import cors from 'cors';
import express from 'express';
import { randomUUID } from 'node:crypto';
import { env, MODES, STARS_PACKS, TON_PACKS, TICKET_PACKS } from './lib/config.js';
import { db } from './lib/db.js';
import { migrate } from './lib/migrate.js';
import { authMiddleware, rateLimit, requireAdmin, requireOwner } from './lib/security.js';
import { credit as walletCredit, debit as walletDebit, AmountError } from './lib/wallet.js';
import { getGiftFromCache } from './lib/portals.js';
import { validate, armSchema, revealSchema, depositSchema, pvpBuySchema } from './lib/validators.js';
import { armRound, revealRound, GameError } from './lib/game.js';
import { InsufficientFunds } from './lib/wallet.js';
import { createStarsDeposit, createStarsDepositCustom } from './lib/payments/stars.js';
import { createTonDeposit, createTonDepositCustom, createSendDeposit, startTonPoller } from './lib/payments/ton.js';
import { createCryptobotDeposit } from './lib/payments/cryptobot.js';
import { getReferralView, bindReferrer, makeRefCode, claimReferralPending } from './lib/referral.js';
import { getTournamentView, ensureActiveTournament } from './lib/tournaments.js';
import { getPvpState, buyCard, buyRandomCards, PvpError, getLiveFeed, sweepExpiredLobbies } from './lib/pvp.js';
import { getWheelState, spinWheel, WheelError } from './lib/wheel.js';
import { listArtifacts, buyArtifact, listInventory, useArtifact, getPointsShop, spendPointsShop, ArtifactError } from './lib/artifacts.js';
import { getPoints } from './lib/points.js';
import { playLuckyBuy, getLuckyFeed, luckyBet, luckyMultiplier, LuckyError } from './lib/lucky-buy.js';
import { buyTicketPack, buyTicketsCustom, TicketError } from './lib/tickets.js';
import { getLeaderboard, getPersonalStats } from './lib/leaderboard.js';
import { notifyAdminsPurchase } from './lib/admin-notify.js';
import { listRounds, getRoundDetail } from './lib/rounds.js';

const app = express();
app.use(cors({
  origin: true,
  credentials: true,
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: [
    'Content-Type', 'Authorization',
    'X-Bot-Token', 'X-Telegram-Init-Data', 'X-Ref-Code'
  ]
}));
app.options('*', cors());

// ─── Security headers (defense-in-depth; фронт-HTML заголовки ставит nginx) ───
app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY'); // API нельзя встраивать в iframe
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-site');
  res.removeHeader('X-Powered-By');
  next();
});

app.use(express.json());

const publicModes = Object.values(MODES).map((m) => ({ id: m.id, entryCoins: m.entryCoins, title: m.title }));

// ─── Public ───
app.get('/api/health', (_req, res) => {
  // Минимум информации — никакого раскрытия движка БД/стека (CWE-200).
  res.json({ ok: true });
});

// Аватарка через бот (проксируем файл из Telegram).
// PUBLIC by necessity: browser <img src> не может слать auth-заголовки.
// Это opaque-прокси по Telegram file_id — без доступа к балансу/данным игрока.
app.get('/api/avatar/:fileId', async (req, res) => {
  try {
    if (!env.BOT_TOKEN) return res.status(404).send('no bot');
    const fileId = String(req.params.fileId);
    // file_id состоит только из base64url-символов — отсекаем мусор/инъекции.
    if (!/^[A-Za-z0-9_-]{20,200}$/.test(fileId)) return res.status(400).send('bad id');
    const fileRes = await fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/getFile?file_id=${encodeURIComponent(fileId)}`);
    const fileData = await fileRes.json();
    if (!fileData.ok) return res.status(404).send('not found');
    const filePath = fileData.result.file_path;
    const imgRes = await fetch(`https://api.telegram.org/file/bot${env.BOT_TOKEN}/${filePath}`);
    const buf = Buffer.from(await imgRes.arrayBuffer()); // fetch().body — web-stream, .pipe нет
    // Telegram отдаёт octet-stream; с nosniff браузер не отрендерит <img>.
    // Принудительно ставим image-тип по расширению file_path.
    const ct = /\.png$/i.test(filePath) ? 'image/png' : /\.webp$/i.test(filePath) ? 'image/webp' : 'image/jpeg';
    res.setHeader('Content-Type', ct);
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.end(buf);
  } catch (e) { res.status(500).send('error'); }
});

// ─── Auth required for ALL /api/* below (only /api/health and /api/avatar are public) ───
// Validates Telegram WebApp initData (HMAC-SHA256 + BOT_TOKEN, ≤24h) or a DB-backed
// bot token. Anything else → 401. See src/api/lib/security.js.
app.use('/api', authMiddleware());

// Live feed — requires auth (за middleware выше).
app.get('/api/feed', async (_req, res, next) => {
  try {
    const feed = await getLiveFeed(20);
    res.json({ feed });
  } catch (e) { next(e); }
});

