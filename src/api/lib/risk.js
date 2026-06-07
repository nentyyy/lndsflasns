import { randomUUID } from 'node:crypto';
import { db } from './db.js';
import { RISK_MODE } from './config.js';
import { consumeTicket } from './tickets.js';
import { addPoints } from './points.js';

export class RiskError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}

// Подобрать НФТ из каталога с ценой <= reward (самый дорогой из подходящих).
async function pickGiftForReward(reward) {
  const gift = await db('portals_cache')
    .where('available', true)
    .andWhere('priceCoins', '<=', reward)
    .andWhere('priceCoins', '>', 0)
    .orderBy('priceCoins', 'desc')
    .first();
  return gift || null;
}

// Сыграть Risk-раунд. cells: 2..10. Списывает 1 премиум-карту.
// Угадал (шанс 1/cells) → приз = betCoins * cells → НФТ-заявка (owned) в инвентарь.
export async function playRisk(userId, cellsRaw) {
  const cells = Math.max(RISK_MODE.minCells, Math.min(RISK_MODE.maxCells, Math.floor(Number(cellsRaw) || 0)));
  const rewardCoins = RISK_MODE.betCoins * cells; // ×2..×10
  const attemptId = randomUUID();

  const result = await db.transaction(async (trx) => {
    // Списываем 1 премиум-карту как ставку.
    const ok = await consumeTicket(trx, userId, 'premium');
    if (!ok) throw new RiskError('need_premium_card', 402);
    await addPoints(trx, userId, RISK_MODE.betCoins); // поинты за ставку

    // Честный RNG: победа с вероятностью 1/cells.
    const pick = Math.floor(Math.random() * cells);   // что выбрал игрок (0..cells-1)
    const winning = Math.floor(Math.random() * cells); // выигрышная ячейка
    const won = pick === winning;

    let giftRow = null;
    let purchaseId = null;
    if (won) {
      const gift = await pickGiftForReward(rewardCoins);
      if (gift) {
        purchaseId = randomUUID();
        await trx('portals_purchases').insert({
          id: purchaseId, user_id: String(userId),
          gift_id: gift.id, gift_name: gift.name, gift_file: gift.file || null,
          price_coins: Number(gift.priceCoins) || rewardCoins,
          idempotency_key: `risk:${attemptId}`, source: 'risk', status: 'owned'
        });
        giftRow = gift;
      }
    }
    return { won, pick, winning, giftRow, purchaseId };
  });

  return {
    won: result.won,
    cells,
    multiplier: cells,
    rewardCoins,
    pick: result.pick,
    winning: result.winning,
    gift: result.giftRow ? { id: result.giftRow.id, name: result.giftRow.name, file: result.giftRow.file, priceCoins: Number(result.giftRow.priceCoins) } : null
  };
}
