import { useState } from "react";

export function useStockExplain() {
  const [activeStock,  setActiveStock]  = useState(null);
  const [explanation,  setExplanation]  = useState("");
  const [multiAgentData, setMultiAgentData] = useState(null);
  const [loading,      setLoading]      = useState(false);
  const [loadingMA,    setLoadingMA]    = useState(false);

  const openExplain = async (stock) => {
    document.body.style.overflow = 'hidden';
    setActiveStock(stock);
    setExplanation("");
    setLoading(true);
    try {
      const params = new URLSearchParams({
        symbol:     stock.symbol,
        change_pct: stock.change_pct,
        price:      stock.price,
        prev_close: stock.prev_close || 0,
        signal:     stock.change_pct >= 0 ? "BULLISH" : "BEARISH",
      });
      const res  = await fetch(`/api/stock-explain?${params}`);
      const data = await res.json();
      setExplanation(data.explanation || data.error || "No explanation available.");
      
      // Also fetch Multi-Agent Analysis
      setLoadingMA(true);
      try {
        const maRes = await fetch(`/api/tv/multi-agent/${stock.symbol}`);
        if (maRes.ok) {
          const maData = await maRes.json();
          setMultiAgentData(maData);
        }
      } catch (err) {
        console.error("Multi-agent fetch failed:", err);
      } finally {
        setLoadingMA(false);
      }
    } catch {
      closeExplain(); // Cleanup scroll and state on error
      setExplanation("Failed to connect to server. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const closeExplain = () => {
    document.body.style.overflow = '';
    setActiveStock(null);
    setExplanation("");
    setMultiAgentData(null);
    setLoading(false);
    setLoadingMA(false);
  };

  return { activeStock, explanation, loading, openExplain, closeExplain };
}

export function StockDeepDiveModal({ stock, explanation, multiAgentData, loading, loadingMA, onClose }) {
  if (!stock) return null;

  const isUp      = stock.change_pct >= 0;
  const accentColor = isUp ? "#16a34a" : "#dc2626";
  const bgColor     = isUp ? "#f0fdf4" : "#fef2f2";
  const badgeBg     = isUp ? "#dcfce7" : "#fee2e2";

  // Parse sections from AI response
  const parseSection = (text, header) => {
    if (!text) return "";
    const regex = new RegExp(`${header}[:\\s]*([\\s\\S]*?)(?=WHY IT|WHAT TO|RISK:|$)`, 'i');
    const match = text.match(regex);
    return match ? match[1].trim() : "";
  };

  const whySection   = parseSection(explanation, "WHY IT'S MOVING");
  const watchSection = parseSection(explanation, "WHAT TO WATCH");
  const riskSection  = parseSection(explanation, "RISK");

  const handleBackdrop = (e) => {
    if (e.target === e.currentTarget) onClose();
  };

  return (
    <div className="deepdive-backdrop" onClick={handleBackdrop}>
      <div className="deepdive-modal" style={{ borderTop: `3px solid ${accentColor}` }}>

        {/* Header */}
        <div className="deepdive-header">
          <div className="deepdive-header-left">
            <span className="deepdive-symbol">{stock.symbol}</span>
            <span className="deepdive-badge" style={{ background: badgeBg, color: accentColor }}>
              {isUp ? "▲" : "▼"} {Math.abs(stock.change_pct).toFixed(2)}%
            </span>
          </div>
          <div className="deepdive-header-right">
            <span className="deepdive-price">₹{formatINR(stock.price)}</span>
            {stock.prev_close > 0 && (
              <span className="deepdive-prev">
                <span style={{ opacity: 0.6, marginRight: '4px' }}>prev</span>
                ₹{formatINR(stock.prev_close)}
              </span>
            )}
          </div>
          <button className="deepdive-close" onClick={onClose}>✕</button>
        </div>

        {/* AI Label */}
        <div className="deepdive-ai-bar">
          <span className="deepdive-ai-dot" />
          <span className="deepdive-ai-label">AI DEEP DIVE — GROQ LLaMA 3.3</span>
        </div>

        {/* Content */}
        <div className="deepdive-content">
          {loading ? (
            <div className="deepdive-loading">
              <div className="deepdive-dots">
                <span /><span /><span />
              </div>
              <p className="deepdive-loading-text">
                Analyzing {stock.symbol} with live market context...
              </p>
            </div>
          ) : (
            <>
              {/* Why Moving */}
              {whySection ? (
                <div className="deepdive-section">
                  <div className="deepdive-section-label" style={{ color: accentColor }}>
                    WHY IT'S MOVING
                  </div>
                  <p className="deepdive-section-text">{whySection}</p>
                </div>
              ) : (
                <div className="deepdive-section">
                  <p className="deepdive-section-text">{explanation}</p>
                </div>
              )}

              {/* What to Watch */}
              {watchSection && (
                <div className="deepdive-section">
                  <div className="deepdive-section-label">WHAT TO WATCH</div>
                  <div className="deepdive-watch-list">
                    {watchSection.split('\n')
                      .filter(l => l.trim())
                      .map((line, i) => (
                        <div key={i} className="deepdive-watch-item">
                          <span className="deepdive-watch-dot"
                            style={{ background: accentColor }} />
                          <span>{line.replace(/^[-•*]\s*/, '')}</span>
                        </div>
                      ))
                    }
                  </div>
                </div>
              )}

              {/* Risk */}
              {riskSection && (
                <div className="deepdive-risk-box">
                  <span className="deepdive-risk-label">⚠ RISK</span>
                  <p className="deepdive-risk-text">{riskSection}</p>
                </div>
              )}

              {/* TradingView Multi-Agent Analysis */}
              {multiAgentData && (
                <div className="deepdive-ma-card">
                  <div className="deepdive-ma-header">
                    <span className="deepdive-ma-label">TRADINGVIEW MULTI-AGENT DEBATE</span>
                    <div className="deepdive-ma-consensus" data-stance={multiAgentData.consensus?.decision}>
                      {multiAgentData.consensus?.decision}
                    </div>
                  </div>
                  
                  <div className="deepdive-ma-agents">
                    {multiAgentData.agents?.map((agent, i) => (
                      <div key={i} className="deepdive-ma-agent">
                        <div className="ma-agent-top">
                          <span className="ma-agent-name">{agent.agent_name}</span>
                          <span className="ma-agent-stance" data-stance={agent.stance}>{agent.stance}</span>
                        </div>
                        <p className="ma-agent-reason">{agent.reasoning}</p>
                      </div>
                    ))}
                  </div>

                  <div className="deepdive-ma-summary">
                    <strong>CONSENSUS:</strong> {multiAgentData.consensus?.summary}
                  </div>
                </div>
              )}

              {loadingMA && !multiAgentData && (
                <div className="deepdive-ma-loading-shimmer">
                  Running multi-agent technical debate...
                </div>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        <div className="deepdive-footer">
          For informational purposes only. Not SEBI registered investment advice.
        </div>

      </div>
    </div>
  );
}

function formatINR(num) {
  if (!num) return "—";
  return Number(num).toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}