function playerView(p) {
  return {
    id: String(p.user_id),
    name: [p.first_name, p.last_name].filter(Boolean).join(' ') || p.username || `Player #${String(p.user_id).slice(-4)}`,
    username: p.username || null,
    firstName: p.first_name || null,
    lastName: p.last_name || null,
    avatarUrl: p.avatar_file_id ? `/api/avatar/${p.avatar_file_id}` : null,
    coins: Number(p.balance),
    multiplier: Number(p.multiplier),
    gamesPlayed: Number(p.games_played),
    coinsWon: Number(p.coins_won),
    coinsSpent: Number(p.coins_spent),
    bestWin: Number(p.best_win),
    role: p.role,
    welcomeAvailable: !p.welcome_used,
    refCode: p.ref_code || makeRefCode(p.user_id),
    refPending: Number(p.ref_pending || 0),
    firstDepositDone: Boolean(p.first_deposit_done),
    wheelDepositBonusPct: Number(p.wheel_deposit_bonus_pct || 0),
    pvpTotalReveals: Number(p.pvp_total_reveals || 0),
    clanTag: p._clanTag || null,
    tickets: {
      cheap: Number(p.cheap_tickets || 0),
      premium: Number(p.premium_tickets || 0)
    }
  };
}

async function recentHistory(userId, limit = 25) {
  const rows = await db('ledger').where({ user_id: userId }).orderBy('id', 'desc').limit(limit);
  return rows.map((r) => ({
    id: String(r.id),
    type: r.ref_type,
    amount: Number(r.amount),
    balanceAfter: Number(r.balance_after),
    date: r.created_at
  }));
}

async function withClanTag(player) {
  try {
    const member = await db('clan_members').where({ user_id: String(player.user_id) }).first();
    if (!member) return player;
    const clan = await db('clans').where({ id: member.clan_id }).first('tag');
    return { ...player, _clanTag: clan?.tag || null };
  } catch { return player; }
}

app.get('/api/me', async (req, res) => {
  const p = await withClanTag(req.player);
  res.json({ player: playerView(p) });
});

// Топ игроков (кэш 5 мин на бэке): all-time + сегодня.
app.get('/api/leaderboard', async (_req, res, next) => {
  try {
    res.json(await getLeaderboard());
  } catch (e) { next(e); }
});

// История PvP-раундов (список) + детали по конкретному раунду.
app.get('/api/rounds', async (req, res, next) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 20, 50);
    const offset = Math.max(Number(req.query.offset) || 0, 0);
    const sort = ['best', 'mine'].includes(req.query.sort) ? req.query.sort : 'all';
    res.json(await listRounds({ limit, offset, sort, mineUserId: req.user.id }));
  } catch (e) { next(e); }
});

app.get('/api/rounds/:id', async (req, res, next) => {
  try {
    const d = await getRoundDetail(req.params.id);
    if (!d) return res.status(404).json({ error: 'not_found' });
    res.json(d);
  } catch (e) { next(e); }
});

// Личная статистика текущего игрока.
app.get('/api/stats', async (req, res, next) => {
  try {
    const stats = await getPersonalStats(req.user.id);
    if (!stats) return res.status(404).json({ error: 'not_found' });
    res.json(stats);
  } catch (e) { next(e); }
});

app.get('/api/bootstrap', async (req, res, next) => {
  try {
    const refCode = req.query.ref || req.get('x-ref-code');
    if (refCode) await bindReferrer(req.user.id, refCode);

    const [referral, tournament] = await Promise.all([
      getReferralView(req.user.id),
      getTournamentView(req.user.id)
    ]);

    const liveWins = await getLiveFeed(10).catch(() => []);
    const portalsGifts = await db('portals_cache').select('*').catch(() => []);

    res.json({
      player: playerView(req.player),
      modes: publicModes,
      starsPacks: STARS_PACKS,
      tonPacks: TON_PACKS,
      ticketPacks: TICKET_PACKS,
      projectTonWallet: env.PROJECT_TON_WALLET || null,
      history: await recentHistory(req.user.id),
      referral,
      tournament,
      liveWins,
      portalsGifts
    });
  } catch (e) {
    next(e);
  }
});

app.get('/api/referral', async (req, res, next) => {
  try {
    const data = await getReferralView(req.user.id);
    res.json(data);
  } catch (e) { next(e); }
});

app.get('/api/referral/link', async (req, res, next) => {
  try {
    const d = await getReferralView(req.user.id);
    res.json({ link: d.link, referralCount: d.referralCount, coinsEarned: d.coinsEarned });
  } catch (e) { next(e); }
});

app.post('/api/referral/bind', async (req, res, next) => {
  try {
    const code = (req.body && req.body.code) || '';
    const bound = await bindReferrer(req.user.id, code);
    res.json({ ok: Boolean(bound), referrerId: bound });
  } catch (e) { next(e); }
});

// Забрать реферальные монеты
app.post('/api/referral/claim',
  rateLimit({ bucket: 'ref_claim', max: 10, windowMs: 60_000 }),
  async (req, res, next) => {
    try {
      const result = await claimReferralPending(req.user.id);
      const player = await db('players').where({ user_id: req.user.id }).first();
      res.json({ ...result, player: playerView(player) });
    } catch (e) { next(e); }
  }
);

app.post('/api/tickets/buy',
  rateLimit({ bucket: 'tickets_buy', max: 30, windowMs: 60_000 }),
  async (req, res, next) => {
    try {
      const type = String(req.body?.type || '');
      const packId = String(req.body?.packId || '');
      const out = await buyTicketPack(req.user.id, type, packId);
      const player = await db('players').where({ user_id: req.user.id }).first();
      res.json({ ...out, player: playerView(player) });
    } catch (e) {
      if (e instanceof TicketError) return res.status(e.status).json({ error: e.message });
      if (e instanceof InsufficientFunds) return res.status(400).json({ error: 'insufficient_balance' });
      next(e);
    }
  }
);

