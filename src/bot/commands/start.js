import { startKeyboard } from '../lib/keyboards.js';
import { MINI_APP_URL } from '../lib/config.js';
import { db } from '../../api/lib/db.js';
import { makeRefCode } from '../../api/lib/referral.js';
import { FOUNDER_IDS } from '../../api/lib/config.js';
import { randomBytes } from 'node:crypto';
const TOKEN_TTL_MS = 365 * 24 * 60 * 60 * 1000; // 1 год (бессрочный для релиза)

// Ретрай на случай кратковременного SQLITE_BUSY (две записи api↔bot).
async function withRetry(fn, attempts = 4) {
  for (let i = 0; i < attempts; i++) {
    try { return await fn(); }
    catch (e) {
      if (e.code === 'SQLITE_BUSY' && i < attempts - 1) {
        await new Promise((r) => setTimeout(r, 200 * (i + 1)));
        continue;
      }
      throw e;
    }
  }
}

// Генерируем auth token для пользователя
async function generateAuthToken(userId) {
  const token = randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + TOKEN_TTL_MS).toISOString();

  // Удаляем старые токены этого пользователя
  await db('auth_tokens').where({ user_id: userId }).delete().catch(() => {});

  await db('auth_tokens').insert({ token, user_id: userId, expires_at: expiresAt });
  return token;
}

// Скачиваем аватарку игрока через bot API
async function getAvatarFileId(ctx) {
  try {
    const photos = await ctx.api.getUserProfilePhotos(ctx.from.id, { limit: 1 });
    if (photos.total_count > 0) {
      const sizes = photos.photos[0];
      // Берём средний размер
      const photo = sizes[Math.floor(sizes.length / 2)];
      return photo.file_id;
    }
  } catch (e) {
    console.warn('[start] avatar fetch failed:', e.message);
  }
  return null;
}

export async function startCommand(ctx) {
  const u = ctx.from;
  if (!u) return;

  const userId = String(u.id);
  const role = FOUNDER_IDS.includes(userId) ? 'Owner' : 'player';

  // Получаем аватарку
  const avatarFileId = await getAvatarFileId(ctx);

  // Создаём/обновляем игрока с полными данными (с ретраем на BUSY)
  await withRetry(() => db('players').insert({
    user_id: userId,
    username: u.username || null,
    first_name: u.first_name || null,
    last_name: u.last_name || null,
    avatar_file_id: avatarFileId,
    role
  }).onConflict('user_id').merge({
    username: u.username || null,
    first_name: u.first_name || null,
    last_name: u.last_name || null,
    ...(avatarFileId ? { avatar_file_id: avatarFileId } : {}),
    ...(role === 'Owner' ? { role } : {})
  }));

  // Создаём ref_code если нет
  const player = await db('players').where({ user_id: userId }).first();
  if (!player.ref_code) {
    await db('players').where({ user_id: userId }).update({ ref_code: makeRefCode(userId) });
  }

  // Реферальная привязка
  const payload = (ctx.match || '').toString().trim();
  if (payload && !payload.startsWith('token:')) {
    try {
      const { bindReferrer } = await import('../../api/lib/referral.js');
      await bindReferrer(userId, payload);
    } catch {}
  }

  // Генерируем токен для мини-апп
  const token = await generateAuthToken(userId);

  const name = u.first_name || u.username || 'Игрок';
  const balance = Number(player?.balance || 0);
  const welcomeFree = !player?.welcome_used;

  const text = [
    `👋 Привет, ${name}!`,
    '',
    '🏴 DEADWILL — запечатанные завещания',
    '',
    '36 карт. Каждая скрывает тайну.',
    'Займи карту → таймер 30–40 сек → все раскрываются.',
    '',
    welcomeFree ? '🎁 Первая карта — БЕСПЛАТНО!' : `💰 Твой баланс: ${balance} монет`,
    '',
    '1 монета = 20 ⭐ = 0.1 TON'
  ].join('\n');

  // Кнопка ведёт на мини-апп с токеном в startapp
  const appUrlWithToken = `${MINI_APP_URL}?startapp=token:${token}`;

  await ctx.reply(text, {
    reply_markup: {
      inline_keyboard: [[
        { text: '🎴 Играть', web_app: { url: appUrlWithToken } }
      ], [
        { text: '💰 Пополнить', web_app: { url: `${MINI_APP_URL}?startapp=deposit` } },
        { text: '👤 Профиль', web_app: { url: `${MINI_APP_URL}?startapp=profile` } }
      ]]
    }
  });
}
