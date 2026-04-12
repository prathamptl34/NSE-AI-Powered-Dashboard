import React, { useMemo } from 'react';

export default function MarketPulseHero({ niftyData, midcapData }) {
  const sentiment = useMemo(() => {
    const totalGainers = niftyData.gainers.length + midcapData.gainers.length;
    const totalLosers = niftyData.losers.length + midcapData.losers.length;
    const total = totalGainers + totalLosers;
    
    if (total === 0) return { score: 50, label: 'Neutral', color: 'var(--text-muted)' };
    
    const score = Math.round((totalGainers / total) * 100);
    let label = 'Neutral';
    let color = 'var(--text-muted)';
    
    if (score > 70) { label = 'Very Bullish'; color = 'var(--green)'; }
    else if (score > 55) { label = 'Bullish'; color = 'var(--green)'; }
    else if (score < 30) { label = 'Very Bearish'; color = 'var(--red)'; }
    else if (score < 45) { label = 'Bearish'; color = 'var(--red)'; }
    
    return { score, label, color };
  }, [niftyData, midcapData]);

  return (
    <div className="hero-container">
      <div className="hero-glass">
        <div className="hero-content">
          <div className="hero-left">
            <h1 className="hero-title">
              Market <span className="text-glow">Sentiment</span>
            </h1>
            <p className="hero-subtitle">
              Live AI-weighted analysis of 200 NSE tokens covering Nifty 100 & Midcap 100 segments.
            </p>
            
            <div className="sentiment-details">
              <div className="sentiment-stat">
                <span className="stat-value">{niftyData.gainers.length + midcapData.gainers.length}</span>
                <span className="stat-label">Gainers</span>
              </div>
              <div className="stat-divider" />
              <div className="sentiment-stat">
                <span className="stat-value">{niftyData.losers.length + midcapData.losers.length}</span>
                <span className="stat-label">Losers</span>
              </div>
            </div>
          </div>
          
          <div className="hero-right">
            <div className="speedometer-container">
              <div className="speedometer-track" />
              <div 
                className="speedometer-needle" 
                style={{ transform: `rotate(${(sentiment.score * 1.8) - 90}deg)` }} 
              />
              <div className="speedometer-center">
                <span className="sentiment-score">{sentiment.score}%</span>
                <span className="sentiment-label" style={{ color: sentiment.color }}>{sentiment.label}</span>
              </div>
            </div>
          </div>
        </div>
        
        <div className="hero-footer">
          <div className="pulse-indicator">
            <span className="pulse-dot" />
            <span className="pulse-text">AI Neural Engine Active</span>
          </div>
          <div className="hero-tags">
            <span className="hero-tag">Real-time Tick Data</span>
            <span className="hero-tag">Volume Weighted</span>
          </div>
        </div>
      </div>
      
      <style jsx>{`
        .hero-container {
          max-width: 1400px;
          margin: 32px auto 0;
          padding: 0 24px;
          width: 100%;
        }
        .hero-glass {
          background: var(--bg-card);
          backdrop-filter: blur(30px);
          -webkit-backdrop-filter: blur(30px);
          border: 1px solid var(--glass-border);
          border-radius: var(--radius-lg);
          padding: 40px;
          position: relative;
          overflow: hidden;
          box-shadow: var(--shadow-premium);
        }
        .hero-glass::before {
          content: '';
          position: absolute;
          top: -50%; left: -50%; width: 200%; height: 200%;
          background: radial-gradient(circle at center, hsla(var(--accent-blue), 0.05) 0%, transparent 50%);
          pointer-events: none;
        }
        .hero-content {
          display: flex;
          justify-content: space-between;
          align-items: center;
          gap: 40px;
          position: relative;
          z-index: 1;
        }
        .hero-title {
          font-size: 42px;
          font-weight: 800;
          letter-spacing: -2px;
          margin-bottom: 12px;
          color: #fff;
        }
        .text-glow {
          color: var(--blue);
          text-shadow: 0 0 20px hsla(var(--accent-blue), 0.5);
        }
        .hero-subtitle {
          color: var(--text-secondary);
          font-size: 16px;
          max-width: 440px;
          line-height: 1.6;
          margin-bottom: 32px;
        }
        .sentiment-details {
          display: flex;
          align-items: center;
          gap: 24px;
        }
        .sentiment-stat {
          display: flex;
          flex-direction: column;
        }
        .stat-value {
          font-size: 24px;
          font-weight: 700;
          color: var(--text-primary);
        }
        .stat-label {
          font-size: 12px;
          color: var(--text-muted);
          text-transform: uppercase;
          letter-spacing: 1px;
        }
        .stat-divider {
          width: 1px;
          height: 30px;
          background: var(--glass-border);
        }
        .speedometer-container {
          position: relative;
          width: 200px;
          height: 100px;
          overflow: hidden;
          display: flex;
          justify-content: center;
          align-items: flex-end;
        }
        .speedometer-track {
          position: absolute;
          width: 200px;
          height: 200px;
          border-radius: 50%;
          border: 12px solid hsla(0,0%,100%,0.05);
          border-bottom-color: transparent;
          border-left-color: transparent;
          transform: rotate(-135deg);
        }
        .speedometer-needle {
          position: absolute;
          width: 2px;
          height: 80px;
          background: #fff;
          bottom: 0;
          left: 50%;
          transform-origin: bottom center;
          transition: transform 1.5s cubic-bezier(0.2, 0.8, 0.2, 1);
          box-shadow: 0 0 10px #fff;
          z-index: 2;
        }
        .speedometer-center {
          position: absolute;
          bottom: 8px;
          display: flex;
          flex-direction: column;
          align-items: center;
          z-index: 3;
        }
        .sentiment-score {
          font-size: 32px;
          font-weight: 800;
          color: #fff;
          margin-bottom: 2px;
          line-height: 1;
        }
        .sentiment-label {
          font-size: 11px;
          font-weight: 800;
          text-transform: uppercase;
          letter-spacing: 1.5px;
          opacity: 0.9;
        }
        .hero-footer {
          margin-top: 40px;
          padding-top: 24px;
          border-top: 1px solid var(--glass-border);
          display: flex;
          justify-content: space-between;
          align-items: center;
          position: relative;
          z-index: 1;
        }
        .pulse-indicator {
          display: flex;
          align-items: center;
          gap: 10px;
        }
        .pulse-dot {
          width: 8px;
          height: 8px;
          background: var(--blue);
          border-radius: 50%;
          box-shadow: 0 0 15px var(--blue);
          animation: pulse 2s infinite;
        }
        .pulse-text {
          font-size: 11px;
          font-weight: 700;
          color: var(--text-muted);
          text-transform: uppercase;
          letter-spacing: 1px;
        }
        .hero-tags {
          display: flex;
          gap: 12px;
        }
        .hero-tag {
          font-size: 10px;
          font-weight: 600;
          padding: 4px 10px;
          background: hsla(0,0%,100%,0.04);
          border: 1px solid var(--glass-border);
          border-radius: 6px;
          color: var(--text-secondary);
        }
        @keyframes pulse {
          0% { transform: scale(1); opacity: 1; }
          50% { transform: scale(1.5); opacity: 0.5; }
          100% { transform: scale(1); opacity: 1; }
        }
        @media (max-width: 768px) {
          .hero-content { flex-direction: column; text-align: center; }
          .hero-subtitle { margin-left: auto; margin-right: auto; }
          .sentiment-details { justify-content: center; }
          .hero-footer { flex-direction: column; gap: 16px; text-align: center; }
        }
      `}</style>
    </div>
  );
}
