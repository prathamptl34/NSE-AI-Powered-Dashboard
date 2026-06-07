import React, { useState, useEffect, memo, useCallback } from "react";
import "./ForexSMCIntelligencePanel.css";
import ForexKillZoneTimer from "./ForexKillZoneTimer";

// ═══════════════════════════════════════════════════════════════════════════════
// CONSTANTS & UTILITIES
// ═══════════════════════════════════════════════════════════════════════════════

const COMMODITY_SYMS = new Set(["XAUUSD", "BTCUSD", "ETHUSD", "NAS100", "SP100"]);
const SWEEP_ASSETS   = ["XAUUSD", "BTCUSD", "EURUSD", "GBPUSD"];

const safeNum = (val, fallback = 0) =>
  val === null || val === undefined || isNaN(Number(val)) ? fallback : Number(val);

const fmtPrice = (symbol = "", price) => {
  if (price === null || price === undefined || price === "—") return "—";
  const n = parseFloat(price);
  if (isNaN(n)) return "—";
  if (COMMODITY_SYMS.has(symbol))
    return "$" + n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return n.toFixed(5);
};

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

const FB_OR          = { instruments: {}, timestamp: "—" };
const FB_SWEEPS      = { sweeps: [], timestamp: "—", active_sweep_count: 0 };
const FB_GRADES      = { grades: [], timestamp: "—", kill_zone: { is_dead_zone: false, is_kill_zone: false } };
const FB_SENTIMENT   = { cot: {}, fear_greed: { value: 50, classification: "Neutral" }, vix: { value: null }, timestamp: "—" };
const FB_DISPLACEMENT = { alerts: [], timestamp: "—" };
const FB_LIQUIDITY   = { pools_above: [], pools_below: [], ltp: "—", timestamp: "—" };
const FB_MTF         = { bias_grid: [], timestamp: "—" };

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
// MICRO-COMPONENTS
// ═══════════════════════════════════════════════════════════════════════════════

const StrengthDots = memo(({ ratio, maxRatio = 4.0, total = 5 }) => {
  const filled = Math.min(Math.round((safeNum(ratio) / maxRatio) * total), total);
  return (
    <span className="fsp-strength-dots">
      {Array.from({ length: total }, (_, i) => (
        <span key={i} className={`fsp-dot ${i < filled ? "filled" : "empty"}`}></span>
      ))}
    </span>
  );
});

const AlignmentDots = memo(({ count, total = 4, color = "#10b981" }) => (
  <span className="fsp-mtf-align">
    {Array.from({ length: total }, (_, i) => (
      <span
        key={i}
        className="fsp-align-dot"
        style={{ background: i < count ? color : "rgba(255,255,255,0.1)" }}
      />
    ))}
  </span>
));

const DemoBadge = () => <span className="fsp-badge fsp-badge-muted">DEMO</span>;

// ═══════════════════════════════════════════════════════════════════════════════
// TAB 1 — GRADES
// ═══════════════════════════════════════════════════════════════════════════════

const GradeBadge = memo(({ grade }) => {
  const letter = (grade || "").split(" ")[0];
  let cls = "fsp-grade-letter ";
  if (letter === "A+") cls += "fsp-grade-A-plus";
  else if (letter === "A") cls += "fsp-grade-A";
  else if (letter === "B") cls += "fsp-grade-B";
  else if (letter === "C") cls += "fsp-grade-C";
  else cls += "fsp-badge-muted";
  
  return (
    <span className={cls}>
      {letter || "—"}
    </span>
  );
});

const ScoreBar = memo(({ score }) => {
  const pct = Math.min(Math.max(safeNum(score), 0), 100);
  const hue  = Math.round((pct / 100) * 120);
  const color = `hsl(${hue},72%,52%)`;
  return (
    <div className="fsp-grade-score-wrap">
      <div className="fsp-score-bar-track">
        <div className="fsp-score-bar-fill" style={{ width: `${pct}%`, background: color }} />
      </div>
      <span className="fsp-score-value" style={{ color }}>{pct}</span>
    </div>
  );
});

