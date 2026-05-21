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
  const [results, setResults] = useState([]);
  const [scanMeta, setScanMeta] = useState(null);
  
  const [showAddFilter, setShowAddFilter] = useState(false);
  
  // Pagination & Sorting
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(50);
  const [sortConfig, setSortConfig] = useState({ key: 'pct_change', direction: 'desc' });

  // Close dropdown on outside click
  const addFilterRef = useRef(null);
  useEffect(() => {
    function handleClickOutside(event) {
      if (addFilterRef.current && !addFilterRef.current.contains(event.target)) {
        setShowAddFilter(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  useEffect(() => {
    fetch('/api/screener/presets')
      .then(r => r.json())
      .then(data => {
        if (data.presets) {
          setPresets(data.presets);
        }
      })
      .catch(err => console.error('Failed to load presets', err));
  }, []);

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
      value: fieldDef.defaultVal
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

  const runScan = async () => {
    if (filters.length === 0) return;
    setIsScanning(true);
    setScanError(null);
    setResults([]);
    setScanMeta(null);
    setScanProgress({ current: 0, total: 100 });
    setPage(1);
    
    const body = {
      filters: filters.map(f => ({ field: f.field, operator: f.operator, value: f.value })),
      universe: selectedUniverse,
      logic: filterLogic,
      index_filter: indexFilter,
      sectors: null
    };
    
    try {
      const res = await fetch('/api/screener/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      
      if (!res.ok) {
        throw new Error(`Server returned ${res.status}`);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder('utf-8');
      
      let allResults = [];
      let finalMeta = null;
      let buffer = '';
      
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        
        buffer += decoder.decode(value, { stream: true });
        const parts = buffer.split('\n\n');
        
        // Keep the last part in buffer if it doesn't end with \n\n
        buffer = parts.pop() || '';
        
        for (const part of parts) {
          if (part.startsWith('data: ')) {
            try {
              const data = JSON.parse(part.substring(6));
              
              if (data.error) {
                setScanError(data.error);
                setIsScanning(false);
                return;
              }

              if (data.results && data.results.length > 0) {
                setResults(prev => {
                  const newItems = data.results.filter(r => !prev.some(p => p.symbol === r.symbol));
                  return [...prev, ...newItems];
                });
                allResults.push(...data.results);
              }
              
              if (data.progress) {
                setScanProgress(data.progress);
              }
              
              if (data.done) {
                setIsScanning(false);
                if (data.total !== undefined) {
                  setScanMeta({ total_matched: data.total, scan_time_ms: 0, timestamp: new Date().toISOString() });
                }
              }

              if (data.meta) {
                finalMeta = data.meta;
                setScanMeta(data.meta);
              }
            } catch (e) {
              console.error("Parse error on chunk:", e);
            }
          }
        }
      }
      
      if (!finalMeta && allResults.length > 0) {
          setScanMeta({ total_matched: allResults.length, scan_time_ms: 0, timestamp: new Date().toISOString() });
      }

    } catch (err) {
      console.error('Scan error:', err);
      setScanError(err.message || "Failed to execute scan. Please try again.");
    } finally {
      setIsScanning(false);
      setScanProgress(prev => ({ ...prev, current: prev.total }));
    }
  };

  const exportCSV = () => {
    const headers = ['Rank','Symbol','Name','LTP','Change%','VolRatio','RSI','MACD','Signal','Sector'];
    const rows = results.map((r, i) => [
      i+1, r.symbol, r.name||'', r.last_price, r.pct_change, r.volume_ratio, 
      r.rsi_14?.toFixed(1), r.macd_histogram?.toFixed(2), r.supertrend, r.sector
    ]);
    const csv = [headers, ...rows].map(r => r.join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `screener_results_${new Date().toISOString().slice(0,10)}.csv`;
    a.click();
  };

  const handleSort = (key) => {
    let direction = 'asc';
    if (sortConfig.key === key && sortConfig.direction === 'asc') {
      direction = 'desc';
    }
    setSortConfig({ key, direction });
  };

  const sortedResults = useMemo(() => {
    let sortableItems = [...results];
    if (sortConfig.key !== null) {
      sortableItems.sort((a, b) => {
        let valA = a[sortConfig.key];
        let valB = b[sortConfig.key];
        if (valA === undefined || valA === null) valA = -999999;
        if (valB === undefined || valB === null) valB = -999999;
        if (valA < valB) return sortConfig.direction === 'asc' ? -1 : 1;
        if (valA > valB) return sortConfig.direction === 'asc' ? 1 : -1;
        return 0;
      });
    }
    return sortableItems;
  }, [results, sortConfig]);

  const paginatedResults = useMemo(() => {
    const startIndex = (page - 1) * perPage;
    return sortedResults.slice(startIndex, startIndex + perPage);
  }, [sortedResults, page, perPage]);

  const totalPages = Math.ceil(sortedResults.length / perPage) || 1;

  const groupedFields = FILTER_FIELDS.reduce((acc, field) => {
    acc[field.category] = acc[field.category] || [];
    acc[field.category].push(field);
    return acc;
  }, {});

  const progressPct = scanProgress.total > 0 ? Math.min(100, Math.round((scanProgress.current / scanProgress.total) * 100)) : 0;

  const sigClass = (sig) => {
    if (!sig) return 'sig-neutral';
    const s = sig.toString().toUpperCase();
    if (s === 'BUY')  return 'sig-buy';
    if (s === 'SELL') return 'sig-sell';
    return 'sig-neutral';
  };

  const volClass = (ratio) =>
    parseFloat(ratio) >= 2 ? 'td-volratio high' : 'td-volratio';

  const rsiClass = (rsi) => {
    const r = parseFloat(rsi);
    if (r >= 70) return 'td-rsi overbought';
    if (r <= 30) return 'td-rsi oversold';
    return 'td-rsi';
  };

  const showSector = results.some(r => r.sector && r.sector !== '-');

  return (
    <div className="screener-page-container">
      
      {/* 1. HEADER (Only if standalone is true and it's not nested in App's header) */}
      {!standalone && (
        <div className="section-header">
          <div className="section-icon">🔍</div>
          <div>
            <h1>Universal Screener</h1>
            <p className="section-subtitle">5,000+ NSE & BSE STOCKS</p>
          </div>
        </div>
      )}

      {/* 2. PRESET STRATEGY CARDS */}
      <div className="preset-cards-row">
        {presets.map(preset => {
          let tagClass = 'default';
          let tagText = 'STRATEGY';
          const id = preset.id.toLowerCase();
          if (id.includes('bullish') || id.includes('bounce') || id.includes('buy')) { tagClass = 'bullish'; tagText = 'BULLISH'; }
          if (id.includes('bearish') || id.includes('sell')) { tagClass = 'bearish'; tagText = 'BEARISH'; }
          if (id.includes('momentum') || id.includes('leaders')) { tagClass = 'momentum'; tagText = 'MOMENTUM'; }
          if (id.includes('breakout')) { tagClass = 'breakout'; tagText = 'BREAKOUT'; }

          return (
            <div
              key={preset.id}
              className={`preset-card ${activePreset === preset.id ? 'active' : ''}`}
              onClick={() => loadPreset(preset)}
            >
              <span className={`preset-tag ${tagClass}`}>
                {tagText}
              </span>
              <span className="preset-icon">{preset.icon}</span>
              <div className="preset-title">{preset.name}</div>
              <div className="preset-desc">{preset.description}</div>
            </div>
          );
        })}
      </div>

      {/* 3. ERROR BANNER */}
      {scanError && (
        <div className="error-banner" style={{ borderLeft: '4px solid #ff4444', backgroundColor: 'rgba(255, 68, 68, 0.1)', padding: '16px', borderRadius: '8px', color: '#fff', marginBottom: '16px' }}>
          <strong>Error: </strong> {scanError}
        </div>
      )}

      {/* 4. FILTER BUILDER */}
      <div className="scanner-panel">
        <div className="scanner-panel-header">
          Build Your Scanner
        </div>
        
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
                  
                  <select 
                    value={f.operator} 
                    onChange={e => updateFilter(f.id, 'operator', e.target.value)}
                  >
                    <option value=">">&gt;</option>
                    <option value="<">&lt;</option>
                    <option value=">=">&gt;=</option>
                    <option value="<=">&lt;=</option>
                    <option value="=">=</option>
                  </select>

                  {fieldDef?.type === 'select' ? (
                    <select 
                      value={f.value} 
                      onChange={e => updateFilter(f.id, 'value', e.target.value)}
                    >
                      {fieldDef.options.map(opt => (
                        <option key={opt.value} value={opt.value}>{opt.label}</option>
                      ))}
                    </select>
                  ) : fieldDef?.type === 'boolean' ? (
                    <select 
                      value={f.value} 
                      onChange={e => updateFilter(f.id, 'value', e.target.value === 'true')}
                    >
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
          
          <div className="controls-spacer"></div>
          
          {filters.length > 0 && (
            <button className="clear-all-btn" onClick={() => { setFilters([]); setActivePreset(null); setResults([]); setScanMeta(null); }}>Clear All</button>
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

      {/* 5. LOADING ANIMATION */}
      {isScanning && (
        <div className="scan-status-panel">
          <div style={{display:'flex', alignItems:'center'}}>
            <div className="radar-container"></div>
            <div>
              <div className="status-line">⚡ Scanning {selectedUniverse === 'ALL' ? 'NSE & BSE' : selectedUniverse} universe...</div>
              <div className="status-line">📊 Symbols processed: {scanProgress.current} / {scanProgress.total}</div>
              <div className="status-line">✅ Matches found: {results.length}</div>
            </div>
          </div>
          <div className="scan-progress-bar-track">
            <div className="scan-progress-bar-fill" style={{ width: `${progressPct}%` }}></div>
          </div>
        </div>
      )}

      {/* 6. RESULTS TABLE */}
      {(isScanning || scanMeta || results.length > 0) && (
        <div className="results-wrapper">
          <div className="results-top-bar">
            <div className="results-count-text">
              Scan Complete — <strong>{results.length}</strong> matches found
            </div>
            <button className="csv-btn" onClick={exportCSV}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3"/></svg>
              Export CSV
            </button>
          </div>
          
          {results.length === 0 ? (
            <div className="screener-empty-state" style={{ padding: '60px 0', textAlign: 'center', color: '#fff' }}>
              <div style={{ fontSize: '3rem', opacity: 0.7 }}>🏜️</div>
              <h3>No Matches Found</h3>
              <p style={{ color: 'rgba(255,255,255,0.5)' }}>No stocks currently meet all your strict criteria. Try loosening the parameters or switching the logic to OR.</p>
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
                          prev_close: r.last_price / (1 + r.pct_change/100),
                          change_pct: r.pct_change
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
                  <button 
                    className="page-btn"
                    onClick={() => setPage(p => Math.max(1, p - 1))} 
                    disabled={page === 1}
                  >Prev</button>
                  <button 
                    className="page-btn"
                    onClick={() => setPage(p => Math.min(totalPages, p + 1))} 
                    disabled={page === totalPages || totalPages === 0}
                  >Next</button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* 7. INITIAL EMPTY STATE */}
      {!isScanning && !scanMeta && results.length === 0 && filters.length === 0 && (
        <div className="screener-empty-state" style={{ padding: '60px 0', textAlign: 'center', color: '#fff' }}>
          <div style={{ fontSize: '3rem', opacity: 0.7 }}>🎯</div>
          <h3>Build Your Scanner</h3>
          <p style={{ color: 'rgba(255,255,255,0.5)' }}>Add filters above to scan the market. Or pick a preset strategy to get started instantly.</p>
        </div>
      )}

    </div>
  );
}
