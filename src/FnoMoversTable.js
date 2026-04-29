import React, { useState, useEffect, useRef } from 'react';

function formatINR(num) {
  if (!num) return "—";
  return Number(num).toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function FnoRow({ stock, index, type, onStockClick }) {
  const isUp = stock.change_pct > 0;
  const accentColor = isUp ? 'var(--green)' : 'var(--red)';
  const arrow = isUp ? '▲' : '▼';
  
  return (
    <div 
      className="fno-row"
      onClick={() => onStockClick && onStockClick(stock.symbol)}
    >
      <div className="fno-row-left">
        <div className={`fno-rank fno-rank-${type}`}>
          {String(index + 1).padStart(2, '0')}
        </div>
        <div className="fno-meta">
          <div className="fno-symbol-group">
            <span className="fno-symbol">{stock.symbol}</span>
            <span className="fno-badge">F&O</span>
          </div>
          <div className="fno-vol-info">
            {stock.vol_ratio && stock.vol_ratio >= 1.2 ? (
              <span className="fno-fire">🔥 {stock.vol_ratio.toFixed(1)}x Vol</span>
            ) : (
              <span className="fno-vol-normal">Avg Vol</span>
            )}
          </div>
        </div>
      </div>
      
      <div className="fno-row-right">
        <div className="fno-price-group">
          <span className="fno-price">₹{formatINR(stock.ltp)}</span>
        </div>
        <div className={`fno-change-pill ${isUp ? 'pill-green' : 'pill-red'}`}>
          <span className="fno-change-arrow">{arrow}</span>
          <span className="fno-change-val">{Math.abs(stock.change_pct || 0).toFixed(2)}%</span>
        </div>
      </div>
    </div>
  );
}

function FnoTable({ title, data, type, onStockClick }) {
  const isGainer = type === 'gainer';
  const accentVar = isGainer ? 'var(--green)' : 'var(--red)';
  const glowVar = isGainer ? 'var(--glow-green)' : 'var(--glow-red)';

  return (
    <div className="fno-panel" style={{ '--panel-accent': accentVar, '--panel-glow': glowVar }}>
      <div className="fno-panel-header">
        <div className="fno-panel-icon">{isGainer ? '🚀' : '📉'}</div>
        <h3 className="fno-panel-title">{title}</h3>
      </div>
      
      <div className="fno-panel-body">
        {!data || data.length === 0 ? (
          Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="fno-skeleton-row">
              <div className="fno-skeleton-pulse"></div>
            </div>
          ))
        ) : (
          data.slice(0, 5).map((stock, i) => (
            <FnoRow 
              key={stock.symbol || i} 
              stock={stock} 
              index={i} 
              type={type} 
              onStockClick={onStockClick} 
            />
          ))
        )}
      </div>
    </div>
  );
}

