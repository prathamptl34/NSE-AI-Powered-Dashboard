"""
forex_streamer.py — Real-time Forex/Crypto/Commodity/Index data streamer.

Primary:  Twelve Data WebSocket (wss://ws.twelvedata.com/v1/quotes/price)
Fallback: yfinance (REST, historical only — D1/H1 candles)

Thread-safe stores:
  _forex_tick_store  — dict[symbol → {ltp, bid, ask, change_pct, volume, timestamp}]
  _forex_candles     — dict["SYMBOL_INTERVAL" → list[200 OHLCV]]

Auto-reconnect with exponential backoff (max 60s).
Smart throttle: UI-facing cache updated max every 500ms per symbol.
On startup: pre-warm candle cache for all 18 symbols × [M5, M15, H1, D1].
"""

import os
import time
import json
import logging
import threading
import asyncio
import requests
from datetime import datetime, timedelta, timezone
from typing import Optional, Dict, List, Any
from collections import defaultdict

import pytz

logger = logging.getLogger(__name__)

# ── Constants ─────────────────────────────────────────────────────────────────

TWELVE_DATA_KEY = os.environ.get("TWELVE_DATA_KEY", "")
TWELVE_BASE     = "https://api.twelvedata.com"
TWELVE_WS_URL   = "wss://ws.twelvedata.com/v1/quotes/price"

# All monitored symbols (strictly spec-listed, no extras)
FOREX_SYMBOLS = [
    "EUR/USD", "GBP/USD", "AUD/USD", "NZD/USD", "USD/JPY",
    "USD/CHF", "USD/CAD", "EUR/GBP", "EUR/JPY", "GBP/JPY",
    "AUD/JPY", "CAD/JPY", "CHF/JPY",
]
COMMODITY_SYMBOLS = ["XAU/USD"]   # Gold — always first
INDEX_SYMBOLS     = ["NDX", "OEX"]
CRYPTO_SYMBOLS    = ["BTC/USD", "ETH/USD"]
DXY_SYMBOL        = "DX-Y.NYB"   # DXY (internal use only, not displayed)

# Flat canonical names used as dict keys throughout the engine
ALL_SYMBOLS = ["XAUUSD"] + [
    s.replace("/", "") for s in FOREX_SYMBOLS
] + ["NAS100", "SP100", "BTCUSD", "ETHUSD"]

# Map canonical → Twelve Data symbol format
CANONICAL_TO_TD = {
    "XAUUSD":  "XAU/USD",
    "EURUSD":  "EUR/USD", "GBPUSD":  "GBP/USD", "AUDUSD":  "AUD/USD",
    "NZDUSD":  "NZD/USD", "USDJPY":  "USD/JPY", "USDCHF":  "USD/CHF",
    "USDCAD":  "USD/CAD", "EURGBP":  "EUR/GBP", "EURJPY":  "EUR/JPY",
    "GBPJPY":  "GBP/JPY", "AUDJPY":  "AUD/JPY", "CADJPY":  "CAD/JPY",
    "CHFJPY":  "CHF/JPY", "NAS100":  "NDX",      "SP100":   "OEX",
    "BTCUSD":  "BTC/USD", "ETHUSD":  "ETH/USD",  "DXY":     "DX-Y.NYB",
}

# Map canonical → yfinance symbol (fallback)
CANONICAL_TO_YF = {
    "XAUUSD":  "GC=F",     "EURUSD":  "EURUSD=X", "GBPUSD":  "GBPUSD=X",
    "AUDUSD":  "AUDUSD=X", "NZDUSD":  "NZDUSD=X", "USDJPY":  "USDJPY=X",
    "USDCHF":  "USDCHF=X", "USDCAD":  "USDCAD=X", "EURGBP":  "EURGBP=X",
    "EURJPY":  "EURJPY=X", "GBPJPY":  "GBPJPY=X", "AUDJPY":  "AUDJPY=X",
    "CADJPY":  "CADJPY=X", "CHFJPY":  "CHFJPY=X", "NAS100":  "^NDX",
    "SP100":   "^OEX",     "BTCUSD":  "BTC-USD",   "ETHUSD":  "ETH-USD",
    "DXY":     "DX-Y.NYB",
}

# Candle intervals to pre-warm
PREWARM_INTERVALS = ["5min", "15min", "1h", "1day"]

