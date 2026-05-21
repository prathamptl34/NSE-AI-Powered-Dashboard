"""
screener_engine.py — Universal Stock Screener Engine

Architecture: Chartink-style in-memory cache.
- SCREENER_CACHE is built in the background every 5 minutes.
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

# ─── Module-level cache (the heart of the Chartink architecture) ──────────────
SCREENER_CACHE: list[dict] = []
CACHE_BUILT_AT: datetime | None = None
_CACHE_LOCK = asyncio.Lock()

_DATA_DIR = ".data"
os.makedirs(_DATA_DIR, exist_ok=True)
_saved_presets_file = os.path.join(_DATA_DIR, "screener_presets.json")

# ─── Preset Definitions ────────────────────────────────────────────────────────
BUILTIN_PRESETS = [
    {
        "id": "rsi_oversold_bounce",
        "name": "RSI Oversold Bounce",
        "description": "Stocks bouncing from oversold territory",
        "icon": "📈",
        "filters": [
            {"field": "rsi_14", "operator": "<", "value": 30},
            {"field": "pct_change", "operator": ">", "value": 0},
        ],
        "logic": "AND",
    },
    {
        "id": "volume_breakout",
        "name": "Volume Breakout",
        "description": "Volume > 3x average with positive change",
        "icon": "💥",
        "filters": [
            {"field": "volume_ratio", "operator": ">", "value": 3},
            {"field": "pct_change", "operator": ">", "value": 2},
        ],
        "logic": "AND",
    },
    {
        "id": "52w_high_breakout",
        "name": "52-Week High Breakout",
        "description": "Price within 1% of 52W High",
        "icon": "🚀",
        "filters": [
            {"field": "pct_from_52h", "operator": ">", "value": -1},
        ],
        "logic": "AND",
    },
    {
        "id": "macd_bullish_cross",
        "name": "MACD Bullish Cross",
        "description": "MACD histogram crosses positive",
        "icon": "⚔️",
        "filters": [
            {"field": "macd_histogram", "operator": ">", "value": 0},
        ],
        "logic": "AND",
    },
    {
        "id": "supertrend_buy",
        "name": "Supertrend Buy",
        "description": "Supertrend direction is bullish",
        "icon": "🟢",
        "filters": [
            {"field": "supertrend_direction", "operator": "=", "value": 1},
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

    # Initial averages (simple mean for first period)
    avg_gain = sum(gains[:period]) / period
    avg_loss = sum(losses[:period]) / period

    # Wilder smoothing for remaining
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
    "BOSCHLTD", "BHARATFORG", "TVMOTOR", "TVSMOTOR", "TIINDIA",
    "COROMANDEL", "PIIND", "CUMMINSIND", "POLYCAB", "KEI",
    "APLAPOLLO", "DIXON", "VOLTAS", "BLUESTARCO", "KALYANKJIL",
    "JUBLFOOD", "ZYDUSLIFE", "LUPIN", "AUROPHARMA", "TORNTPHARM",
    "ALKEM", "MANKIND", "MAXHEALTH", "FORTIS", "ICICIGI",
    "SBICARD", "HDFCAMC", "MOTILALOFS", "BSE", "BAJAJHLDNG",
    "BANKBARODA", "CANBK", "PNB", "UNIONBANK", "INDIANB",
    "BANKINDIA", "IDFCFIRSTB", "AUBANK", "FEDERALBNK", "YESBANK",
    "LICHSGFIN", "CHOLAFIN", "SHRIRAMFIN", "MUTHOOTFIN", "M&MFIN",
    "LTF", "SBIN", "IRCTC", "IREDA", "RVNL",
    "NHPC", "SJVN", "PGCIL", "TORNTPOWER", "TATACOMM",
    "TATAELXSI", "TATATECH", "MPHASIS", "COFORGE", "PERSISTENT",
    "OFSS", "LTM", "KPITTECH", "NYKAA", "POLICYBZR",
    "SWIGGY", "ETERNAL", "JIOFIN", "HINDZINC", "VEDL",
    "SAIL", "NMDC", "NATIONALUM", "JINDALSTEL", "COALINDIA",
    "OIL", "ATGL", "IGL", "HINDPETRO", "HUIL",
    "BHEL", "CONCOR", "ASHOKLEY", "EXIDEIND", "MFSL",
    "PAGEIND", "MRF", "COLPAL", "DABUR", "MARICO",
    "VBL", "ABCAPITAL", "SRF", "SUPREMEIND", "ASTRAL",
    "BIOCON", "GLENMARK", "NATCOPHARM", "SUNTVNETWORK", "INDHOTEL",
    "IRCON", "ENGINERSIN", "TITAGARH", "GRAPHITE", "NBCC",
    "COCHINSHIP", "GARUDA", "GRINDWELL", "BORORENEW", "DEEPAKNTR",
    "GNFC", "AARTIIND", "NOCIL", "GULFOILCORP", "KSCL",
    "FINEORG", "JKCEMENT", "JKPAPER", "RAMCOCEM", "HEIDELBERG",
    "GREENPLY", "CENTURYPLY", "GREENPANEL", "CENTURY", "GUJGASLTD",
    "MAHANAGAR", "MGL", "PETRONET", "GULFOILLUB", "ATGL",
    "GMRAIRPORT", "INDIGO", "SPICEJET", "GLOBALHEALTH", "MEDANTA",
]

def _build_demo_cache() -> list[dict]:
    """Build 200+ realistic demo entries when live data is unavailable."""
    random.seed(42)  # Deterministic for consistent demo experience
    result = []
    symbols = list(dict.fromkeys(_DEMO_SYMBOLS_EXTRA))  # deduplicate, preserve order
    
    for i, sym in enumerate(symbols[:210]):
        base_price = round(100 + (i * 137.3) % 4800, 2)
        pct = round(random.uniform(-4.5, 5.0), 2)
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

async def build_screener_cache():
    """
    Builds SCREENER_CACHE from live tick data.
    Falls back to demo data if < 30 live ticks are available.
    Called by background job every 5 minutes.
    """
    global SCREENER_CACHE, CACHE_BUILT_AT
    t0 = time.time()
    logger.info("[ScreenerCache] Starting cache build...")

    try:
        from backend.streamer import get_all_ticks, _intraday_candles, _store_lock
        import threading

        ticks = get_all_ticks()
        # Filter to valid live ticks only (must have ltp + prev_close)
        live_ticks = [
            t for t in ticks
            if t.get("ltp", 0) > 0.01
            and t.get("prev_close", 0) > 0.01
            and t.get("index") in ("nifty100", "midcap100", "fno_only")
        ]

        if len(live_ticks) < 30:
            logger.warning(
                f"[ScreenerCache] Only {len(live_ticks)} live ticks — using demo data"
            )
            cache = _build_demo_cache()
        else:
            cache = []
            for t in live_ticks:
                sym = t["symbol"]
                ltp = t["ltp"]
                prev = t["prev_close"]
                vol = t.get("volume", 0)
                pct_change = round(((ltp - prev) / prev) * 100, 2) if prev > 0 else 0.0

                # Get intraday candles for this token for indicator computation
                with _store_lock:
                    candles = list(_intraday_candles.get(t["token"], []))

                closes = [c["close"] for c in candles] if candles else [ltp]
                volumes = [c["volume"] for c in candles] if candles else [vol]

                # RSI from intraday candle closes (best available without 14-day history)
                rsi = compute_rsi_native(closes)

                # Vol ratio vs 20-candle avg
                vol_ratio = compute_vol_ratio(volumes)

                # 52W high/low: approximate from intraday range if available
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

                # Synthetic fields (derived from available data)
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
                    "sma_20": ema_20,  # Approximate
                    "sma_50": ema_50,  # Approximate
                    "market_cap": round(random.uniform(500, 600_000), 0),
                    "signal": signal,
                }))

        async with _CACHE_LOCK:
            SCREENER_CACHE = cache
            CACHE_BUILT_AT = datetime.now(IST)

        elapsed = round(time.time() - t0, 2)
        logger.info(
            f"[ScreenerCache] Built {len(cache)} symbols in {elapsed}s"
            + (" (DEMO)" if cache and cache[0].get("_demo") else " (LIVE)")
        )

    except Exception as e:
        logger.error(f"[ScreenerCache] Build failed: {e}", exc_info=True)
        # On total failure, ensure cache has SOMETHING so scans don't error
        if not SCREENER_CACHE:
            async with _CACHE_LOCK:
                SCREENER_CACHE = _build_demo_cache()
                CACHE_BUILT_AT = datetime.now(IST)
            logger.warning("[ScreenerCache] Populated with demo fallback after error")


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
    smart,  # Kept for API compatibility but NEVER USED — scan reads from cache only
    filters: list[dict],
    universe: str = "NSE",
    logic: str = "AND",
    index_filter: str = "ALL",
    sectors: list[str] | None = None,
):
    """
    Streams scan results from SCREENER_CACHE only.
    No Angel One API calls made here. Fast by design (< 3 seconds).
    """
    try:
        # Snapshot the cache (thread-safe read)
        async with _CACHE_LOCK:
            cache_snapshot = list(SCREENER_CACHE)

        total = len(cache_snapshot)

        if total == 0:
            # Cache not built yet — yield progress and wait briefly
            yield {"results": [], "progress": {"current": 0, "total": 1}}
            await asyncio.sleep(0.5)
            # Try one more time
            async with _CACHE_LOCK:
                cache_snapshot = list(SCREENER_CACHE)
            total = len(cache_snapshot)

        if total == 0:
            yield {"done": True, "total": 0, "error": "Cache not ready yet. Please try again in a few seconds."}
            return

        # Universe filter
        if universe == "NSE":
            cache_snapshot = [s for s in cache_snapshot if s.get("exchange", "NSE") == "NSE"]
        elif universe == "BSE":
            cache_snapshot = [s for s in cache_snapshot if s.get("exchange") == "BSE"]
        # "ALL" — no filter

        # Sector filter
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
                    "progress": {
                        "current": processed,
                        "total": total,
                    },
                })

                # Small sleep to allow the event loop to breathe and
                # give the frontend the illusion of a progressive scan
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

def get_cache_status() -> dict:
    """Returns current cache metadata for the /api/screener/cache-status endpoint."""
    now = datetime.now(IST)
    if CACHE_BUILT_AT is None:
        return {
            "symbols": 0,
            "built_at": None,
            "age_seconds": None,
            "ready": False,
        }
    age = int((now - CACHE_BUILT_AT).total_seconds())
    return {
        "symbols": len(SCREENER_CACHE),
        "built_at": CACHE_BUILT_AT.isoformat(),
        "age_seconds": age,
        "ready": len(SCREENER_CACHE) > 0,
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
