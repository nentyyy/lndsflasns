// DEADWILL API client — auth priority: bot-token > initData > dev fallback
const BASE = import.meta.env.VITE_API_BASE || '';
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
  // Приоритет 1: Bot token (самый надёжный)
  const botToken = extractBotToken();
  if (botToken) return { 'X-Bot-Token': botToken };

  const webApp = window.Telegram?.WebApp;
  const initData = webApp?.initData;

  // Приоритет 2: полный initData (открыто через кнопку бота)
  if (initData) return { Authorization: `tma ${initData}` };

  // Приоритет 3: initDataUnsafe.user.id (открыто ссылкой в Telegram)
  const userId = webApp?.initDataUnsafe?.user?.id;
  if (userId) return { 'X-Dev-User': String(userId) };

  // Fallback: dev
  return { 'X-Dev-User': '1' };
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
  pvpState: (mode = 'cheap') => request(`/api/pvp/state?mode=${encodeURIComponent(mode)}`),
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
  adminUsers: (limit = 50, offset = 0) => request(`/api/admin/users?limit=${limit}&offset=${offset}`),
  adminDeposits: (limit = 50, offset = 0) => request(`/api/admin/deposits?limit=${limit}&offset=${offset}`),
  adminRounds: (limit = 50, offset = 0) => request(`/api/admin/rounds?limit=${limit}&offset=${offset}`),
  adminLiveRounds: () => request('/api/admin/live-rounds'),
  adminReferrals: () => request('/api/admin/referrals'),
  adminLedger: (limit = 100, offset = 0) => request(`/api/admin/ledger?limit=${limit}&offset=${offset}`),
  adminPortals: () => request('/api/admin/portals'),
  adminEconomy: () => request('/api/admin/economy'),
  adminAdjustBalance: (userId, amount, reason) => request(`/api/admin/users/${userId}/adjust`, { method: 'POST', body: { amount, reason } }),
  clans: () => request('/api/clans'),
  createClan: (name, tag, description) => request('/api/clans', { method: 'POST', body: { name, tag, description } }),
  joinClan: (id) => request(`/api/clans/${id}/join`, { method: 'POST', body: {} }),
  leaveClan: (id) => request(`/api/clans/${id}/leave`, { method: 'POST', body: {} })
};