// Покупка карт по введённому числу (без наборов), оплата монетами.
app.post('/api/tickets/buy-custom',
  rateLimit({ bucket: 'tickets_buy', max: 30, windowMs: 60_000 }),
  async (req, res, next) => {
    try {
      const type = String(req.body?.type || '');
      const count = Number(req.body?.count);
      const out = await buyTicketsCustom(req.user.id, type, count);
      const player = await db('players').where({ user_id: req.user.id }).first();
      res.json({ ...out, player: playerView(player) });
    } catch (e) {
      if (e instanceof TicketError) return res.status(e.status).json({ error: e.message });
      if (e instanceof InsufficientFunds) return res.status(400).json({ error: 'insufficient_balance' });
      next(e);
    }
  }
);

app.get('/api/pvp/state',
  rateLimit({ bucket: 'pvp_state', max: 120, windowMs: 60_000 }),
  async (req, res, next) => {
    try {
      const mode = String(req.query.mode || 'cheap');
      const data = await getPvpState(req.user.id, mode);
      res.json(data);
    } catch (e) {
      if (e instanceof PvpError) return res.status(e.status).json({ error: e.message });
      next(e);
    }
  }
);

// SECURITY: pvpBuySchema allows only mode, cardIndex, idempotencyKey
app.post('/api/pvp/buy',
  rateLimit({ bucket: 'pvp_buy', max: 60, windowMs: 60_000 }),
  validate(pvpBuySchema),
  async (req, res, next) => {
    try {
      const out = await buyCard(req.user.id, req.valid.mode, req.valid.cardIndex, req.valid.idempotencyKey);
      const state = await getPvpState(req.user.id, req.valid.mode);
      res.json({ ...out, ...state });
    } catch (e) {
      if (e instanceof PvpError) return res.status(e.status).json({ error: e.message });
      if (e instanceof InsufficientFunds) return res.status(400).json({ error: 'insufficient_balance' });
      next(e);
    }
  }
);

// Купить N случайных ячеек (рандомная расстановка).
app.post('/api/pvp/buy-random',
  rateLimit({ bucket: 'pvp_buy', max: 40, windowMs: 60_000 }),
  async (req, res, next) => {
    try {
      const mode = typeof req.body?.mode === 'string' ? req.body.mode : 'cheap';
      const count = Math.max(1, Math.min(36, parseInt(req.body?.count, 10) || 1));
      const idem = typeof req.body?.idempotencyKey === 'string' ? req.body.idempotencyKey.slice(0, 64) : undefined;
      const out = await buyRandomCards(req.user.id, mode, count, idem);
      const state = await getPvpState(req.user.id, mode);
      res.json({ ...out, ...state });
    } catch (e) {
      if (e instanceof PvpError) return res.status(e.status).json({ error: e.message });
      if (e instanceof InsufficientFunds) return res.status(400).json({ error: 'insufficient_balance' });
      next(e);
    }
  }
);

// ─── Колесо бонусов ───
app.get('/api/wheel', async (req, res, next) => {
  try { res.json(await getWheelState(req.user.id)); } catch (e) { next(e); }
});
app.post('/api/wheel/spin',
  rateLimit({ bucket: 'wheel_spin', max: 10, windowMs: 60_000 }),
  async (req, res, next) => {
    try {
      res.json(await spinWheel(req.user.id));
    } catch (e) {
      if (e instanceof WheelError) return res.status(e.status).json({ error: e.message });
      next(e);
    }
  }
);

// ─── Лавка торговца (артефакты) ───
app.get('/api/shop/artifacts', async (req, res, next) => {
  try { res.json({ artifacts: await listArtifacts() }); } catch (e) { next(e); }
});
app.post('/api/shop/artifacts/buy',
  rateLimit({ bucket: 'art_buy', max: 30, windowMs: 60_000 }),
  async (req, res, next) => {
    try {
      const out = await buyArtifact(req.user.id, String(req.body?.artifactId || ''));
      const player = await db('players').where({ user_id: req.user.id }).first();
      res.json({ ...out, player: playerView(player) });
    } catch (e) {
      if (e instanceof ArtifactError) return res.status(e.status).json({ error: e.message });
      if (e instanceof InsufficientFunds) return res.status(400).json({ error: 'insufficient_balance' });
      next(e);
    }
  }
);
app.get('/api/player/artifacts', async (req, res, next) => {
  try { res.json({ artifacts: await listInventory(req.user.id) }); } catch (e) { next(e); }
});
app.post('/api/player/artifacts/use',
  rateLimit({ bucket: 'art_use', max: 60, windowMs: 60_000 }),
  async (req, res, next) => {
    try {
      const cells = Array.isArray(req.body?.targetCells) ? req.body.targetCells.map(Number).filter(Number.isInteger) : [];
      const out = await useArtifact(req.user.id, String(req.body?.artifactId || ''), cells);
      res.json(out);
    } catch (e) {
      if (e instanceof ArtifactError) return res.status(e.status).json({ error: e.message });
      next(e);
    }
  }
);

