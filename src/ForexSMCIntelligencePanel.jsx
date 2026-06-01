import React, { useState, useEffect, memo } from "react";
import "./ForexSMCIntelligencePanel.css";
import ForexKillZoneTimer from "./ForexKillZoneTimer";

// --- API Helper ---
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
  if (n == null || n === "—") return "—";
  return Number(n).toLocaleString("en-US", { minimumFractionDigits: 5, maximumFractionDigits: 5 });
}

// --- Empty Data Fallbacks ---
const FB_OR = { instruments: {}, timestamp: "—" };
const FB_SWEEPS = { sweeps: [], timestamp: "—", active_sweep_count: 0, summary: { active_count: 0, confirmed_count: 0, market_bias: "NEUTRAL" } };
const FB_GRADES = { grades: [], timestamp: "—", kill_zone: { is_dead_zone: false } };
const FB_SENTIMENT = { cot: {}, fear_greed: { value: 50 }, vix: { value: null }, timestamp: "—" };
const FB_DISPLACEMENT = { alerts: [], timestamp: "—" };
const FB_LIQUIDITY = { pools_above: [], pools_below: [], ltp: "—", timestamp: "—" };
const FB_MTF = { bias_grid: [], timestamp: "—" };

export default function ForexSMCIntelligencePanel() {
  const [activeTab, setActiveTab] = useState("grades");
  
  // Data states
  const [orData, setOrData] = useState(FB_OR);
  const [sweepsData, setSweepsData] = useState(FB_SWEEPS);
  const [gradesData, setGradesData] = useState(FB_GRADES);
  const [sentimentData, setSentimentData] = useState(FB_SENTIMENT);
  const [dispData, setDispData] = useState(FB_DISPLACEMENT);
  const [liqData, setLiqData] = useState(FB_LIQUIDITY);
  const [mtfData, setMtfData] = useState(FB_MTF);
  const [livePrices, setLivePrices] = useState({});
  
  const [liqSymbol, setLiqSymbol] = useState("XAUUSD");
  const [gradeFilter, setGradeFilter] = useState("All");
  const [sweepFilter, setSweepFilter] = useState("All Sweeps");
  const [showExpired, setShowExpired] = useState(false);

  const [utcTime, setUtcTime] = useState("");
  const [lastUpdated, setLastUpdated] = useState(0);

  // Live Clock & Time Elapsed
  useEffect(() => {
    const t = setInterval(() => {
      const d = new Date();
      setUtcTime(d.toISOString().substr(11, 8) + " UTC");
      setLastUpdated(prev => prev + 1);
    }, 1000);
    return () => clearInterval(t);
  }, []);

  // Pollers
  useEffect(() => {
    const fetchOR = async () => { const res = await apiFetch("/api/forex/smc/opening-range"); if (res) { setOrData(res.data ?? FB_OR); setLastUpdated(0); } };
    const fetchSweeps = async () => { const res = await apiFetch("/api/forex/smc/sweeps"); if (res) { setSweepsData(res.data ?? FB_SWEEPS); setLastUpdated(0); } };
    const fetchGrades = async () => { const res = await apiFetch("/api/forex/smc/grades"); if (res) { setGradesData(res.data ?? FB_GRADES); setLastUpdated(0); } };
    const fetchSentiment = async () => { const res = await apiFetch("/api/forex/smc/sentiment"); if (res) { setSentimentData(res.data ?? FB_SENTIMENT); setLastUpdated(0); } };
    const fetchDisp = async () => { const res = await apiFetch("/api/forex/smc/displacement"); if (res) { setDispData(res.data ?? FB_DISPLACEMENT); setLastUpdated(0); } };
    const fetchMtf = async () => { const res = await apiFetch("/api/forex/smc/mtf-bias"); if (res) { setMtfData(res.data ?? FB_MTF); setLastUpdated(0); } };
    
    fetchOR(); fetchSweeps(); fetchGrades(); fetchSentiment(); fetchDisp(); fetchMtf();
    
    const i1 = setInterval(fetchOR, 5000);
    const i2 = setInterval(fetchSweeps, 5000);
    const i3 = setInterval(fetchGrades, 8000);
    const i4 = setInterval(fetchSentiment, 120000);
    const i5 = setInterval(fetchDisp, 10000);
    const i6 = setInterval(fetchMtf, 30000);
    
    return () => { clearInterval(i1); clearInterval(i2); clearInterval(i3); clearInterval(i4); clearInterval(i5); clearInterval(i6); };
  }, []);

  // WebSocket for Live Prices
  useEffect(() => {
    let ws;
    let wsUrl = (window.location.protocol === 'https:' ? 'wss://' : 'ws://') + window.location.host + '/ws/forex/prices';
    if (window.location.port === '3000' || window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
      wsUrl = 'ws://127.0.0.1:8001/ws/forex/prices';
    }
    const connect = () => {
      ws = new WebSocket(wsUrl);
      ws.onmessage = (e) => {
        try {
          const data = JSON.parse(e.data);
          setLivePrices(data);
        } catch (err) {}
      };
      ws.onclose = () => { setTimeout(connect, 3000); };
    };
    connect();
    return () => { if (ws) ws.close(); };
  }, []);

  useEffect(() => {
    const fetchLiq = async () => { const res = await apiFetch(`/api/forex/smc/liquidity-pools?symbol=${liqSymbol}`); if (res) setLiqData(res.data ?? FB_LIQUIDITY); };
    fetchLiq();
    const i = setInterval(fetchLiq, 60000);
    return () => clearInterval(i);
  }, [liqSymbol]);

  const getLtp = (sym) => livePrices[sym]?.ltp || gradesData.grades.find(g => g.symbol === sym)?.ltp || "—";
  const xauTick = getLtp("XAUUSD");
  const btcTick = getLtp("BTCUSD");
  
  const isDeadZone = gradesData.kill_zone?.is_dead_zone;
  const isKzPulse = gradesData.kill_zone?.is_kill_zone;

  const renderTabs = () => (
    <div className="fsmc-tabs">
      {["grades", "sweeps", "displacement", "opening-range", "liquidity", "mtf", "sentiment"].map(t => (
        <div key={t} className={`fsmc-tab ${activeTab === t ? "active" : ""}`} onClick={() => setActiveTab(t)}>
          {t === "opening-range" ? "Kill Zones" : t === "mtf" ? "MTF Bias" : t.charAt(0).toUpperCase() + t.slice(1)}
        </div>
      ))}
    </div>
  );

  return (
    <div className="forex-smc-panel" style={{ borderColor: isKzPulse ? 'var(--accent-amber)' : 'transparent', boxShadow: isKzPulse ? '0 0 15px rgba(245, 158, 11, 0.15)' : 'none', transition: 'all 0.5s ease' }}>
      
      {/* GLOBAL HEADER */}
      <div className="fsmc-global-header">
        <div className="fsmc-header-left">
          <span className="fsmc-time utc-clock">{utcTime || "—"}</span>
          <div className="fsmc-ticker"><span className="fsmc-ticker-sym">XAUUSD</span> <span className="price-value">{xauTick}</span></div>
          <div className="fsmc-ticker"><span className="fsmc-ticker-sym">BTCUSD</span> <span className="price-value">{btcTick}</span></div>
          <div className="fsmc-last-updated timestamp">Updated {lastUpdated}s ago</div>
        </div>
        <div className="fsmc-header-right">
          {sentimentData.vix?.value && (
            <div className={`fsmc-vix ${sentimentData.vix.risk_level.toLowerCase()}`}>
              VIX: {sentimentData.vix.value}
            </div>
          )}
        </div>
      </div>

      {renderTabs()}

      <div className="fsmc-tab-content">
        
        {/* GRADES TAB */}
        {activeTab === "grades" && (
          <div>
            <div className="fsmc-filters">
              {["All", "A+ Only", "Long Only", "Short Only", "Gold Only"].map(f => (
                <button key={f} className={`filter-btn ${gradeFilter === f ? 'active' : ''}`} onClick={() => setGradeFilter(f)}>{f}</button>
              ))}
            </div>
            <div className="fsmc-grid">
              {gradesData.grades
                .filter(g => {
                  if (gradeFilter === "A+ Only") return g.score >= 80;
                  if (gradeFilter === "Long Only") return g.direction === "LONG";
                  if (gradeFilter === "Short Only") return g.direction === "SHORT";
                  if (gradeFilter === "Gold Only") return g.symbol === "XAUUSD";
                  return true;
                })
                .map((g, i) => {
                  const radius = 40;
                  const circumference = Math.PI * radius;
                  const fill = (Math.min(Math.max(g.score, 0), 100) / 100) * circumference;
                  let color = "var(--text-muted)";
                  if (g.score >= 80) color = "var(--accent-emerald)";
                  else if (g.score >= 60) color = "var(--accent-blue)";
                  else if (g.score >= 40) color = "var(--accent-amber)";
                  else color = "var(--accent-rose)";
                  if (g.do_not_trade) color = "var(--accent-rose)";

                  return (
                    <div key={g.symbol} className={`fsmc-card grade-card ${(g.symbol === "XAUUSD" || g.symbol === "BTCUSD") ? 'full-width' : ''}`}>
                      <div className="fsmc-card-header">
                        <div className="fsmc-card-title">
                          <span className="symbol-name">{g.symbol}</span>
                          {g.data_source === "DEMO" && <span className="fsmc-badge demo">DEMO</span>}
                        </div>
                        {g.direction !== "NEUTRAL" && (
                          <div className={`fsmc-badge`} style={{ background: g.direction === "LONG" ? "hsla(160,84%,39%,0.1)" : "hsla(343,90%,60%,0.1)", color: g.direction === "LONG" ? "var(--accent-emerald)" : "var(--accent-rose)" }}>
                            {g.direction === "LONG" ? "▲ LONG" : "▼ SHORT"}
                          </div>
                        )}
                      </div>
                      
                      <div style={{ display: 'flex', gap: '24px', alignItems: 'center' }}>
                        <div className="grade-gauge">
                          <svg width="100" height="50" viewBox="0 0 100 50">
                            <path d="M 10 45 A 40 40 0 0 1 90 45" fill="none" strokeWidth="8" className="grade-arc-bg" />
                            <path d="M 10 45 A 40 40 0 0 1 90 45" fill="none" strokeWidth="8" stroke={color} className="grade-arc-fill" strokeDasharray={`${fill} ${circumference}`} />
                          </svg>
                          <div className="grade-label" style={{ color }}><span className="score-number">{g.score}</span></div>
                          <div className="grade-letter" style={{ color, textAlign: 'center', marginTop: '4px', fontWeight: 600 }}>{g.grade.split(' ')[0]}</div>
                        </div>
                        <div style={{ flex: 1 }}>
                           <div className="factors-list">
                             {Object.values(g.factors || {}).map((f, idx) => {
                               let cleanLabel = f.label.replace(/bullish|bearish/gi, '').replace(/\(\)/g, '').trim();
                               if (!cleanLabel) cleanLabel = f.label;
                               return (
                                 <div key={idx} className="factor-item">
                                   <div className={`factor-dot ${f.pts > 0 ? 'dot-yes' : 'dot-no'}`} />
                                   <span style={{ flex: 1, color: f.pts > 0 ? 'var(--text-primary)' : 'var(--text-muted)' }}>{cleanLabel}</span>
                                 </div>
                               );
                             })}
                           </div>
                        </div>
                      </div>
                      
                      {g.direction !== "NEUTRAL" && !g.do_not_trade && (
                         <div className="action-summary">
                           {g.direction === "LONG" ? "Enter on FVG retracement after sweep confirmation" : "Enter on FVG retracement after sweep confirmation"}
                         </div>
                      )}
                    </div>
                  );
                })}
            </div>
          </div>
        )}

        {/* SWEEPS TAB */}
        {activeTab === "sweeps" && (
          <div className="sweeps-panel">
            
            {/* ZONE 1: CONTROL BAR */}
            <div className="sweeps-control-bar">
              <div className="sweeps-filters">
                {["All Sweeps", "Week H/L", "Day H/L", "Session H/L"].map(f => (
                  <button key={f} className={`sweep-pill-btn ${sweepFilter === f ? 'active' : ''}`} onClick={() => setSweepFilter(f)}>{f}</button>
                ))}
                <button 
                  className={`sweep-pill-btn ${showExpired ? 'toggle-active' : ''}`} 
                  onClick={() => setShowExpired(!showExpired)}
                >
                  {showExpired ? "Hide Expired" : "Show Expired"}
                </button>
              </div>
              <div className="sweeps-meta">
                {sweepsData.summary?.active_count > 0 && <span className="meta-active">● {sweepsData.summary.active_count} ACTIVE</span>}
                {sweepsData.summary?.confirmed_count > 0 && <span className="meta-confirmed">● {sweepsData.summary.confirmed_count} CONFIRMED</span>}
                <span className="meta-updated">↻ Updated {lastUpdated}s ago</span>
              </div>
            </div>

            {/* ZONE 2: SUMMARY STRIP */}
            <div className="sweeps-summary-strip">
              <div className="summary-card">
                <div className="summary-icon gold-dot">●</div>
                <div className="summary-main">
                  <div className="summary-title">XAUUSD</div>
                  <div className="summary-val">{xauTick}</div>
                </div>
                <div className="summary-badge">
                  {(() => {
                    const xauSweeps = sweepsData.sweeps.filter(s => s.symbol === "XAUUSD");
                    const confirmed = xauSweeps.find(s => s.status === "CONFIRMED");
                    if (confirmed) return <span className="pill-confirmed">{confirmed.level_category} CONFIRMED {confirmed.level_category.includes("L") ? "↑" : "↓"}</span>;
                    const active = xauSweeps.find(s => s.status === "ACTIVE");
                    if (active) return <span className="pill-active">{active.level_category} ACTIVE {active.level_category.includes("L") ? "↑" : "↓"}</span>;
                    return <span className="pill-muted">No Active Sweep</span>;
                  })()}
                </div>
              </div>

              <div className="summary-card center-align">
                <div className="summary-big-num">{sweepsData.summary?.active_count + sweepsData.summary?.confirmed_count}</div>
                <div className="summary-title">SWEEPS DETECTED</div>
                <div className="summary-sub">Last 4 hours</div>
                <div className="summary-split">
                  <span className="split-confirmed">{sweepsData.summary?.confirmed_count} CONFIRMED</span>
                  <span className="split-active">{sweepsData.summary?.active_count} ACTIVE</span>
                </div>
              </div>

              <div className="summary-card">
                <div className="summary-main">
                  <div className={`summary-big-label ${sweepsData.summary?.market_bias.toLowerCase()}`}>
                    {sweepsData.summary?.market_bias}
                  </div>
                  <div className="summary-sub" style={{marginTop:'4px'}}>Based on liquidity sweep direction</div>
                </div>
              </div>
            </div>

            {/* ZONE 3: SWEEP TABLE */}
            <div className="sweeps-table-wrapper">
              {sweepsData.sweeps.filter(s => {
                  if (sweepFilter === "Week H/L") return s.level_category?.includes("PW");
                  if (sweepFilter === "Day H/L") return s.level_category?.includes("PD");
                  if (sweepFilter === "Session H/L") return s.level_category?.includes("PS");
                  return true;
              }).filter(s => showExpired ? true : s.status !== "EXPIRED").length === 0 ? (
                <div className="fsmc-empty-state">
                  <svg className="empty-radar" viewBox="0 0 100 100" width="60" height="60">
                    <circle cx="50" cy="50" r="48" fill="none" stroke="hsla(217,91%,60%,0.2)" strokeWidth="2" />
                    <circle cx="50" cy="50" r="3" fill="var(--accent-blue)" />
                    <line x1="50" y1="50" x2="50" y2="2" stroke="var(--accent-blue)" strokeWidth="2" opacity="0.6" className="radar-line" />
                  </svg>
                  <div className="empty-title">No sweeps detected</div>
                  <div className="empty-subtext">Sweeps appear when price wicks beyond a key level and closes back — indicating institutional liquidity grab</div>
                </div>
              ) : (
              <table className="sweeps-table">
                <thead>
                  <tr>
                    <th style={{width:'110px'}}>SYMBOL</th>
                    <th style={{width:'150px'}}>LEVEL TYPE</th>
                    <th style={{width:'130px'}}>KEY LEVEL</th>
                    <th style={{width:'120px'}}>WICK TO</th>
                    <th style={{width:'120px'}}>CLOSED AT</th>
                    <th style={{width:'130px'}}>STATUS</th>
                    <th style={{width:'80px'}}>AGE</th>
                  </tr>
                </thead>
                <tbody>
                  {sweepsData.sweeps
                    .filter(s => {
                      if (sweepFilter === "Week H/L") return s.level_category?.includes("PW");
                      if (sweepFilter === "Day H/L") return s.level_category?.includes("PD");
                      if (sweepFilter === "Session H/L") return s.level_category?.includes("PS");
                      return true;
                    })
                    .filter(s => showExpired ? true : s.status !== "EXPIRED")
                    .sort((a, b) => {
                      const statusOrder = { "CONFIRMED": 1, "ACTIVE": 2, "EXPIRED": 3 };
                      if (statusOrder[a.status] !== statusOrder[b.status]) return statusOrder[a.status] - statusOrder[b.status];
                      if (a.symbol === "XAUUSD" && b.symbol !== "XAUUSD") return -1;
                      if (b.symbol === "XAUUSD" && a.symbol !== "XAUUSD") return 1;
                      return a.time_elapsed_s - b.time_elapsed_s;
                    })
                    .map((s, i) => {
                    
                    let rowCls = "sweep-row ";
                    let statusCls = "sweep-status-badge ";
                    if (s.status === "ACTIVE") {
                      rowCls += "row-active";
                      statusCls += "st-active";
                    } else if (s.status === "CONFIRMED") {
                      rowCls += "row-confirmed";
                      statusCls += "st-confirmed";
                    } else {
                      rowCls += "row-expired";
                      statusCls += "st-expired";
                    }
                    if (s.symbol === "XAUUSD") rowCls += " row-xau";

                    let isHigh = s.level_category?.includes("H");
                    let levelColor = isHigh ? 'level-rose' : 'level-emerald';
                    if (s.level_category?.includes("PS")) levelColor = 'level-amber';

                    let badgeCls = "sweep-strength-pill ";
                    if (s.level_strength === "MAJOR") badgeCls += "pill-major";
                    else if (s.level_strength === "INTRADAY") badgeCls += "pill-intra";
                    else badgeCls += "pill-standard";

                    let wickCls = isHigh ? 'val-rose' : 'val-emerald';

                    const formatAge = (s) => {
                      const m = Math.floor(s/60);
                      if (m < 60) return `${m}m`;
                      return `${Math.floor(m/60)}h ${m%60}m`;
                    };
                    const ageText = formatAge(s.time_elapsed_s);
                    const ageCls = s.time_elapsed_s > 3600 ? "val-amber" : "val-muted";

                    return (
                      <tr key={i} className={rowCls}>
                        <td className="col-symbol">
                          <div className="sym-name">{s.symbol}</div>
                          <div className="sym-type">{s.symbol === "BTCUSD" || s.symbol === "ETHUSD" ? "CRYPTO" : s.symbol === "NAS100" || s.symbol === "SP100" ? "INDEX" : "FOREX"}</div>
                        </td>
                        <td className="col-level">
                          <div className={`level-cat ${levelColor}`}>{s.level_category}</div>
                          <div className={badgeCls}>{s.level_strength}</div>
                        </td>
                        <td className="col-price">
                          <span className="price-val">{s.level_price}</span>
                        </td>
                        <td className="col-wick">
                          <span className={`wick-val ${wickCls}`}>{s.wick_extreme}</span>
                        </td>
                        <td className="col-close">
                          <span className="close-val">{s.candle_close}</span>
                        </td>
                        <td className="col-status">
                          <div className={statusCls}>
                            {s.status !== "EXPIRED" && <span className="status-dot">●</span>}
                            {s.status}
                          </div>
                        </td>
                        <td className="col-age">
                          <span className={`age-val ${ageCls}`}>{ageText}</span>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
              )}
            </div>
          </div>
        )}

        {/* DISPLACEMENT TAB */}
        {activeTab === "displacement" && (
          <div className="fsmc-table-wrapper">
            <table className="fsmc-table">
              <thead>
                <tr>
                  <th>SYMBOL</th>
                  <th>DIR</th>
                  <th>TYPE</th>
                  <th>BODY/ATR</th>
                  <th>AGE</th>
                </tr>
              </thead>
              <tbody>
                {dispData.alerts.reduce((acc, a) => {
                  if (!acc.some(existing => existing.symbol === a.symbol && Math.abs(existing.age_s - a.age_s) < 120)) {
                     acc.push(a);
                  }
                  return acc;
                }, []).map((a, i) => (
                  <tr key={i} className={`sweep-row ${a.expired ? 'strikethrough' : ''}`}>
                    <td>
                      <span className="symbol-name">{a.symbol}</span>
                      {a.data_source === "DEMO" && <span className="fsmc-badge demo" style={{marginLeft:'8px'}}>DEMO</span>}
                    </td>
                    <td style={{ color: a.direction === "▲" ? 'var(--accent-emerald)' : 'var(--accent-rose)' }}>{a.direction}</td>
                    <td style={{ color: a.alert_type === "MSS_CONFIRMED" ? 'var(--accent-emerald)' : 'var(--accent-amber)' }}>{a.alert_type.replace('_', ' ')}</td>
                    <td className="body-atr-ratio">{a.body_atr_ratio}x</td>
                    <td className="timestamp">{a.expired ? 'EXPIRED' : `${Math.floor(a.age_s / 60)}m ago`}</td>
                  </tr>
                ))}
                {dispData.alerts.length === 0 && <tr><td colSpan="5" style={{textAlign:'center', color:'var(--text-muted)'}}>No recent displacement candles</td></tr>}
              </tbody>
            </table>
          </div>
        )}

        {/* KILL ZONES / OPENING RANGE */}
        {activeTab === "opening-range" && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
            <ForexKillZoneTimer />
            
            <div className="fsmc-grid">
              {Object.values(orData.instruments || {}).map(inst => {
                const ltpToUse = getLtp(inst.symbol);
                const posPct = Math.min(Math.max(((ltpToUse - inst.opening_range_low) / inst.range_width) * 100, 2), 98);
                
                return (
                  <div key={inst.symbol} className="fsmc-card">
                    <div className="fsmc-card-header">
                      <div className="fsmc-card-title">
                        <span className="symbol-name">{inst.symbol}</span> <span style={{fontSize:'12px', color:'var(--text-muted)', fontWeight:400}}>NY Midnight OR</span>
                        {inst.data_source === "DEMO" && <span className="fsmc-badge demo">DEMO</span>}
                      </div>
                      <div style={{fontSize:'13px'}} className="price-value">{formatINR(ltpToUse)}</div>
                    </div>
                    
                    <div className="or-band">
                      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                        <span>ORH</span> <span className="price-value">{inst.opening_range_high}</span>
                      </div>
                      {ltpToUse !== "—" && (
                        <div className="or-ltp-dot" style={{ top: `${100 - posPct}%` }} />
                      )}
                      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                        <span>ORL</span> <span className="price-value">{inst.opening_range_low}</span>
                      </div>
                    </div>
                    
                    {inst.manipulation_type !== "NONE" && (
                      <div style={{ color: inst.manipulation_type === "BULL_MANIPULATION" ? 'var(--accent-emerald)' : 'var(--accent-rose)', fontWeight: 600, fontSize: '14px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <span style={{ animation: 'pulse-border 1.5s infinite' }}>⚡</span> {inst.manipulation_type.replace('_', ' ')}
                      </div>
                    )}
                    
                    {inst.action_steps && inst.action_steps.length > 0 && (
                      <div className="action-steps">
                        {inst.action_steps.map((step, idx) => <div key={idx}>{step}</div>)}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {/* LIQUIDITY MAP */}
        {activeTab === "liquidity" && (
          <div className="fsmc-card full-width">
            <div className="fsmc-card-header">
              <div className="fsmc-card-title">
                Liquidity Pool Map
                <select value={liqSymbol} onChange={(e) => setLiqSymbol(e.target.value)} style={{ marginLeft: '16px', background: 'var(--bg)', color: '#fff', border: '1px solid var(--glass-border)', padding: '4px 8px', borderRadius: '4px' }}>
                  <option value="XAUUSD">XAUUSD</option>
                  <option value="BTCUSD">BTCUSD</option>
                  <option value="EURUSD">EURUSD</option>
                  <option value="GBPUSD">GBPUSD</option>
                </select>
              </div>
            </div>
            
            <div className="liq-ladder" style={{ marginTop: '24px' }}>
              {[...(liqData.pools_above || [])].reverse().map((p, i) => (
                <div key={`above-${i}`} className="liq-pool-row">
                  <span className="price-value" style={{ width: '80px', color: 'var(--accent-rose)' }}>{p.price}</span>
                  <div className="liq-pool-line liq-rose" />
                  <span className="distance-pct" style={{ width: '60px', textAlign: 'right', color: 'var(--text-muted)' }}>+{p.dist_pct}%</span>
                  <div style={{ display: 'flex', gap: '4px', width: '120px' }}>
                    {p.tags.map(t => <span key={t} className="fsmc-badge" style={{ background: 'hsla(343,90%,60%,0.1)', color: 'var(--accent-rose)' }}>{t}</span>)}
                  </div>
                </div>
              ))}
              
              <div className="liq-current">
                CURRENT PRICE: <span className="price-value">{liqData.ltp}</span>
              </div>
              
              {(liqData.pools_below || []).map((p, i) => (
                <div key={`below-${i}`} className="liq-pool-row">
                  <span className="price-value" style={{ width: '80px', color: 'var(--accent-emerald)' }}>{p.price}</span>
                  <div className="liq-pool-line liq-emerald" />
                  <span className="distance-pct" style={{ width: '60px', textAlign: 'right', color: 'var(--text-muted)' }}>{p.dist_pct}%</span>
                  <div style={{ display: 'flex', gap: '4px', width: '120px' }}>
                    {p.tags.map(t => <span key={t} className="fsmc-badge" style={{ background: 'hsla(160,84%,39%,0.1)', color: 'var(--accent-emerald)' }}>{t}</span>)}
                  </div>
                </div>
              ))}
              
              {(!liqData.pools_above?.length && !liqData.pools_below?.length) && (
                <div style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '24px' }}>No liquidity pools detected in recent data</div>
              )}
            </div>
          </div>
        )}

        {/* MTF BIAS */}
        {activeTab === "mtf" && (
          <div className="fsmc-card full-width">
            <div className="mtf-grid" style={{ marginBottom: '12px', color: 'var(--text-muted)', fontSize: '10px' }}>
              <div>SYMBOL</div><div>D1</div><div>H4</div><div>H1</div><div>M15</div><div>BIAS</div>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {mtfData.bias_grid.map(row => (
                <div key={row.symbol} className="mtf-grid sweep-row">
                  <div style={{ fontWeight: 600 }} className="symbol-name">{row.symbol}</div>
                  {["D1", "H4", "H1", "M15"].map(tf => {
                    const val = row[tf];
                    let cls = "bg-grey";
                    if (val === "BULLISH") cls = "bg-emerald";
                    else if (val === "BEARISH") cls = "bg-rose";
                    else if (val === "RANGING") cls = "bg-amber";
                    return <div key={tf} className={`mtf-cell ${cls}`}>{val}</div>
                  })}
                  <div className={`mtf-cell ${row.overall_bias.includes("STRONG_BULL") ? "bg-emerald-solid" : row.overall_bias.includes("STRONG_BEAR") ? "bg-rose-solid" : row.overall_bias.includes("BULL") ? "bg-emerald" : row.overall_bias.includes("BEAR") ? "bg-rose" : "bg-neutral"}`}>
                    {row.overall_bias.replace('_', ' ')}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* SENTIMENT */}
        {activeTab === "sentiment" && (
          <div className="fsmc-grid">
            {Object.entries(sentimentData.cot || {}).map(([sym, cot]) => {
              const fillPct = Math.min(Math.abs(cot.net_position) / 1000, 50);
              const isLong = cot.net_position > 0;
              const isMomentumProxy = cot.label?.includes("momentum");
              return (
                <div key={sym} className="fsmc-card">
                  <div className="fsmc-card-header">
                     <div className="fsmc-card-title symbol-name">{sym} COT Sentiment</div>
                     {isMomentumProxy && <div className="fsmc-badge" style={{ color: 'var(--accent-amber)', border: '1px solid var(--accent-amber)' }} title="Based on price momentum, not institutional flow">MOMENTUM PROXY</div>}
                  </div>
                  
                  <div className="cot-bar-container">
                    <div className="cot-bar-fill" style={{ 
                      width: `${fillPct}%`, 
                      background: isLong ? 'var(--accent-emerald)' : 'var(--accent-rose)',
                      left: isLong ? '50%' : `${50 - fillPct}%`
                    }} />
                    <div style={{ position: 'absolute', left: '50%', top: 0, bottom: 0, width: '2px', background: 'var(--bg)' }} />
                  </div>
                  <div style={{ textAlign: 'center', fontSize: '12px', fontWeight: 600, color: isLong ? 'var(--accent-emerald)' : 'var(--accent-rose)' }}>
                    {cot.bias}
                  </div>
                </div>
              )
            })}
            
            <div className="fsmc-card">
              <div className="fsmc-card-title">Crypto Fear & Greed</div>
              
              <div className="grade-gauge" style={{ margin: '16px auto', width: '120px', height: '60px' }}>
                <svg width="120" height="60" viewBox="0 0 100 50">
                  <path d="M 10 45 A 40 40 0 0 1 90 45" fill="none" strokeWidth="8" className="grade-arc-bg" />
                  {sentimentData.fear_greed?.value && (
                    <path d="M 10 45 A 40 40 0 0 1 90 45" fill="none" strokeWidth="8" stroke={
                      sentimentData.fear_greed.value <= 24 ? '#b91c1c' :
                      sentimentData.fear_greed.value <= 44 ? 'var(--accent-rose)' :
                      sentimentData.fear_greed.value <= 55 ? 'var(--accent-amber)' :
                      sentimentData.fear_greed.value <= 74 ? 'var(--accent-emerald)' :
                      '#16a34a'
                    } className="grade-arc-fill" strokeDasharray={`${(sentimentData.fear_greed.value / 100) * (Math.PI * 40)} ${Math.PI * 40}`} />
                  )}
                </svg>
                <div className="grade-label" style={{ 
                  color: sentimentData.fear_greed?.value <= 24 ? '#b91c1c' :
                         sentimentData.fear_greed?.value <= 44 ? 'var(--accent-rose)' :
                         sentimentData.fear_greed?.value <= 55 ? 'var(--accent-amber)' :
                         sentimentData.fear_greed?.value <= 74 ? 'var(--accent-emerald)' :
                         '#16a34a'
                }}><span className="score-number" style={{ fontSize: '28px' }}>{sentimentData.fear_greed?.value}</span></div>
              </div>
              <div style={{ textAlign: 'center', color: 'var(--text-muted)' }}>
                {sentimentData.fear_greed?.classification}
              </div>
            </div>
          </div>
        )}

      </div>
    </div>
  );
}
