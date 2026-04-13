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
import requests
from dotenv import load_dotenv
import pytz
import logging
import sys
import traceback
import re
import json

from groq import Groq
from backend.signal_engine import calculate_all_signals, get_summary_stats, get_sector, FNO_STOCKS
from backend.streamer import MarketStreamer, get_market_summary, get_all_ticks, get_prev_close_status, get_intraday_candles
from backend.historical import get_historical_summary, get_intraday_sparklines
from backend.nse_holidays import is_trading_day
from backend.tv_mcp_client import (
    start_tv_mcp_server, stop_tv_mcp_server, 
    get_multi_agent_analysis, get_multi_timeframe_alignment, get_volume_breakout_stocks
)

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
_latest_ai_insight = None
_latest_divergence_flags = []
_is_generating_insight = False

# Centralized AI Cache for high performance
_AI_GLOBAL_STATE = {
    "latest_insight": None, # For AI Analyst page
    "sector_biases": {},    # For Scanner page adjustments
    "scanner_narrative": "Initializing market intelligence...",
    "movers_commentary": [],
    "last_updated": None
}


# ── AI Sector Bias ─────────────────────────────────────────────────────────────
# ── AI Setup (Groq SDK with LLaMA 3.3) ────────────────────────────────────────
IST = pytz.timezone("Asia/Kolkata")

def get_ai_sector_biases() -> dict:
    """
    Called by background loop to update sector sentiment.
    Returns: {'IT': 'BULLISH', 'BANKS': 'BEARISH', ...}
    """
    try:
        summary = get_market_summary()
        n100 = summary.get("nifty100", {})
        g = ", ".join([x['symbol'] for x in n100.get("gainers", [])[:5]])
        l = ", ".join([x['symbol'] for x in n100.get("losers", [])[:5]])
        
        prompt = f"""Analyze top NSE movers and determine bias for these sectors: IT, BANKS, FMCG, METALS, AUTO, PHARMA, ENERGY.
Gainers: {g}
Losers: {l}

Respond ONLY with a JSON object. Values MUST be 'BULLISH', 'BEARISH', or 'NEUTRAL'.
Example: {{"IT": "BULLISH", "BANKS": "NEUTRAL"}}"""

        result = call_ai(prompt, 200)
        # Parse JSON
        import json, re
        match = re.search(r'\{.*\}', result, re.DOTALL)
        if match:
            return json.loads(match.group())
        return {}
    except Exception as e:
        logger.error(f"Sector bias calculation error: {e}")
        return {}

def call_ai(prompt: str, max_tokens: int = 600) -> str:
    """
    Tries models in order until one works.
    Groq free tier model availability changes — fallback chain is essential.
    """
    models = [
        "llama-3.1-8b-instant",        # fastest, most reliable free tier
        "llama3-8b-8192",               # stable fallback
        "gemma2-9b-it",                 # Google model on Groq, very reliable
    ]
    client = Groq(api_key=os.getenv("GROQ_API_KEY").strip())

    for model in models:
        try:
            response = client.chat.completions.create(
                model       = model,
                messages    = [{"role": "user", "content": prompt}],
                max_tokens  = max_tokens,
                temperature = 0.3,
                timeout     = 10.0,
            )
            result = response.choices[0].message.content
            if result and len(result) > 20:
                print(f"[Groq] Using model: {model}")
                return result
        except Exception as e:
            print(f"[Groq] {model} failed: {e}")
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


def validate_environment() -> bool:
    """Validate all required env vars exist."""
    required = ["ANGEL_API_KEY", "ANGEL_CLIENT_ID", "ANGEL_PASSWORD", "ANGEL_TOTP_SECRET", "GROQ_API_KEY"]
    missing  = [r for r in required if r not in os.environ]

    if missing:
        logger.error("🛑 MISSING ENV VARS: %s", ", ".join(missing))
        return False
    
    logger.info("✅ All required environment variables are set")
    try:
        current_ip = requests.get('https://api.ipify.org').text
        logger.info(f"🌍 OUTGOING SERVER IP: {current_ip}")
        logger.info("👉 Copy this IP to your Angel One portal if you get a 'Static IP' error.")
    except Exception as e:
        logger.warning(f"Could not check outgoing IP: {e}")
        
    return True

