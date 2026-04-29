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

function getIntensityClass(pct) {
  if (pct >= 1.5) return "hm-intensity-green-3";
  if (pct >= 0.5) return "hm-intensity-green-2";
  if (pct >= 0) return "hm-intensity-green-1";
  if (pct > -0.5) return "hm-intensity-red-1";
  if (pct > -1.5) return "hm-intensity-red-2";
  return "hm-intensity-red-3";
}

// ─── Skeleton Tile ────────────────────────────────────────────────────────────

function SkeletonTile() {
  return (
    <div className="index-tile skeleton-tile">
      <div className="skel skel-name" />
      <div className="skel skel-pct" />
      <div className="tile-divider" />
      <div className="skel skel-row" />
      <div className="skel-label" />
      <div className="skel skel-row" />
    </div>
  );
}

// ─── Index Tile ───────────────────────────────────────────────────────────────

const IndexTile = React.memo(({ tile, isBiggestGainer, isBiggestLoser }) => {
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

  const intensityClass = getIntensityClass(tile.change_pct);
  const borderClass = isBiggestGainer ? "biggest-gainer-border" : isBiggestLoser ? "biggest-loser-border" : "";

  const fmt = (n) =>
    n != null
      ? "\u20b9" + Math.floor(n).toLocaleString("en-IN")
      : "\u2014";

  const pct = (n) =>
    n != null ? `${n >= 0 ? "+" : ""}${Number(n).toFixed(2)}%` : "\u2014";

  // Compute font size for sector name
  const nameLen = tile.sector.length;
  const nameFontSize = nameLen > 16 ? "10px" : "11px";

  return (
    <div className={`index-tile ${intensityClass} ${borderClass}`} ref={tileRef}>
      <div className="tile-header">
        <span className="tile-index-name" style={{ fontSize: nameFontSize }}>{tile.sector}</span>
        <span className="tile-arrow">
          {tile.change_pct > 0 ? "\u25b2" : tile.change_pct < 0 ? "\u25bc" : "\u25cf"}
        </span>
      </div>

      <div className={`tile-change-pct ${tile.change_pct >= 0 ? "text-green" : "text-red"}`}>
        {pct(tile.change_pct)}
      </div>

      <div className="tile-divider" />

      <div className="tile-row-block">
        <div className="tile-label">TOP GAINER</div>
        <div className="tile-stock-line">
          <span className="stock-name">{tile.top_gainer?.symbol || "Awaiting\u2026"}</span>
          <span className="stock-price">{fmt(tile.top_gainer?.ltp)}</span>
          {tile.top_gainer?.change_pct != null && (
            <span className="stock-badge bg-green">{pct(tile.top_gainer.change_pct)}</span>
          )}
        </div>
      </div>

      <div className="tile-row-block">
        <div className="tile-label">TOP LOSER</div>
        <div className="tile-stock-line">
          <span className="stock-name">{tile.top_loser?.symbol || "Awaiting\u2026"}</span>
          <span className="stock-price">{fmt(tile.top_loser?.ltp)}</span>
          {tile.top_loser?.change_pct != null && (
            <span className="stock-badge bg-red">{pct(tile.top_loser.change_pct)}</span>
          )}
        </div>
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

  // Initial REST snapshot
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

  // SSE
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

  // Find extreme indices for highlighting
  const extremes = useMemo(() => {
    if (!indices.length) return { gainer: null, loser: null };
    let gainer = indices[0], loser = indices[0];
    indices.forEach(idx => {
      if (idx.change_pct > gainer.change_pct) gainer = idx;
      if (idx.change_pct < loser.change_pct) loser = idx;
    });
    return { gainer: gainer.sector, loser: loser.sector };
  }, [indices]);

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

  return (
    <div className="heatmap-page">

      {/* ── Terminal Header ── */}
      <header className="hm-terminal-header">
        <div className="header-left">
          <div className="brand-line">&#x1F525; Market Pulse</div>
          <div className="status-line">
            <span className={`status-dot ${streaming ? "dot-live" : "dot-off"}`} />
            <span className={streaming ? "text-live" : "text-off"}>
              {streaming ? "LIVE" : "Streaming OFF"}
            </span>
          </div>
        </div>

        <div className="header-center">
          <div className="ist-clock">{timeStr}</div>
        </div>

        <div className="header-right">
          <div className="hm-pill-badge bg-green">
            &#9650; &gt;1% {stats.gainers}
          </div>
          <div className="hm-pill-badge bg-flat">
            &#8212; Flat {stats.flat}
          </div>
          <div className="hm-pill-badge bg-red">
            &#9660; &lt;-1% {stats.losers}
          </div>
        </div>
      </header>

      {/* ── Grid ── */}
      <div className="hm-terminal-body">
        <div className="hm-terminal-grid">
          {indices.length > 0
            ? gridTiles.map((idx, i) =>
                idx
                  ? <IndexTile 
                      key={idx.sector} 
                      tile={idx} 
                      isBiggestGainer={idx.sector === extremes.gainer}
                      isBiggestLoser={idx.sector === extremes.loser}
                    />
                  : <div key={`empty-${i}`} className="index-tile empty-tile" />
              )
            : Array.from({ length: 21 }).map((_, i) => (
                <SkeletonTile key={`skel-${i}`} />
              ))
          }
        </div>
      </div>

    </div>
  );
}
