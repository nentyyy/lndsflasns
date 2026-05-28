import { randomUUID } from 'node:crypto';
import { db } from '../db.js';
import { env, getStarsPack, FIRST_DEPOSIT_BONUS_PCT } from '../config.js';
import { creditOnce } from '../wallet.js';
import { rewardReferralForDeposit } from '../referral.js';

// Create a Telegram Stars invoice. Coins are credited ONLY after the
// successful_payment update is verified by the bot (see settleStarsPayment).
export async function createStarsDeposit(userId, packId) {
  const pack = getStarsPack(packId);
  if (!pack) throw new Error('unknown stars pack');

  const depositId = randomUUID();
  // Первый депозит +15%
  const player = await db('players').where({ user_id: userId }).first();
  const isFirst = !player?.first_deposit_done;
  const firstBonus = isFirst ? Math.floor((pack.coins + pack.bonus) * FIRST_DEPOSIT_BONUS_PCT) : 0;

  await db('deposits').insert({
    id: depositId,
    user_id: userId,
    method: 'stars',
    pack_id: pack.id,
    status: 'pending',
    coins: pack.coins,
    bonus: pack.bonus + firstBonus,
    currency: 'XTR',
    expected_amount: pack.stars
  });

  let invoiceLink = null;
  if (env.BOT_TOKEN) {
    const res = await fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/createInvoiceLink`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: `DEADWILL — ${pack.title}`,
        description: `${pack.coins + pack.bonus} монет${firstBonus > 0 ? ` (+${firstBonus} бонус первого деп)` : pack.bonus > 0 ? ` (+${pack.bonus} бонус)` : ''} на игру`,
        payload: depositId,
        currency: 'XTR',
        prices: [{ label: `${pack.coins} монет`, amount: pack.stars }]
      })
    });
    const data = await res.json();
    if (!data.ok) throw new Error(`createInvoiceLink failed: ${data.description}`);
    invoiceLink = data.result;
  }

  return { depositId, invoiceLink, pack };
}

// Called by the bot on a verified successful_payment update.
// Idempotent on telegram_charge_id and on the ledger ref.
export async function settleStarsPayment({ payload, telegramChargeId, totalAmount, currency }) {
  const deposit = await db('deposits').where({ id: payload, method: 'stars' }).first();
  if (!deposit) throw new Error('deposit not found for payload');
  if (currency !== 'XTR' || Number(totalAmount) !== Number(deposit.expected_amount)) {
    await db('deposits').where({ id: deposit.id }).update({ status: 'failed' });
    throw new Error('amount/currency mismatch');
  }

  const total = Number(deposit.coins) + Number(deposit.bonus);
  const { balance, applied } = await creditOnce(deposit.user_id, total, 'deposit_stars', deposit.id);

  if (applied) {
    await db('deposits').where({ id: deposit.id }).update({
      status: 'paid',
      telegram_charge_id: telegramChargeId,
      paid_at: db.fn.now()
    });
    await db('players').where({ user_id: deposit.user_id }).update({ first_deposit_done: true });
    await rewardReferralForDeposit(deposit.id).catch((e) => console.error('ref reward err', e.message));
  }
  return { balance, coins: total, userId: deposit.user_id, applied };
}
