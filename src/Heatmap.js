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

  // Change% badge pill style for the header
  const isPos = tile.change_pct > 0;
  const isNeg = tile.change_pct < 0;
  const badgeStyle = isPos
    ? { background: "rgba(74,222,128,0.12)", border: "1px solid rgba(74,222,128,0.3)", color: "#4ade80" }
    : isNeg
    ? { background: "rgba(248,113,113,0.12)", border: "1px solid rgba(248,113,113,0.3)", color: "#f87171" }
    : { background: "rgba(148,163,184,0.12)", border: "1px solid rgba(148,163,184,0.3)", color: "#94a3b8" };

  // Accent bar color per card
  const accentColor = (chg) => chg > 0 ? "#4ade80" : chg < 0 ? "#f87171" : "#475569";

  // Change% pill style per card
  const pillStyle = (chg) => {
    if (chg > 0) return { background: "#166534", color: "#4ade80" };
    if (chg < 0) return { background: "#7f1d1d", color: "#f87171" };
    return { background: "#1e293b", color: "#94a3b8" };
  };

  // Dynamic columns: 2 for ≤6 stocks, 3 otherwise
  const cols = stocks.length <= 6 ? 2 : 3;

  return (
    <div className="heatmap-modal-overlay" onClick={onClose}>
      <div className="heatmap-modal" onClick={e => e.stopPropagation()}>

        {/* ── Modal Header ── */}
        <div className="hm-modal-header">
          <div>
            <div style={{ fontSize: "20px", fontWeight: "800", color: "#fff", lineHeight: 1.2 }}>
              {tile.sector}
            </div>
            <div style={{ fontSize: "12px", color: "rgba(255,255,255,0.35)", marginTop: "3px" }}>
              All Constituents — Ranked by Performance
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "14px" }}>
            <div style={{
              ...badgeStyle,
              borderRadius: "10px",
              padding: "6px 16px",
              fontSize: "32px",
              fontWeight: "900",
              letterSpacing: "-1.5px",
              lineHeight: 1,
            }}>
              {tile.change_pct >= 0 ? "+" : ""}{Number(tile.change_pct).toFixed(2)}%
            </div>
            <button className="hm-modal-close" onClick={onClose} aria-label="Close">✕</button>
          </div>
        </div>

        {/* ── Stock Grid ── */}
        {stocks.length === 0 ? (
          <div style={{ padding: "40px 24px", textAlign: "center", color: "rgba(255,255,255,0.35)", fontSize: "13px" }}>
            No live data yet — waiting for market ticks
          </div>
        ) : (
          <div
            className="modal-stock-grid"
            style={{ gridTemplateColumns: `repeat(${cols}, 1fr)` }}
          >
            {stocks.map((s, idx) => {
              const isFirst = idx === 0;
              const isLast  = idx === lastIdx;
              const glowStyle = isFirst
                ? { boxShadow: "0 0 0 1px rgba(74,222,128,0.25), 0 4px 12px rgba(74,222,128,0.1)" }
                : isLast
                ? { boxShadow: "0 0 0 1px rgba(248,113,113,0.25), 0 4px 12px rgba(248,113,113,0.1)" }
                : {};

              return (
                <div key={s.symbol} className="modal-stock-card" style={glowStyle}>
                  {/* Left accent bar */}
                  <div style={{
                    width: "3px",
                    height: "32px",
                    borderRadius: "2px",
                    flexShrink: 0,
                    background: accentColor(s.change_percent),
                  }} />

                  {/* Rank */}
                  <span style={{ fontSize: "11px", color: "rgba(255,255,255,0.3)", width: "16px", flexShrink: 0 }}>
                    {idx + 1}
                  </span>

                  {/* Symbol */}
                  <span style={{ flex: 1, fontSize: "13px", fontWeight: "700", color: "#fff" }}>
                    {s.symbol}
                  </span>

                  {/* Right: price + pill stacked */}
                  <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: "3px" }}>
                    <span style={{ fontSize: "12px", color: "rgba(255,255,255,0.55)", whiteSpace: "nowrap" }}>
                      {fmt(s.ltp)}
                    </span>
                    <span style={{
                      ...pillStyle(s.change_percent),
                      fontSize: "11px",
                      fontWeight: "700",
                      padding: "2px 7px",
                      borderRadius: "5px",
                      textAlign: "center",
                      whiteSpace: "nowrap",
                    }}>
                      {pct(s.change_percent)}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* ── Modal Footer ── */}
        <div className="hm-modal-footer">
          {stocks.length} stocks &bull; {positiveCount} advancing &bull; {negativeCount} declining
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
      {/* ── Scoped CSS for modal only ── */}
      <style>{`
        .heatmap-modal-overlay {
          position: fixed;
          top: 0; left: 0;
          width: 100vw; height: 100vh;
          background: rgba(0,0,0,0.75);
          z-index: 2000;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 20px;
          box-sizing: border-box;
        }
        .heatmap-modal {
          background: #0f172a;
          border: 1px solid rgba(255,255,255,0.12);
          border-radius: 20px;
          width: 760px;
          max-width: 95vw;
          overflow: hidden;
          box-shadow: 0 30px 80px rgba(0,0,0,0.7);
        }
        .hm-modal-header {
          padding: 24px 28px 20px;
          border-bottom: 1px solid rgba(255,255,255,0.08);
          display: flex;
          align-items: center;
          justify-content: space-between;
        }
        .hm-modal-close {
          font-size: 18px;
          color: rgba(255,255,255,0.4);
          cursor: pointer;
          padding: 4px 8px;
          border-radius: 6px;
          background: transparent;
          border: none;
          line-height: 1;
          transition: color 0.15s, background 0.15s;
        }
        .hm-modal-close:hover {
          color: #fff;
          background: rgba(255,255,255,0.08);
        }
        .modal-stock-grid {
          display: grid;
          gap: 6px;
          padding: 16px 20px 8px;
        }
        .modal-stock-card {
          background: rgba(255,255,255,0.04);
          border: 1px solid rgba(255,255,255,0.07);
          border-radius: 10px;
          padding: 10px 14px;
          display: flex;
          align-items: center;
          gap: 10px;
          transition: all 0.15s ease;
          cursor: default;
        }
        .modal-stock-card:hover {
          background: rgba(255,255,255,0.08);
          border-color: rgba(255,255,255,0.15);
          transform: translateY(-1px);
        }
        .hm-modal-footer {
          padding: 12px 24px 18px;
          text-align: center;
          color: rgba(255,255,255,0.3);
          font-size: 12px;
        }
        @media (max-width: 600px) {
          .heatmap-modal { border-radius: 14px; }
          .modal-stock-grid { grid-template-columns: repeat(2, 1fr) !important; padding: 12px 12px 8px; gap: 5px; }
          .modal-stock-card { padding: 8px 10px; }
          .modal-stock-card span[style*="font-size: 13px"] { font-size: 12px !important; }
        }
      `}</style>

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
