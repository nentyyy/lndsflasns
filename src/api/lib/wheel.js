import { randomUUID } from 'node:crypto';
import { db } from './db.js';
import { credit } from './wallet.js';
import { WHEEL_SEGMENTS, WHEEL_COOLDOWN_MS } from './config.js';

export class WheelError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}

// Публичный вид сегментов (без весов) — для отрисовки колеса.
const publicSegments = () =>
  WHEEL_SEGMENTS.map((s) => ({ key: s.key, type: s.type, value: s.value, label: s.label }));

function nextSpinAt(player) {
  if (!player?.wheel_last_spin) return 0;
  return new Date(player.wheel_last_spin).getTime() + WHEEL_COOLDOWN_MS;
}

export async function getWheelState(userId) {
  const player = await db('players').where({ user_id: userId }).first();
  const unlocked = Boolean(player?.first_deposit_done);
  const next = nextSpinAt(player);
  const canSpin = unlocked && Date.now() >= next;
  return {
    unlocked,
    canSpin,
    nextSpinAt: next ? new Date(next).toISOString() : null,
    cooldownMs: WHEEL_COOLDOWN_MS,
    depositBonusPct: Number(player?.wheel_deposit_bonus_pct || 0),
    segments: publicSegments()
  };
}

// Взвешенный выбор сегмента.
function pickSegment() {
  const totalWeight = WHEEL_SEGMENTS.reduce((s, x) => s + x.weight, 0);
  let r = Math.random() * totalWeight;
  for (let i = 0; i < WHEEL_SEGMENTS.length; i++) {
    r -= WHEEL_SEGMENTS[i].weight;
    if (r < 0) return { index: i, seg: WHEEL_SEGMENTS[i] };
  }
  return { index: WHEEL_SEGMENTS.length - 1, seg: WHEEL_SEGMENTS[WHEEL_SEGMENTS.length - 1] };
}

export async function spinWheel(userId) {
  return db.transaction(async (trx) => {
    const player = await trx('players').where({ user_id: userId }).first();
    if (!player) throw new WheelError('player not found', 404);
    if (!player.first_deposit_done) throw new WheelError('locked', 403);
    if (Date.now() < nextSpinAt(player)) throw new WheelError('cooldown', 429);

    const { index, seg } = pickSegment();

    let balance = Number(player.balance);
    const reward = { key: seg.key, type: seg.type, value: seg.value, label: seg.label };

    if (seg.type === 'coins') {
      balance = await credit(trx, userId, seg.value, 'wheel', `wheel:${randomUUID()}`);
    } else if (seg.type === 'tickets') {
      await trx('players').where({ user_id: userId }).update({ cheap_tickets: trx.raw('cheap_tickets + ?', [seg.value]) });
    } else if (seg.type === 'deposit_bonus') {
      // Берём максимум из накопленного и нового (не складываем бесконечно).
      const pct = Math.max(Number(player.wheel_deposit_bonus_pct || 0), seg.value);
      await trx('players').where({ user_id: userId }).update({ wheel_deposit_bonus_pct: pct });
    }

    await trx('players').where({ user_id: userId }).update({
      wheel_last_spin: trx.fn.now(),
      wheel_spins: trx.raw('wheel_spins + 1')
    });

    const updated = await trx('players').where({ user_id: userId }).first();
    return {
      segmentIndex: index,
      reward,
      balance,
      tickets: { cheap: Number(updated.cheap_tickets), premium: Number(updated.premium_tickets) },
      depositBonusPct: Number(updated.wheel_deposit_bonus_pct || 0),
      nextSpinAt: new Date(nextSpinAt(updated)).toISOString()
    };
  });
}
