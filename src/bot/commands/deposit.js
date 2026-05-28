import { InlineKeyboard } from 'grammy';
import { buildTonTopupUrl, sendStarsInvoice } from '../lib/payments.js';

export async function depositCommand(ctx) {
  const text = [
    'Пополнение баланса',
    'Telegram Stars: встроенный invoice внутри Telegram.',
    'TON: внешний vault checkout для wallet top-up.',
    'После оплаты монеты зачисляются во внутренний баланс DEADWILL.'
  ].join('\n');

  await ctx.reply(text, {
    reply_markup: new InlineKeyboard()
      .text('Stars invoice', 'stars:shadow')
      .row()
      .url('TON top-up', buildTonTopupUrl())
  });

  if (ctx.match?.includes('instant')) {
    await sendStarsInvoice(ctx);
  }
}
