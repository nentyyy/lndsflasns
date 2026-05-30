import { randomUUID } from 'node:crypto';
import { db } from './db.js';
import { debit } from './wallet.js';
import { getPoints, spendPoints } from './points.js';
import { getGiftFromCache } from './portals.js';
import { notifyAdminsPurchase } from './admin-notify.js';

export class ArtifactError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}

// ─── Каталог артефактов (Лавка торговца) ───
export const ARTIFACT_CATALOG = [
  { id: 'card',   name: 'Игральная карта', description: 'Выбор 1 дополнительной ячейки вручную',                price: 5,  effect: { kind: 'place_choose', cells: 1 } },
  { id: 'amulet', name: 'Амулет',          description: '3 случайные ячейки, 1 гарантированно с призом',         price: 18, effect: { kind: 'place_random', cells: 3, guarantee: true, excludeMax: true } },
  { id: 'staff',  name: 'Посох',           description: 'Показывает ряд, где находится приз',                    price: 10, effect: { kind: 'reveal_row' } },
  { id: 'guide',  name: 'Путеводитель',    description: 'Показывает 1 выигрышную ячейку',                        price: 10, effect: { kind: 'reveal_cell', excludeMax: true } },
  { id: 'book',   name: 'Книга',           description: 'Удваивает приз выбранной ячейки',                       price: 10, effect: { kind: 'double_cell', excludeMax: true } }
];

export async function seedArtifacts() {
  for (const a of ARTIFACT_CATALOG) {
    const row = { id: a.id, name: a.name, description: a.description, type: a.effect.kind, level: 1, price: a.price, effect: JSON.stringify(a.effect) };
    const exists = await db('artifacts').where({ id: a.id }).first();
    if (exists) await db('artifacts').where({ id: a.id }).update(row);
    else await db('artifacts').insert(row);
  }
  // Старый каталог (opener_*/guide_*/mirror/curse/shield/double) — удаляем.
  await db('artifacts').whereNotIn('id', ARTIFACT_CATALOG.map((a) => a.id)).del().catch(() => {});
}

const fromRow = (r) => ({ id: r.id, name: r.name, description: r.description, price: Number(r.price), effect: typeof r.effect === 'string' ? JSON.parse(r.effect) : r.effect });

export async function listArtifacts() {
  const rows = await db('artifacts');
  const order = ARTIFACT_CATALOG.map((a) => a.id);
  return rows.map(fromRow).sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
}

async function grantArtifact(trx, userId, artifactId, qty = 1) {
  const existing = await trx('player_artifacts').where({ user_id: String(userId), artifact_id: artifactId }).first();
  if (existing) await trx('player_artifacts').where({ id: existing.id }).update({ quantity: trx.raw('quantity + ?', [qty]) });
  else await trx('player_artifacts').insert({ id: randomUUID(), user_id: String(userId), artifact_id: artifactId, quantity: qty, acquired_at: trx.fn.now() });
}

export async function buyArtifact(userId, artifactId) {
  const art = await db('artifacts').where({ id: artifactId }).first();
  if (!art) throw new ArtifactError('artifact_not_found', 404);
  let balance;
  await db.transaction(async (trx) => {
    balance = await debit(trx, userId, Number(art.price), 'artifact_buy', `art:${artifactId}:${randomUUID()}`);
    await grantArtifact(trx, userId, artifactId);
  });
  return { balance, artifact: fromRow(art) };
}

export async function listInventory(userId) {
  const rows = await db('player_artifacts as pa')
    .join('artifacts as a', 'pa.artifact_id', 'a.id')
    .where('pa.user_id', String(userId)).where('pa.quantity', '>', 0)
    .select('pa.artifact_id', 'pa.quantity', 'a.name', 'a.description', 'a.price', 'a.effect');
  return rows.map((r) => ({ artifactId: r.artifact_id, name: r.name, description: r.description, quantity: Number(r.quantity), effect: JSON.parse(r.effect) }));
}

// ─── Применение артефактов ───
// Сетка 36 ячеек: ряд = строка раскладки (для Посоха).
function rowsOf(cardCount) {
  const rows = [];
  const top = [0, 1, 2].filter((i) => i < cardCount); if (top.length) rows.push(top);
  const midEnd = Math.min(33, cardCount);
  for (let i = Math.min(3, cardCount); i < midEnd; i += 5) rows.push(Array.from({ length: Math.min(5, midEnd - i) }, (_, k) => i + k));
  const bot = [33, 34, 35].filter((i) => i < cardCount); if (bot.length) rows.push(bot);
  return rows;
}