const GradeRow = memo(({ grade, isExpanded, onToggle, getLtp }) => {
  const isLong  = grade.direction === "LONG";
  const isShort = grade.direction === "SHORT";

  const activePills = Object.values(grade.factors || {})
    .filter(f => safeNum(f.pts) > 0)
    .map(f => {
      const raw = (f.label || "").replace(/bullish|bearish/gi, "").replace(/\(\)/g, "").trim();
      return raw.split(/\s+/)[0];
    })
    .filter(Boolean)
    .slice(0, 4);

  return (
    <div className="fsp-grade-row-container">
      <div
        className="fsp-grade-row"
        onClick={onToggle}
        role="button"
        tabIndex={0}
        onKeyDown={e => e.key === "Enter" && onToggle()}
      >
        <div className="fsp-grade-row-main">
          <div className="fsp-grade-symbol">
            <span className="fsp-grade-symbol-name">{grade.symbol}</span>
            <div style={{display: "flex", gap: "4px"}}>
              {grade.data_source === "DEMO" && <DemoBadge />}
              {isLong  && <span className="fsp-badge fsp-badge-bull">▲ LONG</span>}
              {isShort && <span className="fsp-badge fsp-badge-bear">▼ SHORT</span>}
              {grade.do_not_trade && !isLong && !isShort && (
                <span className="fsp-badge fsp-badge-muted">NO TRADE</span>
              )}
            </div>
          </div>

          <ScoreBar score={grade.score} />
          <GradeBadge grade={grade.grade} />

          <div className="fsp-grade-pills">
            {activePills.map((p, i) => (
              <span key={i} className="fsp-condition-pill active">{p}</span>
            ))}
            {activePills.length === 0 && (
              <span className="fsp-condition-pill inactive">None</span>
            )}
          </div>

          <button className={`fsp-grade-expand-btn ${isExpanded ? "open" : ""}`}>
            ›
          </button>
        </div>
      </div>

      <div className={`fsp-grade-drawer ${isExpanded ? "open" : ""}`}>
        <div className="fsp-grade-drawer-inner">
          {Object.entries(grade.factors || {}).map(([key, f]) => {
            const active = safeNum(f.pts) > 0;
            return (
              <div key={key} className="fsp-drawer-condition">
                <span className={active ? "pass" : "fail"}>{active ? "✓" : "✗"}</span>
                <span>{f.label}</span>
                {active && <span style={{color: "#10b981"}}>+{f.pts}</span>}
              </div>
            );
          })}
        </div>
        {!grade.do_not_trade && (isLong || isShort) && (
          <div className="fsp-grade-entry-text">
            📋 Enter on FVG retracement after sweep confirmation — target previous session {isLong ? "high" : "low"}
          </div>
        )}
        {grade.do_not_trade && (
          <div className="fsp-grade-entry-text" style={{borderColor: "#ef4444", background: "rgba(239,68,68,0.06)"}}>
            ✗ Insufficient confluence — stand aside, do not trade this setup
          </div>
        )}
      </div>
    </div>
  );
});

const GradesTab = memo(({ gradesData, getLtp, gradeFilter, setGradeFilter }) => {
  const [expandedSym, setExpandedSym] = useState(null);
  
  const grades = (gradesData.grades || []).filter(g => {
    if (gradeFilter === "A+ Only")   return safeNum(g.score) >= 80;
    if (gradeFilter === "Long Only")  return g.direction === "LONG";
    if (gradeFilter === "Short Only") return g.direction === "SHORT";
    if (gradeFilter === "Gold Only")  return g.symbol === "XAUUSD";
    return true;
  }).sort((a, b) => safeNum(b.score) - safeNum(a.score));

  return (
    <div className="fsp-tab-content">
      <div className="fsp-grades-filters">
        {["All", "A+ Only", "Long Only", "Short Only", "Gold Only"].map(f => (
          <button
            key={f}
            className={`fsp-filter-btn ${gradeFilter === f ? "active" : ""}`}
            onClick={() => setGradeFilter(f)}
          >
            {f}
          </button>
        ))}
      </div>

      <div className="fsp-grades-list">
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
          <div className="fsp-card" style={{textAlign:"center", color:"var(--color-muted)"}}>
            No grades match the current filter
          </div>
        )}
      </div>
    </div>
  );
});

