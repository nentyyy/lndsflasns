import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { useTonConnectUI, useTonWallet } from '@tonconnect/ui-react';
import BottomBar from './components/BottomBar';
import AdminPanel from './components/AdminPanel';
import Splash from './components/Splash';
import { api } from './api.js';
import {
  createInitialState,
  formatCoins,
  formatCompact,
  historyFilters,
  parseRewardCredit,
  transferTone,
  XP_PER_LEVEL,
  XP_PER_ROUND
} from './data/mock.js';
import { NFT_RARITIES, RARITY_COLOR } from './data/gifts-catalog.js';

const toneByType = { coins: 'gold', bonus: 'gold', multiplier: 'violet', empty: 'muted', debt: 'danger' };
const titleByType = {
  coins: 'Выигрыш', bonus: 'Golden bonus', multiplier: 'Множитель x2',
  empty: 'Пустой контракт', debt: 'Проклятый долг'
};
function mapResult(r) {
  return {
    type: r.type,
    stamp: r.stamp,
    creditCoins: r.credit,
    tone: toneByType[r.type] || 'gold',
    title: titleByType[r.type] || 'Результат',
    note: r.usedMultiplier ? 'Множитель применён. Монеты зачислены.' : '',
    nextMultiplier: r.nextMultiplier
  };
}

const tabs = ['play', 'shop', 'profile'];
const shopTabs = ['nft'];
const PREMIUM_CARDS = 5;

// Единый helper для отображения пользователя — используется везде
function userDisplay(p) {
  if (!p) return { displayName: 'Игрок', initial: 'И', avatarUrl: null, badge: null };
  const id = p.id || p.userId || p.user_id || '';
  const u = p.username || '';
  const displayName = u
    ? `@${u}`
    : [p.name, p.firstName, p.first_name, p.lastName, p.last_name]
        .map(v => (v || '').trim())
        .filter(v => v && v !== 'Dev')
        .join(' ')
        .trim() || `Player #${String(id).slice(-4)}`;
  const initial = displayName.replace(/^@/, '').slice(0, 1).toUpperCase() || 'P';
  const avatarUrl = p.avatarUrl || p.photoUrl || null;
  // Бейджи (Founder/Admin) не показываем никому — роль работает на бэке.
  const badge = null;
  return { displayName, initial, avatarUrl, badge };
}

// Кодируем text-комментарий для TON-перевода как base64 BoC.
// Формат ячейки: 4 байта (op = 0) + UTF-8 строка, упаковано в Bag of Cells.
function encodeTonComment(text) {
  const encoder = new TextEncoder();
  const textBytes = encoder.encode(text);
  // 4 байта op (0) + текст
  const payload = new Uint8Array(4 + textBytes.length);
  payload.set([0, 0, 0, 0], 0);
  payload.set(textBytes, 4);
  const bits = payload.length * 8;
  // Cell descriptors: refs=0, hasBits, fullBytes
  const d1 = 0; // 0 refs, ordinary
  const d2 = ((bits / 8) | 0) * 2; // augmented = even
  // BoC serialization (упрощённая, для 1 cell без рефов)
  // header: magic b5ee9c72, flags=00 (has_idx=0, has_crc32=0, hasCacheBits=0, flags=0, sizeBytes=1)
  // offsetBytes=1, cellCount=1, rootCount=1, absent=0, totalCellSize=2+payload.length
  const cellSize = 2 + payload.length;
  const boc = new Uint8Array(4 + 1 + 1 + 1 + 1 + 1 + 1 + 1 + cellSize);
  let off = 0;
  boc.set([0xb5, 0xee, 0x9c, 0x72], off); off += 4;
  boc[off++] = 0x01; // size_bytes & flags: has_idx=0, hash_crc=0, has_cache_bits=0, flags=0, size_bytes=1
  boc[off++] = 0x01; // off_bytes=1
  boc[off++] = 0x01; // cells=1
  boc[off++] = 0x01; // roots=1
  boc[off++] = 0x00; // absent=0
  boc[off++] = cellSize; // tot_cells_size=cellSize
  boc[off++] = 0x00; // root_list: index 0
  boc[off++] = d1;
  boc[off++] = d2;
  boc.set(payload, off);
  // → base64
  let bin = '';
  for (let i = 0; i < boc.length; i++) bin += String.fromCharCode(boc[i]);
  return btoa(bin);
}

