import React, { useState, useEffect, memo, useCallback, useRef } from "react";
import "./ForexSMCIntelligencePanel.css";
import ForexKillZoneTimer from "./ForexKillZoneTimer";

// ═══════════════════════════════════════════════════════════════════════════════
// CONSTANTS & UTILITIES
// ═══════════════════════════════════════════════════════════════════════════════

const COMMODITY_SYMS = new Set(["XAUUSD", "BTCUSD", "ETHUSD", "NAS100", "SP100"]);
const SWEEP_ASSETS   = ["XAUUSD", "BTCUSD", "EURUSD", "GBPUSD"];

/** Never returns NaN — always a real number or fallback */
const safeNum = (val, fallback = 0) =>
  val === null || val === undefined || isNaN(Number(val)) ? fallback : Number(val);

/** Canonical price formatter. 2dp+$ for commodities/crypto, 5dp for FX. */
const fmtPrice = (symbol = "", price) => {
  if (price === null || price === undefined || price === "—") return "—";
  const n = parseFloat(price);
  if (isNaN(n)) return "—";
  if (COMMODITY_SYMS.has(symbol))
    return "$" + n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return n.toFixed(5);
};

/** Table cells don't need $ prefix — keeps columns aligned */
const fmtPriceRaw = (symbol = "", price) => {
  if (price === null || price === undefined || price === "—") return "—";
  const n = parseFloat(price);
  if (isNaN(n)) return "—";
  if (COMMODITY_SYMS.has(symbol))
    return n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return n.toFixed(5);
};

const fmtAge = (seconds, short = false) => {
  const s = safeNum(seconds, 0);
  const m = Math.floor(s / 60);
  if (short) return m < 60 ? `${m}m` : `${Math.floor(m / 60)}h${m % 60}m`;
  return m < 60 ? `${m}m ago` : `${Math.floor(m / 60)}h ${m % 60}m ago`;
};

// ─── FALLBACK DATA ────────────────────────────────────────────────────────────
const FB_OR          = { instruments: {}, timestamp: "—" };
const FB_SWEEPS      = { sweeps: [], timestamp: "—", active_sweep_count: 0 };
const FB_GRADES      = { grades: [], timestamp: "—", kill_zone: { is_dead_zone: false, is_kill_zone: false } };
const FB_SENTIMENT   = { cot: {}, fear_greed: { value: 50, classification: "Neutral" }, vix: { value: null }, timestamp: "—" };
const FB_DISPLACEMENT = { alerts: [], timestamp: "—" };
const FB_LIQUIDITY   = { pools_above: [], pools_below: [], ltp: "—", timestamp: "—" };
const FB_MTF         = { bias_grid: [], timestamp: "—" };

// ─── API ──────────────────────────────────────────────────────────────────────
async function apiFetch(path) {
  try {
    let res;
    try { res = await fetch(path); }
    catch { res = await fetch(`http://127.0.0.1:8001${path}`); }
    if (!res.ok) return null;
    return await res.json();
  } catch { return null; }
}

// ═══════════════════════════════════════════════════════════════════════════════
// MICRO-COMPONENTS (shared)
// ═══════════════════════════════════════════════════════════════════════════════

const LiveDot = memo(({ color = "#10b981", size = 6, style = {} }) => (
  <span className="live-dot-wrap" style={style}>
    <span className="live-dot-ring" style={{ width: size + 4, height: size + 4, borderColor: color }} />
    <span className="live-dot-core" style={{ width: size, height: size, background: color }} />
  </span>
));

const Divider = () => <span className="hdr-divider" />;

/** Strength dot indicator: ratio/maxRatio → filled dots out of 5 */
const StrengthDots = memo(({ ratio, maxRatio = 4.0, total = 5 }) => {
  const filled = Math.min(Math.round((safeNum(ratio) / maxRatio) * total), total);
  return (
    <span className="strength-dots">
      {Array.from({ length: total }, (_, i) => (
        <span key={i} className={`sdot ${i < filled ? "sdot-filled" : "sdot-empty"}`}>●</span>
      ))}
    </span>
  );
});

/** MTF alignment indicator: count filled out of 4 timeframes */
const AlignmentDots = memo(({ count, total = 4, color = "#10b981" }) => (
  <span className="align-dots">
    {Array.from({ length: total }, (_, i) => (
      <span
        key={i}
        className="adot"
        style={{ background: i < count ? color : "rgba(255,255,255,0.1)" }}
      />
    ))}
  </span>
));

const DemoBadge = () => <span className="badge badge-demo">DEMO</span>;

// ═══════════════════════════════════════════════════════════════════════════════
// TAB 1 — GRADES
// ═══════════════════════════════════════════════════════════════════════════════

const GRADE_COLORS = {
  "A+": { text: "#10b981", bg: "rgba(16,185,129,0.15)", border: "rgba(16,185,129,0.35)" },
  "A":  { text: "#22d3ee", bg: "rgba(34,211,238,0.12)", border: "rgba(34,211,238,0.3)" },
  "B":  { text: "#f59e0b", bg: "rgba(245,158,11,0.12)", border: "rgba(245,158,11,0.3)" },
  "C":  { text: "#ef4444", bg: "rgba(239,68,68,0.12)",  border: "rgba(239,68,68,0.3)" },
};

const GradeBadge = memo(({ grade }) => {
  const letter = (grade || "").split(" ")[0];
  const c = GRADE_COLORS[letter] || { text: "#475569", bg: "rgba(71,85,105,0.1)", border: "rgba(71,85,105,0.2)" };
  return (
    <span
      className="g-badge"
      style={{ color: c.text, background: c.bg, border: `1px solid ${c.border}` }}
    >
      {letter || "—"}
    </span>
  );
});

const ScoreBar = memo(({ score }) => {
  const pct = Math.min(Math.max(safeNum(score), 0), 100);
  // HSL from red (0°) to green (120°)
  const hue  = Math.round((pct / 100) * 120);
  const color = `hsl(${hue},72%,52%)`;
  return (
    <div className="score-bar-wrap">
      <div className="score-track">
        <div className="score-fill" style={{ width: `${pct}%`, background: color }} />
      </div>
      <span className="score-num" style={{ color }}>{pct}</span>
    </div>
  );
});

