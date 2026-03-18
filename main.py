"""
Stock Dashboard - FastAPI Backend
Serves market summary data from Angel One SmartAPI live feed.
"""

import os
import asyncio
import time
from contextlib import asynccontextmanager
from fastapi import FastAPI, HTTPException, Query, Request, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from datetime import datetime
from dotenv import load_dotenv
import pytz
import logging
import sys
import traceback
import re
from groq import Groq
from historical import get_historical_summary
from nse_holidays import is_trading_day
from signal_engine import calculate_all_signals, get_summary_stats, get_sector, FNO_STOCKS, calculate_price_levels, TECH_CACHE
from streamer import MarketStreamer, get_market_summary, get_all_ticks, get_prev_close_status, NIFTY100_TOKENS, MIDCAP100_TOKENS
import pandas as pd
from tvDatafeed import TvDatafeed, Interval
from concurrent.futures import ThreadPoolExecutor

# ── Logging Configuration ─────────────────────────────────────────────────────
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

load_dotenv()

# ── Global state ──────────────────────────────────────────────────────────────
streamer = None
START_TIME = time.time()



# ── AI Setup ──────────────────────────────────────────────────────────────────
# ── AI Setup (Groq SDK with LLaMA 3.3) ────────────────────────────────────────
IST = pytz.timezone("Asia/Kolkata")

def is_market_open() -> bool:
    """Check if NSE market is currently open (9:15 AM - 3:30 PM IST, Mon-Fri)."""
    now = datetime.now(IST)
    if now.weekday() >= 5: # Saturday/Sunday
        return False
    
    market_open = now.replace(hour=9, minute=15, second=0, microsecond=0)
    market_close = now.replace(hour=15, minute=30, second=0, microsecond=0)
    return market_open <= now <= market_close

# Module-level cache for "Offline" survival
_last_market_data = {
    "nifty100": {"gainers": [], "losers": []},
    "midcap100": {"gainers": [], "losers": []},
    "total_tokens_tracked": 0
}

def call_ai(prompt: str, max_tokens: int = 600, timeout: float = 15.0) -> str:
    """
    Tries models in order until one works.
    Groq free tier model availability changes — fallback chain is essential.
    """
    models = [
        "llama-3.3-70b-versatile",      # primary — best quality, still free
        "llama-3.1-8b-instant",         # fallback — fast
        "llama3-8b-8192",               # stable fallback
        "gemma2-9b-it",                 # Google model on Groq, very reliable
    ]
    client = Groq(api_key=os.getenv("GROQ_API_KEY"))

    for model in models:
        try:
            response = client.chat.completions.create(
                model       = model,
                messages    = [{"role": "user", "content": prompt}],
                max_tokens  = max_tokens,
                temperature = 0.3,
                timeout     = timeout,
            )
            result = response.choices[0].message.content
            if result and len(result) > 20:
                print(f"[AI] Success with model: {model}")
                return result
        except Exception as e:
            print(f"[AI] Model {model} failed: {e}")
            continue

    return "AI analysis temporarily unavailable. Please try again in a moment."

def generate_scanner_narrative(stats_dict: dict, top_bullish: list, top_bearish: list) -> str:
    """One GPT-4o call via Groq for the overall scanner summary narrative."""
    try:
        bull_names = ", ".join([s["symbol"] for s in top_bullish[:3]])
        bear_names = ", ".join([s["symbol"] for s in top_bearish[:3]])
        prompt = f"""You are a professional NSE market analyst.
Scan results: {stats_dict['bullish_count']} bullish, {stats_dict['bearish_count']} bearish, {stats_dict['neutral_count']} neutral out of {stats_dict['total']} stocks.
Strongest bullish: {bull_names}. Strongest bearish: {bear_names}.
Write exactly 2 sentences summarizing the market signal landscape. Bloomberg-style, no bullet points.

IMPORTANT: Write carefully. No spelling errors. No typos. Proofread before responding."""
        return call_ai(prompt, 350)
    except Exception as e:
        logger.error(f"Scanner narrative error: {str(e)}")
        return f"Market scan complete. {stats_dict['bullish_count']} bullish, {stats_dict['bearish_count']} bearish signals detected across {stats_dict['total']} stocks."

