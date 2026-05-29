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
import { credit } from '../api/lib/wallet.js';
import { FOUNDER_IDS } from '../api/lib/config.js';

// Доступ к админ-командам — по telegram_id (immutable), не по username.
const isAdmin = (ctx) => FOUNDER_IDS.includes(String(ctx.from?.id));

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
  const link = `https://t.me/${BOT_USERNAME}?start=ref_${userId}`;
  await ctx.reply(
    `🔗 *Реферальная программа*\n\n` +
    `Получай *10%* с каждого пополнения приглашённых игроков\n\n` +
    `Твоя ссылка:\n\`${link}\``,
    { parse_mode: 'Markdown', reply_markup: { inline_keyboard: [[{ text: '🎴 Открыть игру', web_app: { url: MINI_APP_URL } }]] } }
  );
});

// ─── /give — только для adminов ───
// Использование: /give @username 500  или  /give 123456789 500
bot.command('give', async (ctx) => {
  if (!isAdmin(ctx)) {
    return ctx.reply('Нет доступа.');
  }

  const text = ctx.message?.text || '';
  const parts = text.split(/\s+/).slice(1); // ['@username', '500']
  if (parts.length < 2) {
    return ctx.reply('Использование: /give @username 500\nили: /give user_id 500');
  }

  const targetRaw = parts[0].replace('@', '');
  const amount = parseInt(parts[1], 10);
  if (!amount || amount <= 0 || amount > 1_000_000) {
    return ctx.reply('Некорректная сумма (1 — 1 000 000)');
  }

  // Ищем игрока по username или user_id
  let player = await db('players')
    .where({ username: targetRaw })
    .orWhere({ user_id: targetRaw })
    .first();

  if (!player) {
    return ctx.reply(`Игрок @${targetRaw} не найден в базе. Он должен хотя бы раз открыть бота.`);
  }

  await db.transaction(async (trx) => {
    await credit(trx, player.user_id, amount, 'admin_give', `give:${Date.now()}:${player.user_id}`);
  });

  const updatedPlayer = await db('players').where({ user_id: player.user_id }).first();
  const name = player.first_name || `@${player.username}` || `ID ${player.user_id}`;

  // Уведомляем получателя
  const giftMsg = [
    '🪙 Ого! Тебе начислили монеты!',
    '',
    `+${amount} монет уже ждут на балансе. Раздача, бонус или внимание админов — неважно, главное тратить с удовольствием! ✨`,
    '',
    'Погнали в игру!'
  ].join('\n');

  try {
    await ctx.api.sendMessage(player.user_id, giftMsg, {
      reply_markup: { inline_keyboard: [[{ text: '🎴  Играть', web_app: { url: MINI_APP_URL } }]] }
    });
  } catch (e) {
    console.warn('cannot notify recipient:', e.message);
  }

  await ctx.reply(
    `✅ ${name} получил +${amount} монет\nНовый баланс: ${Number(updatedPlayer.balance)} монет`
  );
});

// ─── /help ───
bot.command('help', async (ctx) => {
  await ctx.reply(
    '*DEADWILL — команды:*\n\n' +
    '/play — открыть игру\n' +
    '/deposit — пополнить баланс\n' +
    '/profile — мой профиль\n' +
    '/referral — реферальная программа\n' +
    (isAdmin(ctx) ? '\n/give @username сумма — начислить монеты' : ''),
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
