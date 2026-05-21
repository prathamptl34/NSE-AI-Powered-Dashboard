"""
screener_engine.py — Universal Stock Screener Engine
"""
import os
import json
import time
import logging
import asyncio
import hashlib
import random
import numpy as np
from datetime import datetime, timedelta
import pandas as pd
from cachetools import TTLCache

from backend.screener_indicators import compute_all_indicators
from backend.signal_engine import FNO_STOCKS, STOCK_SECTORS
from backend.streamer import NIFTY100_TOKENS, MIDCAP100_TOKENS, ALL_TOKENS

logger = logging.getLogger(__name__)

_screener_results_cache = TTLCache(maxsize=50, ttl=900)
_master_cache = None
_master_cache_date = None

_DATA_DIR = ".data"
os.makedirs(_DATA_DIR, exist_ok=True)
_master_file = os.path.join(_DATA_DIR, "master_instruments.json")
_saved_presets_file = os.path.join(_DATA_DIR, 'screener_presets.json')

BUILTIN_PRESETS = [
    {
        "id": "rsi_oversold_bounce",
        "name": "RSI Oversold Bounce",
        "description": "Stocks bouncing from oversold territory",
        "icon": "📈",
        "filters": [
            {"field": "rsi_14", "operator": "<", "value": 30},
            {"field": "price_vs_ema_50", "operator": ">", "value": 0}
        ],
        "logic": "AND"
    },
    {
        "id": "volume_breakout",
        "name": "Volume Breakout",
        "description": "Volume > 3x average with positive change",
        "icon": "💥",
        "filters": [
            {"field": "vol_ratio", "operator": ">", "value": 3},
            {"field": "change_pct", "operator": ">", "value": 2}
        ],
        "logic": "AND"
    },
    {
        "id": "52w_high_breakout",
        "name": "52-Week High Breakout",
        "description": "Price within 1% of 52W High",
        "icon": "🚀",
        "filters": [
            {"field": "price_vs_52w_high", "operator": ">", "value": -1}
        ],
        "logic": "AND"
    },
    {
        "id": "macd_bullish_cross",
        "name": "MACD Bullish Cross",
        "description": "MACD histogram crosses positive",
        "icon": "⚔️",
        "filters": [
            {"field": "macd_histogram", "operator": ">", "value": 0}
        ],
        "logic": "AND"
    },
    {
        "id": "supertrend_buy",
        "name": "Supertrend Buy",
        "description": "Supertrend direction is bullish",
        "icon": "🟢",
        "filters": [
            {"field": "supertrend_direction", "operator": "=", "value": 1}
        ],
        "logic": "AND"
    }
]

def to_native(val):
    if isinstance(val, dict):
        return {k: to_native(v) for k, v in val.items()}
    elif isinstance(val, list):
        return [to_native(x) for x in val]
    elif isinstance(val, (np.integer, int)):
        return int(val)
    elif isinstance(val, (np.floating, float)):
        if np.isnan(val):
            return None
        return float(val)
    elif isinstance(val, np.ndarray):
        return to_native(val.tolist())
    elif isinstance(val, (datetime, pd.Timestamp)):
        return val.isoformat()
    try:
        if pd.isna(val):
            return None
    except Exception:
        pass
    return val

NIFTY100_SYMBOLS = set([m['symbol'] for m in NIFTY100_TOKENS.values()])
MIDCAP100_SYMBOLS = set([m['symbol'] for m in MIDCAP100_TOKENS.values()])
FNO_SYMBOLS = set(FNO_STOCKS)

def load_master_instruments() -> list[dict]:
    """Load/refresh master list using ALL_TOKENS."""
    global _master_cache, _master_cache_date
    today = datetime.now().date().isoformat()
    if _master_cache and _master_cache_date == today:
        return _master_cache
        
    instruments = []
    seen = set()
    for token, meta in ALL_TOKENS.items():
        sym = meta['symbol']
        if sym not in seen:
            instruments.append({
                'token': token,
                'symbol': sym,
                'name': meta.get('name', sym),
                'exchange': meta.get('exchange', 'NSE')
            })
            seen.add(sym)
            
    _master_cache = instruments
    _master_cache_date = today
    return instruments

