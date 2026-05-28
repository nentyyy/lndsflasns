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
    // Обновляем роль если нужно (вдруг добавили в список позже)
    if (ADMIN_USERNAMES.includes(username) && existing.role !== 'Owner') {
      await db('players').where({ user_id: id }).update({ role: 'Owner', username });
    }
    return db('players').where({ user_id: id }).first();
  }
  await db('players')
    .insert({
      user_id: id,
      username,
      first_name: user.first_name || null,
      role
    })
    .onConflict('user_id')
    .ignore();
  return db('players').where({ user_id: id }).first();
}

// Express middleware: authenticates every request, attaches req.user + req.player.
export function authMiddleware() {
  return async (req, res, next) => {
    try {
      let user;
      const rawInitData = extractInitData(req);

      if (env.BOT_TOKEN && rawInitData) {
        // Telegram Mini App — проверяем подпись
        user = verifyInitData(rawInitData, env.BOT_TOKEN);
      } else if (env.ALLOW_DEV_AUTH) {
        // Fallback: браузер без initData или dev-режим
        const devId = req.get('x-dev-user') || '1';
        user = { id: devId, username: 'dev', first_name: 'Dev' };
      } else if (env.BOT_TOKEN && !rawInitData) {
        throw new AuthError('missing initData — open via Telegram');
      } else {
        throw new AuthError('auth not configured');
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
