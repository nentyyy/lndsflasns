import cors from 'cors';
import express from 'express';
import { env, MODES, STARS_PACKS, TON_PACKS, TICKET_PACKS } from './lib/config.js';
import { db } from './lib/db.js';
import { migrate } from './lib/migrate.js';
import { authMiddleware, rateLimit } from './lib/security.js';
import { validate, armSchema, revealSchema, depositSchema, pvpBuySchema } from './lib/validators.js';
import { armRound, revealRound, GameError } from './lib/game.js';
import { InsufficientFunds } from './lib/wallet.js';
import { createStarsDeposit } from './lib/payments/stars.js';
import { createTonDeposit, startTonPoller } from './lib/payments/ton.js';
import { createCryptobotDeposit } from './lib/payments/cryptobot.js';
import { getReferralView, bindReferrer, makeRefCode, claimReferralPending } from './lib/referral.js';
import { getTournamentView, ensureActiveTournament } from './lib/tournaments.js';
import { getPvpState, buyCard, PvpError, getLiveFeed } from './lib/pvp.js';
import { buyTicketPack, TicketError } from './lib/tickets.js';

const app = express();
app.use(cors({
  origin: true,
  credentials: true,
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: [
    'Content-Type', 'Authorization',
    'X-Dev-User', 'X-Telegram-Init-Data', 'X-Ref-Code'
  ]
}));
app.options('*', cors());
app.use(express.json());

const publicModes = Object.values(MODES).map((m) => ({ id: m.id, entryCoins: m.entryCoins, title: m.title }));

// ─── Public ───
app.get('/api/health', (_req, res) => {
  res.json({ ok: true, app: 'DEADWILL', db: env.DATABASE_URL ? 'pg' : 'sqlite' });
});

// Live feed — public (no auth needed for display)
app.get('/api/feed', async (_req, res, next) => {
  try {
    const feed = await getLiveFeed(20);
    res.json({ feed });
  } catch (e) { next(e); }
});

// ─── Auth required ───
app.use('/api', authMiddleware());

