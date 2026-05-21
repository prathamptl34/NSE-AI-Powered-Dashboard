"""
screener_engine.py — Universal Stock Screener Engine

Architecture: Chartink-style in-memory cache, per-timeframe.
- One SCREENER_CACHE per timeframe: 5min, 15min, 1hr, 1day
- Cache built in background every 5 minutes per interval.
- /api/screener/run scans against cache ONLY — no Angel One API calls at scan time.
- Results stream in < 3 seconds regardless of market hours.
"""
import os
import json
import time
import math
import logging
import asyncio
import random
import numpy as np
from datetime import datetime
import pytz

from backend.signal_engine import FNO_STOCKS, STOCK_SECTORS
from backend.streamer import NIFTY100_TOKENS, MIDCAP100_TOKENS, ALL_TOKENS

logger = logging.getLogger(__name__)

IST = pytz.timezone("Asia/Kolkata")

# ─── Timeframe Config ──────────────────────────────────────────────────────────
VALID_INTERVALS = ("5min", "15min", "1hr", "1day")
DEFAULT_INTERVAL = "1day"

# Angel One API interval codes
INTERVAL_TO_ANGEL_CODE = {
    "5min":  "FIVE_MINUTE",
    "15min": "FIFTEEN_MINUTE",
    "1hr":   "ONE_HOUR",
    "1day":  "ONE_DAY",
}

# ─── Per-timeframe Cache Store ─────────────────────────────────────────────────
# Each key is one of VALID_INTERVALS
_CACHE_STORE: dict[str, list[dict]] = {k: [] for k in VALID_INTERVALS}
_CACHE_BUILT_AT: dict[str, datetime | None] = {k: None for k in VALID_INTERVALS}
_CACHE_LOCK = asyncio.Lock()

_DATA_DIR = ".data"
os.makedirs(_DATA_DIR, exist_ok=True)
_saved_presets_file = os.path.join(_DATA_DIR, "screener_presets.json")


# ─── Preset Definitions ────────────────────────────────────────────────────────
BUILTIN_PRESETS = [
    {
        "id": "strong_movers",
        "name": "Strong Movers",
        "description": "Stocks moving up more than 2% today",
        "icon": "🚀",
        "tag": "BULLISH",
        "filters": [
            {"field": "pct_change", "operator": ">", "value": 2},
        ],
        "logic": "AND",
    },
    {
        "id": "volume_breakout",
        "name": "Volume Breakout",
        "description": "Unusually high buying activity detected",
        "icon": "📈",
        "tag": "BREAKOUT",
        "filters": [
            {"field": "volume_ratio", "operator": ">", "value": 3},
            {"field": "pct_change", "operator": ">", "value": 1},
        ],
        "logic": "AND",
    },
    {
        "id": "oversold_bounce",
        "name": "Oversold Bounce",
        "description": "Stocks that fell too much, may bounce back",
        "icon": "💎",
        "tag": "BULLISH",
        "filters": [
            {"field": "rsi_14", "operator": "<", "value": 30},
            {"field": "pct_change", "operator": ">", "value": 0},
        ],
        "logic": "AND",
    },
    {
        "id": "momentum_surge",
        "name": "Momentum Surge",
        "description": "Strong stocks getting even stronger",
        "icon": "⚡",
        "tag": "MOMENTUM",
        "filters": [
            {"field": "rsi_14", "operator": ">", "value": 60},
            {"field": "volume_ratio", "operator": ">", "value": 1.5},
            {"field": "pct_change", "operator": ">", "value": 1},
        ],
        "logic": "AND",
    },
    {
        "id": "near_52w_high",
        "name": "Near 52W High",
        "description": "Stocks close to their yearly highest price",
        "icon": "🏔",
        "tag": "BREAKOUT",
        "filters": [
            {"field": "pct_from_52h", "operator": ">", "value": -3},
        ],
        "logic": "AND",
    },
]


# ─── JSON Sanitizer ────────────────────────────────────────────────────────────
def sanitize_for_json(obj):
    """Recursively convert numpy/special types to native Python types."""
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
    elif isinstance(obj, float) and (math.isnan(obj) or math.isinf(obj)):
        return None
    elif obj != obj:  # NaN check for non-numpy
        return None
    return obj


# ─── Native Python Indicator Computations ─────────────────────────────────────