export default function FnoMoversTable({ gainers, losers, onStockClick }) {
  return (
    <div className="fno-movers-section">
      <style jsx>{`
        .fno-movers-section {
          padding: 0 24px 40px;
          max-width: 1400px;
          margin: 0 auto;
        }
        .fno-main-title { 
          font-size: 13px; 
          font-weight: 800; 
          color: var(--text-muted); 
          margin-bottom: 24px; 
          letter-spacing: 2px; 
          display: flex;
          align-items: center;
          gap: 12px;
        }
        .fno-main-title::after {
          content: '';
          flex: 1;
          height: 1px;
          background: linear-gradient(90deg, var(--glass-border) 0%, transparent 100%);
        }
        .fno-movers-grid { 
          display: grid; 
          grid-template-columns: repeat(auto-fit, minmax(400px, 1fr)); 
          gap: 32px; 
        }

        /* Panel Styling */
        .fno-panel {
          background: var(--bg-card);
          border: 1px solid var(--glass-border);
          border-radius: var(--radius-lg);
          padding: 24px;
          backdrop-filter: blur(20px);
          position: relative;
          overflow: hidden;
          box-shadow: 0 8px 32px rgba(0, 0, 0, 0.2);
          transition: transform 0.3s ease, box-shadow 0.3s ease;
        }
        .fno-panel:hover {
          box-shadow: 0 12px 40px rgba(0, 0, 0, 0.4), var(--panel-glow);
          transform: translateY(-2px);
        }
        .fno-panel::before {
          content: '';
          position: absolute;
          top: 0; left: 0; width: 100%; height: 3px;
          background: var(--panel-accent);
          box-shadow: 0 0 10px var(--panel-accent);
        }

        /* Header */
        .fno-panel-header {
          display: flex;
          align-items: center;
          gap: 12px;
          margin-bottom: 24px;
        }
        .fno-panel-icon {
          font-size: 20px;
          filter: drop-shadow(0 2px 4px rgba(0,0,0,0.5));
        }
        .fno-panel-title {
          font-size: 15px;
          font-weight: 800;
          color: var(--panel-accent);
          letter-spacing: 1px;
          text-transform: uppercase;
          margin: 0;
        }

        /* Rows */
        .fno-panel-body {
          display: flex;
          flex-direction: column;
          gap: 12px;
        }
        .fno-row {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 16px;
          background: hsla(0, 0%, 100%, 0.02);
          border: 1px solid hsla(0, 0%, 100%, 0.04);
          border-radius: 12px;
          cursor: pointer;
          transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
        }
        .fno-row:hover {
          background: hsla(0, 0%, 100%, 0.05);
          border-color: hsla(0, 0%, 100%, 0.1);
          transform: translateX(4px);
        }
        
        .fno-row-left {
          display: flex;
          align-items: center;
          gap: 16px;
        }
        .fno-rank {
          font-size: 13px;
          font-weight: 800;
          opacity: 0.6;
          width: 24px;
          text-align: center;
        }
        .fno-rank-gainer { color: var(--green); }
        .fno-rank-loser { color: var(--red); }
        
        .fno-meta {
          display: flex;
          flex-direction: column;
          gap: 4px;
        }
        .fno-symbol-group {
          display: flex;
          align-items: center;
          gap: 8px;
        }
        .fno-symbol {
          font-size: 16px;
          font-weight: 800;
          color: #fff;
          letter-spacing: 0.5px;
        }
        .fno-badge {
          font-size: 9px;
          font-weight: 800;
          background: var(--blue-dim);
          color: var(--blue);
          padding: 2px 6px;
          border-radius: 6px;
          letter-spacing: 0.5px;
        }
        .fno-vol-info {
          font-size: 11px;
          font-weight: 600;
        }
        .fno-fire {
          color: #f97316;
          text-shadow: 0 0 8px rgba(249, 115, 22, 0.4);
        }
        .fno-vol-normal {
          color: var(--text-muted);
        }

        .fno-row-right {
          display: flex;
          flex-direction: column;
          align-items: flex-end;
          gap: 4px;
          background: rgba(0, 0, 0, 0.2);
          padding: 8px 12px;
          border-radius: 8px;
          border: 1px solid rgba(255, 255, 255, 0.03);
          min-width: 110px;
        }
        .fno-price {
          font-size: 20px;
          font-weight: 900;
          color: #fff;
          letter-spacing: -0.5px;
          line-height: 1;
        }
        .fno-change-pill {
          display: flex;
          align-items: center;
          gap: 4px;
          padding: 4px 8px;
          border-radius: 6px;
          font-size: 12px;
          font-weight: 800;
        }
        .pill-green {
          background: rgba(22, 163, 74, 0.15);
          color: var(--green);
          border: 1px solid rgba(22, 163, 74, 0.2);
        }
        .pill-red {
          background: rgba(220, 38, 38, 0.15);
          color: var(--red);
          border: 1px solid rgba(220, 38, 38, 0.2);
        }

        /* Skeletons */
        .fno-skeleton-row {
          height: 64px;
          border-radius: 12px;
          background: hsla(0, 0%, 100%, 0.02);
          border: 1px solid hsla(0, 0%, 100%, 0.04);
          overflow: hidden;
          position: relative;
        }
        .fno-skeleton-pulse {
          position: absolute;
          top: 0; left: 0; right: 0; bottom: 0;
          background: linear-gradient(90deg, transparent 0%, hsla(0,0%,100%,0.03) 50%, transparent 100%);
          animation: pulse 1.5s infinite;
        }
        @keyframes pulse {
          0% { transform: translateX(-100%); }
          100% { transform: translateX(100%); }
        }
      `}</style>
      <h2 className="fno-main-title">F&O SECTOR HIGHLIGHTS</h2>
      <div className="fno-movers-grid">
        <FnoTable title="Momentum Gainers" data={gainers} type="gainer" onStockClick={onStockClick} />
        <FnoTable title="Pressure Losers" data={losers} type="loser" onStockClick={onStockClick} />
      </div>
    </div>
  );
}
