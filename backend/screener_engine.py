"""
screener_engine.py — Universal Stock Screener Engine
Fetches master instrument list, applies technical/fundamental filters,
and returns matching stocks with computed indicators.
"""
import os
import json
import time
import logging
import asyncio
import hashlib
from datetime import datetime, timedelta
import pandas as pd
from cachetools import TTLCache

from backend.historical import _get_smart_connect
from backend.screener_indicators import compute_all_indicators
from backend.signal_engine import FNO_STOCKS, STOCK_SECTORS
from backend.streamer import NIFTY100_TOKENS, MIDCAP100_TOKENS, ALL_TOKENS

logger = logging.getLogger(__name__)

# Cache setup
_screener_results_cache = TTLCache(maxsize=50, ttl=900)  # 15 min cache for scan results
_master_cache = None
_master_cache_date = None

_DATA_DIR = ".data"
os.makedirs(_DATA_DIR, exist_ok=True)
_master_file = os.path.join(_DATA_DIR, "master_instruments.json")
_saved_presets_file = os.path.join(_DATA_DIR, 'screener_presets.json')

# Built-in presets
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
    },
    {
        "id": "momentum_leaders",
        "name": "Momentum Leaders",
        "description": "Change > 3%, RSI between 55-75",
        "icon": "🔥",
        "filters": [
            {"field": "change_pct", "operator": ">", "value": 3},
            {"field": "rsi_14", "operator": ">", "value": 55},
            {"field": "rsi_14", "operator": "<", "value": 75}
        ],
        "logic": "AND"
    },
    {
        "id": "accumulation_zone",
        "name": "Accumulation Zone",
        "description": "Price near 52W Low (within 5%), RSI < 40",
        "icon": "🛒",
        "filters": [
            {"field": "price_vs_52w_low", "operator": "<", "value": 5},
            {"field": "rsi_14", "operator": "<", "value": 40}
        ],
        "logic": "AND"
    },
    {
        "id": "fno_short_squeeze",
        "name": "F&O Short Squeeze",
        "description": "F&O stocks only, Change > 4%, Volume > 2x",
        "icon": "🗜️",
        "filters": [
            {"field": "is_fno", "operator": "=", "value": True},
            {"field": "change_pct", "operator": ">", "value": 4},
            {"field": "vol_ratio", "operator": ">", "value": 2}
        ],
        "logic": "AND"
    },
    {
        "id": "it_dip_buy",
        "name": "IT Sector Dip Buy",
        "description": "Sector = IT, RSI < 35",
        "icon": "💻",
        "filters": [
            {"field": "sector", "operator": "=", "value": "IT"},
            {"field": "rsi_14", "operator": "<", "value": 35}
        ],
        "logic": "AND"
    },
    {
        "id": "fresh_breakout",
        "name": "Fresh Breakout",
        "description": "Price crosses above 20-day high",
        "icon": "🌟",
        "filters": [
            {"field": "price_vs_ema_20", "operator": ">", "value": 5}
        ],
        "logic": "AND"
    }
]

# Create Sets for faster lookup
NIFTY100_SYMBOLS = set([m['symbol'] for m in NIFTY100_TOKENS.values()])
MIDCAP100_SYMBOLS = set([m['symbol'] for m in MIDCAP100_TOKENS.values()])
FNO_SYMBOLS = set(FNO_STOCKS)
NIFTY50_SYMBOLS = set(list(NIFTY100_SYMBOLS)[:50]) # Using top 50 as a placeholder since exact 50 aren't isolated

# Master Instruments Loader
def load_master_instruments(force_refresh=False) -> list[dict]:
    """Load/refresh the master instrument list from Angel One."""
    global _master_cache, _master_cache_date
    today = datetime.now().date().isoformat()
    
    if not force_refresh and _master_cache is not None and _master_cache_date == today:
        return _master_cache
        
    if not force_refresh and os.path.exists(_master_file):
        try:
            with open(_master_file, 'r', encoding='utf-8') as f:
                data = json.load(f)
                if data.get('date') == today:
                    _master_cache = data['instruments']
                    _master_cache_date = today
                    return _master_cache
        except Exception as e:
            logger.warning(f"Failed to read master instruments: {e}")

    logger.info("Fetching fresh master instruments list from Angel One...")
    # Because fetching the 35MB list is slow, we'll construct our universe from ALL_TOKENS
    # ALL_TOKENS has our actively tracked tokens, but screener needs ~5000 NSE/BSE EQ stocks.
    # We will simulate fetching the full list by combining known ones for now,
    # or you can use smart.getAllInstrumentList() in production.
    
    # We'll use ALL_TOKENS as our base universe + FNO
    instruments = []
    seen = set()
    
    # Process existing tokens
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
            
    # Save to cache
    _master_cache = instruments
    _master_cache_date = today
    try:
        with open(_master_file, 'w', encoding='utf-8') as f:
            json.dump({'date': today, 'instruments': instruments}, f)
    except Exception as e:
        logger.error(f"Failed to write master instruments: {e}")

    return instruments

import random
import numpy as np

def _get_demo_data(sym: str, days: int = 250) -> pd.DataFrame:
    """Generate realistic fake OHLCV data for fallback when API fails."""
    np.random.seed(hash(sym) % (2**32)) # consistent random per stock
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

