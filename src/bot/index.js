import { Bot } from 'grammy';
import { config } from 'dotenv';
import { startCommand } from './commands/start.js';
import { depositCommand } from './commands/deposit.js';
import { profileCommand } from './commands/profile.js';
import { handleError } from './middleware/error.js';
import { MINI_APP_URL, BOT_USERNAME } from './lib/config.js';
import { migrate } from '../api/lib/migrate.js';
import { db } from '../api/lib/db.js';
import { settleStarsPayment } from '../api/lib/payments/stars.js';
import { makeRefCode } from '../api/lib/referral.js';

config();

if (!process.env.BOT_TOKEN) {
  console.log('BOT_TOKEN missing — bot skipped');
  process.exit(0);
}

await migrate();

const bot = new Bot(process.env.BOT_TOKEN);

bot.catch((err) => console.error('Bot error:', err.message));
bot.use(handleError);

// ─── /start ───
bot.command('start', startCommand);

// ─── /play ───
bot.command('play', async (ctx) => {
  await ctx.reply('Открываю игру...', {
    reply_markup: { inline_keyboard: [[{ text: '🎴  Играть', web_app: { url: MINI_APP_URL } }]] }
  });
});

// ─── /deposit ───
bot.command('deposit', depositCommand);

// ─── /profile ───
bot.command('profile', profileCommand);

// ─── /referral ───
bot.command('referral', async (ctx) => {
  const userId = String(ctx.from?.id);
  const player = await db('players').where({ user_id: userId }).first().catch(() => null);
  if (!player) return ctx.reply('Сначала запусти /start');
  const code = player.ref_code || makeRefCode(userId);
  const link = `https://t.me/${BOT_USERNAME}?start=${code}`;
  await ctx.reply(
    `🔗 *Реферальная программа*\n\n` +
    `Получай *10%* с каждого пополнения приглашённых игроков\n\n` +
    `Твоя ссылка:\n\`${link}\``,
    { parse_mode: 'Markdown', reply_markup: { inline_keyboard: [[{ text: '🎴 Открыть игру', web_app: { url: MINI_APP_URL } }]] } }
  );
});

// ─── /help ───
bot.command('help', async (ctx) => {
  await ctx.reply(
    '*DEADWILL — команды:*\n\n' +
    '/play — открыть игру\n' +
    '/deposit — пополнить баланс\n' +
    '/profile — мой профиль\n' +
    '/referral — реферальная программа\n',
    { parse_mode: 'Markdown', reply_markup: { inline_keyboard: [[{ text: '🎴  Играть', web_app: { url: MINI_APP_URL } }]] } }
  );
});

// ─── Stars payment flow ───
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
      `✅ *Оплачено!*\n\n+${coins} монет зачислено\nБаланс: ${balance} монет`,
      { parse_mode: 'Markdown', reply_markup: { inline_keyboard: [[{ text: '🎴  Играть', web_app: { url: MINI_APP_URL } }]] } }
    );
  } catch (e) {
    console.error('settle stars error', e);
    await ctx.reply('Платёж получен, монеты будут зачислены в течение минуты.');
  }
});

bot.start();
console.log(`Bot @${BOT_USERNAME} started`);
