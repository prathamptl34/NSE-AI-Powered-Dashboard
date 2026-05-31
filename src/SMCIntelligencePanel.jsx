/**
 * SMCIntelligencePanel.jsx  v2.0
 * Complete audit + bug fix + UI polish pass.
 *
 * KEY FIX: All useState initialized with static fallback data.
 * The UI NEVER stays in skeleton state — demo data loads instantly,
 * real data replaces it when the API responds.
 */

import React, {
  useState, useEffect, useCallback, memo, useMemo
} from "react";
import "./SMCIntelligencePanel.css";

// ─── API FETCH ───────────────────────────────────────────────────────────────
async function apiFetch(path) {
  try {
    let res;
    try { res = await fetch(path); }
    catch { res = await fetch(`http://127.0.0.1:8001${path}`); }
    if (!res.ok) return null;
    return await res.json();
  } catch { return null; }
}

function formatINR(n) {
  if (n == null || n === 0) return "—";
  return Number(n).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatMMSS(secs) {
  const m = Math.floor(Math.abs(secs) / 60);
  const s = Math.floor(Math.abs(secs) % 60);
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

// ─── STATIC FALLBACK DATA ────────────────────────────────────────────────────
// Used as initial state so components render immediately without skeletons.

const FB_OR = {
  instruments: {
    NIFTY: {
      status: "ACTIVE", symbol: "NIFTY", ltp: 24318.75,
      opening_range_high: 24380.00, opening_range_low: 24245.50,
      range_width: 134.50, ltp_position: "INSIDE",
      recent_events: [{
        symbol: "NIFTY", type: "BULL_MANIPULATION",
        trigger_price: 24238.60, opening_range_high: 24380.00,
        opening_range_low: 24245.50, timestamp: "09:28:14 AM IST", confirmation: true,
      }],
    },
    BANKNIFTY: {
      status: "ACTIVE", symbol: "BANKNIFTY", ltp: 52105.00,
      opening_range_high: 52250.00, opening_range_low: 51960.00,
      range_width: 290.00, ltp_position: "INSIDE", recent_events: [],
    },
  },
  active_alerts: [],
  timestamp: "Demo Mode",
};

const FB_SWEEPS = {
  sweeps: [
    { symbol: "BANKNIFTY", sweep_type: "PDH_SWEEP", level_price: 52250.00, wick_extreme: 52318.50, sweep_magnitude: 68.50, sweep_time: "10:42 AM", status: "CONFIRMED" },
    { symbol: "NIFTY",     sweep_type: "PDL_SWEEP", level_price: 24180.00, wick_extreme: 24163.25, sweep_magnitude: 16.75, sweep_time: "09:52 AM", status: "CONFIRMED" },
    { symbol: "RELIANCE",  sweep_type: "PDH_SWEEP", level_price: 2940.50,  wick_extreme: 2948.75,  sweep_magnitude: 8.25,  sweep_time: "11:14 AM", status: "ACTIVE" },
    { symbol: "HDFCBANK",  sweep_type: "PWL_SWEEP", level_price: 1680.00,  wick_extreme: 1672.30,  sweep_magnitude: 7.70,  sweep_time: "13:38 PM", status: "FAILED" },
    { symbol: "INFY",      sweep_type: "PDL_SWEEP", level_price: 1515.00,  wick_extreme: 1509.80,  sweep_magnitude: 5.20,  sweep_time: "14:05 PM", status: "ACTIVE" },
  ],
  active_count: 3,
  timestamp: "Demo Mode",
};

const FB_GRADES = {
  grades: [
    { symbol: "TCS",      score: 91, grade: "A+", direction: "SHORT", change_pct: -1.82, factors_met: ["HTF Trend Aligned", "Liquidity Sweep Detected", "Volume Confirmation", "Kill Zone Active", "AI Sector Bias"], factors_missing: ["Displacement Candle"], recommendation: "A+ Setup — Wait for FVG retracement entry on 5M short continuation" },
    { symbol: "BANKNIFTY",score: 87, grade: "A+", direction: "LONG",  change_pct:  1.44, factors_met: ["HTF Trend Aligned", "Liquidity Sweep Detected", "Volume Confirmation", "Kill Zone Active"], factors_missing: ["AI Sector Bias", "Displacement Candle"], recommendation: "A+ Setup — Wait for FVG retracement entry on 5M long continuation" },
    { symbol: "RELIANCE", score: 72, grade: "A",  direction: "LONG",  change_pct:  0.96, factors_met: ["HTF Trend Aligned", "Volume Confirmation", "Kill Zone Active"], factors_missing: ["Liquidity Sweep Detected", "AI Sector Bias", "Displacement Candle"], recommendation: "A Setup — Good confluence. Enter on confirmed MSS with tight SL" },
    { symbol: "NIFTY",    score: 65, grade: "A",  direction: "SHORT", change_pct: -0.63, factors_met: ["HTF Trend Aligned", "Liquidity Sweep Detected", "AI Sector Bias"], factors_missing: ["Volume Confirmation", "Kill Zone Active", "Displacement Candle"], recommendation: "A Setup — Good confluence. Enter on confirmed MSS with tight SL" },
    { symbol: "HDFCBANK", score: 45, grade: "B",  direction: "SHORT", change_pct: -0.42, factors_met: ["Volume Confirmation", "Kill Zone Active"], factors_missing: ["HTF Trend Aligned", "Liquidity Sweep Detected", "AI Sector Bias", "Displacement Candle"], recommendation: "B Setup — Partial confluence. Reduce position size" },
    { symbol: "INFY",     score: 28, grade: "NO TRADE", direction: "LONG", change_pct: 0.28, factors_met: ["HTF Trend Aligned"], factors_missing: ["Liquidity Sweep Detected", "Volume Confirmation", "Kill Zone Active", "AI Sector Bias", "Displacement Candle"], recommendation: "NO TRADE — Insufficient confluence. Sit out." },
  ],
  top_setup: null,
  timestamp: "Demo Mode",
};

const FB_OI = {
  indices: {
    NIFTY: {
      symbol: "NIFTY", pcr: 1.18, max_pain: 24200, call_wall: 24500, put_wall: 24000,
      underlying: 24318.75, oi_divergence: false, ai_bias: "NEUTRAL",
      top_ce_strikes: [
        { strike: 24500, oi: 6420000, oi_change: 1840000 },
        { strike: 24600, oi: 4210000, oi_change: 920000 },
        { strike: 24700, oi: 2980000, oi_change: 640000 },
      ],
      top_pe_strikes: [
        { strike: 24000, oi: 7180000, oi_change: 2200000 },
        { strike: 23900, oi: 4520000, oi_change: 1040000 },
        { strike: 23800, oi: 3110000, oi_change: 780000 },
      ],
      timestamp: "Demo",
    },
    BANKNIFTY: {
      symbol: "BANKNIFTY", pcr: 0.88, max_pain: 51500, call_wall: 52500, put_wall: 51000,
      underlying: 52105.00, oi_divergence: true, ai_bias: "BEARISH",
      top_ce_strikes: [
        { strike: 52500, oi: 3240000, oi_change: 980000 },
        { strike: 53000, oi: 2180000, oi_change: 540000 },
        { strike: 52000, oi: 1640000, oi_change: 320000 },
      ],
      top_pe_strikes: [
        { strike: 51000, oi: 2840000, oi_change: 760000 },
        { strike: 50500, oi: 1920000, oi_change: 440000 },
        { strike: 51500, oi: 1480000, oi_change: 280000 },
      ],
      timestamp: "Demo",
    },
  },
  next_refresh: 180,
  timestamp: "Demo Mode",
};

const FB_DISPLACEMENT = {
  alerts: [
    { symbol: "BANKNIFTY", timeframe: "5M", direction: "BULLISH", body_ratio: 2.84, mss_confirmed: true,  candle_time: "10:45", alert_time: "10:47 AM" },
    { symbol: "NIFTY",     timeframe: "5M", direction: "BEARISH", body_ratio: 1.97, mss_confirmed: true,  candle_time: "09:55", alert_time: "09:57 AM" },
    { symbol: "RELIANCE",  timeframe: "5M", direction: "BULLISH", body_ratio: 1.63, mss_confirmed: false, candle_time: "11:15", alert_time: "11:17 AM" },
    { symbol: "TCS",       timeframe: "5M", direction: "BEARISH", body_ratio: 2.21, mss_confirmed: true,  candle_time: "13:40", alert_time: "13:42 PM" },
  ],
  mss_count: 3,
  timestamp: "Demo Mode",
};

const FB_LP = {
  symbol: "BANKNIFTY",
  current_price: 52105.00,
  pools: [
    { pool_type: "EQUAL_HIGHS", pool_price: 52480.00, distance_pct: 0.72, touch_count: 3, round_number_confluence: true,  untested: true  },
    { pool_type: "EQUAL_HIGHS", pool_price: 52900.00, distance_pct: 1.53, touch_count: 2, round_number_confluence: false, untested: true  },
    { pool_type: "EQUAL_HIGHS", pool_price: 53500.00, distance_pct: 2.68, touch_count: 4, round_number_confluence: true,  untested: false },
    { pool_type: "EQUAL_LOWS",  pool_price: 51800.00, distance_pct: 0.59, touch_count: 2, round_number_confluence: false, untested: false },
    { pool_type: "EQUAL_LOWS",  pool_price: 51500.00, distance_pct: 1.16, touch_count: 4, round_number_confluence: true,  untested: true  },
    { pool_type: "EQUAL_LOWS",  pool_price: 51000.00, distance_pct: 2.12, touch_count: 3, round_number_confluence: true,  untested: false },
  ],
  timestamp: "Demo Mode",
};

// ─── REUSABLE COMPONENTS ─────────────────────────────────────────────────────

/** Arc gauge SVG — reliable 360° circle, filled proportionally */
const ArcGauge = memo(({ score, grade }) => {
  const radius = 36;
  const circumference = 2 * Math.PI * radius;
  const fill = (Math.min(100, Math.max(0, score)) / 100) * circumference;
  const color = grade === "A+" ? "#10b981" : grade === "A" ? "#3b82f6" : grade === "B" ? "#f59e0b" : "#6b7280";
  return (
    <svg width="90" height="90" viewBox="0 0 90 90" style={{ display: "block", margin: "0 auto" }}>
      <circle cx="45" cy="45" r={radius} fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="7" />
      <circle cx="45" cy="45" r={radius} fill="none" stroke={color} strokeWidth="7"
        strokeDasharray={`${fill} ${circumference}`}
        strokeLinecap="round"
        transform="rotate(-90 45 45)"
        style={{ filter: `drop-shadow(0 0 6px ${color})`, transition: "stroke-dasharray 1.2s ease" }}
      />
      <text x="45" y="43" textAnchor="middle" fill={color} fontSize="16" fontWeight="700" fontFamily="IBM Plex Mono, monospace">{score}</text>
      <text x="45" y="57" textAnchor="middle" fill="rgba(255,255,255,0.35)" fontSize="9" fontFamily="IBM Plex Mono, monospace">/ 100</text>
    </svg>
  );
});

/** PCR gauge bar with visible pointer */
const PCRGauge = memo(({ pcr }) => {
  if (pcr == null) return null;
  const safe = Math.min(2.0, Math.max(0, pcr));
  const pct  = (safe / 2.0) * 100;
  const zone  = safe < 0.7 ? "Bearish" : safe < 1.2 ? "Neutral" : "Bullish";
  const color = safe < 0.7 ? "#f43f5e"  : safe < 1.2 ? "#f59e0b"  : "#10b981";
  return (
    <div className="pcr-gauge-wrapper">
      <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 10 }}>
        <span style={{ fontFamily: "IBM Plex Mono, monospace", fontSize: 28, fontWeight: 700, color }}>{pcr.toFixed(2)}</span>
        <span style={{ fontFamily: "IBM Plex Mono, monospace", fontSize: 12, color }}>{zone}</span>
      </div>
      <div className="pcr-gauge-bar">
        <div className="pcr-zone pcr-bearish">Bearish</div>
        <div className="pcr-zone pcr-neutral">Neutral</div>
        <div className="pcr-zone pcr-bullish">Bullish</div>
        <div className="pcr-pointer" style={{ left: `${pct}%`, borderTopColor: color }} />
      </div>
      <div className="pcr-labels">
        <span>0.0</span><span>0.7</span><span>1.2</span><span>2.0</span>
      </div>
    </div>
  );
});