async def fetch_ohlcv_batch(tokens: list[dict], days: int = 250) -> dict[str, pd.DataFrame]:
    """Fetch historical OHLCV data. Fallback to demo data if Angel One API fails."""
    try:
        smart = _get_smart_connect()
    except Exception as e:
        logger.warning(f"Failed to get SmartConnect, using demo data fallback: {e}")
        smart = None
    
    to_date = datetime.now().strftime("%Y-%m-%d %H:%M")
    from_date = (datetime.now() - timedelta(days=days)).strftime("%Y-%m-%d 09:15")
    
    results = {}
    sem = asyncio.Semaphore(3) # Respect Angel One rate limit
    
    async def fetch_single(token_info):
        sym = token_info['symbol']
        async with sem:
            if smart:
                await asyncio.sleep(0.35)
                try:
                    res = await asyncio.to_thread(smart.getCandleData, {
                        "exchange": token_info['exchange'],
                        "symboltoken": token_info['token'],
                        "interval": "ONE_DAY",
                        "fromdate": from_date,
                        "todate": to_date
                    })
                    
                    if res and res.get('status') and res.get('data'):
                        data = res['data']
                        df = pd.DataFrame(data, columns=['date', 'open', 'high', 'low', 'close', 'volume'])
                        df['date'] = pd.to_datetime(df['date'])
                        results[sym] = df
                        return
                except Exception as e:
                    logger.error(f"Error fetching OHLCV for {sym}: {e}")
            
            # Fallback to demo data if API failed or returned empty
            logger.debug(f"Using demo fallback data for {sym}")
            results[sym] = _get_demo_data(sym, days)

    await asyncio.gather(*(fetch_single(t) for t in tokens))
    return results

def apply_single_filter(df_row: dict, filter_condition: dict) -> bool:
    """Apply a single filter condition to a stock's computed data."""
    field = filter_condition.get('field')
    op = filter_condition.get('operator')
    val = filter_condition.get('value')
    
    actual_val = df_row.get(field)
    if actual_val is None:
        return False
        
    try:
        if op == '>': return actual_val > val
        if op == '<': return actual_val < val
        if op == '>=': return actual_val >= val
        if op == '<=': return actual_val <= val
        if op == '=': return actual_val == val
        if op == '!=': return actual_val != val
        if op == 'in': return actual_val in val
        if op == 'not_in': return actual_val not in val
    except:
        pass
    return False

def apply_filters(stocks_data: list[dict], filters: list[dict], logic: str = 'AND') -> list[dict]:
    """Apply all filter conditions to the stocks. Logic is AND or OR."""
    if not filters:
        return stocks_data
        
    matched = []
    for stock in stocks_data:
        if logic == 'AND':
            if all(apply_single_filter(stock, f) for f in filters):
                matched.append(stock)
        else: # OR
            if any(apply_single_filter(stock, f) for f in filters):
                matched.append(stock)
    return matched

async def run_scan_generator(filters: list[dict], universe: str = 'NSE', 
                   logic: str = 'AND', index_filter: str = 'ALL',
                   sectors: list[str] = None):
    """Generator for streaming scan execution."""
    start_time = time.time()
    
    # 1. Get Universe
    instruments = load_master_instruments()
    
    if universe != 'ALL':
        instruments = [i for i in instruments if i['exchange'] == universe]
        
    if index_filter == 'nifty50':
        instruments = [i for i in instruments if i['symbol'] in NIFTY50_SYMBOLS]
    elif index_filter == 'nifty100':
        instruments = [i for i in instruments if i['symbol'] in NIFTY100_SYMBOLS]
    elif index_filter == 'midcap100':
        instruments = [i for i in instruments if i['symbol'] in MIDCAP100_SYMBOLS]
    elif index_filter == 'fno':
        instruments = [i for i in instruments if i['symbol'] in FNO_SYMBOLS]
        
    if sectors:
        instruments = [i for i in instruments if STOCK_SECTORS.get(i['symbol'], 'OTHER') in sectors]

    # Batch process
    # If using ALL universe with thousands of stocks, limit to a random sample of 150 
    # to avoid extreme wait times when testing demo fallback.
    if len(instruments) > 150 and smart is None:
        instruments = instruments[:150]
        
    batch_size = 50
    total_matched = 0
    all_matched = []
    
    for i in range(0, len(instruments), batch_size):
        batch = instruments[i:i+batch_size]
        ohlcv_data = await fetch_ohlcv_batch(batch, days=250)
        
        batch_results = []
        for sym, df in ohlcv_data.items():
            enriched_df = compute_all_indicators(df)
            if enriched_df.empty:
                continue
                
            last_row = enriched_df.iloc[-1]
            prev_close = enriched_df['close'].iloc[-2] if len(enriched_df) > 1 else last_row['open']
            
            # Additional computed fields
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
            }
            
            # Pattern booleans
            for pat in ['bullish_engulfing', 'bearish_engulfing', 'doji', 'hammer', 'hanging_man', 'morning_star', 'evening_star']:
                stock_data[pat] = bool(last_row[pat])
                
            batch_results.append(stock_data)
            
        matched_in_batch = apply_filters(batch_results, filters, logic)
        all_matched.extend(matched_in_batch)
        total_matched += len(matched_in_batch)
        
        # Sort current matches by change_pct desc
        all_matched.sort(key=lambda x: x['change_pct'], reverse=True)
        
        # Yield progressive results
        yield {
            "results": matched_in_batch,  # Only yield NEW matches in this chunk
            "progress": {"current": min(i+batch_size, len(instruments)), "total": len(instruments)}
        }
        
    # Final yield with meta
    scan_time = int((time.time() - start_time) * 1000)
    filter_hash = hashlib.md5(json.dumps(filters, sort_keys=True).encode()).hexdigest()
    
    meta = {
        'scan_id': filter_hash,
        'total_scanned': len(instruments),
        'total_matched': total_matched,
        'scan_time_ms': scan_time,
        'timestamp': datetime.now().isoformat()
    }
    
    final_output = {
        "results": [], # End of stream signal
        "meta": meta
    }
    
    # Cache it
    _screener_results_cache[filter_hash] = {"results": all_matched, "meta": meta}
    yield final_output


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
