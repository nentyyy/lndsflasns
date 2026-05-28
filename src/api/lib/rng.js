import { randomBytes, createHmac } from 'node:crypto';

// Commit: generate a server seed and publish only its hash up front.
export function createServerSeed() {
  const serverSeed = randomBytes(32).toString('hex');
  const serverSeedHash = createHmac('sha256', serverSeed).update('commit').digest('hex');
  return { serverSeed, serverSeedHash };
}

// Deterministic, verifiable roll in [0,1). The player can reproduce this
// after we reveal serverSeed, using clientSeed + nonce + clauseIndex.
export function roll(serverSeed, clientSeed, nonce, clauseIndex) {
  const digest = createHmac('sha256', serverSeed)
    .update(`${clientSeed}:${nonce}:${clauseIndex}`)
    .digest();
  return digest.readUInt32BE(0) / 0x100000000;
}

// Pick a weighted outcome from a mode using a uniform roll.
export function pickOutcome(mode, r) {
  const total = mode.outcomes.reduce((s, o) => s + o.weight, 0);
  let acc = 0;
  for (const o of mode.outcomes) {
    acc += o.weight / total;
    if (r < acc) return o;
  }
  return mode.outcomes[mode.outcomes.length - 1];
}
