import { db } from './db.js';
import { debit, credit } from './wallet.js';

export class ClanError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}

// Уровни: XP для перехода + бонус к выигрышу (%).
export const CLAN_LEVELS = [
  { level: 1, xpNeeded: 0,     bonus: 0  },
  { level: 2, xpNeeded: 500,   bonus: 1  },
  { level: 3, xpNeeded: 1500,  bonus: 2  },
  { level: 4, xpNeeded: 3500,  bonus: 3  },
  { level: 5, xpNeeded: 7000,  bonus: 4  },
  { level: 6, xpNeeded: 12000, bonus: 5  },
  { level: 7, xpNeeded: 20000, bonus: 6  },
  { level: 8, xpNeeded: 32000, bonus: 8  },
  { level: 9, xpNeeded: 50000, bonus: 10 },
  { level: 10, xpNeeded: 80000, bonus: 12 },
];

export function clanLevel(xp) {
  let lv = 1;
  for (const row of CLAN_LEVELS) { if (xp >= row.xpNeeded) lv = row.level; }
  return lv;
}
export function clanBonus(xp) {
  return CLAN_LEVELS.find((r) => r.level === clanLevel(xp))?.bonus || 0;
}

// XP начисляется за каждую ставку участника (entry_coins).
export async function addClanXp(userId, xpAmount) {
  const member = await db('clan_members').where({ user_id: String(userId) }).first();
  if (!member) return;
  const before = await db('clans').where({ id: member.clan_id }).first();
  if (!before) return;
  const newXp = Number(before.xp) + Number(xpAmount);
  const newLevel = clanLevel(newXp);
  await db('clans').where({ id: member.clan_id }).update({
    xp: newXp,
    level: newLevel,
    total_wagered: db.raw('total_wagered + ?', [xpAmount])
  });
}

function playerDisplay(p) {
  return {
    userId: String(p.user_id),
    name: p.username ? `@${p.username}` : [p.first_name, p.last_name].filter(Boolean).join(' ') || `Player #${String(p.user_id).slice(-4)}`,
    avatarUrl: p.avatar_file_id ? `/api/avatar/${p.avatar_file_id}` : null,
    role: p.role || 'member',
    contributed: Number(p.contributed || 0)
  };
}

async function clanView(clan, myUserId) {
  const memberRows = await db('clan_members as cm')
    .join('players as p', 'cm.user_id', 'p.user_id')
    .where('cm.clan_id', clan.id)
    .select('p.user_id', 'p.username', 'p.first_name', 'p.last_name', 'p.avatar_file_id', 'cm.role', 'cm.contributed');
  const isMember = memberRows.some((m) => String(m.user_id) === String(myUserId));
  const nextLv = CLAN_LEVELS.find((r) => r.level === clan.level + 1);
  return {
    id: clan.id, name: clan.name, tag: clan.tag, description: clan.description,
    level: clan.level, xp: Number(clan.xp), xpNext: nextLv?.xpNeeded || null,
    bonusPct: clanBonus(Number(clan.xp)),
    chest: Number(clan.chest || 0),
    memberCount: memberRows.length,
    members: memberRows.map(playerDisplay),
    isMember, ownerId: String(clan.owner_id)
  };
}

export async function listClans(myUserId) {
  const clans = await db('clans').orderBy('xp', 'desc');
  const myClanMember = await db('clan_members').where({ user_id: String(myUserId) }).first();
  const simple = await Promise.all(clans.map(async (c) => {
    const cnt = await db('clan_members').where({ clan_id: c.id }).count('* as n').first();
    return {
      id: c.id, name: c.name, tag: c.tag, description: c.description,
      level: c.level, xp: Number(c.xp), bonusPct: clanBonus(Number(c.xp)),
      memberCount: Number(cnt?.n || 0), ownerId: String(c.owner_id)
    };
  }));
  return { clans: simple, myClanId: myClanMember?.clan_id || null };
}

export async function getMyClan(userId) {
  const member = await db('clan_members').where({ user_id: String(userId) }).first();
  if (!member) return null;
  const clan = await db('clans').where({ id: member.clan_id }).first();
  if (!clan) return null;
  return clanView(clan, userId);
}

