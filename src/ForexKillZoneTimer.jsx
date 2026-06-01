import React, { useState, useEffect, memo } from "react";

// SESSIONS CONSTANTS
const SESSIONS = [
  { id: "ASIAN", name: "ASIAN SESSION", startHour: 0, endHour: 6, color: "var(--accent-blue)", desc: "Accumulation / Liquidity Formation" },
  { id: "LONDON_KZ", name: "LONDON KILL ZONE", startHour: 7, endHour: 10, color: "var(--accent-amber)", desc: "Manipulation / Trend Origin", pulse: true },
  { id: "NY_KZ", name: "NY KILL ZONE", startHour: 12, endHour: 15, color: "var(--accent-rose)", desc: "Distribution / Reversal", pulse: true },
  { id: "LONDON_CLOSE", name: "LONDON CLOSE", startHour: 16, endHour: 18, color: "var(--accent-emerald)", desc: "Retracement / Range Completion" },
  { id: "DEAD_ZONE", name: "DEAD ZONE", startHour: 18, endHour: 24, color: "#6b7280", desc: "No SMC Setups" },
];

const NY_MIDNIGHT = 5; // 05:00 UTC

function getActiveSession(utcHour) {
  for (let s of SESSIONS) {
    if (utcHour >= s.startHour && utcHour < s.endHour) return s;
  }
  // Gaps (e.g., 06:00-07:00, 10:00-12:00, 15:00-16:00)
  return { id: "GAP", name: "SESSION TRANSITION", color: "var(--text-muted)", desc: "Waiting for next Kill Zone" };
}

const ForexKillZoneTimer = memo(() => {
  const [nowUTC, setNowUTC] = useState(Date.now());

  useEffect(() => {
    const t = setInterval(() => setNowUTC(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const d = new Date(nowUTC);
  const h = d.getUTCHours();
  const m = d.getUTCMinutes();
  const s = d.getUTCSeconds();

  const totalSeconds = h * 3600 + m * 60 + s;
  const percentComplete = (totalSeconds / 86400) * 100;

  const activeSession = getActiveSession(h);
  
  // Calculate time to next session or end of current
  let nextEventTime = 0;
  if (activeSession.id !== "GAP") {
      nextEventTime = activeSession.endHour * 3600;
  } else {
      for (let sess of SESSIONS) {
          if (sess.startHour > h) {
              nextEventTime = sess.startHour * 3600;
              break;
          }
      }
      if (nextEventTime === 0) nextEventTime = 24 * 3600;
  }
  
  const diffSecs = nextEventTime - totalSeconds;
  const countdownMins = Math.floor(diffSecs / 60);
  const countdownSecs = diffSecs % 60;
  const countdownStr = `${String(countdownMins).padStart(2, "0")}:${String(countdownSecs).padStart(2, "0")}`;

  return (
    <div className={`forex-kz-container ${activeSession.pulse ? 'kz-pulse' : ''}`} style={{ borderColor: activeSession.pulse ? activeSession.color : 'transparent' }}>
      
      {activeSession.id === "DEAD_ZONE" && (
        <div className="dead-zone-banner" style={{ background: "rgba(107, 114, 128, 0.2)", color: "#9ca3af", padding: "6px 12px", borderRadius: "4px", marginBottom: "12px", fontSize: "12px", fontWeight: 600, display: "flex", alignItems: "center", gap: "8px" }}>
          <span>⚠</span> Dead Zone Active — No High-Probability SMC Setups
        </div>
      )}

      <div className="kz-header">
        <div className="kz-header-left">
          <span className="kz-active-badge" style={{ backgroundColor: activeSession.color, color: "#000" }}>
            {activeSession.name}
          </span>
          <span className="kz-desc">{activeSession.desc}</span>
        </div>
        <div className="kz-header-right">
          <span className="kz-countdown-label">Next Phase in</span>
          <span className="kz-countdown">{countdownStr}</span>
        </div>
      </div>

      <div className="kz-timeline">
        <div className="kz-timeline-track">
          {SESSIONS.map(sess => (
            <div 
              key={sess.id}
              className="kz-timeline-segment"
              style={{
                left: `${(sess.startHour / 24) * 100}%`,
                width: `${((sess.endHour - sess.startHour) / 24) * 100}%`,
                backgroundColor: sess.color,
                opacity: activeSession.id === sess.id ? 0.8 : 0.3
              }}
            />
          ))}
          
          <div 
            className="kz-ny-midnight"
            style={{ left: `${(NY_MIDNIGHT / 24) * 100}%` }}
            title="NY Midnight Open (05:00 UTC)"
          >
            <div className="kz-ny-line" />
            <div className="kz-ny-label">NY MIDNIGHT OPEN</div>
          </div>

          <div 
            className="kz-live-needle"
            style={{ left: `${percentComplete}%` }}
          />
        </div>
        
        <div className="kz-timeline-labels">
          <span>00:00 UTC</span>
          <span>06:00</span>
          <span>12:00</span>
          <span>18:00</span>
          <span>24:00</span>
        </div>
      </div>
    </div>
  );
});

export default ForexKillZoneTimer;