// ─── FEATURE 1 — OPENING RANGE MANIPULATION ──────────────────────────────────
const OpeningRangePanel = memo(() => {
  const [data, setData] = useState(FB_OR);

  const doFetch = useCallback(async () => {
    const d = await apiFetch("/api/smc/opening-range");
    if (d && d.instruments) setData(d);
  }, []);

  useEffect(() => { doFetch(); const id = setInterval(doFetch, 5000); return () => clearInterval(id); }, [doFetch]);

  const bandPct = (ltp, orh, orl) => {
    const range = orh - orl;
    if (!range) return 50;
    return Math.min(98, Math.max(2, ((ltp - orl) / range) * 100));
  };

  const renderInstrument = (symbol, info) => {
    if (!info || info.status === "NO_DATA") return (
      <div key={symbol} className="smc-panel-card">
        <div className="smc-card-title">{symbol}</div>
        <div style={{ color: "#6b7280", fontSize: 13, marginTop: 12 }}>No live data for {symbol}</div>
      </div>
    );

    const { opening_range_high: orh, opening_range_low: orl, ltp, recent_events = [] } = info;
    const activeEvent = recent_events[recent_events.length - 1];
    const ltpPct = bandPct(ltp, orh, orl);

    return (
      <div key={symbol} className="smc-panel-card">
        <div className="smc-card-title">{symbol}</div>
        <div className="smc-card-subtitle">9:15–9:30 AM NSE Opening Range</div>

        {info.status === "MONITORING" ? (
          <div style={{ color: "#6b7280", fontSize: 13, display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ width: 7, height: 7, borderRadius: "50%", background: "#6b7280", display: "inline-block", animation: "pulse-dot 2s ease-in-out infinite" }} />
            Monitoring opening range... Market opens at 9:15 AM IST
          </div>
        ) : (
          <>
            {/* ORH/ORL stats */}
            <div className="or-stats">
              <div>
                <div className="or-stat-label">ORH</div>
                <div className="or-stat-value high">₹{formatINR(orh)}</div>
              </div>
              <div>
                <div className="or-stat-label">LTP</div>
                <div className="or-stat-value ltp">₹{formatINR(ltp)}</div>
              </div>
              <div>
                <div className="or-stat-label">ORL</div>
                <div className="or-stat-value low">₹{formatINR(orl)}</div>
              </div>
            </div>

            {/* Visual band */}
            <div className="or-band-wrapper" style={{ marginTop: 8 }}>
              <span className="or-label-high">ORH ₹{formatINR(orh)}</span>
              <span className="or-label-low">ORL ₹{formatINR(orl)}</span>
              <div className="or-dot" style={{ left: `${ltpPct}%` }} />
            </div>

            {/* Manipulation alert */}
            {activeEvent ? (
              <div className={`manipulation-alert ${activeEvent.type === "BULL_MANIPULATION" ? "bull" : "bear"}`} style={{ marginTop: 14 }}>
                <div className="alert-title">
                  {activeEvent.type === "BULL_MANIPULATION" ? "🟢" : "🔴"}{" "}
                  {activeEvent.type === "BULL_MANIPULATION"
                    ? `Fake Breakdown at ₹${formatINR(activeEvent.trigger_price)} — Reversal Long Setup`
                    : `Fake Breakout at ₹${formatINR(activeEvent.trigger_price)} — Reversal Short Setup`}
                </div>
                <div className="alert-time">Detected at {activeEvent.timestamp}</div>
                <div className="action-steps">
                  {[
                    activeEvent.type === "BULL_MANIPULATION" ? "Wait for MSS (Market Structure Shift) on 5M chart" : "Wait for bearish MSS and break of structure on 5M",
                    "Enter on FVG retracement after displacement candle",
                    "Exit before 2:30 PM IST to avoid closing risk",
                  ].map((step, i) => (
                    <div key={i} className="action-step">
                      <span className="step-num">0{i + 1}</span>{step}
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <div className="manipulation-alert idle" style={{ marginTop: 14 }}>
                <div className="alert-title" style={{ color: "#6b7280" }}>
                  No manipulation detected — Opening range intact
                </div>
              </div>
            )}
          </>
        )}
      </div>
    );
  };

  return (
    <div className="smc-two-col">
      {Object.entries(data.instruments || {}).map(([sym, info]) => renderInstrument(sym, info))}
    </div>
  );
});

// ─── FEATURE 2 — SESSION KILL ZONE TIMER ────────────────────────────────────
const MARKET_OPEN_MIN  = 9 * 60;
const MARKET_CLOSE_MIN = 15 * 60 + 30;
const MARKET_SPAN_MIN  = MARKET_CLOSE_MIN - MARKET_OPEN_MIN;

const KZ_SEGMENTS = [
  { start: 9 * 60,       end: 9 * 60 + 15,  cls: "kz-seg-dead",   label: "",       zone: null },
  { start: 9 * 60 + 15,  end: 9 * 60 + 30,  cls: "kz-seg-or",     label: "OR",     zone: "opening" },
  { start: 9 * 60 + 30,  end: 11 * 60,      cls: "kz-seg-prime",  label: "PRIME",  zone: "prime" },
  { start: 11 * 60,      end: 13 * 60,      cls: "kz-seg-dead",   label: "DEAD",   zone: null },
  { start: 13 * 60,      end: 13 * 60 + 30, cls: "kz-seg-dead",   label: "",       zone: null },
  { start: 13 * 60 + 30, end: 14 * 60 + 30, cls: "kz-seg-london", label: "LONDON", zone: "london" },
  { start: 14 * 60 + 30, end: 15 * 60 + 30, cls: "kz-seg-danger", label: "EXIT",   zone: "closing" },
];

const KZ_ZONES = [
  { key: "opening", start: [9,15],  end: [9,30],   label: "Opening Range Formation",   icon: "🔔", color: "#f59e0b" },
  { key: "prime",   start: [9,30],  end: [11,0],   label: "Prime Intraday Window",     icon: "🎯", color: "#10b981" },
  { key: "dead",    start: [11,0],  end: [13,0],   label: "Dead Zone — Avoid Trading", icon: "⛔", color: "#6b7280" },
  { key: "london",  start: [13,30], end: [15,0],   label: "London Overlap Kill Zone",  icon: "🌍", color: "#60a5fa" },
  { key: "closing", start: [14,30], end: [15,30],  label: "Options Exit Deadline",     icon: "⏰", color: "#f43f5e" },
];

function getISTNow() {
  const now = new Date();
  return new Date(now.toLocaleString("en-US", { timeZone: "Asia/Kolkata" }));
}

function getNeedlePct(ist) {
  const totalMin = (ist.getHours() - 9) * 60 + ist.getMinutes() + ist.getSeconds() / 60;
  return Math.min(100, Math.max(0, (totalMin / MARKET_SPAN_MIN) * 100));
}

function getActiveZone(ist) {
  const mins = ist.getHours() * 60 + ist.getMinutes();
  for (const z of [...KZ_ZONES].reverse()) {
    const s = z.start[0] * 60 + z.start[1];
    const e = z.end[0] * 60 + z.end[1];
    if (mins >= s && mins < e) return z;
  }
  return { key: "closed", label: "Market Closed", icon: "🌙", color: "#4b5563" };
}

const KillZoneTimer = memo(() => {
  const [ist, setIst] = useState(getISTNow);

  useEffect(() => {
    const id = setInterval(() => setIst(getISTNow()), 1000);
    return () => clearInterval(id);
  }, []);

  const needlePct  = useMemo(() => getNeedlePct(ist), [ist]);
  const activeZone = useMemo(() => getActiveZone(ist), [ist]);
  const istMins    = ist.getHours() * 60 + ist.getMinutes();

  const remainingSecs = useMemo(() => {
    if (!activeZone.end) return 0;
    const endMin = activeZone.end[0] * 60 + activeZone.end[1];
    return Math.max(0, (endMin - istMins) * 60);
  }, [activeZone, istMins]);

  return (
    <div className="smc-panel-card">
      <div className="smc-card-title">Session Kill Zone Timer</div>
      <div className="smc-card-subtitle">Live NSE IST Trading Windows</div>

      <div className="kz-timeline-bar">
        {KZ_SEGMENTS.map((seg, i) => {
          const w = ((seg.end - seg.start) / MARKET_SPAN_MIN) * 100;
          const isActive = seg.zone && activeZone.key === seg.zone;
          return (
            <div key={i} className={`kz-segment ${seg.cls}${isActive ? " kz-seg-active" : ""}`} style={{ width: `${w}%` }}>
              {seg.label}
            </div>
          );
        })}
        <div className="kz-needle" style={{ left: `${needlePct}%` }} />
      </div>
      <div className="kz-time-labels">
        <span>9:00</span><span>9:30</span><span>11:00</span>
        <span>13:00</span><span>13:30</span><span>14:30</span><span>15:30</span>
      </div>

      <div className="kz-active-zone" style={{ borderColor: `${activeZone.color}44`, background: `${activeZone.color}0d` }}>
        <div>
          <div className="kz-zone-name" style={{ color: activeZone.color }}>{activeZone.label}</div>
          {activeZone.key !== "closed" && remainingSecs > 0 && (
            <div className="kz-countdown">
              Ends in: <span style={{ color: activeZone.color, fontWeight: 700 }}>{formatMMSS(remainingSecs)}</span>
            </div>
          )}
        </div>
        <span style={{ fontSize: 28 }}>{activeZone.icon}</span>
      </div>

      {activeZone.key === "dead" && (
        <div style={{ marginTop: 12, padding: "10px 14px", borderRadius: 8, background: "hsla(220,20%,12%,0.8)", border: "1px solid hsla(220,20%,30%,0.4)", fontSize: 12, color: "#6b7280" }}>
          🚫 Dead Zone — High probability of false signals. Avoid new entries.
        </div>
      )}
      {activeZone.key === "closing" && (
        <div style={{ marginTop: 12, padding: "10px 14px", borderRadius: 8, background: "hsla(343,90%,60%,0.08)", border: "1px solid hsla(343,90%,60%,0.3)", fontSize: 12, color: "#f43f5e" }}>
          ⚠️ Options Exit Deadline — Close open positions to avoid theta decay.
        </div>
      )}
    </div>
  );
});

// ─── FEATURE 3 — PDH/PDL SWEEP RADAR ────────────────────────────────────────
const SweepRadar = memo(() => {
  const [data, setData] = useState(FB_SWEEPS);

  const doFetch = useCallback(async () => {
    const d = await apiFetch("/api/smc/sweeps");
    if (d && (d.sweeps || d.active_count != null)) setData(d);
  }, []);

  useEffect(() => { doFetch(); const id = setInterval(doFetch, 5000); return () => clearInterval(id); }, [doFetch]);

  const sweeps = data.sweeps ?? [];

  const rowCls  = (t) => (t === "PDH_SWEEP" || t === "PWH_SWEEP") ? "sweep-row-pdh" : "sweep-row-pdl";
  const typeCol = (t) => (t === "PDH_SWEEP" || t === "PWH_SWEEP") ? "#f43f5e" : "#10b981";
  const statusCls = (s) => s === "ACTIVE" ? "badge-amber" : s === "CONFIRMED" ? "badge-emerald" : "badge-grey";

  return (
    <div className="smc-panel-card">
      <div className="smc-card-title">PDH / PDL Liquidity Sweep Radar</div>
      <div className="smc-card-subtitle">
        {(data.active_count ?? 0) > 0
          ? `${data.active_count} Active Sweep${data.active_count > 1 ? "s" : ""} Detected`
          : "Monitoring 22 instruments for intrabar liquidity sweeps"}
      </div>

      {sweeps.length === 0 ? (
        <div style={{ textAlign: "center", padding: "32px 0", color: "#4b5563", fontSize: 13 }}>
          <div style={{ fontSize: 28, marginBottom: 10, opacity: 0.5 }}>🔍</div>
          No sweeps detected across 22 instruments
        </div>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table className="sweep-table">
            <thead>
              <tr>
                <th>Symbol</th><th>Level</th><th>Level Price</th>
                <th>Wick</th><th>Size</th><th>Status</th><th>Time</th>
              </tr>
            </thead>
            <tbody>
              {sweeps.map((s, i) => (
                <tr key={i} className={rowCls(s.sweep_type)}>
                  <td style={{ fontFamily: "IBM Plex Mono, monospace", fontWeight: 700, color: "#e8eeff" }}>{s.symbol}</td>
                  <td><span className={`badge ${typeCol(s.sweep_type) === "#f43f5e" ? "badge-rose" : "badge-emerald"}`}>{s.sweep_type}</span></td>
                  <td style={{ fontFamily: "IBM Plex Mono, monospace" }}>₹{formatINR(s.level_price)}</td>
                  <td style={{ fontFamily: "IBM Plex Mono, monospace" }}>₹{formatINR(s.wick_extreme)}</td>
                  <td style={{ fontFamily: "IBM Plex Mono, monospace" }}>{formatINR(s.sweep_magnitude)} pts</td>
                  <td><span className={`badge ${statusCls(s.status)}`}>{s.status}</span></td>
                  <td style={{ fontFamily: "IBM Plex Mono, monospace", fontSize: 10, color: "#6b7280" }}>{s.sweep_time}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="smc-refresh-hint">↻ 5s · Last: {data.timestamp}</div>
    </div>
  );
});

// ─── FEATURE 4 — SETUP QUALITY GRADER ───────────────────────────────────────
const GradeCard = memo(({ setup }) => {
  const { symbol, score, grade, direction, factors_met = [], factors_missing = [], recommendation, change_pct } = setup;
  const gradeColor = grade === "A+" ? "#10b981" : grade === "A" ? "#3b82f6" : grade === "B" ? "#f59e0b" : "#6b7280";

  return (
    <div className="grade-card">
      <div className="grade-card-header">
        <div>
          <div className="grade-symbol">{symbol}</div>
          {change_pct != null && (
            <div style={{ fontFamily: "IBM Plex Mono, monospace", fontSize: 11, color: change_pct >= 0 ? "#10b981" : "#f43f5e", marginTop: 2 }}>
              {change_pct >= 0 ? "+" : ""}{change_pct.toFixed(2)}%
            </div>
          )}
        </div>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4 }}>
          <span className={`badge ${grade === "A+" ? "badge-emerald" : grade === "A" ? "badge-blue" : grade === "B" ? "badge-amber" : "badge-grey"}`} style={{ fontSize: 13, padding: "4px 12px" }}>{grade}</span>
          <span className={direction === "LONG" ? "grade-direction-long" : "grade-direction-short"}>
            {direction === "LONG" ? "↑ LONG" : "↓ SHORT"}
          </span>
        </div>
      </div>

      <ArcGauge score={score} grade={grade} />

      <div className="factor-list">
        {(factors_met ?? []).map((f, i) => (
          <div key={`m${i}`} className="factor-item met">
            <span className="factor-dot-met" />{f}
          </div>
        ))}
        {(factors_missing ?? []).map((f, i) => (
          <div key={`x${i}`} className="factor-item unmet">
            <span className="factor-dot-unmet" />{f}
          </div>
        ))}
      </div>

      {recommendation && (
        <div style={{ marginTop: 10, padding: "8px 12px", borderRadius: 8, background: "hsla(222,47%,6%,0.8)", borderLeft: `3px solid ${gradeColor}`, fontSize: 11, color: "#94a3b8", lineHeight: 1.6 }}>
          {recommendation}
        </div>
      )}
    </div>
  );
});

const SetupGrader = memo(() => {
  const [data, setData]       = useState(FB_GRADES);
  const [gradeFilter, setGF]  = useState("all");

  const doFetch = useCallback(async () => {
    const d = await apiFetch("/api/smc/grades");
    if (d && d.grades) setData(d);
  }, []);

  useEffect(() => { doFetch(); const id = setInterval(doFetch, 30000); return () => clearInterval(id); }, [doFetch]);

  const allGrades = data?.grades ?? [];
  const filteredGrades = allGrades.filter(g => {
    if (gradeFilter === "aplus") return g.grade === "A+";
    if (gradeFilter === "long")  return g.direction === "LONG";
    if (gradeFilter === "short") return g.direction === "SHORT";
    return true;
  });

  const filters = [
    { key: "all",   label: "All" },
    { key: "aplus", label: "A+ Only" },
    { key: "long",  label: "Long Only" },
    { key: "short", label: "Short Only" },
  ];

  return (
    <div className="smc-panel-card">
      <div className="smc-card-title">SMC Setup Quality Grader</div>
      <div className="smc-card-subtitle">6-Factor Confluence Scoring · Refreshes every 30s</div>

      <div className="filter-row">
        {filters.map(f => (
          <button key={f.key} className={`filter-btn${gradeFilter === f.key ? " active" : ""}`} onClick={() => setGF(f.key)}>
            {f.label}
          </button>
        ))}
      </div>

      {filteredGrades.length === 0 ? (
        <div style={{ textAlign: "center", padding: "24px 0", color: "#6b7280", fontSize: 13 }}>No setups match the current filter</div>
      ) : (
        <div className="grade-grid">
          {filteredGrades.slice(0, 6).map(setup => (
            <GradeCard key={setup.symbol} setup={setup} />
          ))}
        </div>
      )}

      {data.timestamp && <div className="smc-refresh-hint">↻ Last: {data.timestamp}</div>}
    </div>
  );
});

// ─── FEATURE 5 — OI & PCR INTEGRATION ───────────────────────────────────────
const OICard = memo(({ symbol, info }) => {
  if (!info) return (
    <div className="smc-panel-card">
      <div className="smc-card-title">{symbol}</div>
      <div style={{ color: "#6b7280", fontSize: 13, marginTop: 12 }}>Loading OI data…</div>
    </div>
  );

  const { pcr, max_pain, call_wall, put_wall, oi_divergence, top_ce_strikes = [], top_pe_strikes = [], ai_bias } = info;
  const biasColor = ai_bias === "BULLISH" ? "#10b981" : ai_bias === "BEARISH" ? "#f43f5e" : "#f59e0b";

  return (
    <div className="smc-panel-card">
      <div className="smc-card-title">{symbol}</div>
      <div className="smc-card-subtitle">Option Chain Intelligence</div>

      <PCRGauge pcr={pcr} />

      <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
        {[
          { label: "Max Pain", val: max_pain ? `₹${formatINR(max_pain)}` : "—", valColor: "#e8eeff" },
          { label: "Call Wall", val: `₹${formatINR(call_wall)}`, valColor: "#f43f5e" },
          { label: "Put Wall",  val: `₹${formatINR(put_wall)}`,  valColor: "#10b981" },
          { label: "AI Bias",   val: ai_bias || "NEUTRAL", valColor: biasColor },
        ].map(({ label, val, valColor }) => (
          <div key={label} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 0", borderBottom: "1px solid hsla(0,0%,100%,0.04)" }}>
            <span style={{ fontFamily: "IBM Plex Mono, monospace", fontSize: 10, color: "#6b7280", letterSpacing: "0.06em", textTransform: "uppercase" }}>{label}</span>
            <span style={{ fontFamily: "IBM Plex Mono, monospace", fontSize: 14, fontWeight: 600, color: valColor }}>{val}</span>
          </div>
        ))}
      </div>

      {(top_ce_strikes.length > 0 || top_pe_strikes.length > 0) && (
        <div style={{ marginTop: 12 }}>
          <div style={{ fontFamily: "IBM Plex Mono, monospace", fontSize: 9, textTransform: "uppercase", letterSpacing: "0.1em", color: "#4b5563", marginBottom: 6 }}>Top OI Buildup</div>
          <table className="oi-table">
            <thead><tr><th>Type</th><th>Strike</th><th>OI Change</th></tr></thead>
            <tbody>
              {(top_ce_strikes ?? []).slice(0, 3).map((s, i) => (
                <tr key={`ce${i}`}>
                  <td className="oi-ce">CE ↑</td>
                  <td>₹{formatINR(s.strike)}</td>
                  <td className="oi-ce">+{(s.oi_change ?? 0).toLocaleString()}</td>
                </tr>
              ))}
              {(top_pe_strikes ?? []).slice(0, 3).map((s, i) => (
                <tr key={`pe${i}`}>
                  <td className="oi-pe">PE ↑</td>
                  <td>₹{formatINR(s.strike)}</td>
                  <td className="oi-pe">+{(s.oi_change ?? 0).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {oi_divergence && (
        <div className="pulse-amber" style={{ marginTop: 12, padding: "10px 14px", borderRadius: 8, background: "hsla(38,92%,50%,0.08)", border: "1px solid hsla(38,92%,50%,0.3)", fontSize: 12, color: "#f59e0b" }}>
          ⚠️ OI Divergence — Conflicting signals. Reduce size.
        </div>
      )}
    </div>
  );
});

const OIPCRPanel = memo(() => {
  const [data, setData]    = useState(FB_OI);
  const [countdown, setCd] = useState(180);

  const doFetch = useCallback(async () => {
    const d = await apiFetch("/api/smc/oi-pcr");
    if (d && d.indices) { setData(d); setCd(d.next_refresh || 180); }
  }, []);

  useEffect(() => {
    doFetch();
    const fetchId = setInterval(doFetch, 180000);
    const cdId    = setInterval(() => setCd(c => Math.max(0, c - 1)), 1000);
    return () => { clearInterval(fetchId); clearInterval(cdId); };
  }, [doFetch]);

  return (
    <div>
      <div className="smc-two-col">
        <OICard symbol="NIFTY"     info={data?.indices?.NIFTY} />
        <OICard symbol="BANKNIFTY" info={data?.indices?.BANKNIFTY} />
      </div>
      <div className="smc-refresh-hint">Next OI refresh in: {formatMMSS(countdown)}</div>
    </div>
  );
});

// ─── FEATURE 6 — DISPLACEMENT CANDLE ALERTS ──────────────────────────────────
const DisplacementFeed = memo(() => {
  const [data, setData] = useState(FB_DISPLACEMENT);

  const doFetch = useCallback(async () => {
    const d = await apiFetch("/api/smc/displacement");
    if (d && d.alerts) setData(d);
  }, []);

  useEffect(() => { doFetch(); const id = setInterval(doFetch, 15000); return () => clearInterval(id); }, [doFetch]);

  const alerts = data.alerts ?? [];

  return (
    <div className="smc-panel-card">
      <div className="smc-card-title">Displacement Candle Alerts</div>
      <div className="smc-card-subtitle">
        5M Timeframe · {(data.mss_count ?? 0) > 0 ? `${data.mss_count} MSS Confirmed` : "Monitoring All Instruments"}
      </div>

      {alerts.length === 0 ? (
        <div style={{ textAlign: "center", padding: "32px 0", color: "#4b5563", fontSize: 13 }}>
          <div style={{ fontSize: 28, opacity: 0.5, marginBottom: 8 }}>🕯️</div>
          No displacement candles in the last 30 minutes
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {(alerts ?? []).map((a, i) => (
            <div key={i} className={`disp-row ${a.mss_confirmed ? "mss" : "disp"}`}>
              <span className="disp-symbol">{a.symbol}</span>
              <span className="disp-tf">{a.timeframe}</span>
              <span style={{ fontSize: 18, fontWeight: 700, color: a.direction === "BULLISH" ? "#10b981" : "#f43f5e" }}>
                {a.direction === "BULLISH" ? "↑" : "↓"}
              </span>
              <span className="disp-ratio">{a.body_ratio}× avg</span>
              <span className={`badge ${a.mss_confirmed ? "badge-emerald" : "badge-amber"}`} style={{ marginLeft: "auto" }}>
                {a.mss_confirmed ? "✓ MSS CONFIRMED" : "DISPLACEMENT ONLY"}
              </span>
              <span className="disp-time">{a.candle_time ?? a.alert_time}</span>
            </div>
          ))}
        </div>
      )}

      <div style={{ marginTop: 12, padding: "10px 14px", borderRadius: 8, background: "hsla(222,47%,7%,0.6)", borderLeft: "2px solid #10b981", fontSize: 11, color: "#94a3b8", lineHeight: 1.6 }}>
        <strong style={{ color: "#10b981" }}>MSS Confirmed</strong> = Market Structure Shift with sweep precursor — highest probability.{" "}
        <span style={{ color: "#f59e0b" }}>Displacement Only</span> = Await additional confluence before entering.
      </div>

      <div className="smc-refresh-hint">↻ 15s · Last: {data.timestamp}</div>
    </div>
  );
});

// ─── FEATURE 7 — LIQUIDITY POOL MAPPER ──────────────────────────────────────
const LP_SYMBOLS = ["BANKNIFTY","NIFTY","RELIANCE","HDFCBANK","INFY","TCS","ICICIBANK","SBIN","BHARTIARTL","KOTAKBANK","TATASTEEL","BAJFINANCE","SUNPHARMA","AXISBANK","WIPRO"];

const LiquidityPoolMapper = memo(() => {
  const [symbol, setSymbol]   = useState("BANKNIFTY");
  const [data, setData]       = useState(FB_LP);
  const [loading, setLoading] = useState(false);

  const doFetch = useCallback(async (sym) => {
    setLoading(true);
    const d = await apiFetch(`/api/smc/liquidity-pools?symbol=${sym}`);
    if (d && d.pools) setData(d);
    else if (d && (d.pools_above || d.pools_below)) {
      // Legacy format compatibility — convert to unified pools array
      const pools = [
        ...(d.pools_above ?? []).map(p => ({ ...p, pool_type: "EQUAL_HIGHS" })),
        ...(d.pools_below ?? []).map(p => ({ ...p, pool_type: "EQUAL_LOWS" })),
      ];
      setData({ ...d, pools });
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    doFetch(symbol);
    const id = setInterval(() => doFetch(symbol), 300000);
    return () => clearInterval(id);
  }, [symbol, doFetch]);

  const handleSymbolChange = (e) => {
    const sym = e.target.value;
    setSymbol(sym);
    setData({ ...FB_LP, symbol: sym, pools: [] });
    doFetch(sym);
  };

  const allPools    = data?.pools ?? [];
  const cp          = data?.current_price ?? 0;
  const poolsAbove  = allPools.filter(p => p.pool_type === "EQUAL_HIGHS" && p.pool_price > cp).sort((a, b) => a.pool_price - b.pool_price);
  const poolsBelow  = allPools.filter(p => p.pool_type === "EQUAL_LOWS"  && p.pool_price < cp).sort((a, b) => b.pool_price - a.pool_price);
  const nearestAbove = poolsAbove[0];
  const nearestBelow = poolsBelow[0];

  const renderPool = (pool, isAbove) => {
    const isNearest = isAbove ? nearestAbove?.pool_price === pool.pool_price : nearestBelow?.pool_price === pool.pool_price;
    const lineColor = isAbove ? "#f43f5e" : "#10b981";
    return (
      <div key={pool.pool_price} style={{ borderBottom: "1px solid hsla(0,0%,100%,0.04)" }}>
        <div className="pool-row" style={{ borderLeft: isNearest ? `3px solid ${lineColor}` : "none", paddingLeft: isNearest ? 10 : 0 }}>
          <span className="pool-price-label" style={{ color: lineColor }}>₹{formatINR(pool.pool_price)}</span>
          <div className={isAbove ? "pool-line-high" : "pool-line-low"} />
          <div className="pool-badges">
            {pool.round_number_confluence && <span className="badge badge-blue">Round</span>}
            {pool.untested  && <span className="badge badge-amber">Untested</span>}
            {!pool.untested && <span className="badge badge-grey">Tested ×{pool.touch_count}</span>}
          </div>
          <span className="pool-dist">{pool.distance_pct?.toFixed(2)}%</span>
        </div>
        {isNearest && (
          <div className="pool-nearest-label">
            {isAbove ? "↑" : "↓"} Nearest Draw on Liquidity
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="smc-panel-card">
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
        <div className="smc-card-title">Liquidity Pool Map</div>
        <select className="lp-symbol-select" value={symbol} onChange={handleSymbolChange}>
          {LP_SYMBOLS.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
      </div>
      <div className="smc-card-subtitle">Equal Highs / Equal Lows · 10-Day 1H Scan · 5 min cache</div>

      {loading ? (
        <div style={{ padding: "24px 0", textAlign: "center", color: "#6b7280", fontFamily: "IBM Plex Mono, monospace", fontSize: 12 }}>
          Loading pools for {symbol}…
        </div>
      ) : (
        <div className="pool-ladder">
          {/* Pools ABOVE */}
          {poolsAbove.length === 0 ? (
            <div style={{ color: "#4b5563", fontSize: 12, padding: "8px 0", textAlign: "center" }}>No equal highs above</div>
          ) : (
            poolsAbove.map(p => renderPool(p, true))
          )}

          {/* Current price divider */}
          <div className="pool-current-price">
            <span className="pool-current-label">LTP</span>
            <div className="pool-current-line" />
            <span className="pool-current-value">₹{formatINR(cp)}</span>
            <div className="pool-current-line" style={{ background: "linear-gradient(270deg, hsla(217,91%,60%,0.5), transparent)" }} />
            <span style={{ fontFamily: "IBM Plex Mono, monospace", fontSize: 10, color: "#4b5563" }}>{symbol}</span>
          </div>

          {/* Pools BELOW */}
          {poolsBelow.length === 0 ? (
            <div style={{ color: "#4b5563", fontSize: 12, padding: "8px 0", textAlign: "center" }}>No equal lows below</div>
          ) : (
            poolsBelow.map(p => renderPool(p, false))
          )}

          {/* Footer */}
          <div style={{ marginTop: 14, padding: "10px 14px", borderRadius: 8, background: "hsla(222,47%,7%,0.6)", border: "1px solid hsla(0,0%,100%,0.05)", fontSize: 11, color: "#94a3b8", display: "flex", gap: 8 }}>
            <span>Pools:</span>
            <strong style={{ color: "#f43f5e" }}>{poolsAbove.length} above</strong>
            <span>|</span>
            <strong style={{ color: "#10b981" }}>{poolsBelow.length} below</strong>
            {nearestAbove && <><span>| Next draw: </span><strong style={{ color: "#f43f5e" }}>₹{formatINR(nearestAbove.pool_price)} ({nearestAbove.distance_pct?.toFixed(2)}% away)</strong></>}
          </div>
        </div>
      )}

      <div className="smc-refresh-hint">↻ 5 min cache · Last: {data.timestamp}</div>
    </div>
  );
});

// ─── ROOT PANEL ──────────────────────────────────────────────────────────────
export default function SMCIntelligencePanel() {
  return (
    <div className="smc-panel-root">
      {/* Sticky Header */}
      <div className="smc-sticky-header">
        <span style={{ fontSize: 26 }}>🧠</span>
        <div>
          <div className="smc-header-title">SMC Intelligence</div>
          <div className="smc-header-subtitle">Institutional Smart Money Concepts — Live Strategy Engine</div>
        </div>
        <div className="smc-live-badge">
          <span className="smc-live-dot" />LIVE
        </div>
      </div>

      {/* Section 1 */}
      <div className="smc-section">
        <div className="smc-section-label">Opening Range Manipulation</div>
        <OpeningRangePanel />
      </div>

      {/* Section 2 */}
      <div className="smc-section">
        <div className="smc-section-label">Session Kill Zones</div>
        <KillZoneTimer />
      </div>

      {/* Section 3 */}
      <div className="smc-section">
        <div className="smc-section-label">PDH / PDL Liquidity Sweep Radar</div>
        <SweepRadar />
      </div>

      {/* Section 4 */}
      <div className="smc-section">
        <div className="smc-section-label">SMC Setup Quality Grader</div>
        <SetupGrader />
      </div>

      {/* Section 5 */}
      <div className="smc-section">
        <div className="smc-section-label">OI & PCR Integration</div>
        <OIPCRPanel />
      </div>

      {/* Section 6 */}
      <div className="smc-section">
        <div className="smc-section-label">Displacement Candle Alerts</div>
        <DisplacementFeed />
      </div>

      {/* Section 7 */}
      <div className="smc-section">
        <div className="smc-section-label">Liquidity Pool Mapper</div>
        <LiquidityPoolMapper />
      </div>
    </div>
  );
}
