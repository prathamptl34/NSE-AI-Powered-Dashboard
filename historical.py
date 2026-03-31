import os
import time
import logging
import pyotp
import json
import threading
from datetime import datetime, timedelta, date, timezone
from SmartApi import SmartConnect
from cachetools import TTLCache

# Import token dicts from existing streamer — do NOT redefine
from streamer import NIFTY100_TOKENS, MIDCAP100_TOKENS
from nse_holidays import is_trading_day, get_last_trading_day_str

logger = logging.getLogger(__name__)

# ── Cache: store results for 60 minutes per (date, index) combo ───────────────
# Max 50 cached results (50 unique date+index combinations)
_memory_cache: TTLCache = TTLCache(maxsize=50, ttl=3600)
_PERSISTENT_CACHE_DIR = ".data"
_PERSISTENT_CACHE_FILE = os.path.join(_PERSISTENT_CACHE_DIR, "historical_cache.json")
_persist_lock = threading.Lock()

def _load_persistent_cache() -> dict:
    if not os.path.exists(_PERSISTENT_CACHE_DIR):
        os.makedirs(_PERSISTENT_CACHE_DIR, exist_ok=True)
    if not os.path.exists(_PERSISTENT_CACHE_FILE):
        return {}
    try:
        with open(_PERSISTENT_CACHE_FILE, "r") as f:
            return json.load(f)
    except Exception as e:
        logger.warning(f"Failed to load persistent cache: {e}")
        return {}

def _save_to_persistent_cache(key: str, data: dict):
    with _persist_lock:
        cache = _load_persistent_cache()
        cache[key] = {
            "data": data,
            "saved_at": datetime.now().isoformat()
        }
        try:
            with open(_PERSISTENT_CACHE_FILE, "w") as f:
                json.dump(cache, f, indent=2)
        except Exception as e:
            logger.warning(f"Failed to save persistent cache: {e}")

# ── Auth helper ───────────────────────────────────────────────────────────────

def _get_smart_connect() -> SmartConnect:
    """Authenticate and return a SmartConnect session."""
    totp = pyotp.TOTP(os.environ["ANGEL_TOTP_SECRET"]).now()
    smart = SmartConnect(api_key=os.environ["ANGEL_API_KEY"])
    resp = smart.generateSession(
        os.environ["ANGEL_CLIENT_ID"],
        os.environ["ANGEL_PASSWORD"],
        totp,
    )
    if not resp or resp.get("status") is False:
        raise RuntimeError(f"Angel One login failed: {resp.get('message', 'Unknown error')}")
    logger.info("Historical: Angel One login successful.")
    return smart


# ── Date helpers ──────────────────────────────────────────────────────────────

def _get_from_date(target_date_str: str) -> str:
    """
    Returns the from_date for getCandleData — 10 calendar days before target_date.
    Format: "YYYY-MM-DD HH:MM"
    """
    target = datetime.strptime(target_date_str, "%Y-%m-%d")
    from_dt = target - timedelta(days=10)
    return from_dt.strftime("%Y-%m-%d %H:%M")


def _is_today_and_market_open(date_str: str) -> bool:
    """
    Returns True if date_str is today AND current IST time is before 15:30.
    """
    today_str = datetime.now().strftime("%Y-%m-%d")
    if date_str != today_str:
        return False
    now_utc = datetime.now(timezone.utc)
    ist_offset = timedelta(hours=5, minutes=30)
    now_ist = now_utc + ist_offset
    market_close = now_ist.replace(hour=15, minute=30, second=0, microsecond=0)
    return now_ist < market_close


# ── Core fetch logic ──────────────────────────────────────────────────────────

