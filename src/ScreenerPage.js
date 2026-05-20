import React, { useState, useEffect, useCallback, useRef } from 'react';

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
  const [results, setResults] = useState([]);
  const [scanMeta, setScanMeta] = useState(null);
  
  const [showAddFilter, setShowAddFilter] = useState(false);
  
  // Pagination & Sorting
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(50);
  const [sortConfig, setSortConfig] = useState({ key: 'change_pct', direction: 'desc' });

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
    setResults([]);
    setScanMeta(null);
    setPage(1);
    
    const body = {
      filters: filters.map(f => ({ field: f.field, operator: f.operator, value: f.value })),
      universe: selectedUniverse,
      logic: filterLogic,
      index_filter: indexFilter,
      sectors: null
    };
    
    try {
      // For SSE streaming, we would use EventSource or fetch with ReadableStream.
      // We implement fetch with ReadableStream for progressive updates.
      const res = await fetch('/api/screener/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      
      const reader = res.body.getReader();
      const decoder = new TextDecoder('utf-8');
      
      let allResults = [];
      let finalMeta = null;
      
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        
        const chunk = decoder.decode(value, { stream: true });
        const lines = chunk.split('\n\n');
        
        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const data = JSON.parse(line.substring(6));
              if (data.results) {
                allResults = data.results;
                setResults(allResults); // Update progressively
              }
              if (data.meta) {
                finalMeta = data.meta;
                setScanMeta(data.meta);
              }
            } catch (e) {}
          }
        }
      }
      
      if (!finalMeta && allResults.length > 0) {
          setScanMeta({ total_matched: allResults.length, scan_time_ms: 0, timestamp: new Date().toISOString() });
      }

    } catch (err) {
      console.error('Scan error:', err);
    } finally {
      setIsScanning(false);
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

  return (
    <div className="screener-page" style={{ minHeight: '100vh', backgroundColor: '#0f0f1a', color: '#ffffff', padding: '24px' }}>
      {/* 2. PRESET STRIP */}
      <div className="screener-presets">
        {presets.map(p => (
          <div 
            key={p.id} 
            className={`screener-preset-card ${activePreset === p.id ? 'active' : ''}`}
            onClick={() => loadPreset(p)}
          >
            <div className="screener-preset-icon">{p.icon}</div>
            <div className="screener-preset-info">
              <div className="screener-preset-name">{p.name}</div>
              <div className="screener-preset-desc">{p.description}</div>
            </div>
          </div>
        ))}
      </div>

      {/* 3. FILTER BUILDER */}
      <div className="screener-filter-panel">
        <div className="screener-filter-header">
          <h3>Filter Criteria</h3>
          {filters.length > 1 && (
            <div className="screener-logic-toggle" onClick={() => setFilterLogic(l => l === 'AND' ? 'OR' : 'AND')}>
              {filterLogic}
            </div>
          )}
        </div>
        
        <div className="screener-filters-list">
          {filters.map((f, index) => {
            const fieldDef = FILTER_FIELDS.find(df => df.key === f.field);
            return (
              <div key={f.id} className="screener-filter-chip">
                {index > 0 && <span className="screener-filter-logic-label">{filterLogic}</span>}
                <span className="screener-filter-label">{fieldDef ? fieldDef.label : f.field}</span>
                
                <select 
                  className="screener-operator-select" 
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
                    className="screener-value-input" 
                    value={f.value} 
                    onChange={e => updateFilter(f.id, 'value', e.target.value)}
                  >
                    {fieldDef.options.map(opt => (
                      <option key={opt.value} value={opt.value}>{opt.label}</option>
                    ))}
                  </select>
                ) : fieldDef?.type === 'boolean' ? (
                  <select 
                    className="screener-value-input" 
                    value={f.value} 
                    onChange={e => updateFilter(f.id, 'value', e.target.value === 'true')}
                  >
                    <option value="true">True</option>
                    <option value="false">False</option>
                  </select>
                ) : (
                  <input 
                    className="screener-value-input" 
                    type="number" 
                    value={f.value} 
                    onChange={e => updateFilter(f.id, 'value', Number(e.target.value))}
                  />
                )}
                
                <button className="screener-remove-filter" onClick={() => removeFilter(f.id)}>×</button>
              </div>
            );
          })}
          
          <div className="screener-add-filter-container">
            <button className="screener-add-filter-btn" onClick={() => setShowAddFilter(!showAddFilter)}>
              + Add Filter
            </button>
            {showAddFilter && (
              <div className="screener-add-filter-dropdown">
                {Object.entries(groupedFields).map(([category, fields]) => (
                  <div key={category} className="screener-filter-category">
                    <div className="screener-filter-category-title">{category}</div>
                    {fields.map(field => (
                      <div key={field.key} className="screener-filter-option" onClick={() => addFilter(field.key)}>
                        {field.label}
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* 4. SCAN CONTROLS */}
      <div className="screener-controls">
        <div className="screener-universe-toggle">
          <button className={`screener-universe-btn ${selectedUniverse === 'NSE' ? 'active' : ''}`} onClick={() => setSelectedUniverse('NSE')}>NSE Only</button>
          <button className={`screener-universe-btn ${selectedUniverse === 'BSE' ? 'active' : ''}`} onClick={() => setSelectedUniverse('BSE')}>BSE Only</button>
          <button className={`screener-universe-btn ${selectedUniverse === 'ALL' ? 'active' : ''}`} onClick={() => setSelectedUniverse('ALL')}>NSE + BSE</button>
        </div>
        
        <button 
          className={`screener-scan-btn ${isScanning ? 'scanning' : ''}`} 
          onClick={runScan} 
          disabled={isScanning || filters.length === 0}
        >
          {isScanning ? 'Scanning...' : 'RUN SCAN'}
        </button>
        
        {filters.length > 0 && (
          <button className="screener-clear-btn" onClick={() => { setFilters([]); setActivePreset(null); setResults([]); setScanMeta(null); }}>Clear All</button>
        )}
      </div>

      {/* 5. LOADING / RESULTS SUMMARY / TABLE */}
      {isScanning && (
        <div className="screener-loading">
          <div className="screener-radar">
             <svg viewBox="0 0 100 100" width="100" height="100">
               <circle cx="50" cy="50" r="48" fill="none" stroke="rgba(0,255,136,0.2)" strokeWidth="2" />
               <circle cx="50" cy="50" r="32" fill="none" stroke="rgba(0,255,136,0.1)" strokeWidth="1" />
               <circle cx="50" cy="50" r="16" fill="none" stroke="rgba(0,255,136,0.05)" strokeWidth="1" />
               <path d="M50 50 L50 2 A48 48 0 0 1 98 50 Z" fill="rgba(0,255,136,0.3)" className="screener-radar-sweep" />
             </svg>
          </div>
          <div className="screener-loading-text">Scanning thousands of stocks...</div>
          <div className="screener-progress-bar"><div className="screener-progress-fill"></div></div>
        </div>
      )}

      {!isScanning && scanMeta && (
        <div className="screener-results-section">
          <div className="screener-summary">
            <div className="screener-summary-left">
              Found <span className="screener-highlight">{scanMeta.total_matched}</span> stocks matching your conditions
            </div>
            <div className="screener-summary-right">
              Scan took {scanMeta.scan_time_ms ? (scanMeta.scan_time_ms / 1000).toFixed(2) : 0}s
              <button className="screener-export-btn" onClick={exportCSV}>📥 Export CSV</button>
            </div>
          </div>
          
          {results.length === 0 ? (
            <div className="screener-empty">
              <div className="screener-empty-icon">🏜️</div>
              <div className="screener-empty-text">No stocks match your current filters</div>
              <div className="screener-empty-sub">Try loosening your filter criteria</div>
            </div>
          ) : (
            <>
              <div className="screener-table-wrapper">
                <table className="screener-table">
                  <thead>
                    <tr>
                      <th>#</th>
                      <th onClick={() => handleSort('symbol')}>Symbol {sortConfig.key === 'symbol' && (sortConfig.direction === 'asc' ? '↑' : '↓')}</th>
                      <th onClick={() => handleSort('price')}>LTP {sortConfig.key === 'price' && (sortConfig.direction === 'asc' ? '↑' : '↓')}</th>
                      <th onClick={() => handleSort('change_pct')}>Change% {sortConfig.key === 'change_pct' && (sortConfig.direction === 'asc' ? '↑' : '↓')}</th>
                      <th onClick={() => handleSort('vol_ratio')}>Vol Ratio {sortConfig.key === 'vol_ratio' && (sortConfig.direction === 'asc' ? '↑' : '↓')}</th>
                      <th onClick={() => handleSort('rsi_14')}>RSI {sortConfig.key === 'rsi_14' && (sortConfig.direction === 'asc' ? '↑' : '↓')}</th>
                      <th onClick={() => handleSort('macd_histogram')}>MACD {sortConfig.key === 'macd_histogram' && (sortConfig.direction === 'asc' ? '↑' : '↓')}</th>
                      <th onClick={() => handleSort('supertrend_direction')}>Signal {sortConfig.key === 'supertrend_direction' && (sortConfig.direction === 'asc' ? '↑' : '↓')}</th>
                      <th onClick={() => handleSort('sector')}>Sector {sortConfig.key === 'sector' && (sortConfig.direction === 'asc' ? '↑' : '↓')}</th>
                      <th>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {paginatedResults.map((r, i) => {
                      const rank = (page - 1) * perPage + i + 1;
                      const changeColor = r.change_pct > 0 ? '#00ff88' : (r.change_pct < 0 ? '#ff4444' : '#aaa');
                      const rsiColor = r.rsi_14 > 70 ? '#ff8800' : (r.rsi_14 < 30 ? '#00aaff' : '#fff');
                      let signalBadge = <span className="screener-badge neutral">NEUTRAL</span>;
                      if (r.supertrend_direction === 1) signalBadge = <span className="screener-badge bullish">BULLISH</span>;
                      if (r.supertrend_direction === -1) signalBadge = <span className="screener-badge bearish">BEARISH</span>;
                      
                      return (
                        <tr key={r.symbol}>
                          <td>{rank}</td>
                          <td className="screener-symbol">{r.symbol}</td>
                          <td>₹{r.price?.toFixed(2)}</td>
                          <td style={{ color: changeColor }}>{r.change_pct > 0 ? '+' : ''}{r.change_pct?.toFixed(2)}%</td>
                          <td>{r.vol_ratio ? r.vol_ratio.toFixed(1) + 'x' : '-'}</td>
                          <td style={{ color: rsiColor }}>{r.rsi_14?.toFixed(1) || '-'}</td>
                          <td>{r.macd_histogram?.toFixed(2) || '-'}</td>
                          <td>{signalBadge}</td>
                          <td className="screener-sector">{r.sector || '-'}</td>
                          <td>
                            <button 
                              className="screener-deep-dive-btn"
                              onClick={() => {
                                if (onStockClick) onStockClick({
                                  symbol: r.symbol,
                                  price: r.price,
                                  prev_close: r.price / (1 + r.change_pct/100),
                                  change_pct: r.change_pct
                                });
                              }}
                            >
                              Deep Dive
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <div className="screener-pagination">
                <div className="screener-page-size">
                  <span>Show: </span>
                  <select value={perPage} onChange={e => { setPerPage(Number(e.target.value)); setPage(1); }}>
                    <option value={25}>25</option>
                    <option value={50}>50</option>
                    <option value={100}>100</option>
                  </select>
                </div>
                <div className="screener-page-nav">
                  <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}>&lt; Prev</button>
                  <span>Page {page} of {totalPages}</span>
                  <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages}>Next &gt;</button>
                </div>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
