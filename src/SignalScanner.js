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
      <style jsx>{`
        .scanner-page {
          min-height: 100vh;
          background: var(--bg);
          color: var(--text-primary);
          padding-bottom: 80px;
        }
        .scanner-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 20px 32px;
          background: hsla(var(--bg-hsl), 0.8);
          backdrop-filter: blur(20px);
          position: sticky;
          top: 0;
          z-index: 100;
          border-bottom: 1px solid var(--glass-border);
        }
        .ai-back-btn {
          background: hsla(0,0%,100%,0.05);
          border: 1px solid var(--glass-border);
          color: var(--text-secondary);
          padding: 8px 16px;
          border-radius: var(--radius-sm);
          font-weight: 600;
          cursor: pointer;
          transition: all 0.2s;
        }
        .ai-back-btn:hover { background: hsla(0,0%,100%,0.1); color: #fff; }
        
        .scanner-title-block { display: flex; flex-direction: column; align-items: center; }
        .scanner-title { font-size: 18px; font-weight: 800; letter-spacing: -0.5px; }
        .scanner-badge { font-size: 10px; color: var(--text-muted); font-weight: 700; text-transform: uppercase; letter-spacing: 1px; }

        .scan-btn {
          background: var(--blue);
          color: #fff;
          border: none;
          padding: 10px 24px;
          border-radius: var(--radius-sm);
          font-weight: 700;
          cursor: pointer;
          box-shadow: var(--blue-glow);
          transition: all 0.2s;
        }
        .scan-btn:hover:not(:disabled) { transform: translateY(-2px); filter: brightness(1.1); }
        .scan-btn:disabled { opacity: 0.6; cursor: not-allowed; }

        .scanner-summary-card {
          margin: 32px;
          padding: 24px;
          background: hsla(var(--accent-blue), 0.05);
          border: 1px solid hsla(var(--accent-blue), 0.2);
          border-radius: var(--radius-md);
          position: relative;
        }
        .scanner-summary-text { font-size: 15px; line-height: 1.6; color: var(--text-secondary); }
        .scanner-summary-timestamp { display: block; margin-top: 12px; font-size: 10px; color: var(--text-muted); text-transform: uppercase; }

        .signal-grid {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
          gap: 20px;
          padding: 0 32px;
        }

        .signal-card {
           background: var(--bg-card);
           border-radius: var(--radius-md);
           border: 1px solid var(--glass-border);
           padding: 24px;
           cursor: pointer;
           transition: all 0.3s ease;
           position: relative;
        }
        .signal-card:hover {
          transform: translateY(-4px);
          border-color: var(--glass-border-bright);
          background: hsla(0,0%,100%,0.06);
        }
        .sc-card-symbol { font-size: 18px; font-weight: 800; color: #fff; }
        .sc-card-signal-badge {
          float: right;
          font-size: 11px;
          font-weight: 800;
          padding: 4px 10px;
          border-radius: 6px;
          text-transform: uppercase;
        }
        .sc-card-score-row { margin: 16px 0; display: flex; align-items: center; gap: 10px; }
        .sc-card-score-track { flex: 1; height: 6px; background: hsla(0,0%,100%,0.05); border-radius: 3px; }
        .sc-card-score-fill { height: 100%; border-radius: 3px; }
        .sc-card-score-num { font-size: 12px; font-weight: 700; color: var(--text-muted); }

        .sc-card-action {
          display: block;
          text-align: center;
          padding: 8px;
          border-radius: 6px;
          font-weight: 800;
          font-size: 13px;
          margin-bottom: 16px;
        }
        .sc-card-reason { font-size: 13px; color: var(--text-secondary); line-height: 1.5; }

        .sector-bias-strip {
          margin: 0 32px 32px;
          padding: 16px;
          background: hsla(0,0%,100%,0.02);
          border-radius: var(--radius-md);
          border: 1px dashed var(--glass-border);
        }
        .sector-bias-label { font-size: 11px; font-weight: 700; color: var(--text-muted); margin-bottom: 12px; display: block; }
        .sector-bias-chips { display: flex; flex-wrap: wrap; gap: 8px; }
        .sector-bias-chip { font-size: 11px; font-weight: 600; padding: 4px 12px; border-radius: 20px; }

        .sdm-backdrop {
          position: fixed; top: 0; left: 0; width: 100%; height: 100%;
          background: rgba(0,0,0,0.8); backdrop-filter: blur(8px);
          z-index: 1000; display: flex; align-items: center; justify-content: center;
        }
        .sdm-modal {
          width: 90%; max-width: 500px; background: var(--bg-soft);
          border-radius: var(--radius-lg); overflow: hidden;
          box-shadow: var(--shadow-premium);
          padding: 32px;
        }
        .sdm-header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 24px; }
        .sdm-symbol { font-size: 24px; font-weight: 800; color: #fff; display: block; }
        .sdm-price { font-size: 24px; font-weight: 800; color: #fff; display: block; text-align: right; }

        .price-levels-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; margin: 24px 0; }
        .price-level-card {
           padding: 12px; border-radius: 10px; background: hsla(0,0%,100%,0.03);
           display: flex; flex-direction: column; align-items: center;
        }
        .level-label { font-size: 10px; font-weight: 700; color: var(--text-muted); margin-bottom: 4px; }
        .level-price { font-size: 14px; font-weight: 800; color: #fff; }
      `}</style>

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
          {loading ? "SCANNING..." : hasScanned ? '↻ RESCAN' : '▶ SCAN NOW'}
        </button>
      </div>

      {/* Narrative + Timestamp */}
      {narrative && (
        <div className="scanner-summary-card">
          <p className="scanner-summary-text">{narrative}</p>
          <span className="scanner-summary-timestamp">{timestamp}</span>
        </div>
      )}

      {/* Summary Strip */}
      {stats && (
        <div className="scanner-summary-strip" style={{ padding: '0 32px', marginBottom: '24px', display: 'flex', gap: '10px' }}>
          <SummaryPill label="BULLISH" count={stats.bullish_count} color="emerald" />
          <SummaryPill label="BEARISH" count={stats.bearish_count} color="rose"   />
          <SummaryPill label="STRONG"  count={stats.strong_count}  color="blue"  />
        </div>
      )}

      {/* Sector Bias */}
      {Object.keys(sectorBiases).length > 0 && <SectorBiasStrip biases={sectorBiases} />}

      {/* Signal Scanner Body */}
      <div className="signal-scanner-body">
        {groupedSignals.map(({ label, items }) => (
          <React.Fragment key={label}>
             <div style={{ padding: '0 32px 16px', fontSize: '12px', fontWeight: '800', color: 'var(--text-muted)', letterSpacing: '1px' }}>{label} ({items.length})</div>
             <div className="signal-grid" style={{ marginBottom: '40px' }}>
               {items.map(s => <SignalCard key={s.symbol} stock={s} onClick={setDetailStock} />)}
             </div>
          </React.Fragment>
        ))}
      </div>

      <SignalDetailModal stock={detailStock} onClose={() => setDetailStock(null)} />
    </div>
  );
}

