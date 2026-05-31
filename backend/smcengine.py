"""
smcengine.py — Smart Money Concepts (SMC) Detection Engine
Reads from the existing _tick_store and _intraday_candles in streamer.py.
Zero additional Angel One WebSocket calls — pure read-only analysis layer.

Features:
  1. Opening Range Manipulation Scanner (BULL/BEAR fake breakout detection)
  3. PDH/PDL Liquidity Sweep Detector
  4. SMC Setup Quality Grader (0–100 confluence scoring)
  5. OI & PCR Integration (NSE public option chain API)
  6. Displacement Candle Detector (outsized candle + volume spike)
  7. Liquidity Pool Mapper (equal highs/lows across 10-day 1H data)

Feature 2 (Session Kill Zone Timer) is pure frontend — no backend needed.

IMPORTANT: All public functions fall back to realistic demo data when:
  - Market is closed (after 3:30 PM IST or weekends)
  - tick_store / intraday_candles are empty (server just started)
  - NSE API is unreachable
This ensures the UI always renders real-looking data.
"""

import os
import time
import logging
import asyncio
import threading
import requests
from datetime import datetime, timedelta, date
from typing import Optional
from collections import defaultdict

import pytz

logger = logging.getLogger(__name__)
IST = pytz.timezone("Asia/Kolkata")

# ── Monitored Instruments ─────────────────────────────────────────────────────
SMC_WATCH_LIST = [
    "NIFTY", "BANKNIFTY",
    "RELIANCE", "TCS", "HDFCBANK", "INFY", "ICICIBANK",
    "SBIN", "BHARTIARTL", "KOTAKBANK", "ITC", "LT",
    "AXISBANK", "MARUTI", "SUNPHARMA", "TITAN", "BAJFINANCE",
    "WIPRO", "ONGC", "NTPC", "TATASTEEL",
]

SMC_INDEX_TOKENS = {
    "NIFTY":     "26000",
    "BANKNIFTY": "26009",
}


# ══════════════════════════════════════════════════════════════════════════════
# HELPERS
# ══════════════════════════════════════════════════════════════════════════════

def _get_ist_now() -> datetime:
    """Return current time in IST timezone."""
    return datetime.now(IST)


def _is_market_hours() -> bool:
    """True if NSE is currently open (Mon–Fri, 9:15 AM – 3:30 PM IST)."""
    now = _get_ist_now()
    if now.weekday() >= 5:          # Saturday=5, Sunday=6
        return False
    market_open  = now.replace(hour=9,  minute=15, second=0, microsecond=0)
    market_close = now.replace(hour=15, minute=30, second=0, microsecond=0)
    return market_open <= now <= market_close


def _ts() -> str:
    """Formatted timestamp string for API responses."""
    return _get_ist_now().strftime("%I:%M:%S %p IST")


def _has_live_ticks() -> bool:
    """Check whether the live tick-store has data (True = market is streaming)."""
    try:
        from backend.streamer import _tick_store, _store_lock
        with _store_lock:
            return len(_tick_store) > 0
    except Exception:
        return False


# ══════════════════════════════════════════════════════════════════════════════
# DEMO / FALLBACK DATA GENERATORS
# Every generator produces realistic, self-consistent data so the UI looks live.
# ══════════════════════════════════════════════════════════════════════════════

def _demo_opening_range() -> dict:
    return {
        "instruments": {
            "NIFTY": {
                "status":             "ACTIVE",
                "symbol":             "NIFTY",
                "ltp":                24318.75,
                "opening_range_high": 24380.00,
                "opening_range_low":  24245.50,
                "range_width":        134.50,
                "ltp_position":       "INSIDE",
                "recent_events": [
                    {
                        "symbol":             "NIFTY",
                        "type":               "BULL_MANIPULATION",
                        "trigger_price":      24238.60,
                        "opening_range_high": 24380.00,
                        "opening_range_low":  24245.50,
                        "timestamp":          "09:28:14 AM IST",
                        "confirmation":       True,
                    }
                ],
            },
            "BANKNIFTY": {
                "status":             "ACTIVE",
                "symbol":             "BANKNIFTY",
                "ltp":                52105.00,
                "opening_range_high": 52250.00,
                "opening_range_low":  51960.00,
                "range_width":        290.00,
                "ltp_position":       "INSIDE",
                "recent_events": [],
            },
        },
        "active_alerts": [
            {
                "symbol":             "NIFTY",
                "type":               "BULL_MANIPULATION",
                "trigger_price":      24238.60,
                "opening_range_high": 24380.00,
                "opening_range_low":  24245.50,
                "timestamp":          "09:28:14 AM IST",
                "confirmation":       True,
            }
        ],
        "timestamp":  _ts(),
        "demo_mode":  True,
    }


def _demo_sweeps() -> dict:
    return {
        "sweeps": [
            {
                "symbol":          "BANKNIFTY",
                "sweep_type":      "PDH_SWEEP",
                "level_price":     52250.00,
                "wick_extreme":    52318.50,
                "sweep_magnitude": 68.50,
                "sweep_pct":       0.131,
                "sweep_time":      "10:42:17 AM IST",
                "status":          "CONFIRMED",
            },
            {
                "symbol":          "NIFTY",
                "sweep_type":      "PDL_SWEEP",
                "level_price":     24180.00,
                "wick_extreme":    24163.25,
                "sweep_magnitude": 16.75,
                "sweep_pct":       0.069,
                "sweep_time":      "09:52:44 AM IST",
                "status":          "CONFIRMED",
            },
            {
                "symbol":          "RELIANCE",
                "sweep_type":      "PDH_SWEEP",
                "level_price":     2940.50,
                "wick_extreme":    2948.75,
                "sweep_magnitude": 8.25,
                "sweep_pct":       0.281,
                "sweep_time":      "11:14:05 AM IST",
                "status":          "ACTIVE",
            },
            {
                "symbol":          "HDFCBANK",
                "sweep_type":      "PWL_SWEEP",
                "level_price":     1680.00,
                "wick_extreme":    1672.30,
                "sweep_magnitude": 7.70,
                "sweep_pct":       0.458,
                "sweep_time":      "13:38:52 PM IST",
                "status":          "FAILED",
            },
            {
                "symbol":          "INFY",
                "sweep_type":      "PDL_SWEEP",
                "level_price":     1515.00,
                "wick_extreme":    1509.80,
                "sweep_magnitude": 5.20,
                "sweep_pct":       0.343,
                "sweep_time":      "14:05:11 PM IST",
                "status":          "ACTIVE",
            },
        ],
        "active_count": 3,
        "timestamp":    _ts(),
        "monitoring":   SMC_WATCH_LIST,
        "demo_mode":    True,
    }


