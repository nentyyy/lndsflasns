const seed = {
  meta: {
    appName: 'DEADWILL',
    seasonName: 'Season IX: Closed Inheritance',
    seasonEndsIn: '12d 08h',
    supportHandle: '@deadwill_support',
    portalsProvider: 'Portals App'
  },
  player: {
    id: '',
    name: '',
    username: null,
    coins: 0,
    multiplier: 1,
    role: 'player',
    gamesPlayed: 0,
    coinsWon: 0,
    coinsSpent: 0,
    bestWin: 0,
    welcomeAvailable: true,
    refCode: '',
    refPending: 0,
    firstDepositDone: false,
    pvpTotalReveals: 0,
    tickets: { cheap: 0, premium: 0 }
  },
  dailyBonus: {
    coins: 1200,
    claimable: true,
    streak: 6
  },
  liveWins: [
    { id: 'lw-1', name: 'Vanta', will: 'Premium', amount: '+2 300', avatar: 'V' },
    { id: 'lw-2', name: 'Noct', will: 'Cheap', amount: '+155', avatar: 'N' },
    { id: 'lw-3', name: 'SIVA', will: 'Premium', amount: 'x2 seal', avatar: 'S' },
    { id: 'lw-4', name: 'Kron', will: 'Cheap', amount: '+110', avatar: 'K' }
  ],
  wills: [
    {
      id: 'premium',
      title: 'Премиум завещание',
      subtitle: 'Высокий вход · Сильнее риск',
      entryCoins: 150,
      accent: 'gold',
      spotlight: 'sealed-obsidian',
      categories: ['Крупные дублоны', 'Golden bonus', 'x2', 'Пусто', 'Проклятый долг'],
      // RTP = (1200+2500+1520+0+0+0) / 6 / 1000 = 5220/6000 = 87%
      outcomes: [
        { type: 'coins',      title: 'Крупный выигрыш',      creditCoins: 1200, stamp: '+1 200', tone: 'gold',   note: 'Дублоны уже зачислены на баланс.' },
        { type: 'coins',      title: 'Очень крупный выигрыш', creditCoins: 2500, stamp: '+2 500', tone: 'gold',   note: 'Редкий sealed payout активирован.' },
        { type: 'bonus',      title: 'Golden bonus',          creditCoins: 1520, stamp: 'Bonus',  tone: 'gold',   note: 'Выдан бонус и shard на NFT скидку.' },
        { type: 'multiplier', title: 'Множитель x2',          creditCoins: 0,    nextMultiplier: 2, stamp: 'x2', tone: 'violet', note: 'Следующий выигрыш по дублонам будет умножен.' },
        { type: 'empty',      title: 'Пустой контракт',       creditCoins: 0,    stamp: 'Пусто', tone: 'muted',  note: 'Контракт оказался без награды.' },
        { type: 'debt',       title: 'Проклятый долг',        creditCoins: 0,    stamp: 'Долг',  tone: 'danger', note: 'Ставка сгорела, повторите позже.' }
      ]
    }
  ],
  referral: {
    code: 'DW18126',
    link: 'https://t.me/deadwill_bot?start=DW18126',
    invites: 7,
    activeInvites: 5,
    earned: 14500,
    tier: 'Silver',
    tierNext: 'Gold',
    tierProgress: 71,
    tierNextAt: 10,
    structure: '10% с каждой игры реферала навсегда',
    tiers: [
      { name: 'Bronze', min: 0,  max: 2,  bonus: '5%' },
      { name: 'Silver', min: 3,  max: 9,  bonus: '7%' },
      { name: 'Gold',   min: 10, max: 24, bonus: '10%' },
      { name: 'Legend', min: 25, max: 999, bonus: '15%' }
    ],
    rewards: [
      { level: 1,  reward: '500 дублонов',  state: 'claimed' },
      { level: 3,  reward: '2000 дублонов', state: 'claimed' },
      { level: 5,  reward: '5000 дублонов', state: 'claimable' },
      { level: 10, reward: 'Premium NFT', state: 'locked' },
      { level: 25, reward: 'Legend статус', state: 'locked' }
    ],
    inviteHistory: [
      { id: 'ref-1', name: 'Vanta88',   date: '24 мая', earned: 4200, active: true },
      { id: 'ref-2', name: 'Kryon_X',   date: '20 мая', earned: 3800, active: true },
      { id: 'ref-3', name: 'Shadowix',  date: '18 мая', earned: 2900, active: true },
      { id: 'ref-4', name: 'NightVeil', date: '14 мая', earned: 2100, active: true },
      { id: 'ref-5', name: 'MireAsh',   date: '10 мая', earned: 1500, active: true },
      { id: 'ref-6', name: 'Crypt9',    date: '5 мая',  earned: 0,    active: false },
      { id: 'ref-7', name: 'DuskV',     date: '1 мая',  earned: 0,    active: false }
    ]
  },
  shop: {
    coinPackages: [
      { id: 'cp-1', title: 'Shadow Pack',  amount: 3200,  bonus: '+200',   price: '1 TON',    method: 'TON',   flair: 'vault' },
      { id: 'cp-2', title: 'Notary Pack',  amount: 12800, bonus: '+1 200', price: '4 TON',    method: 'TON',   flair: 'seal'  },
      { id: 'cp-3', title: 'Stars Bundle', amount: 4200,  bonus: '+350',   price: '1000 ⭐', method: 'Stars', flair: 'stars' }
    ],
    premiumOffers: [
      { id: 'pr-1', title: 'Black Seal Pass',  copy: 'Премиальная линия наград и приоритет в transfer.',    price: '1 490 ⭐', active: true  },
      { id: 'pr-2', title: 'Executor Status',  copy: 'Premium badge, vault styling и сезонный frame.',      price: '3 TON',   active: false }
    ],
    nftItems: [
      { id: 'nft-1', title: 'Sigil of Closed Estate',   rarity: 'Epic',      priceCoins: 85000,  stock: 8, status: 'available', short: 'SIGIL'  },
      { id: 'nft-2', title: 'Ledger of Night Claims',   rarity: 'Legendary', priceCoins: 120000, stock: 4, status: 'available', short: 'LEDGER' },
      { id: 'nft-3', title: 'Black Gold Executor Seal', rarity: 'Mythic',    priceCoins: 160000, stock: 2, status: 'limited',   short: 'SEAL'   }
    ]
  },
  transfers: [
    { id: 'TR-204', asset: 'Sigil of Closed Estate', priceCoins: 85000,  date: 'Today, 18:11',    status: 'pending',   comment: 'NFT будет передан через Portals App после проверки.', delay: '6h'  },
    { id: 'TR-198', asset: 'Ledger of Night Claims',  priceCoins: 120000, date: 'Yesterday, 22:48', status: 'approved',  comment: 'Заявка подтверждена и ожидает передачу.',              delay: '2h'  },
    { id: 'TR-166', asset: 'Archive Crest',            priceCoins: 64000,  date: '24 May, 13:07',   status: 'completed', comment: 'NFT успешно отправлен в Portals App.',                  delay: 'done' }
  ],
  clans: {
    joined: true,
    myClan: {
      name: 'Lan$oGift',
      level: 8,
      members: 24,
      contribution: 251600,
      seasonRank: 4,
      description: 'Клан закрытых контрактов и редких сделок.',
      ownerActions: ['Принять заявку', 'Изменить описание', 'Назначить роль']
    },
    roster: [
      { place: 1, name: 'V.',       role: 'Owner',   seasonCoins: 90200, accent: 'gold'    },
      { place: 2, name: 'SIVA',     role: 'Member',  seasonCoins: 24100, accent: 'silver'  },
      { place: 3, name: 'Noct Vale',role: 'Officer', seasonCoins: 19800, accent: 'bronze'  },
      { place: 4, name: 'Ash Mire', role: 'Member',  seasonCoins: 16450, accent: 'default' }
    ],
    chat: [
      { id: 'chat-1', type: 'system', author: 'System', body: 'Игрок Vanta получил +2500 в премиум завещании.' },
      { id: 'chat-2', type: 'user',   author: 'SIVA',   body: 'Добиваем weekly и поднимаем клан в топ-3.' },
      { id: 'chat-3', type: 'user',   author: 'nenty',  body: 'После shop беру еще одно премиум завещание.' }
    ],
    top: [
      { place: 1, name: 'Velvet Notary', members: 31, seasonCoins: '8.4M' },
      { place: 2, name: 'Ink Dominion',  members: 29, seasonCoins: '7.9M' },
      { place: 3, name: 'Lan$oGift',     members: 24, seasonCoins: '7.2M' },
      { place: 4, name: 'Night Sigil',   members: 21, seasonCoins: '6.1M' },
      { place: 5, name: 'Vault Crest',   members: 18, seasonCoins: '5.4M' }
    ]
  },
  pass: {
    owned: true,
    level: 19,
    xpLabel: '7 420 / 10 000 XP',
    endsIn: '12d 08h',
    daily: [
      { id: 'dq-1', title: 'Открыть 3 завещания',  progress: '2 / 3',       xp: 180,  state: 'active'    },
      { id: 'dq-2', title: 'Пополнить баланс',      progress: '0 / 1',       xp: 250,  state: 'active'    },
      { id: 'dq-3', title: 'Заработать 1500 дублонов', progress: '1500 / 1500', xp: 220,  state: 'claimable' }
    ],
    weekly: [
      { id: 'wq-1', title: 'Сыграть 20 раундов',       progress: '13 / 20', xp: 950,  state: 'active'    },
      { id: 'wq-2', title: 'Создать 1 transfer заявку', progress: '1 / 1',   xp: 1100, state: 'claimable' }
    ],
    rewards: [
      { level: 17, free: { title: '800 coins',     state: 'claimed'   }, premium: { title: 'Executor frame', state: 'claimed'   } },
      { level: 18, free: { title: 'Vault ticket',  state: 'claimed'   }, premium: { title: 'NFT discount',   state: 'claimed'   } },
      { level: 19, free: { title: '1 500 coins',   state: 'claimable' }, premium: { title: 'Priority token', state: 'claimable' } },
      { level: 20, free: { title: 'Boost x1',      state: 'locked'    }, premium: { title: 'Premium attempt', state: 'locked'   } },
      { level: 21, free: { title: '2 000 coins',   state: 'locked'    }, premium: { title: 'NFT shard',      state: 'locked'    } }
    ]
  },
  history: [
    { id: 'op-1', type: 'topup',    title: 'TON пополнение',      date: 'Today, 21:14',    amount: 32000,  status: 'completed' },
    { id: 'op-2', type: 'game',     title: 'Премиум завещание',   date: 'Today, 20:58',    amount: 2500,   status: 'completed' },
    { id: 'op-3', type: 'transfer', title: 'Transfer заявка',     date: 'Yesterday, 18:11', amount: -85000, status: 'pending'   },
    { id: 'op-4', type: 'shop',     title: 'Black Seal Pass',     date: 'Yesterday, 11:24', amount: 0,      status: 'active'    }
  ],
  profileSections: [
    { id: 'nfts',      title: 'Мои NFT',           subtitle: 'Коллекция и статусы передачи'       },
    { id: 'transfers', title: 'Transfer Center',    subtitle: 'Все заявки и проверка статусов'     },
    { id: 'pass',      title: 'Battle Pass',        subtitle: 'Сезонные награды и задания'         },
    { id: 'support',   title: 'Поддержка',          subtitle: '@deadwill_support'                  },
    { id: 'rules',     title: 'Правила',             subtitle: 'Экономика, лимиты, anti-fraud'      }
  ],
  notifications: [
    { id: 'nt-1', title: 'Transfer создан',  copy: 'Заявка TR-204 отправлена в очередь Portals.', when: '5m ago'  },
    { id: 'nt-2', title: 'Клан поднялся',    copy: 'Lan$oGift закрепился на #4 в сезонном рейтинге.', when: '22m ago' },
    { id: 'nt-3', title: 'Уровень pass',     copy: 'Доступны награды 19 уровня.',                 when: '1h ago'  }
  ]
};

