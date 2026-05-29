import { db } from './db.js';

// Кэш топа на 5 минут (бэк-кэш, чтобы не считать на каждый запрос).
let cache = { data: null, ts: 0 };
const TTL_MS = 5 * 60 * 1000;

function row(p) {
  return {
    userId: String(p.user_id),
    name: [p.first_name, p.last_name].filter(Boolean).join(' ') || p.username || `Player #${String(p.user_id).slice(-4)}`,
    username: p.username || null,
    avatarUrl: p.avatar_file_id ? `/api/avatar/${p.avatar_file_id}` : null,
    coinsWon: Number(p.coins_won || p.won || 0),
    roundsPlayed: Number(p.games_played != null ? p.games_played : p.rounds || 0)
  };
}

function startOfTodayISO() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

export async function getLeaderboard() {
  if (cache.data && Date.now() - cache.ts < TTL_MS) return cache.data;

  // All-time: по накопленному coins_won.
  const allTime = await db('players')
    .where('coins_won', '>', 0)
    .orderBy('coins_won', 'desc')
    .limit(10)
    .select('user_id', 'first_name', 'last_name', 'username', 'avatar_file_id', 'coins_won', 'games_played');

  // Сегодня: сумма выплат из ledger за сегодня, сгруппировано по игроку.
  const todayRows = await db('ledger as l')
    .join('players as p', 'l.user_id', 'p.user_id')
    .whereIn('l.ref_type', ['pvp_payout', 'payout'])
    .where('l.amount', '>', 0)
    .where('l.created_at', '>=', startOfTodayISO())
    .groupBy('l.user_id', 'p.first_name', 'p.last_name', 'p.username', 'p.avatar_file_id')
    .orderBy('won', 'desc')
    .limit(10)
    .select('l.user_id', 'p.first_name', 'p.last_name', 'p.username', 'p.avatar_file_id')
    .sum('l.amount as won')
    .count('l.id as rounds');

  const data = {
    allTime: allTime.map(row),
    today: todayRows.map(row),
    updatedAt: new Date().toISOString()
  };
  cache = { data, ts: Date.now() };
  return data;
}

// Личная статистика игрока.
export async function getPersonalStats(userId) {
  const p = await db('players').where({ user_id: userId }).first();
  if (!p) return null;

  const [soloWins, pvpWins, fav] = await Promise.all([
    db('rounds').where({ user_id: userId, status: 'revealed' }).where('credit', '>', 0).count('* as n').first(),
    db('pvp_cards').where({ user_id: userId, status: 'revealed' }).where('credit', '>', 0).count('* as n').first(),
    db('portals_purchases').where({ user_id: userId }).groupBy('gift_name').orderBy('n', 'desc')
      .select('gift_name').count('* as n').first()
  ]);

  const roundsPlayed = Number(p.games_played || 0) + Number(p.pvp_total_reveals || 0);
  const wins = Number(soloWins?.n || 0) + Number(pvpWins?.n || 0);
  return {
    roundsPlayed,
    wins,
    losses: Math.max(0, roundsPlayed - wins),
    bestWin: Number(p.best_win || 0),
    totalWon: Number(p.coins_won || 0),
    totalSpent: Number(p.coins_spent || 0),
    favoriteGift: fav?.gift_name || null
  };
}
