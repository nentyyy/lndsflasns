// Portals Userbot — парсит подарки из @portals и синкает в БД.
import { TelegramClient } from 'telegram';
import { StringSession } from 'telegram/sessions/index.js';
import input from 'input';
import { db } from '../api/lib/db.js';
import { migrate } from '../api/lib/migrate.js';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Загружаем .env из корня проекта
const envPath = path.join(__dirname, '..', '..', '.env');
dotenv.config({ path: envPath });

const SESSION_FILE = path.join(__dirname, 'session.txt');
const API_ID = Number(process.env.TG_API_ID || '');
const API_HASH = process.env.TG_API_HASH || '';

if (!API_ID || !API_HASH) {
  console.error('Set TG_API_ID and TG_API_HASH in .env');
  process.exit(1);
}

let sessionString = '';
if (fs.existsSync(SESSION_FILE)) {
  sessionString = fs.readFileSync(SESSION_FILE, 'utf8').trim();
}

const session = new StringSession(sessionString);
const client = new TelegramClient(session, API_ID, API_HASH, { connectionRetries: 5 });

// 1 монета = 0.1 TON
function tonToCoins(ton) { return Math.ceil(ton / 0.1); }

// Пытаемся получить WebApp URL и данные подарков из ответа @portals
async function fetchPortalsData() {
  try {
    const portalsBot = 'portals';

    // Отправляем /start
    await client.sendMessage(portalsBot, { message: '/start' });
    await new Promise(r => setTimeout(r, 3000));

    const messages = await client.getMessages(portalsBot, { limit: 10 });
    let webAppUrl = null;

    for (const msg of messages) {
      // Ищем WebApp URL в кнопках
      if (msg.replyMarkup) {
        for (const row of (msg.replyMarkup.rows || [])) {
          for (const btn of (row.buttons || [])) {
            const url = btn.url || btn.webView?.url || '';
            if (url.includes('t.me') || url.startsWith('https://')) {
              console.log('[portals] button url:', url);
              if (!webAppUrl) webAppUrl = url;
            }
          }
        }
      }
      if (msg.message) {
        console.log('[portals] message text:', msg.message.slice(0, 200));
      }
    }

    // Если нашли WebApp URL — пробуем получить данные через HTTP
    if (webAppUrl) {
      console.log('[portals] trying to fetch gift data from:', webAppUrl);
      const gifts = await fetchGiftsFromWebApp(webAppUrl);
      return gifts;
    }

    // Пробуем известные Portals API endpoints напрямую
    return await tryPortalsApi();

  } catch (e) {
    console.error('[portals] fetchPortalsData error:', e.message);
    return [];
  }
}

// Пробуем Portals HTTP API
async function tryPortalsApi() {
  const endpoints = [
    'https://api.portals.win/gifts',
    'https://portals.win/api/gifts',
    'https://ton-portals.app/api/gifts',
    'https://portals.tg/api/gifts',
  ];

  for (const url of endpoints) {
    try {
      const res = await fetch(url, { headers: { 'Accept': 'application/json' }, signal: AbortSignal.timeout(5000) });
      if (res.ok) {
        const data = await res.json();
        console.log('[portals] found API at:', url);
        return parseGiftsResponse(data);
      }
    } catch {}
  }

  console.log('[portals] no known API endpoint responded');
  return [];
}

// Получаем данные через URL мини-апп
async function fetchGiftsFromWebApp(webAppUrl) {
  try {
    // Извлекаем домен и пробуем /api/gifts или /gifts
    const base = new URL(webAppUrl);
    const apiUrl = `${base.protocol}//${base.host}/api/gifts`;
    const res = await fetch(apiUrl, { signal: AbortSignal.timeout(5000) });
    if (res.ok) {
      const data = await res.json();
      return parseGiftsResponse(data);
    }
  } catch (e) {
    console.log('[portals] webApp API fetch failed:', e.message);
  }
  return [];
}

// Парсим ответ в единый формат
function parseGiftsResponse(data) {
  const list = Array.isArray(data) ? data : (data.gifts || data.items || data.data || []);
  return list.map(item => ({
    id: String(item.id || item.slug || item.name).toLowerCase().replace(/\s+/g, '-'),
    name: item.name || item.title || String(item.id),
    file: item.file || item.image || item.emoji || `${item.id}.webp`,
    rarity: item.rarity || item.tier || 'Common',
    priceTon: Number(item.price || item.priceTon || item.ton_price || 0),
    stock: Number(item.stock || item.available || item.count || 999),
    available: item.available !== false && item.stock !== 0,
  })).filter(g => g.priceTon > 0);
}

// Синкаем в БД
async function syncGifts(gifts) {
  if (!gifts.length) {
    console.log('[portals] no gifts found via API — check logs above for WebApp URL');
    console.log('[portals] add gifts manually via: /api/admin/portals-cache endpoint');
    return;
  }
  for (const g of gifts) {
    await db('portals_cache').insert({
      id: g.id, name: g.name, file: g.file, rarity: g.rarity,
      priceCoins: tonToCoins(g.priceTon), priceTon: g.priceTon,
      stock: g.stock, available: g.available ? 1 : 0,
      updated_at: new Date().toISOString()
    }).onConflict('id').merge();
  }
  console.log(`[portals] synced ${gifts.length} gifts to DB`);
}

// Купить подарок — запись заказа в БД
async function processOrders() {
  const orderFile = path.join(__dirname, 'pending_order.json');
  if (!fs.existsSync(orderFile)) return;
  try {
    const order = JSON.parse(fs.readFileSync(orderFile, 'utf8'));
    fs.unlinkSync(orderFile);
    console.log('[portals] processing order:', order);
    // Отправляем сообщение боту @portals для покупки
    await client.sendMessage('portals', { message: `/buy ${order.giftId}` });
    await db('portals_purchases').where({ id: order.purchaseId }).update({ status: 'sent', sent_at: new Date().toISOString() });
    console.log('[portals] order sent:', order.purchaseId);
  } catch (e) {
    console.error('[portals] order error:', e.message);
  }
}

async function main() {
  await migrate();

  await client.start({
    phoneNumber: async () => await input.text('Телефон (+7...): '),
    password: async () => await input.text('Пароль 2FA (если есть): '),
    phoneCode: async () => await input.text('Код из Telegram: '),
    onError: (err) => console.error('Auth error:', err.message),
  });

  const saved = client.session.save();
  fs.writeFileSync(SESSION_FILE, saved);
  console.log('[userbot] session saved');
  console.log('[userbot] connected as:', (await client.getMe()).username || 'user');

  // Первичная синхронизация
  const gifts = await fetchPortalsData();
  await syncGifts(gifts);

  // Каждые 5 минут обновляем
  setInterval(async () => {
    const g = await fetchPortalsData();
    await syncGifts(g);
  }, 5 * 60 * 1000);

  // Каждые 3 секунды проверяем очередь заказов
  setInterval(processOrders, 3000);

  console.log('[userbot] running. Ctrl+C to stop.');
}

main().catch(e => { console.error('Fatal:', e.message); process.exit(1); });
