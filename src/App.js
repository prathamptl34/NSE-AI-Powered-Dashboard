import React, { useState, useEffect, useRef, useCallback } from "react";
import "./index.css";
import InsightsPage from "./InsightsPage";
import SignalScanner from "./SignalScanner";
import { useStockExplain, StockDeepDiveModal } from './StockDeepDive';

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

  // Smoothing function for professional curves
  const getX = (i) => (i / (data.length - 1)) * width;
  const getY = (val) => height - paddingY - ((val - min) / range) * (height - 2 * paddingY);

  // Generate smooth bezier curve path
  let pathD = `M ${getX(0)},${getY(data[0])}`;
  for (let i = 1; i < data.length; i++) {
    const currX = getX(i);
    const currY = getY(data[i]);
    const prevX = getX(i - 1);
    const prevY = getY(data[i - 1]);
    const cpX = (prevX + currX) / 2;
    pathD += ` C ${cpX},${prevY} ${cpX},${currY} ${currX},${currY}`;
  }

  const areaD = `${pathD} L ${width},${height} L 0,${height} Z`;
  const color = accent === 'green' ? '#10b981' : '#ef4444';

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
        
        {/* Smooth Line */}
        <path d={pathD} fill="none" stroke={color} strokeWidth="2" filter="url(#glow)" />

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

