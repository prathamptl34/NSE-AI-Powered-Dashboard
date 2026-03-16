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

const StockCard = React.memo(function StockCard({ stock, rank, accent, onClick }) {
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
      className={`stock-card flash-${flash || 'none'}`}
      style={{ animationDelay: `${rank * 0.04}s`, cursor: 'pointer' }}
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

      <div className="stock-meta">
        <span className="stock-symbol">{stock.symbol}</span>
        <span className="stock-exchange">NSE</span>
      </div>

      <div className="stock-price-block">
        <span className="stock-price">₹{formatINR(stock.ltp)}</span>
        <span className="stock-prev">prev ₹{formatINR(stock.prev_close)}</span>
      </div>

      <div className={`change-badge change-${accent}`}>
        <span className="change-arrow">{accent === 'green' ? '▲' : '▼'}</span>
        <span className="change-pct">{Math.abs(stock.change_pct).toFixed(2)}%</span>
      </div>
    </div>
  );
});

function Panel({ title, accent, data, type, lastUpdated, onStockClick }) {
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
      setNiftyData(json.nifty100 || { gainers: [], losers: [] });
      setMidcapData(json.midcap100 || { gainers: [], losers: [] });
      setLiveCount(json.total_tokens_tracked || 0);
      setLastUpdated(formatIST());
      if (wsStatus !== 'live') setWsStatus('live');
    } catch {
      setWsStatus('offline');
    }
  }, [wsStatus]);

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
            if (msg.index === 'nifty100') {
              setNiftyData({ gainers: msg.gainers || [], losers: msg.losers || [] });
            } else if (msg.index === 'midcap100') {
              setMidcapData({ gainers: msg.gainers || [], losers: msg.losers || [] });
            } else {
              setNiftyData({ gainers: msg.gainers || [], losers: msg.losers || [] });
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
            <div className="header-center" style={{ flex: 1, display: 'flex', justifyContent: 'center' }}>
              <MarketClock />
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
              <span className="symbol-count">{liveCount > 0 ? liveCount : '200'} symbols</span>
            </div>
          </header>

          {/* NIFTY 100 */}
          <div className="section-label">
            <span className="label-dot" />
            Nifty 100
          </div>
          <main className="panels-wrapper">
            <Panel title="Top Gainers" accent="green" data={niftyData.gainers} type="gainer" lastUpdated={lastUpdated} onStockClick={openExplain} />
            <Panel title="Top Losers"  accent="red"   data={niftyData.losers}  type="loser" lastUpdated={lastUpdated} onStockClick={openExplain} />
          </main>

          {/* NIFTY MIDCAP 100 */}
          <div className="section-label">
            <span className="label-dot" style={{ background: '#7c3aed' }} />
            Nifty Midcap 100
          </div>
          <main className="panels-wrapper" style={{ marginBottom: '32px' }}>
            <Panel title="Top Gainers" accent="green" data={midcapData.gainers} type="gainer" lastUpdated={lastUpdated} onStockClick={openExplain} />
            <Panel title="Top Losers"  accent="red"   data={midcapData.losers}  type="loser" lastUpdated={lastUpdated} onStockClick={openExplain} />
          </main>

          {/* HISTORICAL DAY VIEW */}
          <div className="historical-layer">
            <div className="historical-header">
              Historical Day View
            </div>

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
                />
                <Panel
                  title="Top Losers"
                  accent="red"
                  data={historicalData.losers}
                  type="loser"
                  lastUpdated={formatIST(new Date())}
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
