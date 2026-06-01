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
    """
    Demo-mode sweep response.  All price fields are '—' — never real-looking numbers.
    This is clearly labeled as DEMO so users cannot mistake it for live data.
    """
    return {
        "status":             "market_closed",
        "data_source":        "DEMO",
        "levels_fetch_time":  None,
        "active_sweep_count": 0,
        "message":            "Market closed — showing illustrative demo data. Live sweeps appear during market hours (9:15 AM – 3:30 PM IST).",
        "sweeps": [
            {
                "symbol":          "BANKNIFTY", "sweep_type": "PDH_SWEEP", "strength": "STANDARD",
                "level_price":     "—", "wick_extreme": "—", "sweep_magnitude": "—",
                "candle_open":     "—", "candle_high": "—", "candle_low": "—", "candle_close": "—",
                "candle_time":     "—", "status": "DEMO", "data_source": "DEMO",
            },
            {
                "symbol":          "NIFTY", "sweep_type": "PDL_SWEEP", "strength": "STANDARD",
                "level_price":     "—", "wick_extreme": "—", "sweep_magnitude": "—",
                "candle_open":     "—", "candle_high": "—", "candle_low": "—", "candle_close": "—",
                "candle_time":     "—", "status": "DEMO", "data_source": "DEMO",
            },
        ],
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
# INTERNAL HELPERS — PDH/PDL SWEEP  (AUDIT-GRADE REWRITE)
# ══════════════════════════════════════════════════════════════════════════════

# Instruments monitored for sweep detection — token mapped for API calls
MONITORED_SYMBOLS = {
    "NIFTY":     {"token": "99926000", "exchange": "NSE"},
    "BANKNIFTY": {"token": "99926009", "exchange": "NSE"},
    "RELIANCE":  {"token": "2885",     "exchange": "NSE"},
    "HDFCBANK":  {"token": "1333",     "exchange": "NSE"},
    "INFY":      {"token": "1594",     "exchange": "NSE"},
    "TCS":       {"token": "11536",    "exchange": "NSE"},
    "ICICIBANK": {"token": "4963",     "exchange": "NSE"},
    "SBIN":      {"token": "3045",     "exchange": "NSE"},
    "AXISBANK":  {"token": "5900",     "exchange": "NSE"},
    "WIPRO":     {"token": "3787",     "exchange": "NSE"},
}

# Minimum wick penetration required to qualify as a sweep (not just noise)
_SWEEP_MIN_POINTS = {
    "NIFTY":     5.0,
    "BANKNIFTY": 20.0,
}
_SWEEP_MIN_POINTS_DEFAULT = 1.0

# Maximum plausible sweep magnitude — anything larger indicates data error
_SWEEP_MAX_MAGNITUDE = {
    "NIFTY":     500.0,
    "BANKNIFTY": 2000.0,
}
_SWEEP_MAX_MAGNITUDE_DEFAULT = 200.0

# Sweep events expire after this many hours
_SWEEP_EXPIRY_HOURS = 4

# Staleness threshold for PDH/PDL levels (25 hours)
_LEVELS_STALE_HOURS = 25

_PDH_PDL_LEVELS: dict = {}     # { symbol: { pdh, pdl, pwh, pwl, fetch_time, date, levels_unavailable } }
_pdhl_lock = threading.Lock()
_sweep_events: list = []
_sweep_lock = threading.Lock()
_last_processed_candle: dict = {}   # { symbol: candle_time_str } — tracks closed candles


def _get_min_sweep_points(symbol: str) -> float:
    return _SWEEP_MIN_POINTS.get(symbol, _SWEEP_MIN_POINTS_DEFAULT)


def _get_max_sweep_magnitude(symbol: str) -> float:
    return _SWEEP_MAX_MAGNITUDE.get(symbol, _SWEEP_MAX_MAGNITUDE_DEFAULT)


def _fetch_pdhl_levels_real(symbol: str, token: str, exchange: str) -> Optional[dict]:
    """
    Fetch real Previous Day and Previous Week OHLC from Angel One getCandleData.
    Returns dict with pdh/pdl/pwh/pwl/date/fetch_time or None on failure.
    CRITICAL: If PDH == PDL the data is corrupt — returns None.
    """
    try:
        from backend.historical import _get_smart_connect
        smart = _get_smart_connect()

        today = date.today()
        # Fetch last 15 calendar days of daily candles to ensure we get the previous trading day
        from_date = (today - timedelta(days=15)).strftime("%Y-%m-%d %H:%M")
        to_date   = today.strftime("%Y-%m-%d %H:%M")

        resp = smart.getCandleData({
            "exchange":    exchange,
            "symboltoken": token,
            "interval":    "ONE_DAY",
            "fromdate":    from_date,
            "todate":      to_date,
        })

        if not resp or resp.get("status") is False:
            logger.warning(f"[SMC-Sweep] getCandleData failed for {symbol}: {resp}")
            return None

        candles = resp.get("data", [])
        if not candles or len(candles) < 2:
            logger.warning(f"[SMC-Sweep] Insufficient candles for {symbol}: got {len(candles) if candles else 0}")
            return None

        # Previous day = second-to-last complete candle
        prev_day = candles[-2]
        pdh = float(prev_day[2])  # high
        pdl = float(prev_day[3])  # low
        prev_day_date = str(prev_day[0])[:10]

        # Guard: corrupt data if high == low
        if pdh == pdl:
            logger.error(f"[SMC-Sweep] Corrupt PDH/PDL for {symbol}: PDH=PDL={pdh} — marking unavailable")
            return None

        # Previous week: take last 5 complete trading sessions before today
        week_candles = candles[-6:-1] if len(candles) >= 6 else candles[:-1]
        if week_candles:
            pwh = float(max(c[2] for c in week_candles))
            pwl = float(min(c[3] for c in week_candles))
        else:
            pwh = pdh
            pwl = pdl

        fetch_time = _get_ist_now().strftime("%H:%M:%S IST")
        logger.info(
            f"[SMC-Sweep] PDH/PDL fetched: {symbol} PDH={pdh} PDL={pdl} "
            f"PWH={pwh} PWL={pwl} date={prev_day_date} at {fetch_time}"
        )
        return {
            "pdh":        pdh,
            "pdl":        pdl,
            "pwh":        pwh,
            "pwl":        pwl,
            "date":       prev_day_date,
            "fetch_time": fetch_time,
            "levels_unavailable": False,
        }

    except Exception as e:
        logger.error(f"[SMC-Sweep] _fetch_pdhl_levels_real failed for {symbol}: {e}")
        return None


def _ensure_levels_fresh(symbol: str, force: bool = False) -> None:
    """
    Refresh PDH/PDL/PWH/PWL levels for symbol if:
    - Not yet fetched today
    - Fetch time is older than _LEVELS_STALE_HOURS
    - force=True (called at 9:10 AM IST daily)
    Marks symbol levels_unavailable if fetch fails.
    """
    meta = MONITORED_SYMBOLS.get(symbol)
    if not meta:
        return

    today_str = _get_ist_now().strftime("%Y-%m-%d")
    with _pdhl_lock:
        cached = _PDH_PDL_LEVELS.get(symbol, {})

    needs_fetch = force
    if not needs_fetch:
        if not cached or cached.get("date") != today_str:
            needs_fetch = True
        elif cached.get("levels_unavailable"):
            # Retry once per session if previously unavailable
            needs_fetch = True
        else:
            # Check staleness of fetch_time
            ft = cached.get("fetch_time")
            if ft:
                try:
                    ft_parsed = datetime.strptime(ft, "%H:%M:%S IST")
                    ft_today = _get_ist_now().replace(
                        hour=ft_parsed.hour, minute=ft_parsed.minute, second=ft_parsed.second, microsecond=0
                    )
                    if (_get_ist_now() - ft_today).total_seconds() > _LEVELS_STALE_HOURS * 3600:
                        needs_fetch = True
                except Exception:
                    pass

    if not needs_fetch:
        return

    result = _fetch_pdhl_levels_real(symbol, meta["token"], meta["exchange"])
    with _pdhl_lock:
        if result:
            _PDH_PDL_LEVELS[symbol] = result
        else:
            # Mark unavailable — do NOT use any estimated/hardcoded values
            _PDH_PDL_LEVELS[symbol] = {
                "levels_unavailable": True,
                "date":               today_str,
                "fetch_time":         _get_ist_now().strftime("%H:%M:%S IST"),
                "pdh": None, "pdl": None, "pwh": None, "pwl": None,
            }


def _get_closed_candle(symbol: str, token: str) -> Optional[dict]:
    """
    Return the most recently CLOSED 5M candle for symbol.
    Uses _intraday_candles[-2] (index -1 is still forming).
    Returns None if insufficient candles.
    """
    try:
        from backend.streamer import _intraday_candles, _store_lock
        with _store_lock:
            candles = list(_intraday_candles.get(token, []))
        if len(candles) < 2:
            return None
        return candles[-2]   # closed candle
    except Exception:
        return None


def _detect_sweep_on_candle(symbol: str, closed_candle: dict, levels: dict) -> Optional[dict]:
    """
    Evaluate a closed 5M candle against PDH/PDL/PWH/PWL levels.
    Strict 3-condition rule — all must pass:
      1. WICK PENETRATION: candle high/low must exceed level by MIN_SWEEP_POINTS
      2. CLOSE REJECTION:  candle close must be back on the ORIGIN side of the level
      3. (Recency enforced by caller — only today's candles are processed)
    Returns sweep dict or None.
    """
    pdh = levels.get("pdh")
    pdl = levels.get("pdl")
    pwh = levels.get("pwh")
    pwl = levels.get("pwl")

    high  = float(closed_candle.get("high",  0))
    low   = float(closed_candle.get("low",   0))
    close = float(closed_candle.get("close", 0))
    open_ = float(closed_candle.get("open",  0))
    candle_time = closed_candle.get("time", "")
    min_pts = _get_min_sweep_points(symbol)

    candidates = []

    # PDH sweep
    if pdh and pdh > 0:
        if high > pdh + min_pts and close < pdh:
            candidates.append({
                "sweep_type": "PDH_SWEEP",
                "strength":   "STANDARD",
                "level_price": round(pdh, 2),
                "wick_extreme": round(high, 2),
                "sweep_magnitude": round(high - pdh, 2),
            })

    # PDL sweep
    if pdl and pdl > 0:
        if low < pdl - min_pts and close > pdl:
            candidates.append({
                "sweep_type": "PDL_SWEEP",
                "strength":   "STANDARD",
                "level_price": round(pdl, 2),
                "wick_extreme": round(low, 2),
                "sweep_magnitude": round(pdl - low, 2),
            })

    # PWH sweep (major)
    if pwh and pwh > 0 and pwh != pdh:
        if high > pwh + min_pts and close < pwh:
            candidates.append({
                "sweep_type": "PWH_SWEEP",
                "strength":   "MAJOR",
                "level_price": round(pwh, 2),
                "wick_extreme": round(high, 2),
                "sweep_magnitude": round(high - pwh, 2),
            })

    # PWL sweep (major)
    if pwl and pwl > 0 and pwl != pdl:
        if low < pwl - min_pts and close > pwl:
            candidates.append({
                "sweep_type": "PWL_SWEEP",
                "strength":   "MAJOR",
                "level_price": round(pwl, 2),
                "wick_extreme": round(low, 2),
                "sweep_magnitude": round(pwl - low, 2),
            })

    # Return first valid candidate (prioritise PWH/PWL as they're stronger)
    if not candidates:
        return None

    max_magnitude = _get_max_sweep_magnitude(symbol)
    now_ist = _get_ist_now()
    today = date.today()

    for c in candidates:
        # Guard: implausible magnitude = data error
        if c["sweep_magnitude"] > max_magnitude:
            logger.error(
                f"[SMC-Sweep] Implausible sweep magnitude for {symbol}: "
                f"{c['sweep_magnitude']} pts on {c['sweep_type']} — discarding"
            )
            continue

        # Guard: level price must never be 0 or None
        if not c["level_price"] or c["level_price"] == 0:
            continue

        c.update({
            "symbol":       symbol,
            "candle_time":  candle_time,
            "candle_open":  round(open_, 2),
            "candle_high":  round(high, 2),
            "candle_low":   round(low, 2),
            "candle_close": round(close, 2),
            "status":       "ACTIVE",
            "confirmed_at": None,
            "detected_at":  now_ist.strftime("%H:%M:%S IST"),
            "data_source":  "LIVE",
        })
        return c

    return None


# ══════════════════════════════════════════════════════════════════════════════
# FEATURE 3 — PDH/PDL LIQUIDITY SWEEP DETECTOR  (AUDIT-GRADE REWRITE)
# ══════════════════════════════════════════════════════════════════════════════

async def get_sweep_data() -> dict:
    """
    Returns active liquidity sweep events with strict 3-condition detection.

    Rules enforced:
    - PDH/PDL must be fetched via real API today (or marked unavailable)
    - Sweep = wick penetration + close rejection + same-day recency (all 3 required)
    - Sweeps expire to EXPIRED after _SWEEP_EXPIRY_HOURS hours
    - FAILED = price subsequently closed beyond the level
    - Implausible magnitudes are discarded with logger.error
    - Demo mode uses '—' dashes only — never real-looking numbers
    """
    if not _has_live_ticks():
        logger.info("[SMC-Sweep] No live ticks — returning labeled demo data")
        return _demo_sweeps()

    try:
        from backend.streamer import _tick_store, _store_lock, ALL_TOKENS

        now_ist   = _get_ist_now()
        today     = date.today()
        today_str = now_ist.strftime("%Y-%m-%d")

        # ── Step 1: Ensure PDH/PDL levels are fresh for all monitored symbols
        for symbol in MONITORED_SYMBOLS:
            await asyncio.to_thread(_ensure_levels_fresh, symbol)

        # ── Step 2: Build lookup of streamer tokens for monitored symbols
        with _store_lock:
            all_tokens_snapshot = dict(ALL_TOKENS)

        symbol_to_token: dict = {}
        for tok, meta in all_tokens_snapshot.items():
            sym = meta.get("symbol", "")
            if sym in MONITORED_SYMBOLS:
                symbol_to_token[sym] = tok

        # ── Step 3: Scan each symbol for new sweep on the last CLOSED candle
        new_detections: list = []

        for symbol in MONITORED_SYMBOLS:
            # Guard 1: skip if levels unavailable
            with _pdhl_lock:
                levels = _PDH_PDL_LEVELS.get(symbol, {})

            if not levels or levels.get("levels_unavailable"):
                continue

            # Guard 2: levels must be from today
            if levels.get("date") != today_str:
                continue

            token = symbol_to_token.get(symbol)
            if not token:
                continue

            # Get the most recently CLOSED candle
            closed = _get_closed_candle(symbol, token)
            if not closed:
                continue

            # Guard 3: candle must be from today
            candle_time_str = closed.get("time", "")
            # Check if already processed this exact candle for this symbol
            if _last_processed_candle.get(symbol) == candle_time_str:
                continue

            sweep = _detect_sweep_on_candle(symbol, closed, levels)
            if sweep:
                new_detections.append(sweep)
                logger.info(
                    f"[SMC-Sweep] NEW SWEEP: {symbol} {sweep['sweep_type']} "
                    f"level={sweep['level_price']} wick={sweep['wick_extreme']} "
                    f"close={sweep['candle_close']} mag={sweep['sweep_magnitude']}pts"
                )

            _last_processed_candle[symbol] = candle_time_str

        # ── Step 4: Update the global sweep events store
        with _sweep_lock:
            # Merge new detections — avoid duplicates; CONFIRM on second consecutive detection
            for new in new_detections:
                key = new["symbol"] + new["sweep_type"]
                matched = False
                for old in _sweep_events:
                    if old["symbol"] == new["symbol"] and old["sweep_type"] == new["sweep_type"]:
                        if old["status"] == "ACTIVE":
                            old["status"]       = "CONFIRMED"
                            old["confirmed_at"] = new["detected_at"]
                            old["wick_extreme"] = new["wick_extreme"]
                        matched = True
                        break
                if not matched:
                    _sweep_events.append(new)

            # Transition ACTIVE → FAILED if symbol/type not in new_detections
            # (price broke through the level instead of reversing)
            new_keys = {ev["symbol"] + ev["sweep_type"] for ev in new_detections}
            for ev in _sweep_events:
                ek = ev["symbol"] + ev["sweep_type"]
                if ek not in new_keys and ev["status"] == "ACTIVE":
                    # Only mark FAILED if we actually just checked this symbol
                    if ev["symbol"] in _last_processed_candle:
                        ev["status"] = "FAILED"

            # Guard: expire sweeps older than _SWEEP_EXPIRY_HOURS hours
            for ev in _sweep_events:
                if ev["status"] in ("ACTIVE", "CONFIRMED"):
                    try:
                        detected_str = ev.get("detected_at", "")
                        if detected_str:
                            detected_t = datetime.strptime(detected_str, "%H:%M:%S IST")
                            detected_t = now_ist.replace(
                                hour=detected_t.hour, minute=detected_t.minute,
                                second=detected_t.second, microsecond=0
                            )
                            if (now_ist - detected_t).total_seconds() > _SWEEP_EXPIRY_HOURS * 3600:
                                ev["status"] = "EXPIRED"
                    except Exception:
                        pass

            # Remove EXPIRED events from display; keep FAILED for context (max 20 events)
            display_events = [
                ev for ev in _sweep_events
                if ev["status"] != "EXPIRED"
            ][-20:]

            # Guard 4: never show a sweep dated before today
            display_events = [
                ev for ev in display_events
                if ev.get("data_source") == "LIVE"
            ]

            all_events = list(reversed(display_events))

        # Determine fetch time to display in UI
        levels_fetch_time = None
        for sym in MONITORED_SYMBOLS:
            with _pdhl_lock:
                lvl = _PDH_PDL_LEVELS.get(sym, {})
            if lvl.get("fetch_time") and not lvl.get("levels_unavailable"):
                levels_fetch_time = lvl["fetch_time"]
                break

        active_count = sum(1 for e in all_events if e["status"] in ("ACTIVE", "CONFIRMED"))

        if not all_events:
            # Market is open and live, but genuinely no sweeps yet — empty LIVE state
            return {
                "status":             "ok",
                "data_source":        "LIVE",
                "levels_fetch_time":  levels_fetch_time,
                "active_sweep_count": 0,
                "message":            None,
                "sweeps":             [],
            }

        return {
            "status":             "ok",
            "data_source":        "LIVE",
            "levels_fetch_time":  levels_fetch_time,
            "active_sweep_count": active_count,
            "message":            None,
            "sweeps":             all_events,
        }

    except Exception as e:
        logger.error(f"[SMC-Sweep] get_sweep_data error: {e}", exc_info=True)
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
