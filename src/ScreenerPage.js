import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import './screener.css';

// ─── Field Definitions (plain-English labels) ────────────────────────────────
const FILTER_FIELDS = [
  // Price & Returns
  { key: 'last_price',    label: 'Stock Price (₹)',         category: '📊 Price & Returns',     type: 'number', defaultOp: '>',  defaultVal: 100,   tooltip: 'The current trading price of the stock in Indian Rupees' },
  { key: 'pct_change',    label: '% Price Change Today',    category: '📊 Price & Returns',     type: 'number', defaultOp: '>',  defaultVal: 2,     tooltip: 'How much the stock price has moved today in percentage' },
  { key: 'pct_from_52h',  label: 'Distance from 52W High', category: '📊 Price & Returns',     type: 'number', defaultOp: '>',  defaultVal: -5,    tooltip: '0 means at the high. -10 means 10% below its yearly peak' },
  { key: 'pct_from_52l',  label: 'Distance from 52W Low',  category: '📊 Price & Returns',     type: 'number', defaultOp: '>',  defaultVal: 10,    tooltip: '0 means at the low. 20 means 20% above its yearly trough' },
  // Volume
  { key: 'volume_ratio',  label: 'Volume vs Average',       category: '📦 Volume',              type: 'number', defaultOp: '>',  defaultVal: 2,     tooltip: '1.0 = normal buying. 2.0 = double the usual volume. 3+ = very high activity' },
  { key: 'volume',        label: 'Volume (shares)',          category: '📦 Volume',              type: 'number', defaultOp: '>',  defaultVal: 500000, tooltip: 'Total number of shares traded today' },
  // Momentum
  { key: 'rsi_14',        label: 'RSI (Momentum Score)',    category: '📉 Momentum Indicators', type: 'number', defaultOp: '<',  defaultVal: 30,    tooltip: 'Below 30 = oversold (may be cheap). Above 70 = overbought (may be expensive). 50 = neutral' },
  { key: 'macd_histogram', label: 'MACD Signal Strength',  category: '📉 Momentum Indicators', type: 'number', defaultOp: '>',  defaultVal: 0,     tooltip: 'Positive = bullish momentum building. Negative = selling pressure' },
  { key: 'adx_14',        label: 'Trend Strength (ADX)',   category: '📉 Momentum Indicators', type: 'number', defaultOp: '>',  defaultVal: 25,    tooltip: 'Above 25 = strong trend. Below 20 = sideways/ranging market' },
  // Trend
  { key: 'ema_20',        label: '20-Day Trend Line',       category: '📈 Trend Indicators',    type: 'number', defaultOp: '>',  defaultVal: 0,     tooltip: 'Short-term trend direction. Buy if price is above this line' },
  { key: 'ema_50',        label: '50-Day Trend Line',       category: '📈 Trend Indicators',    type: 'number', defaultOp: '>',  defaultVal: 0,     tooltip: 'Medium-term trend. A key level that traders watch closely' },
  { key: 'ema_200',       label: '200-Day Trend Line',      category: '📈 Trend Indicators',    type: 'number', defaultOp: '>',  defaultVal: 0,     tooltip: 'Long-term trend. If price is above this, the stock is in a bull market' },
  { key: 'supertrend',    label: 'Supertrend Direction',    category: '📈 Trend Indicators',    type: 'select', defaultOp: '=',  defaultVal: 'BUY', tooltip: 'BUY = uptrend signal. SELL = downtrend signal', options: [{value:'BUY',label:'BUY (Uptrend)'},{value:'SELL',label:'SELL (Downtrend)'}] },
  // Fundamentals
  { key: 'market_cap',    label: 'Market Cap (Cr)',         category: '🏢 Fundamentals',        type: 'number', defaultOp: '>',  defaultVal: 5000,  tooltip: 'Company size in Crores. Large cap = 20,000+ Cr. Mid cap = 5,000–20,000 Cr' },
];