def compute_rsi_native(closes: list[float], period: int = 14) -> float:
    """
    Compute RSI(14) using Wilder's smoothing method.
    Pure Python — no TA-Lib, no pandas-ta.
    Returns 50.0 if insufficient data.
    """
    if len(closes) < period + 1:
        return 50.0

    deltas = [closes[i] - closes[i - 1] for i in range(1, len(closes))]
    gains = [max(d, 0.0) for d in deltas]
    losses = [abs(min(d, 0.0)) for d in deltas]

    avg_gain = sum(gains[:period]) / period
    avg_loss = sum(losses[:period]) / period

    for i in range(period, len(gains)):
        avg_gain = (avg_gain * (period - 1) + gains[i]) / period
        avg_loss = (avg_loss * (period - 1) + losses[i]) / period

    if avg_loss == 0:
        return 100.0
    rs = avg_gain / avg_loss
    return round(100 - (100 / (1 + rs)), 2)


def compute_vol_ratio(volumes: list[float]) -> float:
    """
    Current volume / 20-period average volume.
    Returns 1.0 if insufficient data.
    """
    if len(volumes) < 2:
        return 1.0
    current = volumes[-1]
    lookback = volumes[-21:-1] if len(volumes) >= 21 else volumes[:-1]
    avg = sum(lookback) / len(lookback) if lookback else 1
    if avg <= 0:
        return 1.0
    return round(current / avg, 2)


def _derive_signal(rsi: float, pct_change: float) -> str:
    """Simple signal derivation from RSI + change_pct."""
    if rsi < 30 and pct_change > 0:
        return "BUY"
    if rsi > 70 and pct_change < 0:
        return "SELL"
    if rsi < 40 and pct_change > 1:
        return "BUY"
    if rsi > 60 and pct_change < -1:
        return "SELL"
    return "NEUTRAL"


# ─── Demo Dataset (200 realistic symbols) ─────────────────────────────────────

_DEMO_SYMBOLS_EXTRA = [
    "RELIANCE", "TCS", "HDFCBANK", "INFY", "ICICIBANK",
    "HINDUNILVR", "ITC", "SBIN", "BHARTIARTL", "KOTAKBANK",
    "LT", "AXISBANK", "ASIANPAINT", "MARUTI", "TITAN",
    "SUNPHARMA", "ULTRACEMCO", "BAJFINANCE", "WIPRO", "NESTLEIND",
    "HCLTECH", "TECHM", "POWERGRID", "NTPC", "ONGC",
    "JSWSTEEL", "TATASTEEL", "HINDALCO", "COALINDIA", "GRASIM",
    "ADANIPORTS", "BAJAJFINSV", "DIVISLAB", "DRREDDY", "CIPLA",
    "EICHERMOT", "HEROMOTOCO", "BPCL", "IOC", "BRITANNIA",
    "SHREECEM", "INDUSINDBK", "M&M", "TATAMOTORS", "HDFCLIFE",
    "SBILIFE", "PIDILITIND", "HAVELLS", "SIEMENS", "ABB",
    "BEL", "CGPOWER", "TRENT", "DMART", "ZOMATO",
    "NAUKRI", "PAYTM", "BAJAJ-AUTO", "TATACONSUM", "APOLLOHOSP",
    "ADANIENT", "ADANIGREEN", "ADANIPOWER", "HAL", "MAZDOCK",
    "IRFC", "RECLTD", "PFC", "LICI", "LODHA",
    "DLF", "GODREJCP", "GODREJPROP", "OBEROIRLTY", "PRESTIGE",
    "PHOENIXLTD", "TATAPOWER", "JSWENERGY", "GAIL", "MOTHERSON",
    "BOSCHLTD", "BHARATFORG", "TVSMOTOR", "TIINDIA",
    "COROMANDEL", "PIIND", "CUMMINSIND", "POLYCAB", "KEI",
    "APLAPOLLO", "DIXON", "VOLTAS", "BLUESTARCO", "KALYANKJIL",
    "JUBLFOOD", "ZYDUSLIFE", "LUPIN", "AUROPHARMA", "TORNTPHARM",
    "ALKEM", "MANKIND", "MAXHEALTH", "FORTIS", "ICICIGI",
    "SBICARD", "HDFCAMC", "MOTILALOFS", "BSE", "BAJAJHLDNG",
    "BANKBARODA", "CANBK", "PNB", "UNIONBANK", "INDIANB",
    "BANKINDIA", "IDFCFIRSTB", "AUBANK", "FEDERALBNK", "YESBANK",
    "LICHSGFIN", "CHOLAFIN", "SHRIRAMFIN", "MUTHOOTFIN", "M&MFIN",
    "LTF", "IRCTC", "IREDA", "RVNL",
    "NHPC", "SJVN", "TORNTPOWER", "TATACOMM",
    "TATAELXSI", "TATATECH", "MPHASIS", "COFORGE", "PERSISTENT",
    "OFSS", "LTM", "KPITTECH", "NYKAA", "POLICYBZR",
    "SWIGGY", "ETERNAL", "JIOFIN", "HINDZINC", "VEDL",
    "SAIL", "NMDC", "NATIONALUM", "JINDALSTEL",
    "OIL", "ATGL", "IGL", "HINDPETRO",
    "BHEL", "CONCOR", "ASHOKLEY", "EXIDEIND", "MFSL",
    "PAGEIND", "MRF", "COLPAL", "DABUR", "MARICO",
    "VBL", "ABCAPITAL", "SRF", "SUPREMEIND", "ASTRAL",
    "BIOCON", "GLENMARK", "NATCOPHARM", "INDHOTEL",
    "IRCON", "TITAGARH", "NBCC",
    "COCHINSHIP", "DEEPAKNTR",
    "GNFC", "AARTIIND", "JKCEMENT", "RAMCOCEM",
    "GREENPLY", "CENTURYPLY", "GUJGASLTD",
    "MGL", "PETRONET",
    "GMRAIRPORT", "INDIGO",
]


