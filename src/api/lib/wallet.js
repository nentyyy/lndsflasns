import { db } from './db.js';
import { MAX_OP_COINS } from './config.js';

export class InsufficientFunds extends Error {}
export class AmountError extends Error {}

// Валидация суммы операции: только целое в (0 .. MAX_OP_COINS].
function assertAmount(amount) {
  if (!Number.isInteger(amount)) throw new AmountError('amount must be integer');
  if (amount <= 0) throw new AmountError('amount must be positive');
  if (amount > MAX_OP_COINS) throw new AmountError('amount exceeds per-operation limit');
}

async function writeLedger(trx, { userId, refType, refId, amount, balanceBefore, balanceAfter, meta }) {
  await trx('ledger').insert({
    user_id: userId,
    ref_type: refType,
    ref_id: refId,
    amount,
    balance_before: balanceBefore,
    balance_after: balanceAfter,
    meta: meta ? JSON.stringify(meta) : null
  });
}

// Atomic, overdraft-safe debit inside an existing transaction.
// SELECT ... FOR UPDATE через атомарный conditional UPDATE (race-safe).
// Returns balance after debit. Throws InsufficientFunds if balance < amount.
export async function debit(trx, userId, amount, refType, refId, meta) {
  assertAmount(amount);
  const before = await trx('players').where({ user_id: userId }).first('balance');
  const affected = await trx('players')
    .where({ user_id: userId })
    .andWhere('balance', '>=', amount)
    .update({
      balance: trx.raw('balance - ?', [amount]),
      updated_at: trx.fn.now()
    });
  if (affected === 0) throw new InsufficientFunds();
  const { balance } = await trx('players').where({ user_id: userId }).first('balance');
  await writeLedger(trx, { userId, refType, refId, amount: -amount, balanceBefore: Number(before.balance), balanceAfter: balance, meta });
  return balance;
}

// Credit inside an existing transaction. Returns balance after credit.
export async function credit(trx, userId, amount, refType, refId, meta) {
  if (amount === 0) {
    const { balance } = await trx('players').where({ user_id: userId }).first('balance');
    return balance;
  }
  assertAmount(amount);
  const before = await trx('players').where({ user_id: userId }).first('balance');
  await trx('players')
    .where({ user_id: userId })
    .update({ balance: trx.raw('balance + ?', [amount]), updated_at: trx.fn.now() });
  const { balance } = await trx('players').where({ user_id: userId }).first('balance');
  await writeLedger(trx, { userId, refType, refId, amount, balanceBefore: Number(before.balance), balanceAfter: balance, meta });
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
