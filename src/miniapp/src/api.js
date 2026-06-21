// DEADWILL API client — auth priority: bot-token > initData
let BASE = import.meta.env.VITE_API_BASE || '';
// Prod safety: никогда не ходить на localhost API со страницы не-localhost
// (защита от случайно запечённого VITE_API_BASE=http://localhost:3000).
if (BASE && /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(BASE) &&
    typeof location !== 'undefined' && !/^(localhost|127\.0\.0\.1)$/i.test(location.hostname)) {
  BASE = '';
}
const BOT_TOKEN_KEY = 'dw_bot_token';
const BOT_TOKEN_EXP_KEY = 'dw_bot_token_exp';

function saveToken(t) {
  const exp = Date.now() + 7 * 24 * 60 * 60 * 1000;
  try { localStorage.setItem(BOT_TOKEN_KEY, t); localStorage.setItem(BOT_TOKEN_EXP_KEY, String(exp)); } catch {}
}

// Ищем токен в URL query, hash, start_param и localStorage
function extractBotToken() {
  try {
    // 1. URL query string: ?startapp=token:XXX (web_app кнопки передают так)
    const urlParams = new URLSearchParams(window.location.search);
    const qStartapp = urlParams.get('startapp') || urlParams.get('token') || '';
    if (qStartapp.startsWith('token:')) {
      const t = qStartapp.slice(6);
      if (t) { saveToken(t); return t; }
    }

    // 2. URL hash: #tgWebAppStartParam=token:XXX
    const hash = window.location.hash || '';
    const hashParams = new URLSearchParams(hash.startsWith('#') ? hash.slice(1) : hash);
    const hashStart = hashParams.get('tgWebAppStartParam') || '';
    if (hashStart.startsWith('token:')) {
      const t = hashStart.slice(6);
      if (t) { saveToken(t); return t; }
    }

    // 3. initDataUnsafe.start_param (deeplinks t.me/bot?start=token:XXX)
    const sp = window.Telegram?.WebApp?.initDataUnsafe?.start_param || '';
    if (sp.startsWith('token:')) {
      const t = sp.slice(6);
      if (t) { saveToken(t); return t; }
    }

    // 4. tgWebAppData в initData (Telegram иногда передаёт параметры здесь)
    const initDataRaw = window.Telegram?.WebApp?.initData || '';
    if (initDataRaw) {
      const p = new URLSearchParams(initDataRaw);
      const startParam = p.get('start_param') || '';
      if (startParam.startsWith('token:')) {
        const t = startParam.slice(6);
        if (t) { saveToken(t); return t; }
      }
    }

    // 5. localStorage (уже авторизован)
    const saved = localStorage.getItem(BOT_TOKEN_KEY);
    const exp = Number(localStorage.getItem(BOT_TOKEN_EXP_KEY) || 0);
    if (saved && exp > Date.now()) return saved;
  } catch {}
  return null;
}

function clearBotToken() {
  try { localStorage.removeItem(BOT_TOKEN_KEY); localStorage.removeItem(BOT_TOKEN_EXP_KEY); } catch {}
}

function authHeaders() {
  // Только два доверенных способа: bot-token (выдаёт бот на /start) и
  // подписанный Telegram initData. Никаких dev-заголовков.
  const botToken = extractBotToken();
  if (botToken) return { 'X-Bot-Token': botToken };

  const initData = window.Telegram?.WebApp?.initData;
  if (initData) return { Authorization: `tma ${initData}` };

  return {}; // нет доверенных кредов → сервер вернёт 401
}

