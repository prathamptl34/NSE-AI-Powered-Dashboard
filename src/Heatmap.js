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
  if (pct >= 4.0) return "intensity-g5";
  if (pct >= 3.0) return "intensity-g4";
  if (pct >= 2.0) return "intensity-g3";
  if (pct >= 1.0) return "intensity-g2";
  if (pct >= 0) return "intensity-g1";
  if (pct > -1.0) return "intensity-r1";
  if (pct > -2.0) return "intensity-r2";
  if (pct > -3.0) return "intensity-r3";
  if (pct > -4.0) return "intensity-r4";
  return "intensity-r5";
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

const IndexTile = React.memo(({ tile, isBest, isWorst, isDimmed, onClick }) => {
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
    <div
      className={`index-tile ${intensityClass} ${extremeClass} ${isDimmed ? "tile-dimmed" : ""}`}
      ref={tileRef}
      onClick={onClick}
      style={{ cursor: "pointer" }}
    >
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

// ─── Sector Modal ─────────────────────────────────────────────────────────────

function SectorModal({ tile, onClose }) {
  const stocks = tile.stocks || [];
  const lastIdx = stocks.length - 1;

  const positiveCount = stocks.filter(s => s.change_percent > 0).length;
  const negativeCount = stocks.filter(s => s.change_percent < 0).length;

  const fmt = (n) =>
    n != null ? "₹" + Number(n).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "—";

  const pct = (n) =>
    n != null ? `${n >= 0 ? "+" : ""}${Number(n).toFixed(2)}%` : "—";

  const isPos = tile.change_pct > 0;
  const isNeg = tile.change_pct < 0;

  // Header banner gradient
  const bannerGradient = isPos
    ? "linear-gradient(135deg, rgba(16,185,129,0.15) 0%, rgba(8,15,30,0) 60%)"
    : isNeg
    ? "linear-gradient(135deg, rgba(239,68,68,0.15) 0%, rgba(8,15,30,0) 60%)"
    : "linear-gradient(135deg, rgba(100,116,139,0.1) 0%, rgba(8,15,30,0) 60%)";
  const bannerBorder = isPos
    ? "1px solid rgba(16,185,129,0.15)"
    : isNeg
    ? "1px solid rgba(239,68,68,0.15)"
    : "1px solid rgba(255,255,255,0.06)";

  // Change% color
  const pctColor = isPos ? "#4ade80" : isNeg ? "#f87171" : "#94a3b8";

  // Per-card background/border based on change%
  const cardStyle = (chg) => {
    if (chg > 0) return {
      background: "linear-gradient(135deg, rgba(16,185,129,0.1), rgba(16,185,129,0.04))",
      border: "1px solid rgba(16,185,129,0.18)",
    };
    if (chg < 0) return {
      background: "linear-gradient(135deg, rgba(239,68,68,0.1), rgba(239,68,68,0.04))",
      border: "1px solid rgba(239,68,68,0.15)",
    };
    return {
      background: "rgba(255,255,255,0.03)",
      border: "1px solid rgba(255,255,255,0.07)",
    };
  };

  // Change% pill per card
  const pillStyle = (chg) => {
    if (chg > 0) return { background: "rgba(74,222,128,0.18)", color: "#4ade80" };
    if (chg < 0) return { background: "rgba(248,113,113,0.18)", color: "#f87171" };
    return { background: "rgba(148,163,184,0.12)", color: "#94a3b8" };
  };

  // Dynamic columns: 2 for ≤6 stocks, 3 otherwise
  const cols = stocks.length <= 6 ? 2 : 3;

  return (
    <div className="heatmap-modal-overlay" onClick={onClose}>
      <div className="heatmap-modal" onClick={e => e.stopPropagation()}>

        {/* ── Header banner ── */}
        <div className="hm-modal-banner" style={{
          background: bannerGradient,
          borderBottom: bannerBorder,
          position: "relative",
        }}>
          {/* Left block */}
          <div>
            <div className="hm-modal-index-name">
              {tile.sector}
            </div>
            <div className="hm-modal-stats-row" style={{ display: "flex", gap: "6px", marginTop: "8px" }}>
              <span className="hm-modal-stat-badge" style={{
                background: "rgba(74,222,128,0.12)", color: "#4ade80",
                borderRadius: "20px",
                fontWeight: "600",
              }}>
                ↑ {positiveCount} Advancing
              </span>
              <span className="hm-modal-stat-badge" style={{
                background: "rgba(248,113,113,0.12)", color: "#f87171",
                borderRadius: "20px",
                fontWeight: "600",
              }}>
                ↓ {negativeCount} Declining
              </span>
            </div>
          </div>

          {/* Right block: large change% */}
          <div className="hm-modal-pct-change" style={{
            fontWeight: "900", letterSpacing: "-1px",
            color: pctColor, lineHeight: 1,
          }}>
            {tile.change_pct >= 0 ? "+" : ""}{Number(tile.change_pct).toFixed(2)}%
          </div>

          {/* Close button — absolute top-right */}
          <button
            className="hm-modal-close"
            onClick={onClose}
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        {/* ── Stock Grid ── */}
        {stocks.length === 0 ? (
          <div style={{ padding: "40px 24px", textAlign: "center", color: "rgba(255,255,255,0.35)", fontSize: "13px" }}>
            No live data yet — waiting for market ticks
          </div>
        ) : (
          <div
            className="modal-stock-grid"
            style={{ gridTemplateColumns: stocks.length > 0 ? `repeat(${cols}, 1fr)` : undefined }}
          >
            {stocks.map((s, idx) => {
              const isFirst = idx === 0;
              const isLast  = idx === lastIdx;

              const baseCardStyle = cardStyle(s.change_percent);
              const specialStyle = isFirst
                ? { borderColor: "rgba(74,222,128,0.4)", boxShadow: "0 0 20px rgba(74,222,128,0.08)" }
                : isLast
                ? { borderColor: "rgba(248,113,113,0.4)", boxShadow: "0 0 20px rgba(248,113,113,0.08)" }
                : {};

              const rankBg = isFirst
                ? { background: "rgba(74,222,128,0.2)", color: "#4ade80" }
                : { background: "rgba(255,255,255,0.07)", color: "rgba(255,255,255,0.35)" };

              return (
                <div
                  key={s.symbol}
                  className="modal-stock-card"
                  style={{ ...baseCardStyle, ...specialStyle }}
                >
                  {/* Left Group: rank badge | symbol */}
                  <div className="modal-stock-left-group">
                    <div className="modal-stock-rank" style={{
                      ...rankBg,
                      width: "22px", height: "22px",
                      borderRadius: "6px",
                      fontSize: "10px", fontWeight: "700",
                      display: "flex", alignItems: "center", justifyContent: "center",
                      flexShrink: 0,
                    }}>
                      {isFirst ? "🏆" : idx + 1}
                    </div>
                    <span className="modal-stock-symbol">
                      {s.symbol}
                    </span>
                  </div>

                  {/* Price */}
                  <div className="modal-stock-price">
                    {fmt(s.ltp)}
                  </div>

                  {/* Change% pill */}
                  <span className="modal-stock-pill" style={{
                    ...pillStyle(s.change_percent),
                  }}>
                    {pct(s.change_percent)}
                  </span>
                </div>
              );
            })}
          </div>
        )}

        {/* ── Footer ── */}
        <div className="hm-modal-footer">
          <span style={{ background: "rgba(255,255,255,0.05)", borderRadius: "20px" }}>
            {stocks.length} Stocks
          </span>
          <span style={{ background: "rgba(74,222,128,0.08)", color: "#4ade80", borderRadius: "20px" }}>
            ↑ {positiveCount} Advancing
          </span>
          <span style={{ background: "rgba(248,113,113,0.08)", color: "#f87171", borderRadius: "20px" }}>
            ↓ {negativeCount} Declining
          </span>
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
  const [activeFilter, setActiveFilter] = useState(null);
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
    if (activeFilter === "losers")  return idx.change_pct >= -1;
    if (activeFilter === "flat")    return idx.change_pct > 1 || idx.change_pct < -1;
    return false;
  };

  return (
    <div className="heatmap-wrapper">
      {/* Scoped CSS moved to index.css */}

      {/* ── Terminal Header ── */}
      <header className="hm-terminal-header">
        <div className="hm-header-left">
          {onBack && (
            <button className="hm-back-btn" onClick={onBack}>
              ← Back
            </button>
          )}
          <div className="hm-brand-group">
            <div className="hm-brand-line">🔥 Market Heatmap (Updated)</div>
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
                onClick={() => setExpandedSector(idx)}
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