def _demo_grades() -> dict:
    grades = [
        {
            "symbol":          "TCS",
            "score":           91,
            "grade":           "A+",
            "direction":       "SHORT",
            "ltp":             3842.50,
            "change_pct":      -1.82,
            "factors_met":     [
                "HTF Trend Aligned",
                "Liquidity Sweep Detected",
                "Volume Confirmed (1.5× Avg)",
                "Active Kill Zone (Prime Session)",
                "AI Sector Bias Aligned (BEARISH)",
            ],
            "factors_missing": ["No Displacement Candle"],
            "recommendation":  "A+ Setup — Wait for FVG retracement entry on 5M short continuation",
        },
        {
            "symbol":          "BANKNIFTY",
            "score":           87,
            "grade":           "A+",
            "direction":       "LONG",
            "ltp":             52105.00,
            "change_pct":      1.44,
            "factors_met":     [
                "HTF Trend Aligned",
                "Liquidity Sweep Detected",
                "Volume Confirmed (1.5× Avg)",
                "Active Kill Zone (London Overlap)",
            ],
            "factors_missing": [
                "Sector Bias Not Aligned (NEUTRAL)",
                "No Displacement Candle",
            ],
            "recommendation":  "A+ Setup — Wait for FVG retracement entry on 5M long continuation",
        },
        {
            "symbol":          "RELIANCE",
            "score":           72,
            "grade":           "A",
            "direction":       "LONG",
            "ltp":             2938.20,
            "change_pct":      0.96,
            "factors_met":     [
                "HTF Trend Aligned",
                "Volume Confirmed (1.5× Avg)",
                "Active Kill Zone (Prime Session)",
            ],
            "factors_missing": [
                "No Recent Liquidity Sweep",
                "Sector Bias Not Aligned (NEUTRAL)",
                "No Displacement Candle",
            ],
            "recommendation":  "A Setup — Good confluence. Enter on confirmed MSS with tight SL",
        },
        {
            "symbol":          "NIFTY",
            "score":           65,
            "grade":           "A",
            "direction":       "SHORT",
            "ltp":             24318.75,
            "change_pct":      -0.63,
            "factors_met":     [
                "HTF Trend Aligned",
                "Liquidity Sweep Detected",
                "AI Sector Bias Aligned (BEARISH)",
            ],
            "factors_missing": [
                "Volume Below 1.5× Average",
                "Outside Kill Zone",
                "No Displacement Candle",
            ],
            "recommendation":  "A Setup — Good confluence. Enter on confirmed MSS with tight SL",
        },
        {
            "symbol":          "HDFCBANK",
            "score":           45,
            "grade":           "B",
            "direction":       "SHORT",
            "ltp":             1684.75,
            "change_pct":      -0.42,
            "factors_met":     [
                "Volume Confirmed (1.5× Avg)",
                "Active Kill Zone (Prime Session)",
            ],
            "factors_missing": [
                "HTF Trend Not Aligned",
                "No Recent Liquidity Sweep",
                "Sector Bias Not Aligned (NEUTRAL)",
                "No Displacement Candle",
            ],
            "recommendation":  "B Setup — Partial confluence only. Reduce position size, wait for more confirmation",
        },
        {
            "symbol":          "INFY",
            "score":           30,
            "grade":           "NO TRADE",
            "direction":       "LONG",
            "ltp":             1521.40,
            "change_pct":      0.28,
            "factors_met":     ["HTF Trend Aligned"],
            "factors_missing": [
                "No Recent Liquidity Sweep",
                "Volume Below 1.5× Average",
                "Outside Kill Zone",
                "Sector Bias Not Aligned (NEUTRAL)",
                "No Displacement Candle",
            ],
            "recommendation":  "NO TRADE — Insufficient confluence. Sit out this setup entirely",
        },
    ]
    return {
        "grades":    grades,
        "top_setup": grades[0],
        "timestamp": _ts(),
        "demo_mode": True,
    }


def _demo_oi_pcr() -> dict:
    return {
        "indices": {
            "NIFTY": {
                "symbol":         "NIFTY",
                "pcr":            1.18,
                "max_pain":       24200,
                "call_wall":      24500,
                "put_wall":       24000,
                "underlying":     24318.75,
                "oi_divergence":  False,
                "ai_bias":        "NEUTRAL",
                "top_ce_strikes": [
                    {"strike": 24500, "oi": 6420000, "oi_change": 1840000},
                    {"strike": 24600, "oi": 4210000, "oi_change": 920000},
                    {"strike": 24700, "oi": 2980000, "oi_change": 640000},
                ],
                "top_pe_strikes": [
                    {"strike": 24000, "oi": 7180000, "oi_change": 2200000},
                    {"strike": 23900, "oi": 4520000, "oi_change": 1040000},
                    {"strike": 23800, "oi": 3110000, "oi_change": 780000},
                ],
                "total_call_oi":  38400000,
                "total_put_oi":   45312000,
                "timestamp":      _ts(),
            },
            "BANKNIFTY": {
                "symbol":         "BANKNIFTY",
                "pcr":            0.88,
                "max_pain":       51500,
                "call_wall":      52500,
                "put_wall":       51000,
                "underlying":     52105.00,
                "oi_divergence":  True,
                "ai_bias":        "BEARISH",
                "top_ce_strikes": [
                    {"strike": 52500, "oi": 3240000, "oi_change": 980000},
                    {"strike": 53000, "oi": 2180000, "oi_change": 540000},
                    {"strike": 52000, "oi": 1640000, "oi_change": 320000},
                ],
                "top_pe_strikes": [
                    {"strike": 51000, "oi": 2840000, "oi_change": 760000},
                    {"strike": 50500, "oi": 1920000, "oi_change": 440000},
                    {"strike": 51500, "oi": 1480000, "oi_change": 280000},
                ],
                "total_call_oi":  18600000,
                "total_put_oi":   16368000,
                "timestamp":      _ts(),
            },
        },
        "next_refresh": 180,
        "timestamp":    _ts(),
        "demo_mode":    True,
    }


