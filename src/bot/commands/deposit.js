import { depositKeyboard } from '../lib/keyboards.js';

export async function depositCommand(ctx) {
  await ctx.reply(
    '💰 Пополнение баланса\n\n' +
    '⭐ Telegram Stars — мгновенно, внутри Telegram\n' +
    '💎 TON — через @send или прямым переводом\n\n' +
    '1 монета = 20 Stars = 0.1 TON\n\n' +
    'Первое пополнение: +15% бонус',
    { reply_markup: depositKeyboard() }
  );
}