# TD interval → yfinance interval/period mapping
YF_INTERVAL_MAP = {
    "5min":  ("5m",  "5d"),
    "15min": ("15m", "30d"),
    "1h":    ("1h",  "60d"),
    "1day":  ("1d",  "365d"),
}

# ── Thread-safe stores ────────────────────────────────────────────────────────

_tick_store: Dict[str, Dict] = {}   # canonical → tick dict
_candle_store: Dict[str, List] = {} # "SYMBOL_INTERVAL" → list[candle]
_store_lock = threading.RLock()

# Throttle: track last UI-cache update time per symbol
_last_tick_update: Dict[str, float] = defaultdict(float)
THROTTLE_MS = 0.5  # 500ms minimum between updates per symbol

# Rate-limit tracking for Twelve Data
_td_call_count = 0
_td_call_reset = time.time()
_td_rate_limit_hit = False
_td_fallback_until: float = 0.0

# ── Public accessors (thread-safe) ────────────────────────────────────────────

def get_forex_tick(symbol: str) -> Optional[Dict]:
    """Return the latest tick for a canonical symbol."""
    with _store_lock:
        return _tick_store.get(symbol.upper())


def get_all_forex_ticks() -> Dict[str, Dict]:
    """Return a snapshot of all current ticks."""
    with _store_lock:
        return dict(_tick_store)


def get_forex_candles(symbol: str, interval: str) -> List[Dict]:
    """Return cached candles for symbol+interval. interval: '5min','15min','1h','1day'"""
    key = f"{symbol.upper()}_{interval}"
    with _store_lock:
        return list(_candle_store.get(key, []))


def get_candle_store_snapshot() -> Dict[str, List]:
    with _store_lock:
        return {k: list(v) for k, v in _candle_store.items()}


# ── Twelve Data REST helpers ──────────────────────────────────────────────────

def _td_headers() -> dict:
    return {"Authorization": f"apikey {TWELVE_DATA_KEY}"}


def _check_td_available() -> bool:
    """Returns True if Twelve Data is available (not rate-limited or key missing)."""
    global _td_rate_limit_hit, _td_fallback_until
    if not TWELVE_DATA_KEY:
        return False
    if time.time() < _td_fallback_until:
        return False
    return True


def _mark_td_rate_limit():
    """Switch to yfinance fallback for 60 seconds."""
    global _td_rate_limit_hit, _td_fallback_until
    _td_rate_limit_hit = True
    _td_fallback_until = time.time() + 60
    logger.warning("[ForexStreamer] Twelve Data rate limit hit — switching to yfinance for 60s")


def _fetch_td_candles(symbol: str, interval: str, outputsize: int = 200) -> Optional[List[Dict]]:
    """
    Fetch OHLCV candles from Twelve Data REST API.
    interval: '5min', '15min', '1h', '1day'
    Returns list of candles [{open, high, low, close, volume, datetime}] or None.
    """
    if not _check_td_available():
        return None

    td_symbol = CANONICAL_TO_TD.get(symbol, symbol)
    url = f"{TWELVE_BASE}/time_series"
    params = {
        "symbol":     td_symbol,
        "interval":   interval,
        "outputsize": outputsize,
        "order":      "ASC",
        "apikey":     TWELVE_DATA_KEY,
    }
    try:
        r = requests.get(url, params=params, timeout=10)
        if r.status_code == 429:
            _mark_td_rate_limit()
            return None
        if not r.ok:
            logger.warning(f"[TD candles] HTTP {r.status_code} for {symbol}/{interval}")
            return None
        data = r.json()
        if data.get("status") == "error":
            logger.warning(f"[TD candles] API error for {symbol}/{interval}: {data.get('message')}")
            return None
        raw = data.get("values", [])
        candles = []
        for c in raw:
            try:
                candles.append({
                    "datetime": c["datetime"],
                    "open":     float(c["open"]),
                    "high":     float(c["high"]),
                    "low":      float(c["low"]),
                    "close":    float(c["close"]),
                    "volume":   float(c.get("volume", 0)),
                })
            except (KeyError, ValueError):
                continue
        return candles if candles else None
    except Exception as e:
        logger.error(f"[TD candles] Exception for {symbol}/{interval}: {e}")
        return None