function App() {
  const [state, setState] = useState(createInitialState);
  const [tab, setTab] = useState('play');
  const [pvpRoundResult, setPvpRoundResult] = useState(null); // итоговый экран после раунда
  const modeId = 'premium';
  const [willView, setWillView] = useState('pvp'); // pvp | solo
  const [pvpState, setPvpState] = useState(null);
  const [pvpBuying, setPvpBuying] = useState(false);
  const [projectTonWallet, setProjectTonWallet] = useState(null);
  const [ticketPacks, setTicketPacks] = useState({ cheap: [], premium: [] });
  const [splashActive, setSplashActive] = useState(true);
  const [bootReady, setBootReady] = useState(false);
  const [refData, setRefData] = useState(null);
  const [roundArmed, setRoundArmed] = useState(false);
  const [selectedClause, setSelectedClause] = useState(null);
  const [revealing, setRevealing] = useState(false);
  const [result, setResult] = useState(null);
  const [shopTab, setShopTab] = useState('nft');
  const [historyFilter, setHistoryFilter] = useState('all');
  const [toast, setToast] = useState(null);
  const [depositOpen, setDepositOpen] = useState(false);
  const [paymentMethod, setPaymentMethod] = useState('stars');
  const [payPending, setPayPending] = useState(false);
  const [adminOpen, setAdminOpen] = useState(false);
  const [roundId, setRoundId] = useState(null);
  const [depositView, setDepositView] = useState('main'); // main | coins | cards
  const [starsPacks, setStarsPacks] = useState([]);
  const [tonPacks, setTonPacks] = useState([]);
  const [tonIntent, setTonIntent] = useState(null);
  const [playerProfileOpen, setPlayerProfileOpen] = useState(null); // {userId, name}
  const [playerProfileData, setPlayerProfileData] = useState(null);
  const [liveWins, setLiveWins] = useState([]);
  const [pvpShuffling, setPvpShuffling] = useState(false);
  const [portalsGifts, setPortalsGifts] = useState([]);
  const [roundsOpen, setRoundsOpen] = useState(false);
  const [authError, setAuthError] = useState(false);

  // Real TON Connect
  const [tonConnectUI] = useTonConnectUI();
  const wallet = useTonWallet();
  const tonWallet = wallet ? { address: wallet.account.address } : null;

  useEffect(() => {
    const webApp = window.Telegram?.WebApp;
    if (!webApp) return;
    webApp.ready();
    webApp.expand();
    try {
      webApp.setHeaderColor?.('#0b0b10');
      webApp.setBackgroundColor?.('#070707');
    } catch (e) {}
  }, []);

  // Pull real balance / stats / packs / tournament / referral from the backend.
  useEffect(() => {
    api.bootstrap()
      .then((data) => {
        setState((current) => ({
          ...current,
          player: { ...current.player, ...data.player },
          history: data.history || current.history
        }));
        setStarsPacks(data.starsPacks || []);
        setTonPacks(data.tonPacks || []);
        if (data.referral) setRefData(data.referral);
        if (data.projectTonWallet) setProjectTonWallet(data.projectTonWallet);
        if (data.ticketPacks) setTicketPacks(data.ticketPacks);
        if (data.liveWins) setLiveWins(data.liveWins);
        if (data.portalsGifts) setPortalsGifts(data.portalsGifts);
      })
      .catch((e) => {
        console.error('bootstrap failed:', e.status, e.message);
        if (e.status === 401) setAuthError(true);
      })
      .finally(() => setBootReady(true));
  }, []);

  // Polling PvP лобби пока пользователь на Will/pvp.
  useEffect(() => {
    let cancelled = false;
    let timer;
    if (tab !== 'play' || willView !== 'pvp') return undefined;
    let prevStatus = null;
    const tick = async () => {
      try {
        const s = await api.pvpState('cheap');
        if (!cancelled) {
          // Раунд только что завершился — авто-показ итогов через 1с
          // (только если игрок участвовал — иначе модал не нужен).
          if (prevStatus === 'open' && s?.lobby?.status === 'settled' && (s.cards || []).some((c) => c.mine)) {
            setTimeout(() => { if (!cancelled) setPvpRoundResult(s); }, 1000);
          }
          prevStatus = s?.lobby?.status || prevStatus;
          setPvpState(s);
          const endsAt = s?.lobby?.endsAt;
          const secsLeft = endsAt ? (new Date(endsAt).getTime() - Date.now()) / 1000 : 999;
          const delay = secsLeft <= 3 ? 400 : secsLeft <= 8 ? 800 : 2000;
          timer = setTimeout(tick, delay);
        }
      } catch (e) {
        if (!cancelled) timer = setTimeout(tick, 2000);
      }
    };
    tick();
    return () => { cancelled = true; clearTimeout(timer); };
  }, [tab, willView]);

  const buyTickets = async (type, pack) => {
    try {
      const res = await api.buyTickets(type, pack.id);
      setState((current) => ({
        ...current,
        player: { ...current.player, coins: res.balance, tickets: res.player.tickets }
      }));
      window.Telegram?.WebApp?.HapticFeedback?.notificationOccurred?.('success');
      notify(`+${pack.count} карт${pack.count > 1 ? '' : 'а'} · ${type === 'cheap' ? 'дешёвых' : 'премиум'}`, 'success');
    } catch (e) {
      if (e.message === 'insufficient_balance') notify('Недостаточно монет', 'danger');
      else notify('Не удалось купить', 'danger');
    }
  };

  // Покупка карт по введённому числу (оплата монетами).
  const buyCardsCount = async (type, count) => {
    const n = parseInt(count, 10);
    if (!n || n < 1) { notify('Введи число карт', 'danger'); return; }
    try {
      const res = await api.buyTicketsCustom(type, n);
      setState((current) => ({
        ...current,
        player: { ...current.player, coins: res.balance, tickets: res.player.tickets }
      }));
      window.Telegram?.WebApp?.HapticFeedback?.notificationOccurred?.('success');
      notify(`+${n} ${type === 'cheap' ? 'PvP' : 'премиум'} карт`, 'success');
    } catch (e) {
      if (e.message === 'insufficient_balance') notify('Недостаточно монет', 'danger');
      else if (e.message === 'bad count') notify('1–500 карт', 'danger');
      else notify('Не удалось купить', 'danger');
    }
  };

  const buyPvpCard = async (cardIndex) => {
    if (pvpBuying) return;
    setPvpBuying(true);
    try {
      const s = await api.pvpBuy('cheap', cardIndex);
      setPvpState({ lobby: s.lobby, cards: s.cards });
      setState((current) => {
        const tickets = { ...current.player.tickets };
        if (s.usedTicket) tickets.cheap = Math.max(0, (tickets.cheap || 0) - 1);
        return {
          ...current,
          player: {
            ...current.player,
            coins: s.balance ?? current.player.coins,
            welcomeAvailable: s.welcomeApplied ? false : current.player.welcomeAvailable,
            pvpTotalReveals: (current.player.pvpTotalReveals || 0) + 1,
            tickets
          }
        };
      });
      notify(
        s.wasFree && !s.welcomeApplied ? 'Бесплатно!' :
        s.welcomeApplied ? 'Приветственная' :
        s.usedTicket    ? 'Билет сожжён' :
        `Карта ${cardIndex + 1}`,
        s.wasFree ? 'success' : 'violet'
      );
      window.Telegram?.WebApp?.HapticFeedback?.impactOccurred?.('medium');
    } catch (e) {
      console.error('pvp buy failed', e);
      if (e.message === 'card already taken') notify('Карту уже забрали', 'danger');
      else if (e.message === 'insufficient_balance') notify('Недостаточно монет', 'danger');
      else if (e.status === 401) notify('Сессия истекла — открой игру заново через бота', 'danger');
      else if (!e.status) notify('Бэкенд не отвечает (порт 3000?)', 'danger');
      else notify(`Ошибка ${e.status}: ${e.message}`, 'danger');
    } finally {
      setPvpBuying(false);
    }
  };

  const openPlayerProfile = useCallback(async (userId) => {
    if (!userId) return;
    setPlayerProfileOpen({ userId });
    setPlayerProfileData(null);
    try {
      const data = await api.playerProfile(userId);
      setPlayerProfileData(data);
    } catch (e) {
      setPlayerProfileData({ error: true });
    }
  }, []);

  const claimRef = async () => {
    try {
      const res = await api.claimReferral();
      if (res.claimed > 0) {
        setState((c) => ({ ...c, player: { ...c.player, coins: res.balance, refPending: 0 } }));
        setRefData((r) => r ? { ...r, pending: 0 } : r);
        notify(`+${formatCoins(res.claimed)} монет реферальных`, 'success');
      } else {
        notify('Нет начислений для вывода', 'default');
      }
    } catch {
      notify('Ошибка сети', 'danger');
    }
  };

  const mode = state.wills.find((item) => item.id === modeId) || state.wills[0];

  const history = useMemo(() => {
    if (historyFilter === 'all') return state.history;
    return state.history.filter((item) => item.type === historyFilter);
  }, [historyFilter, state.history]);

  const notify = (text, tone = 'default') => {
    setToast({ text, tone, id: Date.now() });
    clearTimeout(notify.timer);
    notify.timer = setTimeout(() => setToast(null), 2200);
  };

  // mode фиксирован — премиум. Дешёвое теперь PvP.
  // eslint-disable-next-line no-unused-vars
  const switchMode = () => {};

  const handleStarsPay = async (pack) => {
    const webApp = window.Telegram?.WebApp;
    setPayPending(true);
    try {
      const res = await api.createDeposit('stars', pack.id);
      setPayPending(false);
      if (!res.invoiceLink) {
        notify('Stars не настроены на сервере', 'danger');
        return;
      }
      if (webApp && webApp.openInvoice) {
        webApp.openInvoice(res.invoiceLink, async (status) => {
          if (status === 'paid') {
            webApp.HapticFeedback?.notificationOccurred?.('success');
            try {
              const data = await api.bootstrap();
              setState((c) => ({ ...c, player: { ...c.player, ...data.player } }));
              setDepositOpen(false);
              notify(`+${formatCoins(pack.coins + pack.bonus)} монет зачислено`, 'success');
            } catch { notify('Баланс обновится через секунду', 'default'); }
          } else if (status === 'cancelled') {
            notify('Оплата отменена', 'default');
          } else if (status === 'failed') {
            webApp.HapticFeedback?.notificationOccurred?.('error');
            notify('Платёж не прошёл', 'danger');
          } else {
            notify('Платёж в обработке', 'default');
          }
        });
      } else {
        // Браузерный fallback: открыть инвойс отдельной вкладкой.
        window.open(res.invoiceLink, '_blank', 'noopener,noreferrer');
        notify('Открыли счёт в новой вкладке', 'default');
      }
    } catch (e) {
      setPayPending(false);
      notify(e.status === 401 ? 'Открой в Telegram' : 'Ошибка соединения', 'danger');
    }
  };

  // Динамический Stars-платёж: любая сумма монет (>=1), цена с сервера.
  const handleStarsCustom = async (coins) => {
    const webApp = window.Telegram?.WebApp;
    if (!coins || coins < 1) { notify('Минимум 1 монета (20 ⭐)', 'danger'); return; }
    setPayPending(true);
    try {
      const res = await api.createStarsCustom(coins);
      setPayPending(false);
      if (!res.invoiceLink) { notify('Stars не настроены на сервере', 'danger'); return; }
      const credited = (res.coins || coins) + (res.bonus || 0);
      if (webApp && webApp.openInvoice) {
        webApp.openInvoice(res.invoiceLink, async (status) => {
          if (status === 'paid') {
            webApp.HapticFeedback?.notificationOccurred?.('success');
            try {
              const data = await api.bootstrap();
              setState((c) => ({ ...c, player: { ...c.player, ...data.player } }));
              setDepositOpen(false);
              notify(`+${formatCoins(credited)} монет зачислено`, 'success');
            } catch { notify('Баланс обновится через секунду', 'default'); }
          } else if (status === 'cancelled') notify('Оплата отменена', 'default');
          else if (status === 'failed') notify('Платёж не прошёл', 'danger');
        });
      } else {
        window.open(res.invoiceLink, '_blank', 'noopener,noreferrer');
        notify('Открыли счёт в новой вкладке', 'default');
      }
    } catch (e) {
      setPayPending(false);
      notify(e.status === 401 ? 'Открой в Telegram' : 'Ошибка соединения', 'danger');
    }
  };

  const handleTonPay = async (pack) => {
    setPayPending(true);
    try {
      const res = await api.createDeposit('ton', pack.id);
      setPayPending(false);
      if (!res.depositId) {
        notify('TON-кошелёк проекта не настроен', 'danger');
        return;
      }
      setTonIntent(res);

      // Если подключен TON Connect — открываем подпись транзакции в кошельке.
      if (tonConnectUI && wallet) {
        try {
          // text comment как base64 cell (минимальный BoC c строкой)
          const payload = encodeTonComment(res.comment);
          await tonConnectUI.sendTransaction({
            validUntil: Math.floor(Date.now() / 1000) + 600,
            messages: [{
              address: res.wallet,
              amount: String(res.amountNanoton),
              payload
            }]
          });
          notify('Транзакция отправлена · ждём подтверждения', 'violet');
          // Опрашиваем статус депозита в фоне
          pollDepositUntilPaid(res.depositId, pack);
        } catch (e) {
          notify('Подпись отменена. Используй реквизиты ниже', 'default');
        }
      } else {
        notify('Скопируй комментарий и сумму, либо нажми «Открыть кошелёк»', 'default');
      }
    } catch (e) {
      setPayPending(false);
      notify('Ошибка соединения', 'danger');
    }
  };

  // Динамический TON-платёж на произвольное число монет (через TonConnect).
  const handleTonCustom = async (coins) => {
    if (!coins || coins < 1) { notify('Минимум 1 монета (0.1 TON)', 'danger'); return; }
    setPayPending(true);
    try {
      const res = await api.createTonCustom(coins);
      setPayPending(false);
      if (!res.depositId) { notify('TON-кошелёк проекта не настроен', 'danger'); return; }
      setTonIntent(res);
      const pack = { coins: res.coins, bonus: res.bonus || 0 };
      if (!wallet) {
        // Кошелёк не подключён — открываем окно подключения, затем повторить оплату.
        try { await tonConnectUI.openModal(); } catch {}
        notify('Подключи кошелёк и нажми оплату ещё раз', 'default');
        return;
      }
      try {
        await tonConnectUI.sendTransaction({
          validUntil: Math.floor(Date.now() / 1000) + 600,
          messages: [{ address: res.wallet, amount: String(res.amountNanoton), payload: encodeTonComment(res.comment) }]
        });
        notify('Транзакция отправлена · ждём подтверждения', 'violet');
        pollDepositUntilPaid(res.depositId, pack);
      } catch (e) {
        notify(`Кошелёк отклонил: ${e?.message || 'отмена'}`, 'danger');
      }
    } catch (e) {
      setPayPending(false);
      notify(e.data?.detail || 'Ошибка соединения', 'danger');
    }
  };

  const pollDepositUntilPaid = async (depositId, pack) => {
    const deadline = Date.now() + 5 * 60 * 1000;
    while (Date.now() < deadline) {
      try {
        const s = await api.depositStatus(depositId);
        if (s.status === 'paid' || s.status === 'confirmed') {
          const data = await api.bootstrap();
          setState((c) => ({ ...c, player: { ...c.player, ...data.player } }));
          setDepositOpen(false);
          setTonIntent(null);
          notify(`+${formatCoins(pack.coins + pack.bonus)} монет зачислено`, 'success');
          window.Telegram?.WebApp?.HapticFeedback?.notificationOccurred?.('success');
          return;
        }
      } catch {}
      await new Promise((r) => setTimeout(r, 4000));
    }
  };

  const handleCryptobotPay = async (pack) => {
    setPayPending(true);
    try {
      const res = await api.createDeposit('cryptobot', pack.id);
      setPayPending(false);
      setTonIntent({ ...res, isCryptobot: true });
      // Открываем @send deeplink
      const link = res.deepLink || `https://t.me/send?start=IVA6oMXOKQEF`;
      if (window.Telegram?.WebApp?.openTelegramLink) {
        window.Telegram.WebApp.openTelegramLink(link);
      } else {
        window.open(link, '_blank');
      }
      notify('Укажи сумму и комментарий в @send', 'violet');
      pollDepositUntilPaid(res.depositId, pack);
    } catch (e) {
      setPayPending(false);
      notify('Ошибка соединения', 'danger');
    }
  };

  const connectTonWallet = () => tonConnectUI.openModal();
  const disconnectTonWallet = () => tonConnectUI.disconnect();

  const buyNft = async (item) => {
    if (state.player.coins < item.priceCoins) {
      notify('Недостаточно монет', 'danger');
      return;
    }
    try {
      const res = await api.portalsBuy(item.id);
      setState((c) => ({ ...c, player: { ...c.player, coins: res.player.coins } }));
      notify('Заявка создана — подарок придёт через Portals', 'success');
      window.Telegram?.WebApp?.HapticFeedback?.notificationOccurred?.('success');
    } catch (e) {
      if (e.message === 'insufficient_balance') notify('Недостаточно монет', 'danger');
      else notify('Ошибка при покупке', 'danger');
    }
  };

  // Buy entry on the server: it debits atomically and commits a server seed.
  const armRound = async () => {
    if (roundArmed || result || revealing) return;
    try {
      const out = await api.arm(modeId);
      setState((current) => {
        const tickets = { ...current.player.tickets };
        if (out.usedTicket) tickets.premium = Math.max(0, (tickets.premium || 0) - 1);
        return { ...current, player: { ...current.player, coins: out.balance, tickets } };
      });
      setRoundId(out.roundId);
      setRoundArmed(true);
      notify(out.usedTicket ? 'Сжёг премиум-карту' : 'Завещание запечатано', 'violet');
    } catch (e) {
      if (e.message === 'insufficient_balance') notify('Недостаточно монет для входа', 'danger');
      else notify('Ошибка сети', 'danger');
    }
  };

  // Reveal on the server: it decides the outcome from the committed seed.
  const playRound = async (index) => {
    if (!roundArmed || result || revealing || !roundId) {
      if (!roundArmed && !result) notify('Сначала купи завещание', 'default');
      return;
    }
    setSelectedClause(index);
    setRevealing(true);
    try {
      const out = await api.reveal(roundId, index);
      const resolved = mapResult(out.result);
      window.setTimeout(() => {
        setResult(resolved);
        setRevealing(false);
        setRoundArmed(false);
        setRoundId(null);

        setState((current) => ({
          ...current,
          player: {
            ...current.player,
            coins: out.balance,
            multiplier: resolved.nextMultiplier ?? current.player.multiplier,
            gamesPlayed: current.player.gamesPlayed + 1,
            coinsWon: current.player.coinsWon + resolved.creditCoins,
            bestWin: Math.max(current.player.bestWin, resolved.creditCoins)
          }
        }));
        notify(
          resolved.type === 'debt' ? 'Ставка сгорела' :
          resolved.type === 'empty' ? 'Контракт пуст' : 'Результат зачислен',
          resolved.type === 'debt' ? 'danger' : 'success'
        );
      }, 1180);
    } catch (e) {
      setRevealing(false);
      setSelectedClause(null);
      notify('Ошибка сети', 'danger');
    }
  };

  const resetRound = () => {
    setSelectedClause(null);
    setResult(null);
    setRevealing(false);
    setRoundArmed(false);
    setRoundId(null);
  };

  const joinClan = (clanName) => {
    if (state.clans.myClan.name === clanName) {
      notify('Ты уже в этом клане', 'default');
      return;
    }
    notify(`Заявка в ${clanName} отправлена`, 'violet');
  };

  // Ссылку формирует сервер (правильный username + ref_<userId>).
  const refLink = refData?.link || state.referral?.link
    || `https://t.me/DeadwillGame_bot?start=ref_${state.player?.id || ''}`;

  const copyRefLink = () => {
    navigator.clipboard?.writeText(refLink).catch(() => {});
    window.Telegram?.WebApp?.HapticFeedback?.notificationOccurred('success');
    notify('Ссылка скопирована', 'success');
  };

  const shareRef = () => {
    const text = 'Играй в DEADWILL — выигрывай TON и NFT подарки!';
    const shareUrl = `https://t.me/share/url?url=${encodeURIComponent(refLink)}&text=${encodeURIComponent(text)}`;
    if (window.Telegram?.WebApp?.openTelegramLink) {
      window.Telegram.WebApp.openTelegramLink(shareUrl);
    } else {
      window.open(shareUrl, '_blank');
    }
    notify('Открываем Telegram', 'violet');
  };

  const claimRefReward = (level) => {
    const reward = state.referral.rewards.find((r) => r.level === level);
    if (!reward || reward.state !== 'claimable') return;
    const creditMatch = reward.reward.match(/[\d\s]+/);
    const credit = creditMatch ? parseInt(creditMatch[0].replace(/\s/g, ''), 10) : 0;
    setState((current) => ({
      ...current,
      referral: {
        ...current.referral,
        earned: current.referral.earned + credit,
        rewards: current.referral.rewards.map((r) =>
          r.level === level ? { ...r, state: 'claimed' } : r
        )
      },
      player: { ...current.player, coins: current.player.coins + credit }
    }));
    notify(credit > 0 ? `+${formatCoins(credit)} монет — реферальная награда` : `Награда за реферала #${level} получена`, 'success');
  };

  const adminApproveTransfer = (id) => {
    setState((current) => ({
      ...current,
      transfers: current.transfers.map((t) => t.id === id ? { ...t, status: 'approved' } : t)
    }));
    notify(`Transfer ${id} одобрен`, 'success');
  };

  const adminRejectTransfer = (id) => {
    setState((current) => ({
      ...current,
      transfers: current.transfers.map((t) => t.id === id ? { ...t, status: 'rejected' } : t)
    }));
    notify(`Transfer ${id} отклонен`, 'danger');
  };

  if (authError && !splashActive) {
    return (
      <div className="dw-shell screen-play">
        <div className="dw-global-backdrop" />
        <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 16, padding: 24, textAlign: 'center', position: 'relative', zIndex: 2 }}>
          <div style={{ fontSize: 44 }}>🔒</div>
          <h1 style={{ fontFamily: 'var(--font-display)', color: 'var(--gold-bright)', fontSize: 24, letterSpacing: '0.1em' }}>DEADWILL</h1>
          <p style={{ color: 'var(--bone)', fontSize: 15, maxWidth: 280, lineHeight: 1.5 }}>
            Открой игру через бота, чтобы войти в свой аккаунт.
          </p>
          <a href="https://t.me/DeadwillGame_bot" className="dw-btn-play" style={{ textDecoration: 'none', maxWidth: 280 }}>
            Открыть @DeadwillGame_bot
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className={`dw-shell screen-${tab}`}>
      <AnimatePresence>
        {splashActive && (
          <Splash
            duration={bootReady ? 1800 : 2400}
            onDone={() => setSplashActive(false)}
          />
        )}
      </AnimatePresence>

      <div className="dw-global-backdrop" />
      <div className={`dw-scene scene-${tab}`} />

      <div className="dw-phone-shell">
        <main className="dw-app">
          <TopBar player={state.player} tonWallet={tonWallet} onOpenDeposit={() => { setDepositOpen(true); setDepositView('main'); setTonIntent(null); }} />

          {tab === 'play' && (
            <WillTab
              view={willView}
              onViewChange={setWillView}
              mode={state.wills.find((w) => w.id === 'premium') || state.wills[0]}
              balance={state.player.coins}
              multiplier={state.player.multiplier}
              roundArmed={roundArmed}
              revealing={revealing}
              selectedClause={selectedClause}
              result={result}
              welcomeAvailable={state.player.welcomeAvailable}
              tickets={state.player.tickets || { cheap: 0, premium: 0 }}
              pvpTotalReveals={state.player.pvpTotalReveals || 0}
              pvpState={pvpState}
              pvpBuying={pvpBuying}
              bestWin={state.player.bestWin || 0}
              lastRoundWin={liveWins[0]?.amount || 0}
              onOpenRounds={() => setRoundsOpen(true)}
              onArmRound={armRound}
              onPickClause={playRound}
              onResetRound={resetRound}
              onBuyPvpCard={buyPvpCard}
              onOpenDeposit={() => { setDepositOpen(true); setDepositView('main'); setTonIntent(null); }}
              onOpenShopTickets={() => { setTab('shop'); setShopTab('tickets'); }}
              onOpenPlayerProfile={openPlayerProfile}
            />
          )}

          {tab === 'clans' && (
            <ClansTab
              player={state.player}
              onBack={() => setTab('profile')}
              onNotify={notify}
            />
          )}

          {tab === 'referral' && (
            <ReferralTab
              referral={refData || state.referral}
              player={state.player}
              onCopy={copyRefLink}
              onShare={shareRef}
              onClaimReward={claimRefReward}
              onClaimRef={claimRef}
              onBack={() => setTab('profile')}
            />
          )}

          {tab === 'shop' && (
            <ShopTab
              shop={state.shop}
              player={state.player}
              onBuyNft={buyNft}
              portalsGifts={portalsGifts}
            />
          )}

          {tab === 'profile' && (
            <ProfileTab
              player={state.player}
              filters={historyFilters}
              activeFilter={historyFilter}
              onFilterChange={setHistoryFilter}
              history={history}
              tonWallet={tonWallet}
              onConnectTon={connectTonWallet}
              onDisconnectTon={disconnectTonWallet}
              onOpenAdmin={() => setAdminOpen(true)}
              onOpenClans={() => setTab('clans')}
              onOpenRef={() => setTab('referral')}
              onOpenLeaderboard={() => setTab('leaderboard')}
            />
          )}

          {tab === 'leaderboard' && (
            <LeaderboardTab
              myId={state.player.id}
              liveWins={liveWins}
              onBack={() => setTab('profile')}
            />
          )}
        </main>

        <BottomBar items={tabs} tab={tab} onTabChange={setTab} />
      </div>

      {depositOpen && (
        <DepositSheet
          view={depositView}
          onViewChange={setDepositView}
          method={paymentMethod}
          onClose={() => { setDepositOpen(false); setTonIntent(null); setDepositView('main'); }}
          onMethodChange={setPaymentMethod}
          starsPacks={starsPacks}
          tonPacks={tonPacks}
          onStarsPay={handleStarsPay}
          onStarsCustom={handleStarsCustom}
          onTonPay={handleTonPay}
          onTonCustom={handleTonCustom}
          onBuyCardsCount={buyCardsCount}
          payPending={payPending}
          tonWallet={tonWallet}
          tonIntent={tonIntent}
          onConnectTon={connectTonWallet}
          ticketPacks={ticketPacks}
          onBuyTickets={buyTickets}
          player={state.player}
          notify={notify}
          onSendPaid={async (coins) => {
            try {
              const data = await api.bootstrap();
              setState((c) => ({ ...c, player: { ...c.player, ...data.player } }));
            } catch {}
            notify(`+${formatCoins(coins)} монет зачислено`, 'success');
            window.Telegram?.WebApp?.HapticFeedback?.notificationOccurred?.('success');
            setTimeout(() => { setDepositOpen(false); setDepositView('main'); }, 1500);
          }}
        />
      )}

      {playerProfileOpen && (
        <PlayerProfileModal
          userId={playerProfileOpen.userId}
          data={playerProfileData}
          onClose={() => { setPlayerProfileOpen(null); setPlayerProfileData(null); }}
        />
      )}

      {roundsOpen && (
        <RoundsHistory myId={state.player.id} onClose={() => setRoundsOpen(false)} />
      )}

      {pvpRoundResult && (
        <PvpRoundResultModal
          result={pvpRoundResult}
          myUserId={state.player.id}
          entryCoins={pvpRoundResult.lobby?.entryCoins || 5}
          onClose={() => setPvpRoundResult(null)}
          onOpenDeposit={() => { setPvpRoundResult(null); setDepositOpen(true); setDepositView('main'); }}
        />
      )}

      {(revealing || result) && (
        <ContractOverlay
          mode={mode}
          result={result}
          revealing={revealing}
          selectedClause={selectedClause}
          onReplay={resetRound}
          onClose={resetRound}
        />
      )}

      {adminOpen && (
        <AdminPanel
          state={state}
          onClose={() => setAdminOpen(false)}
          onApproveTransfer={adminApproveTransfer}
          onRejectTransfer={adminRejectTransfer}
        />
      )}

      {toast && <Toast toast={toast} />}
    </div>
  );
}