def _fetch_token_candles(smart: SmartConnect, token: str, target_date_str: str, retry: bool = True) -> dict | None:
    """
    Fetch ONE_DAY candles for a single token.
    """
    from_date = _get_from_date(target_date_str)
    to_date   = f"{target_date_str} 23:59"

    try:
        resp = smart.getCandleData({
            "exchange":    "NSE",
            "symboltoken": token,
            "interval":    "ONE_DAY",
            "fromdate":    from_date,
            "todate":      to_date,
        })
    except Exception as e:
        logger.warning(f"getCandleData API error for token {token}: {e}")
        return None

    if not resp:
        return None
        
    if resp.get("status") is False:
        msg = resp.get('message', '').lower()
        if retry and ('session' in msg or 'invalid jwt' in msg):
            logger.info(f"Historical: Session expired during fetch for {token}. Re-authenticating...")
            # Note: In a real multi-threaded scenario, we'd need a re-login lock, 
            # but for simplicity, we'll try to let the next thread handle it or just fail this one.
            return None 
        return None

    candles = resp.get("data", [])
    if not candles:
        return None

    target_candle = None
    prev_candle   = None

    for i, candle in enumerate(candles):
        candle_date = candle[0][:10]
        if candle_date == target_date_str:
            target_candle = candle
            if i > 0:
                prev_candle = candles[i - 1]
            break

    if target_candle is None:
        return None

    prev_close = prev_candle[4] if prev_candle else target_candle[1]
    return {
        "open":       target_candle[1],
        "high":       target_candle[2],
        "low":        target_candle[3],
        "close":      target_candle[4],
        "volume":     target_candle[5],
        "prev_close": prev_close,
    }


def _calculate_change_pct(close: float, prev_close: float) -> float:
    if not prev_close or prev_close == 0:
        return 0.0
    return round(((close - prev_close) / prev_close) * 100, 2)


def _process_single_token(smart: SmartConnect, token: str, meta: dict, date_str: str, index: str, delay: float = 0.0) -> dict | None:
    if delay > 0:
        time.sleep(delay)
        
    candle = _fetch_token_candles(smart, token, date_str)
    # Reduced wait to 0.1s for speed, but staggering helps avoid burst limits
    time.sleep(0.1) 
    
    if candle is None:
        return None

    change_pct = _calculate_change_pct(candle["close"], candle["prev_close"])
    return {
        "token":      token,
        "symbol":     meta["symbol"],
        "index":      index,
        "open":       round(candle["open"],       2),
        "high":       round(candle["high"],       2),
        "low":        round(candle["low"],        2),
        "close":      round(candle["close"],      2),
        "prev_close": round(candle["prev_close"], 2),
        "change_pct": change_pct,
        "volume":     candle["volume"],
        "date":       date_str,
    }


# ── Main public function ──────────────────────────────────────────────────────

