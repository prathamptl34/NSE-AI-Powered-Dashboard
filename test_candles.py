import sys
import os

# Add project root to sys.path
sys.path.insert(0, os.path.abspath('.'))

import time
from datetime import datetime, timedelta
import backend.streamer as streamer
import json

# Setup ALL_TOKENS so it doesn't fail
streamer.ALL_TOKENS = {
    "2885": {"symbol": "RELIANCE", "prev_close": 2840, "index": "nifty100"}
}

# Override datetime so we can generate mock candles easily
class MockDatetime:
    _current_time = datetime.strptime("2026-04-12 09:15:00", "%Y-%m-%d %H:%M:%S")

    @classmethod
    def now(cls, tz=None):
        return cls._current_time
        
    @classmethod
    def advance(cls, minutes):
        cls._current_time += timedelta(minutes=minutes)

# Monkeypatch datetime in streamer
streamer.datetime = MockDatetime

print("Mocking ticks for RELIANCE (Token 2885)...")

# Tick 1: 09:15, open = 2840, volume = 1000
streamer._update_tick("2885", ltp=2840, volume=10000)
streamer._update_tick("2885", ltp=2848, volume=600000)
streamer._update_tick("2885", ltp=2836, volume=800000)
streamer._update_tick("2885", ltp=2844, volume=1200000) # Ends the first 5 minutes. Volume diff should be 1.2M.

# Advance time to 09:20
MockDatetime.advance(5)

# Tick 2: 09:20, price changes, volume increases
streamer._update_tick("2885", ltp=2844, volume=1300000) # tick volume = 1.3M, so diff is 100k
streamer._update_tick("2885", ltp=2851, volume=1800000) # tick volume = 1.8M, diff +500k
streamer._update_tick("2885", ltp=2841, volume=2000000)
streamer._update_tick("2885", ltp=2849, volume=2180000) # Total volume increase in this 5 mins is 2.18M - 1.20M = 980000!

# Fetch and print!
candles = streamer.get_intraday_candles("2885")

output = {
    "token": "2885",
    "symbol": "RELIANCE",
    "candles_today": candles
}

print("\n--- OUTPUT ---")
print(json.dumps(output, indent=2))