def _fetch_td_quote(symbol: str) -> Optional[Dict]:
    """Fetch real-time quote from Twelve Data REST."""
    if not _check_td_available():
        return None
    td_symbol = CANONICAL_TO_TD.get(symbol, symbol)
    try:
        r = requests.get(
            f"{TWELVE_BASE}/quote",
            params={"symbol": td_symbol, "apikey": TWELVE_DATA_KEY},
            timeout=8,
        )
        if r.status_code == 429:
            _mark_td_rate_limit()
            return None
        if not r.ok:
            return None
        d = r.json()
        if d.get("status") == "error":
            return None
        ltp = float(d.get("close", 0) or 0)
        if ltp <= 0:
            return None
        return {
            "ltp":        ltp,
            "bid":        float(d.get("fifty_two_week", {}).get("low", ltp)),
            "ask":        ltp,
            "change_pct": float(d.get("percent_change", 0) or 0),
            "volume":     float(d.get("volume", 0) or 0),
            "timestamp":  d.get("datetime", datetime.utcnow().isoformat()),
            "data_source": "LIVE",
        }
    except Exception as e:
        logger.error(f"[TD quote] Exception for {symbol}: {e}")
        return None


# ── yfinance fallback ─────────────────────────────────────────────────────────

def _fetch_yf_candles(symbol: str, interval: str, outputsize: int = 200) -> Optional[List[Dict]]:
    """Fetch OHLCV candles from yfinance as fallback."""
    try:
        import yfinance as yf
        yf_sym = CANONICAL_TO_YF.get(symbol)
        if not yf_sym:
            return None
        yf_interval, period = YF_INTERVAL_MAP.get(interval, ("1d", "60d"))
        ticker = yf.Ticker(yf_sym)
        df = ticker.history(period=period, interval=yf_interval, auto_adjust=True)
        if df is None or df.empty:
            return None
        df = df.tail(outputsize)
        candles = []
        for idx, row in df.iterrows():
            try:
                candles.append({
                    "datetime": str(idx),
                    "open":     float(row["Open"]),
                    "high":     float(row["High"]),
                    "low":      float(row["Low"]),
                    "close":    float(row["Close"]),
                    "volume":   float(row.get("Volume", 0) or 0),
                })
            except Exception:
                continue
        return candles if candles else None
    except Exception as e:
        logger.error(f"[yfinance candles] {symbol}/{interval}: {e}")
        return None


def _fetch_yf_quote(symbol: str) -> Optional[Dict]:
    """Fetch real-time quote from yfinance."""
    try:
        import yfinance as yf
        yf_sym = CANONICAL_TO_YF.get(symbol)
        if not yf_sym:
            return None
        ticker = yf.Ticker(yf_sym)
        info = ticker.fast_info
        ltp = getattr(info, "last_price", None) or getattr(info, "regularMarketPrice", None)
        if not ltp:
            hist = ticker.history(period="1d", interval="1m")
            if hist is not None and not hist.empty:
                ltp = float(hist["Close"].iloc[-1])
        if not ltp:
            return None
        prev = getattr(info, "previous_close", ltp)
        change_pct = ((ltp - prev) / prev * 100) if prev else 0
        return {
            "ltp":        float(ltp),
            "bid":        float(ltp),
            "ask":        float(ltp),
            "change_pct": round(change_pct, 4),
            "volume":     0,
            "timestamp":  datetime.utcnow().isoformat(),
            "data_source": "DEMO",
        }
    except Exception as e:
        logger.error(f"[yfinance quote] {symbol}: {e}")
        return None


# ── Candle cache management ───────────────────────────────────────────────────

def _store_candles(symbol: str, interval: str, candles: List[Dict]):
    """Store candles thread-safely, keeping last 200."""
    if not candles:
        return
    key = f"{symbol}_{interval}"
    with _store_lock:
        _candle_store[key] = candles[-200:]
    logger.debug(f"[ForexStreamer] Cached {len(candles)} candles for {key}")


def _fetch_and_cache_candles(symbol: str, interval: str) -> bool:
    """Fetch candles from TD or yfinance and cache them. Returns True on success."""
    # Try Twelve Data first
    candles = _fetch_td_candles(symbol, interval)
    if candles:
        _store_candles(symbol, interval, candles)
        return True
    # Fallback to yfinance
    candles = _fetch_yf_candles(symbol, interval)
    if candles:
        _store_candles(symbol, interval, candles)
        return True
    logger.warning(f"[ForexStreamer] Could not fetch candles for {symbol}/{interval}")
    return False