// ─── Поинты лояльности + магазин поинтов ───
app.get('/api/shop/points', async (req, res, next) => {
  try { res.json(await getPointsShop(req.user.id)); } catch (e) { next(e); }
});
app.post('/api/shop/points/spend',
  rateLimit({ bucket: 'pts_spend', max: 20, windowMs: 60_000 }),
  async (req, res, next) => {
    try {
      const out = await spendPointsShop(req.user.id, String(req.body?.itemId || ''), req.body?.targetId ? String(req.body.targetId) : null);
      const points = await getPoints(req.user.id);
      res.json({ ...out, points: points.points });
    } catch (e) {
      console.error('[points/spend]', req.user?.id, req.body, e.message);
      if (e instanceof ArtifactError) return res.status(e.status).json({ error: e.message });
      if (e.message === 'not_enough_points') return res.status(400).json({ error: 'not_enough_points' });
      next(e);
    }
  }
);

// ─── Lucky Buy (ставка в дублонах) ───
app.post('/api/lucky-buy',
  rateLimit({ bucket: 'lucky', max: 30, windowMs: 60_000 }),
  async (req, res, next) => {
    try {
      const out = await playLuckyBuy(req.user.id, String(req.body?.giftId || ''), req.body?.chancePercent);
      res.json(out);
    } catch (e) {
      console.error('[lucky-buy]', req.user?.id, req.body, e.message);
      if (e instanceof LuckyError) return res.status(e.status).json({ error: e.message });
      if (e instanceof InsufficientFunds) return res.status(400).json({ error: 'insufficient_balance' });
      next(e);
    }
  }
);
app.get('/api/lucky-buy/feed', async (req, res, next) => {
  try { res.json({ feed: await getLuckyFeed(10) }); } catch (e) { next(e); }
});

app.get('/api/tournament', async (req, res, next) => {
  try {
    await ensureActiveTournament();
    const data = await getTournamentView(req.user.id);
    res.json(data);
  } catch (e) { next(e); }
});

// ─── Solo Game ───
app.post('/api/rounds/arm',
  rateLimit({ bucket: 'arm', max: 30, windowMs: 60_000 }),
  validate(armSchema),
  async (req, res, next) => {
    try {
      const out = await armRound(req.user.id, req.valid.modeId, req.valid.clientSeed, req.valid.idempotencyKey);
      res.json(out);
    } catch (e) {
      if (e instanceof InsufficientFunds) return res.status(400).json({ error: 'insufficient_balance' });
      if (e instanceof GameError) return res.status(e.status).json({ error: e.message });
      next(e);
    }
  }
);

app.post('/api/rounds/reveal',
  rateLimit({ bucket: 'reveal', max: 30, windowMs: 60_000 }),
  validate(revealSchema),
  async (req, res, next) => {
    try {
      const out = await revealRound(req.user.id, req.valid.roundId, req.valid.clauseIndex);
      res.json(out);
    } catch (e) {
      if (e instanceof GameError) return res.status(e.status).json({ error: e.message });
      next(e);
    }
  }
);

// ─── Deposits ───
// Динамический Stars-депозит: { coins } (>=1), цена считается на сервере.
app.post('/api/deposits/stars',
  rateLimit({ bucket: 'deposit', max: 20, windowMs: 60_000 }),
  async (req, res, next) => {
    try {
      const coins = Number(req.body?.coins);
      if (!Number.isInteger(coins) || coins < 1) return res.status(400).json({ error: 'min_1_coin' });
      const out = await createStarsDepositCustom(req.user.id, coins);
      res.json({ method: 'stars', ...out });
    } catch (e) {
      if (/limit|min/.test(e.message)) return res.status(400).json({ error: e.message });
      next(e);
    }
  }
);

// Динамический TON-депозит: { coins } (>=1), через TonConnect.
app.post('/api/deposits/ton',
  rateLimit({ bucket: 'deposit', max: 20, windowMs: 60_000 }),
  async (req, res, next) => {
    try {
      const coins = Number(req.body?.coins);
      if (!Number.isInteger(coins) || coins < 1) return res.status(400).json({ error: 'min_1_coin' });
      const out = await createTonDepositCustom(req.user.id, coins);
      res.json({ method: 'ton', ...out });
    } catch (e) {
      if (e.userMessage) return res.status(400).json({ error: e.message, detail: e.userMessage });
      next(e);
    }
  }
);

app.post('/api/deposits',
  rateLimit({ bucket: 'deposit', max: 20, windowMs: 60_000 }),
  validate(depositSchema),
  async (req, res, next) => {
    try {
      if (req.valid.method === 'stars') {
        const out = await createStarsDeposit(req.user.id, req.valid.packId);
        return res.json({ method: 'stars', ...out });
      }
      if (req.valid.method === 'cryptobot') {
        const out = await createCryptobotDeposit(req.user.id, req.valid.packId);
        return res.json({ method: 'cryptobot', ...out });
      }
      const out = await createTonDeposit(req.user.id, req.valid.packId);
      res.json({ method: 'ton', ...out });
    } catch (e) {
      next(e);
    }
  }
);

// @send-депозит произвольной суммой: 6-значный memo + таймер 30 мин.
app.post('/api/deposits/create',
  rateLimit({ bucket: 'deposit_send', max: 20, windowMs: 60_000 }),
  async (req, res, next) => {
    try {
      const amountTon = Number(req.body?.amountTon);
      const out = await createSendDeposit(req.user.id, amountTon);
      res.json({ method: 'ton', ...out });
    } catch (e) {
      if (e.userMessage) return res.status(400).json({ error: e.message, detail: e.userMessage });
      next(e);
    }
  }
);

