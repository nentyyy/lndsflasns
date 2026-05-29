import { createHmac, timingSafeEqual } from 'node:crypto';
import { env } from './config.js';
import { db } from './db.js';

// ─── Telegram WebApp initData verification ───
// https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app
// Max initData age: 24h regardless of env (Telegram recommends ≤ 24h).
const INITDATA_MAX_AGE_SEC = Math.min(Number(env.INITDATA_TTL) || 86400, 86400);

export function verifyInitData(initData, botToken) {
  if (!botToken) throw new AuthError('bot token not configured');
  if (!initData) throw new AuthError('missing initData');
  const params = new URLSearchParams(initData);
  const hash = params.get('hash');
  if (!hash) throw new AuthError('missing hash');
  params.delete('hash');

  const dataCheckString = [...params.entries()]
    .map(([k, v]) => `${k}=${v}`)
    .sort()
    .join('\n');

  // Official Telegram scheme: secret = HMAC_SHA256("WebAppData", botToken)
  const secretKey = createHmac('sha256', 'WebAppData').update(botToken).digest();
  const calc = createHmac('sha256', secretKey).update(dataCheckString).digest('hex');
  // Constant-time compare to avoid timing oracle.
  const a = Buffer.from(calc, 'hex');
  const b = Buffer.from(hash, 'hex');
  if (a.length !== b.length || !timingSafeEqual(a, b)) throw new AuthError('bad initData signature');

  const authDate = Number(params.get('auth_date')) * 1000;
  if (!authDate || Date.now() - authDate > INITDATA_MAX_AGE_SEC * 1000) {
    throw new AuthError('initData expired');
  }

  const userRaw = params.get('user');
  if (!userRaw) throw new AuthError('missing user');
  const user = JSON.parse(userRaw);
  if (!user?.id) throw new AuthError('missing user id');
  return user; // { id, username, first_name, ... } — trusted (HMAC-verified)
}

export class AuthError extends Error {}

function extractInitData(req) {
  const auth = req.get('authorization') || '';
  if (auth.startsWith('tma ')) return auth.slice(4).trim();
  return req.get('x-telegram-init-data') || '';
}

const ADMIN_USERNAMES = ['kuckd', 'oslems'];

// Ensure the player row exists and return it. `user` always comes from a
// verified source (HMAC initData or a DB-backed bot token) — never from a header.
async function ensurePlayer(user) {
  const id = String(user.id);
  const username = user.username || null;
  const isFounder = username && ADMIN_USERNAMES.includes(username);

  const existing = await db('players').where({ user_id: id }).first();
  if (existing) {
    const updates = {};
    if (username && existing.username !== username) updates.username = username;
    if (user.first_name && existing.first_name !== user.first_name) updates.first_name = user.first_name;
    if (user.last_name && existing.last_name !== user.last_name) updates.last_name = user.last_name;
    // Founders bootstrap to Owner; never auto-downgrade an existing elevated role.
    if (isFounder && existing.role !== 'Owner') updates.role = 'Owner';
    if (Object.keys(updates).length > 0) {
      await db('players').where({ user_id: id }).update(updates);
    }
    return db('players').where({ user_id: id }).first();
  }
  await db('players')
    .insert({
      user_id: id,
      username,
      first_name: user.first_name || null,
      last_name: user.last_name || null,
      role: isFounder ? 'Owner' : 'player'
    })
    .onConflict('user_id')
    .ignore();
  return db('players').where({ user_id: id }).first();
}

// Express middleware: authenticates EVERY /api request. Only two trusted paths:
//   1. X-Bot-Token  — random secret issued by the bot on /start, stored in DB.
//   2. Telegram initData — HMAC-SHA256 verified against BOT_TOKEN.
// Anything else → 401. No X-Dev-User, no unverified parse, no id=1 fallback.
export function authMiddleware() {
  return async (req, res, next) => {
    try {
      // Path 1: bot-issued session token (DB-backed secret).
      const botToken = req.get('x-bot-token') || '';
      if (botToken) {
        const record = await db('auth_tokens').where({ token: botToken }).first();
        if (record && new Date(record.expires_at).getTime() > Date.now()) {
          req.user = { id: String(record.user_id) };
          req.player = await ensurePlayer(req.user);
          if (!req.player) throw new AuthError('player not found');
          return next();
        }
        throw new AuthError('invalid or expired token');
      }

      // Path 2: HMAC-verified Telegram initData (strict, no fallback).
      const rawInitData = extractInitData(req);
      if (!rawInitData) throw new AuthError('missing credentials');
      const user = verifyInitData(rawInitData, env.BOT_TOKEN);

      req.user = { ...user, id: String(user.id) };
      req.player = await ensurePlayer(req.user);
      next();
    } catch (e) {
      if (e instanceof AuthError) {
        return res.status(401).json({ error: 'unauthorized', detail: e.message });
      }
      next(e);
    }
  };
}

// Role guards — read role strictly from the DB-backed req.player, never from input.
export function requireAdmin(req, res, next) {
  const role = req.player?.role;
  if (role !== 'Owner' && role !== 'Admin') {
    return res.status(403).json({ error: 'forbidden' });
  }
  next();
}

export function requireOwner(req, res, next) {
  if (req.player?.role !== 'Owner') {
    return res.status(403).json({ error: 'forbidden' });
  }
  next();
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
