// Portals Userbot — парсит подарки из @PortalsBot и синкает в БД.
// Запуск: node src/userbot/index.js
// Первый запуск: введи номер телефона и код подтверждения.
import { TelegramClient } from 'telegram';
import { StringSession } from 'telegram/sessions/index.js';
import { Api } from 'telegram';
import input from 'input';
import { db } from '../api/lib/db.js';
import { migrate } from '../api/lib/migrate.js';
import { COIN_RATE } from '../api/lib/config.js';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

// Загружаем .env из корня проекта (/opt/deadwill/.env)
const envPath = new URL('../../.env', import.meta.url).pathname;
dotenv.config({ path: envPath });

const __dirname = path.dirname(fileURLToPath(import.meta.url));
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
const client = new TelegramClient(session, API_ID, API_HASH, {
  connectionRetries: 5,
});

// Конвертируем TON → монеты (1 монета = 0.1 TON)
function tonToCoins(tonAmount) {
  return Math.ceil(tonAmount / 0.1);
}

// Парсим подарки из WebApp Portals или из сообщений бота @PortalsBot
async function fetchPortalsGifts() {
  try {
    // Отправляем /start боту @PortalsBot чтобы получить список
    const portalsBot = 'portals';

    // Получаем inline кнопки или список через bot API
    await client.sendMessage(portalsBot, { message: '/start' });
    await new Promise(r => setTimeout(r, 2000));

    const messages = await client.getMessages(portalsBot, { limit: 5 });
    console.log('[portals] got', messages.length, 'messages from bot');

    // Возвращаем placeholder данные пока не подключён реальный парсинг
    // В production здесь будет парсинг ответов бота
    return [];
  } catch (e) {
    console.error('[portals] fetch error:', e.message);
    return [];
  }
}

// Синкаем кеш подарков в базу данных
async function syncGiftsToDb(gifts) {
  if (!gifts || gifts.length === 0) {
    console.log('[portals] no gifts to sync');
    return;
  }
  for (const gift of gifts) {
    await db('portals_cache')
      .insert({
        id: gift.id,
        name: gift.name,
        file: gift.file || `${gift.id}.webp`,
        rarity: gift.rarity || 'Common',
        priceCoins: gift.priceCoins || tonToCoins(gift.priceTon || 0.1),
        priceTon: gift.priceTon || 0,
        stock: gift.stock || 999,
        available: gift.available !== false,
        updated_at: new Date().toISOString()
      })
      .onConflict('id')
      .merge();
  }
  console.log(`[portals] synced ${gifts.length} gifts`);
}

// Купить подарок через Portals (для команды из API)
async function buyGiftViaPortals(giftId, recipientUserId) {
  try {
    const portalsBot = 'portals';
    // Команда покупки — зависит от API бота
    await client.sendMessage(portalsBot, { message: `/buy ${giftId} ${recipientUserId}` });
    console.log(`[portals] sent buy request for ${giftId} to user ${recipientUserId}`);
    return { ok: true };
  } catch (e) {
    console.error('[portals] buy error:', e.message);
    return { ok: false, error: e.message };
  }
}

// Главный цикл
async function main() {
  await migrate();

  await client.start({
    phoneNumber: async () => await input.text('Телефон (+7...): '),
    password: async () => await input.text('Пароль 2FA (если есть): '),
    phoneCode: async () => await input.text('Код из Telegram: '),
    onError: (err) => console.error('Auth error:', err.message),
  });

  // Сохраняем сессию
  const savedSession = client.session.save();
  fs.writeFileSync(SESSION_FILE, savedSession);
  console.log('[userbot] session saved');
  console.log('[userbot] connected as:', (await client.getMe()).username || 'user');

  // Первичная синхронизация
  await syncGiftsToDb(await fetchPortalsGifts());

  // Периодический цикл: каждые 5 минут обновляем цены
  setInterval(async () => {
    console.log('[portals] syncing...');
    await syncGiftsToDb(await fetchPortalsGifts());
  }, 5 * 60 * 1000);

  // Слушаем HTTP-команды на покупку через простой файл-флаг
  setInterval(async () => {
    const orderFile = path.join(__dirname, 'pending_order.json');
    if (fs.existsSync(orderFile)) {
      try {
        const order = JSON.parse(fs.readFileSync(orderFile, 'utf8'));
        fs.unlinkSync(orderFile);
        console.log('[portals] processing order:', order);
        const result = await buyGiftViaPortals(order.giftId, order.userId);
        if (result.ok) {
          await db('portals_purchases').where({ id: order.purchaseId }).update({ status: 'sent', sent_at: new Date().toISOString() });
        }
      } catch (e) {
        console.error('[portals] order error:', e.message);
      }
    }
  }, 3000);

  console.log('[userbot] running. Ctrl+C to stop.');
}

main().catch(e => {
  console.error('Fatal:', e.message);
  process.exit(1);
});
