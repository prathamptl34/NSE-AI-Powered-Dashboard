"""
forex_smcengine.py — SMC Intelligence Engine for Forex / Gold / Crypto / Indices

All 7 SMC calculation functions:
  1. get_forex_opening_range()      — NY Midnight Open manipulation scanner
  2. detect_forex_sweeps()          — PDH/PDL/PWH/PWL/PSH/PSL sweep radar
  3. grade_forex_setup()            — 6-factor confluence grader (0-100)
  4. get_forex_sentiment()          — COT + Fear&Greed + VIX integration
  5. detect_forex_displacement()    — Displacement candle + MSS detector
  6. map_forex_liquidity_pools()    — Equal highs/lows + round number mapper
  7. calculate_mtf_bias()           — Multi-timeframe HH/HL structure bias

Every function has a demo_fallback() that returns clearly-labeled data
with "—" for all price fields when live feed is unavailable.
"""

import os
import time
import math
import logging
import requests
import threading
from datetime import datetime, timedelta, timezone
from typing import Optional, Dict, List, Any

import pytz

logger = logging.getLogger(__name__)
UTC = timezone.utc

# ── Import tick/candle stores from forex_streamer ─────────────────────────────
try:
    from backend.forex_streamer import (
        get_forex_tick,
        get_all_forex_ticks,
        get_forex_candles,
        get_dxy_tick,
        ALL_SYMBOLS,
    )
    _streamer_available = True
except ImportError:
    _streamer_available = False
    logger.warning("[ForexSMC] forex_streamer not importable — all functions will use demo data")
    ALL_SYMBOLS = [
        "XAUUSD", "EURUSD", "GBPUSD", "AUDUSD", "NZDUSD",
        "USDJPY", "USDCHF", "USDCAD", "EURGBP", "EURJPY",
        "GBPJPY", "AUDJPY", "CADJPY", "CHFJPY", "NAS100",
        "SP100", "BTCUSD", "ETHUSD",
    ]

# ── Caches ────────────────────────────────────────────────────────────────────

_opening_range_cache: Dict     = {}
_opening_range_ts: float       = 0.0

_sweep_cache: Dict             = {}
_sweep_ts: float               = 0.0
_sweep_events_raw: List        = []   # shared for grade lookup

_grade_cache: Dict             = {}
_grade_ts: float               = 0.0

_sentiment_cache: Dict         = {}
_sentiment_ts: float           = 0.0

_displacement_cache: Dict      = {}
_displacement_ts: float        = 0.0

_liquidity_cache: Dict[str, Dict] = {}
_liquidity_ts: Dict[str, float]   = {}

_mtf_bias_cache: Dict          = {}
_mtf_bias_ts: float            = 0.0

CACHE_TTL = {
    "opening_range":    3,
    "sweeps":           10,
    "grades":           10,
    "sentiment":        120,
    "displacement":     10,
    "liquidity":        60,
    "mtf_bias":         30,
}

# ── Pip thresholds per symbol ─────────────────────────────────────────────────

JPY_PAIRS = {"USDJPY", "EURJPY", "GBPJPY", "AUDJPY", "CADJPY", "CHFJPY"}
MAJOR_PAIRS = {"EURUSD", "GBPUSD", "AUDUSD", "NZDUSD", "USDCHF", "USDCAD", "EURGBP"}

def _pip_threshold(symbol: str) -> float:
    if symbol == "XAUUSD":       return 0.50
    if symbol == "BTCUSD":       return 50.0
    if symbol == "ETHUSD":       return 2.0
    if symbol in ("NAS100", "SP100"): return 5.0
    if symbol in JPY_PAIRS:      return 0.30
    return 0.0003  # Standard major/cross


# ── Time helpers ──────────────────────────────────────────────────────────────

def _utc_now() -> datetime:
    return datetime.now(UTC)


def _utc_minutes() -> int:
    now = _utc_now()
    return now.hour * 60 + now.minute


def _is_same_trading_day(dt_str: str) -> bool:
    """Check if a candle datetime string is from today's trading day (UTC)."""
    try:
        if not dt_str:
            return False
        # Try various formats
        for fmt in ("%Y-%m-%d %H:%M:%S", "%Y-%m-%dT%H:%M:%S", "%Y-%m-%d"):
            try:
                dt = datetime.strptime(dt_str[:19], fmt)
                today_utc = _utc_now().date()
                return dt.date() == today_utc
            except ValueError:
                continue
        return False
    except Exception:
        return False


def _get_active_kill_zone() -> Dict:
    """Determine active Forex session kill zone based on UTC time."""
    utc = _utc_now()
    h, m = utc.hour, utc.minute
    total_min = h * 60 + m

    # NY Midnight Open marker: 05:00 UTC
    # Asian: 00:00–06:00 UTC
    # London KZ: 07:00–10:00 UTC
    # NY KZ: 12:00–15:00 UTC
    # London Close: 16:00–18:00 UTC
    # Dead Zone: 18:00–23:59 UTC

    if 0 <= total_min < 360:       # 00:00–06:00 UTC
        zone = "ASIAN"
        zone_end_min = 360
        color = "blue"
        pts = 5
    elif 360 <= total_min < 420:   # 06:00–07:00 UTC — gap
        zone = "PRE_LONDON"
        zone_end_min = 420
        color = "muted"
        pts = 3
    elif 420 <= total_min < 600:   # 07:00–10:00 UTC
        zone = "LONDON_KZ"
        zone_end_min = 600
        color = "amber"
        pts = 15
    elif 600 <= total_min < 720:   # 10:00–12:00 UTC
        zone = "LONDON_NY_GAP"
        zone_end_min = 720
        color = "muted"
        pts = 3
    elif 720 <= total_min < 900:   # 12:00–15:00 UTC
        zone = "NY_KZ"
        zone_end_min = 900
        color = "rose"
        pts = 15
    elif 900 <= total_min < 960:   # 15:00–16:00 UTC
        zone = "POST_NY"
        zone_end_min = 960
        color = "muted"
        pts = 3
    elif 960 <= total_min < 1080:  # 16:00–18:00 UTC
        zone = "LONDON_CLOSE"
        zone_end_min = 1080
        color = "emerald"
        pts = 8
    else:                          # 18:00–23:59 UTC
        zone = "DEAD_ZONE"
        zone_end_min = 1440
        color = "grey"
        pts = 0

    minutes_remaining = zone_end_min - total_min
    return {
        "zone": zone,
        "color": color,
        "kill_zone_pts": pts,
        "minutes_remaining": minutes_remaining,
        "is_kill_zone": zone in ("LONDON_KZ", "NY_KZ"),
        "is_dead_zone": zone == "DEAD_ZONE",
    }


# ── FEATURE 1: NY MIDNIGHT OPEN MANIPULATION SCANNER ─────────────────────────

def _demo_opening_range() -> Dict:
    return {
        "status": "ok",
        "data_source": "DEMO",
        "data": {
            "instruments": {
                sym: {
                    "symbol": sym, "status": "DEMO",
                    "ltp": "—", "opening_range_high": "—",
                    "opening_range_low": "—", "range_width": "—",
                    "ltp_position": "—", "manipulation_type": "NONE",
                    "data_source": "DEMO",
                    "action_steps": [],
                }
                for sym in ["XAUUSD", "EURUSD", "GBPUSD", "USDJPY", "BTCUSD"]
            },
            "timestamp": _utc_now().strftime("%H:%M:%S UTC"),
        }
    }