/* ─── Top bar ─────────────────────────────────────────────── */

function TopBar({ player, tonWallet, onOpenDeposit }) {
  const u = userDisplay(player);
  return (
    <motion.header className="dw-topbar"
      initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, ease: [0.2, 0, 0, 1] }}>
      <div className="dw-profile-compact">
        <div className="dw-avatar" style={u.avatarUrl ? { padding: 0, overflow: 'hidden' } : {}}>
          {u.avatarUrl
            ? <img src={u.avatarUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: '50%' }} />
            : u.initial}
        </div>
        <div className="dw-profile-copy-compact">
          <strong>
            {u.displayName}
            {u.badge && <span className="dw-badge" style={{ fontSize: 10, marginLeft: 6, verticalAlign: 'middle' }}>{u.badge}</span>}
          </strong>
          {tonWallet && (
            <motion.span className="dw-ton-status"
              initial={{ opacity: 0, scale: 0.85 }} animate={{ opacity: 1, scale: 1 }} transition={{ duration: 0.25 }}>
              <span className="dw-ton-dot" />
              <span className="dw-ton-addr">{tonWallet.address.slice(0, 4)}…{tonWallet.address.slice(-4)}</span>
            </motion.span>
          )}
        </div>
      </div>
      <button className="dw-balance-pill" onClick={onOpenDeposit}>
        <span className="dw-coin-dot" />
        <strong className="dw-balance-num">{formatCoins(player.coins)}</strong>
        <span className="dw-plus-sign">+</span>
      </button>
    </motion.header>
  );
}

/* ─── Death Seal · CSS hero ──────────────────────────────── */

function DeathSeal() {
  return (
    <div className="dw-death-seal" aria-hidden="true">
      <div className="dw-seal-glyph">
        <div className="dw-seal-skull">
          <svg viewBox="0 0 100 110" xmlns="http://www.w3.org/2000/svg">
            <defs>
              <linearGradient id="dw-gold-grad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%"  stopColor="#f0d57a" />
                <stop offset="55%" stopColor="#d4af37" />
                <stop offset="100%" stopColor="#8a6c1c" />
              </linearGradient>
            </defs>

            {/* Череп: купол + скуловые кости */}
            <path
              className="skull-fill"
              d="M50 6
                 C 28 6, 14 22, 14 44
                 C 14 56, 18 64, 24 70
                 L 24 80
                 C 24 84, 27 87, 31 87
                 L 33 87
                 L 33 92
                 C 33 95, 35 97, 38 97
                 L 42 97
                 L 42 90
                 L 46 90
                 L 46 97
                 L 54 97
                 L 54 90
                 L 58 90
                 L 58 97
                 L 62 97
                 C 65 97, 67 95, 67 92
                 L 67 87
                 L 69 87
                 C 73 87, 76 84, 76 80
                 L 76 70
                 C 82 64, 86 56, 86 44
                 C 86 22, 72 6, 50 6 Z"
            />

            {/* Глазницы */}
            <ellipse className="skull-eye" cx="34" cy="46" rx="9" ry="11" />
            <ellipse className="skull-eye" cx="66" cy="46" rx="9" ry="11" />

            {/* Тени под глазницами (трещинами) */}
            <path className="skull-shade" d="M30 56 Q 34 62 38 56 L 36 60 L 32 60 Z" />
            <path className="skull-shade" d="M62 56 Q 66 62 70 56 L 68 60 L 64 60 Z" />

            {/* Нос (треугольник) */}
            <path
              className="skull-nose"
              d="M50 58 L 45 72 Q 50 76 55 72 Z"
            />

            {/* Зубы — вертикальные разрезы */}
            <rect className="skull-tooth-gap" x="36" y="80" width="1.6" height="9" />
            <rect className="skull-tooth-gap" x="41" y="80" width="1.6" height="9" />
            <rect className="skull-tooth-gap" x="46" y="80" width="1.6" height="9" />
            <rect className="skull-tooth-gap" x="51" y="80" width="1.6" height="9" />
            <rect className="skull-tooth-gap" x="56" y="80" width="1.6" height="9" />
            <rect className="skull-tooth-gap" x="61" y="80" width="1.6" height="9" />

            {/* Горизонтальная челюстная линия */}
            <rect className="skull-tooth-gap" x="30" y="78" width="40" height="1.2" />

            {/* Трещина на лбу */}
            <path
              className="skull-shade"
              d="M 50 8 L 48 14 L 51 20 L 49 26 L 52 32"
              fill="none"
              stroke="rgba(0,0,0,0.5)"
              strokeWidth="0.8"
              strokeLinecap="round"
            />
          </svg>
        </div>
      </div>
    </div>
  );
}

/* ─── Home tab ────────────────────────────────────────────── */

