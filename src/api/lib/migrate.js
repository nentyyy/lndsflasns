import { db } from './db.js';

export async function migrate() {
  if (!(await db.schema.hasTable('players'))) {
    await db.schema.createTable('players', (t) => {
      t.bigInteger('user_id').primary(); // Telegram user id
      t.string('username');
      t.string('first_name');
      t.bigInteger('balance').notNullable().defaultTo(0); // coins, integer only
      t.integer('multiplier').notNullable().defaultTo(1);
      t.bigInteger('nonce').notNullable().defaultTo(0); // provably-fair counter
      t.bigInteger('games_played').notNullable().defaultTo(0);
      t.bigInteger('coins_won').notNullable().defaultTo(0);
      t.bigInteger('coins_spent').notNullable().defaultTo(0);
      t.bigInteger('best_win').notNullable().defaultTo(0);
      t.string('role').notNullable().defaultTo('player');
      // Маркер «не израсходован welcome-контракт»: первая дешевая попытка бесплатно.
      t.boolean('welcome_used').notNullable().defaultTo(false);
      // Реферальная программа: кто пригласил, и реферальный код.
      t.bigInteger('referrer_id').nullable().index();
      t.string('ref_code').nullable();
      t.bigInteger('ref_earned').notNullable().defaultTo(0);
      t.bigInteger('cheap_tickets').notNullable().defaultTo(0);
      t.bigInteger('premium_tickets').notNullable().defaultTo(0);
      t.integer('pvp_zero_streak').notNullable().defaultTo(0);
      t.bigInteger('pvp_total_reveals').notNullable().defaultTo(0);
      t.bigInteger('pvp_session_wagered').notNullable().defaultTo(0);
      t.bigInteger('pvp_session_returned').notNullable().defaultTo(0);
      t.boolean('first_deposit_done').notNullable().defaultTo(false);
      t.bigInteger('ref_pending').notNullable().defaultTo(0);
      t.timestamp('created_at').defaultTo(db.fn.now());
      t.timestamp('updated_at').defaultTo(db.fn.now());
    });
  } else {
    // Ленивые миграции для уже существующих players.
    const cols = await db('players').columnInfo();
    if (!cols.welcome_used)          await db.schema.alterTable('players', (t) => t.boolean('welcome_used').notNullable().defaultTo(false));
    if (!cols.referrer_id)           await db.schema.alterTable('players', (t) => t.bigInteger('referrer_id').nullable().index());
    if (!cols.ref_code)              await db.schema.alterTable('players', (t) => t.string('ref_code').nullable());
    if (!cols.ref_earned)            await db.schema.alterTable('players', (t) => t.bigInteger('ref_earned').notNullable().defaultTo(0));
    if (!cols.ref_pending)           await db.schema.alterTable('players', (t) => t.bigInteger('ref_pending').notNullable().defaultTo(0));
    if (!cols.cheap_tickets)         await db.schema.alterTable('players', (t) => t.bigInteger('cheap_tickets').notNullable().defaultTo(0));
    if (!cols.premium_tickets)       await db.schema.alterTable('players', (t) => t.bigInteger('premium_tickets').notNullable().defaultTo(0));
    if (!cols.pvp_zero_streak)       await db.schema.alterTable('players', (t) => t.integer('pvp_zero_streak').notNullable().defaultTo(0));
    if (!cols.pvp_total_reveals)     await db.schema.alterTable('players', (t) => t.bigInteger('pvp_total_reveals').notNullable().defaultTo(0));
    if (!cols.first_deposit_done)    await db.schema.alterTable('players', (t) => t.boolean('first_deposit_done').notNullable().defaultTo(false));
    if (!cols.pvp_session_wagered)   await db.schema.alterTable('players', (t) => t.bigInteger('pvp_session_wagered').notNullable().defaultTo(0));
    if (!cols.pvp_session_returned)  await db.schema.alterTable('players', (t) => t.bigInteger('pvp_session_returned').notNullable().defaultTo(0));
  }

  // Double-entry style ledger. balance on players is derived from these.
  if (!(await db.schema.hasTable('ledger'))) {
    await db.schema.createTable('ledger', (t) => {
      t.increments('id').primary();
      t.bigInteger('user_id').notNullable().index();
      t.string('ref_type').notNullable(); // bet | payout | deposit_stars | deposit_ton | transfer
      t.string('ref_id').notNullable();
      t.bigInteger('amount').notNullable(); // signed
      t.bigInteger('balance_after').notNullable();
      t.timestamp('created_at').defaultTo(db.fn.now());
      // idempotency: a given (ref_type, ref_id) can only post once
      t.unique(['ref_type', 'ref_id']);
    });
  }

  if (!(await db.schema.hasTable('rounds'))) {
    await db.schema.createTable('rounds', (t) => {
      t.string('id').primary(); // uuid
      t.bigInteger('user_id').notNullable().index();
      t.string('mode').notNullable();
      t.bigInteger('entry').notNullable();
      t.string('client_seed').notNullable();
      t.string('server_seed').notNullable();
      t.string('server_seed_hash').notNullable();
      t.bigInteger('nonce').notNullable();
      t.integer('clause_index');
      t.string('status').notNullable().defaultTo('armed'); // armed | revealed
      t.string('outcome_key');
      t.string('outcome_type');
      t.bigInteger('credit').defaultTo(0);
      t.string('idempotency_key');
      t.timestamp('created_at').defaultTo(db.fn.now());
      t.timestamp('revealed_at');
      t.unique(['user_id', 'idempotency_key']);
    });
  }

  if (!(await db.schema.hasTable('deposits'))) {
    await db.schema.createTable('deposits', (t) => {
      t.string('id').primary(); // uuid
      t.bigInteger('user_id').notNullable().index();
      t.string('method').notNullable(); // stars | ton
      t.string('pack_id').notNullable();
      t.string('status').notNullable().defaultTo('pending'); // pending | paid | failed
      t.bigInteger('coins').notNullable();
      t.bigInteger('bonus').notNullable().defaultTo(0);
      t.string('currency').notNullable();
      t.bigInteger('expected_amount').notNullable(); // XTR for stars, nanoton for ton
      t.string('ton_comment'); // memo the user must attach (= deposit id)
      t.string('ton_tx_hash');
      t.string('telegram_charge_id');
      t.timestamp('created_at').defaultTo(db.fn.now());
      t.timestamp('paid_at');
      t.unique(['telegram_charge_id']);
      t.unique(['ton_comment']);
    });
  }

  if (!(await db.schema.hasTable('transfers'))) {
    await db.schema.createTable('transfers', (t) => {
      t.string('id').primary();
      t.bigInteger('user_id').notNullable().index();
      t.string('asset').notNullable();
      t.bigInteger('price_coins').notNullable();
      t.string('status').notNullable().defaultTo('pending');
      t.string('comment');
      t.timestamp('created_at').defaultTo(db.fn.now());
    });
  }

  // Турниры: новый цикл создаётся раз в 3 дня. Игроки набирают очки за раунды.
  if (!(await db.schema.hasTable('tournaments'))) {
    await db.schema.createTable('tournaments', (t) => {
      t.string('id').primary();
      t.string('title').notNullable();
      t.timestamp('starts_at').notNullable();
      t.timestamp('ends_at').notNullable();
      t.string('status').notNullable().defaultTo('active'); // active | settled
      t.json('prizes').notNullable();
      t.timestamp('created_at').defaultTo(db.fn.now());
    });
  }

  if (!(await db.schema.hasTable('tournament_entries'))) {
    await db.schema.createTable('tournament_entries', (t) => {
      t.increments('id').primary();
      t.string('tournament_id').notNullable().index();
      t.bigInteger('user_id').notNullable().index();
      t.bigInteger('score').notNullable().defaultTo(0);
      t.bigInteger('rounds_played').notNullable().defaultTo(0);
      t.timestamp('updated_at').defaultTo(db.fn.now());
      t.unique(['tournament_id', 'user_id']);
    });
  }

  // PvP лобби: 36 карт по 5 монет, 30–40 секунд после первой покупки.
  if (!(await db.schema.hasTable('pvp_lobbies'))) {
    await db.schema.createTable('pvp_lobbies', (t) => {
      t.string('id').primary();
      t.string('mode').notNullable();
      t.integer('card_count').notNullable();
      t.bigInteger('entry_coins').notNullable();
      t.string('status').notNullable().defaultTo('open'); // open | sealing | settled
      t.string('server_seed').notNullable();
      t.string('server_seed_hash').notNullable();
      t.integer('ttl_ms').notNullable().defaultTo(35000);
      t.timestamp('opened_at').nullable();
      t.timestamp('ends_at').nullable();
      t.timestamp('settled_at').nullable();
      t.timestamp('created_at').defaultTo(db.fn.now());
    });
  } else {
    const lobbyCols = await db('pvp_lobbies').columnInfo();
    if (!lobbyCols.ttl_ms) await db.schema.alterTable('pvp_lobbies', (t) => t.integer('ttl_ms').notNullable().defaultTo(35000));
  }

  if (!(await db.schema.hasTable('pvp_cards'))) {
    await db.schema.createTable('pvp_cards', (t) => {
      t.string('lobby_id').notNullable().index();
      t.integer('card_index').notNullable();
      t.bigInteger('user_id').nullable().index();
      t.string('status').notNullable().defaultTo('free'); // free | taken | revealed
      t.string('outcome_key').notNullable();
      t.string('outcome_type').notNullable();
      t.bigInteger('credit').notNullable().defaultTo(0);
      t.string('stamp').nullable();
      t.string('idempotency_key').nullable();
      t.boolean('was_free').notNullable().defaultTo(false);
      t.timestamp('taken_at').nullable();
      t.timestamp('revealed_at').nullable();
      t.primary(['lobby_id', 'card_index']);
      t.unique(['idempotency_key']);
    });
  } else {
    const pvpCols = await db('pvp_cards').columnInfo();
    if (!pvpCols.idempotency_key) await db.schema.alterTable('pvp_cards', (t) => t.string('idempotency_key').nullable());
    if (!pvpCols.was_free)        await db.schema.alterTable('pvp_cards', (t) => t.boolean('was_free').notNullable().defaultTo(false));
    // Add unique index on idempotency_key if not exists (catch for SQLite)
    try {
      await db.schema.alterTable('pvp_cards', (t) => t.unique(['idempotency_key']));
    } catch {}
  }

  // Кланы
  if (!(await db.schema.hasTable('clans'))) {
    await db.schema.createTable('clans', (t) => {
      t.increments('id').primary();
      t.string('name').notNullable().unique();
      t.string('tag', 8).notNullable();
      t.bigInteger('owner_id').notNullable().index();
      t.text('description').nullable();
      t.bigInteger('total_wagered').notNullable().defaultTo(0);
      t.timestamp('created_at').defaultTo(db.fn.now());
    });
  }
  if (!(await db.schema.hasTable('clan_members'))) {
    await db.schema.createTable('clan_members', (t) => {
      t.increments('id').primary();
      t.integer('clan_id').notNullable().index();
      t.bigInteger('user_id').notNullable().unique();
      t.string('role').notNullable().defaultTo('member'); // owner | member
      t.timestamp('joined_at').defaultTo(db.fn.now());
    });
  }

  // Покупки Portals/NFT
  if (!(await db.schema.hasTable('portals_purchases'))) {
    await db.schema.createTable('portals_purchases', (t) => {
      t.string('id').primary();
      t.bigInteger('user_id').notNullable().index();
      t.string('gift_id').notNullable();
      t.string('gift_name').notNullable();
      t.bigInteger('price_coins').notNullable();
      t.string('status').notNullable().defaultTo('pending'); // pending | sent | failed
      t.timestamp('created_at').defaultTo(db.fn.now());
      t.timestamp('sent_at').nullable();
    });
  }

  // Реферальные начисления (логи для прозрачности).
  if (!(await db.schema.hasTable('ref_payouts'))) {
    await db.schema.createTable('ref_payouts', (t) => {
      t.increments('id').primary();
      t.bigInteger('referrer_id').notNullable().index();
      t.bigInteger('referee_id').notNullable().index();
      t.string('deposit_id').notNullable();
      t.bigInteger('amount').notNullable();
      t.timestamp('created_at').defaultTo(db.fn.now());
      t.unique(['deposit_id']);
    });
  }
}

// Allow `node lib/migrate.js` direct run
if (import.meta.url === `file://${process.argv[1]}`.replace(/\\/g, '/')) {
  migrate()
    .then(() => {
      console.log('migrations applied');
      return db.destroy();
    })
    .catch((e) => {
      console.error(e);
      process.exit(1);
    });
}