async def get_forex_opening_range() -> Dict:
    """
    Feature 1 — NY Midnight Open (05:00 UTC) Manipulation Scanner.
    Opening Range = 05:00–06:00 UTC (first 60 minutes after NY midnight).
    Detects bull/bear manipulation via wick-rejection beyond ORH/ORL.
    """
    global _opening_range_cache, _opening_range_ts

    if time.time() - _opening_range_ts < CACHE_TTL["opening_range"]:
        return _opening_range_cache

    if not _streamer_available:
        _opening_range_cache = _demo_opening_range()
        _opening_range_ts = time.time()
        return _opening_range_cache

    priority_symbols = ["XAUUSD", "EURUSD", "GBPUSD", "USDJPY", "BTCUSD"]
    result = {}

    for sym in priority_symbols:
        try:
            candles_m5 = get_forex_candles(sym, "5min")
            tick = get_forex_tick(sym)

            if not candles_m5 or len(candles_m5) < 10:
                result[sym] = {
                    "symbol": sym, "status": "DATA_UNAVAILABLE",
                    "data_source": "DEMO", "ltp": "—",
                    "opening_range_high": "—", "opening_range_low": "—",
                    "manipulation_type": "NONE",
                }
                continue

            # Opening Range window: 05:00–06:00 UTC (300–360 minutes from midnight)
            or_candles = []
            for c in candles_m5:
                try:
                    dt_str = c.get("datetime", "")
                    # Parse datetime
                    dt = None
                    for fmt in ("%Y-%m-%d %H:%M:%S", "%Y-%m-%dT%H:%M:%S"):
                        try:
                            dt = datetime.strptime(dt_str[:19], fmt)
                            break
                        except ValueError:
                            continue
                    if dt is None:
                        continue
                    # Check if today's 05:00–06:00 UTC
                    today = _utc_now().date()
                    if dt.date() != today:
                        continue
                    if 5 <= dt.hour < 6:
                        or_candles.append(c)
                except Exception:
                    continue

            ltp = float(tick.get("ltp", 0)) if tick else 0

            if not or_candles:
                result[sym] = {
                    "symbol": sym, "status": "NO_OR_DATA",
                    "data_source": "DEMO" if not tick else "LIVE",
                    "ltp": ltp if ltp > 0 else "—",
                    "opening_range_high": "—", "opening_range_low": "—",
                    "manipulation_type": "NONE",
                }
                continue

            orh = max(c["high"] for c in or_candles)
            orl = min(c["low"]  for c in or_candles)
            rng = orh - orl

            # Validate plausibility
            if ltp > 0 and (abs(ltp - orh) / max(orh, 1)) > 0.15:
                result[sym] = {
                    "symbol": sym, "status": "LEVEL_CHECK_FAILED",
                    "data_source": "LIVE", "ltp": "—",
                    "opening_range_high": "—", "opening_range_low": "—",
                    "manipulation_type": "NONE",
                }
                continue

            # Detect manipulation on recent M5 candles (post 06:00 UTC)
            post_or_candles = []
            for c in candles_m5:
                try:
                    dt_str = c.get("datetime", "")
                    dt = None
                    for fmt in ("%Y-%m-%d %H:%M:%S", "%Y-%m-%dT%H:%M:%S"):
                        try:
                            dt = datetime.strptime(dt_str[:19], fmt)
                            break
                        except ValueError:
                            continue
                    if dt is None:
                        continue
                    today = _utc_now().date()
                    if dt.date() == today and dt.hour >= 6:
                        post_or_candles.append(c)
                except Exception:
                    continue

            manip_type = "NONE"
            trigger_price = None

            pip_th = _pip_threshold(sym)

            for c in post_or_candles[-6:]:  # last 6 M5 candles
                wick_below = c["low"] < (orl - pip_th)
                closed_above_orl = c["close"] > orl
                wick_above = c["high"] > (orh + pip_th)
                closed_below_orh = c["close"] < orh

                if wick_below and closed_above_orl:
                    manip_type = "BULL_MANIPULATION"
                    trigger_price = c["low"]
                    break
                elif wick_above and closed_below_orh:
                    manip_type = "BEAR_MANIPULATION"
                    trigger_price = c["high"]
                    break

            # LTP position relative to OR
            if ltp > 0:
                if ltp > orh:
                    ltp_pos = "ABOVE_ORH"
                elif ltp < orl:
                    ltp_pos = "BELOW_ORL"
                else:
                    ltp_pos = "INSIDE"
            else:
                ltp_pos = "—"

            action_steps = []
            if manip_type == "BULL_MANIPULATION":
                action_steps = [
                    "Step 1: Wait for MSS on M5 — structure must shift bullish",
                    "Step 2: Enter on FVG retracement (50–75% fill)",
                    "Step 3: Target previous session high — exit before session close",
                ]
            elif manip_type == "BEAR_MANIPULATION":
                action_steps = [
                    "Step 1: Wait for MSS on M5 — structure must shift bearish",
                    "Step 2: Enter on FVG retracement (50–75% fill)",
                    "Step 3: Target previous session low — exit before session close",
                ]

            result[sym] = {
                "symbol": sym,
                "status": "ACTIVE",
                "data_source": "LIVE" if tick else "DEMO",
                "ltp": round(ltp, 5) if ltp > 0 else "—",
                "opening_range_high": round(orh, 5),
                "opening_range_low":  round(orl, 5),
                "range_width":        round(rng, 5),
                "ltp_position":       ltp_pos,
                "manipulation_type":  manip_type,
                "trigger_price":      round(trigger_price, 5) if trigger_price else None,
                "action_steps":       action_steps,
                "or_candle_count":    len(or_candles),
            }

        except Exception as e:
            logger.error(f"[ForexSMC] opening-range error for {sym}: {e}")
            result[sym] = {
                "symbol": sym, "status": "ERROR",
                "data_source": "DEMO", "ltp": "—",
                "opening_range_high": "—", "opening_range_low": "—",
                "manipulation_type": "NONE",
            }

    _opening_range_cache = {
        "status": "ok",
        "data_source": "LIVE" if _streamer_available else "DEMO",
        "data": {
            "instruments": result,
            "timestamp": _utc_now().strftime("%H:%M:%S UTC"),
        }
    }
    _opening_range_ts = time.time()
    return _opening_range_cache


# ── FEATURE 2: PDH/PDL LIQUIDITY SWEEP RADAR ─────────────────────────────────

def _demo_sweeps() -> Dict:
    return {
        "status": "ok",
        "data_source": "DEMO",
        "data": {
            "sweeps": [
                {
                    "symbol": sym, "level_category": cat, "level_label": label, "level_strength": strength,
                    "level_price": 4541.20, "wick_extreme": 4543.80, "sweep_size_pips": 2.6,
                    "candle_close": 4539.10, "status": "DEMO",
                    "timestamp": _utc_now().strftime("%Y-%m-%dT%H:%M:%SZ"), "time_elapsed_s": 0,
                }
                for sym, cat, label, strength in [
                    ("XAUUSD", "PDH", "Previous Day High", "STANDARD"),
                    ("EURUSD", "PDL", "Previous Day Low", "STANDARD"),
                    ("GBPUSD", "PWH", "Previous Week High", "MAJOR"),
                    ("USDJPY", "PSH", "Previous Session High", "INTRADAY"),
                ]
            ],
            "active_sweep_count": 0,
            "timestamp": _utc_now().strftime("%H:%M:%S UTC"),
        }
    }


