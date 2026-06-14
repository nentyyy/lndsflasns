import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { useTonConnectUI, useTonWallet } from '@tonconnect/ui-react';
import BottomBar from './components/BottomBar';
import AdminPanel from './components/AdminPanel';
import Splash from './components/Splash';
import { api } from './api.js';
import * as sfx from './sfx.js';
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
// rarity removed per Task 2 — import kept empty to avoid breaking JSX references below
const NFT_RARITIES = [];
const RARITY_COLOR = {};

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

const tabs = ['play', 'solo', 'shop', 'clans', 'profile'];
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
  const [board, setBoard] = useState(null); // что было под каждой премиум-картой
  const [shopTab, setShopTab] = useState('nft');
  const [historyFilter, setHistoryFilter] = useState('all');
  const [toast, setToast] = useState(null);
  const [cardsModalOpen, setCardsModalOpen] = useState(false);
  const [winStreak, setWinStreak] = useState(0); // >0 победы подряд, <0 поражения
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
  const [tutorialOpen, setTutorialOpen] = useState(false);
  const [wheelOpen, setWheelOpen] = useState(false);
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

  // Автопоказ туториала новичку — один раз.
  useEffect(() => {
    if (!bootReady) return;
    let seen = false;
    try { seen = localStorage.getItem('dw_tut_seen') === '1'; } catch {}
    if (state.player?.welcomeAvailable && !seen) {
      setTutorialOpen(true);
      try { localStorage.setItem('dw_tut_seen', '1'); } catch {}
    }
  }, [bootReady, state.player?.welcomeAvailable]);

  // Глобальное обновление баланса/инвентаря раз в 12с — баланс свежий ВЕЗДЕ.
  useEffect(() => {
    if (!bootReady) return undefined;
    const id = setInterval(() => {
      api.me().then((m) => {
        if (m?.player) setState((c) => ({ ...c, player: { ...c.player, ...m.player } }));
      }).catch(() => {});
    }, 12000);
    return () => clearInterval(id);
  }, [bootReady]);

  // Polling PvP лобби пока пользователь на Will/pvp.
  useEffect(() => {
    let cancelled = false;
    let timer;
    if (tab !== 'play') return undefined;
    let prevStatus = null;
    const tick = async () => {
      try {
        const s = await api.pvpState('cheap');
        if (!cancelled) {
          // Раунд только что завершился — авто-показ итогов через 1с
          // (только если игрок участвовал — иначе модал не нужен).
          if (prevStatus === 'open' && s?.lobby?.status === 'settled') {
            // Динамика по завершении раунда: баланс + лента победителей (для «Прошлый раунд»).
            api.me().then((m) => {
              if (!cancelled && m?.player) setState((c) => ({ ...c, player: { ...c.player, ...m.player } }));
            }).catch(() => {});
            api.liveFeed().then((f) => { if (!cancelled && Array.isArray(f?.feed || f)) setLiveWins(f.feed || f); }).catch(() => {});
            const myCards = (s.cards || []).filter((c) => c.mine);
            if (myCards.length) {
              // Стрик: победа = суммарный приз > суммарной ставки.
              const won = myCards.reduce((sum, c) => sum + (c.outcome?.credit || 0), 0)
                > myCards.length * (s.lobby?.entryCoins || 5);
              setWinStreak((v) => {
                const next = won ? (v > 0 ? v + 1 : 1) : (v < 0 ? v - 1 : -1);
                return next;
              });
              // Даём доиграть каскадному открытию (~4с) + пауза,
              // поле с раскрытыми картами остаётся видимым, затем итоговый экран.
              setTimeout(() => { if (!cancelled) setPvpRoundResult(s); }, 4600);
            }
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
  }, [tab]);

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
      if (e.message === 'insufficient_balance') notify('Недостаточно дублонов', 'danger');
      else notify('Не удалось купить', 'danger');
    }
  };

  // Покупка карт по введённому числу (оплата дублонами).
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
      if (e.message === 'insufficient_balance') notify('Недостаточно дублонов', 'danger');
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
      if (e.message === 'need_card') {
        // PvP только за карты — перекидываем в покупку карт.
        notify('Нужна карта — купи карты, чтобы играть', 'violet');
        setDepositOpen(true); setDepositView('cards'); setTonIntent(null);
      }
      else if (e.message === 'card already taken') notify('Карту уже забрали', 'danger');
      else if (e.status === 401) notify('Сессия истекла — открой игру заново через бота', 'danger');
      else if (!e.status) notify('Бэкенд не отвечает (порт 3000?)', 'danger');
      else notify(`Ошибка ${e.status}: ${e.message}`, 'danger');
    } finally {
      setPvpBuying(false);
    }
  };

  // Случайная расстановка: выбираешь количество ячеек, сервер ставит их рандомно.
  const buyRandomCells = async (count) => {
    if (pvpBuying) return;
    setPvpBuying(true);
    try {
      const s = await api.pvpBuyRandom('cheap', count);
      setPvpState({ lobby: s.lobby, cards: s.cards });
      api.me().then((m) => { if (m?.player) setState((c) => ({ ...c, player: { ...c.player, ...m.player } })); }).catch(() => {});
      notify(s.placed < count ? `Поставлено ${s.placed} из ${count} (не хватило карт)` : `Поставлено ${s.placed} ячеек 🎲`, 'success');
      window.Telegram?.WebApp?.HapticFeedback?.impactOccurred?.('medium');
    } catch (e) {
      if (e.message === 'need_card') {
        notify('Нужны карты — купи карты, чтобы играть', 'violet');
        setDepositOpen(true); setDepositView('cards'); setTonIntent(null);
      } else if (e.status === 401) notify('Сессия истекла — открой игру заново через бота', 'danger');
      else notify('Не удалось поставить', 'danger');
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
        api.referral().then(setRefData).catch(() => setRefData((r) => r ? { ...r, pending: 0 } : r));
        notify(`+${formatCoins(res.claimed)} дублонов реферальных`, 'success');
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
              notify(`+${formatCoins(pack.coins + pack.bonus)} дублонов зачислено`, 'success');
              setTimeout(wheelBaitAfterDeposit, 1800);
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

  // Динамический Stars-платёж: любая сумма дублонов (>=1), цена с сервера.
  // Байт колеса после депозита: показывает прогресс к доступу.
  const wheelBaitAfterDeposit = async () => {
    try {
      const w = await api.wheel();
      if (w.unlocked) {
        notify('🎡 Колесо разблокировано! Крути каждый день — профиль › Колесо', 'success');
        setTimeout(() => { setTab('profile'); }, 1600);
      } else if (w.tonNeeded > 0) {
        notify(`🎡 Ещё +${w.tonNeeded} TON за неделю — и крутишь колесо каждый день!`, 'violet');
      }
    } catch {}
  };

  const handleStarsCustom = async (coins) => {
    const webApp = window.Telegram?.WebApp;
    if (!coins || coins < 1) { notify('Минимум 1 дублон (20 ⭐)', 'danger'); return; }
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
              notify(`+${formatCoins(credited)} дублонов зачислено`, 'success');
              setTimeout(wheelBaitAfterDeposit, 1800);
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

  // Динамический TON-платёж на произвольное число дублонов (через TonConnect).
  const handleTonCustom = async (coins) => {
    if (!coins || coins < 1) { notify('Минимум 1 дублон (0.1 TON)', 'danger'); return; }
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
          notify(`+${formatCoins(pack.coins + pack.bonus)} дублонов зачислено`, 'success');
          window.Telegram?.WebApp?.HapticFeedback?.notificationOccurred?.('success');
          setTimeout(wheelBaitAfterDeposit, 1800);
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
      notify('Недостаточно дублонов', 'danger');
      return;
    }
    try {
      const res = await api.portalsBuy(item.id);
      setState((c) => ({ ...c, player: { ...c.player, coins: res.player.coins } }));
      notify(`Куплено: ${item.name || item.title}`, 'success');
      window.Telegram?.WebApp?.HapticFeedback?.notificationOccurred?.('success');
    } catch (e) {
      if (e.message === 'insufficient_balance') notify('Недостаточно дублонов', 'danger');
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
      notify('Премиум-карта сожжена', 'violet');
    } catch (e) {
      if (e.message === 'need_card') {
        notify('Нужна премиум-карта — купи карты', 'violet');
        setDepositOpen(true); setDepositView('cards'); setTonIntent(null);
      }
      else if (e.message === 'insufficient_balance') notify('Недостаточно дублонов', 'danger');
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
        setBoard(out.board || null);
        setRevealing(false);
        setRoundArmed(false);
        setRoundId(null);

        setState((current) => ({
          ...current,
          player: {
            ...current.player,
            coins: out.balance,
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
    setBoard(null);
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

  // Забрать майлстоун-награду (новая реф-система).
  const claimRefMilestone = async (milestoneId) => {
    try {
      const res = await api.claimMilestone(milestoneId);
      if (res.player) setState((c) => ({ ...c, player: { ...c.player, coins: res.player.coins } }));
      const fresh = await api.referral().catch(() => null);
      if (fresh) setRefData(fresh);
      notify(`+${formatCoins(res.reward)} дублонов — награда за друзей`, 'success');
    } catch (e) {
      notify(e.message === 'already_claimed' ? 'Уже получено' : e.message === 'not_enough_invites' ? 'Недостаточно друзей' : 'Ошибка', 'danger');
    }
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
          <TopBar player={state.player} tonWallet={tonWallet} streak={Math.max(0, winStreak)} onOpenDeposit={() => { setDepositOpen(true); setDepositView('main'); setTonIntent(null); }} onOpenTutorial={() => setTutorialOpen(true)} onOpenCards={() => setCardsModalOpen(true)} />

          {tab === 'play' && (
            <section className="dw-page dw-play-page">
              <PvpPanel
                welcomeAvailable={state.player.welcomeAvailable}
                tickets={state.player.tickets || { cheap: 0, premium: 0 }}
                pvpTotalReveals={state.player.pvpTotalReveals || 0}
                pvpState={pvpState}
                pvpBuying={pvpBuying}
                balance={state.player.coins}
                myUserId={state.player.id}
                lastWinner={liveWins[0] || null}
                onOpenRounds={() => setRoundsOpen(true)}
                onBuyPvpCard={buyPvpCard}
                onBetRandom={buyRandomCells}
                onOpenDeposit={() => { setDepositOpen(true); setDepositView('cards'); setTonIntent(null); }}
                onOpenPlayerProfile={openPlayerProfile}
              />
            </section>
          )}

          {tab === 'solo' && (
            <section className="dw-page dw-play-page">
              <SoloPanel
                mode={state.wills.find((w) => w.id === 'premium') || state.wills[0]}
                balance={state.player.coins}
                roundArmed={roundArmed}
                revealing={revealing}
                selectedClause={selectedClause}
                result={result}
                board={board}
                tickets={state.player.tickets || { cheap: 0, premium: 0 }}
                onArmRound={armRound}
                onPickClause={playRound}
                onResetRound={resetRound}
                onOpenDeposit={() => { setDepositOpen(true); setDepositView('cards'); setTonIntent(null); }}
                onNotify={notify}
                onBalance={(coins) => setState((c) => ({ ...c, player: { ...c.player, coins } }))}
                onTickets={(t) => setState((c) => ({ ...c, player: { ...c.player, tickets: t } }))}
              />
            </section>
          )}

          {tab === 'clans' && (
            <ClansTab
              player={state.player}
              onBack={() => setTab('play')}
              onNotify={notify}
            />
          )}

          {tab === 'referral' && (
            <ReferralTab
              referral={refData || state.referral}
              player={state.player}
              onCopy={copyRefLink}
              onShare={shareRef}
              onClaimMilestone={claimRefMilestone}
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
              onNotify={notify}
              onBalance={(coins) => setState((c) => ({ ...c, player: { ...c.player, coins } }))}
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
              onOpenRef={() => { setTab('referral'); api.referral().then(setRefData).catch(() => {}); }}
              onOpenWheel={() => setWheelOpen(true)}
              onOpenMyRounds={() => setRoundsOpen('mine')}
              onNotify={notify}
              onBalance={(coins) => setState((c) => ({ ...c, player: { ...c.player, coins } }))}
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
            notify(`+${formatCoins(coins)} дублонов зачислено`, 'success');
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
        <RoundsHistory myId={state.player.id} initialSort={typeof roundsOpen === 'string' ? roundsOpen : 'all'} onClose={() => setRoundsOpen(false)} />
      )}

      {cardsModalOpen && (
        <CardsModal player={state.player} onBuy={buyCardsCount} onClose={() => setCardsModalOpen(false)} />
      )}

      {tutorialOpen && (
        <Tutorial
          isNew={Boolean(state.player.welcomeAvailable)}
          onNavigate={(t) => { setTab(t); }}
          onPlayFree={() => { setTutorialOpen(false); setTab('play'); notify('Открой любую карту — первая бесплатно!', 'success'); }}
          onClose={() => setTutorialOpen(false)}
        />
      )}

      {wheelOpen && (
        <WheelModal
          onClose={() => setWheelOpen(false)}
          onReward={() => { api.me().then((m) => { if (m?.player) setState((c) => ({ ...c, player: { ...c.player, ...m.player } })); }).catch(() => {}); }}
        />
      )}

      {pvpRoundResult && (
        <PvpRoundResultModal
          result={pvpRoundResult}
          myUserId={state.player.id}
          entryCoins={pvpRoundResult.lobby?.entryCoins || 5}
          onClose={() => setPvpRoundResult(null)}
          onOpenDeposit={() => { setPvpRoundResult(null); setDepositOpen(true); setDepositView('main'); }}
          onOpenShop={() => { setPvpRoundResult(null); setTab('shop'); }}
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

/* ─── Туториал для новичков ───────────────────────────────── */

const TUTORIAL_STEPS = [
  { tab: 'play', demo: 'cards', icon: '🎴', title: 'ЖИВЫЕ РАУНДЫ', text: 'Открывай ячейки в PvP-раунде на 36 карт. За золотыми — дублоны, пустые гаснут. Каждое 10-е открытие — бесплатное!' },
  { tab: 'shop', demo: 'vault', icon: '🏦', title: 'СЕЙФ', text: 'Пополняй баланс через Stars или TON и покупай карты для игры — без них в раунд не зайти.' },
  { tab: 'profile', demo: 'profile', icon: '👤', title: 'ПРОФИЛЬ', text: 'Статистика, кланы и рефералка — зови друзей и получай 10% с каждого их пополнения.' }
];

function TutorialDemo({ kind }) {
  if (kind === 'cards') {
    return (
      <div className="dw-tut-demo dw-tut-demo-cards">
        {['+40', '', '+8', '', '+3'].map((v, i) => (
          <motion.div key={i}
            className={`dw-tut-mini-card ${v ? 'win' : 'empty'}`}
            initial={{ rotateY: 90, opacity: 0 }}
            animate={{ rotateY: 0, opacity: v ? 1 : 0.18 }}
            transition={{ delay: 0.12 * i, duration: 0.35, ease: [0.34, 1.56, 0.64, 1] }}>
            {v || '·'}
          </motion.div>
        ))}
      </div>
    );
  }
  if (kind === 'vault') {
    return (
      <div className="dw-tut-demo dw-tut-demo-vault">
        {['⭐', '💎', '🪙'].map((e, i) => (
          <motion.span key={i} className="dw-tut-vault-coin"
            initial={{ y: 14, opacity: 0 }} animate={{ y: 0, opacity: 1 }}
            transition={{ delay: 0.15 * i, type: 'spring', stiffness: 320 }}>{e}</motion.span>
        ))}
      </div>
    );
  }
  return (
    <div className="dw-tut-demo dw-tut-demo-profile">
      <motion.div className="dw-tut-prof-ava" initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ type: 'spring', stiffness: 300 }}>☠️</motion.div>
      <div className="dw-tut-prof-bars">
        {[70, 45, 88].map((w, i) => (
          <motion.span key={i} className="dw-tut-prof-bar"
            initial={{ width: 0 }} animate={{ width: `${w}%` }} transition={{ delay: 0.1 * i + 0.2, duration: 0.5 }} />
        ))}
      </div>
    </div>
  );
}

function Tutorial({ isNew, onNavigate, onPlayFree, onClose }) {
  const [step, setStep] = useState(0);
  const total = TUTORIAL_STEPS.length;
  const last = step >= total;

  useEffect(() => {
    if (!last) onNavigate(TUTORIAL_STEPS[step].tab);
  }, [step]);

  const s = TUTORIAL_STEPS[step];
  const progress = Math.min(100, ((step + 1) / (total + 1)) * 100);

  return (
    <motion.div className="dw-sheet-backdrop dw-tut-backdrop" onClick={onClose}
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.2 }}>
      <motion.div className="dw-tut-card" onClick={(e) => e.stopPropagation()}
        initial={{ y: 30, opacity: 0, scale: 0.96 }} animate={{ y: 0, opacity: 1, scale: 1 }} transition={{ duration: 0.32, ease: [0.2, 0, 0, 1] }}>
        <button className="dw-icon-btn dw-tut-close" onClick={onClose}>×</button>

        <div className="dw-tut-progress"><span style={{ width: `${progress}%` }} /></div>

        <AnimatePresence mode="wait">
          {!last ? (
            <motion.div key={step} className="dw-tut-step"
              initial={{ x: 40, opacity: 0 }} animate={{ x: 0, opacity: 1 }} exit={{ x: -40, opacity: 0 }} transition={{ duration: 0.28 }}>
              <TutorialDemo kind={s.demo} />
              <div className="dw-tut-icon">{s.icon}</div>
              <h2 className="dw-tut-title">{s.title}</h2>
              <p className="dw-tut-text">{s.text}</p>
              <div className="dw-tut-dots">
                {TUTORIAL_STEPS.map((_, i) => <span key={i} className={`dw-tut-dot ${i === step ? 'active' : ''}`} />)}
              </div>
              <div style={{ display: 'flex', gap: 10 }}>
                <button className="dw-btn ghost" style={{ flex: 1 }} onClick={onClose}>Пропустить</button>
                <button className="dw-btn primary" style={{ flex: 2 }} onClick={() => setStep(step + 1)}>Далее ›</button>
              </div>
            </motion.div>
          ) : (
            <motion.div key="final" className="dw-tut-step"
              initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.3 }}>
              <motion.div className="dw-tut-icon dw-tut-icon-final"
                animate={{ scale: [1, 1.18, 1], rotate: [0, -6, 6, 0] }} transition={{ duration: 1.1, repeat: Infinity }}>
                {isNew ? '🎁' : '✨'}
              </motion.div>
              <h2 className="dw-tut-title">{isNew ? 'Первая ставка — бесплатно!' : 'Готово!'}</h2>
              <p className="dw-tut-text">
                {isNew
                  ? 'Открой любую ячейку в PvP-раунде — первая попытка ничего не стоит. Удачи!'
                  : 'Теперь ты знаешь, как играть. Удачи в раундах!'}
              </p>
              {isNew
                ? <button className="dw-btn primary full dw-tut-cta" onClick={onPlayFree}>🎴 Сделать бесплатную ставку</button>
                : <button className="dw-btn primary full" onClick={onClose}>Понятно</button>}
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
    </motion.div>
  );
}

/* ─── Колесо бонусов ──────────────────────────────────────── */

function WheelBanner({ bonusPct, onOpen, locked, tonNeeded }) {
  return (
    <button className={`dw-wheel-banner${locked ? ' locked' : ''}`} onClick={onOpen}>
      <span className="dw-wheel-banner-ico">🎡</span>
      <span className="dw-wheel-banner-txt">
        <strong>Колесо фортуны</strong>
        <small>
          {locked ? `Внеси ещё ${tonNeeded} TON за неделю` : bonusPct > 0 ? `Активен бонус +${bonusPct}% к депозиту` : 'Крути каждый день — забирай призы'}
        </small>
      </span>
      <span className="dw-wheel-banner-go">{locked ? '🔒' : '›'}</span>
    </button>
  );
}

// Цвет сектора по типу — для красочного колеса.
const WHEEL_COLORS = {
  deposit_bonus: ['#3a2a6e', '#5a4a96'],
  coins: ['#7a5210', '#b8862b'],
  tickets: ['#0e5a4a', '#15917a'],
  nft: ['#7a1248', '#ff5ca8']
};
function wheelShort(seg) {
  if (seg.type === 'coins') return `+${seg.value} дбл`;
  if (seg.type === 'deposit_bonus') return `+${seg.value}%`;
  if (seg.type === 'nft') return 'НФТ';
  if (seg.type === 'tickets') return 'Карта';
  return '🎴';
}

function WheelModal({ onClose, onReward }) {
  const [data, setData] = useState(null);
  const [spinning, setSpinning] = useState(false);
  const [rotation, setRotation] = useState(0);
  const [result, setResult] = useState(null);
  const [now, setNow] = useState(Date.now());
  const rotRef = React.useRef(0);

  const [nftLogo, setNftLogo] = useState(null); // случайное лого НФТ для сектора
  useEffect(() => { api.wheel().then(setData).catch(() => setData({ error: true })); }, []);
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, []);
  // Случайный логотип НФТ из дешёвого флора для отрисовки в секторе.
  useEffect(() => {
    api.gifts().then((d) => {
      const list = (d?.gifts || d || []).filter((g) => g.file && g.priceCoins > 0 && g.priceCoins <= 30);
      const pool = list.length ? list : (d?.gifts || d || []).filter((g) => g.file);
      if (pool.length) setNftLogo(pool[Math.floor(Math.random() * pool.length)].file);
    }).catch(() => {});
  }, []);

  const segs = data?.segments || [];
  const N = segs.length || 8;
  const seg = 360 / N;

  const nextAt = data?.nextSpinAt ? new Date(data.nextSpinAt).getTime() : 0;
  const onCooldown = data && !data.canSpin && data.unlocked && nextAt > now;
  const waitLabel = () => {
    const ms = Math.max(0, nextAt - now);
    const h = Math.floor(ms / 3.6e6), m = Math.floor((ms % 3.6e6) / 6e4);
    return h > 0 ? `${h}ч ${m}м` : `${m}м`;
  };

  const [spinDur, setSpinDur] = useState(4.2);
  const [confetti, setConfetti] = useState(false);

  const spin = async () => {
    if (spinning || !data?.canSpin) return;
    setSpinning(true); setResult(null); setConfetti(false);
    try {
      const out = await api.wheelSpin();
      // Целевой угол: указатель сверху над центром выпавшего сектора.
      const aim = (idx, spins, jitter = 0) => Math.ceil(rotRef.current / 360) * 360 + 360 * spins + (360 - (idx * seg + seg / 2)) + jitter;

      // Байт-прокрут: 55% — тормозим у соседнего сектора, замираем, доползаем.
      const bait = Math.random() < 0.55;
      if (bait) {
        const neighbour = (out.segmentIndex + 1) % N;
        const stop1 = aim(neighbour, 5, seg * 0.35);
        rotRef.current = stop1; setSpinDur(3.6); setRotation(stop1); sfx.tick(0.5);
        await new Promise((r) => setTimeout(r, 3700));
        await new Promise((r) => setTimeout(r, 650)); // «замерло»
        window.Telegram?.WebApp?.HapticFeedback?.impactOccurred?.('light');
        const stop2 = aim(out.segmentIndex, 1);
        rotRef.current = stop2; setSpinDur(1.2); setRotation(stop2);
        await new Promise((r) => setTimeout(r, 1300));
      } else {
        const next = aim(out.segmentIndex, 6);
        rotRef.current = next; setSpinDur(4.2); setRotation(next);
        await new Promise((r) => setTimeout(r, 4300));
      }

      setResult({ ...out.reward, nftFile: out.nft?.file || null });
      setSpinning(false);
      setData((d) => ({ ...d, canSpin: false, nextSpinAt: out.nextSpinAt }));
      onReward && onReward(out);
      const big = out.reward?.type === 'nft' || out.reward?.type === 'deposit_bonus';
      if (big) { setConfetti(true); setTimeout(() => setConfetti(false), 3000); sfx.winFanfare(); }
      window.Telegram?.WebApp?.HapticFeedback?.notificationOccurred?.('success');
    } catch (e) {
      setSpinning(false);
      if (e.message === 'cooldown') setData((d) => ({ ...d, canSpin: false }));
    }
  };

  const xy = (r, aDeg) => { const a = (aDeg * Math.PI) / 180; return [100 + r * Math.sin(a), 100 - r * Math.cos(a)]; };

  return (
    <motion.div className="dw-sheet-backdrop" onClick={onClose}
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.25 }}>
      <motion.div className="dw-wheel-sheet dw-wheel-sheet--rich" onClick={(e) => e.stopPropagation()}
        initial={{ y: 40, opacity: 0, scale: 0.96 }} animate={{ y: 0, opacity: 1, scale: 1 }} transition={{ duration: 0.3 }}>
        {confetti && (
          <span className="dw-confetti">
            {Array.from({ length: 44 }).map((_, k) => (
              <span key={k} className="dw-confetti-bit" style={{
                left: `${Math.random() * 100}%`,
                background: ['#FFD700', '#4FC3F7', '#ff5ca8', '#6dbe88', '#fff6d0'][k % 5],
                animationDelay: `${Math.random() * 0.6}s`, animationDuration: `${1.8 + Math.random() * 1.4}s`
              }} />
            ))}
          </span>
        )}
        <div className="dw-round-result-header">
          <h2>🎡 Колесо фортуны</h2>
          <button className="dw-icon-btn" onClick={onClose}>×</button>
        </div>

        <div className="dw-wheel-stage">
          <div className="dw-wheel-pointer" />
          <svg viewBox="0 0 200 200" className="dw-wheel-svg">
            <defs>
              <radialGradient id="dw-wheel-hub" cx="50%" cy="40%" r="60%">
                <stop offset="0%" stopColor="#fff6d0" /><stop offset="55%" stopColor="#f3c33f" /><stop offset="100%" stopColor="#8a6c1c" />
              </radialGradient>
            </defs>
            <g style={{ transition: spinning ? `transform ${spinDur}s cubic-bezier(0.16,1,0.3,1)` : 'none', transform: `rotate(${rotation}deg)`, transformOrigin: '100px 100px' }}>
              {segs.map((s, i) => {
                const a0 = i * seg, a1 = (i + 1) * seg;
                const [x0, y0] = xy(96, a0), [x1, y1] = xy(96, a1);
                const [lx, ly] = xy(62, a0 + seg / 2);
                const pal = WHEEL_COLORS[s.type] || ['#3a2e0c', '#1c1710'];
                const fill = pal[i % 2];
                const isWin = result && segs[i].key === result.key;
                const isNft = s.type === 'nft';
                return (
                  <g key={i}>
                    <path d={`M100 100 L${x0} ${y0} A96 96 0 0 1 ${x1} ${y1} Z`}
                      fill={isWin ? pal[1] : fill} stroke="#ffe27a" strokeWidth={isWin ? 2 : 1}
                      opacity={result && !isWin ? 0.45 : 1} />
                    {isNft && nftLogo ? (
                      <g transform={`rotate(${a0 + seg / 2} ${lx} ${ly})`}>
                        <image href={`/gifts/${nftLogo}`} x={lx - 11} y={ly - 15} width={22} height={22} preserveAspectRatio="xMidYMid slice" />
                        <text x={lx} y={ly + 13} fill="#fff" fontSize="8" fontWeight="900" textAnchor="middle"
                          style={{ paintOrder: 'stroke', stroke: 'rgba(0,0,0,0.5)', strokeWidth: 0.6 }}>NFT</text>
                      </g>
                    ) : (
                      <text x={lx} y={ly} fill="#fff" fontSize="11" fontWeight="900"
                        textAnchor="middle" dominantBaseline="middle"
                        transform={`rotate(${a0 + seg / 2} ${lx} ${ly})`}
                        style={{ paintOrder: 'stroke', stroke: 'rgba(0,0,0,0.5)', strokeWidth: 0.6 }}>{wheelShort(s)}</text>
                    )}
                  </g>
                );
              })}
              <circle cx="100" cy="100" r="96" fill="none" stroke="#ffe27a" strokeWidth="3" opacity="0.6" />
              <circle cx="100" cy="100" r="16" fill="url(#dw-wheel-hub)" stroke="#1c1710" strokeWidth="2" />
            </g>
          </svg>
        </div>

        {result ? (
          <div className="dw-wheel-result">
            {result.nftFile && <img src={`/gifts/${result.nftFile}`} alt="" className="dw-wheel-result-nft" />}
            🎉 Выпало: <strong>{result.label}</strong>
          </div>
        ) : data?.unlocked === false ? (
          <div className="dw-wheel-locked">
            🔒 Пополни ещё на <strong>{data?.tonNeeded ?? '—'} TON</strong> за неделю, чтобы крутить
            <small>Считаем TON и Stars · за 7 дней: {data?.weekTon ?? 0} / {data?.requiredTon ?? 5} TON · потом колесо каждый день</small>
          </div>
        ) : (
          <div className="dw-wheel-hint">Бесплатный спин раз в 24 часа · всю неделю</div>
        )}

        {data?.canSpin ? (
          <button className="dw-btn primary full dw-wheel-spin" disabled={spinning} onClick={spin}>
            {spinning ? 'Крутим…' : '🎲 Крутить колесо'}
          </button>
        ) : onCooldown ? (
          <button className="dw-btn ghost full" disabled>Следующий спин через {waitLabel()}</button>
        ) : result ? (
          <button className="dw-btn primary full" onClick={onClose}>Забрать</button>
        ) : data?.unlocked === false ? (
          <button className="dw-btn primary full" onClick={() => { onClose(); }}>Пополнить</button>
        ) : (
          <button className="dw-btn ghost full" disabled>Недоступно</button>
        )}
      </motion.div>
    </motion.div>
  );
}

/* ─── Top bar ─────────────────────────────────────────────── */

function TopBar({ player, tonWallet, onOpenDeposit, onOpenTutorial, onOpenCards, streak = 0 }) {
  const u = userDisplay(player);
  const cards = player?.tickets?.cheap || 0;
  const [muted, setMuted] = React.useState(sfx.isMuted());

  // Count-up + вспышка при изменении баланса.
  const [shown, setShown] = React.useState(player.coins);
  const [bump, setBump] = React.useState(false);
  const prevBal = React.useRef(player.coins);
  React.useEffect(() => {
    const from = prevBal.current, to = player.coins;
    prevBal.current = to;
    if (from === to) { setShown(to); return; }
    if (to > from) { setBump(true); window.Telegram?.WebApp?.HapticFeedback?.impactOccurred?.('light'); setTimeout(() => setBump(false), 600); }
    let raf; const start = performance.now(); const dur = 600;
    const step = (now) => {
      const p = Math.min(1, (now - start) / dur);
      setShown(Math.round((from + (to - from) * (1 - Math.pow(1 - p, 3))) * 100) / 100);
      if (p < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [player.coins]);

  return (
    <motion.header className="dw-topbar"
      initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, ease: [0.2, 0, 0, 1] }}>
      <div className="dw-avatar" style={u.avatarUrl ? { padding: 0, overflow: 'hidden' } : {}}>
        {u.avatarUrl
          ? <img src={u.avatarUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: '50%' }} />
          : u.initial}
      </div>
      <button className="dw-help-btn" onClick={onOpenTutorial} aria-label="Как играть">?</button>
      <button className="dw-help-btn" onClick={() => { sfx.setMuted(!sfx.isMuted()); setMuted(sfx.isMuted()); }} aria-label="Звук">{muted ? '🔇' : '🔊'}</button>
      {streak >= 3 && (
        <span className={`dw-streak-badge ${streak >= 7 ? 's7' : streak >= 5 ? 's5' : ''}`}>
          {streak >= 7 ? '💀' : '🔥'} ×{streak}
        </span>
      )}
      <button className="dw-cards-pill" onClick={onOpenCards}>
        🎴 <strong>{formatCoins(cards)}</strong>
      </button>
      <div style={{ flex: 1 }} />
      <button className="dw-balance-pill" onClick={onOpenDeposit}>
        <span className="dw-coin-dot" />
        <strong className={`dw-balance-num${bump ? ' dw-balance-bump' : ''}`}>{formatCoins(shown)}</strong>
        <span className="dw-plus-sign">+</span>
      </button>
    </motion.header>
  );
}

/* Модал покупки PvP-карт из топбара */
function CardsModal({ player, onBuy, onClose }) {
  const [count, setCount] = useState(1);
  const cards = player?.tickets?.cheap || 0;
  const PRICE = 5;
  const total = count * PRICE;
  const canAfford = (player?.coins || 0) >= total;
  return (
    <motion.div className="dw-sheet-backdrop" onClick={onClose}
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
      <motion.div className="dw-cards-modal" onClick={(e) => e.stopPropagation()}
        initial={{ y: 30, opacity: 0 }} animate={{ y: 0, opacity: 1 }}>
        <div className="dw-round-result-header">
          <h2>🎴 Карты</h2>
          <button className="dw-icon-btn" onClick={onClose}>×</button>
        </div>
        <p style={{ fontSize: 14, margin: '0 0 4px' }}>PvP-карты: <strong>{formatCoins(cards)}</strong> шт.</p>
        <p style={{ fontSize: 13, color: 'var(--bone-soft)', margin: '0 0 14px' }}>Стоимость: {PRICE} дбл./карта</p>
        <div className="dw-bet-control">
          <div className="dw-bet-stepper">
            <button onClick={() => setCount(Math.max(1, count - 1))} disabled={count <= 1}>−</button>
            <span className="dw-bet-count">{count}</span>
            <button onClick={() => setCount(Math.min(500, count + 1))} disabled={count >= 500}>+</button>
          </div>
          <button className={`dw-btn ${canAfford ? 'primary' : 'ghost'} dw-bet-go`}
            disabled={!canAfford}
            onClick={async () => { await onBuy('cheap', count); onClose(); }}>
            {canAfford ? `Купить — ${formatCoins(total)} дбл.` : 'Мало дублонов'}
          </button>
        </div>
      </motion.div>
    </motion.div>
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
          <span className="dw-home-info-val">5 дублонов</span>
          <span className="dw-home-info-lbl">вход в раунд</span>
        </div>
        <div className="dw-home-info-sep" />
        <div className="dw-home-info-item">
          <span className="dw-home-info-val">+40 дублонов</span>
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
                <strong>{w.name}</strong> выиграл {w.amount} дублонов
              </span>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
/* ─── Play tab ────────────────────────────────────────────── */

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

function PvpCard({ card, idx, settled, revealOpen = true, pickable = false, artPick = false, artPickMine = false, hinted = false, pvpBuying, onBuyPvpCard, onArtPick, onOpenPlayerProfile, shuffling }) {
  const isRevealed = revealOpen && (settled || card.status === 'revealed') && card.outcome;
  const canPick = pickable && !card.taken && !settled && !pvpBuying;
  // artPick = свободные ячейки (place_choose), artPickMine = свои ячейки (double_cell/book)
  const canArt = (artPick && !card.taken && !settled) || (artPickMine && card.mine && !settled);
  const credit = isRevealed ? (card.outcome.credit || 0) : 0;
  const win = isRevealed && credit > 0;
  const empty = isRevealed && credit === 0;
  const isMax = credit >= 65; // максимальный приз — спецэффект
  // Монетка по номиналу: золото >=20, серебро 8-19, бронза 1-7, скрыта при 0.
  const coinTier = credit >= 20 ? 'gold' : credit >= 8 ? 'silver' : credit >= 1 ? 'bronze' : null;
  // Цвет рамки выигрышной: моя — синяя, чужая — жёлтая.
  const winMine = win && card.mine;
  const winOther = win && !card.mine;

  // Эффект однократно при появлении выигрыша: вспышка + частицы + вибрация.
  const [fx, setFx] = React.useState(false);
  const firedRef = React.useRef(false);
  React.useEffect(() => {
    if (win && !firedRef.current) {
      firedRef.current = true;
      setFx(true);
      sfx.revealSound(credit); // звон по уровню приза
      const h = window.Telegram?.WebApp?.HapticFeedback;
      if (isMax) { h?.impactOccurred?.('heavy'); setTimeout(() => h?.impactOccurred?.('heavy'), 120); setTimeout(() => h?.impactOccurred?.('rigid'), 260); }
      else if (winMine) h?.impactOccurred?.('heavy');
      else h?.impactOccurred?.('medium');
      const t = setTimeout(() => setFx(false), 900);
      return () => clearTimeout(t);
    }
    if (!win) firedRef.current = false;
  }, [win, winMine, isMax]);

  // Частицы: моя — синие, остальные золотые. MAX — больше и ярче.
  const particleCount = isMax ? 18 : 12;
  const particleClass = winMine ? 'blue' : 'gold';

  const cls = [
    'dw-pvp-card',
    canPick || canArt ? 'dw-pvp-card--pick' : 'dw-pvp-card--locked',
    hinted ? 'dw-pvp-card--hint' : '',
    card.taken && !card.mine && !isRevealed ? 'taken' : '',
    card.mine && !isRevealed ? 'mine' : '',
    isRevealed ? 'revealed' : '',
    winMine ? 'win-mine' : '',
    winOther ? 'win-other' : '',
    empty ? 'empty' : '',
    isMax ? 'maxprize' : '',
    fx ? 'flash' : '',
    shuffling ? 'shuffling' : ''
  ].filter(Boolean).join(' ');

  const handleClick = canArt ? () => onArtPick(idx) : canPick ? () => onBuyPvpCard(idx) : undefined;

  return (
    <motion.div
      className={cls}
      onClick={handleClick}
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.18, delay: 0.008 * idx }}
      whileTap={handleClick ? { scale: 0.95 } : undefined}
    >
      {isMax && win && <span className="dw-max-label">MAX</span>}
      {isMax && win && fx && [0, 1, 2].map((k) => (
        <span key={k} className="dw-ring" style={{ animationDelay: `${k * 0.2}s` }} />
      ))}
      {win && fx && (
        <span className="dw-particles">
          {Array.from({ length: particleCount }).map((_, k) => {
            const ang = (Math.PI * 2 * k) / particleCount + (Math.random() - 0.5);
            const dist = (isMax ? 90 : 60) + Math.random() * (isMax ? 40 : 40);
            return (
              <span key={k} className={`dw-particle ${particleClass}${isMax ? ' big' : ''}`}
                style={{ '--px': `${Math.cos(ang) * dist}px`, '--py': `${-Math.abs(Math.sin(ang)) * dist - 20}px`, animationDelay: `${Math.random() * 0.15}s` }} />
            );
          })}
        </span>
      )}
      {card.owner && !isRevealed && (() => { const u = userDisplay(card.owner); return (
        <button className="dw-pvp-avatar-btn"
          onClick={(e) => { e.stopPropagation(); onOpenPlayerProfile(card.owner.userId); }}
          title={u.displayName}
          style={u.avatarUrl ? { padding: 0, overflow: 'hidden' } : {}}>
          {u.avatarUrl
            ? <img src={u.avatarUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
            : <span className="dw-pvp-avatar">{u.initial}</span>}
        </button>
      ); })()}
      {!isRevealed && <span className="dw-pvp-card-num">{idx + 1}</span>}
      {!isRevealed && <span className="dw-pvp-card-seal" />}
      {isRevealed && win && (
        <>
          {coinTier && <span className={`dw-pvp-coin dw-pvp-coin--${coinTier}`} />}
          <span className="dw-pvp-card-big">{credit}</span>
        </>
      )}
    </motion.div>
  );
}

function PvpWinnerStat({ label, winner, amount, right, onClick }) {
  const u = winner ? userDisplay(winner) : null;
  return (
    <button className={`dw-pvp-stat${right ? ' dw-pvp-stat--right' : ''}`} onClick={onClick}>
      <span>{label}</span>
      <div className="dw-pvp-stat-winner">
        {u && (
          <span className="dw-pvp-stat-ava" style={u.avatarUrl ? { padding: 0, overflow: 'hidden' } : {}}>
            {u.avatarUrl ? <img src={u.avatarUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: '50%' }} /> : u.initial}
          </span>
        )}
        <strong>{amount ? `+${formatCoins(amount)}` : '—'}</strong>
      </div>
      {u && <small className="dw-pvp-stat-name">{u.displayName}</small>}
    </button>
  );
}

function PvpPanel({ pvpState, pvpBuying, balance, welcomeAvailable, tickets, pvpTotalReveals, myUserId, lastWinner = null, onOpenRounds, onBuyPvpCard, onBetRandom, onOpenDeposit, onOpenPlayerProfile }) {
  const [tick, setTick] = useState(0);
  const [shuffling, setShuffling] = useState(false);
  const [revealStep, setRevealStep] = useState(9999); // сколько ячеек уже раскрыто (9999 = все)
  const [bestRound, setBestRound] = useState(null);
  const [bet, setBet] = useState(1); // сколько ячеек для рандомной ставки
  const [artifacts, setArtifacts] = useState([]);
  const [artPending, setArtPending] = useState(null); // { artifactId, kind } — ожидает выбора ячейки
  const [artHints, setArtHints] = useState(null); // { row?:[], cell?:number } — подсказка от Посоха/Путеводителя
  // Просмотр прошлых игр прямо на поле. pastList — список раундов, pastIdx — индекс
  // в списке (null = живая игра). pastDetail — детали выбранного раунда.
  const [pastList, setPastList] = useState([]);
  const [pastIdx, setPastIdx] = useState(null);
  const [pastDetail, setPastDetail] = useState(null);
  const prevStatus = React.useRef(null);

  // Лучший раунд (по призу) — для левой плашки шапки.
  useEffect(() => {
    api.rounds('best', 0, 1).then((d) => setBestRound(d.rounds?.[0] || null)).catch(() => {});
  }, [pvpState?.lobby?.status]);

  // Список прошлых раундов для перелистывания.
  useEffect(() => {
    api.rounds('all', 0, 50).then((d) => setPastList(d.rounds || [])).catch(() => {});
  }, [pvpState?.lobby?.status]);

  // Подгружаем детали выбранной прошлой игры.
  useEffect(() => {
    if (pastIdx === null || !pastList[pastIdx]) { setPastDetail(null); return; }
    let cancelled = false;
    api.roundDetail(pastList[pastIdx].lobbyId).then((d) => { if (!cancelled) setPastDetail(d); }).catch(() => {});
    return () => { cancelled = true; };
  }, [pastIdx, pastList]);

  // Артефакты временно отключены — панель в раунде не показываем.
  // useEffect(() => {
  //   api.myArtifacts().then((d) => setArtifacts(d.artifacts || [])).catch(() => {});
  // }, [pvpState?.lobby?.status]);

  useEffect(() => {
    const t = setInterval(() => setTick((v) => v + 1), 500);
    return () => clearInterval(t);
  }, []);
  void tick;

  // Когда лобби переходит в settled — короткий «замес», затем ячейки
  // открываются по очереди (дублоны не показываются все разом).
  useEffect(() => {
    const status = pvpState?.lobby?.status;
    const total = pvpState?.lobby?.cardCount ?? 36;
    let timers = [];
    if (prevStatus.current === 'open' && status === 'settled') {
      setShuffling(true);
      setRevealStep(0); // прячем все исходы на время анимации
      const shuffleT = setTimeout(() => {
        setShuffling(false);
        // Каскад с нарастающим напряжением: первые карты быстро (50ms),
        // середина медленнее (80ms), последние очень медленно (150ms).
        let n = 0;
        const step = () => {
          n += 1;
          setRevealStep(n);
          if (n < total) {
            const delay = n < 10 ? 50 : n < 26 ? 80 : 150;
            timers.push(setTimeout(step, delay));
          }
        };
        step();
      }, 450);
      timers.push(shuffleT);
      prevStatus.current = status;
      return () => { timers.forEach(clearTimeout); };
    }
    if (status === 'open') setRevealStep(9999); // новое лобби — сбрасываем
    else if (status === 'settled') setRevealStep(9999); // зашли в готовый раунд — всё открыто
    prevStatus.current = status;
  }, [pvpState?.lobby?.status]);

  const lobby = pvpState?.lobby;
  const cards = pvpState?.cards || [];
  const settled = lobby && lobby.status === 'settled';
  const viewingPast = pastIdx !== null; // объявлено до эффектов, что им пользуются (TDZ-fix)
  const timer = lobby ? pvpTimer(lobby.endsAt) : null;
  const secs = timer !== null ? Number(timer) : null;
  const urgent = secs !== null && secs <= 10 && secs > 0; // последние 10с — красный пульс
  const critical = secs !== null && secs <= 5 && secs > 0; // последние 5с — крупнее + вибра
  const idle = !lobby?.openedAt && lobby?.status === 'open';

  // Тиканье + вибрация в последние 10 секунд (громче к концу).
  const lastTickRef = React.useRef(null);
  React.useEffect(() => {
    if (secs === null || secs > 10 || secs <= 0 || settled) { lastTickRef.current = null; return; }
    if (lastTickRef.current === secs) return;
    lastTickRef.current = secs;
    sfx.tick((10 - secs) / 10); // 0→1 громкость
    if (secs <= 5) window.Telegram?.WebApp?.HapticFeedback?.impactOccurred?.('light');
  }, [secs, settled]);

  const cardCount = lobby?.cardCount ?? 36;
  const hasTicket = (tickets?.cheap || 0) > 0;
  const welcomeFree = welcomeAvailable && cards.every((c) => !c.mine);

  // Free spin counter
  const FREE_EVERY = 10;
  const reveals = pvpTotalReveals || 0;
  const tillFree = reveals === 0 ? FREE_EVERY : FREE_EVERY - (reveals % FREE_EVERY);
  const isFreeNext = reveals > 0 && reveals % FREE_EVERY === FREE_EVERY - 1;

  // PvP только за карты. Нет карты/бесплатного → надо купить карты.
  const canPlay = welcomeFree || hasTicket || isFreeNext;

  // Сколько ячеек можно поставить рандомно: ограничено свободными ячейками и
  // доступными «входами» (welcome + free spin + cheap-карты).
  const freeCount = cards.filter((c) => !c.taken).length || cardCount;
  const takenCount = cards.filter((c) => c.taken).length;
  const playerCount = new Set(cards.filter((c) => c.owner).map((c) => c.owner.userId)).size;
  const entriesAvail = (welcomeFree ? 1 : 0) + (isFreeNext ? 1 : 0) + (tickets?.cheap || 0);
  const maxBet = Math.max(1, Math.min(freeCount, entriesAvail || 1, 15));
  const betClamped = Math.min(Math.max(1, bet), maxBet);

  // Live-попап «игрок взял карту» (соц. давление). Очередь из 1 элемента.
  const [livePop, setLivePop] = React.useState(null);
  const seenTakenRef = React.useRef(null);
  React.useEffect(() => {
    if (settled || viewingPast) return;
    const taken = cards.filter((c) => c.owner && !c.mine).map((c) => `${c.index}:${c.owner.userId}`);
    const seen = seenTakenRef.current;
    if (seen === null) { seenTakenRef.current = new Set(taken); return; }
    const fresh = cards.find((c) => c.owner && !c.mine && !seen.has(`${c.index}:${c.owner.userId}`));
    taken.forEach((k) => seen.add(k));
    if (fresh) {
      const u = userDisplay(fresh.owner);
      setLivePop({ name: u.displayName, avatarUrl: u.avatarUrl, initial: u.initial, idx: fresh.index, key: Date.now() });
    }
  }, [cards, settled, viewingPast]);
  React.useEffect(() => {
    if (!livePop) return undefined;
    const t = setTimeout(() => setLivePop(null), 1800);
    return () => clearTimeout(t);
  }, [livePop]);

  // Вибрация при пересечении порогов «мало карт».
  const freeWarnRef = React.useRef(99);
  React.useEffect(() => {
    if (settled) { freeWarnRef.current = 99; return; }
    const h = window.Telegram?.WebApp?.HapticFeedback;
    if (freeCount <= 1 && freeWarnRef.current > 1) h?.impactOccurred?.('heavy');
    else if (freeCount < 5 && freeWarnRef.current >= 5) h?.impactOccurred?.('medium');
    freeWarnRef.current = freeCount;
  }, [freeCount, settled]);

  const rows = buildPvpRows(cardCount);
  const getCard = (i) => cards.find((c) => c.index === i) || { index: i, status: 'free', mine: false, taken: false, outcome: null, owner: null };

  // Применить артефакт: для place_choose и double_cell сначала выбираем ячейку.
  const applyArtifact = async (artifactId, targetCells) => {
    const art = artifacts.find((a) => a.artifactId === artifactId);
    if (!art) return;
    const kind = art.effect?.kind;
    // Артефакты, требующие выбора ячейки — переходим в режим ожидания.
    if ((kind === 'place_choose' || kind === 'double_cell') && targetCells.length === 0) {
      setArtPending({ artifactId, kind }); setArtHints(null); return;
    }
    try {
      const out = await api.useArtifact(artifactId, targetCells);
      setArtPending(null);
      if (out.kind === 'reveal_row') setArtHints({ row: out.row });
      else if (out.kind === 'reveal_cell') setArtHints({ cell: out.cell });
      else setArtHints(null);
      // Обновляем инвентарь артефактов.
      api.myArtifacts().then((d) => setArtifacts(d.artifacts || [])).catch(() => {});
    } catch (e) {
      setArtPending(null);
      // Ошибки тихо игнорируем — onNotify здесь недоступен, но достаточно визуальной отмены.
    }
  };

  // Просмотр прошлой игры на поле: данные из pastDetail (cardIndex → {owner, prize}).
  const pastRound = viewingPast ? pastList[pastIdx] : null;
  const pastByIndex = {};
  (pastDetail?.players || []).forEach((p) => { pastByIndex[p.cardIndex] = p; });
  const goPrev = () => setPastIdx((v) => { const start = v === null ? -1 : v; return Math.min(pastList.length - 1, start + 1); });
  const goNext = () => setPastIdx((v) => { if (v === null) return null; return v <= 0 ? null : v - 1; });

  return (
    <>
      <div className="dw-pvp-header dw-pvp-header--center">
        {pastList.length > 0 && (
          <button className="dw-pvp-nav-arrow" disabled={pastIdx !== null && pastIdx >= pastList.length - 1} onClick={goPrev}>‹</button>
        )}
        {viewingPast ? (
          <div className="dw-pvp-past-title">
            <span>Игра #{pastRound?.roundNumber ?? '—'}</span>
            <small>{pastRound?.players || 0} игроков · банк {formatCoins(pastRound?.totalWon || 0)}</small>
          </div>
        ) : (
          <div className="dw-pvp-timer-wrap">
            <div className={`dw-pvp-timer ${critical ? 'critical' : urgent ? 'urgent' : idle || settled ? 'idle' : ''}`}>
              {settled ? '00' : timer ?? '30'}<span style={{ fontSize: 11, marginLeft: 4, opacity: 0.7 }}>с</span>
            </div>
            <small className="dw-pvp-gamenum">
              {lobby?.gameNum ? `Игра #${lobby.gameNum} · ` : ''}👁 {playerCount} в раунде
            </small>
          </div>
        )}
        {pastList.length > 0 && (
          <button className="dw-pvp-nav-arrow" disabled={!viewingPast} onClick={goNext}>›</button>
        )}
      </div>

      {viewingPast && (
        <button className="dw-pvp-return-live" onClick={() => setPastIdx(null)}>← Вернуться к текущей игре</button>
      )}

      {/* Заметный счётчик до бесплатной ячейки */}
      {!viewingPast && (
        <div className={`dw-freecell-bar${isFreeNext ? ' ready' : ''}`}>
          {isFreeNext
            ? <>🎁 Следующая ячейка <strong>БЕСПЛАТНО!</strong></>
            : <>До бесплатной ячейки ещё <strong>{tillFree}</strong> {tillFree === 1 ? 'открытие' : tillFree < 5 ? 'открытия' : 'открытий'}</>}
        </div>
      )}

      <div className="dw-pvp-grid-36">
        {rows.map((row, ri) => (
          <div key={ri} className={`dw-pvp-row ${row.type}`}>
            {row.indices.map((i) => {
              // Режим просмотра прошлой игры — рисуем результат, без интеракций.
              if (viewingPast) {
                const p = pastByIndex[i];
                const mine = p && String(p.userId) === String(myUserId);
                const prize = p ? p.prize : 0;
                const win = prize > 0;
                const cls = ['dw-pvp-card', 'dw-pvp-card--locked', 'revealed',
                  win && mine ? 'win-mine' : '', win && !mine ? 'win-other' : '', !win ? 'empty' : ''].filter(Boolean).join(' ');
                const u = p ? userDisplay(p) : null;
                return (
                  <div key={i} className={cls}>
                    {u && (
                      <button className="dw-pvp-avatar-btn" onClick={(e) => { e.stopPropagation(); onOpenPlayerProfile?.(p.userId); }}
                        style={u.avatarUrl ? { padding: 0, overflow: 'hidden' } : {}}>
                        {u.avatarUrl ? <img src={u.avatarUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : <span className="dw-pvp-avatar">{u.initial}</span>}
                      </button>
                    )}
                    {win && <span className="dw-pvp-card-big">{prize}</span>}
                  </div>
                );
              }
              return (
                <PvpCard
                  key={i}
                  card={getCard(i)}
                  idx={i}
                  settled={settled}
                  revealOpen={revealStep === 9999 || i < revealStep}
                  pickable={canPlay && !artPending}
                  artPick={Boolean(artPending && artPending.kind === 'place_choose')}
                  artPickMine={Boolean(artPending && artPending.kind === 'double_cell')}
                  hinted={Boolean(artHints?.cell === i || artHints?.row?.includes(i))}
                  pvpBuying={pvpBuying}
                  onBuyPvpCard={onBuyPvpCard}
                  onArtPick={artPending ? (idx) => applyArtifact(artPending.artifactId, [idx]) : undefined}
                  onOpenPlayerProfile={onOpenPlayerProfile}
                  shuffling={shuffling}
                />
              );
            })}
          </div>
        ))}
      </div>

      {/* Мало свободных карт — нарастающее давление */}
      {!settled && !viewingPast && freeCount <= 10 && freeCount > 0 && (
        <div className={`dw-free-warn ${freeCount <= 1 ? 'last' : freeCount < 5 ? 'crit' : ''}`}>
          {freeCount <= 1 ? 'Последняя карта!' : `Осталось ${freeCount} карт${freeCount < 5 ? '!' : ''}`}
        </div>
      )}

      {/* Управление ставкой (скрыто при просмотре прошлой игры) */}
      {!settled && !viewingPast && (
        <>
          {!canPlay ? (
            <button className="dw-btn primary full" style={{ marginTop: 8 }} onClick={onOpenDeposit}>Купить карты для игры</button>
          ) : artPending ? (
            <div className="dw-art-pending-hint">
              {artPending.kind === 'place_choose' ? '🃏 Выбери ячейку для карты' : '📖 Выбери свою ячейку для удвоения'}
              <button className="dw-btn ghost small" style={{ marginLeft: 8 }} onClick={() => { setArtPending(null); setArtHints(null); }}>Отмена</button>
            </div>
          ) : (
            <>
              <div className="dw-bet-control" style={{ marginTop: 8 }}>
                <div className="dw-bet-stepper">
                  <button onClick={() => setBet(Math.max(1, betClamped - 1))} disabled={pvpBuying || betClamped <= 1}>−</button>
                  <span className="dw-bet-count">{betClamped}</span>
                  <button onClick={() => setBet(Math.min(maxBet, betClamped + 1))} disabled={pvpBuying || betClamped >= maxBet}>+</button>
                </div>
                <button className="dw-btn primary dw-bet-go" disabled={pvpBuying} onClick={() => onBetRandom(betClamped)}>
                  🎲 РАНДОМ ×{betClamped}
                </button>
              </div>
              {/* Докупить карты можно всегда, даже если они уже есть */}
              <button className="dw-btn ghost full" style={{ marginTop: 6 }} onClick={onOpenDeposit}>🎴 Купить ещё карт</button>
            </>
          )}
        </>
      )}

      {/* Артефакты — показываем если есть */}
      {!settled && !viewingPast && artifacts.length > 0 && !artPending && (
        <div className="dw-art-panel">
          {artHints && (
            <div className="dw-art-hint-msg">
              {artHints.row ? `🪄 Ряд с призом: ячейки ${artHints.row.map((i) => i + 1).join(', ')}` : `🧭 Выигрышная ячейка: #${artHints.cell + 1}`}
              <button className="dw-btn ghost small" style={{ marginLeft: 8 }} onClick={() => setArtHints(null)}>✕</button>
            </div>
          )}
          <div className="dw-art-row">
            {artifacts.map((a) => (
              <button key={a.artifactId} className="dw-art-btn" title={a.description}
                onClick={() => applyArtifact(a.artifactId, [])}>
                <span>{artIcon(a.artifactId)}</span>
                <span className="dw-art-qty">×{a.quantity}</span>
                <small>{a.name}</small>
              </button>
            ))}
          </div>
        </div>
      )}

      {settled && !viewingPast && (
        <div className="dw-pvp-empty">
          Раунд завершён. Новое лобби откроется — поставь ячейки в следующий.
        </div>
      )}

      {/* Live-попап: кто-то взял карту */}
      <AnimatePresence>
        {livePop && !viewingPast && (
          <motion.div className="dw-live-pop" key={livePop.key}
            initial={{ x: -120, opacity: 0 }} animate={{ x: 0, opacity: 1 }} exit={{ opacity: 0 }}
            transition={{ type: 'spring', stiffness: 320, damping: 26 }}>
            <span className="dw-live-pop-ava" style={livePop.avatarUrl ? { padding: 0, overflow: 'hidden' } : {}}>
              {livePop.avatarUrl ? <img src={livePop.avatarUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: '50%' }} /> : livePop.initial}
            </span>
            <span className="dw-live-pop-txt">{livePop.name} взял карту #{livePop.idx + 1}</span>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}

function SoloPanel(props) {
  const [soloMode, setSoloMode] = useState('premium'); // premium | risk
  return (
    <>
      <div className="dw-solo-switch">
        <button className={soloMode === 'premium' ? 'active' : ''} onClick={() => setSoloMode('premium')}>
          👑 Премиум<small>5 печатей</small>
        </button>
        <button className={soloMode === 'risk' ? 'active' : ''} onClick={() => setSoloMode('risk')}>
          🎲 Риск<small>×2…×10 НФТ</small>
        </button>
      </div>
      {soloMode === 'premium' ? <PremiumPanel {...props} /> : <RiskPanel {...props} />}
    </>
  );
}

function PremiumPanel({
  mode, balance, multiplier, roundArmed, revealing, selectedClause, result, board, tickets,
  onArmRound, onPickClause, onResetRound, onOpenDeposit
}) {
  const hasTicket = (tickets?.premium || 0) > 0;

  return (
    <>
      <div className={`dw-contracts-row ${roundArmed ? 'armed' : ''} ${board ? 'opened' : ''}`}>
        {Array.from({ length: PREMIUM_CARDS }).map((_, index) => {
          const selected = selectedClause === index;
          const cell = board?.[index] || null;
          // После вскрытия показываем содержимое ВСЕХ карт.
          const opened = Boolean(board);
          const won = cell && cell.credit > 0;
          const dimmed = opened ? (!selected && !won) : (selectedClause !== null && !selected);
          const cls = ['dw-contract-card',
            selected ? 'selected' : '', dimmed ? 'dimmed' : '',
            opened ? 'opened' : '', opened ? (won ? 'open-win' : 'open-empty') : '',
            opened && selected ? 'open-pick' : ''].filter(Boolean).join(' ');
          return (
            <motion.button
              key={index}
              className={cls}
              onClick={() => onPickClause(index)}
              disabled={!roundArmed || revealing || Boolean(result)}
              initial={{ opacity: 0, y: 8 }}
              animate={opened
                ? { opacity: 1, y: 0, rotateY: 0, scale: selected ? 1.06 : 1 }
                : { opacity: 1, y: 0 }}
              transition={{ duration: 0.3, delay: opened ? 0.06 * index : 0.03 * index, ease: [0.2, 0, 0, 1] }}
              whileTap={{ scale: 0.94 }}
            >
              {opened && cell ? (
                <span className="dw-contract-face">
                  <span className="dw-contract-stamp">{won ? '🎁' : (cell.type === 'debt' ? '💀' : '·')}</span>
                  <span className="dw-contract-credit">{cell.stamp || (won ? `+${formatCoins(cell.credit)}` : '—')}</span>
                </span>
              ) : (
                <span className="dw-contract-num">{index + 1}</span>
              )}
            </motion.button>
          );
        })}
      </div>

      <div className="dw-play-action">
        {hasTicket && (
          <p className="dw-play-meta-line" style={{ fontSize: 11, opacity: 0.6 }}>
            {tickets.premium} карт
          </p>
        )}
        {roundArmed ? (
          <p className="dw-play-hint">выбери одну из пяти</p>
        ) : !hasTicket ? (
          <button className="dw-btn primary full" onClick={onOpenDeposit}>Купить премиум-карты</button>
        ) : (
          <button className="dw-btn primary full" onClick={onArmRound} disabled={revealing || Boolean(result)}>
            запечатать · сжечь карту
          </button>
        )}
        {(result || roundArmed) && (
          <button className="dw-btn ghost small dw-play-reset" onClick={onResetRound}>сбросить</button>
        )}
      </div>
    </>
  );
}

/* ─── Соло Risk-режим: 2-10 закрытых, угадай → ×N в НФТ ─────── */

function RiskPanel({ tickets, onOpenDeposit, onNotify, onBalance, onTickets }) {
  const [cells, setCells] = useState(3);
  const [phase, setPhase] = useState('setup'); // setup | armed | revealing | done
  const [pick, setPick] = useState(null);
  const [outcome, setOutcome] = useState(null); // {won, winning, gift, rewardCoins}
  const [busy, setBusy] = useState(false);
  const [confetti, setConfetti] = useState(false);
  const premium = tickets?.premium || 0;
  const hasCard = premium > 0;
  const reward = Math.round(150 * cells * 0.85);

  const arm = () => { if (!hasCard) { onOpenDeposit?.(); return; } setPhase('armed'); setPick(null); setOutcome(null); };

  const choose = async (idx) => {
    if (phase !== 'armed' || busy) return;
    setPick(idx); setBusy(true); setPhase('revealing');
    const h = window.Telegram?.WebApp?.HapticFeedback;
    // Нарастающее напряжение перед результатом.
    sfx.tick(0.4); h?.impactOccurred?.('light');
    setTimeout(() => { sfx.tick(0.7); h?.impactOccurred?.('light'); }, 500);
    setTimeout(() => { sfx.tick(1); h?.impactOccurred?.('medium'); }, 1000);
    try {
      const res = await api.riskPlay(cells, idx);
      if (res.player) { onBalance?.(res.player.coins); onTickets?.(res.player.tickets); }
      // Длиннее пауза «вскрытия» для саспенса.
      setTimeout(() => {
        setOutcome(res); setPhase('done'); setBusy(false);
        if (res.won) {
          sfx.winFanfare(); h?.notificationOccurred?.('success');
          setConfetti(true); setTimeout(() => setConfetti(false), 3000);
          onNotify?.(res.gift ? `🎉 Угадал! Подарок ${res.gift.name} твой` : `🎉 Угадал! +${formatCoins(res.coinsWon)} дублонов`, 'success');
        } else { sfx.loseSound(); h?.notificationOccurred?.('error'); }
      }, 1500);
    } catch (e) {
      setBusy(false); setPhase('armed'); setPick(null);
      onNotify?.(e.message === 'need_premium_card' ? 'Нужна премиум-карта' : 'Ошибка', 'danger');
    }
  };

  const reset = () => { setPhase('setup'); setPick(null); setOutcome(null); };

  return (
    <div className="dw-risk">
      <div className="dw-risk-info">
        <p className="dw-risk-lead">Выбери, сколько ячеек закрыто. Угадай 1 из {cells} — забери подарок <strong>×{cells}</strong>.</p>
        <div className="dw-risk-reward">🎁 Приз: подарок до <strong>{formatCoins(reward)}</strong> дбл.</div>
      </div>

      {phase === 'setup' && (
        <>
          <div className="dw-risk-slider-row">
            <span>Закрыто ячеек</span>
            <strong className="dw-risk-cells-val">{cells}</strong>
          </div>
          <input className="dw-lucky-slider" type="range" min={2} max={10} step={1} value={cells}
            onChange={(e) => setCells(Number(e.target.value))} />
          <div className="dw-risk-mult-scale">
            <span>×2 безопаснее</span><span>×10 рискованнее</span>
          </div>
          <button className={`dw-btn ${hasCard ? 'primary' : 'ghost'} full`} style={{ marginTop: 14 }} onClick={arm}>
            {hasCard ? `Поставить премиум-карту (${premium})` : 'Нужна премиум-карта'}
          </button>
        </>
      )}

      {(phase === 'armed' || phase === 'revealing' || phase === 'done') && (
        <>
          {confetti && (
            <span className="dw-confetti">
              {Array.from({ length: 36 }).map((_, k) => (
                <span key={k} className="dw-confetti-bit" style={{
                  left: `${Math.random() * 100}%`,
                  background: ['#FFD700', '#4FC3F7', '#ff5ca8', '#6dbe88'][k % 4],
                  animationDelay: `${Math.random() * 0.5}s`, animationDuration: `${1.6 + Math.random() * 1.2}s`
                }} />
              ))}
            </span>
          )}
          <div className={`dw-risk-grid${phase === 'revealing' ? ' revealing' : ''}`}>
            {Array.from({ length: cells }).map((_, i) => {
              const isPick = pick === i;
              const revealed = phase === 'done';
              const isWinning = outcome && i === outcome.winning;
              const cls = ['dw-risk-cell',
                isPick ? 'pick' : '',
                phase === 'revealing' && isPick ? 'shaking' : '',
                revealed && isWinning ? 'win' : '',
                revealed && isPick && !outcome.won ? 'miss' : '',
                revealed && !isWinning && !isPick ? 'dim' : ''].filter(Boolean).join(' ');
              return (
                <button key={i} className={cls} disabled={phase !== 'armed'} onClick={() => choose(i)}>
                  {revealed ? (isWinning ? '🎁' : '✗') : (phase === 'revealing' && isPick ? '🎲' : '?')}
                </button>
              );
            })}
          </div>
          {phase === 'armed' && <p className="dw-play-hint">выбери ячейку — угадай {cells === 2 ? 'из 2' : `1 из ${cells}`}</p>}
          {phase === 'done' && (
            <div className={`dw-risk-result ${outcome.won ? 'win' : 'lose'}`}>
              {outcome.won
                ? (outcome.gift
                    ? <>🎉 Угадал! <strong>{outcome.gift.name}</strong> — в инвентаре</>
                    : <>🎉 Угадал! <strong>+{formatCoins(outcome.coinsWon)}</strong> дублонов</>)
                : <>💀 Мимо. Выигрышная была #{outcome.winning + 1}</>}
            </div>
          )}
          {phase === 'done' && <button className="dw-btn primary full" style={{ marginTop: 10 }} onClick={reset}>Играть ещё</button>}
        </>
      )}
    </div>
  );
}

/* ─── Clans tab ───────────────────────────────────────────── */

function ClansTab({ onBack, player, onNotify }) {
  const [view, setView] = useState('list'); // list | my | chat | lb
  const [clans, setClans] = useState([]);
  const [myClanId, setMyClanId] = useState(null);
  const [myClan, setMyClan] = useState(null);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ name: '', tag: '', description: '' });
  const [chatMsgs, setChatMsgs] = useState([]);
  const [chatText, setChatText] = useState('');
  const [sending, setSending] = useState(false);
  const [lb, setLb] = useState([]);
  const [chestAmt, setChestAmt] = useState('');

  const load = async () => {
    setLoading(true);
    try {
      const [d, mc] = await Promise.all([api.clans(), api.myClan()]);
      setClans(d.clans || []);
      setMyClanId(d.myClanId || null);
      setMyClan(mc.clan || null);
    } catch {}
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const loadChat = async () => {
    if (!myClanId) return;
    try { const d = await api.clanChat(myClanId); setChatMsgs(d.messages || []); } catch {}
  };

  useEffect(() => {
    if (view === 'chat') loadChat();
    if (view === 'lb') api.clanLeaderboard().then((d) => setLb(d.leaderboard || [])).catch(() => {});
  }, [view, myClanId]);

  const handleCreate = async () => {
    if (!form.name.trim() || !form.tag.trim()) return onNotify('Введи название и тег', 'danger');
    try {
      await api.createClan(form.name, form.tag, form.description);
      setCreating(false); setForm({ name: '', tag: '', description: '' });
      onNotify('Клан создан!', 'success'); load();
    } catch (e) {
      onNotify(e.message === 'name_taken' ? 'Имя занято' : e.message === 'already_in_clan' ? 'Ты уже в клане' : e.message === 'insufficient_balance' ? 'Нужно 50 дублонов' : 'Ошибка', 'danger');
    }
  };

  const handleJoin = async (clanId) => {
    try { await api.joinClan(clanId); onNotify('Вступил!', 'success'); load(); }
    catch (e) { onNotify(e.message === 'already_in_clan' ? 'Уже в клане' : 'Ошибка', 'danger'); }
  };

  const handleLeave = async () => {
    if (!window.confirm('Выйти из клана?')) return;
    try { await api.leaveClan(myClanId); onNotify('Вышел из клана', 'success'); load(); setView('list'); }
    catch (e) { onNotify(e.message || 'Ошибка', 'danger'); }
  };

  const handleKick = async (userId) => {
    try { await api.kickMember(myClanId, userId); onNotify('Исключён', 'success'); load(); }
    catch { onNotify('Ошибка', 'danger'); }
  };

  const handleSetRole = async (userId, role) => {
    try { await api.setRole(myClanId, userId, role); onNotify('Роль изменена', 'success'); load(); }
    catch { onNotify('Ошибка', 'danger'); }
  };

  const handleChestContribute = async () => {
    const amt = parseInt(chestAmt, 10);
    if (!amt || amt <= 0) return;
    try { await api.contributeChest(myClanId, amt); onNotify(`+${amt} в сундук`, 'success'); setChestAmt(''); load(); }
    catch (e) { onNotify(e.message === 'insufficient_balance' ? 'Мало дублонов' : 'Ошибка', 'danger'); }
  };

  const handleChestWithdraw = async () => {
    const amt = parseInt(chestAmt, 10);
    if (!amt || amt <= 0) return;
    try { await api.withdrawChest(myClanId, amt); onNotify(`Выведено ${amt} дублонов`, 'success'); setChestAmt(''); load(); }
    catch (e) { onNotify(e.message === 'not_enough_chest' ? 'Нет столько в сундуке' : 'Ошибка', 'danger'); }
  };

  const sendChat = async () => {
    if (!chatText.trim() || sending) return;
    setSending(true);
    try { await api.sendClanChat(myClanId, chatText); setChatText(''); await loadChat(); }
    catch { onNotify('Ошибка отправки', 'danger'); }
    setSending(false);
  };

  const handleGive = async (msgId) => {
    try { await api.tradeGive(myClanId, msgId); onNotify('Передано!', 'success'); await loadChat(); }
    catch (e) { onNotify(e.message === 'not_owned' ? 'У тебя нет этого' : 'Ошибка', 'danger'); }
  };

  const [tradeOpen, setTradeOpen] = useState(false);
  const [myArtsForTrade, setMyArtsForTrade] = useState([]);

  const openTrade = async () => {
    try { const d = await api.myArtifacts(); setMyArtsForTrade(d.artifacts || []); } catch {}
    setTradeOpen(true);
  };
  const handleRequestArtifact = async (artifactId) => {
    try { await api.tradeRequest(myClanId, artifactId); onNotify('Запрос отправлен в чат', 'success'); setTradeOpen(false); await loadChat(); }
    catch (e) { onNotify(e.message || 'Ошибка', 'danger'); }
  };
  const handleRequestCard = async () => {
    try { await api.tradeRequestCard(myClanId); onNotify('Запрос карты отправлен', 'success'); setTradeOpen(false); await loadChat(); }
    catch (e) { onNotify(e.message || 'Ошибка', 'danger'); }
  };

  const isOwner = myClan && String(myClan.ownerId) === String(player?.id);

  if (loading) return <section className="dw-page"><div className="dw-pay-loading"><div className="dw-pay-spinner" /></div></section>;

  return (
    <section className="dw-page dw-clans-page">
      <div className="dw-clan-topbar">
        <button className="dw-back-link" onClick={onBack}>‹ назад</button>
        <div className="dw-clan-nav">
          <button className={view === 'list' ? 'active' : ''} onClick={() => setView('list')}>Кланы</button>
          {myClanId && <button className={view === 'my' ? 'active' : ''} onClick={() => setView('my')}>Мой</button>}
          {myClanId && <button className={view === 'chat' ? 'active' : ''} onClick={() => { setView('chat'); }}>Чат</button>}
          <button className={view === 'lb' ? 'active' : ''} onClick={() => setView('lb')}>ТОП</button>
        </div>
      </div>

      {/* СПИСОК */}
      {view === 'list' && (
        <>
          {!myClanId && (
            creating ? (
              <div className="dw-panel" style={{ marginBottom: 12 }}>
                <div className="dw-panel-head"><h2>Создать клан <small style={{ color: 'var(--bone-soft)', fontSize: 12 }}>— 50 дбл.</small></h2><button className="dw-icon-btn" onClick={() => setCreating(false)}>×</button></div>
                <input className="dw-manual-input" placeholder="Название" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} style={{ marginBottom: 8, textAlign: 'left' }} />
                <input className="dw-manual-input" placeholder="Тег [до 8 букв]" maxLength={8} value={form.tag} onChange={(e) => setForm((f) => ({ ...f, tag: e.target.value.toUpperCase() }))} style={{ marginBottom: 8, textAlign: 'left' }} />
                <input className="dw-manual-input" placeholder="Описание" value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} style={{ marginBottom: 10, textAlign: 'left' }} />
                <button className="dw-btn primary full" onClick={handleCreate} disabled={!form.name.trim() || !form.tag.trim()}>Создать</button>
              </div>
            ) : (
              <button className="dw-btn primary full" style={{ marginBottom: 12 }} onClick={() => setCreating(true)}>+ Создать клан — 50 дбл.</button>
            )
          )}
          <div className="dw-clan-list">
            {clans.map((c) => (
              <div key={c.id} className="dw-clan-row">
                <div className="dw-clan-tag-badge">[{c.tag}]</div>
                <div style={{ flex: 1 }}>
                  <strong>{c.name}</strong>
                  <div style={{ fontSize: 12, color: 'var(--bone-soft)' }}>Ур.{c.level} · {c.memberCount} чел. · +{c.bonusPct}% к выигрышу</div>
                </div>
                {!myClanId && <button className="dw-btn primary small" onClick={() => handleJoin(c.id)}>Вступить</button>}
                {String(c.id) === String(myClanId) && <span className="dw-badge">Мой</span>}
              </div>
            ))}
          </div>
        </>
      )}

      {/* МОЙ КЛАН */}
      {view === 'my' && myClan && (
        <div>
          <div className="dw-clan-header">
            <span className="dw-clan-tag-badge">[{myClan.tag}]</span>
            <div>
              <h2 style={{ margin: 0 }}>{myClan.name}</h2>
              <p style={{ color: 'var(--bone-soft)', fontSize: 13, margin: 0 }}>Уровень {myClan.level} · +{myClan.bonusPct}% к выигрышу</p>
            </div>
          </div>
          <div className="dw-clan-xp-bar"><span style={{ width: `${myClan.xpNext ? Math.min(100, myClan.xp / myClan.xpNext * 100) : 100}%` }} /></div>
          <p style={{ fontSize: 12, color: 'var(--bone-soft)', margin: '4px 0 12px' }}>{myClan.xp} / {myClan.xpNext || '—'} XP</p>

          {/* Сундук */}
          <div className="dw-panel" style={{ marginBottom: 12 }}>
            <div className="dw-panel-head"><span>💰 Клановый сундук</span><strong style={{ color: 'var(--gold)' }}>{formatCoins(myClan.chest)} дбл.</strong></div>
            <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
              <input className="dw-manual-input" style={{ flex: 1, textAlign: 'left', fontSize: 14 }} type="number" min={1} placeholder="Сумма" value={chestAmt} onChange={(e) => setChestAmt(e.target.value)} />
              <button className="dw-btn primary small" onClick={handleChestContribute}>Взнос</button>
              {isOwner && <button className="dw-btn ghost small" onClick={handleChestWithdraw}>Вывод</button>}
            </div>
          </div>

          {/* Участники */}
          <div className="dw-panel">
            <div className="dw-panel-head"><h3 style={{ margin: 0 }}>Участники</h3></div>
            {myClan.members.map((m) => (
              <div key={m.userId} className="dw-clan-member-row">
                <span className="dw-round-row-avatar" style={m.avatarUrl ? { padding: 0, overflow: 'hidden' } : {}}>
                  {m.avatarUrl ? <img src={m.avatarUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: '50%' }} /> : m.name?.[0]?.toUpperCase()}
                </span>
                <div style={{ flex: 1 }}>
                  <strong style={{ fontSize: 14 }}>{m.name}</strong>
                  <div style={{ fontSize: 11, color: 'var(--bone-soft)' }}>{m.role} · взнос {formatCoins(m.contributed)}</div>
                </div>
                {isOwner && String(m.userId) !== String(player?.id) && (
                  <div style={{ display: 'flex', gap: 6 }}>
                    <button className="dw-btn ghost small" onClick={() => handleSetRole(m.userId, m.role === 'officer' ? 'member' : 'officer')}>
                      {m.role === 'officer' ? 'Разжаловать' : 'Офицер'}
                    </button>
                    <button className="dw-btn ghost small" style={{ color: 'var(--crimson-glow)' }} onClick={() => handleKick(m.userId)}>Кик</button>
                  </div>
                )}
              </div>
            ))}
          </div>

          {!isOwner && <button className="dw-btn ghost full" style={{ marginTop: 12, color: 'var(--crimson-glow)' }} onClick={handleLeave}>Выйти из клана</button>}
        </div>
      )}

      {/* ЧАТ */}
      {view === 'chat' && (
        <div className="dw-clan-chat">
          <div className="dw-clan-chat-msgs">
            {chatMsgs.map((m) => (
              <div key={m.id} className={`dw-clan-chat-msg ${m.type === 'system' || m.type === 'trade_done' ? 'system' : ''}`}>
                {(m.type === 'msg' || m.type === 'trade_request') && (
                  <span className="dw-round-row-avatar" style={{ width: 24, height: 24, fontSize: 11, flexShrink: 0, ...(m.author.avatarUrl ? { padding: 0, overflow: 'hidden' } : {}) }}>
                    {m.author.avatarUrl ? <img src={m.author.avatarUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: '50%' }} /> : m.author.name?.[0]?.toUpperCase()}
                  </span>
                )}
                <div style={{ flex: 1 }}>
                  {m.type === 'msg' && <><strong style={{ fontSize: 12, color: 'var(--gold-bright)' }}>{m.author.name}</strong> <span style={{ fontSize: 11, color: 'var(--bone-soft)' }}>[{m.author.role}]</span><br /></>}
                  <span style={{ fontSize: 13 }}>{m.text}</span>
                  {m.type === 'trade_request' && !m.tradeFulfilled && String(m.target_user_id) !== String(player?.id) && (
                    <button className="dw-btn primary small" style={{ marginLeft: 8 }} onClick={() => handleGive(m.id)}>Дать</button>
                  )}
                  {m.type === 'trade_request' && m.tradeFulfilled && <span style={{ color: 'var(--emerald-glow)', fontSize: 11, marginLeft: 8 }}>✓ выдан</span>}
                </div>
              </div>
            ))}
          </div>
          <div className="dw-clan-chat-input">
            <button className="dw-btn ghost small" onClick={openTrade} title="Запросить карту или артефакт">🤝</button>
            <input className="dw-manual-input" style={{ flex: 1, textAlign: 'left', fontSize: 14 }}
              placeholder="Сообщение…" maxLength={500} value={chatText}
              onChange={(e) => setChatText(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') sendChat(); }} />
            <button className="dw-btn primary small" onClick={sendChat} disabled={sending || !chatText.trim()}>→</button>
          </div>

          {/* Пикер запроса (карта или артефакт) */}
          {tradeOpen && (
            <div className="dw-trade-picker">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                <strong style={{ fontSize: 14 }}>Что запросить?</strong>
                <button className="dw-icon-btn" onClick={() => setTradeOpen(false)}>×</button>
              </div>
              <button className="dw-btn primary full" style={{ marginBottom: 8 }} onClick={handleRequestCard}>
                🃏 Запросить ПВП-карту
              </button>
              {myArtsForTrade.length > 0 ? (
                <>
                  <p style={{ fontSize: 12, color: 'var(--bone-soft)', marginBottom: 6 }}>Запросить артефакт:</p>
                  <div className="dw-art-row">
                    {myArtsForTrade.map((a) => (
                      <button key={a.artifactId} className="dw-art-btn" onClick={() => handleRequestArtifact(a.artifactId)}>
                        <span>{artIcon(a.artifactId)}</span>
                        <small>{a.name}</small>
                      </button>
                    ))}
                  </div>
                </>
              ) : (
                <>
                  <p style={{ fontSize: 12, color: 'var(--bone-soft)', marginBottom: 6 }}>Нет артефактов для запроса. Выбери из каталога:</p>
                  <div className="dw-art-row">
                    {[{id:'card',name:'Карта'},{id:'amulet',name:'Амулет'},{id:'staff',name:'Посох'},{id:'guide',name:'Путеводитель'},{id:'book',name:'Книга'}].map((a) => (
                      <button key={a.id} className="dw-art-btn" onClick={() => handleRequestArtifact(a.id)}>
                        <span>{artIcon(a.id)}</span>
                        <small>{a.name}</small>
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      )}

      {/* ТОП */}
      {view === 'lb' && (
        <div className="dw-clan-lb">
          {lb.map((c) => (
            <div key={c.id} className="dw-clan-lb-row">
              <span className="dw-clan-lb-rank">#{c.rank}</span>
              <div style={{ flex: 1 }}>
                <strong>[{c.tag}] {c.name}</strong>
                <div style={{ fontSize: 12, color: 'var(--bone-soft)' }}>Ур.{c.level} · {c.memberCount} чел.</div>
              </div>
              <span style={{ color: 'var(--gold)', fontWeight: 800 }}>{formatCoins(c.xp)} XP</span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

/* ─── Referral tab ────────────────────────────────────────── */

function ReferralTab({ referral, player, onCopy, onShare, onBack, onClaimRef, onClaimMilestone }) {
  const tier = referral.tier || { name: '—', depositPct: 0, color: '#999' };
  const next = referral.nextTier;
  const tiers = referral.tiers || [];
  // Прогресс до следующего тира.
  const prog = next ? Math.min(100, Math.round((referral.invites / next.min) * 100)) : 100;

  return (
    <section className="dw-page dw-referral-page">
      <button className="dw-back-link" onClick={onBack}>‹ профиль</button>

      {/* Hero — тир-карта */}
      <div className="dw-ref2-hero" style={{ '--tier': tier.color }}>
        <div className="dw-ref2-hero-glow" />
        <span className="dw-kicker">Реферальный ранг</span>
        <h1 className="dw-ref2-tier-name">{tier.name}</h1>
        <div className="dw-ref2-pct-row">
          <span className="dw-ref2-pct"><strong>{tier.depositPct}%</strong> с депозитов друзей</span>
        </div>
        {next ? (
          <>
            <div className="dw-ref2-prog"><span style={{ width: `${prog}%` }} /></div>
            <p className="dw-ref2-next">Ещё {Math.max(0, next.min - referral.invites)} друзей до ранга «{next.name}» ({next.depositPct}%)</p>
          </>
        ) : (
          <p className="dw-ref2-next">Максимальный ранг достигнут 👑</p>
        )}
      </div>

      {/* Что ты получаешь — кратко и понятно */}
      <div className="dw-ref2-explain">
        <div className="dw-ref2-explain-row"><span>💰</span> <b>{tier.depositPct}%</b> с каждого пополнения друга — навсегда</div>
        <div className="dw-ref2-explain-row"><span>🎁</span> <b>+5%</b> с первого депозита друга (бонусом, до 30)</div>
        <div className="dw-ref2-explain-row"><span>🏆</span> награды за <b>5/10/25/50</b> активных друзей</div>
      </div>

      {/* Ссылка */}
      <div className="dw-ref2-link">
        <div className="dw-ref2-link-text">
          <span className="dw-kicker">Твоя ссылка</span>
          <strong>{(referral.link || '').replace('https://', '')}</strong>
        </div>
        <button className="dw-btn primary small" onClick={onCopy}>Копировать</button>
      </div>
      <button className="dw-btn secondary full" style={{ marginTop: 8 }} onClick={onShare}>Поделиться в Telegram</button>

      {/* Claim pending */}
      <div className="dw-ref2-claim">
        <div>
          <span className="dw-kicker">Доступно к выводу</span>
          <strong className="dw-ref2-claim-amount">{formatCoins(referral.pending || 0)}</strong>
        </div>
        <button className={`dw-btn ${(referral.pending || 0) > 0 ? 'primary' : 'ghost'}`}
          onClick={onClaimRef} disabled={!(referral.pending > 0)}>Забрать</button>
      </div>

      {/* Статы */}
      <div className="dw-ref2-stats">
        <div><span>{referral.invites}</span><small>приглашено</small></div>
        <div><span>{referral.activeInvites}</span><small>активных</small></div>
        <div><span>{formatCompact(referral.earned || 0)}</span><small>всего</small></div>
      </div>

      {/* Майлстоуны */}
      <article className="dw-panel">
        <div className="dw-panel-head"><h2>Награды за друзей</h2><span className="dw-panel-sub">актив = деп от 0.5 TON</span></div>
        <div className="dw-ref2-ms-list">
          {(referral.milestones || []).map((m) => (
            <div key={m.id} className={`dw-ref2-ms ${m.claimed ? 'claimed' : m.reached ? 'ready' : 'locked'}`}>
              <div className="dw-ref2-ms-icon">{m.claimed ? '✓' : '🎁'}</div>
              <div className="dw-ref2-ms-info">
                <strong>{m.label}</strong>
                <small>{m.invites} активных друзей</small>
              </div>
              {m.claimed ? <span className="dw-badge accent">Получено</span>
                : m.reached ? <button className="dw-btn primary small" onClick={() => onClaimMilestone(m.id)}>Забрать</button>
                : <span className="dw-ref2-ms-lock">{referral.activeInvites}/{m.invites}</span>}
            </div>
          ))}
        </div>
      </article>

      {/* Тир-лестница */}
      <article className="dw-panel">
        <div className="dw-panel-head"><h2>Ранги</h2></div>
        <div className="dw-ref2-tiers">
          {tiers.map((t) => (
            <div key={t.id} className={`dw-ref2-tier ${t.current ? 'current' : ''} ${t.reached ? 'reached' : ''}`} style={{ '--tc': t.color }}>
              <strong>{t.name}</strong>
              <small>{t.min}+ друзей</small>
              <span>{t.depositPct}%</span>
            </div>
          ))}
        </div>
      </article>

      {/* Список рефералов */}
      <article className="dw-panel">
        <div className="dw-panel-head"><h2>Мои друзья</h2><span className="dw-panel-sub">{referral.invites}</span></div>
        {(referral.inviteHistory || []).length === 0 ? (
          <p style={{ color: 'var(--bone-soft)', textAlign: 'center', padding: '14px 0', fontSize: 13 }}>Пока никого — поделись ссылкой!</p>
        ) : (
          <div className="dw-history-list">
            {(referral.inviteHistory || []).map((item) => (
              <div className="dw-history-row" key={item.id}>
                <span className="dw-round-row-avatar" style={{ width: 34, height: 34, fontSize: 13, ...(item.avatarUrl ? { padding: 0, overflow: 'hidden' } : {}) }}>
                  {item.avatarUrl ? <img src={item.avatarUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: '50%' }} /> : item.name[0]?.toUpperCase()}
                </span>
                <div className="dw-history-copy">
                  <strong>{item.name}</strong>
                  <p>{item.active ? <span style={{ color: 'var(--emerald-glow)' }}>● активен</span> : <span style={{ color: 'var(--muted)' }}>○ неактивен</span>}</p>
                </div>
                {item.earned > 0 ? <span className="pos">+{formatCoins(item.earned)}</span> : <span style={{ color: 'var(--bone-soft)', fontSize: 12 }}>—</span>}
              </div>
            ))}
          </div>
        )}
      </article>
    </section>
  );
}

/* ─── Shop tab ────────────────────────────────────────────── */

function ShopTab({ shop, player, onBuyNft, portalsGifts, onNotify, onBalance }) {
  const [sortDir, setSortDir] = useState('asc');
  const [luckyGift, setLuckyGift] = useState(null); // gift открытый в Lucky Buy
  const [shopView, setShopView] = useState('gifts'); // gifts | artifacts | points

  const catalog = portalsGifts || [];
  const sorted = [...catalog].sort((a, b) =>
    sortDir === 'asc' ? a.priceCoins - b.priceCoins : b.priceCoins - a.priceCoins);

  return (
    <section className="dw-page dw-shop-page">
      {/* Лавка (артефакты) и Поинты временно скрыты */}

      {shopView === 'gifts' && (
        <>
          <div className="dw-sort-row">
            <button className="dw-sort-toggle" onClick={() => setSortDir(sortDir === 'asc' ? 'desc' : 'asc')}>
              Цена {sortDir === 'asc' ? '↑ дешевле' : '↓ дороже'}
            </button>
          </div>
          {catalog.length === 0 && <p style={{ color: 'var(--bone-soft)', textAlign: 'center', padding: '24px 0', fontSize: 14 }}>Загрузка…</p>}
          <div className="dw-nft-grid">
            {sorted.map((item, i) => {
              const canBuy = (player?.coins || 0) >= item.priceCoins;
              return (
                <motion.article className="dw-nft-tile" key={item.id}
                  initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.22, delay: Math.min(i * 0.03, 0.4) }}>
                  <div className="dw-nft-preview" style={{ position: 'relative' }}>
                    <img src={`/gifts/${item.file}`} alt={item.name} className="dw-gift-img" loading="lazy" />
                    <button className="dw-lucky-icon" onClick={() => setLuckyGift(item)} title="Lucky Buy">🍀</button>
                  </div>
                  <h2 style={{ fontSize: 14, textTransform: 'lowercase' }}>{item.name}</h2>
                  <strong style={{ fontSize: 15, color: 'var(--gold)' }}>{formatCoins(item.priceCoins)} дбл.</strong>
                  {item.stock === 0 && <p style={{ color: 'var(--crimson-glow)', fontSize: 11, margin: '2px 0 6px' }}>Нет в наличии</p>}
                  <button className={`dw-btn ${canBuy && item.stock > 0 ? 'primary' : 'ghost'}`}
                    style={{ width: '100%', fontSize: 13, marginTop: 6 }}
                    onClick={() => onBuyNft({ ...item, title: item.name })}
                    disabled={!canBuy || item.stock === 0}>
                    {!canBuy ? 'Мало дублонов' : item.stock === 0 ? 'Нет в наличии' : 'Купить'}
                  </button>
                </motion.article>
              );
            })}
          </div>
        </>
      )}

      {/* {shopView === 'artifacts' && <ArtifactsShop player={player} onBalance={onBalance} />} */}
      {/* {shopView === 'points' && <PointsShop player={player} catalog={catalog} />} */}

      {luckyGift && (
        <LuckyBuyModal gift={luckyGift} player={player} onBalance={onBalance} onNotify={onNotify} onClose={() => setLuckyGift(null)} />
      )}
    </section>
  );
}

/* ─── Лавка торговца (артефакты) ─────────────────────────── */

function ArtifactsShop({ player, onBalance }) {
  const [artifacts, setArtifacts] = useState([]);
  const [inventory, setInventory] = useState([]);
  const [buying, setBuying] = useState(null);

  useEffect(() => {
    api.shopArtifacts().then((d) => setArtifacts(d.artifacts || [])).catch(() => {});
    api.myArtifacts().then((d) => setInventory(d.artifacts || [])).catch(() => {});
  }, []);

  const buy = async (artifactId) => {
    setBuying(artifactId);
    try {
      const res = await api.buyArtifact(artifactId);
      if (typeof res.balance === 'number') onBalance?.(res.balance); // динамика баланса
      else if (res.player) onBalance?.(res.player.coins);
      const [sh, inv] = await Promise.all([api.shopArtifacts(), api.myArtifacts()]);
      setArtifacts(sh.artifacts || []);
      setInventory(inv.artifacts || []);
    } catch (e) {
      // notify handled by caller
    } finally { setBuying(null); }
  };

  const owned = Object.fromEntries(inventory.map((i) => [i.artifactId, i.quantity]));

  return (
    <div className="dw-artifacts-grid">
      {artifacts.map((art) => {
        const canAfford = (player?.coins || 0) >= art.price;
        return (
          <div key={art.id} className="dw-artifact-tile">
            <div className="dw-artifact-icon">{artIcon(art.id)}</div>
            <h3>{art.name}</h3>
            <p>{art.description}</p>
            <div className="dw-artifact-footer">
              <strong style={{ color: 'var(--gold)' }}>{art.price} дбл.</strong>
            </div>
            <button className={`dw-btn ${canAfford ? 'primary' : 'ghost'} full`}
              disabled={!canAfford || buying === art.id}
              onClick={() => buy(art.id)}>
              {buying === art.id ? '…' : canAfford ? 'Купить' : 'Мало дублонов'}
            </button>
          </div>
        );
      })}
    </div>
  );
}

function artIcon(id) {
  return { card: '🃏', amulet: '📿', staff: '🪄', guide: '🧭', book: '📖' }[id] || '✨';
}

/* ─── Магазин поинтов ─────────────────────────────────────── */

function PointsShop({ player, catalog }) {
  const [data, setData] = useState(null);
  const [spending, setSpending] = useState(null);
  const [picker, setPicker] = useState(null); // { item, kind } — выбор артефакта/NFT
  const [arts, setArts] = useState([]);
  const [msg, setMsg] = useState(null);

  useEffect(() => {
    api.shopPoints().then(setData).catch(() => {});
    api.shopArtifacts().then((d) => setArts(d.artifacts || [])).catch(() => {});
  }, []);

  const doSpend = async (itemId, targetId) => {
    setSpending(itemId); setMsg(null);
    try {
      const res = await api.spendPoints(itemId, targetId);
      const d = await api.shopPoints();
      setData(d);
      setPicker(null);
      setMsg(res?.granted ? `Получено: ${res.granted.name}` : 'Готово!');
    } catch (e) {
      console.error('points spend failed', e);
      setMsg(
        e?.message === 'not_enough_points' ? 'Недостаточно поинтов'
        : e?.message === 'gift_over_limit' ? 'Подарок дороже лимита'
        : e?.message === 'no_gifts' ? 'Нет доступных НФТ'
        : 'Не удалось — попробуй ещё раз'
      );
    } finally { setSpending(null); }
  };

  const onClaim = (item) => {
    setMsg(null);
    // artifact_choice / nft_choice требуют выбора цели; nft_random — сразу.
    if (item.kind === 'artifact_choice') { setPicker({ item, kind: 'artifact' }); return; }
    if (item.kind === 'nft_choice') { setPicker({ item, kind: 'nft' }); return; }
    doSpend(item.id, null); // nft_random
  };

  if (!data) return <p style={{ color: 'var(--bone-soft)', textAlign: 'center', padding: 24 }}>Загрузка…</p>;

  const nftChoices = (catalog || []).filter((g) => !picker?.item?.maxValue || g.priceCoins <= picker.item.maxValue);

  return (
    <div style={{ paddingBottom: 16 }}>
      <div className="dw-points-balance"><strong>{data.points}</strong> поинтов</div>
      {msg && <div className="dw-lucky-result win" style={{ marginBottom: 10 }}>{msg}</div>}
      {(data.items || []).map((item) => {
        const canAfford = data.points >= item.cost;
        return (
          <div key={item.id} className="dw-points-row">
            <div style={{ flex: 1 }}>
              <strong style={{ color: canAfford ? 'var(--gold)' : 'var(--bone-soft)' }}>{item.cost} птс</strong>
              <p style={{ color: 'var(--bone-soft)', fontSize: 13, margin: '2px 0 0' }}>{item.label}</p>
            </div>
            <button className={`dw-btn ${canAfford ? 'primary' : 'ghost'} small dw-points-btn`}
              disabled={!canAfford || spending === item.id}
              onClick={() => onClaim(item)}>
              {spending === item.id ? '…' : 'Забрать'}
            </button>
          </div>
        );
      })}

      {/* Пикер выбора артефакта/НФТ */}
      {picker && (
        <div className="dw-trade-picker" style={{ marginTop: 12 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <strong style={{ fontSize: 14 }}>{picker.kind === 'artifact' ? 'Выбери артефакт' : 'Выбери НФТ'}</strong>
            <button className="dw-icon-btn" onClick={() => setPicker(null)}>×</button>
          </div>
          {picker.kind === 'artifact' ? (
            <div className="dw-art-row">
              {arts.map((a) => (
                <button key={a.id} className="dw-art-btn" disabled={spending} onClick={() => doSpend(picker.item.id, a.id)}>
                  <span>{artIcon(a.id)}</span><small>{a.name}</small>
                </button>
              ))}
            </div>
          ) : (
            <div className="dw-nft-grid">
              {nftChoices.map((g) => (
                <button key={g.id} className="dw-nft-tile" style={{ cursor: 'pointer' }} disabled={spending} onClick={() => doSpend(picker.item.id, g.id)}>
                  <div className="dw-nft-preview"><img src={`/gifts/${g.file}`} alt={g.name} className="dw-gift-img" loading="lazy" /></div>
                  <h2 style={{ fontSize: 12, textTransform: 'lowercase' }}>{g.name}</h2>
                  <strong style={{ fontSize: 12, color: 'var(--gold)' }}>{formatCoins(g.priceCoins)} дбл.</strong>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ─── Lucky Buy колесо ────────────────────────────────────── */

function LuckyBuyModal({ gift, player, onBalance, onNotify, onClose }) {
  const [chance, setChance] = useState(20);
  const [spinning, setSpinning] = useState(false);
  const [rotation, setRotation] = useState(0);
  const [spinDur, setSpinDur] = useState(3.4); // длительность текущей фазы вращения (сек)
  const [spinEase, setSpinEase] = useState('cubic-bezier(0.16,1,0.3,1)');
  const [result, setResult] = useState(null);
  const [demoResult, setDemoResult] = useState(null);
  const [error, setError] = useState(null);
  const [feed, setFeed] = useState([]);
  const [wheelFx, setWheelFx] = useState(''); // '' | 'dimmed shake' | 'win'
  const [attempts, setAttempts] = useState(0); // попыток за сессию
  const [loseStreak, setLoseStreak] = useState(0); // проигрышей подряд
  const [confetti, setConfetti] = useState(false);
  const rotRef = React.useRef(0);
  const touchStartY = React.useRef(null);

  const price = Number(gift.priceCoins) || 0;
  // bet = price * chance/100 * 0.70 (RTP 70%) — точность до 0.01.
  const bet = Math.max(0.01, Math.round(price * chance / 100 * 0.70 * 100) / 100);
  // Показываем дробные с 2 знаками, целые — без хвоста.
  const fmtBet = (b) => Number.isInteger(b) ? formatCoins(b) : b.toFixed(2);
  const mult = price > 0 && bet > 0 ? (price / bet).toFixed(1) : '—';
  const canAfford = (player?.coins || 0) >= bet;

  // Свайп вниз закрывает шторку (как нативные Telegram drawers).
  const onTouchStart = (e) => { touchStartY.current = e.touches[0].clientY; };
  const onTouchEnd = (e) => {
    if (touchStartY.current === null) return;
    const dy = e.changedTouches[0].clientY - touchStartY.current;
    touchStartY.current = null;
    if (dy > 80 && !spinning) onClose();
  };

  useEffect(() => { api.luckyFeed().then((d) => setFeed(d.feed || [])).catch(() => {}); }, []);

  const haptic = (kind = 'light') => window.Telegram?.WebApp?.HapticFeedback?.impactOccurred?.(kind);

  // Абсолютный угол, чтобы стрелка (вверху) села на θ. dir:'back' — ближайший
  // угол НАЗАД (мягкий доворот), иначе вперёд на turns полных оборотов.
  const targetAngle = (theta, { turns = 0, dir = 'fwd' } = {}) => {
    const targetMod = (((360 - (theta % 360)) % 360) + 360) % 360;
    const current = rotRef.current;
    const currentMod = ((current % 360) + 360) % 360;
    const fwd = (((targetMod - currentMod) % 360) + 360) % 360; // 0..360 вперёд
    if (dir === 'back') return current + (fwd - 360); // небольшой ход назад
    return current + turns * 360 + fwd;
  };

  const animateTo = (deg, dur, ease = 'cubic-bezier(0.16,1,0.3,1)') => new Promise((res) => {
    setSpinDur(dur); setSpinEase(ease);
    rotRef.current = deg; setRotation(deg);
    setTimeout(res, dur * 1000 + 30);
  });
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));

  const finishWin = (out) => {
    setSpinning(false); setResult(out || { won: true });
    setWheelFx('win'); haptic('heavy'); setLoseStreak(0);
    setConfetti(true); setTimeout(() => setConfetti(false), 3000);
    sfx.winFanfare();
    onNotify?.(`🎉 Вы выиграли ${gift.name}!`, 'success');
  };
  const finishLose = (out) => {
    setSpinning(false); setResult(out || { won: false });
    setWheelFx('dimmed shake'); setLoseStreak((v) => v + 1);
    window.Telegram?.WebApp?.HapticFeedback?.notificationOccurred?.('error');
    sfx.loseSound();
    // Тост не показываем — итог и так виден на колесе (без дубля).
  };

  const runScenario = async (won, finalize) => {
    const goldDeg = chance / 100 * 360;
    const pad = Math.min(4, goldDeg * 0.25);
    const inGold = () => pad + Math.random() * Math.max(0.0001, goldDeg - 2 * pad);
    const inGrey = () => goldDeg + 6 + Math.random() * Math.max(0.0001, (360 - goldDeg) - 12);
    const SMOOTH = 'cubic-bezier(0.12,0.72,0.16,1)'; // плавная глубокая деселерация

    const wait = (ms) => new Promise((r) => setTimeout(r, ms));

    if (won) {
      // 45% — байт «вот-вот мимо»: тормозит у дальнего края золота, замирает,
      // потом МЕДЛЕННО доползает вперёд и мягко встаёт в золото (без отката назад).
      if (Math.random() < 0.45) {
        const edge = Math.max(0.5, goldDeg - 1.5); // почти у выхода из золота
        await animateTo(targetAngle(edge, { turns: 5 }), 3.8 + Math.random() * 0.6, SMOOTH);
        await wait(550);
        haptic('light');
        await animateTo(targetAngle(inGold(), { turns: 1 }), 1.1, 'cubic-bezier(0.22,0.9,0.3,1)');
      } else {
        // Чистая плавная остановка на золоте.
        await animateTo(targetAngle(inGold(), { turns: 5 }), 3.6 + Math.random() * 0.8, SMOOTH);
      }
      finalize();
      return;
    }
    // lose — больше байта: почти всегда «почти выиграл», стоп вплотную к золоту.
    const scenario = Math.random() > 0.85 ? 'long' : 'near';
    if (scenario === 'near') {
      // Стрелка останавливается на 2-6° ЗА краем золота — выглядит как «чуть-чуть не хватило».
      await animateTo(targetAngle(goldDeg + 2 + Math.random() * 4, { turns: 5 }), 4.2 + Math.random() * 0.8, SMOOTH);
    } else {
      // Изредка — долгое вращение 6-8с, несколько раз проходит золото на скорости.
      await animateTo(targetAngle(inGrey(), { turns: 9 + Math.floor(Math.random() * 3) }), 6.5 + Math.random() * 1.5, SMOOTH);
    }
    finalize();
  };

  const spinWheel = async (demo) => {
    setSpinning(true); setResult(null); setDemoResult(null); setError(null); setWheelFx('');

    if (demo) {
      const won = Math.random() * 100 < chance;
      await runScenario(won, () => { setSpinning(false); setDemoResult(won ? 'win' : 'lose'); if (won) { setWheelFx('win'); haptic('heavy'); } else { setWheelFx('dimmed shake'); } });
      return;
    }

    // Реальная игра: бэкенд решает результат ДО анимации.
    try {
      const out = await api.luckyBuy(gift.id, chance);
      setAttempts((v) => v + 1);
      // Баланс обновляем сразу (ставка уже списана на сервере).
      if (typeof out.balance === 'number') onBalance?.(out.balance);
      await runScenario(out.won, () => (out.won ? finishWin(out) : finishLose(out)));
    } catch (e) {
      console.error('lucky-buy failed', e);
      setSpinning(false);
      setError(
        e?.message === 'insufficient_balance' ? 'Недостаточно дублонов'
        : e?.message === 'gift_not_found' ? 'Подарок не найден'
        : e?.message === 'invalid_price' ? 'Некорректная цена подарка'
        : 'Не удалось сыграть, попробуй ещё раз'
      );
    }
  };

  // SVG wheel: gold zone = chance%, grey = rest, pointer at top
  const r = 90;
  const cx = 100, cy = 100;
  const goldAngle = (chance / 100) * 2 * Math.PI;
  // Gold arc: starts at -90° (top) going clockwise
  const toXY = (a, rad) => [cx + rad * Math.cos(a - Math.PI / 2), cy + rad * Math.sin(a - Math.PI / 2)];
  const [gx1, gy1] = toXY(0, r);
  const [gx2, gy2] = toXY(goldAngle, r);
  const largeArc = goldAngle > Math.PI ? 1 : 0;

  const outcome = result || (demoResult === 'win' ? { won: true } : demoResult === 'lose' ? { won: false } : null);

  return (
    <motion.div className="dw-sheet-backdrop" onClick={onClose}
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
      <motion.div className="dw-wheel-sheet dw-lucky-sheet" onClick={(e) => e.stopPropagation()}
        onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}
        initial={{ y: 40, opacity: 0 }} animate={{ y: 0, opacity: 1 }}>
        {confetti && (
          <span className="dw-confetti">
            {Array.from({ length: 40 }).map((_, k) => (
              <span key={k} className="dw-confetti-bit" style={{
                left: `${Math.random() * 100}%`,
                background: ['#FFD700', '#4FC3F7', '#ff5ca8', '#6dbe88', '#fff6d0'][k % 5],
                animationDelay: `${Math.random() * 0.6}s`, animationDuration: `${1.8 + Math.random() * 1.4}s`
              }} />
            ))}
          </span>
        )}
        <div className="dw-drawer-handle" />
        <div className="dw-round-result-header">
          <h2 style={{ flex: 1, textAlign: 'center' }}>🍀 Lucky Buy{attempts > 0 ? ` · Попытка #${attempts}` : ''}</h2>
        </div>
        {error && <div className="dw-lucky-result lose" style={{ marginBottom: 10 }}>{error}</div>}

        <div className={`dw-wheel-stage${loseStreak >= 5 ? ' dw-wheel-magnet' : ''}`}>
          {wheelFx.includes('win') && (
            <span className="dw-particles" style={{ zIndex: 8 }}>
              {Array.from({ length: 20 }).map((_, k) => {
                const ang = (Math.PI * 2 * k) / 20;
                const dist = 70 + Math.random() * 50;
                return <span key={k} className="dw-particle gold big"
                  style={{ '--px': `${Math.cos(ang) * dist}px`, '--py': `${Math.sin(ang) * dist}px`, animationDelay: `${Math.random() * 0.1}s` }} />;
              })}
            </span>
          )}
          <div className="dw-wheel-pointer" />
          <svg viewBox="0 0 200 200" className={`dw-wheel-svg ${wheelFx}`}>
            <g style={{ transition: `transform ${spinDur}s ${spinEase}`, transform: `rotate(${rotation}deg)`, transformOrigin: `${cx}px ${cy}px` }}>
              {/* Grey zone (loss) */}
              <circle cx={cx} cy={cy} r={r} fill="#2a2520" />
              {/* Gold zone (win) */}
              <path d={`M${cx} ${cy} L${gx1} ${gy1} A${r} ${r} 0 ${largeArc} 1 ${gx2} ${gy2} Z`} fill="#d4af37" opacity="0.85" />
              {/* Center: картинка подарка, который крутит игрок */}
              <defs>
                <clipPath id="dw-wheel-gift"><circle cx={cx} cy={cy} r={20} /></clipPath>
              </defs>
              <circle cx={cx} cy={cy} r={22} fill="#1a1510" stroke="#d4af37" strokeWidth="1.5" />
              {gift.file ? (
                <image href={`/gifts/${gift.file}`} x={cx - 20} y={cy - 20} width={40} height={40}
                  clipPath="url(#dw-wheel-gift)" preserveAspectRatio="xMidYMid slice" />
              ) : (
                <text x={cx} y={cy + 7} textAnchor="middle" fontSize="22">🎁</text>
              )}
            </g>
            {/* Outer ring */}
            <circle cx={cx} cy={cy} r={r} fill="none" stroke="#d4af37" strokeWidth="2" opacity="0.5" />
          </svg>
        </div>

        {/* Зона результата с фикс. высотой — модал не прыгает */}
        <div className="dw-lucky-result-slot">
          {outcome ? (
            <div className={`dw-lucky-result ${outcome.won ? 'win' : 'lose'}`}>
              {outcome.won ? `🎉 Вы выиграли ${gift.name}!` : '💀 Удача отвернулась — попробуй ещё раз'}
            </div>
          ) : loseStreak >= 5 ? (
            <div className="dw-lucky-tease strong">🔥 Подарок почти твой — ещё попытка!</div>
          ) : loseStreak >= 3 ? (
            <div className="dw-lucky-tease">😤 Ещё чуть-чуть...</div>
          ) : null}
        </div>

        <div className="dw-lucky-slider-row">
          <span>Шанс: <strong style={{ color: 'var(--gold)' }}>{chance}%</strong></span>
          <span>Ставка: <strong style={{ color: 'var(--gold)' }}>{fmtBet(bet)} дбл.</strong></span>
        </div>
        <input type="range" min={1} max={80} step={1} value={chance}
          onChange={(e) => { setChance(Number(e.target.value)); setResult(null); setDemoResult(null); setError(null); setWheelFx(''); }}
          className="dw-lucky-slider" disabled={spinning} />
        <div className="dw-lucky-meta">
          <span>Множитель: ×{mult}</span>
          <span>Цена подарка: {formatCoins(price)} дбл.</span>
        </div>

        <div style={{ display: 'flex', gap: 10, marginTop: 12 }}>
          <button className="dw-btn ghost" style={{ flex: 1 }} disabled={spinning} onClick={() => spinWheel(true)}>
            🎭 Демо
          </button>
          <button className={`dw-btn ${canAfford ? 'primary' : 'ghost'}`} style={{ flex: 2 }}
            disabled={spinning || !canAfford} onClick={() => spinWheel(false)}>
            {spinning ? 'Крутим…' : canAfford ? `Сыграть — ${fmtBet(bet)} дбл.` : 'Мало дублонов'}
          </button>
        </div>

        {feed.length > 0 && (
          <div className="dw-lucky-feed">
            <span className="dw-kicker" style={{ color: 'var(--gold)' }}>Последние выигрыши</span>
            {feed.map((w, i) => (
              <div key={i} className="dw-lucky-feed-row">
                <span className="dw-round-row-avatar" style={{ width: 22, height: 22, fontSize: 11 }}>
                  {w.avatarUrl ? <img src={w.avatarUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: '50%' }} /> : w.name?.[0]?.toUpperCase()}
                </span>
                <span>{w.name} выиграл <strong>{w.giftName}</strong> при шансе {w.chance}%</span>
              </div>
            ))}
          </div>
        )}

        <button className="dw-btn ghost full" style={{ marginTop: 14 }} disabled={spinning} onClick={onClose}>
          Закрыть
        </button>
      </motion.div>
    </motion.div>
  );
}

/* ─── Инвентарь ───────────────────────────────────────────── */

function Inventory({ onNotify, onBalance }) {
  const [data, setData] = useState(null);
  const [tab, setTab] = useState('all'); // all | gifts | artifacts
  const [confirm, setConfirm] = useState(null); // { kind, action, item }
  const [busy, setBusy] = useState(false);

  const load = () => api.inventory().then(setData).catch(() => setData({ gifts: [], artifacts: [] }));
  useEffect(() => { load(); }, []);

  if (!data) return <article className="dw-panel" style={{ marginBottom: 12 }}><p style={{ color: 'var(--bone-soft)', textAlign: 'center', fontSize: 13 }}>Загрузка…</p></article>;

  const gifts = data.gifts || [];
  const arts = [];                 // артефакты временно скрыты
  const empty = gifts.length === 0;
  const showGifts = true;
  const showArts = false;

  const doSell = async (item) => {
    setBusy(true);
    try {
      const res = await api.sellInvItem(item.id, item.kind);
      if (res.player) onBalance?.(res.player.coins);
      onNotify?.(`Продано: ${item.name} (+${formatCoins(res.payout)} дбл.)`, 'success');
      setConfirm(null); await load();
    } catch (e) { onNotify?.('Не удалось продать', 'danger'); }
    finally { setBusy(false); }
  };
  const doWithdraw = async (item) => {
    setBusy(true);
    try {
      const res = await api.withdrawInvItem(item.id); // создаёт счёт на 25 Stars
      const webApp = window.Telegram?.WebApp;
      if (res.invoiceLink && webApp?.openInvoice) {
        webApp.openInvoice(res.invoiceLink, async (status) => {
          if (status === 'paid') {
            onNotify?.('Оплачено — подарок выводится в течение 24ч', 'success');
            await load();
          } else if (status === 'failed') {
            onNotify?.('Оплата не прошла', 'danger');
          }
          setConfirm(null); setBusy(false);
        });
        return;
      }
      if (res.invoiceLink) { window.open(res.invoiceLink, '_blank', 'noopener,noreferrer'); setConfirm(null); }
      else onNotify?.('Stars не настроены на сервере', 'danger');
    } catch (e) {
      onNotify?.('Не удалось создать счёт на вывод', 'danger');
    } finally { setBusy(false); }
  };

  return (
    <article className="dw-panel" style={{ marginBottom: 12 }}>
      <div className="dw-panel-head" style={{ marginBottom: 10 }}><h2>Инвентарь подарков</h2></div>

      {empty && <p style={{ color: 'var(--bone-soft)', textAlign: 'center', padding: '16px 0', fontSize: 14 }}>Здесь пока пусто — загляни в магазин</p>}

      {showGifts && gifts.map((g) => (
        <div key={g.id} className="dw-inv-row">
          <div className="dw-inv-img">{g.file ? <img src={`/gifts/${g.file}`} alt="" /> : '🎁'}</div>
          <div className="dw-inv-info">
            <strong>{g.name}</strong>
            <small>{g.sourceLabel} · {formatCoins(g.priceCoins)} дбл.</small>
          </div>
          <div className="dw-inv-actions">
            <button className="dw-btn ghost small" onClick={() => setConfirm({ action: 'sell', item: g })}>Продать</button>
            <button className="dw-btn primary small" onClick={() => setConfirm({ action: 'withdraw', item: g })}>Вывести</button>
          </div>
        </div>
      ))}

      {showArts && arts.map((a) => (
        <div key={a.id} className="dw-inv-row">
          <div className="dw-inv-img">{artIcon(a.artifactId)}</div>
          <div className="dw-inv-info">
            <strong>{a.name} ×{a.quantity}</strong>
            <small>{a.description}</small>
          </div>
          <div className="dw-inv-actions">
            <button className="dw-btn ghost small" onClick={() => setConfirm({ action: 'sell', item: a })}>Продать</button>
          </div>
        </div>
      ))}

      {confirm && (
        <div className="dw-sheet-backdrop" onClick={() => !busy && setConfirm(null)} style={{ zIndex: 50 }}>
          <div className="dw-cards-modal" onClick={(e) => e.stopPropagation()}>
            {confirm.action === 'sell' ? (
              <>
                <h2 style={{ fontSize: 17, marginBottom: 10 }}>Продать?</h2>
                <p style={{ fontSize: 14, color: 'var(--bone-soft)', marginBottom: 14 }}>
                  Продать «{confirm.item.name}» за {formatCoins(confirm.item.kind === 'gift' ? Math.round(confirm.item.priceCoins * 0.7) : Math.round(confirm.item.price * 0.5))} дбл.?
                </p>
                <div style={{ display: 'flex', gap: 10 }}>
                  <button className="dw-btn ghost" style={{ flex: 1 }} disabled={busy} onClick={() => setConfirm(null)}>Отмена</button>
                  <button className="dw-btn primary" style={{ flex: 1 }} disabled={busy} onClick={() => doSell(confirm.item)}>Продать</button>
                </div>
              </>
            ) : (
              <>
                <h2 style={{ fontSize: 17, marginBottom: 12 }}>Вывод подарка</h2>
                {confirm.item.file && (
                  <div className="dw-inv-img" style={{ width: 72, height: 72, margin: '0 auto 10px', fontSize: 34 }}>
                    <img src={`/gifts/${confirm.item.file}`} alt="" />
                  </div>
                )}
                <p style={{ textAlign: 'center', fontWeight: 700, marginBottom: 10 }}>{confirm.item.name}</p>
                <p style={{ fontSize: 14, color: 'var(--vellum)', marginBottom: 4, textAlign: 'center' }}>
                  Стоимость вывода: <strong style={{ color: 'var(--gold)' }}>25 ⭐️</strong>
                </p>
                <p style={{ fontSize: 12, color: 'var(--bone-soft)', marginBottom: 14, textAlign: 'center' }}>
                  Подарок будет отправлен в течение 24 часов
                </p>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <button className="dw-btn primary full" disabled={busy} onClick={() => doWithdraw(confirm.item)}>
                    {busy ? '…' : 'Оплатить 25 ⭐️ и вывести'}
                  </button>
                  <button className="dw-btn ghost full" disabled={busy} onClick={() => setConfirm(null)}>Отмена</button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </article>
  );
}

/* ─── Profile tab ─────────────────────────────────────────── */

function ProfileTab({ player, filters, activeFilter, onFilterChange, history, tonWallet, onConnectTon, onDisconnectTon, onOpenAdmin, onOpenClans, onOpenRef, onOpenWheel, onOpenMyRounds, onNotify, onBalance }) {
  const u = userDisplay(player);
  const [showId, setShowId] = useState(false);
  const [statsOpen, setStatsOpen] = useState(false);
  const [wheel, setWheel] = useState(null);
  useEffect(() => { api.wheel().then(setWheel).catch(() => {}); }, []);

  return (
    <section className="dw-page dw-profile-page">

      <div className="dw-profile-header">
        <div className="dw-avatar large" style={u.avatarUrl ? { padding: 0, overflow: 'hidden' } : {}}>
          {u.avatarUrl
            ? <img src={u.avatarUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: '50%' }} />
            : u.initial}
        </div>
        <div className="dw-profile-header-copy">
          <h1 className="dw-profile-name" style={{ fontSize: 20 }}>
            {u.displayName}
            {player.clanTag && <span className="dw-clan-tag-badge" style={{ marginLeft: 6, fontSize: 13 }}>[{player.clanTag}]</span>}
          </h1>
          <p className="dw-profile-meta" style={{ fontSize: 13, cursor: 'pointer' }} onClick={() => setShowId((v) => !v)}>
            {showId ? `ID ${player.id}` : 'показать ID'}
          </p>
        </div>
      </div>

      {/* Статистика — одна понятная кнопка, открывает полный модал */}
      <button className="dw-profile-statbtn" onClick={() => setStatsOpen(true)}>
        <span className="dw-profile-statbtn-ico">📊</span>
        <span className="dw-profile-statbtn-txt">
          <strong>Моя статистика</strong>
          <small>игры, винрейт, рекорд, поинты</small>
        </span>
        <span className="dw-profile-statbtn-go">›</span>
      </button>
      {statsOpen && <StatsModal player={player} onClose={() => setStatsOpen(false)} onOpenMyRounds={() => { setStatsOpen(false); onOpenMyRounds?.(); }} />}

      {/* Понятные кнопки разделов */}
      <div className="dw-profile-nav">
        <button className="dw-profile-navbtn" onClick={onOpenRef}>
          <span className="dw-profile-navbtn-ico">🤝</span>
          <span className="dw-profile-navbtn-txt"><strong>Рефералы</strong><small>зови друзей · до 15%</small></span>
          <span className="dw-profile-navbtn-go">›</span>
        </button>
        <button className="dw-profile-navbtn dw-profile-navbtn--wheel" onClick={onOpenWheel}>
          <span className="dw-profile-navbtn-ico">🎡</span>
          <span className="dw-profile-navbtn-txt">
            <strong>Колесо фортуны</strong>
            <small>{wheel?.canSpin ? '🔥 Доступен спин!' : wheel?.unlocked === false ? `Нужно ещё ${wheel?.tonNeeded ?? '5'} TON за неделю` : 'Крути каждый день'}</small>
          </span>
          <span className="dw-profile-navbtn-go">{wheel?.canSpin ? '🔥' : '›'}</span>
        </button>
      </div>

      <Inventory onNotify={onNotify} onBalance={onBalance} />

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
                  : result.note || 'дублоны зачислены'}
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

function PersonalStats({ player, onOpenMyRounds }) {
  const [s, setS] = useState(null);
  const [pts, setPts] = useState(null);
  useEffect(() => {
    api.stats().then(setS).catch(() => {});
    api.shopPoints().then((d) => setPts(d.points)).catch(() => {});
  }, []);
  const roundsPlayed = s ? s.roundsPlayed : (player?.gamesPlayed || 0);
  const wins = s?.wins ?? 0;
  const bestWin = s ? s.bestWin : (player?.bestWin || 0);
  const winRate = roundsPlayed > 0 ? Math.round((wins / roundsPlayed) * 100) : 0;
  return (
    <article className="dw-panel" style={{ marginBottom: 12 }}>
      <div className="dw-stats-row">
        <button className="dw-stat-cell dw-stat-cell--btn" onClick={onOpenMyRounds}><span>игр ›</span><strong>{formatCoins(roundsPlayed)}</strong></button>
        <div className="dw-stat-cell"><span>побед</span><strong>{formatCoins(wins)}</strong></div>
        <div className="dw-stat-cell accent"><span>винрейт</span><strong>{winRate}%</strong></div>
        <div className="dw-stat-cell accent"><span>рекорд</span><strong>{formatCompact(bestWin)}</strong></div>
      </div>
      {pts !== null && (
        <div style={{ marginTop: 8, paddingTop: 8, borderTop: '1px solid var(--border)', fontSize: 13, color: 'var(--bone-soft)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span>⭐ Поинты лояльности</span>
          <strong style={{ color: 'var(--gold)', fontFamily: 'var(--font-display)' }}>{formatCoins(pts)}</strong>
        </div>
      )}
    </article>
  );
}

/* ─── Полная статистика (модал) ────────────────────────────── */

function StatsModal({ player, onClose, onOpenMyRounds }) {
  const [s, setS] = useState(null);
  const [pts, setPts] = useState(null);
  useEffect(() => {
    api.stats().then(setS).catch(() => {});
    api.shopPoints().then((d) => setPts(d.points)).catch(() => {});
  }, []);
  const rounds = s ? s.roundsPlayed : (player?.gamesPlayed || 0);
  const wins = s?.wins ?? 0;
  const losses = Math.max(0, rounds - wins);
  const winRate = rounds > 0 ? Math.round((wins / rounds) * 100) : 0;
  const bestWin = s ? s.bestWin : (player?.bestWin || 0);
  const totalWon = s?.totalWon ?? (player?.coinsWon || 0);
  const totalSpent = s?.totalSpent ?? (player?.coinsSpent || 0);

  const Cell = ({ label, value, accent }) => (
    <div className={`dw-statm-cell${accent ? ' accent' : ''}`}><span>{label}</span><strong>{value}</strong></div>
  );

  return (
    <motion.div className="dw-sheet-backdrop" onClick={onClose}
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
      <motion.div className="dw-deposit-sheet" onClick={(e) => e.stopPropagation()}
        initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }} transition={{ type: 'spring', stiffness: 260, damping: 26 }}>
        <div className="dw-round-result-header">
          <h2>📊 Статистика</h2>
          <button className="dw-icon-btn" onClick={onClose}>×</button>
        </div>
        <div className="dw-statm-grid">
          <Cell label="Игр сыграно" value={formatCoins(rounds)} />
          <Cell label="Побед" value={formatCoins(wins)} accent />
          <Cell label="Поражений" value={formatCoins(losses)} />
          <Cell label="Винрейт" value={`${winRate}%`} accent />
          <Cell label="Рекорд" value={formatCompact(bestWin)} accent />
          <Cell label="Всего выиграно" value={formatCompact(totalWon)} />
          <Cell label="Всего поставлено" value={formatCompact(totalSpent)} />
        </div>
        <button className="dw-btn primary full" style={{ marginTop: 14 }} onClick={onOpenMyRounds}>
          История моих игр ›
        </button>
      </motion.div>
    </motion.div>
  );
}

/* ─── История раундов: список + детали по игрокам ─────────── */

function RoundsHistory({ myId, onClose, initialSort = 'all' }) {
  const [sort, setSort] = useState(initialSort); // all | best | mine
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
              <button className={`dw-will-pager-btn ${sort === 'mine' ? 'active' : ''}`} onClick={() => setSort('mine')}>Мои</button>
              <button className={`dw-will-pager-btn ${sort === 'best' ? 'active' : ''}`} onClick={() => setSort('best')}>Лучшие</button>
            </div>
            {loading ? (
              <div className="dw-pay-loading"><div className="dw-pay-spinner" /></div>
            ) : rounds.length === 0 ? (
              <p style={{ color: 'var(--bone-soft)', textAlign: 'center', padding: '16px 0', fontSize: 14 }}>{sort === 'mine' ? 'Ты ещё не играл в раундах' : 'Раундов пока нет'}</p>
            ) : rounds.map((r) => {
              const w = r.winner;
              const u = w ? userDisplay(w) : null;
              return (
                <button key={r.lobbyId} className="dw-round-row" style={{ width: '100%', textAlign: 'left' }} onClick={() => openDetail(r.lobbyId)}>
                  <span className="dw-lb-rank">#{r.roundNumber}</span>
                  <span className="dw-round-row-avatar" style={u?.avatarUrl ? { padding: 0, overflow: 'hidden' } : {}}>
                    {u?.avatarUrl ? <img src={u.avatarUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: '50%' }} /> : (u?.initial || '—')}
                  </span>
                  <span className="dw-round-row-name">{w ? `Победитель ${u.displayName}` : 'Без победителя'} · {r.players} игроков{sort === 'best' ? ` · банк ${formatCoins(r.totalWon)}` : ''}</span>
                  <span className="dw-round-row-prize pos">{(sort === 'best' ? r.totalWon : (w ? r.topPrize : 0)) > 0 ? `+${formatCoins(sort === 'best' ? r.totalWon : r.topPrize)}` : '0'}</span>
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
                <span className="dw-round-row-name">{u.displayName} выиграл <strong className="gold">{formatCoins(w.amount)}</strong> дублонов</span>
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
          Переведи TON на адрес проекта с указанным комментарием. Минимум 0.5 TON (5 дублонов).
        </p>
        <div className="dw-coins-input-wrap">
          <input className="dw-coins-input" type="number" min="0.5" step="0.1" placeholder="Сумма в TON"
            value={amount} onChange={(e) => setAmount(e.target.value)} />
          {amt >= 0.5 && (
            <div className="dw-coins-preview"><span>{formatCoins(Math.round(amt * 10))} дублонов</span></div>
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
            Отправь <strong className="gold">{dep.amountTon} TON</strong> ({formatCoins(dep.coins)} дублонов) на адрес ниже, обязательно с комментарием.
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
          <div><strong>Оплата получена!</strong><p>+{formatCoins(dep.coins)} дублонов зачислено</p></div>
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

/* ─── Deposit sheet — дублоны / карты ─────────────────────── */

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
    onStarsCustom(coinsNum); // динамическая сумма: coinsNum дублонов = coinsNum*20 ⭐
  };
  const handleBuyCoinsTon = () => {
    if (!coinsNum) return;
    onTonCustom(coinsNum); // динамическая сумма TON через TonConnect
  };

  const cheapPacks = ticketPacks?.cheap || [];
  const premPacks = (ticketPacks?.premium || []).slice(0, 5);

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
            <p style={{ color: 'var(--bone-soft)', fontSize: 13, margin: 0 }}>1 дублон = 20 ⭐ = 0.1 TON</p>
          </div>
          <button className="dw-icon-btn" onClick={onClose}>×</button>
        </div>

        {/* MAIN — 2 кнопки */}
        {view === 'main' && !payPending && !tonIntent && (
          <div className="dw-deposit-choices">
            <button className="dw-deposit-choice dw-deposit-choice--gold" onClick={() => onViewChange('coins')}>
              <span className="dw-deposit-choice-icon">🪙</span>
              <div className="dw-deposit-choice-text">
                <strong>Купить дублоны</strong>
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

        {/* COINS — вводишь сколько дублонов хочешь */}
        {view === 'coins' && !payPending && !tonIntent && (
          <div className="dw-coins-buy">
            <div className="dw-rate-bar">
              <span>1 дублон</span><span className="dw-rate-eq">=</span>
              <span>20 ⭐</span><span className="dw-rate-eq">=</span><span>0.1 TON</span>
            </div>
            {/* Быстрый выбор популярных сумм — в один тап */}
            <div className="dw-coins-presets">
              {[50, 100, 250, 500, 1000].map((v) => (
                <button key={v} className={`dw-coins-preset${coinsNum === v ? ' active' : ''}`}
                  onClick={() => setCoins(String(v))}>{v}</button>
              ))}
            </div>
            <div className="dw-coins-input-wrap">
              <input className="dw-coins-input" type="number" min="1" placeholder="Своя сумма"
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

          </div>
        )}

        {/* CARDS — ввод числа карт, оплата дублонами (без наборов) */}
        {view === 'cards' && !payPending && (
          <div className="dw-cards-shop">
            <div className="dw-card-buy-block">
              <div className="dw-cards-section-head">
                <span style={{ fontSize: 15, fontWeight: 700 }}>🎴 PvP карты</span>
                <span className="dw-kicker" style={{ marginLeft: 8 }}>5 дублонов / карта</span>
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
                <span className="dw-kicker" style={{ marginLeft: 8 }}>150 дублонов / карта</span>
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

function PvpRoundResultModal({ result, myUserId, entryCoins, onClose, onOpenDeposit, onOpenShop }) {
  const cards = result?.cards || [];
  const takenCards = cards.filter(c => c.taken);

  // BUG 1 — группируем по userId, чтобы один игрок с несколькими картами
  // показывался ОДНОЙ строкой (со всеми его картами и суммарным результатом).
  const groupMap = {};
  for (const c of takenCards) {
    const uid = c.owner?.userId || (c.mine ? String(myUserId) : `card-${c.index}`);
    if (!groupMap[uid]) {
      groupMap[uid] = { userId: uid, owner: c.owner, mine: false, totalPrize: 0, totalBet: 0, cards: [] };
    }
    const g = groupMap[uid];
    g.totalPrize += c.outcome?.credit || 0;
    g.totalBet += entryCoins;
    g.cards.push(c.index + 1);
    if (c.mine) g.mine = true;
  }
  // profit = выигрыш − ставка. Сортировка по profit по убыванию.
  const rows = Object.values(groupMap)
    .map(g => ({ ...g, profit: g.totalPrize - g.totalBet, cards: g.cards.sort((a, b) => a - b) }))
    .sort((a, b) => b.profit - a.profit);

  const winners = rows.filter(r => r.profit >= 0);  // окуп тоже считается «в плюсе»
  const losers = rows.filter(r => r.profit < 0);

  // Мой результат суммируется по всем моим картам. 4 состояния:
  // profit>0 победа, =0 ноль, -bet<profit<0 частичный слив, =-bet полный проигрыш.
  const myRow = rows.find(r => r.mine);
  const myProfit = myRow ? myRow.profit : 0;
  const myBet = myRow ? myRow.totalBet : 0;
  const myMult = (myRow && myRow.totalBet > 0) ? (myRow.totalPrize / myRow.totalBet).toFixed(1) : '0.0';
  const myState = !myRow ? null
    : myProfit > 0 ? 'win'
    : myProfit === 0 ? 'zero'
    : myProfit > -myBet ? 'partial'
    : 'lose';
  const isLoser = myState === 'partial' || myState === 'lose';
  // «Грязный вин» — суммарный лут (все выпавшие дублоны), без вычета ставки.
  const myGross = myRow ? myRow.totalPrize : 0;

  // Анимированный «отсчёт» лута — дублоны набегают, а не появляются разом.
  const [shownWin, setShownWin] = useState(0);
  useEffect(() => {
    if (!(myGross > 0)) { setShownWin(0); return; }
    let raf; const start = performance.now(); const dur = 850;
    const step = (now) => {
      const p = Math.min(1, (now - start) / dur);
      setShownWin(Math.round(myGross * (1 - Math.pow(1 - p, 3))));
      if (p < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [myGross]);

  const cardLabel = (nums) => nums.length > 1 ? `карты #${nums.join(', #')}` : `карта #${nums[0]}`;

  // Вибрация при открытии итогов.
  useEffect(() => {
    const h = window.Telegram?.WebApp?.HapticFeedback;
    if (isLoser) h?.notificationOccurred?.('error');
    else if (myState === 'win') h?.notificationOccurred?.('success');
  }, []);

  const Row = ({ r, i }) => {
    const u = userDisplay(r.owner);
    const cls = ['dw-round-row',
      r.mine ? 'dw-round-row--mine' : '',
      r.profit > 0 ? 'win' : (r.profit < 0 ? 'lose' : '')].filter(Boolean).join(' ');
    return (
      <div key={r.userId + i} className={cls} style={{ animationDelay: `${i * 0.08}s` }}>
        <span className="dw-round-row-avatar" style={u.avatarUrl ? { padding: 0, overflow: 'hidden' } : {}}>
          {u.avatarUrl ? <img src={u.avatarUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: '50%' }} /> : u.initial}
        </span>
        <span className="dw-round-row-name">
          {u.displayName}{r.mine ? ' (ты)' : ''}
          <small className="dw-round-row-cards">{cardLabel(r.cards)}</small>
        </span>
        <span className={`dw-round-row-prize ${r.profit > 0 ? 'pos' : (r.profit < 0 ? 'neg' : '')}`}>
          {r.profit > 0 ? `+${r.profit}` : r.profit}
        </span>
      </div>
    );
  };

  const glowCls = myState === 'win' ? 'win-glow' : isLoser ? 'lose-glow' : '';

  return (
    <motion.div className="dw-sheet-backdrop" onClick={onClose}
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.25 }}>
      <motion.div className={`dw-round-result ${glowCls} ${isLoser ? 'dw-shake' : ''}`} onClick={e => e.stopPropagation()}
        initial={{ y: '100%', scale: 0.96 }} animate={{ y: 0, scale: 1 }} exit={{ y: '100%' }}
        transition={{ type: 'spring', stiffness: 260, damping: 24 }}>

        <div className="dw-round-result-header">
          <h2>{result?.lobby?.gameNum ? `Раунд #${result.lobby.gameNum} завершён` : 'Раунд завершён'}</h2>
          <button className="dw-icon-btn" onClick={onClose}>×</button>
        </div>

        {/* Мой результат — суммарный по всем картам, 4 состояния */}
        {myState === 'win' && (
          <div className="dw-round-my-result win dw-win-anim">
            <span className="dw-round-result-emoji dw-emoji-bounce">🏆</span>
            <div>
              <strong className="dw-win-title">ТЫ ВЫИГРАЛ</strong>
              <span className="dw-round-amount">+{shownWin} дублонов <em> ×{myMult}</em></span>
              <small className="dw-win-net">чистыми +{myProfit} · ставка {myBet}</small>
            </div>
          </div>
        )}
        {myState === 'zero' && (
          <div className="dw-round-my-result zero">
            <span className="dw-round-result-emoji">🤝</span>
            <div><strong>Вышел в ноль</strong></div>
          </div>
        )}
        {myState === 'partial' && (
          <div className="dw-round-my-result lose">
            <span className="dw-round-result-emoji">😬</span>
            <div>
              <strong>Немного слило</strong>
              <span className="dw-round-amount">−{myBet} дублонов <em> ставка</em></span>
              <small className="dw-win-net">отбил +{myGross} · чистыми {myProfit}</small>
            </div>
          </div>
        )}
        {myState === 'lose' && (
          <div className="dw-round-my-result lose">
            <span className="dw-round-result-emoji">💀</span>
            <div>
              <strong>В этот раз не повезло</strong>
              <span className="dw-round-amount">−{myBet} дублонов <em> в труху</em></span>
              <small className="dw-win-net">ставка сгорела полностью</small>
            </div>
          </div>
        )}

        {/* Топ-3 по выигрышу в раунде */}
        {(() => {
          const top = [...rows].filter(r => r.totalPrize > 0).sort((a, b) => b.totalPrize - a.totalPrize).slice(0, 3);
          if (!top.length) return null;
          return (
            <div className="dw-round-section">
              <span className="dw-kicker" style={{ color: 'var(--gold)' }}>Топ раунда</span>
              {top.map((r, i) => {
                const u = userDisplay(r.owner);
                return (
                  <div key={r.userId} className={`dw-round-row${r.mine ? ' dw-round-row--mine' : ''} win`} style={{ animationDelay: `${i * 0.07}s` }}>
                    <span className="dw-top-medal">{['🥇','🥈','🥉'][i]}</span>
                    <span className="dw-round-row-avatar" style={u.avatarUrl ? { padding: 0, overflow: 'hidden' } : {}}>
                      {u.avatarUrl ? <img src={u.avatarUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: '50%' }} /> : u.initial}
                    </span>
                    <span className="dw-round-row-name">{u.displayName}{r.mine ? ' (ты)' : ''}</span>
                    <span className="dw-round-row-prize pos">+{r.totalPrize}</span>
                  </div>
                );
              })}
            </div>
          );
        })()}

        {/* «Карта которую ты не взял» — подталкивает играть ещё */}
        {(() => {
          const myWon = myRow ? myRow.totalPrize : 0;
          const freeBest = cards
            .filter((c) => !c.taken && c.outcome && (c.outcome.credit || 0) > myWon)
            .sort((a, b) => (b.outcome.credit || 0) - (a.outcome.credit || 0))[0];
          if (!freeBest) return null;
          return (
            <div className="dw-missed-card">
              😈 Карта #{freeBest.index + 1} которую ты не взял дала +{freeBest.outcome.credit} дублонов
            </div>
          );
        })()}

        <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
          <button className="dw-btn primary" style={{ flex: 2 }} onClick={onClose}>
            Новый раунд
          </button>
          {isLoser ? (
            <button className="dw-btn ghost" style={{ flex: 1 }} onClick={onOpenDeposit}>
              Пополнить
            </button>
          ) : (
            <button className="dw-btn ghost" style={{ flex: 1 }} onClick={onOpenShop}>
              Магазин
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
          <p>Сжигаются при покупке PvP-карты вместо дублонов.</p>
        </article>
        <article className={`dw-ticket-card ${inventory.premium > 0 ? '' : 'empty'}`}>
          <span className="dw-kicker">Премиум карты</span>
          <div className="dw-ticket-count">{inventory.premium}</div>
          <p>Сжигаются при печати соло-завещания вместо 150 дублонов.</p>
        </article>
      </div>

      {cheap.length > 0 && (
        <article className="dw-panel">
          <div className="dw-tickets-section-head">
            <h3>Дешёвые карты</h3>
            <span>5 дублонов за штуку</span>
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
                    <span>{each} дублонов за карту{pack.count >= 20 ? ' · скидка' : ''}</span>
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
            <span>150 дублонов за штуку</span>
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
                    <span>{each} дублонов за карту{pack.count >= 5 ? ' · скидка' : ''}</span>
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
