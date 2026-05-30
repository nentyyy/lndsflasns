import { Bot } from 'grammy';
import { config } from 'dotenv';
import {
  SUPPORT_BOT_TOKEN, SUPPORT_ADMIN_IDS
} from '../api/lib/config.js';
import {
  SUPPORT_CATEGORIES, SUPPORT_PRIORITIES,
  categoryLabel, priorityLabel, statusLabel,
  createTicket, getTicket, listUserTickets, countTickets,
  cancelTicket, setStatus, addMessage
} from '../api/lib/support.js';

config();

if (!SUPPORT_BOT_TOKEN) {
  console.log('SUPPORT_BOT_TOKEN missing — support bot skipped');
  process.exit(0);
}

const bot = new Bot(SUPPORT_BOT_TOKEN);
bot.catch((err) => console.error('Support bot error:', err.message));

const isAdmin = (ctx) => SUPPORT_ADMIN_IDS.includes(String(ctx.from?.id));

// ─── Лёгкий in-memory FSM (по telegram id) ───
// Хранит незавершённый ввод: создание запроса, продолжение, ответ админа.
const flow = new Map();
const setFlow = (id, v) => flow.set(String(id), v);
const getFlow = (id) => flow.get(String(id));
const clearFlow = (id) => flow.delete(String(id));

const fmtUser = (ctx) => (ctx.from?.username ? `@${ctx.from.username}` : (ctx.from?.first_name || `id ${ctx.from?.id}`));
const fmtDate = (d) => {
  try { return new Date(d).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }); }
  catch { return String(d); }
};

// ─── Клавиатуры ───
function mainMenuKb() {
  return { inline_keyboard: [
    [{ text: '📩 Новый запрос', callback_data: 'new' }],
    [{ text: '📂 Мои запросы', callback_data: 'mine' }],
    [{ text: '💬 Частые вопросы', callback_data: 'faq' }]
  ] };
}
function categoriesKb() {
  return { inline_keyboard: [
    ...SUPPORT_CATEGORIES.map((c) => [{ text: c.label, callback_data: `cat:${c.key}` }]),
    [{ text: '🔙 Назад', callback_data: 'menu' }]
  ] };
}
function prioritiesKb() {
  return { inline_keyboard: [
    SUPPORT_PRIORITIES.map((p) => ({ text: p.label, callback_data: `prio:${p.key}` })),
    [{ text: '🔙 Назад', callback_data: 'new' }]
  ] };
}

const WELCOME = [
  '☠️ Добро пожаловать в DEADWILL',
  'Здесь решаем любые вопросы — быстро и без лишних слов.',
  '⚡️ Обычно отвечаем в течение нескольких часов.'
].join('\n');

async function showMenu(ctx, edit = false) {
  if (edit) {
    await ctx.editMessageText(WELCOME, { reply_markup: mainMenuKb() }).catch(() => ctx.reply(WELCOME, { reply_markup: mainMenuKb() }));
  } else {
    await ctx.reply(WELCOME, { reply_markup: mainMenuKb() });
  }
}

// ─── /start ───
bot.command('start', async (ctx) => {
  clearFlow(ctx.from.id);
  await showMenu(ctx);
});

// ─── /status [N] ───
bot.command('status', async (ctx) => {
  const arg = (ctx.message.text || '').split(/\s+/)[1];
  let ticket;
  if (arg) {
    ticket = await getTicket(Number(arg));
    if (!ticket || String(ticket.user_id) !== String(ctx.from.id)) {
      return ctx.reply('Запрос с таким номером не найден.');
    }
  } else {
    const list = await listUserTickets(ctx.from.id, 1);
    ticket = list[0];
    if (!ticket) return ctx.reply('У тебя пока нет обращений. Жми /start, чтобы создать.');
  }
  await ctx.reply(statusCard(ticket), { reply_markup: ticketKb(ticket) });
});

// ─── /mytickets ───
bot.command('mytickets', (ctx) => showMyTickets(ctx));