function HomeTab({ player, liveWins, onOpenPlay, onOpenDeposit }) {
  return (
    <section className="dw-page dw-home-page">
      <motion.div
        className="dw-home-hero"
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
      >
        <DeathSeal />
        <h1 className="dw-hero-title">DEADWILL</h1>
        <p className="dw-hero-tagline">Выбери карту — узнай судьбу</p>
      </motion.div>

      <motion.div
        className="dw-home-actions"
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35, delay: 0.18 }}
      >
        <button className="dw-btn-play" onClick={onOpenPlay}>
          {player.welcomeAvailable ? '🎴  Играть бесплатно' : '🎴  Играть'}
        </button>
        <button className="dw-btn-deposit" onClick={onOpenDeposit}>
          + Пополнить
        </button>
      </motion.div>

      <div className="dw-home-info">
        <div className="dw-home-info-item">
          <span className="dw-home-info-val">5 монет</span>
          <span className="dw-home-info-lbl">вход в раунд</span>
        </div>
        <div className="dw-home-info-sep" />
        <div className="dw-home-info-item">
          <span className="dw-home-info-val">+40 монет</span>
          <span className="dw-home-info-lbl">топ приз</span>
        </div>
        <div className="dw-home-info-sep" />
        <div className="dw-home-info-item">
          <span className="dw-home-info-val">36 карт</span>
          <span className="dw-home-info-lbl">в раунде</span>
        </div>
      </div>

      {liveWins.length > 0 && (
        <div className="dw-live-feed">
          <span className="dw-live-dot" />
          <div className="dw-live-scroll">
            {liveWins.map((w, i) => (
              <span key={i} className="dw-live-item">
                <strong>{w.name}</strong> выиграл {w.amount} монет
              </span>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
/* ─── Play tab ────────────────────────────────────────────── */

function WillTab(props) {
  const { view, onViewChange } = props;
  return (
    <section className="dw-page dw-play-page">
      <div className="dw-will-pager">
        <button
          className={`dw-will-pager-btn ${view === 'pvp' ? 'active' : ''}`}
          onClick={() => onViewChange('pvp')}
        >
          ПВП
          <small>5 монет · 36 карт</small>
        </button>
        <button
          className={`dw-will-pager-btn ${view === 'solo' ? 'active' : ''}`}
          onClick={() => onViewChange('solo')}
        >
          Соло · Премиум
          <small>150 монет · 5 печатей</small>
        </button>
      </div>

      <AnimatePresence mode="wait">
        {view === 'pvp' ? (
          <motion.div
            key="pvp"
            initial={{ opacity: 0, x: -16 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -16 }}
            transition={{ duration: 0.25 }}
          >
            <PvpPanel {...props} />
          </motion.div>
        ) : (
          <motion.div
            key="solo"
            initial={{ opacity: 0, x: 16 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 16 }}
            transition={{ duration: 0.25 }}
          >
            <SoloPanel {...props} />
          </motion.div>
        )}
      </AnimatePresence>
    </section>
  );
}

function pvpTimer(endsAt) {
  if (!endsAt) return null;
  const diff = new Date(endsAt).getTime() - Date.now();
  if (diff <= 0) return '0';
  const s = Math.floor(diff / 1000);
  return `${s}`;
}

// Строим 36-карточный grid: 3 сверху, 6×5 посередине, 3 снизу.
// topRow: [0,1,2], middleRows: [3..32] (6 рядов по 5), bottomRow: [33,34,35]
function buildPvpRows(cardCount) {
  const rows = [];
  if (cardCount <= 0) return rows;
  const top = [0, 1, 2].filter((i) => i < cardCount);
  if (top.length) rows.push({ type: 'center3', indices: top });
  const midStart = Math.min(3, cardCount);
  const midEnd = Math.min(33, cardCount);
  for (let i = midStart; i < midEnd; i += 5) {
    rows.push({ type: 'row5', indices: Array.from({ length: Math.min(5, midEnd - i) }, (_, k) => i + k) });
  }
  const bot = [33, 34, 35].filter((i) => i < cardCount);
  if (bot.length) rows.push({ type: 'center3', indices: bot });
  return rows;
}

function PvpCard({ card, idx, settled, pvpBuying, lowBalance, onBuyPvpCard, onOpenPlayerProfile, shuffling }) {
  const isRevealed = (settled || card.status === 'revealed') && card.outcome;
  const cls = [
    'dw-pvp-card',
    card.taken && !card.mine ? 'taken' : '',
    card.mine ? 'mine' : '',
    isRevealed ? 'revealed' : '',
    isRevealed && card.outcome.type === 'coins' ? 'win' : '',
    isRevealed && card.outcome.type === 'empty' ? 'empty' : '',
    shuffling ? 'shuffling' : ''
  ].filter(Boolean).join(' ');

  return (
    <motion.button
      className={cls}
      disabled={pvpBuying || card.taken || settled || lowBalance}
      onClick={() => onBuyPvpCard(idx)}
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.18, delay: 0.008 * idx }}
      whileTap={{ scale: 0.95 }}
    >
      {card.owner && (() => { const u = userDisplay(card.owner); return (
        <button className="dw-pvp-avatar-btn"
          onClick={(e) => { e.stopPropagation(); onOpenPlayerProfile(card.owner.userId); }}
          title={u.displayName}
          style={u.avatarUrl ? { padding: 0, overflow: 'hidden' } : {}}>
          {u.avatarUrl
            ? <img src={u.avatarUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
            : <span className="dw-pvp-avatar">{u.initial}</span>}
        </button>
      ); })()}
      <span className="dw-pvp-card-num">{idx + 1}</span>
      {!isRevealed && <span className="dw-pvp-card-seal" />}
      {isRevealed && <span className="dw-pvp-card-stamp">{card.outcome.stamp}</span>}
    </motion.button>
  );
}

function PvpPanel({ pvpState, pvpBuying, balance, welcomeAvailable, tickets, pvpTotalReveals, bestWin = 0, lastRoundWin = 0, onOpenRounds, onBuyPvpCard, onOpenDeposit, onOpenPlayerProfile }) {
  const [tick, setTick] = useState(0);
  const [shuffling, setShuffling] = useState(false);
  const prevStatus = React.useRef(null);

  useEffect(() => {
    const t = setInterval(() => setTick((v) => v + 1), 500);
    return () => clearInterval(t);
  }, []);
  void tick;

  // Shuffle animation когда лобби переходит в settled
  useEffect(() => {
    const status = pvpState?.lobby?.status;
    if (prevStatus.current === 'open' && status === 'settled') {
      setShuffling(true);
      setTimeout(() => setShuffling(false), 1200);
    }
    prevStatus.current = status;
  }, [pvpState?.lobby?.status]);

  const lobby = pvpState?.lobby;
  const cards = pvpState?.cards || [];
  const settled = lobby && lobby.status === 'settled';
  const timer = lobby ? pvpTimer(lobby.endsAt) : null;
  const urgent = timer !== null && Number(timer) <= 7 && Number(timer) > 0;
  const idle = !lobby?.openedAt && lobby?.status === 'open';

  const cardCount = lobby?.cardCount ?? 36;
  const entry = lobby?.entryCoins ?? 5;
  const hasTicket = (tickets?.cheap || 0) > 0;
  const welcomeFree = welcomeAvailable && cards.every((c) => !c.mine);
  const cost = welcomeFree || hasTicket ? 0 : entry;
  const lowBalance = balance < cost;
  const myCards = cards.filter((c) => c.mine);
  const priceLabel = welcomeFree ? 'free' : hasTicket ? '1 карта' : `${entry}`;

  // Free spin counter
  const FREE_EVERY = 10;
  const reveals = pvpTotalReveals || 0;
  const tillFree = reveals === 0 ? FREE_EVERY : FREE_EVERY - (reveals % FREE_EVERY);
  const isFreeNext = reveals > 0 && reveals % FREE_EVERY === FREE_EVERY - 1;

  const rows = buildPvpRows(cardCount);

  const getCard = (i) => cards.find((c) => c.index === i) || { index: i, status: 'free', mine: false, taken: false, outcome: null, owner: null };

  const gameNum = lobby?.gameNum ? `#${lobby.gameNum}` : '';

  return (
    <>
      <div className="dw-pvp-header dw-pvp-header--3col">
        <button className="dw-pvp-stat" onClick={onOpenRounds}>
          <span>Лучший ›</span>
          <strong>{formatCoins(bestWin)}</strong>
        </button>
        <div className={`dw-pvp-timer ${urgent ? 'urgent' : idle || settled ? 'idle' : ''}`}>
          {settled ? '00' : timer ?? '35'}<span style={{ fontSize: 11, marginLeft: 4, opacity: 0.7 }}>с</span>
        </div>
        <button className="dw-pvp-stat dw-pvp-stat--right" onClick={onOpenRounds}>
          <span>Прошлый раунд ›</span>
          <strong>{formatCoins(lastRoundWin)}</strong>
        </button>
      </div>

      <div className="dw-pvp-grid-36">
        {rows.map((row, ri) => (
          <div key={ri} className={`dw-pvp-row ${row.type}`}>
            {row.indices.map((i) => (
              <PvpCard
                key={i}
                card={getCard(i)}
                idx={i}
                settled={settled}
                pvpBuying={pvpBuying}
                lowBalance={lowBalance}
                onBuyPvpCard={onBuyPvpCard}
                onOpenPlayerProfile={onOpenPlayerProfile}
                shuffling={shuffling}
              />
            ))}
          </div>
        ))}
      </div>

      {/* Free spin counter */}
      <div className="dw-pvp-free-counter">
        {isFreeNext
          ? <span className="dw-free-next">Следующее открытие — <strong>бесплатное!</strong></span>
          : <span>Ещё <strong>{tillFree}</strong> открытий до бесплатного</span>
        }
      </div>

      <div className="dw-pvp-footer">
        <span>
          {formatCoins(balance)} монет · моих: <strong>{myCards.length}</strong>
          {hasTicket && <span className="dw-ticket-pill" style={{ marginLeft: 8 }}>{tickets.cheap}×карт</span>}
        </span>
        <span>Цена: <strong>{priceLabel}</strong></span>
      </div>

      {/* Номер игры */}
      {gameNum && (
        <div className="dw-pvp-game-num">Игра {gameNum}</div>
      )}

      {settled && (
        <div className="dw-pvp-empty">
          Раунд завершён. Новое лобби откроется — нажми свободную карту.
        </div>
      )}

      {!settled && lowBalance && (
        <button className="dw-btn ghost full" onClick={onOpenDeposit}>
          пополнить · мало монет
        </button>
      )}
    </>
  );
}

function SoloPanel({
  mode, balance, multiplier, roundArmed, revealing, selectedClause, result, tickets,
  onArmRound, onPickClause, onResetRound, onOpenDeposit
}) {
  const hasTicket = (tickets?.premium || 0) > 0;
  const entry = mode?.entryCoins ?? 150;
  const cost = hasTicket ? 0 : entry;
  const lowBalance = balance < cost;

  return (
    <>
      {multiplier > 1 && (
        <div className="dw-play-mult-bar">
          <span className="dw-badge">×{multiplier}</span>
        </div>
      )}

      <div className={`dw-contracts-row ${roundArmed ? 'armed' : ''}`}>
        {Array.from({ length: PREMIUM_CARDS }).map((_, index) => {
          const selected = selectedClause === index;
          const dimmed = selectedClause !== null && !selected;
          return (
            <motion.button
              key={index}
              className={`dw-contract-card ${selected ? 'selected' : ''} ${dimmed ? 'dimmed' : ''}`}
              onClick={() => onPickClause(index)}
              disabled={!roundArmed || revealing || Boolean(result)}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.25, delay: 0.03 * index, ease: [0.2, 0, 0, 1] }}
              whileTap={{ scale: 0.94 }}
            >
              <span className="dw-contract-num">{index + 1}</span>
            </motion.button>
          );
        })}
      </div>

      <div className="dw-play-action">
        <p className="dw-play-meta-line">
          {formatCoins(balance)} монет · вход {hasTicket
            ? <span className="gold">1 карта</span>
            : <span className="gold">{formatCoins(entry)}</span>}
          {hasTicket && <span className="dw-ticket-pill" style={{ marginLeft: 8 }}>{tickets.premium} в инвентаре</span>}
        </p>
        {roundArmed ? (
          <p className="dw-play-hint">выбери одну из пяти</p>
        ) : lowBalance ? (
          <button className="dw-btn ghost full" onClick={onOpenDeposit}>пополнить · недостаточно монет</button>
        ) : (
          <button className="dw-btn primary full" onClick={onArmRound} disabled={revealing || Boolean(result)}>
            запечатать · {hasTicket ? 'сжечь карту' : formatCoins(entry)}
          </button>
        )}
        {(result || roundArmed) && (
          <button className="dw-btn ghost small dw-play-reset" onClick={onResetRound}>сбросить</button>
        )}
      </div>
    </>
  );
}

/* ─── Clans tab ───────────────────────────────────────────── */

function ClansTab({ onBack, player, onNotify }) {
  const [clans, setClans] = React.useState([]);
  const [myClanId, setMyClanId] = React.useState(null);
  const [loading, setLoading] = React.useState(true);
  const [creating, setCreating] = React.useState(false);
  const [form, setForm] = React.useState({ name: '', tag: '', description: '' });

  const load = async () => {
    setLoading(true);
    try {
      const data = await api.clans();
      setClans(data.clans || []);
      setMyClanId(data.myClanId || null);
    } catch {}
    setLoading(false);
  };

  React.useEffect(() => { load(); }, []);

  const handleCreate = async () => {
    if (!form.name.trim()) return;
    try {
      await api.createClan(form.name, form.tag, form.description);
      setCreating(false);
      setForm({ name: '', tag: '', description: '' });
      load();
      onNotify('Клан создан!', 'success');
    } catch (e) {
      onNotify(e.message === 'name_taken' ? 'Имя занято' : e.message === 'already_in_clan' ? 'Ты уже в клане' : 'Ошибка', 'danger');
    }
  };

  const handleJoin = async (clanId) => {
    try {
      await api.joinClan(clanId);
      load();
      onNotify('Вступил в клан', 'success');
    } catch (e) {
      onNotify(e.message === 'already_in_clan' ? 'Уже в клане' : 'Ошибка', 'danger');
    }
  };

  const myClan = clans.find((c) => c.id === myClanId);

  return (
    <section className="dw-page dw-clans-page">
      <button className="dw-back-link" onClick={onBack}>‹ назад</button>
      <h2 style={{ marginBottom: 16 }}>Кланы</h2>

      {loading && <div className="dw-pay-loading"><div className="dw-pay-spinner" /></div>}

      {!loading && myClan && (
        <article className="dw-panel" style={{ marginBottom: 12 }}>
          <div className="dw-panel-head">
            <div>
              <span className="dw-kicker">Мой клан</span>
              <h2>[{myClan.tag}] {myClan.name}</h2>
            </div>
            <span className="dw-badge">{myClan.memberCount} чел.</span>
          </div>
          {myClan.description && <p style={{ color: 'var(--bone-soft)', marginTop: 6 }}>{myClan.description}</p>}
        </article>
      )}

      {!loading && !myClanId && (
        <>
          {!creating ? (
            <button className="dw-btn primary full" style={{ marginBottom: 16 }} onClick={() => setCreating(true)}>
              + Создать клан
            </button>
          ) : (
            <article className="dw-panel" style={{ marginBottom: 16 }}>
              <div className="dw-panel-head"><h2>Новый клан</h2><button className="dw-icon-btn" onClick={() => setCreating(false)}>×</button></div>
              <input className="dw-manual-input" style={{ marginBottom: 10, textAlign: 'left', fontSize: 15 }}
                placeholder="Название клана" value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
              <input className="dw-manual-input" style={{ marginBottom: 10, textAlign: 'left', fontSize: 15 }}
                placeholder="Тег (до 8 символов)" maxLength={8} value={form.tag}
                onChange={(e) => setForm((f) => ({ ...f, tag: e.target.value }))} />
              <input className="dw-manual-input" style={{ marginBottom: 12, textAlign: 'left', fontSize: 15 }}
                placeholder="Описание (необязательно)" value={form.description}
                onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} />
              <button className="dw-btn primary full" onClick={handleCreate} disabled={!form.name.trim()}>
                Создать
              </button>
            </article>
          )}
        </>
      )}

      {!loading && clans.length === 0 && (
        <p style={{ color: 'var(--bone-soft)', textAlign: 'center', padding: '24px 0' }}>Кланов пока нет. Создай первый!</p>
      )}

      <div className="dw-stack">
        {clans.map((clan, i) => (
          <article className="dw-panel" key={clan.id}>
            <div className="dw-panel-head">
              <div>
                <span className="dw-kicker">#{i + 1}</span>
                <h2>[{clan.tag}] {clan.name}</h2>
              </div>
              <span className="dw-badge">{clan.memberCount} чел.</span>
            </div>
            {clan.description && <p style={{ color: 'var(--bone-soft)', fontSize: 13, marginTop: 4 }}>{clan.description}</p>}
            <div style={{ marginTop: 10 }}>
              {clan.isMember ? (
                <span className="dw-badge accent">Мой клан</span>
              ) : !myClanId ? (
                <button className="dw-btn secondary small" onClick={() => handleJoin(clan.id)}>Вступить</button>
              ) : null}
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

/* ─── Referral tab ────────────────────────────────────────── */

function ReferralTab({ referral, player, onCopy, onShare, onClaimReward, onBack, onClaimRef }) {
  const tiers = referral.tiers || [];
  const currentTier = tiers.find((t) => t.name === referral.tier) || tiers[0] || null;
  const code = referral.code;

  return (
    <section className="dw-page dw-referral-page">
      <button className="dw-back-link" onClick={onBack}>‹ профиль</button>

      {/* Hero */}
      <div className="dw-ref-hero">
        <div className="dw-ref-hero-glow" />
        <div className="dw-ref-hero-corner tl" />
        <div className="dw-ref-hero-corner tr" />
        <div className="dw-ref-hero-corner bl" />
        <div className="dw-ref-hero-corner br" />

        <span className="dw-kicker">Реферальная программа</span>
        <h1>Зови друзей,<br />получай монеты</h1>
        <p>{referral.structure || `${referral.pct || 7}% с каждого пополнения реферала`}</p>

        <div className="dw-ref-link-box">
          <div className="dw-ref-link-text">
            <span className="dw-kicker" style={{ marginBottom: 2 }}>Твоя ссылка</span>
            <strong>t.me/deadwill_bot?start={code}</strong>
          </div>
          <button className="dw-btn primary small" onClick={onCopy}>Копировать</button>
        </div>

        <button className="dw-btn secondary" style={{ width: '100%', marginTop: 10 }} onClick={onShare}>
          поделиться в Telegram
        </button>
      </div>

      {/* Stats + Claim */}
      <div className="dw-ref-stats-row">
        <div className="dw-ref-stat">
          <span>Приглашено</span>
          <strong>{referral.invites}</strong>
        </div>
        <div className="dw-ref-stat accent">
          <span>Активных</span>
          <strong>{referral.activeInvites}</strong>
        </div>
        <div className="dw-ref-stat gold">
          <span>Заработано</span>
          <strong>{formatCompact(referral.earned)}</strong>
        </div>
      </div>

      {/* Кнопка «Забрать реферальные» */}
      <div className="dw-ref-claim-block">
        <div className="dw-ref-claim-info">
          <span className="dw-kicker">Доступно к получению</span>
          <strong className="dw-large-value">{formatCoins(referral.pending || 0)}</strong>
        </div>
        <button
          className={`dw-btn ${(referral.pending || 0) > 0 ? 'primary' : 'ghost'}`}
          onClick={onClaimRef}
          disabled={!(referral.pending > 0)}
        >
          Забрать реферальные
        </button>
      </div>

      {currentTier && (
        <article className="dw-panel dw-ref-tier-card">
          <div className="dw-panel-head">
            <div>
              <span className="dw-kicker">Текущий уровень</span>
              <h2>Tier: {referral.tier}</h2>
            </div>
            <span className="dw-badge premium">{currentTier.bonus} бонус</span>
          </div>
          <div className="dw-ledger-line" style={{ margin: '12px 0 8px' }}>
            <div className="dw-ledger-fill" style={{ width: `${referral.tierProgress || 0}%` }} />
          </div>
          <p style={{ color: 'var(--bone-soft)', fontSize: 12 }}>
            {referral.invites} из {referral.tierNextAt} рефералов до {referral.tierNext}
          </p>

          <div className="dw-ref-tiers">
            {tiers.map((t) => (
              <div key={t.name} className={`dw-ref-tier-chip ${t.name === referral.tier ? 'active' : ''}`}>
                <strong>{t.name}</strong>
                <span>{t.bonus}</span>
              </div>
            ))}
          </div>
        </article>
      )}

      {/* Reward milestones */}
      {referral.rewards && referral.rewards.length > 0 && (
      <article className="dw-panel">
        <div className="dw-panel-head">
          <h2>Награды за рефералов</h2>
          <span className="dw-panel-sub">Единовременные</span>
        </div>
        <div className="dw-ref-rewards-list">
          {referral.rewards.map((r) => (
            <div className={`dw-ref-reward-row ${r.state}`} key={r.level}>
              <div className={`dw-ref-reward-num ${r.state === 'claimed' ? 'done' : r.state === 'claimable' ? 'ready' : ''}`}>
                {r.state === 'claimed' ? '·' : r.level}
              </div>
              <div className="dw-history-copy">
                <strong>{r.reward}</strong>
                <p>За {r.level} {r.level === 1 ? 'реферала' : 'рефералов'}</p>
              </div>
              {r.state === 'claimable' ? (
                <button className="dw-btn primary small" onClick={() => onClaimReward(r.level)}>
                  Забрать
                </button>
              ) : (
                <span className={`dw-badge ${r.state === 'claimed' ? 'accent' : ''}`} style={{ opacity: r.state === 'locked' ? 0.4 : 1 }}>
                  {r.state === 'claimed' ? 'Получено' : 'Закрыто'}
                </span>
              )}
            </div>
          ))}
        </div>
      </article>
      )}

      {/* Invite history */}
      <article className="dw-panel">
        <div className="dw-panel-head">
          <h2>Мои рефералы</h2>
          <span className="dw-panel-sub">{referral.invites} игроков</span>
        </div>
        <div className="dw-history-list">
          {(referral.inviteHistory || []).map((item) => (
            <div className="dw-history-row" key={item.id}>
              <div className="dw-feed-avatar" style={{ width: 34, height: 34, fontSize: 12 }}>{item.name[0]}</div>
              <div className="dw-history-copy">
                <strong>{item.name}</strong>
                <p>{item.date} · {item.active ? <span style={{ color: 'var(--success)' }}>активен</span> : <span style={{ color: 'var(--muted)' }}>неактивен</span>}</p>
              </div>
              {item.earned > 0 ? (
                <span className="pos">+{formatCoins(item.earned)}</span>
              ) : (
                <span style={{ color: 'var(--bone-soft)', fontSize: 12 }}>—</span>
              )}
            </div>
          ))}
        </div>
      </article>
    </section>
  );
}

/* ─── Shop tab ────────────────────────────────────────────── */

function ShopTab({ shop, player, onBuyNft, portalsGifts }) {
  const [nftRarity, setNftRarity] = useState('all');
  const [sortDir, setSortDir] = useState('asc'); // по возрастанию по умолчанию

  // ТОЛЬКО серверный каталог (цены и список — из БД). Никакого статичного
  // fallback: иначе при сбое bootstrap показались бы чужие подарки/цены.
  const catalog = portalsGifts || [];
  const filtered = nftRarity === 'all'
    ? catalog
    : catalog.filter((g) => g.rarity === nftRarity);
  const filteredGifts = [...filtered].sort((a, b) =>
    sortDir === 'asc' ? a.priceCoins - b.priceCoins : b.priceCoins - a.priceCoins);

  return (
    <section className="dw-page dw-shop-page">
      <h1 className="dw-shop-title" style={{ fontSize: 22 }}>NFT Shop</h1>
      <p style={{ color: 'var(--bone-soft)', fontSize: 13, marginBottom: 12, textAlign: 'center' }}>
        Подарки доставляются через Portals
      </p>

      <div className="dw-nft-rarity-bar">
        {NFT_RARITIES.map((r) => (
          <button key={r} className={`dw-nft-rarity-chip ${nftRarity === r ? 'active' : ''}`}
            style={nftRarity === r && r !== 'all' ? { borderColor: RARITY_COLOR[r], color: RARITY_COLOR[r] } : {}}
            onClick={() => setNftRarity(r)}>
            {r === 'all' ? 'Все' : r}
          </button>
        ))}
      </div>
      <div className="dw-sort-row">
        <span>Цена</span>
        <button className={`dw-sort-arrow ${sortDir === 'asc' ? 'active' : ''}`} onClick={() => setSortDir('asc')} title="по возрастанию">↑</button>
        <button className={`dw-sort-arrow ${sortDir === 'desc' ? 'active' : ''}`} onClick={() => setSortDir('desc')} title="по убыванию">↓</button>
      </div>
      {catalog.length === 0 && (
        <p style={{ color: 'var(--bone-soft)', textAlign: 'center', padding: '24px 0', fontSize: 14 }}>
          Загрузка каталога…
        </p>
      )}
      <div className="dw-nft-grid">
        {filteredGifts.map((item, i) => {
          const canBuy = (player?.coins || 0) >= item.priceCoins;
          return (
            <motion.article className="dw-nft-tile" key={item.id}
              initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.22, delay: Math.min(i * 0.03, 0.4) }}>
              <div className={`dw-nft-preview rarity-${(item.rarity || 'common').toLowerCase()}`}>
                <img src={`/gifts/${item.file}`} alt={item.name} className="dw-gift-img" loading="lazy" />
              </div>
              <span className="dw-kicker" style={{ color: RARITY_COLOR[item.rarity] }}>{item.rarity}</span>
              <h2 style={{ fontSize: 14 }}>{item.name}</h2>
              <strong style={{ fontSize: 15, color: 'var(--gold)' }}>{formatCoins(item.priceCoins)} монет</strong>
              {item.stock > 0
                ? <p style={{ color: 'var(--muted)', fontSize: 11, margin: '2px 0 6px' }}>Осталось {item.stock}</p>
                : <p style={{ color: 'var(--crimson-glow)', fontSize: 11, margin: '2px 0 6px' }}>Нет в наличии</p>
              }
              <button className={`dw-btn ${canBuy && item.stock > 0 ? 'primary' : 'ghost'}`}
                style={{ width: '100%', fontSize: 13 }}
                onClick={() => onBuyNft({ ...item, title: item.name })}
                disabled={!canBuy || item.stock === 0}>
                {!canBuy ? 'Мало монет' : item.stock === 0 ? 'Нет в наличии' : 'Купить'}
              </button>
            </motion.article>
          );
        })}
      </div>
    </section>
  );
}

/* ─── Profile tab ─────────────────────────────────────────── */

function ProfileTab({ player, filters, activeFilter, onFilterChange, history, tonWallet, onConnectTon, onDisconnectTon, onOpenAdmin, onOpenClans, onOpenRef, onOpenLeaderboard }) {
  const u = userDisplay(player);
  return (
    <section className="dw-page dw-profile-page">

      <div className="dw-profile-header">
        <div className="dw-avatar large" style={u.avatarUrl ? { padding: 0, overflow: 'hidden' } : {}}>
          {u.avatarUrl
            ? <img src={u.avatarUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: '50%' }} />
            : u.initial}
        </div>
        <div className="dw-profile-header-copy">
          <h1 className="dw-profile-name" style={{ fontSize: 20 }}>{u.displayName}</h1>
          {u.badge && <span className="dw-badge premium" style={{ marginBottom: 4 }}>{u.badge}</span>}
          <p className="dw-profile-meta" style={{ fontSize: 13 }}>ID {player.id}</p>
        </div>
      </div>

      <div className="dw-stats-row">
        <div className="dw-stat-cell">
          <span>игр</span>
          <strong>{player.gamesPlayed || 0}</strong>
        </div>
        <div className="dw-stat-cell">
          <span>выиграно</span>
          <strong>{formatCompact(player.coinsWon || 0)}</strong>
        </div>
        <div className="dw-stat-cell">
          <span>потрачено</span>
          <strong>{formatCompact(player.coinsSpent || 0)}</strong>
        </div>
        <div className="dw-stat-cell accent">
          <span>рекорд</span>
          <strong>{formatCompact(player.bestWin || 0)}</strong>
        </div>
      </div>

      <PersonalStats />

      <button className="dw-panel dw-nav-card" style={{ width: '100%', marginBottom: 12 }} onClick={onOpenLeaderboard}>
        <span className="dw-kicker">рейтинг</span>
        <strong>🏆 Топ игроков</strong>
        <p>лучшие за всё время и сегодня</p>
      </button>

      <div className="dw-home-strip">
        <button className="dw-panel dw-nav-card" onClick={onOpenClans}>
          <span className="dw-kicker">кланы</span>
          <strong>Кланы</strong>
          <p>вступить или создать</p>
        </button>
        <button className="dw-panel dw-nav-card" onClick={onOpenRef}>
          <span className="dw-kicker">реферал</span>
          <strong>10%</strong>
          <p>зови друзей</p>
        </button>
      </div>

      <article className="dw-panel" style={{ marginBottom: 12 }}>
        <div className="dw-panel-head" style={{ marginBottom: 10 }}>
          <h2>TON-кошелёк</h2>
        </div>
        {tonWallet ? (
          <div className="dw-history-row">
            <div className="dw-history-copy">
              <strong style={{ fontSize: 14, color: 'var(--gold)' }}>Подключён</strong>
              <p style={{ fontSize: 12 }}>{tonWallet.address.slice(0, 6)}…{tonWallet.address.slice(-6)}</p>
            </div>
            <button className="dw-btn ghost small" onClick={onDisconnectTon}>Отключить</button>
          </div>
        ) : (
          <button className="dw-btn primary" style={{ width: '100%' }} onClick={onConnectTon}>
            Подключить TON-кошелёк
          </button>
        )}
      </article>

      <article className="dw-panel">
        <div className="dw-panel-head" style={{ marginBottom: 12 }}>
          <h2>История операций</h2>
        </div>
        {history.length === 0 ? (
          <p style={{ color: 'var(--bone-soft)', textAlign: 'center', padding: '16px 0', fontSize: 14 }}>
            Операций пока нет
          </p>
        ) : (
          <div className="dw-history-list">
            {history.map((item) => {
              const label = {
                pvp_bet: 'Ставка PvP', pvp_payout: 'Выигрыш PvP',
                bet: 'Ставка', payout: 'Выигрыш',
                deposit_stars: 'Пополнение Stars', deposit_ton: 'Пополнение TON',
                deposit_cryptobot: 'Пополнение @send', ref_bonus: 'Реферальный бонус',
                ref_claim: 'Реферальные выведены', admin_adjust: 'Корректировка', portals_buy: 'NFT покупка'
              }[item.type] || item.type;
              return (
                <div className="dw-history-row" key={item.id}>
                  <div className="dw-history-copy">
                    <strong style={{ fontSize: 14 }}>{label}</strong>
                    <p style={{ fontSize: 12 }}>{new Date(item.date).toLocaleDateString('ru-RU')}</p>
                  </div>
                  <span className={item.amount >= 0 ? 'pos' : 'neg'} style={{ fontSize: 15 }}>
                    {item.amount >= 0 ? '+' : ''}{formatCoins(item.amount)}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </article>

      {(player.role === 'Owner' || player.role === 'Admin') && (
        <button className="dw-panel dw-admin-entry" onClick={onOpenAdmin}>
          <div className="dw-admin-entry-inner">
            <div>
              <span className="dw-kicker dw-kicker-admin">Admin</span>
              <h2>Панель управления</h2>
              <p>Transfers, пользователи, экономика.</p>
            </div>
            <span className="dw-admin-arrow">›</span>
          </div>
        </button>
      )}
    </section>
  );
}

/* ─── Pass overlay (modal) ────────────────────────────────── */

function PassOverlay({ passData, player, onClose, onClaimReward, onClaimQuest }) {
  return (
    <div className="dw-sheet-backdrop" onClick={onClose}>
      <div className="dw-deposit-sheet" onClick={(e) => e.stopPropagation()}>
        <div className="dw-panel-head" style={{ marginBottom: 14 }}>
          <div>
            <span className="dw-kicker">Season pass</span>
            <h2>Battle Pass</h2>
          </div>
          <button className="dw-icon-btn" onClick={onClose}>×</button>
        </div>

        <article className="dw-ledger-hero" style={{ marginBottom: 12 }}>
          <div className="dw-ledger-medal">{player.passLevel}</div>
          <p>{passData.xpLabel}</p>
          <div className="dw-ledger-line">
            <div className="dw-ledger-fill" style={{ width: `${player.passProgress}%` }} />
          </div>
          <div className="dw-pass-meta">
            <span className="dw-badge">Ends {passData.endsIn}</span>
            {passData.owned
              ? <span className="dw-badge premium">Premium active</span>
              : <span className="dw-badge">Free track</span>
            }
          </div>
        </article>

        <div className="dw-quest-grid">
          <QuestPanel title="Daily" items={passData.daily} onClaim={(id) => onClaimQuest(id, 'daily')} />
          <QuestPanel title="Weekly" items={passData.weekly} onClaim={(id) => onClaimQuest(id, 'weekly')} />
        </div>

        <div className="dw-reward-track" style={{ marginTop: 12 }}>
          <div className="dw-pass-lanes">
            <span>FREE</span>
            <span>PREMIUM</span>
          </div>
          {passData.rewards.map((reward) => (
            <article className="dw-reward-row" key={reward.level}>
              <div className="dw-reward-lvl">Lvl {reward.level}</div>
              <RewardCell
                title="Free"
                reward={reward.free}
                onClaim={() => onClaimReward(reward.level, 'free')}
              />
              <RewardCell
                title="Premium"
                reward={reward.premium}
                onClaim={() => onClaimReward(reward.level, 'premium')}
                locked={!passData.owned && reward.premium.state !== 'claimed'}
              />
            </article>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ─── Contract overlay ────────────────────────────────────── */

function ContractOverlay({ mode, revealing, result, selectedClause, onReplay, onClose }) {
  return (
    <div className="dw-overlay">
      <div className="dw-overlay-inner">
        {revealing ? (
          <motion.div
            className="dw-overlay-reveal"
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.35, ease: [0.2, 0, 0, 1] }}
          >
            <span className="dw-kicker">reveal</span>
            <p className="dw-overlay-contract-num">контракт {selectedClause !== null ? selectedClause + 1 : ''}</p>
            <div className="dw-overlay-spinner" />
          </motion.div>
        ) : result ? (
          <>
            <motion.div
              className="dw-overlay-result"
              initial={{ opacity: 0, y: 14 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.4, ease: [0.2, 0, 0, 1] }}
            >
              <span className="dw-kicker">
                {result.type === 'empty' ? 'empty' : result.type === 'debt' ? 'debt' : 'win'}
              </span>
              <motion.p
                className={`dw-overlay-amount ${result.type === 'multiplier' ? 'violet' : result.type === 'empty' || result.type === 'debt' ? 'muted' : 'gold'}`}
                initial={{ opacity: 0, scale: 0.65 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
              >
                {(result.type === 'coins' || result.type === 'bonus')
                  ? `+${formatCoins(result.creditCoins)}`
                  : result.type === 'multiplier' ? '×2' : '—'}
              </motion.p>
              <motion.p
                className="dw-overlay-desc"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ duration: 0.3, delay: 0.32 }}
              >
                {result.type === 'multiplier' ? 'следующий выигрыш усилен'
                  : result.type === 'empty' ? 'контракт пуст'
                  : result.type === 'debt' ? 'ставка утрачена'
                  : result.note || 'монеты зачислены'}
              </motion.p>
            </motion.div>
            <motion.div
              className="dw-overlay-actions"
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.35, delay: 0.44, ease: [0.2, 0, 0, 1] }}
            >
              <button className="dw-btn primary full" onClick={onReplay}>play again</button>
              <button className="dw-btn ghost full" onClick={onClose}>close</button>
            </motion.div>
          </>
        ) : null}
      </div>
    </div>
  );
}

/* ─── Player profile modal ────────────────────────────────── */

function PlayerProfileModal({ userId, data, onClose }) {
  const u = userDisplay(data);
  return (
    <div className="dw-sheet-backdrop" onClick={onClose}>
      <div className="dw-deposit-sheet" onClick={(e) => e.stopPropagation()}>
        <div className="dw-panel-head" style={{ marginBottom: 14 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div className="dw-avatar" style={u.avatarUrl ? { padding: 0, overflow: 'hidden', width: 40, height: 40, flexShrink: 0 } : { width: 40, height: 40, flexShrink: 0 }}>
              {u.avatarUrl
                ? <img src={u.avatarUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: '50%' }} />
                : u.initial}
            </div>
            <div>
              <span className="dw-kicker">Профиль игрока</span>
              <h2 style={{ margin: 0 }}>{data ? u.displayName : '…'}</h2>
            </div>
          </div>
          <button className="dw-icon-btn" onClick={onClose}>×</button>
        </div>

        {!data && (
          <div className="dw-pay-loading"><div className="dw-pay-spinner" /><span>загрузка…</span></div>
        )}
        {data?.error && (
          <p style={{ color: 'var(--muted)', textAlign: 'center', padding: '16px 0' }}>Не удалось загрузить</p>
        )}
        {data && !data.error && (
          <>
            <div className="dw-admin-stats-row">
              <div className="dw-admin-stat"><span>игр</span><strong>{data.gamesPlayed}</strong></div>
              <div className="dw-admin-stat"><span>выиграно</span><strong>{formatCompact(data.coinsWon)}</strong></div>
              <div className="dw-admin-stat"><span>рекорд</span><strong>{formatCompact(data.bestWin)}</strong></div>
            </div>
            <article className="dw-panel" style={{ marginTop: 12 }}>
              <div className="dw-panel-head"><h2>История игр</h2></div>
              <div className="dw-history-list">
                {(data.history || []).slice(0, 10).map((item, i) => (
                  <div className="dw-history-row" key={i}>
                    <div className="dw-history-copy">
                      <strong>{item.type === 'pvp_payout' ? 'PvP выигрыш' : item.type === 'payout' ? 'Соло' : item.type}</strong>
                      <p>{new Date(item.date).toLocaleDateString('ru-RU')}</p>
                    </div>
                    <span className={item.amount >= 0 ? 'pos' : 'neg'}>
                      {item.amount >= 0 ? '+' : ''}{formatCoins(item.amount)}
                    </span>
                  </div>
                ))}
                {(!data.history || data.history.length === 0) && (
                  <p style={{ color: 'var(--muted)', textAlign: 'center', padding: '12px 0' }}>Нет записей</p>
                )}
              </div>
            </article>
          </>
        )}
      </div>
    </div>
  );
}

/* ─── Личная статистика ───────────────────────────────────── */

function PersonalStats() {
  const [s, setS] = useState(null);
  useEffect(() => { api.stats().then(setS).catch(() => {}); }, []);
  if (!s) return null;
  const winRate = s.roundsPlayed > 0 ? Math.round((s.wins / s.roundsPlayed) * 100) : 0;
  return (
    <article className="dw-panel" style={{ marginBottom: 12 }}>
      <div className="dw-panel-head" style={{ marginBottom: 12 }}><h2>Статистика</h2></div>
      <div className="dw-stats-row" style={{ marginBottom: 10 }}>
        <div className="dw-stat-cell"><span>раундов</span><strong>{formatCoins(s.roundsPlayed)}</strong></div>
        <div className="dw-stat-cell"><span>побед</span><strong>{formatCoins(s.wins)}</strong></div>
        <div className="dw-stat-cell"><span>поражений</span><strong>{formatCoins(s.losses)}</strong></div>
        <div className="dw-stat-cell accent"><span>winrate</span><strong>{winRate}%</strong></div>
      </div>
      <div className="dw-stats-row">
        <div className="dw-stat-cell"><span>лучший выигрыш</span><strong>{formatCoins(s.bestWin)}</strong></div>
        <div className="dw-stat-cell"><span>любимый подарок</span><strong style={{ fontSize: 13 }}>{s.favoriteGift || '—'}</strong></div>
      </div>
    </article>
  );
}

/* ─── История раундов: список + детали по игрокам ─────────── */

function RoundsHistory({ myId, onClose }) {
  const [sort, setSort] = useState('all'); // all | best
  const [rounds, setRounds] = useState([]);
  const [loading, setLoading] = useState(true);
  const [detail, setDetail] = useState(null); // { roundNumber, players[] }
  const [detailLoading, setDetailLoading] = useState(false);

  useEffect(() => {
    setLoading(true);
    api.rounds(sort, 0, 30).then((d) => setRounds(d.rounds || [])).catch(() => {}).finally(() => setLoading(false));
  }, [sort]);

  const openDetail = async (lobbyId) => {
    setDetailLoading(true);
    try { setDetail(await api.roundDetail(lobbyId)); } catch {} finally { setDetailLoading(false); }
  };

  return (
    <motion.div className="dw-sheet-backdrop" onClick={onClose}
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.2 }}>
      <motion.div className="dw-round-result" onClick={(e) => e.stopPropagation()}
        initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }} transition={{ duration: 0.32, ease: [0.32, 0, 0, 1] }}>

        {!detail ? (
          <>
            <div className="dw-round-result-header">
              <h2>История раундов</h2>
              <button className="dw-icon-btn" onClick={onClose}>×</button>
            </div>
            <div className="dw-will-pager" style={{ marginBottom: 12 }}>
              <button className={`dw-will-pager-btn ${sort === 'all' ? 'active' : ''}`} onClick={() => setSort('all')}>Все</button>
              <button className={`dw-will-pager-btn ${sort === 'best' ? 'active' : ''}`} onClick={() => setSort('best')}>Лучшие</button>
            </div>
            {loading ? (
              <div className="dw-pay-loading"><div className="dw-pay-spinner" /></div>
            ) : rounds.length === 0 ? (
              <p style={{ color: 'var(--bone-soft)', textAlign: 'center', padding: '16px 0', fontSize: 14 }}>Раундов пока нет</p>
            ) : rounds.map((r) => {
              const w = r.winner;
              const u = w ? userDisplay(w) : null;
              return (
                <button key={r.lobbyId} className="dw-round-row" style={{ width: '100%', textAlign: 'left' }} onClick={() => openDetail(r.lobbyId)}>
                  <span className="dw-lb-rank">#{r.roundNumber}</span>
                  <span className="dw-round-row-avatar" style={u?.avatarUrl ? { padding: 0, overflow: 'hidden' } : {}}>
                    {u?.avatarUrl ? <img src={u.avatarUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: '50%' }} /> : (u?.initial || '—')}
                  </span>
                  <span className="dw-round-row-name">{w ? `Победитель ${u.displayName}` : 'Без победителя'} · {r.players} игроков</span>
                  <span className="dw-round-row-prize pos">{w ? `+${formatCoins(r.topPrize)}` : '0'}</span>
                </button>
              );
            })}
          </>
        ) : (
          <>
            <div className="dw-round-result-header">
              <button className="dw-btn ghost small" onClick={() => setDetail(null)}>‹ назад</button>
              <h2 style={{ flex: 1, textAlign: 'center' }}>Раунд #{detail.roundNumber}</h2>
              <button className="dw-icon-btn" onClick={onClose}>×</button>
            </div>
            {detailLoading ? <div className="dw-pay-loading"><div className="dw-pay-spinner" /></div> :
              detail.players.length === 0 ? (
                <p style={{ color: 'var(--bone-soft)', textAlign: 'center', padding: '16px 0' }}>Никто не играл</p>
              ) : detail.players.map((p, i) => {
                const u = userDisplay(p);
                const mine = String(p.userId) === String(myId);
                return (
                  <div key={i} className={`dw-round-row${mine ? ' dw-round-row--mine' : ''}`}>
                    <span className="dw-lb-rank">{p.prize > 0 ? (i < 3 ? ['🥇', '🥈', '🥉'][i] : i + 1) : '—'}</span>
                    <span className="dw-round-row-avatar" style={u.avatarUrl ? { padding: 0, overflow: 'hidden' } : {}}>
                      {u.avatarUrl ? <img src={u.avatarUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: '50%' }} /> : u.initial}
                    </span>
                    <span className="dw-round-row-name">{u.displayName}{mine ? ' (ты)' : ''} · карта #{p.cardIndex + 1}</span>
                    <span className={`dw-round-row-prize ${p.prize > 0 ? 'pos' : ''}`}>{p.prize > 0 ? `+${formatCoins(p.prize)}` : '0'}</span>
                  </div>
                );
              })}
          </>
        )}
      </motion.div>
    </motion.div>
  );
}

/* ─── Топ игроков ─────────────────────────────────────────── */

function timeAgo(date) {
  const diff = Math.max(0, Date.now() - new Date(date).getTime());
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'только что';
  if (m < 60) return `${m} мин назад`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} ч назад`;
  return `${Math.floor(h / 24)} дн назад`;
}

function LeaderboardRow({ p, rank, myId }) {
  const u = userDisplay(p);
  const mine = String(p.userId) === String(myId);
  return (
    <div className={`dw-lb-row${mine ? ' dw-lb-row--mine' : ''}`}>
      <span className="dw-lb-rank">{rank <= 3 ? ['🥇', '🥈', '🥉'][rank - 1] : rank}</span>
      <span className="dw-round-row-avatar" style={u.avatarUrl ? { padding: 0, overflow: 'hidden' } : {}}>
        {u.avatarUrl ? <img src={u.avatarUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: '50%' }} /> : u.initial}
      </span>
      <span className="dw-lb-name">{u.displayName}{mine ? ' (ты)' : ''}</span>
      <span className="dw-lb-stats">
        <strong className="gold">{formatCoins(p.coinsWon)}</strong>
        <small>{formatCoins(p.roundsPlayed)} раундов</small>
      </span>
    </div>
  );
}

function LeaderboardTab({ myId, liveWins, onBack }) {
  const [data, setData] = useState(null);
  const [period, setPeriod] = useState('allTime');
  useEffect(() => { api.leaderboard().then(setData).catch(() => {}); }, []);
  const list = data ? (period === 'allTime' ? data.allTime : data.today) : [];

  return (
    <section className="dw-page dw-profile-page">
      <div className="dw-panel-head" style={{ marginBottom: 12 }}>
        <h2>🏆 Топ игроков</h2>
        <button className="dw-btn ghost small" onClick={onBack}>назад</button>
      </div>

      <div className="dw-will-pager" style={{ marginBottom: 12 }}>
        <button className={`dw-will-pager-btn ${period === 'allTime' ? 'active' : ''}`} onClick={() => setPeriod('allTime')}>За всё время</button>
        <button className={`dw-will-pager-btn ${period === 'today' ? 'active' : ''}`} onClick={() => setPeriod('today')}>Сегодня</button>
      </div>

      <article className="dw-panel" style={{ marginBottom: 12 }}>
        {list.length === 0 ? (
          <p style={{ color: 'var(--bone-soft)', textAlign: 'center', padding: '16px 0', fontSize: 14 }}>Пока пусто</p>
        ) : list.map((p, i) => <LeaderboardRow key={p.userId} p={p} rank={i + 1} myId={myId} />)}
      </article>

      {(liveWins || []).length > 0 && (
        <article className="dw-panel">
          <div className="dw-panel-head" style={{ marginBottom: 12 }}><h2>Последние выигрыши</h2></div>
          {liveWins.slice(0, 20).map((w, i) => {
            const u = userDisplay(w);
            return (
              <div className="dw-round-row" key={i}>
                <span className="dw-round-row-avatar" style={u.avatarUrl ? { padding: 0, overflow: 'hidden' } : {}}>
                  {u.avatarUrl ? <img src={u.avatarUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: '50%' }} /> : u.initial}
                </span>
                <span className="dw-round-row-name">{u.displayName} выиграл <strong className="gold">{formatCoins(w.amount)}</strong> монет</span>
                <span className="dw-round-row-prize" style={{ fontSize: 11, opacity: 0.6 }}>{timeAgo(w.date)}</span>
              </div>
            );
          })}
        </article>
      )}
    </section>
  );
}

/* ─── @send депозит: адрес + memo + таймер 30 мин ─────────── */

function SendDeposit({ onPaid, onNotify }) {
  const [amount, setAmount] = useState('');
  const [dep, setDep] = useState(null);
  const [status, setStatus] = useState('pending');
  const [left, setLeft] = useState(0);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    if (!dep) return undefined;
    const t = setInterval(() => {
      const s = Math.max(0, Math.floor((new Date(dep.expiresAt).getTime() - Date.now()) / 1000));
      setLeft(s);
      if (s === 0) setStatus((st) => (st === 'pending' ? 'expired' : st));
    }, 1000);
    return () => clearInterval(t);
  }, [dep]);

  useEffect(() => {
    if (!dep || status !== 'pending') return undefined;
    let cancelled = false;
    let id;
    const poll = async () => {
      try {
        const s = await api.depositStatus(dep.depositId);
        if (cancelled) return;
        if (s.status === 'confirmed' || s.status === 'paid') { setStatus('confirmed'); onPaid?.(dep.coins); return; }
        if (s.status === 'expired') { setStatus('expired'); return; }
      } catch {}
      if (!cancelled) id = setTimeout(poll, 8000);
    };
    id = setTimeout(poll, 8000);
    return () => { cancelled = true; clearTimeout(id); };
  }, [dep, status]);

  const create = async () => {
    const amt = parseFloat(amount);
    if (!amt || amt < 0.5) { onNotify?.('Минимум 0.5 TON', 'danger'); return; }
    setCreating(true);
    try {
      const res = await api.createSendDeposit(amt);
      setDep(res);
      setStatus('pending');
    } catch (e) {
      onNotify?.(e.data?.detail || 'Не удалось создать депозит', 'danger');
    } finally { setCreating(false); }
  };

  const copy = (t) => { try { navigator.clipboard?.writeText(t); onNotify?.('Скопировано', 'success'); } catch {} };
  const mmss = `${String(Math.floor(left / 60)).padStart(2, '0')}:${String(left % 60).padStart(2, '0')}`;

  if (!dep) {
    const amt = parseFloat(amount) || 0;
    return (
      <div className="dw-coins-buy">
        <p style={{ color: 'var(--bone-soft)', fontSize: 13, margin: '0 0 12px' }}>
          Переведи TON на адрес проекта с указанным комментарием. Минимум 0.5 TON (5 монет).
        </p>
        <div className="dw-coins-input-wrap">
          <input className="dw-coins-input" type="number" min="0.5" step="0.1" placeholder="Сумма в TON"
            value={amount} onChange={(e) => setAmount(e.target.value)} />
          {amt >= 0.5 && (
            <div className="dw-coins-preview"><span>{formatCoins(Math.round(amt * 10))} монет</span></div>
          )}
        </div>
        <button className="dw-btn primary full" onClick={create} disabled={creating || amt < 0.5}>
          {creating ? 'Создаём…' : 'Создать заявку'}
        </button>
      </div>
    );
  }

  return (
    <div className="dw-send-wait">
      {status === 'pending' && (
        <>
          <div className="dw-send-status">
            <span className="dw-live-dot" /> Ожидание оплаты…
            <strong className="dw-send-timer">{mmss}</strong>
          </div>
          <p style={{ color: 'var(--bone-soft)', fontSize: 12, margin: '4px 0 14px' }}>
            Отправь <strong className="gold">{dep.amountTon} TON</strong> ({formatCoins(dep.coins)} монет) на адрес ниже, обязательно с комментарием.
          </p>
          <label className="dw-send-field-label">Адрес кошелька</label>
          <button className="dw-send-copy" onClick={() => copy(dep.wallet)}>
            <code>{dep.wallet}</code><span>копировать</span>
          </button>
          <label className="dw-send-field-label">Комментарий (memo)</label>
          <button className="dw-send-copy dw-send-copy--memo" onClick={() => copy(dep.memo)}>
            <code style={{ fontSize: 20, letterSpacing: '0.2em' }}>{dep.memo}</code><span>копировать</span>
          </button>
          <p style={{ color: 'var(--danger, #c0556a)', fontSize: 12, marginTop: 12 }}>
            ⚠️ Без комментария платёж не зачислится автоматически.
          </p>
        </>
      )}
      {status === 'confirmed' && (
        <div className="dw-round-my-result win" style={{ marginTop: 8 }}>
          <span className="dw-round-result-emoji">✅</span>
          <div><strong>Оплата получена!</strong><p>+{formatCoins(dep.coins)} монет зачислено</p></div>
        </div>
      )}
      {status === 'expired' && (
        <div className="dw-round-my-result lose" style={{ marginTop: 8 }}>
          <span className="dw-round-result-emoji">⌛</span>
          <div><strong>Время истекло</strong><p>Заявка больше не активна. Создай новую.</p></div>
        </div>
      )}
    </div>
  );
}

/* ─── Deposit sheet — монеты / карты ─────────────────────── */

function DepositSheet({ view, onViewChange, method, onMethodChange, starsPacks, tonPacks, onStarsPay, onStarsCustom, onTonPay, onTonCustom, onBuyCardsCount, payPending, tonWallet, tonIntent, onConnectTon, onClose, ticketPacks, onBuyTickets, player, onSendPaid, notify }) {
  const [coins, setCoins] = React.useState('');
  const coinsNum = Math.max(0, parseInt(coins) || 0);
  const starsForCoins = coinsNum * 20;
  const tonForCoins = (coinsNum * 0.1).toFixed(2);
  const [cheapCards, setCheapCards] = React.useState('');
  const [premCards, setPremCards] = React.useState('');
  const cheapN = Math.max(0, parseInt(cheapCards) || 0);
  const premN = Math.max(0, parseInt(premCards) || 0);

  const handleBuyCoinsStars = () => {
    if (!coinsNum) return;
    onStarsCustom(coinsNum); // динамическая сумма: coinsNum монет = coinsNum*20 ⭐
  };
  const handleBuyCoinsTon = () => {
    if (!coinsNum) return;
    onTonCustom(coinsNum); // динамическая сумма TON через TonConnect
  };

  const cheapPacks = ticketPacks?.cheap || [];
  const premPacks = (ticketPacks?.premium || []).slice(0, 5);

  // Мы убрали manualTon и используем coins input:
  const handleManualSend = () => {
    const amt = parseFloat(manualTon);
    if (!amt || amt <= 0) return;
    onTonPay({ id: 'manual', nanoton: Math.round(amt * 1e9), coins: Math.floor(amt * 10), bonus: 0, title: amt + ' TON' });
  };
  return (
    <motion.div className="dw-sheet-backdrop" onClick={onClose}
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.2 }}>
      <motion.div className="dw-deposit-sheet" onClick={(e) => e.stopPropagation()}
        initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }}
        transition={{ duration: 0.32, ease: [0.32, 0, 0, 1] }}>
        <div className="dw-deposit-head">
          <div>
            {view !== 'main' && <button className="dw-back-link" style={{ marginBottom: 4 }} onClick={() => onViewChange('main')}>← Назад</button>}
            <h2 style={{ fontSize: 20, margin: '2px 0' }}>Пополнение</h2>
            <p style={{ color: 'var(--bone-soft)', fontSize: 13, margin: 0 }}>1 монета = 20 ⭐ = 0.1 TON</p>
          </div>
          <button className="dw-icon-btn" onClick={onClose}>×</button>
        </div>

        {/* MAIN — 2 кнопки */}
        {view === 'main' && !payPending && !tonIntent && (
          <div className="dw-deposit-choices">
            <button className="dw-deposit-choice dw-deposit-choice--gold" onClick={() => onViewChange('coins')}>
              <span className="dw-deposit-choice-icon">🪙</span>
              <div className="dw-deposit-choice-text">
                <strong>Купить монеты</strong>
                <p>За TON, Stars или выгодные наборы</p>
              </div>
              <span className="dw-deposit-choice-arrow">›</span>
            </button>
            <button className="dw-deposit-choice" onClick={() => onViewChange('cards')}>
              <span className="dw-deposit-choice-icon">🎴</span>
              <div className="dw-deposit-choice-text">
                <strong>Купить карты</strong>
                <p>PvP карты и Премиум завещания</p>
              </div>
              <span className="dw-deposit-choice-arrow">›</span>
            </button>
          </div>
        )}

        {/* COINS — вводишь сколько монет хочешь */}
        {view === 'coins' && !payPending && !tonIntent && (
          <div className="dw-coins-buy">
            <div className="dw-rate-bar">
              <span>1 монета</span><span className="dw-rate-eq">=</span>
              <span>20 ⭐</span><span className="dw-rate-eq">=</span><span>0.1 TON</span>
            </div>
            <div className="dw-coins-input-wrap">
              <input className="dw-coins-input" type="number" min="1" placeholder="Сколько монет?"
                value={coins} onChange={e => setCoins(e.target.value)} />
              {coinsNum > 0 && (
                <div className="dw-coins-preview">
                  <span>{starsForCoins} ⭐</span><span className="dw-rate-eq">·</span><span>{tonForCoins} TON</span>
                </div>
              )}
            </div>
            <div className="dw-coins-pay-btns">
              <button className="dw-coins-pay-btn dw-coins-pay-btn--stars" onClick={handleBuyCoinsStars} disabled={!coinsNum}>
                <span>⭐ Оплатить Stars</span>
                {coinsNum > 0 && <span className="dw-coins-pay-amt">{starsForCoins} Stars</span>}
              </button>
              <button className="dw-coins-pay-btn dw-coins-pay-btn--ton" onClick={handleBuyCoinsTon} disabled={!coinsNum}>
                <span>💎 Оплатить TON</span>
                {coinsNum > 0 && <span className="dw-coins-pay-amt">{tonForCoins} TON</span>}
              </button>
            </div>

            {/* Отдельная плашка карт рядом с монетами */}
            <div className="dw-card-panel">
              <div className="dw-card-panel-head">
                <span>🎴 PvP карты</span>
                <span className="dw-kicker">5 монет / шт</span>
              </div>
              <div className="dw-card-buy-row">
                <input className="dw-coins-input" type="number" min="1" placeholder="Сколько карт?"
                  value={cheapCards} onChange={(e) => setCheapCards(e.target.value)} />
                <button className="dw-btn primary" disabled={!cheapN || (player?.coins || 0) < cheapN * 5}
                  onClick={() => onBuyCardsCount('cheap', cheapN)}>
                  {cheapN ? `Купить · ${formatCoins(cheapN * 5)}` : 'Купить'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* CARDS — ввод числа карт, оплата монетами (без наборов) */}
        {view === 'cards' && !payPending && (
          <div className="dw-cards-shop">
            <div className="dw-card-buy-block">
              <div className="dw-cards-section-head">
                <span style={{ fontSize: 15, fontWeight: 700 }}>🎴 PvP карты</span>
                <span className="dw-kicker" style={{ marginLeft: 8 }}>5 монет / карта</span>
              </div>
              <div className="dw-card-buy-row">
                <input className="dw-coins-input" type="number" min="1" placeholder="Сколько карт?"
                  value={cheapCards} onChange={(e) => setCheapCards(e.target.value)} />
                <button className="dw-btn primary" disabled={!cheapN || (player?.coins || 0) < cheapN * 5}
                  onClick={() => onBuyCardsCount('cheap', cheapN)}>
                  {cheapN ? `Купить · ${formatCoins(cheapN * 5)}` : 'Купить'}
                </button>
              </div>
            </div>
            <div className="dw-card-buy-block" style={{ marginTop: 16 }}>
              <div className="dw-cards-section-head">
                <span style={{ fontSize: 15, fontWeight: 700 }}>📜 Премиум завещания</span>
                <span className="dw-kicker" style={{ marginLeft: 8 }}>150 монет / карта</span>
              </div>
              <div className="dw-card-buy-row">
                <input className="dw-coins-input" type="number" min="1" placeholder="Сколько карт?"
                  value={premCards} onChange={(e) => setPremCards(e.target.value)} />
                <button className="dw-btn primary" disabled={!premN || (player?.coins || 0) < premN * 150}
                  onClick={() => onBuyCardsCount('premium', premN)}>
                  {premN ? `Купить · ${formatCoins(premN * 150)}` : 'Купить'}
                </button>
              </div>
            </div>
          </div>
        )}

        {payPending && (
          <div className="dw-pay-loading"><div className="dw-pay-spinner" /><span>Создаём счёт…</span></div>
        )}

        {tonIntent && !payPending && (
          <article className="dw-ton-intent">
            <span className="dw-kicker">Реквизиты перевода</span>
            <div className="dw-ton-intent-row"><span>Кошелёк</span><strong className="dw-wallet-addr">{(tonIntent.wallet || '').slice(0, 14)}…</strong></div>
            <div className="dw-ton-intent-row"><span>Сумма</span><strong>{tonIntent.amountTon} TON</strong></div>
            <div className="dw-ton-intent-row"><span>Memo</span><strong style={{ fontSize: 11, wordBreak: 'break-all' }}>{tonIntent.comment || ''}</strong></div>
            <p className="dw-ton-intent-note">Отправь точную сумму с этим комментарием.</p>
            <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
              <button className="dw-btn primary" style={{ flex: 1 }} onClick={() => {
                const link = `ton://transfer/${tonIntent.wallet}?amount=${tonIntent.amountNanoton}&text=${encodeURIComponent(tonIntent.comment)}`;
                if (window.Telegram?.WebApp?.openLink) window.Telegram.WebApp.openLink(link);
                else window.open(link, '_blank');
              }}>Открыть кошелёк</button>
              <button className="dw-btn secondary" style={{ flex: 1 }} onClick={() => navigator.clipboard?.writeText(tonIntent.comment).catch(() => {})}>Скопировать</button>
            </div>
          </article>
        )}
      </motion.div>
    </motion.div>
  );
}

