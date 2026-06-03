// Portals NFT sync
// Получаем доступные подарки из Telegram Gifts API и маппим цены в монеты.
// Пока API недоступно — используем кеш из gifts_catalog фронта.

import { db } from './db.js';

const CACHE_TTL_MS = 5 * 60 * 1000; // 5 минут

let cache = { items: null, ts: 0 };

// Sync availability: помечаем подарки как unavailable если они исчезли из Portals.
// В production заменить на реальный API-вызов к Portals/gift.
export async function syncPortalsAvailability(giftIds) {
  // TODO: подключить реальный API Portals когда будут credentials
  // Пока возвращаем все подарки как available
  return giftIds.reduce((acc, id) => {
    acc[id] = { available: true };
    return acc;
  }, {});
}

export async function getAvailableGiftIds() {
  if (cache.items && Date.now() - cache.ts < CACHE_TTL_MS) {
    return cache.items;
  }
  // Без реального API — все подарки считаем доступными
  cache = { items: null, ts: Date.now() };
  return null; // null = all available
}

// Authoritative server-side lookup: цена и название подарка ТОЛЬКО отсюда.
// Возвращает null если подарок не существует в каталоге (whitelist).
export async function getGiftFromCache(giftId) {
  if (!giftId) return null;
  const row = await db('portals_cache').where({ id: String(giftId) }).first();
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    file: row.file,
    priceCoins: Number(row.priceCoins),
    priceTon: Number(row.priceTon),
    stock: Number(row.stock),
    available: Number(row.available)
  };
}