// ─── /reply <id> <текст> — ответ админа игроку ───
bot.command('reply', async (ctx) => {
  if (!isAdmin(ctx)) return ctx.reply('Команда доступна только команде поддержки.');
  const m = (ctx.message.text || '').match(/^\/reply\s+(\d+)\s+([\s\S]+)$/);
  if (!m) return ctx.reply('Формат: /reply <номер> <текст ответа>');
  await deliverAdminReply(ctx, Number(m[1]), m[2].trim());
});

function statusCard(t) {
  return [
    `📜 Запрос #${t.id}`,
    `Тема: ${categoryLabel(t.category)}`,
    `Статус: ${statusLabel(t.status)}`,
    `Открыт: ${fmtDate(t.created_at)}`
  ].join('\n');
}

function ticketKb(t) {
  const rows = [];
  if (t.status === 'open' || t.status === 'in_work') {
    rows.push([{ text: '🗑 Отменить запрос', callback_data: `cancel:${t.id}` }]);
  }
  rows.push([{ text: '🔙 В меню', callback_data: 'menu' }]);
  return { inline_keyboard: rows };
}

async function showMyTickets(ctx, edit = false) {
  const { total, open } = await countTickets(ctx.from.id);
  const list = await listUserTickets(ctx.from.id, 5);
  const lines = [`📂 Твои запросы`, `Всего: ${total} / Открытых: ${open}`, ''];
  if (!list.length) {
    lines.push('Пока пусто. Создай первый — кнопка ниже.');
  } else {
    for (const t of list) {
      lines.push(`#${t.id} · ${categoryLabel(t.category)} · ${statusLabel(t.status)}`);
    }
  }
  const kb = { inline_keyboard: [
    ...list
      .filter((t) => t.status === 'open' || t.status === 'in_work')
      .map((t) => [{ text: `🗑 Отменить #${t.id}`, callback_data: `cancel:${t.id}` }]),
    [{ text: '📩 Новый запрос', callback_data: 'new' }],
    [{ text: '🔙 Назад', callback_data: 'menu' }]
  ] };
  const text = lines.join('\n');
  if (edit) await ctx.editMessageText(text, { reply_markup: kb }).catch(() => ctx.reply(text, { reply_markup: kb }));
  else await ctx.reply(text, { reply_markup: kb });
}