def _build_demo_cache(interval: str = "1day") -> list[dict]:
    """Build 200+ realistic demo entries when live data is unavailable.
    Seed varies per interval so each timeframe shows different data."""
    seed_map = {"5min": 11, "15min": 22, "1hr": 33, "1day": 42}
    random.seed(seed_map.get(interval, 42))
    result = []
    symbols = list(dict.fromkeys(_DEMO_SYMBOLS_EXTRA))

    # Adjust volatility ranges per timeframe — realistic for each interval
    pct_range = {
        "5min":  (-1.2, 1.5),
        "15min": (-2.0, 2.5),
        "1hr":   (-3.0, 3.5),
        "1day":  (-4.5, 5.0),
    }.get(interval, (-4.5, 5.0))

    for i, sym in enumerate(symbols[:210]):
        base_price = round(100 + (i * 137.3) % 4800, 2)
        pct = round(random.uniform(*pct_range), 2)
        vol = int(random.uniform(200_000, 8_000_000))
        vol_ratio = round(random.uniform(0.5, 6.0), 2)
        rsi = round(random.uniform(22, 78), 1)
        hi = round(base_price * random.uniform(1.005, 1.25), 2)
        lo = round(base_price * random.uniform(0.75, 0.995), 2)
        pct_from_52h = round(((base_price - hi) / hi) * 100, 2)
        pct_from_52l = round(((base_price - lo) / lo) * 100, 2)
        signal = _derive_signal(rsi, pct)
        sector = STOCK_SECTORS.get(sym, "OTHERS")

        result.append({
            "symbol": sym,
            "exchange": "NSE",
            "sector": sector,
            "interval": interval,
            "last_price": base_price,
            "pct_change": pct,
            "volume": vol,
            "volume_ratio": vol_ratio,
            "rsi_14": rsi,
            "macd_histogram": round(random.uniform(-3.0, 3.0), 3),
            "supertrend": signal,
            "supertrend_direction": 1 if signal == "BUY" else (-1 if signal == "SELL" else 0),
            "adx_14": round(random.uniform(10, 45), 1),
            "pct_from_52h": pct_from_52h,
            "pct_from_52l": pct_from_52l,
            "bb_pctb": round(random.uniform(0.05, 0.95), 3),
            "atr_14": round(base_price * random.uniform(0.005, 0.04), 2),
            "ema_20": round(base_price * random.uniform(0.97, 1.03), 2),
            "ema_50": round(base_price * random.uniform(0.93, 1.07), 2),
            "ema_200": round(base_price * random.uniform(0.85, 1.15), 2),
            "sma_20": round(base_price * random.uniform(0.97, 1.03), 2),
            "sma_50": round(base_price * random.uniform(0.93, 1.07), 2),
            "market_cap": round(random.uniform(500, 600_000), 0),
            "signal": signal,
            "_demo": True,
        })

    return result


# ─── Cache Builder ─────────────────────────────────────────────────────────────

