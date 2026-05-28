import { db } from './db.js';
import { REFERRAL_PCT } from './config.js';
import { credit } from './wallet.js';

// Стабильный реф-код из user_id. Достаточно случайный для приватности.
export function makeRefCode(userId) {
  const n = BigInt(String(userId));
  // base36, верхний регистр; в конце прибавляем 2-буквенную «соль» от id.
  return 'DW' + n.toString(36).toUpperCase().padStart(5, '0');
}

export function decodeRefCode(code) {
  if (!code || typeof code !== 'string') return null;
  const trimmed = code.trim().toUpperCase().replace(/^DW/, '');
  if (!trimmed) return null;
  try {
    const n = BigInt(parseInt(trimmed, 36));
    if (!n) return null;
    return String(n);
  } catch {
    return null;
  }
}

// Привязать реферера к новому игроку (только один раз и только если не сам).
export async function bindReferrer(userId, refCode) {
  if (!refCode) return null;
  const referrerId = decodeRefCode(refCode);
  if (!referrerId || referrerId === String(userId)) return null;

  const me = await db('players').where({ user_id: userId }).first();
  if (!me) return null;
  if (me.referrer_id) return String(me.referrer_id); // уже привязан

  const ref = await db('players').where({ user_id: referrerId }).first();
  if (!ref) return null;

  await db('players').where({ user_id: userId }).update({ referrer_id: referrerId });
  return referrerId;
}

// При успешном депозите: начислить рефереру % от пополнения.
// Идемпотентно по deposit_id.
export async function rewardReferralForDeposit(depositId) {
  const deposit = await db('deposits').where({ id: depositId, status: 'paid' }).first();
  if (!deposit) return null;
  const player = await db('players').where({ user_id: deposit.user_id }).first();
  if (!player || !player.referrer_id) return null;

  const total = Number(deposit.coins) + Number(deposit.bonus);
  const bonus = Math.max(1, Math.floor(total * REFERRAL_PCT));

  try {
    await db('ref_payouts').insert({
      referrer_id: player.referrer_id,
      referee_id: deposit.user_id,
      deposit_id: depositId,
      amount: bonus
    });
  } catch (e) {
    return null; // уже начислено
  }

  // Начисляем в ref_pending (не сразу в баланс — игрок должен нажать «Забрать»)
  await db('players')
    .where({ user_id: player.referrer_id })
    .update({ ref_pending: db.raw('ref_pending + ?', [bonus]), ref_earned: db.raw('ref_earned + ?', [bonus]) });
  return { referrerId: String(player.referrer_id), bonus };
}

// Claim pending referral earnings → balance
export async function claimReferralPending(userId) {
  return db.transaction(async (trx) => {
    const player = await trx('players').where({ user_id: userId }).first();
    if (!player) return { claimed: 0, balance: 0 };
    const pending = Number(player.ref_pending || 0);
    if (pending <= 0) return { claimed: 0, balance: Number(player.balance) };

    const balance = await credit(trx, userId, pending, 'ref_claim', `ref_claim:${userId}:${Date.now()}`);
    await trx('players').where({ user_id: userId }).update({ ref_pending: 0 });
    return { claimed: pending, balance };
  });
}

export async function getReferralView(userId) {
  const me = await db('players').where({ user_id: userId }).first();
  if (!me) return null;
  let code = me.ref_code;
  if (!code) {
    code = makeRefCode(userId);
    await db('players').where({ user_id: userId }).update({ ref_code: code });
  }
  const invitees = await db('players').where({ referrer_id: userId }).select('user_id', 'username', 'first_name', 'created_at');
  const payouts = await db('ref_payouts').where({ referrer_id: userId }).orderBy('id', 'desc').limit(50);
  const totalEarned = Number(me.ref_earned || 0);

  return {
    code,
    pct: Math.round(REFERRAL_PCT * 100),
    earned: totalEarned,
    pending: Number(me.ref_pending || 0),
    invites: invitees.length,
    activeInvites: invitees.length,
    structure: `${Math.round(REFERRAL_PCT * 100)}% с каждого пополнения реферала`,
    inviteHistory: invitees.slice(0, 20).map((p, i) => ({
      id: `ref-${p.user_id}`,
      name: p.first_name || p.username || `Игрок ${String(p.user_id).slice(-4)}`,
      date: new Date(p.created_at).toISOString().slice(0, 10),
      earned: payouts.filter((x) => String(x.referee_id) === String(p.user_id)).reduce((s, x) => s + Number(x.amount), 0),
      active: true
    }))
  };
}