# ── Technical Data Fetcher (Phase 4) ──────────────────────────────────────────
def fetch_stock_tech(symbol: str, tv: TvDatafeed):
    """Fetch Daily, Hourly, and 15min data for a single stock."""
    try:
        # 1. Daily for ATR(14), EMA20, EMA50, RSI
        df_d = tv.get_hist(symbol=symbol, exchange='NSE', interval=Interval.in_daily, n_bars=100)
        if df_d is None or df_d.empty: return None
        
        # Calculate indicators
        df_d['ema20'] = df_d['close'].ewm(span=20, adjust=False).mean()
        df_d['ema50'] = df_d['close'].ewm(span=50, adjust=False).mean()
        
        # Simple RSI
        delta = df_d['close'].diff()
        gain = (delta.where(delta > 0, 0)).rolling(window=14).mean()
        loss = (-delta.where(delta < 0, 0)).rolling(window=14).mean()
        rs = gain / loss
        df_d['rsi'] = 100 - (100 / (1 + rs))
        
        # ATR(14)
        high_low = df_d['high'] - df_d['low']
        high_cp = (df_d['high'] - df_d['close'].shift()).abs()
        low_cp = (df_d['low'] - df_d['close'].shift()).abs()
        tr = pd.concat([high_low, high_cp, low_cp], axis=1).max(axis=1)
        df_d['atr'] = tr.rolling(window=14).mean()

        # 2. Hourly for Swing High/Low
        df_h = tv.get_hist(symbol=symbol, exchange='NSE', interval=Interval.in_1_hour, n_bars=50)
        s_high = df_h['high'].max() if df_h is not None else None
        s_low  = df_h['low'].min() if df_h is not None else None
        
        last = df_d.iloc[-1]
        return {
            "atr":   round(float(last['atr']), 2) if not pd.isna(last['atr']) else None,
            "ema20": round(float(last['ema20']), 2),
            "ema50": round(float(last['ema50']), 2),
            "rsi":   round(float(last['rsi']), 1) if not pd.isna(last['rsi']) else 50,
            "swing_high": round(float(s_high), 2) if s_high else None,
            "swing_low":  round(float(s_low), 2) if s_low else None,
            "ready": True
        }
    except Exception as e:
        logger.error(f"Error fetching tech for {symbol}: {e}")
        return None

async def refresh_technical_data():
    """Background task to populate TECH_CACHE."""
    symbols = [v['symbol'] for v in NIFTY100_TOKENS.values()] + [v['symbol'] for v in MIDCAP100_TOKENS.values()]
    symbols = list(set(symbols)) # Unique
    
    tv = TvDatafeed()
    logger.info(f"Starting technical data refresh for {len(symbols)} stocks...")
    
    with ThreadPoolExecutor(max_workers=5) as executor:
        for i in range(0, len(symbols), 5):
            batch = symbols[i:i+5]
            futures = {executor.submit(fetch_stock_tech, sym, tv): sym for sym in batch}
            
            for future in futures:
                sym = futures[future]
                res = future.result()
                if res:
                    TECH_CACHE[sym] = res
                    # Success log every 20 stocks
                    if len(TECH_CACHE) % 20 == 0:
                        logger.info(f"Technical Cache: {len(TECH_CACHE)}/{len(symbols)} loaded")
            
            await asyncio.sleep(0.3) # User-requested delay

    logger.info("✅ Technical Cache Refresh Complete")


