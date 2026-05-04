import React, { useRef, useEffect } from 'react';

const MoverRow = ({ stock, rank, type }) => {
  const prevPrice = useRef(stock.ltp);
  const rowRef = useRef(null);

  useEffect(() => {
    if (stock.ltp !== prevPrice.current) {
      const animClass = stock.ltp > prevPrice.current ? 'flash-up-anim' : 'flash-down-anim';
      rowRef.current?.classList.remove('flash-up-anim', 'flash-down-anim');
      
      // Trigger reflow to restart animation
      void rowRef.current?.offsetWidth;
      
      rowRef.current?.classList.add(animClass);
      prevPrice.current = stock.ltp;
      
      const timer = setTimeout(() => {
        rowRef.current?.classList.remove(animClass);
      }, 1000);
      return () => clearTimeout(timer);
    }
  }, [stock.ltp]);

  const accentColor = type === 'up' ? 'hsl(160, 84%, 39%)' : 'hsl(343, 90%, 60%)';
  const badgeClass = type === 'up' ? 'pill-stock-up' : 'pill-stock-down';

  return (
    <div className="mover-row" ref={rowRef}>
      <div className="mover-info">
        <span className="mover-rank" style={{ color: accentColor }}>#{String(rank).padStart(2, '0')}</span>
        <div className="mover-symbol-box">
          <span className="mover-symbol">{stock.symbol}</span>
          <span className="mover-sector">{stock.sector.replace('_', ' ')}</span>
        </div>
      </div>
      <div className="mover-data">
        <span className="mover-price">₹{Number(stock.ltp).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>
        <span className={`mover-badge ${badgeClass}`}>
          {type === 'up' ? '+' : ''}{stock.change_pct.toFixed(2)}%
        </span>
      </div>
    </div>
  );
};

const MoversSection = ({ moversData }) => {
  const { gainers = [], losers = [] } = moversData || {};

  return (
    <div className="movers-section">
      <div className="movers-header">
        <div className="movers-title-box">
          <span className="movers-icon">⚡</span>
          <h2 className="movers-main-title">MOVERS ALERT — ±3%</h2>
          <div className="live-dot" />
        </div>
      </div>

      <div className="movers-columns">
        {/* Gainers Column */}
        <div className="movers-col">
          <div className="col-header col-up">
            <span className="col-icon">🚀</span>
            <span className="col-label">SURGING +3%</span>
            <span className="col-count">{gainers.length}</span>
          </div>
          <div className="movers-list">
            {gainers.length === 0 ? (
              <div className="movers-empty">No stocks crossing +3% yet</div>
            ) : (
              gainers.map((stock, i) => (
                <MoverRow key={stock.symbol} stock={stock} rank={i + 1} type="up" />
              ))
            )}
          </div>
        </div>

        {/* Losers Column */}
        <div className="movers-col">
          <div className="col-header col-down">
            <span className="col-icon">🔻</span>
            <span className="col-label">FALLING -3%</span>
            <span className="col-count">{losers.length}</span>
          </div>
          <div className="movers-list">
            {losers.length === 0 ? (
              <div className="movers-empty">No stocks crossing -3% yet</div>
            ) : (
              losers.map((stock, i) => (
                <MoverRow key={stock.symbol} stock={stock} rank={i + 1} type="down" />
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default React.memo(MoversSection);