// ═══════════════════════════════════════════════════════════════════════════════
// TAB 2 — SWEEPS
// ═══════════════════════════════════════════════════════════════════════════════

const AssetPill = memo(({ symbol, ltp, changePct, sweeps, isSelected, onClick }) => {
  const hasActive    = sweeps.some(s => s.symbol === symbol && s.status === "ACTIVE");
  const hasConfirmed = sweeps.some(s => s.symbol === symbol && s.status === "CONFIRMED");
  const pct          = safeNum(changePct, null);

  return (
    <div
      className={`fsp-sweeps-asset-pill ${isSelected ? "selected" : ""}`}
      onClick={onClick}
    >
      <div className="fsp-sweeps-asset-header">
        <span className={`fsp-sweep-dot ${hasActive || hasConfirmed ? "active" : "inactive"}`}></span>
        <span className="fsp-sweeps-asset-symbol">{symbol}</span>
      </div>
      <div className="fsp-sweeps-asset-price">
        {fmtPriceRaw(symbol, ltp)}
        {pct !== null && (
          <span style={{ color: pct >= 0 ? "#10b981" : "#ef4444", marginLeft: "6px" }}>
            {pct >= 0 ? "▲" : "▼"}{Math.abs(pct).toFixed(2)}%
          </span>
        )}
      </div>
    </div>
  );
});

const SweepDetailPanel = memo(({ symbol, sweeps, ltp, sweepFilter, showExpired }) => {
  const filtered = sweeps.filter(s => {
    if (s.symbol !== symbol) return false;
    if (sweepFilter === "Week H/L")    return s.level_category?.includes("PW");
    if (sweepFilter === "Day H/L")     return s.level_category?.includes("PD");
    if (sweepFilter === "Session H/L") return s.level_category?.includes("PS");
    return true;
  }).filter(s => showExpired ? true : s.status !== "EXPIRED");

  const primary = filtered.find(s => s.status === "CONFIRMED") || filtered.find(s => s.status === "ACTIVE");
  const sweepBias = primary ? (primary.sweep_direction === "BUY_SIDE" ? "BULLISH" : "BEARISH") : null;
  const changePct = safeNum(ltp?.change_pct, null);

  return (
    <div className="fsp-sweeps-detail">
      <div className="fsp-sweeps-detail-header">
        <div>
          <span className="fsp-sweeps-detail-symbol">{symbol}</span>
        </div>
        <div style={{textAlign: "right"}}>
          <span className="fsp-sweeps-detail-price">{fmtPrice(symbol, ltp?.ltp)}</span>
          {changePct !== null && (
            <div style={{ color: changePct >= 0 ? "#10b981" : "#ef4444", fontSize: "12px", fontFamily: "var(--font-mono)" }}>
              {changePct >= 0 ? "▲" : "▼"}{Math.abs(changePct).toFixed(2)}%
            </div>
          )}
        </div>
      </div>

      {primary ? (
        <>
          <div className="fsp-sweep-card">
            <div className="fsp-sweep-card-row">
              <span className="fsp-sweep-card-label">SWEEP DETECTED</span>
              <span className={`fsp-badge ${primary.status === "CONFIRMED" ? "fsp-badge-bull" : "fsp-badge-neutral"}`}>
                {primary.status}
              </span>
            </div>
            <div className="fsp-sweep-card-row">
              <span className="fsp-sweep-card-label">Type</span>
              <span className="fsp-sweep-card-value" style={{color: sweepBias === "BULLISH" ? "#10b981" : "#ef4444"}}>
                {primary.level_label || primary.level_category} — {sweepBias}
              </span>
            </div>
            <div className="fsp-sweep-card-row">
              <span className="fsp-sweep-card-label">Level Swept</span>
              <span className="fsp-sweep-card-value">{fmtPriceRaw(symbol, primary.level_price)}</span>
            </div>
            <div className="fsp-sweep-card-row">
              <span className="fsp-sweep-card-label">Age</span>
              <span className="fsp-sweep-card-value">{fmtAge(primary.time_elapsed_s)}</span>
            </div>
          </div>
        </>
      ) : (
        <div className="fsp-sweeps-empty">
          <div className="fsp-sweeps-empty-icon"></div>
          <div className="fsp-sweeps-empty-title">No active sweep on {symbol}</div>
          <div className="fsp-sweeps-empty-subtitle">Monitoring Week H/L · Day H/L · Session H/L</div>
        </div>
      )}
    </div>
  );
});

