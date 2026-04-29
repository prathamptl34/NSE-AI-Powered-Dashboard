import React, { useState, useEffect, useRef, useCallback, useMemo } from "react";

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

function getIntensityClass(pct) {
  if (pct >= 2.0) return "intensity-g3";
  if (pct >= 1.0) return "intensity-g2";
  if (pct >= 0) return "intensity-g1";
  if (pct > -1.0) return "intensity-r1";
  if (pct > -2.0) return "intensity-r2";
  return "intensity-r3";
}

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

const IndexTile = React.memo(({ tile, isBest, isWorst, isDimmed }) => {
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

  const intensityClass = getIntensityClass(tile.change_pct);
  const extremeClass = isBest ? "best-gainer" : isWorst ? "worst-loser" : "";

  const fmt = (n) =>
    n != null ? "₹" + Number(n).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "—";

  const pct = (n) =>
    n != null ? `${n >= 0 ? "+" : ""}${Number(n).toFixed(2)}%` : "—";

  return (
    <div className={`index-tile ${intensityClass} ${extremeClass} ${isDimmed ? "tile-dimmed" : ""}`} ref={tileRef}>
      <div className="hm-row-1">
        <span className="hm-index-name">{tile.sector}</span>
        <span className={`hm-arrow ${tile.change_pct >= 0 ? "hm-arrow-up" : "hm-arrow-down"}`}>
          {tile.change_pct >= 0 ? "▲" : "▼"}
        </span>
      </div>

      <div className={`hm-row-2 ${tile.change_pct > 0 ? "hm-pct-pos" : tile.change_pct < 0 ? "hm-pct-neg" : "hm-pct-zero"}`}>
        {pct(tile.change_pct)}
      </div>

      <div className="hm-divider" />

      <div className="hm-stock-row">
        <span className="hm-row-label">Top Gainer</span>
        <div className="hm-stock-line">
          <span className="hm-stock-name">{tile.top_gainer?.symbol || "..."}</span>
          <div className="hm-stock-right">
            <span className="hm-stock-price">{fmt(tile.top_gainer?.ltp)}</span>
            {tile.top_gainer?.change_pct != null && (
              <span className="hm-stock-pill pill-stock-up">{pct(tile.top_gainer.change_pct)}</span>
            )}
          </div>
        </div>
      </div>

      <div className="hm-stock-row">
        <span className="hm-row-label">Top Loser</span>
        <div className="hm-stock-line">
          <span className="hm-stock-name">{tile.top_loser?.symbol || "..."}</span>
          <div className="hm-stock-right">
            <span className="hm-stock-price">{fmt(tile.top_loser?.ltp)}</span>
            {tile.top_loser?.change_pct != null && (
              <span className="hm-stock-pill pill-stock-down">{pct(tile.top_loser.change_pct)}</span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
});

// ─── Main Heatmap Page ────────────────────────────────────────────────────────

export default function HeatmapPage({ onBack, wsStatus }) {
  const [indices, setIndices] = useState([]);
  const [streaming, setStreaming] = useState(false);
  const [timeStr, setTimeStr] = useState(getISTTime());
  const [activeFilter, setActiveFilter] = useState(null); // gainers, flat, losers
  const sseRef = useRef(null);

  // Live clock
  useEffect(() => {
    const id = setInterval(() => setTimeStr(getISTTime()), 1000);
    return () => clearInterval(id);
  }, []);

  // Merge logic
  const mergeIndices = useCallback((incoming) => {
    setIndices((prev) => {
      if (!prev.length) return incoming;
      const map = {};
      incoming.forEach((idx) => { map[idx.sector] = idx; });
      return prev.map((idx) => map[idx.sector] || idx);
    });
  }, []);

  // SSE + Initial Fetch
  useEffect(() => {
    let es = null;
    let timer = null;

    // Fast initial load
    const fetchInitial = async () => {
      try {
        const base = window.location.port === "3000" ? "http://127.0.0.1:8000" : "";
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
      const base = window.location.port === "3000" ? "http://127.0.0.1:8000" : "";
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

  // Stats for pills
  const stats = useMemo(() => {
    let g = 0, f = 0, l = 0;
    indices.forEach(idx => {
      if (idx.change_pct > 1) g++;
      else if (idx.change_pct < -1) l++;
      else f++;
    });
    return { g, f, l };
  }, [indices]);

  const toggleFilter = (type) => {
    setActiveFilter(activeFilter === type ? null : type);
  };

  const getIsDimmed = (idx) => {
    if (!activeFilter) return false;
    if (activeFilter === "gainers") return idx.change_pct <= 1;
    if (activeFilter === "losers") return idx.change_pct >= -1;
    if (activeFilter === "flat") return idx.change_pct > 1 || idx.change_pct < -1;
    return false;
  };

  return (
    <div className="heatmap-wrapper">
      {/* ── Terminal Header ── */}
      <header className="hm-terminal-header">
        <div className="hm-header-left">
          {onBack && (
            <button className="hm-back-btn" onClick={onBack}>
              ← Back
            </button>
          )}
          <div className="hm-brand-group">
            <div className="hm-brand-line">🔥 Market Heatmap</div>
            <div className="hm-status-line">
              <span className={`hm-status-dot ${streaming ? "hm-dot-live" : "hm-dot-off"}`} />
              <span className={streaming ? "hm-text-live" : "hm-text-off"}>
                {streaming ? "LIVE" : "OFFLINE"}
              </span>
            </div>
          </div>
        </div>

        <div className="hm-header-center">
          {timeStr}
        </div>

        <div className="hm-header-right">
          <div 
            className={`hm-pill pill-gain ${activeFilter === "gainers" ? "active" : ""}`}
            onClick={() => toggleFilter("gainers")}
          >
            ▲ &gt;1% {stats.g}
          </div>
          <div 
            className={`hm-pill pill-flat ${activeFilter === "flat" ? "active" : ""}`}
            onClick={() => toggleFilter("flat")}
          >
            ● Flat {stats.f}
          </div>
          <div 
            className={`hm-pill pill-loss ${activeFilter === "losers" ? "active" : ""}`}
            onClick={() => toggleFilter("losers")}
          >
            ▼ &lt;-1% {stats.l}
          </div>
        </div>
      </header>

      {/* ── Grid ── */}
      <div className="hm-terminal-grid">
        {indices.length > 0
          ? indices.map((idx) => (
              <IndexTile 
                key={idx.sector} 
                tile={idx} 
                isBest={idx.sector === extremes.best}
                isWorst={idx.sector === extremes.worst}
                isDimmed={getIsDimmed(idx)}
              />
            ))
          : Array.from({ length: 21 }).map((_, i) => (
              <SkeletonTile key={`skel-${i}`} />
            ))
        }
      </div>
    </div>
  );
}
