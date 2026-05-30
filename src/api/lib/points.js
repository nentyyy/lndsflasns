import { db } from './db.js';

// Поинты лояльности: 1 дублон ставки = 1 поинт. Не сгорают. Тратятся в лавке.
export async function addPoints(trx, userId, amount) {
  const amt = Math.floor(Number(amount) || 0);
  if (amt <= 0) return;
  const q = trx || db;
  const existing = await q('player_points').where({ user_id: String(userId) }).first();
  if (existing) {
    await q('player_points').where({ user_id: String(userId) }).update({
      points: q.raw('points + ?', [amt]),
      total_earned: q.raw('total_earned + ?', [amt])
    });
  } else {
    await q('player_points').insert({ user_id: String(userId), points: amt, total_earned: amt });
  }
}

export async function getPoints(userId) {
  const row = await db('player_points').where({ user_id: String(userId) }).first();
  return { points: Number(row?.points || 0), totalEarned: Number(row?.total_earned || 0) };
}

// Списать поинты атомарно. Бросает, если не хватает.
export async function spendPoints(trx, userId, amount) {
  const amt = Math.floor(Number(amount) || 0);
  const updated = await trx('player_points')
    .where({ user_id: String(userId) })
    .where('points', '>=', amt)
    .update({ points: trx.raw('points - ?', [amt]) });
  if (!updated) throw new Error('not_enough_points');
}