/* ─── PvP Round Result Modal ──────────────────────────────── */

function PvpRoundResultModal({ result, myUserId, entryCoins, onClose, onOpenDeposit }) {
  const cards = result?.cards || [];
  const takenCards = cards.filter(c => c.taken);
  const winners = takenCards.filter(c => c.outcome?.credit > 0)
    .sort((a, b) => b.outcome.credit - a.outcome.credit);
  const losers = takenCards.filter(c => !c.outcome?.credit);
  const myCard = cards.find(c => c.mine);
  const myWon = myCard?.outcome?.credit || 0;
  const isWinner = myWon > 0;

  return (
    <motion.div className="dw-sheet-backdrop" onClick={onClose}
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.25 }}>
      <motion.div className="dw-round-result" onClick={e => e.stopPropagation()}
        initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }}
        transition={{ duration: 0.35, ease: [0.32, 0, 0, 1] }}>

        <div className="dw-round-result-header">
          <h2>{result?.lobby?.gameNum ? `Раунд #${result.lobby.gameNum} завершён` : 'Раунд завершён'}</h2>
          <button className="dw-icon-btn" onClick={onClose}>×</button>
        </div>

        {/* Мой результат */}
        {myCard && (
          <div className={`dw-round-my-result ${isWinner ? 'win' : 'lose'}`}>
            {isWinner ? (
              <>
                <span className="dw-round-result-emoji">🏆</span>
                <div>
                  <strong>Ты выиграл!</strong>
                  <p>+{myWon} монет зачислено</p>
                </div>
              </>
            ) : (
              <>
                <span className="dw-round-result-emoji">💀</span>
                <div>
                  <strong>В этот раз не повезло</strong>
                  <p>Карта оказалась пустой</p>
                </div>
              </>
            )}
          </div>
        )}

        {/* Победители */}
        {winners.length > 0 && (
          <div className="dw-round-section">
            <span className="dw-kicker" style={{ color: 'var(--gold)' }}>Победители</span>
            {winners.map((c, i) => {
              const u = userDisplay(c.owner);
              const isMine = c.mine;
              return (
                <div key={i} className={`dw-round-row${isMine ? ' dw-round-row--mine' : ''}`}>
                  <span className="dw-round-row-avatar" style={u.avatarUrl ? { padding: 0, overflow: 'hidden' } : {}}>
                    {u.avatarUrl ? <img src={u.avatarUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: '50%' }} /> : u.initial}
                  </span>
                  <span className="dw-round-row-name">{u.displayName}{isMine ? ' (ты)' : ''}</span>
                  <span className="dw-round-row-prize pos">+{c.outcome.credit}</span>
                </div>
              );
            })}
          </div>
        )}

        {/* Проигравшие */}
        {losers.length > 0 && (
          <div className="dw-round-section">
            <span className="dw-kicker" style={{ color: 'var(--bone-soft)' }}>Выбыли</span>
            {losers.slice(0, 8).map((c, i) => {
              const u = userDisplay(c.owner);
              const isMine = c.mine;
              return (
                <div key={i} className={`dw-round-row${isMine ? ' dw-round-row--mine' : ''}`} style={{ opacity: isMine ? 1 : 0.6 }}>
                  <span className="dw-round-row-avatar" style={u.avatarUrl ? { padding: 0, overflow: 'hidden' } : {}}>
                    {u.avatarUrl ? <img src={u.avatarUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: '50%' }} /> : u.initial}
                  </span>
                  <span className="dw-round-row-name">{u.displayName}{isMine ? ' (ты)' : ''}</span>
                  <span className="dw-round-row-prize neg">—{entryCoins}</span>
                </div>
              );
            })}
          </div>
        )}

        <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
          <button className="dw-btn primary" style={{ flex: 2 }} onClick={onClose}>
            Новый раунд
          </button>
          {!isWinner && (
            <button className="dw-btn ghost" style={{ flex: 1 }} onClick={onOpenDeposit}>
              Пополнить
            </button>
          )}
        </div>
      </motion.div>
    </motion.div>
  );
}

