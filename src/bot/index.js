import { Bot } from 'grammy';
import { config } from 'dotenv';
import { writeFileSync } from 'node:fs';
import { startCommand } from './commands/start.js';
import { depositCommand } from './commands/deposit.js';
import { profileCommand } from './commands/profile.js';
import { handleError } from './middleware/error.js';
import { MINI_APP_URL, BOT_USERNAME } from './lib/config.js';
import { db } from '../api/lib/db.js';
import { settleStarsPayment } from '../api/lib/payments/stars.js';
import { settleWithdrawPayment } from '../api/lib/inventory.js';
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

// Миграции выполняет ТОЛЬКО API-процесс (избегаем конкуренции записи в SQLite
// при одновременном старте). Бот лишь читает/пишет уже готовую схему.

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
  const name = player.username ? `@${player.username}` : (player.first_name || `ID ${player.user_id}`);

  // Уведомляем получателя
  const giftMsg = [
    `🪙 Тебе начислено +${amount} дублонов!`,
    '',
    `Баланс: ${Number(updatedPlayer.balance)} дублонов.`,
    'Удачи в раунде — жми «Играть»!'
  ].join('\n');

  try {
    await ctx.api.sendMessage(player.user_id, giftMsg, {
      reply_markup: { inline_keyboard: [[{ text: '🎴  Играть', web_app: { url: MINI_APP_URL } }]] }
    });
  } catch (e) {
    console.warn('cannot notify recipient:', e.message);
  }

  await ctx.reply(
    `✅ ${name} получил +${amount} дублонов\nНовый баланс: ${Number(updatedPlayer.balance)} дублонов`
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
    (isAdmin(ctx) ? '\n/give @username сумма — начислить дублоны' : ''),
    { parse_mode: 'Markdown', reply_markup: { inline_keyboard: [[{ text: '🎴  Играть', web_app: { url: MINI_APP_URL } }]] } }
  );
});

// ─── Stars payment flow ───
bot.on('pre_checkout_query', async (ctx) => {
  try {
    const payload = ctx.preCheckoutQuery.invoice_payload;
    const deposit = await db('deposits').whereIn('method', ['stars', 'withdraw']).where({ id: payload, status: 'pending' }).first();
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

// ─── Одобрение/отклонение заявок на вывод подарка ───
bot.on('callback_query:data', async (ctx) => {
  const data = ctx.callbackQuery.data || '';
  const m = data.match(/^(approve|reject):(.+)$/);
  if (!m) return ctx.answerCallbackQuery();
  if (!isAdmin(ctx)) return ctx.answerCallbackQuery({ text: 'Нет доступа', show_alert: true });

  const [, action, purchaseId] = m;
  const purchase = await db('portals_purchases').where({ id: purchaseId }).first();
  if (!purchase) return ctx.answerCallbackQuery({ text: 'Заявка не найдена', show_alert: true });
  if (purchase.status !== 'pending') {
    return ctx.answerCallbackQuery({ text: `Уже обработана: ${purchase.status}`, show_alert: true });
  }

  const baseText = ctx.callbackQuery.message?.text || 'Заявка';
  const by = ctx.from?.username ? `@${ctx.from.username}` : `ID ${ctx.from?.id}`;

  if (action === 'approve') {
    await db('portals_purchases').where({ id: purchaseId }).update({ status: 'sent', sent_at: db.fn.now() });
    // Триггерим выдачу через userbot (Portals).
    try {
      const orderPath = new URL('../userbot/pending_order.json', import.meta.url).pathname;
      writeFileSync(orderPath, JSON.stringify({ purchaseId, giftId: purchase.gift_id, userId: String(purchase.user_id) }));
    } catch (e) { console.warn('order file err', e.message); }

    await ctx.editMessageText(`${baseText}\n\n✅ ОДОБРЕНО (${by})`).catch(() => {});
    try {
      await ctx.api.sendMessage(purchase.user_id,
        `🎁 Ваш подарок «${purchase.gift_name}» уже у вас!\n\nСпасибо, что играете в DEADWILL — надеемся, вы вернётесь к нам снова ✨`,
        { reply_markup: { inline_keyboard: [[{ text: '🎴 Играть', web_app: { url: MINI_APP_URL } }]] } });
    } catch (e) { console.warn('notify buyer err', e.message); }
    return ctx.answerCallbackQuery({ text: 'Одобрено' });
  }

  // reject → подарок возвращается в инвентарь игрока (не списываем, не рефандим).
  await db('portals_purchases').where({ id: purchaseId }).update({ status: 'owned' });

  await ctx.editMessageText(`${baseText}\n\n❌ ОТКЛОНЕНО (${by}) — подарок вернулся в инвентарь`).catch(() => {});
  try {
    await ctx.api.sendMessage(purchase.user_id,
      `Заявка на вывод «${purchase.gift_name}» отклонена. Подарок остался в твоём инвентаре.`);
  } catch (e) { console.warn('notify buyer err', e.message); }
  return ctx.answerCallbackQuery({ text: 'Отклонено, подарок в инвентаре' });
});

bot.on('message:successful_payment', async (ctx) => {
  const sp = ctx.message.successful_payment;
  // Определяем тип счёта: вывод подарка (withdraw) или пополнение (stars).
  const dep = await db('deposits').where({ id: sp.invoice_payload }).first().catch(() => null);
  if (dep?.method === 'withdraw') {
    try {
      const { name } = await settleWithdrawPayment(sp.invoice_payload);
      await ctx.reply(
        `✅ *Оплачено!*\n\nЗаявка на вывод «${name}» принята. Подарок будет отправлен в течение 24 часов.`,
        { parse_mode: 'Markdown' }
      );
    } catch (e) {
      console.error('settle withdraw error', e);
      await ctx.reply('Оплата получена, заявка на вывод будет обработана.');
    }
    return;
  }
  try {
    const { balance, coins } = await settleStarsPayment({
      payload: sp.invoice_payload,
      telegramChargeId: sp.telegram_payment_charge_id,
      totalAmount: sp.total_amount,
      currency: sp.currency
    });
    await ctx.reply(
      `✅ *Оплачено!*\n\n+${coins} дублонов зачислено\nБаланс: ${balance} дублонов`,
      { parse_mode: 'Markdown', reply_markup: { inline_keyboard: [[{ text: '🎴  Играть', web_app: { url: MINI_APP_URL } }]] } }
    );
  } catch (e) {
    console.error('settle stars error', e);
    await ctx.reply('Платёж получен, дублоны будут зачислены в течение минуты.');
  }
});

bot.start();
console.log(`Bot @${BOT_USERNAME} started`);