def validate_environment() -> bool:
    """Validate all required environment variables are set."""
    required_vars = ["ANGEL_API_KEY", "ANGEL_CLIENT_ID", "ANGEL_PASSWORD", "ANGEL_TOTP_SECRET", "GROQ_API_KEY"]
    missing_vars = []
    
    for var in required_vars:
        if not os.environ.get(var):
            missing_vars.append(var)
    
    if missing_vars:
        logger.error("\n" + "="*50)
        logger.error("DEPLOYMENT FAILED - Missing Environment Variables")
        logger.error("="*50)
        logger.error(f"Missing variables: {', '.join(missing_vars)}")
        logger.error("Please set these in Render Dashboard -> Environment tab")
        logger.error("="*50 + "\n")
        return False
    
    logger.info("✅ All required environment variables are set")
    return True

@asynccontextmanager
async def lifespan(app: FastAPI):
    """Lifecycle manager. Validates env vars and starts/stops background async tasks."""
    global streamer
    
    if not validate_environment():
        raise RuntimeError("Missing required environment variables. See logs for details.")
            
    from streamer import start_streamer_with_reconnect
    logger.info("Starting MarketStreamer reconnection loop...")
    task = asyncio.create_task(start_streamer_with_reconnect())
    
    # Start technical refresh (Phase 4)
    logger.info("Starting Technical Refresh task...")
    tech_task = asyncio.create_task(refresh_technical_data())
    
    logger.info("Tasks created.")
    yield
    logger.info("Shutting down background tasks...")
    if streamer: streamer.stop()
    task.cancel()
    tech_task.cancel()
    try:
        await task
    except asyncio.CancelledError:
        pass


# ── App setup ─────────────────────────────────────────────────────────────────
try:
    app = FastAPI(
        title="Stock Dashboard API",
        description="Live Nifty 100 & Midcap 100 Gainers/Losers",
        version="1.0.0",
        lifespan=lifespan,
    )

    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    from streamer import connected_clients
    logger.info("WebSocket route /ws/stream is registered and sharing clients with streamer.py")
except Exception as e:
    logger.error(f"FATAL INITIALIZATION ERROR: {e}")
    traceback.print_exc()
    sys.exit(3)


@app.websocket("/ws/stream")
async def websocket_stream(websocket: WebSocket):
    print(">>> New WebSocket connection request...")
    logger.info("New WebSocket connection request...")
    await websocket.accept()
    print(">>> WebSocket accepted!")
    connected_clients.add(websocket)
    logger.info(f"WebSocket accepted. Total clients: {len(connected_clients)}")
    try:
        while True:
            await asyncio.sleep(30)  # keep alive ping
            await websocket.send_json({"type": "ping"})
    except WebSocketDisconnect:
        logger.info("WebSocket disconnected")
        connected_clients.discard(websocket)
    except Exception as e:
        logger.error(f"WebSocket error: {e}")
        connected_clients.discard(websocket)


# ── AI Sector Bias ─────────────────────────────────────────────────────────────

