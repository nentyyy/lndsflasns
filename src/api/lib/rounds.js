import { db } from './db.js';

function pview(p) {
  return {
    userId: String(p.user_id),
    name: p.username ? `@${p.username}`
      : [p.first_name, p.last_name].filter(Boolean).join(' ') || `Player #${String(p.user_id).slice(-4)}`,
    username: p.username || null,
    avatarUrl: p.avatar_file_id ? `/api/avatar/${p.avatar_file_id}` : null
  };
}

// Список завершённых PvP-раундов. sort: 'all' | 'best' | 'mine'.
// mine — только раунды, где участвовал mineUserId.
export async function listRounds({ limit = 20, offset = 0, sort = 'all', mineUserId = null } = {}) {
  let lobbyQuery = db('pvp_lobbies')
    .where({ status: 'settled' })
    .whereNotNull('round_number');

  // «Мои» раунды — только те лобби, где у игрока есть карта.
  if (sort === 'mine' && mineUserId) {
    const mineLobbyIds = await db('pvp_cards')
      .where({ user_id: mineUserId })
      .distinct('lobby_id')
      .pluck('lobby_id');
    if (!mineLobbyIds.length) return { rounds: [], total: 0, hasMore: false };
    lobbyQuery = lobbyQuery.whereIn('id', mineLobbyIds);
  }

  const lobbies = await lobbyQuery
    .orderBy('round_number', 'desc')
    .limit(500)
    .select('id', 'round_number', 'settled_at', 'entry_coins');

  const agg = await db('pvp_cards')
    .where('status', 'revealed')
    .whereNotNull('user_id')
    .groupBy('lobby_id')
    .select('lobby_id')
    .max('credit as topPrize')
    .sum('credit as totalWon')          // суммарно монет выиграно в раунде
    .countDistinct('user_id as players'); // уникальные игроки, не карты
  const aggMap = new Map(agg.map((a) => [a.lobby_id, a]));

  let rounds = lobbies.map((l) => {
    const a = aggMap.get(l.id) || {};
    return {
      lobbyId: l.id,
      roundNumber: l.round_number,
      settledAt: l.settled_at,
      entry: Number(l.entry_coins),
      topPrize: Number(a.topPrize || 0),
      totalWon: Number(a.totalWon || 0),
      players: Number(a.players || 0)
    };
  });

  // ALL — по убыванию номера (свежие сверху).
  // BEST — по суммарным монетам раунда (самые крупные), tiebreak — свежие выше.
  rounds.sort((x, y) =>
    sort === 'best'
      ? (y.totalWon - x.totalWon) || (y.roundNumber - x.roundNumber)
      : (y.roundNumber - x.roundNumber));
  const total = rounds.length;
  const page = rounds.slice(offset, offset + limit);

  for (const r of page) {
    if (r.topPrize > 0) {
      const w = await db('pvp_cards as c')
        .join('players as p', 'c.user_id', 'p.user_id')
        .where({ 'c.lobby_id': r.lobbyId, 'c.status': 'revealed' })
        .where('c.credit', r.topPrize)
        .first('p.user_id', 'p.username', 'p.first_name', 'p.last_name', 'p.avatar_file_id');
      r.winner = w ? { ...pview(w), amount: r.topPrize } : null;
    } else {
      r.winner = null;
    }
  }

  return { rounds: page, total, hasMore: offset + limit < total };
}

// Детали одного раунда: все участники с картой и призом (по убыванию приза).
export async function getRoundDetail(lobbyId) {
  const lobby = await db('pvp_lobbies').where({ id: lobbyId }).first();
  if (!lobby) return null;
  const cards = await db('pvp_cards as c')
    .join('players as p', 'c.user_id', 'p.user_id')
    .where('c.lobby_id', lobbyId)
    .whereNotNull('c.user_id')
    .orderBy('c.credit', 'desc')
    .select('c.card_index', 'c.credit', 'c.outcome_type', 'p.user_id', 'p.username', 'p.first_name', 'p.last_name', 'p.avatar_file_id');
  return {
    roundNumber: lobby.round_number,
    entry: Number(lobby.entry_coins),
    settledAt: lobby.settled_at,
    players: cards.map((c) => ({ ...pview(c), cardIndex: c.card_index, prize: Number(c.credit) }))
  };
}