@asynccontextmanager
async def lifespan(app: FastAPI):
    """Lifecycle manager. Validates env vars and starts/stops background async tasks."""
    global streamer
    
    if not validate_environment():
        raise RuntimeError("Missing required environment variables. See logs for details.")
            
    from backend.streamer import load_metadata
    load_metadata()
    
    logger.info("Starting MarketStreamer background task...")
    streamer = MarketStreamer(
        api_key=os.environ["ANGEL_API_KEY"].strip(),
        client_code=os.environ["ANGEL_CLIENT_ID"].strip(),
        password=os.environ["ANGEL_PASSWORD"].strip(),
        totp_secret=os.environ["ANGEL_TOTP_SECRET"].strip(),
    )
    task = asyncio.create_task(streamer.run())
    logger.info("MarketStreamer started.")
    
    # Start TradingView MCP Server
    await start_tv_mcp_server()
    
    # Start Volume Breakout Polling
    async def poll_breakouts():
        while True:
            try:
                # Poll every 5 minutes
                breakouts = await get_volume_breakout_stocks(limit=10)
                if breakouts:
                    from backend.streamer import connected_clients
                    msg = {"type": "volume_breakouts", "data": breakouts, "timestamp": datetime.now().isoformat()}
                    for ws in list(connected_clients):
                        try:
                            await ws.send_json(msg)
                        except:
                            pass
                await asyncio.sleep(300) 
            except asyncio.CancelledError:
                break
            except Exception as e:
                logger.error(f"Volume breakout polling error: {e}")
                await asyncio.sleep(60)

    breakout_task = asyncio.create_task(poll_breakouts())
    
    # Start AI Insight Polling (Instant Fetch)
    async def poll_ai_insights():
        while True:
            try:
                await generate_insight_payload_async()
                await asyncio.sleep(240)  # Every 4 minutes
            except asyncio.CancelledError:
                break
            except Exception as e:
                print(e)
                logger.error(f"AI insight polling error: {e}")
                await asyncio.sleep(60)
                
    ai_insight_task = asyncio.create_task(poll_ai_insights())
    
    yield
    
    logger.info("Shutting down background tasks...")
    from backend.streamer import save_metadata
    save_metadata()
    breakout_task.cancel()
    ai_insight_task.cancel()
    await stop_tv_mcp_server()
    streamer.stop()
    task.cancel()
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

    from backend.streamer import connected_clients
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
            await asyncio.sleep(15)  # keep alive ping
            await websocket.send_json({"type": "ping"})
    except WebSocketDisconnect:
        logger.info("WebSocket disconnected")
        connected_clients.discard(websocket)
    except Exception as e:
        logger.error(f"WebSocket error: {e}")
        connected_clients.discard(websocket)


@app.get("/api/cache-status")
async def get_cache_status():
    """Returns the status of the background metadata scavenger."""
    from backend.streamer import ALL_TOKENS
    total = len(ALL_TOKENS)
    confirmed = sum(1 for v in ALL_TOKENS.values() if v.get('prev_close_confirmed'))
    return {
        "ready": confirmed > (total * 0.8), # Considered ready if 80% confirmed
        "progress_pct": round((confirmed / total) * 100, 1) if total > 0 else 100,
        "confirmed": confirmed,
        "total": total
    }


@app.get("/api/market-summary/raw")
async def market_summary_raw(request: Request):
    """Returns full tick data for all subscribed tokens (debug / advanced use)."""
    if streamer is None:
        raise HTTPException(status_code=503, detail="Streamer not initialised yet.")
    return get_market_summary(top_n=100)


