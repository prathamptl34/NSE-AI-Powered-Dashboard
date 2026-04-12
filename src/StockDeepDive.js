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

  const isUp = stock.change_pct >= 0;
  const accent = isUp ? 'var(--green)' : 'var(--red)';
  const dim    = isUp ? 'var(--green-dim)' : 'var(--red-dim)';

  const handleBackdrop = (e) => {
    if (e.target === e.currentTarget) onClose();
  };

  return (
    <div className="sdm-backdrop" onClick={handleBackdrop}>
      <style jsx>{`
        .sdm-backdrop {
          position: fixed; top: 0; left: 0; width: 100%; height: 100%;
          background: rgba(0,0,0,0.85); backdrop-filter: blur(12px);
          z-index: 1000; display: flex; align-items: center; justify-content: center;
        }
        .sdm-modal {
          width: 90%; max-width: 600px; max-height: 90vh;
          background: var(--bg-soft); border-radius: var(--radius-lg);
          border: 1px solid var(--glass-border); overflow-y: auto;
          box-shadow: var(--shadow-premium); padding: 40px; position: relative;
        }
        .sdm-header { display: flex; justify-content: space-between; margin-bottom: 32px; align-items: flex-start; }
        .sdm-symbol { font-size: 32px; font-weight: 800; color: #fff; display: block; letter-spacing: -1px; }
        .sdm-price { font-size: 32px; font-weight: 800; color: #fff; text-align: right; display: block; }
        
        .sdm-ai-strip {
          background: hsla(0,0%,100%,0.03); padding: 12px 20px; border-radius: 10px;
          margin-bottom: 32px; display: flex; align-items: center; gap: 12px;
          border: 1px solid var(--glass-border);
        }
        .ai-pulse { width: 8px; height: 8px; border-radius: 50%; background: var(--blue); box-shadow: 0 0 10px var(--blue); }
        .ai-label { font-size: 11px; font-weight: 800; color: var(--text-muted); letter-spacing: 1px; }

        .sdm-section { margin-bottom: 32px; }
        .sdm-section-title { font-size: 11px; font-weight: 800; color: var(--text-muted); margin-bottom: 12px; letter-spacing: 1px; }
        .sdm-text { font-size: 16px; line-height: 1.7; color: var(--text-secondary); }

        .sdm-ma-card {
           background: hsla(0,0%,100%,0.02); border: 1px solid var(--glass-border);
           border-radius: var(--radius-md); padding: 24px; margin-top: 40px;
        }
        .ma-consensus { padding: 8px 16px; border-radius: 8px; font-weight: 800; font-size: 14px; text-transform: uppercase; }
      `}</style>

      <div className="sdm-modal" style={{ borderTop: `4px solid ${accent}` }}>
        <div className="sdm-header">
           <div>
             <span className="sdm-symbol">{stock.symbol}</span>
             <span style={{ fontSize: '14px', fontWeight: '800', color: accent }}>
               {isUp ? '▲' : '▼'} {Math.abs(stock.change_pct).toFixed(2)}%
             </span>
           </div>
           <div>
             <span className="sdm-price">₹{formatINR(stock.price)}</span>
             <span style={{ display: 'block', textAlign: 'right', fontSize: '11px', color: 'var(--text-muted)' }}>LIVE CMP</span>
           </div>
        </div>

        <div className="sdm-ai-strip">
           <div className="ai-pulse" />
           <span className="ai-label">NEURAL ENGINE ANALYSIS ACTIVE</span>
        </div>

        <div className="sdm-content">
          {loading ? (
             <div style={{ padding: '40px 0', textAlign: 'center' }}>
               <div style={{ fontSize: '14px', fontWeight: '700', color: 'var(--text-muted)' }}>Synthesizing knowledge...</div>
             </div>
          ) : (
             <>
               <div className="sdm-section">
                  <div className="sdm-section-title" style={{ color: accent }}>AI INSIGHT</div>
                  <p className="sdm-text">{explanation}</p>
               </div>

               {multiAgentData && (
                 <div className="sdm-ma-card">
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
                       <span className="ai-label">MULTI-AGENT TECHNICAL DEBATE</span>
                       <span className="ma-consensus" style={{ background: dim, color: accent }}>{multiAgentData.consensus?.decision}</span>
                    </div>
                    <p style={{ fontSize: '14px', color: var('--text-secondary'), lineHeight: '1.6' }}>{multiAgentData.consensus?.summary}</p>
                 </div>
               )}
             </>
          )}
        </div>

        <button onClick={onClose} style={{ width: '100%', marginTop: '40px', padding: '14px', borderRadius: '12px', border: '1px solid var(--glass-border)', background: 'transparent', color: '#fff', fontWeight: '800', cursor: 'pointer' }}>Close Deep Dive</button>
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
