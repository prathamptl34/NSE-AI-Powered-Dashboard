import asyncio
import httpx
import logging
import sys

logger = logging.getLogger(__name__)

_tv_mcp_process = None

async def start_tv_mcp_server():
    """Starts the TradingView MCP server as a subprocess on port 8001."""
    global _tv_mcp_process
    if _tv_mcp_process is not None:
        logger.warning("TradingView MCP server is already running.")
        return
    
    logger.info("Starting TradingView MCP server...")
    try:
        # Command: python -m tradingview_mcp.server streamable-http --host 127.0.0.1 --port 8001
        _tv_mcp_process = await asyncio.create_subprocess_exec(
            sys.executable, "-m", "tradingview_mcp.server", "streamable-http",
            "--host", "127.0.0.1", "--port", "8001",
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE
        )
        logger.info(f"TradingView MCP server started (PID: {_tv_mcp_process.pid})")
        await asyncio.sleep(3)  # Wait for server to initialize
    except Exception as e:
        logger.error(f"Critical error starting TradingView MCP server: {e}")

async def stop_tv_mcp_server():
    """Gracefully terminates the TradingView MCP server subprocess."""
    global _tv_mcp_process
    if _tv_mcp_process:
        logger.info("Shutting down TradingView MCP server...")
        try:
            _tv_mcp_process.terminate()
            await _tv_mcp_process.wait()
            logger.info("TradingView MCP server stopped.")
        except Exception as e:
            logger.error(f"Error during TradingView MCP server shutdown: {e}")
        finally:
            _tv_mcp_process = None

async def _tv_call(tool_name: str, params: dict) -> dict:
    """Helper to call tools on the TradingView MCP HTTP server."""
    url = f"http://127.0.0.1:8001/tool/{tool_name}"
    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            resp = await client.post(url, json=params)
            if resp.status_code == 200:
                return resp.json()
            else:
                logger.error(f"[TV-MCP] {tool_name} failed ({resp.status_code}): {resp.text}")
                return {}
    except httpx.ConnectError:
        logger.error(f"[TV-MCP] Connection failed. Is the server running on port 8001?")
        return {}
    except Exception as e:
        logger.error(f"[TV-MCP] {tool_name} error: {e}")
        return {}

async def get_multi_agent_analysis(symbol: str, exchange: str = "NSE", timeframe: str = "1D") -> dict:
    """Calls the multi-agent analysis tool for a deep technical/sentiment debate."""
    params = {"symbol": symbol, "exchange": exchange, "timeframe": timeframe}
    return await _tv_call("multi_agent_analysis", params)

async def get_multi_timeframe_alignment(symbol: str, exchange: str = "NSE") -> dict:
    """Calls the multi-timeframe analysis tool to check trend alignment."""
    params = {"symbol": symbol, "exchange": exchange}
    return await _tv_call("multi_timeframe_analysis", params)

async def get_volume_breakout_stocks(
    exchange: str = "NSE", 
    timeframe: str = "15m", 
    min_volume_ratio: float = 2.0, 
    min_price_change: float = 2.0, 
    limit: int = 15
) -> list:
    """Calls the volume breakout scanner tool to find breaking stocks across the exchange."""
    params = {
        "exchange": exchange,
        "timeframe": timeframe,
        "min_volume_ratio": min_volume_ratio,
        "min_price_change": min_price_change,
        "limit": limit
    }
    result = await _tv_call("volume_breakout_scanner", params)
    # The scanner tool returns a dict with a 'breakouts' list
    if isinstance(result, dict) and "breakouts" in result:
        return result["breakouts"]
    return []
