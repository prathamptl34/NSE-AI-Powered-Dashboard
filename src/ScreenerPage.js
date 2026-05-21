import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import './screener.css';

const FILTER_FIELDS = [
  // Price
  { key: 'last_price', label: 'Last Price (₹)', type: 'number', category: 'Price', defaultOp: '>', defaultVal: 0 },
  { key: 'pct_change', label: '% Change Today', type: 'number', category: 'Price', defaultOp: '>', defaultVal: 2 },
  { key: 'pct_from_52h', label: '% From 52W High', type: 'number', category: 'Price', defaultOp: '<', defaultVal: 5 },
  { key: 'pct_from_52l', label: '% From 52W Low', type: 'number', category: 'Price', defaultOp: '>', defaultVal: 10 },
  // Volume
  { key: 'volume', label: 'Volume (shares)', type: 'number', category: 'Volume', defaultOp: '>', defaultVal: 100000 },
  { key: 'volume_ratio', label: 'Volume Ratio (x avg)', type: 'number', category: 'Volume', defaultOp: '>', defaultVal: 2 },
  // Technical Indicators
  { key: 'rsi_14', label: 'RSI (14)', type: 'number', category: 'Technical Indicators', defaultOp: '<', defaultVal: 30 },
  { key: 'macd_histogram', label: 'MACD Histogram', type: 'number', category: 'Technical Indicators', defaultOp: '>', defaultVal: 0 },
  { key: 'adx_14', label: 'ADX (14)', type: 'number', category: 'Technical Indicators', defaultOp: '>', defaultVal: 25 },
  { key: 'supertrend', label: 'Supertrend', type: 'select', category: 'Technical Indicators', options: [{value: 'BUY', label: 'BUY'}, {value: 'SELL', label: 'SELL'}], defaultOp: '=', defaultVal: 'BUY' },
  { key: 'bb_pctb', label: 'Bollinger %B', type: 'number', category: 'Technical Indicators', defaultOp: '<', defaultVal: 0.2 },
  { key: 'atr_14', label: 'ATR (14)', type: 'number', category: 'Technical Indicators', defaultOp: '>', defaultVal: 0 },
  // Moving Averages
  { key: 'ema_20', label: 'EMA 20', type: 'number', category: 'Moving Averages', defaultOp: '>', defaultVal: 0 },
  { key: 'ema_50', label: 'EMA 50', type: 'number', category: 'Moving Averages', defaultOp: '>', defaultVal: 0 },
  { key: 'ema_200', label: 'EMA 200', type: 'number', category: 'Moving Averages', defaultOp: '>', defaultVal: 0 },
  { key: 'sma_20', label: 'SMA 20', type: 'number', category: 'Moving Averages', defaultOp: '>', defaultVal: 0 },
  { key: 'sma_50', label: 'SMA 50', type: 'number', category: 'Moving Averages', defaultOp: '>', defaultVal: 0 },
  // Fundamentals
  { key: 'market_cap', label: 'Market Cap (Cr)', type: 'number', category: 'Fundamentals', defaultOp: '>', defaultVal: 1000 },
];

const cleanSymbol = (raw) => {
  if (!raw) return raw;
  return raw
    .replace(/NSE$/i, '')
    .replace(/BSE$/i, '')
    .replace(/-EQ$/i, '')
    .trim();
};

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

