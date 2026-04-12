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
  allStocks.forEach(s => { stockMap[s.symbol] = s.change_pct || 0; });

  // Calculate avg change per sector
  const sectors = Object.entries(SECTOR_MAP).map(([name, symbols]) => {
    const changes  = symbols.map(sym => stockMap[sym] || 0);
    const validChg = changes.filter(c => c !== 0);
    const avg      = validChg.length > 0
      ? validChg.reduce((a, b) => a + b, 0) / validChg.length
      : 0;
    return { name, avg: parseFloat(avg.toFixed(2)) };
  });

  const getColor = (avg) => {
    if (avg >=  2.0) return { bg: '#166534', text: '#ffffff' };
    if (avg >=  0.5) return { bg: '#16a34a', text: '#ffffff' };
    if (avg >=  0.0) return { bg: '#bbf7d0', text: '#166534' };
    if (avg >= -0.5) return { bg: '#fee2e2', text: '#991b1b' };
    if (avg >= -2.0) return { bg: '#dc2626', text: '#ffffff' };
    return                  { bg: '#7f1d1d', text: '#ffffff' };
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
              title={`${name}: ${avg > 0 ? '+' : ''}${avg}%`}
            >
              <span className="sector-box-name">{name}</span>
              <span className="sector-box-pct">
                {avg > 0 ? '+' : ''}{avg}%
              </span>
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
          <div className="stock-ai-symbol">{symbol}</div>
        </div>
        <div className="stock-ai-stats">
          <span className="stock-ai-price">₹{price?.toLocaleString('en-IN') || '—'}</span>
          <span className="stock-ai-change" style={{ color: accent }}>
            {isGainer ? '+' : ''}{changePct?.toFixed(2)}%
          </span>
        </div>
      </div>
      <div className="stock-ai-divider" />
      <div className="stock-ai-reason-label">AI ANALYSIS</div>
      <p className="stock-ai-reason">{aiReason || '—'}</p>
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

export default function InsightsPage({ onBack, wsStatus }) {
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState(null);
  const [breakouts, setBreakouts] = useState([]);
  const [history, setHistory] = useState([]);
  const [moodScore, setMoodScore] = useState(50);
  const [error, setError] = useState(null);
  const [hasGenerated, setHasGenerated] = useState(false);

  useEffect(() => {
    fetchInsight();
    fetchBreakouts();
    const interval = setInterval(fetchBreakouts, 300000); // 5 min
    return () => clearInterval(interval);
  }, []);

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

  return (
    <div className="insights-view">
      <style jsx>{`
        .insights-view {
          min-height: 100vh;
          background: var(--bg);
          color: var(--text-primary);
          padding-bottom: 80px;
        }
        .ai-page-header {
           display: flex;
           align-items: center;
           justify-content: space-between;
           padding: 20px 32px;
           background: hsla(var(--bg-hsl), 0.8);
           backdrop-filter: blur(20px);
           position: sticky; top: 0; z-index: 100;
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
        }
        .ai-page-title { text-align: center; flex: 1; }
        .ai-title-text { font-size: 18px; font-weight: 800; display: block; border-bottom: none; }
        .ai-model-badge { font-size: 10px; color: var(--text-muted); font-weight: 700; text-transform: uppercase; letter-spacing: 1px; }

        .fg-wrapper {
          margin: 40px auto;
          max-width: 400px;
          padding: 32px;
          background: var(--bg-card);
          border-radius: var(--radius-lg);
          border: 1px solid var(--glass-border);
          text-align: center;
          box-shadow: var(--shadow-premium);
        }
        .fg-label { font-size: 24px; font-weight: 800; margin-top: 16px; }
        .fg-sublabel { font-size: 10px; font-weight: 700; color: var(--text-muted); letter-spacing: 1px; }

        .sector-heatmap { margin: 0 32px 40px; }
        .sector-heatmap-label { font-size: 11px; font-weight: 700; color: var(--text-muted); margin-bottom: 12px; letter-spacing: 1px; }
        .sector-heatmap-grid { 
          display: grid; 
          grid-template-columns: repeat(auto-fill, minmax(140px, 1fr)); 
          gap: 12px; 
        }
        .sector-box {
           padding: 16px; border-radius: 12px; display: flex; flex-direction: column; 
           align-items: center; gap: 4px; transition: transform 0.2s;
        }
        .sector-box:hover { transform: scale(1.05); }
        .sector-box-name { font-size: 11px; font-weight: 700; }
        .sector-box-pct { font-size: 14px; font-weight: 800; }

        .ai-main-card {
           margin: 0 32px 32px;
           background: var(--bg-card);
           border: 1px solid var(--glass-border);
           border-radius: var(--radius-lg);
           padding: 40px;
           position: relative;
        }
        .ai-main-card::before {
          content: ''; position: absolute; top: 0; left: 0; width: 4px; height: 100%;
          background: var(--blue);
        }
        .ai-card-label { font-size: 11px; font-weight: 700; color: var(--blue); letter-spacing: 1px; margin-bottom: 24px; }
        
        .insight-section { margin-bottom: 32px; }
        .insight-section-label { font-size: 11px; font-weight: 800; color: var(--text-muted); margin-bottom: 12px; display: block; }
        .insight-section-text { font-size: 16px; line-height: 1.7; color: var(--text-secondary); }

        .stock-ai-card {
           background: var(--bg-card);
           border: 1px solid var(--glass-border);
           border-radius: var(--radius-md);
           padding: 24px;
           animation: card-entry 0.6s ease-out forwards;
           opacity: 0;
        }
        @keyframes card-entry {
          from { opacity: 0; transform: translateY(20px); }
          to { opacity: 1; transform: translateY(0); }
        }
      `}</style>
      
      {/* HEADER */}
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

      <FearGreedGauge score={moodScore} />
      {data && <SectorHeatmap allStocks={[...(data.gainers || []), ...(data.losers || [])]} />}
      
      <div className="ai-main-card">
         <div className="ai-card-label">NARRATIVE INTELLIGENCE</div>
         {loading ? <ThinkingState /> : <StructuredInsight text={data?.insight} gainers={data?.gainers} losers={data?.losers} />}
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