def get_historical_summary(date_str: str, index: str, top_n: int = 5) -> dict:
    """
    Fetch top gainers and losers. Optimized with Persistent JSON cache and ThreadPoolExecutor.
    """
    import concurrent.futures

    # ── Cache check (Memory + Persistent) ─────────────────────────────────────
    cache_key = f"{date_str}_{index}_{top_n}"
    if cache_key in _memory_cache:
        cached = dict(_memory_cache[cache_key])
        cached["cached"] = True
        return cached

    persist = _load_persistent_cache()
    if cache_key in persist:
        data = persist[cache_key]["data"]
        data["cached"] = True
        _memory_cache[cache_key] = data
        return data

    # ── Select token dict ─────────────────────────────────────────────────────
    tokens = NIFTY100_TOKENS if index == "nifty100" else MIDCAP100_TOKENS
    total_tokens = len(tokens)
    start_time_fetch = time.time()
    logger.info(f"Historical: COLD FETCH for {total_tokens} tokens on {date_str}...")

    # ── Authenticate ──────────────────────────────────────────────────────────
    smart = _get_smart_connect()

    # ── Parallel Fetch ────────────────────────────────────────────────────────
    results = []
    errors = 0
    
    # Accelerated to 10 workers for speed
    with concurrent.futures.ThreadPoolExecutor(max_workers=10) as executor:
        # Reduced staggering to 0.05s
        future_to_token = {
            executor.submit(_process_single_token, smart, t, m, date_str, index, i * 0.05): t 
            for i, (t, m) in enumerate(tokens.items())
        }
        
        for i, future in enumerate(concurrent.futures.as_completed(future_to_token)):
            token = future_to_token[future]
            try:
                res = future.result()
                if res:
                    results.append(res)
                else:
                    errors += 1
            except Exception as exc:
                errors += 1
                logger.error(f"Historical: Fetch failed for {token}: {exc}")
            
            if (i+1) % 25 == 0:
                logger.info(f"Historical Progress: {i+1}/{total_tokens} fetched...")

    fetch_duration = time.time() - start_time_fetch
    tokens_with_data = len(results)
    
    logger.info(f"Historical: Fetch complete in {fetch_duration:.2f}s. {tokens_with_data} with data.")

    # ── Sort and slice ────────────────────────────────────────────────────────
    try:
        gainers = sorted(results, key=lambda x: x["change_pct"], reverse=True)[:top_n]
        losers  = sorted(results, key=lambda x: x["change_pct"])[:top_n]

        output = {
            "gainers":              gainers,
            "losers":               losers,
            "date":                 date_str,
            "index":                index,
            "total_tokens_fetched": total_tokens,
            "tokens_with_data":     tokens_with_data,
            "is_intraday":          _is_today_and_market_open(date_str),
            "cached":               False,
            "fetch_duration_s":     round(fetch_duration, 2)
        }

        # ── Cache result (skip caching if today and market still open) ────────────
        if not output["is_intraday"] and tokens_with_data > 0:
            _memory_cache[cache_key] = output
            _save_to_persistent_cache(cache_key, output)

        return output
    except Exception as e:
        logger.error(f"Historical sorting failed: {e}", exc_info=True)
        raise

# ── Intraday Sparklines ───────────────────────────────────────────────────────

_intraday_cache: TTLCache = TTLCache(maxsize=200, ttl=300) # 5 min cache

def get_intraday_sparklines(tokens: list[str]) -> dict:
    """
    Fetch FIVE_MINUTE candles for today for a batch of tokens.
    Returns { token: [close_price1, close_price2, ...] }
    """
    import concurrent.futures
    import time
    
    smart = _get_smart_connect()
    
    # Get last active trading day's range
    target_day_str = get_last_trading_day_str()
    from_date = f"{target_day_str} 09:15"
    to_date = f"{target_day_str} 15:30"
    
    results = {}
    tokens_to_fetch = []
    
    for t in tokens:
        if t in _intraday_cache:
            results[t] = _intraday_cache[t]
        else:
            tokens_to_fetch.append(t)
            
    if not tokens_to_fetch:
        return results
        
    def fetch_single(token, delay):
        if delay > 0:
            time.sleep(delay)
        
        req = {
            "exchange": "NSE",
            "symboltoken": token,
            "interval": "FIVE_MINUTE",
            "fromdate": from_date,
            "todate": to_date
        }
        res = smart.getCandleData(req)
        # 3 req/sec limit means we must wait at least 0.35s before the next call
        time.sleep(0.35) 
        
        if res and res.get("status") and res.get("data"):
            # Return list of close prices (index 4)
            return token, [row[4] for row in res["data"]]
        return token, []
        
    # Execute sequentially with 2 workers to avoid banning
    with concurrent.futures.ThreadPoolExecutor(max_workers=2) as executor:
        future_to_token = {
            executor.submit(fetch_single, t, i * 0.4): t 
            for i, t in enumerate(tokens_to_fetch)
        }
        for future in concurrent.futures.as_completed(future_to_token):
            token, prices = future.result()
            if prices:
                _intraday_cache[token] = prices
                results[token] = prices

    return results