# ── Tick store update ─────────────────────────────────────────────────────────

def _update_tick(symbol: str, tick: Dict):
    """Update tick store with throttling (max 500ms per symbol)."""
    now = time.time()
    if now - _last_tick_update[symbol] < THROTTLE_MS:
        return
    _last_tick_update[symbol] = now
    with _store_lock:
        _tick_store[symbol] = {**tick, "symbol": symbol}


# ── Pre-warm cache on startup ─────────────────────────────────────────────────

def prewarm_candle_cache():
    """
    Pre-warm candles for all 18 symbols × [M5, M15, H1, D1].
    Runs in a background thread at startup.
    Respects Twelve Data rate limit: 8 calls/minute free tier.
    """
    logger.info("[ForexStreamer] Starting candle cache pre-warm...")
    call_count = 0
    minute_start = time.time()

    for symbol in ALL_SYMBOLS + ["DXY"]:
        for interval in PREWARM_INTERVALS:
            # Rate limit guard: 8 calls/minute for TD free tier
            if _check_td_available():
                call_count += 1
                if call_count >= 8:
                    elapsed = time.time() - minute_start
                    if elapsed < 60:
                        sleep_time = 61 - elapsed
                        logger.info(f"[ForexStreamer] TD rate limit guard — sleeping {sleep_time:.1f}s")
                        time.sleep(sleep_time)
                    call_count = 0
                    minute_start = time.time()

            ok = _fetch_and_cache_candles(symbol, interval)
            if ok:
                logger.info(f"[ForexStreamer] Pre-warmed {symbol}/{interval}")
            time.sleep(0.1)  # small gap between requests

    logger.info("[ForexStreamer] Candle cache pre-warm complete.")

    # Also pre-fetch quotes for all symbols
    _refresh_all_quotes()


def _refresh_all_quotes():
    """Fetch latest quote for all symbols (REST polling)."""
    for symbol in ALL_SYMBOLS + ["DXY"]:
        tick = None
        if _check_td_available():
            tick = _fetch_td_quote(symbol)
        if tick is None:
            tick = _fetch_yf_quote(symbol)
        if tick:
            _update_tick(symbol, tick)
        time.sleep(0.05)


# ── WebSocket streamer ────────────────────────────────────────────────────────