const TIMEFRAMES = [
  { key: '5min',  label: '5 Min',   tooltip: 'Short-term scalping signals' },
  { key: '15min', label: '15 Min',  tooltip: 'Intraday swing signals' },
  { key: '1hr',   label: '1 Hour',  tooltip: 'Positional trade signals' },
  { key: '1day',  label: '1 Day',   tooltip: 'Best for most traders. Daily trend signals', recommended: true },
];

// Plain-english summary generator for stock slide-in panel
function buildStockSummary(stock) {
  const parts = [];
  const chg = parseFloat(stock.pct_change || 0);
  const rsi = parseFloat(stock.rsi_14 || 50);
  const vr = parseFloat(stock.volume_ratio || 1);
  const sig = (stock.supertrend || '').toUpperCase();

  if (chg > 2) parts.push('moving up strongly today');
  else if (chg > 0) parts.push('slightly up today');
  else if (chg < -2) parts.push('falling significantly today');
  else parts.push('relatively flat today');

  if (vr > 3) parts.push('with very high buying activity (volume spike)');
  else if (vr > 1.5) parts.push('with above-average trading volume');

  if (rsi < 30) parts.push('RSI is oversold — could be a good entry point');
  else if (rsi > 70) parts.push('RSI is overbought — use caution');

  if (sig === 'BUY') parts.push('trend signal is bullish');
  else if (sig === 'SELL') parts.push('trend signal is bearish');

  return 'This stock is ' + parts.join(', ') + '.';
}

function formatAge(seconds) {
  if (seconds === null || seconds === undefined) return 'never';
  if (seconds < 60) return `${seconds}s ago`;
  const mins = Math.floor(seconds / 60);
  if (mins < 60) return `${mins} min ago`;
  return `${Math.floor(mins / 60)}h ago`;
}

function formatNextRefresh(ageSeconds) {
  if (ageSeconds === null || ageSeconds === undefined) return 'soon';
  const remaining = Math.max(0, 300 - ageSeconds);
  if (remaining < 60) return `${remaining}s`;
  return `${Math.floor(remaining / 60)} min`;
}

function cleanSymbol(raw) {
  if (!raw) return raw;
  return raw.replace(/NSE$/i, '').replace(/BSE$/i, '').replace(/-EQ$/i, '').trim();
}

// ─── Tooltip Component ────────────────────────────────────────────────────────
function InfoTooltip({ text }) {
  const [visible, setVisible] = useState(false);
  return (
    <span
      className="sc-info-icon"
      onMouseEnter={() => setVisible(true)}
      onMouseLeave={() => setVisible(false)}
    >
      ⓘ
      {visible && <span className="sc-tooltip-bubble">{text}</span>}
    </span>
  );
}

