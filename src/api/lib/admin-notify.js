import { env, FOUNDER_IDS } from './config.js';
import { db } from './db.js';

// Прямой вызов Telegram Bot API из API-процесса (у него есть BOT_TOKEN).
// Нажатия кнопок обрабатывает bot-процесс (callback_query).
async function tg(method, body) {
  if (!env.BOT_TOKEN) return null;
  try {
    const res = await fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    return await res.json();
  } catch (e) {
    console.error('tg notify error', e.message);
    return null;
  }
}

const fmt = (n) => new Intl.NumberFormat('ru-RU').format(Number(n) || 0);

// Уведомить всех админов о заявке на вывод подарка + кнопки Одобрить/Отклонить.
export async function notifyAdminsPurchase(purchase) {
  const p = await db('players').where({ user_id: purchase.user_id }).first();
  if (!p) return;

  const dep = await db('ledger')
    .where({ user_id: purchase.user_id })
    .where('ref_type', 'like', 'deposit%')
    .where('amount', '>', 0)
    .sum('amount as s').first();

  // Последние 3 результата (выигрыши/ставки) для контекста.
  const recent = await db('ledger')
    .where({ user_id: purchase.user_id })
    .whereIn('ref_type', ['pvp_payout', 'payout', 'pvp_bet', 'bet'])
    .orderBy('id', 'desc').limit(3)
    .select('ref_type', 'amount');
  const recentLine = recent.length
    ? recent.map((r) => `${r.amount >= 0 ? '+' : ''}${fmt(r.amount)}`).join(', ')
    : '—';

  const who = p.username ? `@${p.username}`
    : [p.first_name, p.last_name].filter(Boolean).join(' ') || `ID ${p.user_id}`;

  const text = [
    '🎁 ЗАЯВКА НА ВЫВОД ПОДАРКА',
    '',
    `Игрок: ${who} (ID ${p.user_id})`,
    `Выводит: ${purchase.gift_name} — ${fmt(purchase.price_coins)} монет`,
    '',
    `Баланс сейчас: ${fmt(p.balance)} монет`,
    `Игр сыграно: ${fmt(p.games_played)}`,
    `Всего выиграно: ${fmt(p.coins_won)} монет`,
    `Всего потрачено: ${fmt(p.coins_spent)} монет`,
    `Всего пополнено: ${fmt(dep?.s || 0)} монет`,
    `Последние результаты: ${recentLine}`,
    '',
    'Когда выдашь подарок — нажми одну из кнопок:'
  ].join('\n');

  const reply_markup = {
    inline_keyboard: [[
      { text: '✅ ОДОБРИТЬ', callback_data: `approve:${purchase.id}` },
      { text: '❌ НЕ ОДОБРИТЬ', callback_data: `reject:${purchase.id}` }
    ]]
  };

  for (const adminId of FOUNDER_IDS) {
    await tg('sendMessage', { chat_id: adminId, text, reply_markup });
  }
}