export async function createClan(userId, name, tag, description) {
  const trimTag = (tag || '').slice(0, 8).toUpperCase();
  if (!name?.trim()) throw new ClanError('name_required');
  if (!trimTag) throw new ClanError('tag_required');
  const already = await db('clan_members').where({ user_id: String(userId) }).first();
  if (already) throw new ClanError('already_in_clan', 409);
  const taken = await db('clans').where({ name: name.trim() }).first();
  if (taken) throw new ClanError('name_taken', 409);

  let clanId;
  await db.transaction(async (trx) => {
    await debit(trx, userId, 50, 'clan_create', `clan_create:${Date.now()}`);
    const [id] = await trx('clans').insert({
      name: name.trim(), tag: trimTag, owner_id: String(userId),
      description: description?.trim() || null, level: 1, xp: 0, chest: 0
    });
    clanId = id;
    await trx('clan_members').insert({ clan_id: clanId, user_id: String(userId), role: 'owner' });
  });
  return { clanId };
}

export async function joinClan(userId, clanId) {
  const clan = await db('clans').where({ id: clanId }).first();
  if (!clan) throw new ClanError('not_found', 404);
  const already = await db('clan_members').where({ user_id: String(userId) }).first();
  if (already) throw new ClanError('already_in_clan', 409);
  await db('clan_members').insert({ clan_id: clanId, user_id: String(userId), role: 'member' });
}

export async function leaveClan(userId, clanId) {
  const clan = await db('clans').where({ id: clanId }).first();
  if (!clan) throw new ClanError('not_found', 404);
  if (String(clan.owner_id) === String(userId)) throw new ClanError('owner_cannot_leave');
  await db('clan_members').where({ clan_id: clanId, user_id: String(userId) }).delete();
}

export async function kickMember(actorId, clanId, targetUserId) {
  const clan = await db('clans').where({ id: clanId }).first();
  if (!clan) throw new ClanError('not_found', 404);
  const actor = await db('clan_members').where({ clan_id: clanId, user_id: String(actorId) }).first();
  if (!actor || (actor.role !== 'owner' && actor.role !== 'officer')) throw new ClanError('forbidden', 403);
  if (String(targetUserId) === String(clan.owner_id)) throw new ClanError('cannot_kick_owner');
  await db('clan_members').where({ clan_id: clanId, user_id: String(targetUserId) }).delete();
}

export async function setRole(actorId, clanId, targetUserId, role) {
  if (!['officer', 'member'].includes(role)) throw new ClanError('invalid_role');
  const clan = await db('clans').where({ id: clanId }).first();
  if (!clan) throw new ClanError('not_found', 404);
  if (String(clan.owner_id) !== String(actorId)) throw new ClanError('forbidden', 403);
  if (String(targetUserId) === String(actorId)) throw new ClanError('cannot_set_own_role');
  const member = await db('clan_members').where({ clan_id: clanId, user_id: String(targetUserId) }).first();
  if (!member) throw new ClanError('not_member', 404);
  await db('clan_members').where({ id: member.id }).update({ role });
}

export async function deleteClan(actorId, clanId) {
  const clan = await db('clans').where({ id: clanId }).first();
  if (!clan) throw new ClanError('not_found', 404);
  if (String(clan.owner_id) !== String(actorId)) throw new ClanError('forbidden', 403);
  await db.transaction(async (trx) => {
    // Возврат сундука владельцу.
    if (Number(clan.chest) > 0) await credit(trx, actorId, Number(clan.chest), 'clan_chest_return', `chest:${clanId}`);
    await trx('clan_members').where({ clan_id: clanId }).delete();
    await trx('clan_messages').where({ clan_id: clanId }).delete();
    await trx('clans').where({ id: clanId }).delete();
  });
}

export async function contributeToChest(userId, clanId, amount) {
  const member = await db('clan_members').where({ clan_id: clanId, user_id: String(userId) }).first();
  if (!member) throw new ClanError('not_member', 403);
  const amt = Math.max(1, Math.floor(Number(amount) || 0));
  await db.transaction(async (trx) => {
    await debit(trx, userId, amt, 'clan_chest', `chest:${clanId}:${Date.now()}`);
    await trx('clans').where({ id: clanId }).update({ chest: trx.raw('chest + ?', [amt]) });
    await trx('clan_members').where({ id: member.id }).update({ contributed: trx.raw('contributed + ?', [amt]) });
  });
}