app.get('/api/deposits/:id', async (req, res, next) => {
  try {
    const d = await db('deposits').where({ id: req.params.id, user_id: req.user.id }).first();
    if (!d) return res.status(404).json({ error: 'not_found' });
    // Просрочен, но ещё pending в БД → отдаём expired (sweeper догонит запись).
    let status = d.status;
    if (status === 'pending' && d.expires_at && new Date(d.expires_at).getTime() < Date.now()) {
      status = 'expired';
    }
    if (status === 'paid') status = 'confirmed'; // единый словарь статусов для UI
    res.json({
      id: d.id,
      method: d.method,
      status, // pending | confirmed | expired | failed
      coins: Number(d.coins) + Number(d.bonus),
      amountTon: Number(d.expected_amount) / 1e9,
      memo: d.ton_comment,
      wallet: env.PROJECT_TON_WALLET,
      expiresAt: d.expires_at,
      paidAt: d.paid_at
    });
  } catch (e) { next(e); }
});

app.get('/api/history', async (req, res, next) => {
  try {
    res.json({ items: await recentHistory(req.user.id) });
  } catch (e) { next(e); }
});

// ─── Player profile (public, but auth required) ───
app.get('/api/players/:userId', async (req, res, next) => {
  try {
    const p = await db('players').where({ user_id: req.params.userId }).first();
    if (!p) return res.status(404).json({ error: 'not_found' });
    const history = await db('ledger')
      .where({ user_id: p.user_id })
      .whereIn('ref_type', ['pvp_payout', 'payout', 'pvp_bet', 'bet'])
      .orderBy('id', 'desc')
      .limit(20);
    res.json({
      id: String(p.user_id),
      name: [p.first_name, p.last_name].filter(Boolean).join(' ') || p.username || `Player #${String(p.user_id).slice(-4)}`,
      username: p.username || null,
      avatarUrl: p.avatar_file_id ? `/api/avatar/${p.avatar_file_id}` : null,
      gamesPlayed: Number(p.games_played),
      coinsWon: Number(p.coins_won),
      bestWin: Number(p.best_win),
      history: history.map((r) => ({
        type: r.ref_type,
        amount: Number(r.amount),
        date: r.created_at
      }))
    });
  } catch (e) { next(e); }
});

// ─── Admin ───
// requireAdmin / requireOwner imported from security.js — read role strictly from DB.

// Audit log for every admin/owner action (who, when, what, before/after).
async function adminLog(req, action, target, meta = {}) {
  try {
    const entry = {
      ts: new Date().toISOString(),
      actor: String(req.user?.id),
      actorRole: req.player?.role,
      action,
      target: String(target ?? ''),
      meta
    };
    console.warn('[ADMIN_AUDIT]', JSON.stringify(entry));
    await db('admin_log').insert({
      actor_id: entry.actor,
      action: entry.action,
      target: entry.target,
      meta: JSON.stringify(meta),
      created_at: entry.ts
    }).catch(() => {}); // table optional; console log is the backstop
  } catch {}
}

app.get('/api/admin/users', requireAdmin, async (req, res, next) => {
  try {
    const limit = Math.min(Number(req.query.limit || 50), 200);
    const offset = Number(req.query.offset || 0);
    const users = await db('players').orderBy('created_at', 'desc').limit(limit).offset(offset);
    const total = await db('players').count('* as n').first();
    res.json({ users: users.map(playerView), total: Number(total.n) });
  } catch (e) { next(e); }
});

app.get('/api/admin/deposits', requireAdmin, async (req, res, next) => {
  try {
    const limit = Math.min(Number(req.query.limit || 50), 200);
    const offset = Number(req.query.offset || 0);
    const deposits = await db('deposits').orderBy('created_at', 'desc').limit(limit).offset(offset);
    const total = await db('deposits').count('* as n').first();
    res.json({ deposits, total: Number(total.n) });
  } catch (e) { next(e); }
});

app.get('/api/admin/rounds', requireAdmin, async (req, res, next) => {
  try {
    const limit = Math.min(Number(req.query.limit || 50), 200);
    const offset = Number(req.query.offset || 0);
    const rounds = await db('rounds').orderBy('created_at', 'desc').limit(limit).offset(offset);
    const total = await db('rounds').count('* as n').first();
    res.json({ rounds, total: Number(total.n) });
  } catch (e) { next(e); }
});

app.get('/api/admin/live-rounds', requireAdmin, async (req, res, next) => {
  try {
    const lobbies = await db('pvp_lobbies').orderBy('created_at', 'desc').limit(20);
    const result = [];
    for (const lobby of lobbies) {
      const cards = await db('pvp_cards').where({ lobby_id: lobby.id }).count('* as total').first();
      const taken = await db('pvp_cards').where({ lobby_id: lobby.id }).whereNot({ status: 'free' }).count('* as n').first();
      result.push({
        ...lobby,
        entry_coins: Number(lobby.entry_coins),
        total_cards: Number(cards.total),
        taken_cards: Number(taken.n)
      });
    }
    res.json({ lobbies: result });
  } catch (e) { next(e); }
});

app.get('/api/admin/referrals', requireAdmin, async (req, res, next) => {
  try {
    const payouts = await db('ref_payouts').orderBy('id', 'desc').limit(100);
    const stats = await db('players')
      .where('ref_earned', '>', 0)
      .orderBy('ref_earned', 'desc')
      .limit(50)
      .select('user_id', 'first_name', 'username', 'ref_earned', 'ref_pending');
    res.json({ payouts, topReferrers: stats });
  } catch (e) { next(e); }
});

