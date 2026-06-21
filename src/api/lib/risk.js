import { randomUUID } from 'node:crypto';
import { db } from './db.js';
import { RISK_MODE } from './config.js';
import { addPoints } from './points.js';
import { credit, debit } from './wallet.js';

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

// Сыграть Risk-раунд. cells: 2..10, pickIdx: выбранная игроком ячейка, bet: ставка монетами.
// Списывает ставку монетами. Угадал (pick === winning, шанс 1/cells) →
// НФТ-приз (owned) ≤ bet*cells*0.85; если подходящего НФТ нет — дублоны.
export async function playRisk(userId, cellsRaw, pickRaw, betRaw) {
  const cells = Math.max(RISK_MODE.minCells, Math.min(RISK_MODE.maxCells, Math.floor(Number(cellsRaw) || 0)));
  const pick = Math.max(0, Math.min(cells - 1, Math.floor(Number(pickRaw) || 0)));
  const bet = Math.floor(Number(betRaw) || 0);
  if (!Number.isInteger(bet) || bet < RISK_MODE.minBet) throw new RiskError('min_bet', 400);
  if (bet > RISK_MODE.maxBet) throw new RiskError('max_bet', 400);
  // RTP 85%: приз = ставка × N × 0.85.
  const rewardCoins = Math.round(bet * cells * RISK_MODE.rtp);
  const attemptId = randomUUID();

  const result = await db.transaction(async (trx) => {
    // Списываем ставку монетами.
    await debit(trx, userId, bet, 'risk_bet', `risk_bet:${attemptId}`);
    await trx('players').where({ user_id: userId }).update({ coins_spent: trx.raw('coins_spent + ?', [bet]) });
    await addPoints(trx, userId, bet); // поинты за ставку

    // Честный RNG: выигрышная ячейка случайна; победа = игрок угадал её.
    const winning = Math.floor(Math.random() * cells);
    const won = pick === winning;

    let giftRow = null;
    let purchaseId = null;
    let coinsWon = 0;
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
      } else {
        // Нет НФТ под сумму — отдаём дублонами, чтобы победа не была пустой.
        coinsWon = rewardCoins;
        await credit(trx, userId, rewardCoins, 'risk_win', `risk:${attemptId}`);
      }
    }
    return { won, winning, giftRow, purchaseId, coinsWon };
  });

  return {
    won: result.won,
    cells,
    multiplier: cells,
    rewardCoins,
    pick,
    winning: result.winning,
    coinsWon: result.coinsWon,
    gift: result.giftRow ? { id: result.giftRow.id, name: result.giftRow.name, file: result.giftRow.file, priceCoins: Number(result.giftRow.priceCoins) } : null
  };
}