export async function withdrawChest(actorId, clanId, amount) {
  const clan = await db('clans').where({ id: clanId }).first();
  if (!clan) throw new ClanError('not_found', 404);
  if (String(clan.owner_id) !== String(actorId)) throw new ClanError('forbidden', 403);
  const amt = Math.max(1, Math.floor(Number(amount) || 0));
  if (Number(clan.chest) < amt) throw new ClanError('not_enough_chest');
  await db.transaction(async (trx) => {
    await trx('clans').where({ id: clanId }).update({ chest: trx.raw('chest - ?', [amt]) });
    await credit(trx, actorId, amt, 'clan_chest_withdraw', `chest_out:${clanId}:${Date.now()}`);
  });
}

export async function getClanLeaderboard(limit = 50) {
  const clans = await db('clans').orderBy('xp', 'desc').limit(limit);
  return Promise.all(clans.map(async (c, i) => {
    const cnt = await db('clan_members').where({ clan_id: c.id }).count('* as n').first();
    return {
      rank: i + 1, id: c.id, name: c.name, tag: c.tag,
      level: c.level, xp: Number(c.xp), bonusPct: clanBonus(Number(c.xp)),
      memberCount: Number(cnt?.n || 0)
    };
  }));
}

// ─── Чат клана ───
export async function getChatMessages(userId, clanId, limit = 100) {
  const member = await db('clan_members').where({ clan_id: clanId, user_id: String(userId) }).first();
  if (!member) throw new ClanError('not_member', 403);
  const rows = await db('clan_messages as cm')
    .join('players as p', 'cm.user_id', 'p.user_id')
    .where('cm.clan_id', clanId)
    .orderBy('cm.id', 'desc').limit(limit)
    .select('cm.id', 'cm.type', 'cm.text', 'cm.artifact_id', 'cm.target_user_id',
      'cm.trade_fulfilled', 'cm.created_at',
      'p.user_id', 'p.username', 'p.first_name', 'p.last_name', 'p.avatar_file_id', 'p.role as player_role');
  // Роль из clan_members
  const memberRoles = await db('clan_members').where({ clan_id: clanId })
    .select('user_id', 'role');
  const roleMap = Object.fromEntries(memberRoles.map((m) => [String(m.user_id), m.role]));
  return rows.reverse().map((r) => ({
    id: r.id, type: r.type, text: r.text,
    artifactId: r.artifact_id, targetUserId: r.target_user_id ? String(r.target_user_id) : null,
    tradeFulfilled: Boolean(r.trade_fulfilled),
    createdAt: r.created_at,
    author: { ...playerDisplay({ ...r, role: roleMap[String(r.user_id)] || 'member' }) }
  }));
}

export async function sendChatMessage(userId, clanId, text) {
  const member = await db('clan_members').where({ clan_id: clanId, user_id: String(userId) }).first();
  if (!member) throw new ClanError('not_member', 403);
  const trimmed = String(text || '').slice(0, 500).trim();
  if (!trimmed) throw new ClanError('empty_message');
  const [id] = await db('clan_messages').insert({
    clan_id: clanId, user_id: String(userId), type: 'msg', text: trimmed
  });
  // Хранить только последние 100 сообщений.
  const oldest = await db('clan_messages').where({ clan_id: clanId })
    .orderBy('id', 'asc').limit(999).offset(100).select('id');
  if (oldest.length) await db('clan_messages').whereIn('id', oldest.map((r) => r.id)).delete();
  return id;
}

// ─── Обмен в клане: артефакт или карта ───
// trade_type: 'artifact' | 'card'

function playerName(p) {
  return p?.username ? `@${p.username}` : p?.first_name || `Player #${String(p.user_id).slice(-4)}`;
}

