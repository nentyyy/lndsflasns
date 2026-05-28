import { db } from './lib/db.js';

const USER_ID = '1';
const AMOUNT = 67000;

const player = await db('players').where({ user_id: USER_ID }).first();
if (!player) {
  await db('players').insert({ user_id: USER_ID, username: 'dev', first_name: 'Dev', balance: AMOUNT });
  console.log(`Created player with balance ${AMOUNT}`);
} else {
  const newBalance = Number(player.balance) + AMOUNT;
  await db('players').where({ user_id: USER_ID }).update({ balance: newBalance });
  await db('ledger').insert({
    user_id: USER_ID,
    ref_type: 'deposit_stars',
    ref_id: `admin-${Date.now()}`,
    amount: AMOUNT,
    balance_after: newBalance
  });
  console.log(`Balance updated: ${player.balance} → ${newBalance}`);
}

await db.destroy();
