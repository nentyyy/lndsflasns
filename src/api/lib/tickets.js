import { randomUUID } from 'node:crypto';
import { db } from './db.js';
import { getTicketPack } from './config.js';
import { debit } from './wallet.js';

export class TicketError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}

const COLUMN = { cheap: 'cheap_tickets', premium: 'premium_tickets' };

export async function buyTicketPack(userId, type, packId) {
  const col = COLUMN[type];
  if (!col) throw new TicketError('unknown ticket type', 404);
  const pack = getTicketPack(type, packId);
  if (!pack) throw new TicketError('unknown pack', 404);

  return db.transaction(async (trx) => {
    const balance = await debit(trx, userId, pack.priceCoins, 'tickets_buy', `tickets:${randomUUID()}`);
    await trx('players').where({ user_id: userId }).update({
      [col]: trx.raw(`${col} + ?`, [pack.count]),
      coins_spent: trx.raw('coins_spent + ?', [pack.priceCoins])
    });
    const row = await trx('players').where({ user_id: userId }).first(col);
    return { balance, ticketCount: Number(row[col]), added: pack.count, price: pack.priceCoins };
  });
}

// Попытаться сжечь 1 билет атомарно. Возвращает true если списан.
export async function consumeTicket(trx, userId, type) {
  const col = COLUMN[type];
  if (!col) return false;
  const updated = await trx('players')
    .where({ user_id: userId })
    .andWhere(col, '>', 0)
    .update({ [col]: trx.raw(`${col} - 1`) });
  return updated > 0;
}

export async function getInventory(userId) {
  const row = await db('players').where({ user_id: userId }).first('cheap_tickets', 'premium_tickets');
  return {
    cheap: Number(row?.cheap_tickets || 0),
    premium: Number(row?.premium_tickets || 0)
  };
}