export default function ScreenerPage({ standalone, onStockClick }) {
  const [presets, setPresets] = useState([]);
  const [activePreset, setActivePreset] = useState(null);

  const [filters, setFilters] = useState([]);
  const [filterLogic, setFilterLogic] = useState('AND');
  const [selectedUniverse, setSelectedUniverse] = useState('NSE');
  const [indexFilter, setIndexFilter] = useState('ALL');

  const [isScanning, setIsScanning] = useState(false);
  const [scanProgress, setScanProgress] = useState({ current: 0, total: 100 });
  const [scanError, setScanError] = useState(null);
  const [scanInterrupted, setScanInterrupted] = useState(false);
  const [results, setResults] = useState([]);
  const [scanMeta, setScanMeta] = useState(null);
  const [scanDone, setScanDone] = useState(false);

  const [showAddFilter, setShowAddFilter] = useState(false);

  // Cache status
  const [cacheStatus, setCacheStatus] = useState(null);

  // Pagination & Sorting
  const [page, setPage] = useState(1);
  const [perPage] = useState(50);
  const [sortConfig, setSortConfig] = useState({ key: 'pct_change', direction: 'desc' });

  // Close dropdown on outside click
  const addFilterRef = useRef(null);
  useEffect(() => {
    function handleClickOutside(event) {
      if (addFilterRef.current && !addFilterRef.current.contains(event.target)) {
        setShowAddFilter(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Fetch presets on mount
  useEffect(() => {
    fetch('/api/screener/presets')
      .then(r => r.json())
      .then(data => { if (data.presets) setPresets(data.presets); })
      .catch(err => console.error('Failed to load presets', err));
  }, []);

  // Fetch and poll cache status every 60s
  const fetchCacheStatus = useCallback(async () => {
    try {
      const res = await fetch('/api/screener/cache-status');
      if (res.ok) {
        const data = await res.json();
        setCacheStatus(data);
      }
    } catch (e) {
      // Silently ignore cache status fetch errors
    }
  }, []);

  useEffect(() => {
    fetchCacheStatus();
    const id = setInterval(fetchCacheStatus, 60_000);
    return () => clearInterval(id);
  }, [fetchCacheStatus]);

  const loadPreset = (preset) => {
    setActivePreset(preset.id);
    setFilters(preset.filters.map((f, i) => ({ ...f, id: i })));
    setFilterLogic(preset.logic || 'AND');
  };

  const addFilter = (fieldKey) => {
    const fieldDef = FILTER_FIELDS.find(f => f.key === fieldKey);
    if (!fieldDef) return;
    setFilters([...filters, {
      id: Date.now(),
      field: fieldDef.key,
      operator: fieldDef.defaultOp,
      value: fieldDef.defaultVal,
    }]);
    setShowAddFilter(false);
    setActivePreset(null);
  };

  const updateFilter = (id, key, value) => {
    setFilters(filters.map(f => f.id === id ? { ...f, [key]: value } : f));
    setActivePreset(null);
  };

  const removeFilter = (id) => {
    setFilters(filters.filter(f => f.id !== id));
    setActivePreset(null);
  };

  const runScan = useCallback(async () => {
    if (filters.length === 0) return;

    // Refresh cache status before scan to show freshest info
    fetchCacheStatus();

    setIsScanning(true);
    setScanError(null);
    setScanInterrupted(false);
    setResults([]);
    setScanMeta(null);
    setScanDone(false);
    setScanProgress({ current: 0, total: cacheStatus?.symbols || 100 });
    setPage(1);

    const body = {
      filters: filters.map(f => ({ field: f.field, operator: f.operator, value: f.value })),
      universe: selectedUniverse,
      logic: filterLogic,
      index_filter: indexFilter,
      sectors: null,
    };

    let receivedDone = false;

    try {
      const res = await fetch('/api/screener/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        throw new Error(`Server returned ${res.status}`);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder('utf-8');
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        // Correct SSE chunk buffering pattern
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n\n');
        buffer = lines.pop(); // keep incomplete trailing chunk

        for (const part of lines) {
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
                const newItems = data.results.filter(r => !seen.has(r.symbol));
                return [...prev, ...newItems];
              });
            }

            if (data.progress) {
              setScanProgress(data.progress);
            }

            if (data.done) {
              receivedDone = true;
              setIsScanning(false);
              setScanDone(true);
              setScanProgress(p => ({ ...p, current: p.total }));
              if (data.total !== undefined) {
                setScanMeta({ total_matched: data.total, timestamp: new Date().toISOString() });
              }
            }

            if (data.meta) {
              setScanMeta(data.meta);
            }
          } catch (e) {
            console.error('SSE parse error:', e, 'raw:', part);
          }
        }
      }

      // If stream closed without done: true → interrupted
      if (!receivedDone) {
        setScanInterrupted(true);
        setIsScanning(false);
      }

    } catch (err) {
      console.error('Scan error:', err);
      if (!receivedDone) {
        setScanInterrupted(true);
      }
      setIsScanning(false);
    } finally {
      setIsScanning(false);
    }
  }, [filters, filterLogic, selectedUniverse, indexFilter, cacheStatus, fetchCacheStatus]);

  const exportCSV = () => {
    const headers = ['Rank', 'Symbol', 'Exchange', 'LTP', 'Change%', 'VolRatio', 'RSI', 'MACD', 'Signal', 'Sector'];
    const rows = results.map((r, i) => [
      i + 1, r.symbol, r.exchange || 'NSE', r.last_price, r.pct_change, r.volume_ratio,
      r.rsi_14?.toFixed(1), r.macd_histogram?.toFixed(2), r.supertrend, r.sector,
    ]);
    const csv = [headers, ...rows].map(r => r.join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `screener_results_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
  };

  const handleSort = (key) => {
    let direction = 'asc';
    if (sortConfig.key === key && sortConfig.direction === 'asc') direction = 'desc';
    setSortConfig({ key, direction });
  };

  const sortedResults = useMemo(() => {
    let items = [...results];
    if (sortConfig.key) {
      items.sort((a, b) => {
        let va = a[sortConfig.key]; let vb = b[sortConfig.key];
        if (va == null) va = -999999; if (vb == null) vb = -999999;
        if (va < vb) return sortConfig.direction === 'asc' ? -1 : 1;
        if (va > vb) return sortConfig.direction === 'asc' ? 1 : -1;
        return 0;
      });
    }
    return items;
  }, [results, sortConfig]);

  const paginatedResults = useMemo(() => {
    const start = (page - 1) * perPage;
    return sortedResults.slice(start, start + perPage);
  }, [sortedResults, page, perPage]);

  const totalPages = Math.ceil(sortedResults.length / perPage) || 1;

  const groupedFields = FILTER_FIELDS.reduce((acc, field) => {
    acc[field.category] = acc[field.category] || [];
    acc[field.category].push(field);
    return acc;
  }, {});

  const progressPct = scanProgress.total > 0
    ? Math.min(100, Math.round((scanProgress.current / scanProgress.total) * 100))
    : 0;

  const sigClass = (sig) => {
    if (!sig) return 'sig-neutral';
    const s = sig.toString().toUpperCase();
    if (s === 'BUY') return 'sig-buy';
    if (s === 'SELL') return 'sig-sell';
    return 'sig-neutral';
  };

  const volClass = (ratio) => parseFloat(ratio) >= 2 ? 'td-volratio high' : 'td-volratio';
  const rsiClass = (rsi) => {
    const r = parseFloat(rsi);
    if (r >= 70) return 'td-rsi overbought';
    if (r <= 30) return 'td-rsi oversold';
    return 'td-rsi';
  };

  const showSector = results.some(r => r.sector && r.sector !== '-' && r.sector !== 'OTHERS');

  return (
    <div className="screener-page-container">

      {/* 1. HEADER */}
      {!standalone && (
        <div className="section-header">
          <div className="section-icon">🔍</div>
          <div>
            <h1>Universal Screener</h1>
            <p className="section-subtitle">5,000+ NSE &amp; BSE STOCKS</p>
          </div>
        </div>
      )}

      {/* 2. PRESET STRATEGY CARDS */}
      <div className="preset-cards-row">
        {presets.map(preset => {
          let tagClass = 'default'; let tagText = 'STRATEGY';
          const id = preset.id.toLowerCase();
          if (id.includes('bullish') || id.includes('bounce') || id.includes('buy')) { tagClass = 'bullish'; tagText = 'BULLISH'; }
          if (id.includes('bearish') || id.includes('sell')) { tagClass = 'bearish'; tagText = 'BEARISH'; }
          if (id.includes('momentum') || id.includes('leaders')) { tagClass = 'momentum'; tagText = 'MOMENTUM'; }
          if (id.includes('breakout')) { tagClass = 'breakout'; tagText = 'BREAKOUT'; }
          return (
            <div key={preset.id} className={`preset-card ${activePreset === preset.id ? 'active' : ''}`} onClick={() => loadPreset(preset)}>
              <span className={`preset-tag ${tagClass}`}>{tagText}</span>
              <span className="preset-icon">{preset.icon}</span>
              <div className="preset-title">{preset.name}</div>
              <div className="preset-desc">{preset.description}</div>
            </div>
          );
        })}
      </div>

      {/* 3. SCAN INTERRUPTED BANNER (replaces generic "network error") */}
      {scanInterrupted && !isScanning && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: '12px',
          background: 'rgba(251, 191, 36, 0.08)', border: '1px solid rgba(251,191,36,0.25)',
          borderRadius: '8px', padding: '12px 16px', marginBottom: '16px', color: '#fbbf24',
        }}>
          <span style={{ fontSize: '16px' }}>⚠</span>
          <span style={{ flex: 1, fontSize: '13px' }}>Scan interrupted — connection closed before completion.</span>
          <button
            onClick={runScan}
            style={{
              background: 'rgba(251,191,36,0.15)', border: '1px solid rgba(251,191,36,0.4)',
              borderRadius: '6px', color: '#fbbf24', padding: '5px 14px',
              cursor: 'pointer', fontSize: '12px', fontWeight: '600',
            }}
          >
            Retry
          </button>
        </div>
      )}

      {/* 4. FILTER BUILDER */}
      <div className="scanner-panel">
        <div className="scanner-panel-header">Build Your Scanner</div>

        {/* Cache info bar — muted, above filters */}
        {cacheStatus && (
          <div style={{
            fontSize: '11px', color: '#666', marginBottom: '10px',
            fontFamily: 'monospace', letterSpacing: '0.02em',
          }}>
            📦 Cache:&nbsp;
            <span style={{ color: '#888' }}>{cacheStatus.symbols || 0} symbols</span>
            {cacheStatus.age_seconds != null && (
              <>
                &nbsp;·&nbsp;Updated {formatAge(cacheStatus.age_seconds)}
                &nbsp;·&nbsp;Next refresh in {formatNextRefresh(cacheStatus.age_seconds)}
              </>
            )}
            {!cacheStatus.ready && (
              <span style={{ color: '#f87171', marginLeft: '6px' }}>⚠ Cache warming up…</span>
            )}
          </div>
        )}

        <div className="filters-row">
          {filters.map((f, index) => {
            const fieldDef = FILTER_FIELDS.find(df => df.key === f.field);
            return (
              <React.Fragment key={f.id}>
                {index > 0 && (
                  <div className="filter-logic-badge" onClick={() => setFilterLogic(l => l === 'AND' ? 'OR' : 'AND')}>
                    {filterLogic}
                  </div>
                )}
                <div className="filter-chip">
                  <span className="filter-chip-label">{fieldDef ? fieldDef.label : f.field}</span>
                  <select value={f.operator} onChange={e => updateFilter(f.id, 'operator', e.target.value)}>
                    <option value=">">&gt;</option>
                    <option value="<">&lt;</option>
                    <option value=">=">&gt;=</option>
                    <option value="<=">&lt;=</option>
                    <option value="=">=</option>
                  </select>
                  {fieldDef?.type === 'select' ? (
                    <select value={f.value} onChange={e => updateFilter(f.id, 'value', e.target.value)}>
                      {fieldDef.options.map(opt => (
                        <option key={opt.value} value={opt.value}>{opt.label}</option>
                      ))}
                    </select>
                  ) : fieldDef?.type === 'boolean' ? (
                    <select value={f.value} onChange={e => updateFilter(f.id, 'value', e.target.value === 'true')}>
                      <option value="true">True</option>
                      <option value="false">False</option>
                    </select>
                  ) : (
                    <input
                      type="number"
                      value={f.value}
                      onChange={e => updateFilter(f.id, 'value', Number(e.target.value))}
                    />
                  )}
                  <button className="filter-chip-remove" onClick={() => removeFilter(f.id)}>×</button>
                </div>
              </React.Fragment>
            );
          })}

          <div style={{ position: 'relative' }} ref={addFilterRef}>
            <button className="add-filter-btn" onClick={() => setShowAddFilter(!showAddFilter)}>
              + Add Filter
            </button>
            {showAddFilter && (
              <div className="filter-dropdown-panel">
                {Object.entries(groupedFields).map(([category, fields]) => (
                  <div key={category}>
                    <div className="filter-group-header">{category}</div>
                    {fields.map(field => (
                      <div key={field.key} className="filter-option" onClick={() => addFilter(field.key)}>
                        {field.label}
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* CONTROLS ROW */}
        <div className="scan-controls-row">
          <div className="exchange-group">
            <button className={`exchange-btn ${selectedUniverse === 'NSE' ? 'active' : ''}`} onClick={() => setSelectedUniverse('NSE')}>NSE Only</button>
            <button className={`exchange-btn ${selectedUniverse === 'BSE' ? 'active' : ''}`} onClick={() => setSelectedUniverse('BSE')}>BSE Only</button>
            <button className={`exchange-btn ${selectedUniverse === 'ALL' ? 'active' : ''}`} onClick={() => setSelectedUniverse('ALL')}>NSE + BSE</button>
          </div>
          <div className="controls-spacer" />
          {filters.length > 0 && (
            <button className="clear-all-btn" onClick={() => { setFilters([]); setActivePreset(null); setResults([]); setScanMeta(null); setScanDone(false); setScanInterrupted(false); }}>
              Clear All
            </button>
          )}
          <button
            className={`run-scan-btn ${isScanning ? 'scanning' : ''}`}
            onClick={runScan}
            disabled={isScanning || filters.length === 0}
          >
            {isScanning ? '⚡ SCANNING...' : '🚀 RUN SCAN'}
          </button>
        </div>
      </div>

      {/* 5. SCAN STATUS + PROGRESS */}
      {isScanning && (
        <div className="scan-status-panel">
          <div style={{ display: 'flex', alignItems: 'center' }}>
            <div className="radar-container" />
            <div>
              <div className="status-line">
                ⚡ Scanning {selectedUniverse === 'ALL' ? 'NSE & BSE' : selectedUniverse} universe
                {cacheStatus?.symbols ? ` · ${cacheStatus.symbols} symbols` : ''}
                {cacheStatus?.age_seconds != null ? ` · Updated ${formatAge(cacheStatus.age_seconds)}` : ''}
              </div>
              <div className="status-line">📊 Symbols processed: {scanProgress.current} / {scanProgress.total}</div>
              <div className="status-line">✅ Matches found: {results.length}</div>
            </div>
          </div>
          <div className="scan-progress-bar-track">
            <div className="scan-progress-bar-fill" style={{ width: `${progressPct}%` }} />
          </div>
        </div>
      )}

      {/* 6. RESULTS TABLE — shows immediately when first results arrive */}
      {(results.length > 0 || scanMeta || (scanDone && !isScanning)) && (
        <div className="results-wrapper">
          <div className="results-top-bar">
            <div className="results-count-text">
              {isScanning ? (
                <span>Scanning… <strong>{results.length}</strong> matches so far</span>
              ) : (
                <span>Scan Complete — <strong>{results.length}</strong> matches found</span>
              )}
            </div>
            <button className="csv-btn" onClick={exportCSV}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3" />
              </svg>
              Export CSV
            </button>
          </div>

          {results.length === 0 ? (
            <div className="screener-empty-state" style={{ padding: '60px 0', textAlign: 'center', color: '#fff' }}>
              <div style={{ fontSize: '3rem', opacity: 0.7 }}>🏜️</div>
              <h3>No Matches Found</h3>
              <p style={{ color: 'rgba(255,255,255,0.5)' }}>
                No stocks meet your criteria. Try loosening the parameters or switching logic to OR.
              </p>
            </div>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table className="results-table">
                <thead>
                  <tr>
                    <th>#</th>
                    <th onClick={() => handleSort('symbol')} className={sortConfig.key === 'symbol' ? `sorted-${sortConfig.direction}` : ''}>Symbol</th>
                    <th onClick={() => handleSort('last_price')} className={sortConfig.key === 'last_price' ? `sorted-${sortConfig.direction}` : ''}>LTP</th>
                    <th onClick={() => handleSort('pct_change')} className={sortConfig.key === 'pct_change' ? `sorted-${sortConfig.direction}` : ''}>Change%</th>
                    <th onClick={() => handleSort('volume_ratio')} className={sortConfig.key === 'volume_ratio' ? `sorted-${sortConfig.direction}` : ''}>Vol Ratio</th>
                    <th onClick={() => handleSort('rsi_14')} className={sortConfig.key === 'rsi_14' ? `sorted-${sortConfig.direction}` : ''}>RSI</th>
                    <th onClick={() => handleSort('supertrend')} className={sortConfig.key === 'supertrend' ? `sorted-${sortConfig.direction}` : ''}>Signal</th>
                    {showSector && <th onClick={() => handleSort('sector')} className={sortConfig.key === 'sector' ? `sorted-${sortConfig.direction}` : ''}>Sector</th>}
                  </tr>
                </thead>
                <tbody>
                  {paginatedResults.map((r, i) => {
                    const rank = (page - 1) * perPage + i + 1;
                    const isPositive = r.pct_change > 0;
                    const exBadge = (r.exchange || 'NSE').toLowerCase();
                    const exLabel = r.exchange || 'NSE';
                    return (
                      <tr key={r.symbol} onClick={() => {
                        if (onStockClick) onStockClick({
                          symbol: r.symbol,
                          price: r.last_price,
                          prev_close: r.last_price / (1 + r.pct_change / 100),
                          change_pct: r.pct_change,
                        });
                      }}>
                        <td className="td-num">{rank}</td>
                        <td className="td-sym">
                          {cleanSymbol(r.symbol)}
                          <span className={`exch-badge ${exBadge}`}>{exLabel}</span>
                        </td>
                        <td className="td-price">₹{r.last_price?.toFixed(2)}</td>
                        <td className={isPositive ? 'td-chg-up' : 'td-chg-dn'}>
                          {isPositive ? '▲' : '▼'} {Math.abs(r.pct_change || 0).toFixed(2)}%
                        </td>
                        <td className={volClass(r.volume_ratio)}>{r.volume_ratio ? r.volume_ratio.toFixed(1) + 'x' : '-'}</td>
                        <td className={rsiClass(r.rsi_14)}>{r.rsi_14?.toFixed(1) || '-'}</td>
                        <td><span className={sigClass(r.supertrend)}>{(r.supertrend || 'NEUTRAL').toUpperCase()}</span></td>
                        {showSector && <td>{r.sector || '-'}</td>}
                      </tr>
                    );
                  })}
                </tbody>
              </table>

              <div className="results-footer">
                <div className="results-showing">
                  Showing {Math.min(results.length, (page - 1) * perPage + 1)} to {Math.min(results.length, page * perPage)} of {results.length} results
                </div>
                <div className="pagination-btns">
                  <button className="page-btn" onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}>Prev</button>
                  <button className="page-btn" onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages || totalPages === 0}>Next</button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* 7. INITIAL EMPTY STATE */}
      {!isScanning && !scanMeta && !scanDone && results.length === 0 && filters.length === 0 && !scanInterrupted && (
        <div className="screener-empty-state" style={{ padding: '60px 0', textAlign: 'center', color: '#fff' }}>
          <div style={{ fontSize: '3rem', opacity: 0.7 }}>🎯</div>
          <h3>Build Your Scanner</h3>
          <p style={{ color: 'rgba(255,255,255,0.5)' }}>
            Add filters above to scan the market. Or pick a preset strategy to get started instantly.
          </p>
        </div>
      )}

    </div>
  );
}