export const createInitialState = () => JSON.parse(JSON.stringify(seed));

// Целые — без хвоста, дробные дублоны — до 2 знаков (для Lucky Buy / копеек).
export const formatCoins = (value) => {
  const n = Number(value) || 0;
  return Number.isInteger(n)
    ? new Intl.NumberFormat('ru-RU').format(n)
    : new Intl.NumberFormat('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);
};

export const formatCompact = (value) =>
  new Intl.NumberFormat('ru-RU', { notation: 'compact', maximumFractionDigits: 1 }).format(value);

export const XP_PER_ROUND = { cheap: 45, premium: 120 };

export const XP_PER_LEVEL = 10000;

export function parseRewardCredit(title) {
  const match = title.match(/([\d\s]+)\s*coins?/i);
  if (!match) return 0;
  return parseInt(match[1].replace(/\s/g, ''), 10);
}

export const transferTone = {
  pending:   'warning',
  approved:  'violet',
  completed: 'success',
  rejected:  'danger'
};

export const historyFilters = [
  { id: 'all',      label: 'Все'         },
  { id: 'game',     label: 'Игры'        },
  { id: 'shop',     label: 'Магазин'     },
  { id: 'topup',    label: 'Пополнения'  },
  { id: 'transfer', label: 'Transfer'    }
];

export function resolveWillOutcome(mode, clauseIndex, roundIndex, multiplier = 1) {
  const outcomeIndex = (clauseIndex + roundIndex * 2 + (mode.id === 'premium' ? 1 : 0)) % mode.outcomes.length;
  const base = mode.outcomes[outcomeIndex];
  const resolved = { ...base, usedMultiplier: multiplier > 1 && (base.type === 'coins' || base.type === 'bonus') };

  if (resolved.usedMultiplier) {
    resolved.creditCoins = Math.round(resolved.creditCoins * multiplier);
    resolved.title = `${resolved.title} x${multiplier}`;
    resolved.note = 'Множитель применен. Дублоны уже зачислены на баланс.';
  }

  return resolved;
}