def _calculate_session_highs_lows(candles_h1: List[Dict]) -> Dict:
    """Derive PSH/PSL from H1 candles (prior London or NY session)."""
    try:
        utc_now = _utc_now()
        today = utc_now.date()

        london_highs, london_lows, ny_highs, ny_lows = [], [], [], []

        for c in candles_h1:
            try:
                dt_str = c.get("datetime", "")
                dt = None
                for fmt in ("%Y-%m-%d %H:%M:%S", "%Y-%m-%dT%H:%M:%S"):
                    try:
                        dt = datetime.strptime(dt_str[:19], fmt)
                        break
                    except ValueError:
                        continue
                if dt is None or dt.date() != today:
                    continue
                h = dt.hour
                if 7 <= h < 10:   # London KZ
                    london_highs.append(c["high"])
                    london_lows.append(c["low"])
                elif 12 <= h < 15: # NY KZ
                    ny_highs.append(c["high"])
                    ny_lows.append(c["low"])
            except Exception:
                continue

        result = {}
        if london_highs:
            result["PSH_LONDON"] = max(london_highs)
            result["PSL_LONDON"] = min(london_lows)
        if ny_highs:
            result["PSH_NY"] = max(ny_highs)
            result["PSL_NY"] = min(ny_lows)
        return result
    except Exception:
        return {}


_forex_sweep_cache: Dict = {}
_level_cache: Dict = {}

def _get_levels_for_symbol(symbol: str) -> Dict:
    """Fetch PDH, PDL, PWH, PWL, PSH, PSL with TTLs."""
    global _level_cache
    now = time.time()
    if symbol not in _level_cache:
        _level_cache[symbol] = {}
        
    cache = _level_cache[symbol]
    
    # 1. PDH / PDL (60 min TTL)
    if "PDH" not in cache or now - cache.get("pdh_ts", 0) > 3600:
        try:
            from backend.forex_streamer import TWELVE_DATA_KEY
            url = f"https://api.twelvedata.com/time_series?symbol={symbol}&interval=1day&outputsize=5&apikey={TWELVE_DATA_KEY}"
            resp = requests.get(url, timeout=5).json()
            if "values" in resp and len(resp["values"]) >= 2:
                yesterday = resp["values"][1]
                cache["PDH"] = float(yesterday["high"])
                cache["PDL"] = float(yesterday["low"])
                cache["pdh_ts"] = now
        except Exception as e:
            logger.error(f"[ForexSMC] PDH/PDL fetch error for {symbol}: {e}")

    # 2. PWH / PWL (4 hour TTL)
    if "PWH" not in cache or now - cache.get("pwh_ts", 0) > 14400:
        try:
            from backend.forex_streamer import TWELVE_DATA_KEY
            url = f"https://api.twelvedata.com/time_series?symbol={symbol}&interval=1week&outputsize=3&apikey={TWELVE_DATA_KEY}"
            resp = requests.get(url, timeout=5).json()
            if "values" in resp and len(resp["values"]) >= 2:
                last_week = resp["values"][1]
                cache["PWH"] = float(last_week["high"])
                cache["PWL"] = float(last_week["low"])
                cache["pwh_ts"] = now
        except Exception as e:
            logger.error(f"[ForexSMC] PWH/PWL fetch error for {symbol}: {e}")

    # 3. PSH / PSL from H1 candles (15 min TTL)
    if "PSH_LONDON" not in cache or now - cache.get("psh_ts", 0) > 900:
        try:
            from backend.forex_streamer import TWELVE_DATA_KEY
            url = f"https://api.twelvedata.com/time_series?symbol={symbol}&interval=1h&outputsize=48&apikey={TWELVE_DATA_KEY}"
            resp = requests.get(url, timeout=5).json()
            if "values" in resp:
                london_highs, london_lows, ny_highs, ny_lows = [], [], [], []
                today_utc = _utc_now().date()
                for c in resp["values"]:
                    dt = _parse_date(c["datetime"])
                    if not dt or dt != today_utc:
                        continue
                    dt_time = datetime.strptime(c["datetime"][:19], "%Y-%m-%d %H:%M:%S")
                    h = dt_time.hour
                    if 7 <= h < 15:   # London = 07:00-15:00
                        london_highs.append(float(c["high"]))
                        london_lows.append(float(c["low"]))
                    if 12 <= h < 20:  # NY = 12:00-20:00
                        ny_highs.append(float(c["high"]))
                        ny_lows.append(float(c["low"]))
                if london_highs:
                    cache["PSH_LONDON"] = max(london_highs)
                    cache["PSL_LONDON"] = min(london_lows)
                if ny_highs:
                    cache["PSH_NY"] = max(ny_highs)
                    cache["PSL_NY"] = min(ny_lows)
                cache["psh_ts"] = now
        except Exception as e:
            logger.error(f"[ForexSMC] PSH/PSL fetch error for {symbol}: {e}")

    return cache


def _update_sweep_status(existing_sweep: Dict, symbol: str) -> Dict:
    tick = get_forex_tick(symbol)
    ltp = float(tick.get("ltp", 0)) if tick else 0
    if ltp:
        existing_sweep["current_ltp"] = round(ltp, 5)
        existing_sweep["distance_from_level"] = round(ltp - existing_sweep["level_price"], 5)
    
    age_s = _get_candle_age_s(existing_sweep["timestamp"])
    existing_sweep["time_elapsed_s"] = age_s
    existing_sweep["age_minutes"] = max(0, int(age_s / 60))
    
    if existing_sweep["status"] == "ACTIVE" and existing_sweep["age_minutes"] > 120:
        existing_sweep["status"] = "EXPIRED"
    elif existing_sweep["status"] == "CONFIRMED" and existing_sweep["age_minutes"] > 240:
        existing_sweep["status"] = "EXPIRED"
        
    return existing_sweep


