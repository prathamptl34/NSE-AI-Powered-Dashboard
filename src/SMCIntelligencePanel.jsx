/**
 * SMCIntelligencePanel.jsx
 * Smart Money Concepts (SMC) Strategy Intelligence Section
 *
 * 7 sub-features:
 *  1. Opening Range Manipulation Scanner
 *  2. Session Kill Zone Timer  (pure frontend)
 *  3. PDH/PDL Liquidity Sweep Radar
 *  4. SMC Setup Quality Grader
 *  5. OI & PCR Integration
 *  6. Displacement Candle Detector
 *  7. Liquidity Pool Mapper
 */

import React, {
  useState, useEffect, useRef, useCallback, memo, useMemo
} from "react";
import "./SMCIntelligencePanel.css";

// ── Fetch helper ────────────────────────────────────────────────────────────
async function apiFetch(path) {
  try {
    let res;
    try {
      res = await fetch(path);
    } catch {
      res = await fetch(`http://127.0.0.1:8001${path}`);
    }
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

function formatINR(n) {
  if (n == null || n === 0) return "—";
  return Number(n).toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

// ══════════════════════════════════════════════════════════════════════════════
// SKELETON LOADER
// ══════════════════════════════════════════════════════════════════════════════
const SkeletonCard = memo(({ lines = 3 }) => (
  <div className="smc-card">
    <div className="smc-skeleton smc-skeleton-block" style={{ height: 20, marginBottom: 12, width: "40%" }} />
    {Array.from({ length: lines }).map((_, i) => (
      <div key={i} className="smc-skeleton smc-skeleton-line"
        style={{ width: i % 2 === 0 ? "80%" : "60%", animationDelay: `${i * 0.08}s` }} />
    ))}
  </div>
));

// ══════════════════════════════════════════════════════════════════════════════
// FEATURE 1 — OPENING RANGE MANIPULATION SCANNER
// ══════════════════════════════════════════════════════════════════════════════
const OpeningRangePanel = memo(() => {
  const [data, setData] = useState(null);

  const fetch = useCallback(async () => {
    const d = await apiFetch("/api/smc/opening-range");
    if (d) setData(d);
  }, []);

  useEffect(() => {
    fetch();
    const id = setInterval(fetch, 5000);
    return () => clearInterval(id);
  }, [fetch]);

  const renderInstrument = (symbol, info) => {
    if (!info || info.status === "NO_DATA") {
      return (
        <div key={symbol} className="smc-card" style={{ marginBottom: 14 }}>
          <div className="smc-card-title">{symbol}</div>
          <div className="or-idle">
            <span className="or-idle-dot" />
            No live data available for {symbol}
          </div>
        </div>
      );
    }

    const { opening_range_high: orh, opening_range_low: orl, ltp, ltp_position, recent_events = [] } = info;
    const rangeWidth = orh && orl ? orh - orl : 0;

    // Compute position of LTP dot on the bar (0–100%)
    let ltpPct = 50;
    if (orh && orl && rangeWidth > 0) {
      if (ltp_position === "ABOVE_ORH") ltpPct = 90;
      else if (ltp_position === "BELOW_ORL") ltpPct = 10;
      else ltpPct = ((ltp - orl) / rangeWidth) * 80 + 10;
      ltpPct = Math.max(5, Math.min(95, ltpPct));
    }

    // OR band visual: spans from 15% to 85% of bar width
    const orBandLeft = "15%";
    const orBandWidth = "70%";

    const activeEvent = recent_events[recent_events.length - 1];

    return (
      <div key={symbol} className="smc-card" style={{ marginBottom: 14 }}>
        <div className="smc-card-title">{symbol}</div>
        <div className="smc-card-subtitle">9:15–9:30 AM NSE Opening Range</div>

        {info.status === "MONITORING" ? (
          <div className="or-idle">
            <span className="or-idle-dot" />
            Monitoring opening range... Market opens at 9:15 AM IST
          </div>
        ) : (
          <>
            {/* Range Band Visual */}
            <div className="or-range-visual">
              {/* OR band */}
              <div className="or-band" style={{ left: orBandLeft, width: orBandWidth }}>
                <span className="or-label or-label-high">ORH ₹{formatINR(orh)}</span>
                <span className="or-label or-label-low">ORL ₹{formatINR(orl)}</span>
              </div>
              {/* LTP dot */}
              <div className="or-ltp-dot" style={{ left: `${ltpPct}%` }} title={`LTP ₹${formatINR(ltp)}`} />
            </div>

            {/* Live stats row */}
            <div style={{ display: "flex", gap: 16, marginTop: 12 }}>
              {[
                { label: "ORH", val: formatINR(orh), color: "var(--smc-rose)" },
                { label: "LTP", val: formatINR(ltp), color: "var(--smc-blue)" },
                { label: "ORL", val: formatINR(orl), color: "var(--smc-emerald)" },
              ].map(({ label, val, color }) => (
                <div key={label} style={{ textAlign: "center", flex: 1 }}>
                  <div style={{ fontFamily: "var(--smc-mono)", fontSize: 10, color: "var(--smc-text-dim)", marginBottom: 2 }}>{label}</div>
                  <div style={{ fontFamily: "var(--smc-mono)", fontSize: 15, fontWeight: 700, color }}>{val}</div>
                </div>
              ))}
            </div>

            {/* Manipulation Alert */}
            {activeEvent ? (
              <div className={`or-manipulation-alert ${activeEvent.type === "BULL_MANIPULATION" ? "bull" : "bear"}`}>
                <span className="or-alert-icon">
                  {activeEvent.type === "BULL_MANIPULATION" ? "🟢" : "🔴"}
                </span>
                <div>
                  <div className="or-alert-text">
                    {activeEvent.type === "BULL_MANIPULATION"
                      ? `⚡ ${symbol} — Fake Breakdown Detected at ₹${formatINR(activeEvent.trigger_price)} | Reversal Long Setup Active`
                      : `⚡ ${symbol} — Fake Breakout Detected at ₹${formatINR(activeEvent.trigger_price)} | Reversal Short Setup Active`}
                  </div>
                  <div style={{ fontSize: 11, color: "var(--smc-text-dim)", marginTop: 4 }}>
                    Detected at {activeEvent.timestamp}
                  </div>

                  {/* 3-step action card */}
                  <div className="or-action-steps" style={{ marginTop: 10 }}>
                    {[
                      activeEvent.type === "BULL_MANIPULATION"
                        ? "Wait for Market Structure Shift (MSS) on 5M chart"
                        : "Wait for bearish MSS and break of structure on 5M",
                      "Enter on FVG (Fair Value Gap) retracement after displacement candle",
                      "Close position before 2:30 PM IST to avoid closing risk",
                    ].map((step, i) => (
                      <div key={i} className="or-step">
                        <span className="or-step-num">0{i + 1}.</span>
                        {step}
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            ) : (
              <div className="or-idle" style={{ marginTop: 12 }}>
                <span className="or-idle-dot" />
                No manipulation detected — Opening range intact. Monitoring for fake breakouts.
              </div>
            )}
          </>
        )}
      </div>
    );
  };

  if (!data) return (
    <div className="smc-2col-grid">
      <SkeletonCard lines={4} />
      <SkeletonCard lines={4} />
    </div>
  );

  return (
    <div className="smc-2col-grid">
      {Object.entries(data.instruments || {}).map(([sym, info]) => renderInstrument(sym, info))}
    </div>
  );
});

// ══════════════════════════════════════════════════════════════════════════════
// FEATURE 2 — SESSION KILL ZONE TIMER (Pure Frontend)
// ══════════════════════════════════════════════════════════════════════════════

const KILL_ZONES = [
  { key: "opening",  start: [9, 15],  end: [9, 30],  label: "Opening Range Formation",    seg: "kz-seg-opening", zone: "kz-zone-opening", icon: "🔔", badgeColor: "var(--smc-amber)" },
  { key: "prime",    start: [9, 30],  end: [11, 0],  label: "Prime Intraday Window",      seg: "kz-seg-prime",   zone: "kz-zone-prime",   icon: "🎯", badgeColor: "var(--smc-emerald)" },
  { key: "dead",     start: [11, 0],  end: [13, 0],  label: "Dead Zone — Avoid Trading",  seg: "kz-seg-dead",    zone: "kz-zone-dead",    icon: "⛔", badgeColor: "var(--smc-text-dim)" },
  { key: "london",   start: [13, 30], end: [15, 0],  label: "London Overlap Kill Zone",   seg: "kz-seg-london",  zone: "kz-zone-london",  icon: "🇬🇧", badgeColor: "var(--smc-blue)" },
  { key: "closing",  start: [14, 30], end: [15, 30], label: "Options Exit Deadline ⚠️",   seg: "kz-seg-closing", zone: "kz-zone-closing", icon: "⏰", badgeColor: "var(--smc-rose)" },
];

const MARKET_START_MIN = 9 * 60 + 0;
const MARKET_END_MIN   = 15 * 60 + 30;
const MARKET_TOTAL_MIN = MARKET_END_MIN - MARKET_START_MIN;

function getISTMinutes() {
  const now = new Date();
  const ist = new Date(now.toLocaleString("en-US", { timeZone: "Asia/Kolkata" }));
  return ist.getHours() * 60 + ist.getMinutes() + ist.getSeconds() / 60;
}

function getActiveZone(mins) {
  for (const z of [...KILL_ZONES].reverse()) {
    const s = z.start[0] * 60 + z.start[1];
    const e = z.end[0] * 60 + z.end[1];
    if (mins >= s && mins < e) return z;
  }
  return { key: "closed", label: "Market Closed", seg: "", zone: "kz-zone-closed", icon: "🌙", badgeColor: "var(--smc-text-dim)" };
}

function formatMMSS(totalSeconds) {
  const m = Math.floor(Math.abs(totalSeconds) / 60);
  const s = Math.floor(Math.abs(totalSeconds) % 60);
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

const KillZoneTimer = memo(() => {
  const [istMins, setIstMins] = useState(getISTMinutes);
  const [tick, setTick]       = useState(0);

  useEffect(() => {
    const id = setInterval(() => {
      setIstMins(getISTMinutes());
      setTick(t => t + 1);
    }, 1000);
    return () => clearInterval(id);
  }, []);

  const activeZone = getActiveZone(istMins);

  // Compute remaining seconds in active zone
  const remainingSecs = useMemo(() => {
    if (!activeZone.end) return 0;
    const endMin = activeZone.end[0] * 60 + activeZone.end[1];
    return Math.max(0, (endMin - istMins) * 60);
  }, [activeZone, istMins]);

  // Needle position (0–100%)
  const needlePct = useMemo(() => {
    const clamped = Math.max(MARKET_START_MIN, Math.min(MARKET_END_MIN, istMins));
    return ((clamped - MARKET_START_MIN) / MARKET_TOTAL_MIN) * 100;
  }, [istMins]);

  // Build segments (non-overlapping windows for the bar)
  const segments = [
    { start: 9 * 60,       end: 9 * 60 + 15,  cls: "kz-seg-dead",    label: "" },
    { start: 9 * 60 + 15,  end: 9 * 60 + 30,  cls: "kz-seg-opening", label: "OR", zone: "opening" },
    { start: 9 * 60 + 30,  end: 11 * 60,       cls: "kz-seg-prime",   label: "PRIME", zone: "prime" },
    { start: 11 * 60,      end: 13 * 60,       cls: "kz-seg-dead",    label: "DEAD" },
    { start: 13 * 60,      end: 13 * 60 + 30,  cls: "kz-seg-dead",    label: "" },
    { start: 13 * 60 + 30, end: 14 * 60 + 30,  cls: "kz-seg-london",  label: "LONDON", zone: "london" },
    { start: 14 * 60 + 30, end: 15 * 60 + 30,  cls: "kz-seg-closing", label: "EXIT", zone: "closing" },
  ];

  return (
    <div className="smc-card">
      <div className="smc-card-title">Session Kill Zone Timer</div>
      <div className="smc-card-subtitle">Live NSE IST Trading Windows</div>

      <div className="kz-timeline-wrapper">
        <div className="kz-timeline-bar">
          {segments.map((seg, i) => {
            const widthPct = ((seg.end - seg.start) / MARKET_TOTAL_MIN) * 100;
            const isActive = activeZone.key === (seg.zone || "closed");
            return (
              <div
                key={i}
                className={`kz-segment ${seg.cls} ${isActive ? "kz-seg-active" : "kz-seg-inactive"}`}
                style={{ width: `${widthPct}%` }}
              >
                <span className="kz-segment-label">{seg.label}</span>
              </div>
            );
          })}
          {/* Live needle */}
          <div className="kz-needle" style={{ left: `${needlePct}%` }} />
        </div>

        <div className="kz-time-labels">
          <span>9:00</span><span>9:30</span><span>11:00</span>
          <span>13:00</span><span>13:30</span><span>14:30</span><span>15:30</span>
        </div>
      </div>

      {/* Active zone badge */}
      <div className={`kz-active-zone ${activeZone.zone}`}>
        <div className="kz-zone-info">
          <div className="kz-zone-name" style={{ color: activeZone.badgeColor }}>
            {activeZone.label}
          </div>
          {activeZone.key !== "closed" && remainingSecs > 0 && (
            <div className="kz-zone-countdown">
              Time remaining:{" "}
              <span className="kz-countdown-value" style={{ color: activeZone.badgeColor }}>
                {formatMMSS(remainingSecs)}
              </span>
            </div>
          )}
        </div>
        <div className="kz-zone-icon">{activeZone.icon}</div>
      </div>

      {/* Warning banners */}
      {activeZone.key === "dead" && (
        <div className="kz-warning-banner kz-warning-dead">
          🚫 Dead Zone Active — High probability of false signals. Avoid new entries.
        </div>
      )}
      {activeZone.key === "closing" && (
        <div className="kz-warning-banner kz-warning-closing">
          ⚠️ Options Exit Deadline approaching — Close open options positions now to avoid theta decay.
        </div>
      )}
    </div>
  );
});

// ══════════════════════════════════════════════════════════════════════════════
// FEATURE 3 — PDH/PDL LIQUIDITY SWEEP RADAR
// ══════════════════════════════════════════════════════════════════════════════
const SweepRadar = memo(() => {
  const [data, setData] = useState(null);

  const fetch = useCallback(async () => {
    const d = await apiFetch("/api/smc/sweeps");
    if (d) setData(d);
  }, []);

  useEffect(() => {
    fetch();
    const id = setInterval(fetch, 5000);
    return () => clearInterval(id);
  }, [fetch]);

  const sweepTypeClass = (t) =>
    t === "PDH_SWEEP" || t === "PWH_SWEEP" ? "sweep-row-high" : "sweep-row-low";
  const sweepBadgeClass = (t) =>
    t === "PDH_SWEEP" ? "badge-pdh" : t === "PDL_SWEEP" ? "badge-pdl" : t === "PWH_SWEEP" ? "badge-pwh" : "badge-pwl";
  const statusBadgeClass = (s) =>
    s === "ACTIVE" ? "status-active" : s === "CONFIRMED" ? "status-confirmed" : "status-failed";

  if (!data) return <SkeletonCard lines={5} />;

  const sweeps = data.sweeps || [];

  return (
    <div className="smc-card">
      <div className="smc-card-title">PDH/PDL Liquidity Sweep Radar</div>
      <div className="smc-card-subtitle">
        {data.active_count > 0
          ? `${data.active_count} Active Sweep${data.active_count > 1 ? "s" : ""} Detected`
          : "Monitoring 22 instruments for intrabar liquidity sweeps"}
      </div>

      {sweeps.length === 0 ? (
        <div className="smc-empty-state">
          <span className="smc-empty-icon">🔍</span>
          No sweeps detected — Monitoring PDH/PDL levels across 22 instruments
        </div>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table className="smc-table">
            <thead>
              <tr>
                <th>Symbol</th>
                <th>Level</th>
                <th>Level Price</th>
                <th>Wick Extreme</th>
                <th>Sweep Size</th>
                <th>Status</th>
                <th>Time</th>
              </tr>
            </thead>
            <tbody>
              {sweeps.slice(0, 10).map((s, i) => (
                <tr
                  key={i}
                  className={sweepTypeClass(s.sweep_type)}
                  title="A liquidity sweep occurs when price wicks beyond a key level to hunt stop-losses, then reverses — signalling a high-probability SMC reversal entry."
                >
                  <td><span className="sweep-symbol">{s.symbol}</span></td>
                  <td><span className={`sweep-type-badge ${sweepBadgeClass(s.sweep_type)}`}>{s.sweep_type}</span></td>
                  <td><span className="sweep-mono">₹{formatINR(s.level_price)}</span></td>
                  <td><span className="sweep-mono">₹{formatINR(s.wick_extreme)}</span></td>
                  <td><span className="sweep-mono">{formatINR(s.sweep_magnitude)} pts</span></td>
                  <td><span className={`status-badge ${statusBadgeClass(s.status)}`}>{s.status}</span></td>
                  <td style={{ fontSize: 10, color: "var(--smc-text-dim)", fontFamily: "var(--smc-mono)" }}>{s.sweep_time}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div style={{ marginTop: 12, fontSize: 11, color: "var(--smc-text-dim)", fontFamily: "var(--smc-mono)" }}>
        ↻ Auto-refresh every 5s · Last: {data.timestamp}
      </div>
    </div>
  );
});

// ══════════════════════════════════════════════════════════════════════════════
// FEATURE 4 — SMC SETUP QUALITY GRADER
// ══════════════════════════════════════════════════════════════════════════════

const GaugeArc = memo(({ score, grade }) => {
  const radius   = 40;
  const circ     = 2 * Math.PI * radius;
  const arc      = circ * 0.75;  // 270° sweep
  const dashoffset = arc - (score / 100) * arc;

  const gradeClass = grade === "A+" ? "gauge-aplus" : grade === "A" ? "gauge-a" : grade === "B" ? "gauge-b" : "gauge-notrade";
  const gradeColor = grade === "A+" ? "var(--smc-emerald)" : grade === "A" ? "var(--smc-blue)" : grade === "B" ? "var(--smc-amber)" : "var(--smc-text-dim)";

  return (
    <div className="smc-gauge-wrapper">
      <svg className="smc-gauge-svg" viewBox="0 0 100 100">
        <circle className="smc-gauge-bg" cx="50" cy="50" r={radius}
          strokeDasharray={`${arc} ${circ - arc}`}
          strokeDashoffset={-arc * 0.125}
          transform="rotate(135 50 50)"
        />
        <circle
          className={`smc-gauge-arc ${gradeClass}`}
          cx="50" cy="50" r={radius}
          strokeDasharray={`${arc} ${circ - arc}`}
          strokeDashoffset={-arc * 0.125 + dashoffset}
          transform="rotate(135 50 50)"
          style={{ transition: "stroke-dashoffset 1.2s cubic-bezier(0.4,0,0.2,1)" }}
        />
      </svg>
      <div className="smc-gauge-score">
        <div className="smc-score-number" style={{ color: gradeColor }}>{score}</div>
        <div className="smc-score-label">/ 100</div>
      </div>
    </div>
  );
});

const SetupGraderCard = memo(({ setup }) => {
  const { symbol, score, grade, direction, factors_met = [], factors_missing = [], recommendation, change_pct } = setup;

  const badgeClass = grade === "A+" ? "grade-aplus" : grade === "A" ? "grade-a" : grade === "B" ? "grade-b" : "grade-notrade";

  return (
    <div className="smc-grade-card">
      <div className="smc-grade-card-header">
        <div>
          <div className="smc-grade-symbol">{symbol}</div>
          <div style={{ fontSize: 11, fontFamily: "var(--smc-mono)", color: change_pct >= 0 ? "var(--smc-emerald)" : "var(--smc-rose)", marginTop: 2 }}>
            {change_pct >= 0 ? "+" : ""}{change_pct?.toFixed(2)}%
          </div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 6 }}>
          <span className={`smc-grade-badge ${badgeClass}`}>{grade}</span>
          <span className={`smc-grade-direction ${direction === "LONG" ? "dir-long" : "dir-short"}`}>
            {direction === "LONG" ? "↑ LONG" : "↓ SHORT"}
          </span>
        </div>
      </div>

      <GaugeArc score={score} grade={grade} />

      {/* Factor checklist */}
      <div className="smc-factors">
        {factors_met.map((f, i) => (
          <div key={`m${i}`} className="smc-factor-row">
            <span className="factor-check">✓</span>
            <span>{f}</span>
          </div>
        ))}
        {factors_missing.map((f, i) => (
          <div key={`x${i}`} className="smc-factor-row" style={{ opacity: 0.55 }}>
            <span className="factor-x">✗</span>
            <span>{f}</span>
          </div>
        ))}
      </div>

      {recommendation && (
        <div className="smc-recommendation">{recommendation}</div>
      )}
    </div>
  );
});

const SetupGrader = memo(() => {
  const [data, setData]           = useState(null);
  const [activeFilter, setFilter] = useState("ALL");

  const fetch = useCallback(async () => {
    const d = await apiFetch("/api/smc/grades");
    if (d) setData(d);
  }, []);

  useEffect(() => {
    fetch();
    const id = setInterval(fetch, 30000);
    return () => clearInterval(id);
  }, [fetch]);

  const grades    = data?.grades || [];
  const filters   = ["ALL", "A+ Only", "Long Only", "Short Only"];

  const filtered = grades.filter((g) => {
    if (activeFilter === "A+ Only")   return g.grade === "A+";
    if (activeFilter === "Long Only")  return g.direction === "LONG";
    if (activeFilter === "Short Only") return g.direction === "SHORT";
    return true;
  }).slice(0, 6);

  if (!data) return <SkeletonCard lines={8} />;

  return (
    <div className="smc-card">
      <div className="smc-card-title">SMC Setup Quality Grader</div>
      <div className="smc-card-subtitle">6-Factor Confluence Scoring · Refreshes every 30s</div>

      <div className="smc-filter-row">
        {filters.map((f) => (
          <button
            key={f}
            className={`smc-filter-btn ${activeFilter === f ? "active" : ""}`}
            onClick={() => setFilter(f)}
          >
            {f}
          </button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <div className="smc-empty-state">
          <span className="smc-empty-icon">📊</span>
          No setups match the current filter
        </div>
      ) : (
        <div className="smc-grade-grid">
          {filtered.map((setup) => (
            <SetupGraderCard key={setup.symbol} setup={setup} />
          ))}
        </div>
      )}

      {data.timestamp && (
        <div style={{ marginTop: 14, fontSize: 11, color: "var(--smc-text-dim)", fontFamily: "var(--smc-mono)" }}>
          ↻ Last updated: {data.timestamp}
        </div>
      )}
    </div>
  );
});

// ══════════════════════════════════════════════════════════════════════════════
// FEATURE 5 — OI & PCR INTEGRATION
// ══════════════════════════════════════════════════════════════════════════════
const PCRGauge = memo(({ pcr }) => {
  if (pcr == null) return <div className="smc-skeleton" style={{ height: 24, borderRadius: 12 }} />;

  const clampedPcr = Math.max(0, Math.min(2, pcr));
  const pct = (clampedPcr / 2) * 100;

  const getSentiment = (p) => {
    if (p < 0.7) return { label: "Bearish", cls: "pcr-bearish", color: "var(--smc-rose)", numCls: "bearish" };
    if (p < 1.2) return { label: "Neutral", cls: "pcr-neutral", color: "var(--smc-amber)", numCls: "neutral" };
    return { label: "Bullish", cls: "pcr-bullish", color: "var(--smc-emerald)", numCls: "bullish" };
  };
  const sentiment = getSentiment(pcr);

  return (
    <>
      <div className="oi-pcr-value-row">
        <span className={`oi-pcr-number ${sentiment.numCls}`}>{pcr.toFixed(2)}</span>
        <span style={{ fontFamily: "var(--smc-mono)", fontSize: 12, color: sentiment.color }}>{sentiment.label}</span>
      </div>
      <div className="oi-pcr-gauge-track">
        <div className={`oi-pcr-fill ${sentiment.cls}`} style={{ width: `${pct}%` }} />
        <div className="oi-pcr-pointer" style={{ left: `${pct}%` }} />
      </div>
      <div className="oi-pcr-labels">
        <span style={{ color: "var(--smc-rose)" }}>0.0 Bearish</span>
        <span>0.7</span>
        <span>1.2</span>
        <span style={{ color: "var(--smc-emerald)" }}>Bullish 2.0</span>
      </div>
    </>
  );
});

const OICard = memo(({ symbol, info }) => {
  if (!info) return <SkeletonCard lines={5} />;

  const { pcr, max_pain, call_wall, put_wall, oi_divergence, top_ce_strikes = [], top_pe_strikes = [], ai_bias } = info;

  return (
    <div className="smc-card">
      <div className="smc-card-title">{symbol}</div>
      <div className="smc-card-subtitle">Option Chain Intelligence</div>

      {info.error ? (
        <div className="smc-empty-state">
          <span className="smc-empty-icon">📡</span>
          NSE data temporarily unavailable. Will retry on next refresh.
        </div>
      ) : (
        <>
          <PCRGauge pcr={pcr} />

          <div style={{ marginTop: 14 }}>
            {[
              { label: "Options Max Pain Strike", val: max_pain ? `₹${formatINR(max_pain)}` : "—" },
              {
                label: "Call Wall (Resistance)",
                val: <span className="oi-wall-badge call-wall">₹{formatINR(call_wall)}</span>,
              },
              {
                label: "Put Wall (Support)",
                val: <span className="oi-wall-badge put-wall">₹{formatINR(put_wall)}</span>,
              },
              { label: "AI Sector Bias", val: <span style={{ fontFamily: "var(--smc-mono)", fontSize: 12, color: ai_bias === "BULLISH" ? "var(--smc-emerald)" : ai_bias === "BEARISH" ? "var(--smc-rose)" : "var(--smc-amber)" }}>{ai_bias || "NEUTRAL"}</span> },
            ].map(({ label, val }) => (
              <div key={label} className="oi-stat-row">
                <span className="oi-stat-label">{label}</span>
                <span className="oi-stat-value">{val}</span>
              </div>
            ))}
          </div>

          {/* Top OI Buildup */}
          {(top_ce_strikes.length > 0 || top_pe_strikes.length > 0) && (
            <div style={{ marginTop: 14 }}>
              <div style={{ fontFamily: "var(--smc-mono)", fontSize: 10, color: "var(--smc-text-dim)", marginBottom: 6, letterSpacing: "0.08em", textTransform: "uppercase" }}>
                Top OI Buildup
              </div>
              <table className="oi-mini-table">
                <thead>
                  <tr>
                    <th>Type</th>
                    <th>Strike</th>
                    <th>OI Change</th>
                  </tr>
                </thead>
                <tbody>
                  {top_ce_strikes.slice(0, 3).map((s, i) => (
                    <tr key={`ce${i}`}>
                      <td style={{ color: "var(--smc-rose)", fontWeight: 600, fontSize: 10, fontFamily: "var(--smc-mono)" }}>CE ↑</td>
                      <td style={{ fontFamily: "var(--smc-mono)" }}>₹{formatINR(s.strike)}</td>
                      <td style={{ color: "var(--smc-rose)", fontFamily: "var(--smc-mono)", fontSize: 11 }}>+{s.oi_change?.toLocaleString()}</td>
                    </tr>
                  ))}
                  {top_pe_strikes.slice(0, 3).map((s, i) => (
                    <tr key={`pe${i}`}>
                      <td style={{ color: "var(--smc-emerald)", fontWeight: 600, fontSize: 10, fontFamily: "var(--smc-mono)" }}>PE ↑</td>
                      <td style={{ fontFamily: "var(--smc-mono)" }}>₹{formatINR(s.strike)}</td>
                      <td style={{ color: "var(--smc-emerald)", fontFamily: "var(--smc-mono)", fontSize: 11 }}>+{s.oi_change?.toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {oi_divergence && (
            <div className="oi-divergence-warning">
              ⚠️ OI Divergence — AI bias conflicts with options positioning. Reduce position size and wait for clarity.
            </div>
          )}
        </>
      )}
    </div>
  );
});

const OIPCRPanel = memo(() => {
  const [data, setData]    = useState(null);
  const [countdown, setCd] = useState(180);

  const fetch = useCallback(async () => {
    const d = await apiFetch("/api/smc/oi-pcr");
    if (d) { setData(d); setCd(d.next_refresh || 180); }
  }, []);

  useEffect(() => {
    fetch();
    const fetchId = setInterval(fetch, 180000); // 3 min
    const cdId    = setInterval(() => setCd((c) => Math.max(0, c - 1)), 1000);
    return () => { clearInterval(fetchId); clearInterval(cdId); };
  }, [fetch]);

  return (
    <div>
      <div className="oi-cards-row">
        <OICard symbol="NIFTY"     info={data?.indices?.NIFTY} />
        <OICard symbol="BANKNIFTY" info={data?.indices?.BANKNIFTY} />
      </div>
      <div className="oi-refresh-timer">
        Next OI refresh in: {formatMMSS(countdown)}
      </div>
    </div>
  );
});

// ══════════════════════════════════════════════════════════════════════════════
// FEATURE 6 — DISPLACEMENT CANDLE DETECTOR
// ══════════════════════════════════════════════════════════════════════════════
const DisplacementFeed = memo(() => {
  const [data, setData] = useState(null);

  const fetch = useCallback(async () => {
    const d = await apiFetch("/api/smc/displacement");
    if (d) setData(d);
  }, []);

  useEffect(() => {
    fetch();
    const id = setInterval(fetch, 15000);
    return () => clearInterval(id);
  }, [fetch]);

  if (!data) return <SkeletonCard lines={6} />;

  const alerts = data.alerts || [];

  return (
    <div className="smc-card">
      <div className="smc-card-title">Displacement Candle Alerts</div>
      <div className="smc-card-subtitle">
        5M Timeframe · {data.mss_count > 0 ? `${data.mss_count} MSS Confirmed` : "Monitoring All Instruments"}
      </div>

      {alerts.length === 0 ? (
        <div className="smc-empty-state">
          <span className="smc-empty-icon">🕯️</span>
          No displacement candles detected in the last 30 minutes
        </div>
      ) : (
        <div className="displacement-feed">
          {alerts.map((a, i) => (
            <div
              key={i}
              className={`displacement-row ${a.mss_confirmed ? "mss-confirmed" : "no-mss"}`}
              style={{ animationDelay: `${i * 0.05}s` }}
            >
              <span className="disp-symbol">{a.symbol}</span>
              <span className="disp-tf">{a.timeframe}</span>
              <span className={`disp-arrow ${a.direction === "BULLISH" ? "bull" : "bear"}`}>
                {a.direction === "BULLISH" ? "↑" : "↓"}
              </span>
              <span className="disp-ratio">{a.body_ratio}× avg</span>
              <span className={`mss-badge ${a.mss_confirmed ? "confirmed" : "displacement-only"}`}>
                {a.mss_confirmed ? "✓ MSS CONFIRMED" : "DISPLACEMENT ONLY"}
              </span>
              <span className="disp-time">{a.candle_time}</span>
            </div>
          ))}
        </div>
      )}

      <div className="displacement-legend">
        <strong style={{ color: "var(--smc-emerald)" }}>MSS Confirmed</strong> = Market Structure Shift with sweep precursor — highest probability reversal. Enter on FVG retracement after confirmation.{" "}
        <span style={{ color: "var(--smc-amber)" }}>Displacement Only</span> = Strong move without prior sweep — wait for additional confluence before entering.
      </div>
    </div>
  );
});

// ══════════════════════════════════════════════════════════════════════════════
// FEATURE 7 — LIQUIDITY POOL MAPPER
// ══════════════════════════════════════════════════════════════════════════════
const LP_SYMBOLS = [
  "BANKNIFTY", "NIFTY", "RELIANCE", "HDFCBANK", "INFY", "TCS",
  "ICICIBANK", "SBIN", "BHARTIARTL", "KOTAKBANK", "TATASTEEL",
  "BAJFINANCE", "SUNPHARMA", "AXISBANK", "WIPRO",
];

const LiquidityPoolMapper = memo(() => {
  const [symbol, setSymbol] = useState("BANKNIFTY");
  const [data, setData]     = useState(null);
  const [loading, setLoading] = useState(false);

  const fetch = useCallback(async (sym) => {
    setLoading(true);
    const d = await apiFetch(`/api/smc/liquidity-pools?symbol=${sym}`);
    if (d) setData(d);
    setLoading(false);
  }, []);

  useEffect(() => {
    fetch(symbol);
    const id = setInterval(() => fetch(symbol), 300000);
    return () => clearInterval(id);
  }, [symbol, fetch]);

  const handleSymbolChange = (e) => {
    setSymbol(e.target.value);
    setData(null);
  };

  const above  = data?.pools_above  || [];
  const below  = data?.pools_below  || [];
  const cp     = data?.current_price;
  const nearest_above = data?.nearest_above;
  const nearest_below = data?.nearest_below;
  const summary = data?.summary || {};

  return (
    <div className="smc-card">
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
        <div className="smc-card-title">Liquidity Pool Map</div>
        <select className="lp-symbol-select" value={symbol} onChange={handleSymbolChange}>
          {LP_SYMBOLS.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
      </div>
      <div className="smc-card-subtitle">
        Equal Highs / Equal Lows · 10-Day 1H Scan · 5 min cache
      </div>

      {(loading || !data) ? (
        <>
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="smc-skeleton" style={{ height: 48, borderRadius: 10, marginBottom: 6, animationDelay: `${i * 0.08}s` }} />
          ))}
        </>
      ) : data.error ? (
        <div className="smc-empty-state">
          <span className="smc-empty-icon">📉</span>
          {data.error}
        </div>
      ) : (
        <div className="lp-ladder">
          {/* Pools ABOVE current price */}
          {above.length > 0 ? (
            <>
              {above.map((pool, i) => (
                <div
                  key={i}
                  className={`lp-pool-line above ${nearest_above?.pool_price === pool.pool_price ? "nearest-above" : ""}`}
                  style={{ animationDelay: `${i * 0.05}s` }}
                >
                  <span className="lp-pool-price" style={{ color: "var(--smc-rose)" }}>
                    ₹{formatINR(pool.pool_price)}
                  </span>
                  <span className="lp-pool-dist">+{pool.distance_pct}%</span>
                  <div className="lp-pool-tags">
                    {pool.round_number_confluence && <span className="lp-tag lp-tag-round">Round ₹{formatINR(pool.nearest_round_number)}</span>}
                    {pool.untested && <span className="lp-tag lp-tag-untested">Untested</span>}
                    {!pool.untested && <span className="lp-tag lp-tag-partial">Tested ×{pool.touch_count}</span>}
                  </div>
                  {nearest_above?.pool_price === pool.pool_price && (
                    <span className="lp-draw-label lp-draw-above">Nearest Draw on Liquidity ↑</span>
                  )}
                </div>
              ))}
            </>
          ) : (
            <div style={{ color: "var(--smc-text-dim)", fontSize: 12, padding: "10px 0", textAlign: "center" }}>No equal highs pools detected above</div>
          )}

          {/* Current price line */}
          <div className="lp-separator">Current Price</div>
          <div className="lp-current-price-line">
            <span className="lp-current-label">LTP</span>
            <span className="lp-current-value">₹{formatINR(cp)}</span>
            <span style={{ fontFamily: "var(--smc-mono)", fontSize: 11, color: "var(--smc-text-dim)", marginLeft: "auto" }}>{symbol}</span>
          </div>
          <div className="lp-separator" />

          {/* Pools BELOW current price */}
          {below.length > 0 ? (
            <>
              {below.map((pool, i) => (
                <div
                  key={i}
                  className={`lp-pool-line below ${nearest_below?.pool_price === pool.pool_price ? "nearest-below" : ""}`}
                  style={{ animationDelay: `${i * 0.05}s` }}
                >
                  <span className="lp-pool-price" style={{ color: "var(--smc-emerald)" }}>
                    ₹{formatINR(pool.pool_price)}
                  </span>
                  <span className="lp-pool-dist">-{pool.distance_pct}%</span>
                  <div className="lp-pool-tags">
                    {pool.round_number_confluence && <span className="lp-tag lp-tag-round">Round ₹{formatINR(pool.nearest_round_number)}</span>}
                    {pool.untested && <span className="lp-tag lp-tag-untested">Untested</span>}
                    {!pool.untested && <span className="lp-tag lp-tag-partial">Tested ×{pool.touch_count}</span>}
                  </div>
                  {nearest_below?.pool_price === pool.pool_price && (
                    <span className="lp-draw-label lp-draw-below">Nearest Draw on Liquidity ↓</span>
                  )}
                </div>
              ))}
            </>
          ) : (
            <div style={{ color: "var(--smc-text-dim)", fontSize: 12, padding: "10px 0", textAlign: "center" }}>No equal lows pools detected below</div>
          )}

          {/* Summary footer */}
          {(summary.above_count != null) && (
            <div className="lp-summary">
              <span>Active Liquidity Targets:</span>
              <strong>{summary.above_count} above</strong>
              <span>|</span>
              <strong>{summary.below_count} below</strong>
              {summary.nearest_above_price && (
                <><span>| Next target:</span> <strong style={{ color: "var(--smc-rose)" }}>₹{formatINR(summary.nearest_above_price)} ({summary.nearest_above_pct}% away)</strong></>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
});

// ══════════════════════════════════════════════════════════════════════════════
// ROOT PANEL — assembles all 7 sections
// ══════════════════════════════════════════════════════════════════════════════
export default function SMCIntelligencePanel() {
  return (
    <div className="smc-panel-root">
      {/* ── Sticky Header ──────────────────────────────────────────────────── */}
      <div className="smc-sticky-header">
        <span className="smc-header-icon">🧠</span>
        <div>
          <div className="smc-header-title">SMC Intelligence</div>
          <div className="smc-header-subtitle">
            Institutional Smart Money Concepts — Live Strategy Engine
          </div>
        </div>
        <div className="smc-live-badge">
          <span className="smc-live-dot" />
          LIVE
        </div>
      </div>

      {/* ── Feature 1: Opening Range ───────────────────────────────────────── */}
      <div className="smc-section">
        <div className="smc-section-label">Opening Range Manipulation</div>
        <OpeningRangePanel />
      </div>

      {/* ── Feature 2: Kill Zone Timer ─────────────────────────────────────── */}
      <div className="smc-section">
        <div className="smc-section-label">Session Kill Zones</div>
        <KillZoneTimer />
      </div>

      {/* ── Feature 3: Sweep Radar ─────────────────────────────────────────── */}
      <div className="smc-section">
        <div className="smc-section-label">PDH / PDL Liquidity Sweep Radar</div>
        <SweepRadar />
      </div>

      {/* ── Feature 4: Setup Grader ────────────────────────────────────────── */}
      <div className="smc-section">
        <div className="smc-section-label">SMC Setup Quality Grader</div>
        <SetupGrader />
      </div>

      {/* ── Feature 5: OI & PCR ────────────────────────────────────────────── */}
      <div className="smc-section">
        <div className="smc-section-label">OI & PCR Integration</div>
        <OIPCRPanel />
      </div>

      {/* ── Feature 6: Displacement ────────────────────────────────────────── */}
      <div className="smc-section">
        <div className="smc-section-label">Displacement Candle Alerts</div>
        <DisplacementFeed />
      </div>

      {/* ── Feature 7: Liquidity Pool Map ──────────────────────────────────── */}
      <div className="smc-section">
        <div className="smc-section-label">Liquidity Pool Mapper</div>
        <LiquidityPoolMapper />
      </div>
    </div>
  );
}