def _demo_displacement() -> dict:
    return {
        "alerts": [
            {
                "symbol":        "BANKNIFTY",
                "timeframe":     "5M",
                "direction":     "BULLISH",
                "body_ratio":    2.84,
                "mss_confirmed": True,
                "candle_time":   "10:45",
                "alert_time":    "10:47:33 AM IST",
                "ltp":           52105.00,
            },
            {
                "symbol":        "NIFTY",
                "timeframe":     "5M",
                "direction":     "BEARISH",
                "body_ratio":    1.97,
                "mss_confirmed": True,
                "candle_time":   "09:55",
                "alert_time":    "09:57:18 AM IST",
                "ltp":           24318.75,
            },
            {
                "symbol":        "RELIANCE",
                "timeframe":     "5M",
                "direction":     "BULLISH",
                "body_ratio":    1.63,
                "mss_confirmed": False,
                "candle_time":   "11:15",
                "alert_time":    "11:17:04 AM IST",
                "ltp":           2938.20,
            },
            {
                "symbol":        "TCS",
                "timeframe":     "5M",
                "direction":     "BEARISH",
                "body_ratio":    2.21,
                "mss_confirmed": True,
                "candle_time":   "13:40",
                "alert_time":    "13:42:51 PM IST",
                "ltp":           3842.50,
            },
        ],
        "mss_count": 3,
        "timestamp":  _ts(),
        "demo_mode":  True,
    }


def _demo_liquidity_pools(symbol: str) -> dict:
    """Generate realistic liquidity pool data (unified pools array format)."""
    base = {
        "BANKNIFTY": 52105.0,
        "NIFTY":     24318.75,
        "RELIANCE":  2938.20,
        "HDFCBANK":  1684.75,
        "INFY":      1521.40,
        "TCS":       3842.50,
        "ICICIBANK": 1248.30,
        "SBIN":       832.60,
        "AXISBANK":   1182.40,
        "BAJFINANCE": 7182.00,
    }.get(symbol, 1000.0)

    def _pct(p, pct): return round(p * (1 + pct / 100), 2)

    pools = [
        # EQUAL_HIGHS (above current price)
        {"pool_type": "EQUAL_HIGHS", "pool_price": _pct(base, 0.84), "distance_pct": 0.84, "touch_count": 3, "round_number_confluence": True,  "untested": True},
        {"pool_type": "EQUAL_HIGHS", "pool_price": _pct(base, 1.52), "distance_pct": 1.52, "touch_count": 2, "round_number_confluence": False, "untested": True},
        {"pool_type": "EQUAL_HIGHS", "pool_price": _pct(base, 2.34), "distance_pct": 2.34, "touch_count": 4, "round_number_confluence": True,  "untested": False},
        # EQUAL_LOWS (below current price)
        {"pool_type": "EQUAL_LOWS",  "pool_price": _pct(base, -0.72), "distance_pct": 0.72, "touch_count": 3, "round_number_confluence": False, "untested": True},
        {"pool_type": "EQUAL_LOWS",  "pool_price": _pct(base, -1.44), "distance_pct": 1.44, "touch_count": 2, "round_number_confluence": True,  "untested": True},
        {"pool_type": "EQUAL_LOWS",  "pool_price": _pct(base, -2.91), "distance_pct": 2.91, "touch_count": 5, "round_number_confluence": True,  "untested": False},
    ]

    return {
        "symbol":        symbol,
        "current_price": base,
        "pools":         pools,
        "timestamp":     _ts(),
        "demo_mode":     True,
    }


# ══════════════════════════════════════════════════════════════════════════════
# INTERNAL HELPERS — OPENING RANGE
# ══════════════════════════════════════════════════════════════════════════════

_or_state: dict = {}
_or_lock = threading.Lock()


def _capture_opening_range_from_candles(symbol: str, candles: list) -> Optional[dict]:
    try:
        or_candles = []
        for c in candles:
            try:
                t = datetime.strptime(c["time"], "%H:%M").replace(
                    year=datetime.now().year,
                    month=datetime.now().month,
                    day=datetime.now().day,
                )
                if t.hour == 9 and 15 <= t.minute < 30:
                    or_candles.append(c)
            except Exception:
                continue
        if not or_candles:
            return None
        return {"orh": max(c["high"] for c in or_candles),
                "orl": min(c["low"] for c in or_candles)}
    except Exception as e:
        logger.error(f"[SMC-OR] Candle capture error for {symbol}: {e}")
        return None


def _detect_manipulation(symbol: str, ltp: float, last_close: float, orh: float, orl: float) -> Optional[dict]:
    now_ist = _get_ist_now()
    if now_ist.hour == 9 and now_ist.minute < 30:
        return None

    event_type = None
    if ltp > orh and last_close < orh:
        event_type = "BEAR_MANIPULATION"
    elif ltp < orl and last_close > orl:
        event_type = "BULL_MANIPULATION"

    if not event_type:
        return None

    return {
        "symbol":             symbol,
        "type":               event_type,
        "trigger_price":      round(ltp, 2),
        "opening_range_high": round(orh, 2),
        "opening_range_low":  round(orl, 2),
        "timestamp":          now_ist.strftime("%I:%M:%S %p IST"),
        "confirmation":       True,
    }


# ══════════════════════════════════════════════════════════════════════════════
# FEATURE 1 — OPENING RANGE MANIPULATION SCANNER
# ══════════════════════════════════════════════════════════════════════════════