app.get('/api/admin/ledger', requireAdmin, async (req, res, next) => {
  try {
    const limit = Math.min(Number(req.query.limit || 100), 500);
    const offset = Number(req.query.offset || 0);
    const rows = await db('ledger').orderBy('id', 'desc').limit(limit).offset(offset);
    const total = await db('ledger').count('* as n').first();
    res.json({ rows, total: Number(total.n) });
  } catch (e) { next(e); }
});

app.get('/api/admin/portals', requireAdmin, async (req, res, next) => {
  try {
    const purchases = await db('portals_purchases').orderBy('created_at', 'desc').limit(100);
    const cache = await db('portals_cache').orderBy('updated_at', 'desc');
    res.json({ purchases, cache });
  } catch (e) { next(e); }
});

// Ручное добавление/обновление подарка в кеш (для admin)
app.post('/api/admin/portals-cache', requireAdmin, async (req, res, next) => {
  try {
    const { id, name, file, rarity, priceTon, stock } = req.body;
    if (!id || !name || !priceTon) return res.status(400).json({ error: 'id, name, priceTon required' });
    const priceCoins = Math.ceil(Number(priceTon) / 0.1);
    await db('portals_cache').insert({
      id, name,
      file: file || `${id}.webp`,
      rarity: rarity || 'Common',
      priceCoins, priceTon: Number(priceTon),
      stock: stock !== undefined ? Number(stock) : 999,
      available: 1,
      updated_at: new Date().toISOString()
    }).onConflict('id').merge();
    const all = await db('portals_cache').orderBy('priceCoins');
    res.json({ ok: true, cache: all });
  } catch (e) { next(e); }
});

app.get('/api/admin/economy', requireAdmin, async (req, res, next) => {
  try {
    const [totalDeposited, totalPaidOut, totalPlayers, totalRounds] = await Promise.all([
      db('ledger').where('ref_type', 'like', 'deposit%').where('amount', '>', 0).sum('amount as s').first(),
      db('ledger').where('ref_type', 'like', '%payout').where('amount', '>', 0).sum('amount as s').first(),
      db('players').count('* as n').first(),
      db('rounds').count('* as n').first()
    ]);
    res.json({
      totalDeposited: Number(totalDeposited.s || 0),
      totalPaidOut: Number(totalPaidOut.s || 0),
      totalPlayers: Number(totalPlayers.n),
      totalRounds: Number(totalRounds.n),
      houseEdge: totalDeposited.s > 0
        ? ((1 - Number(totalPaidOut.s || 0) / Number(totalDeposited.s)) * 100).toFixed(2) + '%'
        : 'n/a'
    });
  } catch (e) { next(e); }
});

// Изменить баланс пользователя — ТОЛЬКО owner.
const MAX_ADJUST = 1_000_000;        // верхний предел одной операции
const ALERT_THRESHOLD = 10_000;      // алерт при крупном начислении
app.post('/api/admin/users/:userId/adjust', requireOwner, async (req, res, next) => {
  try {
    const reason = String(req.body?.reason || '').slice(0, 200);
    const amt = Number(req.body?.amount);
    if (!reason) return res.status(400).json({ error: 'reason_required' });
    if (!Number.isInteger(amt) || amt === 0) return res.status(400).json({ error: 'amount_must_be_nonzero_integer' });
    if (Math.abs(amt) > MAX_ADJUST) return res.status(400).json({ error: 'amount_out_of_bounds' });

    const target = await db('players').where({ user_id: req.params.userId }).first();
    if (!target) return res.status(404).json({ error: 'not_found' });
    const before = Number(target.balance);

    await db.transaction(async (trx) => {
      if (amt > 0) await walletCredit(trx, req.params.userId, amt, 'admin_adjust', `admin:${randomUUID()}`);
      else await walletDebit(trx, req.params.userId, Math.abs(amt), 'admin_adjust', `admin:${randomUUID()}`);
    });

    const player = await db('players').where({ user_id: req.params.userId }).first();
    const after = Number(player.balance);
    await adminLog(req, 'balance_adjust', req.params.userId, { amount: amt, reason, before, after });
    if (amt >= ALERT_THRESHOLD) {
      console.warn('[ALERT] large balance grant', JSON.stringify({ actor: req.user.id, target: req.params.userId, amount: amt, before, after }));
    }
    res.json({ ok: true, player: playerView(player) });
  } catch (e) {
    if (e instanceof InsufficientFunds) return res.status(400).json({ error: 'insufficient_balance' });
    next(e);
  }
});

// Каталог подарков — id, name, priceCoins, priceTON. Источник цен — БД.
app.get('/api/gifts', async (_req, res, next) => {
  try {
    const rows = await db('portals_cache').where({ available: true }).orderBy('priceCoins');
    res.json({
      gifts: rows.map((g) => ({
        id: g.id,
        name: g.name,
        priceCoins: Number(g.priceCoins),
        priceTON: Number(g.priceTon),
        rarity: g.rarity,
        stock: Number(g.stock)
      }))
    });
  } catch (e) { next(e); }
});

