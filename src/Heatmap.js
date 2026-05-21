import React, { useState, useEffect, useRef, useCallback, useMemo } from "react";
import './Heatmap.css';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getISTTime() {
  const d = new Date();
  const day = d.getDate().toString().padStart(2, '0');
  const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const month = monthNames[d.getMonth()];
  const year = d.getFullYear();
  const h = d.getHours().toString().padStart(2, '0');
  const m = d.getMinutes().toString().padStart(2, '0');
  const s = d.getSeconds().toString().padStart(2, '0');
  return `${day} ${month} ${year}  ${h}:${m}:${s} IST`;
}

const getTileStyle = (changePct) => {
  const v = parseFloat(changePct) || 0;
  if (v > 0) {
    if (v >= 3)   return { backgroundColor: '#0d2010', boxShadow: '0 0 12px rgba(34,197,94,0.15)' };
    if (v >= 1.5) return { backgroundColor: '#0b1a0e', boxShadow: 'none' };
    if (v >= 0.5) return { backgroundColor: '#091509', boxShadow: 'none' };
                  return { backgroundColor: '#07120a', boxShadow: 'none' };
  } else if (v < 0) {
    if (v <= -3)  return { backgroundColor: '#1f0808', boxShadow: '0 0 12px rgba(239,68,68,0.15)' };
    if (v <= -1.5)return { backgroundColor: '#190707', boxShadow: 'none' };
    if (v <= -0.5)return { backgroundColor: '#130606', boxShadow: 'none' };
                  return { backgroundColor: '#0f0505', boxShadow: 'none' };
  }
  return { backgroundColor: '#0d0d0f', boxShadow: 'none' }; // flat/neutral
};

// ─── Skeleton Tile ────────────────────────────────────────────────────────────

function SkeletonTile() {
  return (
    <div className="index-tile skeleton-tile">
      <div style={{ height: '14px', width: '50%', background: '#222', margin: '12px', borderRadius: '2px' }} />
      <div style={{ height: '36px', width: '80%', background: '#222', margin: '0 12px 12px 12px', borderRadius: '4px' }} />
    </div>
  );
}

// ─── Index Tile ───────────────────────────────────────────────────────────────

const IndexTile = React.memo(({ tile, isBest, isWorst, isDimmed, onClick, maxAbsPct }) => {
  const tileRef = useRef(null);
  const prevPct = useRef(null);

  useEffect(() => {
    if (!tileRef.current || prevPct.current === null) {
      prevPct.current = tile.change_pct;
      return;
    }
    if (tile.change_pct !== prevPct.current) {
      const cls = tile.change_pct > prevPct.current ? "tile-flash-green" : "tile-flash-red";
      tileRef.current.classList.add(cls);
      const timer = setTimeout(() => tileRef.current?.classList.remove(cls), 800);
      prevPct.current = tile.change_pct;
      return () => clearTimeout(timer);
    }
  }, [tile.change_pct]);

  const tileStyle = getTileStyle(tile.change_pct);
  const perfBarWidth = maxAbsPct ? Math.min(100, (Math.abs(tile.change_pct) / maxAbsPct) * 100) : 0;
  const perfBarColor = tile.change_pct >= 0 ? '#4ade80' : '#f87171';

  const extremeClass = isBest ? "best-gainer" : isWorst ? "worst-loser" : "";

  const fmt = (n) =>
    n != null ? "₹" + Number(n).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "—";

  const pct = (n) =>
    n != null ? `${n >= 0 ? "+" : ""}${Number(n).toFixed(2)}%` : "—";

  return (
    <div
      className={`index-tile ${extremeClass} ${isDimmed ? "tile-dimmed" : ""}`}
      ref={tileRef}
      onClick={onClick}
      style={{ cursor: "pointer", ...tileStyle }}
    >
      <div className="hm-row-1">
        <span className="hm-index-name">{tile.sector}</span>
        <span className={`hm-arrow ${tile.change_pct >= 0 ? "hm-arrow-up" : "hm-arrow-down"}`}>
          {tile.change_pct >= 0 ? "▲" : "▼"}
        </span>
      </div>

      <div className={`hm-row-2 ${tile.change_pct > 0 ? "hm-pct-pos" : tile.change_pct < 0 ? "hm-pct-neg" : "hm-pct-zero"}`}>
        {pct(tile.change_pct)}
        <div className="hm-perf-bar-container">
          <div className="hm-perf-bar-fill" style={{ width: `${perfBarWidth}%`, backgroundColor: perfBarColor }} />
        </div>
      </div>

      <div className="hm-divider" />

      <div className="hm-stock-row hm-gainer-section">
        <span className="hm-label-row">TOP GAINER</span>
        <div className="hm-stock-line hm-gainer-row">
          <span className="hm-stock-name hm-gainer-name">{tile.top_gainer?.symbol || "..."}</span>
          <span className="hm-stock-pill hm-gainer-badge pill-stock-up">
            {tile.top_gainer?.change_pct != null ? pct(tile.top_gainer.change_pct) : "..."}
          </span>
        </div>
      </div>

      <div className="hm-stock-row hm-loser-section">
        <span className="hm-label-row">TOP LOSER</span>
        <div className="hm-stock-line hm-loser-row">
          <span className="hm-stock-name hm-loser-name">{tile.top_loser?.symbol || "..."}</span>
          <span className="hm-stock-pill hm-loser-badge pill-stock-down">
            {tile.top_loser?.change_pct != null ? pct(tile.top_loser.change_pct) : "..."}
          </span>
        </div>
      </div>
    </div>
  );
});