// ─── Callback-кнопки ───
bot.on('callback_query:data', async (ctx) => {
  const data = ctx.callbackQuery.data;

  // Навигация
  if (data === 'menu') { clearFlow(ctx.from.id); await ctx.answerCallbackQuery(); return showMenu(ctx, true); }
  if (data === 'mine') { await ctx.answerCallbackQuery(); return showMyTickets(ctx, true); }
  if (data === 'faq') {
    await ctx.answerCallbackQuery();
    return ctx.editMessageText('📖 Раздел пополняется. Пока задай вопрос напрямую.', {
      reply_markup: { inline_keyboard: [
        [{ text: '📩 Написать нам', callback_data: 'new' }],
        [{ text: '🔙 Назад', callback_data: 'menu' }]
      ] }
    }).catch(() => {});
  }
  if (data === 'new') {
    setFlow(ctx.from.id, { mode: 'await_category' });
    await ctx.answerCallbackQuery();
    return ctx.editMessageText('Выбери категорию обращения:', { reply_markup: categoriesKb() }).catch(() => {});
  }

  // Выбор категории
  let m;
  if ((m = data.match(/^cat:(.+)$/))) {
    const f = getFlow(ctx.from.id) || {};
    setFlow(ctx.from.id, { ...f, mode: 'await_priority', category: m[1] });
    await ctx.answerCallbackQuery();
    return ctx.editMessageText(`Категория: ${categoryLabel(m[1])}\n\nНасколько срочно?`, { reply_markup: prioritiesKb() }).catch(() => {});
  }

  // Выбор приоритета
  if ((m = data.match(/^prio:(.+)$/))) {
    const f = getFlow(ctx.from.id) || {};
    if (!f.category) { await ctx.answerCallbackQuery(); return showMenu(ctx, true); }
    setFlow(ctx.from.id, { ...f, mode: 'await_text', priority: m[1] });
    await ctx.answerCallbackQuery();
    return ctx.editMessageText('✍️ Опиши вопрос одним сообщением — чем подробнее, тем быстрее поможем.').catch(() => {});
  }

  // Отмена запроса игроком
  if ((m = data.match(/^cancel:(\d+)$/))) {
    const t = await cancelTicket(Number(m[1]), ctx.from.id);
    await ctx.answerCallbackQuery();
    if (!t) return ctx.reply('Не получилось отменить — запрос не найден.');
    return ctx.reply(`🗑 Запрос #${t.id} отменён. Если передумаешь — мы здесь.`, { reply_markup: mainMenuKb() });
  }

  // Игрок отметил «вопрос решён»
  if ((m = data.match(/^resolved:(\d+)$/))) {
    const t = await getTicket(Number(m[1]));
    await ctx.answerCallbackQuery();
    if (!t || String(t.user_id) !== String(ctx.from.id)) return;
    await setStatus(t.id, 'closed');
    notifyAdmins(`✅ Игрок отметил запрос #${t.id} как решённый.`).catch(() => {});
    return ctx.reply(`⚰️ Запрос #${t.id} закрыт. Если появится новый вопрос — возвращайся.`, { reply_markup: mainMenuKb() });
  }

  // Игрок хочет продолжить переписку
  if ((m = data.match(/^continue:(\d+)$/))) {
    const t = await getTicket(Number(m[1]));
    await ctx.answerCallbackQuery();
    if (!t || String(t.user_id) !== String(ctx.from.id)) return;
    setFlow(ctx.from.id, { mode: 'continue', ticketId: t.id });
    return ctx.reply(`💬 Напиши, что уточнить по запросу #${t.id} — отправлю команде.`);
  }

  // ── Админские действия ──
  if ((m = data.match(/^take:(\d+)$/))) {
    if (!isAdmin(ctx)) return ctx.answerCallbackQuery({ text: 'Нет доступа', show_alert: true });
    const t = await setStatus(Number(m[1]), 'in_work');
    await ctx.answerCallbackQuery({ text: 'Взято в работу' });
    await ctx.editMessageText(`${ctx.callbackQuery.message?.text || ''}\n\n💬 В работе (${fmtUser(ctx)})`, { reply_markup: adminTicketKb(t) }).catch(() => {});
    notifyUser(t.user_id, `💬 Твой запрос #${t.id} взят в работу. Скоро ответим.`).catch(() => {});
    return;
  }
  if ((m = data.match(/^areply:(\d+)$/))) {
    if (!isAdmin(ctx)) return ctx.answerCallbackQuery({ text: 'Нет доступа', show_alert: true });
    setFlow(ctx.from.id, { mode: 'admin_reply', ticketId: Number(m[1]) });
    await ctx.answerCallbackQuery();
    return ctx.reply(`✍️ Напиши ответ для запроса #${m[1]} — отправлю игроку.`);
  }
  if ((m = data.match(/^close:(\d+)$/))) {
    if (!isAdmin(ctx)) return ctx.answerCallbackQuery({ text: 'Нет доступа', show_alert: true });
    const t = await setStatus(Number(m[1]), 'closed');
    await ctx.answerCallbackQuery({ text: 'Закрыто' });
    await ctx.editMessageText(`${ctx.callbackQuery.message?.text || ''}\n\n✅ Закрыт (${fmtUser(ctx)})`).catch(() => {});
    notifyUser(t.user_id, `⚰️ Запрос #${t.id} закрыт. Если появится новый вопрос — возвращайся.`).catch(() => {});
    return;
  }

  return ctx.answerCallbackQuery();
});

function adminTicketKb(t) {
  return { inline_keyboard: [
    [{ text: '💬 Ответить', callback_data: `areply:${t.id}` }, { text: '❌ Закрыть', callback_data: `close:${t.id}` }]
  ] };
}

