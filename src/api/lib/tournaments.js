import { randomUUID } from 'node:crypto';
import { db } from './db.js';
import { TOURNAMENT_CYCLE_MS, TOURNAMENT_PRIZES } from './config.js';
import { credit } from './wallet.js';

// Гарантировать наличие активного турнира; цикл — 3 дня. Старые завершаем и
// (в фоне) выдаём призы топу.
export async function ensureActiveTournament() {
  const now = new Date();
  const active = await db('tournaments').where({ status: 'active' }).orderBy('starts_at', 'desc').first();
  if (active && new Date(active.ends_at).getTime() > now.getTime()) return active;
  if (active) await settleTournament(active.id).catch((e) => console.error('settle err', e.message));

  const id = randomUUID();
  const starts = now;
  const ends = new Date(now.getTime() + TOURNAMENT_CYCLE_MS);
  await db('tournaments').insert({
    id,
    title: `Цикл ${starts.toISOString().slice(0, 10)}`,
    starts_at: starts.toISOString(),
    ends_at: ends.toISOString(),
    status: 'active',
    prizes: JSON.stringify(TOURNAMENT_PRIZES)
  });
  return db('tournaments').where({ id }).first();
}

export async function addTournamentScore(trx, userId, delta) {
  const t = await ensureActiveTournament();
  const existing = await trx('tournament_entries').where({ tournament_id: t.id, user_id: userId }).first();
  if (existing) {
    await trx('tournament_entries').where({ id: existing.id }).update({
      score: trx.raw('score + ?', [delta]),
      rounds_played: trx.raw('rounds_played + 1'),
      updated_at: trx.fn.now()
    });
  } else {
    await trx('tournament_entries').insert({
      tournament_id: t.id,
      user_id: userId,
      score: delta,
      rounds_played: 1
    });
  }
}

export async function getTournamentView(userId) {
  const t = await ensureActiveTournament();
  const rows = await db('tournament_entries as te')
    .leftJoin('players as p', 'p.user_id', 'te.user_id')
    .where({ 'te.tournament_id': t.id })
    .orderBy('te.score', 'desc')
    .limit(50)
    .select('te.user_id', 'te.score', 'te.rounds_played', 'p.username', 'p.first_name');

  const top = rows.map((r, i) => ({
    place: i + 1,
    userId: String(r.user_id),
    name: r.first_name || r.username || `Игрок ${String(r.user_id).slice(-4)}`,
    score: Number(r.score),
    rounds: Number(r.rounds_played)
  }));

  const me = top.find((row) => row.userId === String(userId));

  let prizes = [];
  try { prizes = typeof t.prizes === 'string' ? JSON.parse(t.prizes) : t.prizes; } catch { prizes = TOURNAMENT_PRIZES; }

  return {
    id: t.id,
    title: t.title,
    startsAt: new Date(t.starts_at).toISOString(),
    endsAt: new Date(t.ends_at).toISOString(),
    prizes,
    top: top.slice(0, 20),
    me: me || null,
    participants: top.length
  };
}

// Распределение призов. Coin-призы зачисляем монетами; TON призы оставляем на
// ручную выплату из админки (создаём transfers пометкой).
async function settleTournament(tournamentId) {
  const rows = await db('tournament_entries')
    .where({ tournament_id: tournamentId })
    .orderBy('score', 'desc')
    .limit(10);
  let prizes;
  const t = await db('tournaments').where({ id: tournamentId }).first();
  try { prizes = typeof t.prizes === 'string' ? JSON.parse(t.prizes) : t.prizes; } catch { prizes = TOURNAMENT_PRIZES; }
  for (const prize of prizes) {
    const row = rows[prize.place - 1];
    if (!row) continue;
    if (prize.kind === 'coins') {
      await db.transaction(async (trx) => {
        await credit(trx, row.user_id, prize.amount, 'tournament_prize', `${tournamentId}:${prize.place}`);
      }).catch((e) => console.error('coin prize err', e.message));
    } else if (prize.kind === 'ton') {
      await db('transfers').insert({
        id: `TR-T-${tournamentId.slice(0, 8)}-${prize.place}`,
        user_id: row.user_id,
        asset: `Турнир #${tournamentId.slice(0, 6)} • ${prize.label}`,
        price_coins: 0,
        status: 'pending',
        comment: `Турнирный приз: ${prize.label}. Выплата вручную через админку.`
      }).onConflict('id').ignore();
    }
  }
  await db('tournaments').where({ id: tournamentId }).update({ status: 'settled' });
}
