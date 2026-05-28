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