async def detect_forex_sweeps() -> Dict:
    """
    Feature 2 — PDH/PDL/PWH/PWL/PSH/PSL Liquidity Sweep Radar.
    """
    global _sweep_cache, _sweep_ts, _sweep_events_raw, _forex_sweep_cache

    if time.time() - _sweep_ts < CACHE_TTL["sweeps"]:
        return _sweep_cache

    if not _streamer_available:
        _sweep_cache = _demo_sweeps()
        _sweep_ts = time.time()
        return _sweep_cache

    results = []
    now_utc = _utc_now()

    for symbol in ALL_SYMBOLS:
        try:
            tick = get_forex_tick(symbol)
            ltp = float(tick.get("ltp", 0)) if tick else 0
            
            # Fetch robust levels from cache/TD
            lvl_cache = _get_levels_for_symbol(symbol)
            
            levels = {}
            if "PDH" in lvl_cache: levels["PDH"] = (lvl_cache["PDH"], "STANDARD", "Previous Day High")
            if "PDL" in lvl_cache: levels["PDL"] = (lvl_cache["PDL"], "STANDARD", "Previous Day Low")
            if "PWH" in lvl_cache: levels["PWH"] = (lvl_cache["PWH"], "MAJOR", "Previous Week High")
            if "PWL" in lvl_cache: levels["PWL"] = (lvl_cache["PWL"], "MAJOR", "Previous Week Low")
            
            for k in ["PSH_LONDON", "PSL_LONDON", "PSH_NY", "PSL_NY"]:
                if k in lvl_cache:
                    label = "Previous Session High" if "PSH" in k else "Previous Session Low"
                    levels[k] = (lvl_cache[k], "INTRADAY", label)

            candles_m5 = get_forex_candles(symbol, "5min")
            if not candles_m5:
                continue

            today_candles = [c for c in candles_m5 if _is_same_trading_day(c.get("datetime", ""))]
            pip_th = _pip_threshold(symbol)

            for level_name, (level_price, strength, level_label) in levels.items():
                cat = level_name.split("_")[0]
                key = f"{symbol}_{cat}"
                existing = _forex_sweep_cache.get(key)
                
                # Check data validity guard (implausibility check)
                if ltp > 0 and (abs(level_price - ltp) / max(ltp, 1)) > 0.20:
                    logger.warning(f"Implausible level for {symbol}: {level_price} vs LTP {ltp} — skipping")
                    continue
                
                if existing:
                    updated = _update_sweep_status(existing, symbol)
                    _forex_sweep_cache[key] = updated
                    if updated["status"] not in ["FAILED", "EXPIRED"]:
                        results.append(updated)
                        continue

                # No active sweep, check for new one
                sweep_detected = False
                wick_extreme = None
                sweep_candle = None
                
                is_high_level = "H" in cat
                is_low_level = "L" in cat

                for c in today_candles[-24:]:
                    if is_high_level:
                        if c["high"] > (level_price + pip_th) and c["close"] < level_price:
                            sweep_detected = True
                            wick_extreme = c["high"]
                            sweep_candle = c
                    elif is_low_level:
                        if c["low"] < (level_price - pip_th) and c["close"] > level_price:
                            sweep_detected = True
                            wick_extreme = c["low"]
                            sweep_candle = c
                
                if sweep_detected and sweep_candle:
                    sweep_magnitude = abs(wick_extreme - level_price)
                    if symbol.endswith("JPY"): sweep_size_pips = sweep_magnitude * 100
                    elif symbol in ["BTCUSD", "ETHUSD", "NAS100", "SP100", "XAUUSD"]: sweep_size_pips = sweep_magnitude
                    else: sweep_size_pips = sweep_magnitude * 10000

                    candle_time_str = sweep_candle.get("datetime", "—")
                    age_s = _get_candle_age_s(candle_time_str)
                    age_minutes = max(0, int(age_s / 60))
                    
                    if age_minutes > 240:
                        status = "EXPIRED"
                    elif age_minutes < 10:
                        status = "ACTIVE"
                    else:
                        status = "CONFIRMED"

                    new_sweep = {
                        "symbol":           symbol,
                        "level_category":   cat,
                        "level_label":      level_label,
                        "level_strength":   strength,
                        "level_price":      round(level_price, 5),
                        "wick_extreme":     round(wick_extreme, 5),
                        "sweep_size_pips":  round(sweep_size_pips, 1),
                        "candle_close":     round(sweep_candle["close"], 5),
                        "timestamp":        candle_time_str,
                        "status":           status,
                        "time_elapsed_s":   age_s,
                        "age_minutes":      age_minutes,
                        "current_ltp":      round(ltp, 5) if ltp > 0 else 0,
                        "distance_from_level": round(ltp - level_price, 5) if ltp > 0 else 0,
                        "sweep_direction":  "SELL_SIDE" if is_high_level else "BUY_SIDE",
                    }
                    _forex_sweep_cache[key] = new_sweep
                    if status not in ["FAILED", "EXPIRED"]:
                        results.append(new_sweep)

        except Exception as e:
            logger.error(f"[ForexSMC] sweep error for {symbol}: {e}")
            continue

    xau_sweeps   = [s for s in results if s["symbol"] == "XAUUSD"]
    other_sweeps = [s for s in results if s["symbol"] != "XAUUSD"]
    sorted_sweeps = xau_sweeps + other_sweeps

    _sweep_events_raw = sorted_sweeps
    _sweep_cache = {
        "status": "ok",
        "data_source": "LIVE",
        "data": {
            "sweeps":             sorted_sweeps,
            "active_sweep_count": sum(1 for s in sorted_sweeps if s["status"] == "ACTIVE"),
            "timestamp":          now_utc.strftime("%H:%M:%S UTC"),
        }
    }
    _sweep_ts = time.time()
    return _sweep_cache


def _parse_date(dt_str: str):
    """Parse datetime string to date object."""
    try:
        for fmt in ("%Y-%m-%d %H:%M:%S", "%Y-%m-%dT%H:%M:%S", "%Y-%m-%d"):
            try:
                return datetime.strptime(dt_str[:10], "%Y-%m-%d").date()
            except ValueError:
                continue
    except Exception:
        pass
    return None


def _get_candle_age_s(dt_str: str) -> int:
    """Return age of a candle in seconds from now (UTC)."""
    try:
        dt = None
        for fmt in ("%Y-%m-%d %H:%M:%S", "%Y-%m-%dT%H:%M:%S"):
            try:
                dt = datetime.strptime(dt_str[:19], fmt)
                break
            except ValueError:
                continue
        if dt is None:
            return 99999
        now = datetime.utcnow()
        delta = now - dt
        return max(0, int(delta.total_seconds()))
    except Exception:
        return 99999


# ── FEATURE 3: SMC SETUP QUALITY GRADER ──────────────────────────────────────

def _demo_grades() -> Dict:
    return {
        "status": "ok",
        "data_source": "DEMO",
        "data": {
            "grades": [
                {
                    "symbol": sym, "score": 0, "grade": "NO TRADE (DEMO)",
                    "direction": "—", "data_source": "DEMO",
                    "factors": {
                        "htf_trend":       {"pts": 0, "label": "DEMO"},
                        "sweep_detected":  {"pts": 0, "label": "DEMO"},
                        "kill_zone":       {"pts": 0, "label": "DEMO"},
                        "dxy_correlation": {"pts": 0, "label": "DEMO"},
                        "displacement":    {"pts": 0, "label": "DEMO"},
                        "fvg_present":     {"pts": 0, "label": "DEMO"},
                    },
                    "do_not_trade": True,
                }
                for sym in ALL_SYMBOLS
            ],
            "timestamp": _utc_now().strftime("%H:%M:%S UTC"),
        }
    }


def _detect_ema50_h4(candles_h4: List[Dict]) -> Optional[str]:
    """Check if price is above or below EMA50 on H4."""
    try:
        if not candles_h4 or len(candles_h4) < 50:
            return None
        closes = [c["close"] for c in candles_h4]
        # EMA50 calculation
        k = 2 / (50 + 1)
        ema = closes[0]
        for price in closes[1:]:
            ema = price * k + ema * (1 - k)
        last_close = closes[-1]
        if last_close > ema:
            return "BULLISH"
        elif last_close < ema:
            return "BEARISH"
        return "NEUTRAL"
    except Exception:
        return None


