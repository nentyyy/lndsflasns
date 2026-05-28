import { randomUUID } from 'node:crypto';
import { db } from '../db.js';
import { getTonPack } from '../config.js';
import { creditOnce } from '../wallet.js';
import { rewardReferralForDeposit } from '../referral.js';

// CryptoBot / @send deposit via t.me/send
// Пользователь платит TON через @send бота и указывает depositId как comment.
// Верификация через тот же TON-поллер (проверяем PROJECT_TON_WALLET).

export const SEND_BOT_LINK = 't.me/send?start=IVA6oMXOKQEF';

export async function createCryptobotDeposit(userId, packId) {
  const pack = getTonPack(packId);
  if (!pack) throw new Error('unknown pack');

  const depositId = randomUUID();
  await db('deposits').insert({
    id: depositId,
    user_id: userId,
    method: 'cryptobot',
    pack_id: pack.id,
    status: 'pending',
    coins: pack.coins,
    bonus: pack.bonus,
    currency: 'TON',
    expected_amount: pack.nanoton,
    ton_comment: depositId
  });

  return {
    depositId,
    comment: depositId,
    amountTon: pack.nanoton / 1e9,
    amountNanoton: pack.nanoton,
    sendBotLink: SEND_BOT_LINK,
    deepLink: `https://t.me/send?startapp=transaction&amount=${pack.nanoton / 1e9}&comment=${encodeURIComponent(depositId)}`,
    pack
  };
}

// Settle cryptobot deposit — вызывается из TON-поллера при совпадении comment.
// Идентичен ton settle, поэтому переиспользуем creditOnce.
export async function settleCryptobotDeposit(depositId, txHash) {
  const deposit = await db('deposits').where({ id: depositId, method: 'cryptobot', status: 'pending' }).first();
  if (!deposit) return null;

  const total = Number(deposit.coins) + Number(deposit.bonus);
  const { applied } = await creditOnce(deposit.user_id, total, 'deposit_cryptobot', deposit.id);
  if (applied) {
    await db('deposits').where({ id: deposit.id }).update({
      status: 'paid',
      ton_tx_hash: txHash || null,
      paid_at: db.fn.now()
    });
    await rewardReferralForDeposit(deposit.id).catch((e) => console.error('ref reward err', e.message));
  }
  return { applied };
}