def apply_single_filter(df_row: dict, filter_condition: dict) -> bool:
    field = filter_condition.get('field')
    op = filter_condition.get('operator')
    val = filter_condition.get('value')
    actual_val = df_row.get(field)
    
    if actual_val is None: return False
    try:
        if op == '=':
            return str(actual_val) == str(val)
        if op == '!=':
            return str(actual_val) != str(val)
        # Numeric comparisons - coerce both to float
        actual_val = float(actual_val)
        val = float(val)
        if op == '>': return actual_val > val
        if op == '<': return actual_val < val
        if op == '>=': return actual_val >= val
        if op == '<=': return actual_val <= val
    except (ValueError, TypeError):
        pass
    return False

def apply_filters(stocks_data: list[dict], filters: list[dict], logic: str = 'AND') -> list[dict]:
    if not filters: return stocks_data
    matched = []
    for stock in stocks_data:
        if logic == 'AND':
            if all(apply_single_filter(stock, f) for f in filters): matched.append(stock)
        else:
            if any(apply_single_filter(stock, f) for f in filters): matched.append(stock)
    return matched

def _get_demo_data(sym: str, days: int = 250) -> pd.DataFrame:
    np.random.seed(hash(sym) % (2**32))
    base_price = np.random.uniform(100, 5000)
    volatility = np.random.uniform(0.01, 0.04)
    dates = pd.date_range(end=datetime.now(), periods=days, freq='B')
    returns = np.random.normal(0, volatility, days)
    prices = base_price * np.exp(np.cumsum(returns))
    
    df = pd.DataFrame({'date': dates})
    df['close'] = prices
    df['open'] = prices * (1 + np.random.uniform(-0.01, 0.01, days))
    df['high'] = df[['open', 'close']].max(axis=1) * (1 + np.random.uniform(0, 0.01, days))
    df['low'] = df[['open', 'close']].min(axis=1) * (1 - np.random.uniform(0, 0.01, days))
    df['volume'] = np.random.randint(100000, 5000000, days)
    return df

async def fetch_and_evaluate(smart, token_info: dict, days: int) -> dict | None:
    sym = token_info['symbol']
    to_date = datetime.now().strftime("%Y-%m-%d %H:%M")
    from_date = (datetime.now() - timedelta(days=days)).strftime("%Y-%m-%d 09:15")
    
    try:
        res = await asyncio.to_thread(smart.getCandleData, {
            "exchange": token_info['exchange'],
            "symboltoken": token_info['token'],
            "interval": "ONE_DAY",
            "fromdate": from_date,
            "todate": to_date
        })
        if res and res.get('status') and res.get('data'):
            df = pd.DataFrame(res['data'], columns=['date', 'open', 'high', 'low', 'close', 'volume'])
            df['date'] = pd.to_datetime(df['date'])
            return {sym: df}
    except Exception as e:
        logger.error(f"Error fetching OHLCV for {sym}: {e}")
    return None

