import React from 'react';
/* Signal Badge reuse logic */
const getSignalConfig = (signal) => {
  switch (signal) {
    case 'BULLISH': return { icon: '▲', color: '#16a34a', badge: '#f0fdf4', badgeText: '#16a34a' };
    case 'BEARISH': return { icon: '▼', color: '#dc2626', badge: '#fef2f2', badgeText: '#dc2626' };
    default:        return { icon: '◈', color: '#6b7280', badge: '#f9fafb', badgeText: '#6b7280' };
  }
};

function formatINR(num) {
  if (!num) return "—";
  return Number(num).toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function FnoTable({ title, data, type, onStockClick }) {
  const accent = type === 'gainer' ? 'var(--green)' : 'var(--red)';
  return (
    <div className="fno-table-container">
      <style jsx>{`
        .fno-table-container {
          background: var(--bg-card);
          border: 1px solid var(--glass-border);
          border-radius: var(--radius-lg);
          padding: 24px;
          backdrop-filter: blur(20px);
        }
        .fno-table-title {
          font-size: 14px;
          font-weight: 800;
          color: var(--text-muted);
          margin-bottom: 20px;
          letter-spacing: 1px;
          text-transform: uppercase;
        }
        .fno-table { width: 100%; border-collapse: collapse; }
        .fno-table th {
          text-align: left; font-size: 10px; font-weight: 700; color: var(--text-muted);
          padding: 12px; border-bottom: 1px solid var(--glass-border);
          text-transform: uppercase; letter-spacing: 1px;
        }
        .fno-table-row { cursor: pointer; transition: background 0.2s; }
        .fno-table-row:hover { background: hsla(0,0%,100%,0.03); }
        .fno-table td { padding: 14px 12px; font-size: 14px; border-bottom: 1px solid hsla(0,0%,100%,0.02); }
        .fno-symbol-text { font-weight: 800; color: #fff; margin-right: 8px; }
        .fno-pill { font-size: 9px; font-weight: 800; background: var(--blue-dim); color: var(--blue); padding: 2px 6px; border-radius: 4px; }
        .fno-chg { font-weight: 800; }
      `}</style>
      <h3 className="fno-table-title" style={{ color: accent }}>{title}</h3>
      <table className="fno-table">
        <thead>
          <tr>
            <th>Symbol</th>
            <th>LTP</th>
            <th>Chg%</th>
            <th>Vol</th>
          </tr>
        </thead>
        <tbody>
          {!data || data.length === 0 ? (
            Array.from({ length: 5 }).map((_, i) => (
              <tr key={i} className="fno-table-row" style={{ height: '49px' }}>
                <td colSpan="4" style={{ padding: '8px 12px' }}>
                  <div style={{
                    height: '20px', 
                    background: 'linear-gradient(90deg, rgba(255,255,255,0.02) 0%, rgba(255,255,255,0.05) 50%, rgba(255,255,255,0.02) 100%)',
                    backgroundSize: '200% 100%',
                    animation: 'shimmer 1.5s ease-in-out infinite',
                    borderRadius: '4px'
                  }}></div>
                </td>
              </tr>
            ))
          ) : (
            data.slice(0, 5).map((stock, i) => {
              const isUp = stock.change_pct > 0;
              return (
                <tr 
                  key={stock.symbol || i} 
                  onClick={() => onStockClick && onStockClick(stock.symbol)}
                  className="fno-table-row"
                >
                  <td>
                    <span className="fno-symbol-text">{stock.symbol}</span>
                    <span className="fno-pill">F&O</span>
                  </td>
                  <td style={{ fontWeight: '700' }}>₹{formatINR(stock.ltp)}</td>
                  <td className="fno-chg" style={{ color: isUp ? 'var(--green)' : 'var(--red)' }}>
                    {isUp ? '+' : ''}{(stock.change_pct || 0).toFixed(2)}%
                  </td>
                  <td style={{ color: 'var(--text-muted)', fontSize: '12px' }}>
                    {stock.vol_ratio && stock.vol_ratio >= 1.2 ? `🔥 ${stock.vol_ratio.toFixed(1)}x` : '-'}
                  </td>
                </tr>
              );
            })
          )}
        </tbody>
      </table>
    </div>
  );
}

export default function FnoMoversTable({ gainers, losers, onStockClick }) {
  return (
    <div className="fno-movers-section" style={{ padding: '0 24px 40px', maxWidth: '1400px', margin: '0 auto' }}>
      <style jsx>{`
        .fno-main-title { font-size: 12px; font-weight: 800; color: var(--text-muted); margin-bottom: 24px; letter-spacing: 2px; }
        .fno-movers-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(400px, 1fr)); gap: 24px; }
      `}</style>
      <h2 className="fno-main-title">F&O SECTOR ANALYSIS</h2>
      <div className="fno-movers-grid">
        <FnoTable title="Momentum Gainers" data={gainers} type="gainer" onStockClick={onStockClick} />
        <FnoTable title="Pressure Losers" data={losers} type="loser" onStockClick={onStockClick} />
      </div>
    </div>
  );
}
