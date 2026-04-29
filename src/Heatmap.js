import React, { useState, useEffect, useRef, useCallback } from "react";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatINR(num) {
  if (num === null || num === undefined) return "—";
  return Number(num).toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function formatVol(v) {
  if (!v || v === 0) return "—";
  if (v >= 1e7) return (v / 1e7).toFixed(2) + " Cr";
  if (v >= 1e5) return (v / 1e5).toFixed(1) + " L";
  return v.toLocaleString("en-IN");
}

function getTileClass(changePct, hasData) {
  if (!hasData) return "flat";
  if (changePct > 0.05) return "positive";
  if (changePct < -0.05) return "negative";
  return "flat";
}

function getTimestamp() {
  return (
    new Date().toLocaleString("en-IN", {
      timeZone: "Asia/Kolkata",
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: true,
    }) + " IST"
  );
}

// ─── Pill Badge Strip ─────────────────────────────────────────────────────────

const PILL_BUCKETS = [
  { label: ">5%",  min: 5,         max: Infinity, cls: "pill-strong-green" },
  { label: ">3%",  min: 3,         max: 5,        cls: "pill-green"        },
  { label: ">1%",  min: 1,         max: 3,        cls: "pill-mild-green"   },
  { label: "Flat", min: -1,        max: 1,        cls: "pill-flat"         },
  { label: "<-1%", min: -3,        max: -1,       cls: "pill-mild-red"     },
  { label: "<-3%", min: -5,        max: -3,       cls: "pill-red"          },
  { label: "<-5%", min: -Infinity, max: -5,       cls: "pill-strong-red"   },
];

function PillStrip({ indices }) {
  const counts = PILL_BUCKETS.map((b) => ({
    ...b,
    count: indices.filter(
      (idx) =>
        idx.constituent_count > 0 &&
        idx.change_pct >= b.min &&
        idx.change_pct < b.max
    ).length,
  }));

  return (
    <div className="heatmap-pill-strip">
      {counts.map((b) =>
        b.count > 0 ? (
          <span key={b.label} className={`heatmap-pill ${b.cls}`}>
            {b.label} <strong>{b.count}</strong>
          </span>
        ) : null
      )}
    </div>
  );
}

// ─── Stock Row (always rendered, never conditional) ───────────────────────────

function StockRow({ type, stock }) {
  const isGainer = type === "gainer";
  const label    = isGainer ? "📈 TOP GAINER" : "📉 TOP LOSER";
  const sign     = isGainer ? "+" : "";

  if (!stock) {
    return (
      <div className="tile-stock-row">
        <span className={`tile-stock-label ${isGainer ? "gainer-label" : "loser-label"}`}>
          {label}
        </span>
        <div className="tile-stock-body">
          <span className="tile-stock-symbol">Awaiting…</span>
          <span className="tile-stock-price">—</span>
        </div>
        <span className="tile-volume">Vol: —</span>
      </div>
    );
  }

  return (
    <div className="tile-stock-row">
      <span className={`tile-stock-label ${isGainer ? "gainer-label" : "loser-label"}`}>
        {label}
      </span>
      <div className="tile-stock-body">
        <span className="tile-stock-symbol">{stock.symbol}</span>
        <span className="tile-stock-price">₹{formatINR(stock.ltp)}</span>
        <span className={`tile-change-pill ${isGainer ? "positive" : "negative"}`}>
          {sign}{stock.change_pct.toFixed(2)}%
        </span>
      </div>
      <span className="tile-volume">Vol: {formatVol(stock.volume)}</span>
    </div>
  );
}

// ─── Index Tile — no click handler, no expand state ───────────────────────────

const IndexTile = React.memo(function IndexTile({ data }) {
  const tileRef    = useRef(null);
  const prevPct    = useRef(data.change_pct);
  const rafRef     = useRef(null);
  const timeoutRef = useRef(null);

  const hasData   = data.constituent_count > 0;
  const tileClass = getTileClass(data.change_pct, hasData);
  const sign      = data.change_pct >= 0 ? "+" : "";

  // RAF-based flash on change_pct update — no remount, no key change
  useEffect(() => {
    if (data.change_pct === prevPct.current) return;
    const dir = data.change_pct > prevPct.current ? "green" : "red";
    prevPct.current = data.change_pct;

    if (tileRef.current) {
      tileRef.current.classList.remove("tile-flash-green", "tile-flash-red");
      rafRef.current = requestAnimationFrame(() => {
        if (tileRef.current) {
          tileRef.current.classList.add(`tile-flash-${dir}`);
        }
      });
      timeoutRef.current = setTimeout(() => {
        if (tileRef.current) {
          tileRef.current.classList.remove("tile-flash-green", "tile-flash-red");
        }
      }, 700);
    }

    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, [data.change_pct]);

  return (
    <div ref={tileRef} className={`index-tile ${tileClass}`}>
      {/* ── Header: name + arrow ── */}
      <div className="tile-header">
        <span className="tile-name">{data.sector}</span>
        <span className="tile-arrow">{data.change_pct >= 0 ? "▲" : "▼"}</span>
      </div>

      {/* ── Change % ── */}
      <div className="tile-change">
        {hasData ? `${sign}${data.change_pct.toFixed(2)}%` : "—"}
      </div>

      {/* ── Detail panel — ALWAYS in DOM, ALWAYS visible ── */}
      <div className="tile-detail-panel">
        <div className="tile-divider" />

        {!hasData ? (
          <div className="tile-awaiting">⏳ Awaiting data…</div>
        ) : (
          <>
            <StockRow type="gainer" stock={data.top_gainer} />
            <div className="tile-mini-divider" />
            <StockRow type="loser" stock={data.top_loser} />
          </>
        )}
      </div>
    </div>
  );
});

// ─── Main Heatmap Page ────────────────────────────────────────────────────────

export default function HeatmapPage({ onBack, wsStatus }) {
  const [indices,   setIndices]  = useState([]);
  const [streaming, setStreaming] = useState(false);
  const [timestamp, setTimestamp] = useState(getTimestamp());
  const [loading,   setLoading]  = useState(true);

  const sseRef = useRef(null);

  // Merge SSE diff by sector name — avoids full re-render on every tick
  const mergeIndices = useCallback((incoming) => {
    setIndices((prev) => {
      if (!prev.length) return incoming;
      const byName = {};
      incoming.forEach((idx) => { byName[idx.sector] = idx; });
      return prev.map((idx) => byName[idx.sector] || idx);
    });
    setTimestamp(getTimestamp());
  }, []);

  // Initial snapshot fetch
  useEffect(() => {
    const fetchInitial = async () => {
      try {
        const base = window.location.port === "3000" ? "http://127.0.0.1:8000" : "";
        const res  = await fetch(`${base}/api/heatmap/sectoral`);
        if (!res.ok) throw new Error("fetch failed");
        const json = await res.json();
        setIndices(json.indices || []);
      } catch (e) {
        console.warn("[Heatmap] initial fetch error:", e);
      } finally {
        setLoading(false);
      }
    };
    fetchInitial();
  }, []);

  // SSE connection — mandatory EventSource.close() cleanup on unmount/toggle
  useEffect(() => {
    if (!streaming) {
      if (sseRef.current) {
        sseRef.current.close();
        sseRef.current = null;
      }
      return;
    }

    const isDev   = window.location.port === "3000";
    const baseUrl = isDev ? "http://127.0.0.1:8000" : "";
    const es      = new EventSource(`${baseUrl}/api/heatmap/stream`);
    sseRef.current = es;

    es.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data);
        if (data.indices) mergeIndices(data.indices);
      } catch {}
    };

    es.onerror = () => {
      console.warn("[Heatmap SSE] connection error");
    };

    return () => {
      es.close();
      sseRef.current = null;
    };
  }, [streaming, mergeIndices]);

  return (
    <div className="heatmap-page">
      {/* ── Sticky Header ── */}
      <div className="heatmap-header">
        <div className="heatmap-header-left">
          <button className="ai-back-btn" onClick={onBack}>← Back</button>
          <div className="heatmap-title-block">
            <span className="heatmap-title">🔥 Sector Heatmap</span>
            <span className="heatmap-badge">NSE Live</span>
          </div>
        </div>

        <div className="heatmap-header-right">
          <span className="heatmap-timestamp">{timestamp}</span>

          <div
            className="heatmap-stream-toggle"
            onClick={() => setStreaming((s) => !s)}
            title={streaming ? "Streaming ON — click to pause" : "Click to start live streaming"}
          >
            <div className={`stream-dot ${streaming ? "dot-live" : "dot-off"}`} />
            <span>{streaming ? "Streaming ON" : "Streaming OFF"}</span>
          </div>

          <div className={`conn-dot conn-${wsStatus}`}>
            <span className="dot-inner" />
            <span className="dot-label">{wsStatus === "live" ? "Live" : "Offline"}</span>
          </div>
        </div>
      </div>

      {/* ── Pill Badges ── */}
      {!loading && indices.length > 0 && (
        <div className="heatmap-pills-row">
          <PillStrip indices={indices} />
        </div>
      )}

      {/* ── Grid ── */}
      <div className="heatmap-body">
        {loading ? (
          <div className="heatmap-loading">
            <div className="heatmap-spinner" />
            <span>Loading sector data…</span>
          </div>
        ) : indices.length === 0 ? (
          <div className="heatmap-empty">
            <span>⏳ Market data warming up. Check back in a moment.</span>
          </div>
        ) : (
          <div className="heatmap-grid">
            {indices.map((idx) => (
              <IndexTile key={idx.sector} data={idx} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
