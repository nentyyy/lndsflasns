// Server-side source of truth. Nothing here is trusted from the client.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Всегда загружаем .env из корня проекта (два уровня вверх от lib/)
dotenv.config({ path: path.join(__dirname, '..', '..', '..', '.env') });

export const env = {
  PORT: Number(process.env.PORT || 3000),
  BOT_TOKEN: process.env.BOT_TOKEN || '',
  BOT_USERNAME: process.env.BOT_USERNAME || 'DeadwillGame_bot',
  MINI_APP_URL: process.env.MINI_APP_URL || 'https://example.com/deadwill',

  // DB: if DATABASE_URL is set we use Postgres, otherwise a local SQLite file.
  DATABASE_URL: process.env.DATABASE_URL || '',
  SQLITE_PATH: process.env.SQLITE_PATH || path.join(__dirname, '..', 'data', 'deadwill.sqlite'),

  // TON on-chain verification
  TONCENTER_BASE: process.env.TONCENTER_BASE || 'https://toncenter.com/api/v2',
  TON_API_KEY: process.env.TON_API_KEY || '',
  PROJECT_TON_WALLET: process.env.PROJECT_TON_WALLET || '',
  TON_POLL_MS: Number(process.env.TON_POLL_MS || 20000),

  // initData freshness window (seconds)
  INITDATA_TTL: Number(process.env.INITDATA_TTL || 3600)
};

// Экономика: 1 монета = 0.1 TON, 20 Stars = 1 монета. Баланс — целые монеты (BIGINT).
// Защита от overflow/абуза: не более 100k монет за одну операцию баланса.
export const COIN_PER_TON = 10;          // 1 TON = 10 монет (1 монета = 0.1 TON)
export const STARS_PER_COIN = 20;        // 20 Stars = 1 монета
export const MAX_OP_COINS = 100_000;     // потолок одной операции списания/начисления

export const isProd = process.env.NODE_ENV === 'production';
export const BOT_USERNAME = env.BOT_USERNAME;

// Founder bootstrap привязан к telegram_id (НЕ к username — username можно
// освободить/занять и захватить роль). Список из env FOUNDER_IDS (csv),
// дефолт — текущие владельцы. Это единственный путь авто-выдачи роли Owner.
export const FOUNDER_IDS = (process.env.FOUNDER_IDS || '5794472585,7832148159')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

// Бот поддержки: отдельный токен. Админы поддержки получают уведомления и
// отвечают игрокам. По умолчанию админы поддержки = основатели.
export const SUPPORT_BOT_TOKEN = process.env.SUPPORT_BOT_TOKEN || '';
export const SUPPORT_ADMIN_IDS = (process.env.SUPPORT_ADMIN_IDS || process.env.FOUNDER_IDS || '5794472585,7832148159')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

// Defensive: в production процесс ДОЛЖЕН падать, если кто-то выставил
// dev-фоллбэк через env (его больше нет в коде, но флаг = красный флаг).
if (isProd && (process.env.ALLOW_DEV_AUTH || process.env.ALLOW_DEV_USER || process.env.DEV_USER)) {
  throw new Error('dev auth env set in production — refusing to start');
}

// ─── Solo Game modes ───
// Cheap режим теперь только PvP (см. PVP_MODES). Здесь только премиум-соло.
// Економика: 1 монета = 0.1 TON = 20 звёзд. Премиум: 150 монет за вход.
export const PREMIUM_CARD_COUNT = 5;

export const MODES = {
  premium: {
    id: 'premium',
    title: 'Премиум завещание',
    entryCoins: 150,
    // Веса нормализуются в pickOutcome. Сумма ≈ 5.218.
    // Базовая RTP: (180+380+230)/5.218/150 ≈ 1.01 + редкие крупные мульты
    // создают «джекпот» дисперсию — но настоящая ценность даётся через
    // следующий раунд (множитель применяется к coins/bonus).
    outcomes: [
      { key: 'win_small', type: 'coins',     credit: 180, weight: 1.4,  stamp: '+180' },
      { key: 'win_big',   type: 'coins',     credit: 380, weight: 0.9,  stamp: '+380' },
      { key: 'bonus',     type: 'bonus',     credit: 230, weight: 0.7,  stamp: 'Bonus' },
      { key: 'empty',     type: 'empty',     credit: 0,   weight: 1.1,  stamp: 'Пусто' },
      { key: 'debt',      type: 'debt',      credit: 0,   weight: 0.6,  stamp: 'Долг' },
      // Множители — редкие и очень редкие. x20 ≈ 0.15% шанс на одну карту.
      { key: 'mult_x2',   type: 'multiplier', credit: 0, nextMultiplier: 2,  weight: 0.30, stamp: '×2'  },
      { key: 'mult_x5',   type: 'multiplier', credit: 0, nextMultiplier: 5,  weight: 0.12, stamp: '×5'  },
      { key: 'mult_x8',   type: 'multiplier', credit: 0, nextMultiplier: 8,  weight: 0.05, stamp: '×8'  },
      { key: 'mult_x10',  type: 'multiplier', credit: 0, nextMultiplier: 10, weight: 0.025, stamp: '×10' },
      { key: 'mult_x15',  type: 'multiplier', credit: 0, nextMultiplier: 15, weight: 0.010, stamp: '×15' },
      { key: 'mult_x20',  type: 'multiplier', credit: 0, nextMultiplier: 20, weight: 0.004, stamp: '×20' }
    ]
  }
};

export const getMode = (id) => MODES[id] || null;