async function openLobby() {
  const lobby = await db('pvp_lobbies').where({ status: 'open' }).orderBy('created_at', 'desc').first();
  if (!lobby) return null;
  // Таймер ещё не истёк (если запущен).
  if (lobby.ends_at && new Date(lobby.ends_at).getTime() < Date.now()) return null;
  return lobby;
}

async function maxPrizeIndex(lobbyId) {
  const top = await db('pvp_cards').where({ lobby_id: lobbyId }).orderBy('credit', 'desc').first('card_index', 'credit');
  return top ? top.card_index : -1;
}

// Применить артефакт. targetCells — массив выбранных индексов (для card/book).
export async function useArtifact(userId, artifactId, targetCells = []) {
  const art = await db('artifacts').where({ id: artifactId }).first();
  if (!art) throw new ArtifactError('artifact_not_found', 404);
  const eff = JSON.parse(art.effect);

  const lobby = await openLobby();
  if (!lobby) throw new ArtifactError('round_over', 409); // нельзя после таймера / нет раунда

  // Владение + один и тот же артефакт нельзя 2 раза за раунд.
  const owned = await db('player_artifacts').where({ user_id: String(userId), artifact_id: artifactId }).first();
  if (!owned || owned.quantity <= 0) throw new ArtifactError('not_owned', 409);
  const usedThisRound = await db('round_artifacts').where({ lobby_id: lobby.id, user_id: String(userId), artifact_id: artifactId }).first();
  if (usedThisRound) throw new ArtifactError('already_used_this_round', 409);

  const maxIdx = await maxPrizeIndex(lobby.id);

  // Готовим результат эффекта ДО списания (списываем только при успехе).
  let result;

  if (eff.kind === 'place_choose') {
    const idx = Number(targetCells?.[0]);
    if (!Number.isInteger(idx)) throw new ArtifactError('need_target_cell', 400);
    result = await db.transaction(async (trx) => {
      const ok = await trx('pvp_cards').where({ lobby_id: lobby.id, card_index: idx, status: 'free' })
        .update({ user_id: userId, status: 'taken', taken_at: trx.fn.now(), was_free: true });
      if (!ok) throw new ArtifactError('cell_taken', 409);
      await startTimerIfNeeded(trx, lobby);
      await consumeAndMark(trx, userId, artifactId, lobby.id);
      return { kind: 'place', cells: [idx] };
    });
  } else if (eff.kind === 'place_random') {
    const free = await db('pvp_cards').where({ lobby_id: lobby.id, status: 'free' }).select('card_index', 'credit');
    if (free.length < eff.cells) throw new ArtifactError('not_enough_free_cells', 409);
    const winners = free.filter((c) => Number(c.credit) > 0 && !(eff.excludeMax && c.card_index === maxIdx));
    const pick = [];
    if (eff.guarantee && winners.length) pick.push(winners[Math.floor(Math.random() * winners.length)].card_index);
    const pool = free.map((c) => c.card_index).filter((i) => !pick.includes(i));
    for (let i = pool.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [pool[i], pool[j]] = [pool[j], pool[i]]; }
    while (pick.length < eff.cells && pool.length) pick.push(pool.shift());
    result = await db.transaction(async (trx) => {
      const placed = [];
      for (const idx of pick) {
        const ok = await trx('pvp_cards').where({ lobby_id: lobby.id, card_index: idx, status: 'free' })
          .update({ user_id: userId, status: 'taken', taken_at: trx.fn.now(), was_free: true });
        if (ok) placed.push(idx);
      }
      if (!placed.length) throw new ArtifactError('cells_taken', 409);
      await startTimerIfNeeded(trx, lobby);
      await consumeAndMark(trx, userId, artifactId, lobby.id);
      return { kind: 'place', cells: placed };
    });
  } else if (eff.kind === 'reveal_row') {
    const prize = await db('pvp_cards').where({ lobby_id: lobby.id }).where('credit', '>', 0)
      .orderByRaw('RANDOM()').first('card_index');
    if (!prize) throw new ArtifactError('no_prize', 409);
    const row = rowsOf(lobby.card_count).find((r) => r.includes(prize.card_index)) || [];
    result = await db.transaction(async (trx) => {
      await consumeAndMark(trx, userId, artifactId, lobby.id);
      return { kind: 'reveal_row', row };
    });
  } else if (eff.kind === 'reveal_cell') {
    const cell = await db('pvp_cards').where({ lobby_id: lobby.id }).where('credit', '>', 0)
      .modify((q) => { if (eff.excludeMax && maxIdx >= 0) q.whereNot('card_index', maxIdx); })
      .orderByRaw('RANDOM()').first('card_index');
    if (!cell) throw new ArtifactError('no_prize', 409);
    result = await db.transaction(async (trx) => {
      await consumeAndMark(trx, userId, artifactId, lobby.id);
      return { kind: 'reveal_cell', cell: cell.card_index };
    });
  } else if (eff.kind === 'double_cell') {
    const idx = Number(targetCells?.[0]);
    if (!Number.isInteger(idx)) throw new ArtifactError('need_target_cell', 400);
    if (eff.excludeMax && idx === maxIdx) throw new ArtifactError('cannot_double_top', 400);
    result = await db.transaction(async (trx) => {
      const card = await trx('pvp_cards').where({ lobby_id: lobby.id, card_index: idx }).first();
      if (!card || String(card.user_id) !== String(userId)) throw new ArtifactError('not_your_cell', 409);
      await trx('pvp_cards').where({ lobby_id: lobby.id, card_index: idx }).update({ bonus_mult: 2 });
      await consumeAndMark(trx, userId, artifactId, lobby.id);
      return { kind: 'double_cell', cell: idx };
    });
  } else {
    throw new ArtifactError('unknown_effect', 400);
  }

  return { applied: true, ...result };
}

