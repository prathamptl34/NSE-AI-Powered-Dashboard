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
  return (
    <div className="fno-table-container">
      <h3 className={`fno-table-title ${type === 'gainer' ? 'fno-title-gainer' : 'fno-title-loser'}`}>{title}</h3>
      <table className="fno-table">
        <thead>
          <tr>
            <th>#</th>
            <th>Symbol</th>
            <th>Sector</th>
            <th>LTP</th>
            <th>Chg%</th>
            <th>Vol Ratio</th>
            <th>Signal</th>
          </tr>
        </thead>
        <tbody>
          {data && data.map((stock, i) => {
            const sc = getSignalConfig(stock.signal);
            const isUp = stock.change_pct > 0;
            const isDown = stock.change_pct < 0;
            return (
              <tr 
                key={stock.symbol || i} 
                onClick={() => onStockClick && onStockClick(stock.symbol)}
                className="fno-table-row"
              >
                <td>{i + 1}</td>
                <td>
                  <span className="fno-symbol-text">{stock.symbol}</span>
                  <span className="fno-pill">F&O</span>
                </td>
                <td className="fno-sector">{stock.sector || 'Unknown'}</td>
                <td className="fno-ltp">₹{formatINR(stock.ltp)}</td>
                <td className={`fno-chg ${isUp ? 'fno-bg-green' : isDown ? 'fno-bg-red' : ''}`}>
                  {isUp ? '+' : ''}{(stock.change_pct || 0).toFixed(2)}%
                </td>
                <td className="fno-vol">
                  {stock.vol_ratio && stock.vol_ratio >= 1.5 ? `🔥 ${stock.vol_ratio.toFixed(1)}x` : '-'}
                </td>
                <td>
                  <span className="sc-card-signal-badge" style={{ background: sc.badge, color: sc.badgeText, whiteSpace: 'nowrap', padding: '4px 8px', borderRadius: '4px', fontSize: '12px', fontWeight: 'bold' }}>
                    {sc.icon} {stock.signal || 'NEUTRAL'}
                  </span>
                </td>
              </tr>
            );
          })}
          {(!data || data.length === 0) && (
            <tr>
              <td colSpan="7" className="fno-empty">No data available</td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

export default function FnoMoversTable({ gainers, losers, onStockClick }) {
  return (
    <div className="fno-movers-section">
      <h2 className="fno-main-title">🔶 F&O Top Movers</h2>
      <div className="fno-movers-grid">
        <FnoTable title="Top Gainers" data={gainers} type="gainer" onStockClick={onStockClick} />
        <FnoTable title="Top Losers" data={losers} type="loser" onStockClick={onStockClick} />
      </div>
    </div>
  );
}
