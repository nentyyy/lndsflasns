import { randomUUID } from 'node:crypto';
import { db } from './db.js';
import { debit } from './wallet.js';
import { getGiftFromCache } from './portals.js';
import { notifyAdminsPurchase } from './admin-notify.js';
import { addPoints } from './points.js';

export class LuckyError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}

// Ставка в ДУБЛОНАХ. Формула по ТЗ: bet = (price / chance * 100) * 0.95.
export function luckyBet(priceCoins, chancePercent) {
  return Math.max(1, Math.round((priceCoins / chancePercent * 100) * 0.95));
}
// Множитель = во сколько раз приз (подарок) больше ставки.
export function luckyMultiplier(priceCoins, chancePercent) {
  const bet = luckyBet(priceCoins, chancePercent);
  return Number((priceCoins / bet).toFixed(2));
}

export async function playLuckyBuy(userId, giftId, chancePercentRaw) {
  const chance = Math.min(80, Math.max(1, Math.round(Number(chancePercentRaw) || 0)));
  const gift = await getGiftFromCache(giftId);
  if (!gift) throw new LuckyError('gift_not_found', 404);
  const priceCoins = Number(gift.priceCoins) || Math.round(Number(gift.priceTon || 0) * 10);
  if (priceCoins <= 0) throw new LuckyError('invalid_price', 409);

  const bet = luckyBet(priceCoins, chance);
  const attemptId = randomUUID();
  const won = Math.random() * 100 < chance; // RNG ТОЛЬКО на бэкенде

  let balance;
  let purchaseId = null;
  await db.transaction(async (trx) => {
    balance = await debit(trx, userId, bet, 'lucky_bet', `lucky:${attemptId}`);
    await trx('players').where({ user_id: userId }).update({ coins_spent: trx.raw('coins_spent + ?', [bet]) });
    await addPoints(trx, userId, bet); // ставка тоже даёт поинты
    await trx('lucky_buy_attempts').insert({
      id: attemptId, user_id: String(userId), gift_id: gift.id,
      chance_percent: chance, bet_coins: bet, won, created_at: trx.fn.now()
    });
    if (won) {
      purchaseId = randomUUID();
      await trx('portals_purchases').insert({
        id: purchaseId, user_id: String(userId),
        gift_id: gift.id, gift_name: gift.name, price_coins: bet,
        idempotency_key: `lucky:${attemptId}`, status: 'pending'
      });
    }
  });

  if (won) {
    notifyAdminsPurchase({ id: purchaseId, user_id: String(userId), gift_id: gift.id, gift_name: gift.name, price_coins: bet })
      .catch((e) => console.error('lucky notify err', e.message));
  }

  return {
    won, betCoins: bet, chance,
    multiplier: luckyMultiplier(priceCoins, chance),
    balance,
    gift: { id: gift.id, name: gift.name, file: gift.file, priceCoins }
  };
}

export async function getLuckyFeed(limit = 10) {
  const rows = await db('lucky_buy_attempts as a')
    .join('players as p', 'a.user_id', 'p.user_id')
    .leftJoin('portals_cache as g', 'a.gift_id', 'g.id')
    .where('a.won', true)
    .orderBy('a.created_at', 'desc')
    .limit(limit)
    .select('a.gift_id', 'a.chance_percent', 'a.bet_coins', 'a.created_at',
      'g.name as gift_name', 'g.file as gift_file',
      'p.user_id', 'p.username', 'p.first_name', 'p.last_name', 'p.avatar_file_id');
  return rows.map((r) => ({
    giftId: r.gift_id,
    giftName: r.gift_name || r.gift_id,
    giftFile: r.gift_file || null,
    chance: Number(r.chance_percent),
    name: r.username ? `@${r.username}` : [r.first_name, r.last_name].filter(Boolean).join(' ') || `Player #${String(r.user_id).slice(-4)}`,
    avatarUrl: r.avatar_file_id ? `/api/avatar/${r.avatar_file_id}` : null,
    at: r.created_at
  }));
}