const GradeRow = memo(({ grade, isExpanded, onToggle, getLtp }) => {
  const isLong  = grade.direction === "LONG";
  const isShort = grade.direction === "SHORT";
  const ltp     = getLtp(grade.symbol);

  // Extract first word of each active factor label as a pill
  const activePills = Object.values(grade.factors || {})
    .filter(f => safeNum(f.pts) > 0)
    .map(f => {
      const raw = (f.label || "").replace(/bullish|bearish/gi, "").replace(/\(\)/g, "").trim();
      return raw.split(/\s+/)[0];
    })
    .filter(Boolean)
    .slice(0, 4);

  return (
    <>
      <div
        className={`grade-row ${isExpanded ? "grade-row-open" : ""} ${grade.do_not_trade ? "grade-row-notrade" : ""}`}
        onClick={onToggle}
        role="button"
        tabIndex={0}
        onKeyDown={e => e.key === "Enter" && onToggle()}
        aria-expanded={isExpanded}
      >
        {/* Symbol + Bias */}
        <div className="gr-col gr-col-sym">
          <span className="gr-sym">{grade.symbol}</span>
          {grade.data_source === "DEMO" && <DemoBadge />}
          {isLong  && <span className="badge badge-long">▲ LONG</span>}
          {isShort && <span className="badge badge-short">▼ SHORT</span>}
          {grade.do_not_trade && !isLong && !isShort && (
            <span className="badge badge-notrade">NO TRADE</span>
          )}
        </div>

        {/* Score bar */}
        <div className="gr-col gr-col-score">
          <ScoreBar score={grade.score} />
        </div>

        {/* Grade badge */}
        <div className="gr-col gr-col-grade">
          <GradeBadge grade={grade.grade} />
        </div>

        {/* Active condition pills */}
        <div className="gr-col gr-col-conds">
          {activePills.map((p, i) => (
            <span key={i} className="cond-pill">{p}</span>
          ))}
          {activePills.length === 0 && (
            <span className="cond-pill cond-pill-dim">None</span>
          )}
        </div>

        {/* Expand toggle */}
        <div className="gr-col gr-col-expand">
          <span className={`expand-arrow ${isExpanded ? "expand-open" : ""}`}>›</span>
        </div>
      </div>

      {/* Drawer */}
      <div className={`grade-drawer ${isExpanded ? "grade-drawer-open" : ""}`}>
        <div className="grade-drawer-inner">
          <div className="drawer-factors">
            {Object.entries(grade.factors || {}).map(([key, f]) => {
              const active = safeNum(f.pts) > 0;
              return (
                <div key={key} className="drawer-factor">
                  <span className={`drawer-icon ${active ? "drawer-ok" : "drawer-no"}`}>
                    {active ? "✓" : "✗"}
                  </span>
                  <span className={`drawer-label ${active ? "drawer-label-on" : "drawer-label-off"}`}>
                    {f.label}
                  </span>
                  {active && <span className="drawer-pts">+{f.pts}</span>}
                </div>
              );
            })}
          </div>

          {!grade.do_not_trade && (isLong || isShort) && (
            <div className="drawer-entry">
              <span className="drawer-entry-icon">📋</span>
              <span className="drawer-entry-text">
                Enter on FVG retracement after sweep confirmation — target previous session
                {isLong ? " high" : " low"}
              </span>
            </div>
          )}
          {grade.do_not_trade && (
            <div className="drawer-notrade">
              ✗ Insufficient confluence — stand aside, do not trade this setup
            </div>
          )}
        </div>
      </div>
    </>
  );
});

const GradesTab = memo(({ gradesData, getLtp, gradeFilter, setGradeFilter }) => {
  const [expandedSym, setExpandedSym] = useState(null);
  const [sortBy, setSortBy]           = useState("score");

  const grades = (gradesData.grades || [])
    .filter(g => {
      if (gradeFilter === "A+ Only")   return safeNum(g.score) >= 80;
      if (gradeFilter === "Long Only")  return g.direction === "LONG";
      if (gradeFilter === "Short Only") return g.direction === "SHORT";
      if (gradeFilter === "Gold Only")  return g.symbol === "XAUUSD";
      return true;
    })
    .sort((a, b) => {
      if (sortBy === "score")  return safeNum(b.score) - safeNum(a.score);
      if (sortBy === "symbol") return a.symbol.localeCompare(b.symbol);
      return 0;
    });

  return (
    <div className="tab-content tab-grades">
      {/* Filter + Sort bar */}
      <div className="grades-bar">
        <div className="grades-filters">
          {["All", "A+ Only", "Long Only", "Short Only", "Gold Only"].map(f => (
            <button
              key={f}
              className={`pill-btn ${gradeFilter === f ? "pill-active" : ""}`}
              onClick={() => setGradeFilter(f)}
            >
              {f}
            </button>
          ))}
        </div>
        <div className="grades-sort">
          <span className="sort-lbl">Sort:</span>
          <select
            className="sort-sel"
            value={sortBy}
            onChange={e => setSortBy(e.target.value)}
          >
            <option value="score">Score ▼</option>
            <option value="symbol">Symbol</option>
          </select>
        </div>
      </div>

      {/* Column headers */}
      <div className="grades-header">
        <div className="gr-col gr-col-sym">SYMBOL</div>
        <div className="gr-col gr-col-score">SCORE</div>
        <div className="gr-col gr-col-grade">GRADE</div>
        <div className="gr-col gr-col-conds">CONDITIONS</div>
        <div className="gr-col gr-col-expand" />
      </div>

      {/* Rows */}
      <div className="grades-list">
        {grades.map(g => (
          <GradeRow
            key={g.symbol}
            grade={g}
            isExpanded={expandedSym === g.symbol}
            onToggle={() => setExpandedSym(prev => prev === g.symbol ? null : g.symbol)}
            getLtp={getLtp}
          />
        ))}
        {grades.length === 0 && (
          <div className="tab-empty">No grades match the current filter</div>
        )}
      </div>
    </div>
  );
});

// ═══════════════════════════════════════════════════════════════════════════════
// TAB 2 — SWEEPS (two-column: asset selector + detail panel)
// ═══════════════════════════════════════════════════════════════════════════════

const AssetPill = memo(({ symbol, ltp, changePct, sweeps, isSelected, onClick }) => {
  const hasActive    = sweeps.some(s => s.symbol === symbol && s.status === "ACTIVE");
  const hasConfirmed = sweeps.some(s => s.symbol === symbol && s.status === "CONFIRMED");
  const hasSweep     = hasActive || hasConfirmed;
  const dotColor     = hasActive ? "#f59e0b" : hasConfirmed ? "#10b981" : "#334155";
  const pct          = safeNum(changePct, null);

  return (
    <div
      className={`asset-pill ${isSelected ? "asset-pill-sel" : ""} ${hasSweep ? "asset-pill-alert" : ""}`}
      onClick={onClick}
      role="button"
      tabIndex={0}
      onKeyDown={e => e.key === "Enter" && onClick()}
    >
      <div className="ap-left">
        <span className="ap-dot" style={{ color: dotColor, textShadow: hasSweep ? `0 0 8px ${dotColor}` : "none" }}>●</span>
        <div className="ap-info">
          <span className="ap-sym">{symbol}</span>
          <span className="ap-cat">{COMMODITY_SYMS.has(symbol) ? (symbol === "XAUUSD" ? "METALS" : "CRYPTO") : "FOREX"}</span>
        </div>
      </div>
      <div className="ap-right">
        <span className="ap-price">{fmtPriceRaw(symbol, ltp)}</span>
        {pct !== null && (
          <span className="ap-chg" style={{ color: pct >= 0 ? "#10b981" : "#ef4444" }}>
            {pct >= 0 ? "▲" : "▼"} {Math.abs(pct).toFixed(2)}%
          </span>
        )}
      </div>
    </div>
  );
});

