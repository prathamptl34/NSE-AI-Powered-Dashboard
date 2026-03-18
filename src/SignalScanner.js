import React, { useState, useEffect, useMemo, memo } from "react";
import { StockDeepDiveModal } from './StockDeepDive';

const FILTERS = ["ALL", "BULLISH", "BEARISH", "NEUTRAL", "STRONG", "F&O"];

export default function SignalScanner({ onBack }) {
  const [signals,   setSignals]   = useState([]);
  const [stats,     setStats]     = useState(null);
  const [narrative, setNarrative] = useState("");
  const [timestamp, setTimestamp] = useState("");
  const [loading,   setLoading]   = useState(false);
  const [filter,    setFilter]    = useState("ALL");
  const [error,     setError]     = useState(null);
  const [hasScanned, setHasScanned] = useState(false);
  const [search, setSearch] = useState('');
  const [detailStock, setDetailStock] = useState(null);
  const [sectorBiases, setSectorBiases] = useState({});
  const [marketClosed, setMarketClosed] = useState(false);
  const [cacheStatus, setCacheStatus] = useState({ ready: true, progress_pct: 100 });

  useEffect(() => {
    const timer = setTimeout(() => {
      handleScan();
    }, 300);
    
    // Poll cache status every 10s (Phase 4)
    const statusInterval = setInterval(async () => {
      try {
        const res = await fetch("/api/cache-status");
        const data = await res.json();
        setCacheStatus(data);
      } catch (e) {}
    }, 10000);

    return () => {
      clearTimeout(timer);
      clearInterval(statusInterval);
    };
  }, []); 

  const handleScan = async () => {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 35000); // 35s timeout
    
    setLoading(true);
    setHasScanned(true);
    setError(null);
    try {
      const res  = await fetch("/api/signal-scanner", { signal: controller.signal });
      const data = await res.json();
      
      if (data.error) { 
        setError(data.error); 
        return; 
      }
      
      if (!data.signals || data.signals.length === 0) {
        setError("No signal data available. Market may be closed or WebSocket connecting.");
        setSignals([]);
      } else {
        setSignals(data.signals || []);
        setStats(data.stats || {});
        setSectorBiases(data.sector_biases || {});
        setMarketClosed(data.market_closed || false);
        setNarrative(data.narrative || "");
        setTimestamp(data.timestamp || "");
      }
    } catch (e) {
      if (e.name === 'AbortError') {
        setError("Scan timed out (server took too long). Please try again.");
      } else {
        setError("Failed to connect to server or parse response.");
      }
      setSignals([]);
    } finally {
      setLoading(false);
      clearTimeout(timeoutId);
    }
  };

  const filtered = useMemo(() => {
    let result = signals;

    // Signal filter
    if (filter === "STRONG") {
      result = result.filter(s => s.score >= 75 || s.score <= 25);
    } else if (filter === "F&O") {
      result = result.filter(s => s.is_fno === true);
    } else if (filter !== "ALL") {
      result = result.filter(s => s.signal === filter);
    }

    // Search filter
    if (search.trim()) {
      const q = search.trim().toUpperCase();
      result = result.filter(s => s.symbol?.toUpperCase().includes(q));
    }

    return result;
  }, [signals, filter, search]);

  // Group signals
  const groupedSignals = useMemo(() => {
    const groups = {
      BULLISH: { label: '▲ BULLISH', className: 'signal-group-bull', items: [] },
      NEUTRAL: { label: '● NEUTRAL', className: 'signal-group-neutral', items: [] },
      BEARISH: { label: '▼ BEARISH', className: 'signal-group-bear', items: [] },
    };

    filtered.forEach(s => {
      if (groups[s.signal]) {
        groups[s.signal].items.push(s);
      }
    });

    return Object.values(groups).filter(group => group.items.length > 0);
  }, [filtered]);

  return (
    <div className="scanner-page">

      {/* Header */}
      <div className="scanner-header">
        <button className="ai-back-btn" onClick={onBack}>← Dashboard</button>
        <div className="scanner-title-block">
          <span className="scanner-title">AI SIGNAL SCANNER</span>
          <span className="scanner-badge">200 STOCKS</span>
        </div>
        <button
          className={`scan-btn ${loading ? "scan-btn-loading" : ""}`}
          onClick={handleScan}
          disabled={loading}
        >
          {loading ? (
            <><span className="scan-spinner" /> SCANNING ALL 200...</>
          ) : (
            <>{hasScanned ? '↻ RESCAN' : '▶ SCANNING...'}</>
          )}
        </button>
      </div>

      {/* Technical Cache Status Banner (Phase 4) */}
      {!cacheStatus.ready && (
        <div className="cache-status-banner">
          <div className="cache-status-info">
            <span className="spinner-small" style={{ borderTopColor: '#f59e0b' }} />
            <span>AI Technical Cache: <strong>{cacheStatus.progress_pct}%</strong> Loaded</span>
          </div>
          <div className="cache-status-progress">
            <div className="cache-status-fill" style={{ width: `${cacheStatus.progress_pct}%` }} />
          </div>
        </div>
      )}

      {/* Narrative + Timestamp */}
      {narrative && (
        <div className="scanner-summary-card">
          <p className="scanner-summary-text">{narrative}</p>
          <span className="scanner-summary-timestamp">{timestamp}</span>
        </div>
      )}

      {/* Summary Strip */}
      {stats && (
        <div className="scanner-summary-strip">
          <SummaryPill label="BULLISH" count={stats.bullish_count} color="green" />
          <SummaryPill label="BEARISH" count={stats.bearish_count} color="red"   />
          <SummaryPill label="NEUTRAL" count={stats.neutral_count} color="gray"  />
          <SummaryPill label="STRONG"  count={stats.strong_count}  color="blue"  />
          <span className="strip-bias" data-bias={stats.market_bias}>
            Market: {stats.market_bias}
          </span>
        </div>
      )}

      {/* Filter Bar */}
      {signals.length > 0 && (
        <div className="sc-filter-bar">
          <div className="sc-filter-buttons">
            {FILTERS.map(f => (
              <button
                key={f}
                className={`sc-filter-btn ${filter === f ? "sc-filter-active" : ""} ${f === 'BULLISH' ? 'sc-filter-bull' : f === 'BEARISH' ? 'sc-filter-bear' : ''}`}
                onClick={() => setFilter(f)}
              >
                {f} 
                <span className="sc-filter-count">
                  {f !== "ALL" && f !== "STRONG" && f !== "F&O"
                    ? `(${signals.filter(s => s.signal === f).length})`
                    : f === "STRONG"
                    ? `(${signals.filter(s => s.score >= 75 || s.score <= 25).length})`
                    : f === "F&O"
                    ? `(${signals.filter(s => s.is_fno).length})`
                    : `(${signals.length})`
                  }
                </span>
              </button>
            ))}
          </div>

          <div className="sc-search-box">
            <span className="sc-search-icon">🔍</span>
            <input
              className="sc-search-input"
              type="text"
              placeholder="Search symbol..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              autoComplete="off"
            />
            {search && (
              <button className="sc-search-clear" onClick={() => setSearch('')}>✕</button>
            )}
          </div>
        </div>
      )}

      <MarketStatusBanner signals={signals} />
      {marketClosed && <SectorBiasStrip biases={sectorBiases} />}

      {/* Error */}
      {error && (
        <div className="scanner-error-state">
          <p>⚠️ {error}</p>
          <button className="btn-rescan" onClick={handleScan}>
            ↻ Try Again
          </button>
        </div>
      )}

      {/* Empty state */}
      {!loading && signals.length === 0 && !error && (
        <div className="scanner-empty-state">
          <p>No signals loaded yet.</p>
          <button className="btn-rescan" onClick={handleScan}>
            ↻ Scan Now
          </button>
        </div>
      )}

      {/* Signal Scanner Body with Grouped Headers */}
      <div className="signal-scanner-body">
        {groupedSignals.map(({ label, className, items }) => (
          <React.Fragment key={label}>
            <div className={`signal-group-header ${className}`}>
              <span>{label} <span>{items.length} stocks</span></span>
            </div>
            <div className="signal-grid">
              {items.map(s => <SignalCard key={s.symbol} stock={s} onClick={setDetailStock} />)}
            </div>
          </React.Fragment>
        ))}
      </div>

      {/* Disclaimer */}
      <div className="scanner-disclaimer">
        ⚠️ Algorithmic signals for informational purposes only.
        Not SEBI registered investment advice. Do your own research.
      </div>

      <SignalDetailModal
        stock={detailStock}
        onClose={() => setDetailStock(null)}
      />

    </div>
  );
}

