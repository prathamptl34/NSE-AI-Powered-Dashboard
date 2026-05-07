import React, { useState, useEffect, useMemo } from 'react';

// ── Components ───────────────────────────────────────────────────────────────

function FearGreedGauge({ score }) {
  const clampedScore = Math.max(0, Math.min(100, score || 50));

  const getConfig = (s) => {
    if (s >= 75) return { label: 'EXTREME GREED', color: '#15803d', bg: '#f0fdf4' };
    if (s >= 60) return { label: 'GREED',         color: '#16a34a', bg: '#f0fdf4' };
    if (s >= 45) return { label: 'NEUTRAL',        color: '#d97706', bg: '#fffbeb' };
    if (s >= 25) return { label: 'FEAR',           color: '#ea580c', bg: '#fff7ed' };
    return              { label: 'EXTREME FEAR',   color: '#dc2626', bg: '#fef2f2' };
  };

  const { label, color, bg } = getConfig(clampedScore);
  const needleDeg = -90 + (clampedScore / 100) * 180;

  // Arc helper
  const arc = (cx, cy, r, startDeg, endDeg) => {
    const toRad  = (d) => (d * Math.PI) / 180;
    const sx = cx + r * Math.cos(toRad(startDeg));
    const sy = cy + r * Math.sin(toRad(startDeg));
    const ex = cx + r * Math.cos(toRad(endDeg));
    const ey = cy + r * Math.sin(toRad(endDeg));
    const large = endDeg - startDeg > 180 ? 1 : 0;
    return `M ${sx} ${sy} A ${r} ${r} 0 ${large} 1 ${ex} ${ey}`;
  };

  const segments = [
    { color: '#dc2626', s: 180, e: 216 }, // Extreme Fear
    { color: '#f97316', s: 216, e: 252 }, // Fear
    { color: '#fbbf24', s: 252, e: 288 }, // Neutral
    { color: '#4ade80', s: 288, e: 324 }, // Greed
    { color: '#16a34a', s: 324, e: 360 }, // Extreme Greed
  ];

  return (
    <div className="fg-wrapper" style={{ background: bg }}>
      <div className="fg-inner">
        <svg viewBox="0 0 280 150" className="fg-svg">
          {/* Track */}
          <path
            d={arc(140, 140, 100, 180, 360)}
            fill="none"
            stroke="#f3f4f6"
            strokeWidth="24"
          />
          {/* Colored segments */}
          {segments.map((seg, i) => (
            <path
              key={i}
              d={arc(140, 140, 100, seg.s, seg.e)}
              fill="none"
              stroke={seg.color}
              strokeWidth="24"
            />
          ))}
          {/* White center cover */}
          <circle cx="140" cy="140" r="78" fill={bg} />

          {/* Needle */}
          <g transform={`rotate(${needleDeg}, 140, 140)`}>
            <line
              x1="140" y1="140"
              x2="140" y2="52"
              stroke="#1f2937"
              strokeWidth="3"
              strokeLinecap="round"
            />
            <circle cx="140" cy="140" r="6" fill="#1f2937" />
          </g>

          {/* Score */}
          <text
            x="140" y="125"
            textAnchor="middle"
            fontSize="32"
            fontWeight="800"
            fill={color}
            fontFamily="Inter, sans-serif"
          >
            {clampedScore}
          </text>

          {/* End labels */}
          <text x="28"  y="148" fontSize="10" fill="#dc2626" fontFamily="Inter" fontWeight="700">FEAR</text>
          <text x="210" y="148" fontSize="10" fill="#16a34a" fontFamily="Inter" fontWeight="700">GREED</text>
        </svg>

        <div className="fg-label" style={{ color }}>{label}</div>
        <div className="fg-sublabel">MARKET FEAR & GREED INDEX</div>
      </div>
    </div>
  );
}