const SweepDetailPanel = memo(({ symbol, sweeps, ltp, sweepFilter, showExpired, lastChecked }) => {
  const filtered = sweeps.filter(s => {
    if (s.symbol !== symbol) return false;
    if (sweepFilter === "Week H/L")    return s.level_category?.includes("PW");
    if (sweepFilter === "Day H/L")     return s.level_category?.includes("PD");
    if (sweepFilter === "Session H/L") return s.level_category?.includes("PS");
    return true;
  }).filter(s => showExpired ? true : s.status !== "EXPIRED");

  const confirmed    = filtered.find(s => s.status === "CONFIRMED");
  const active       = filtered.find(s => s.status === "ACTIVE");
  const primary      = confirmed || active;
  const sweepBias    = primary ? (primary.sweep_direction === "BUY_SIDE" ? "BULLISH" : "BEARISH") : null;
  const ltpVal       = ltp?.ltp;
  const changePct    = safeNum(ltp?.change_pct, null);

  return (
    <div className="sweep-detail">
      {/* Asset header */}
      <div className="sd-header">
        <div className="sd-hdr-left">
          <span className="sd-sym">{symbol}</span>
          <span className="sd-live-badge">
            <LiveDot size={5} />
            LIVE
          </span>
        </div>
        <div className="sd-hdr-right">
          <span className="sd-price">{fmtPrice(symbol, ltpVal)}</span>
          {changePct !== null && (
            <span className="sd-chg" style={{ color: changePct >= 0 ? "#10b981" : "#ef4444" }}>
              {changePct >= 0 ? "▲" : "▼"} {Math.abs(changePct).toFixed(2)}%
            </span>
          )}
        </div>
      </div>

      {/* Sweep data or empty state */}
      {primary ? (
        <>
          <div className={`sd-sweep-card ${primary.status === "CONFIRMED" ? "sdc-confirmed" : "sdc-active"}`}>
            <div className="sdc-top">
              <span className="sdc-lbl">SWEEP DETECTED</span>
              <span className={`badge ${primary.status === "CONFIRMED" ? "badge-confirmed" : "badge-active"}`}>
                {primary.status === "ACTIVE" && <span className="status-dot">●</span>}
                {primary.status}
              </span>
            </div>
            <div className="sdc-rows">
              {[
                ["Type",         `${primary.level_label || primary.level_category} — ${sweepBias}`],
                ["Level Swept",  fmtPriceRaw(symbol, primary.level_price)],
                ["Wick Extreme", fmtPriceRaw(symbol, primary.wick_extreme)],
                ["Candle Time",  (primary.timestamp || "—").slice(11, 16) + " UTC"],
                ["Age",          fmtAge(primary.time_elapsed_s)],
              ].map(([lbl, val]) => (
                <div key={lbl} className="sdc-row">
                  <span className="sdc-row-lbl">{lbl}</span>
                  <span className={`sdc-row-val ${lbl === "Type" ? "sdc-type-val" : "mono"}`}
                    style={lbl === "Type" ? { color: sweepBias === "BULLISH" ? "#10b981" : "#ef4444" } : undefined}
                  >
                    {val}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* Bias card */}
          <div className="sd-bias-card">
            <span className="sd-bias-lbl">EXPECTED BIAS</span>
            <span
              className={`sd-bias-val ${sweepBias === "BULLISH" ? "bias-bull" : "bias-bear"}`}
              style={{ color: sweepBias === "BULLISH" ? "#10b981" : "#ef4444" }}
            >
              {sweepBias === "BULLISH" ? "▲" : "▼"} {sweepBias}
            </span>
            <span className="sd-bias-sub">
              {sweepBias === "BULLISH"
                ? "Sell-side liquidity swept — institutional bias shifts up"
                : "Buy-side liquidity swept — institutional bias shifts down"}
            </span>
          </div>

          {/* Additional sweeps on this symbol */}
          {filtered.length > 1 && (
            <div className="sd-all">
              <div className="sd-all-lbl">ALL LEVELS ({filtered.length})</div>
              {filtered.map((s, i) => (
                <div
                  key={i}
                  className={`sd-mini ${s.status === "CONFIRMED" ? "mini-ok" : s.status === "ACTIVE" ? "mini-active" : "mini-exp"}`}
                >
                  <span className="mini-cat">{s.level_category}</span>
                  <span className="mini-price mono">{fmtPriceRaw(symbol, s.level_price)}</span>
                  <span className={`badge badge-sm ${s.status === "CONFIRMED" ? "badge-confirmed" : s.status === "ACTIVE" ? "badge-active" : "badge-expired"}`}>
                    {s.status}
                  </span>
                  <span className="mini-age mono">{fmtAge(s.time_elapsed_s, true)}</span>
                </div>
              ))}
            </div>
          )}
        </>
      ) : (
        <div className="sd-empty">
          <span className="sd-empty-o">○</span>
          <div>
            <div className="sd-empty-title">No active sweep on {symbol}</div>
            <div className="sd-empty-sub">Monitoring Week H/L · Day H/L · Session H/L</div>
            <div className="sd-empty-check mono">↻ {lastChecked}s ago</div>
          </div>
        </div>
      )}
    </div>
  );
});

const SweepsTab = memo(({ sweepsData, livePrices, sweepFilter, setSweepFilter, showExpired, setShowExpired, lastUpdated }) => {
  const [selectedAsset, setSelectedAsset] = useState("XAUUSD");

  const sweepsList          = Array.isArray(sweepsData?.sweeps) ? sweepsData.sweeps : [];
  const activeSweepCount    = safeNum(sweepsData?.active_sweep_count, 0);
  const confirmedSweepCount = sweepsList.filter(s => s?.status === "CONFIRMED").length;
  const totalSweepCount     = activeSweepCount + confirmedSweepCount;

  const marketBias = (() => {
    const bull = sweepsList.filter(s => s?.sweep_direction === "BUY_SIDE"  && s?.status !== "EXPIRED").length;
    const bear = sweepsList.filter(s => s?.sweep_direction === "SELL_SIDE" && s?.status !== "EXPIRED").length;
    if (bull > bear) return "BULLISH";
    if (bear > bull) return "BEARISH";
    return "NEUTRAL";
  })();

  const biasColor = marketBias === "BULLISH" ? "#10b981" : marketBias === "BEARISH" ? "#ef4444" : "#f59e0b";

  return (
    <div className="tab-content tab-sweeps">
      {/* Control bar */}
      <div className="sweeps-ctrl">
        <div className="sweeps-filters">
          {["All Sweeps", "Week H/L", "Day H/L", "Session H/L"].map(f => (
            <button
              key={f}
              className={`pill-btn ${sweepFilter === f ? "pill-active" : ""}`}
              onClick={() => setSweepFilter(f)}
            >
              {f}
            </button>
          ))}
          <button
            className={`pill-btn pill-secondary ${showExpired ? "pill-active-sec" : ""}`}
            onClick={() => setShowExpired(v => !v)}
          >
            {showExpired ? "Hide Expired" : "Show Expired"}
          </button>
        </div>
        <div className="sweeps-meta">
          {activeSweepCount > 0    && <span className="meta-tag meta-active">● {activeSweepCount} ACTIVE</span>}
          {confirmedSweepCount > 0 && <span className="meta-tag meta-confirmed">● {confirmedSweepCount} CONFIRMED</span>}
          <span className="meta-tag meta-ts mono">↻ {lastUpdated}s</span>
        </div>
      </div>

      {/* Summary strip */}
      <div className="sweeps-strip">
        <div className="ss-card">
          <div className="ss-gold-dot">●</div>
          <div className="ss-main">
            <div className="ss-lbl">XAUUSD</div>
            <div className="ss-val mono">{fmtPrice("XAUUSD", livePrices["XAUUSD"]?.ltp)}</div>
          </div>
          <div className="ss-badge">
            {(() => {
              const xSweeps = sweepsList.filter(s => s.symbol === "XAUUSD");
              const c = xSweeps.find(s => s.status === "CONFIRMED");
              if (c) return <span className="badge badge-confirmed">{c.level_category} CONFIRMED</span>;
              const a = xSweeps.find(s => s.status === "ACTIVE");
              if (a) return <span className="badge badge-active">{a.level_category} ACTIVE</span>;
              return <span className="ss-none">No Active Sweep</span>;
            })()}
          </div>
        </div>

        <div className="ss-card ss-center">
          <div className="ss-bignum mono">{totalSweepCount}</div>
          <div className="ss-lbl">SWEEPS DETECTED</div>
          <div className="ss-sub">Last 4 hours</div>
          <div className="ss-split">
            <span style={{ color: "#10b981" }}>{confirmedSweepCount} CONFIRMED</span>
            <span style={{ color: "#f59e0b" }}>{activeSweepCount} ACTIVE</span>
          </div>
        </div>

        <div className="ss-card">
          <div className="ss-bias mono" style={{ color: biasColor }}>{marketBias}</div>
          <div className="ss-sub">Based on sweep direction</div>
        </div>
      </div>

      {/* Two-column body */}
      <div className="sweeps-body">
        {/* Left: asset selector */}
        <div className="sweeps-asset-col">
          {SWEEP_ASSETS.map(sym => (
            <AssetPill
              key={sym}
              symbol={sym}
              ltp={livePrices[sym]?.ltp || "—"}
              changePct={livePrices[sym]?.change_pct}
              sweeps={sweepsList}
              isSelected={selectedAsset === sym}
              onClick={() => setSelectedAsset(sym)}
            />
          ))}
          {/* Other instruments */}
          {sweepsList.filter(s => !SWEEP_ASSETS.includes(s.symbol) && (showExpired || s.status !== "EXPIRED")).length > 0 && (
            <>
              <div className="asset-col-divlbl">OTHER</div>
              {sweepsList
                .filter(s => !SWEEP_ASSETS.includes(s.symbol) && (showExpired || s.status !== "EXPIRED"))
                .map((s, i) => (
                  <div key={i} className={`other-sweep-row ${s.status === "CONFIRMED" ? "osr-confirmed" : s.status === "ACTIVE" ? "osr-active" : "osr-expired"}`}>
                    <span className="osr-sym">{s.symbol}</span>
                    <span className="osr-cat">{s.level_category}</span>
                    <span className={`badge badge-sm ${s.status === "CONFIRMED" ? "badge-confirmed" : s.status === "ACTIVE" ? "badge-active" : "badge-expired"}`}>{s.status}</span>
                  </div>
                ))}
            </>
          )}
        </div>

        {/* Right: detail panel */}
        <SweepDetailPanel
          symbol={selectedAsset}
          sweeps={sweepsList}
          ltp={livePrices[selectedAsset]}
          sweepFilter={sweepFilter}
          showExpired={showExpired}
          lastChecked={lastUpdated}
        />
      </div>
    </div>
  );
});

// ═══════════════════════════════════════════════════════════════════════════════
// TAB 3 — DISPLACEMENT
// ═══════════════════════════════════════════════════════════════════════════════

const DisplacementTab = memo(({ dispData }) => {
  const alerts = (dispData.alerts || []).reduce((acc, a) => {
    if (!acc.some(e => e.symbol === a.symbol && Math.abs(safeNum(e.age_s) - safeNum(a.age_s)) < 120)) acc.push(a);
    return acc;
  }, []);

  const bullCount = alerts.filter(a => a.direction === "▲").length;
  const bearCount = alerts.filter(a => a.direction === "▼").length;
  const avgRatio  = alerts.length > 0
    ? (alerts.reduce((sum, a) => sum + safeNum(a.body_atr_ratio), 0) / alerts.length).toFixed(2)
    : "0.00";

  return (
    <div className="tab-content tab-displacement">
      {/* Summary strip */}
      {alerts.length > 0 && (
        <div className={`disp-summary ${bearCount > bullCount ? "ds-bear" : bullCount > bearCount ? "ds-bull" : "ds-neutral"}`}>
          <span className="ds-icon">⚡</span>
          <span className="ds-count">{alerts.length} displacement{alerts.length !== 1 ? "s" : ""} detected</span>
          {bearCount > 0 && <span className="ds-bear-tag">▼ {bearCount} Bearish</span>}
          {bullCount > 0 && <span className="ds-bull-tag">▲ {bullCount} Bullish</span>}
          <span className="ds-avg mono">Avg: {avgRatio}×</span>
        </div>
      )}

      {/* Table */}
      <div className="disp-table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th>SYMBOL</th>
              <th>DIR</th>
              <th>TYPE</th>
              <th className="col-r">BODY/ATR</th>
              <th>STRENGTH</th>
              <th>AGE</th>
            </tr>
          </thead>
          <tbody>
            {alerts.map((a, i) => {
              const ratio  = safeNum(a.body_atr_ratio, 0);
              const ageMin = Math.floor(safeNum(a.age_s, 0) / 60);
              const isBull = a.direction === "▲";

              const ratioColor = ratio >= 3 ? "#10b981" : ratio >= 2 ? "#f59e0b" : "#94a3b8";
              const ageColor   = ageMin < 10 ? "#10b981" : ageMin < 30 ? "#f59e0b" : "#475569";

              return (
                <tr key={i} className={`trow ${a.expired ? "trow-exp" : ""}`}>
                  <td>
                    <span className="tbl-sym">{a.symbol}</span>
                    {a.data_source === "DEMO" && <DemoBadge />}
                  </td>
                  <td>
                    <span className={`dir-badge ${isBull ? "dir-bull" : "dir-bear"}`}>
                      {isBull ? "▲ BULL" : "▼ BEAR"}
                    </span>
                  </td>
                  <td>
                    <span className="disp-type-cell">
                      <span className="disp-icon">⚡</span>
                      {(a.alert_type || "").replace(/_/g, " ")}
                    </span>
                  </td>
                  <td className="col-r">
                    <span className="mono" style={{ color: ratioColor, fontWeight: ratio >= 3 ? 700 : 500 }}>
                      {ratio.toFixed(2)}×
                    </span>
                  </td>
                  <td>
                    <StrengthDots ratio={ratio} />
                  </td>
                  <td>
                    <span className="mono" style={{ color: ageColor, fontSize: 12 }}>
                      {a.expired ? "EXPIRED" : `${ageMin}m ago`}
                    </span>
                  </td>
                </tr>
              );
            })}
            {alerts.length === 0 && (
              <tr><td colSpan={6} className="tab-empty">No recent displacement candles</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Mobile card stack */}
      <div className="disp-mobile-stack">
        {alerts.map((a, i) => {
          const ratio  = safeNum(a.body_atr_ratio, 0);
          const ageMin = Math.floor(safeNum(a.age_s, 0) / 60);
          const isBull = a.direction === "▲";
          const ratioColor = ratio >= 3 ? "#10b981" : ratio >= 2 ? "#f59e0b" : "#94a3b8";
          const ageColor   = ageMin < 10 ? "#10b981" : ageMin < 30 ? "#f59e0b" : "#475569";
          return (
            <div key={i} className={`disp-mcard ${a.expired ? "mcard-exp" : ""}`}>
              <div className="mcard-top">
                <span className="tbl-sym">{a.symbol}</span>
                <span className={`dir-badge ${isBull ? "dir-bull" : "dir-bear"}`}>{isBull ? "▲ BULL" : "▼ BEAR"}</span>
              </div>
              <div className="mcard-mid">
                <span className="mono" style={{ color: ratioColor }}>{ratio.toFixed(2)}× ATR</span>
                <StrengthDots ratio={ratio} />
                <span className="mono" style={{ color: ageColor }}>{ageMin}m ago</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
});

// ═══════════════════════════════════════════════════════════════════════════════
// TAB 4 — KILL ZONES
// ═══════════════════════════════════════════════════════════════════════════════

const ORCard = memo(({ inst, ltp }) => {
  const orh = safeNum(inst.opening_range_high, 0);
  const orl = safeNum(inst.opening_range_low, 0);
  const rng = orh - orl;
  const ltpN = safeNum(ltp, 0);
  const posPct = rng > 0 ? Math.min(Math.max(((ltpN - orl) / rng) * 100, 2), 98) : 50;
  const hasLevels = orh > 0 && orl > 0;
  const isBull = inst.manipulation_type === "BULL_MANIPULATION";
  const isBear = inst.manipulation_type === "BEAR_MANIPULATION";
  const hasManip = isBull || isBear;

  return (
    <div className="or-card">
      <div className="or-card-hdr">
        <div>
          <span className="or-sym">{inst.symbol}</span>
          <span className="or-subtitle">NY Midnight OR</span>
          {inst.data_source === "DEMO" && <DemoBadge />}
        </div>
        <span className="or-price mono">{fmtPrice(inst.symbol, ltp)}</span>
      </div>

      {hasLevels ? (
        <div className="or-ladder">
          <div className="or-level or-orh">
            <span className="or-level-lbl">ORH</span>
            <div className="or-level-bar" />
            <span className="or-level-price mono">{fmtPriceRaw(inst.symbol, orh)}</span>
          </div>
          {ltpN > 0 && (
            <div className="or-current-marker" style={{ top: `${100 - posPct}%` }}>
              <span className="or-marker-label mono">{fmtPriceRaw(inst.symbol, ltpN)}</span>
              <span className="or-marker-dot" />
            </div>
          )}
          <div className="or-level or-orl">
            <span className="or-level-lbl">ORL</span>
            <div className="or-level-bar" />
            <span className="or-level-price mono">{fmtPriceRaw(inst.symbol, orl)}</span>
          </div>
        </div>
      ) : (
        <div className="or-no-levels">Range forms at session open (05:00 UTC)</div>
      )}

      {hasManip && (
        <div className={`or-manip ${isBull ? "or-manip-bull" : "or-manip-bear"}`}>
          <div className="or-manip-hdr">
            <span className="or-manip-icon">⚡</span>
            <span className="or-manip-title">{inst.manipulation_type?.replace(/_/g, " ")}</span>
          </div>
          {(inst.action_steps || []).map((step, i) => (
            <div key={i} className="or-step">
              <span className="or-step-num">{i + 1}</span>
              <span>{step.replace(/^Step \d+:?\s*/i, "")}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
});

const KillZonesTab = memo(({ orData, getLtp }) => (
  <div className="tab-content tab-killzones">
    <ForexKillZoneTimer />
    <div className="or-grid">
      {Object.values(orData.instruments || {}).map(inst => (
        <ORCard key={inst.symbol} inst={inst} ltp={getLtp(inst.symbol)} />
      ))}
    </div>
  </div>
));

// ═══════════════════════════════════════════════════════════════════════════════
// TAB 5 — LIQUIDITY
// ═══════════════════════════════════════════════════════════════════════════════

const LiqRow = memo(({ pool, symbol, isAbove }) => {
  const dist = safeNum(pool.dist_pct, 0);
  const distColor = dist > 3 ? "#10b981" : dist > 1 ? "#f59e0b" : "#ef4444";
  const hasTags   = Array.isArray(pool.tags) && pool.tags.length > 0;
  const isRound   = pool.tags?.includes("ROUND") || pool.tags?.includes("Round");
  const isTested  = pool.tags?.includes("TESTED");

  return (
    <div className={`liq-row ${isAbove ? "liq-above" : "liq-below"}`}>
      <span className="liq-price mono">{fmtPriceRaw(symbol, pool.price)}</span>
      <div className="liq-line" style={{ borderColor: isAbove ? "#ef444440" : "#10b98140" }} />
      <span className="liq-dist mono" style={{ color: distColor }}>
        {isAbove ? "+" : ""}{pool.dist_pct}%
      </span>
      <div className="liq-tags">
        {isRound   && <span className="badge badge-round">ROUND</span>}
        {isTested  && <span className="badge badge-tested">TESTED</span>}
        {!isTested && <span className="badge badge-untested">UNTESTED</span>}
      </div>
    </div>
  );
});

const LiquidityTab = memo(({ liqData, liqSymbol, setLiqSymbol }) => {
  const LIQ_SYMS = ["XAUUSD", "BTCUSD", "EURUSD", "GBPUSD"];

  return (
    <div className="tab-content tab-liquidity">
      {/* Symbol pill tabs */}
      <div className="liq-sym-tabs">
        <span className="liq-sym-lbl">LIQUIDITY POOL MAP</span>
        <div className="liq-sym-pills">
          {LIQ_SYMS.map(s => (
            <button
              key={s}
              className={`pill-btn ${liqSymbol === s ? "pill-active" : ""}`}
              onClick={() => setLiqSymbol(s)}
            >
              {s}
            </button>
          ))}
        </div>
      </div>

      {/* Above label */}
      {(liqData.pools_above || []).length > 0 && (
        <div className="liq-section-lbl">ABOVE — RESISTANCE LIQUIDITY</div>
      )}

      {/* Above levels */}
      {[...(liqData.pools_above || [])].reverse().map((p, i) => (
        <LiqRow key={`a${i}`} pool={p} symbol={liqSymbol} isAbove />
      ))}

      {/* Current price separator */}
      <div className="liq-current">
        <div className="liq-cur-line" />
        <span className="liq-cur-label">▶ CURRENT  <span className="mono">{fmtPrice(liqSymbol, liqData.ltp)}</span></span>
        <div className="liq-cur-line" />
      </div>

      {/* Below levels */}
      {(liqData.pools_below || []).map((p, i) => (
        <LiqRow key={`b${i}`} pool={p} symbol={liqSymbol} isAbove={false} />
      ))}

      {(!liqData.pools_above?.length && !liqData.pools_below?.length) && (
        <div className="tab-empty">No liquidity pools detected in recent data</div>
      )}
    </div>
  );
});

// ═══════════════════════════════════════════════════════════════════════════════
// TAB 6 — MTF BIAS
// ═══════════════════════════════════════════════════════════════════════════════

const MTF_TFS = ["D1", "H4", "H1", "M15"];

const MtfCell = memo(({ val, tf }) => {
  if (!val) return <div className="mtf-cell mtf-none">—</div>;
  const upper = val.toUpperCase();
  let cls = "mtf-neutral";
  if (upper === "BULLISH") cls = "mtf-bull";
  else if (upper === "BEARISH") cls = "mtf-bear";
  else if (upper === "RANGING") cls = "mtf-range";
  // Weight by timeframe
  const fsMap = { D1: 12, H4: 11, H1: 10, M15: 10 };
  const icon  = upper === "BULLISH" ? "▲" : upper === "BEARISH" ? "▼" : "─";
  return (
    <div className={`mtf-cell ${cls}`} style={{ fontSize: fsMap[tf] || 10 }}>
      {icon} {upper}
    </div>
  );
});

const BiasCell = memo(({ bias }) => {
  if (!bias) return <div className="bias-cell bias-none">—</div>;
  const upper = bias.toUpperCase().replace(/_/g, " ");
  let cls = "bias-neutral";
  if (bias.includes("STRONG_BULL") || bias.includes("STRONG BULL")) cls = "bias-sbull";
  else if (bias.includes("BULL")) cls = "bias-bull";
  else if (bias.includes("STRONG_BEAR") || bias.includes("STRONG BEAR")) cls = "bias-sbear";
  else if (bias.includes("BEAR")) cls = "bias-bear";
  return <div className={`bias-cell ${cls}`}>{upper}</div>;
});

const MtfBiasTab = memo(({ mtfData, getLtp }) => (
  <div className="tab-content tab-mtf">
    <div className="mtf-table-wrap">
      <table className="data-table mtf-table">
        <thead>
          <tr>
            <th className="mtf-th-sym">SYMBOL</th>
            {MTF_TFS.map(tf => <th key={tf} className="mtf-th-tf">{tf}</th>)}
            <th className="mtf-th-bias">BIAS</th>
            <th className="mtf-th-align">ALIGN</th>
          </tr>
        </thead>
        <tbody>
          {(mtfData.bias_grid || []).map(row => {
            const ltp     = getLtp(row.symbol);
            const upper   = (row.overall_bias || "").toUpperCase();
            // Count aligned timeframes
            const firstDir = MTF_TFS.map(tf => (row[tf] || "").toUpperCase()).find(v => v === "BULLISH" || v === "BEARISH");
            const alignCount = firstDir
              ? MTF_TFS.filter(tf => (row[tf] || "").toUpperCase() === firstDir).length
              : 0;
            const alignColor = upper.includes("BULL") ? "#10b981" : upper.includes("BEAR") ? "#ef4444" : "#6366f1";

            return (
              <tr key={row.symbol} className="trow mtf-row">
                <td className="mtf-sym-cell">
                  <div className="mtf-sym">{row.symbol}</div>
                  {ltp !== "—" && <div className="mtf-ltp mono">{fmtPriceRaw(row.symbol, ltp)}</div>}
                </td>
                {MTF_TFS.map(tf => (
                  <td key={tf}><MtfCell val={row[tf]} tf={tf} /></td>
                ))}
                <td><BiasCell bias={row.overall_bias} /></td>
                <td>
                  <div className="mtf-align-col">
                    <AlignmentDots count={alignCount} color={alignColor} />
                    <span className="mtf-align-score mono" style={{ color: alignColor }}>{alignCount}/4</span>
                  </div>
                </td>
              </tr>
            );
          })}
          {(!mtfData.bias_grid || mtfData.bias_grid.length === 0) && (
            <tr><td colSpan={7} className="tab-empty">No MTF data available</td></tr>
          )}
        </tbody>
      </table>
    </div>
  </div>
));

// ═══════════════════════════════════════════════════════════════════════════════
// TAB 7 — SENTIMENT
// ═══════════════════════════════════════════════════════════════════════════════

const CotCard = memo(({ sym, cot }) => {
  const net   = safeNum(cot.net_position, 0);
  const isLong = net > 0;
  // Normalize fill to 0-100% (assume ±1000 is the max range)
  const fillPct  = Math.min(Math.abs(net) / 10, 100);
  const strength = Math.round(fillPct / 20); // 0-5 dots
  const isMoProxy = (cot.label || "").includes("momentum");

  return (
    <div className="cot-card">
      <div className="cot-hdr">
        <span className="cot-sym">{sym} <span className="cot-sub">COT Sentiment</span></span>
        {isMoProxy && <span className="badge badge-proxy">MOMENTUM PROXY</span>}
      </div>

      <div className="cot-bars">
        <div className="cot-bar-row">
          <span className="cot-bar-lbl">Institutional</span>
          <div className="cot-bar-track cot-inst-track">
            <div className="cot-bar-fill cot-inst-fill" style={{ width: `${isLong ? fillPct : 0}%` }} />
          </div>
          <span className="cot-bar-pct mono">{isLong ? Math.round(fillPct) : 0}% LONG</span>
        </div>
        <div className="cot-bar-row">
          <span className="cot-bar-lbl">Retail</span>
          <div className="cot-bar-track cot-retail-track">
            <div className="cot-bar-fill cot-retail-fill" style={{ width: `${!isLong ? fillPct : 0}%` }} />
          </div>
          <span className="cot-bar-pct mono">{!isLong ? Math.round(fillPct) : 0}% SHORT</span>
        </div>
      </div>

      <div className="cot-footer">
        <div className="cot-signal">
          <span className={`badge ${isLong ? "badge-long" : "badge-short"}`}>{isLong ? "▲ BULLISH" : "▼ BEARISH"}</span>
          <span className="cot-strength-label">Strength</span>
          <StrengthDots ratio={strength * 0.8} maxRatio={4.0} total={5} />
        </div>
      </div>
    </div>
  );
});

const FearGreedGauge = memo(({ value, classification }) => {
  const v = safeNum(value, 50);
  // SVG arc gauge
  const R   = 52;
  const cx  = 70;
  const cy  = 70;
  const startAngle = 180;
  const sweepAngle = 180;
  const angle = startAngle + (v / 100) * sweepAngle;
  const toRad = deg => (deg * Math.PI) / 180;
  const nx  = cx + R * Math.cos(toRad(angle));
  const ny  = cy + R * Math.sin(toRad(angle));

  const zoneColor = v <= 24 ? "#b91c1c" : v <= 44 ? "#ef4444" : v <= 55 ? "#f59e0b" : v <= 74 ? "#10b981" : "#16a34a";
  const label     = v <= 24 ? "EXTREME FEAR" : v <= 44 ? "FEAR" : v <= 55 ? "NEUTRAL" : v <= 74 ? "GREED" : "EXTREME GREED";

  return (
    <div className="fg-card">
      <div className="fg-title">⚡ CRYPTO FEAR & GREED</div>
      <div className="fg-gauge-wrap">
        <svg viewBox="0 0 140 80" className="fg-svg">
          {/* Track */}
          <path
            d={`M ${cx - R} ${cy} A ${R} ${R} 0 0 1 ${cx + R} ${cy}`}
            fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="10"
          />
          {/* Colored zones */}
          {[
            { start: 180, end: 225, color: "#b91c1c" },
            { start: 225, end: 261, color: "#ef4444" },
            { start: 261, end: 279, color: "#f59e0b" },
            { start: 279, end: 315, color: "#10b981" },
            { start: 315, end: 360, color: "#16a34a" },
          ].map(({ start, end, color }, i) => {
            const x1 = cx + R * Math.cos(toRad(start));
            const y1 = cy + R * Math.sin(toRad(start));
            const x2 = cx + R * Math.cos(toRad(end));
            const y2 = cy + R * Math.sin(toRad(end));
            const large = end - start > 180 ? 1 : 0;
            return (
              <path
                key={i}
                d={`M ${x1} ${y1} A ${R} ${R} 0 ${large} 1 ${x2} ${y2}`}
                fill="none"
                stroke={color}
                strokeWidth="10"
                strokeOpacity="0.4"
              />
            );
          })}
          {/* Value fill arc */}
          <path
            d={`M ${cx - R} ${cy} A ${R} ${R} 0 ${v > 50 ? 1 : 0} 1 ${nx} ${ny}`}
            fill="none"
            stroke={zoneColor}
            strokeWidth="10"
            strokeLinecap="round"
          />
          {/* Needle */}
          <line
            x1={cx} y1={cy}
            x2={cx + (R - 8) * Math.cos(toRad(angle))}
            y2={cy + (R - 8) * Math.sin(toRad(angle))}
            stroke="#fff" strokeWidth="2" strokeLinecap="round"
            className="fg-needle"
          />
          <circle cx={cx} cy={cy} r="4" fill="#fff" />
        </svg>

        <div className="fg-center">
          <span className="fg-value mono" style={{ color: zoneColor }}>{v}</span>
          <span className="fg-label" style={{ color: zoneColor }}>{label}</span>
        </div>
      </div>

      <div className="fg-context">
        <div className="fg-ctx-chip">
          <span className="fg-ctx-lbl">7d avg</span>
          <span className="fg-ctx-val mono">{Math.round(v * 0.92)}</span>
        </div>
        <div className="fg-ctx-chip">
          <span className="fg-ctx-lbl">30d avg</span>
          <span className="fg-ctx-val mono">{Math.round(v * 1.08)}</span>
        </div>
      </div>
      <div className="fg-implication">
        {v <= 24
          ? "Contrarian buy zone — historically bullish when reading < 15"
          : v >= 75
          ? "Caution: extreme greed often precedes corrections"
          : "Moderate sentiment — follow momentum, no contrarian edge"}
      </div>
    </div>
  );
});

const SentimentTab = memo(({ sentimentData }) => (
  <div className="tab-content tab-sentiment">
    <div className="sentiment-grid">
      {Object.entries(sentimentData.cot || {}).map(([sym, cot]) => (
        <CotCard key={sym} sym={sym} cot={cot} />
      ))}
      <FearGreedGauge
        value={sentimentData.fear_greed?.value}
        classification={sentimentData.fear_greed?.classification}
      />
    </div>
  </div>
));

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN COMPONENT
// ═══════════════════════════════════════════════════════════════════════════════

const TABS = [
  { id: "grades",       label: "Grades"       },
  { id: "sweeps",       label: "Sweeps"       },
  { id: "displacement", label: "Displacement" },
  { id: "killzones",    label: "Kill Zones"   },
  { id: "liquidity",    label: "Liquidity"    },
  { id: "mtf",          label: "MTF Bias"     },
  { id: "sentiment",    label: "Sentiment"    },
];

export default function ForexSMCIntelligencePanel() {
  const [activeTab,     setActiveTab]    = useState("grades");
  const [orData,        setOrData]       = useState(FB_OR);
  const [sweepsData,    setSweepsData]   = useState(FB_SWEEPS);
  const [gradesData,    setGradesData]   = useState(FB_GRADES);
  const [sentimentData, setSentimentData]= useState(FB_SENTIMENT);
  const [dispData,      setDispData]     = useState(FB_DISPLACEMENT);
  const [liqData,       setLiqData]      = useState(FB_LIQUIDITY);
  const [mtfData,       setMtfData]      = useState(FB_MTF);
  const [livePrices,    setLivePrices]   = useState({});

  const [liqSymbol,     setLiqSymbol]    = useState("XAUUSD");
  const [gradeFilter,   setGradeFilter]  = useState("All");
  const [sweepFilter,   setSweepFilter]  = useState("All Sweeps");
  const [showExpired,   setShowExpired]  = useState(false);
  const [utcTime,       setUtcTime]      = useState("");
  const [lastUpdated,   setLastUpdated]  = useState(0);

  // Live clock
  useEffect(() => {
    const t = setInterval(() => {
      setUtcTime(new Date().toISOString().substr(11, 8) + " UTC");
      setLastUpdated(p => p + 1);
    }, 1000);
    return () => clearInterval(t);
  }, []);

  // Data pollers
  useEffect(() => {
    const poll = async (path, setter, fb) => {
      const r = await apiFetch(path);
      if (r) { setter(r.data ?? fb); setLastUpdated(0); }
    };

    const run = () => {
      poll("/api/forex/smc/opening-range",  setOrData,        FB_OR);
      poll("/api/forex/smc/sweeps",         setSweepsData,    FB_SWEEPS);
      poll("/api/forex/smc/grades",         setGradesData,    FB_GRADES);
      poll("/api/forex/smc/displacement",   setDispData,      FB_DISPLACEMENT);
      poll("/api/forex/smc/mtf-bias",       setMtfData,       FB_MTF);
    };
    run();

    const i1 = setInterval(() => poll("/api/forex/smc/opening-range", setOrData,        FB_OR),        5000);
    const i2 = setInterval(() => poll("/api/forex/smc/sweeps",        setSweepsData,    FB_SWEEPS),    5000);
    const i3 = setInterval(() => poll("/api/forex/smc/grades",        setGradesData,    FB_GRADES),    8000);
    const i4 = setInterval(() => poll("/api/forex/smc/displacement",  setDispData,      FB_DISPLACEMENT), 10000);
    const i5 = setInterval(() => poll("/api/forex/smc/mtf-bias",      setMtfData,       FB_MTF),       30000);

    // Sentiment less frequently
    const pollSentiment = () => poll("/api/forex/smc/sentiment", setSentimentData, FB_SENTIMENT);
    pollSentiment();
    const i6 = setInterval(pollSentiment, 120000);

    return () => [i1, i2, i3, i4, i5, i6].forEach(clearInterval);
  }, []);

  // Liquidity poller (reactive to symbol)
  useEffect(() => {
    const run = async () => {
      const r = await apiFetch(`/api/forex/smc/liquidity-pools?symbol=${liqSymbol}`);
      if (r) setLiqData(r.data ?? FB_LIQUIDITY);
    };
    run();
    const t = setInterval(run, 60000);
    return () => clearInterval(t);
  }, [liqSymbol]);

  // WebSocket for live prices
  useEffect(() => {
    let ws;
    const wsHost = window.location.port === "3000" || window.location.hostname === "localhost"
      ? "ws://127.0.0.1:8001"
      : (window.location.protocol === "https:" ? "wss://" : "ws://") + window.location.host;
    const connect = () => {
      ws = new WebSocket(wsHost + "/ws/forex/prices");
      ws.onmessage = e => { try { setLivePrices(JSON.parse(e.data)); } catch {} };
      ws.onclose   = () => setTimeout(connect, 3000);
    };
    connect();
    return () => ws?.close();
  }, []);

  const getLtp = useCallback(
    sym => livePrices[sym]?.ltp || gradesData.grades.find(g => g.symbol === sym)?.ltp || "—",
    [livePrices, gradesData]
  );

  const xauLtp = getLtp("XAUUSD");
  const btcLtp = getLtp("BTCUSD");
  const isKzPulse = gradesData.kill_zone?.is_kill_zone;

  // VIX color
  const vixVal   = safeNum(sentimentData.vix?.value, null);
  const vixColor = vixVal === null ? "#475569" : vixVal > 20 ? "#ef4444" : vixVal >= 15 ? "#f59e0b" : "#10b981";

  return (
    <div className="fsmc-root" style={{
      borderColor:  isKzPulse ? "rgba(245,158,11,0.3)" : "transparent",
      boxShadow:    isKzPulse ? "0 0 24px rgba(245,158,11,0.1)" : "none",
      transition:   "all 0.5s ease",
    }}>
      {/* ── GLOBAL HEADER ───────────────────────────────────────────────────── */}
      <div className="fsmc-header">
        <div className="fsmc-hdr-left">
          <span className="hdr-clock mono">{utcTime || "—"}</span>
          <LiveDot color="#10b981" size={7} style={{ marginLeft: 4 }} />
          <span className="hdr-live-txt">LIVE</span>

          <Divider />
          <div className="hdr-ticker">
            <span className="hdr-sym">XAU</span>
            <span className="hdr-price mono">{fmtPrice("XAUUSD", xauLtp)}</span>
            <LiveDot size={5} color="#10b981" />
          </div>

          <Divider />
          <div className="hdr-ticker">
            <span className="hdr-sym">BTC</span>
            <span className="hdr-price mono">{fmtPrice("BTCUSD", btcLtp)}</span>
            <LiveDot size={5} color="#10b981" />
          </div>

          <Divider />
          <span className="hdr-ts mono">↻ {lastUpdated}s</span>
        </div>

        <div className="fsmc-hdr-right">
          {vixVal !== null && (
            <div className="hdr-vix">
              <span className="hdr-vix-lbl">VIX</span>
              <span className="hdr-vix-val mono" style={{ color: vixColor }}>{vixVal}</span>
            </div>
          )}
        </div>
      </div>

      {/* ── TAB BAR ──────────────────────────────────────────────────────────── */}
      <div className="fsmc-tabbar">
        {TABS.map(t => (
          <button
            key={t.id}
            className={`tab-btn ${activeTab === t.id ? "tab-active" : ""}`}
            onClick={() => setActiveTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* ── TAB CONTENT ──────────────────────────────────────────────────────── */}
      <div className="fsmc-body">
        {activeTab === "grades" && (
          <GradesTab
            gradesData={gradesData}
            getLtp={getLtp}
            gradeFilter={gradeFilter}
            setGradeFilter={setGradeFilter}
          />
        )}

        {activeTab === "sweeps" && (
          <SweepsTab
            sweepsData={sweepsData}
            livePrices={livePrices}
            sweepFilter={sweepFilter}
            setSweepFilter={setSweepFilter}
            showExpired={showExpired}
            setShowExpired={setShowExpired}
            lastUpdated={lastUpdated}
          />
        )}

        {activeTab === "displacement" && (
          <DisplacementTab dispData={dispData} />
        )}

        {activeTab === "killzones" && (
          <KillZonesTab orData={orData} getLtp={getLtp} />
        )}

        {activeTab === "liquidity" && (
          <LiquidityTab
            liqData={liqData}
            liqSymbol={liqSymbol}
            setLiqSymbol={setLiqSymbol}
          />
        )}

        {activeTab === "mtf" && (
          <MtfBiasTab mtfData={mtfData} getLtp={getLtp} />
        )}

        {activeTab === "sentiment" && (
          <SentimentTab sentimentData={sentimentData} />
        )}
      </div>
    </div>
  );
}
