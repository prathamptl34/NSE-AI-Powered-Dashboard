import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import './screener.css';

const FILTER_FIELDS = [
  // Price
  { key: 'price', label: 'Last Price', type: 'number', category: 'Price', defaultOp: '>', defaultVal: 0 },
  { key: 'change_pct', label: '% Change Today', type: 'number', category: 'Price', defaultOp: '>', defaultVal: 2 },
  { key: 'price_vs_52w_high', label: '% From 52W High', type: 'number', category: 'Price', defaultOp: '<', defaultVal: 5 },
  { key: 'price_vs_52w_low', label: '% From 52W Low', type: 'number', category: 'Price', defaultOp: '>', defaultVal: 10 },
  { key: 'price_vs_ema_9', label: 'Price vs EMA 9', type: 'number', category: 'Price', defaultOp: '>', defaultVal: 0 },
  { key: 'price_vs_ema_20', label: 'Price vs EMA 20', type: 'number', category: 'Price', defaultOp: '>', defaultVal: 0 },
  { key: 'price_vs_ema_50', label: 'Price vs EMA 50', type: 'number', category: 'Price', defaultOp: '>', defaultVal: 0 },
  { key: 'price_vs_ema_200', label: 'Price vs EMA 200', type: 'number', category: 'Price', defaultOp: '>', defaultVal: 0 },
  { key: 'price_vs_vwap', label: 'Price vs VWAP', type: 'number', category: 'Price', defaultOp: '>', defaultVal: 0 },
  // Volume
  { key: 'vol_ratio', label: 'Volume Ratio (x avg)', type: 'number', category: 'Volume', defaultOp: '>', defaultVal: 2 },
  { key: 'volume', label: 'Volume (abs)', type: 'number', category: 'Volume', defaultOp: '>', defaultVal: 100000 },
  // Technical
  { key: 'rsi_14', label: 'RSI (14)', type: 'number', category: 'Technical', defaultOp: '<', defaultVal: 30 },
  { key: 'macd_histogram', label: 'MACD Histogram', type: 'number', category: 'Technical', defaultOp: '>', defaultVal: 0 },
  { key: 'adx', label: 'ADX', type: 'number', category: 'Technical', defaultOp: '>', defaultVal: 25 },
  { key: 'bb_bandwidth', label: 'BB Bandwidth', type: 'number', category: 'Technical', defaultOp: '<', defaultVal: 0.1 },
  { key: 'supertrend_direction', label: 'Supertrend', type: 'select', category: 'Technical', options: [{value: 1, label: 'Bullish'}, {value: -1, label: 'Bearish'}], defaultOp: '=', defaultVal: 1 },
  // Patterns
  { key: 'bullish_engulfing', label: 'Bullish Engulfing', type: 'boolean', category: 'Patterns', defaultOp: '=', defaultVal: true },
  { key: 'bearish_engulfing', label: 'Bearish Engulfing', type: 'boolean', category: 'Patterns', defaultOp: '=', defaultVal: true },
  { key: 'doji', label: 'Doji', type: 'boolean', category: 'Patterns', defaultOp: '=', defaultVal: true },
  { key: 'hammer', label: 'Hammer', type: 'boolean', category: 'Patterns', defaultOp: '=', defaultVal: true },
  { key: 'morning_star', label: 'Morning Star', type: 'boolean', category: 'Patterns', defaultOp: '=', defaultVal: true },
  { key: 'evening_star', label: 'Evening Star', type: 'boolean', category: 'Patterns', defaultOp: '=', defaultVal: true },
  // Fundamental
  { key: 'sector', label: 'Sector', type: 'select', category: 'Fundamental', options: [
    {value:'IT',label:'IT'},{value:'BANKS',label:'Banks'},{value:'PHARMA',label:'Pharma'},
    {value:'AUTO',label:'Auto'},{value:'FMCG',label:'FMCG'},{value:'METALS',label:'Metals'},
    {value:'ENERGY',label:'Energy'},{value:'FINANCE',label:'Finance'},{value:'INFRA',label:'Infra'},
    {value:'TELECOM',label:'Telecom'},{value:'CONSUMER',label:'Consumer'},{value:'REALTY',label:'Realty'}
  ], defaultOp: '=', defaultVal: 'IT' },
  { key: 'index_membership', label: 'Index', type: 'select', category: 'Fundamental', options: [
    {value:'nifty50',label:'Nifty 50'},{value:'nifty100',label:'Nifty 100'},
    {value:'midcap100',label:'Midcap 100'},{value:'fno',label:'F&O List'}
  ], defaultOp: '=', defaultVal: 'nifty50' },
  { key: 'is_fno', label: 'F&O Stock', type: 'boolean', category: 'Fundamental', defaultOp: '=', defaultVal: true },
];

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
  const [sortConfig, setSortConfig] = useState({ key: 'change_pct', direction: 'desc' });

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
      i+1, r.symbol, r.name||'', r.price, r.change_pct, r.vol_ratio, 
      r.rsi_14?.toFixed(1), r.macd_histogram?.toFixed(2), r.supertrend_direction, r.sector
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
      <div className="screener-presets-scroll-wrapper">
        <div className="screener-presets-row">
          {presets.map(p => {
            // Determine premium tag style based on id/name
            let tagClass = 'default';
            let tagText = 'STRATEGY';
            const id = p.id.toLowerCase();
            if (id.includes('bullish') || id.includes('bounce') || id.includes('buy')) { tagClass = 'bullish'; tagText = 'BULLISH'; }
            if (id.includes('bearish') || id.includes('sell')) { tagClass = 'bearish'; tagText = 'BEARISH'; }
            if (id.includes('momentum') || id.includes('leaders')) { tagClass = 'momentum'; tagText = 'MOMENTUM'; }
            if (id.includes('breakout')) { tagClass = 'breakout'; tagText = 'BREAKOUT'; }

            return (
              <div 
                key={p.id} 
                className={`screener-preset-card ${activePreset === p.id ? 'active' : ''}`}
                onClick={() => loadPreset(p)}
              >
                <div className="screener-preset-header">
                  <div className="screener-preset-icon">{p.icon}</div>
                  <div className={`screener-preset-tag ${tagClass}`}>{tagText}</div>
                </div>
                <h4 className="screener-preset-title">{p.name}</h4>
                <p className="screener-preset-desc">{p.description}</p>
              </div>
            );
          })}
        </div>
      </div>

      {/* 3. ERROR BANNER */}
      {scanError && (
        <div className="error-banner" style={{ borderLeft: '4px solid #ff4444', backgroundColor: 'rgba(255, 68, 68, 0.1)', padding: '16px', borderRadius: '8px', color: '#fff', marginBottom: '16px' }}>
          <strong>Error: </strong> {scanError}
        </div>
      )}

      {/* 4. FILTER BUILDER */}
      <div className="screener-filter-panel">
        <div className="screener-filter-header">
          <h3>Build Your Scanner</h3>
        </div>
        
        <div className="screener-filters-list">
          {filters.map((f, index) => {
            const fieldDef = FILTER_FIELDS.find(df => df.key === f.field);
            return (
              <React.Fragment key={f.id}>
                {index > 0 && (
                  <div className="screener-logic-badge" onClick={() => setFilterLogic(l => l === 'AND' ? 'OR' : 'AND')}>
                    {filterLogic}
                  </div>
                )}
                <div className="screener-filter-chip">
                  <span className="screener-filter-name">{fieldDef ? fieldDef.label : f.field}</span>
                  
                  <select 
                    className="screener-filter-op" 
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
                      className="screener-filter-val" 
                      value={f.value} 
                      onChange={e => updateFilter(f.id, 'value', e.target.value)}
                      style={{ width: 'auto' }}
                    >
                      {fieldDef.options.map(opt => (
                        <option key={opt.value} value={opt.value}>{opt.label}</option>
                      ))}
                    </select>
                  ) : fieldDef?.type === 'boolean' ? (
                    <select 
                      className="screener-filter-val" 
                      value={f.value} 
                      onChange={e => updateFilter(f.id, 'value', e.target.value === 'true')}
                      style={{ width: 'auto' }}
                    >
                      <option value="true">True</option>
                      <option value="false">False</option>
                    </select>
                  ) : (
                    <input 
                      className="screener-filter-val" 
                      type="number" 
                      value={f.value} 
                      onChange={e => updateFilter(f.id, 'value', Number(e.target.value))}
                    />
                  )}
                  
                  <button className="screener-filter-remove" onClick={() => removeFilter(f.id)}>×</button>
                </div>
              </React.Fragment>
            );
          })}
          
          <div className="screener-add-container" ref={addFilterRef}>
            <button className="screener-add-btn" onClick={() => setShowAddFilter(!showAddFilter)}>
              + Add Filter
            </button>
            {showAddFilter && (
              <div className="screener-dropdown-menu">
                {Object.entries(groupedFields).map(([category, fields]) => (
                  <div key={category} className="screener-dropdown-group">
                    <div className="screener-dropdown-group-title">{category}</div>
                    {fields.map(field => (
                      <div key={field.key} className="screener-dropdown-item" onClick={() => addFilter(field.key)}>
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
        <div className="screener-controls-row">
          <div className="screener-exchange-toggle">
            <button className={`screener-exchange-btn ${selectedUniverse === 'NSE' ? 'active' : ''}`} onClick={() => setSelectedUniverse('NSE')}>NSE Only</button>
            <button className={`screener-exchange-btn ${selectedUniverse === 'BSE' ? 'active' : ''}`} onClick={() => setSelectedUniverse('BSE')}>BSE Only</button>
            <button className={`screener-exchange-btn ${selectedUniverse === 'ALL' ? 'active' : ''}`} onClick={() => setSelectedUniverse('ALL')}>NSE + BSE</button>
          </div>
          
          <div className="screener-run-container">
            {filters.length > 0 && (
              <button className="screener-clear-btn" onClick={() => { setFilters([]); setActivePreset(null); setResults([]); setScanMeta(null); }}>Clear All</button>
            )}
            
            <button 
              className={`screener-run-btn ${isScanning ? 'scanning' : ''}`} 
              onClick={runScan} 
              disabled={isScanning || filters.length === 0}
            >
              {isScanning ? (
                <>
                  <span className="spinner">⏳</span> SCANNING...
                </>
              ) : 'RUN SCAN'}
            </button>
          </div>
        </div>
      </div>

      {/* 5. LOADING ANIMATION */}
      {isScanning && (
        <div className="screener-status-panel">
          <div className="screener-radar-container"></div>
          <div className="screener-status-text">
            ⚡ Scanning {selectedUniverse === 'ALL' ? 'NSE & BSE' : selectedUniverse} universe...<br/>
            📊 Symbols processed: {scanProgress.current} / {scanProgress.total}<br/>
            ✅ Matches found so far: {results.length}
          </div>
          <div className="screener-progress-wrapper">
            <div className="screener-progress-bar" style={{ width: `${progressPct}%` }}></div>
          </div>
        </div>
      )}

      {/* 6. RESULTS TABLE */}
      {!isScanning && (scanMeta || results.length > 0) && (
        <div className="screener-results-container">
          <div className="screener-table-header">
            <h4 className="screener-table-title">
              Scan Complete — <span>{results.length}</span> matches found
            </h4>
            <div className="screener-table-actions">
              <button onClick={exportCSV}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3"/></svg>
                Export CSV
              </button>
            </div>
          </div>
          
          {results.length === 0 ? (
            <div className="screener-empty-state">
              <div className="screener-empty-icon">🏜️</div>
              <h3>No Matches Found</h3>
              <p>No stocks currently meet all your strict criteria. Try loosening the parameters or switching the logic to OR.</p>
            </div>
          ) : (
            <div className="screener-table-wrapper">
              <table className="screener-table">
                <thead>
                  <tr>
                    <th>#</th>
                    <th onClick={() => handleSort('symbol')}>Symbol {sortConfig.key === 'symbol' && (sortConfig.direction === 'asc' ? '▲' : '▼')}</th>
                    <th onClick={() => handleSort('price')}>LTP {sortConfig.key === 'price' && (sortConfig.direction === 'asc' ? '▲' : '▼')}</th>
                    <th onClick={() => handleSort('change_pct')}>Change% {sortConfig.key === 'change_pct' && (sortConfig.direction === 'asc' ? '▲' : '▼')}</th>
                    <th onClick={() => handleSort('vol_ratio')}>Vol Ratio {sortConfig.key === 'vol_ratio' && (sortConfig.direction === 'asc' ? '▲' : '▼')}</th>
                    <th onClick={() => handleSort('rsi_14')}>RSI {sortConfig.key === 'rsi_14' && (sortConfig.direction === 'asc' ? '▲' : '▼')}</th>
                    <th onClick={() => handleSort('supertrend_direction')}>Signal {sortConfig.key === 'supertrend_direction' && (sortConfig.direction === 'asc' ? '▲' : '▼')}</th>
                    <th onClick={() => handleSort('sector')}>Sector {sortConfig.key === 'sector' && (sortConfig.direction === 'asc' ? '▲' : '▼')}</th>
                  </tr>
                </thead>
                <tbody>
                  {paginatedResults.map((r, i) => {
                    const rank = (page - 1) * perPage + i + 1;
                    const isPositive = r.change_pct > 0;
                    
                    let signalBadge = <span className="screener-badge neutral">NEUTRAL</span>;
                    if (r.supertrend_direction === 1) signalBadge = <span className="screener-badge bullish">BULLISH</span>;
                    if (r.supertrend_direction === -1) signalBadge = <span className="screener-badge bearish">BEARISH</span>;
                    
                    const exBadge = r.symbol.includes('.BSE') ? 'bse' : 'nse';
                    const exLabel = r.symbol.includes('.BSE') ? 'BSE' : 'NSE';

                    return (
                      <tr key={r.symbol} onClick={() => {
                        if (onStockClick) onStockClick({
                          symbol: r.symbol,
                          price: r.price,
                          prev_close: r.price / (1 + r.change_pct/100),
                          change_pct: r.change_pct
                        });
                      }}>
                        <td style={{ color: 'rgba(255,255,255,0.3)' }}>{rank}</td>
                        <td>
                          <div className="screener-table-symbol">
                            {r.symbol}
                            <span className={`screener-exchange-badge ${exBadge}`}>{exLabel}</span>
                          </div>
                        </td>
                        <td className="screener-table-price">₹{r.price?.toFixed(2)}</td>
                        <td className={`screener-table-change ${isPositive ? 'positive' : 'negative'}`}>
                          {isPositive ? '▲' : '▼'} {Math.abs(r.change_pct || 0).toFixed(2)}%
                        </td>
                        <td>{r.vol_ratio ? r.vol_ratio.toFixed(1) + 'x' : '-'}</td>
                        <td>{r.rsi_14?.toFixed(1) || '-'}</td>
                        <td>{signalBadge}</td>
                        <td className="screener-sector">{r.sector || '-'}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              
              <div className="screener-pagination" style={{ padding: '16px 24px', display: 'flex', justifyContent: 'space-between', borderTop: '1px solid rgba(255,255,255,0.05)' }}>
                <div style={{ color: 'rgba(255,255,255,0.5)', fontSize: '13px' }}>
                  Showing {Math.min(results.length, (page - 1) * perPage + 1)} to {Math.min(results.length, page * perPage)} of {results.length} results
                </div>
                <div className="screener-page-nav" style={{ display: 'flex', gap: '8px' }}>
                  <button 
                    onClick={() => setPage(p => Math.max(1, p - 1))} 
                    disabled={page === 1}
                    style={{ background: 'rgba(255,255,255,0.05)', border: 'none', color: '#fff', padding: '4px 12px', borderRadius: '4px', cursor: 'pointer', opacity: page === 1 ? 0.3 : 1 }}
                  >Prev</button>
                  <button 
                    onClick={() => setPage(p => Math.min(totalPages, p + 1))} 
                    disabled={page === totalPages || totalPages === 0}
                    style={{ background: 'rgba(255,255,255,0.05)', border: 'none', color: '#fff', padding: '4px 12px', borderRadius: '4px', cursor: 'pointer', opacity: (page === totalPages || totalPages === 0) ? 0.3 : 1 }}
                  >Next</button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* 7. INITIAL EMPTY STATE */}
      {!isScanning && !scanMeta && results.length === 0 && filters.length === 0 && (
        <div className="screener-empty-state">
          <div className="screener-empty-icon">🎯</div>
          <h3>Build Your Scanner</h3>
          <p>Add filters above to scan the market. Or pick a preset strategy to get started instantly.</p>
        </div>
      )}

    </div>
  );
}
