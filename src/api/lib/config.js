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
    // Фиксированные призы. Множителей нет — каждая карта независимый фикс-приз.
    // RTP ≈ 78% (понижен): EV = (150*1.4+250*0.6+450*0.25+1000*0.07)/5.42 ≈ 117 из 150.
    outcomes: [
      { key: 'win_s', type: 'coins', credit: 150,  weight: 1.4,  stamp: '+150'  },
      { key: 'win_m', type: 'coins', credit: 250,  weight: 0.6,  stamp: '+250'  },
      { key: 'win_l', type: 'coins', credit: 450,  weight: 0.25, stamp: '+450' },
      { key: 'jack',  type: 'coins', credit: 1000, weight: 0.07, stamp: '+1000' },
      { key: 'empty', type: 'empty', credit: 0,    weight: 2.1,  stamp: 'Пусто' },
      { key: 'debt',  type: 'debt',  credit: 0,    weight: 1.0,  stamp: 'Долг'  }
    ]
  }
};

export const getMode = (id) => MODES[id] || null;

// ─── Solo Risk-режим ───
// Игрок ставит 1 премиум-карту (= 150 дублонов стоимости), выбирает N закрытых
// ячеек (2-10) и одну из них вскрывает. Угадал → приз = ставка × N (в подарок-НФТ).
// Чем больше N, тем выше риск и множитель. Шанс угадать = 1/N.
// RTP 85%: при шансе 1/N приз = ставка × N × 0.85 (EV = 0.85 от ставки).
export const RISK_MODE = {
  minCells: 2,
  maxCells: 10,
  betCoins: 150,           // стоимость премиум-карты (эквивалент ставки)
  rtp: 0.85,
  maxRewardCoins: 300 * 10 // потолок приза для подбора НФТ
};

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
    // Раскладка: 12 выигрышных + 24 пустых = 36 ячеек.
    // 1×65, 2×20, 2×15, 3×5, 4×3 = 162 дублона (RTP 162/180 = 90%). 65 — MAX-приз.
    outcomesPool: [
      // 24 пустых
      ...Array.from({ length: 24 }, () => ({ key: 'empty', type: 'empty', credit: 0, stamp: 'Пусто' })),
      // 4 ячейки — 3 монеты
      ...Array.from({ length: 4 }, () => ({ key: 'win_3', type: 'coins', credit: 3, stamp: '+3' })),
      // 3 ячейки — 5 монет
      ...Array.from({ length: 3 }, () => ({ key: 'win_5', type: 'coins', credit: 5, stamp: '+5' })),
      // 2 ячейки — 15 монет
      ...Array.from({ length: 2 }, () => ({ key: 'win_15', type: 'coins', credit: 15, stamp: '+15' })),
      // 2 ячейки — 20 монет
      ...Array.from({ length: 2 }, () => ({ key: 'win_20', type: 'coins', credit: 20, stamp: '+20' })),
      // 1 ячейка — 65 монет (MAX)
      { key: 'win_65', type: 'coins', credit: 65, stamp: '+65' }
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

// ─── Referral 2.0 ───
// Базовый % с депозитов (легаси-фоллбэк). Реальный % зависит от тира.
export const REFERRAL_PCT = 0.10;

// Тиры: чем больше приглашённых, тем выше комиссия с депозитов рефералов.
export const REFERRAL_TIERS = [
  { id: 'novice',  name: 'Новичок',  min: 0,  depositPct: 5,  color: '#9a8c6a' },
  { id: 'bronze',  name: 'Бронза',   min: 3,  depositPct: 7,  color: '#cd7f32' },
  { id: 'silver',  name: 'Серебро',  min: 10, depositPct: 10, color: '#c9d2dc' },
  { id: 'gold',    name: 'Золото',   min: 25, depositPct: 12, color: '#f3c33f' },
  { id: 'legend',  name: 'Легенда',  min: 50, depositPct: 15, color: '#ff5ca8' }
];

// Доля со ставок рефералов в PvP (рейк): даже без депозитов активный реферал
// приносит доход. % от entry каждой купленной ячейки.
export const REFERRAL_WAGER_PCT = 0.03;

// Одноразовый бонус рефереру за ПЕРВЫЙ депозит приглашённого.
export const REFERRAL_FIRST_DEP_BONUS = 50;

// Майлстоуны: одноразовые награды за число приглашённых.
export const REFERRAL_MILESTONES = [
  { id: 'm5',  invites: 5,  reward: 200,  label: '+200 дублонов' },
  { id: 'm10', invites: 10, reward: 600,  label: '+600 дублонов' },
  { id: 'm25', invites: 25, reward: 2000, label: '+2000 дублонов' },
  { id: 'm50', invites: 50, reward: 6000, label: '+6000 дублонов' }
];

export function referralTierFor(count) {
  let t = REFERRAL_TIERS[0];
  for (const tier of REFERRAL_TIERS) if (count >= tier.min) t = tier;
  return t;
}

// ─── Колесо бонусов ───
// Доступно при депозите от WHEEL_WEEK_TON TON за последние 7 дней.
// Один спин раз в 24 часа (каждый день всю неделю).
// type: tickets (фри-карта) | coins (дублоны) | deposit_bonus (% к деп) | nft (заявка-подарок).
export const WHEEL_COOLDOWN_MS = 24 * 60 * 60 * 1000;
export const WHEEL_WEEK_TON = 5;       // нужно столько TON за неделю для доступа
export const WHEEL_WEEK_MS = 7 * 24 * 60 * 60 * 1000;
export const WHEEL_SEGMENTS = [
  { key: 'dep10',   type: 'deposit_bonus', value: 10, label: '+10% к деп.',  weight: 45 },
  { key: 'dep5',    type: 'deposit_bonus', value: 5,  label: '+5% к деп.',   weight: 45 },
  { key: 'card',    type: 'tickets',       value: 1,  label: 'Фри-карта',    weight: 4 },
  { key: 'coin1',   type: 'coins',         value: 1,  label: '+1 монета',    weight: 2.75 },
  { key: 'coin2',   type: 'coins',         value: 2,  label: '+2 монеты',    weight: 2.75 },
  { key: 'nft',     type: 'nft',           value: 0,  label: 'НФТ 🎁',       weight: 0.5 }
];

// ─── Tournaments ───
// Цикл 3 дня. После окончания призы выплачиваются топу.
export const TOURNAMENT_CYCLE_MS = 3 * 24 * 60 * 60 * 1000;
export const TOURNAMENT_PRIZES = [
  { place: 1, kind: 'ton',  amount: 5,  label: '5 TON' },
  { place: 2, kind: 'ton',  amount: 2,  label: '2 TON' },
  { place: 3, kind: 'coins', amount: 500, label: '500 монет' }
];
