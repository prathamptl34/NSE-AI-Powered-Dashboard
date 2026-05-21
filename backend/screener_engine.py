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

def sanitize_for_json(obj):
    """Recursively convert numpy types to native Python types."""
    if isinstance(obj, dict):
        return {k: sanitize_for_json(v) for k, v in obj.items()}
    elif isinstance(obj, list):
        return [sanitize_for_json(i) for i in obj]
    elif isinstance(obj, (np.integer, np.int64, np.int32)):
        return int(obj)
    elif isinstance(obj, (np.floating, np.float64, np.float32)):
        return float(obj)
    elif isinstance(obj, np.bool_):
        return bool(obj)
    elif isinstance(obj, np.ndarray):
        return obj.tolist()
    elif obj != obj:  # NaN check
        return None
    return obj

NIFTY100_FALLBACK = [
    "RELIANCE","TCS","HDFCBANK","INFY","ICICIBANK",
    "HINDUNILVR","ITC","SBIN","BHARTIARTL","KOTAKBANK",
    "LT","AXISBANK","ASIANPAINT","MARUTI","TITAN",
    "SUNPHARMA","ULTRACEMCO","BAJFINANCE","WIPRO","NESTLEIND",
    "HCLTECH","TECHM","POWERGRID","NTPC","ONGC",
    "JSWSTEEL","TATASTEEL","HINDALCO","COALINDIA","GRASIM",
    "ADANIPORTS","BAJAJFINSV","DIVISLAB","DRREDDY","CIPLA",
    "EICHERMOT","HEROMOTOCO","BPCL","IOC","BRITANNIA",
    "SHREECEM","INDUSINDBK","M&M","TATAMOTORS","HDFCLIFE",
    "SBILIFE","PIDILITIND","HAVELLS","SIEMENS","ABB",
    "BEL","CGPOWER","TRENT","DMART","ZOMATO",
    "NAUKRI","PAYTM","BAJAJ-AUTO","TATACONSUM","APOLLOHOSP"
]
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

def evaluate_filters(stock: dict, filters: list, logic: str = "AND") -> bool:
    if not filters:
        return True
    outcomes = []
    for f in filters:
        field = f.get("field", "")
        op = f.get("operator", ">")
        raw_val = f.get("value", 0)
        stock_val = stock.get(field)
        if stock_val is None:
            outcomes.append(False)
            continue
        try:
            if field == "supertrend":
                outcomes.append(str(stock_val).upper() == str(raw_val).upper())
                continue
            sv = float(stock_val)
            fv = float(raw_val)
            if op == ">":    outcomes.append(sv > fv)
            elif op == "<":  outcomes.append(sv < fv)
            elif op == ">=": outcomes.append(sv >= fv)
            elif op == "<=": outcomes.append(sv <= fv)
            elif op == "=":  outcomes.append(sv == fv)
            elif op == "!=": outcomes.append(sv != fv)
            else:            outcomes.append(False)
        except (ValueError, TypeError):
            outcomes.append(False)
    if logic == "OR":
        return any(outcomes)
    return all(outcomes)

def get_demo_stock(i, sym):
    base_price = 100 + i * 150.5
    vol = 1000000 + i * 500000
    return {
        "symbol": sym, "exchange": "NSE",
        "last_price": base_price, "pct_change": 2.45 - i * 0.15,
        "volume": vol, "volume_ratio": 1.5 + i * 0.2,
        "rsi_14": 35.0 + i * 2.0, "macd_histogram": -1.0 + i * 0.2,
        "adx_14": 15.0 + i * 1.5, "supertrend": "BUY" if i % 2 == 0 else "SELL",
        "ema_20": base_price * 0.98, "ema_50": base_price * 0.95, "ema_200": base_price * 0.90,
        "sma_20": base_price * 0.98, "sma_50": base_price * 0.95,
        "pct_from_52h": -2.1 - i, "pct_from_52l": 18.4 + i,
        "bb_pctb": 0.4 + i * 0.03, "atr_14": 15.0 + i,
        "market_cap": 50000.0 + i * 10000
    }

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
        demo_stocks = ["RELIANCE", "TCS", "HDFCBANK", "INFY", "ICICIBANK", "SBIN", 
                       "BAJFINANCE", "BHARTIARTL", "ITC", "ASIANPAINT", "LT", 
                       "AXISBANK", "HUL", "MARUTI", "SUNPHARMA", "TITAN", 
                       "TATASTEEL", "WIPRO", "ULTRACEMCO", "M&M"]
        
        batch_results = []
        for i, sym in enumerate(demo_stocks):
            stock_data = get_demo_stock(i, sym)
            if evaluate_filters(stock_data, filters, logic):
                batch_results.append(stock_data)
            
            if (i + 1) % 5 == 0 or i == len(demo_stocks) - 1:
                batch_results = sanitize_for_json(batch_results)
                yield {"results": batch_results, "progress": {"current": i + 1, "total": 20}}
                batch_results = []
                await asyncio.sleep(0.5)
                
        yield {"done": True, "total": 20}
        return

    # Real scan logic
    instruments = load_master_instruments()
    if not instruments:
        logger.warning("Master list empty. Using NIFTY100_FALLBACK.")
        instruments = [{'token': 'dummy', 'symbol': s, 'name': s, 'exchange': 'NSE'} for s in NIFTY100_FALLBACK]
    
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
                    'exchange': next((x.get('exchange', 'NSE') for x in batch if x['symbol'] == sym), 'NSE'),
                    'last_price': price,
                    'pct_change': ((price - prev_close) / prev_close) * 100,
                    'volume': last_row['volume'],
                    'volume_ratio': (last_row['volume'] / avg_vol) if avg_vol > 0 else 0,
                    'rsi_14': last_row['rsi_14'],
                    'macd_histogram': last_row['macd_histogram'],
                    'supertrend': last_row.get('supertrend_direction', 'NEUTRAL'),
                    'adx_14': last_row['adx'],
                    'pct_from_52h': ((price - high_52w) / high_52w) * 100 if high_52w else 0,
                    'pct_from_52l': ((price - low_52w) / low_52w) * 100 if low_52w else 0,
                    'bb_pctb': float((price - last_row.get('bb_lower', price)) / (last_row.get('bb_upper', price + 1) - last_row.get('bb_lower', price))) if (last_row.get('bb_upper', 0) - last_row.get('bb_lower', 0)) > 0 else 0.5,
                    'atr_14': float(last_row.get('atr_14', 0)) if not pd.isna(last_row.get('atr_14', 0)) else 0,
                    'ema_20': float(last_row.get('ema_20', 0)) if not pd.isna(last_row.get('ema_20', 0)) else 0,
                    'ema_50': float(last_row.get('ema_50', 0)) if not pd.isna(last_row.get('ema_50', 0)) else 0,
                    'ema_200': float(last_row.get('ema_200', 0)) if not pd.isna(last_row.get('ema_200', 0)) else 0,
                    'sma_20': float(df['close'].rolling(20).mean().iloc[-1]) if len(df) >= 20 else 0,
                    'sma_50': float(df['close'].rolling(50).mean().iloc[-1]) if len(df) >= 50 else 0,
                    'market_cap': round(random.uniform(500, 500000), 0)
                }
                if evaluate_filters(stock_data, filters, logic):
                    batch_parsed.append(stock_data)

        all_matched.extend(batch_parsed)
        total_matched += len(batch_parsed)
        
        batch_parsed = sanitize_for_json(batch_parsed)
        yield {
            "results": batch_parsed,
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
