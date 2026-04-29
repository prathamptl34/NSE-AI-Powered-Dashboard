import React, { useState, useEffect, useRef, useCallback, useMemo } from "react";

// ─── Helpers ──────────────────────────────────────────────────────────────────

const SECTOR_SLOTS = 24; // 4 rows x 6 cols

function getISTTime() {
  return new Date().toLocaleString("en-IN", {
    timeZone: "Asia/Kolkata",
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).replace(",", " ") + " IST";
}

// ─── Skeleton Tile ────────────────────────────────────────────────────────────

function SkeletonTile() {
  return (
    <div className="index-tile skeleton-tile">
      <div className="skel skel-name" />
      <div className="skel skel-pct" />
      <div className="tile-divider" />
      <div className="skel skel-label" />
      <div className="skel skel-row" />
      <div className="skel skel-label" />
      <div className="skel skel-row" />
    </div>
  );
}

// ─── Index Tile ───────────────────────────────────────────────────────────────

const IndexTile = React.memo(({ tile }) => {
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
      const raf = requestAnimationFrame(() => {
        setTimeout(() => tileRef.current?.classList.remove(cls), 600);
      });
      prevPct.current = tile.change_pct;
      return () => cancelAnimationFrame(raf);
    }
  }, [tile.change_pct]);

  const colorClass =
    tile.change_pct > 0 ? "positive" : tile.change_pct < 0 ? "negative" : "flat";

  const fmt = (n) =>
    n != null
      ? "\u20b9" + Number(n).toLocaleString("en-IN", { maximumFractionDigits: 1 })
      : "\u2014";

  const pct = (n) =>
    n != null ? `${n >= 0 ? "+" : ""}${Number(n).toFixed(2)}%` : "\u2014";

  return (
    <div className={`index-tile ${colorClass}`} ref={tileRef}>
      <div className="tile-header">
        <span className="tile-index-name">{tile.sector}</span>
        <span className="tile-arrow">
          {tile.change_pct > 0 ? "\u25b2" : tile.change_pct < 0 ? "\u25bc" : "\u25cf"}
        </span>
      </div>

      <div className="tile-change-pct">{pct(tile.change_pct)}</div>

      <hr className="tile-divider" />

      <div className="tile-section-label gainer">TOP GAINER</div>
      <div className="tile-stock-row">
        <span className="tile-stock-symbol">
          {tile.top_gainer?.symbol || tile.top_gainer?.name || "Awaiting\u2026"}
        </span>
        <span className="tile-stock-price">{fmt(tile.top_gainer?.ltp)}</span>
        {tile.top_gainer?.change_pct != null && (
          <span className="tile-change-pill positive">{pct(tile.top_gainer.change_pct)}</span>
        )}
      </div>

      <div className="tile-section-label loser">TOP LOSER</div>
      <div className="tile-stock-row">
        <span className="tile-stock-symbol">
          {tile.top_loser?.symbol || tile.top_loser?.name || "Awaiting\u2026"}
        </span>
        <span className="tile-stock-price">{fmt(tile.top_loser?.ltp)}</span>
        {tile.top_loser?.change_pct != null && (
          <span className="tile-change-pill negative">{pct(tile.top_loser.change_pct)}</span>
        )}
      </div>

    </div>
  );
});

// ─── Main Heatmap Page ────────────────────────────────────────────────────────