const SignalCard = memo(function SignalCard({ stock, onClick }) {
  const signalColor = stock.signal === 'BULLISH' ? 'var(--green)' : stock.signal === 'BEARISH' ? 'var(--red)' : 'var(--text-muted)';
  const actionStyles = {
    'BUY': { color: 'var(--green)', bg: 'var(--green-dim)' },
    'SELL': { color: 'var(--red)', bg: 'var(--red-dim)' },
    'WATCH BUY': { color: 'var(--blue)', bg: 'var(--blue-dim)' },
    'WATCH SELL': { color: 'var(--red)', bg: 'hsla(var(--accent-rose), 0.05)' },
    'HOLD': { color: 'var(--text-muted)', bg: 'hsla(0,0%,100%,0.04)' }
  };
  const sa = actionStyles[stock.action] || actionStyles['HOLD'];

  return (
    <div className="signal-card" onClick={() => onClick(stock)} style={{ borderTop: `3px solid ${signalColor}` }}>
      <div className="sc-card-top">
        <span className="sc-card-symbol">{stock.symbol}</span>
        <span className="sc-card-signal-badge" style={{ background: sa.bg, color: sa.color }}>{stock.signal}</span>
      </div>
      
      <div className="sc-card-score-row">
        <div className="sc-card-score-track">
           <div className="sc-card-score-fill" style={{ width: `${stock.score}%`, background: signalColor }} />
        </div>
        <span className="sc-card-score-num">{stock.score}%</span>
      </div>

      <div className="sc-card-action" style={{ color: sa.color, background: sa.bg }}>{stock.action}</div>
      <p className="sc-card-reason">{stock.reason}</p>
      
      <div style={{ marginTop: '16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ fontSize: '15px', fontWeight: '800', color: '#fff' }}>₹{stock.price.toLocaleString('en-IN')}</span>
        <span style={{ fontSize: '12px', fontWeight: '800', color: stock.change_pct >= 0 ? 'var(--green)' : 'var(--red)' }}>
          {stock.change_pct >= 0 ? '+' : ''}{stock.change_pct.toFixed(2)}%
        </span>
      </div>
    </div>
  );
});

function SignalDetailModal({ stock, onClose }) {
  if (!stock) return null;
  const accent = stock.signal === 'BULLISH' ? 'var(--green)' : stock.signal === 'BEARISH' ? 'var(--red)' : 'var(--blue)';
  return (
    <div className="sdm-backdrop" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="sdm-modal" style={{ borderTop: `4px solid ${accent}` }}>
        <div className="sdm-header">
           <div>
             <span className="sdm-symbol">{stock.symbol}</span>
             <span style={{ fontSize: '11px', color: 'var(--text-muted)', fontWeight: '700' }}>{stock.sector}</span>
           </div>
           <div>
             <span className="sdm-price">₹{stock.price.toLocaleString('en-IN')}</span>
             <span style={{ display: 'block', textAlign: 'right', fontSize: '14px', fontWeight: '800', color: stock.change_pct >= 0 ? 'var(--green)' : 'var(--red)' }}>
               {stock.change_pct >= 0 ? '+' : ''}{stock.change_pct.toFixed(2)}%
             </span>
           </div>
        </div>

        <div style={{ background: 'hsla(0,0%,100%,0.02)', padding: '20px', borderRadius: '12px', marginBottom: '24px' }}>
          <div style={{ fontSize: '10px', fontWeight: '700', color: 'var(--text-muted)', marginBottom: '8px' }}>AI ANALYSIS</div>
          <div style={{ fontSize: '20px', fontWeight: '800', color: accent }}>{stock.action} SIGNAL</div>
          <div style={{ marginTop: '12px', height: '6px', background: 'hsla(0,0%,100%,0.05)', borderRadius: '3px' }}>
             <div style={{ height: '100%', width: `${stock.score}%`, background: accent, borderRadius: '3px' }} />
          </div>
        </div>

        <div className="price-levels-grid">
           <div className="price-level-card">
              <span className="level-label">SUPPORT</span>
              <span className="level-price">₹{stock.support?.toLocaleString('en-IN') || '—'}</span>
           </div>
           <div className="price-level-card" style={{ background: 'hsla(var(--accent-emerald), 0.1)' }}>
              <span className="level-label" style={{ color: 'var(--green)' }}>TARGET</span>
              <span className="level-price" style={{ color: 'var(--green)' }}>₹{stock.target?.toLocaleString('en-IN') || '—'}</span>
           </div>
           <div className="price-level-card" style={{ background: 'hsla(var(--accent-rose), 0.1)' }}>
              <span className="level-label" style={{ color: 'var(--red)' }}>STOP LOSS</span>
              <span className="level-price" style={{ color: 'var(--red)' }}>₹{stock.stop_loss?.toLocaleString('en-IN') || '—'}</span>
           </div>
        </div>

        <div style={{ fontSize: '14px', lineHeight: '1.6', color: 'var(--text-secondary)' }}>{stock.reason}</div>
        
        <button onClick={onClose} style={{ width: '100%', marginTop: '32px', padding: '12px', borderRadius: '10px', border: '1px solid var(--glass-border)', background: 'transparent', color: '#fff', fontWeight: '700', cursor: 'pointer' }}>Close Analysis</button>
      </div>
    </div>
  );
}

function SectorBiasStrip({ biases }) {
  return (
    <div className="sector-bias-strip">
       <span className="sector-bias-label">◈ AI SECTOR BIAS SUMMARY</span>
       <div className="sector-bias-chips">
         {Object.entries(biases).map(([sector, bias]) => (
           <span key={sector} className="sector-bias-chip" style={{ 
             background: bias === 'BULLISH' ? 'var(--green-dim)' : bias === 'BEARISH' ? 'var(--red-dim)' : 'hsla(0,0%,100%,0.05)',
             color: bias === 'BULLISH' ? 'var(--green)' : bias === 'BEARISH' ? 'var(--red)' : 'var(--text-muted)',
             border: `1px solid ${bias === 'BULLISH' ? 'hsla(var(--accent-emerald), 0.2)' : bias === 'BEARISH' ? 'hsla(var(--accent-rose), 0.2)' : 'var(--glass-border)'}`
           }}>{sector}</span>
         ))}
       </div>
    </div>
  );
}

function SummaryPill({ label, count, color }) {
  return (
    <div style={{ flex: 1, padding: '16px', borderRadius: '14px', background: `var(--${color}-dim)`, border: `1px solid hsla(var(--accent-${color}), 0.2)` }}>
       <div style={{ fontSize: '24px', fontWeight: '800', color: `var(--${color})` }}>{count}</div>
       <div style={{ fontSize: '10px', fontWeight: '700', color: `var(--${color})`, letterSpacing: '1px' }}>{label}</div>
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