/* ── Sub-components ── */

// Add SectorBiasStrip component:
function SectorBiasStrip({ biases }) {
  if (!biases || Object.keys(biases).length === 0) return null;

  const colorMap = {
    BULLISH: { bg: '#f0fdf4', color: '#16a34a', border: '#bbf7d0' },
    NEUTRAL: { bg: '#f9fafb', color: '#6b7280', border: '#e5e7eb' },
    BEARISH: { bg: '#fef2f2', color: '#dc2626', border: '#fecaca' },
  };

  return (
    <div className="sector-bias-strip">
      <span className="sector-bias-label">◈ AI SECTOR BIAS</span>
      <div className="sector-bias-chips">
        {Object.entries(biases).filter(([s]) => s !== 'DIVERSIFIED').map(([sector, bias]) => {
          const c = colorMap[bias] || colorMap.NEUTRAL;
          return (
            <span
              key={sector}
              className="sector-bias-chip"
              style={{ background: c.bg, color: c.color, border: `1px solid ${c.border}` }}
            >
              {sector}
            </span>
          );
        })}
      </div>
    </div>
  );
}

const SignalCard = memo(function SignalCard({ stock, onClick }) {
  const getSignalConfig = (signal) => {
    switch (signal) {
      case 'BULLISH': return { icon: '▲', color: '#16a34a', badge: '#f0fdf4', badgeText: '#16a34a' };
      case 'BEARISH': return { icon: '▼', color: '#dc2626', badge: '#fef2f2', badgeText: '#dc2626' };
      default:        return { icon: '◈', color: '#6b7280', badge: '#f9fafb', badgeText: '#6b7280' };
    }
  };

  const sc = getSignalConfig(stock.signal);
  const isUp   = stock.change_pct > 0;
  const isDown = stock.change_pct < 0;
  const changeColor = isUp ? 'sc-up' : isDown ? 'sc-down' : 'sc-flat';

  const actionConfig = {
    'BUY':        { color: '#15803d', bg: '#dcfce7', label: '● BUY' },
    'WATCH BUY':  { color: '#16a34a', bg: '#f0fdf4', label: '↑ WATCH BUY' },
    'HOLD':       { color: '#6b7280', bg: '#f3f4f6', label: '→ HOLD' },
    'WATCH SELL': { color: '#dc2626', bg: '#fef2f2', label: '↓ WATCH SELL' },
    'SELL':       { color: '#991b1b', bg: '#fee2e2', label: '● SELL' },
  };

  const ac  = actionConfig[stock.action] || actionConfig['HOLD'];

  return (
    <div
      className="signal-card"
      style={{ borderTop: `3px solid ${sc.color}` }}
      onClick={() => onClick(stock)}
    >
      {/* Top row */}
      <div className="sc-card-top">
        <div>
          <span className="sc-card-symbol">{stock.symbol}</span>
          {stock.sector && stock.sector !== 'DIVERSIFIED' && (
            <span className="sc-card-sector">{stock.sector}</span>
          )}
          {stock.is_fno && <span className="fno-badge">F&O</span>}
        </div>
        <span className="sc-card-signal-badge" style={{ background: sc.badge, color: sc.badgeText }}>
          {sc.icon} {stock.signal}
        </span>
      </div>

      {/* Score bar */}
      <div className="sc-card-score-row">
        <div className="sc-card-score-track">
          <div
            className="sc-card-score-fill"
            style={{
              width: `${stock.score}%`,
              background: stock.signal === 'BULLISH' ? '#16a34a'
                        : stock.signal === 'BEARISH' ? '#dc2626'
                        : '#d97706'
            }}
          />
        </div>
        <span className="sc-card-score-num">{stock.score}</span>
      </div>

      {/* Price row */}
      <div className="sc-card-price-row">
        <span className="sc-card-price">₹{formatINR(stock.price)}</span>
        <span className={`sc-card-change ${isUp ? 'sc-up' : isDown ? 'sc-down' : 'sc-flat'}`}>
          {isUp ? '▲' : isDown ? '▼' : '●'} {Math.abs(stock.change_pct || 0).toFixed(2)}%
        </span>
      </div>

      {/* Action label */}
      <div className="sc-card-action" style={{ color: ac.color, background: ac.bg }}>
        {ac.label}
      </div>

      {/* Reason */}
      <p className="sc-card-reason">{stock.reason}</p>

      {/* Volume */}
      {stock.vol_ratio >= 1.5 && stock.vol_ratio <= 50 && (
        <span className="sc-card-vol">🔥 {stock.vol_ratio.toFixed(1)}x vol</span>
      )}
    </div>
  );
});