// Запросить артефакт у участников клана.
export async function requestArtifact(userId, clanId, artifactId) {
  const member = await db('clan_members').where({ clan_id: clanId, user_id: String(userId) }).first();
  if (!member) throw new ClanError('not_member', 403);
  const art = await db('artifacts').where({ id: artifactId }).first();
  if (!art) throw new ClanError('artifact_not_found', 404);
  const player = await db('players').where({ user_id: String(userId) }).first();
  const text = `${playerName(player)} просит ${art.name}`;
  const [msgId] = await db('clan_messages').insert({
    clan_id: clanId, user_id: String(userId), type: 'trade_request',
    text, artifact_id: artifactId, target_user_id: String(userId)
  });
  return { msgId, tradeType: 'artifact' };
}

// Запросить ПВП-карту у участников клана.
export async function requestCard(userId, clanId) {
  const member = await db('clan_members').where({ clan_id: clanId, user_id: String(userId) }).first();
  if (!member) throw new ClanError('not_member', 403);
  const player = await db('players').where({ user_id: String(userId) }).first();
  const text = `${playerName(player)} просит ПВП-карту`;
  const [msgId] = await db('clan_messages').insert({
    clan_id: clanId, user_id: String(userId), type: 'trade_request',
    text, artifact_id: '__card__', target_user_id: String(userId)
  });
  return { msgId, tradeType: 'card' };
}

// Выдать то, что просил участник (артефакт или карту).
export async function giveTrade(donorId, clanId, msgId) {
  const msg = await db('clan_messages').where({ id: msgId, clan_id: clanId, type: 'trade_request' }).first();
  if (!msg) throw new ClanError('request_not_found', 404);
  if (msg.trade_fulfilled) throw new ClanError('already_fulfilled', 409);
  if (String(msg.target_user_id) === String(donorId)) throw new ClanError('cannot_give_to_self');
  const donorMember = await db('clan_members').where({ clan_id: clanId, user_id: String(donorId) }).first();
  if (!donorMember) throw new ClanError('not_member', 403);

  const isCard = msg.artifact_id === '__card__';
  const donor = await db('players').where({ user_id: String(donorId) }).first();
  const dname = playerName(donor);
  const rname = msg.text.split(' ')[0];

  await db.transaction(async (trx) => {
    if (isCard) {
      // Списываем карту у дарителя, зачисляем получателю.
      const ok = await trx('players').where({ user_id: String(donorId) }).where('cheap_tickets', '>', 0)
        .update({ cheap_tickets: trx.raw('cheap_tickets - 1') });
      if (!ok) throw new ClanError('not_owned', 409);
      await trx('players').where({ user_id: String(msg.target_user_id) })
        .update({ cheap_tickets: trx.raw('cheap_tickets + 1') });
      await trx('clan_messages').where({ id: msgId }).update({ trade_fulfilled: true });
      await trx('clan_messages').insert({
        clan_id: clanId, user_id: String(donorId), type: 'trade_done',
        text: `${dname} подарил ПВП-карту → ${rname}`
      });
    } else {
      const artId = msg.artifact_id;
      const { randomUUID } = await import('node:crypto');
      const owned = await trx('player_artifacts').where({ user_id: String(donorId), artifact_id: artId }).where('quantity', '>', 0).first();
      if (!owned) throw new ClanError('not_owned', 409);
      await trx('player_artifacts').where({ id: owned.id }).update({ quantity: trx.raw('quantity - 1') });
      const recv = await trx('player_artifacts').where({ user_id: String(msg.target_user_id), artifact_id: artId }).first();
      if (recv) await trx('player_artifacts').where({ id: recv.id }).update({ quantity: trx.raw('quantity + 1') });
      else await trx('player_artifacts').insert({ id: randomUUID(), user_id: String(msg.target_user_id), artifact_id: artId, quantity: 1 });
      await trx('clan_messages').where({ id: msgId }).update({ trade_fulfilled: true });
      const art = await trx('artifacts').where({ id: artId }).first();
      await trx('clan_messages').insert({
        clan_id: clanId, user_id: String(donorId), type: 'trade_done',
        text: `${dname} подарил ${art?.name || artId} → ${rname}`, artifact_id: artId
      });
    }
  });
}
