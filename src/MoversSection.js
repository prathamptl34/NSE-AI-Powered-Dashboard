import React, { useRef, useEffect } from 'react';

const MoverRow = ({ stock, rank, type }) => {
  const prevPrice = useRef(stock.ltp);
  const rowRef = useRef(null);

  useEffect(() => {
    if (stock.ltp !== prevPrice.current) {
      const animClass = stock.ltp > prevPrice.current ? 'flash-up-anim' : 'flash-down-anim';
      rowRef.current?.classList.remove('flash-up-anim', 'flash-down-anim');
      void rowRef.current?.offsetWidth;
      rowRef.current?.classList.add(animClass);
      prevPrice.current = stock.ltp;
      const timer = setTimeout(() => {
        rowRef.current?.classList.remove(animClass);
      }, 1000);
      return () => clearTimeout(timer);
    }
  }, [stock.ltp]);

  const isUp = type === 'up';
  const rowBg     = isUp ? 'hsla(160, 84%, 39%, 0.08)' : 'hsla(343, 90%, 60%, 0.08)';
  const rowBorder = isUp ? '1px solid hsla(160, 84%, 39%, 0.15)' : '1px solid hsla(343, 90%, 60%, 0.15)';
  const accentColor = isUp ? 'hsl(160, 84%, 39%)' : 'hsl(343, 90%, 60%)';
  const badgeClass = isUp ? 'pill-stock-up' : 'pill-stock-down';

  return (
    <div
      className="mover-row"
      ref={rowRef}
      style={{ background: rowBg, border: rowBorder }}
    >
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
          {isUp ? '+' : ''}{stock.change_pct.toFixed(2)}%
        </span>
      </div>
    </div>
  );
};

const MoversSection = ({ moversData }) => {
  const { gainers = [], losers = [] } = moversData || {};

  return (
    <div className="movers-section">
      <div className="movers-columns" style={{ alignItems: 'start' }}>
        {/* Gainers Column */}
        <div className="movers-col">
          <div className="col-header col-up">
            <span className="col-icon">🚀</span>
            <span className="col-label">SURGING +3%</span>
            <span className="col-count col-count-badge">{gainers.length}</span>
          </div>
          <div className="movers-list">
            {gainers.length === 0 ? (
              <div className="movers-empty movers-no-more">
                <span>No stocks crossing +3% yet</span>
              </div>
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
            <span className="col-count col-count-badge">{losers.length}</span>
          </div>
          <div className="movers-list">
            {losers.length === 0 ? (
              <div className="movers-empty movers-no-more">
                <span>No stocks crossing -3% yet</span>
              </div>
            ) : (
              losers.map((stock, i) => (
                <MoverRow key={stock.symbol} stock={stock} rank={i + 1} type="down" />
              ))
            )}
            {/* Equal height placeholder when losers < gainers */}
            {losers.length > 0 && losers.length < gainers.length && (
              <div className="movers-empty-placeholder" style={{
                border: '1px dashed hsla(0,0%,100%,0.08)',
                borderRadius: '8px',
                padding: '20px',
                textAlign: 'center',
                color: 'var(--text-muted)',
                fontSize: '11px',
                marginTop: '4px'
              }}>
                No more movers
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default React.memo(MoversSection);
