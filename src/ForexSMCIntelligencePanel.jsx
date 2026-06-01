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
const FB_SWEEPS = { sweeps: [], timestamp: "—" };
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
  
  const [liqSymbol, setLiqSymbol] = useState("XAUUSD");
  const [gradeFilter, setGradeFilter] = useState("All");

  const [utcTime, setUtcTime] = useState("");

  // Live Clock
  useEffect(() => {
    const t = setInterval(() => {
      const d = new Date();
      setUtcTime(d.toISOString().substr(11, 8) + " UTC");
    }, 1000);
    return () => clearInterval(t);
  }, []);

  // Pollers
  useEffect(() => {
    const fetchOR = async () => { const res = await apiFetch("/api/forex/smc/opening-range"); if (res && res.data) setOrData(res.data); };
    const fetchSweeps = async () => { const res = await apiFetch("/api/forex/smc/sweeps"); if (res && res.data) setSweepsData(res.data); };
    const fetchGrades = async () => { const res = await apiFetch("/api/forex/smc/grades"); if (res && res.data) setGradesData(res.data); };
    const fetchSentiment = async () => { const res = await apiFetch("/api/forex/smc/sentiment"); if (res && res.data) setSentimentData(res.data); };
    const fetchDisp = async () => { const res = await apiFetch("/api/forex/smc/displacement"); if (res && res.data) setDispData(res.data); };
    const fetchMtf = async () => { const res = await apiFetch("/api/forex/smc/mtf-bias"); if (res && res.data) setMtfData(res.data); };
    
    fetchOR(); fetchSweeps(); fetchGrades(); fetchSentiment(); fetchDisp(); fetchMtf();
    
    const i1 = setInterval(fetchOR, 5000);
    const i2 = setInterval(fetchSweeps, 5000);
    const i3 = setInterval(fetchGrades, 8000);
    const i4 = setInterval(fetchSentiment, 120000);
    const i5 = setInterval(fetchDisp, 10000);
    const i6 = setInterval(fetchMtf, 30000);
    
    return () => { clearInterval(i1); clearInterval(i2); clearInterval(i3); clearInterval(i4); clearInterval(i5); clearInterval(i6); };
  }, []);

  useEffect(() => {
    const fetchLiq = async () => { const res = await apiFetch(`/api/forex/smc/liquidity-pools?symbol=${liqSymbol}`); if (res && res.data) setLiqData(res.data); };
    fetchLiq();
    const i = setInterval(fetchLiq, 60000);
    return () => clearInterval(i);
  }, [liqSymbol]);

  const xauTick = gradesData.grades.find(g => g.symbol === "XAUUSD")?.ltp || "—";
  const btcTick = gradesData.grades.find(g => g.symbol === "BTCUSD")?.ltp || "—";
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
          <span className="fsmc-time">{utcTime || "—"}</span>
          <div className="fsmc-ticker"><span className="fsmc-ticker-sym">XAUUSD</span> {xauTick}</div>
          <div className="fsmc-ticker"><span className="fsmc-ticker-sym">BTCUSD</span> {btcTick}</div>
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
                    <div key={g.symbol} className={`fsmc-card ${(g.symbol === "XAUUSD" || g.symbol === "BTCUSD") ? 'full-width' : ''}`}>
                      <div className="fsmc-card-header">
                        <div className="fsmc-card-title">
                          {g.symbol}
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
                          <div className="grade-label" style={{ color }}>{g.grade.split(' ')[0]}</div>
                        </div>
                        <div style={{ flex: 1 }}>
                           <div style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '8px' }}>{g.grade_detail}</div>
                           <div className="factors-list">
                             {Object.values(g.factors || {}).map((f, idx) => (
                               <div key={idx} className="factor-item">
                                 <div className={`factor-dot ${f.pts > 0 ? 'dot-yes' : 'dot-no'}`} />
                                 <span style={{ flex: 1, color: f.pts > 0 ? 'var(--text-primary)' : 'var(--text-muted)' }}>{f.label}</span>
                                 <span style={{ color: 'var(--text-muted)' }}>{f.pts} pts</span>
                               </div>
                             ))}
                           </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
            </div>
          </div>
        )}

        {/* SWEEPS TAB */}
        {activeTab === "sweeps" && (
          <div className="fsmc-table-wrapper">
            <table className="fsmc-table">
              <thead>
                <tr>
                  <th>SYMBOL</th>
                  <th>LEVEL</th>
                  <th>LEVEL PRICE</th>
                  <th>WICK EXT.</th>
                  <th>CANDLE CLOSE</th>
                  <th>STATUS</th>
                  <th>AGE</th>
                </tr>
              </thead>
              <tbody>
                {sweepsData.sweeps.map((s, i) => {
                  let rowCls = "";
                  if (s.status === "ACTIVE") rowCls = "row-pulse row-amber";
                  else if (s.status === "CONFIRMED") rowCls = "row-emerald";
                  else if (s.status === "FAILED") rowCls = "strikethrough";
                  
                  if (s.sweep_type.includes("PDH") || s.sweep_type.includes("PWH")) rowCls += " row-rose";
                  if (s.sweep_type.includes("PDL") || s.sweep_type.includes("PWL")) rowCls += " row-emerald";

                  return (
                    <tr key={i} className={rowCls}>
                      <td style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                        {s.symbol}
                        {s.data_source === "DEMO" && <span className="fsmc-badge demo">DEMO</span>}
                      </td>
                      <td>{s.sweep_type.replace('_SWEEP', '')} <span style={{fontSize:'10px', color:'var(--text-muted)'}}>{s.strength}</span></td>
                      <td>{s.level_price}</td>
                      <td style={{ color: s.sweep_type.includes("H") ? "var(--accent-rose)" : "var(--accent-emerald)" }}>{s.wick_extreme}</td>
                      <td>{s.candle_close}</td>
                      <td>{s.status}</td>
                      <td>{Math.floor(s.time_elapsed_s / 60)}m ago</td>
                    </tr>
                  )
                })}
                {sweepsData.sweeps.length === 0 && <tr><td colSpan="7" style={{textAlign:'center', color:'var(--text-muted)'}}>No active sweeps detected</td></tr>}
              </tbody>
            </table>
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
                  <th>ALERT TYPE</th>
                  <th>BODY/ATR</th>
                  <th>CLOSE</th>
                  <th>AGE</th>
                </tr>
              </thead>
              <tbody>
                {dispData.alerts.map((a, i) => (
                  <tr key={i} className={a.expired ? 'strikethrough' : ''}>
                    <td>
                      {a.symbol}
                      {a.data_source === "DEMO" && <span className="fsmc-badge demo" style={{marginLeft:'8px'}}>DEMO</span>}
                    </td>
                    <td style={{ color: a.direction === "▲" ? 'var(--accent-emerald)' : 'var(--accent-rose)' }}>{a.direction}</td>
                    <td style={{ color: a.alert_type === "MSS_CONFIRMED" ? 'var(--accent-emerald)' : 'var(--accent-amber)' }}>{a.alert_type.replace('_', ' ')}</td>
                    <td>{a.body_atr_ratio}x</td>
                    <td>{a.candle_close}</td>
                    <td>{a.expired ? 'EXPIRED' : `${Math.floor(a.age_s / 60)}m ago`}</td>
                  </tr>
                ))}
                {dispData.alerts.length === 0 && <tr><td colSpan="6" style={{textAlign:'center', color:'var(--text-muted)'}}>No recent displacement candles</td></tr>}
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
                const posPct = Math.min(Math.max(((inst.ltp - inst.opening_range_low) / inst.range_width) * 100, 2), 98);
                
                return (
                  <div key={inst.symbol} className="fsmc-card">
                    <div className="fsmc-card-header">
                      <div className="fsmc-card-title">
                        {inst.symbol} <span style={{fontSize:'12px', color:'var(--text-muted)', fontWeight:400}}>NY Midnight OR</span>
                        {inst.data_source === "DEMO" && <span className="fsmc-badge demo">DEMO</span>}
                      </div>
                      <div style={{fontSize:'13px', fontFamily:'JetBrains Mono'}}>{formatINR(inst.ltp)}</div>
                    </div>
                    
                    <div className="or-band">
                      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                        <span>ORH</span> <span>{inst.opening_range_high}</span>
                      </div>
                      {inst.ltp !== "—" && (
                        <div className="or-ltp-dot" style={{ top: `${100 - posPct}%` }} />
                      )}
                      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                        <span>ORL</span> <span>{inst.opening_range_low}</span>
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
                  <span style={{ width: '80px', color: 'var(--accent-rose)' }}>{p.price}</span>
                  <div className="liq-pool-line liq-rose" />
                  <span style={{ width: '60px', textAlign: 'right', color: 'var(--text-muted)' }}>+{p.dist_pct}%</span>
                  <div style={{ display: 'flex', gap: '4px', width: '120px' }}>
                    {p.tags.map(t => <span key={t} className="fsmc-badge" style={{ background: 'hsla(343,90%,60%,0.1)', color: 'var(--accent-rose)' }}>{t}</span>)}
                  </div>
                </div>
              ))}
              
              <div className="liq-current">
                CURRENT PRICE: {liqData.ltp}
              </div>
              
              {(liqData.pools_below || []).map((p, i) => (
                <div key={`below-${i}`} className="liq-pool-row">
                  <span style={{ width: '80px', color: 'var(--accent-emerald)' }}>{p.price}</span>
                  <div className="liq-pool-line liq-emerald" />
                  <span style={{ width: '60px', textAlign: 'right', color: 'var(--text-muted)' }}>{p.dist_pct}%</span>
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
                <div key={row.symbol} className="mtf-grid">
                  <div style={{ fontWeight: 600 }}>{row.symbol}</div>
                  {["D1", "H4", "H1", "M15"].map(tf => {
                    const val = row[tf];
                    let cls = "bg-grey";
                    if (val === "BULLISH") cls = "bg-emerald";
                    else if (val === "BEARISH") cls = "bg-rose";
                    else if (val === "RANGING") cls = "bg-amber";
                    return <div key={tf} className={`mtf-cell ${cls}`}>{val}</div>
                  })}
                  <div className={`mtf-cell ${row.overall_bias.includes("BULL") ? "bg-emerald" : row.overall_bias.includes("BEAR") ? "bg-rose" : "bg-grey"}`}>
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
              return (
                <div key={sym} className="fsmc-card">
                  <div className="fsmc-card-title">{sym} COT Sentiment</div>
                  <div style={{ color: 'var(--text-muted)', fontSize: '13px' }}>{cot.label}</div>
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
              <div style={{ fontSize: '36px', fontWeight: 700, textAlign: 'center', margin: '16px 0', fontFamily: 'JetBrains Mono' }}>
                {sentimentData.fear_greed?.value}
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
