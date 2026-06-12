import { randomUUID } from 'node:crypto';
import { db } from './db.js';
import { credit } from './wallet.js';
import { WHEEL_SEGMENTS, WHEEL_COOLDOWN_MS, WHEEL_WEEK_TON, WHEEL_WEEK_MS, WHEEL_NFT_MAX_COINS } from './config.js';
import { notifyAdminsPurchase } from './admin-notify.js';

export class WheelError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}

const publicSegments = () =>
  WHEEL_SEGMENTS.map((s) => ({ key: s.key, type: s.type, value: s.value, label: s.label }));

function nextSpinAt(player) {
  if (!player?.wheel_last_spin) return 0;
  return new Date(player.wheel_last_spin).getTime() + WHEEL_COOLDOWN_MS;
}

// TON-эквивалент депозитов игрока за 7 дней (TON и Stars). 1 coin = 0.1 TON,
// поэтому TON-эквивалент любого пополнения = coins * 0.1.
async function weekTon(userId) {
  const since = new Date(Date.now() - WHEEL_WEEK_MS).toISOString();
  const row = await db('deposits')
    .where({ user_id: userId, status: 'paid' })
    .whereIn('method', ['ton', 'stars'])
    .where('paid_at', '>=', since)
    .sum('coins as c').first();
  return (Number(row?.c || 0)) * 0.1;
}

export async function getWheelState(userId) {
  const player = await db('players').where({ user_id: userId }).first();
  const ton = await weekTon(userId);
  const unlocked = ton >= WHEEL_WEEK_TON;
  const next = nextSpinAt(player);
  const canSpin = unlocked && Date.now() >= next;
  return {
    unlocked,
    canSpin,
    weekTon: Math.round(ton * 100) / 100,
    requiredTon: WHEEL_WEEK_TON,
    tonNeeded: Math.max(0, Math.round((WHEEL_WEEK_TON - ton) * 100) / 100),
    nextSpinAt: next ? new Date(next).toISOString() : null,
    cooldownMs: WHEEL_COOLDOWN_MS,
    depositBonusPct: Number(player?.wheel_deposit_bonus_pct || 0),
    segments: publicSegments()
  };
}

function pickSegment() {
  const totalWeight = WHEEL_SEGMENTS.reduce((s, x) => s + x.weight, 0);
  let r = Math.random() * totalWeight;
  for (let i = 0; i < WHEEL_SEGMENTS.length; i++) {
    r -= WHEEL_SEGMENTS[i].weight;
    if (r < 0) return { index: i, seg: WHEEL_SEGMENTS[i] };
  }
  return { index: WHEEL_SEGMENTS.length - 1, seg: WHEEL_SEGMENTS[WHEEL_SEGMENTS.length - 1] };
}

// Подобрать случайный НФТ из флора до WHEEL_NFT_MAX_COINS монет.
async function pickWheelGift() {
  let gifts = await db('portals_cache').where('available', true)
    .andWhere('priceCoins', '>', 0).andWhere('priceCoins', '<=', WHEEL_NFT_MAX_COINS)
    .orderBy('priceCoins', 'asc').limit(7);
  // Фолбэк — 7 самых дешёвых, если в лимит ничего не попало.
  if (!gifts.length) {
    gifts = await db('portals_cache').where('available', true).andWhere('priceCoins', '>', 0)
      .orderBy('priceCoins', 'asc').limit(7);
  }
  if (!gifts.length) return null;
  return gifts[Math.floor(Math.random() * gifts.length)];
}

export async function spinWheel(userId) {
  // Проверка доступа вне транзакции (читает deposits).
  const ton = await weekTon(userId);
  if (ton < WHEEL_WEEK_TON) throw new WheelError('locked', 403);

  const out = await db.transaction(async (trx) => {
    const player = await trx('players').where({ user_id: userId }).first();
    if (!player) throw new WheelError('player not found', 404);
    if (Date.now() < nextSpinAt(player)) throw new WheelError('cooldown', 429);

    const { index, seg } = pickSegment();
    let balance = Number(player.balance);
    const reward = { key: seg.key, type: seg.type, value: seg.value, label: seg.label };
    let nftPurchaseId = null;
    let nftGift = null;

    if (seg.type === 'coins') {
      balance = await credit(trx, userId, seg.value, 'wheel', `wheel:${randomUUID()}`);
    } else if (seg.type === 'tickets') {
      await trx('players').where({ user_id: userId }).update({ cheap_tickets: trx.raw('cheap_tickets + ?', [seg.value]) });
    } else if (seg.type === 'deposit_bonus') {
      const pct = Math.max(Number(player.wheel_deposit_bonus_pct || 0), seg.value);
      await trx('players').where({ user_id: userId }).update({ wheel_deposit_bonus_pct: pct });
    } else if (seg.type === 'nft') {
      const gift = await pickWheelGift();
      if (gift) {
        nftPurchaseId = randomUUID();
        await trx('portals_purchases').insert({
          id: nftPurchaseId, user_id: String(userId),
          gift_id: gift.id, gift_name: gift.name, gift_file: gift.file || null,
          price_coins: Number(gift.priceCoins) || 0, idempotency_key: `wheel:${nftPurchaseId}`,
          source: 'wheel', status: 'owned'
        });
        nftGift = gift;
        reward.label = `НФТ: ${gift.name}`;
      } else {
        // Нет НФТ в каталоге — компенсируем дублонами.
        balance = await credit(trx, userId, 50, 'wheel', `wheel:${randomUUID()}`);
        reward.label = '+50 дублонов';
        reward.type = 'coins'; reward.value = 50;
      }
    }

    await trx('players').where({ user_id: userId }).update({
      wheel_last_spin: trx.fn.now(),
      wheel_spins: trx.raw('wheel_spins + 1')
    });

    const updated = await trx('players').where({ user_id: userId }).first();
    return {
      segmentIndex: index,
      reward,
      balance,
      tickets: { cheap: Number(updated.cheap_tickets), premium: Number(updated.premium_tickets) },
      depositBonusPct: Number(updated.wheel_deposit_bonus_pct || 0),
      nextSpinAt: new Date(nextSpinAt(updated)).toISOString(),
      nft: nftGift ? { id: nftGift.id, name: nftGift.name, file: nftGift.file } : null,
      nftPurchaseId
    };
  });

  if (out.nftPurchaseId) {
    notifyAdminsPurchase({ id: out.nftPurchaseId, user_id: String(userId), gift_id: out.nft.id, gift_name: out.nft.name, price_coins: 0 })
      .catch((e) => console.error('wheel nft notify err', e.message));
  }
  return out;
}