// ─── Sector Modal ─────────────────────────────────────────────────────────────

function SectorModal({ tile, onClose }) {
  const stocks = tile.stocks || [];
  const positiveCount = stocks.filter(s => s.change_percent > 0).length;
  const negativeCount = stocks.filter(s => s.change_percent < 0).length;

  const fmt = (n) =>
    n != null ? "₹" + Number(n).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "—";

  const pct = (n) =>
    n != null ? `${n >= 0 ? "+" : ""}${Number(n).toFixed(2)}%` : "—";

  const isPos = tile.change_pct > 0;
  const isNeg = tile.change_pct < 0;

  // Find min and max for gainer/loser cards
  const sortedByChange = [...stocks].sort((a, b) => b.change_percent - a.change_percent);
  const topGainerSymbol = sortedByChange[0]?.symbol;
  const topLoserSymbol = sortedByChange[sortedByChange.length - 1]?.symbol;

  return (
    <div className="heatmap-modal-overlay" onClick={onClose}>
      <div className="heatmap-modal" onClick={e => e.stopPropagation()}>
        
        <div className="hm-modal-header">
          <div className="hm-modal-header-left">
            <div className="hm-modal-index-name">{tile.sector}</div>
            <div className={`hm-modal-pct-change ${isPos ? "hm-pct-pos" : isNeg ? "hm-pct-neg" : "hm-pct-zero"}`}>
              {pct(tile.change_pct)}
            </div>
            <div className="hm-modal-badges">
              <span className="hm-modal-badge badge-adv">↑ {positiveCount} Advancing</span>
              <span className="hm-modal-badge badge-dec">↓ {negativeCount} Declining</span>
            </div>
          </div>
          <button className="hm-modal-close" onClick={onClose}>×</button>
        </div>

        <div className="hm-modal-content">
          {stocks.length === 0 ? (
            <div className="hm-modal-empty">No live data yet — waiting for market ticks</div>
          ) : (
            <div className="hm-modal-grid">
              {stocks.map((s, idx) => {
                const isTopGainer = s.symbol === topGainerSymbol && s.change_percent > 0;
                const isTopLoser = s.symbol === topLoserSymbol && s.change_percent < 0;
                
                return (
                  <div
                    key={s.symbol}
                    className={`hm-modal-card ${isTopGainer ? "hm-card-best" : ""} ${isTopLoser ? "hm-card-worst" : ""}`}
                  >
                    <span className="hm-modal-rank">{idx + 1}</span>
                    <span className="hm-modal-symbol">{s.symbol}</span>
                    <span className="hm-modal-price">{fmt(s.ltp)}</span>
                    <span className={`hm-modal-badge ${s.change_percent >= 0 ? 'pill-up' : 'pill-down'}`}>
                      {pct(s.change_percent)}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="hm-modal-footer">
          {stocks.length} Stocks · ↑ {positiveCount} Advancing · ↓ {negativeCount} Declining
        </div>

      </div>
    </div>
  );
}


// ─── Main Heatmap Page ────────────────────────────────────────────────────────

export default function HeatmapPage({ onBack, wsStatus }) {
  const [indices, setIndices] = useState([]);
  const [streaming, setStreaming] = useState(false);
  const [timeStr, setTimeStr] = useState(getISTTime());
  // expandedSector holds the full tile data object (or null)
  const [expandedSector, setExpandedSector] = useState(null);
  const sseRef = useRef(null);

  // Live clock
  useEffect(() => {
    const id = setInterval(() => setTimeStr(getISTTime()), 1000);
    return () => clearInterval(id);
  }, []);

  // ESC key closes modal
  useEffect(() => {
    const handler = (e) => { if (e.key === "Escape") setExpandedSector(null); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  // Merge logic
  const mergeIndices = useCallback((incoming) => {
    setIndices((prev) => {
      if (!prev.length) {
        return [...incoming].sort((a, b) => (b.change_pct || 0) - (a.change_pct || 0));
      }
      const map = {};
      incoming.forEach((idx) => { map[idx.sector] = idx; });
      const next = prev.map((idx) => map[idx.sector] || idx);
      return next.sort((a, b) => (b.change_pct || 0) - (a.change_pct || 0));
    });
  }, []);

  // SSE + Initial Fetch
  useEffect(() => {
    let es = null;
    let timer = null;

    const fetchInitial = async () => {
      try {
        const base = window.location.port === "3000" ? "http://127.0.0.1:8001" : "";
        const res = await fetch(`${base}/api/heatmap/sectoral`);
        if (res.ok) {
          const data = await res.json();
          if (data.indices) setIndices(data.indices);
        }
      } catch (err) {
        console.error("Heatmap initial fetch error:", err);
      }
    };

    function connect() {
      const base = window.location.port === "3000" ? "http://127.0.0.1:8001" : "";
      es = new EventSource(`${base}/api/heatmap/stream`);
      sseRef.current = es;

      es.onopen = () => setStreaming(true);

      es.onmessage = (e) => {
        try {
          const data = JSON.parse(e.data);
          if (data.indices) mergeIndices(data.indices);
        } catch {}
      };

      es.onerror = () => {
        setStreaming(false);
        es.close();
        timer = setTimeout(connect, 3000);
      };
    }

    fetchInitial();
    connect();

    return () => {
      clearTimeout(timer);
      if (sseRef.current) { sseRef.current.close(); sseRef.current = null; }
    };
  }, [mergeIndices]);

  // Derived Extremes
  const extremes = useMemo(() => {
    if (!indices.length) return { best: null, worst: null };
    let bestIdx = indices[0], worstIdx = indices[0];
    indices.forEach(idx => {
      if (idx.change_pct > bestIdx.change_pct) bestIdx = idx;
      if (idx.change_pct < worstIdx.change_pct) worstIdx = idx;
    });
    return { best: bestIdx.sector, worst: worstIdx.sector };
  }, [indices]);

  // Derived max absolute pct for performance bar
  const maxAbsPct = useMemo(() => {
    if (!indices.length) return 0;
    const rawMax = Math.max(...indices.map(idx => Math.abs(idx.change_pct)));
    return Math.min(rawMax, 3.0);
  }, [indices]);

  // Stats for pills
  const stats = useMemo(() => {
    let g = 0, f = 0, l = 0;
    indices.forEach(idx => {
      const v = parseFloat(idx.change_pct) || 0;
      if (v > 0) g++;
      if (v >= -0.5 && v <= 0.5) f++;
      if (v < 0) l++;
    });
    return { g, f, l };
  }, [indices]);

  return (
    <div className="heatmap-wrapper">
      {/* Scoped CSS moved to index.css */}

      {/* ── Terminal Header ── */}
      <div className="hm-terminal-header">
        <div className="hm-header-left">
          {onBack && (
            <button className="hm-back-btn" onClick={onBack}>
              ← Back
            </button>
          )}
          <h2 className="hm-title">Market Heatmap</h2>
          <span className="hm-live-dot">{streaming ? '● LIVE' : '● OFF'}</span>
        </div>
        <div className="hm-header-right" style={{display:'flex', alignItems:'center', gap:'12px'}}>
          <div className="hm-filter-pills" style={{display:'flex', gap:'10px'}}>
            <div style={{ display: 'flex', alignItems: 'center', backgroundColor: 'rgba(34, 197, 94, 0.15)', color: '#4ade80', padding: '6px 14px', borderRadius: '20px', fontSize: '13px', fontWeight: '600', border: '1px solid rgba(34, 197, 94, 0.2)' }}>
              <span style={{ marginRight: '8px' }}>🟢 Gaining</span>
              <span style={{ backgroundColor: 'rgba(34, 197, 94, 0.2)', color: '#4ade80', padding: '2px 8px', borderRadius: '12px', fontSize: '12px', fontWeight: 'bold' }}>{stats.g}</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', backgroundColor: 'rgba(156, 163, 175, 0.15)', color: '#9ca3af', padding: '6px 14px', borderRadius: '20px', fontSize: '13px', fontWeight: '600', border: '1px solid rgba(156, 163, 175, 0.2)' }}>
              <span style={{ marginRight: '8px' }}>⚪ Flat</span>
              <span style={{ backgroundColor: 'rgba(156, 163, 175, 0.2)', color: '#9ca3af', padding: '2px 8px', borderRadius: '12px', fontSize: '12px', fontWeight: 'bold' }}>{stats.f}</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', backgroundColor: 'rgba(239, 68, 68, 0.15)', color: '#f87171', padding: '6px 14px', borderRadius: '20px', fontSize: '13px', fontWeight: '600', border: '1px solid rgba(239, 68, 68, 0.2)' }}>
              <span style={{ marginRight: '8px' }}>🔴 Declining</span>
              <span style={{ backgroundColor: 'rgba(239, 68, 68, 0.2)', color: '#f87171', padding: '2px 8px', borderRadius: '12px', fontSize: '12px', fontWeight: 'bold' }}>{stats.l}</span>
            </div>
          </div>
          <span className="hm-header-time">{timeStr}</span>
        </div>
      </div>

      {/* ── Grid ── */}
      <div className="hm-terminal-grid">
        {indices.length > 0
          ? indices.map((idx) => (
              <IndexTile
                key={idx.sector}
                tile={idx}
                isBest={idx.sector === extremes.best}
                isWorst={idx.sector === extremes.worst}
                isDimmed={false}
                onClick={() => setExpandedSector(idx)}
                maxAbsPct={maxAbsPct}
              />
            ))
          : Array.from({ length: 21 }).map((_, i) => (
              <SkeletonTile key={`skel-${i}`} />
            ))
        }
      </div>

      {/* ── Sector Modal (outside grid, fixed overlay) ── */}
      {expandedSector && (
        <SectorModal
          tile={expandedSector}
          onClose={() => setExpandedSector(null)}
        />
      )}
    </div>
  );
}
