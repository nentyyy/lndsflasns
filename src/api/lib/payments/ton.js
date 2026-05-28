import { randomUUID } from 'node:crypto';
import axios from 'axios';
import { db } from '../db.js';
import { env, getTonPack, FIRST_DEPOSIT_BONUS_PCT } from '../config.js';
import { creditOnce } from '../wallet.js';
import { rewardReferralForDeposit } from '../referral.js';

// Create a TON deposit intent. The user must send `amountTon` to our project
// wallet with the exact `comment` (= deposit id) so the poller can match it.
export async function createTonDeposit(userId, packId) {
  const pack = getTonPack(packId);
  if (!pack) throw new Error('unknown ton pack');
  if (!env.PROJECT_TON_WALLET) {
    const err = new Error('ton_wallet_not_configured');
    err.userMessage = 'TON-кошелёк проекта не настроен';
    throw err;
  }

  const depositId = randomUUID();
  // Первый депозит +15%
  const isFirst = !(await db('players').where({ user_id: userId }).first())?.first_deposit_done;
  const firstBonus = isFirst ? Math.floor((pack.coins + pack.bonus) * FIRST_DEPOSIT_BONUS_PCT) : 0;

  await db('deposits').insert({
    id: depositId,
    user_id: userId,
    method: 'ton',
    pack_id: pack.id,
    status: 'pending',
    coins: pack.coins,
    bonus: pack.bonus + firstBonus,
    currency: 'TON',
    expected_amount: pack.nanoton,
    ton_comment: depositId
  });

  return {
    depositId,
    wallet: env.PROJECT_TON_WALLET,
    amountNanoton: pack.nanoton,
    amountTon: pack.nanoton / 1e9,
    comment: depositId,
    pack,
    firstDepositBonus: firstBonus > 0 ? firstBonus : 0
  };
}

// Poll on-chain transactions to the project wallet and settle matching deposits.
export async function pollTonDeposits() {
  if (!env.PROJECT_TON_WALLET) return { checked: 0, settled: 0 };

  const { data } = await axios.get(`${env.TONCENTER_BASE}/getTransactions`, {
    params: { address: env.PROJECT_TON_WALLET, limit: 40, archival: true },
    headers: env.TON_API_KEY ? { 'X-API-Key': env.TON_API_KEY } : {}
  });
  if (!data.ok) throw new Error('toncenter error');

  let settled = 0;
  for (const tx of data.result) {
    const inMsg = tx.in_msg;
    if (!inMsg) continue;
    const comment = (inMsg.message || '').trim();
    const value = Number(inMsg.value || 0); // nanoton
    if (!comment) continue;

    const deposit = await db('deposits')
      .where({ ton_comment: comment, method: 'ton', status: 'pending' })
      .first();
    if (!deposit) continue;
    if (value < Number(deposit.expected_amount)) continue; // underpaid → leave pending

    const total = Number(deposit.coins) + Number(deposit.bonus);
    const { applied } = await creditOnce(deposit.user_id, total, 'deposit_ton', deposit.id);
    if (applied) {
      await db('deposits').where({ id: deposit.id }).update({
        status: 'paid',
        ton_tx_hash: tx.transaction_id?.hash || null,
        paid_at: db.fn.now()
      });
      await db('players').where({ user_id: deposit.user_id }).update({ first_deposit_done: true });
      await rewardReferralForDeposit(deposit.id).catch((e) => console.error('ref reward err', e.message));
      settled += 1;
    }
  }
  return { checked: data.result.length, settled };
}

export function startTonPoller() {
  if (!env.PROJECT_TON_WALLET) {
    console.log('[ton] PROJECT_TON_WALLET not set — poller disabled');
    return;
  }
  const tick = async () => {
    try {
      const r = await pollTonDeposits();
      if (r.settled) console.log(`[ton] settled ${r.settled} deposit(s)`);
    } catch (e) {
      console.error('[ton] poll error', e.message);
    }
  };
  setInterval(tick, env.TON_POLL_MS);
  console.log(`[ton] poller started (every ${env.TON_POLL_MS}ms)`);
}