def get_ai_sector_biases() -> dict:
    """
    ONE Groq call to get sector biases based on current market knowledge.
    Returns dict like: {'IT': 'BULLISH', 'BANKS': 'NEUTRAL', 'METALS': 'BEARISH', ...}
    """
    prompt = """You are an NSE market analyst. Based on current Indian market conditions,
rate each sector as BULLISH, NEUTRAL, or BEARISH.

Consider: global cues, FII activity, recent earnings trends, commodity prices, RBI policy.

Respond ONLY as JSON. No explanation. Example format:
{"IT": "BULLISH", "BANKS": "NEUTRAL", "METALS": "BEARISH", "FMCG": "BULLISH",
 "AUTO": "NEUTRAL", "PHARMA": "BULLISH", "INFRA": "NEUTRAL", "ENERGY": "NEUTRAL",
 "FINANCE": "NEUTRAL", "TELECOM": "BULLISH", "CONSUMER": "NEUTRAL", "REALTY": "NEUTRAL",
 "DIVERSIFIED": "NEUTRAL"}

Sectors to rate: IT, BANKS, FMCG, METALS, AUTO, PHARMA, INFRA, ENERGY, FINANCE, TELECOM, CONSUMER, REALTY, DIVERSIFIED"""

    try:
        result = call_ai(prompt, max_tokens=200)
        # Extract JSON from response
        import json
        match = re.search(r'\{[^}]+\}', result, re.DOTALL)
        if match:
            biases = json.loads(match.group())
            # Validate all values are valid signals
            valid = {'BULLISH', 'NEUTRAL', 'BEARISH'}
            return {k: v for k, v in biases.items() if v in valid}
    except Exception as e:
        print(f'[AI sector bias] {e}')

    # Fallback if AI fails
    return {
        'IT': 'NEUTRAL', 'BANKS': 'NEUTRAL', 'FMCG': 'NEUTRAL',
        'METALS': 'NEUTRAL', 'AUTO': 'NEUTRAL', 'PHARMA': 'NEUTRAL',
        'INFRA': 'NEUTRAL', 'ENERGY': 'NEUTRAL', 'FINANCE': 'NEUTRAL',
        'TELECOM': 'NEUTRAL', 'CONSUMER': 'NEUTRAL', 'REALTY': 'NEUTRAL',
        'DIVERSIFIED': 'NEUTRAL'
    }


# ── API Routes ────────────────────────────────────────────────────────────────

@app.api_route("/api/health", methods=["GET", "HEAD"])
async def health():
    return {"status": "ok", "version": "1.0.0"}

@app.post("/api/force-refresh-metadata")
async def force_refresh():
    """Trigger the scavenger loop to re-fetch all prev_close values."""
    from streamer import ALL_TOKENS
    for tok in ALL_TOKENS.values():
        tok["prev_close_confirmed"] = False
    return {"message": "Metadata refresh triggered. Scavenger will update shortly."}


# Add simple in-memory cache with 25s TTL
_market_cache = {"data": None, "ts": 0}
CACHE_TTL = 25  # seconds

@app.get("/api/market-summary")
async def market_summary():
    """
    Returns top 5 gainers and losers for Nifty 100 and Nifty Midcap 100.
    With simple TTL cache + "Last Known" survival if streamer is offline.
    """
    ws_connected = streamer and streamer.is_connected
    
    # Try fetch fresh data
    data = get_market_summary(top_n=5)
    
    # Update global "Last Known" cache if we have real data
    if data.get("total_tokens_tracked", 0) > 0:
        global _last_market_data
        _last_market_data = data

    return {
        **_last_market_data,
        "ws_connected": ws_connected,
        "last_update": datetime.now(IST).isoformat(),
        "data_note": "live" if ws_connected else "last_known"
    }


@app.get("/api/market-summary/raw")
async def market_summary_raw(request: Request):
    """Returns full tick data for all subscribed tokens (debug / advanced use)."""
    if streamer is None:
        raise HTTPException(status_code=503, detail="Streamer not initialised yet.")
    return get_market_summary(top_n=100)


@app.get("/api/historical-summary")
async def historical_summary(
    request: Request,
    date:  str = Query(...,       description="Trading date in YYYY-MM-DD format"),
    index: str = Query("nifty100", enum=["nifty100", "midcap100"]),
    top_n: int = Query(5,          ge=1, le=20, description="Number of top results"),
):
    """
    Returns top gainers and losers for a specific past trading date.
    Uses Angel One getCandleData REST API (not the live WebSocket).
    
    NOTE: This endpoint takes 20-40 seconds for full index fetch.
    Results are cached for 1 hour per (date, index, top_n) combination.
    """
    # Step 1: Validate date format
    try:
        datetime.strptime(date, "%Y-%m-%d")
    except ValueError:
        raise HTTPException(
            status_code=400,
            detail={"error": "INVALID_DATE_FORMAT", "message": "Use YYYY-MM-DD format. Example: 2025-03-10"}
        )

    # Step 2: Validate it is a trading day
    valid, reason = is_trading_day(date)
    if not valid:
        raise HTTPException(
            status_code=400,
            detail={"error": "NOT_A_TRADING_DAY", "message": reason}
        )

    # Step 3: Fetch (blocking call — run in thread pool)
    try:
        result = await asyncio.to_thread(get_historical_summary, date, index, top_n)
    except RuntimeError as e:
        raise HTTPException(
            status_code=503,
            detail={"error": "AUTH_FAILED", "message": str(e)}
        )
    except Exception as e:
        logger.error("Historical fetch error: %s", e)
        raise HTTPException(
            status_code=500,
            detail={"error": "FETCH_ERROR", "message": "Failed to fetch historical data. Check logs."}
        )

    return result