def _detect_fvg(candles_m5: List[Dict], ltp: float) -> Dict:
    """Detect Fair Value Gaps on M5 — bullish or bearish."""
    try:
        if not candles_m5 or len(candles_m5) < 3:
            return {"found": False, "pts": 0, "label": "No M5 data"}

        recent = candles_m5[-20:]  # last 20 M5 candles
        best_fvg_pts = 0
        fvg_label = "No FVG"

        for i in range(1, len(recent) - 1):
            prev_c = recent[i - 1]
            curr_c = recent[i]
            next_c = recent[i + 1]

            # Bullish FVG: gap up — prev high < next low
            if prev_c["high"] < next_c["low"]:
                midpoint = (prev_c["high"] + next_c["low"]) / 2
                dist_pct = abs(ltp - midpoint) / max(ltp, 1) * 100 if ltp > 0 else 100
                if dist_pct <= 0.5:
                    # Check if unfilled (price hasn't returned to gap)
                    gap_filled = any(
                        c["low"] <= next_c["low"] for c in candles_m5[i + 1 :]
                    )
                    pts = 8 if gap_filled else 15
                    if pts > best_fvg_pts:
                        best_fvg_pts = pts
                        fvg_label = f"Bullish FVG ({'Partial' if gap_filled else 'Unfilled'})"

            # Bearish FVG: gap down — prev low > next high
            elif prev_c["low"] > next_c["high"]:
                midpoint = (prev_c["low"] + next_c["high"]) / 2
                dist_pct = abs(ltp - midpoint) / max(ltp, 1) * 100 if ltp > 0 else 100
                if dist_pct <= 0.5:
                    gap_filled = any(
                        c["high"] >= next_c["high"] for c in candles_m5[i + 1:]
                    )
                    pts = 8 if gap_filled else 15
                    if pts > best_fvg_pts:
                        best_fvg_pts = pts
                        fvg_label = f"Bearish FVG ({'Partial' if gap_filled else 'Unfilled'})"

        return {"found": best_fvg_pts > 0, "pts": best_fvg_pts, "label": fvg_label}
    except Exception:
        return {"found": False, "pts": 0, "label": "FVG check error"}


def _detect_displacement_for_grade(candles_m5: List[Dict]) -> Dict:
    """Check for displacement candle (body > 1.5× ATR avg) in recent M5 candles."""
    try:
        if not candles_m5 or len(candles_m5) < 21:
            return {"found": False, "pts": 0, "label": "Insufficient data"}

        recent = candles_m5[-21:]
        atr_values = [c["high"] - c["low"] for c in recent[:20]]
        atr_avg = sum(atr_values) / len(atr_values) if atr_values else 0
        if atr_avg == 0:
            return {"found": False, "pts": 0, "label": "ATR=0"}

        last = recent[-1]
        body = abs(last["close"] - last["open"])

        if body > 1.5 * atr_avg:
            # Check if in top/bottom 25% (decisive candle)
            rng = last["high"] - last["low"]
            if rng > 0:
                pos = (last["close"] - last["low"]) / rng
                decisive = pos > 0.75 or pos < 0.25
            else:
                decisive = False

            if decisive:
                # Check if sweep preceded it (for MSS)
                sym_sweeps = [
                    s for s in _sweep_events_raw
                    if s.get("status") in ("ACTIVE", "CONFIRMED")
                    and s.get("time_elapsed_s", 99999) < 900  # within 15 min
                ]
                if sym_sweeps:
                    return {"found": True, "pts": 15, "label": "MSS Confirmed (Sweep+Displacement)"}
                return {"found": True, "pts": 8, "label": "Displacement Only"}

        return {"found": False, "pts": 0, "label": "No displacement"}
    except Exception:
        return {"found": False, "pts": 0, "label": "Error"}


async def grade_forex_setup() -> Dict:
    """
    Feature 3 — SMC Setup Quality Grader.
    Scores 6 confluence factors per symbol, 0–100 total.
    """
    global _grade_cache, _grade_ts

    if time.time() - _grade_ts < CACHE_TTL["grades"]:
        return _grade_cache

    if not _streamer_available:
        _grade_cache = _demo_grades()
        _grade_ts = time.time()
        return _grade_cache

    kill_zone_info = _get_active_kill_zone()
    kz_pts = kill_zone_info["kill_zone_pts"]
    is_dead = kill_zone_info["is_dead_zone"]

    dxy_tick = get_dxy_tick()
    dxy_rising = False
    dxy_falling = False
    if dxy_tick:
        chg = float(dxy_tick.get("change_pct", 0))
        dxy_rising  = chg > 0.05
        dxy_falling = chg < -0.05

    grades = []

    # XAUUSD goes first (always)
    ordered_symbols = ["XAUUSD", "BTCUSD"] + [
        s for s in ALL_SYMBOLS if s not in ("XAUUSD", "BTCUSD")
    ]

    for sym in ordered_symbols:
        try:
            candles_h4 = get_forex_candles(sym, "1h")   # use H1 as H4 proxy if H4 not in cache
            candles_m5 = get_forex_candles(sym, "5min")
            tick        = get_forex_tick(sym)

            ltp = float(tick.get("ltp", 0)) if tick else 0

            # ── Factor 1: HTF Trend Aligned (20 pts) ──
            ema_bias = _detect_ema50_h4(candles_h4)
            if ema_bias == "BULLISH":
                f1_pts   = 20
                direction = "LONG"
                f1_label = "H4 EMA50 — Bullish"
            elif ema_bias == "BEARISH":
                f1_pts   = 20
                direction = "SHORT"
                f1_label = "H4 EMA50 — Bearish"
            elif ema_bias == "NEUTRAL":
                f1_pts   = 10
                direction = "NEUTRAL"
                f1_label = "H4 EMA50 — Neutral"
            else:
                f1_pts   = 0
                direction = "NEUTRAL"
                f1_label = "Insufficient H4 data"

            # ── Factor 2: Sweep Detected (20 pts) ──
            sym_sweeps = [
                s for s in _sweep_events_raw
                if s["symbol"] == sym and s["time_elapsed_s"] < 7200
            ]
            if any(s["status"] == "CONFIRMED" for s in sym_sweeps):
                f2_pts   = 20
                f2_label = "CONFIRMED sweep within 2h"
            elif any(s["status"] == "ACTIVE" for s in sym_sweeps):
                f2_pts   = 12
                f2_label = "ACTIVE sweep detected"
            else:
                f2_pts   = 0
                f2_label = "No recent sweep"

            # ── Factor 3: Kill Zone (15 pts) ──
            f3_pts   = kz_pts
            f3_label = kill_zone_info["zone"]

            # ── Factor 4: DXY Correlation (15 pts) ──
            USD_BASE  = {"USDJPY", "USDCHF", "USDCAD"}
            USD_QUOTE = {"EURUSD", "GBPUSD", "AUDUSD", "NZDUSD", "EURGBP"}
            if sym in USD_BASE:
                if direction == "LONG" and dxy_rising:
                    f4_pts = 15; f4_label = "DXY aligned (rising)"
                elif direction == "SHORT" and dxy_falling:
                    f4_pts = 15; f4_label = "DXY aligned (falling)"
                else:
                    f4_pts = 0;  f4_label = "DXY misaligned"
            elif sym in USD_QUOTE:
                if direction == "LONG" and dxy_falling:
                    f4_pts = 15; f4_label = "DXY aligned (falling)"
                elif direction == "SHORT" and dxy_rising:
                    f4_pts = 15; f4_label = "DXY aligned (rising)"
                else:
                    f4_pts = 0;  f4_label = "DXY misaligned"
            else:
                # Non-USD pairs: neutral correlation
                f4_pts   = 8
                f4_label = "DXY neutral (cross pair)"

            # ── Factor 5: Displacement (15 pts) ──
            disp = _detect_displacement_for_grade(candles_m5)
            f5_pts   = disp["pts"]
            f5_label = disp["label"]

            # ── Factor 6: FVG Present (15 pts) ──
            fvg = _detect_fvg(candles_m5, ltp)
            f6_pts   = fvg["pts"]
            f6_label = fvg["label"]

            # ── Total Score ──
            total = f1_pts + f2_pts + f3_pts + f4_pts + f5_pts + f6_pts

            # Dead zone override
            do_not_trade = is_dead
            if is_dead:
                grade_label  = "NO TRADE"
                grade_detail = "Dead Zone — No High-Probability SMC Setups"
            elif total >= 80:
                grade_label  = "A+"
                grade_detail = "EXECUTE — Highest probability setup"
            elif total >= 60:
                grade_label  = "A"
                grade_detail = "MONITOR — Good setup, wait for confirmation"
            elif total >= 40:
                grade_label  = "B"
                grade_detail = "WAIT — Missing key confluences"
            else:
                grade_label  = "NO TRADE"
                grade_detail = "SKIP — Do not risk capital"
                do_not_trade = True

            grades.append({
                "symbol":       sym,
                "score":        total,
                "grade":        grade_label,
                "grade_detail": grade_detail,
                "direction":    direction,
                "data_source":  "LIVE" if tick else "DEMO",
                "do_not_trade": do_not_trade,
                "ltp":          round(ltp, 5) if ltp > 0 else "—",
                "factors": {
                    "htf_trend":       {"pts": f1_pts, "max": 20, "label": f1_label},
                    "sweep_detected":  {"pts": f2_pts, "max": 20, "label": f2_label},
                    "kill_zone":       {"pts": f3_pts, "max": 15, "label": f3_label},
                    "dxy_correlation": {"pts": f4_pts, "max": 15, "label": f4_label},
                    "displacement":    {"pts": f5_pts, "max": 15, "label": f5_label},
                    "fvg_present":     {"pts": f6_pts, "max": 15, "label": f6_label},
                },
            })

        except Exception as e:
            logger.error(f"[ForexSMC] grade error for {sym}: {e}")
            grades.append({
                "symbol": sym, "score": 0, "grade": "NO TRADE", "direction": "—",
                "data_source": "DEMO", "do_not_trade": True, "ltp": "—",
                "factors": {
                    k: {"pts": 0, "max": m, "label": "Error"}
                    for k, m in [("htf_trend", 20), ("sweep_detected", 20),
                                 ("kill_zone", 15), ("dxy_correlation", 15),
                                 ("displacement", 15), ("fvg_present", 15)]
                },
            })

    _grade_cache = {
        "status": "ok",
        "data_source": "LIVE" if _streamer_available else "DEMO",
        "data": {
            "grades":    grades,
            "kill_zone": kill_zone_info,
            "timestamp": _utc_now().strftime("%H:%M:%S UTC"),
        }
    }
    _grade_ts = time.time()
    return _grade_cache


