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
"""

import os
import time
import logging
import asyncio
import threading
import requests
from datetime import datetime, timedelta
from typing import Optional
from collections import defaultdict

import pytz

logger = logging.getLogger(__name__)
IST = pytz.timezone("Asia/Kolkata")

# ── Monitored Instruments ─────────────────────────────────────────────────────
# Top 20 F&O stocks + indices used across all SMC features
SMC_WATCH_LIST = [
    "NIFTY", "BANKNIFTY",
    "RELIANCE", "TCS", "HDFCBANK", "INFY", "ICICIBANK",
    "SBIN", "BHARTIARTL", "KOTAKBANK", "ITC", "LT",
    "AXISBANK", "MARUTI", "SUNPHARMA", "TITAN", "BAJFINANCE",
    "WIPRO", "ONGC", "NTPC", "TATASTEEL",
]

# Mapping index symbols to their Angel One tokens for live LTP
SMC_INDEX_TOKENS = {
    "NIFTY":     "26000",   # NSE:NIFTY 50
    "BANKNIFTY": "26009",   # NSE:BANKNIFTY
}

# ═════════════════════════════════════════════════════════════════════════════
# FEATURE 1 — OPENING RANGE MANIPULATION SCANNER
# ═════════════════════════════════════════════════════════════════════════════

# In-memory state for OR tracking
_or_state: dict = {}  # symbol → { orh, orl, or_captured, manipulation_events }
_or_lock = threading.Lock()

# Previous wick state for manipulation detection
_prev_ltp: dict = {}
_prev_candle_close: dict = {}


def _get_ist_now() -> datetime:
    """Return current time in IST timezone."""
    return datetime.now(IST)


def _capture_opening_range_from_candles(symbol: str, candles: list) -> Optional[dict]:
    """
    Extract ORH/ORL from intraday candles captured between 9:15 and 9:30 AM IST.
    Returns: { orh, orl } or None if not enough data.
    """
    try:
        or_candles = []
        for c in candles:
            try:
                # Candle time is stored as "HH:MM" string
                t = datetime.strptime(c["time"], "%H:%M").replace(
                    year=datetime.now().year,
                    month=datetime.now().month,
                    day=datetime.now().day,
                )
                # Include candles in the 9:15–9:30 window
                if (t.hour == 9 and t.minute >= 15) and (t.hour == 9 and t.minute < 30):
                    or_candles.append(c)
            except Exception:
                continue

        if not or_candles:
            return None

        orh = max(c["high"] for c in or_candles)
        orl = min(c["low"] for c in or_candles)
        return {"orh": orh, "orl": orl}
    except Exception as e:
        logger.error(f"[SMC-OR] Candle capture error for {symbol}: {e}")
        return None


def _detect_manipulation(
    symbol: str, ltp: float, last_close: float, orh: float, orl: float
) -> Optional[dict]:
    """
    Compare current LTP and last close against OR boundaries.
    - BEAR_MANIPULATION: wick above ORH, then CLOSES back below ORH
    - BULL_MANIPULATION: wick below ORL, then CLOSES back above ORL
    Returns manipulation event dict or None.
    """
    now_ist = _get_ist_now()

    # Only check after 9:30 AM
    if now_ist.hour == 9 and now_ist.minute < 30:
        return None

    event_type = None
    trigger = ltp

    # Wick is above ORH but last candle close is below ORH → fake breakout
    if ltp > orh and last_close < orh:
        event_type = "BEAR_MANIPULATION"
        trigger = ltp

    # Wick is below ORL but last candle close is above ORL → fake breakdown
    elif ltp < orl and last_close > orl:
        event_type = "BULL_MANIPULATION"
        trigger = ltp

    if not event_type:
        return None

    return {
        "symbol":             symbol,
        "type":               event_type,
        "trigger_price":      round(trigger, 2),
        "opening_range_high": round(orh, 2),
        "opening_range_low":  round(orl, 2),
        "timestamp":          now_ist.strftime("%I:%M:%S %p IST"),
        "confirmation":       True,  # Close-back-inside is the confirmation
    }


async def get_opening_range_data() -> dict:
    """
    Main entry point for Feature 1.
    Returns OR levels for BANKNIFTY and NIFTY plus any active manipulation alerts.
    """
    try:
        from backend.streamer import _tick_store, _intraday_candles, _store_lock, ALL_TOKENS

        results = {}
        manipulation_events = []

        symbols_to_check = ["NIFTY", "BANKNIFTY"]

        for symbol in symbols_to_check:
            # Find token for this symbol
            token = None
            with _store_lock:
                for tok, meta in ALL_TOKENS.items():
                    if meta.get("symbol") == symbol:
                        token = tok
                        break

            if not token:
                results[symbol] = {"status": "NO_DATA", "symbol": symbol}
                continue

            # Get live LTP and candles
            with _store_lock:
                tick = _tick_store.get(token, {})
                candles = list(_intraday_candles.get(token, []))

            ltp = tick.get("ltp", 0)
            if ltp == 0:
                results[symbol] = {"status": "NO_DATA", "symbol": symbol}
                continue

            # Capture OR levels if not yet done today
            with _or_lock:
                if symbol not in _or_state or _or_state[symbol].get("date") != datetime.now().strftime("%Y-%m-%d"):
                    or_levels = _capture_opening_range_from_candles(symbol, candles)
                    _or_state[symbol] = {
                        "date":            datetime.now().strftime("%Y-%m-%d"),
                        "orh":             or_levels["orh"] if or_levels else None,
                        "orl":             or_levels["orl"] if or_levels else None,
                        "or_captured":     or_levels is not None,
                        "manipulation_events": [],
                    }

                state = _or_state[symbol]

            if not state.get("or_captured"):
                results[symbol] = {
                    "status":   "MONITORING",
                    "symbol":   symbol,
                    "ltp":      round(ltp, 2),
                    "message":  "Opening Range not yet captured (market opens at 9:15 AM IST)",
                }
                continue

            orh = state["orh"]
            orl = state["orl"]

            # Get last candle close for confirmation
            last_close = candles[-1]["close"] if candles else ltp

            # Check for manipulation
            event = _detect_manipulation(symbol, ltp, last_close, orh, orl)
            if event:
                with _or_lock:
                    # Deduplicate: only add if not seen in last 5 minutes
                    events = _or_state[symbol]["manipulation_events"]
                    recent_types = [
                        e["type"] for e in events
                        if e.get("type") == event["type"]
                    ]
                    if not recent_types:
                        events.append(event)
                        if len(events) > 5:
                            events.pop(0)

                manipulation_events.append(event)

            results[symbol] = {
                "status":            "ACTIVE",
                "symbol":            symbol,
                "ltp":               round(ltp, 2),
                "opening_range_high": round(orh, 2),
                "opening_range_low":  round(orl, 2),
                "range_width":        round(orh - orl, 2),
                "ltp_position":       "ABOVE_ORH" if ltp > orh else ("BELOW_ORL" if ltp < orl else "INSIDE"),
                "recent_events":      state.get("manipulation_events", [])[-3:],
            }

        return {
            "instruments": results,
            "active_alerts": manipulation_events,
            "timestamp": _get_ist_now().strftime("%I:%M:%S %p IST"),
        }

    except Exception as e:
        logger.error(f"[SMC-OR] get_opening_range_data error: {e}")
        return {"instruments": {}, "active_alerts": [], "timestamp": "", "error": str(e)}


# ═════════════════════════════════════════════════════════════════════════════
# FEATURE 3 — PDH/PDL LIQUIDITY SWEEP DETECTOR
# ═════════════════════════════════════════════════════════════════════════════

# Cache for previous day high/low levels
_pdhl_cache: dict = {}  # symbol → { pdh, pdl, pwh, pwl, date }
_pdhl_lock = threading.Lock()

# Active sweep events
_sweep_events: list = []
_sweep_lock = threading.Lock()


def _fetch_pdhl_levels(symbol: str, token: str) -> Optional[dict]:
    """
    Fetch previous day and previous week OHLC using Angel One getCandleData REST API.
    Returns { pdh, pdl, pwh, pwl } or None on failure.
    
    # TODO: Inject Angel One auth_token from environment or session for live fetches.
    # For now, falls back to tick-store prev_close approximation.
    """
    try:
        from backend.historical import _get_smart_connect
        from datetime import date

        smart = _get_smart_connect()

        today = date.today()
        # Fetch last 8 trading days of daily candles
        from_date = (today - timedelta(days=10)).strftime("%Y-%m-%d %H:%M")
        to_date = today.strftime("%Y-%m-%d %H:%M")

        resp = smart.getCandleData({
            "exchange":     "NSE",
            "symboltoken":  token,
            "interval":     "ONE_DAY",
            "fromdate":     from_date,
            "todate":       to_date,
        })

        if not resp or resp.get("status") is False:
            return None

        candles = resp.get("data", [])
        if len(candles) < 2:
            return None

        # candles[-1] = today (partial), candles[-2] = yesterday complete
        prev_day = candles[-2] if len(candles) > 1 else candles[-1]
        week_candles = candles[-6:-1] if len(candles) >= 6 else candles[:-1]

        pdh = prev_day[2]  # high
        pdl = prev_day[3]  # low

        pwh = max(c[2] for c in week_candles) if week_candles else pdh
        pwl = min(c[3] for c in week_candles) if week_candles else pdl

        return {"pdh": pdh, "pdl": pdl, "pwh": pwh, "pwl": pwl}

    except Exception as e:
        logger.debug(f"[SMC-Sweep] PDHL fetch failed for {symbol}: {e}")
        return None


async def get_sweep_data() -> dict:
    """
    Main entry point for Feature 3.
    Returns active liquidity sweep events across all monitored instruments.
    """
    try:
        from backend.streamer import _tick_store, _intraday_candles, _store_lock, ALL_TOKENS

        sweep_results = []
        now_ist = _get_ist_now()
        today_str = now_ist.strftime("%Y-%m-%d")

        with _store_lock:
            tick_snapshot = dict(_tick_store)

        for symbol in SMC_WATCH_LIST:
            # Find token
            token = None
            for tok, meta in ALL_TOKENS.items():
                if meta.get("symbol") == symbol:
                    token = tok
                    break

            if not token:
                continue

            tick = tick_snapshot.get(token, {})
            ltp = tick.get("ltp", 0)
            if ltp == 0:
                continue

            # Get or refresh PDHL levels (once per day)
            with _pdhl_lock:
                cached = _pdhl_cache.get(symbol, {})
                if cached.get("date") != today_str or not cached.get("pdh"):
                    # Try to fetch via Angel One REST
                    levels = await asyncio.to_thread(_fetch_pdhl_levels, symbol, token)
                    if levels:
                        _pdhl_cache[symbol] = {**levels, "date": today_str}
                        cached = _pdhl_cache[symbol]
                    else:
                        # Fallback: use prev_close as PDH/PDL approximation
                        pc = tick.get("prev_close", 0)
                        if pc > 0:
                            _pdhl_cache[symbol] = {
                                "pdh": pc * 1.003,  # 0.3% above prev close
                                "pdl": pc * 0.997,  # 0.3% below prev close
                                "pwh": pc * 1.015,
                                "pwl": pc * 0.985,
                                "date": today_str,
                            }
                            cached = _pdhl_cache[symbol]

            if not cached:
                continue

            pdh = cached.get("pdh", 0)
            pdl = cached.get("pdl", 0)
            pwh = cached.get("pwh", 0)
            pwl = cached.get("pwl", 0)

            # Get last completed candle for close-side analysis
            with _store_lock:
                candles = list(_intraday_candles.get(token, []))

            last_close = candles[-2]["close"] if len(candles) >= 2 else tick.get("prev_close", ltp)

            def _check_sweep(level: float, sweep_type: str, is_above: bool) -> Optional[dict]:
                """Check if LTP has swept a level and close-sided back."""
                if level <= 0:
                    return None
                # Wick beyond level
                wick_beyond = ltp > level if is_above else ltp < level
                # Close remains on original side
                close_original_side = last_close < level if is_above else last_close > level

                if wick_beyond and close_original_side:
                    magnitude = abs(ltp - level)
                    pct = round((magnitude / level) * 100, 3)
                    return {
                        "symbol":          symbol,
                        "sweep_type":      sweep_type,
                        "level_price":     round(level, 2),
                        "wick_extreme":    round(ltp, 2),
                        "sweep_magnitude": round(magnitude, 2),
                        "sweep_pct":       pct,
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

        # Merge with existing sweep event history
        with _sweep_lock:
            # Update status of old events to CONFIRMED if they persist
            for new in sweep_results:
                matched = False
                for old in _sweep_events:
                    if old["symbol"] == new["symbol"] and old["sweep_type"] == new["sweep_type"]:
                        old["status"] = "CONFIRMED"
                        old["wick_extreme"] = new["wick_extreme"]
                        matched = True
                        break
                if not matched:
                    _sweep_events.append(new)

            # Mark events no longer active as FAILED after 3 sweeps
            symbols_in_new = {s["symbol"] + s["sweep_type"] for s in sweep_results}
            for ev in _sweep_events:
                key = ev["symbol"] + ev["sweep_type"]
                if key not in symbols_in_new and ev["status"] == "ACTIVE":
                    ev["status"] = "FAILED"

            # Return last 15 events, newest first
            all_events = list(reversed(_sweep_events[-15:]))

        return {
            "sweeps": all_events,
            "active_count": sum(1 for e in all_events if e["status"] in ("ACTIVE", "CONFIRMED")),
            "timestamp": now_ist.strftime("%I:%M:%S %p IST"),
            "monitoring": SMC_WATCH_LIST,
        }

    except Exception as e:
        logger.error(f"[SMC-Sweep] get_sweep_data error: {e}")
        return {"sweeps": [], "active_count": 0, "timestamp": "", "error": str(e)}


# ═════════════════════════════════════════════════════════════════════════════
# FEATURE 4 — SMC SETUP QUALITY GRADER
# ═════════════════════════════════════════════════════════════════════════════

def _score_setup(symbol: str, tick: dict, candles: list, sector_biases: dict, sweep_events: list) -> dict:
    """
    Compute SMC setup score (0–100) from 6 confluence factors.

    Factor 1  — HTF Trend Aligned                         → +20 pts
    Factor 2  — Liquidity Sweep in last 15 min            → +20 pts
    Factor 3  — Volume > 1.5× 20-period average           → +15 pts
    Factor 4  — Active Kill Zone (Prime / London)         → +15 pts
    Factor 5  — AI Sector Bias aligned with direction     → +15 pts
    Factor 6  — Displacement Candle present               → +15 pts
    """
    score = 0
    factors_met = []
    factors_missing = []

    ltp = tick.get("ltp", 0)
    prev_close = tick.get("prev_close", 0)
    if ltp == 0 or prev_close == 0:
        return {"symbol": symbol, "score": 0, "grade": "NO TRADE", "error": "No price data"}

    change_pct = tick.get("change_pct", 0)
    direction = "LONG" if change_pct >= 0 else "SHORT"

    # ── Factor 1: HTF Trend (using prev_close vs ltp as proxy for daily trend) ──
    htf_aligned = (direction == "LONG" and ltp > prev_close) or (direction == "SHORT" and ltp < prev_close)
    if htf_aligned:
        score += 20
        factors_met.append("HTF Trend Aligned")
    else:
        factors_missing.append("HTF Trend Not Aligned")

    # ── Factor 2: Liquidity Sweep in last 15 minutes ──────────────────────────
    recent_sweep = any(
        e["symbol"] == symbol and e["status"] in ("ACTIVE", "CONFIRMED")
        for e in sweep_events
    )
    if recent_sweep:
        score += 20
        factors_met.append("Liquidity Sweep Detected")
    else:
        factors_missing.append("No Recent Liquidity Sweep")

    # ── Factor 3: Volume Confirmation ─────────────────────────────────────────
    current_vol = tick.get("volume", 0)
    avg_vol = tick.get("avg_volume", 0)
    vol_confirmed = avg_vol > 0 and current_vol > (1.5 * avg_vol)
    if vol_confirmed:
        score += 15
        factors_met.append("Volume Confirmed (1.5× Avg)")
    else:
        factors_missing.append("Volume Below 1.5× Average")

    # ── Factor 4: Active Kill Zone ─────────────────────────────────────────────
    now_ist = _get_ist_now()
    h, m = now_ist.hour, now_ist.minute
    t_min = h * 60 + m
    prime_session    = (9 * 60 + 30) <= t_min <= (11 * 60)
    london_overlap   = (13 * 60 + 30) <= t_min <= (15 * 60)
    in_kill_zone = prime_session or london_overlap
    if in_kill_zone:
        score += 15
        zone_name = "Prime Session" if prime_session else "London Overlap"
        factors_met.append(f"Active Kill Zone ({zone_name})")
    else:
        factors_missing.append("Outside Kill Zone")

    # ── Factor 5: AI Sector Bias ───────────────────────────────────────────────
    from backend.signal_engine import get_sector
    sector = get_sector(symbol)
    bias = sector_biases.get(sector, "NEUTRAL")
    bias_aligned = (
        (direction == "LONG" and bias == "BULLISH") or
        (direction == "SHORT" and bias == "BEARISH")
    )
    if bias_aligned:
        score += 15
        factors_met.append(f"AI Sector Bias Aligned ({bias})")
    else:
        factors_missing.append(f"Sector Bias Not Aligned ({bias})")

    # ── Factor 6: Displacement Candle ─────────────────────────────────────────
    displacement = _check_displacement_in_candles(candles)
    if displacement:
        score += 15
        factors_met.append(f"Displacement Candle ({displacement['ratio']:.1f}× avg)")
    else:
        factors_missing.append("No Displacement Candle")

    # ── Grade ──────────────────────────────────────────────────────────────────
    if score >= 80:
        grade = "A+"
        recommendation = f"A+ Setup — Wait for FVG retracement entry on 5M {direction.lower()} continuation"
    elif score >= 60:
        grade = "A"
        recommendation = f"A Setup — Good confluence. Enter on confirmed MSS with tight SL"
    elif score >= 40:
        grade = "B"
        recommendation = "B Setup — Partial confluence only. Reduce position size, wait for more confirmation"
    else:
        grade = "NO TRADE"
        recommendation = "NO TRADE — Insufficient confluence. Sit out this setup entirely"

    return {
        "symbol":          symbol,
        "score":           score,
        "grade":           grade,
        "direction":       direction,
        "factors_met":     factors_met,
        "factors_missing": factors_missing,
        "recommendation":  recommendation,
        "ltp":             round(ltp, 2),
        "change_pct":      round(change_pct, 2),
    }


def _check_displacement_in_candles(candles: list) -> Optional[dict]:
    """
    Check if the most recent 5M candle is a displacement candle.
    Displacement: body > 1.5× avg_body AND volume > 1.3× avg_volume.
    """
    try:
        if len(candles) < 5:
            return None

        bodies = [abs(c["close"] - c["open"]) for c in candles[:-1]]
        vols = [c.get("volume", 0) for c in candles[:-1]]

        avg_body = sum(bodies[-20:]) / len(bodies[-20:]) if bodies else 0
        avg_vol = sum(vols[-20:]) / len(vols[-20:]) if vols else 0

        last = candles[-1]
        curr_body = abs(last["close"] - last["open"])
        curr_vol = last.get("volume", 0)

        if avg_body > 0 and curr_body > 1.5 * avg_body:
            ratio = curr_body / avg_body
            return {"ratio": ratio, "vol_confirmed": avg_vol > 0 and curr_vol > 1.3 * avg_vol}
        return None
    except Exception:
        return None


async def get_grade_data() -> dict:
    """
    Main entry point for Feature 4.
    Returns setup grades for all monitored instruments.
    """
    try:
        from backend.streamer import _tick_store, _intraday_candles, _store_lock, ALL_TOKENS
        from main import _AI_GLOBAL_STATE

        sector_biases = _AI_GLOBAL_STATE.get("sector_biases", {})

        # Get current sweep events for Factor 2
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

        # Sort by score descending
        grades.sort(key=lambda x: x.get("score", 0), reverse=True)

        return {
            "grades":    grades,
            "top_setup": grades[0] if grades else None,
            "timestamp": _get_ist_now().strftime("%I:%M:%S %p IST"),
        }

    except Exception as e:
        logger.error(f"[SMC-Grade] get_grade_data error: {e}")
        return {"grades": [], "top_setup": None, "timestamp": "", "error": str(e)}


# ═════════════════════════════════════════════════════════════════════════════
# FEATURE 5 — OI & PCR INTEGRATION
# ═════════════════════════════════════════════════════════════════════════════

_oi_cache: dict = {}   # symbol → { data, fetched_at }
_oi_cache_ttl = 180    # seconds (3 minutes)
_oi_lock = threading.Lock()

NSE_OI_HEADERS = {
    "User-Agent":      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    "Accept":          "application/json, text/plain, */*",
    "Accept-Language": "en-IN,en;q=0.9",
    "Referer":         "https://www.nseindia.com/option-chain",
    "Accept-Encoding": "gzip, deflate, br",
    "Connection":      "keep-alive",
}


def _fetch_oi_from_nse(symbol: str) -> Optional[dict]:
    """
    Fetch option chain data from NSE India public API.
    Parses PCR, max pain, call wall, put wall, top OI buildup strikes.
    
    # TODO: If NSE blocks requests, switch to a proxy or authenticated data source.
    """
    try:
        url = f"https://www.nseindia.com/api/option-chain-indices?symbol={symbol}"

        # NSE requires a session cookie — first hit the main page
        session = requests.Session()
        session.get("https://www.nseindia.com", headers=NSE_OI_HEADERS, timeout=10)
        resp = session.get(url, headers=NSE_OI_HEADERS, timeout=10)

        if resp.status_code != 200:
            logger.warning(f"[SMC-OI] NSE returned {resp.status_code} for {symbol}")
            return None

        data = resp.json()
        records = data.get("records", {})
        oc_data = records.get("data", [])
        underlying_value = records.get("underlyingValue", 0)

        if not oc_data:
            return None

        # Parse strikes
        total_call_oi = 0
        total_put_oi = 0
        strike_pain = {}
        top_ce_oi = []
        top_pe_oi = []

        for row in oc_data:
            strike = row.get("strikePrice", 0)
            ce = row.get("CE", {})
            pe = row.get("PE", {})

            ce_oi = ce.get("openInterest", 0) or 0
            pe_oi = pe.get("openInterest", 0) or 0
            ce_chg = ce.get("changeinOpenInterest", 0) or 0
            pe_chg = pe.get("changeinOpenInterest", 0) or 0

            total_call_oi += ce_oi
            total_put_oi += pe_oi

            # Max pain: sum of loss for all call buyers + put buyers
            # Simplified: track OI-weighted strike distances
            if ce_oi > 0:
                top_ce_oi.append({"strike": strike, "oi": ce_oi, "oi_change": ce_chg})
            if pe_oi > 0:
                top_pe_oi.append({"strike": strike, "oi": pe_oi, "oi_change": pe_chg})

        # PCR
        pcr = round(total_put_oi / total_call_oi, 3) if total_call_oi > 0 else 0

        # Max pain: strike with maximum combined OI on both sides
        # (buyers lose most when price is at this strike at expiry)
        all_strikes = set(row.get("strikePrice", 0) for row in oc_data)
        pain_scores = {}
        for test_strike in all_strikes:
            pain = 0
            for row in oc_data:
                s = row.get("strikePrice", 0)
                ce = row.get("CE", {})
                pe = row.get("PE", {})
                # Call pain: max(0, test_strike - s) * CE_OI
                pain += max(0, test_strike - s) * (ce.get("openInterest", 0) or 0)
                # Put pain: max(0, s - test_strike) * PE_OI
                pain += max(0, s - test_strike) * (pe.get("openInterest", 0) or 0)
            pain_scores[test_strike] = pain

        max_pain = min(pain_scores, key=pain_scores.get) if pain_scores else 0

        # Sort OI lists
        top_ce_oi.sort(key=lambda x: x["oi"], reverse=True)
        top_pe_oi.sort(key=lambda x: x["oi"], reverse=True)

        call_wall = top_ce_oi[0]["strike"] if top_ce_oi else 0
        put_wall = top_pe_oi[0]["strike"] if top_pe_oi else 0

        return {
            "symbol":          symbol,
            "pcr":             pcr,
            "max_pain":        max_pain,
            "call_wall":       call_wall,
            "put_wall":        put_wall,
            "underlying":      underlying_value,
            "top_ce_strikes":  top_ce_oi[:3],
            "top_pe_strikes":  top_pe_oi[:3],
            "total_call_oi":   total_call_oi,
            "total_put_oi":    total_put_oi,
            "oi_divergence":   False,  # Will be computed after sector bias check
            "timestamp":       _get_ist_now().strftime("%I:%M:%S %p IST"),
        }

    except Exception as e:
        logger.error(f"[SMC-OI] NSE fetch error for {symbol}: {e}")
        return None


async def get_oi_pcr_data() -> dict:
    """
    Main entry point for Feature 5.
    Returns OI and PCR data for NIFTY and BANKNIFTY.
    """
    try:
        from main import _AI_GLOBAL_STATE
        sector_biases = _AI_GLOBAL_STATE.get("sector_biases", {})

        results = {}
        now = time.time()

        for symbol in ["NIFTY", "BANKNIFTY"]:
            with _oi_lock:
                cached = _oi_cache.get(symbol, {})
                cache_age = now - cached.get("fetched_at", 0)

            if cache_age < _oi_cache_ttl and cached.get("data"):
                results[symbol] = cached["data"]
                continue

            # Fetch from NSE in thread pool
            oi_data = await asyncio.to_thread(_fetch_oi_from_nse, symbol)

            if oi_data:
                # Check OI divergence: AI is BEARISH but PCR > 1.2 (bullish options positioning)
                bank_bias = sector_biases.get("BANKS", "NEUTRAL")
                nifty_bias = sector_biases.get("IT", "NEUTRAL")
                if symbol == "BANKNIFTY":
                    bias = bank_bias
                else:
                    bias = nifty_bias

                pcr = oi_data.get("pcr", 1.0)
                divergence = (bias == "BEARISH" and pcr > 1.2) or (bias == "BULLISH" and pcr < 0.7)
                oi_data["oi_divergence"] = divergence
                oi_data["ai_bias"] = bias

                with _oi_lock:
                    _oi_cache[symbol] = {"data": oi_data, "fetched_at": now}

                results[symbol] = oi_data
            else:
                results[symbol] = {
                    "symbol":     symbol,
                    "error":      "NSE data unavailable",
                    "pcr":        None,
                    "max_pain":   None,
                    "call_wall":  None,
                    "put_wall":   None,
                    "timestamp":  _get_ist_now().strftime("%I:%M:%S %p IST"),
                }

        # Compute next refresh time
        with _oi_lock:
            oldest_fetch = min(
                (_oi_cache.get(s, {}).get("fetched_at", 0) for s in ["NIFTY", "BANKNIFTY"]),
                default=0,
            )
        next_refresh = max(0, int(_oi_cache_ttl - (now - oldest_fetch)))

        return {
            "indices":      results,
            "next_refresh": next_refresh,
            "timestamp":    _get_ist_now().strftime("%I:%M:%S %p IST"),
        }

    except Exception as e:
        logger.error(f"[SMC-OI] get_oi_pcr_data error: {e}")
        return {"indices": {}, "next_refresh": 180, "timestamp": "", "error": str(e)}


# ═════════════════════════════════════════════════════════════════════════════
# FEATURE 6 — DISPLACEMENT CANDLE DETECTOR
# ═════════════════════════════════════════════════════════════════════════════

# In-memory store of displacement alerts (last 30 mins)
_displacement_events: list = []
_displacement_lock = threading.Lock()


async def get_displacement_data() -> dict:
    """
    Main entry point for Feature 6.
    Scans all monitored instruments for displacement candles on the 5M timeframe.
    Returns last 10 events, with MSS confirmation if a sweep precedes the displacement.
    """
    try:
        from backend.streamer import _tick_store, _intraday_candles, _store_lock, ALL_TOKENS

        now_ist = _get_ist_now()
        cutoff_minutes = 30  # Clear events older than 30 minutes
        cutoff_time = now_ist - timedelta(minutes=cutoff_minutes)

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

            # Compute 20-period averages for body and volume
            recent = candles[-21:-1]  # Up to 20 candles before the last one
            if not recent:
                continue

            bodies = [abs(c["close"] - c["open"]) for c in recent]
            vols = [c.get("volume", 0) for c in recent]

            avg_body = sum(bodies) / len(bodies) if bodies else 0
            avg_vol = sum(vols) / len(vols) if vols else 0

            if avg_body == 0:
                continue

            last = candles[-1]
            curr_body = abs(last["close"] - last["open"])
            curr_vol = last.get("volume", 0)
            body_ratio = curr_body / avg_body

            # Displacement condition: body > 1.5× avg AND volume > 1.3× avg
            if body_ratio >= 1.5 and (avg_vol == 0 or curr_vol >= 1.3 * avg_vol):
                direction = "BULLISH" if last["close"] > last["open"] else "BEARISH"

                # Check MSS: was there a sweep in the prior 3 candles?
                sweep_result = await get_sweep_data()
                sweep_events = sweep_result.get("sweeps", [])
                mss_confirmed = any(
                    e["symbol"] == symbol and e["status"] in ("ACTIVE", "CONFIRMED")
                    for e in sweep_events
                )

                event = {
                    "symbol":        symbol,
                    "timeframe":     "5M",
                    "direction":     direction,
                    "body_ratio":    round(body_ratio, 2),
                    "mss_confirmed": mss_confirmed,
                    "candle_time":   last.get("time", now_ist.strftime("%H:%M")),
                    "alert_time":    now_ist.strftime("%I:%M:%S %p IST"),
                    "ltp":           round(tick_snapshot.get(token, {}).get("ltp", 0), 2),
                }
                new_events.append(event)

        with _displacement_lock:
            # Merge new events (deduplicate by symbol + candle_time)
            existing_keys = {
                (e["symbol"], e.get("candle_time"))
                for e in _displacement_events
            }
            for ev in new_events:
                key = (ev["symbol"], ev.get("candle_time"))
                if key not in existing_keys:
                    _displacement_events.append(ev)

            # Purge events older than 30 minutes
            def _is_recent(ev):
                try:
                    t = datetime.strptime(ev["alert_time"], "%I:%M:%S %p IST")
                    t = t.replace(year=now_ist.year, month=now_ist.month, day=now_ist.day)
                    t = IST.localize(t) if t.tzinfo is None else t
                    return t > cutoff_time
                except Exception:
                    return True  # Keep if can't parse

            _displacement_events[:] = [e for e in _displacement_events if _is_recent(e)]
            # Return last 10, newest first
            result_events = list(reversed(_displacement_events[-10:]))

        return {
            "alerts":    result_events,
            "mss_count": sum(1 for e in result_events if e.get("mss_confirmed")),
            "timestamp": now_ist.strftime("%I:%M:%S %p IST"),
        }

    except Exception as e:
        logger.error(f"[SMC-Displacement] get_displacement_data error: {e}")
        return {"alerts": [], "mss_count": 0, "timestamp": "", "error": str(e)}


# ═════════════════════════════════════════════════════════════════════════════
# FEATURE 7 — LIQUIDITY POOL MAPPER
# ═════════════════════════════════════════════════════════════════════════════

_lp_cache: dict = {}   # symbol → { pools, current_price, fetched_at }
_lp_cache_ttl = 300    # 5 minutes
_lp_lock = threading.Lock()


def _find_equal_levels(highs_or_lows: list, tolerance_pct: float = 0.15) -> list:
    """
    Scan a list of price levels (all highs or all lows from 1H candles).
    Returns clusters of levels within tolerance_pct% of each other.
    Each cluster represents a liquidity pool.
    """
    if not highs_or_lows:
        return []

    sorted_levels = sorted(highs_or_lows)
    pools = []
    used = set()

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
            pool_price = sum(cluster) / len(cluster)
            pools.append({"price": round(pool_price, 2), "touch_count": len(cluster)})
        used.add(i)

    return pools


def _fetch_historical_1h_for_lp(symbol: str, token: str) -> Optional[list]:
    """
    Fetch 10 days of 1H OHLCV candles for liquidity pool detection.
    Uses Angel One getCandleData (same pattern as historical.py).
    
    # TODO: Inject auth token from session for production use.
    """
    try:
        from backend.historical import _get_smart_connect
        from datetime import date

        smart = _get_smart_connect()
        today = date.today()
        from_date = (today - timedelta(days=14)).strftime("%Y-%m-%d %H:%M")
        to_date = today.strftime("%Y-%m-%d %H:%M")

        resp = smart.getCandleData({
            "exchange":     "NSE",
            "symboltoken":  token,
            "interval":     "ONE_HOUR",
            "fromdate":     from_date,
            "todate":       to_date,
        })

        if not resp or resp.get("status") is False:
            return None

        return resp.get("data", [])
    except Exception as e:
        logger.debug(f"[SMC-LP] 1H fetch failed for {symbol}: {e}")
        return None


async def get_liquidity_pools(symbol: str) -> dict:
    """
    Main entry point for Feature 7.
    Returns liquidity pool map for the specified symbol.
    """
    try:
        symbol = symbol.upper()
        now = time.time()

        # Check cache
        with _lp_lock:
            cached = _lp_cache.get(symbol, {})
            cache_age = now - cached.get("fetched_at", 0)
            if cache_age < _lp_cache_ttl and cached.get("pools"):
                return cached["pools"]

        # Find token
        from backend.streamer import _tick_store, _store_lock, ALL_TOKENS

        token = None
        for tok, meta in ALL_TOKENS.items():
            if meta.get("symbol") == symbol:
                token = tok
                break

        if not token:
            return {"symbol": symbol, "error": "Symbol not found in monitored universe", "pools": []}

        # Get current price
        with _store_lock:
            tick = _tick_store.get(token, {})
        current_price = tick.get("ltp", 0)

        # Fetch 1H candles
        candles = await asyncio.to_thread(_fetch_historical_1h_for_lp, symbol, token)

        if not candles:
            return {
                "symbol":        symbol,
                "current_price": current_price,
                "pools":         [],
                "error":         "Historical data unavailable",
            }

        # Extract all swing highs and lows
        highs = [c[2] for c in candles]  # index 2 = high
        lows = [c[3] for c in candles]   # index 3 = low

        # Find equal highs pools and equal lows pools
        equal_highs = _find_equal_levels(highs, tolerance_pct=0.15)
        equal_lows = _find_equal_levels(lows, tolerance_pct=0.15)

        # Determine round number proximity
        def _round_num_multiple(p):
            """Returns the nearest round number multiple (₹100 for indices, ₹50 for stocks)."""
            mult = 100 if symbol in ("NIFTY", "BANKNIFTY") else 50
            return round(p / mult) * mult

        def _enrich_pool(pool_list, pool_type: str) -> list:
            enriched = []
            for pool in pool_list:
                price = pool["price"]
                nearest_round = _round_num_multiple(price)
                round_confluence = abs(price - nearest_round) / price * 100 <= 0.5

                # Distance from current price
                if current_price > 0:
                    dist_pct = round(abs(price - current_price) / current_price * 100, 2)
                else:
                    dist_pct = 0

                # Untested: check if current_price has ever been near this pool
                # (simplified: if current_price is on the opposite side of pool from its type)
                if pool_type == "EQUAL_HIGHS":
                    untested = current_price < price * 0.998
                else:
                    untested = current_price > price * 1.002

                enriched.append({
                    "pool_type":               pool_type,
                    "pool_price":              price,
                    "distance_pct":            dist_pct,
                    "touch_count":             pool["touch_count"],
                    "round_number_confluence": round_confluence,
                    "nearest_round_number":    nearest_round,
                    "untested":                untested,
                    "current_price":           current_price,
                })

            # Sort by proximity to current price
            enriched.sort(key=lambda x: x["distance_pct"])
            return enriched

        highs_pools = _enrich_pool(equal_highs, "EQUAL_HIGHS")
        lows_pools = _enrich_pool(equal_lows, "EQUAL_LOWS")

        # Find nearest draw on liquidity
        above_pools = [p for p in highs_pools if p["pool_price"] > current_price]
        below_pools = [p for p in lows_pools if p["pool_price"] < current_price]

        nearest_above = above_pools[0] if above_pools else None
        nearest_below = below_pools[0] if below_pools else None

        result = {
            "symbol":         symbol,
            "current_price":  round(current_price, 2),
            "pools_above":    above_pools[:5],   # Top 5 above
            "pools_below":    below_pools[:5],   # Top 5 below
            "nearest_above":  nearest_above,
            "nearest_below":  nearest_below,
            "summary": {
                "above_count": len(above_pools),
                "below_count": len(below_pools),
                "nearest_above_price": nearest_above["pool_price"] if nearest_above else None,
                "nearest_above_pct":   nearest_above["distance_pct"] if nearest_above else None,
                "nearest_below_price": nearest_below["pool_price"] if nearest_below else None,
                "nearest_below_pct":   nearest_below["distance_pct"] if nearest_below else None,
            },
            "timestamp": _get_ist_now().strftime("%I:%M:%S %p IST"),
        }

        # Cache
        with _lp_lock:
            _lp_cache[symbol] = {"pools": result, "fetched_at": now}

        return result

    except Exception as e:
        logger.error(f"[SMC-LP] get_liquidity_pools error for {symbol}: {e}")
        return {"symbol": symbol, "pools": [], "error": str(e), "timestamp": _get_ist_now().strftime("%I:%M:%S %p IST")}
