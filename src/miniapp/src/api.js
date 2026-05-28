// Thin client for the DEADWILL backend.
const BASE = import.meta.env.VITE_API_BASE || '';

function authHeaders() {
  const initData = window.Telegram?.WebApp?.initData;
  if (initData) return { Authorization: `tma ${initData}` };
  return { 'X-Dev-User': '1' };
}

async function request(path, { method = 'GET', body } = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...authHeaders()
    },
    body: body ? JSON.stringify(body) : undefined
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || `http_${res.status}`);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

function uuid() {
  return crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function startParamRef() {
  try {
    const sp = window.Telegram?.WebApp?.initDataUnsafe?.start_param;
    if (sp && /^DW/i.test(sp)) return sp;
  } catch {}
  return null;
}

export const api = {
  bootstrap: () => {
    const ref = startParamRef();
    const qs = ref ? `?ref=${encodeURIComponent(ref)}` : '';
    return request(`/api/bootstrap${qs}`);
  },
  me: () => request('/api/me'),
  referral: () => request('/api/referral'),
  bindReferral: (code) => request('/api/referral/bind', { method: 'POST', body: { code } }),
  claimReferral: () => request('/api/referral/claim', { method: 'POST', body: {} }),
  tournament: () => request('/api/tournament'),
  pvpState: (mode = 'cheap') => request(`/api/pvp/state?mode=${encodeURIComponent(mode)}`),
  // SECURITY: only send mode, cardIndex, idempotencyKey — never prize/reward/amount
  pvpBuy: (mode, cardIndex) => request('/api/pvp/buy', { method: 'POST', body: { mode, cardIndex, idempotencyKey: uuid() } }),
  buyTickets: (type, packId) => request('/api/tickets/buy', { method: 'POST', body: { type, packId } }),
  arm: (modeId) => request('/api/rounds/arm', { method: 'POST', body: { modeId, clientSeed: uuid(), idempotencyKey: uuid() } }),
  reveal: (roundId, clauseIndex) => request('/api/rounds/reveal', { method: 'POST', body: { roundId, clauseIndex } }),
  createDeposit: (method, packId) => request('/api/deposits', { method: 'POST', body: { method, packId } }),
  depositStatus: (id) => request(`/api/deposits/${id}`),
  history: () => request('/api/history'),
  playerProfile: (userId) => request(`/api/players/${userId}`),
  liveFeed: () => request('/api/feed'),
  portalsBuy: (giftId, giftName, priceCoins) => request('/api/portals/buy', { method: 'POST', body: { giftId, giftName, priceCoins } }),
  // Admin
  adminUsers: (limit = 50, offset = 0) => request(`/api/admin/users?limit=${limit}&offset=${offset}`),
  adminDeposits: (limit = 50, offset = 0) => request(`/api/admin/deposits?limit=${limit}&offset=${offset}`),
  adminRounds: (limit = 50, offset = 0) => request(`/api/admin/rounds?limit=${limit}&offset=${offset}`),
  adminLiveRounds: () => request('/api/admin/live-rounds'),
  adminReferrals: () => request('/api/admin/referrals'),
  adminLedger: (limit = 100, offset = 0) => request(`/api/admin/ledger?limit=${limit}&offset=${offset}`),
  adminPortals: () => request('/api/admin/portals'),
  adminEconomy: () => request('/api/admin/economy'),
  adminAdjustBalance: (userId, amount, reason) => request(`/api/admin/users/${userId}/adjust`, { method: 'POST', body: { amount, reason } })
};