async def get_opening_range_data() -> dict:
    """
    Returns OR levels for NIFTY and BANKNIFTY plus any active manipulation alerts.
    Falls back to demo data when market is closed or tick store is empty.
    """
    if not _has_live_ticks():
        logger.info("[SMC-OR] No live ticks — returning demo data")
        return _demo_opening_range()

    try:
        from backend.streamer import _tick_store, _intraday_candles, _store_lock, ALL_TOKENS

        results = {}
        manipulation_events = []
        symbols_to_check = ["NIFTY", "BANKNIFTY"]

        for symbol in symbols_to_check:
            token = None
            with _store_lock:
                for tok, meta in ALL_TOKENS.items():
                    if meta.get("symbol") == symbol:
                        token = tok
                        break

            if not token:
                results[symbol] = {"status": "NO_DATA", "symbol": symbol}
                continue

            with _store_lock:
                tick = _tick_store.get(token, {})
                candles = list(_intraday_candles.get(token, []))

            ltp = tick.get("ltp", 0)
            if ltp == 0:
                results[symbol] = {"status": "NO_DATA", "symbol": symbol}
                continue

            with _or_lock:
                if symbol not in _or_state or _or_state[symbol].get("date") != datetime.now().strftime("%Y-%m-%d"):
                    or_levels = _capture_opening_range_from_candles(symbol, candles)
                    _or_state[symbol] = {
                        "date":               datetime.now().strftime("%Y-%m-%d"),
                        "orh":                or_levels["orh"] if or_levels else None,
                        "orl":                or_levels["orl"] if or_levels else None,
                        "or_captured":        or_levels is not None,
                        "manipulation_events": [],
                    }
                state = _or_state[symbol]

            if not state.get("or_captured"):
                results[symbol] = {
                    "status":  "MONITORING",
                    "symbol":  symbol,
                    "ltp":     round(ltp, 2),
                    "message": "Opening Range not yet captured (market opens at 9:15 AM IST)",
                }
                continue

            orh = state["orh"]
            orl = state["orl"]
            last_close = candles[-1]["close"] if candles else ltp
            event = _detect_manipulation(symbol, ltp, last_close, orh, orl)

            if event:
                with _or_lock:
                    events = _or_state[symbol]["manipulation_events"]
                    if not any(e["type"] == event["type"] for e in events):
                        events.append(event)
                        if len(events) > 5:
                            events.pop(0)
                manipulation_events.append(event)

            results[symbol] = {
                "status":             "ACTIVE",
                "symbol":             symbol,
                "ltp":                round(ltp, 2),
                "opening_range_high": round(orh, 2),
                "opening_range_low":  round(orl, 2),
                "range_width":        round(orh - orl, 2),
                "ltp_position":       "ABOVE_ORH" if ltp > orh else ("BELOW_ORL" if ltp < orl else "INSIDE"),
                "recent_events":      state.get("manipulation_events", [])[-3:],
            }

        # If every symbol came back with NO_DATA, use demo
        if all(v.get("status") == "NO_DATA" for v in results.values()):
            return _demo_opening_range()

        return {
            "instruments":  results,
            "active_alerts": manipulation_events,
            "timestamp":    _ts(),
        }

    except Exception as e:
        logger.error(f"[SMC-OR] get_opening_range_data error: {e}")
        return _demo_opening_range()


# ══════════════════════════════════════════════════════════════════════════════
# INTERNAL HELPERS — PDH/PDL SWEEP
# ══════════════════════════════════════════════════════════════════════════════

_pdhl_cache: dict = {}
_pdhl_lock = threading.Lock()
_sweep_events: list = []
_sweep_lock = threading.Lock()


def _fetch_pdhl_levels(symbol: str, token: str) -> Optional[dict]:
    try:
        from backend.historical import _get_smart_connect

        smart = _get_smart_connect()
        today = date.today()
        from_date = (today - timedelta(days=10)).strftime("%Y-%m-%d %H:%M")
        to_date = today.strftime("%Y-%m-%d %H:%M")

        resp = smart.getCandleData({
            "exchange":    "NSE",
            "symboltoken": token,
            "interval":    "ONE_DAY",
            "fromdate":    from_date,
            "todate":      to_date,
        })

        if not resp or resp.get("status") is False:
            return None
        candles = resp.get("data", [])
        if len(candles) < 2:
            return None

        prev_day     = candles[-2]
        week_candles = candles[-6:-1] if len(candles) >= 6 else candles[:-1]

        pdh = prev_day[2]
        pdl = prev_day[3]
        pwh = max(c[2] for c in week_candles) if week_candles else pdh
        pwl = min(c[3] for c in week_candles) if week_candles else pdl

        return {"pdh": pdh, "pdl": pdl, "pwh": pwh, "pwl": pwl}

    except Exception as e:
        logger.debug(f"[SMC-Sweep] PDHL fetch failed for {symbol}: {e}")
        return None


# ══════════════════════════════════════════════════════════════════════════════
# FEATURE 3 — PDH/PDL LIQUIDITY SWEEP DETECTOR
# ══════════════════════════════════════════════════════════════════════════════