// ─── Текстовые сообщения (зависит от состояния FSM) ───
bot.on('message:text', async (ctx) => {
  const text = ctx.message.text.trim();
  if (text.startsWith('/')) return; // команды обрабатываются выше
  const f = getFlow(ctx.from.id);
  if (!f) return showMenu(ctx);

  // Игрок описывает новый запрос
  if (f.mode === 'await_text') {
    const t = await createTicket({
      userId: ctx.from.id, username: ctx.from.username,
      category: f.category, priority: f.priority, text
    });
    clearFlow(ctx.from.id);
    await ctx.reply(`🕯 Запрос #${t.id} принят. Мёртвые не ждут — ответим как можно скорее.`, { reply_markup: mainMenuKb() });
    return notifyNewTicket(t);
  }

  // Игрок продолжает переписку по существующему запросу
  if (f.mode === 'continue') {
    const t = await getTicket(f.ticketId);
    clearFlow(ctx.from.id);
    if (!t) return ctx.reply('Запрос не найден.');
    await addMessage(t.id, false, text);
    await ctx.reply(`📨 Добавлено к запросу #${t.id}. Команда увидит сообщение.`, { reply_markup: mainMenuKb() });
    return notifyAdmins(`💬 Новое сообщение по запросу #${t.id}\nОт: ${fmtUser(ctx)}\nТекст: ${text}`, adminTicketKb(t));
  }

  // Админ пишет ответ игроку
  if (f.mode === 'admin_reply') {
    if (!isAdmin(ctx)) { clearFlow(ctx.from.id); return; }
    const id = f.ticketId;
    clearFlow(ctx.from.id);
    return deliverAdminReply(ctx, id, text);
  }

  return showMenu(ctx);
});

// ─── Доставка ответа админа игроку ───
async function deliverAdminReply(ctx, ticketId, text) {
  const t = await getTicket(ticketId);
  if (!t) return ctx.reply('Запрос не найден.');
  await addMessage(t.id, true, text);
  if (t.status === 'open') await setStatus(t.id, 'in_work');
  try {
    await bot.api.sendMessage(t.user_id,
      `💬 Ответ по запросу #${t.id}:\n${text}`,
      { reply_markup: { inline_keyboard: [[
        { text: '✅ Вопрос решён', callback_data: `resolved:${t.id}` },
        { text: '🔄 Продолжить', callback_data: `continue:${t.id}` }
      ]] } });
    await ctx.reply(`✅ Ответ отправлен игроку (запрос #${t.id}).`);
  } catch (e) {
    await ctx.reply(`Не удалось доставить ответ: ${e.message}`);
  }
}

// ─── Уведомления ───
async function notifyAdmins(text, replyMarkup) {
  for (const adminId of SUPPORT_ADMIN_IDS) {
    try { await bot.api.sendMessage(adminId, text, replyMarkup ? { reply_markup: replyMarkup } : {}); }
    catch (e) { console.warn(`notify admin ${adminId}:`, e.message); }
  }
}
async function notifyUser(userId, text) {
  try { await bot.api.sendMessage(userId, text); }
  catch (e) { console.warn(`notify user ${userId}:`, e.message); }
}

async function notifyNewTicket(t) {
  const prio = priorityLabel(t.priority);
  const who = t.username ? `@${t.username}` : `id ${t.user_id}`;
  const text = [
    `⚠️ Новый запрос #${t.id}`,
    `От: ${who} (id: ${t.user_id})`,
    `Категория: ${categoryLabel(t.category)}`,
    `Приоритет: ${prio}`,
    `Текст: ${t.text}`
  ].join('\n');
  const kb = { inline_keyboard: [[
    { text: '✅ Взять в работу', callback_data: `take:${t.id}` },
    { text: '❌ Закрыть', callback_data: `close:${t.id}` }
  ], [
    { text: '💬 Ответить', callback_data: `areply:${t.id}` }
  ]] };
  return notifyAdmins(text, kb);
}

bot.start();
console.log('Support bot started');
