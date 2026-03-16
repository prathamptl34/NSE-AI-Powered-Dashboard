"""
Historical Gainers/Losers using Angel One getCandleData REST API.
This module is completely separate from the live WebSocket streamer.
Each call authenticates fresh and fetches ONE_DAY candles for all tokens.
"""

import os
import time
import logging
import pyotp
from datetime import datetime, timedelta, date, timezone
from SmartApi import SmartConnect
from cachetools import TTLCache

# Import token dicts from existing streamer — do NOT redefine
from streamer import NIFTY100_TOKENS, MIDCAP100_TOKENS
from nse_holidays import is_trading_day

logger = logging.getLogger(__name__)

# ── Cache: store results for 60 minutes per (date, index) combo ───────────────
# Max 50 cached results (50 unique date+index combinations)
_cache: TTLCache = TTLCache(maxsize=50, ttl=3600)


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
    This ensures we always capture at least 1 previous trading day (prev_close),
    even across long weekends and multi-day NSE holidays.
    Format: "YYYY-MM-DD HH:MM"
    """
    target = datetime.strptime(target_date_str, "%Y-%m-%d")
    from_dt = target - timedelta(days=10)
    return from_dt.strftime("%Y-%m-%d %H:%M")


def _is_today_and_market_open(date_str: str) -> bool:
    """
    Returns True if date_str is today AND current IST time is before 15:30.
    Used to show an intraday warning on the frontend.
    """
    today_str = datetime.now().strftime("%Y-%m-%d")
    if date_str != today_str:
        return False
    # IST = UTC + 5:30
    now_utc = datetime.now(timezone.utc)
    now_ist_hour   = (now_utc.hour + 5) % 24
    now_ist_minute = (now_utc.minute + 30) % 60
    if now_utc.minute + 30 >= 60:
        now_ist_hour += 1
    market_close_hour, market_close_minute = 15, 30
    return (now_ist_hour, now_ist_minute) < (market_close_hour, market_close_minute)


# ── Core fetch logic ──────────────────────────────────────────────────────────

def _fetch_token_candles(smart: SmartConnect, token: str, target_date_str: str) -> dict | None:
    """
    Fetch ONE_DAY candles for a single token.
    Returns the OHLCV data for target_date and prev_close from the day before.
    Returns None if data is unavailable for this token/date.
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
        logger.warning("getCandleData failed for token %s: %s", token, e)
        return None

    if not resp or resp.get("status") is False:
        return None

    candles = resp.get("data", [])
    # candles format: [[timestamp, open, high, low, close, volume], ...]

    if not candles:
        return None

    # Find the candle for the target date
    target_candle = None
    prev_candle   = None

    for i, candle in enumerate(candles):
        candle_date = candle[0][:10]  # "YYYY-MM-DDTHH:MM:SS..." → "YYYY-MM-DD"
        if candle_date == target_date_str:
            target_candle = candle
            if i > 0:
                prev_candle = candles[i - 1]
            break

    if target_candle is None:
        # No trading data for this token on target date
        return None

    prev_close = prev_candle[4] if prev_candle else target_candle[1]  # fallback: use open

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
    """Helper for parallel execution to fetch and calculate change for one token."""
    if delay > 0:
        time.sleep(delay)
        
    candle = _fetch_token_candles(smart, token, date_str)
    # Angel One rate limits are ~10 req/sec. With 3-5 threads, a 0.5s sleep per request 
    # ensures we stay safely below that limit while still being much faster than serial.
    time.sleep(0.5) 
    
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
    Fetch top gainers and losers for all tokens in the given index on a specific date.
    Optimized with ThreadPoolExecutor for parallel fetching.
    """
    import concurrent.futures

    # ── Cache check ───────────────────────────────────────────────────────────
    cache_key = f"{date_str}_{index}_{top_n}"
    if cache_key in _cache:
        logger.info("Historical: Cache hit for %s %s", date_str, index)
        cached = dict(_cache[cache_key])
        cached["cached"] = True
        return cached

    # ── Select token dict ─────────────────────────────────────────────────────
    tokens = NIFTY100_TOKENS if index == "nifty100" else MIDCAP100_TOKENS
    total_tokens = len(tokens)
    start_time_fetch = time.time()
    logger.info("Historical: Parallel fetching %d tokens for %s on %s", total_tokens, index, date_str)

    # ── Authenticate ──────────────────────────────────────────────────────────
    smart = _get_smart_connect()

    # ── Parallel Fetch ────────────────────────────────────────────────────────
    results = []
    errors = 0
    
    # We use a ThreadPoolExecutor with 3 workers.
    # Angel One rate limits are ~10 req/sec. 3 threads with 0.5s sleep = 6 req/sec.
    with concurrent.futures.ThreadPoolExecutor(max_workers=3) as executor:
        # Create a mapping of future to token for error tracking.
        # We stagger the start of each worker to avoid a simultaneous burst.
        future_to_token = {
            executor.submit(_process_single_token, smart, t, m, date_str, index, i * 0.15): t 
            for i, (t, m) in enumerate(tokens.items())
        }
        
        for future in concurrent.futures.as_completed(future_to_token):
            token = future_to_token[future]
            try:
                res = future.result()
                if res:
                    results.append(res)
                else:
                    errors += 1
                    logger.debug("Historical: No data for token %s", token)
            except Exception as exc:
                errors += 1
                logger.error("Historical: Fetch failed for token %s: %s", token, exc, exc_info=True)

    fetch_duration = time.time() - start_time_fetch
    tokens_with_data = len(results)
    logger.info(
        "Historical: Parallel fetch complete in %.2fs. %d fetched, %d with data, %d errors.",
        fetch_duration, total_tokens, tokens_with_data, errors
    )

    # ── Sort and slice ────────────────────────────────────────────────────────
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
    if not output["is_intraday"]:
        _cache[cache_key] = output

    return output
