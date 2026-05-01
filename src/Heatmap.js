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

  const pctColor = tile.change_pct > 0 ? "#4ade80" : tile.change_pct < 0 ? "#f87171" : "#94a3b8";

  const pillStyle = (change) => {
    if (change > 0)  return { background: "#166534", color: "#4ade80" };
    if (change < 0)  return { background: "#7f1d1d", color: "#f87171" };
    return { background: "#1e293b", color: "#94a3b8" };
  };

  return (
    <div
      className="heatmap-modal-overlay"
      onClick={onClose}
    >
      <div
        className="heatmap-modal"
        onClick={e => e.stopPropagation()}
      >
        {/* ── Modal Header ── */}
        <div className="hm-modal-header">
          <div>
            <div style={{ fontSize: "18px", fontWeight: "700", color: "#fff", lineHeight: 1.2 }}>
              {tile.sector}
            </div>
            <div style={{ fontSize: "12px", color: "rgba(255,255,255,0.4)", marginTop: "4px" }}>
              All Constituents
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "16px" }}>
            <div style={{ fontSize: "28px", fontWeight: "900", color: pctColor, letterSpacing: "-1px" }}>
              {tile.change_pct >= 0 ? "+" : ""}{Number(tile.change_pct).toFixed(2)}%
            </div>
            <button
              className="hm-modal-close"
              onClick={onClose}
              aria-label="Close"
            >
              ✕
            </button>
          </div>
        </div>

        {/* ── Stock List ── */}
        <div className="hm-modal-list">
          {stocks.length === 0 ? (
            <div style={{ padding: "40px 24px", textAlign: "center", color: "rgba(255,255,255,0.35)", fontSize: "13px" }}>
              No live data yet — waiting for market ticks
            </div>
          ) : (
            stocks.map((s, idx) => {
              const isFirst = idx === 0;
              const isLast  = idx === lastIdx;
              const accentStyle = isFirst
                ? { borderLeft: "3px solid #4ade80", paddingLeft: "21px" }
                : isLast
                ? { borderLeft: "3px solid #f87171", paddingLeft: "21px" }
                : {};

              return (
                <div
                  key={s.symbol}
                  className="modal-stock-row"
                  style={accentStyle}
                >
                  <span className="msr-rank">{idx + 1}</span>
                  <span className="msr-symbol">{s.symbol}</span>
                  <span className="msr-price">{fmt(s.ltp)}</span>
                  <span className="msr-pill" style={pillStyle(s.change_percent)}>
                    {pct(s.change_percent)}
                  </span>
                </div>
              );
            })
          )}
        </div>

        {/* ── Modal Footer ── */}
        <div className="hm-modal-footer">
          {stocks.length} stocks &bull; {positiveCount} advancing &middot; {negativeCount} declining
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
        }
        .heatmap-modal {
          background: #0f172a;
          border: 1px solid rgba(255,255,255,0.1);
          border-radius: 16px;
          width: 480px;
          max-width: 92vw;
          max-height: 80vh;
          display: flex;
          flex-direction: column;
          overflow: hidden;
          box-shadow: 0 25px 60px rgba(0,0,0,0.6);
        }
        .hm-modal-header {
          padding: 20px 24px 16px;
          border-bottom: 1px solid rgba(255,255,255,0.08);
          display: flex;
          align-items: center;
          justify-content: space-between;
          flex-shrink: 0;
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
        .hm-modal-list {
          overflow-y: auto;
          flex: 1;
          padding: 8px 0;
        }
        .modal-stock-row {
          display: flex;
          align-items: center;
          padding: 10px 24px;
          border-bottom: 1px solid rgba(255,255,255,0.04);
          transition: background 0.12s;
        }
        .modal-stock-row:hover {
          background: rgba(255,255,255,0.04);
        }
        .msr-rank {
          width: 28px;
          font-size: 12px;
          color: rgba(255,255,255,0.3);
          flex-shrink: 0;
        }
        .msr-symbol {
          flex: 1;
          font-size: 14px;
          font-weight: 700;
          color: #fff;
        }
        .msr-price {
          margin-right: 16px;
          font-size: 13px;
          color: rgba(255,255,255,0.65);
          white-space: nowrap;
        }
        .msr-pill {
          padding: 3px 8px;
          border-radius: 6px;
          font-size: 12px;
          font-weight: 700;
          min-width: 56px;
          text-align: center;
          flex-shrink: 0;
          white-space: nowrap;
        }
        .hm-modal-footer {
          padding: 12px 24px;
          border-top: 1px solid rgba(255,255,255,0.08);
          text-align: center;
          font-size: 12px;
          color: rgba(255,255,255,0.35);
          flex-shrink: 0;
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