# ── AI Helpers ────────────────────────────────────────────────────────────────

def extract_signal(text: str) -> str:
    """Extracts high-level sentiment from AI analysis text."""
    text_upper = text.upper()
    for word in ["BULLISH", "BEARISH", "CAUTIOUS", "NEUTRAL"]:
        if word in text_upper:
            return word
    return "NEUTRAL"


@app.get("/api/cache-status")
async def get_cache_status():
    """Returns the status of the technical indicators cache."""
    total_expected = len(NIFTY100_TOKENS) + len(MIDCAP100_TOKENS)
    cached_count = len(TECH_CACHE)
    ready = cached_count >= (total_expected * 0.8) # 80%+ coverage is "ready"
    
    return {
        "cached_count": cached_count,
        "total_expected": total_expected,
        "ready": ready,
        "progress_pct": round((cached_count / total_expected) * 100, 1) if total_expected > 0 else 0
    }

@app.get("/api/ai-insight")
async def get_ai_insight():
    """
    Calculates live dashboard stats and fetches AI market context.
    Shows the power of combining live scraper with LLM analysis.
    """
    try:
        # Check if we have any real data or if market is open
        if not _last_market_data or _last_market_data.get("total_tokens_tracked", 0) == 0:
            return {
                "signal": "NEUTRAL",
                "insight": "Market data is currently unavailable. The feed to Angel One may be offline or the session has expired. Analysis will resume automatically when live data is restored.",
                "timestamp": datetime.now(IST).strftime("%I:%M:%S %p IST"),
                "gainers": [],
                "losers": [],
                "error": "no_data"
            }

        # 1. Get data from last known if streamer is lagging
        summary = get_market_summary(top_n=10)
        if summary.get("total_tokens_tracked", 0) == 0:
            summary = _last_market_data

        nifty   = summary.get("nifty100", {})
        midcap  = summary.get("midcap100", {})
        
        gainers = (nifty.get("gainers", []) + midcap.get("gainers", []))
        losers  = (nifty.get("losers", [])  + midcap.get("losers",  []))

        if not gainers and not losers:
            return {"insight": "Waiting for live data feed...", "signal": "NEUTRAL"}

        # Sort combined lists to find overall top movers
        gainers.sort(key=lambda x: x['change_pct'], reverse=True)
        losers.sort(key=lambda x: x['change_pct']) # Most negative first

        top_gainer = gainers[0] if gainers else None
        top_loser  = losers[0] if losers else None

        # Build prompts for AI
        g_text = ", ".join([f"{s['symbol']} (+{s['change_pct']:.1f}%)" for s in gainers[:5]])
        l_text = ", ".join([f"{s['symbol']} ({s['change_pct']:.1f}%)" for s in losers[:5]])

        main_prompt = f"""You are a top NSE equity strategist. Analyze current momentum.
LIVE MARKET DATA:
- Top Gainers: {g_text}
- Top Losers: {l_text}

Write a structured market analysis in EXACTLY this format:
MARKET SNAPSHOT: [2 sentences]
SECTOR ANALYSIS: [2 sentences]
OUTLOOK: [2 sentences]
SIGNAL: [One word: BULLISH, BEARISH, or NEUTRAL]"""

        # Build stock-level prompts
        g_prompt = f"""You are an NSE analyst. Write 3 clean sentences only.
{top_gainer['symbol']} is up {top_gainer['change_pct']:.2f}% today on NSE.
Explain potential catalysts and short-term outlook.""" if top_gainer else None

        l_prompt = f"""You are an NSE analyst. Write 3 clean sentences only.
{top_loser['symbol']} is down {top_loser['change_pct']:.2f}% today on NSE.
Explain potential risks and key support levels.""" if top_loser else None

        # Run AI calls
        tasks = [asyncio.to_thread(call_ai, main_prompt, 600)]
        if g_prompt: tasks.append(asyncio.to_thread(call_ai, g_prompt, 250))
        if l_prompt: tasks.append(asyncio.to_thread(call_ai, l_prompt, 250))

        results = await asyncio.gather(*tasks)

        main_insight   = results[0]
        gainer_insight = results[1] if len(results) > 1 else None
        loser_insight  = results[2] if len(results) > 2 else None

        # Extract signal
        signal = "NEUTRAL"
        if "SIGNAL:" in main_insight:
            signal_part = main_insight.split("SIGNAL:")[-1].strip().upper()
            if "BULLISH" in signal_part: signal = "BULLISH"
            elif "BEARISH" in signal_part: signal = "BEARISH"

        return {
            "insight":        main_insight,
            "signal":         signal,
            "timestamp":      datetime.now(IST).strftime("%I:%M:%S %p IST"),
            "gainer_insight": gainer_insight,
            "loser_insight":  loser_insight,
            "gainers":        gainers[:10],
            "losers":         losers[:10],
        }

    except Exception as e:
        logger.error(f"AI Insight error: {e}")
        return {"error": str(e), "insight": None}