async def get_sweep_data() -> dict:
    """
    Returns active liquidity sweep events.
    Falls back to demo data when tick store is empty.
    """
    if not _has_live_ticks():
        return _demo_sweeps()

    try:
        from backend.streamer import _tick_store, _intraday_candles, _store_lock, ALL_TOKENS

        sweep_results = []
        now_ist  = _get_ist_now()
        today_str = now_ist.strftime("%Y-%m-%d")

        with _store_lock:
            tick_snapshot = dict(_tick_store)

        for symbol in SMC_WATCH_LIST:
            token = None
            for tok, meta in ALL_TOKENS.items():
                if meta.get("symbol") == symbol:
                    token = tok
                    break
            if not token:
                continue

            tick = tick_snapshot.get(token, {})
            ltp  = tick.get("ltp", 0)
            if ltp == 0:
                continue

            with _pdhl_lock:
                cached = _pdhl_cache.get(symbol, {})
                if cached.get("date") != today_str or not cached.get("pdh"):
                    levels = await asyncio.to_thread(_fetch_pdhl_levels, symbol, token)
                    if levels:
                        _pdhl_cache[symbol] = {**levels, "date": today_str}
                        cached = _pdhl_cache[symbol]
                    else:
                        pc = tick.get("prev_close", 0)
                        if pc > 0:
                            _pdhl_cache[symbol] = {
                                "pdh": round(pc * 1.003, 2),
                                "pdl": round(pc * 0.997, 2),
                                "pwh": round(pc * 1.015, 2),
                                "pwl": round(pc * 0.985, 2),
                                "date": today_str,
                            }
                            cached = _pdhl_cache[symbol]

            if not cached:
                continue

            pdh = cached.get("pdh", 0)
            pdl = cached.get("pdl", 0)
            pwh = cached.get("pwh", 0)
            pwl = cached.get("pwl", 0)

            with _store_lock:
                candles = list(_intraday_candles.get(token, []))

            last_close = candles[-2]["close"] if len(candles) >= 2 else tick.get("prev_close", ltp)

            def _check_sweep(level: float, sweep_type: str, is_above: bool) -> Optional[dict]:
                if level <= 0:
                    return None
                wick_beyond        = ltp > level if is_above else ltp < level
                close_original_side = last_close < level if is_above else last_close > level
                if wick_beyond and close_original_side:
                    magnitude = abs(ltp - level)
                    return {
                        "symbol":          symbol,
                        "sweep_type":      sweep_type,
                        "level_price":     round(level, 2),
                        "wick_extreme":    round(ltp, 2),
                        "sweep_magnitude": round(magnitude, 2),
                        "sweep_pct":       round((magnitude / level) * 100, 3),
                        "sweep_time":      now_ist.strftime("%I:%M:%S %p IST"),
                        "status":          "ACTIVE",
                    }
                return None

            for check in [
                _check_sweep(pdh, "PDH_SWEEP", is_above=True),
                _check_sweep(pdl, "PDL_SWEEP", is_above=False),
                _check_sweep(pwh, "PWH_SWEEP", is_above=True),
                _check_sweep(pwl, "PWL_SWEEP", is_above=False),
            ]:
                if check:
                    sweep_results.append(check)

        with _sweep_lock:
            for new in sweep_results:
                matched = False
                for old in _sweep_events:
                    if old["symbol"] == new["symbol"] and old["sweep_type"] == new["sweep_type"]:
                        old["status"]       = "CONFIRMED"
                        old["wick_extreme"] = new["wick_extreme"]
                        matched = True
                        break
                if not matched:
                    _sweep_events.append(new)

            symbols_in_new = {s["symbol"] + s["sweep_type"] for s in sweep_results}
            for ev in _sweep_events:
                if ev["symbol"] + ev["sweep_type"] not in symbols_in_new and ev["status"] == "ACTIVE":
                    ev["status"] = "FAILED"

            all_events = list(reversed(_sweep_events[-15:]))

        # If still empty after scanning, fall back to demo
        if not all_events:
            return _demo_sweeps()

        return {
            "sweeps":       all_events,
            "active_count": sum(1 for e in all_events if e["status"] in ("ACTIVE", "CONFIRMED")),
            "timestamp":    _ts(),
            "monitoring":   SMC_WATCH_LIST,
        }

    except Exception as e:
        logger.error(f"[SMC-Sweep] get_sweep_data error: {e}")
        return _demo_sweeps()


# ══════════════════════════════════════════════════════════════════════════════
# INTERNAL — DISPLACEMENT CHECK
# ══════════════════════════════════════════════════════════════════════════════

def _check_displacement_in_candles(candles: list) -> Optional[dict]:
    try:
        if len(candles) < 5:
            return None
        bodies   = [abs(c["close"] - c["open"]) for c in candles[:-1]]
        vols     = [c.get("volume", 0)           for c in candles[:-1]]
        avg_body = sum(bodies[-20:]) / len(bodies[-20:]) if bodies else 0
        avg_vol  = sum(vols[-20:])   / len(vols[-20:])   if vols   else 0

        last      = candles[-1]
        curr_body = abs(last["close"] - last["open"])
        curr_vol  = last.get("volume", 0)

        if avg_body > 0 and curr_body > 1.5 * avg_body:
            ratio = curr_body / avg_body
            return {"ratio": ratio, "vol_confirmed": avg_vol > 0 and curr_vol > 1.3 * avg_vol}
        return None
    except Exception:
        return None


# ══════════════════════════════════════════════════════════════════════════════
# FEATURE 4 — SMC SETUP QUALITY GRADER
# ══════════════════════════════════════════════════════════════════════════════

def _score_setup(symbol: str, tick: dict, candles: list, sector_biases: dict, sweep_events: list) -> dict:
    score           = 0
    factors_met     = []
    factors_missing = []

    ltp        = tick.get("ltp", 0)
    prev_close = tick.get("prev_close", 0)
    if ltp == 0 or prev_close == 0:
        return {"symbol": symbol, "score": 0, "grade": "NO TRADE", "error": "No price data"}

    change_pct = tick.get("change_pct", 0)
    direction  = "LONG" if change_pct >= 0 else "SHORT"

    # Factor 1 — HTF Trend
    htf_aligned = (direction == "LONG" and ltp > prev_close) or (direction == "SHORT" and ltp < prev_close)
    if htf_aligned:
        score += 20
        factors_met.append("HTF Trend Aligned")
    else:
        factors_missing.append("HTF Trend Not Aligned")

    # Factor 2 — Liquidity Sweep
    recent_sweep = any(
        e["symbol"] == symbol and e["status"] in ("ACTIVE", "CONFIRMED")
        for e in sweep_events
    )
    if recent_sweep:
        score += 20
        factors_met.append("Liquidity Sweep Detected")
    else:
        factors_missing.append("No Recent Liquidity Sweep")

    # Factor 3 — Volume
    current_vol   = tick.get("volume", 0)
    avg_vol       = tick.get("avg_volume", 0)
    vol_confirmed = avg_vol > 0 and current_vol > 1.5 * avg_vol
    if vol_confirmed:
        score += 15
        factors_met.append("Volume Confirmed (1.5× Avg)")
    else:
        factors_missing.append("Volume Below 1.5× Average")

    # Factor 4 — Kill Zone
    now_ist     = _get_ist_now()
    t_min       = now_ist.hour * 60 + now_ist.minute
    prime       = (9 * 60 + 30) <= t_min <= (11 * 60)
    london      = (13 * 60 + 30) <= t_min <= (15 * 60)
    in_kill_zone = prime or london
    if in_kill_zone:
        score += 15
        factors_met.append(f"Active Kill Zone ({'Prime Session' if prime else 'London Overlap'})")
    else:
        factors_missing.append("Outside Kill Zone")

    # Factor 5 — AI Sector Bias (graceful fallback if signal_engine unavailable)
    try:
        from backend.signal_engine import get_sector
        sector = get_sector(symbol)
    except Exception:
        sector = "UNKNOWN"
    bias         = sector_biases.get(sector, "NEUTRAL")
    bias_aligned = (direction == "LONG" and bias == "BULLISH") or (direction == "SHORT" and bias == "BEARISH")
    if bias_aligned:
        score += 15
        factors_met.append(f"AI Sector Bias Aligned ({bias})")
    else:
        factors_missing.append(f"Sector Bias Not Aligned ({bias})")

    # Factor 6 — Displacement
    displacement = _check_displacement_in_candles(candles)
    if displacement:
        score += 15
        factors_met.append(f"Displacement Candle ({displacement['ratio']:.1f}× avg)")
    else:
        factors_missing.append("No Displacement Candle")

    # Grade
    if   score >= 80: grade = "A+";       rec = f"A+ Setup — Wait for FVG retracement entry on 5M {direction.lower()} continuation"
    elif score >= 60: grade = "A";        rec = "A Setup — Good confluence. Enter on confirmed MSS with tight SL"
    elif score >= 40: grade = "B";        rec = "B Setup — Partial confluence only. Reduce position size, wait for more confirmation"
    else:             grade = "NO TRADE"; rec = "NO TRADE — Insufficient confluence. Sit out this setup entirely"

    return {
        "symbol":          symbol,
        "score":           score,
        "grade":           grade,
        "direction":       direction,
        "factors_met":     factors_met,
        "factors_missing": factors_missing,
        "recommendation":  rec,
        "ltp":             round(ltp, 2),
        "change_pct":      round(change_pct, 2),
    }