async function startTimerIfNeeded(trx, lobby) {
  const fresh = await trx('pvp_lobbies').where({ id: lobby.id }).first();
  if (!fresh.opened_at) {
    const opened = new Date();
    const ends = new Date(opened.getTime() + Number(fresh.ttl_ms || 35_000));
    await trx('pvp_lobbies').where({ id: lobby.id }).update({ opened_at: opened.toISOString(), ends_at: ends.toISOString() });
  }
}

async function consumeAndMark(trx, userId, artifactId, lobbyId) {
  const ok = await trx('player_artifacts').where({ user_id: String(userId), artifact_id: artifactId }).where('quantity', '>', 0)
    .update({ quantity: trx.raw('quantity - 1') });
  if (!ok) throw new ArtifactError('not_owned', 409);
  await trx('round_artifacts').insert({ lobby_id: lobbyId, user_id: String(userId), artifact_id: artifactId, used_at: trx.fn.now() });
}

// ─── Магазин поинтов ───
export const POINTS_SHOP = [
  { id: 'pts_art', cost: 500, kind: 'artifact_choice', label: 'Любой артефакт на выбор' },
  { id: 'pts_nft_floor', cost: 5000, kind: 'nft_random', maxValue: null, label: 'Случайный НФТ из флор-каталога' },
  { id: 'pts_nft_50', cost: 10000, kind: 'nft_choice', maxValue: 50, label: 'НФТ на выбор до 50 дублонов' },
  { id: 'pts_nft_200', cost: 25000, kind: 'nft_choice', maxValue: 200, label: 'НФТ на выбор до 200 дублонов' }
];

export async function getPointsShop(userId) {
  const p = await getPoints(userId);
  return { points: p.points, totalEarned: p.totalEarned, items: POINTS_SHOP };
}

export async function spendPointsShop(userId, itemId, targetId) {
  const item = POINTS_SHOP.find((i) => i.id === itemId);
  if (!item) throw new ArtifactError('item_not_found', 404);

  if (item.kind === 'artifact_choice') {
    const art = await db('artifacts').where({ id: targetId }).first();
    if (!art) throw new ArtifactError('bad_artifact_choice', 400);
    await db.transaction(async (trx) => {
      await spendPoints(trx, userId, item.cost);
      await grantArtifact(trx, userId, art.id);
    });
    return { ok: true, granted: { type: 'artifact', id: art.id, name: art.name } };
  }

  let gift;
  if (item.kind === 'nft_random') {
    const floor = await db('portals_cache').where('available', true).orderBy('priceCoins', 'asc').limit(8);
    if (!floor.length) throw new ArtifactError('no_gifts', 409);
    gift = floor[Math.floor(Math.random() * floor.length)];
  } else {
    gift = await getGiftFromCache(targetId);
    if (!gift) throw new ArtifactError('gift_not_found', 404);
    if (item.maxValue && Number(gift.priceCoins) > item.maxValue) throw new ArtifactError('gift_over_limit', 400);
  }
  const purchaseId = randomUUID();
  await db.transaction(async (trx) => {
    await spendPoints(trx, userId, item.cost);
    await trx('portals_purchases').insert({
      id: purchaseId, user_id: String(userId), gift_id: gift.id, gift_name: gift.name,
      price_coins: Number(gift.priceCoins) || 0, idempotency_key: `pts:${purchaseId}`, status: 'pending'
    });
  });
  notifyAdminsPurchase({ id: purchaseId, user_id: String(userId), gift_id: gift.id, gift_name: gift.name, price_coins: Number(gift.priceCoins) || 0 })
    .catch((e) => console.error('pts nft notify err', e.message));
  return { ok: true, granted: { type: 'nft', id: gift.id, name: gift.name }, purchaseId };
}
