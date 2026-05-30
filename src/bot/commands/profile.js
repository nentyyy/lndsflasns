import { appKeyboard } from '../lib/keyboards.js';
import { db } from '../../api/lib/db.js';
import { makeRefCode } from '../../api/lib/referral.js';

export async function profileCommand(ctx) {
  const userId = String(ctx.from?.id);
  const player = await db('players').where({ user_id: userId }).first().catch(() => null);

  if (!player) {
    return ctx.reply('Профиль не найден. Напиши /start чтобы начать.', {
      reply_markup: appKeyboard()
    });
  }

  const refCode = player.ref_code || makeRefCode(userId);
  const balance = Number(player.balance);
  const games = Number(player.games_played);
  const won = Number(player.coins_won);
  const best = Number(player.best_win);

  const text = [
    `👤 ${player.first_name || player.username || 'Игрок'}`,
    '',
    `💰 Баланс: ${balance} дублонов`,
    `🎮 Игр: ${games}`,
    `🏆 Выиграно: ${won} дублонов`,
    `⭐ Лучший выигрыш: ${best} дублонов`,
    '',
    `Реферальный код: ${refCode}`,
    `10% с каждого пополнения твоих рефералов`
  ].join('\n');

  await ctx.reply(text, { reply_markup: appKeyboard() });
}