const SweepsTab = memo(({ sweepsData, livePrices, sweepFilter, setSweepFilter, showExpired, setShowExpired }) => {
  const [selectedAsset, setSelectedAsset] = useState("XAUUSD");
  const sweepsList = Array.isArray(sweepsData?.sweeps) ? sweepsData.sweeps : [];

  return (
    <div className="fsp-tab-content">
      <div className="fsp-sweeps-filter-bar">
        {["All Sweeps", "Week H/L", "Day H/L", "Session H/L"].map(f => (
          <button
            key={f}
            className={`fsp-filter-btn ${sweepFilter === f ? "active" : ""}`}
            onClick={() => setSweepFilter(f)}
          >
            {f}
          </button>
        ))}
        <button
          className={`fsp-sweeps-show-expired ${showExpired ? "active" : ""}`}
          onClick={() => setShowExpired(v => !v)}
        >
          {showExpired ? "Hide Expired" : "Show Expired"}
        </button>
      </div>

      <div className="fsp-sweeps-layout">
        <div className="fsp-sweeps-asset-list">
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
        </div>
        <SweepDetailPanel
          symbol={selectedAsset}
          sweeps={sweepsList}
          ltp={livePrices[selectedAsset]}
          sweepFilter={sweepFilter}
          showExpired={showExpired}
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
  const avgRatio  = alerts.length > 0 ? (alerts.reduce((sum, a) => sum + safeNum(a.body_atr_ratio), 0) / alerts.length).toFixed(2) : "0.00";

  return (
    <div className="fsp-tab-content">
      {alerts.length > 0 && (
        <div className="fsp-displacement-summary">
          <span className="fsp-displacement-summary-icon">⚡</span>
          <span className="fsp-displacement-summary-stat">{alerts.length} displacement detected</span>
          {bearCount > 0 && <span className="fsp-badge fsp-badge-bear">▼ {bearCount} Bearish</span>}
          {bullCount > 0 && <span className="fsp-badge fsp-badge-bull">▲ {bullCount} Bullish</span>}
          <span className="fsp-displacement-summary-stat" style={{fontFamily:"var(--font-mono)"}}>Avg: {avgRatio}×</span>
        </div>
      )}

      <div className="fsp-displacement-table-wrap">
        <table className="fsp-displacement-table">
          <thead>
            <tr>
              <th>SYMBOL</th>
              <th>DIR</th>
              <th>TYPE</th>
              <th>BODY/ATR</th>
              <th>STRENGTH</th>
              <th>AGE</th>
            </tr>
          </thead>
          <tbody>
            {alerts.map((a, i) => {
              const ratio = safeNum(a.body_atr_ratio, 0);
              const ageMin = Math.floor(safeNum(a.age_s, 0) / 60);
              const isBull = a.direction === "▲";
              return (
                <tr key={i}>
                  <td>
                    <span className="fsp-displacement-symbol">{a.symbol}</span>
                    {a.data_source === "DEMO" && <DemoBadge />}
                  </td>
                  <td>
                    <span className={`fsp-dir-badge ${isBull ? "bull" : "bear"}`}>
                      {isBull ? "▲ BULL" : "▼ BEAR"}
                    </span>
                  </td>
                  <td>⚡ {(a.alert_type || "").replace(/_/g, " ")}</td>
                  <td><span className="fsp-atr-value">{ratio.toFixed(2)}×</span></td>
                  <td><StrengthDots ratio={ratio} /></td>
                  <td>
                    <span className="fsp-age" style={{color: ageMin < 10 ? "#10b981" : "#f59e0b"}}>
                      {a.expired ? "EXPIRED" : `${ageMin}m ago`}
                    </span>
                  </td>
                </tr>
              );
            })}
            {alerts.length === 0 && (
              <tr><td colSpan={6} style={{textAlign:"center", padding:"20px", color:"var(--color-muted)"}}>No recent displacement</td></tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="fsp-displacement-mobile-cards">
        {alerts.map((a, i) => {
          const ratio = safeNum(a.body_atr_ratio, 0);
          const ageMin = Math.floor(safeNum(a.age_s, 0) / 60);
          const isBull = a.direction === "▲";
          return (
            <div key={i} className="fsp-displacement-mobile-card">
              <div className="fsp-displacement-mobile-card-top">
                <span className="fsp-displacement-symbol">{a.symbol}</span>
                <span className={`fsp-dir-badge ${isBull ? "bull" : "bear"}`}>{isBull ? "▲ BULL" : "▼ BEAR"}</span>
              </div>
              <div className="fsp-displacement-mobile-card-bottom">
                <span className="fsp-atr-value">{ratio.toFixed(2)}× ATR</span>
                <StrengthDots ratio={ratio} />
                <span className="fsp-age">{ageMin}m ago</span>
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

const KillZonesTab = memo(({ orData, getLtp }) => (
  <div className="fsp-tab-content">
    <ForexKillZoneTimer />
    <div className="fsp-kz-assets-grid">
      {Object.values(orData.instruments || {}).map(inst => {
        const ltp = getLtp(inst.symbol);
        const orh = safeNum(inst.opening_range_high, 0);
        const orl = safeNum(inst.opening_range_low, 0);
        const isBull = inst.manipulation_type === "BULL_MANIPULATION";
        const isBear = inst.manipulation_type === "BEAR_MANIPULATION";
        return (
          <div key={inst.symbol} className="fsp-kz-asset-card">
            <div className="fsp-kz-asset-header">
              <div>
                <div className="fsp-kz-asset-symbol">{inst.symbol}</div>
                <div className="fsp-kz-asset-session">NY Midnight OR</div>
              </div>
              <div className="fsp-kz-asset-price">{fmtPrice(inst.symbol, ltp)}</div>
            </div>
            
            <div className="fsp-kz-or-range">
              <div className="fsp-kz-or-row">
                <span className="fsp-kz-or-label">ORH</span>
                <span className="fsp-kz-or-value">{fmtPriceRaw(inst.symbol, orh)}</span>
              </div>
              <div className="fsp-kz-or-row">
                <span className="fsp-kz-or-label">ORL</span>
                <span className="fsp-kz-or-value">{fmtPriceRaw(inst.symbol, orl)}</span>
              </div>
            </div>

            {(isBull || isBear) && (
              <div className={`fsp-kz-manipulation ${isBull ? "bull" : "bear"}`}>
                <div className="fsp-kz-manipulation-title">
                  ⚡ {inst.manipulation_type?.replace(/_/g, " ")}
                </div>
                {(inst.action_steps || []).map((step, i) => (
                  <div key={i} className="fsp-kz-manipulation-step">
                    {step.replace(/^Step \d+:?\s*/i, "")}
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  </div>
));

// ═══════════════════════════════════════════════════════════════════════════════
// TAB 5 — LIQUIDITY
// ═══════════════════════════════════════════════════════════════════════════════

const LiqRow = memo(({ pool, symbol, isAbove }) => (
  <div className="fsp-liq-level-row">
    <span className="fsp-liq-price" style={{color: isAbove ? "#ef4444" : "#10b981"}}>
      {fmtPriceRaw(symbol, pool.price)}
    </span>
    <span className="fsp-liq-pct" style={{color: "var(--color-muted)"}}>
      {isAbove ? "+" : ""}{safeNum(pool.dist_pct, 0)}%
    </span>
    <div className="fsp-liq-badges">
      {(pool.tags?.includes("ROUND") || pool.tags?.includes("Round")) && <span className="fsp-liq-badge-round">ROUND</span>}
      {pool.tags?.includes("TESTED") ? <span className="fsp-liq-badge-tested">TESTED</span> : <span className="fsp-liq-badge-untested">UNTESTED</span>}
    </div>
  </div>
));

const LiquidityTab = memo(({ liqData, liqSymbol, setLiqSymbol }) => {
  const LIQ_SYMS = ["XAUUSD", "BTCUSD", "EURUSD", "GBPUSD"];
  return (
    <div className="fsp-tab-content">
      <div className="fsp-liq-symbol-tabs">
        {LIQ_SYMS.map(s => (
          <button key={s} className={`fsp-liq-symbol-btn ${liqSymbol === s ? "active" : ""}`} onClick={() => setLiqSymbol(s)}>
            {s}
          </button>
        ))}
      </div>
      <div className="fsp-liq-pool">
        <div className="fsp-liq-section-label">ABOVE — RESISTANCE LIQUIDITY</div>
        {[...(liqData.pools_above || [])].reverse().map((p, i) => <LiqRow key={`a${i}`} pool={p} symbol={liqSymbol} isAbove />)}
        
        <div className="fsp-liq-current-bar">
          <span className="fsp-liq-current-label">▶ CURRENT</span>
          <span>{fmtPrice(liqSymbol, liqData.ltp)}</span>
        </div>
        
        {(liqData.pools_below || []).map((p, i) => <LiqRow key={`b${i}`} pool={p} symbol={liqSymbol} isAbove={false} />)}
      </div>
    </div>
  );
});

// ═══════════════════════════════════════════════════════════════════════════════
// TAB 6 — MTF BIAS
// ═══════════════════════════════════════════════════════════════════════════════

const MTF_TFS = ["D1", "H4", "H1", "M15"];

const MtfCell = memo(({ val }) => {
  if (!val) return <div className="fsp-mtf-cell">—</div>;
  const upper = val.toUpperCase();
  let cls = "range";
  if (upper === "BULLISH") cls = "bull";
  else if (upper === "BEARISH") cls = "bear";
  return <div className="fsp-mtf-cell"><span className={`fsp-mtf-tf-badge ${cls}`}>{upper}</span></div>;
});

const BiasCell = memo(({ bias }) => {
  if (!bias) return <div className="fsp-mtf-cell">—</div>;
  const upper = bias.toUpperCase().replace(/_/g, " ");
  let cls = "neutral";
  if (upper.includes("STRONG BULL")) cls = "strong-bull";
  else if (upper.includes("BULL")) cls = "mild-bull";
  else if (upper.includes("STRONG BEAR")) cls = "strong-bear";
  else if (upper.includes("BEAR")) cls = "mild-bear";
  return <span className={`fsp-mtf-bias-badge ${cls}`}>{upper}</span>;
});

const MtfBiasTab = memo(({ mtfData, getLtp }) => (
  <div className="fsp-tab-content">
    <div className="fsp-mtf-table-wrap">
      <table className="fsp-mtf-table">
        <thead>
          <tr>
            <th>SYMBOL</th>
            {MTF_TFS.map(tf => <th key={tf} className="tf-header">{tf}</th>)}
            <th>BIAS</th>
            <th>ALIGN</th>
          </tr>
        </thead>
        <tbody>
          {(mtfData.bias_grid || []).map(row => {
            const firstDir = MTF_TFS.map(tf => (row[tf] || "").toUpperCase()).find(v => v === "BULLISH" || v === "BEARISH");
            const alignCount = firstDir ? MTF_TFS.filter(tf => (row[tf] || "").toUpperCase() === firstDir).length : 0;
            return (
              <tr key={row.symbol}>
                <td className="fsp-mtf-symbol-cell">
                  <div className="fsp-mtf-symbol-name">{row.symbol}</div>
                  <div className="fsp-mtf-symbol-price">{fmtPriceRaw(row.symbol, getLtp(row.symbol))}</div>
                </td>
                {MTF_TFS.map(tf => <td key={tf}><MtfCell val={row[tf]} /></td>)}
                <td><BiasCell bias={row.overall_bias} /></td>
                <td><AlignmentDots count={alignCount} color={row.overall_bias?.includes("BULL") ? "#10b981" : "#ef4444"} /></td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  </div>
));

// ═══════════════════════════════════════════════════════════════════════════════
// TAB 7 — SENTIMENT
// ═══════════════════════════════════════════════════════════════════════════════

const SentimentTab = memo(({ sentimentData }) => (
  <div className="fsp-tab-content">
    <div className="fsp-sentiment-grid">
      {Object.entries(sentimentData.cot || {}).map(([sym, cot]) => {
        const net = safeNum(cot.net_position, 0);
        const isLong = net > 0;
        const fillPct = Math.min(Math.abs(net) / 10, 100);
        return (
          <div key={sym} className="fsp-cot-card">
            <div className="fsp-cot-header">
              <span className="fsp-cot-symbol">{sym}</span>
            </div>
            <div className="fsp-cot-bar-group">
              <div className="fsp-cot-bar-row">
                <div className="fsp-cot-bar-label-row">
                  <span className="fsp-cot-bar-name">Institutional</span>
                  <span className="fsp-cot-bar-pct">{isLong ? Math.round(fillPct) : 0}% LONG</span>
                </div>
                <div className="fsp-cot-bar-track">
                  <div className="fsp-cot-bar-fill institutional" style={{ width: `${isLong ? fillPct : 0}%` }} />
                </div>
              </div>
              <div className="fsp-cot-bar-row">
                <div className="fsp-cot-bar-label-row">
                  <span className="fsp-cot-bar-name">Retail</span>
                  <span className="fsp-cot-bar-pct">{!isLong ? Math.round(fillPct) : 0}% SHORT</span>
                </div>
                <div className="fsp-cot-bar-track">
                  <div className="fsp-cot-bar-fill retail" style={{ width: `${!isLong ? fillPct : 0}%` }} />
                </div>
              </div>
            </div>
            <div className="fsp-cot-footer">
              <div className="fsp-cot-signal">
                <span className={`fsp-badge ${isLong ? "fsp-badge-bull" : "fsp-badge-bear"}`}>{isLong ? "▲ BULLISH" : "▼ BEARISH"}</span>
              </div>
            </div>
          </div>
        );
      })}

      <div className="fsp-fg-card">
        <div className="fsp-fg-title">⚡ CRYPTO FEAR & GREED</div>
        <div className="fsp-fg-value" style={{color: sentimentData.fear_greed?.value <= 44 ? "#ef4444" : "#10b981"}}>
          {sentimentData.fear_greed?.value || 50}
        </div>
        <div className="fsp-fg-label" style={{color: sentimentData.fear_greed?.value <= 44 ? "#ef4444" : "#10b981"}}>
          {sentimentData.fear_greed?.classification || "NEUTRAL"}
        </div>
      </div>
    </div>
  </div>
));

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN COMPONENT
// ═══════════════════════════════════════════════════════════════════════════════

const TABS = ["GRADES", "SWEEPS", "DISPLACEMENT", "KILL ZONES", "LIQUIDITY", "MTF BIAS", "SENTIMENT"];

export default function ForexSMCIntelligencePanel() {
  const [activeTab,     setActiveTab]    = useState("GRADES");
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

  useEffect(() => {
    const t = setInterval(() => {
      setUtcTime(new Date().toISOString().substr(11, 8));
      setLastUpdated(p => p + 1);
    }, 1000);
    return () => clearInterval(t);
  }, []);

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
    const i1 = setInterval(() => poll("/api/forex/smc/opening-range", setOrData, FB_OR), 5000);
    const i2 = setInterval(() => poll("/api/forex/smc/sweeps", setSweepsData, FB_SWEEPS), 5000);
    const i3 = setInterval(() => poll("/api/forex/smc/grades", setGradesData, FB_GRADES), 8000);
    const i4 = setInterval(() => poll("/api/forex/smc/displacement", setDispData, FB_DISPLACEMENT), 10000);
    const i5 = setInterval(() => poll("/api/forex/smc/mtf-bias", setMtfData, FB_MTF), 30000);
    const pollSentiment = () => poll("/api/forex/smc/sentiment", setSentimentData, FB_SENTIMENT);
    pollSentiment();
    const i6 = setInterval(pollSentiment, 120000);
    return () => [i1, i2, i3, i4, i5, i6].forEach(clearInterval);
  }, []);

  useEffect(() => {
    const run = async () => {
      const r = await apiFetch(`/api/forex/smc/liquidity-pools?symbol=${liqSymbol}`);
      if (r) setLiqData(r.data ?? FB_LIQUIDITY);
    };
    run();
    const t = setInterval(run, 60000);
    return () => clearInterval(t);
  }, [liqSymbol]);

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

  const getLtp = useCallback(sym => livePrices[sym]?.ltp || gradesData.grades.find(g => g.symbol === sym)?.ltp || "—", [livePrices, gradesData]);

  const xauLtp = getLtp("XAUUSD");
  const btcLtp = getLtp("BTCUSD");
  const vixVal = safeNum(sentimentData.vix?.value, null);

  return (
    <div className="forex-smc-panel">
      <div className="fsp-header">
        <span className="fsp-header-time">
          <span className="fsp-header-live-dot"></span>
          {utcTime} UTC LIVE
        </span>
        <div className="fsp-header-price">
          <span className="fsp-header-price-label">XAU</span>
          <span className="fsp-header-price-value">{fmtPrice("XAUUSD", xauLtp)}</span>
        </div>
        <div className="fsp-header-price">
          <span className="fsp-header-price-label">BTC</span>
          <span className="fsp-header-price-value">{fmtPrice("BTCUSD", btcLtp)}</span>
        </div>
        <span className="fsp-header-refresh">↻ {lastUpdated}s</span>
        {vixVal !== null && (
          <div className="fsp-header-vix">
            <span className="fsp-header-vix-label">VIX</span>
            <span className={`fsp-header-vix-value ${vixVal > 20 ? 'fsp-vix-high' : vixVal > 15 ? 'fsp-vix-mid' : 'fsp-vix-low'}`}>
              {vixVal.toFixed(2)}
            </span>
          </div>
        )}
      </div>

      <div className="fsp-tab-nav">
        {TABS.map(tab => (
          <button
            key={tab}
            className={`fsp-tab-btn ${activeTab === tab ? "active" : ""}`}
            onClick={() => setActiveTab(tab)}
          >
            {tab}
          </button>
        ))}
      </div>

      <div className="fsp-tab-content-wrapper">
        {activeTab === "GRADES" && <GradesTab gradesData={gradesData} getLtp={getLtp} gradeFilter={gradeFilter} setGradeFilter={setGradeFilter} />}
        {activeTab === "SWEEPS" && <SweepsTab sweepsData={sweepsData} livePrices={livePrices} sweepFilter={sweepFilter} setSweepFilter={setSweepFilter} showExpired={showExpired} setShowExpired={setShowExpired} />}
        {activeTab === "DISPLACEMENT" && <DisplacementTab dispData={dispData} />}
        {activeTab === "KILL ZONES" && <KillZonesTab orData={orData} getLtp={getLtp} />}
        {activeTab === "LIQUIDITY" && <LiquidityTab liqData={liqData} liqSymbol={liqSymbol} setLiqSymbol={setLiqSymbol} />}
        {activeTab === "MTF BIAS" && <MtfBiasTab mtfData={mtfData} getLtp={getLtp} />}
        {activeTab === "SENTIMENT" && <SentimentTab sentimentData={sentimentData} />}
      </div>
    </div>
  );
}
