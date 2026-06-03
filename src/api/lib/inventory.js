import { db } from './db.js';
import { credit } from './wallet.js';
import { getGiftFromCache } from './portals.js';
import { notifyAdminsPurchase } from './admin-notify.js';

export class InventoryError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}

const SOURCE_LABEL = { shop: 'Куплен в магазине', lucky: 'Lucky Buy', points: 'За поинты', clan: 'От клана' };

// Список инвентаря: подарки (owned) + артефакты.
export async function getInventory(userId) {
  const gifts = await db('portals_purchases')
    .where({ user_id: String(userId), status: 'owned' })
    .orderBy('created_at', 'desc')
    .select('id', 'gift_id', 'gift_name', 'gift_file', 'price_coins', 'source', 'created_at');

  // Подтянем file из каталога, если в покупке не сохранён.
  const giftItems = await Promise.all(gifts.map(async (g) => {
    let file = g.gift_file;
    if (!file) { const c = await getGiftFromCache(g.gift_id).catch(() => null); file = c?.file || null; }
    return {
      kind: 'gift', id: g.id, giftId: g.gift_id, name: g.gift_name, file,
      priceCoins: Number(g.price_coins), source: g.source || 'shop',
      sourceLabel: SOURCE_LABEL[g.source] || 'Подарок', at: g.created_at
    };
  }));

  const arts = await db('player_artifacts as pa')
    .join('artifacts as a', 'pa.artifact_id', 'a.id')
    .where('pa.user_id', String(userId)).where('pa.quantity', '>', 0)
    .select('pa.artifact_id', 'pa.quantity', 'a.name', 'a.description', 'a.price', 'a.effect');
  const artItems = arts.map((a) => ({
    kind: 'artifact', id: a.artifact_id, artifactId: a.artifact_id, name: a.name,
    description: a.description, price: Number(a.price), quantity: Number(a.quantity),
    effect: JSON.parse(a.effect), sourceLabel: 'Артефакт'
  }));

  return { gifts: giftItems, artifacts: artItems };
}

// Продать подарок — 70% от priceCoins. id = portals_purchases.id.
export async function sellGift(userId, purchaseId) {
  const row = await db('portals_purchases').where({ id: purchaseId, user_id: String(userId), status: 'owned' }).first();
  if (!row) throw new InventoryError('gift_not_found', 404);
  const payout = Math.max(1, Math.round(Number(row.price_coins) * 0.7));
  let balance;
  await db.transaction(async (trx) => {
    const ok = await trx('portals_purchases').where({ id: purchaseId, status: 'owned' }).update({ status: 'sold' });
    if (!ok) throw new InventoryError('already_processed', 409);
    balance = await credit(trx, userId, payout, 'gift_sell', `sell:${purchaseId}`);
  });
  return { balance, payout, name: row.gift_name };
}

// Вывести подарок — создать заявку (pending) + уведомить админов.
export async function withdrawGift(userId, purchaseId) {
  const row = await db('portals_purchases').where({ id: purchaseId, user_id: String(userId), status: 'owned' }).first();
  if (!row) throw new InventoryError('gift_not_found', 404);
  await db('portals_purchases').where({ id: purchaseId, status: 'owned' }).update({ status: 'pending' });
  notifyAdminsPurchase({ id: row.id, user_id: String(userId), gift_id: row.gift_id, gift_name: row.gift_name, price_coins: Number(row.price_coins) })
    .catch((e) => console.error('withdraw notify err', e.message));
  return { ok: true, name: row.gift_name };
}

// Продать артефакт — 50% от price. id = artifact_id.
export async function sellArtifact(userId, artifactId) {
  const art = await db('artifacts').where({ id: artifactId }).first();
  if (!art) throw new InventoryError('artifact_not_found', 404);
  const payout = Math.max(1, Math.round(Number(art.price) * 0.5));
  let balance;
  await db.transaction(async (trx) => {
    const owned = await trx('player_artifacts').where({ user_id: String(userId), artifact_id: artifactId }).where('quantity', '>', 0).first();
    if (!owned) throw new InventoryError('not_owned', 409);
    await trx('player_artifacts').where({ id: owned.id }).update({ quantity: trx.raw('quantity - 1') });
    balance = await credit(trx, userId, payout, 'artifact_sell', `artsell:${artifactId}:${Date.now()}`);
  });
  return { balance, payout, name: art.name };
}
