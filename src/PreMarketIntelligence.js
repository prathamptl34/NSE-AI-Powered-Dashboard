import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';

// ─── IST Helpers ─────────────────────────────────────────────────────────────

function getNowIST() {
  const now = new Date();
  // Shift to IST (UTC+5:30)
  return new Date(now.getTime() + (5 * 60 + 30) * 60000);
}

function isInISTWindow(startH, startM, endH, endM) {
  const ist = getNowIST();
  const totalMins = ist.getUTCHours() * 60 + ist.getUTCMinutes();
  const start = startH * 60 + startM;
  const end   = endH   * 60 + endM;
  return totalMins >= start && totalMins <= end;
}

function isPreMarketActive()  { return isInISTWindow(9,  0,  9, 15); }
function isMarketHoursActive() { return isInISTWindow(9, 15, 15, 30); }

// ─── API Base ─────────────────────────────────────────────────────────────────

function getBase() {
  return window.location.port === '3000' ? 'http://127.0.0.1:8001' : '';
}

// ─── Web Audio Ping ───────────────────────────────────────────────────────────

function playSpikePing() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.frequency.value = 880;
    gain.gain.setValueAtTime(0.15, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.25);
    osc.start();
    osc.stop(ctx.currentTime + 0.25);
  } catch (e) {
    // AudioContext blocked or unsupported — fail silently
  }
}

// ─── Formatting helpers ────────────────────────────────────────────────────────

function fmtPct(n) {
  if (n == null) return '—';
  const sign = n >= 0 ? '+' : '';
  return `${sign}${Number(n).toFixed(2)}%`;
}