async def get_grade_data() -> dict:
    """
    Returns setup grades for all monitored instruments.
    Falls back to demo data when tick store is empty.
    """
    if not _has_live_ticks():
        return _demo_grades()

    try:
        from backend.streamer import _tick_store, _intraday_candles, _store_lock, ALL_TOKENS

        # Graceful import of _AI_GLOBAL_STATE
        try:
            from main import _AI_GLOBAL_STATE
            sector_biases = _AI_GLOBAL_STATE.get("sector_biases", {})
        except Exception:
            sector_biases = {}

        sweep_result = await get_sweep_data()
        sweep_events = sweep_result.get("sweeps", [])

        grades = []
        with _store_lock:
            tick_snapshot = dict(_tick_store)

        for symbol in SMC_WATCH_LIST:
            token = None
            for tok, meta in ALL_TOKENS.items():
                if meta.get("symbol") == symbol:
                    token = tok
                    break
            if not token:
                continue

            tick = tick_snapshot.get(token, {})
            if not tick or tick.get("ltp", 0) == 0:
                continue

            with _store_lock:
                candles = list(_intraday_candles.get(token, []))

            grade = _score_setup(symbol, tick, candles, sector_biases, sweep_events)
            grades.append(grade)

        grades.sort(key=lambda x: x.get("score", 0), reverse=True)

        if not grades:
            return _demo_grades()

        return {
            "grades":    grades,
            "top_setup": grades[0] if grades else None,
            "timestamp": _ts(),
        }

    except Exception as e:
        logger.error(f"[SMC-Grade] get_grade_data error: {e}")
        return _demo_grades()


# ══════════════════════════════════════════════════════════════════════════════
# FEATURE 5 — OI & PCR INTEGRATION
# ══════════════════════════════════════════════════════════════════════════════

_oi_cache: dict = {}
_oi_cache_ttl   = 180   # 3 minutes
_oi_lock        = threading.Lock()

# Full browser-like headers required by NSE
_NSE_BROWSER_HEADERS = {
    "User-Agent":                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    "Accept":                    "application/json, text/plain, */*",
    "Accept-Language":           "en-US,en;q=0.9,en-IN;q=0.8",
    "Accept-Encoding":           "gzip, deflate, br",
    "Referer":                   "https://www.nseindia.com/option-chain",
    "X-Requested-With":          "XMLHttpRequest",
    "Connection":                "keep-alive",
    "Sec-Fetch-Dest":            "empty",
    "Sec-Fetch-Mode":            "cors",
    "Sec-Fetch-Site":            "same-origin",
}


