import { randomUUID } from 'node:crypto';
import { db } from './db.js';
import { getMode } from './config.js';
import { createServerSeed, roll, pickOutcome } from './rng.js';
import { debit, credit } from './wallet.js';
import { addTournamentScore } from './tournaments.js';
import { addPoints } from './points.js';

export class GameError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

// Arm a round: commit a server seed and debit the entry atomically.
// The outcome is NOT decided yet from the client's perspective — only the
// server seed hash is published. Idempotent on (user_id, idempotencyKey).
export async function armRound(userId, modeId, clientSeed, idempotencyKey, betRaw) {
  const mode = getMode(modeId);
  if (!mode) throw new GameError('unknown mode', 404);
  const seed = (clientSeed || randomUUID()).slice(0, 64);

  // Ставка монетами от minBet до maxBet (целые дублоны).
  const bet = Math.floor(Number(betRaw) || 0);
  if (!Number.isInteger(bet) || bet < mode.minBet) throw new GameError('min_bet', 400);
  if (bet > mode.maxBet) throw new GameError('max_bet', 400);

  return db.transaction(async (trx) => {
    if (idempotencyKey) {
      const dup = await trx('rounds').where({ user_id: userId, idempotency_key: idempotencyKey }).first();
      if (dup) {
        const { balance } = await trx('players').where({ user_id: userId }).first('balance');
        return { roundId: dup.id, serverSeedHash: dup.server_seed_hash, entry: dup.entry, mode: dup.mode, balance, reused: true };
      }
    }

    // Премиум играется ставкой монетами — списываем bet атомарно.
    const entryCost = bet;
    const balance = await debit(trx, userId, bet, 'premium_bet', `premium:${idempotencyKey || randomUUID()}`);
    await trx('players').where({ user_id: userId }).update({ coins_spent: trx.raw('coins_spent + ?', [bet]) });
    await addPoints(trx, userId, bet); // поинты лояльности за ставку

    const { serverSeed, serverSeedHash } = createServerSeed();
    await trx('players').where({ user_id: userId }).update({ nonce: trx.raw('nonce + 1') });
    const { nonce } = await trx('players').where({ user_id: userId }).first('nonce');

    const roundId = randomUUID();
    await trx('rounds').insert({
      id: roundId,
      user_id: userId,
      mode: mode.id,
      entry: entryCost,
      client_seed: seed,
      server_seed: serverSeed,
      server_seed_hash: serverSeedHash,
      nonce,
      status: 'armed',
      idempotency_key: idempotencyKey || null
    });

    return { roundId, serverSeedHash, entry: entryCost, mode: mode.id, balance, reused: false };
  });
}

// Reveal: decide the outcome from the committed seed, apply payout atomically.
// Idempotent — replaying a revealed round returns the stored result.
export async function revealRound(userId, roundId, clauseIndexRaw) {
  const clauseIndex = Number.isInteger(clauseIndexRaw) ? clauseIndexRaw : 0;

  return db.transaction(async (trx) => {
    const round = await trx('rounds').where({ id: roundId, user_id: userId }).first();
    if (!round) throw new GameError('round not found', 404);
    const mode = getMode(round.mode);

    if (round.status === 'revealed') {
      const { balance } = await trx('players').where({ user_id: userId }).first('balance');
      return buildResult(round, balance, true);
    }

    const r = roll(round.server_seed, round.client_seed, round.nonce, clauseIndex);
    const outcome = pickOutcome(mode, r);
    // Приз = ставка × множитель карты. Каждая карта независима (provably-fair по index).
    const bet = Number(round.entry) || 0;
    const creditCoins = Math.floor(bet * (outcome.mult || 0));

    let balance = (await trx('players').where({ user_id: userId }).first('balance')).balance;
    if (creditCoins > 0) {
      balance = await credit(trx, userId, creditCoins, 'payout', `payout:${roundId}`);
    }

    await trx('players').where({ user_id: userId }).update({
      games_played: trx.raw('games_played + 1'),
      coins_won: trx.raw('coins_won + ?', [creditCoins]),
      best_win: trx.raw('CASE WHEN best_win < ? THEN ? ELSE best_win END', [creditCoins, creditCoins])
    });

    await trx('rounds').where({ id: roundId }).update({
      status: 'revealed',
      outcome_key: outcome.key,
      outcome_type: outcome.type,
      credit: creditCoins,
      clause_index: clauseIndex,
      revealed_at: trx.fn.now()
    });

    // Очки в активный турнир: ставка + выигрыш.
    try {
      const score = Number(round.entry || 0) + Number(creditCoins || 0);
      if (score > 0) await addTournamentScore(trx, userId, score);
    } catch (e) {
      console.warn('tournament score skipped', e.message);
    }

    return buildResult({ ...round, outcome_key: outcome.key, outcome_type: outcome.type, credit: creditCoins, clause_index: clauseIndex }, balance, false);
  });
}

const PREMIUM_CARDS = 5;

function buildResult(round, balance, replayed) {
  const mode = getMode(round.mode);
  const outcome = mode.outcomes.find((o) => o.key === round.outcome_key) || {};
  // Что было бы под КАЖДОЙ картой (provably-fair: тот же seed+nonce, индекс карты).
  // Раскрываем все, чтобы после выбора подсветить остальные. Приз = ставка × множитель.
  const picked = Number(round.clause_index) || 0;
  const bet = Number(round.entry) || 0;
  const board = Array.from({ length: PREMIUM_CARDS }).map((_, i) => {
    const o = pickOutcome(mode, roll(round.server_seed, round.client_seed, round.nonce, i));
    return { type: o.type, key: o.key, stamp: o.stamp, credit: Math.floor(bet * (o.mult || 0)), picked: i === picked };
  });
  return {
    balance,
    replayed,
    board,
    result: {
      type: round.outcome_type,
      key: round.outcome_key,
      stamp: outcome.stamp,
      credit: Number(round.credit) || 0
    },
    fair: {
      serverSeed: round.server_seed,
      serverSeedHash: round.server_seed_hash,
      clientSeed: round.client_seed,
      nonce: Number(round.nonce),
      clauseIndex: round.clause_index
    }
  };
}