/* ─── Helper components ───────────────────────────────────── */

function QuestPanel({ title, items, onClaim }) {
  return (
    <article className="dw-panel">
      <div className="dw-panel-head">
        <h2>{title}</h2>
      </div>
      <div className="dw-history-list">
        {items.map((item) => (
          <div className="dw-history-row dw-quest-row" key={item.id}>
            <div className="dw-history-copy">
              <strong>{item.title}</strong>
              <p>{item.progress}</p>
            </div>
            {item.state === 'claimable' ? (
              <button className="dw-btn primary small dw-claim-btn" onClick={() => onClaim(item.id)}>
                +{item.xp} XP
              </button>
            ) : (
              <span className={`dw-badge ${item.state === 'claimed' ? 'accent' : ''}`}>
                {item.state === 'claimed' ? 'Сдано' : `+${item.xp} XP`}
              </span>
            )}
          </div>
        ))}
      </div>
    </article>
  );
}

function RewardCell({ title, reward, onClaim, locked }) {
  return (
    <div className={`dw-reward-cell ${reward.state}`}>
      <span>{title}</span>
      <strong>{reward.title}</strong>
      {reward.state === 'claimable' && !locked ? (
        <button className="dw-btn primary small dw-claim-btn" onClick={onClaim}>Claim</button>
      ) : (
        <em className={locked ? 'locked' : reward.state}>
          {locked ? 'Premium' : reward.state === 'claimed' ? 'получено' : reward.state}
        </em>
      )}
    </div>
  );
}

