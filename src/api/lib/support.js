import { db } from './db.js';

// ─── Справочники категорий / приоритетов / статусов ───
// Тексты полностью оригинальные, в стиле DEADWILL.
export const SUPPORT_CATEGORIES = [
  { key: 'gameplay', label: '🎮 Игровой процесс' },
  { key: 'coins',    label: '💰 Монеты и пополнение' },
  { key: 'gifts',    label: '🎁 Подарки и магазин' },
  { key: 'tech',     label: '⚙️ Технические проблемы' },
  { key: 'partner',  label: '🤝 Сотрудничество' },
  { key: 'idea',     label: '💡 Идея для игры' }
];

export const SUPPORT_PRIORITIES = [
  { key: 'normal', label: '⚪️ Обычный' },
  { key: 'urgent', label: '🔥 Срочный' }
];

// open → на рассмотрении, in_work → в работе, closed → закрыт, cancelled → отменён
export const SUPPORT_STATUSES = {
  open:      '⏳ на рассмотрении',
  in_work:   '💬 в работе',
  closed:    '✅ закрыт',
  cancelled: '🗑 отменён'
};

export const categoryLabel = (key) =>
  SUPPORT_CATEGORIES.find((c) => c.key === key)?.label || key;
export const priorityLabel = (key) =>
  SUPPORT_PRIORITIES.find((p) => p.key === key)?.label || key;
export const statusLabel = (key) => SUPPORT_STATUSES[key] || key;

// ─── CRUD по обращениям ───

export async function createTicket({ userId, username, category, priority, text }) {
  const [id] = await db('support_tickets').insert({
    user_id: String(userId),
    username: username || null,
    category,
    priority,
    status: 'open',
    text,
    created_at: db.fn.now(),
    updated_at: db.fn.now()
  });
  // Первое сообщение игрока сохраняем и в ленте переписки.
  await db('support_messages').insert({
    ticket_id: id, from_admin: false, text, created_at: db.fn.now()
  });
  return getTicket(id);
}

export async function getTicket(id) {
  return db('support_tickets').where({ id }).first();
}

export async function listUserTickets(userId, limit = 5) {
  return db('support_tickets')
    .where({ user_id: String(userId) })
    .orderBy('created_at', 'desc')
    .limit(limit);
}

export async function countTickets(userId) {
  const rows = await db('support_tickets').where({ user_id: String(userId) });
  const open = rows.filter((t) => t.status === 'open' || t.status === 'in_work').length;
  return { total: rows.length, open };
}

export async function setStatus(id, status) {
  await db('support_tickets').where({ id }).update({ status, updated_at: db.fn.now() });
  return getTicket(id);
}

// Отмена возможна только своих и только пока обращение живое.
export async function cancelTicket(id, userId) {
  const t = await getTicket(id);
  if (!t || String(t.user_id) !== String(userId)) return null;
  if (t.status === 'closed' || t.status === 'cancelled') return t;
  return setStatus(id, 'cancelled');
}

export async function addMessage(ticketId, fromAdmin, text) {
  await db('support_messages').insert({
    ticket_id: ticketId, from_admin: Boolean(fromAdmin), text, created_at: db.fn.now()
  });
  await db('support_tickets').where({ id: ticketId }).update({ updated_at: db.fn.now() });
}

export async function listMessages(ticketId) {
  return db('support_messages').where({ ticket_id: ticketId }).orderBy('id', 'asc');
}