const SECTOR_MAP = {
  'IT':       ['TCS', 'INFY', 'WIPRO', 'HCLTECH', 'TECHM', 'LTIM', 'PERSISTENT'],
  'BANKS':    ['HDFCBANK', 'ICICIBANK', 'KOTAKBANK', 'AXISBANK', 'SBIN', 'INDUSINDBK', 'BANDHANBNK'],
  'FMCG':     ['HINDUNILVR', 'BRITANNIA', 'TATACONSUM', 'NESTLEIND', 'DABUR', 'MARICO', 'GODREJCP'],
  'METALS':   ['HINDALCO', 'JINDALSTEL', 'JSWSTEEL', 'TATASTEEL', 'HINDZINC', 'NMDC', 'COALINDIA'],
  'AUTO':     ['MARUTI', 'TATAMOTORS', 'MAHINDRA', 'BAJAJ-AUTO', 'MOTHERSON', 'HEROMOTOCO', 'EICHERMOT'],
  'PHARMA':   ['SUNPHARMA', 'DRREDDY', 'CIPLA', 'DIVISLAB', 'AUROPHARMA', 'TORNTPHARM', 'BIOCON'],
  'INFRA':    ['LT', 'ADANIPORTS', 'ADANIENT', 'ABB', 'SIEMENS', 'HAL', 'BEL'],
  'ENERGY':   ['RELIANCE', 'ONGC', 'NTPC', 'POWERGRID', 'BPCL', 'IOC', 'TATAPOWER'],
};