function playerView(p) {
  return {
    id: p.user_id,
    name: p.first_name || p.username || 'player',
    username: p.username,
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
    pvpTotalReveals: Number(p.pvp_total_reveals || 0),
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

app.get('/api/me', async (req, res) => {
  res.json({ player: playerView(req.player) });
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
      liveWins
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

app.get('/api/deposits/:id', async (req, res, next) => {
  try {
    const d = await db('deposits').where({ id: req.params.id, user_id: req.user.id }).first();
    if (!d) return res.status(404).json({ error: 'not_found' });
    res.json({
      id: d.id,
      method: d.method,
      status: d.status,
      coins: Number(d.coins) + Number(d.bonus),
      comment: d.ton_comment,
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
      id: p.user_id,
      name: p.first_name || p.username || `Игрок`,
      username: p.username,
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
function requireAdmin(req, res, next) {
  if (req.player?.role !== 'Owner' && req.player?.role !== 'Admin') {
    return res.status(403).json({ error: 'forbidden' });
  }
  next();
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
    res.json({ purchases });
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

// Изменить баланс пользователя (admin)
app.post('/api/admin/users/:userId/adjust', requireAdmin, async (req, res, next) => {
  try {
    const { amount, reason } = req.body;
    if (!amount || !reason) return res.status(400).json({ error: 'amount and reason required' });
    const { credit, debit } = await import('./lib/wallet.js');
    const amt = Number(amount);
    await db.transaction(async (trx) => {
      if (amt > 0) {
        await credit(trx, req.params.userId, amt, 'admin_adjust', `admin:${Date.now()}`);
      } else {
        await debit(trx, req.params.userId, Math.abs(amt), 'admin_adjust', `admin:${Date.now()}`);
      }
    });
    const player = await db('players').where({ user_id: req.params.userId }).first();
    res.json({ ok: true, player: playerView(player) });
  } catch (e) { next(e); }
});

// Portals purchase — создать заявку
app.post('/api/portals/buy',
  rateLimit({ bucket: 'portals_buy', max: 10, windowMs: 60_000 }),
  async (req, res, next) => {
    try {
      const { giftId, giftName, priceCoins } = req.body;
      if (!giftId || !giftName || !priceCoins) return res.status(400).json({ error: 'invalid_request' });
      const { randomUUID } = await import('node:crypto');
      const { debit: dbDebit } = await import('./lib/wallet.js');
      const purchaseId = randomUUID();

      await db.transaction(async (trx) => {
        await dbDebit(trx, req.user.id, Number(priceCoins), 'portals_buy', `portals:${purchaseId}`);
      });

      await db('portals_purchases').insert({
        id: purchaseId,
        user_id: req.user.id,
        gift_id: String(giftId),
        gift_name: String(giftName),
        price_coins: Number(priceCoins),
        status: 'pending'
      });

      const player = await db('players').where({ user_id: req.user.id }).first();
      res.json({ purchaseId, status: 'pending', player: playerView(player) });
    } catch (e) {
      if (e instanceof InsufficientFunds) return res.status(400).json({ error: 'insufficient_balance' });
      next(e);
    }
  }
);

// ─── Clans ───
app.get('/api/clans', async (req, res, next) => {
  try {
    const clans = await db('clans')
      .orderBy('total_wagered', 'desc')
      .limit(50)
      .select('id', 'name', 'tag', 'owner_id', 'description', 'total_wagered', 'created_at');
    const enriched = await Promise.all(clans.map(async (c) => {
      const count = await db('clan_members').where({ clan_id: c.id }).count('* as n').first();
      const me = await db('clan_members').where({ clan_id: c.id, user_id: req.user.id }).first();
      return { ...c, memberCount: Number(count.n), isMember: Boolean(me), isOwner: String(c.owner_id) === String(req.user.id) };
    }));
    const myClan = await db('clan_members').where({ user_id: req.user.id }).first();
    res.json({ clans: enriched, myClanId: myClan?.clan_id || null });
  } catch (e) { next(e); }
});

app.post('/api/clans',
  rateLimit({ bucket: 'clan_create', max: 3, windowMs: 3600_000 }),
  async (req, res, next) => {
    try {
      const { name, tag, description } = req.body || {};
      if (!name || name.length < 2 || name.length > 32) return res.status(400).json({ error: 'invalid_name' });
      const safeTag = (tag || name).slice(0, 8).replace(/[^a-zA-ZА-Яа-я0-9]/g, '').toUpperCase() || 'CLAN';

      // Проверяем что уже не в клане
      const already = await db('clan_members').where({ user_id: req.user.id }).first();
      if (already) return res.status(409).json({ error: 'already_in_clan' });

      const [clanId] = await db('clans').insert({
        name: name.trim(),
        tag: safeTag,
        owner_id: req.user.id,
        description: description ? String(description).slice(0, 200) : null
      });

      await db('clan_members').insert({ clan_id: clanId, user_id: req.user.id, role: 'owner' });
      res.json({ ok: true, clanId });
    } catch (e) {
      if (e.message?.includes('UNIQUE')) return res.status(409).json({ error: 'name_taken' });
      next(e);
    }
  }
);

app.post('/api/clans/:id/join', async (req, res, next) => {
  try {
    const clanId = Number(req.params.id);
    const clan = await db('clans').where({ id: clanId }).first();
    if (!clan) return res.status(404).json({ error: 'not_found' });
    const already = await db('clan_members').where({ user_id: req.user.id }).first();
    if (already) return res.status(409).json({ error: 'already_in_clan' });
    await db('clan_members').insert({ clan_id: clanId, user_id: req.user.id, role: 'member' });
    res.json({ ok: true });
  } catch (e) { next(e); }
});

app.post('/api/clans/:id/leave', async (req, res, next) => {
  try {
    const clanId = Number(req.params.id);
    const clan = await db('clans').where({ id: clanId }).first();
    if (!clan) return res.status(404).json({ error: 'not_found' });
    if (String(clan.owner_id) === String(req.user.id)) return res.status(400).json({ error: 'owner_cannot_leave' });
    await db('clan_members').where({ clan_id: clanId, user_id: req.user.id }).delete();
    res.json({ ok: true });
  } catch (e) { next(e); }
});

// ─── Error handler ───
app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: 'internal_error' });
});

migrate()
  .then(() => {
    startTonPoller();
    app.listen(env.PORT, () => console.log(`API server running on port ${env.PORT} (db: ${env.DATABASE_URL ? 'pg' : 'sqlite'})`));
  })
  .catch((e) => {
    console.error('migration failed', e);
    process.exit(1);
  });
