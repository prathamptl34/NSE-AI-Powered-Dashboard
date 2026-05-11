import React, { useState, useEffect, useRef, useCallback } from "react";
import "./index.css";
import InsightsPage from "./InsightsPage";
import SignalScanner from "./SignalScanner";
import { useStockExplain, StockDeepDiveModal } from './StockDeepDive';
import FnoMoversTable from "./FnoMoversTable";
import HeatmapPage from "./Heatmap";
import MoversSection from "./MoversSection";

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

  const getX = (i) => (i / (data.length - 1)) * width;
  const getY = (val) => height - paddingY - ((val - min) / range) * (height - 2 * paddingY);

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
        <path d={areaD} fill={`url(#grad-${accent})`} />
        <path d={pathD} fill="none" stroke={color} strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" filter="url(#glow)" />
        {hoverIdx !== null && (
          <g>
            <line x1={getX(hoverIdx)} y1="0" x2={getX(hoverIdx)} y2={height} stroke="var(--text-muted)" strokeDasharray="3,3" opacity="0.6" strokeWidth="1" />
            <circle cx={getX(hoverIdx)} cy={getY(data[hoverIdx])} r="3.5" fill="var(--bg-main)" stroke={color} strokeWidth="2" />
          </g>
        )}
      </svg>
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

const StockCard = React.memo(function StockCard({ stock, rank, accent, onClick, viewMode, history }) {
  const [flashDir, setFlashDir] = useState(null);
  const prevPrice = useRef(stock.ltp);

  useEffect(() => {
    if (stock.ltp === prevPrice.current) return;
    const dir = stock.ltp > prevPrice.current ? 'up' : 'down';
    prevPrice.current = stock.ltp;
    setFlashDir(null);
    setTimeout(() => setFlashDir(dir), 50);
  }, [stock.ltp]);

  return (
    <StockCardInner
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

// ── App Component ─────────────────────────────────────────────────────────────

export default function App() {
  const { activeStock, explanation, loading, openExplain, closeExplain } = useStockExplain();
  const [activeSection, setActiveSection] = useState('dashboard');
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    try { return localStorage.getItem('mp_sidebar_collapsed') === 'true'; }
    catch { return false; }
  });
  const [niftyData, setNiftyData] = useState({ gainers: [], losers: [] });
  const [midcapData, setMidcapData] = useState({ gainers: [], losers: [] });
  const [fnoMovers, setFnoMovers] = useState({ gainers: [], losers: [] });
  const [moversData, setMoversData] = useState({ gainers: [], losers: [] });
  const [wsStatus, setWsStatus] = useState('offline');
  const [aiInsight, setAiInsight] = useState(null);
  const [aiSignal, setAiSignal] = useState(null);
  const [lastUpdated, setLastUpdated] = useState(null);
  const [viewMode] = useState('normal');
  const [historyMap] = useState({});
  const wsRef = useRef(null);

  const toggleSidebar = useCallback(() => {
    setSidebarCollapsed(prev => {
      const next = !prev;
      try { localStorage.setItem('mp_sidebar_collapsed', String(next)); } catch {}
      return next;
    });
  }, []);

  const navItems = [
    { key: 'dashboard', label: 'Dashboard',      icon: '📊' },
    { key: 'analyst',   label: 'Market Analyst', icon: '✨' },
    { key: 'scanner',   label: 'Signal Scanner', icon: '◉' },
    { key: 'heatmap',   label: 'Heatmap',        icon: '🔥' },
    { key: 'movers',    label: 'Movers Alert',   icon: '⚡' },
  ];

  // ── Sidebar ────────────────────────────────────────────────────────────────
  const Sidebar = ({ activeSection, setActiveSection, wsStatus, collapsed, onToggle }) => (
    <div className={`sidebar ${collapsed ? 'sidebar-collapsed' : ''}`}>
      <div className="sidebar-header">
        <div className="sidebar-brand">
          <div className="sidebar-logo">MP</div>
          <div className="sidebar-wordmark">Market Pulse</div>
        </div>
        <div className="sidebar-badge">NSE LIVE</div>
        <div className="sidebar-status">
          <ConnectionDot status={wsStatus} />
          <div className="sidebar-clock"><MarketClock /></div>
        </div>
      </div>

      <div className="sidebar-nav">
        {navItems.map(item => (
          <div
            key={item.key}
            className={`nav-item ${activeSection === item.key ? 'active' : ''} ${collapsed ? 'nav-item-collapsed' : ''}`}
            onClick={() => setActiveSection(item.key)}
            data-tooltip={item.label}
          >
            <span className="nav-icon">{item.icon}</span>
            <span className="nav-label">{item.label}</span>
          </div>
        ))}
      </div>

      <div className="sidebar-footer">
        <span className="sidebar-version">v2.0</span>
      </div>

      {/* Toggle button */}
      <button className={`sidebar-toggle-btn ${collapsed ? 'is-collapsed' : ''}`} onClick={onToggle} aria-label="Toggle sidebar">
      </button>
    </div>
  );

  const MobileHeader = ({ activeSection, wsStatus }) => {
    const currentNav = navItems.find(i => i.key === activeSection);
    return (
      <div className="mobile-header">
        <div className="mobile-header-left">
          <div className="logo-mark">MP</div>
        </div>
        <div className="mobile-header-center">
          {currentNav ? `${currentNav.icon} ${currentNav.label}` : 'Dashboard'}
        </div>
        <div className="mobile-header-right">
          <div className={`conn-dot conn-${wsStatus}`} style={{ padding: 0 }}><span className="dot-inner" /></div>
          <div className="sidebar-clock" style={{ fontSize: '10px' }}><MarketClock /></div>
        </div>
      </div>
    );
  };

  const BottomTabs = ({ activeSection, setActiveSection }) => (
    <div className="bottom-tabs">
      {navItems.map(item => (
        <div
          key={item.key}
          className={`tab-item ${activeSection === item.key ? 'active' : ''}`}
          onClick={() => setActiveSection(item.key)}
        >
          <span className="tab-icon">{item.icon}</span>
          <span className="tab-label">
            {item.key === 'dashboard' ? 'Home' :
             item.key === 'movers'    ? 'Movers' :
             item.label.split(' ')[1] || item.label}
          </span>
        </div>
      ))}
    </div>
  );

  const fetchData = useCallback(async () => {
    const fetchWithFallback = async (path) => {
      try {
        let res;
        try { res = await fetch(path); }
        catch (e) { res = await fetch(`http://127.0.0.1:8001${path}`); }
        if (!res.ok) return null;
        const contentType = res.headers.get("content-type");
        if (!contentType || !contentType.includes("application/json")) return null;
        return await res.json();
      } catch (e) { return null; }
    };

    const summary = await fetchWithFallback("/api/market-summary");
    if (summary) {
      setNiftyData(summary.nifty100 || { gainers: [], losers: [] });
      setMidcapData(summary.midcap100 || { gainers: [], losers: [] });
      setLastUpdated(formatIST());
    }

    const fno = await fetchWithFallback("/api/fno-movers");
    if (fno) setFnoMovers({ gainers: fno.gainers || [], losers: fno.losers || [] });

    const ai = await fetchWithFallback("/api/ai-insight");
    if (ai) {
      if (ai.insight) setAiInsight(ai.insight);
      if (ai.signal) setAiSignal(ai.signal);
    }

    const movers = await fetchWithFallback("/api/movers");
    if (movers) setMoversData(movers);
  }, []);

  const [showBanner, setShowBanner] = useState(false);
  const bannerTimerRef = useRef(null);
  const reconnectTimerRef = useRef(null);

  useEffect(() => {
    fetchData();
    const pollId = setInterval(fetchData, 2000);

    const connectWS = () => {
      if (wsRef.current && (wsRef.current.readyState === 0 || wsRef.current.readyState === 1)) return;
      try {
        const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const isDev = window.location.port === '3000';
        const backendHost = isDev ? '127.0.0.1:8001' : window.location.host;
        const ws = new WebSocket(`${proto}//${backendHost}/ws/stream`);
        wsRef.current = ws;

        ws.onopen = () => {
          setWsStatus('live');
          setShowBanner(false);
          if (bannerTimerRef.current) clearTimeout(bannerTimerRef.current);
        };

        ws.onmessage = (e) => {
          try {
            const msg = JSON.parse(e.data);
            if (msg.type === 'ping') return;
            if (msg.type === 'full_update' || msg.type === 'partial_update') {
              if (msg.index === 'nifty100') setNiftyData({ gainers: msg.gainers || [], losers: msg.losers || [] });
              else if (msg.index === 'midcap100') setMidcapData({ gainers: msg.gainers || [], losers: msg.losers || [] });
              if (msg.fno_movers) setFnoMovers({ gainers: msg.fno_movers.gainers || [], losers: msg.fno_movers.losers || [] });
              if (msg.movers) setMoversData(msg.movers);
              setLastUpdated(formatIST());
              setWsStatus('live');
              setShowBanner(false);
              if (bannerTimerRef.current) clearTimeout(bannerTimerRef.current);
            }
          } catch (err) {}
        };

        ws.onclose = () => {
          setWsStatus('offline');
          wsRef.current = null;
          if (!bannerTimerRef.current) {
            bannerTimerRef.current = setTimeout(() => setShowBanner(true), 7000);
          }
          reconnectTimerRef.current = setTimeout(connectWS, 3000);
        };

        ws.onerror = () => { setWsStatus('offline'); ws.close(); };
      } catch (e) {
        reconnectTimerRef.current = setTimeout(connectWS, 5000);
      }
    };

    connectWS();

    return () => {
      clearInterval(pollId);
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
      if (bannerTimerRef.current) clearTimeout(bannerTimerRef.current);
      if (wsRef.current) { wsRef.current.onclose = null; wsRef.current.close(); }
    };
  }, [fetchData]);

  const handleManualRetry = () => {
    fetchData();
    if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
  };

  const sidebarWidth = sidebarCollapsed ? 64 : 220;

  return (
    <div className="app-shell">
      <Sidebar
        activeSection={activeSection}
        setActiveSection={setActiveSection}
        wsStatus={wsStatus}
        collapsed={sidebarCollapsed}
        onToggle={toggleSidebar}
      />
      <MobileHeader activeSection={activeSection} wsStatus={wsStatus} />

      <main
        className="main-content"
        style={{ '--sidebar-w': `${sidebarWidth}px` }}
      >
        {showBanner && (
          <div className="offline-notice">
            <span>⚠️ Connection Lost. Reconnecting to Market Stream...</span>
            <button className="retry-btn" onClick={handleManualRetry}>Retry Now</button>
          </div>
        )}

        {/* SECTION 0: DASHBOARD (DEFAULT) */}
        {activeSection === 'dashboard' && (
          <div id="section-dashboard" className="content-fade-in section-content">
            <div className="section-page-header">
              <div className="section-page-title">
                <span className="section-page-icon">📊</span>
                <div>
                  <div className="section-page-name">Dashboard</div>
                  <div className="section-page-sub">NSE LIVE · TOP MOVERS</div>
                </div>
              </div>
            </div>
            <div className="section-divider-line" />

            <div className="section-header-compact">
              <div className="section-title">
                <div className="section-line" style={{ background: 'var(--blue)' }} />
                NIFTY 100 SEGMENT
              </div>
            </div>
            <div className="panels-wrapper">
              <Panel title="Top Gainers" accent="green" data={niftyData.gainers} type="gainer" lastUpdated={lastUpdated} onStockClick={openExplain} viewMode={viewMode} historyMap={historyMap} />
              <Panel title="Top Losers" accent="red" data={niftyData.losers} type="loser" lastUpdated={lastUpdated} onStockClick={openExplain} viewMode={viewMode} historyMap={historyMap} />
            </div>

            <div className="section-header-compact">
              <div className="section-title">
                <div className="section-line" style={{ background: '#a855f7' }} />
                NIFTY MIDCAP 100
              </div>
            </div>
            <div className="panels-wrapper">
              <Panel title="Top Gainers" accent="green" data={midcapData.gainers} type="gainer" lastUpdated={lastUpdated} onStockClick={openExplain} viewMode={viewMode} historyMap={historyMap} />
              <Panel title="Top Losers" accent="red" data={midcapData.losers} type="loser" lastUpdated={lastUpdated} onStockClick={openExplain} viewMode={viewMode} historyMap={historyMap} />
            </div>

            <div className="section-header-compact">
              <div className="section-title">
                <div className="section-line" style={{ background: '#f97316' }} />
                EQUITY F&O SEGMENT
              </div>
            </div>
            <div className="panels-wrapper fno-bottom-panel">
              <FnoMoversTable gainers={fnoMovers.gainers} losers={fnoMovers.losers} onStockClick={openExplain} />
            </div>
          </div>
        )}

        {/* SECTION 1: MARKET ANALYST */}
        {activeSection === 'analyst' && (
          <div id="section-analyst" className="content-fade-in section-content">
            <div className="section-page-header">
              <div className="section-page-title">
                <span className="section-page-icon">✨</span>
                <div>
                  <div className="section-page-name">Market Analyst</div>
                  <div className="section-page-sub">AI-POWERED · MIXTRAL-8X7B · GROQ</div>
                </div>
              </div>
            </div>
            <div className="section-divider-line" />
            <InsightsPage onBack={() => setActiveSection('dashboard')} wsStatus={wsStatus} standalone={true} />
          </div>
        )}

        {/* SECTION 2: SIGNAL SCANNER */}
        {activeSection === 'scanner' && (
          <div id="section-scanner" className="content-fade-in section-content">
            <div className="section-page-header">
              <div className="section-page-title">
                <span className="section-page-icon">◉</span>
                <div>
                  <div className="section-page-name">Signal Scanner</div>
                  <div className="section-page-sub">200 STOCKS · AI SIGNALS</div>
                </div>
              </div>
            </div>
            <div className="section-divider-line" />
            <SignalScanner standalone={true} />
          </div>
        )}

        {/* SECTION 3: HEATMAP */}
        {activeSection === 'heatmap' && (
          <div id="section-heatmap" className="content-fade-in">
            <HeatmapPage wsStatus={wsStatus} standalone={true} />
          </div>
        )}

        {/* SECTION 4: MOVERS ALERT */}
        {activeSection === 'movers' && (
          <div id="section-movers" className="content-fade-in section-content">
            <div className="section-page-header">
              <div className="section-page-title">
                <span className="section-page-icon">⚡</span>
                <div>
                  <div className="section-page-name">Movers Alert</div>
                  <div className="section-page-sub">STOCKS MOVING ±3%</div>
                </div>
              </div>
            </div>
            <div className="section-divider-line" />
            <MoversSection moversData={moversData} standalone={true} />
          </div>
        )}
      </main>

      <BottomTabs activeSection={activeSection} setActiveSection={setActiveSection} />

      <StockDeepDiveModal
        stock={activeStock}
        explanation={explanation}
        loading={loading}
        onClose={closeExplain}
      />
    </div>
  );
}

// Move Panel outside App to avoid recreation
function Panel({ title, accent, data, type, lastUpdated, onStockClick, viewMode, historyMap }) {
  const items = data ? data.slice(0, 5) : [];
  return (
    <section className={`panel panel-${accent}`}>
      <div className="panel-header">
        <span className="panel-icon">{type === 'gainer' ? '▲' : '▼'}</span>
        <h2 className="panel-title">{title}</h2>
        <span className="panel-count">{items.length} stocks</span>
      </div>
      <div className="panel-body">
        <div className="stock-table-header">
          <span className="th-rank">#</span>
          <span className="th-symbol">SYMBOL</span>
          <span className="th-price">PRICE</span>
          <span className="th-change">CHANGE</span>
        </div>
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