function SectorHeatmap({ allStocks }) {
  if (!allStocks || allStocks.length === 0) return null;

  // Build lookup: symbol -> change_pct
  const stockMap = {};
  allStocks.forEach(s => { stockMap[s.symbol] = s.change_pct; });

  // Calculate avg change per sector
  const sectors = Object.entries(SECTOR_MAP).map(([name, symbols]) => {
    const validChg = symbols
      .map(sym => stockMap[sym])
      .filter(c => c != null && !isNaN(c) && c !== 0);
    const hasData = validChg.length > 0;
    const avg = hasData
      ? parseFloat((validChg.reduce((a, b) => a + b, 0) / validChg.length).toFixed(2))
      : null;
    return { name, avg, hasData };
  });

  const getColor = (avg) => {
    if (avg == null) return { bg: 'hsla(0,0%,100%,0.04)', text: 'hsla(0,0%,100%,0.3)' };
    if (avg >=  2.0) return { bg: '#166534', text: '#ffffff' };
    if (avg >=  0.5) return { bg: '#16a34a', text: '#ffffff' };
    if (avg >=  0.0) return { bg: '#bbf7d0', text: '#166534' };
    if (avg >= -0.5) return { bg: '#fee2e2', text: '#991b1b' };
    if (avg >= -2.0) return { bg: '#dc2626', text: '#ffffff' };
    return                  { bg: '#7f1d1d', text: '#ffffff' };
  };

  const fmtPct = (avg) => {
    if (avg == null) return '--';
    return `${avg > 0 ? '+' : ''}${avg}%`;
  };

  return (
    <div className="sector-heatmap">
      <div className="sector-heatmap-label">SECTOR HEATMAP</div>
      <div className="sector-heatmap-grid">
        {sectors.map(({ name, avg }) => {
          const { bg, text } = getColor(avg);
          return (
            <div
              key={name}
              className="sector-box"
              style={{ background: bg, color: text }}
              title={`${name}: ${fmtPct(avg)}`}
            >
              <span className="sector-box-name">{name}</span>
              <span className="sector-box-pct">{fmtPct(avg)}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ThinkingState() {
  const steps = [
    'Fetching live market data...',
    'Analyzing top movers...',
    'Running Mixtral-8x7b · Groq inference...',
    'Parsing market signals...',
  ];
  const [step, setStep] = useState(0);

  useEffect(() => {
    const id = setInterval(() => setStep(s => (s + 1) % steps.length), 1800);
    return () => clearInterval(id);
  }, []);

  return (
    <div className="thinking-state">
      <div className="thinking-dots">
        <span /><span /><span />
      </div>
      <span className="thinking-step">{steps[step]}</span>
    </div>
  );
}

function AutoLoadingState() {
  return (
    <div className="ai-empty-state">
      <div className="ai-empty-icon">◈</div>
      <p className="ai-empty-title">Loading market analysis...</p>
      <p className="ai-empty-sub">Fetching live data and generating insight.</p>
    </div>
  );
}

function AIMetaPanel({ lastRun, model }) {
  return (
    <div className="ai-meta-panel">
      <div className="ai-meta-row">
        <span className="ai-meta-key">MODEL</span>
        <span className="ai-meta-val">{model}</span>
      </div>
      <div className="ai-meta-row">
        <span className="ai-meta-key">DATA SOURCE</span>
        <span className="ai-meta-val">Angel One WebSocket</span>
      </div>
      <div className="ai-meta-row">
        <span className="ai-meta-key">UNIVERSE</span>
        <span className="ai-meta-val">Nifty 100 + Midcap 100</span>
      </div>
      <div className="ai-meta-row">
        <span className="ai-meta-key">LAST RUN</span>
        <span className="ai-meta-val ai-meta-accent">{lastRun || '—'}</span>
      </div>
      <div className="ai-meta-disclaimer">
        AI insights are for informational purposes only. Not financial advice.
      </div>
    </div>
  );
}

function ConfidencePills({ signal }) {
  const pills = [
    { key: 'BULLISH',  color: 'var(--ai-green)',  glow: 'var(--ai-glow-green)' },
    { key: 'BEARISH',  color: 'var(--ai-red)',    glow: 'var(--ai-glow-red)'   },
    { key: 'NEUTRAL',  color: 'var(--ai-gold)',   glow: '0 0 16px rgba(255,184,0,0.3)' },
    { key: 'CAUTIOUS', color: '#fb923c',           glow: '0 0 16px rgba(251,146,60,0.3)' },
  ];

  // Priority check already done on backend, but handle CAUTIOUS correctly here
  const active = pills.find(p => signal?.toUpperCase().includes(p.key));

  return (
    <div className="confidence-pills">
      {pills.map(p => (
        <span
          key={p.key}
          className={`conf-pill ${active?.key === p.key ? 'conf-pill-active' : ''}`}
          style={active?.key === p.key
            ? { color: p.color, borderColor: p.color, boxShadow: p.glow, background: `${p.color}10` }
            : {}}
        >
          {p.key}
        </span>
      ))}
    </div>
  );
}

function TypewriterText({ text, speed = 30 }) {
  const [displayedText, setDisplayedText] = useState('');
  
  useEffect(() => {
    setDisplayedText('');
    if (!text) return;

    let i = 0;
    const interval = setInterval(() => {
      setDisplayedText(prev => prev + text.charAt(i));
      i++;
      if (i >= text.length) clearInterval(interval);
    }, speed);

    return () => clearInterval(interval);
  }, [text, speed]);

  return <div className="typewriter-text">{displayedText}</div>;
}

function StructuredInsight({ text, gainers, losers }) {
  if (!text) return null;

  // Parse sections from structured AI response
  const parseSection = (label) => {
    // Escaping colon to be safe, searching for section start and stopping at next section or end
    const regex = new RegExp(`${label}:\\s*([\\s\\S]*?)(?=MARKET SNAPSHOT:|SECTOR ANALYSIS:|OUTLOOK:|SIGNAL:|$)`, 'i');
    const match = text.match(regex);
    return match ? match[1].trim() : null;
  };

  const snapshot = parseSection("MARKET SNAPSHOT");
  const sector   = parseSection("SECTOR ANALYSIS");
  const outlook  = parseSection("OUTLOOK");

  // Calculate quick stats
  const topGainerPct = gainers?.[0]?.change_pct?.toFixed(2);
  const topLoserPct  = Math.abs(losers?.[0]?.change_pct || 0).toFixed(2);
  const topGainerSym = gainers?.[0]?.symbol;
  const topLoserSym  = losers?.[0]?.symbol;

  // If parsing fails (unstructured response), show full text
  if (!snapshot && !sector && !outlook) {
    return <p className="insight-fallback-text">{text}</p>;
  }

  return (
    <div className="structured-insight">
      {/* Quick stat chips */}
      {topGainerSym && (
        <div className="insight-stat-chips">
          <div className="stat-chip stat-chip-green">
            <span className="stat-chip-label">TOP GAINER</span>
            <span className="stat-chip-value">{topGainerSym} +{topGainerPct}%</span>
          </div>
          <div className="stat-chip stat-chip-red">
            <span className="stat-chip-label">TOP LOSER</span>
            <span className="stat-chip-value">{topLoserSym} -{topLoserPct}%</span>
          </div>
          <div className="stat-chip stat-chip-blue">
            <span className="stat-chip-label">UNIVERSE</span>
            <span className="stat-chip-value">200 STOCKS</span>
          </div>
        </div>
      )}

      {snapshot && (
        <div className="insight-section">
          <span className="insight-section-label">📊 MARKET SNAPSHOT</span>
          <p className="insight-section-text">{snapshot}</p>
        </div>
      )}
      {sector && (
        <div className="insight-section">
          <span className="insight-section-label">🔄 SECTOR ANALYSIS</span>
          <p className="insight-section-text">{sector}</p>
        </div>
      )}
      {outlook && (
        <div className="insight-section">
          <span className="insight-section-label">🎯 OUTLOOK</span>
          <p className="insight-section-text">{outlook}</p>
        </div>
      )}
    </div>
  );
}

function StockAICard({ type, symbol, price, changePct, aiReason, delay = 0 }) {
  const isGainer = type === 'gainer';
  const accent   = isGainer ? 'var(--ai-green)' : 'var(--ai-red)';
  const glow     = isGainer ? 'var(--ai-glow-green)' : 'var(--ai-glow-red)';

  const displaySymbol = symbol || 'Loading...';
  const displayPrice = (price != null && !isNaN(price))
    ? `₹${Number(price).toLocaleString('en-IN')}` : '—';
  const displayChange = (changePct != null && !isNaN(changePct))
    ? `${isGainer ? '+' : ''}${changePct.toFixed(2)}%` : '—';

  return (
    <div
      className="stock-ai-card"
      style={{
        '--card-accent': accent,
        '--card-glow':   glow,
        animationDelay:  `${delay}ms`,
      }}
    >
      <div className="stock-ai-card-header">
        <div>
          <div className="stock-ai-label">
            {isGainer ? '▲ TOP GAINER' : '▼ TOP LOSER'}
          </div>
          <div className="stock-ai-symbol">{displaySymbol}</div>
        </div>
        <div className="stock-ai-stats">
          <span className="stock-ai-price">{displayPrice}</span>
          <span className="stock-ai-change" style={{ color: accent }}>
            {displayChange}
          </span>
        </div>
      </div>
      <div className="stock-ai-divider" />
      <div className="stock-ai-reason-label">AI ANALYSIS</div>
      <p className="stock-ai-reason">{aiReason || '—'}</p>
    </div>
  );
}

function AIErrorState({ onRetry }) {
  return (
    <div style={{
      background: 'hsla(40, 100%, 50%, 0.06)',
      border: '1px solid hsla(40, 100%, 50%, 0.15)',
      borderLeft: '4px solid hsl(40, 100%, 50%)',
      borderRadius: '12px',
      padding: '20px',
      display: 'flex',
      alignItems: 'center',
      gap: '16px',
    }}>
      <span style={{ fontSize: '24px' }}>⚠️</span>
      <div style={{ flex: 1 }}>
        <div style={{ fontWeight: 700, color: 'hsl(40, 100%, 65%)', fontSize: '14px', marginBottom: '4px' }}>
          AI engine warming up...
        </div>
        <div style={{ fontSize: '11px', color: 'hsla(0,0%,100%,0.4)', letterSpacing: '0.5px' }}>
          Groq · Auto-retrying in 30s
        </div>
      </div>
      <button onClick={onRetry} style={{
        background: 'hsla(40, 100%, 50%, 0.15)',
        border: '1px solid hsla(40, 100%, 50%, 0.3)',
        color: 'hsl(40, 100%, 65%)',
        padding: '6px 14px',
        borderRadius: '8px',
        fontWeight: 700,
        fontSize: '12px',
        cursor: 'pointer',
      }}>↻ Retry</button>
    </div>
  );
}

function SignalHistory({ history }) {
  if (!history.length) return null;
  return (
    <div className="signal-history">
      <div className="signal-history-label">RECENT SIGNALS</div>
      {history.map((h, i) => (
        <div className="signal-history-row" key={i}>
          <span className="sh-time">{h.timestamp}</span>
          <span className={`sh-signal sh-signal-${h.signal?.toLowerCase()}`}>
            {h.signal || 'NEUTRAL'}
          </span>
          <span className="sh-preview">{h.preview}</span>
        </div>
      ))}
    </div>
  );
}

// ── Multi-Timeframe Alignment Widget ──────────────────────────────────────────
function MTFAlignmentWidget({ symbol }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!symbol) return;
    const fetchMTF = async () => {
      setLoading(true);
      try {
        const res = await fetch(`/api/tv/mtf/${symbol}`);
        if (res.ok) setData(await res.json());
      } catch (err) {
        console.error("MTF fetch failed:", err);
      } finally {
        setLoading(false);
      }
    };
    fetchMTF();
  }, [symbol]);

  if (loading) return <div className="mtf-loading">Checking multi-timeframe alignment...</div>;
  if (!data) return null;

  return (
    <div className="mtf-alignment-section">
      <div className="section-label">
        <span className="label-dot" style={{ background: 'var(--purple)' }} />
        MTF ALIGNMENT — {symbol}
      </div>
      <div className="mtf-grid">
        {data.alignments?.map((item, i) => (
          <div key={i} className="mtf-row">
            <span className="mtf-timeframe">{item.timeframe}</span>
            <div className="mtf-status" data-trend={item.trend}>
              {item.trend}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Volume Breakouts Table ───────────────────────────────────────────────────
function VolumeBreakoutTable({ breakouts }) {
  if (!breakouts || breakouts.length === 0) return null;

  return (
    <div className="breakouts-section">
      <div className="section-label">
        <span className="label-dot" style={{ background: 'var(--orange)' }} />
        LIVE VOLUME BREAKOUTS (15m)
      </div>
      <table className="breakouts-table">
        <thead>
          <tr>
            <th>Symbol</th>
            <th>Price</th>
            <th>Chg%</th>
            <th>Vol Ratio</th>
          </tr>
        </thead>
        <tbody>
          {breakouts.map((b, i) => (
            <tr key={i}>
              <td className="breakout-symbol">{b.symbol}</td>
              <td>₹{b.price?.toFixed(2)}</td>
              <td className={`breakout-chg ${b.change_pct >= 0 ? 'sc-up' : 'sc-down'}`}>
                {b.change_pct >= 0 ? '+' : ''}{b.change_pct?.toFixed(2)}%
              </td>
              <td className="breakout-ratio">{b.volume_ratio?.toFixed(1)}x</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── Main Page ──────────────────────────────────────────────────────────────

export default function InsightsPage({ onBack, wsStatus, standalone = false }) {
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState(null);
  const [breakouts, setBreakouts] = useState([]);
  const [flags, setFlags] = useState([]);
  const [history, setHistory] = useState([]);
  const [moodScore, setMoodScore] = useState(50);
  const [error, setError] = useState(null);
  const [hasGenerated, setHasGenerated] = useState(false);

  useEffect(() => {
    fetchInsight();
    fetchBreakouts();
    fetchFlags();
    const interval = setInterval(fetchBreakouts, 300000); // 5 min
    return () => clearInterval(interval);
  }, []);

  const fetchFlags = async () => {
    try {
      const res = await fetch('/api/divergence-flags');
      if (res.ok) {
        const d = await res.json();
        setFlags(d.flags || []);
      }
    } catch (err) {
      console.error("Failed to fetch flags:", err);
    }
  };

  const fetchBreakouts = async () => {
    try {
      const res = await fetch('/api/tv/volume-breakouts');
      if (res.ok) {
        const d = await res.json();
        setBreakouts(d.breakouts || []);
      }
    } catch (err) {
      console.error("Failed to fetch breakouts:", err);
    }
  };

  const fetchInsight = async () => {
    setLoading(true);
    setError(null);
    setHasGenerated(true);
    try {
      const res = await fetch('/api/ai-insight');
      if (!res.ok) throw new Error('Failed to fetch AI insights');
      const result = await res.json();
      
      setData(result);
      
      // Calculate mood score
      const gainers = result.gainers || [];
      const losers  = result.losers  || [];
      const avgGain = (gainers).reduce((s, g) => s + (g.change_pct || 0), 0) / Math.max(gainers.length || 1, 1);
      const avgLoss = Math.abs((losers).reduce((s, l) => s + (l.change_pct || 0), 0)) / Math.max(losers.length || 1, 1);
      const score   = Math.max(0, Math.min(100, Math.round(50 + (avgGain - avgLoss) * 4)));
      setMoodScore(score);

      // Update history (prepend, slice to 5)
      setHistory(prev => [{
        timestamp: result.timestamp || new Date().toLocaleTimeString('en-IN', {timeZone:'Asia/Kolkata'}),
        signal:    result.signal    || 'NEUTRAL',
        preview:   (
          result.insight   ||
          result.analysis  ||
          result.text      ||
          result.overview  ||
          'Analysis complete'
        ).substring(0, 80) + '...',
      }, ...prev].slice(0, 5));

    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  // Auto-retry on error every 30s
  useEffect(() => {
    if (!error) return;
    const retryTimer = setTimeout(() => fetchInsight(), 30000);
    return () => clearTimeout(retryTimer);
  }, [error]);

  return (
    <div className="insights-view">

      {/* HEADER — only shown when NOT standalone (standalone uses App.js section header) */}
      {!standalone && (
        <div className="ai-page-header">
          <button className="ai-back-btn" onClick={onBack}>← Back</button>
          <div className="ai-page-title">
            <span className="ai-title-text">AI MARKET ANALYST</span>
            <span className="ai-model-badge">Mixtral-8x7b · Groq Neural Engine</span>
          </div>
          <button className="ai-refresh-btn" style={{
            background: 'var(--blue)', color: '#fff', border: 'none', padding: '8px 20px',
            borderRadius: '8px', fontWeight: '700', cursor: 'pointer', boxShadow: 'var(--blue-glow)'
          }} onClick={fetchInsight}>
            {loading ? 'Analyzing...' : 'Refresh'}
          </button>
        </div>
      )}

      {/* Row 1: Gauge (left 40%) + Refresh/Summary header (right 60%) */}
      <div className="analyst-top-row">
        <div className="analyst-gauge-col">
          <FearGreedGauge score={moodScore} />
        </div>
        <div className="analyst-summary-col">
          <div className="analyst-summary-header">
            <span className="analyst-summary-label">AI MARKET INSIGHT</span>
            <button className="ai-refresh-btn-inline" onClick={fetchInsight}>
              {loading ? '⏳ Analyzing...' : '↻ Refresh'}
            </button>
          </div>
          <div className="analyst-summary-body">
            {loading ? (
              <div className="thinking-state" style={{ justifyContent: 'flex-start', padding: '16px 0' }}>
                <div className="thinking-dots"><span /><span /><span /></div>
                <span className="thinking-step">Running Mixtral-8x7b analysis...</span>
              </div>
            ) : error || (data?.insight && data.insight.toLowerCase().includes('unavailable')) ? (
              <AIErrorState onRetry={fetchInsight} />
            ) : data?.insight ? (
              <p style={{ fontSize: '14px', lineHeight: 1.7, color: 'var(--text-secondary)', margin: 0 }}>
                {data.insight.substring(0, 400)}{data.insight.length > 400 ? '...' : ''}
              </p>
            ) : (
              <p style={{ fontSize: '13px', color: 'var(--text-muted)', fontStyle: 'italic' }}>
                Click Refresh to generate AI market analysis.
              </p>
            )}
          </div>
          <ConfidencePills signal={data?.signal} />
        </div>
      </div>

      {/* Row 2: Sector Heatmap */}
      {data && <SectorHeatmap allStocks={[...(data.gainers || []), ...(data.losers || [])]} />}
      
      {flags && flags.length > 0 && (
        <div className="lie-detector-section" style={{ margin: '0 32px 32px' }}>
          <div className="section-label" style={{ fontSize: '11px', fontWeight: '800', color: 'var(--text-muted)', marginBottom: '16px', letterSpacing: '1px' }}>
            ⚠️ AI LIE DETECTOR (NARRATIVE VS TAPE)
          </div>
          <div className="lie-detector-grid" style={{ display: 'grid', gap: '16px' }}>
            {flags.map((f, i) => {
              let accent = 'var(--text-primary)';
              if (f.divergence_type === 'Bull Trap') accent = '#f59e0b';
              else if (f.divergence_type === 'Bear Trap') accent = '#f43f5e';
              else if (f.divergence_type === 'Confirmed Move') accent = 'var(--green)';

              return (
                <div key={i} style={{ padding: '20px', background: 'var(--bg-card)', border: `1px solid hsla(0,0%,100%,0.1)`, borderLeft: `4px solid ${accent}`, borderRadius: '12px', boxShadow: 'var(--shadow-premium)' }}>
                  <div style={{ fontSize: '14px', fontWeight: '800', color: accent, marginBottom: '8px' }}>
                    {f.symbol} — {f.divergence_type} ({f.confidence} Confidence)
                  </div>
                  <div style={{ fontSize: '14px', color: 'var(--text-secondary)', fontStyle: 'italic' }}>
                    "{f.one_line_reason}"
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      
      <div className="ai-main-card">
         <div className="ai-card-label">NARRATIVE INTELLIGENCE</div>
         {loading ? <ThinkingState /> :
          (data?.insight && data.insight.toLowerCase().includes('unavailable'))
            ? <AIErrorState onRetry={fetchInsight} />
            : <StructuredInsight text={data?.insight} gainers={data?.gainers} losers={data?.losers} />
         }
      </div>

      {data && !loading && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '24px', padding: '0 32px' }}>
          {data.gainers?.[0] && (
            <StockAICard 
               type="gainer"
               symbol={data.gainers[0].symbol}
               price={data.gainers[0].ltp}
               changePct={data.gainers[0].change_pct}
               aiReason={data.gainer_insight}
            />
          )}
          {data.losers?.[0] && (
            <StockAICard 
              type="loser"
              symbol={data.losers[0].symbol}
              price={data.losers[0].ltp}
              changePct={data.losers[0].change_pct}
              aiReason={data.loser_insight}
              delay={300}
            />
          )}
        </div>
      )}

      {/* SIGNAL HISTORY */}
      <SignalHistory history={history} />
    </div>
  );
}