function fmtINR(n) {
  if (n == null) return '—';
  return '₹' + Number(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtVol(n) {
  if (n == null || n === 0) return '—';
  if (n >= 10000000) return `${(n / 10000000).toFixed(1)}Cr`;
  if (n >= 100000)   return `${(n / 100000).toFixed(1)}L`;
  if (n >= 1000)     return `${(n / 1000).toFixed(1)}K`;
  return String(n);
}

// ═══════════════════════════════════════════════════════════════════════════════
// WIDGET 1 — Gap Scanner
// ═══════════════════════════════════════════════════════════════════════════════

const GapRow = React.memo(function GapRow({ item, rank }) {
  const isUp = item.direction === 'up';
  return (
    <tr className={`gap-row ${isUp ? 'gap-row-up' : 'gap-row-down'}`}>
      <td className="gap-td gap-td-rank">#{rank}</td>
      <td className="gap-td gap-td-symbol">{item.symbol}</td>
      <td className="gap-td gap-td-num">{fmtINR(item.prev_close)}</td>
      <td className="gap-td gap-td-num">{fmtINR(item.today_open)}</td>
      <td className="gap-td gap-td-pct">
        <span className={`gap-pct-badge ${isUp ? 'gap-up' : 'gap-down'}`}>
          {isUp ? '▲' : '▼'} {Math.abs(item.gap_pct).toFixed(2)}%
        </span>
      </td>
    </tr>
  );
});

function GapScanner() {
  const [data,       setData]       = useState([]);
  const [loading,    setLoading]    = useState(true);
  const [filter,     setFilter]     = useState('all');
  const [lastUpdate, setLastUpdate] = useState(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`${getBase()}/api/gaps`);
      if (!res.ok) return;
      const json = await res.json();
      if (json.gaps) {
        setData(json.gaps);
        setLastUpdate(new Date().toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata' }));
      }
    } catch (e) {
      // silent
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    const id = setInterval(load, 60000);
    return () => clearInterval(id);
  }, [load]);

  const filtered = useMemo(() => {
    if (filter === 'all')  return data;
    if (filter === 'up')   return data.filter(d => d.direction === 'up');
    if (filter === 'down') return data.filter(d => d.direction === 'down');
    if (filter === 'gt2')  return data.filter(d => Math.abs(d.gap_pct) >= 2);
    if (filter === 'gt5')  return data.filter(d => Math.abs(d.gap_pct) >= 5);
    return data;
  }, [data, filter]);

  const FILTERS = [
    { key: 'all',  label: 'All' },
    { key: 'up',   label: '▲ Gap Up' },
    { key: 'down', label: '▼ Gap Down' },
    { key: 'gt2',  label: '>2%' },
    { key: 'gt5',  label: '>5%' },
  ];

  return (
    <div className="premarket-widget">
      <div className="pm-widget-header">
        <span className="pm-widget-icon">📊</span>
        <div>
          <div className="pm-widget-title">Gap Scanner</div>
          <div className="pm-widget-sub">Overnight gap analysis · Nifty 100 + Midcap 100</div>
        </div>
        {lastUpdate && <span className="pm-widget-ts">{lastUpdate}</span>}
      </div>

      <div className="pm-filter-bar">
        {FILTERS.map(f => (
          <button
            key={f.key}
            className={`pm-filter-btn ${filter === f.key ? 'active' : ''}`}
            onClick={() => setFilter(f.key)}
          >
            {f.label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="pm-loading-state">
          <div className="pm-spinner" />
          <span>Loading gap data...</span>
        </div>
      ) : filtered.length === 0 ? (
        <div className="market-closed-placeholder">
          <span className="pm-empty-icon">📭</span>
          <p>No gaps found for current filter</p>
        </div>
      ) : (
        <div className="gap-table-wrapper">
          <table className="gap-table">
            <thead>
              <tr>
                <th>#</th>
                <th>SYMBOL</th>
                <th>PREV CLOSE</th>
                <th>TODAY OPEN</th>
                <th>GAP %</th>
              </tr>
            </thead>
            <tbody>
              {filtered.slice(0, 30).map((item, i) => (
                <GapRow key={item.symbol} item={item} rank={i + 1} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// WIDGET 2 — Pre-Market Volume
// ═══════════════════════════════════════════════════════════════════════════════

function PremarketVolume() {
  const [data,    setData]    = useState(null);
  const [loading, setLoading] = useState(true);
  const active = isPreMarketActive();

  const load = useCallback(async () => {
    if (!active) { setLoading(false); return; }
    try {
      const res = await fetch(`${getBase()}/api/premarket-volume`);
      if (!res.ok) return;
      const json = await res.json();
      setData(json);
    } catch (e) {
      // silent
    } finally {
      setLoading(false);
    }
  }, [active]);

  useEffect(() => {
    load();
    const id = setInterval(load, 15000);
    return () => clearInterval(id);
  }, [load]);

  return (
    <div className="premarket-widget">
      <div className="pm-widget-header">
        <span className="pm-widget-icon">⚡</span>
        <div>
          <div className="pm-widget-title">Pre-Market Volume</div>
          <div className="pm-widget-sub">Volume surges · 09:00–09:15 IST</div>
        </div>
        {active && <span className="pm-live-badge">● LIVE</span>}
      </div>

      {!active ? (
        <div className="market-closed-placeholder">
          <span className="pm-empty-icon">🕰️</span>
          <p>Pre-market session inactive</p>
          <span className="pm-empty-sub">Active daily 09:00–09:15 IST</span>
        </div>
      ) : loading ? (
        <div className="pm-loading-state">
          <div className="pm-spinner" />
          <span>Scanning pre-market volume...</span>
        </div>
      ) : !data || !data.active ? (
        <div className="market-closed-placeholder">
          <span className="pm-empty-icon">📭</span>
          <p>{data?.message || 'No pre-market data available'}</p>
        </div>
      ) : data.stocks.length === 0 ? (
        <div className="market-closed-placeholder">
          <span className="pm-empty-icon">🔍</span>
          <p>No volume surges detected yet</p>
          <span className="pm-empty-sub">Threshold: today vol ≥ 3× 5-day avg</span>
        </div>
      ) : (
        <div className="pm-vol-grid">
          {data.stocks.map(s => (
            <div key={s.symbol} className="pm-vol-card">
              <div className="pm-vol-symbol">{s.symbol}</div>
              <div className="pm-vol-row">
                <span className="pm-vol-label">Today</span>
                <span className="pm-vol-value">{fmtVol(s.today_vol)}</span>
              </div>
              <div className="pm-vol-row">
                <span className="pm-vol-label">5D Avg</span>
                <span className="pm-vol-value">{fmtVol(s.avg_vol)}</span>
              </div>
              {s.multiplier != null && (
                <span className="multiplier-badge">{s.multiplier}×</span>
              )}
              <div className={`pm-vol-chg ${s.price_change_pct >= 0 ? 'gap-up' : 'gap-down'}`}>
                {fmtPct(s.price_change_pct)}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// WIDGET 3 — Sector Momentum
// ═══════════════════════════════════════════════════════════════════════════════

function SectorMomentum() {
  const [sectors, setSectors] = useState([]);
  const [loading, setLoading] = useState(true);
  const [ts,      setTs]      = useState(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`${getBase()}/api/sector-momentum`);
      if (!res.ok) return;
      const json = await res.json();
      if (json.sectors) {
        setSectors(json.sectors);
        setTs(json.timestamp);
      }
    } catch (e) {
      // silent
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    const id = setInterval(load, 30000);
    return () => clearInterval(id);
  }, [load]);

  const maxScore = useMemo(() =>
    sectors.length ? Math.max(...sectors.map(s => Math.abs(s.score))) || 1 : 1,
  [sectors]);

  return (
    <div className="premarket-widget">
      <div className="pm-widget-header">
        <span className="pm-widget-icon">🔥</span>
        <div>
          <div className="pm-widget-title">Sector Momentum</div>
          <div className="pm-widget-sub">Live sector leaderboard · refreshes every 30s</div>
        </div>
        {ts && <span className="pm-widget-ts">{ts}</span>}
      </div>

      {loading ? (
        <div className="pm-loading-state">
          <div className="pm-spinner" />
          <span>Computing sector momentum...</span>
        </div>
      ) : sectors.length === 0 ? (
        <div className="market-closed-placeholder">
          <span className="pm-empty-icon">📡</span>
          <p>Waiting for live tick data...</p>
        </div>
      ) : (
        <div className="sector-leaderboard">
          {sectors.map((s, i) => {
            const barWidth = Math.min(100, (Math.abs(s.score) / maxScore) * 100);
            const isPos = s.direction === 'up';
            return (
              <div key={s.sector_name} className="sector-row">
                <span className="sector-rank">#{i + 1}</span>
                <div className="sector-info">
                  <div className="sector-name-row">
                    <span className="sector-name">{s.sector_name.replace('NIFTY ', '')}</span>
                    {s.top_mover_symbol && (
                      <span className={`sector-mover-chip ${isPos ? 'chip-up' : 'chip-down'}`}>
                        {s.top_mover_symbol} {fmtPct(s.top_mover_pct)}
                      </span>
                    )}
                  </div>
                  <div className="sector-bar-track">
                    <div
                      className={`sector-bar ${isPos ? 'sector-bar-pos' : 'sector-bar-neg'}`}
                      style={{ width: `${barWidth}%` }}
                    />
                  </div>
                </div>
                <span className={`sector-score ${isPos ? 'gap-up' : 'gap-down'}`}>
                  {fmtPct(s.score)}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// WIDGET 4 — Volume Spike Detector (SSE)
// ═══════════════════════════════════════════════════════════════════════════════

const MAX_SPIKE_AGE_MS = 15 * 60 * 1000; // 15 minutes

function VolumeSpikeDetector() {
  const [spikes,    setSpikes]    = useState([]);
  const [streaming, setStreaming] = useState(false);
  const sseRef   = useRef(null);
  const timerRef = useRef(null);
  const active   = isMarketHoursActive();

  // Prune spikes older than 15 minutes
  useEffect(() => {
    const prune = setInterval(() => {
      const cutoff = Date.now() - MAX_SPIKE_AGE_MS;
      setSpikes(prev => prev.filter(s => s._receivedAt > cutoff));
    }, 60000);
    return () => clearInterval(prune);
  }, []);

  // SSE connection — exact same pattern as Heatmap.js
  useEffect(() => {
    if (!active) return;

    function connect() {
      const base = getBase();
      const es = new EventSource(`${base}/api/volume-spikes`);
      sseRef.current = es;

      es.onopen = () => setStreaming(true);

      es.onmessage = (e) => {
        try {
          const data = JSON.parse(e.data);
          if (data.type === 'spike') {
            playSpikePing();
            setSpikes(prev => [
              { ...data, _receivedAt: Date.now(), _id: `${data.symbol}-${data.slot}-${Date.now()}` },
              ...prev.slice(0, 49), // keep last 50
            ]);
          }
        } catch {}
      };

      es.onerror = () => {
        setStreaming(false);
        es.close();
        timerRef.current = setTimeout(connect, 3000);
      };
    }

    connect();

    return () => {
      clearTimeout(timerRef.current);
      if (sseRef.current) { sseRef.current.close(); sseRef.current = null; }
      setStreaming(false);
    };
  }, [active]);

  const dismiss = useCallback((id) => {
    setSpikes(prev => prev.filter(s => s._id !== id));
  }, []);

  return (
    <div className="premarket-widget">
      <div className="pm-widget-header">
        <span className="pm-widget-icon">🔔</span>
        <div>
          <div className="pm-widget-title">Volume Spike Detector</div>
          <div className="pm-widget-sub">5-min candle volume ≥ 2× historical avg · 09:15–15:30 IST</div>
        </div>
        {active && (
          <span className={`pm-live-badge ${streaming ? '' : 'pm-live-badge-offline'}`}>
            {streaming ? '● LIVE' : '○ CONNECTING'}
          </span>
        )}
      </div>

      {!active ? (
        <div className="market-closed-placeholder">
          <span className="pm-empty-icon">🔒</span>
          <p>Market closed</p>
          <span className="pm-empty-sub">Active 09:15–15:30 IST</span>
        </div>
      ) : spikes.length === 0 ? (
        <div className="market-closed-placeholder">
          <span className="pm-empty-icon">👁️</span>
          <p>Monitoring for volume spikes...</p>
          <span className="pm-empty-sub">Spike alerts will appear here in real-time</span>
        </div>
      ) : (
        <div className="spike-list">
          {spikes.map(s => {
            const ageMs = Date.now() - s._receivedAt;
            const ageMins = Math.floor(ageMs / 60000);
            const isPos = s.price_change_pct >= 0;
            return (
              <div key={s._id} className="spike-card spike-card-enter">
                <div className="spike-header">
                  <span className="spike-symbol">{s.symbol}</span>
                  <span className="multiplier-badge">{s.multiplier}×</span>
                  <button className="spike-dismiss" onClick={() => dismiss(s._id)} aria-label="Dismiss">×</button>
                </div>
                <div className="spike-body">
                  <div className="spike-stat">
                    <span className="spike-stat-label">Current Vol</span>
                    <span className="spike-stat-val">{fmtVol(s.current_vol)}</span>
                  </div>
                  <div className="spike-stat">
                    <span className="spike-stat-label">Hist Avg</span>
                    <span className="spike-stat-val">{fmtVol(s.avg_vol)}</span>
                  </div>
                  <div className="spike-stat">
                    <span className="spike-stat-label">Price</span>
                    <span className={`spike-stat-val ${isPos ? 'gap-up' : 'gap-down'}`}>
                      {fmtPct(s.price_change_pct)}
                    </span>
                  </div>
                  <div className="spike-stat">
                    <span className="spike-stat-label">Slot</span>
                    <span className="spike-stat-val">{s.slot}</span>
                  </div>
                </div>
                <div className="spike-footer">
                  {ageMins < 1 ? 'Just now' : `${ageMins}m ago`}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN EXPORT — PreMarketIntelligence
// ═══════════════════════════════════════════════════════════════════════════════

export default function PreMarketIntelligence() {
  return (
    <div className="premarket-section">
      <GapScanner />
      <PremarketVolume />
      <SectorMomentum />
      <VolumeSpikeDetector />
    </div>
  );
}
