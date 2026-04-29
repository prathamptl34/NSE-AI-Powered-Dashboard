import React, { useState, useEffect, useRef, useCallback, useMemo } from "react";

// ─── Helpers ──────────────────────────────────────────────────────────────────

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

  const tileClass = "index-tile ";

  const fmt = (n) => n != null
    ? "₹" + Number(n).toLocaleString('en-IN', { maximumFractionDigits: 1 })
    : '—';

  const pct = (n) => n != null
    ? "${n >= 0 ? '+' : ''}${Number(n).toFixed(2)}%"
    : '—';

  return (
    <div className={tileClass} ref={tileRef}>
      <div className="tile-header">
        <span className="tile-index-name">{tile.sector}</span>
        <span className="tile-arrow">
          {tile.change_pct > 0 ? '▲' : tile.change_pct < 0 ? '▼' : '●'}
        </span>
      </div>
      <div className="tile-change-pct">{pct(tile.change_pct)}</div>
      <hr className="tile-divider" />
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
  const [indices, setIndices] = useState([]);
  const [streaming, setStreaming] = useState(false);
  const [timeStr, setTimeStr] = useState("");
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("all");
  const sseRef = useRef(null);

  useEffect(() => {
    const updateTime = () => {
      setTimeStr(new Date().toLocaleString("en-IN", {
        timeZone: "Asia/Kolkata",
        day: "2-digit", month: "short", year: "numeric",
        hour: "2-digit", minute: "2-digit", second: "2-digit",
        hour12: true,
      }) + " IST");
    };
    updateTime();
    const timer = setInterval(updateTime, 1000);
    return () => clearInterval(timer);
  }, []);

  const mergeIndices = useCallback((incoming) => {
    setIndices((prev) => {
      if (!prev.length) return incoming;
      const byName = {};
      incoming.forEach((idx) => { byName[idx.sector] = idx; });
      return prev.map((idx) => byName[idx.sector] || idx);
    });
  }, []);

  useEffect(() => {
    const fetchInitial = async () => {
      try {
        const base = window.location.port === "3000" ? "http://127.0.0.1:8000" : "";
        const res  = await fetch("${base}/api/heatmap/sectoral");
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

  useEffect(() => {
    if (!streaming) {
      if (sseRef.current) { sseRef.current.close(); sseRef.current = null; }
      return;
    }
    const isDev   = window.location.port === "3000";
    const baseUrl = isDev ? "http://127.0.0.1:8000" : "";
    const es      = new EventSource("${baseUrl}/api/heatmap/stream");
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

  const stats = useMemo(() => {
    let gainers = 0, flat = 0, losers = 0;
    indices.forEach(idx => {
      if (idx.change_pct > 1) gainers++;
      else if (idx.change_pct < -1) losers++;
      else flat++;
    });
    return { gainers, flat, losers };
  }, [indices]);

  const displayedIndices = useMemo(() => {
    let filtered = indices;
    if (filter === "gainers") filtered = indices.filter(i => i.change_pct > 1);
    else if (filter === "losers")  filtered = indices.filter(i => i.change_pct < -1);
    else if (filter === "flat")    filtered = indices.filter(i => i.change_pct >= -1 && i.change_pct <= 1);
    
    // Exact 24 elements for a 4x6 grid
    const padded = [...filtered];
    while (padded.length < 24) padded.push(null);
    return padded.slice(0, 24);
  }, [indices, filter]);

  return (
    <div className="heatmap-page">
      <div className="heatmap-header">
        <div className="heatmap-header-left">
          <button className="ai-back-btn" onClick={onBack}>← Back</button>
          <div className="heatmap-title-block">
            <span className="heatmap-title">🔥 Sector Heatmap</span>
            <div
              className="heatmap-stream-toggle"
              onClick={() => setStreaming((s) => !s)}
              title={streaming ? "Streaming ON — click to pause" : "Click to start live streaming"}
            >
              <div className={"stream-dot "} />
              <span>{streaming ? "LIVE" : "Streaming OFF"}</span>
            </div>
          </div>
        </div>

        <div className="heatmap-header-center">
          <span className="heatmap-clock">{timeStr}</span>
        </div>

        <div className="heatmap-header-right">
          <div className="heatmap-pill-strip">
            <button 
              className={"heatmap-pill pill-green "}
              onClick={() => setFilter(filter === "gainers" ? "all" : "gainers")}
            >
              &gt;1% <strong>{stats.gainers}</strong>
            </button>
            <button 
              className={"heatmap-pill pill-flat "}
              onClick={() => setFilter(filter === "flat" ? "all" : "flat")}
            >
              Flat <strong>{stats.flat}</strong>
            </button>
            <button 
              className={"heatmap-pill pill-red "}
              onClick={() => setFilter(filter === "losers" ? "all" : "losers")}
            >
              &lt;-1% <strong>{stats.losers}</strong>
            </button>
          </div>
        </div>
      </div>

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
            {displayedIndices.map((idx, i) => {
              if (!idx) return <div key={"empty-"} className="index-tile empty-tile" />;
              return <IndexTile key={idx.sector} tile={idx} />;
            })}
          </div>
        )}
      </div>
    </div>
  );
}