function SignalDetailModal({ stock, onClose }) {
  if (!stock) return null;

  const isUp   = stock.change_pct >= 0;
  const isBuy  = stock.action === 'BUY' || stock.action === 'WATCH BUY';
  const isSell = stock.action === 'SELL' || stock.action === 'WATCH SELL';

  const accentColor = isBuy  ? '#16a34a'
                    : isSell ? '#dc2626'
                    : '#6b7280';

  const handleBackdrop = (e) => {
    if (e.target === e.currentTarget) onClose();
  };

  return (
    <div className="sdm-backdrop" onClick={handleBackdrop}>
      <div className="sdm-modal" style={{ borderTop: `4px solid ${accentColor}` }}>
        <div className="modal-drag-handle" />

        {/* Header */}
        <div className="sdm-header">
          <div className="sdm-header-left">
            <span className="sdm-symbol">{stock.symbol}</span>
            <span className="sdm-exchange">NSE</span>
          </div>
          <div className="sdm-header-right">
            <span className="sdm-price">₹{formatINR(stock.price)}</span>
            <span className={`sdm-change ${isUp ? 'sc-up' : 'sc-down'}`}>
              {isUp ? '+' : ''}{(stock.change_pct || 0).toFixed(2)}%
            </span>
          </div>
          <button className="sdm-close" onClick={onClose}>✕</button>
        </div>

        {/* Main Signal Card */}
        <div className="sdm-signal-section" style={{ background: isBuy ? '#f0fdf4' : isSell ? '#fef2f2' : '#f9fafb' }}>
          <div className="sdm-signal-label">AI SIGNAL</div>
          <div className="sdm-signal-action" style={{ color: accentColor }}>
            {stock.action === 'BUY'        ? '● STRONG BUY'   :
             stock.action === 'WATCH BUY'  ? '↑ WATCH TO BUY' :
             stock.action === 'SELL'       ? '● STRONG SELL'  :
             stock.action === 'WATCH SELL' ? '↓ WATCH TO SELL':
             '→ HOLD — No Clear Signal'}
          </div>

          {/* Confidence bar */}
          <div className="sdm-confidence-row">
            <span className="sdm-conf-label">SIGNAL CONFIDENCE</span>
            <div className="sdm-conf-bar">
              <div className="sdm-conf-fill" style={{ width: `${stock.score}%`, background: accentColor }} />
            </div>
            <span className="sdm-conf-num" style={{ color: accentColor }}>{stock.score}%</span>
          </div>
        </div>

        {/* Price Levels Grid */}
        <div className="price-levels-grid">
          <div className="price-level-card entry">
            <span className="level-label">ENTRY</span>
            <span className="level-price">₹{stock.entry_price?.toLocaleString('en-IN') ?? stock.support?.toLocaleString('en-IN')}</span>
          </div>
          <div className="price-level-card target">
            <span className="level-label">TARGET</span>
            <span className="level-price">₹{stock.exit_price?.toLocaleString('en-IN') ?? stock.target?.toLocaleString('en-IN')}</span>
            <span className="level-note">+{stock.reward_pct ?? stock.target_upside_pct}%</span>
          </div>
          <div className="price-level-card stoploss">
            <span className="level-label">STOP LOSS</span>
            <span className="level-price">₹{stock.stop_loss?.toLocaleString('en-IN')}</span>
            <span className="level-note">-{stock.risk_pct}%</span>
          </div>
        </div>

        {/* Risk:Reward ratio */}
        <div className="rr-ratio-bar">
          <span className="rr-label">Risk : Reward</span>
          <span className="rr-value">1 : {stock.rr_ratio}</span>
        </div>

        {/* Key Levels */}
        {stock.key_levels && stock.price > 0 && (
          <div className="sdm-levels">
            <div className="sdm-section-label">KEY PRICE LEVELS</div>
            <div className="sdm-levels-grid">
              <div className="sdm-level sdm-level-support">
                <span className="sdm-level-name">Support</span>
                <span className="sdm-level-price">₹{formatINR(stock.key_levels.support)}</span>
              </div>
              <div className="sdm-level sdm-level-target">
                <span className="sdm-level-name">Target</span>
                <span className="sdm-level-price">₹{formatINR(stock.key_levels.target)}</span>
              </div>
              <div className="sdm-level sdm-level-sl">
                <span className="sdm-level-name">Stop Loss</span>
                <span className="sdm-level-price">₹{formatINR(stock.key_levels.stop_loss)}</span>
              </div>
            </div>
          </div>
        )}

        {/* Reasoning */}
        <div className="sdm-reasoning">
          <div className="sdm-section-label">SIGNAL REASONING</div>
          <p className="sdm-reason-text">{stock.reason}</p>
          {stock.ai_note && (
            <div className="sdm-ai-note">
              <span className="sdm-ai-icon">◈</span>
              <p>{stock.ai_note}</p>
            </div>
          )}
        </div>

        {/* Disclaimer */}
        <div className="sdm-disclaimer">
          ⚠️ Algorithmic signal. Not SEBI registered investment advice. Do your own research.
        </div>
      </div>
    </div>
  );
}

