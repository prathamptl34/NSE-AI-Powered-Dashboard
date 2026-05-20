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
    <div style={{
      minHeight: '100vh',
      backgroundColor: '#0f0f1a', 
      color: '#00ff88',
      fontSize: '32px',
      padding: '40px',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center'
    }}>
      ✅ Screener Page Loaded Successfully
    </div>
  );
}
