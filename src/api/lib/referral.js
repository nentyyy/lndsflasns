import { db } from './db.js';
import { REFERRAL_PCT, BOT_USERNAME, REFERRAL_TIERS, REFERRAL_WAGER_PCT, REFERRAL_FIRST_DEP_BONUS, REFERRAL_MILESTONES, referralTierFor } from './config.js';
import { credit } from './wallet.js';

// Кол-во приглашённых.
async function inviteCount(userId) {
  const row = await db('players').where({ referrer_id: userId }).count('* as n').first();
  return Number(row?.n || 0);
}

// Стабильный реф-код из user_id. Достаточно случайный для приватности.
export function makeRefCode(userId) {
  const n = BigInt(String(userId));
  // base36, верхний регистр; в конце прибавляем 2-буквенную «соль» от id.
  return 'DW' + n.toString(36).toUpperCase().padStart(5, '0');
}

export function decodeRefCode(code) {
  if (!code || typeof code !== 'string') return null;
  // Новый формат: ref_<userId> (referrer id напрямую).
  const refMatch = code.trim().match(/^ref_(\d{3,})$/i);
  if (refMatch) return refMatch[1];
  // Легаси DW-код (base36 от user_id).
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

  // Комиссия зависит от ТИРА реферера (число приглашённых).
  const count = await inviteCount(player.referrer_id);
  const tier = referralTierFor(count);
  const total = Number(deposit.coins) + Number(deposit.bonus);
  let bonus = Math.max(1, Math.floor(total * (tier.depositPct / 100)));

  // Одноразовый бонус за ПЕРВЫЙ депозит этого реферала.
  const paidCount = await db('deposits').where({ user_id: deposit.user_id, status: 'paid' }).count('* as n').first();
  const isFirstPaid = Number(paidCount?.n || 0) <= 1;
  if (isFirstPaid) bonus += REFERRAL_FIRST_DEP_BONUS;

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

  await db('players')
    .where({ user_id: player.referrer_id })
    .update({ ref_pending: db.raw('ref_pending + ?', [bonus]), ref_earned: db.raw('ref_earned + ?', [bonus]) });
  return { referrerId: String(player.referrer_id), bonus };
}

// Рейк со ставки реферала (PvP): % от entry падает рефереру в pending.
// Вызывается из pvp при покупке ячейки. Тихо игнорирует ошибки.
export async function rewardReferralForWager(refereeId, entryCoins) {
  const ref = await db('players').where({ user_id: refereeId }).first('referrer_id');
  if (!ref?.referrer_id) return;
  const cut = Math.floor(Number(entryCoins) * REFERRAL_WAGER_PCT);
  if (cut <= 0) return;
  await db('players').where({ user_id: ref.referrer_id }).update({
    ref_pending: db.raw('ref_pending + ?', [cut]),
    ref_earned: db.raw('ref_earned + ?', [cut]),
    ref_wager_earned: db.raw('ref_wager_earned + ?', [cut])
  });
}

// Забрать майлстоун (одноразово). Возвращает {claimed, reward, balance}.
export async function claimMilestone(userId, milestoneId) {
  const m = REFERRAL_MILESTONES.find((x) => x.id === milestoneId);
  if (!m) throw new Error('unknown_milestone');
  return db.transaction(async (trx) => {
    const player = await trx('players').where({ user_id: userId }).first();
    if (!player) throw new Error('player_not_found');
    const count = Number((await trx('players').where({ referrer_id: userId }).count('* as n').first())?.n || 0);
    if (count < m.invites) throw new Error('not_enough_invites');
    let claimed = [];
    try { claimed = JSON.parse(player.ref_milestones || '[]'); } catch {}
    if (claimed.includes(m.id)) throw new Error('already_claimed');
    const balance = await credit(trx, userId, m.reward, 'ref_milestone', `ms:${userId}:${m.id}`);
    claimed.push(m.id);
    await trx('players').where({ user_id: userId }).update({ ref_milestones: JSON.stringify(claimed) });
    return { claimed: m.id, reward: m.reward, balance };
  });
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
  const invitees = await db('players as p')
    .where({ referrer_id: userId })
    .select('p.user_id', 'p.username', 'p.first_name', 'p.last_name', 'p.avatar_file_id', 'p.created_at', 'p.first_deposit_done', 'p.pvp_total_reveals');
  const payouts = await db('ref_payouts').where({ referrer_id: userId }).orderBy('id', 'desc').limit(100);
  const count = invitees.length;
  const tier = referralTierFor(count);
  const tierIdx = REFERRAL_TIERS.findIndex((t) => t.id === tier.id);
  const nextTier = REFERRAL_TIERS[tierIdx + 1] || null;

  let claimedMs = [];
  try { claimedMs = JSON.parse(me.ref_milestones || '[]'); } catch {}

  const earnedByRef = (uid) => payouts.filter((x) => String(x.referee_id) === String(uid)).reduce((s, x) => s + Number(x.amount), 0);
  // «Активный» реферал = сделал депозит или сыграл хотя бы раз.
  const activeInvites = invitees.filter((p) => p.first_deposit_done || Number(p.pvp_total_reveals) > 0).length;

  return {
    code,
    link: `https://t.me/${BOT_USERNAME}?start=ref_${userId}`,
    invites: count,
    activeInvites,
    earned: Number(me.ref_earned || 0),
    pending: Number(me.ref_pending || 0),
    fromDeposits: Number(me.ref_earned || 0) - Number(me.ref_wager_earned || 0),
    fromWager: Number(me.ref_wager_earned || 0),
    // Тиры
    tier: { id: tier.id, name: tier.name, depositPct: tier.depositPct, color: tier.color },
    nextTier: nextTier ? { name: nextTier.name, min: nextTier.min, depositPct: nextTier.depositPct } : null,
    tiers: REFERRAL_TIERS.map((t) => ({ id: t.id, name: t.name, min: t.min, depositPct: t.depositPct, color: t.color, reached: count >= t.min, current: t.id === tier.id })),
    wagerPct: Math.round(REFERRAL_WAGER_PCT * 100),
    // Майлстоуны
    milestones: REFERRAL_MILESTONES.map((m) => ({
      id: m.id, invites: m.invites, reward: m.reward, label: m.label,
      reached: count >= m.invites, claimed: claimedMs.includes(m.id)
    })),
    // Список приглашённых
    inviteHistory: invitees
      .sort((a, b) => earnedByRef(b.user_id) - earnedByRef(a.user_id))
      .slice(0, 30).map((p) => ({
        id: `ref-${p.user_id}`,
        name: p.username ? `@${p.username}` : (p.first_name || `Игрок ${String(p.user_id).slice(-4)}`),
        avatarUrl: p.avatar_file_id ? `/api/avatar/${p.avatar_file_id}` : null,
        date: new Date(p.created_at).toISOString().slice(0, 10),
        earned: earnedByRef(p.user_id),
        active: p.first_deposit_done || Number(p.pvp_total_reveals) > 0
      }))
  };
}