async def run_scan_generator(smart, filters: list[dict], universe: str = 'NSE', 
                   logic: str = 'AND', index_filter: str = 'ALL',
                   sectors: list[str] = None):
    
    start_time = time.time()
    
    # GUARD: Use demo dataset if SmartConnect is invalid
    if smart is None:
        logger.warning("[Screener] Angel One session invalid, using demo data")
        yield {"results": [], "progress": {"current": 0, "total": 20}}
        await asyncio.sleep(1)
        demo_stocks = ["RELIANCE-EQ", "TCS-EQ", "HDFCBANK-EQ", "INFY-EQ", "ICICIBANK-EQ", "SBIN-EQ", 
                       "BAJFINANCE-EQ", "BHARTIARTL-EQ", "ITC-EQ", "ASIANPAINT-EQ", "LT-EQ", 
                       "AXISBANK-EQ", "HUL-EQ", "MARUTI-EQ", "SUNPHARMA-EQ", "TITAN-EQ", 
                       "TATASTEEL-EQ", "WIPRO-EQ", "ULTRACEMCO-EQ", "M&M-EQ"]
        
        batch_results = []
        for i, sym in enumerate(demo_stocks):
            df = _get_demo_data(sym, 250)
            enriched = compute_all_indicators(df)
            if enriched.empty: continue
            
            last_row = enriched.iloc[-1]
            prev_close = enriched['close'].iloc[-2] if len(enriched) > 1 else last_row['open']
            price = last_row['close']
            high_52w = df['high'].max()
            low_52w = df['low'].min()
            avg_vol = df['volume'].rolling(20).mean().iloc[-1]
            
            stock_data = {
                'symbol': sym,
                'name': sym,
                'price': price,
                'change_pct': ((price - prev_close) / prev_close) * 100,
                'volume': last_row['volume'],
                'vol_ratio': (last_row['volume'] / avg_vol) if avg_vol > 0 else 0,
                'rsi_14': last_row['rsi_14'],
                'macd_histogram': last_row['macd_histogram'],
                'supertrend_direction': last_row['supertrend_direction'],
                'adx': last_row['adx'],
                'bb_bandwidth': last_row['bb_bandwidth'],
                'sector': STOCK_SECTORS.get(sym, 'OTHER'),
                'is_fno': sym in FNO_SYMBOLS,
                'price_vs_52w_high': ((price - high_52w) / high_52w) * 100 if high_52w else 0,
                'price_vs_52w_low': ((price - low_52w) / low_52w) * 100 if low_52w else 0,
                'price_vs_ema_9': ((price - last_row['ema_9']) / last_row['ema_9']) * 100 if not pd.isna(last_row['ema_9']) else 0,
                'price_vs_ema_20': ((price - last_row['ema_20']) / last_row['ema_20']) * 100 if not pd.isna(last_row['ema_20']) else 0,
                'price_vs_ema_50': ((price - last_row['ema_50']) / last_row['ema_50']) * 100 if not pd.isna(last_row['ema_50']) else 0,
                'price_vs_ema_200': ((price - last_row['ema_200']) / last_row['ema_200']) * 100 if not pd.isna(last_row['ema_200']) else 0,
                'price_vs_vwap': ((price - last_row['vwap']) / last_row['vwap']) * 100 if not pd.isna(last_row['vwap']) else 0,
                # New indicator fields
                'bb_pct_b': float((price - last_row.get('bb_lower', price)) / (last_row.get('bb_upper', price + 1) - last_row.get('bb_lower', price))) if (last_row.get('bb_upper', 0) - last_row.get('bb_lower', 0)) > 0 else 0.5,
                'atr_14': float(last_row.get('atr_14', 0)) if not pd.isna(last_row.get('atr_14', 0)) else 0,
                'ema_20': float(last_row.get('ema_20', 0)) if not pd.isna(last_row.get('ema_20', 0)) else 0,
                'ema_50': float(last_row.get('ema_50', 0)) if not pd.isna(last_row.get('ema_50', 0)) else 0,
                'ema_200': float(last_row.get('ema_200', 0)) if not pd.isna(last_row.get('ema_200', 0)) else 0,
                'sma_20': float(df['close'].rolling(20).mean().iloc[-1]) if len(df) >= 20 else 0,
                'sma_50': float(df['close'].rolling(50).mean().iloc[-1]) if len(df) >= 50 else 0,
                # Fundamental fields (demo values)
                'delivery_pct': round(random.uniform(25, 75), 1),
                'market_cap_cr': round(random.uniform(500, 500000), 0),
                'pe_ratio': round(random.uniform(5, 80), 1),
            }
            batch_results.append(stock_data)
            
            if (i + 1) % 5 == 0 or i == len(demo_stocks) - 1:
                matched = apply_filters(batch_results, filters, logic)
                yield {"results": matched, "progress": {"current": i + 1, "total": 20}}
                batch_results = []
                await asyncio.sleep(0.5)
                
        yield {"done": True, "total": 20}
        return

    # Real scan logic
    instruments = load_master_instruments()
    
    # Reduce Universe for speed
    if universe == 'NSE':
        # Full universe scan available but disabled for performance
        instruments = [i for i in instruments if i['symbol'] in NIFTY100_SYMBOLS or i['symbol'] in MIDCAP100_SYMBOLS]
    elif universe == 'BSE':
        instruments = [i for i in instruments if i['exchange'] == 'BSE'][:500]
    else:
        instruments = [i for i in instruments if i['symbol'] in NIFTY100_SYMBOLS or i['symbol'] in MIDCAP100_SYMBOLS or i['exchange'] == 'BSE'][:800]
        
    if index_filter == 'nifty100':
        instruments = [i for i in instruments if i['symbol'] in NIFTY100_SYMBOLS]
    elif index_filter == 'midcap100':
        instruments = [i for i in instruments if i['symbol'] in MIDCAP100_SYMBOLS]
    elif index_filter == 'fno':
        instruments = [i for i in instruments if i['symbol'] in FNO_SYMBOLS]

    if sectors:
        instruments = [i for i in instruments if STOCK_SECTORS.get(i['symbol'], 'OTHER') in sectors]

    total_instruments = len(instruments)
    batch_size = 20
    sem = asyncio.Semaphore(5)
    
    total_matched = 0
    all_matched = []
    
    async def process_symbol(token_info):
        async with sem:
            try:
                # Add 8-second per symbol timeout
                await asyncio.sleep(0.3)
                result = await asyncio.wait_for(
                    fetch_and_evaluate(smart, token_info, 250),
                    timeout=8.0
                )
                return result
            except Exception:
                return None # Never re-raise inside semaphore block

    for i in range(0, total_instruments, batch_size):
        batch = instruments[i:i+batch_size]
        tasks = [process_symbol(t) for t in batch]
        batch_results_data = await asyncio.gather(*tasks)
        
        batch_parsed = []
        for res in batch_results_data:
            if not res: continue
            for sym, df in res.items():
                enriched = compute_all_indicators(df)
                if enriched.empty: continue
                
                last_row = enriched.iloc[-1]
                prev_close = enriched['close'].iloc[-2] if len(enriched) > 1 else last_row['open']
                price = last_row['close']
                high_52w = df['high'].max()
                low_52w = df['low'].min()
                avg_vol = df['volume'].rolling(20).mean().iloc[-1]
                
                stock_data = {
                    'symbol': sym,
                    'name': next((x['name'] for x in batch if x['symbol'] == sym), sym),
                    'price': price,
                    'change_pct': ((price - prev_close) / prev_close) * 100,
                    'volume': last_row['volume'],
                    'vol_ratio': (last_row['volume'] / avg_vol) if avg_vol > 0 else 0,
                    'rsi_14': last_row['rsi_14'],
                    'macd_histogram': last_row['macd_histogram'],
                    'supertrend_direction': last_row['supertrend_direction'],
                    'adx': last_row['adx'],
                    'bb_bandwidth': last_row['bb_bandwidth'],
                    'sector': STOCK_SECTORS.get(sym, 'OTHER'),
                    'is_fno': sym in FNO_SYMBOLS,
                    'price_vs_52w_high': ((price - high_52w) / high_52w) * 100 if high_52w else 0,
                    'price_vs_52w_low': ((price - low_52w) / low_52w) * 100 if low_52w else 0,
                    'price_vs_ema_9': ((price - last_row['ema_9']) / last_row['ema_9']) * 100 if not pd.isna(last_row['ema_9']) else 0,
                    'price_vs_ema_20': ((price - last_row['ema_20']) / last_row['ema_20']) * 100 if not pd.isna(last_row['ema_20']) else 0,
                    'price_vs_ema_50': ((price - last_row['ema_50']) / last_row['ema_50']) * 100 if not pd.isna(last_row['ema_50']) else 0,
                    'price_vs_ema_200': ((price - last_row['ema_200']) / last_row['ema_200']) * 100 if not pd.isna(last_row['ema_200']) else 0,
                    'price_vs_vwap': ((price - last_row['vwap']) / last_row['vwap']) * 100 if not pd.isna(last_row['vwap']) else 0,
                    # New indicator fields
                    'bb_pct_b': float((price - last_row.get('bb_lower', price)) / (last_row.get('bb_upper', price + 1) - last_row.get('bb_lower', price))) if (last_row.get('bb_upper', 0) - last_row.get('bb_lower', 0)) > 0 else 0.5,
                    'atr_14': float(last_row.get('atr_14', 0)) if not pd.isna(last_row.get('atr_14', 0)) else 0,
                    'ema_20': float(last_row.get('ema_20', 0)) if not pd.isna(last_row.get('ema_20', 0)) else 0,
                    'ema_50': float(last_row.get('ema_50', 0)) if not pd.isna(last_row.get('ema_50', 0)) else 0,
                    'ema_200': float(last_row.get('ema_200', 0)) if not pd.isna(last_row.get('ema_200', 0)) else 0,
                    'sma_20': float(df['close'].rolling(20).mean().iloc[-1]) if len(df) >= 20 else 0,
                    'sma_50': float(df['close'].rolling(50).mean().iloc[-1]) if len(df) >= 50 else 0,
                    'delivery_pct': round(random.uniform(25, 75), 1),
                    'market_cap_cr': round(random.uniform(500, 500000), 0),
                    'pe_ratio': round(random.uniform(5, 80), 1),
                }
                for pat in ['bullish_engulfing', 'bearish_engulfing', 'doji', 'hammer', 'morning_star', 'evening_star']:
                    stock_data[pat] = bool(last_row.get(pat, False))
                    
                batch_parsed.append(stock_data)

        matched = apply_filters(batch_parsed, filters, logic)
        all_matched.extend(matched)
        total_matched += len(matched)
        
        yield {
            "results": matched,
            "progress": {"current": min(i+batch_size, total_instruments), "total": total_instruments}
        }

    # Final completion yield
    yield {"done": True, "total": total_matched}

def get_presets() -> list[dict]:
    """Return builtin + saved presets."""
    presets = list(BUILTIN_PRESETS)
    if os.path.exists(_saved_presets_file):
        try:
            with open(_saved_presets_file, 'r') as f:
                saved = json.load(f)
                presets.extend(saved)
        except Exception:
            pass
    return presets

def save_preset(name: str, filters: list[dict], logic: str = 'AND') -> dict:
    """Save a custom preset to JSON file."""
    custom_id = f"custom_{int(time.time())}"
    new_preset = {
        "id": custom_id,
        "name": name,
        "description": "User saved preset",
        "icon": "💾",
        "filters": filters,
        "logic": logic
    }
    
    saved = []
    if os.path.exists(_saved_presets_file):
        try:
            with open(_saved_presets_file, 'r') as f:
                saved = json.load(f)
        except Exception:
            pass
            
    saved.append(new_preset)
    
    with open(_saved_presets_file, 'w') as f:
        json.dump(saved, f, indent=2)
        
    return new_preset

def get_cached_results(scan_id: str) -> dict | None:
    """Retrieve cached scan results."""
    return _screener_results_cache.get(scan_id)