// ─── Stock Detail Panel ───────────────────────────────────────────────────────
function StockDetailPanel({ stock, onClose }) {
  if (!stock) return null;
  const isUp = stock.pct_change >= 0;
  const rsi = parseFloat(stock.rsi_14 || 50);
  const rsiColor = rsi >= 70 ? '#ff4444' : rsi <= 30 ? '#00ff88' : '#aaa';
  const sig = (stock.supertrend || 'NEUTRAL').toUpperCase();

  return (
    <div className="sc-detail-overlay" onClick={onClose}>
      <div className="sc-detail-panel" onClick={e => e.stopPropagation()}>
        <button className="sc-detail-close" onClick={onClose}>✕</button>
        <div className="sc-detail-symbol">{cleanSymbol(stock.symbol)}</div>
        <div className="sc-detail-exch">{stock.exchange || 'NSE'} · {stock.sector || ''}</div>

        <div className="sc-detail-price">
          <span className="sc-detail-ltp">₹{parseFloat(stock.last_price || 0).toFixed(2)}</span>
          <span className={`sc-detail-chg ${isUp ? 'up' : 'dn'}`}>
            {isUp ? '▲' : '▼'} {Math.abs(stock.pct_change || 0).toFixed(2)}%
          </span>
        </div>

        <div className="sc-detail-grid">
          <div className="sc-detail-kv">
            <span className="sc-kv-label">Volume Activity</span>
            <span className="sc-kv-val">{parseFloat(stock.volume_ratio || 1).toFixed(1)}x avg</span>
          </div>
          <div className="sc-detail-kv">
            <span className="sc-kv-label">RSI Score</span>
            <span className="sc-kv-val" style={{ color: rsiColor }}>{rsi.toFixed(1)}</span>
          </div>
          <div className="sc-detail-kv">
            <span className="sc-kv-label">Trend Signal</span>
            <span className={`sig-badge ${sig === 'BUY' ? 'buy' : sig === 'SELL' ? 'sell' : 'neutral'}`}>{sig}</span>
          </div>
          <div className="sc-detail-kv">
            <span className="sc-kv-label">Trend Strength</span>
            <span className="sc-kv-val">{parseFloat(stock.adx_14 || 0).toFixed(1)}</span>
          </div>
        </div>

        <div className="sc-detail-summary">
          <span className="sc-detail-summary-label">💡 What does this mean?</span>
          <p>{buildStockSummary(stock)}</p>
        </div>
      </div>
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────
export default function ScreenerPage({ standalone, onStockClick }) {
  const [presets, setPresets] = useState([]);
  const [activePreset, setActivePreset] = useState(null);
  const [interval, setInterval_] = useState('1day');

  const [filters, setFilters] = useState([]);
  const [filterLogic, setFilterLogic] = useState('AND');
  const [selectedUniverse, setSelectedUniverse] = useState('NSE');

  const [isScanning, setIsScanning] = useState(false);
  const [scanProgress, setScanProgress] = useState({ current: 0, total: 100 });
  const [scanError, setScanError] = useState(null);
  const [scanInterrupted, setScanInterrupted] = useState(false);
  const [results, setResults] = useState([]);
  const [scanDone, setScanDone] = useState(false);
  const [scanTotal, setScanTotal] = useState(0);

  const [showAddFilter, setShowAddFilter] = useState(false);
  const [showLegend, setShowLegend] = useState(false);
  const [selectedStock, setSelectedStock] = useState(null);

  const [cacheStatus, setCacheStatus] = useState(null);
  const [cacheRebuilding, setCacheRebuilding] = useState(false);

  // Sorting & pagination
  const [page, setPage] = useState(1);
  const PER_PAGE = 50;
  const [sortConfig, setSortConfig] = useState({ key: 'pct_change', direction: 'desc' });

  const addFilterRef = useRef(null);

  // Close dropdown on outside click
  useEffect(() => {
    function handler(e) {
      if (addFilterRef.current && !addFilterRef.current.contains(e.target)) {
        setShowAddFilter(false);
      }
    }
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  // Load presets
  useEffect(() => {
    fetch('/api/screener/presets')
      .then(r => r.json())
      .then(d => { if (d.presets) setPresets(d.presets); })
      .catch(() => {});
  }, []);

  // Fetch cache status for selected interval
  const fetchCacheStatus = useCallback(async (iv) => {
    try {
      const res = await fetch(`/api/screener/cache-status?interval=${iv || interval}`);
      if (res.ok) setCacheStatus(await res.json());
    } catch (_) {}
  }, [interval]);

  useEffect(() => {
    fetchCacheStatus(interval);
    const id = setInterval(() => fetchCacheStatus(interval), 60_000);
    return () => clearInterval(id);
  }, [interval, fetchCacheStatus]);

  // When timeframe changes: show "rebuilding" briefly and re-fetch status
  const handleIntervalChange = useCallback((newIv) => {
    if (newIv === interval) return;
    setInterval_(newIv);
    setCacheRebuilding(true);
    setCacheStatus(null);
    // Reset results for new timeframe
    setResults([]);
    setScanDone(false);
    setScanInterrupted(false);
    // Fetch status after a short delay (cache may already exist)
    setTimeout(() => {
      fetchCacheStatus(newIv);
      setCacheRebuilding(false);
    }, 1500);
  }, [interval, fetchCacheStatus]);

  const loadPreset = (preset) => {
    setActivePreset(preset.id);
    setFilters(preset.filters.map((f, i) => ({ ...f, _id: Date.now() + i })));
    setFilterLogic(preset.logic || 'AND');
    setResults([]);
    setScanDone(false);
    setScanInterrupted(false);
  };

  const addFilter = (fieldKey) => {
    const def = FILTER_FIELDS.find(f => f.key === fieldKey);
    if (!def) return;
    setFilters(prev => [...prev, {
      _id: Date.now(),
      field: def.key,
      operator: def.defaultOp,
      value: def.defaultVal,
    }]);
    setShowAddFilter(false);
    setActivePreset(null);
  };

  const updateFilter = (id, key, value) => {
    setFilters(prev => prev.map(f => f._id === id ? { ...f, [key]: value } : f));
    setActivePreset(null);
  };

  const removeFilter = (id) => {
    setFilters(prev => prev.filter(f => f._id !== id));
    setActivePreset(null);
  };

  const clearAll = () => {
    setFilters([]);
    setActivePreset(null);
    setResults([]);
    setScanDone(false);
    setScanInterrupted(false);
    setScanError(null);
  };

  const runScan = useCallback(async () => {
    if (filters.length === 0) return;

    fetchCacheStatus(interval);
    setIsScanning(true);
    setScanError(null);
    setScanInterrupted(false);
    setResults([]);
    setScanDone(false);
    setScanTotal(0);
    setScanProgress({ current: 0, total: cacheStatus?.symbols || 200 });
    setPage(1);

    const body = {
      filters: filters.map(f => ({ field: f.field, operator: f.operator, value: f.value })),
      universe: selectedUniverse,
      logic: filterLogic,
      index_filter: 'ALL',
      sectors: null,
      interval,
    };

    let receivedDone = false;

    try {
      const res = await fetch('/api/screener/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (!res.ok) throw new Error(`Server returned ${res.status}`);

      const reader = res.body.getReader();
      const decoder = new TextDecoder('utf-8');
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const parts = buffer.split('\n\n');
        buffer = parts.pop();

        for (const part of parts) {
          if (!part.startsWith('data: ')) continue;
          try {
            const data = JSON.parse(part.substring(6));

            if (data.error) {
              setScanError(data.error);
              setIsScanning(false);
              return;
            }
            if (data.results && data.results.length > 0) {
              setResults(prev => {
                const seen = new Set(prev.map(p => p.symbol));
                return [...prev, ...data.results.filter(r => !seen.has(r.symbol))];
              });
            }
            if (data.progress) {
              setScanProgress(data.progress);
            }
            if (data.done) {
              receivedDone = true;
              setScanDone(true);
              setIsScanning(false);
              setScanTotal(data.total || 0);
              setScanProgress(p => ({ ...p, current: p.total }));
            }
          } catch (_) {}
        }
      }

      if (!receivedDone) {
        setScanInterrupted(true);
        setIsScanning(false);
      }
    } catch (err) {
      console.error('Scan error:', err);
      setScanInterrupted(true);
      setIsScanning(false);
    }
  }, [filters, filterLogic, selectedUniverse, interval, cacheStatus, fetchCacheStatus]);

  const exportCSV = () => {
    const h = ['#','Symbol','Exchange','Price (₹)','Change Today','Volume Activity','RSI Score','Trend Signal','Sector'];
    const rows = sortedResults.map((r, i) => [
      i + 1, r.symbol, r.exchange || 'NSE',
      r.last_price, r.pct_change, `${r.volume_ratio?.toFixed(1)}x`,
      r.rsi_14?.toFixed(1), r.supertrend, r.sector,
    ]);
    const csv = [h, ...rows].map(r => r.join(',')).join('\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    a.download = `screener_${interval}_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
  };

  const handleSort = (key) => {
    setSortConfig(s => ({ key, direction: s.key === key && s.direction === 'asc' ? 'desc' : 'asc' }));
  };

  const sortedResults = useMemo(() => {
    const items = [...results];
    if (!sortConfig.key) return items;
    items.sort((a, b) => {
      let va = a[sortConfig.key] ?? -999999;
      let vb = b[sortConfig.key] ?? -999999;
      if (typeof va === 'string') va = va.toLowerCase();
      if (typeof vb === 'string') vb = vb.toLowerCase();
      if (va < vb) return sortConfig.direction === 'asc' ? -1 : 1;
      if (va > vb) return sortConfig.direction === 'asc' ? 1 : -1;
      return 0;
    });
    return items;
  }, [results, sortConfig]);

  const paginated = useMemo(() => {
    const start = (page - 1) * PER_PAGE;
    return sortedResults.slice(start, start + PER_PAGE);
  }, [sortedResults, page]);

  const totalPages = Math.max(1, Math.ceil(sortedResults.length / PER_PAGE));

  const progressPct = scanProgress.total > 0
    ? Math.min(100, Math.round((scanProgress.current / scanProgress.total) * 100))
    : 0;

  const cacheAgeDotColor = () => {
    const s = cacheStatus?.age_seconds;
    if (s == null) return '#555';
    if (s < 300) return '#00ff88';
    if (s < 600) return '#ff9900';
    return '#ff4444';
  };

  const groupedFields = FILTER_FIELDS.reduce((acc, f) => {
    acc[f.category] = acc[f.category] || [];
    acc[f.category].push(f);
    return acc;
  }, {});

  const hasResults = results.length > 0;
  const isIdle = !isScanning && !scanDone && !hasResults && !scanInterrupted && !scanError;
  const isCacheNotReady = cacheStatus && !cacheStatus.ready && !cacheRebuilding;

  const volClass = (ratio) => {
    const r = parseFloat(ratio);
    if (r >= 2) return 'td-vol high';
    if (r >= 1) return 'td-vol mid';
    return 'td-vol';
  };

  const rsiClass = (rsi) => {
    const r = parseFloat(rsi);
    if (r >= 70) return 'td-rsi overbought';
    if (r <= 30) return 'td-rsi oversold';
    return 'td-rsi';
  };

  const sortIndicator = (key) =>
    sortConfig.key === key ? (sortConfig.direction === 'asc' ? ' ▲' : ' ▼') : '';

  return (
    <div className="sc-page">

      {/* SECTION 1 — TIMEFRAME SELECTOR */}
      <div className="sc-tf-bar">
        <span className="sc-tf-label">TIMEFRAME</span>
        <div className="sc-tf-tabs">
          {TIMEFRAMES.map(tf => (
            <button
              key={tf.key}
              className={`sc-tf-tab ${interval === tf.key ? 'active' : ''}`}
              onClick={() => handleIntervalChange(tf.key)}
              title={tf.tooltip}
            >
              {tf.label}
              {tf.recommended && interval !== tf.key && <span className="sc-tf-rec">★ recommended</span>}
              <InfoTooltip text={tf.tooltip} />
            </button>
          ))}
        </div>
      </div>

      {/* SECTION 2 — PRESET CARDS */}
      <div className="sc-presets-row">
        {presets.map(preset => {
          const tag = (preset.tag || 'STRATEGY').toUpperCase();
          const tagClass = {
            BULLISH: 'tag-bullish', BEARISH: 'tag-bearish',
            BREAKOUT: 'tag-breakout', MOMENTUM: 'tag-momentum',
          }[tag] || 'tag-default';
          return (
            <div
              key={preset.id}
              className={`sc-preset-card ${activePreset === preset.id ? 'active' : ''}`}
              onClick={() => loadPreset(preset)}
            >
              <span className={`sc-preset-tag ${tagClass}`}>{tag}</span>
              <span className="sc-preset-icon">{preset.icon}</span>
              <div className="sc-preset-name">{preset.name}</div>
              <div className="sc-preset-desc">{preset.description}</div>
            </div>
          );
        })}
      </div>

      {/* SECTION 3 — FILTER BUILDER */}
      <div className="sc-builder-panel">

        {/* Cache status pill — top right */}
        <div className="sc-builder-toprow">
          <span className="sc-builder-heading">Build Your Scanner</span>
          <div className="sc-cache-pill" title={`Stock data refreshes every 5 minutes. Timeframe: ${interval}`}>
            {cacheRebuilding ? (
              <span className="sc-cache-rebuilding">🔄 Rebuilding cache for {TIMEFRAMES.find(t => t.key === interval)?.label}…</span>
            ) : cacheStatus ? (
              <>
                <span className="sc-cache-dot" style={{ background: cacheAgeDotColor() }} />
                <span>{cacheStatus.symbols || 0} stocks ready</span>
                {cacheStatus.age_seconds != null && (
                  <span className="sc-cache-age"> · Updated {formatAge(cacheStatus.age_seconds)}</span>
                )}
              </>
            ) : (
              <span style={{ color: '#555', fontSize: '11px' }}>Loading cache info…</span>
            )}
          </div>
        </div>

        {/* Filters row */}
        <div className="sc-filters-row">
          {filters.map((f) => {
            const def = FILTER_FIELDS.find(d => d.key === f.field);
            return (
              <div key={f._id} className="sc-filter-chip">
                <span className="sc-chip-label">
                  {def ? def.label : f.field}
                  {def?.tooltip && <InfoTooltip text={def.tooltip} />}
                </span>
                <select value={f.operator} onChange={e => updateFilter(f._id, 'operator', e.target.value)}>
                  <option value=">">&gt;</option>
                  <option value="<">&lt;</option>
                  <option value=">=">&gt;=</option>
                  <option value="<=">&lt;=</option>
                  <option value="=">=</option>
                </select>
                {def?.type === 'select' ? (
                  <select value={f.value} onChange={e => updateFilter(f._id, 'value', e.target.value)}>
                    {def.options.map(opt => (
                      <option key={opt.value} value={opt.value}>{opt.label}</option>
                    ))}
                  </select>
                ) : (
                  <input
                    type="number"
                    value={f.value}
                    onChange={e => updateFilter(f._id, 'value', Number(e.target.value))}
                  />
                )}
                <button className="sc-chip-remove" onClick={() => removeFilter(f._id)}>×</button>
              </div>
            );
          })}

          {/* AND / OR badge between chips */}
          {filters.length > 1 && (
            <button
              className="sc-logic-badge"
              onClick={() => setFilterLogic(l => l === 'AND' ? 'OR' : 'AND')}
              title="Click to toggle AND / OR logic"
            >
              {filterLogic}
            </button>
          )}

          {/* Add filter dropdown */}
          <div className="sc-add-wrapper" ref={addFilterRef}>
            <button className="sc-add-btn" onClick={() => setShowAddFilter(v => !v)}>
              + Add Filter
            </button>
            {showAddFilter && (
              <div className="sc-filter-dropdown">
                {Object.entries(groupedFields).map(([cat, fields]) => (
                  <div key={cat}>
                    <div className="sc-dd-cat">{cat}</div>
                    {fields.map(fd => (
                      <div key={fd.key} className="sc-dd-option" onClick={() => addFilter(fd.key)}>
                        {fd.label}
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Control row */}
        <div className="sc-controls-row">
          <div className="sc-universe-group">
            {['NSE', 'BSE', 'ALL'].map(u => (
              <button
                key={u}
                className={`sc-univ-btn ${selectedUniverse === u ? 'active' : ''}`}
                onClick={() => setSelectedUniverse(u)}
              >
                {u === 'ALL' ? 'NSE + BSE' : `${u} Only`}
              </button>
            ))}
          </div>
          <div style={{ flex: 1 }} />
          {filters.length > 0 && (
            <button className="sc-clear-btn" onClick={clearAll}>Clear All</button>
          )}
          <button
            className={`sc-run-btn ${isScanning ? 'scanning' : ''}`}
            onClick={runScan}
            disabled={isScanning || filters.length === 0}
          >
            {isScanning ? '⚡ Scanning…' : '🚀 Run Scan'}
          </button>
        </div>
      </div>

      {/* ── STATE BLOCKS ── */}

      {/* Cache not ready */}
      {isCacheNotReady && !isScanning && (
        <div className="sc-state-block warning">
          <span style={{ fontSize: '2rem' }}>⏳</span>
          <h3>Building stock data…</h3>
          <p>This takes about 30 seconds on first load. You'll be ready to scan shortly.</p>
        </div>
      )}

      {/* Idle / initial */}
      {isIdle && !isCacheNotReady && (
        <div className="sc-state-block">
          <span style={{ fontSize: '3rem' }}>🎯</span>
          <h3>Ready to find stocks?</h3>
          <p>Select a preset above or build your own filters, then hit <strong>Run Scan</strong></p>
        </div>
      )}

      {/* Scan interrupted */}
      {scanInterrupted && !isScanning && (
        <div className="sc-interrupted-bar">
          <span>⚠️ Scan was interrupted. This can happen due to slow internet. Your filters are saved.</span>
          <button className="sc-retry-btn" onClick={runScan}>🔄 Try Again</button>
        </div>
      )}

      {/* Scan error */}
      {scanError && !isScanning && (
        <div className="sc-interrupted-bar error">
          <span>⚠️ {scanError}</span>
          <button className="sc-retry-btn" onClick={runScan}>🔄 Try Again</button>
        </div>
      )}

      {/* SECTION 4 — SCAN PROGRESS */}
      {isScanning && (
        <div className="sc-progress-panel">
          <div className="sc-progress-bar-track">
            <div
              className="sc-progress-bar-fill"
              style={{ width: `${progressPct}%`, transition: 'width 0.3s ease' }}
            />
          </div>
          <div className="sc-progress-label">
            {progressPct}%
          </div>
          <div className="sc-progress-sub">
            🔍 Scanning {cacheStatus?.symbols || '…'} stocks for your filters…
          </div>
          <div className="sc-progress-match">
            ✅ {results.length} match{results.length !== 1 ? 'es' : ''} found so far
          </div>
        </div>
      )}

      {/* SECTION 5 — RESULTS TABLE */}
      {(hasResults || (scanDone && !isScanning)) && (
        <div className="sc-results-wrapper">
          <div className="sc-results-topbar">
            <div className="sc-results-count">
              {isScanning ? (
                <>Scanning… <strong>{results.length}</strong> matches so far</>
              ) : (
                <>✅ Scan complete — <strong>{results.length}</strong> stock{results.length !== 1 ? 's' : ''} match your filters</>
              )}
            </div>
            <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
              <button
                className="sc-legend-btn"
                onClick={() => setShowLegend(v => !v)}
              >
                {showLegend ? 'Hide Legend' : '❓ What do columns mean?'}
              </button>
              <button className="sc-csv-btn" onClick={exportCSV}>
                ↓ Export CSV
              </button>
            </div>
          </div>

          {/* Column legend */}
          {showLegend && (
            <div className="sc-legend-bar">
              <span><strong>Price:</strong> Current trade price</span>
              <span><strong>Change Today:</strong> % move since yesterday's close</span>
              <span><strong>Volume Activity:</strong> 1x = normal, 2x = double average buying</span>
              <span><strong>RSI Score:</strong> &lt;30 oversold ·&gt;70 overbought · 50 neutral</span>
              <span><strong>Trend Signal:</strong> BUY = uptrend · SELL = downtrend · NEUTRAL = sideways</span>
            </div>
          )}

          {/* Zero results */}
          {results.length === 0 ? (
            <div className="sc-state-block" style={{ padding: '60px 0' }}>
              <span style={{ fontSize: '3rem' }}>🌵</span>
              <h3>No stocks matched your filters</h3>
              <p>Try relaxing your filters — for example, lower the % Change Today value, or switch logic to OR</p>
            </div>
          ) : (
            <>
              <div style={{ overflowX: 'auto' }}>
                <table className="sc-table">
                  <thead>
                    <tr>
                      <th>#</th>
                      <th onClick={() => handleSort('symbol')}>Stock{sortIndicator('symbol')}</th>
                      <th onClick={() => handleSort('last_price')}>Price (₹){sortIndicator('last_price')}</th>
                      <th onClick={() => handleSort('pct_change')}>Change Today{sortIndicator('pct_change')}</th>
                      <th onClick={() => handleSort('volume_ratio')}>Volume Activity{sortIndicator('volume_ratio')}</th>
                      <th onClick={() => handleSort('rsi_14')}>RSI Score{sortIndicator('rsi_14')}</th>
                      <th onClick={() => handleSort('supertrend')}>Trend Signal{sortIndicator('supertrend')}</th>
                      <th onClick={() => handleSort('sector')}>Sector{sortIndicator('sector')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {paginated.map((r, i) => {
                      const rank = (page - 1) * PER_PAGE + i + 1;
                      const isUp = r.pct_change >= 0;
                      const sig = (r.supertrend || 'NEUTRAL').toUpperCase();
                      const exchCls = (r.exchange || 'NSE').toLowerCase();
                      return (
                        <tr key={r.symbol} onClick={() => setSelectedStock(r)}>
                          <td className="td-rank">{rank}</td>
                          <td className="td-sym">
                            {cleanSymbol(r.symbol)}
                            <span className={`sc-exch-badge ${exchCls}`}>{r.exchange || 'NSE'}</span>
                          </td>
                          <td className="td-price">₹{parseFloat(r.last_price || 0).toFixed(2)}</td>
                          <td className={isUp ? 'td-chg up' : 'td-chg dn'}>
                            {isUp ? '▲' : '▼'} {Math.abs(r.pct_change || 0).toFixed(2)}%
                          </td>
                          <td className={volClass(r.volume_ratio)}>
                            {parseFloat(r.volume_ratio || 1).toFixed(1)}x avg
                          </td>
                          <td className={rsiClass(r.rsi_14)}>
                            {parseFloat(r.rsi_14 || 50).toFixed(1)}
                          </td>
                          <td>
                            <span className={`sig-badge ${sig === 'BUY' ? 'buy' : sig === 'SELL' ? 'sell' : 'neutral'}`}>
                              {sig}
                            </span>
                          </td>
                          <td className="td-sector">{r.sector || '—'}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              <div className="sc-results-footer">
                <span className="sc-results-showing">
                  Showing {Math.min(results.length, (page - 1) * PER_PAGE + 1)}–{Math.min(results.length, page * PER_PAGE)} of {results.length}
                </span>
                <div className="sc-page-btns">
                  <button className="sc-page-btn" onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}>← Prev</button>
                  <span className="sc-page-num">{page} / {totalPages}</span>
                  <button className="sc-page-btn" onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages}>Next →</button>
                </div>
              </div>
            </>
          )}
        </div>
      )}

      {/* SECTION 5b — STOCK DETAIL PANEL */}
      {selectedStock && (
        <StockDetailPanel stock={selectedStock} onClose={() => setSelectedStock(null)} />
      )}
    </div>
  );
}
