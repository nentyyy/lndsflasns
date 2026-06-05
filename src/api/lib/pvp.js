import { randomUUID, createHmac } from 'node:crypto';
import { db } from './db.js';
import { getPvpMode, MAX_ZERO_STREAK, FREE_SPIN_EVERY, WELCOME_CHEAP_DISCOUNT } from './config.js';
import { createServerSeed } from './rng.js';
import { debit, credit } from './wallet.js';
import { addTournamentScore } from './tournaments.js';
import { consumeTicket } from './tickets.js';
import { addPoints } from './points.js';
import { addClanXp } from './clans.js';
import { rewardReferralForWager } from './referral.js';

export class PvpError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}

function makeRng(seed) {
  let counter = 0;
  return () => {
    const h = createHmac('sha256', seed).update(`shuffle:${counter++}`).digest();
    return h.readUInt32BE(0) / 0x100000000;
  };
}

function shuffle(arr, rng) {
  const out = arr.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

async function createLobby(mode) {
  const def = getPvpMode(mode);
  if (!def) throw new PvpError('unknown pvp mode', 404);

  const { serverSeed, serverSeedHash } = createServerSeed();
  const rng = makeRng(serverSeed);
  const shuffled = shuffle(def.outcomesPool, rng);
  const lobbyId = randomUUID();
  // Фиксированное время ставок — 30 секунд.
  const ttlMs = 30_000;

  await db.transaction(async (trx) => {
    const maxRow = await trx('pvp_lobbies').max('round_number as m').first();
    const roundNumber = (Number(maxRow?.m) || 0) + 1;
    await trx('pvp_lobbies').insert({
      id: lobbyId,
      mode,
      card_count: def.cardCount,
      entry_coins: def.entryCoins,
      status: 'open',
      server_seed: serverSeed,
      server_seed_hash: serverSeedHash,
      ttl_ms: ttlMs,
      round_number: roundNumber
    });
    const rows = shuffled.map((o, i) => ({
      lobby_id: lobbyId,
      card_index: i,
      user_id: null,
      status: 'free',
      outcome_key: o.key,
      outcome_type: o.type,
      credit: o.credit,
      stamp: o.stamp
    }));
    await trx('pvp_cards').insert(rows);
  });

  return lobbyId;
}

async function getActiveLobbyRow(mode) {
  return db('pvp_lobbies')
    .where({ mode, status: 'open' })
    .orderBy('created_at', 'desc')
    .first();
}

async function settleIfExpired(lobby) {
  if (!lobby || lobby.status !== 'open' || !lobby.ends_at) return lobby;
  const endsTs = new Date(lobby.ends_at).getTime();
  if (Date.now() < endsTs) return lobby;

  const updated = await db('pvp_lobbies')
    .where({ id: lobby.id, status: 'open' })
    .update({ status: 'sealing' });
  if (!updated) {
    return db('pvp_lobbies').where({ id: lobby.id }).first();
  }

  const cards = await db('pvp_cards').where({ lobby_id: lobby.id, status: 'taken' });

  // Публикуем server_seed для честной игры
  for (const c of cards) {
    // Книга: bonus_mult ×2 на конкретную ячейку.
    const payout = Number(c.credit) * (Number(c.bonus_mult) || 1);
    if (payout > 0) {
      await db.transaction(async (trx) => {
        await credit(trx, c.user_id, payout, 'pvp_payout', `pvp:${lobby.id}:${c.card_index}`);
        await trx('players').where({ user_id: c.user_id }).update({
          coins_won: trx.raw('coins_won + ?', [payout]),
          best_win: trx.raw('CASE WHEN best_win < ? THEN ? ELSE best_win END', [payout, payout]),
          pvp_zero_streak: 0,
          pvp_session_returned: trx.raw('pvp_session_returned + ?', [payout])
        });
      }).catch((e) => console.error('pvp credit err', e.message));
    } else {
      // Нулевой исход — инкрементируем streak
      await db('players')
        .where({ user_id: c.user_id })
        .update({ pvp_zero_streak: db.raw('pvp_zero_streak + 1') })
        .catch(() => {});
    }

    await db('pvp_cards').where({ lobby_id: lobby.id, card_index: c.card_index }).update({
      status: 'revealed',
      revealed_at: db.fn.now()
    });

    try {
      await db.transaction(async (trx) => {
        await addTournamentScore(trx, c.user_id, Number(lobby.entry_coins) + payout);
      });
    } catch {}
  }

  await db('pvp_lobbies').where({ id: lobby.id }).update({
    status: 'settled',
    settled_at: db.fn.now()
  });
  return db('pvp_lobbies').where({ id: lobby.id }).first();
}

// Restart-safety + idle-safety: завершаем все истёкшие лобби, по которым
// ещё не прошла выплата (settleIfExpired ленивый — без трафика не сработает).
export async function sweepExpiredLobbies() {
  const stale = await db('pvp_lobbies')
    .where({ status: 'open' })
    .whereNotNull('ends_at')
    .where('ends_at', '<', new Date().toISOString());
  let settled = 0;
  for (const lobby of stale) {
    try { await settleIfExpired(lobby); settled++; }
    catch (e) { console.error('sweep settle err', lobby.id, e.message); }
  }
  return settled;
}

// ─── Loss protection: если у игрока ≥ MAX_ZERO_STREAK нулей подряд,
// свапаем его карту с первой non-zero свободной картой.
async function applyLossProtection(trx, lobbyId, cardIndex, player) {
  const streak = Number(player.pvp_zero_streak || 0);
  if (streak < MAX_ZERO_STREAK) return false;

  // Смотрим какой outcome у выбранной карты
  const chosen = await trx('pvp_cards').where({ lobby_id: lobbyId, card_index: cardIndex }).first();
  if (!chosen || Number(chosen.credit) > 0) return false; // уже winning — ок

  // Ищем свободную winning карту для свапа
  const winner = await trx('pvp_cards')
    .where({ lobby_id: lobbyId, status: 'free' })
    .whereNot({ card_index: cardIndex })
    .where('credit', '>', 0)
    .first();
  if (!winner) return false;

  // Атомарный свап outcomes
  await trx('pvp_cards')
    .where({ lobby_id: lobbyId, card_index: cardIndex })
    .update({ outcome_key: winner.outcome_key, outcome_type: winner.outcome_type, credit: winner.credit, stamp: winner.stamp });
  await trx('pvp_cards')
    .where({ lobby_id: lobbyId, card_index: winner.card_index })
    .update({ outcome_key: chosen.outcome_key, outcome_type: chosen.outcome_type, credit: chosen.credit, stamp: chosen.stamp });

  return true;
}

// ─── Free spin check: каждые FREE_SPIN_EVERY открытий — бесплатное.
function isFreeReveal(player) {
  const total = Number(player.pvp_total_reveals || 0);
  return total > 0 && (total + 1) % FREE_SPIN_EVERY === 0;
}

function freeTillNext(player) {
  const total = Number(player.pvp_total_reveals || 0);
  const next = FREE_SPIN_EVERY - (total % FREE_SPIN_EVERY);
  return next === FREE_SPIN_EVERY ? 0 : next;
}

export async function buyCard(userId, mode, cardIndex, idempotencyKey) {
  const idx = Number(cardIndex);
  if (!Number.isInteger(idx) || idx < 0) throw new PvpError('bad cardIndex');

  // Anti-replay: проверяем idempotencyKey
  if (idempotencyKey) {
    const existing = await db('pvp_cards').where({ idempotency_key: idempotencyKey }).first();
    if (existing) {
      const player = await db('players').where({ user_id: userId }).first();
      return {
        lobbyId: existing.lobby_id,
        cardIndex: existing.card_index,
        balance: Number(player.balance),
        welcomeApplied: false,
        usedTicket: false,
        cost: 0,
        replayed: true,
        freeTillNext: freeTillNext(player)
      };
    }
  }

  // Закрываем истёкшие лобби
  const existing = await getActiveLobbyRow(mode);
  if (existing) await settleIfExpired(existing);

  let lobby = await getActiveLobbyRow(mode);
  if (!lobby) {
    await createLobby(mode);
    lobby = await getActiveLobbyRow(mode);
  }
  if (!lobby) throw new PvpError('lobby unavailable', 500);
  if (idx >= lobby.card_count) throw new PvpError('cardIndex out of range');

  return db.transaction(async (trx) => {
    // Row-level lock на лобби
    const lock = await trx('pvp_lobbies').where({ id: lobby.id, status: 'open' }).first();
    if (!lock) throw new PvpError('lobby closed', 409);

    const player = await trx('players').where({ user_id: userId }).first();
    if (!player) throw new PvpError('player not found', 404);

    // PvP играется ТОЛЬКО картами (не монетами): welcome → free spin → cheap-карта.
    // Нет карты → 'need_card' (фронт перекинет в покупку карт).
    let welcomeApplied = false;
    let usedTicket = false;
    let wasFree = false;
    const freeReveal = isFreeReveal(player);

    if (!player.welcome_used && WELCOME_CHEAP_DISCOUNT >= 1) {
      welcomeApplied = true;
      wasFree = true;
    } else if (freeReveal) {
      wasFree = true;
    } else if (await consumeTicket(trx, userId, 'cheap')) {
      usedTicket = true;
    } else {
      throw new PvpError('need_card', 402);
    }
    const cost = 0; // монетами PvP больше не оплачивается

    // Применяем loss protection перед атомарным занятием
    await applyLossProtection(trx, lobby.id, idx, player);

    // Атомарно занять карту (race condition защита через FK/PK constraint)
    const occupied = await trx('pvp_cards')
      .where({ lobby_id: lobby.id, card_index: idx, status: 'free' })
      .update({
        user_id: userId,
        status: 'taken',
        taken_at: trx.fn.now(),
        idempotency_key: idempotencyKey || null,
        was_free: wasFree
      });
    if (!occupied) throw new PvpError('card already taken', 409);

    // Anti double-bet: один игрок не может иметь 2 занятых карты одновременно — снимаем это ограничение
    // (разрешаем несколько карт на игрока в одном раунде, это законная игра)

    let balance;
    if (cost > 0) {
      balance = await debit(trx, userId, cost, 'pvp_bet', `pvp:${lobby.id}:${idx}`);
      await trx('players').where({ user_id: userId }).update({
        coins_spent: trx.raw('coins_spent + ?', [cost]),
        pvp_session_wagered: trx.raw('pvp_session_wagered + ?', [cost])
      });
    } else {
      const row = await trx('players').where({ user_id: userId }).first('balance');
      balance = row.balance;
    }

    if (welcomeApplied) {
      await trx('players').where({ user_id: userId }).update({ welcome_used: true });
    }

    // Инкрементируем pvp_total_reveals (для free spin счётчика)
    await trx('players').where({ user_id: userId }).update({
      pvp_total_reveals: trx.raw('pvp_total_reveals + 1')
    });

    // Поинты лояльности + XP клана + реферальный рейк.
    await addPoints(trx, userId, Number(lobby.entry_coins));
    addClanXp(userId, Number(lobby.entry_coins)).catch(() => {});
    rewardReferralForWager(userId, Number(lobby.entry_coins)).catch(() => {});

    // Запустить таймер при первой покупке
    if (!lobby.opened_at) {
      const opened = new Date();
      const ttlMs = Number(lobby.ttl_ms || 35_000);
      const ends = new Date(opened.getTime() + ttlMs);
      await trx('pvp_lobbies').where({ id: lobby.id }).update({
        opened_at: opened.toISOString(),
        ends_at: ends.toISOString()
      });
    }

    const updatedPlayer = await trx('players').where({ user_id: userId }).first();
    const till = freeTillNext(updatedPlayer);

    return { lobbyId: lobby.id, cardIndex: idx, balance, welcomeApplied, usedTicket, cost, wasFree, freeTillNext: till, replayed: false };
  });
}

// Купить N случайных ячеек: игрок выбирает количество, ячейки ставятся рандомно.
// Каждая ячейка оплачивается welcome → free spin → cheap-картой. Если карт не хватает,
// ставим столько, на сколько хватило (partial), и возвращаем placed.
export async function buyRandomCards(userId, mode, countRaw, idempotencyKey) {
  const count = Math.max(1, Math.min(36, Number(countRaw) || 1));

  // Anti-replay: если этот батч уже выполнялся — вернём те же ячейки.
  if (idempotencyKey) {
    const prev = await db('pvp_cards').where('idempotency_key', 'like', `${idempotencyKey}:%`).orderBy('card_index', 'asc');
    if (prev.length) {
      const player = await db('players').where({ user_id: userId }).first();
      return { lobbyId: prev[0].lobby_id, placed: prev.length, cells: prev.map((c) => c.card_index), balance: Number(player.balance), freeTillNext: freeTillNext(player), replayed: true };
    }
  }

  const existingLobby = await getActiveLobbyRow(mode);
  if (existingLobby) await settleIfExpired(existingLobby);
  let lobby = await getActiveLobbyRow(mode);
  if (!lobby) { await createLobby(mode); lobby = await getActiveLobbyRow(mode); }
  if (!lobby) throw new PvpError('lobby unavailable', 500);

  return db.transaction(async (trx) => {
    const lock = await trx('pvp_lobbies').where({ id: lobby.id, status: 'open' }).first();
    if (!lock) throw new PvpError('lobby closed', 409);

    // Свободные ячейки в случайном порядке.
    const freeRows = await trx('pvp_cards').where({ lobby_id: lobby.id, status: 'free' }).select('card_index');
    const freeIdx = freeRows.map((r) => r.card_index);
    for (let i = freeIdx.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [freeIdx[i], freeIdx[j]] = [freeIdx[j], freeIdx[i]]; }

    const cells = [];
    let welcomeApplied = false;
    for (const idx of freeIdx) {
      if (cells.length >= count) break;

      // Атомарно занимаем ячейку.
      const occupied = await trx('pvp_cards')
        .where({ lobby_id: lobby.id, card_index: idx, status: 'free' })
        .update({ user_id: userId, status: 'taken', taken_at: trx.fn.now(), idempotency_key: idempotencyKey ? `${idempotencyKey}:${idx}` : null });
      if (!occupied) continue; // гонка — пробуем следующую

      // Определяем оплату: welcome → free spin → cheap-карта.
      const player = await trx('players').where({ user_id: userId }).first();
      let wasFree = false;
      if (!player.welcome_used && WELCOME_CHEAP_DISCOUNT >= 1 && !welcomeApplied) {
        welcomeApplied = true; wasFree = true;
        await trx('players').where({ user_id: userId }).update({ welcome_used: true });
      } else if (isFreeReveal(player)) {
        wasFree = true;
      } else if (await consumeTicket(trx, userId, 'cheap')) {
        // оплачено картой
      } else {
        // Нет оплаты — освобождаем ячейку и останавливаемся.
        await trx('pvp_cards').where({ lobby_id: lobby.id, card_index: idx }).update({ user_id: null, status: 'free', taken_at: null, idempotency_key: null });
        break;
      }

      await trx('pvp_cards').where({ lobby_id: lobby.id, card_index: idx }).update({ was_free: wasFree });
      await applyLossProtection(trx, lobby.id, idx, player);
      await trx('players').where({ user_id: userId }).update({ pvp_total_reveals: trx.raw('pvp_total_reveals + 1') });
      await addPoints(trx, userId, Number(lobby.entry_coins));
      rewardReferralForWager(userId, Number(lobby.entry_coins)).catch(() => {});
      cells.push(idx);
    }

    if (cells.length === 0) throw new PvpError('need_card', 402);

    // Запускаем таймер при первой покупке в лобби.
    const fresh = await trx('pvp_lobbies').where({ id: lobby.id }).first();
    if (!fresh.opened_at) {
      const opened = new Date();
      const ends = new Date(opened.getTime() + Number(fresh.ttl_ms || 35_000));
      await trx('pvp_lobbies').where({ id: lobby.id }).update({ opened_at: opened.toISOString(), ends_at: ends.toISOString() });
    }

    const updatedPlayer = await trx('players').where({ user_id: userId }).first();
    return { lobbyId: lobby.id, placed: cells.length, cells, balance: Number(updatedPlayer.balance), welcomeApplied, freeTillNext: freeTillNext(updatedPlayer), replayed: false };
  });
}

export async function getPvpState(userId, mode) {
  let active = await getActiveLobbyRow(mode);
  if (active) active = await settleIfExpired(active);

  if (!active || active.status !== 'open') {
    const recent = await db('pvp_lobbies')
      .where({ mode, status: 'settled' })
      .orderBy('settled_at', 'desc')
      .first();
    if (recent && Date.now() - new Date(recent.settled_at).getTime() < 12_000) {
      return viewLobby(recent, userId, true);
    }
    return { lobby: null, mode };
  }

  return viewLobby(active, userId, false);
}

async function viewLobby(lobby, userId, allRevealed) {
  const cards = await db('pvp_cards').where({ lobby_id: lobby.id }).orderBy('card_index', 'asc');

  // Подтягиваем данные игроков для аватаров
  const takenUserIds = [...new Set(cards.filter((c) => c.user_id).map((c) => String(c.user_id)))];
  let playerMap = {};
  if (takenUserIds.length > 0) {
    const players = await db('players').whereIn('user_id', takenUserIds).select('user_id', 'first_name', 'last_name', 'username', 'avatar_file_id');
    for (const p of players) {
      playerMap[String(p.user_id)] = {
        name: [p.first_name, p.last_name].filter(Boolean).join(' ') || p.username || `Player #${String(p.user_id).slice(-4)}`,
        username: p.username || null,
        avatarUrl: p.avatar_file_id ? `/api/avatar/${p.avatar_file_id}` : null,
      };
    }
  }

  const view = cards.map((c) => {
    const mine = c.user_id && String(c.user_id) === String(userId);
    const isRevealed = allRevealed || c.status === 'revealed';
    const owner = c.user_id ? playerMap[String(c.user_id)] : null;
    return {
      index: c.card_index,
      status: c.status,
      mine: Boolean(mine),
      taken: c.status !== 'free',
      owner: owner ? { name: owner.name, username: owner.username, avatarUrl: owner.avatarUrl, userId: String(c.user_id) } : null,
      outcome: isRevealed ? { key: c.outcome_key, type: c.outcome_type, credit: Number(c.credit), stamp: c.stamp } : null
    };
  });

  // Сквозной порядковый номер раунда (глобальный счётчик, не сбрасывается).
  const gameNum = lobby.round_number || null;

  return {
    lobby: {
      id: lobby.id,
      gameNum,
      mode: lobby.mode,
      status: lobby.status,
      cardCount: lobby.card_count,
      entryCoins: Number(lobby.entry_coins),
      openedAt: lobby.opened_at ? new Date(lobby.opened_at).toISOString() : null,
      endsAt: lobby.ends_at ? new Date(lobby.ends_at).toISOString() : null,
      settledAt: lobby.settled_at ? new Date(lobby.settled_at).toISOString() : null,
      serverSeedHash: lobby.server_seed_hash,
      serverSeed: allRevealed ? lobby.server_seed : null
    },
    cards: view
  };
}

export async function getLiveFeed(limit = 20) {
  const rows = await db('ledger as l')
    .join('players as p', 'l.user_id', 'p.user_id')
    .whereIn('l.ref_type', ['pvp_payout', 'payout'])
    .where('l.amount', '>', 0)
    .orderBy('l.id', 'desc')
    .limit(limit)
    .select('l.amount', 'l.created_at', 'p.user_id', 'p.first_name', 'p.last_name', 'p.username', 'p.avatar_file_id');
  return rows.map((r) => ({
    userId: String(r.user_id),
    name: [r.first_name, r.last_name].filter(Boolean).join(' ') || r.username || 'Игрок',
    username: r.username || null,
    avatarUrl: r.avatar_file_id ? `/api/avatar/${r.avatar_file_id}` : null,
    amount: Number(r.amount),
    date: r.created_at
  }));
}
