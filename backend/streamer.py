"""
streamer.py — Angel One SmartWebSocketV2 live feed handler.

Subscribes to all Nifty 100 + Midcap 100 tokens, maintains an in-memory
tick store, and exposes get_market_summary() for the FastAPI layer.
"""

import os
import asyncio
import logzero
from logzero import logger
import pyotp
import threading
import time
import json
from datetime import datetime, timezone, timedelta
from datetime import datetime, timezone, timedelta
from typing import Optional
from collections import defaultdict

_intraday_candles = defaultdict(list)
_last_cumulative_vol = defaultdict(int)
_current_trading_day = datetime.now().strftime("%Y-%m-%d")

# Enable JSON logging if running in Cloud Run
if os.environ.get("K_SERVICE"):
    logzero.json()

from SmartApi import SmartConnect
from SmartApi.smartWebSocketV2 import SmartWebSocketV2

from backend.fno_universe import FNO_SYMBOL_TOKEN_MAP

# ── Token lists ───────────────────────────────────────────────────────────────
# Exchange segment: 1 = NSE Cash
NSE_SEGMENT = 1

# Nifty 100 tokens (symbol_token : prev_close, name)
NIFTY100_TOKENS: dict[str, dict] = {
    "13": {"symbol": "ABB", "prev_close": 0.0},
    "10217": {"symbol": "ADANIENSOL", "prev_close": 0.0},
    "25": {"symbol": "ADANIENT", "prev_close": 0.0},
    "3563": {"symbol": "ADANIGREEN", "prev_close": 0.0},
    "15083": {"symbol": "ADANIPORTS", "prev_close": 0.0},
    "17388": {"symbol": "ADANIPOWER", "prev_close": 0.0},
    "1270": {"symbol": "AMBUJACEM", "prev_close": 0.0},
    "157": {"symbol": "APOLLOHOSP", "prev_close": 0.0},
    "236": {"symbol": "ASIANPAINT", "prev_close": 0.0},
    "19913": {"symbol": "DMART", "prev_close": 0.0},
    "5900": {"symbol": "AXISBANK", "prev_close": 0.0},
    "16669": {"symbol": "BAJAJ-AUTO", "prev_close": 0.0},
    "317": {"symbol": "BAJFINANCE", "prev_close": 0.0},
    "16675": {"symbol": "BAJAJFINSV", "prev_close": 0.0},
    "305": {"symbol": "BAJAJHLDNG", "prev_close": 0.0},
    "25270": {"symbol": "BAJAJHFL", "prev_close": 0.0},
    "4668": {"symbol": "BANKBARODA", "prev_close": 0.0},
    "383": {"symbol": "BEL", "prev_close": 0.0},
    "526": {"symbol": "BPCL", "prev_close": 0.0},
    "10604": {"symbol": "BHARTIARTL", "prev_close": 0.0},
    "2181": {"symbol": "BOSCHLTD", "prev_close": 0.0},
    "547": {"symbol": "BRITANNIA", "prev_close": 0.0},
    "760": {"symbol": "CGPOWER", "prev_close": 0.0},
    "10794": {"symbol": "CANBK", "prev_close": 0.0},
    "685": {"symbol": "CHOLAFIN", "prev_close": 0.0},
    "694": {"symbol": "CIPLA", "prev_close": 0.0},
    "20374": {"symbol": "COALINDIA", "prev_close": 0.0},
    "14732": {"symbol": "DLF", "prev_close": 0.0},
    "10940": {"symbol": "DIVISLAB", "prev_close": 0.0},
    "881": {"symbol": "DRREDDY", "prev_close": 0.0},
    "910": {"symbol": "EICHERMOT", "prev_close": 0.0},
    "5097": {"symbol": "ETERNAL", "prev_close": 0.0},
    "4717": {"symbol": "GAIL", "prev_close": 0.0},
    "10099": {"symbol": "GODREJCP", "prev_close": 0.0},
    "1232": {"symbol": "GRASIM", "prev_close": 0.0},
    "7229": {"symbol": "HCLTECH", "prev_close": 0.0},
    "1333": {"symbol": "HDFCBANK", "prev_close": 0.0},
    "467": {"symbol": "HDFCLIFE", "prev_close": 0.0},
    "9819": {"symbol": "HAVELLS", "prev_close": 0.0},
    "1363": {"symbol": "HINDALCO", "prev_close": 0.0},
    "2303": {"symbol": "HAL", "prev_close": 0.0},
    "1394": {"symbol": "HINDUNILVR", "prev_close": 0.0},
    "1424": {"symbol": "HINDZINC", "prev_close": 0.0},
    "25844": {"symbol": "HYUNDAI", "prev_close": 0.0},
    "4963": {"symbol": "ICICIBANK", "prev_close": 0.0},
    "21770": {"symbol": "ICICIGI", "prev_close": 0.0},
    "1660": {"symbol": "ITC", "prev_close": 0.0},
    "1512": {"symbol": "INDHOTEL", "prev_close": 0.0},
    "1624": {"symbol": "IOC", "prev_close": 0.0},
    "2029": {"symbol": "IRFC", "prev_close": 0.0},
    "13751": {"symbol": "NAUKRI", "prev_close": 0.0},
    "1594": {"symbol": "INFY", "prev_close": 0.0},
    "11195": {"symbol": "INDIGO", "prev_close": 0.0},
    "17869": {"symbol": "JSWENERGY", "prev_close": 0.0},
    "11723": {"symbol": "JSWSTEEL", "prev_close": 0.0},
    "6733": {"symbol": "JINDALSTEL", "prev_close": 0.0},
    "18143": {"symbol": "JIOFIN", "prev_close": 0.0},
    "1922": {"symbol": "KOTAKBANK", "prev_close": 0.0},
    "17818": {"symbol": "LTM", "prev_close": 0.0},
    "11483": {"symbol": "LT", "prev_close": 0.0},
    "9480": {"symbol": "LICI", "prev_close": 0.0},
    "3220": {"symbol": "LODHA", "prev_close": 0.0},
    "2031": {"symbol": "M&M", "prev_close": 0.0},
    "10999": {"symbol": "MARUTI", "prev_close": 0.0},
    "22377": {"symbol": "MAXHEALTH", "prev_close": 0.0},
    "509": {"symbol": "MAZDOCK", "prev_close": 0.0},
    "11630": {"symbol": "NTPC", "prev_close": 0.0},
    "17963": {"symbol": "NESTLEIND", "prev_close": 0.0},
    "2475": {"symbol": "ONGC", "prev_close": 0.0},
    "2664": {"symbol": "PIDILITIND", "prev_close": 0.0},
    "14299": {"symbol": "PFC", "prev_close": 0.0},
    "14977": {"symbol": "POWERGRID", "prev_close": 0.0},
    "10666": {"symbol": "PNB", "prev_close": 0.0},
    "15355": {"symbol": "RECLTD", "prev_close": 0.0},
    "2885": {"symbol": "RELIANCE", "prev_close": 0.0},
    "21808": {"symbol": "SBILIFE", "prev_close": 0.0},
    "4204": {"symbol": "MOTHERSON", "prev_close": 0.0},
    "3103": {"symbol": "SHREECEM", "prev_close": 0.0},
    "4306": {"symbol": "SHRIRAMFIN", "prev_close": 0.0},
    "756871": {"symbol": "ENRIN", "prev_close": 0.0},
    "3150": {"symbol": "SIEMENS", "prev_close": 0.0},
    "13332": {"symbol": "SOLARINDS", "prev_close": 0.0},
    "3045": {"symbol": "SBIN", "prev_close": 0.0},
    "3351": {"symbol": "SUNPHARMA", "prev_close": 0.0},
    "8479": {"symbol": "TVSMOTOR", "prev_close": 0.0},
    "11536": {"symbol": "TCS", "prev_close": 0.0},
    "3432": {"symbol": "TATACONSUM", "prev_close": 0.0},
    "3456": {"symbol": "TMPV", "prev_close": 0.0},
    "3426": {"symbol": "TATAPOWER", "prev_close": 0.0},
    "3499": {"symbol": "TATASTEEL", "prev_close": 0.0},
    "13538": {"symbol": "TECHM", "prev_close": 0.0},
    "3506": {"symbol": "TITAN", "prev_close": 0.0},
    "3518": {"symbol": "TORNTPHARM", "prev_close": 0.0},
    "1964": {"symbol": "TRENT", "prev_close": 0.0},
    "11532": {"symbol": "ULTRACEMCO", "prev_close": 0.0},
    "10447": {"symbol": "UNITDSPR", "prev_close": 0.0},
    "18921": {"symbol": "VBL", "prev_close": 0.0},
    "3063": {"symbol": "VEDL", "prev_close": 0.0},
    "3787": {"symbol": "WIPRO", "prev_close": 0.0},
    "7929": {"symbol": "ZYDUSLIFE", "prev_close": 0.0},
}

