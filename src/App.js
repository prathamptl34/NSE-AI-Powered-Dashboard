import React, { useState, useEffect, useRef, useCallback } from "react";
import "./index.css";
import InsightsPage from "./InsightsPage";
import SignalScanner from "./SignalScanner";
import MarketPulseHero from "./MarketPulseHero";
import { useStockExplain, StockDeepDiveModal } from './StockDeepDive';
import FnoMoversTable from "./FnoMoversTable";

// ── Utility functions ─────────────────────────────────────────────────────────

function formatINR(num) {
  if (num === null || num === undefined) return '—';
  return Number(num).toLocaleString('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function formatIST(date = new Date()) {
  return date.toLocaleTimeString('en-IN', {
    timeZone: 'Asia/Kolkata',
    hour:     '2-digit',
    minute:   '2-digit',
    second:   '2-digit',
    hour12:   true,
  });
}

// ── Components ────────────────────────────────────────────────────────────────

function MarketClock() {
  const [time, setTime] = useState('');

  useEffect(() => {
    const tick = () => setTime(formatIST());
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);

  return (
    <div className="market-clock">
      <span className="clock-time">{time}</span>
      <span className="clock-label">IST</span>
    </div>
  );
}

function ConnectionDot({ status }) {
  return (
    <div className={`conn-dot conn-${status}`}>
      <span className="dot-inner" />
      <span className="dot-label">{status === 'live' ? 'Live' : 'Offline'}</span>
    </div>
  );
}

function MarketPulseBanner({ insight, signal }) {
  const isLoading = !insight;
  return (
    <div className="market-pulse-banner">
      <div className="pulse-signal-box">
        <span className="pulse-label">Pulse</span>
        <div className={`signal-pill signal-${(signal || 'neutral').toLowerCase()}`}>
          {signal || 'Detecting...'}
        </div>
      </div>
      <div className="pulse-narrative">
        {isLoading ? (
          <div className="pulse-narrative-placeholder">
            <div className="pulse-loading-dot" />
            AI is analyzing current market momentum...
          </div>
        ) : (
          insight
        )}
      </div>
    </div>
  );
}

function SkeletonList({ count = 10 }) {
  return Array.from({ length: count }).map((_, i) => (
    <div className="skeleton-card" key={i} style={{ animationDelay: `${i * 0.05}s` }} />
  ));
}

// ── Interactive Professional Sparkline ───────────────────────────────────────

const Sparkline = React.memo(({ data, accent }) => {
  const [hoverIdx, setHoverIdx] = useState(null);

  if (!data || data.length < 2) {
    return <div className="sparkline-placeholder">Accumulating data...</div>;
  }

  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const width = 140;
  const height = 45;
  const paddingY = 5;

  const getX = (i) => (i / (data.length - 1)) * width;
  const getY = (val) => height - paddingY - ((val - min) / range) * (height - 2 * paddingY);

  // Generate straight line path for accurate financial look
  let pathD = `M ${getX(0)},${getY(data[0])}`;
  for (let i = 1; i < data.length; i++) {
    pathD += ` L ${getX(i)},${getY(data[i])}`;
  }

  const areaD = `${pathD} L ${width},${height} L 0,${height} Z`;
  const color = accent === 'green' ? 'var(--green)' : 'var(--red)';

  const handleMouseMove = (e) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const idx = Math.round((x / rect.width) * (data.length - 1));
    setHoverIdx(Math.max(0, Math.min(idx, data.length - 1)));
  };

  return (
    <div 
      className="sparkline-container" 
      style={{ position: 'relative', width: '100%', height: '50px', marginLeft: '10px' }}
      onMouseMove={handleMouseMove}
      onMouseLeave={() => setHoverIdx(null)}
    >
      <svg width="100%" height="100%" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" style={{ overflow: 'visible' }}>
        <defs>
          <linearGradient id={`grad-${accent}`} x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.5" />
            <stop offset="100%" stopColor={color} stopOpacity="0.0" />
          </linearGradient>
          <filter id="glow">
            <feGaussianBlur stdDeviation="1" result="coloredBlur"/>
            <feMerge>
              <feMergeNode in="coloredBlur"/>
              <feMergeNode in="SourceGraphic"/>
            </feMerge>
          </filter>
        </defs>
        
        {/* Soft Area Fill */}
        <path d={areaD} fill={`url(#grad-${accent})`} />
        
        {/* Sharp Financial Line */}
        <path d={pathD} fill="none" stroke={color} strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" filter="url(#glow)" />

        {/* Interactive Hover Crosshair & Dot */}
        {hoverIdx !== null && (
          <g>
            <line x1={getX(hoverIdx)} y1="0" x2={getX(hoverIdx)} y2={height} stroke="var(--text-muted)" strokeDasharray="3,3" opacity="0.6" strokeWidth="1" />
            <circle cx={getX(hoverIdx)} cy={getY(data[hoverIdx])} r="3.5" fill="var(--bg-main)" stroke={color} strokeWidth="2" />
          </g>
        )}
      </svg>

      {/* Modern Tooltip Label */}
      {hoverIdx !== null && (
        <div style={{
          position: 'absolute',
          left: `calc(${(hoverIdx / (data.length - 1)) * 100}% - 20px)`,
          top: '-20px',
          background: 'var(--bg-elevated)',
          color: 'var(--text-primary)',
          fontSize: '10px',
          fontWeight: 'bold',
          padding: '3px 6px',
          borderRadius: '4px',
          boxShadow: '0 4px 6px -1px rgba(0,0,0,0.1)',
          pointerEvents: 'none',
          whiteSpace: 'nowrap',
          zIndex: 10
        }}>
          ₹{data[hoverIdx].toFixed(2)}
        </div>
      )}
    </div>
  );
});

// Pure display — receives flashDir as prop, re-keyed by parent to restart CSS animation
function StockCardInner({ stock, rank, accent, onClick, viewMode, history, flashDir }) {
  return (
    <div
      className={`stock-card ${viewMode === 'chart' ? 'card-chart-mode' : ''} ${flashDir ? `flash-${flashDir}` : ''}`}
      style={{ cursor: 'pointer' }}
      onClick={() => onClick({
        symbol: stock.symbol,
        price: stock.ltp,
        prev_close: stock.prev_close || 0,
        change_pct: stock.change_pct
      })}
    >
      <div className={`rank rank-${accent}`}>
        {String(rank).padStart(2, '0')}
      </div>
      <div className="stock-meta" style={{ minWidth: '90px' }}>
        <span className="stock-symbol">{stock.symbol}</span>
        <span className="stock-exchange">NSE</span>
      </div>
      {viewMode === 'chart' ? (
        <Sparkline data={history} accent={accent} />
      ) : (
        <div className="stock-price-block">
          <span className="stock-price">₹{formatINR(stock.ltp)}</span>
          <span className="stock-prev">prev ₹{formatINR(stock.prev_close)}</span>
        </div>
      )}
      <div className={`change-badge change-${accent}`}>
        {viewMode === 'chart' && <span className="chart-price">₹{formatINR(stock.ltp)}</span>}
        <span className="change-arrow">{accent === 'green' ? '▲' : '▼'}</span>
        <span className="change-pct">{Math.abs(stock.change_pct).toFixed(2)}%</span>
      </div>
    </div>
  );
}

// Wrapper — tracks price changes, bumps animKey to force StockCardInner to remount
const StockCard = React.memo(function StockCard({ stock, rank, accent, onClick, viewMode, history }) {
  const [animKey, setAnimKey] = useState(0);
  const [flashDir, setFlashDir] = useState(null);
  const prevPrice = useRef(stock.ltp);

  useEffect(() => {
    if (stock.ltp === prevPrice.current) return;
    const dir = stock.ltp > prevPrice.current ? 'up' : 'down';
    prevPrice.current = stock.ltp;
    setFlashDir(dir);
    setAnimKey(k => k + 1); // key on StockCardInner below drives remount → CSS animation restarts
    const t = setTimeout(() => setFlashDir(null), 800);
    return () => clearTimeout(t);
  }, [stock.ltp]);

  return (
    <StockCardInner
      key={animKey}
      stock={stock}
      rank={rank}
      accent={accent}
      onClick={onClick}
      viewMode={viewMode}
      history={history}
      flashDir={flashDir}
    />
  );
});

function Panel({ title, accent, data, type, lastUpdated, onStockClick, viewMode, historyMap }) {
  // Clamp to 5 to prevent glitches when WS sends extra items mid-update
  const items = data ? data.slice(0, 5) : [];
  return (
    <section className={`panel panel-${accent}`}>
      <div className="panel-header">
        <span className="panel-icon">{type === 'gainer' ? '▲' : '▼'}</span>
        <h2 className="panel-title">{title}</h2>
        <span className="panel-count">{items.length} stocks</span>
      </div>
      <div className="panel-body">
        {items.length === 0
          ? <SkeletonList count={5} />
          : items.map((s, i) => (
              <StockCard 
                key={s.symbol} 
                stock={s} 
                rank={i+1} 
                accent={accent} 
                onClick={onStockClick} 
                viewMode={viewMode}
                history={historyMap[s.symbol] || []}
              />
            ))
        }
      </div>
      <div className="panel-footer">
        <span className="last-updated">Updated {lastUpdated || "—"}</span>
      </div>
    </section>
  );
}

// ── App Component ─────────────────────────────────────────────────────────────

export default function App() {
  const { activeStock, explanation, multiAgentData, loading, loadingMA, openExplain, closeExplain } = useStockExplain();
  const [currentPage, setCurrentPage] = useState('home');
  const [niftyData, setNiftyData] = useState({ gainers: [], losers: [] });
  const [midcapData, setMidcapData] = useState({ gainers: [], losers: [] });
  const [fnoMovers, setFnoMovers] = useState({ gainers: [], losers: [] });
  const [wsStatus, setWsStatus] = useState('offline');
  const [aiInsight, setAiInsight] = useState(null);
  const [aiSignal, setAiSignal] = useState(null);
  const [lastUpdated, setLastUpdated] = useState(null);
  const [viewMode, setViewMode] = useState('normal'); 
  const [historyMap, setHistoryMap] = useState({});
  const fetchedIntradayRef = useRef(new Set());
  const wsRef = useRef(null);

  const fetchData = useCallback(async () => {
    const fetchWithFallback = async (path) => {
      try {
        let res;
        try {
          res = await fetch(path);
        } catch (e) {
          // Dev fallback
          res = await fetch(`http://127.0.0.1:8000${path}`);
        }
        
        if (!res.ok) return null;
        const contentType = res.headers.get("content-type");
        if (!contentType || !contentType.includes("application/json")) {
           console.warn(`[API] ${path} returned non-JSON:`, contentType);
           return null;
        }
        return await res.json();
      } catch (e) {
        console.warn(`[API] ${path} error:`, e);
        return null;
      }
    };

    // 1. Market Summary
    const summary = await fetchWithFallback("/api/market-summary");
    if (summary) {
      setNiftyData(summary.nifty100 || { gainers: [], losers: [] });
      setMidcapData(summary.midcap100 || { gainers: [], losers: [] });
      setLastUpdated(formatIST());
    }

    // 2. F&O Movers
    const fno = await fetchWithFallback("/api/fno-movers");
    if (fno) {
      setFnoMovers({ gainers: fno.gainers || [], losers: fno.losers || [] });
    }

    // 3. AI Insight Narrative
    const ai = await fetchWithFallback("/api/ai-insight");
    if (ai) {
      if (ai.insight) setAiInsight(ai.insight);
      if (ai.signal) setAiSignal(ai.signal);
    }
  }, []);

  const [showBanner, setShowBanner] = useState(false);
  const bannerTimerRef = useRef(null);
  const reconnectTimerRef = useRef(null);

  // Polling & WebSocket Manager
  useEffect(() => {
    fetchData();
    const pollId = setInterval(fetchData, wsStatus === 'live' ? 10000 : 5000);

    const connectWS = () => {
      // If already connecting or connected, do nothing
      if (wsRef.current && (wsRef.current.readyState === 0 || wsRef.current.readyState === 1)) return;
      
      try {
        const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const isDev = window.location.port === '3000';
        const backendHost = isDev ? '127.0.0.1:8000' : window.location.host;
        const ws = new WebSocket(`${proto}//${backendHost}/ws/stream`);
        wsRef.current = ws;

        ws.onopen = () => {
          console.log("[WS] Connected");
          setWsStatus('live');
          setShowBanner(false);
          if (bannerTimerRef.current) clearTimeout(bannerTimerRef.current);
        };

        ws.onmessage = (e) => {
          try {
            const msg = JSON.parse(e.data);
            if (msg.type === 'ping') return;

            if (msg.type === 'full_update' || msg.type === 'partial_update') {
              if (msg.index === 'nifty100') {
                setNiftyData({ gainers: msg.gainers || [], losers: msg.losers || [] });
              } else if (msg.index === 'midcap100') {
                setMidcapData({ gainers: msg.gainers || [], losers: msg.losers || [] });
              }
              if (msg.fno_movers) {
                setFnoMovers({ gainers: msg.fno_movers.gainers || [], losers: msg.fno_movers.losers || [] });
              }
              setLastUpdated(formatIST());
              setWsStatus('live');
              setShowBanner(false);
              if (bannerTimerRef.current) clearTimeout(bannerTimerRef.current);
            }
          } catch (err) {}
        };

        ws.onclose = () => {
          console.log("[WS] Disconnected. Silent retry...");
          setWsStatus('offline');
          wsRef.current = null;
          
          // Only show banner after 7s of continuous disconnection
          if (!bannerTimerRef.current) {
            bannerTimerRef.current = setTimeout(() => {
              setShowBanner(true);
            }, 7000);
          }
          
          reconnectTimerRef.current = setTimeout(connectWS, 3000);
        };

        ws.onerror = (e) => {
          setWsStatus('offline');
          ws.close();
        };
      } catch (e) {
        reconnectTimerRef.current = setTimeout(connectWS, 5000);
      }
    };

    connectWS();

    return () => {
      clearInterval(pollId);
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
      if (bannerTimerRef.current) clearTimeout(bannerTimerRef.current);
      if (wsRef.current) {
        wsRef.current.onclose = null;
        wsRef.current.close();
      }
    };
  }, [fetchData]);

  const handleManualRetry = () => {
    fetchData();
    if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
    // Force immediate reconnection attempt
    const connectWS = () => {
      if (wsRef.current && (wsRef.current.readyState === 0 || wsRef.current.readyState === 1)) return;
      try {
        const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const isDev = window.location.port === '3000';
        const backendHost = isDev ? '127.0.0.1:8000' : window.location.host;
        const ws = new WebSocket(`${proto}//${backendHost}/ws/stream`);
        wsRef.current = ws;
        ws.onopen = () => { setWsStatus('live'); setShowBanner(false); };
        ws.onclose = () => { setWsStatus('offline'); reconnectTimerRef.current = setTimeout(connectWS, 3000); };
      } catch(e){}
    };
    connectWS();
  };

  // Intraday Sparkline Fetcher
  const lastFetchTimeRef = useRef(0);
  useEffect(() => {
    if (viewMode !== 'chart') return;
    
    // Throttle: Don't check for missing symbols more than once every 30s
    const now = Date.now();
    if (now - lastFetchTimeRef.current < 30000) return;
    
    const all = [
      ...niftyData.gainers, ...niftyData.losers, 
      ...midcapData.gainers, ...midcapData.losers,
      ...fnoMovers.gainers, ...fnoMovers.losers
    ];
    
    // Deduplicate symbols
    const uniqueSymbols = Array.from(new Set(all.map(s => s.symbol)));
    
    const missingSymbols = uniqueSymbols.filter(sym => 
      !fetchedIntradayRef.current.has(sym) && 
      (!historyMap[sym] || historyMap[sym].length <= 2)
    );
      
    if (missingSymbols.length === 0) return;
    
    // Mark as pending immediately
    missingSymbols.forEach(sym => fetchedIntradayRef.current.add(sym));
    lastFetchTimeRef.current = now;
    
    const fetchIntraday = async () => {
      try {
        console.log(`[Charts] Fetching sparklines for ${missingSymbols.length} stocks...`);
        const res = await fetch(`/api/intraday-sparklines?symbols=${missingSymbols.join(',')}`);
        if (!res.ok) {
          // Allow retry after cooldown if failed
          missingSymbols.forEach(sym => fetchedIntradayRef.current.delete(sym));
          return;
        }
        const data = await res.json();
        
        setHistoryMap(prev => {
          const next = { ...prev };
          Object.keys(data).forEach(sym => {
            if (data[sym] && data[sym].length > 2) {
              next[sym] = data[sym].slice(-50); 
            }
          });
          return next;
        });
      } catch (e) {
        missingSymbols.forEach(sym => fetchedIntradayRef.current.delete(sym));
      }
    };
    
    fetchIntraday();
  }, [viewMode, niftyData, midcapData, fnoMovers, historyMap]);

  const [selectedDate, setSelectedDate] = useState("");
  const [historicalData, setHistoricalData] = useState(null);
  const [histLoading, setHistLoading] = useState(false);
  const [histError, setHistError] = useState(null);
  const [histIndex, setHistIndex] = useState("nifty100");
  const [dateValidation, setDateValidation] = useState(null);

  const validateDate = useCallback(async (dateStr) => {
    if (!dateStr) { setDateValidation(null); return; }
    try {
      const res = await fetch(`/api/trading-day-check?date=${dateStr}`);
      const json = await res.json();
      setDateValidation(json);
    } catch {
      setDateValidation({ is_valid: false, message: "Could not validate date." });
    }
  }, []);

  const fetchHistorical = useCallback(async () => {
    if (!selectedDate || !dateValidation?.is_valid) return;
    setHistLoading(true);
    setHistError(null);
    setHistoricalData(null);
    try {
      const res = await fetch(`/api/historical-summary?date=${selectedDate}&index=${histIndex}&top_n=5`);
      const json = await res.json();
      if (!res.ok) {
        setHistError(json.detail?.message || "Failed to fetch historical data.");
      } else {
        setHistoricalData(json);
      }
    } catch {
      setHistError("Network error. Please check your connection.");
    } finally {
      setHistLoading(false);
    }
  }, [selectedDate, histIndex, dateValidation]);

  return (
    <div className="app-shell">
      {showBanner && (
        <div className="offline-notice">
          <span>⚠️ Connection Lost. Reconnecting to Market Stream...</span>
          <button className="retry-btn" onClick={handleManualRetry}>Retry Now</button>
        </div>
      )}

      {currentPage === 'home' ? (
        <div className="dashboard-plane">
          <header className="header">
            <div className="header-left">
              <div className="logo-mark">MP</div>
              <div className="header-title">
                <span className="title-main">Market Pulse</span>
                <span className="title-separator">•</span>
                <span className="title-sub">NSE Live Dashboard</span>
              </div>
            </div>
            
            <div className="header-center">
              <div className="view-toggle-container">
                <span className={`toggle-label ${viewMode === 'normal' ? 'active' : ''}`}>Normal</span>
                <button 
                  className={`view-toggle-switch ${viewMode === 'chart' ? 'on' : ''}`}
                  onClick={() => setViewMode(prev => prev === 'normal' ? 'chart' : 'normal')}
                >
                  <div className="toggle-handle" />
                </button>
                <span className={`toggle-label ${viewMode === 'chart' ? 'active' : ''}`}>Charts</span>
              </div>
            </div>

            <div className="header-right">
              <button 
                className="ai-insights-btn premium-btn"
                onClick={() => setCurrentPage('insights')}
              >
                ✨ Market Analyst
              </button>
              <button 
                className="scanner-nav-btn premium-btn-blue"
                onClick={() => setCurrentPage('scanner')}
              >
                ◉ Signal Scanner
              </button>
              <ConnectionDot status={wsStatus} />
              <MarketClock />
            </div>
          </header>

          <div className="section-header">
            <div className="section-title">
              <div className="section-line" style={{ background: 'var(--blue)' }} />
              NIFTY 100 SEGMENT
            </div>
          </div>
          <main className="panels-wrapper">
            <Panel title="Top Gainers" accent="green" data={niftyData.gainers} type="gainer" lastUpdated={lastUpdated} onStockClick={openExplain} viewMode={viewMode} historyMap={historyMap} />
            <Panel title="Top Losers" accent="red" data={niftyData.losers} type="loser" lastUpdated={lastUpdated} onStockClick={openExplain} viewMode={viewMode} historyMap={historyMap} />
          </main>

          <div className="section-header">
            <h2 className="section-title">Nifty Midcap 100</h2>
            <div className="section-line" style={{ background: '#a855f7' }} />
          </div>
          <main className="panels-wrapper">
            <Panel title="Top Gainers" accent="green" data={midcapData.gainers} type="gainer" lastUpdated={lastUpdated} onStockClick={openExplain} viewMode={viewMode} historyMap={historyMap} />
            <Panel title="Top Losers" accent="red" data={midcapData.losers} type="loser" lastUpdated={lastUpdated} onStockClick={openExplain} viewMode={viewMode} historyMap={historyMap} />
          </main>

          <div className="section-header">
            <h2 className="section-title">Equity F&O Segment</h2>
            <div className="section-line" style={{ background: '#f97316' }} />
          </div>
          <main className="panels-wrapper" style={{ marginBottom: '40px', display: 'block' }}>
            <FnoMoversTable 
              gainers={fnoMovers.gainers} 
              losers={fnoMovers.losers} 
              onStockClick={openExplain} 
            />
          </main>

          <MarketPulseHero niftyData={niftyData} midcapData={midcapData} />

          <div className="historical-explorer">
            <div className="hist-card">
              <div className="hist-controls-box">
                <div className="hist-field">
                  <span className="hist-label">Select Date</span>
                  <input 
                    type="date" 
                    className="hist-date-input"
                    value={selectedDate}
                    onChange={(e) => { setSelectedDate(e.target.value); validateDate(e.target.value); }}
                  />
                  {dateValidation && selectedDate && (
                    <div className={`trading-day-bubble ${dateValidation.is_valid ? 'bubble-valid' : 'bubble-invalid'}`}>
                      {dateValidation.is_valid ? "✓ Valid Trading Day" : `✗ ${dateValidation.message}`}
                    </div>
                  )}
                </div>

                <div className="hist-field">
                  <span className="hist-label">Market Index</span>
                  <div className="hist-btn-group">
                    <button className={histIndex === "nifty100" ? "active" : ""} onClick={() => { setHistIndex("nifty100"); setHistoricalData(null); }}>Nifty 100</button>
                    <button className={histIndex === "midcap100" ? "active" : ""} onClick={() => { setHistIndex("midcap100"); setHistoricalData(null); }}>Midcap 100</button>
                  </div>
                </div>

                <button 
                  className="hist-action-btn" 
                  onClick={fetchHistorical} 
                  disabled={!selectedDate || !dateValidation?.is_valid || histLoading}
                >
                  {histLoading ? "Loading..." : "Explore History"}
                </button>
              </div>

              {histError && <div style={{ color: "#ef4444", fontSize: "13px", textAlign: 'center', marginBottom: "24px", fontWeight: 600 }}>✗ Error: {histError}</div>}
              
              {historicalData && !histLoading && (
                <div className="panels-wrapper" style={{ padding: 0 }}>
                  <Panel 
                    title={`${histIndex === "nifty100" ? "Nifty 100" : "Midcap 100"} Gainers`} 
                    accent="green" 
                    data={historicalData.gainers} 
                    type="gainer" 
                    lastUpdated={selectedDate} 
                    viewMode="normal" 
                    historyMap={{}} 
                  />
                  <Panel 
                    title={`${histIndex === "nifty100" ? "Nifty 100" : "Midcap 100"} Losers`} 
                    accent="red" 
                    data={historicalData.losers} 
                    type="loser" 
                    lastUpdated={selectedDate} 
                    viewMode="normal" 
                    historyMap={{}} 
                  />
                </div>
              )}
            </div>
          </div>
        </div>
      ) : currentPage === 'insights' ? (
        <InsightsPage onBack={() => setCurrentPage('home')} wsStatus={wsStatus} />
      ) : (
        <SignalScanner onBack={() => setCurrentPage('home')} />
      )}

      <StockDeepDiveModal
        stock={activeStock}
        explanation={explanation}
        loading={loading}
        onClose={closeExplain}
      />
    </div>
  );
}