# ── FEATURE 4: OI & SENTIMENT ─────────────────────────────────────────────────

def _demo_sentiment() -> Dict:
    return {
        "status": "ok",
        "data_source": "DEMO",
        "data": {
            "cot": {
                sym: {"net_position": 0, "label": "DEMO — COT unavailable", "bias": "NEUTRAL"}
                for sym in ["EURUSD", "GBPUSD", "AUDUSD", "XAUUSD", "BTCUSD"]
            },
            "fear_greed": {"value": 50, "classification": "Neutral", "data_source": "DEMO"},
            "vix": {"value": None, "risk_level": "UNKNOWN", "data_source": "DEMO"},
            "timestamp": _utc_now().strftime("%H:%M:%S UTC"),
        }
    }


async def get_forex_sentiment() -> Dict:
    """
    Feature 4 — OI & Sentiment Integration.
    Sources: COT (CFTC), Fear & Greed Index (Alternative.me), VIX (yfinance).
    """
    global _sentiment_cache, _sentiment_ts

    if time.time() - _sentiment_ts < CACHE_TTL["sentiment"]:
        return _sentiment_cache

    # ── Fear & Greed Index ──
    fear_greed = {"value": 50, "classification": "Neutral", "data_source": "DEMO"}
    try:
        r = requests.get("https://api.alternative.me/fng/?limit=1", timeout=8)
        if r.ok:
            d = r.json()
            fg_data = d.get("data", [{}])[0]
            fear_greed = {
                "value":          int(fg_data.get("value", 50)),
                "classification": fg_data.get("value_classification", "Neutral"),
                "data_source":    "LIVE",
            }
    except Exception as e:
        logger.warning(f"[ForexSMC] Fear & Greed fetch error: {e}")

    # ── VIX ──
    vix_data = {"value": None, "risk_level": "UNKNOWN", "data_source": "DEMO"}
    try:
        import yfinance as yf
        vix_ticker = yf.Ticker("^VIX")
        hist = vix_ticker.history(period="1d", interval="1h")
        if hist is not None and not hist.empty:
            vix_val = float(hist["Close"].iloc[-1])
            if vix_val > 35:
                risk = "EXTREME_FEAR"
            elif vix_val > 25:
                risk = "ELEVATED"
            else:
                risk = "NORMAL"
            vix_data = {"value": round(vix_val, 2), "risk_level": risk, "data_source": "LIVE"}
    except Exception as e:
        logger.warning(f"[ForexSMC] VIX fetch error: {e}")

    # ── COT (Simplified — use pre-known bias from price action) ──
    # Full CFTC parsing requires downloading and parsing a large CSV — use simplified proxy
    cot = {}
    COT_SYMBOLS = ["EURUSD", "GBPUSD", "AUDUSD", "XAUUSD", "BTCUSD"]
    for sym in COT_SYMBOLS:
        tick = get_forex_tick(sym) if _streamer_available else None
        if tick:
            chg = float(tick.get("change_pct", 0))
            net = int(chg * 5000)  # proxy from price momentum
            bias = "BULLISH" if net > 500 else ("BEARISH" if net < -500 else "NEUTRAL")
            cot[sym] = {
                "net_position": net,
                "label": f"Proxy: {'+' if net > 0 else ''}{net:,} (derived from price momentum)",
                "bias": bias,
                "data_source": "PROXY",
            }
        else:
            cot[sym] = {
                "net_position": 0,
                "label": "COT data unavailable",
                "bias": "NEUTRAL",
                "data_source": "DEMO",
            }

    _sentiment_cache = {
        "status": "ok",
        "data_source": "LIVE",
        "data": {
            "cot":         cot,
            "fear_greed":  fear_greed,
            "vix":         vix_data,
            "timestamp":   _utc_now().strftime("%H:%M:%S UTC"),
        }
    }
    _sentiment_ts = time.time()
    return _sentiment_cache


# ── FEATURE 5: DISPLACEMENT CANDLE & MSS DETECTOR ────────────────────────────

def _demo_displacement() -> Dict:
    return {
        "status": "ok",
        "data_source": "DEMO",
        "data": {
            "alerts":    [],
            "timestamp": _utc_now().strftime("%H:%M:%S UTC"),
        }
    }


