import React, { useState, useEffect } from 'react';
import { formatCoins, formatCompact } from '../data/mock.js';
import { api } from '../api.js';

const TABS = ['overview', 'users', 'deposits', 'rounds', 'live', 'referrals', 'ledger', 'portals', 'economy'];
const TAB_LABELS = {
  overview: 'Overview', users: 'Users', deposits: 'Deposits',
  rounds: 'Rounds', live: 'Live', referrals: 'Рефералы',
  ledger: 'Ledger', portals: 'Portals', economy: 'Economy'
};

function useAdminFetch(tab) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState(null);

  useEffect(() => {
    if (!tab) return;
    let cancelled = false;
    setLoading(true);
    setData(null);
    setErr(null);
    const fetch = async () => {
      try {
        let res;
        if (tab === 'users')     res = await api.adminUsers();
        if (tab === 'deposits')  res = await api.adminDeposits();
        if (tab === 'rounds')    res = await api.adminRounds();
        if (tab === 'live')      res = await api.adminLiveRounds();
        if (tab === 'referrals') res = await api.adminReferrals();
        if (tab === 'ledger')    res = await api.adminLedger();
        if (tab === 'portals')   res = await api.adminPortals();
        if (tab === 'economy')   res = await api.adminEconomy();
        if (!cancelled) setData(res);
      } catch (e) {
        if (!cancelled) setErr(e.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    fetch();
    return () => { cancelled = true; };
  }, [tab]);

  return { data, loading, err };
}

export default function AdminPanel({ state, onClose, onApproveTransfer, onRejectTransfer }) {
  const [adminTab, setAdminTab] = useState('overview');
  const { data, loading, err } = useAdminFetch(adminTab !== 'overview' ? adminTab : null);

  return (
    <div className="dw-sheet-backdrop" onClick={onClose}>
      <div className="dw-admin-sheet" onClick={(e) => e.stopPropagation()}>
        <div className="dw-admin-header">
          <div>
            <span className="dw-kicker dw-kicker-admin">Admin</span>
            <h2>DEADWILL Admin</h2>
          </div>
          <button className="dw-icon-btn" onClick={onClose}>×</button>
        </div>

        <div className="dw-segment-switch" style={{ flexWrap: 'wrap', gap: 4 }}>
          {TABS.map((id) => (
            <button
              key={id}
              className={`dw-segment-chip ${adminTab === id ? 'active' : ''}`}
              onClick={() => setAdminTab(id)}
            >
              {TAB_LABELS[id]}
            </button>
          ))}
        </div>

        {adminTab === 'overview' && (
          <div className="dw-stack">
            <div className="dw-admin-stats-row">
              <div className="dw-admin-stat"><span>Rounds</span><strong>{state.player.gamesPlayed}</strong></div>
              <div className="dw-admin-stat"><span>Balance</span><strong>{formatCoins(state.player.coins)}</strong></div>
              <div className="dw-admin-stat"><span>Best win</span><strong>{formatCompact(state.player.bestWin)}</strong></div>
            </div>
            <article className="dw-panel">
              <div className="dw-panel-head"><h2>Быстрый доступ</h2></div>
              <p style={{ color: 'var(--muted)', fontSize: 13, marginTop: 8 }}>
                Выбери вкладку выше для просмотра данных.
              </p>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 12 }}>
                {['users','deposits','rounds','live','referrals','ledger','portals','economy'].map((t) => (
                  <button key={t} className="dw-btn ghost small" onClick={() => setAdminTab(t)}>
                    {TAB_LABELS[t]}
                  </button>
                ))}
              </div>
            </article>
          </div>
        )}

        {adminTab !== 'overview' && (
          <div className="dw-stack" style={{ marginTop: 12 }}>
            {loading && (
              <div className="dw-pay-loading"><div className="dw-pay-spinner" /><span>загрузка…</span></div>
            )}
            {err && (
              <p style={{ color: 'var(--crimson-glow)', textAlign: 'center', padding: '16px 0' }}>
                Ошибка: {err}
              </p>
            )}

            {/* Users */}
            {adminTab === 'users' && data && (
              <article className="dw-panel">
                <div className="dw-panel-head"><h2>Пользователи</h2><span className="dw-panel-sub">всего {data.total}</span></div>
                <div className="dw-history-list">
                  {data.users?.map((u) => (
                    <div className="dw-history-row" key={u.id}>
                      <div className="dw-history-copy">
                        <strong>{u.name}</strong>
                        <p>ID {u.id} · {u.role} · игр {u.gamesPlayed}</p>
                      </div>
                      <span style={{ color: 'var(--gold)', fontSize: 13 }}>{formatCoins(u.coins)}</span>
                    </div>
                  ))}
                </div>
              </article>
            )}

            {/* Deposits */}
            {adminTab === 'deposits' && data && (
              <article className="dw-panel">
                <div className="dw-panel-head"><h2>Депозиты</h2><span className="dw-panel-sub">всего {data.total}</span></div>
                <div className="dw-history-list">
                  {data.deposits?.map((d) => (
                    <div className="dw-history-row" key={d.id}>
                      <div className="dw-history-copy">
                        <strong>{d.method} · {d.pack_id}</strong>
                        <p>user {d.user_id} · {d.status} · {new Date(d.created_at).toLocaleDateString('ru-RU')}</p>
                      </div>
                      <span className={d.status === 'paid' ? 'pos' : 'neg'}>{formatCoins(Number(d.coins) + Number(d.bonus))}</span>
                    </div>
                  ))}
                </div>
              </article>
            )}

            {/* Rounds */}
            {adminTab === 'rounds' && data && (
              <article className="dw-panel">
                <div className="dw-panel-head"><h2>Solo Rounds</h2><span className="dw-panel-sub">всего {data.total}</span></div>
                <div className="dw-history-list">
                  {data.rounds?.map((r) => (
                    <div className="dw-history-row" key={r.id}>
                      <div className="dw-history-copy">
                        <strong>{r.mode} · {r.status}</strong>
                        <p>user {r.user_id} · entry {formatCoins(r.entry)}</p>
                      </div>
                      <span className={r.credit > 0 ? 'pos' : 'neg'}>{r.credit ? '+' + formatCoins(r.credit) : '—'}</span>
                    </div>
                  ))}
                </div>
              </article>
            )}

            {/* Live rounds */}
            {adminTab === 'live' && data && (
              <article className="dw-panel">
                <div className="dw-panel-head"><h2>Live Lobbies</h2></div>
                <div className="dw-history-list">
                  {data.lobbies?.map((l) => (
                    <div className="dw-history-row" key={l.id}>
                      <div className="dw-history-copy">
                        <strong>#{l.id?.slice(-6)} · {l.status}</strong>
                        <p>карт: {l.taken_cards}/{l.total_cards} · вход {formatCoins(l.entry_coins)}</p>
                      </div>
                      <span>{l.status === 'open' ? '🟢' : l.status === 'settled' ? '✓' : '⏳'}</span>
                    </div>
                  ))}
                </div>
              </article>
            )}

            {/* Referrals */}
            {adminTab === 'referrals' && data && (
              <>
                <article className="dw-panel">
                  <div className="dw-panel-head"><h2>Топ рефереров</h2></div>
                  <div className="dw-history-list">
                    {data.topReferrers?.map((r) => (
                      <div className="dw-history-row" key={r.user_id}>
                        <div className="dw-history-copy">
                          <strong>{r.first_name || r.username || `#${r.user_id}`}</strong>
                          <p>pending: {formatCoins(r.ref_pending)}</p>
                        </div>
                        <span className="pos">+{formatCoins(r.ref_earned)}</span>
                      </div>
                    ))}
                  </div>
                </article>
                <article className="dw-panel">
                  <div className="dw-panel-head"><h2>Последние выплаты</h2></div>
                  <div className="dw-history-list">
                    {data.payouts?.slice(0, 20).map((p) => (
                      <div className="dw-history-row" key={p.id}>
                        <div className="dw-history-copy">
                          <strong>ref {p.referrer_id} ← {p.referee_id}</strong>
                          <p>{new Date(p.created_at).toLocaleDateString('ru-RU')}</p>
                        </div>
                        <span className="pos">+{formatCoins(p.amount)}</span>
                      </div>
                    ))}
                  </div>
                </article>
              </>
            )}

            {/* Ledger */}
            {adminTab === 'ledger' && data && (
              <article className="dw-panel">
                <div className="dw-panel-head"><h2>Ledger</h2><span className="dw-panel-sub">всего {data.total}</span></div>
                <div className="dw-history-list">
                  {data.rows?.map((r) => (
                    <div className="dw-history-row" key={r.id}>
                      <div className="dw-history-copy">
                        <strong>{r.ref_type}</strong>
                        <p>user {r.user_id} · {new Date(r.created_at).toLocaleDateString('ru-RU')}</p>
                      </div>
                      <span className={r.amount >= 0 ? 'pos' : 'neg'}>{r.amount >= 0 ? '+' : ''}{formatCoins(r.amount)}</span>
                    </div>
                  ))}
                </div>
              </article>
            )}

            {/* Portals */}
            {adminTab === 'portals' && data && (
              <article className="dw-panel">
                <div className="dw-panel-head"><h2>Portals Purchases</h2></div>
                <div className="dw-history-list">
                  {data.purchases?.length === 0 && (
                    <p style={{ color: 'var(--muted)', textAlign: 'center', padding: '12px 0' }}>Покупок нет</p>
                  )}
                  {data.purchases?.map((p) => (
                    <div className="dw-history-row" key={p.id}>
                      <div className="dw-history-copy">
                        <strong>{p.gift_name}</strong>
                        <p>user {p.user_id} · {p.status} · {new Date(p.created_at).toLocaleDateString('ru-RU')}</p>
                      </div>
                      <span>{formatCoins(p.price_coins)}</span>
                    </div>
                  ))}
                </div>
              </article>
            )}

            {/* Economy */}
            {adminTab === 'economy' && data && (
              <article className="dw-panel">
                <div className="dw-panel-head"><h2>Economy Snapshot</h2></div>
                <div className="dw-history-list">
                  {[
                    ['Всего депозитов', formatCoins(data.totalDeposited)],
                    ['Всего выплачено', formatCoins(data.totalPaidOut)],
                    ['House edge', data.houseEdge],
                    ['Игроков', String(data.totalPlayers)],
                    ['Раундов', String(data.totalRounds)]
                  ].map(([label, value]) => (
                    <div className="dw-history-row" key={label}>
                      <div className="dw-history-copy"><strong>{label}</strong></div>
                      <span style={{ color: 'var(--gold)' }}>{value}</span>
                    </div>
                  ))}
                </div>
              </article>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