function StatTile({ label, value }) {
  return (
    <div className="dw-stat-tile">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function EmptyState({ title, copy }) {
  return (
    <article className="dw-empty-state">
      <div className="dw-empty-seal">DW</div>
      <strong>{title}</strong>
      <p>{copy}</p>
    </article>
  );
}

function Toast({ toast }) {
  return <div className={`dw-toast ${toast.tone}`}>{toast.text}</div>;
}

function TicketsShop({ ticketPacks, inventory, balance, onBuyTickets }) {
  const cheap = ticketPacks?.cheap || [];
  const premium = ticketPacks?.premium || [];

  return (
    <div className="dw-stack">
      <div className="dw-tickets-strip">
        <article className={`dw-ticket-card ${inventory.cheap > 0 ? '' : 'empty'}`}>
          <span className="dw-kicker">Дешёвые карты</span>
          <div className="dw-ticket-count">{inventory.cheap}</div>
          <p>Сжигаются при покупке PvP-карты вместо монет.</p>
        </article>
        <article className={`dw-ticket-card ${inventory.premium > 0 ? '' : 'empty'}`}>
          <span className="dw-kicker">Премиум карты</span>
          <div className="dw-ticket-count">{inventory.premium}</div>
          <p>Сжигаются при печати соло-завещания вместо 150 монет.</p>
        </article>
      </div>

      {cheap.length > 0 && (
        <article className="dw-panel">
          <div className="dw-tickets-section-head">
            <h3>Дешёвые карты</h3>
            <span>5 монет за штуку</span>
          </div>
          <div className="dw-ticket-pack-list">
            {cheap.map((pack) => {
              const each = (pack.priceCoins / pack.count).toFixed(2).replace(/\.00$/, '');
              const cant = balance < pack.priceCoins;
              return (
                <button
                  key={pack.id}
                  className="dw-ticket-pack"
                  onClick={() => !cant && onBuyTickets('cheap', pack)}
                  disabled={cant}
                >
                  <span className="dw-ticket-pack-glyph" />
                  <span className="dw-ticket-pack-copy">
                    <strong>{pack.count} карт</strong>
                    <span>{each} монет за карту{pack.count >= 20 ? ' · скидка' : ''}</span>
                  </span>
                  <span className="dw-ticket-pack-price">{formatCoins(pack.priceCoins)}</span>
                </button>
              );
            })}
          </div>
        </article>
      )}

      {premium.length > 0 && (
        <article className="dw-panel">
          <div className="dw-tickets-section-head">
            <h3>Премиум карты</h3>
            <span>150 монет за штуку</span>
          </div>
          <div className="dw-ticket-pack-list">
            {premium.map((pack) => {
              const each = Math.round(pack.priceCoins / pack.count);
              const cant = balance < pack.priceCoins;
              return (
                <button
                  key={pack.id}
                  className="dw-ticket-pack"
                  onClick={() => !cant && onBuyTickets('premium', pack)}
                  disabled={cant}
                >
                  <span className="dw-ticket-pack-glyph" />
                  <span className="dw-ticket-pack-copy">
                    <strong>{pack.count} карт{pack.count > 1 ? '' : 'а'}</strong>
                    <span>{each} монет за карту{pack.count >= 5 ? ' · скидка' : ''}</span>
                  </span>
                  <span className="dw-ticket-pack-price">{formatCoins(pack.priceCoins)}</span>
                </button>
              );
            })}
          </div>
        </article>
      )}
    </div>
  );
}

export default App;
