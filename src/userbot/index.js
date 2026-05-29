import { TelegramClient } from 'telegram';
import { StringSession } from 'telegram/sessions/index.js';
import { Api } from 'telegram';
import input from 'input';
import { db } from '../api/lib/db.js';
import { migrate } from '../api/lib/migrate.js';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', '..', '.env') });

const SESSION_FILE = path.join(__dirname, 'session.txt');
const API_ID = Number(process.env.TG_API_ID || '');
const API_HASH = process.env.TG_API_HASH || '';

if (!API_ID || !API_HASH) { console.error('Set TG_API_ID and TG_API_HASH in .env'); process.exit(1); }

let sessionString = '';
if (fs.existsSync(SESSION_FILE)) sessionString = fs.readFileSync(SESSION_FILE, 'utf8').trim();

const session = new StringSession(sessionString);
const client = new TelegramClient(session, API_ID, API_HASH, { connectionRetries: 5 });

const PORTALS_URL = 'https://portal-market.com/';

function tonToCoins(ton) { return Math.ceil(Number(ton) / 0.1); }

// Получаем WebApp initData через RequestWebView (аутентифицированный доступ)
async function getPortalsInitData() {
  try {
    const peer = await client.getInputEntity('portals');
    const result = await client.invoke(new Api.messages.RequestWebView({
      peer,
      bot: peer,
      url: PORTALS_URL,
      platform: 'android',
    }));
    const url = result.url;
    // URL вида: https://portal-market.com/#tgWebAppData=...
    const fragment = url.split('#')[1] || url.split('?')[1] || '';
    const params = new URLSearchParams(fragment);
    const initData = params.get('tgWebAppData') || '';
    console.log('[portals] got initData length:', initData.length);
    return initData;
  } catch (e) {
    console.error('[portals] RequestWebView error:', e.message);
    return '';
  }
}

// Запрашиваем список подарков
async function fetchGifts(initData) {
  const headers = {
    'Accept': 'application/json',
    'Content-Type': 'application/json',
    'Origin': 'https://portal-market.com',
    'Referer': 'https://portal-market.com/',
  };
  if (initData) headers['X-Telegram-Init-Data'] = initData;

  const endpoints = [
    '/api/gifts',
    '/api/v1/gifts',
    '/api/market/gifts',
    '/api/catalog',
    '/api/v1/catalog',
    '/api/market',
    '/api/items',
    '/api/products',
    '/api/market/listings',
    '/api/listings',
  ];

  for (const ep of endpoints) {
    try {
      const res = await fetch(`https://portal-market.com${ep}`, {
        headers,
        signal: AbortSignal.timeout(6000)
      });
      const ct = res.headers.get('content-type') || '';
      if (res.ok && ct.includes('json')) {
        const data = await res.json();
        console.log('[portals] got response from', ep, '- keys:', Object.keys(data).join(','));
        const gifts = parseGifts(data);
        if (gifts.length > 0) return gifts;
      }
    } catch (e) {
      // silent
    }
  }

  // Пробуем получить список через GraphQL
  try {
    const res = await fetch('https://portal-market.com/graphql', {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: '{ gifts { id name price rarity stock } }' }),
      signal: AbortSignal.timeout(5000)
    });
    if (res.ok) {
      const data = await res.json();
      if (data.data?.gifts) return parseGifts(data.data.gifts);
    }
  } catch {}

  return [];
}

function parseGifts(data) {
  const list = Array.isArray(data) ? data : (data.gifts || data.items || data.data || data.result || data.products || []);
  if (!Array.isArray(list)) return [];
  return list
    .filter(i => i && (i.price || i.priceTon || i.price_ton) > 0)
    .map(i => ({
      id: String(i.id || i.slug || i.name || '').toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, ''),
      name: String(i.name || i.title || i.id),
      file: String(i.file || i.image || i.thumbnail || i.photo || `${i.id}.webp`),
      rarity: String(i.rarity || i.tier || i.type || 'Common'),
      priceTon: Number(i.price || i.priceTon || i.price_ton || i.ton_price || 0),
      stock: Number(i.stock || i.available_count || i.count || 999),
      available: i.available !== false && i.stock !== 0,
    }))
    .filter(g => g.id && g.priceTon > 0);
}

async function syncGifts(gifts) {
  if (!gifts.length) {
    console.log('[portals] no gifts parsed — API structure may differ, check logs');
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

async function processOrders() {
  const f = path.join(__dirname, 'pending_order.json');
  if (!fs.existsSync(f)) return;
  try {
    const order = JSON.parse(fs.readFileSync(f, 'utf8'));
    fs.unlinkSync(f);
    console.log('[portals] processing order:', order);
    // Открываем Portals и отправляем запрос на покупку
    const initData = await getPortalsInitData();
    const headers = { 'Content-Type': 'application/json', 'Accept': 'application/json' };
    if (initData) headers['X-Telegram-Init-Data'] = initData;
    const res = await fetch('https://portal-market.com/api/buy', {
      method: 'POST',
      headers,
      body: JSON.stringify({ giftId: order.giftId }),
      signal: AbortSignal.timeout(10000)
    });
    const result = await res.json().catch(() => ({}));
    console.log('[portals] buy result:', JSON.stringify(result));
    const status = res.ok ? 'sent' : 'failed';
    await db('portals_purchases').where({ id: order.purchaseId }).update({ status, sent_at: new Date().toISOString() });
  } catch (e) {
    console.error('[portals] order error:', e.message);
  }
}

async function main() {
  await migrate();
  await client.start({
    phoneNumber: async () => await input.text('Телефон: '),
    password: async () => await input.text('2FA: '),
    phoneCode: async () => await input.text('Код: '),
    onError: e => console.error(e.message),
  });
  fs.writeFileSync(SESSION_FILE, client.session.save());
  console.log('[userbot] session saved');
  console.log('[userbot] connected as:', (await client.getMe()).username || 'user');

  const initData = await getPortalsInitData();
  const gifts = await fetchGifts(initData);
  await syncGifts(gifts);

  setInterval(async () => {
    const d = await getPortalsInitData();
    await syncGifts(await fetchGifts(d));
  }, 5 * 60 * 1000);

  setInterval(processOrders, 3000);
  console.log('[userbot] running');
}

main().catch(e => { console.error('Fatal:', e.message); process.exit(1); });