async def detect_forex_displacement() -> Dict:
    """
    Feature 5 — Displacement Candle & MSS Detector.
    Displacement = M5 body > 1.5× 20-candle ATR avg + decisive close.
    MSS CONFIRMED = displacement preceded by sweep within 3 M5 candles.
    """
    global _displacement_cache, _displacement_ts

    if time.time() - _displacement_ts < CACHE_TTL["displacement"]:
        return _displacement_cache

    if not _streamer_available:
        _displacement_cache = _demo_displacement()
        _displacement_ts = time.time()
        return _displacement_cache

    alerts = []
    now_utc = _utc_now()

    for sym in ALL_SYMBOLS:
        try:
            candles_m5 = get_forex_candles(sym, "5min")
            if not candles_m5 or len(candles_m5) < 22:
                continue

            # Only use today's candles
            today_candles = [
                c for c in candles_m5
                if _is_same_trading_day(c.get("datetime", ""))
            ]
            if len(today_candles) < 22:
                continue

            # Compute ATR on last 20 candles before the candidate
            for idx in range(20, len(today_candles)):
                window    = today_candles[idx - 20:idx]
                candidate = today_candles[idx]

                atr_values = [c["high"] - c["low"] for c in window]
                atr_avg    = sum(atr_values) / len(atr_values) if atr_values else 0
                if atr_avg == 0:
                    continue

                body = abs(candidate["close"] - candidate["open"])
                if body <= 1.5 * atr_avg:
                    continue

                # Decisive close check
                rng = candidate["high"] - candidate["low"]
                if rng == 0:
                    continue
                close_pos = (candidate["close"] - candidate["low"]) / rng

                is_bull = candidate["close"] > candidate["open"] and close_pos > 0.75
                is_bear = candidate["close"] < candidate["open"] and close_pos < 0.25

                if not is_bull and not is_bear:
                    continue

                direction = "▲" if is_bull else "▼"
                body_atr_ratio = round(body / atr_avg, 2)

                # Check for preceding sweep (within 3 M5 candles = 15 minutes)
                candle_time = candidate.get("datetime", "")
                age_s       = _get_candle_age_s(candle_time)

                if age_s > 1800:   # expire after 30 min
                    continue

                sym_sweeps = [
                    s for s in _sweep_events_raw
                    if s["symbol"] == sym and s["time_elapsed_s"] < (age_s + 900)
                ]
                mss = len(sym_sweeps) > 0

                alert_type = "MSS_CONFIRMED" if mss else "DISPLACEMENT_ONLY"

                alerts.append({
                    "symbol":        sym,
                    "direction":     direction,
                    "alert_type":    alert_type,
                    "body_atr_ratio": body_atr_ratio,
                    "candle_open":   round(candidate["open"], 5),
                    "candle_high":   round(candidate["high"], 5),
                    "candle_low":    round(candidate["low"], 5),
                    "candle_close":  round(candidate["close"], 5),
                    "candle_time":   candle_time,
                    "age_s":         age_s,
                    "expired":       age_s > 1800,
                    "data_source":   "LIVE",
                })

        except Exception as e:
            logger.error(f"[ForexSMC] displacement error for {sym}: {e}")

    # Sort newest first, expire > 30 min
    alerts.sort(key=lambda a: a["age_s"])

    _displacement_cache = {
        "status": "ok",
        "data_source": "LIVE" if _streamer_available else "DEMO",
        "data": {
            "alerts":    alerts[:20],   # cap at 20
            "timestamp": now_utc.strftime("%H:%M:%S UTC"),
        }
    }
    _displacement_ts = time.time()
    return _displacement_cache


# ── FEATURE 6: LIQUIDITY POOL MAPPER ─────────────────────────────────────────

def _demo_liquidity(symbol: str) -> Dict:
    return {
        "status": "ok",
        "data_source": "DEMO",
        "data": {
            "symbol":    symbol,
            "ltp":       "—",
            "pools":     [],
            "timestamp": _utc_now().strftime("%H:%M:%S UTC"),
        }
    }


def _round_number_proximity(price: float, symbol: str) -> Optional[float]:
    """Returns the nearest round number if within 0.3%."""
    try:
        if symbol in ("XAUUSD",):          step = 50.0
        elif symbol == "BTCUSD":           step = 1000.0
        elif symbol == "ETHUSD":           step = 100.0
        elif symbol in ("NAS100", "SP100"):step = 100.0
        else:                              step = 0.01  # Forex majors

        nearest = round(price / step) * step
        diff_pct = abs(price - nearest) / max(price, 1) * 100
        return nearest if diff_pct <= 0.3 else None
    except Exception:
        return None


def _tolerance_pct(symbol: str) -> float:
    """Equal high/low tolerance per symbol."""
    if symbol == "BTCUSD":  return 0.005   # 0.5%
    if symbol == "XAUUSD":  return 0.001   # 0.1%
    return 0.0005                           # 0.05% standard


async def map_forex_liquidity_pools(symbol: str = "XAUUSD") -> Dict:
    """
    Feature 6 — Liquidity Pool Mapper.
    Scans last 10 days of H1 candles for equal highs/lows.
    """
    global _liquidity_cache, _liquidity_ts

    sym = symbol.upper()
    if (
        sym in _liquidity_cache
        and time.time() - _liquidity_ts.get(sym, 0) < CACHE_TTL["liquidity"]
    ):
        return _liquidity_cache[sym]

    if not _streamer_available:
        result = _demo_liquidity(sym)
        _liquidity_cache[sym] = result
        _liquidity_ts[sym] = time.time()
        return result

    try:
        candles_h1 = get_forex_candles(sym, "1h")
        tick        = get_forex_tick(sym)
        ltp         = float(tick.get("ltp", 0)) if tick else 0

        if not candles_h1 or len(candles_h1) < 20 or ltp == 0:
            result = _demo_liquidity(sym)
            _liquidity_cache[sym] = result
            _liquidity_ts[sym] = time.time()
            return result

        # Use last 240 H1 candles = ~10 days
        recent = candles_h1[-240:]
        tol    = _tolerance_pct(sym)

        highs_by_date: Dict[str, float] = {}
        lows_by_date:  Dict[str, float] = {}
        for c in recent:
            dt_str = c.get("datetime", "")[:10]
            highs_by_date[dt_str] = max(highs_by_date.get(dt_str, 0), c["high"])
            lows_by_date[dt_str]  = min(lows_by_date.get(dt_str, float("inf")), c["low"])

        swing_highs = list(highs_by_date.values())
        swing_lows  = list(lows_by_date.values())

        pools = []

        # Equal Highs
        for i, h1 in enumerate(swing_highs):
            matches = [h1]
            for h2 in swing_highs[i + 1:]:
                if abs(h1 - h2) / max(h1, 1) <= tol:
                    matches.append(h2)
            if len(matches) >= 2:
                pool_price = sum(matches) / len(matches)
                # Already added a pool near this price?
                if any(abs(p["price"] - pool_price) / max(pool_price, 1) < tol for p in pools):
                    continue
                dist_pct = (pool_price - ltp) / ltp * 100 if ltp > 0 else 0
                tested = abs(dist_pct) < 0.2
                rn = _round_number_proximity(pool_price, sym)
                pools.append({
                    "type":       "EQUAL_HIGHS",
                    "price":      round(pool_price, 5),
                    "count":      len(matches),
                    "dist_pct":   round(dist_pct, 3),
                    "direction":  "ABOVE" if pool_price > ltp else "BELOW",
                    "tags":       (["Round #"] if rn else []) + (["Partial"] if tested else ["Untested"]),
                    "round_num":  rn,
                })

        # Equal Lows
        for i, l1 in enumerate(swing_lows):
            if l1 == float("inf"):
                continue
            matches = [l1]
            for l2 in swing_lows[i + 1:]:
                if l2 == float("inf"):
                    continue
                if abs(l1 - l2) / max(l1, 1) <= tol:
                    matches.append(l2)
            if len(matches) >= 2:
                pool_price = sum(matches) / len(matches)
                if any(abs(p["price"] - pool_price) / max(pool_price, 1) < tol for p in pools):
                    continue
                dist_pct = (pool_price - ltp) / ltp * 100 if ltp > 0 else 0
                tested = abs(dist_pct) < 0.2
                rn = _round_number_proximity(pool_price, sym)
                pools.append({
                    "type":       "EQUAL_LOWS",
                    "price":      round(pool_price, 5),
                    "count":      len(matches),
                    "dist_pct":   round(dist_pct, 3),
                    "direction":  "ABOVE" if pool_price > ltp else "BELOW",
                    "tags":       (["Round #"] if rn else []) + (["Partial"] if tested else ["Untested"]),
                    "round_num":  rn,
                })

        # Sort: above (closest first) and below (closest first)
        above = sorted(
            [p for p in pools if p["direction"] == "ABOVE"],
            key=lambda p: p["dist_pct"]
        )[:5]
        below = sorted(
            [p for p in pools if p["direction"] == "BELOW"],
            key=lambda p: -p["dist_pct"]
        )[:5]

        nearest_above = next((p for p in above if "Untested" in p["tags"]), None)
        nearest_below = next((p for p in below if "Untested" in p["tags"]), None)

        result = {
            "status": "ok",
            "data_source": "LIVE",
            "data": {
                "symbol":         sym,
                "ltp":            round(ltp, 5),
                "pools_above":    above,
                "pools_below":    below,
                "nearest_above":  nearest_above,
                "nearest_below":  nearest_below,
                "timestamp":      _utc_now().strftime("%H:%M:%S UTC"),
            }
        }
        _liquidity_cache[sym] = result
        _liquidity_ts[sym] = time.time()
        return result

    except Exception as e:
        logger.error(f"[ForexSMC] liquidity pool error for {sym}: {e}")
        result = _demo_liquidity(sym)
        _liquidity_cache[sym] = result
        _liquidity_ts[sym] = time.time()
        return result


