import { startKeyboard } from '../lib/keyboards.js';
import { db } from '../../api/lib/db.js';
import { bindReferrer, makeRefCode } from '../../api/lib/referral.js';

async function ensurePlayer(ctx) {
  const u = ctx.from;
  if (!u) return null;
  const id = String(u.id);
  const exists = await db('players').where({ user_id: id }).first();
  if (!exists) {
    await db('players').insert({
      user_id: id,
      username: u.username || null,
      first_name: u.first_name || null,
      ref_code: makeRefCode(id)
    }).onConflict('user_id').ignore();
  }
  return id;
}

export async function startCommand(ctx) {
  const userId = await ensurePlayer(ctx);
  // /start DW12345 — реферальный код
  const payload = (ctx.match || '').toString().trim();
  if (userId && payload) {
    try { await bindReferrer(userId, payload); } catch {}
  }

  await ctx.reply(
    [
      'DEADWILL — Запечатанные завещания.',
      '',
      'Выбирай один из пяти контрактов. Часть скрывает золото, часть — пустоту, часть — проклятый долг.',
      '',
      '/app — открыть приложение',
      '/deposit — пополнить (Stars · TON)',
      '/profile — баланс и история'
    ].join('\n'),
    {
      reply_markup: startKeyboard()
    }
  );
}