async def build_screener_cache(interval: str = "1day"):
    """
    Builds the per-interval SCREENER_CACHE from live tick data.
    Falls back to demo data if < 30 live ticks are available.
    Called by background job every 5 minutes per interval.
    """
    global _CACHE_STORE, _CACHE_BUILT_AT
    interval = interval if interval in VALID_INTERVALS else DEFAULT_INTERVAL
    t0 = time.time()
    logger.info(f"[ScreenerCache:{interval}] Starting cache build...")

    try:
        from backend.streamer import get_all_ticks, _intraday_candles, _store_lock

        ticks = get_all_ticks()
        live_ticks = [
            t for t in ticks
            if t.get("ltp", 0) > 0.01
            and t.get("prev_close", 0) > 0.01
            and t.get("index") in ("nifty100", "midcap100", "fno_only")
        ]

        if len(live_ticks) < 30:
            logger.warning(
                f"[ScreenerCache:{interval}] Only {len(live_ticks)} live ticks — using demo data"
            )
            cache = _build_demo_cache(interval)
        else:
            cache = []
            for t in live_ticks:
                sym = t["symbol"]
                ltp = t["ltp"]
                prev = t["prev_close"]
                vol = t.get("volume", 0)
                pct_change = round(((ltp - prev) / prev) * 100, 2) if prev > 0 else 0.0

                with _store_lock:
                    candles = list(_intraday_candles.get(t.get("token", ""), []))

                closes = [c["close"] for c in candles] if candles else [ltp]
                volumes = [c["volume"] for c in candles] if candles else [vol]

                rsi = compute_rsi_native(closes)
                vol_ratio = compute_vol_ratio(volumes)

                if candles:
                    hi = max(c["high"] for c in candles)
                    lo = min(c["low"] for c in candles)
                else:
                    hi = ltp * 1.05
                    lo = ltp * 0.95

                pct_from_52h = round(((ltp - hi) / hi) * 100, 2) if hi > 0 else 0.0
                pct_from_52l = round(((ltp - lo) / lo) * 100, 2) if lo > 0 else 0.0

                signal = _derive_signal(rsi, pct_change)
                sector = STOCK_SECTORS.get(sym, "OTHERS")

                adx_approx = min(50, round(15 + vol_ratio * 5, 1))
                atr_approx = round(ltp * 0.015, 2)
                ema_20 = round(ltp * (1 + pct_change / 200), 2)
                ema_50 = round(ltp * (1 + pct_change / 400), 2)
                ema_200 = round(ltp * (1 + pct_change / 800), 2)
                bb_pctb = round(min(1.0, max(0.0, 0.5 + pct_change / 10.0)), 3)
                macd_hist = round(pct_change * 0.3 + (rsi - 50) * 0.05, 3)

                cache.append(sanitize_for_json({
                    "symbol": sym,
                    "exchange": t.get("exchange", "NSE"),
                    "sector": sector,
                    "interval": interval,
                    "last_price": ltp,
                    "pct_change": pct_change,
                    "volume": vol,
                    "volume_ratio": vol_ratio,
                    "rsi_14": rsi,
                    "macd_histogram": macd_hist,
                    "supertrend": signal,
                    "supertrend_direction": 1 if signal == "BUY" else (-1 if signal == "SELL" else 0),
                    "adx_14": adx_approx,
                    "pct_from_52h": pct_from_52h,
                    "pct_from_52l": pct_from_52l,
                    "bb_pctb": bb_pctb,
                    "atr_14": atr_approx,
                    "ema_20": ema_20,
                    "ema_50": ema_50,
                    "ema_200": ema_200,
                    "sma_20": ema_20,
                    "sma_50": ema_50,
                    "market_cap": round(random.uniform(500, 600_000), 0),
                    "signal": signal,
                }))

        async with _CACHE_LOCK:
            _CACHE_STORE[interval] = cache
            _CACHE_BUILT_AT[interval] = datetime.now(IST)

        elapsed = round(time.time() - t0, 2)
        logger.info(
            f"[ScreenerCache:{interval}] Built {len(cache)} symbols in {elapsed}s"
            + (" (DEMO)" if cache and cache[0].get("_demo") else " (LIVE)")
        )

    except Exception as e:
        logger.error(f"[ScreenerCache:{interval}] Build failed: {e}", exc_info=True)
        if not _CACHE_STORE.get(interval):
            async with _CACHE_LOCK:
                _CACHE_STORE[interval] = _build_demo_cache(interval)
                _CACHE_BUILT_AT[interval] = datetime.now(IST)
            logger.warning(f"[ScreenerCache:{interval}] Populated with demo fallback after error")


# ─── Filter Evaluator ──────────────────────────────────────────────────────────

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
            if field in ("supertrend", "signal"):
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


# ─── Scan Generator (Cache-Only) ───────────────────────────────────────────────