export default function HeatmapPage({ onBack, wsStatus }) {
  const [indices, setIndices] = useState([]);   // empty = skeleton mode
  const [streaming, setStreaming] = useState(false);
  const [timeStr, setTimeStr] = useState(getISTTime());
  const [filter, setFilter] = useState("all");
  const sseRef = useRef(null);

  // Live clock — every second
  useEffect(() => {
    const id = setInterval(() => setTimeStr(getISTTime()), 1000);
    return () => clearInterval(id);
  }, []);

  // Initial REST snapshot (best-effort, non-blocking)
  useEffect(() => {
    const base = window.location.port === "3000" ? "http://127.0.0.1:8000" : "";
    fetch(`${base}/api/heatmap/sectoral`)
      .then((r) => r.ok ? r.json() : Promise.reject())
      .then((json) => { if (json.indices?.length) setIndices(json.indices); })
      .catch(() => {});
  }, []);

  // Merge SSE updates
  const mergeIndices = useCallback((incoming) => {
    setIndices((prev) => {
      if (!prev.length) return incoming;
      const map = {};
      incoming.forEach((idx) => { map[idx.sector] = idx; });
      return prev.map((idx) => map[idx.sector] || idx);
    });
  }, []);

  // SSE — connect immediately, reconnect on drop after 1000ms
  useEffect(() => {
    let es = null;
    let retryTimer = null;

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
        retryTimer = setTimeout(connect, 1000);
      };
    }

    connect();

    return () => {
      clearTimeout(retryTimer);
      if (sseRef.current) { sseRef.current.close(); sseRef.current = null; }
      setStreaming(false);
    };
  }, [mergeIndices]);

  // Stats for pills
  const stats = useMemo(() => {
    let gainers = 0, flat = 0, losers = 0;
    indices.forEach((idx) => {
      if (idx.change_pct > 1) gainers++;
      else if (idx.change_pct < -1) losers++;
      else flat++;
    });
    return { gainers, flat, losers };
  }, [indices]);

  // Filtered list padded to SECTOR_SLOTS
  const gridTiles = useMemo(() => {
    let list = indices;
    if (filter === "gainers") list = indices.filter((i) => i.change_pct > 1);
    else if (filter === "losers") list = indices.filter((i) => i.change_pct < -1);
    else if (filter === "flat") list = indices.filter((i) => i.change_pct >= -1 && i.change_pct <= 1);

    const padded = [...list];
    while (padded.length < SECTOR_SLOTS) padded.push(null);
    return padded.slice(0, SECTOR_SLOTS);
  }, [indices, filter]);

  // Pill toggle helper
  const toggleFilter = (key) => setFilter((f) => (f === key ? "all" : key));

  const isLoaded = indices.length > 0;

  return (
    <div className="heatmap-page">

      {/* ── Compact Header ── */}
      <header className="hm-header">

        {/* LEFT — branding + status */}
        <div className="hm-left">
          <span className="hm-brand">&#x1F525; Market Pulse</span>
          <div className="hm-status">
            <span className={`hm-dot ${streaming ? "dot-live" : "dot-off"}`} />
            <span className={`hm-status-text ${streaming ? "text-live" : "text-off"}`}>
              {streaming ? "LIVE" : "Streaming OFF"}
            </span>
          </div>
        </div>

        {/* CENTER — IST clock */}
        <div className="hm-center">
          <span className="hm-clock">{timeStr}</span>
        </div>

        {/* RIGHT — filter pills */}
        <div className="hm-right">
          <button
            className={`hm-pill pill-green${filter === "gainers" ? " pill-active" : ""}`}
            onClick={() => toggleFilter("gainers")}
          >
            &#9650; &gt;1% <strong>{stats.gainers}</strong>
          </button>
          <button
            className={`hm-pill pill-flat${filter === "flat" ? " pill-active" : ""}`}
            onClick={() => toggleFilter("flat")}
          >
            &#8212; Flat <strong>{stats.flat}</strong>
          </button>
          <button
            className={`hm-pill pill-red${filter === "losers" ? " pill-active" : ""}`}
            onClick={() => toggleFilter("losers")}
          >
            &#9660; &lt;-1% <strong>{stats.losers}</strong>
          </button>
        </div>

      </header>

      {/* ── Grid ── */}
      <div className="hm-body">
        <div className="hm-grid">
          {isLoaded
            ? gridTiles.map((idx, i) =>
                idx
                  ? <IndexTile key={idx.sector} tile={idx} />
                  : <div key={`empty-${i}`} className="index-tile empty-tile" />
              )
            : Array.from({ length: SECTOR_SLOTS }).map((_, i) => (
                <SkeletonTile key={`skel-${i}`} />
              ))
          }
        </div>
      </div>

    </div>
  );
}
