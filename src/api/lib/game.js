import { randomUUID } from 'node:crypto';
import { db } from './db.js';
import { getMode } from './config.js';
import { createServerSeed, roll, pickOutcome } from './rng.js';
import { debit, credit } from './wallet.js';
import { addTournamentScore } from './tournaments.js';
import { consumeTicket } from './tickets.js';

export class GameError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

// Arm a round: commit a server seed and debit the entry atomically.
// The outcome is NOT decided yet from the client's perspective — only the
// server seed hash is published. Idempotent on (user_id, idempotencyKey).
export async function armRound(userId, modeId, clientSeed, idempotencyKey) {
  const mode = getMode(modeId);
  if (!mode) throw new GameError('unknown mode', 404);
  const seed = (clientSeed || randomUUID()).slice(0, 64);

  return db.transaction(async (trx) => {
    if (idempotencyKey) {
      const dup = await trx('rounds').where({ user_id: userId, idempotency_key: idempotencyKey }).first();
      if (dup) {
        const { balance } = await trx('players').where({ user_id: userId }).first('balance');
        return { roundId: dup.id, serverSeedHash: dup.server_seed_hash, entry: dup.entry, mode: dup.mode, balance, reused: true };
      }
    }

    // Премиум играется ТОЛЬКО премиум-картами (не монетами).
    // Нет карты → 'need_card' (фронт перекинет в покупку карт).
    const entryCost = 0;
    let usedTicket = false;
    if (await consumeTicket(trx, userId, 'premium')) {
      usedTicket = true;
    } else {
      throw new GameError('need_card', 402);
    }
    const { balance } = await trx('players').where({ user_id: userId }).first('balance');

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

    return { roundId, serverSeedHash, entry: entryCost, mode: mode.id, balance, reused: false, usedTicket };
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
    const player = await trx('players').where({ user_id: userId }).first();
    let creditCoins = outcome.credit;
    let usedMultiplier = false;
    if ((outcome.type === 'coins' || outcome.type === 'bonus') && player.multiplier > 1) {
      creditCoins = outcome.credit * player.multiplier;
      usedMultiplier = true;
    }
    const nextMultiplier = outcome.type === 'multiplier'
      ? (outcome.nextMultiplier || 2)
      : (usedMultiplier ? 1 : player.multiplier);

    let balance = player.balance;
    if (creditCoins > 0) {
      balance = await credit(trx, userId, creditCoins, 'payout', `payout:${roundId}`);
    }

    await trx('players').where({ user_id: userId }).update({
      multiplier: nextMultiplier,
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

    return buildResult({ ...round, outcome_key: outcome.key, outcome_type: outcome.type, credit: creditCoins, clause_index: clauseIndex }, balance, false, { usedMultiplier, nextMultiplier });
  });
}

function buildResult(round, balance, replayed, extra = {}) {
  const mode = getMode(round.mode);
  const outcome = mode.outcomes.find((o) => o.key === round.outcome_key) || {};
  return {
    balance,
    replayed,
    result: {
      type: round.outcome_type,
      key: round.outcome_key,
      stamp: outcome.stamp,
      credit: Number(round.credit) || 0,
      usedMultiplier: extra.usedMultiplier || false,
      nextMultiplier: extra.nextMultiplier
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