MIDCAP100_TOKENS: dict[str, dict] = {
    "13061": {"symbol": "360ONE", "prev_close": 0.0},
    "22": {"symbol": "ACC", "prev_close": 0.0},
    "25780": {"symbol": "APLAPOLLO", "prev_close": 0.0},
    "21238": {"symbol": "AUBANK", "prev_close": 0.0},
    "6066": {"symbol": "ATGL", "prev_close": 0.0},
    "21614": {"symbol": "ABCAPITAL", "prev_close": 0.0},
    "11703": {"symbol": "ALKEM", "prev_close": 0.0},
    "212": {"symbol": "ASHOKLEY", "prev_close": 0.0},
    "14418": {"symbol": "ASTRAL", "prev_close": 0.0},
    "275": {"symbol": "AUROPHARMA", "prev_close": 0.0},
    "19585": {"symbol": "BSE", "prev_close": 0.0},
    "4745": {"symbol": "BANKINDIA", "prev_close": 0.0},
    "2144": {"symbol": "BDL", "prev_close": 0.0},
    "422": {"symbol": "BHARATFORG", "prev_close": 0.0},
    "438": {"symbol": "BHEL", "prev_close": 0.0},
    "23489": {"symbol": "BHARTIHEXA", "prev_close": 0.0},
    "11373": {"symbol": "BIOCON", "prev_close": 0.0},
    "8311": {"symbol": "BLUESTARCO", "prev_close": 0.0},
    "21508": {"symbol": "COCHINSHIP", "prev_close": 0.0},
    "11543": {"symbol": "COFORGE", "prev_close": 0.0},
    "15141": {"symbol": "COLPAL", "prev_close": 0.0},
    "4749": {"symbol": "CONCOR", "prev_close": 0.0},
    "739": {"symbol": "COROMANDEL", "prev_close": 0.0},
    "1901": {"symbol": "CUMMINSIND", "prev_close": 0.0},
    "772": {"symbol": "DABUR", "prev_close": 0.0},
    "21690": {"symbol": "DIXON", "prev_close": 0.0},
    "676": {"symbol": "EXIDEIND", "prev_close": 0.0},
    "6545": {"symbol": "NYKAA", "prev_close": 0.0},
    "1023": {"symbol": "FEDERALBNK", "prev_close": 0.0},
    "14592": {"symbol": "FORTIS", "prev_close": 0.0},
    "13528": {"symbol": "GMRAIRPORT", "prev_close": 0.0},
    "7406": {"symbol": "GLENMARK", "prev_close": 0.0},
    "1181": {"symbol": "GODFRYPHLP", "prev_close": 0.0},
    "17875": {"symbol": "GODREJPROP", "prev_close": 0.0},
    "4244": {"symbol": "HDFCAMC", "prev_close": 0.0},
    "1348": {"symbol": "HEROMOTOCO", "prev_close": 0.0},
    "1406": {"symbol": "HINDPETRO", "prev_close": 0.0},
    "18457": {"symbol": "POWERINDIA", "prev_close": 0.0},
    "20825": {"symbol": "HUDCO", "prev_close": 0.0},
    "11184": {"symbol": "IDFCFIRSTB", "prev_close": 0.0},
    "15313": {"symbol": "IRB", "prev_close": 0.0},
    "29251": {"symbol": "ITCHOTELS", "prev_close": 0.0},
    "14309": {"symbol": "INDIANB", "prev_close": 0.0},
    "13611": {"symbol": "IRCTC", "prev_close": 0.0},
    "20261": {"symbol": "IREDA", "prev_close": 0.0},
    "11262": {"symbol": "IGL", "prev_close": 0.0},
    "29135": {"symbol": "INDUSTOWER", "prev_close": 0.0},
    "5258": {"symbol": "INDUSINDBK", "prev_close": 0.0},
    "18096": {"symbol": "JUBLFOOD", "prev_close": 0.0},
    "13310": {"symbol": "KEI", "prev_close": 0.0},
    "9683": {"symbol": "KPITTECH", "prev_close": 0.0},
    "2955": {"symbol": "KALYANKJIL", "prev_close": 0.0},
    "24948": {"symbol": "LTF", "prev_close": 0.0},
    "1997": {"symbol": "LICHSGFIN", "prev_close": 0.0},
    "10440": {"symbol": "LUPIN", "prev_close": 0.0},
    "2277": {"symbol": "MRF", "prev_close": 0.0},
    "13285": {"symbol": "M&MFIN", "prev_close": 0.0},
    "15380": {"symbol": "MANKIND", "prev_close": 0.0},
    "4067": {"symbol": "MARICO", "prev_close": 0.0},
    "2142": {"symbol": "MFSL", "prev_close": 0.0},
    "14947": {"symbol": "MOTILALOFS", "prev_close": 0.0},
    "4503": {"symbol": "MPHASIS", "prev_close": 0.0},
    "23650": {"symbol": "MUTHOOTFIN", "prev_close": 0.0},
    "17400": {"symbol": "NHPC", "prev_close": 0.0},
    "15332": {"symbol": "NMDC", "prev_close": 0.0},
    "27176": {"symbol": "NTPCGREEN", "prev_close": 0.0},
    "6364": {"symbol": "NATIONALUM", "prev_close": 0.0},
    "20242": {"symbol": "OBEROIRLTY", "prev_close": 0.0},
    "17438": {"symbol": "OIL", "prev_close": 0.0},
    "6705": {"symbol": "PAYTM", "prev_close": 0.0},
    "10738": {"symbol": "OFSS", "prev_close": 0.0},
    "6656": {"symbol": "POLICYBZR", "prev_close": 0.0},
    "24184": {"symbol": "PIIND", "prev_close": 0.0},
    "14413": {"symbol": "PAGEIND", "prev_close": 0.0},
    "17029": {"symbol": "PATANJALI", "prev_close": 0.0},
    "18365": {"symbol": "PERSISTENT", "prev_close": 0.0},
    "14552": {"symbol": "PHOENIXLTD", "prev_close": 0.0},
    "9590": {"symbol": "POLYCAB", "prev_close": 0.0},
    "25049": {"symbol": "PREMIERENE", "prev_close": 0.0},
    "20302": {"symbol": "PRESTIGE", "prev_close": 0.0},
    "9552": {"symbol": "RVNL", "prev_close": 0.0},
    "17971": {"symbol": "SBICARD", "prev_close": 0.0},
    "3273": {"symbol": "SRF", "prev_close": 0.0},
    "4684": {"symbol": "SONACOMS", "prev_close": 0.0},
    "2963": {"symbol": "SAIL", "prev_close": 0.0},
    "3363": {"symbol": "SUPREMEIND", "prev_close": 0.0},
    "12018": {"symbol": "SUZLON", "prev_close": 0.0},
    "27066": {"symbol": "SWIGGY", "prev_close": 0.0},
    "3721": {"symbol": "TATACOMM", "prev_close": 0.0},
    "3411": {"symbol": "TATAELXSI", "prev_close": 0.0},
    "20293": {"symbol": "TATATECH", "prev_close": 0.0},
    "13786": {"symbol": "TORNTPOWER", "prev_close": 0.0},
    "312": {"symbol": "TIINDIA", "prev_close": 0.0},
    "11287": {"symbol": "UPL", "prev_close": 0.0},
    "10753": {"symbol": "UNIONBANK", "prev_close": 0.0},
    "27969": {"symbol": "VMM", "prev_close": 0.0},
    "14366": {"symbol": "IDEA", "prev_close": 0.0},
    "3718": {"symbol": "VOLTAS", "prev_close": 0.0},
    "25907": {"symbol": "WAAREEENER", "prev_close": 0.0},
    "11915": {"symbol": "YESBANK", "prev_close": 0.0},
}