const StockCard = React.memo(function StockCard({ stock, rank, accent, onClick, viewMode, history }) {
  const [flash, setFlash] = useState(null);
  const prevPrice = useRef(stock.ltp);

  useEffect(() => {
    if (stock.ltp === prevPrice.current) return;
    const dir = stock.ltp > prevPrice.current ? 'up' : 'down';
    setFlash(dir);
    prevPrice.current = stock.ltp;
    const t = setTimeout(() => setFlash(null), 600);
    return () => clearTimeout(t);
  }, [stock.ltp]);

  return (
    <div
      className={`stock-card ${viewMode === 'chart' ? 'card-chart-mode' : ''} flash-${flash || 'none'}`}
      style={{ animationDelay: `${rank * 0.04}s`, cursor: 'pointer', display: 'flex', alignItems: 'center' }}
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
});

function Panel({ title, accent, data, type, lastUpdated, onStockClick, viewMode, historyMap }) {
  return (
    <section className={`panel panel-${accent}`}>
      <div className="panel-header">
        <span className="panel-icon">{type === 'gainer' ? '▲' : '▼'}</span>
        <h2 className="panel-title">{title}</h2>
        <span className="panel-count">{data ? data.length : 0} stocks</span>
      </div>
      <div className="panel-body">
        {!data || data.length === 0
          ? <SkeletonList count={5} />
          : data.map((s, i) => (
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
  const { activeStock, explanation, loading, openExplain, closeExplain } = useStockExplain();
  const [currentPage, setCurrentPage] = useState('home');
  const [niftyData, setNiftyData] = useState({ gainers: [], losers: [] });
  const [midcapData, setMidcapData] = useState({ gainers: [], losers: [] });
  const [liveCount, setLiveCount] = useState(0);
  const [wsStatus, setWsStatus] = useState('offline');
  const [lastUpdated, setLastUpdated] = useState('');

  // ── Perspective View Mode
  const [viewMode, setViewMode] = useState('normal'); // 'normal' | 'chart'
  const [historyMap, setHistoryMap] = useState({}); // { symbol: [prices...] }

  const fetchedIntradayRef = useRef(new Set());

  useEffect(() => {
    if (viewMode !== 'chart') return;
    
    const all = [...niftyData.gainers, ...niftyData.losers, ...midcapData.gainers, ...midcapData.losers];
    const missingSymbols = all
      .map(s => s.symbol)
      .filter(sym => !fetchedIntradayRef.current.has(sym) && (!historyMap[sym] || historyMap[sym].length <= 2));
      
    if (missingSymbols.length === 0) return;
    
    missingSymbols.forEach(sym => fetchedIntradayRef.current.add(sym));
    
    const fetchIntraday = async () => {
      try {
        const res = await fetch(`/api/intraday-sparklines?symbols=${missingSymbols.join(',')}`);
        if (!res.ok) return;
        const data = await res.json();
        
        setHistoryMap(prev => {
          const next = { ...prev };
          Object.keys(data).forEach(sym => {
            if (data[sym] && data[sym].length > 2) {
              // Intraday API gives 5-min candles, keep up to last 50 for the chart
              next[sym] = data[sym].slice(-50); 
            }
          });
          return next;
        });
      } catch (e) {
        console.error("Fetch intraday error", e);
      }
    };
    
    fetchIntraday();
  }, [viewMode, niftyData, midcapData, historyMap]);

  const updateHistory = useCallback((stocks) => {
    setHistoryMap(prev => {
      const next = { ...prev };
      stocks.forEach(s => {
        let h = next[s.symbol];
        
        if (!h) {
          h = s.prev_close ? [s.prev_close, s.ltp] : [s.ltp, s.ltp];
        } 
        else if (h[h.length - 1] !== s.ltp) {
          h = [...h, s.ltp].slice(-50); 
        }
        
        next[s.symbol] = h;
      });
      return next;
    });
  }, []);

  // ── Historical State
  const [selectedDate, setSelectedDate] = useState("");
  const [historicalData, setHistoricalData] = useState(null);
  const [histLoading, setHistLoading] = useState(false);
  const [histError, setHistError] = useState(null);
  const [histIndex, setHistIndex] = useState("nifty100");
  const [dateValidation, setDateValidation] = useState(null);

  // Fallback Polling
  const fetchData = useCallback(async () => {
    try {
      const res = await fetch("/api/market-summary");
      if (!res.ok) return;
      const json = await res.json();
      
      const nData = json.nifty100 || { gainers: [], losers: [] };
      const mData = json.midcap100 || { gainers: [], losers: [] };

      setNiftyData(nData);
      setMidcapData(mData);
      setLiveCount(json.total_tokens_tracked || 0);
      setLastUpdated(formatIST());
      
      // Update history for all stocks
      if (viewMode === 'chart') {
        const all = [...nData.gainers, ...nData.losers, ...mData.gainers, ...mData.losers];
        updateHistory(all);
      }

      if (wsStatus !== 'live') setWsStatus('live');
    } catch {
      setWsStatus('offline');
    }
  }, [wsStatus, viewMode, updateHistory]);

  useEffect(() => {
    fetchData();
    // Faster polling fallback (2s) if WebSocket is not 'live', otherwise stay quiet (10s)
    const id = setInterval(fetchData, wsStatus === 'live' ? 10000 : 2000);

    let ws;
    try {
      const proto  = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      let wsHost = window.location.host;
      if (wsHost.includes('localhost') || wsHost.includes('127.0.0.1')) {
        // Use localhost explicitly for local development
        wsHost = 'localhost:8000'; 
      }
      const wsUrl  = `${proto}//${wsHost}/ws/stream`;
      console.log('Connecting to WS:', wsUrl);

      ws = new WebSocket(wsUrl);
      ws.onopen  = () => setWsStatus('live');
      ws.onclose = () => {};
      ws.onerror = () => {};
      ws.onmessage = (e) => {
        try {
          const msg = JSON.parse(e.data);
          if (msg.type === 'partial_update' || msg.type === 'full_update') {
            const currentData = { gainers: msg.gainers || [], losers: msg.losers || [] };
            
            if (msg.index === 'nifty100') {
              setNiftyData(currentData);
            } else if (msg.index === 'midcap100') {
              setMidcapData(currentData);
            } else {
              setNiftyData(currentData);
            }

            if (viewMode === 'chart') {
              updateHistory([...currentData.gainers, ...currentData.losers]);
            }

            setLastUpdated(formatIST());
          }
        } catch (err) {}
      };
    } catch (e) {}

    return () => {
      clearInterval(id);
      if (ws) ws.close();
    };
  }, [fetchData]);

  // ── Historical Handlers
  const validateDate = useCallback(async (dateStr) => {
    if (!dateStr) { setDateValidation(null); return; }
    try {
      const res  = await fetch(`/api/trading-day-check?date=${dateStr}`);
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
      const res  = await fetch(
        `/api/historical-summary?date=${selectedDate}&index=${histIndex}&top_n=5`
      );
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
      {currentPage === 'home' ? (
        <div className="dashboard-plane">
          <header className="header">
            <div className="header-left">
              <div className="logo-mark">MP</div>
              <div className="header-title">
                <span className="title-main">Market Pulse</span>
                <span className="title-sub">NSE · Live Dashboard</span>
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
                className="ai-insights-btn"
                onClick={() => setCurrentPage('insights')}
              >
                AI Insights
              </button>
              <button 
                className="scanner-nav-btn"
                onClick={() => setCurrentPage('scanner')}
              >
                ◉ Signal Scanner
              </button>
              <ConnectionDot status={wsStatus} />
              <MarketClock />
            </div>
          </header>

          {/* LIVE BOARDS */}
          <div className="section-label">
            <span className="label-dot" />
            Nifty 100
          </div>
          <main className="panels-wrapper">
            <Panel 
              title="Top Gainers" 
              accent="green" 
              data={niftyData.gainers} 
              type="gainer" 
              lastUpdated={lastUpdated} 
              onStockClick={openExplain} 
              viewMode={viewMode}
              historyMap={historyMap}
            />
            <Panel 
              title="Top Losers"  
              accent="red"   
              data={niftyData.losers}  
              type="loser" 
              lastUpdated={lastUpdated} 
              onStockClick={openExplain} 
              viewMode={viewMode}
              historyMap={historyMap}
            />
          </main>

          <div className="section-label">
            <span className="label-dot" style={{ background: '#7c3aed' }} />
            Nifty Midcap 100
          </div>
          <main className="panels-wrapper" style={{ marginBottom: '32px' }}>
            <Panel 
              title="Top Gainers" 
              accent="green" 
              data={midcapData.gainers} 
              type="gainer" 
              lastUpdated={lastUpdated} 
              onStockClick={openExplain} 
              viewMode={viewMode}
              historyMap={historyMap}
            />
            <Panel 
              title="Top Losers"  
              accent="red"   
              data={midcapData.losers}  
              type="loser" 
              lastUpdated={lastUpdated} 
              onStockClick={openExplain} 
              viewMode={viewMode}
              historyMap={historyMap}
            />
          </main>

          {/* HISTORICAL DAY VIEW */}
          <div className="historical-layer">
            <div className="historical-header">Historical Day View</div>
            <div className="hist-controls">
              <div>
                <span className="hist-label">Select Date</span>
                <input
                  type="date"
                  className="hist-input"
                  value={selectedDate}
                  max={new Date().toISOString().split("T")[0]}
                  onChange={(e) => {
                    setSelectedDate(e.target.value);
                    setHistoricalData(null);
                    setHistError(null);
                    validateDate(e.target.value);
                  }}
                />
                {dateValidation && selectedDate && (
                  <div style={{
                    fontSize: "12px",
                    color: dateValidation.is_valid ? "var(--green)" : "var(--red)",
                    marginTop: "6px",
                    fontWeight: 500
                  }}>
                    {dateValidation.is_valid ? "✓ Valid trading day" : `✗ ${dateValidation.message}`}
                  </div>
                )}
              </div>

              <div>
                <span className="hist-label">Index</span>
                <div className="hist-btn-group">
                  <button
                    className={histIndex === "nifty100" ? "active" : ""}
                    onClick={() => { setHistIndex("nifty100"); setHistoricalData(null); }}
                  >
                    Nifty 100
                  </button>
                  <button
                    className={histIndex === "midcap100" ? "active" : ""}
                    onClick={() => { setHistIndex("midcap100"); setHistoricalData(null); }}
                  >
                    Midcap 100
                  </button>
                </div>
              </div>

              <div>
                <button
                  className="hist-action-btn"
                  onClick={fetchHistorical}
                  disabled={!selectedDate || !dateValidation?.is_valid || histLoading}
                >
                  {histLoading ? "Loading..." : "Load Day"}
                </button>
              </div>

              {historicalData?.cached && (
                  <div style={{ marginLeft: "auto", fontSize: "12px", color: "var(--green)", fontWeight: 500 }}>
                    ⚡ From cache
                  </div>
              )}
            </div>

            {histError && (
              <div style={{ color: "var(--red)", fontSize: "13px", marginBottom: "16px", fontWeight: 500 }}>
                ✗ {histError}
              </div>
            )}

            {(historicalData && !histLoading) && (
              <div className="panels-wrapper" style={{ padding: 0 }}>
                <Panel
                  title="Top Gainers"
                  accent="green"
                  data={historicalData.gainers}
                  type="gainer"
                  lastUpdated={formatIST(new Date())}
                  viewMode="normal"
                  historyMap={{}}
                />
                <Panel
                  title="Top Losers"
                  accent="red"
                  data={historicalData.losers}
                  type="loser"
                  lastUpdated={formatIST(new Date())}
                  viewMode="normal"
                  historyMap={{}}
                />
              </div>
            )}
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