# ── FEATURE 7: MULTI-TIMEFRAME BIAS DASHBOARD ─────────────────────────────────

def _demo_mtf_bias() -> Dict:
    return {
        "status": "ok",
        "data_source": "DEMO",
        "data": {
            "bias_grid": [
                {
                    "symbol": sym,
                    "D1": "NO_DATA", "H4": "NO_DATA", "H1": "NO_DATA", "M15": "NO_DATA",
                    "overall_bias": "NEUTRAL", "alignment_score": 0, "data_source": "DEMO",
                }
                for sym in ALL_SYMBOLS
            ],
            "timestamp": _utc_now().strftime("%H:%M:%S UTC"),
        }
    }


def _classify_structure(candles: List[Dict]) -> str:
    """
    Classify market structure: BULLISH (HH+HL), BEARISH (LH+LL), or RANGING.
    Uses last 5 swing points.
    """
    try:
        if not candles or len(candles) < 10:
            return "NO_DATA"

        # Identify swing highs and lows from last 30 candles
        n = min(30, len(candles))
        recent = candles[-n:]
        highs = [c["high"] for c in recent]
        lows  = [c["low"]  for c in recent]

        # Rolling window to find swing points
        swing_highs = []
        swing_lows  = []
        for i in range(2, len(recent) - 2):
            if (recent[i]["high"] > recent[i-1]["high"] and
                recent[i]["high"] > recent[i-2]["high"] and
                recent[i]["high"] > recent[i+1]["high"] and
                recent[i]["high"] > recent[i+2]["high"]):
                swing_highs.append(recent[i]["high"])
            if (recent[i]["low"] < recent[i-1]["low"] and
                recent[i]["low"] < recent[i-2]["low"] and
                recent[i]["low"] < recent[i+1]["low"] and
                recent[i]["low"] < recent[i+2]["low"]):
                swing_lows.append(recent[i]["low"])

        if len(swing_highs) < 2 or len(swing_lows) < 2:
            return "RANGING"

        # Check HH + HL = BULLISH
        last_2_highs = swing_highs[-2:]
        last_2_lows  = swing_lows[-2:]

        hh = last_2_highs[-1] > last_2_highs[-2]
        hl = last_2_lows[-1]  > last_2_lows[-2]
        lh = last_2_highs[-1] < last_2_highs[-2]
        ll = last_2_lows[-1]  < last_2_lows[-2]

        if hh and hl:
            return "BULLISH"
        elif lh and ll:
            return "BEARISH"
        else:
            return "RANGING"

    except Exception:
        return "NO_DATA"


async def calculate_mtf_bias() -> Dict:
    """
    Feature 7 — Multi-Timeframe Bias Dashboard.
    Checks HH/HL vs LH/LL structure on D1, H4(H1 proxy), H1, M15.
    """
    global _mtf_bias_cache, _mtf_bias_ts

    if time.time() - _mtf_bias_ts < CACHE_TTL["mtf_bias"]:
        return _mtf_bias_cache

    if not _streamer_available:
        _mtf_bias_cache = _demo_mtf_bias()
        _mtf_bias_ts = time.time()
        return _mtf_bias_cache

    bias_grid = []
    ordered_symbols = ["XAUUSD", "BTCUSD"] + [
        s for s in ALL_SYMBOLS if s not in ("XAUUSD", "BTCUSD")
    ]

    TF_MAP = {
        "D1":  "1day",
        "H4":  "1h",    # H4 not in TD free, use H1 as proxy
        "H1":  "1h",
        "M15": "15min",
    }

    for sym in ordered_symbols:
        try:
            row = {"symbol": sym, "data_source": "LIVE"}
            tf_results = {}

            for label, interval in TF_MAP.items():
                candles = get_forex_candles(sym, interval)
                tf_results[label] = _classify_structure(candles)

            row.update(tf_results)

            # Overall alignment
            scores = {
                "BULLISH": 1, "BEARISH": -1, "RANGING": 0, "NO_DATA": 0
            }
            total = sum(scores.get(tf_results.get(k, "NO_DATA"), 0) for k in ["D1", "H4", "H1", "M15"])

            if total == 4:
                row["overall_bias"]     = "STRONG_BULL"
                row["alignment_score"]  = 100
            elif total == 3:
                row["overall_bias"]     = "MILD_BULL"
                row["alignment_score"]  = 75
            elif total == -4:
                row["overall_bias"]     = "STRONG_BEAR"
                row["alignment_score"]  = 0
            elif total == -3:
                row["overall_bias"]     = "MILD_BEAR"
                row["alignment_score"]  = 25
            elif total == 0:
                row["overall_bias"]     = "NEUTRAL"
                row["alignment_score"]  = 50
            elif total > 0:
                row["overall_bias"]     = "MILD_BULL"
                row["alignment_score"]  = 60
            else:
                row["overall_bias"]     = "MILD_BEAR"
                row["alignment_score"]  = 40

            # EMA50 check on H1
            h1_candles = get_forex_candles(sym, "1h")
            ema50_bias = _detect_ema50_h4(h1_candles)
            row["ema50_h1"] = ema50_bias or "NO_DATA"

            bias_grid.append(row)

        except Exception as e:
            logger.error(f"[ForexSMC] MTF bias error for {sym}: {e}")
            bias_grid.append({
                "symbol": sym, "D1": "NO_DATA", "H4": "NO_DATA",
                "H1": "NO_DATA", "M15": "NO_DATA",
                "overall_bias": "NEUTRAL", "alignment_score": 50,
                "ema50_h1": "NO_DATA", "data_source": "DEMO",
            })

    _mtf_bias_cache = {
        "status": "ok",
        "data_source": "LIVE" if _streamer_available else "DEMO",
        "data": {
            "bias_grid": bias_grid,
            "timestamp": _utc_now().strftime("%H:%M:%S UTC"),
        }
    }
    _mtf_bias_ts = time.time()
    return _mtf_bias_cache