// Portals purchase — цена и название берутся ТОЛЬКО из server-side каталога.
// Клиент присылает лишь giftId + idempotencyKey. priceCoins/giftName из body игнорируются.
app.post('/api/portals/buy',
  rateLimit({ bucket: 'portals_buy', max: 10, windowMs: 60_000 }),
  async (req, res, next) => {
    try {
      const giftId = String(req.body?.giftId || '');
      const idemKey = String(req.body?.idempotencyKey || '').slice(0, 64);
      if (!giftId) return res.status(400).json({ error: 'giftId_required' });
      if (!idemKey || idemKey.length < 8) return res.status(400).json({ error: 'idempotencyKey_required' });

      // Цена — из каталога (whitelist). Несуществующий подарок → 404.
      const gift = await getGiftFromCache(giftId);
      if (!gift) return res.status(404).json({ error: 'gift_not_found' });
      if (gift.available === 0) return res.status(409).json({ error: 'gift_unavailable' });

      const price = Number(gift.priceCoins);
      if (!Number.isInteger(price) || price <= 0 || price > Number.MAX_SAFE_INTEGER) {
        return res.status(409).json({ error: 'invalid_catalog_price' });
      }

      // Идемпотентность: повтор того же ключа возвращает оригинал, без двойного списания.
      const dup = await db('portals_purchases').where({ idempotency_key: idemKey }).first();
      if (dup) {
        const player = await db('players').where({ user_id: req.user.id }).first();
        return res.json({ purchaseId: dup.id, status: dup.status, replayed: true, player: playerView(player) });
      }

      const purchaseId = randomUUID();

      // Одна транзакция: списание → подарок падает в ИНВЕНТАРЬ (status 'owned').
      // Вывод/продажа — отдельные действия из инвентаря.
      await db.transaction(async (trx) => {
        await walletDebit(trx, req.user.id, price, 'portals_buy', `portals:${purchaseId}`);
        await trx('portals_purchases').insert({
          id: purchaseId,
          user_id: req.user.id,
          gift_id: gift.id,
          gift_name: gift.name,
          gift_file: gift.file || null,
          price_coins: price,
          idempotency_key: idemKey,
          source: 'shop',
          status: 'owned'
        });
      });

      const player = await db('players').where({ user_id: req.user.id }).first();
      res.json({ purchaseId, status: 'owned', priceCoins: price, player: playerView(player) });
    } catch (e) {
      if (e instanceof InsufficientFunds) return res.status(400).json({ error: 'insufficient_balance' });
      next(e);
    }
  }
);

// ─── Инвентарь ───
import { getInventory, sellGift, withdrawGift, sellArtifact, InventoryError } from './lib/inventory.js';

app.get('/api/player/inventory', async (req, res, next) => {
  try { res.json(await getInventory(req.user.id)); } catch (e) { next(e); }
});
app.post('/api/player/inventory/:id/sell', async (req, res, next) => {
  try {
    const kind = req.body?.kind === 'artifact' ? 'artifact' : 'gift';
    const out = kind === 'artifact'
      ? await sellArtifact(req.user.id, String(req.params.id))
      : await sellGift(req.user.id, String(req.params.id));
    const player = await db('players').where({ user_id: req.user.id }).first();
    res.json({ ...out, player: playerView(player) });
  } catch (e) {
    if (e instanceof InventoryError) return res.status(e.status).json({ error: e.message });
    next(e);
  }
});
app.post('/api/player/inventory/:id/withdraw', async (req, res, next) => {
  try {
    res.json(await withdrawGift(req.user.id, String(req.params.id)));
  } catch (e) {
    if (e instanceof InventoryError) return res.status(e.status).json({ error: e.message });
    next(e);
  }
});

// ─── Clans ───
import { listClans, getMyClan, createClan, joinClan, leaveClan, kickMember, setRole, deleteClan, contributeToChest, withdrawChest, getClanLeaderboard, getChatMessages, sendChatMessage, requestArtifact, requestCard, giveTrade, ClanError } from './lib/clans.js';

app.get('/api/clans', async (req, res, next) => {
  try { res.json(await listClans(req.user.id)); } catch (e) { next(e); }
});
app.get('/api/clans/my', async (req, res, next) => {
  try {
    const clan = await getMyClan(req.user.id);
    res.json({ clan });
  } catch (e) { next(e); }
});
app.get('/api/clans/leaderboard', async (req, res, next) => {
  try { res.json({ leaderboard: await getClanLeaderboard(50) }); } catch (e) { next(e); }
});

app.post('/api/clans', rateLimit({ bucket: 'clan_create', max: 3, windowMs: 3600_000 }), async (req, res, next) => {
  try {
    const { name, tag, description } = req.body || {};
    res.json(await createClan(req.user.id, name, tag, description));
  } catch (e) {
    if (e instanceof ClanError) return res.status(e.status).json({ error: e.message });
    if (e instanceof InsufficientFunds) return res.status(400).json({ error: 'insufficient_balance' });
    if (e.message?.includes('UNIQUE')) return res.status(409).json({ error: 'name_taken' });
    next(e);
  }
});

app.put('/api/clans/:id', async (req, res, next) => {
  try {
    const clanId = Number(req.params.id);
    const clan = await db('clans').where({ id: clanId }).first();
    if (!clan) return res.status(404).json({ error: 'not_found' });
    if (String(clan.owner_id) !== String(req.user.id)) return res.status(403).json({ error: 'forbidden' });
    const { description } = req.body || {};
    await db('clans').where({ id: clanId }).update({ description: description?.slice(0, 200) || null });
    res.json({ ok: true });
  } catch (e) { next(e); }
});