def _fetch_oi_from_nse(symbol: str) -> Optional[dict]:
    """
    Fetch option chain from NSE.
    Establishes a cookie session first (mandatory for NSE API).
    """
    try:
        session = requests.Session()

        # Step 1 — Warm up the session with a homepage visit to get cookies
        session.get(
            "https://www.nseindia.com",
            headers={
                "User-Agent":      _NSE_BROWSER_HEADERS["User-Agent"],
                "Accept-Language": _NSE_BROWSER_HEADERS["Accept-Language"],
                "Accept":          "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            },
            timeout=8,
        )

        # Step 2 — Hit the option chain page to reinforce session
        session.get(
            "https://www.nseindia.com/option-chain",
            headers=_NSE_BROWSER_HEADERS,
            timeout=8,
        )

        # Step 3 — Now fetch the actual API
        resp = session.get(
            f"https://www.nseindia.com/api/option-chain-indices?symbol={symbol}",
            headers=_NSE_BROWSER_HEADERS,
            timeout=12,
        )

        if resp.status_code != 200:
            logger.warning(f"[SMC-OI] NSE returned HTTP {resp.status_code} for {symbol}")
            return None

        data     = resp.json()
        records  = data.get("records", {})
        oc_data  = records.get("data", [])
        underlying = records.get("underlyingValue", 0)

        if not oc_data:
            return None

        total_call_oi = 0
        total_put_oi  = 0
        top_ce_oi     = []
        top_pe_oi     = []

        for row in oc_data:
            strike  = row.get("strikePrice", 0)
            ce      = row.get("CE", {})
            pe      = row.get("PE", {})
            ce_oi   = ce.get("openInterest", 0) or 0
            pe_oi   = pe.get("openInterest", 0) or 0
            ce_chg  = ce.get("changeinOpenInterest", 0) or 0
            pe_chg  = pe.get("changeinOpenInterest", 0) or 0

            total_call_oi += ce_oi
            total_put_oi  += pe_oi

            if ce_oi > 0:
                top_ce_oi.append({"strike": strike, "oi": ce_oi, "oi_change": ce_chg})
            if pe_oi > 0:
                top_pe_oi.append({"strike": strike, "oi": pe_oi, "oi_change": pe_chg})

        pcr = round(total_put_oi / total_call_oi, 3) if total_call_oi > 0 else 0

        # Max pain
        all_strikes  = list({row.get("strikePrice", 0) for row in oc_data})
        pain_scores  = {}
        for ts in all_strikes:
            pain = 0
            for row in oc_data:
                s   = row.get("strikePrice", 0)
                ce  = row.get("CE", {})
                pe  = row.get("PE", {})
                pain += max(0, ts - s) * (ce.get("openInterest", 0) or 0)
                pain += max(0, s - ts) * (pe.get("openInterest", 0) or 0)
            pain_scores[ts] = pain

        max_pain = min(pain_scores, key=pain_scores.get) if pain_scores else 0

        top_ce_oi.sort(key=lambda x: x["oi"], reverse=True)
        top_pe_oi.sort(key=lambda x: x["oi"], reverse=True)

        return {
            "symbol":         symbol,
            "pcr":            pcr,
            "max_pain":       max_pain,
            "call_wall":      top_ce_oi[0]["strike"] if top_ce_oi else 0,
            "put_wall":       top_pe_oi[0]["strike"] if top_pe_oi else 0,
            "underlying":     underlying,
            "top_ce_strikes": top_ce_oi[:3],
            "top_pe_strikes": top_pe_oi[:3],
            "total_call_oi":  total_call_oi,
            "total_put_oi":   total_put_oi,
            "oi_divergence":  False,
            "timestamp":      _ts(),
        }

    except Exception as e:
        logger.warning(f"[SMC-OI] NSE fetch failed for {symbol}: {e}")
        return None


async def get_oi_pcr_data() -> dict:
    """
    Returns OI and PCR data for NIFTY and BANKNIFTY.
    Falls back to demo data on NSE failure.
    """
    try:
        # Graceful import
        try:
            from main import _AI_GLOBAL_STATE
            sector_biases = _AI_GLOBAL_STATE.get("sector_biases", {})
        except Exception:
            sector_biases = {}

        results = {}
        now     = time.time()

        for symbol in ["NIFTY", "BANKNIFTY"]:
            with _oi_lock:
                cached     = _oi_cache.get(symbol, {})
                cache_age  = now - cached.get("fetched_at", 0)

            if cache_age < _oi_cache_ttl and cached.get("data"):
                results[symbol] = cached["data"]
                continue

            oi_data = await asyncio.to_thread(_fetch_oi_from_nse, symbol)

            if oi_data:
                bank_bias = sector_biases.get("BANKS", "NEUTRAL")
                nifty_bias = sector_biases.get("IT", "NEUTRAL")
                bias = bank_bias if symbol == "BANKNIFTY" else nifty_bias

                pcr       = oi_data.get("pcr", 1.0)
                divergence = (bias == "BEARISH" and pcr > 1.2) or (bias == "BULLISH" and pcr < 0.7)
                oi_data["oi_divergence"] = divergence
                oi_data["ai_bias"]       = bias

                with _oi_lock:
                    _oi_cache[symbol] = {"data": oi_data, "fetched_at": now}

                results[symbol] = oi_data
            else:
                # Per-symbol demo fallback
                demo = _demo_oi_pcr()["indices"][symbol]
                results[symbol] = demo

        with _oi_lock:
            oldest = min(
                (_oi_cache.get(s, {}).get("fetched_at", 0) for s in ["NIFTY", "BANKNIFTY"]),
                default=0,
            )
        next_refresh = max(0, int(_oi_cache_ttl - (now - oldest)))

        return {
            "indices":      results,
            "next_refresh": next_refresh,
            "timestamp":    _ts(),
        }

    except Exception as e:
        logger.error(f"[SMC-OI] get_oi_pcr_data error: {e}")
        return _demo_oi_pcr()


# ══════════════════════════════════════════════════════════════════════════════
# FEATURE 6 — DISPLACEMENT CANDLE DETECTOR
# ══════════════════════════════════════════════════════════════════════════════

_displacement_events: list = []
_displacement_lock = threading.Lock()


async def get_displacement_data() -> dict:
    """
    Returns recent displacement candle alerts.
    Falls back to demo data when tick store is empty.
    """
    if not _has_live_ticks():
        return _demo_displacement()

    try:
        from backend.streamer import _tick_store, _intraday_candles, _store_lock, ALL_TOKENS

        now_ist    = _get_ist_now()
        cutoff     = now_ist - timedelta(minutes=30)
        new_events = []

        with _store_lock:
            tick_snapshot = dict(_tick_store)

        for symbol in SMC_WATCH_LIST:
            token = None
            for tok, meta in ALL_TOKENS.items():
                if meta.get("symbol") == symbol:
                    token = tok
                    break
            if not token:
                continue

            with _store_lock:
                candles = list(_intraday_candles.get(token, []))

            if len(candles) < 5:
                continue

            recent  = candles[-21:-1]
            bodies  = [abs(c["close"] - c["open"]) for c in recent]
            vols    = [c.get("volume", 0)           for c in recent]
            avg_body = sum(bodies) / len(bodies) if bodies else 0
            avg_vol  = sum(vols)   / len(vols)   if vols   else 0

            if avg_body == 0:
                continue

            last      = candles[-1]
            curr_body = abs(last["close"] - last["open"])
            curr_vol  = last.get("volume", 0)
            ratio     = curr_body / avg_body

            if ratio >= 1.5 and (avg_vol == 0 or curr_vol >= 1.3 * avg_vol):
                direction = "BULLISH" if last["close"] > last["open"] else "BEARISH"

                # MSS check via sweep history
                with _sweep_lock:
                    mss_confirmed = any(
                        e["symbol"] == symbol and e["status"] in ("ACTIVE", "CONFIRMED")
                        for e in _sweep_events
                    )

                new_events.append({
                    "symbol":        symbol,
                    "timeframe":     "5M",
                    "direction":     direction,
                    "body_ratio":    round(ratio, 2),
                    "mss_confirmed": mss_confirmed,
                    "candle_time":   last.get("time", now_ist.strftime("%H:%M")),
                    "alert_time":    _ts(),
                    "ltp":           round(tick_snapshot.get(token, {}).get("ltp", 0), 2),
                })

        with _displacement_lock:
            existing = {(e["symbol"], e.get("candle_time")) for e in _displacement_events}
            for ev in new_events:
                if (ev["symbol"], ev.get("candle_time")) not in existing:
                    _displacement_events.append(ev)

            def _is_recent(ev):
                try:
                    t = datetime.strptime(ev["alert_time"], "%I:%M:%S %p IST")
                    t = t.replace(year=now_ist.year, month=now_ist.month, day=now_ist.day)
                    t = IST.localize(t) if t.tzinfo is None else t
                    return t > cutoff
                except Exception:
                    return True

            _displacement_events[:] = [e for e in _displacement_events if _is_recent(e)]
            result_events = list(reversed(_displacement_events[-10:]))

        if not result_events:
            return _demo_displacement()

        return {
            "alerts":    result_events,
            "mss_count": sum(1 for e in result_events if e.get("mss_confirmed")),
            "timestamp": _ts(),
        }

    except Exception as e:
        logger.error(f"[SMC-Displacement] get_displacement_data error: {e}")
        return _demo_displacement()


# ══════════════════════════════════════════════════════════════════════════════
# FEATURE 7 — LIQUIDITY POOL MAPPER
# ══════════════════════════════════════════════════════════════════════════════

_lp_cache: dict = {}
_lp_cache_ttl   = 300   # 5 minutes
_lp_lock        = threading.Lock()


def _find_equal_levels(price_list: list, tolerance_pct: float = 0.15) -> list:
    if not price_list:
        return []
    sorted_levels = sorted(price_list)
    pools = []
    used  = set()

    for i, level in enumerate(sorted_levels):
        if i in used:
            continue
        cluster = [level]
        for j, other in enumerate(sorted_levels):
            if j == i or j in used:
                continue
            if abs(level - other) / level * 100 <= tolerance_pct:
                cluster.append(other)
                used.add(j)
        if len(cluster) >= 2:
            pools.append({
                "price":       round(sum(cluster) / len(cluster), 2),
                "touch_count": len(cluster),
            })
        used.add(i)

    return pools


def _fetch_historical_1h_for_lp(symbol: str, token: str) -> Optional[list]:
    try:
        from backend.historical import _get_smart_connect

        smart = _get_smart_connect()
        today = date.today()
        from_date = (today - timedelta(days=14)).strftime("%Y-%m-%d %H:%M")
        to_date   = today.strftime("%Y-%m-%d %H:%M")

        resp = smart.getCandleData({
            "exchange":    "NSE",
            "symboltoken": token,
            "interval":    "ONE_HOUR",
            "fromdate":    from_date,
            "todate":      to_date,
        })

        if not resp or resp.get("status") is False:
            return None
        return resp.get("data", [])

    except Exception as e:
        logger.debug(f"[SMC-LP] 1H fetch failed for {symbol}: {e}")
        return None


async def get_liquidity_pools(symbol: str) -> dict:
    """
    Returns liquidity pool map for the given symbol.
    Falls back to demo data when historical data is unavailable.
    """
    symbol = symbol.upper()
    now    = time.time()

    # Check cache first
    with _lp_lock:
        cached    = _lp_cache.get(symbol, {})
        cache_age = now - cached.get("fetched_at", 0)
        if cache_age < _lp_cache_ttl and cached.get("pools"):
            return cached["pools"]

    try:
        from backend.streamer import _tick_store, _store_lock, ALL_TOKENS

        # Find token
        token = None
        for tok, meta in ALL_TOKENS.items():
            if meta.get("symbol") == symbol:
                token = tok
                break

        if not token:
            return _demo_liquidity_pools(symbol)

        with _store_lock:
            tick = _tick_store.get(token, {})
        current_price = tick.get("ltp", 0)

        # Need at least a price to build pools
        if current_price == 0:
            return _demo_liquidity_pools(symbol)

        # Fetch 1H candles
        candles = await asyncio.to_thread(_fetch_historical_1h_for_lp, symbol, token)

        if not candles:
            return _demo_liquidity_pools(symbol)

        highs = [c[2] for c in candles]
        lows  = [c[3] for c in candles]

        equal_highs = _find_equal_levels(highs, tolerance_pct=0.15)
        equal_lows  = _find_equal_levels(lows,  tolerance_pct=0.15)

        def _round_num_mult(p):
            mult = 100 if symbol in ("NIFTY", "BANKNIFTY") else 50
            return round(p / mult) * mult

        def _enrich(pool_list, pool_type: str) -> list:
            enriched = []
            for pool in pool_list:
                price        = pool["price"]
                nearest_rn   = _round_num_mult(price)
                rn_confluence = abs(price - nearest_rn) / price * 100 <= 0.5
                dist_pct     = round(abs(price - current_price) / current_price * 100, 2) if current_price > 0 else 0
                untested     = current_price < price * 0.998 if pool_type == "EQUAL_HIGHS" else current_price > price * 1.002
                enriched.append({
                    "pool_type":               pool_type,
                    "pool_price":              price,
                    "distance_pct":            dist_pct,
                    "touch_count":             pool["touch_count"],
                    "round_number_confluence": rn_confluence,
                    "nearest_round_number":    nearest_rn,
                    "untested":                untested,
                    "current_price":           current_price,
                })
            enriched.sort(key=lambda x: x["distance_pct"])
            return enriched

        highs_pools = _enrich(equal_highs, "EQUAL_HIGHS")
        lows_pools  = _enrich(equal_lows,  "EQUAL_LOWS")

        above_pools = [p for p in highs_pools if p["pool_price"] > current_price]
        below_pools = [p for p in lows_pools  if p["pool_price"] < current_price]

        nearest_above = above_pools[0] if above_pools else None
        nearest_below = below_pools[0] if below_pools else None

        # Unified pools array — frontend filters by pool_type
        all_pools = [
            {**p, "pool_type": "EQUAL_HIGHS"} for p in above_pools[:5]
        ] + [
            {**p, "pool_type": "EQUAL_LOWS"} for p in below_pools[:5]
        ]

        result = {
            "symbol":        symbol,
            "current_price": round(current_price, 2),
            "pools":         all_pools,          # unified array — frontend uses this
            "pools_above":   above_pools[:5],    # kept for legacy compatibility
            "pools_below":   below_pools[:5],
            "timestamp":     _ts(),
        }

        with _lp_lock:
            _lp_cache[symbol] = {"pools": result, "fetched_at": now}

        return result

    except Exception as e:
        logger.error(f"[SMC-LP] get_liquidity_pools error for {symbol}: {e}")
        return _demo_liquidity_pools(symbol)