@app.get("/api/ai-insight")
async def get_ai_insight():
    """Returns the latest AI-generated market insight from background cache."""
    # Use centralized state if available
    state = _AI_GLOBAL_STATE.get("latest_insight")
    if state:
        return state
        
    # Fallback to legacy variable
    if _latest_ai_insight:
        return _latest_ai_insight
        
    return {"error": "AI Market Analyst is warming up. Please wait 60 seconds."}


@app.get("/api/fno-movers")
async def get_fno_movers():
    from backend.streamer import _fno_tick_store
    sorted_stocks = sorted(
        [v for v in _fno_tick_store.values() if v and v.get("change_pct") is not None],
        key=lambda x: x["change_pct"], reverse=True
    )
    return {
        "gainers": sorted_stocks[:5],
        "losers": sorted_stocks[-5:][::-1],
        "timestamp": datetime.now().isoformat()
    }


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
        logger.error(f"Historical Auth Error: {e}")
        raise HTTPException(
            status_code=503,
            detail={"error": "AUTH_FAILED", "message": f"Angel One login failed. Please check your credentials. Details: {str(e)}"}
        )
    except Exception as e:
        import traceback
        logger.error(f"Historical fetch error: {e}")
        traceback.print_exc()
        raise HTTPException(
            status_code=500,
            detail={"error": "FETCH_ERROR", "message": f"Failed to fetch historical data: {str(e)}"}
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

from backend.streamer import ALL_TOKENS

@app.get("/api/intraday-sparklines")
async def api_intraday_sparklines(symbols: str):
    """
    Fetch 5-minute intraday prices for a comma-separated list of symbols.
    """
    try:
        sym_list = [s.strip().upper() for s in symbols.split(",") if s.strip()]
        if not sym_list:
            return {}
            
        # Map symbols to tokens
        tokens_to_fetch = []
        token_to_sym = {}
        for token, meta in ALL_TOKENS.items():
            if meta["symbol"] in sym_list:
                tokens_to_fetch.append(token)
                token_to_sym[token] = meta["symbol"]
                
        if not tokens_to_fetch:
            return {}
        
        # Offload to a thread because it makes Angel One API calls + sleeps
        results = await asyncio.to_thread(get_intraday_sparklines, tokens_to_fetch)
        
        # Map tokens back to symbols in response
        sym_results = {}
        for t, prices in results.items():
            sym = token_to_sym.get(t)
            if sym:
                sym_results[sym] = prices
                
        return sym_results
    except Exception as e:
        logger.error(f"Sparkline fetch error: {e}")
        return {}

_latest_ai_insight = None
_is_generating_insight = False

async def generate_insight_payload_async():
    """Generates the main AI insight. Run periodically in the background."""
    global _latest_ai_insight, _is_generating_insight
    if _is_generating_insight:
        return
    _is_generating_insight = True
    
    try:
        # Get live market data from existing streamer
        summary = get_market_summary()
        gainers = summary.get("nifty100", {}).get("gainers", [])[:5]
        losers  = summary.get("nifty100", {}).get("losers",  [])[:5]

        top_gainer = gainers[0] if gainers else None
        top_loser  = losers[0]  if losers  else None

        if not gainers:
            # Keep existing insight if there's no data yet, wait for ticks
            if _latest_ai_insight is None:
                _latest_ai_insight = {"error": "No market data available yet."}
            return

        # Build market overview prompts
        g_text = ", ".join([f"{g['symbol']} +{g['change_pct']:.2f}%" for g in gainers])
        l_text = ", ".join([f"{l['symbol']} {l['change_pct']:.2f}%"  for l in losers])

        main_prompt = f"""You are a senior NSE market analyst writing for professional traders.

LIVE MARKET DATA:
- Top Gainers (Nifty 100): {g_text}
- Top Losers  (Nifty 100): {l_text}

Write a structured market analysis in EXACTLY this format.
Do not add any other sections. Complete every sentence fully.
Use clean English with zero spelling errors.

MARKET SNAPSHOT:
[Write exactly 2 complete sentences about overall market breadth and sentiment today.]

SECTOR ANALYSIS:
[Write exactly 2 complete sentences about which sectors are leading and which are lagging based on the movers above.]

OUTLOOK:
[Write exactly 2 complete sentences about short-term outlook, key index levels to watch, and what could trigger the next move.]

SIGNAL: [Write only one word here: BULLISH or BEARISH or NEUTRAL or CAUTIOUS]"""

        # Build stock-level prompts
        g_prompt = f"""You are an NSE analyst. Write 3 clean sentences only.
{top_gainer['symbol']} is up {top_gainer['change_pct']:.2f}% today on NSE.
Explain: (1) the most likely specific catalyst, (2) what this means for the stock short-term.
No typos. No bullet points. Complete sentences only.""" if top_gainer else None

        l_prompt = f"""You are an NSE analyst. Write 3 clean sentences only.
{top_loser['symbol']} is down {abs(top_loser['change_pct']):.2f}% today on NSE.
Explain: (1) the most likely specific reason for the decline, (2) key risk level to watch.
No typos. No bullet points. Complete sentences only.""" if top_loser else None

        # Run AI calls sequentially with safety sleeps to avoid Groq 429 limits
        main_insight = await asyncio.to_thread(call_ai, main_prompt, 600)
        await asyncio.sleep(2)
        
        gainer_insight = None
        if g_prompt:
            gainer_insight = await asyncio.to_thread(call_ai, g_prompt, 250)
            await asyncio.sleep(2)
            
        loser_insight = None
        if l_prompt:
            loser_insight = await asyncio.to_thread(call_ai, l_prompt, 250)
            await asyncio.sleep(2)

        # Strip the signal word from the main insight text
        lines  = main_insight.strip().split('\n')
        signal = extract_signal(lines[-1]) if lines else "NEUTRAL"
        clean_insight = '\n'.join(lines[:-1]).strip() if extract_signal(lines[-1]) != "NEUTRAL" or lines[-1].strip().upper() in ["BULLISH","BEARISH","CAUTIOUS","NEUTRAL"] else main_insight

        _latest_ai_insight = {
            "insight":        clean_insight,
            "signal":         signal,
            "timestamp":      datetime.now(IST).strftime("%I:%M:%S %p IST"),
            "gainer_insight": gainer_insight,
            "loser_insight":  loser_insight,
            "gainers":        gainers,
            "losers":         losers,
        }
        
        # Update Central AI State
        _AI_GLOBAL_STATE["latest_insight"] = _latest_ai_insight
        _AI_GLOBAL_STATE["last_updated"]   = datetime.now(IST).strftime("%I:%M:%S %p IST")

        # --- Performance Upgrade: Pre-calculate Scanner Data ---
        try:
            # 1. Sector Biases
            biases = get_ai_sector_biases()
            if biases:
                _AI_GLOBAL_STATE["sector_biases"] = biases
            
            # 2. Scanner Narrative
            ticks = get_all_ticks()
            if ticks:
                from backend.signal_engine import calculate_all_signals, get_summary_stats
                
                all_stocks_for_scanner = []
                for t in ticks:
                    all_stocks_for_scanner.append({
                        "symbol": t["symbol"],
                        "change_pct": t.get("change_pct", 0),
                        "score": 50 # minimal dummy for narrative context
                    })
                
                scanner_signals = calculate_all_signals(all_stocks_for_scanner)
                scanner_stats = get_summary_stats(scanner_signals)
                
                # 2. Scanner Narrative & Commentary (Sequential)
                _AI_GLOBAL_STATE["scanner_narrative"] = await asyncio.to_thread(generate_scanner_narrative, scanner_stats, scanner_signals[:5], scanner_signals[-5:])
                await asyncio.sleep(2)
                
                _AI_GLOBAL_STATE["movers_commentary"] = await asyncio.to_thread(generate_movers_commentary, scanner_signals[:3], scanner_signals[-3:])
                await asyncio.sleep(2)
                    
        except Exception as e:
            logger.error(f"Background scanner pre-calc error: {e}")

        # --- Priority 3: Divergence Lie Detector ---
        def _get_vr(t):
            av = t.get("avg_volume", 0)
            return round(t.get("volume", 0) / av, 2) if av > 10000 else 1.0

        all_movers = gainers + losers
        top_5_movers = sorted(all_movers, key=lambda x: abs(x.get('change_pct', 0)), reverse=True)[:5]
        mover_data = [
            {"symbol": m["symbol"], "price_change_pct": m.get("change_pct", 0), "volume_ratio": _get_vr(m)} 
            for m in top_5_movers
        ]

        divergence_prompt = f"""
You are a quantitative analyst. Analyze each stock below and compare news sentiment vs price action.

Stocks data:
{json.dumps(mover_data)}

For each stock return ONLY valid JSON array, no extra text:
[
  {{
    "symbol": "SYMBOL",
    "narrative_sentiment": <integer -10 to 10>,
    "tape_sentiment": <integer -10 to 10>,
    "divergence_type": "Bull Trap" | "Bear Trap" | "Confirmed Move" | "Neutral",
    "confidence": "Low" | "Medium" | "High",
    "one_line_reason": "..."
  }}
]
"""
        div_result = await asyncio.to_thread(call_ai, divergence_prompt, 800)
        
        try:
            json_str = div_result
            if "[" in json_str:
                json_str = json_str[json_str.find("["):json_str.rfind("]")+1]
            parsed_response = json.loads(json_str)
            filtered = [
                s for s in parsed_response
                if s.get('confidence') == 'High'
                and abs(s.get('narrative_sentiment', 0) - s.get('tape_sentiment', 0)) > 5
            ]
            global _latest_divergence_flags
            _latest_divergence_flags = filtered
            
            # Log to local file
            os.makedirs(".data", exist_ok=True)
            with open(".data/divergences.jsonl", "a") as f:
                for match in filtered:
                    m_copy = match.copy()
                    m_copy['timestamp'] = datetime.now(IST).isoformat()
                    f.write(json.dumps(m_copy) + "\n")
        except Exception as e:
            logger.error(f"Divergence parse error: {e}")
    finally:
        _is_generating_insight = False


@app.get("/api/signal-scanner")
async def get_signal_scanner():
    try:
        # Get all processed ticks from the streamer
        ticks = get_all_ticks()

        if not ticks:
            return {"error": "No stock data available. WebSocket may be connecting."}

        # Map ticks to the format expected by signal_engine (ltp -> price)
        all_stocks = []
        for t in ticks:
            symbol = t["symbol"]
            candles = get_intraday_candles(t["token"])
            all_stocks.append({
                "token":      t["token"],
                "symbol":     symbol,
                "price":      t["ltp"],
                "prev_close": t["prev_close"],
                "change_pct": t.get("change_pct", 0),
                "volume":     t.get("volume", 0),
                "avg_volume": t.get("avg_volume", 0),
                "is_fno":     symbol in FNO_STOCKS,
                "candles_today": candles,
                "historical_candles": [] # Will be populated dynamically later
            })

        # Calculate signals for all stocks (pure algorithm — instant, no API cost)
        signals = calculate_all_signals(all_stocks)

        # Detect if market is closed (all stocks have 0% change)
        changes = [abs(s.get('change_pct', 0)) for s in all_stocks]
        market_closed = len(changes) > 10 and max(changes) < 0.01

        # Get AI sector biases from cache (instant)
        sector_biases = _AI_GLOBAL_STATE.get("sector_biases", {})
        if market_closed and sector_biases:
            logger.info('[Scanner] Market closed — using cached AI sector biases')

            # Override signals with AI sector biases
            # get_sector is now imported at top level
            for sig in signals:
                sector = get_sector(sig['symbol'])
                bias   = sector_biases.get(sector, 'NEUTRAL')

                if bias == 'BULLISH':
                    sig['score']  = min(100, sig['score'] + 15)
                    sig['signal'] = 'BULLISH' if sig['score'] >= 60 else 'NEUTRAL'
                    sig['action'] = 'WATCH BUY' if sig['score'] >= 60 else 'HOLD'
                    sig['reason'] = f'{sector} sector showing bullish bias · {sig["reason"]}'
                elif bias == 'BEARISH':
                    sig['score']  = max(0, sig['score'] - 15)
                    sig['signal'] = 'BEARISH' if sig['score'] <= 40 else 'NEUTRAL'
                    sig['action'] = 'WATCH SELL' if sig['score'] <= 40 else 'HOLD'
                    sig['reason'] = f'{sector} sector under pressure · {sig["reason"]}'

            # Re-sort after bias adjustment
            order = {'BULLISH': 0, 'NEUTRAL': 1, 'BEARISH': 2}
            signals.sort(key=lambda x: (order.get(x['signal'], 1), -x['score']))

        stats = get_summary_stats(signals)
        
        # Use cached AI narrative and commentary for instant response
        narrative = _AI_GLOBAL_STATE.get("scanner_narrative", "Scan complete. Analyzing market breadth.")
        movers_raw = _AI_GLOBAL_STATE.get("movers_commentary", [])

        if movers_raw:
            for item in movers_raw:
                sym = item.get("symbol")
                for sig in signals:
                    if sig["symbol"] == sym:
                        sig["ai_note"] = item.get("note", "")
                        break

        # Add sector info to each signal for frontend display
        # get_sector is now imported at top level
        for sig in signals:
            sig['sector'] = get_sector(sig['symbol'])

        return {
            "signals":      signals,
            "stats":        stats,
            "narrative":    narrative,
            "timestamp":    datetime.now(IST).strftime("%I:%M:%S %p IST"),
            "market_closed": market_closed,
            "sector_biases": _AI_GLOBAL_STATE.get("sector_biases", {}),
            "disclaimer":   "AI signals for informational purposes only. Not SEBI advice.",
        }

    except Exception as e:
        logger.error("Signal Scanner error: %s", e)
        return {"error": str(e)}


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

# ── TradingView MCP Routes ────────────────────────────────────────────────────

@app.get("/api/tv/multi-agent/{symbol}")
async def tv_multi_agent(symbol: str, timeframe: str = "1D"):
    """Advanced AI debate about a stock using multiple technical agents."""
    try:
        analysis = await get_multi_agent_analysis(symbol.upper(), timeframe=timeframe)
        if not analysis:
            raise HTTPException(status_code=503, detail="Analysis service temporarily unavailable")
        return analysis
    except Exception as e:
        logger.error(f"TV Multi-Agent error: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/tv/mtf/{symbol}")
async def tv_mtf_alignment(symbol: str):
    """Checks trend alignment across multiple timeframes (15m to 1W)."""
    try:
        alignment = await get_multi_timeframe_alignment(symbol.upper())
        if not alignment:
            raise HTTPException(status_code=503, detail="Alignment service temporarily unavailable")
        return alignment
    except Exception as e:
        logger.error(f"TV MTF error: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/tv/volume-breakouts")
async def tv_breakouts(timeframe: str = "15m"):
    """Scans for real-time volume breakout opportunities."""
    try:
        breakouts = await get_volume_breakout_stocks(timeframe=timeframe)
        return {"breakouts": breakouts, "timestamp": datetime.now().isoformat()}
    except Exception as e:
        logger.error(f"TV Breakout error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


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
    port = int(os.environ.get("API_PORT", 8000))
    logger.info(f"Starting uvicorn on port {port}")
    
    try:
        uvicorn.run(
            "main:app", 
            host="0.0.0.0", 
            port=port, 
            reload=True,
            reload_excludes=[
                "**/.data/**", 
                "**/historical_cache.json", 
                "**/*.log",
                "**/.git/**"
            ]
        )
    except Exception as e:
        logger.error(f"FATAL STARTUP ERROR: {e}")
        traceback.print_exc()
        sys.exit(3)
