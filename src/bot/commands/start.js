import { startKeyboard } from '../lib/keyboards.js';
import { MINI_APP_URL } from '../lib/config.js';
import { db } from '../../api/lib/db.js';
import { bindReferrer, makeRefCode } from '../../api/lib/referral.js';

async function ensurePlayer(ctx) {
  const u = ctx.from;
  if (!u) return null;
  const id = String(u.id);
  await db('players').insert({
    user_id: id,
    username: u.username || null,
    first_name: u.first_name || null,
    ref_code: makeRefCode(id)
  }).onConflict('user_id').ignore();
  return id;
}

export async function startCommand(ctx) {
  const userId = await ensurePlayer(ctx);

  const payload = (ctx.match || '').toString().trim();
  if (userId && payload) {
    try { await bindReferrer(userId, payload); } catch {}
  }

  const player = await db('players').where({ user_id: userId }).first().catch(() => null);
  const balance = player ? Number(player.balance) : 0;
  const welcomeFree = player ? !player.welcome_used : true;

  const text = [
    '🏴 DEADWILL — запечатанные завещания',
    '',
    'Перед тобой 36 карт. Каждая скрывает тайну:',
    'золото, пустоту или проклятый долг.',
    '',
    '🎴 Как играть:',
    '• Занимаешь карту → ставишь 5 монет',
    '• Таймер 30–40 сек, другие игроки тоже занимают',
    '• Все карты открываются одновременно',
    '',
    '💰 Призы: +3, +7, +12, +14, +15, +20, +25, +40 монет',
    '',
    '1 монета = 0.1 TON = 20 Stars',
    welcomeFree ? '🎁 Первая карта — БЕСПЛАТНО!' : `Баланс: ${balance} монет`
  ].join('\n');

  try {
    await ctx.reply(text, { reply_markup: startKeyboard() });
  } catch (e) {
    console.error('start reply error:', e.message);
  }
}