class ForexStreamer:
    """
    Connects to Twelve Data WebSocket and streams live price ticks.
    Falls back to REST polling (every 15s) if WebSocket unavailable.
    """

    def __init__(self):
        self._running = False
        self._ws_thread: Optional[threading.Thread] = None
        self._poll_thread: Optional[threading.Thread] = None
        self._reconnect_delay = 2.0
        self._max_reconnect_delay = 60.0

    def start(self):
        """Start streaming in background threads."""
        self._running = True
        # Always start REST polling thread (runs in parallel)
        self._poll_thread = threading.Thread(target=self._rest_poll_loop, daemon=True, name="forex-rest-poll")
        self._poll_thread.start()
        # Start WebSocket thread if key available
        if TWELVE_DATA_KEY:
            self._ws_thread = threading.Thread(target=self._ws_loop, daemon=True, name="forex-ws")
            self._ws_thread.start()
        # Start candle refresh thread
        self._candle_thread = threading.Thread(target=self._candle_refresh_loop, daemon=True, name="forex-candle-refresh")
        self._candle_thread.start()
        logger.info("[ForexStreamer] Started (WebSocket + REST polling + candle refresh)")

    def stop(self):
        self._running = False
        logger.info("[ForexStreamer] Stopped")

    def _ws_loop(self):
        """WebSocket connection loop with exponential backoff."""
        delay = self._reconnect_delay
        while self._running:
            try:
                self._connect_ws()
                delay = self._reconnect_delay  # reset on success
            except Exception as e:
                logger.warning(f"[ForexStreamer WS] Error: {e} — retrying in {delay}s")
                time.sleep(delay)
                delay = min(delay * 2, self._max_reconnect_delay)

    def _connect_ws(self):
        """Establish and maintain a Twelve Data WebSocket connection."""
        import websocket as ws_lib

        td_symbols = [CANONICAL_TO_TD[s] for s in ALL_SYMBOLS if s in CANONICAL_TO_TD]
        symbol_str  = ",".join(td_symbols)

        subscribe_msg = json.dumps({
            "action": "subscribe",
            "params": {
                "symbols": symbol_str,
                "apikey":  TWELVE_DATA_KEY,
            }
        })

        logger.info(f"[ForexStreamer WS] Connecting to {TWELVE_WS_URL}")

        def on_open(ws):
            logger.info("[ForexStreamer WS] Connected — subscribing")
            ws.send(subscribe_msg)

        def on_message(ws, message):
            try:
                msg = json.loads(message)
                event = msg.get("event")
                if event == "price":
                    symbol_td = msg.get("symbol", "")
                    # Reverse-map TD symbol to canonical
                    canonical = None
                    for k, v in CANONICAL_TO_TD.items():
                        if v == symbol_td:
                            canonical = k
                            break
                    if canonical:
                        ltp = float(msg.get("price", 0))
                        tick = {
                            "ltp":        ltp,
                            "bid":        float(msg.get("bid", ltp)),
                            "ask":        float(msg.get("ask", ltp)),
                            "change_pct": 0.0,  # WS doesn't send change_pct, use REST
                            "volume":     float(msg.get("volume", 0) or 0),
                            "timestamp":  msg.get("timestamp", datetime.utcnow().isoformat()),
                            "data_source": "LIVE",
                        }
                        # Calculate change_pct using existing tick if available
                        existing = _tick_store.get(canonical)
                        if existing and existing.get("prev_close"):
                            pc = existing["prev_close"]
                            tick["change_pct"] = round((ltp - pc) / pc * 100, 4)
                        elif existing and existing.get("ltp"):
                            tick["change_pct"] = existing.get("change_pct", 0)
                        _update_tick(canonical, tick)
            except Exception as e:
                logger.debug(f"[ForexStreamer WS] Message parse error: {e}")

        def on_error(ws, error):
            logger.warning(f"[ForexStreamer WS] Error: {error}")

        def on_close(ws, code, msg):
            logger.info(f"[ForexStreamer WS] Closed: {code} {msg}")

        app = ws_lib.WebSocketApp(
            TWELVE_WS_URL,
            on_open=on_open,
            on_message=on_message,
            on_error=on_error,
            on_close=on_close,
        )
        app.run_forever(ping_interval=30, ping_timeout=10)

    def _rest_poll_loop(self):
        """Poll REST API every 15 seconds for all symbols."""
        # Initial pre-warm in a separate thread
        prewarm_thread = threading.Thread(target=prewarm_candle_cache, daemon=True, name="forex-prewarm")
        prewarm_thread.start()

        while self._running:
            try:
                _refresh_all_quotes()
            except Exception as e:
                logger.error(f"[ForexStreamer REST poll] Error: {e}")
            time.sleep(15)

    def _candle_refresh_loop(self):
        """Refresh candle data periodically."""
        time.sleep(30)  # let prewarm finish first
        while self._running:
            try:
                # Refresh M5 candles every 5 minutes
                for symbol in ALL_SYMBOLS + ["DXY"]:
                    if not self._running:
                        break
                    _fetch_and_cache_candles(symbol, "5min")
                    time.sleep(0.5)
            except Exception as e:
                logger.error(f"[ForexStreamer candle refresh] Error: {e}")
            time.sleep(300)  # 5 minutes


# ── Singleton streamer instance ───────────────────────────────────────────────

_forex_streamer: Optional[ForexStreamer] = None


def start_forex_streamer():
    """Start the forex streamer singleton (idempotent)."""
    global _forex_streamer
    if _forex_streamer is not None:
        return
    _forex_streamer = ForexStreamer()
    _forex_streamer.start()
    logger.info("[ForexStreamer] Singleton started")


def stop_forex_streamer():
    global _forex_streamer
    if _forex_streamer:
        _forex_streamer.stop()
        _forex_streamer = None


# ── Convenience: get DXY ──────────────────────────────────────────────────────

def get_dxy_tick() -> Optional[Dict]:
    """Get DXY (Dollar Index) tick — used internally for correlation scoring."""
    return get_forex_tick("DXY")
