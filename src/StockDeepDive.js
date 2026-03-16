import { useState } from "react";

export function useStockExplain() {
  const [activeStock,  setActiveStock]  = useState(null);
  const [explanation,  setExplanation]  = useState("");
  const [loading,      setLoading]      = useState(false);

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
    setLoading(false);
  };

  return { activeStock, explanation, loading, openExplain, closeExplain };
}

export function StockDeepDiveModal({ stock, explanation, loading, onClose }) {
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
              <span className="deepdive-prev">prev ₹{formatINR(stock.prev_close)}</span>
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