@app.get("/api/signal-scanner")
async def signal_scanner():
    try:
        # Get all processed ticks from the streamer
        ticks = get_all_ticks()
        
        # Map ticks to the format expected by signal_engine (ltp -> price)
        all_stocks = []
        for t in ticks:
            all_stocks.append({
                "symbol":     t["symbol"],
                "price":      t["ltp"],
                "prev_close": t["prev_close"],
                "change_pct": t.get("change_pct", 0),
                "volume":     t.get("volume", 0),
                "avg_volume": t.get("avg_volume", 0)
            })

        signals = calculate_all_signals(all_stocks)
        
        # Enrich signals with F&O info
        for s in signals:
            s["is_fno"] = s["symbol"] in FNO_STOCKS
            # Preserve Phase 4 logic if already present (added later, but kept for stability)
            current_price = s["price"] or 0
            signal_type = s["signal"]
            score = s["score"]
            levels = calculate_price_levels(s["symbol"], current_price, signal_type, score)
            s.update(levels)

        if is_market_open():
            stats = get_summary_stats(signals)
            top_bullish = [s for s in signals if s["signal"] == "BULLISH"][:5]
            top_bearish = [s for s in signals if s["signal"] == "BEARISH"][:5]
            narrative = await asyncio.to_thread(generate_scanner_narrative, stats, top_bullish, top_bearish)
        else:
            narrative = (
                "Market is currently closed. Signals are based on last known "
                "prices from the previous session. Live signals resume at 9:15 AM IST."
            )
        return {
            "signals": signals,
            "narrative": narrative,
            "market_open": is_market_open(),
            "timestamp": datetime.now(IST).strftime("%I:%M:%S %p IST")
        }
    except Exception as e:
        logger.error(f"[SCANNER] Error: {e}")
        return {"signals": [], "narrative": f"Scanner error: {str(e)}", "error": str(e)}


