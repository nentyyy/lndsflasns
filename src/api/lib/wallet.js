import { db } from './db.js';

export class InsufficientFunds extends Error {}

// Atomic, overdraft-safe debit inside an existing transaction.
// Returns balance after debit. Throws InsufficientFunds if balance < amount.
export async function debit(trx, userId, amount, refType, refId) {
  if (amount <= 0) throw new Error('debit amount must be positive');
  const affected = await trx('players')
    .where({ user_id: userId })
    .andWhere('balance', '>=', amount)
    .update({
      balance: trx.raw('balance - ?', [amount]),
      updated_at: trx.fn.now()
    });
  if (affected === 0) throw new InsufficientFunds();
  const { balance } = await trx('players').where({ user_id: userId }).first('balance');
  await trx('ledger').insert({
    user_id: userId,
    ref_type: refType,
    ref_id: refId,
    amount: -amount,
    balance_after: balance
  });
  return balance;
}

// Credit inside an existing transaction. Returns balance after credit.
export async function credit(trx, userId, amount, refType, refId) {
  if (amount < 0) throw new Error('credit amount must be >= 0');
  if (amount === 0) {
    const { balance } = await trx('players').where({ user_id: userId }).first('balance');
    return balance;
  }
  await trx('players')
    .where({ user_id: userId })
    .update({ balance: trx.raw('balance + ?', [amount]), updated_at: trx.fn.now() });
  const { balance } = await trx('players').where({ user_id: userId }).first('balance');
  await trx('ledger').insert({
    user_id: userId,
    ref_type: refType,
    ref_id: refId,
    amount,
    balance_after: balance
  });
  return balance;
}

// Idempotent credit used by deposit settlement. Safe to call twice for the
// same (refType, refId): the second call is a no-op thanks to the UNIQUE
// ledger constraint (the backstop) and the existence pre-check.
export async function creditOnce(userId, amount, refType, refId) {
  return db.transaction(async (trx) => {
    const existing = await trx('ledger').where({ ref_type: refType, ref_id: refId }).first();
    if (existing) return { balance: existing.balance_after, applied: false };
    const balance = await credit(trx, userId, amount, refType, refId);
    return { balance, applied: true };
  });
}

export async function getPlayer(userId) {
  return db('players').where({ user_id: userId }).first();
}
