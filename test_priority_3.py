import sys
import os

# Add project root to sys.path
sys.path.insert(0, os.path.abspath('.'))

import asyncio
import main
import json
from datetime import datetime

import backend.streamer as streamer

# We will inject explicit high divergence scenario directly into the Groq response
# so we avoid waiting for real LLM or we can run the real LLM with a forced prompt.
# Actually, the user wants a "real" run from the LLM, so let's mock the gainers/losers to be obvious traps,
# and let the LLM detect it and yield a High confidence flag.

async def run_test():
    # Mock gainers/losers to be obvious
    gainers = [{
        "symbol": "TATASTEEL",
        "change_pct": 5.2,
        "volume": 900000,
        "avg_volume": 3500000  # volume ratio ~ 0.25 (going up on terrible volume = Bull Trap)
    }]
    losers = []

    # Patch the main.py local variables inside generate_insight_payload_async
    # We can't easily patch local variables inside the function.
    # We can mock get_market_summary instead!
    
    original_summary = streamer.get_market_summary
    
    def fake_summary():
        return {
            "nifty100": {
                "gainers": gainers,
                "losers": losers
            }
        }
        
    streamer.get_market_summary = fake_summary
    
    print("Running Groq analysis...")
    await main.generate_insight_payload_async()
    
    print("Analysis complete.")
    flags = main._latest_divergence_flags
    print("Divergence Flags Response:")
    
    # simulate the FastAPI endpoint output
    import pytz
    IST = pytz.timezone("Asia/Kolkata")
    output = {
        "flags": flags,
        "timestamp": datetime.now(IST).strftime("%I:%M:%S %p IST")
    }
    
    print(json.dumps(output, indent=2))

if __name__ == "__main__":
    asyncio.run(run_test())