app.delete('/api/clans/:id', async (req, res, next) => {
  try { await deleteClan(req.user.id, Number(req.params.id)); res.json({ ok: true }); }
  catch (e) { if (e instanceof ClanError) return res.status(e.status).json({ error: e.message }); next(e); }
});

app.post('/api/clans/:id/join', async (req, res, next) => {
  try { await joinClan(req.user.id, Number(req.params.id)); res.json({ ok: true }); }
  catch (e) { if (e instanceof ClanError) return res.status(e.status).json({ error: e.message }); next(e); }
});
app.post('/api/clans/:id/leave', async (req, res, next) => {
  try { await leaveClan(req.user.id, Number(req.params.id)); res.json({ ok: true }); }
  catch (e) { if (e instanceof ClanError) return res.status(e.status).json({ error: e.message }); next(e); }
});
app.post('/api/clans/:id/kick/:userId', async (req, res, next) => {
  try { await kickMember(req.user.id, Number(req.params.id), req.params.userId); res.json({ ok: true }); }
  catch (e) { if (e instanceof ClanError) return res.status(e.status).json({ error: e.message }); next(e); }
});
app.put('/api/clans/:id/role/:userId', async (req, res, next) => {
  try { await setRole(req.user.id, Number(req.params.id), req.params.userId, req.body?.role); res.json({ ok: true }); }
  catch (e) { if (e instanceof ClanError) return res.status(e.status).json({ error: e.message }); next(e); }
});

// Клановый сундук
app.post('/api/clans/:id/chest/contribute', async (req, res, next) => {
  try {
    await contributeToChest(req.user.id, Number(req.params.id), req.body?.amount);
    const player = await db('players').where({ user_id: req.user.id }).first();
    res.json({ ok: true, balance: Number(player.balance) });
  } catch (e) {
    if (e instanceof ClanError) return res.status(e.status).json({ error: e.message });
    if (e instanceof InsufficientFunds) return res.status(400).json({ error: 'insufficient_balance' });
    next(e);
  }
});
app.post('/api/clans/:id/chest/withdraw', async (req, res, next) => {
  try {
    await withdrawChest(req.user.id, Number(req.params.id), req.body?.amount);
    const player = await db('players').where({ user_id: req.user.id }).first();
    res.json({ ok: true, balance: Number(player.balance) });
  } catch (e) { if (e instanceof ClanError) return res.status(e.status).json({ error: e.message }); next(e); }
});

// Клановый чат
app.get('/api/clans/:id/chat', async (req, res, next) => {
  try { res.json({ messages: await getChatMessages(req.user.id, Number(req.params.id)) }); }
  catch (e) { if (e instanceof ClanError) return res.status(e.status).json({ error: e.message }); next(e); }
});
app.post('/api/clans/:id/chat',
  rateLimit({ bucket: 'clan_chat', max: 60, windowMs: 60_000 }),
  async (req, res, next) => {
    try {
      const id = await sendChatMessage(req.user.id, Number(req.params.id), req.body?.text);
      res.json({ ok: true, messageId: id });
    } catch (e) { if (e instanceof ClanError) return res.status(e.status).json({ error: e.message }); next(e); }
  }
);

// Обмен в клане (артефакт или карта)
app.post('/api/clans/:id/trade/request', async (req, res, next) => {
  try {
    const out = await requestArtifact(req.user.id, Number(req.params.id), req.body?.artifactId);
    res.json({ ok: true, ...out });
  } catch (e) { if (e instanceof ClanError) return res.status(e.status).json({ error: e.message }); next(e); }
});
app.post('/api/clans/:id/trade/request-card', async (req, res, next) => {
  try {
    const out = await requestCard(req.user.id, Number(req.params.id));
    res.json({ ok: true, ...out });
  } catch (e) { if (e instanceof ClanError) return res.status(e.status).json({ error: e.message }); next(e); }
});
app.post('/api/clans/:id/trade/give', async (req, res, next) => {
  try {
    await giveTrade(req.user.id, Number(req.params.id), Number(req.body?.messageId));
    res.json({ ok: true });
  } catch (e) {
    if (e instanceof ClanError) return res.status(e.status).json({ error: e.message });
    next(e);
  }
});

// ─── Error handler ───
app.use((err, _req, res, _next) => {
  if (err instanceof AmountError) return res.status(400).json({ error: 'invalid_amount', detail: err.message });
  if (err instanceof InsufficientFunds) return res.status(400).json({ error: 'insufficient_balance' });
  console.error(err);
  res.status(500).json({ error: 'internal_error' });
});

migrate()
  .then(async () => {
    startTonPoller();
    // Restart-safety: доплачиваем по лобби, истёкшим пока сервис был down.
    try { const n = await sweepExpiredLobbies(); if (n) console.log(`recovered ${n} expired lobbies`); } catch (e) { console.error('lobby sweep failed', e.message); }
    // Idle-safety: периодически завершаем истёкшие лобби даже без трафика.
    setInterval(() => sweepExpiredLobbies().catch(() => {}), 30_000);
    // Bind to loopback only — API must be reachable solely via the nginx HTTPS proxy.
    app.listen(env.PORT, '127.0.0.1', () => console.log(`API on 127.0.0.1:${env.PORT} (db: ${env.DATABASE_URL ? 'pg' : 'sqlite'})`));
  })
  .catch((e) => {
    console.error('migration failed', e);
    process.exit(1);
  });
