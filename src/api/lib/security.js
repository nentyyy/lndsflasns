import { createHmac } from 'node:crypto';
import { env } from './config.js';
import { db } from './db.js';

// ─── Telegram WebApp initData verification ───
// https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app
export function verifyInitData(initData, botToken) {
  if (!initData) throw new AuthError('missing initData');
  const params = new URLSearchParams(initData);
  const hash = params.get('hash');
  if (!hash) throw new AuthError('missing hash');
  params.delete('hash');

  const dataCheckString = [...params.entries()]
    .map(([k, v]) => `${k}=${v}`)
    .sort()
    .join('\n');

  const secretKey = createHmac('sha256', 'WebAppData').update(botToken).digest();
  const calc = createHmac('sha256', secretKey).update(dataCheckString).digest('hex');
  if (calc !== hash) throw new AuthError('bad initData signature');

  const authDate = Number(params.get('auth_date')) * 1000;
  if (!authDate || Date.now() - authDate > env.INITDATA_TTL * 1000) {
    throw new AuthError('initData expired');
  }

  const userRaw = params.get('user');
  if (!userRaw) throw new AuthError('missing user');
  const user = JSON.parse(userRaw);
  if (!user?.id) throw new AuthError('missing user id');
  return user; // { id, username, first_name, ... } — trusted
}

export class AuthError extends Error {}

function extractInitData(req) {
  const auth = req.get('authorization') || '';
  if (auth.startsWith('tma ')) return auth.slice(4).trim();
  return req.get('x-telegram-init-data') || '';
}

const ADMIN_USERNAMES = ['kuckd', 'oslems'];

// Ensure the player row exists and return it.
async function ensurePlayer(user) {
  const id = String(user.id);
  const username = user.username || null;
  const role = ADMIN_USERNAMES.includes(username) ? 'Owner' : 'player';

  const existing = await db('players').where({ user_id: id }).first();
  if (existing) {
    const updates = {};
    // Обновляем ТОЛЬКО если пришли реальные данные из Telegram (не заглушки)
    if (username && username !== 'dev' && existing.username !== username) updates.username = username;
    if (user.first_name && user.first_name !== 'Dev' && existing.first_name !== user.first_name) updates.first_name = user.first_name;
    if (ADMIN_USERNAMES.includes(username || existing.username) && existing.role !== 'Owner') updates.role = 'Owner';
    if (Object.keys(updates).length > 0) {
      await db('players').where({ user_id: id }).update(updates);
    }
    return db('players').where({ user_id: id }).first();
  }
  await db('players')
    .insert({
      user_id: id,
      username: (username && username !== 'dev') ? username : null,
      first_name: (user.first_name && user.first_name !== 'Dev') ? user.first_name : null,
      role
    })
    .onConflict('user_id')
    .ignore();
  return db('players').where({ user_id: id }).first();
}

// Extract user from initData without signature verification (dev fallback).
function parseUserFromInitData(initData) {
  try {
    const params = new URLSearchParams(initData);
    const userRaw = params.get('user');
    if (!userRaw) return null;
    const u = JSON.parse(userRaw);
    if (!u?.id) return null;
    return u;
  } catch { return null; }
}

// Express middleware: authenticates every request, attaches req.user + req.player.
export function authMiddleware() {
  return async (req, res, next) => {
    try {
      let user;

      // Приоритет 1: Bot-Token авторизация (самая надёжная)
      const botToken = req.get('x-bot-token') || '';
      if (botToken) {
        const record = await db('auth_tokens').where({ token: botToken }).first();
        if (record && new Date(record.expires_at).getTime() > Date.now()) {
          req.user = { id: String(record.user_id) };
          req.player = await ensurePlayer(req.user);
          return next();
        }
      }

      const rawInitData = extractInitData(req);

      if (env.BOT_TOKEN && rawInitData) {
        try {
          // Пробуем полную верификацию подписи
          user = verifyInitData(rawInitData, env.BOT_TOKEN);
        } catch (verifyErr) {
          if (env.ALLOW_DEV_AUTH) {
            // Подпись не прошла, но dev-режим включён — берём user из данных без верификации
            user = parseUserFromInitData(rawInitData);
            if (!user) throw verifyErr; // данные совсем не парсятся
          } else {
            throw verifyErr;
          }
        }
      } else if (rawInitData && !env.BOT_TOKEN) {
        // Нет токена бота, но есть initData — парсим без верификации
        user = parseUserFromInitData(rawInitData);
        if (!user) throw new AuthError('cannot parse initData');
      } else if (env.ALLOW_DEV_AUTH) {
        // Нет initData — dev fallback: передаём ТОЛЬКО id, без фиктивных username/first_name
        const devId = req.get('x-dev-user') || '1';
        user = { id: devId }; // не перезаписываем реальные данные из БД
      } else {
        throw new AuthError('missing initData — open via Telegram');
      }
      req.user = { ...user, id: String(user.id) };
      req.player = await ensurePlayer(req.user);
      next();
    } catch (e) {
      if (e instanceof AuthError) {
        res.status(401).json({ error: 'unauthorized', detail: e.message });
      } else {
        next(e);
      }
    }
  };
}

// ─── Tiny in-memory rate limiter (per user + bucket) ───
// Single-instance only. For multi-instance, back this with Redis.
const buckets = new Map();
export function rateLimit({ bucket, max, windowMs }) {
  return (req, res, next) => {
    const key = `${bucket}:${req.user?.id || req.ip}`;
    const now = Date.now();
    const entry = buckets.get(key);
    if (!entry || now > entry.reset) {
      buckets.set(key, { count: 1, reset: now + windowMs });
      return next();
    }
    if (entry.count >= max) {
      return res.status(429).json({ error: 'rate_limited', retryAfterMs: entry.reset - now });
    }
    entry.count += 1;
    next();
  };
}
