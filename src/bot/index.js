// src/bot/index.js
import { Bot } from 'grammy';
import { config } from 'dotenv';
import { startCommand } from './commands/start.js';
import { depositCommand } from './commands/deposit.js';
import { buyWillCommand } from './commands/buy-will.js';
import { resolveWillCommand } from './commands/resolve-will.js';
import { clanCommand } from './commands/clan.js';
import { shopCommand } from './commands/shop.js';
import { profileCommand } from './commands/profile.js';
import { passCommand } from './commands/pass.js';
import { handleError } from './middleware/error.js';
import { sendStarsInvoice } from './lib/payments.js';
import { MINI_APP_URL } from './lib/config.js';
import { migrate } from '../api/lib/migrate.js';
import { db } from '../api/lib/db.js';
import { settleStarsPayment } from '../api/lib/payments/stars.js';

config();

if (process.env.BOT_TOKEN) {
  await migrate();
  const bot = new Bot(process.env.BOT_TOKEN);

  bot.catch((error) => {
    console.error('Unhandled bot error', error);
  });

  bot.use(handleError);

  bot.command('start', startCommand);
  bot.command('deposit', depositCommand);
  bot.command('buy-will', buyWillCommand);
  bot.command('resolve-will', resolveWillCommand);
  bot.command('clan', clanCommand);
  bot.command('shop', shopCommand);
  bot.command('profile', profileCommand);
  bot.command('pass', passCommand);
  bot.command('app', async (ctx) => {
    await ctx.reply('Открываю DEADWILL.', {
      reply_markup: {
        inline_keyboard: [[{ text: 'Open DEADWILL', web_app: { url: MINI_APP_URL } }]]
      }
    });
  });
  bot.command('stars', async (ctx) => {
    await sendStarsInvoice(ctx, 'stars-shadow');
  });
  bot.command('ton', async (ctx) => {
    await depositCommand(ctx);
  });

  bot.callbackQuery('stars:shadow', async (ctx) => {
    await ctx.answerCallbackQuery();
    await sendStarsInvoice(ctx, 'stars-shadow');
  });

  // Approve only if the payload maps to a real pending deposit.
  bot.on('pre_checkout_query', async (ctx) => {
    try {
      const payload = ctx.preCheckoutQuery.invoice_payload;
      const deposit = await db('deposits').where({ id: payload, method: 'stars', status: 'pending' }).first();
      if (!deposit) {
        await ctx.answerPreCheckoutQuery(false, 'Заказ не найден или уже оплачен');
        return;
      }
      await ctx.answerPreCheckoutQuery(true);
    } catch (e) {
      console.error('pre_checkout error', e);
      await ctx.answerPreCheckoutQuery(false, 'Ошибка проверки платежа');
    }
  });

  // Credit coins ONLY here, after Telegram confirms the payment. Idempotent.
  bot.on('message:successful_payment', async (ctx) => {
    const sp = ctx.message.successful_payment;
    try {
      const { balance, coins } = await settleStarsPayment({
        payload: sp.invoice_payload,
        telegramChargeId: sp.telegram_payment_charge_id,
        totalAmount: sp.total_amount,
        currency: sp.currency
      });
      await ctx.reply(
        `Оплата принята. +${coins} монет зачислено.\nБаланс: ${balance}.`,
        { reply_markup: { inline_keyboard: [[{ text: 'Открыть DEADWILL', web_app: { url: MINI_APP_URL } }]] } }
      );
    } catch (e) {
      console.error('settle stars error', e);
      await ctx.reply('Платеж получен, но возникла ошибка зачисления. Поддержка уже уведомлена.');
    }
  });

  bot.on('message:web_app_data', async (ctx) => {
    await ctx.reply('Mini app синхронизирован. Данные получены.');
  });

  bot.start();
  console.log('Bot started');
} else {
  console.log('BOT_TOKEN is missing. Bot command handlers are ready, launch skipped.');
}
