import { randomUUID } from 'node:crypto';
import { db } from './db.js';
import { debit, round2 } from './wallet.js';
import { getGiftFromCache } from './portals.js';
import { addPoints } from './points.js';

export class LuckyError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}

// Ставка в ДУБЛОНАХ: за шанс X% выиграть подарок ценой P ты платишь P*X/100*0.70.
// RTP 70%. Точность до 0.01 — НЕ округляем до целого.
export function luckyBet(priceCoins, chancePercent) {
  return Math.max(0.01, round2(priceCoins * chancePercent / 100 * 0.70));
}
// Множитель = приз / ставка (показывает "в сколько раз приз больше ставки").
export function luckyMultiplier(priceCoins, chancePercent) {
  const bet = luckyBet(priceCoins, chancePercent);
  return Number((priceCoins / bet).toFixed(1));
}

export async function playLuckyBuy(userId, giftId, chancePercentRaw) {
  const chance = Math.min(80, Math.max(1, Math.round(Number(chancePercentRaw) || 0)));
  const gift = await getGiftFromCache(giftId);
  if (!gift) throw new LuckyError('gift_not_found', 404);
  const priceCoins = Number(gift.priceCoins) || Math.round(Number(gift.priceTon || 0) * 10);
  if (priceCoins <= 0) throw new LuckyError('invalid_price', 409);

  const bet = luckyBet(priceCoins, chance);
  const attemptId = randomUUID();
  // Скрытый буст: фактический шанс победы чуть выше показанного (+6 абс., но не
  // ниже 1.15×). Игроку «везёт чаще», чем кажется. RNG ТОЛЬКО на бэкенде.
  const effChance = Math.min(95, Math.max(chance * 1.15, chance + 6));
  const won = Math.random() * 100 < effChance;

  let balance;
  let purchaseId = null;
  await db.transaction(async (trx) => {
    balance = await debit(trx, userId, bet, 'lucky_bet', `lucky:${attemptId}`);
    await trx('players').where({ user_id: userId }).update({ coins_spent: trx.raw('ROUND(coins_spent + ?, 2)', [bet]) });
    await addPoints(trx, userId, Math.floor(bet)); // поинты — целые
    await trx('lucky_buy_attempts').insert({
      id: attemptId, user_id: String(userId), gift_id: gift.id,
      chance_percent: chance, bet_coins: bet, won, created_at: trx.fn.now()
    });
    if (won) {
      purchaseId = randomUUID();
      // Выигранный подарок падает в ИНВЕНТАРЬ (owned), цена = полная стоимость подарка.
      await trx('portals_purchases').insert({
        id: purchaseId, user_id: String(userId),
        gift_id: gift.id, gift_name: gift.name, gift_file: gift.file || null,
        price_coins: priceCoins, idempotency_key: `lucky:${attemptId}`,
        source: 'lucky', status: 'owned'
      });
    }
  });

  return {
    won, betCoins: bet, chance,
    multiplier: luckyMultiplier(priceCoins, chance),
    balance,
    gift: { id: gift.id, name: gift.name, file: gift.file, priceCoins }
  };
}

export async function getLuckyFeed(limit = 10) {
  // Берём с запасом, потом дедуплицируем.
  const rows = await db('lucky_buy_attempts as a')
    .join('players as p', 'a.user_id', 'p.user_id')
    .leftJoin('portals_cache as g', 'a.gift_id', 'g.id')
    .where('a.won', true)
    .orderBy('a.created_at', 'desc')
    .limit(limit * 6)
    .select('a.gift_id', 'a.chance_percent', 'a.bet_coins', 'a.created_at',
      'g.name as gift_name', 'g.file as gift_file',
      'p.user_id', 'p.username', 'p.first_name', 'p.last_name', 'p.avatar_file_id');

  const FIVE_MIN = 5 * 60 * 1000;
  const out = [];
  let prevUser = null;            // не показывать того же игрока с тем же подарком подряд
  const recentByUser = new Map(); // не чаще 1 записи от игрока за 5 минут

  for (const r of rows) {
    const uid = String(r.user_id);
    const ts = new Date(r.created_at).getTime();
    // Подряд один и тот же игрок+подарок — пропускаем.
    if (prevUser && prevUser.uid === uid && prevUser.gift === r.gift_id) continue;
    // Не чаще 1 раза за 5 минут от одного игрока.
    const last = recentByUser.get(uid);
    if (last && Math.abs(last - ts) < FIVE_MIN) continue;

    out.push({
      giftId: r.gift_id,
      giftName: r.gift_name || r.gift_id,
      giftFile: r.gift_file || null,
      chance: Number(r.chance_percent),
      name: r.username ? `@${r.username}` : [r.first_name, r.last_name].filter(Boolean).join(' ') || `Player #${uid.slice(-4)}`,
      avatarUrl: r.avatar_file_id ? `/api/avatar/${r.avatar_file_id}` : null,
      at: r.created_at
    });
    prevUser = { uid, gift: r.gift_id };
    recentByUser.set(uid, ts);
    if (out.length >= limit) break;
  }
  return out;
}