def generate_movers_commentary(top_bullish: list, top_bearish: list) -> list:
    """
    ONE Groq call — returns short AI note for top 3 bullish + top 3 bearish.
    Makes the top mover cards feel unique vs generic algorithm cards.
    """
    if not top_bullish and not top_bearish:
        return []

    try:
        movers = []
        for s in top_bullish:
            movers.append(f"{s['symbol']} +{s['change_pct']:.2f}% (BULLISH, score {s['score']})")
        for s in top_bearish:
            movers.append(f"{s['symbol']} {s['change_pct']:.2f}% (BEARISH, score {s['score']})")

        prompt = f"""For each NSE stock below, write ONE short sentence (max 12 words) explaining the likely reason.
Be specific. No generic phrases like "market conditions" or "investor sentiment".
Respond ONLY as JSON array. Example: [{{"symbol":"TCS","note":"Q4 earnings beat boosted IT sector confidence"}}]

Stocks: {', '.join(movers)}"""

        result = call_ai(prompt, max_tokens=300)

        # Parse JSON safely
        import json, re
        match = re.search(r'\[.*\]', result, re.DOTALL)
        if match:
            return json.loads(match.group())
        return []
    except Exception as e:
        print(f"[movers commentary] {e}")
        return []


@app.get("/api/stock-explain")
async def explain_stock(
    symbol:     str,
    change_pct: float = 0.0,
    signal:     str   = "NEUTRAL",
    price:      float = 0.0,
    prev_close: float = 0.0,
):
    try:
        direction = "up" if change_pct >= 0 else "down"
        abs_chg   = abs(change_pct)

        prompt = f"""You are a professional NSE market analyst. Be specific and concise.

{symbol} (NSE listed) is {direction} {abs_chg:.2f}% today.
Current price: ₹{price:.2f} | Previous close: ₹{prev_close:.2f}

Write a response in this exact format:

WHY IT'S MOVING:
[2-3 sentences explaining the most likely catalyst — earnings, sector rotation, FII activity, macro event, technical breakout/breakdown, or news. Be specific to {symbol} as an Indian company.]

WHAT TO WATCH:
[3 bullet points — key levels, upcoming events, or signals traders should monitor]

RISK:
[1 sentence on the biggest risk if this move continues or reverses]

IMPORTANT: Write carefully. No spelling errors. No typos. Proofread before responding."""

        explanation = await asyncio.to_thread(call_ai, prompt, 350)

        return {
            "symbol":      symbol,
            "explanation": explanation,
            "change_pct":  change_pct,
            "price":       price,
            "timestamp":   datetime.now(IST).strftime("%I:%M:%S %p IST"),
        }

    except Exception as e:
        logger.error("Stock explanation error: %s", e)
        return {
            "error":       str(e),
            "explanation": "Explanation unavailable. Please try again."
        }


@app.get("/api/trading-day-check")

async def trading_day_check(
    request: Request,
    date: str = Query(..., description="Date to check in YYYY-MM-DD format")
):
    """
    Quick check — is a given date a valid NSE trading day?
    Used by the frontend date picker to show instant validation.
    """
    try:
        datetime.strptime(date, "%Y-%m-%d")
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid date format.")

    valid, reason = is_trading_day(date)
    return {
        "date":       date,
        "is_valid":   valid,
        "message":    reason,
    }

# ── Serve React SPA (production build) ───────────────────────────────────────
BUILD_DIR = os.path.join(os.path.dirname(__file__), "build")
if os.path.isdir(BUILD_DIR):
    app.mount("/static", StaticFiles(directory=os.path.join(BUILD_DIR, "static")), name="static")

    @app.get("/{full_path:path}")
    async def serve_spa(full_path: str):
        index = os.path.join(BUILD_DIR, "index.html")
        return FileResponse(index)

if __name__ == "__main__":
    import uvicorn
    # Render provides PORT env var. Fallback to 8000 for local.
    port = int(os.environ.get("PORT", 8000))
    logger.info(f"Starting uvicorn on port {port}")
    
    try:
        uvicorn.run("main:app", host="0.0.0.0", port=port, reload=True)
    except Exception as e:
        logger.error(f"FATAL STARTUP ERROR: {e}")
        traceback.print_exc()
        sys.exit(3)