async function request(path, { method = 'GET', body } = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: body ? JSON.stringify(body) : undefined
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 401) clearBotToken(); // токен протух — удаляем
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
  claimMilestone: (milestoneId) => request('/api/referral/milestone', { method: 'POST', body: { milestoneId } }),
  pvpState: (mode = 'cheap') => request(`/api/pvp/state?mode=${encodeURIComponent(mode)}`),
  pvpBuy: (mode, cardIndex) => request('/api/pvp/buy', { method: 'POST', body: { mode, cardIndex, idempotencyKey: uuid() } }),
  pvpBuyRandom: (mode, count) => request('/api/pvp/buy-random', { method: 'POST', body: { mode, count, idempotencyKey: uuid() } }),
  wheel: () => request('/api/wheel'),
  wheelSpin: () => request('/api/wheel/spin', { method: 'POST', body: {} }),
  buyTickets: (type, packId) => request('/api/tickets/buy', { method: 'POST', body: { type, packId } }),
  buyTicketsCustom: (type, count) => request('/api/tickets/buy-custom', { method: 'POST', body: { type, count } }),
  arm: (modeId, bet) => request('/api/rounds/arm', { method: 'POST', body: { modeId, bet, clientSeed: uuid(), idempotencyKey: uuid() } }),
  reveal: (roundId, clauseIndex) => request('/api/rounds/reveal', { method: 'POST', body: { roundId, clauseIndex } }),
  riskPlay: (cells, pick, bet) => request('/api/risk/play', { method: 'POST', body: { cells, pick, bet } }),
  createDeposit: (method, packId) => request('/api/deposits', { method: 'POST', body: { method, packId } }),
  createStarsCustom: (coins) => request('/api/deposits/stars', { method: 'POST', body: { coins } }),
  createTonCustom: (coins) => request('/api/deposits/ton', { method: 'POST', body: { coins } }),
  createSendDeposit: (amountTon) => request('/api/deposits/create', { method: 'POST', body: { amountTon } }),
  depositStatus: (id) => request(`/api/deposits/${id}`),
  history: () => request('/api/history'),
  playerProfile: (userId) => request(`/api/players/${userId}`),
  liveFeed: () => request('/api/feed'),
  leaderboard: () => request('/api/leaderboard'),
  stats: () => request('/api/stats'),
  rounds: (sort = 'all', offset = 0, limit = 20) => request(`/api/rounds?sort=${sort}&offset=${offset}&limit=${limit}`),
  roundDetail: (id) => request(`/api/rounds/${id}`),
  gifts: () => request('/api/gifts'),
  portalsBuy: (giftId) => request('/api/portals/buy', { method: 'POST', body: { giftId, idempotencyKey: uuid() } }),
  adminUsers: (limit = 50, offset = 0) => request(`/api/admin/users?limit=${limit}&offset=${offset}`),
  adminDeposits: (limit = 50, offset = 0) => request(`/api/admin/deposits?limit=${limit}&offset=${offset}`),
  adminRounds: (limit = 50, offset = 0) => request(`/api/admin/rounds?limit=${limit}&offset=${offset}`),
  adminLiveRounds: () => request('/api/admin/live-rounds'),
  adminReferrals: () => request('/api/admin/referrals'),
  adminLedger: (limit = 100, offset = 0) => request(`/api/admin/ledger?limit=${limit}&offset=${offset}`),
  adminPortals: () => request('/api/admin/portals'),
  adminEconomy: () => request('/api/admin/economy'),
  adminAdjustBalance: (userId, amount, reason) => request(`/api/admin/users/${userId}/adjust`, { method: 'POST', body: { amount, reason } }),
  // Artifacts
  shopArtifacts: () => request('/api/shop/artifacts'),
  buyArtifact: (artifactId) => request('/api/shop/artifacts/buy', { method: 'POST', body: { artifactId } }),
  myArtifacts: () => request('/api/player/artifacts'),
  useArtifact: (artifactId, targetCells = []) => request('/api/player/artifacts/use', { method: 'POST', body: { artifactId, targetCells } }),
  shopPoints: () => request('/api/shop/points'),
  spendPoints: (itemId, targetId) => request('/api/shop/points/spend', { method: 'POST', body: { itemId, targetId } }),
  // Lucky Buy
  luckyBuy: (giftId, chancePercent) => request('/api/lucky-buy', { method: 'POST', body: { giftId, chancePercent } }),
  luckyFeed: () => request('/api/lucky-buy/feed'),
  // Inventory
  inventory: () => request('/api/player/inventory'),
  sellInvItem: (id, kind) => request(`/api/player/inventory/${id}/sell`, { method: 'POST', body: { kind } }),
  withdrawInvItem: (id) => request(`/api/player/inventory/${id}/withdraw`, { method: 'POST', body: {} }),
  // Clans
  clans: () => request('/api/clans'),
  myClan: () => request('/api/clans/my'),
  clanLeaderboard: () => request('/api/clans/leaderboard'),
  createClan: (name, tag, description) => request('/api/clans', { method: 'POST', body: { name, tag, description } }),
  updateClan: (id, description) => request(`/api/clans/${id}`, { method: 'PUT', body: { description } }),
  deleteClan: (id) => request(`/api/clans/${id}`, { method: 'DELETE', body: {} }),
  joinClan: (id) => request(`/api/clans/${id}/join`, { method: 'POST', body: {} }),
  leaveClan: (id) => request(`/api/clans/${id}/leave`, { method: 'POST', body: {} }),
  kickMember: (clanId, userId) => request(`/api/clans/${clanId}/kick/${userId}`, { method: 'POST', body: {} }),
  setRole: (clanId, userId, role) => request(`/api/clans/${clanId}/role/${userId}`, { method: 'PUT', body: { role } }),
  contributeChest: (clanId, amount) => request(`/api/clans/${clanId}/chest/contribute`, { method: 'POST', body: { amount } }),
  withdrawChest: (clanId, amount) => request(`/api/clans/${clanId}/chest/withdraw`, { method: 'POST', body: { amount } }),
  clanChat: (clanId) => request(`/api/clans/${clanId}/chat`),
  sendClanChat: (clanId, text) => request(`/api/clans/${clanId}/chat`, { method: 'POST', body: { text } }),
  tradeRequest: (clanId, artifactId) => request(`/api/clans/${clanId}/trade/request`, { method: 'POST', body: { artifactId } }),
  tradeRequestCard: (clanId) => request(`/api/clans/${clanId}/trade/request-card`, { method: 'POST', body: {} }),
  tradeGive: (clanId, messageId) => request(`/api/clans/${clanId}/trade/give`, { method: 'POST', body: { messageId } }),
};