# Combined lookup: token → {symbol, prev_close, index}
ALL_TOKENS: dict[str, dict] = {}
for tok, meta in NIFTY100_TOKENS.items():
    ALL_TOKENS[tok] = {**meta, "index": "nifty100"}
for tok, meta in MIDCAP100_TOKENS.items():
    if tok not in ALL_TOKENS:   # avoid overwriting with wrong index label
        ALL_TOKENS[tok] = {**meta, "index": "midcap100"}
for tok, meta in FNO_SYMBOL_TOKEN_MAP.items():
    if tok and tok not in ALL_TOKENS:
        ALL_TOKENS[tok] = {**meta, "index": "fno_only"}

# ── In-memory tick store ──────────────────────────────────────────────────────
_tick_store: dict[str, dict] = {}
_fno_tick_store: dict = {}
_tv_fail_count = {}
_tv_lock = threading.Lock()
live_prices = {}
_store_lock = threading.Lock()
connected_clients = set()
_METADATA_CACHE = os.path.join(".data", "metadata_cache.json")

# Time caching for high-frequency tick updates
_cached_day = ""
_cached_candle_time = ""
_last_time_update = 0

def load_metadata():
    """Loads previous close prices from persistent cache to enable instant startup."""
    if not os.path.exists(_METADATA_CACHE):
        return
    try:
        with open(_METADATA_CACHE, "r") as f:
            cache = json.load(f)
            count = 0
            for token, meta in cache.items():
                if token in ALL_TOKENS:
                    ALL_TOKENS[token]["prev_close"] = meta.get("prev_close", 0.0)
                    ALL_TOKENS[token]["prev_close_confirmed"] = meta.get("prev_close_confirmed", False)
                    count += 1
            logger.info(f"Loaded metadata for {count} tokens from persistence.")
    except Exception as e:
        logger.warning(f"Failed to load metadata cache: {e}")