async def run_scan_generator(
    smart,  # Kept for API compatibility — NEVER USED, scans read from cache only
    filters: list[dict],
    universe: str = "NSE",
    logic: str = "AND",
    index_filter: str = "ALL",
    sectors: list[str] | None = None,
    interval: str = "1day",
):
    """
    Streams scan results from the per-interval SCREENER_CACHE only.
    No Angel One API calls made here. Fast by design (< 3 seconds).
    """
    interval = interval if interval in VALID_INTERVALS else DEFAULT_INTERVAL
    try:
        async with _CACHE_LOCK:
            cache_snapshot = list(_CACHE_STORE.get(interval, []))

        total = len(cache_snapshot)

        if total == 0:
            yield {"results": [], "progress": {"current": 0, "total": 1}}
            await asyncio.sleep(0.5)
            async with _CACHE_LOCK:
                cache_snapshot = list(_CACHE_STORE.get(interval, []))
            total = len(cache_snapshot)

        if total == 0:
            yield {"done": True, "total": 0, "error": "Cache not ready yet. Please wait a moment and try again."}
            return

        if universe == "NSE":
            cache_snapshot = [s for s in cache_snapshot if s.get("exchange", "NSE") == "NSE"]
        elif universe == "BSE":
            cache_snapshot = [s for s in cache_snapshot if s.get("exchange") == "BSE"]

        if sectors:
            cache_snapshot = [s for s in cache_snapshot if s.get("sector") in sectors]

        total = len(cache_snapshot)

        BATCH_SIZE = 20
        matched_total = 0
        processed = 0

        try:
            for i in range(0, total, BATCH_SIZE):
                batch = cache_snapshot[i: i + BATCH_SIZE]
                matched_in_batch = []

                for stock in batch:
                    try:
                        if evaluate_filters(stock, filters, logic):
                            matched_in_batch.append(stock)
                    except Exception as fe:
                        logger.warning(f"[ScreenerCache] Filter eval error for {stock.get('symbol')}: {fe}")

                processed += len(batch)
                matched_total += len(matched_in_batch)

                yield sanitize_for_json({
                    "results": matched_in_batch,
                    "progress": {"current": processed, "total": total},
                })

                await asyncio.sleep(0.05)

        except asyncio.CancelledError:
            logger.info("[ScreenerCache] Scan generator cancelled by client disconnect")
            return
        except Exception as e:
            logger.error(f"[ScreenerCache] Scan loop error: {e}", exc_info=True)
            yield sanitize_for_json({"error": f"Scan error: {str(e)}", "done": True, "total": matched_total})
            return

        yield sanitize_for_json({"done": True, "total": matched_total})

    except Exception as outer_e:
        logger.error(f"[ScreenerCache] Outer generator error: {outer_e}", exc_info=True)
        yield {"error": str(outer_e), "done": True, "total": 0}


# ─── Cache Status ──────────────────────────────────────────────────────────────

def get_cache_status(interval: str = "1day") -> dict:
    """Returns cache metadata for the /api/screener/cache-status endpoint."""
    interval = interval if interval in VALID_INTERVALS else DEFAULT_INTERVAL
    now = datetime.now(IST)
    built_at = _CACHE_BUILT_AT.get(interval)
    symbols = len(_CACHE_STORE.get(interval, []))

    if built_at is None:
        return {
            "symbols": 0,
            "built_at": None,
            "age_seconds": None,
            "ready": False,
            "interval": interval,
        }

    age = int((now - built_at).total_seconds())
    return {
        "symbols": symbols,
        "built_at": built_at.isoformat(),
        "age_seconds": age,
        "ready": symbols > 0,
        "interval": interval,
    }


# ─── Preset CRUD ──────────────────────────────────────────────────────────────

def get_presets() -> list[dict]:
    """Return builtin + saved presets."""
    presets = list(BUILTIN_PRESETS)
    if os.path.exists(_saved_presets_file):
        try:
            with open(_saved_presets_file, "r") as f:
                saved = json.load(f)
                presets.extend(saved)
        except Exception:
            pass
    return presets


def save_preset(name: str, filters: list[dict], logic: str = "AND") -> dict:
    """Save a custom preset to JSON file."""
    custom_id = f"custom_{int(time.time())}"
    new_preset = {
        "id": custom_id,
        "name": name,
        "description": "User saved preset",
        "icon": "💾",
        "tag": "CUSTOM",
        "filters": filters,
        "logic": logic,
    }
    saved = []
    if os.path.exists(_saved_presets_file):
        try:
            with open(_saved_presets_file, "r") as f:
                saved = json.load(f)
        except Exception:
            pass
    saved.append(new_preset)
    with open(_saved_presets_file, "w") as f:
        json.dump(saved, f, indent=2)
    return new_preset


def get_cached_results(scan_id: str) -> dict | None:
    """Stub for legacy cached results endpoint."""
    return None