function ScoreBar({ score, signal }) {
  const color = signal === "BULLISH" ? "#16a34a"
              : signal === "BEARISH" ? "#dc2626"
              : "#d97706";
  return (
    <div className="score-bar-track">
      <div
        className="score-bar-fill"
        style={{ width: `${score}%`, background: color }}
      />
    </div>
  );
}

function SummaryPill({ label, count, color }) {
  return (
    <div className={`summary-pill summary-pill-${color}`}>
      <span className="sp-count">{count}</span>
      <span className="sp-label">{label}</span>
    </div>
  );
}

function MarketStatusBanner({ signals = [] }) {
  const now   = new Date();
  const ist   = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
  const hour  = ist.getHours();
  const min   = ist.getMinutes();
  const total = hour * 60 + min;

  // Market hours: 9:15 AM (555) to 3:30 PM (930)
  const isOpen    = total >= 555 && total <= 930;
  const isPreMkt  = total >= 480 && total < 555;  // 8:00–9:15 AM
  const allNeutral = signals.length > 0 &&
    signals.filter(s => s.signal === 'NEUTRAL').length === signals.length;

  if (isOpen && !allNeutral) return null;

  if (!isOpen) {
    return (
      <div className="market-status-banner market-status-closed">
        🌙 <strong>Market Closed</strong> — Showing last known prices.
        Signals will update live when market opens at <strong>9:15 AM IST</strong>.
      </div>
    );
  }

  if (isPreMkt) {
    return (
      <div className="market-status-banner market-status-premarket">
        ⏳ <strong>Pre-Market</strong> — Market opens at 9:15 AM IST.
        Signals will activate at open.
      </div>
    );
  }

  if (allNeutral) {
    return (
      <div className="market-status-banner market-status-early">
        📊 <strong>Early Session</strong> — Signals sharpen after 10:30 AM
        as momentum and volume data build.
      </div>
    );
  }

  return null;
}

function formatINR(num) {
  if (!num) return "—";
  return Number(num).toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}