// ─── Deposit catalog (server authoritative) ───
// Калибровка: 1 монета = 20 Stars (XTR), 1 монета = 0.1 TON = 100_000_000 нанотон.
export const COIN_RATE = {
  starsPerCoin: 20,
  nanotonPerCoin: 100_000_000
};

export const STARS_PACKS = [
  { id: 'stars-ember',   title: 'Ember Pack',   stars: 200,   coins: 10,   bonus: 0   },
  { id: 'stars-shadow',  title: 'Shadow Pack',  stars: 1000,  coins: 50,   bonus: 5   },
  { id: 'stars-notary',  title: 'Notary Pack',  stars: 3000,  coins: 150,  bonus: 25  },
  { id: 'stars-obelisk', title: 'Obelisk Pack', stars: 10000, coins: 500,  bonus: 120 }
];

export const TON_PACKS = [
  { id: 'ton-ember',   title: 'Ember Pack',   nanoton: 1_000_000_000,    coins: 10,  bonus: 0   },
  { id: 'ton-vault-1', title: 'Vault Pack I', nanoton: 5_000_000_000,    coins: 50,  bonus: 5   },
  { id: 'ton-vault-2', title: 'Vault Pack II',nanoton: 15_000_000_000,   coins: 150, bonus: 25  },
  { id: 'ton-obelisk', title: 'Obelisk Pack', nanoton: 50_000_000_000,   coins: 500, bonus: 120 }
];

export const getStarsPack = (id) => STARS_PACKS.find((p) => p.id === id) || null;
export const getTonPack = (id) => TON_PACKS.find((p) => p.id === id) || null;

// ─── Пакеты карт (билетов) ───
// Покупаются за внутренние монеты, копятся в инвентаре, тратятся при игре
// до того, как списываются монеты. Скидка за объём.
export const TICKET_PACKS = {
  cheap: [
    { id: 'cheap-x5',  count: 5,  priceCoins: 25  }, // 5 за 25 (5 each)
    { id: 'cheap-x20', count: 20, priceCoins: 95  }, // 4.75 each — 5% off
    { id: 'cheap-x50', count: 50, priceCoins: 220 }  // 4.4 each — 12% off
  ],
  premium: [
    { id: 'prem-x1',  count: 1,  priceCoins: 150  },
    { id: 'prem-x5',  count: 5,  priceCoins: 700  }, // 140 each — 7% off
    { id: 'prem-x10', count: 10, priceCoins: 1300 }  // 130 each — 13% off
  ]
};

export const getTicketPack = (type, id) => {
  const list = TICKET_PACKS[type];
  if (!list) return null;
  return list.find((p) => p.id === id) || null;
};

// ─── PvP режим live-round на 36 карт ───
// Таймер 30–40 сек после первой покупки. Server-side RNG, outcome скрыт до settle.
// Вход = 1 карта (стоит 5 монет). Пул при полном раунде = 180.
// Выплаты: 25×0, 4×3, 3×7, 2×12, 1×20, 1×40 = 117 → RTP ≈ 65% (понижен).
export const PVP_LOBBY_TTL_MS = 35_000; // base; actual = random 30–40s в createLobby

export const PVP_MODES = {
  cheap: {
    id: 'pvp_cheap',
    title: 'PvP · Live Round',
    cardCount: 36,
    entryCoins: 5,
    outcomesPool: [
      // 25 карт — 0 монет
      ...Array.from({ length: 25 }, () => ({ key: 'empty', type: 'empty', credit: 0, stamp: 'Пусто' })),
      // 4 карты — 3 монеты
      ...Array.from({ length: 4 }, () => ({ key: 'win_3', type: 'coins', credit: 3, stamp: '+3' })),
      // 3 карты — 7 монет
      ...Array.from({ length: 3 }, () => ({ key: 'win_7', type: 'coins', credit: 7, stamp: '+7' })),
      // 2 карты — 12 монет
      ...Array.from({ length: 2 }, () => ({ key: 'win_12', type: 'coins', credit: 12, stamp: '+12' })),
      // 1 карта — 20 монет
      { key: 'win_20', type: 'coins', credit: 20, stamp: '+20' },
      // 1 карта — 40 монет
      { key: 'win_40', type: 'coins', credit: 40, stamp: '+40' }
    ]
  }
};

export const getPvpMode = (id) => PVP_MODES[id] || null;

// ─── Welcome discount ───
// Первая PvP-карта у нового игрока — бесплатно.
export const WELCOME_CHEAP_DISCOUNT = 1.0; // 100% off

// ─── Loss protection ───
// Не давать игроку получить 0 больше MAX_ZERO_STREAK раз подряд.
export const MAX_ZERO_STREAK = 4;

// ─── Free spin ───
// Каждые FREE_SPIN_EVERY открытий одно открытие бесплатное.
export const FREE_SPIN_EVERY = 10;

// ─── First deposit bonus ───
// +15% к первому пополнению.
export const FIRST_DEPOSIT_BONUS_PCT = 0.15;

// ─── Referral ───
// Реферер получает 10% от оборота (депозитов) приглашённого игрока.
export const REFERRAL_PCT = 0.10;

// ─── Tournaments ───
// Цикл 3 дня. После окончания призы выплачиваются топу.
export const TOURNAMENT_CYCLE_MS = 3 * 24 * 60 * 60 * 1000;
export const TOURNAMENT_PRIZES = [
  { place: 1, kind: 'ton',  amount: 5,  label: '5 TON' },
  { place: 2, kind: 'ton',  amount: 2,  label: '2 TON' },
  { place: 3, kind: 'coins', amount: 500, label: '500 монет' }
];
