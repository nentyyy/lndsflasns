import { appKeyboard } from '../lib/keyboards.js';
import { db } from '../../api/lib/db.js';
import { makeRefCode } from '../../api/lib/referral.js';

export async function profileCommand(ctx) {
  const userId = String(ctx.from?.id);
  const player = await db('players').where({ user_id: userId }).first();

  if (!player) {
    return ctx.reply('Профиль не найден. Напиши /start чтобы начать.', {
      reply_markup: appKeyboard()
    });
  }

  const refCode = player.ref_code || makeRefCode(userId);
  const balance = Number(player.balance);
  const won = Number(player.coins_won);
  const games = Number(player.games_played);

  await ctx.reply(
    `👤 *${player.first_name || player.username || 'Игрок'}*\n\n` +
    `💰 Баланс: *${balance} монет*\n` +
    `🎮 Игр сыграно: *${games}*\n` +
    `🏆 Выиграно: *${won} монет*\n\n` +
    `🔗 Реферальный код: \`${refCode}\``,
    {
      parse_mode: 'Markdown',
      reply_markup: appKeyboard()
    }
  );
}
