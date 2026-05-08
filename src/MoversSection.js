import React, { useRef, useEffect } from 'react';
import './MoversSection.css';

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

  // CRITICAL: type="up" means SURGING = GREEN, type="down" means FALLING = RED
  const isGainer = type === 'up';
  const rowBg     = isGainer ? 'hsla(160, 84%, 39%, 0.10)' : 'hsla(343, 90%, 60%, 0.10)';
  const rowBorder = isGainer ? '1px solid hsla(160, 84%, 39%, 0.20)' : '1px solid hsla(343, 90%, 60%, 0.20)';
  const accentColor = isGainer ? 'hsl(160, 84%, 39%)' : 'hsl(343, 90%, 60%)';
  const badgeBg   = isGainer ? 'hsl(160, 84%, 39%)' : 'hsl(343, 90%, 60%)';

  const sectorText = stock.sector ? stock.sector.replace(/_/g, ' ') : '';

  return (
    <div
      className="mover-row"
      ref={rowRef}
      style={{ background: rowBg, border: rowBorder, borderRadius: '10px', padding: '12px 16px', marginBottom: '6px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', transition: 'filter 0.2s, transform 0.2s' }}
    >
      <div className="mover-info" style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
        <span className="mover-rank" style={{ color: accentColor, fontWeight: 800, fontSize: '0.82rem', fontVariantNumeric: 'tabular-nums', minWidth: '28px' }}>#{String(rank).padStart(2, '0')}</span>
        <div className="mover-symbol-box" style={{ display: 'flex', flexDirection: 'column' }}>
          <span className="mover-symbol" style={{ color: '#fff', fontWeight: 700, fontSize: '0.9rem' }}>{stock.symbol}</span>
          <span className="mover-sector" style={{ fontSize: '0.7rem', color: 'hsla(0,0%,100%,0.4)' }}>{sectorText}</span>
        </div>
      </div>
      <div className="mover-data" style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
        <span className="mover-price" style={{ color: 'hsla(0,0%,100%,0.7)', fontWeight: 700, fontSize: '0.88rem', fontVariantNumeric: 'tabular-nums' }}>₹{Number(stock.ltp).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>
        <span className="mover-badge" style={{ background: badgeBg, color: '#fff', padding: '4px 10px', borderRadius: '6px', fontWeight: 800, fontSize: '0.78rem', minWidth: '64px', textAlign: 'center', fontVariantNumeric: 'tabular-nums' }}>
          {isGainer ? '+' : ''}{stock.change_pct.toFixed(2)}%
        </span>
      </div>
    </div>
  );
};

const MoversSection = ({ moversData }) => {
  const { gainers = [], losers = [] } = moversData || {};

  return (
    <div className="movers-section movers-panel">
      <div className="movers-columns" style={{ alignItems: 'start' }}>
        {/* Gainers Column */}
        <div className="movers-col movers-column">
          <div className="col-header col-up movers-section-header movers-panel-title-row">
            <span className="col-icon">🚀</span>
            <span className="col-label">SURGING +3%</span>
            <span className="col-count col-count-badge movers-count-badge">{gainers.length}</span>
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
        <div className="movers-col movers-column">
          <div className="col-header col-down movers-section-header movers-panel-title-row">
            <span className="col-icon">🔻</span>
            <span className="col-label">FALLING -3%</span>
            <span className="col-count col-count-badge movers-count-badge">{losers.length}</span>
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
              <div style={{
                border: '1px dashed hsla(0,0%,100%,0.08)',
                borderRadius: '8px',
                padding: '20px',
                textAlign: 'center',
                color: 'hsla(0,0%,100%,0.25)',
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
