import React, { useState, useEffect, useRef, useCallback } from "react";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatINR(num) {
  if (num === null || num === undefined) return "—";
  return Number(num).toLocaleString("en-IN", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  });
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

// ─── Index Tile ───────────────────────────────────────────────────────────────

const IndexTile = React.memo(({ tile }) => {
  const tileRef = useRef(null);
  const prevLtp = useRef(null);

  // Price flash on change
  useEffect(() => {
    if (!tileRef.current || prevLtp.current === null) {
      prevLtp.current = tile.change_pct;
      return;
    }
    if (tile.change_pct !== prevLtp.current) {
      const cls = tile.change_pct > prevLtp.current
        ? 'tile-flash-green' : 'tile-flash-red';
      tileRef.current.classList.add(cls);
      const raf = requestAnimationFrame(() => {
        setTimeout(() => {
          tileRef.current?.classList.remove(cls);
        }, 600);
      });
      prevLtp.current = tile.change_pct;
      return () => cancelAnimationFrame(raf);
    }
  }, [tile.change_pct]);

  const tileClass = `index-tile ${
    tile.change_pct > 0 ? 'positive' :
    tile.change_pct < 0 ? 'negative' : 'flat'
  }`;

  const fmt = (n) => n != null
    ? `₹${Number(n).toLocaleString('en-IN', { maximumFractionDigits: 1 })}`
    : '—';

  const pct = (n) => n != null
    ? `${n >= 0 ? '+' : ''}${Number(n).toFixed(2)}%`
    : '—';

  return (
    <div className={tileClass} ref={tileRef}>

      {/* Index Name + Arrow */}
      <div className="tile-header">
        <span className="tile-index-name">{tile.sector}</span>
        <span className="tile-arrow">
          {tile.change_pct > 0 ? '▲' : tile.change_pct < 0 ? '▼' : '●'}
        </span>
      </div>

      {/* Big Change% */}
      <div className="tile-change-pct">{pct(tile.change_pct)}</div>

      <hr className="tile-divider" />

      {/* TOP GAINER */}
      <div className="tile-section-label gainer">TOP GAINER</div>
      <div className="tile-stock-row">
        <span className="tile-stock-symbol">
          {tile.top_gainer?.symbol || tile.top_gainer?.name || 'Awaiting…'}
        </span>
        <span className="tile-stock-right">
          <span className="tile-stock-price">{fmt(tile.top_gainer?.ltp)}</span>
          {tile.top_gainer?.change_pct != null && (
            <span className="tile-change-pill positive">
              {pct(tile.top_gainer.change_pct)}
            </span>
          )}
        </span>
      </div>

      {/* TOP LOSER */}
      <div className="tile-section-label loser">TOP LOSER</div>
      <div className="tile-stock-row">
        <span className="tile-stock-symbol">
          {tile.top_loser?.symbol || tile.top_loser?.name || 'Awaiting…'}
        </span>
        <span className="tile-stock-right">
          <span className="tile-stock-price">{fmt(tile.top_loser?.ltp)}</span>
          {tile.top_loser?.change_pct != null && (
            <span className="tile-change-pill negative">
              {pct(tile.top_loser.change_pct)}
            </span>
          )}
        </span>
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

  // SSE — mandatory EventSource.close() cleanup
  useEffect(() => {
    if (!streaming) {
      if (sseRef.current) { sseRef.current.close(); sseRef.current = null; }
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
    es.onerror = () => console.warn("[Heatmap SSE] connection error");
    return () => { es.close(); sseRef.current = null; };
  }, [streaming, mergeIndices]);

  return (
    <div className="heatmap-page">
      {/* ── Header ── */}
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
              <IndexTile key={idx.sector} tile={idx} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