_last_save_time = 0

def save_metadata(force=False):
    """Saves current confirmed previous close prices to persistent cache."""
    global _last_save_time
    now = time.time()
    if not force and (now - _last_save_time < 10):
        return  # Throttle to once every 10s
        
    try:
        os.makedirs(".data", exist_ok=True)
        cache = {
            tok: {
                "prev_close": m.get("prev_close", 0.0),
                "prev_close_confirmed": m.get("prev_close_confirmed", False)
            }
            for tok, m in ALL_TOKENS.items()
            if m.get("prev_close_confirmed")
        }
        with open(_METADATA_CACHE, "w") as f:
            json.dump(cache, f, indent=2)
        _last_save_time = now
        logger.info(f"Saved metadata for {len(cache)} tokens to persistence.")
    except Exception as e:
        logger.warning(f"Failed to save metadata cache: {e}")


def _update_tick(token: str, ltp: float, volume: int = 0, close_price: float = 0):
    meta = ALL_TOKENS.get(token)
    if not meta:
        return

    # SOURCE PRIORITY: Official close_price from WebSocket is authoritative
    old_prev = meta.get("prev_close", 0.0)
    was_confirmed = meta.get("prev_close_confirmed", False)

    # 1. If WebSocket provides a close_price, it's the absolute truth for NSE
    if close_price > 0:
        # Update if not confirmed OR if there is a significant discrepancy (>0.1%)
        diff = abs(old_prev - close_price)
        percent_diff = (diff / close_price) * 100 if close_price > 0 else 0
        
        if not was_confirmed or percent_diff > 0.1:
            if was_confirmed and percent_diff > 0.1:
                logger.info(f"[Metadata] Corrected {meta['symbol']} prev_close: {old_prev} -> {close_price} ({percent_diff:.2f}% diff)")
            else:
                logger.info(f"[Metadata] Confirming {meta['symbol']} via WebSocket: {close_price}")
            
            meta["prev_close"] = close_price
            meta["prev_close_confirmed"] = True
            # Trigger immediate (but throttled) save
            save_metadata()
            
    # --- Priority 1: Intraday Candle Store (OHLCV 5-min) ---
    global _current_trading_day, _cached_day, _cached_candle_time, _last_time_update
    curr_t = time.time()
    if curr_t - _last_time_update > 1.0:
        now_dt = datetime.now()
        _cached_day = now_dt.strftime("%Y-%m-%d")
        minute_floor = (now_dt.minute // 5) * 5
        _cached_candle_time = now_dt.replace(minute=minute_floor, second=0, microsecond=0).strftime("%H:%M")
        _last_time_update = curr_t
    
    today_str = _cached_day
    candle_time_str = _cached_candle_time

    if today_str != _current_trading_day:
        with _store_lock:
            _intraday_candles.clear()
            _last_cumulative_vol.clear()
        _current_trading_day = today_str

    with _store_lock:
        tick_vol_diff = volume - _last_cumulative_vol[token]
        if tick_vol_diff < 0:
            tick_vol_diff = volume # Volume reset edge-case
        _last_cumulative_vol[token] = volume

        candles = _intraday_candles[token]
        if not candles or candles[-1]["time"] != candle_time_str:
            candles.append({
                "time": candle_time_str,
                "open": ltp,
                "high": ltp,
                "low": ltp,
                "close": ltp,
                "volume": tick_vol_diff
            })
        else:
            c = candles[-1]
            c["high"] = max(c["high"], ltp)
            c["low"] = min(c["low"], ltp)
            c["close"] = ltp
            c["volume"] += tick_vol_diff
    
    # Fallback to current meta if not updated
    prev = meta["prev_close"]
    # Handle division by zero for initial load
    change_pct = round(((ltp - prev) / prev) * 100, 2) if prev > 0 else 0.0
    
    with _store_lock:
        _tick_store[token] = {
            "token":      token,
            "symbol":     meta["symbol"],
            "index":      meta["index"],
            "ltp":        ltp,
            "prev_close": prev,
            "change_pct": change_pct,
            "volume":     volume,
            "prev_close_confirmed": meta.get("prev_close_confirmed", False),
            "updated_at": datetime.now(timezone.utc).isoformat(),
        }
        sym = meta.get("symbol")
        if sym and sym in FNO_SYMBOL_TOKEN_MAP:
            _fno_tick_store[sym] = _tick_store.get(token) or _fno_tick_store.get(sym)


def get_all_ticks() -> list:
    """Return all processed ticks for scanning."""
    with _store_lock:
        return list(_tick_store.values())

def get_intraday_candles(token: str) -> list:
    """Return the OHLCV intraday candles for a token."""
    with _store_lock:
        return list(_intraday_candles.get(token, []))

def get_market_summary(top_n: int = 5) -> dict:
    """Compute top-N gainers and losers for each index."""
    with _store_lock:
        ticks = list(_tick_store.values())

    nifty   = [t for t in ticks if t["index"] == "nifty100"]
    midcap  = [t for t in ticks if t["index"] == "midcap100"]

    def rank(items, reverse):
        # 1. Filter: Must have valid price AND confirmed previous close
        # Exclude stocks with 0 price or 0 prev_close to prevent 100% drop visual glitches
        valid_items = [
            t for t in items 
            if t.get("ltp", 0) > 0.01 
            and t.get("prev_close", 0) > 0.01
            and abs(t.get("change_pct", 0.0)) > 0.001
        ]
        
        # 2. Deduplicate by symbol (safety first)
        seen_symbols = set()
        unique_items = []
        for it in sorted(valid_items, key=lambda x: (abs(x.get("change_pct", 0.0)), x.get("volume", 0)), reverse=True):
            sym = it["symbol"]
            if sym not in seen_symbols:
                unique_items.append(it)
                seen_symbols.add(sym)

        # 3. Final Sort for direction (Gainer vs Loser)
        if reverse: # Gainers
            return sorted(unique_items, key=lambda x: (x.get("change_pct", 0.0), x.get("volume", 0)), reverse=True)[:top_n]
        else: # Losers
            return sorted(unique_items, key=lambda x: (x.get("change_pct", 0.0), -x.get("volume", 0)), reverse=False)[:top_n]

    return {
        "nifty100": {
            "gainers": rank(nifty, reverse=True),
            "losers":  rank(nifty, reverse=False),
        },
        "midcap100": {
            "gainers": rank(midcap, reverse=True),
            "losers":  rank(midcap, reverse=False),
        },
        "last_updated": datetime.now(timezone.utc).isoformat(),
        "total_tokens_tracked": len(ticks),
    }


# ── WebSocket callback handlers ───────────────────────────────────────────────

def _on_data(wsapp, message):
    """Called for every incoming tick message."""
    try:
        # SmartWebSocketV2 delivers parsed dict with 'token', 'last_traded_price', etc.
        token  = str(message.get("token", ""))
        ltp    = message.get("last_traded_price", 0) / 100  # paise → rupees
        volume = message.get("volume_trade_for_the_day", 0)
        close_price = message.get("closed_price", 0)
        if close_price:
            close_price = close_price / 100  # paise → rupees
        live_prices[token] = ltp
        _update_tick(token, ltp, volume, close_price=close_price)
    except Exception as exc:
        logger.warning("Tick parse error: %s | raw=%s", exc, message)


def _on_open(wsapp):
    logger.info("WebSocket connection opened.")


def _on_error(wsapp, error):
    logger.error("WebSocket error: %s", error)


def _on_close(wsapp):
    logger.warning("WebSocket connection closed.")


# ── MarketStreamer ─────────────────────────────────────────────────────────────

class MarketStreamer:
    """Manages Angel One auth, WebSocket subscription, and reconnection loop."""

    RECONNECT_DELAY = 10  # seconds

    def __init__(self, api_key: str, client_code: str, password: str, totp_secret: str):
        self.api_key     = api_key
        self.client_code = client_code
        self.password    = password
        self.totp_secret = totp_secret
        self._running    = False
        self._sws: Optional[SmartWebSocketV2] = None
        self.is_connected = False
        self._tasks_started = False

    # ── Authentication ────────────────────────────────────────────────────────

    def _login(self) -> tuple[str, str, str]:
        """Authenticate and return (auth_token, feed_token, refresh_token)."""
        totp = pyotp.TOTP(self.totp_secret).now()
        smart = SmartConnect(api_key=self.api_key)
        data  = smart.generateSession(self.client_code, self.password, totp)
        if data["status"] is False:
            raise RuntimeError(f"Angel One login failed: {data['message']}")
        auth_token    = data["data"]["jwtToken"]
        refresh_token = data["data"]["refreshToken"]
        feed_token    = smart.getfeedToken()
        logger.info("Angel One login successful for client: %s", self.client_code)
        return auth_token, feed_token, refresh_token

    # ── Subscription helper ───────────────────────────────────────────────────

    def _build_token_list(self) -> list[dict]:
        """Build subscription payload: list of {exchangeType, tokens}."""
        all_toks = list(ALL_TOKENS.keys())
        return [{"exchangeType": NSE_SEGMENT, "tokens": all_toks}]

    # ── Main run loop ─────────────────────────────────────────────────────────

    async def run(self):
        self._running = True
        reconnect_delay = 5  # initial backoff

        # Start background tasks ONCE per lifespan
        if not self._tasks_started:
            asyncio.create_task(market_pusher())
            asyncio.create_task(scan_loop())
            self._tasks_started = True

        while self._running:
            try:
                auth_token, feed_token, _ = await asyncio.to_thread(self._login)
                token_list = self._build_token_list()

                self._sws = SmartWebSocketV2(
                    auth_token   = auth_token,
                    api_key      = self.api_key,
                    client_code  = self.client_code,
                    feed_token   = feed_token,
                    max_retry_attempt = 50,
                )

                # Set callbacks as attributes (library API pattern)
                sws = self._sws

                def _subscribe_on_open(wsapp):
                    nonlocal reconnect_delay
                    reconnect_delay = 5  # reset delay on successful connection
                    _on_open(wsapp)
                    # Use QUOTE mode (2) to get volume + close_price
                    sws.subscribe("stock-feed", 2, token_list)
                    self.is_connected = True

                sws.on_open  = _subscribe_on_open
                sws.on_data  = _on_data
                sws.on_error = _on_error
                sws.on_close = _on_close

                logger.info("Starting WebSocket stream for %d tokens...", len(ALL_TOKENS))

                # connect() is blocking; run in a thread so we stay async-friendly
                await asyncio.to_thread(sws.connect)

            except asyncio.CancelledError:
                logger.info("Streamer cancelled.")
                break
            except Exception as exc:
                logger.error("Streamer error: %s - reconnecting in %ds", exc, reconnect_delay)
            finally:
                self.is_connected = False

            if self._running:
                await asyncio.sleep(reconnect_delay)
                reconnect_delay = min(reconnect_delay * 2, 120)

    def stop(self):
        logger.info("Graceful SIGTERM shutdown - closing Angel One WebSocket...")
        self._running = False
        self.is_connected = False
        if self._sws:
            try:
                self._sws.close_connection()
            except Exception as e:
                logger.error(f"Error closing WebSocket: {e}")


async def fetch_angel_one_historical(symbol, token, exchange='NSE'):
    from . import historical
    import pandas as pd
    import asyncio
    
    smart = historical._get_smart_connect()
    # Fetch 7 days to ensure we have a previous trading day
    to_date = datetime.now().strftime("%Y-%m-%d %H:%M")
    from_date = (datetime.now() - timedelta(days=7)).strftime("%Y-%m-%d %H:%M")
    
    def _fetch():
        return smart.getCandleData({
            "exchange": exchange,
            "symboltoken": str(token),
            "interval": "ONE_DAY",  
            "fromdate": from_date,
            "todate": to_date
        })
    res = await asyncio.to_thread(_fetch)
    if res and res.get('status') and res.get('data'):
        df = pd.DataFrame(res['data'], columns=['timestamp', 'open', 'high', 'low', 'close', 'volume'])
        return df
    return None

def process_symbol_data(df, symbol, price):
    meta = None
    token = None
    for tok, m in ALL_TOKENS.items():
        if m['symbol'] == symbol:
            token = tok
            meta = m
            break
            
    if not meta or not token:
        return None
        
    # Better historical fallback: Use most recent completed trading day's close
    if not meta.get('prev_close_confirmed', False) and df is not None and not df.empty:
        try:
            import pandas as pd
            today_date = datetime.now().strftime("%Y-%m-%d")
            
            if 'timestamp' in df.columns:
                df['date_only'] = pd.to_datetime(df['timestamp']).dt.strftime('%Y-%m-%d')
                hist_df = df[df['date_only'] < today_date].copy()
            else:
                hist_df = df.copy()

            if not hist_df.empty:
                hist_df['dt'] = pd.to_datetime(hist_df['timestamp'])
                hist_df = hist_df.sort_values('dt')
                
                recent_day = hist_df.iloc[-1]
                recent_close = float(recent_day['close'])
                meta['prev_close'] = recent_close
                meta['prev_close_confirmed'] = True
                logger.debug(f"[Historical] Set {symbol} prev_close={meta['prev_close']} from {recent_day['timestamp'][:10]}")
        except Exception as e:
            logger.error(f"[Historical] Fallback error for {symbol}: {e}")

    _update_tick(token, price or 0.0)
    with _store_lock:
        return _tick_store.get(token)

def get_prev_close_status():
    """Returns a report of how many symbols have confirmed previous close prices."""
    confirmed = sum(1 for m in ALL_TOKENS.values() if m.get('prev_close_confirmed'))
    total = len(ALL_TOKENS)
    return {
        "confirmed": confirmed,
        "total": total,
        "pending": total - confirmed,
        "health_pct": round((confirmed / total) * 100, 2) if total > 0 else 0
    }

async def safe_send(ws, data):
    try:
        await ws.send_json(data)
    except Exception:
        connected_clients.discard(ws)

async def broadcast(data):
    """Broadcast JSON to all connected dashboard clients."""
    if not connected_clients:
        return
    tasks = [safe_send(ws, data) for ws in list(connected_clients)]
    if tasks:
        await asyncio.gather(*tasks)


async def fetch_symbol_safe(symbol, token, exchange='NSE'):
    """Fetch OHLC data with retry + yFinance fallback."""
    import yfinance as yf
    import gc

    df = None

    # Try Angel One historical API first
    for attempt in range(2):
        try:
            df = await fetch_angel_one_historical(symbol, token, exchange)
            if df is not None and not df.empty:
                break
        except Exception as e:
            logger.error(f'[Angel Historical] {symbol} error: {e}')
            await asyncio.sleep(1)

    # yFinance fallback
    if df is None or df.empty:
        try:
            yf_sym = f'{symbol}.NS' if exchange == 'NSE' else f'{symbol}.BO'
            df = await asyncio.to_thread(yf.download, yf_sym, period='5d', interval='1d', progress=False)
            if df is not None and not df.empty:
                logger.debug(f'[yFinance fallback] {symbol} OK')
        except Exception as e:
            logger.error(f'[yFinance] {symbol}: {e}')

    price = live_prices.get(token)
    if price is None and df is not None and not df.empty:
        price = float(df['close'].iloc[-1])

    result = process_symbol_data(df, symbol, price)
    del df
    gc.collect()
    return result

async def market_pusher():
    """Periodically broadcasts the top 5 gainers/losers to all clients."""
    while True:
        try:
            summary = get_market_summary(top_n=5)
            
            # Prepare F&O Movers
            fno_list = list(_fno_tick_store.values())
            valid_fno = [
                v for v in fno_list 
                if v and v.get("change_pct") is not None and v.get("ltp", 0) > 0 and abs(v.get("change_pct", 0.0)) > 0.001
            ]
            
            # Sort F&O: Primary by change_pct, Secondary by volume
            fno_sorted_asc = sorted(valid_fno, key=lambda x: (x.get("change_pct", 0.0), -x.get("volume", 0)), reverse=False)
            fno_sorted_desc = sorted(valid_fno, key=lambda x: (x.get("change_pct", 0.0), x.get("volume", 0)), reverse=True)
            
            fno_movers = {
                'gainers': fno_sorted_desc[:5],
                'losers':  fno_sorted_asc[:5]
            }

            # The frontend (App.js) handles updates per index. 
            # We broadcast one message per index to ensure state is updated correctly.
            for idx in ["nifty100", "midcap100"]:
                await broadcast({
                    'type':       'full_update',
                    'index':      idx,
                    'gainers':    summary[idx]["gainers"],
                    'losers':     summary[idx]["losers"],
                    'fno_movers': fno_movers,
                    'total':      summary.get('total_tokens_tracked', 200)
                })

        except Exception as e:
            logger.error(f"[Pusher] Error: {e}")
        
        await asyncio.sleep(2)

async def scan_loop():
    """Metadata scavenger loop. Focuses on filling missing prev_close/OHLC."""
    while True:
        cycle_start = time.time()
        to_fetch = []
        
        # Determine which tokens need historical data
        for tok, meta in ALL_TOKENS.items():
            with _store_lock:
                tick = _tick_store.get(tok)
                # If already confirmed (via WebSocket or past fetch), skip
                if meta.get('prev_close_confirmed'):
                    continue
                to_fetch.append((meta['symbol'], tok))
        
        # PRIORITIZE: Sort such that symbols in FNO_SYMBOL_TOKEN_MAP come first
        to_fetch.sort(key=lambda x: x[0] in FNO_SYMBOL_TOKEN_MAP, reverse=True)

        if to_fetch:
            logger.info(f'[Scan] Backfilling {len(to_fetch)} symbols...')
            # Fetch in batches of 10 for safety against Angel One rate limits
            batch_size = 10
            for i in range(0, len(to_fetch), batch_size):
                batch = to_fetch[i : i + batch_size]
                tasks = [fetch_symbol_safe(sym, tok) for sym, tok in batch]
                if tasks:
                    results = await asyncio.gather(*tasks, return_exceptions=True)
                    # Check for rate limiting in batch results (AB1012 or 429)
                    if any(x in str(r).lower() for r in results if isinstance(r, (Exception, str)) for x in ["access rate", "ab1012", "too many requests"]):
                        logger.warning("[Scan] Rate limit detected. Backing off for 120s...")
                        await asyncio.sleep(120)
                        break
                
                # Intra-batch sleep for extra safety
                await asyncio.sleep(2.0) 
                # Save progress after every batch
                save_metadata()

        cycle_time = time.time() - cycle_start
        # Once all are confirmed, wait 60s for next pass. Otherwise retry missing after 10s.
        sleep_time = 10 if to_fetch else 60
        if to_fetch:
             logger.info(f'[Scan] Scavenger cycle complete in {cycle_time:.1f}s.')
        await asyncio.sleep(sleep_time) 
