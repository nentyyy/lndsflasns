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

const WELCOME_TEXT = `🏴 *DEADWILL* — запечатанные завещания

Перед тобой 36 карт. Каждая хранит тайну: золото, пустоту или проклятый долг.

*Как играть:*
• Занимаешь карту → делаешь ставку
• Через 30–40 секунд открываются все карты
• Твой приз — то, что скрывалось под твоей картой

*Призы в раунде:*
5 карт по +7 монет · 5 карт по +3 · 2 по +12
Джекпоты: +14 · +15 · +20 · +25 · *+40 монет* 🔥

*Валюта:*
1 монета \= 0.1 TON \= 20 ⭐ Stars

Первая карта — *бесплатно*. Удачи\!`;

export async function startCommand(ctx) {
  const userId = await ensurePlayer(ctx);

  // Реферальный код из /start DWxxxxx
  const payload = (ctx.match || '').toString().trim();
  if (userId && payload) {
    try { await bindReferrer(userId, payload); } catch {}
  }

  // Отправляем красивый старт с фото-заглушкой (death seal SVG как URL недоступен в боте, используем текст)
  try {
    await ctx.replyWithPhoto(
      'https://194-31-223-100.sslip.io/og.png',
      {
        caption: WELCOME_TEXT,
        parse_mode: 'MarkdownV2',
        reply_markup: startKeyboard()
      }
    );
  } catch {
    // Нет фото — шлём текст
    await ctx.reply(WELCOME_TEXT, {
      parse_mode: 'MarkdownV2',
      reply_markup: startKeyboard()
    });
  }
}
