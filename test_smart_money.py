import sys
import os

# Add project root to sys.path
sys.path.insert(0, os.path.abspath('.'))

import time
from datetime import datetime, timedelta
import backend.streamer as streamer
import backend.signal_engine as signal_engine
import json

streamer.ALL_TOKENS = {
    "2885": {"symbol": "RELIANCE", "prev_close": 2840, "index": "nifty100"}
}

class MockDatetime:
    _current_time = datetime.strptime("2026-04-12 09:15:00", "%Y-%m-%d %H:%M:%S")

    @classmethod
    def now(cls, tz=None):
        return cls._current_time
        
    @classmethod
    def advance(cls, minutes):
        cls._current_time += timedelta(minutes=minutes)

streamer.datetime = MockDatetime

print("Mocking 10 candles for RELIANCE (Token 2885) to meet Gate 1 and Gate 4...")

# Generate 7 candles today to bypass Gate 1
start_vol = 1000
for i in range(10):
    MockDatetime.advance(5)
    # create a downtrend to force Accumulation if it spikes on 10th candle
    ltp = 2840 - (i * 2)
    # For the last candle (index 9), we spike volume realistically and make the body tiny
    if i == 9:
        # Realistic volume spike (300k volume in 5 mins vs 80k average)
        # Previous cumulative was approx 10k
        streamer._update_tick("2885", ltp=2820, volume=10000)
        streamer._update_tick("2885", ltp=2818, volume=150000)
        streamer._update_tick("2885", ltp=2820, volume=310000)
    else:
        streamer._update_tick("2885", ltp=ltp, volume=start_vol + (i * 1000))

candles_today = streamer.get_intraday_candles("2885")

# Mock historical_candles array (5 days of history for index 9, baseline average)
# We want the baseline volume for index 9 to be around 80,000.
# So that the 300,000 volume on the 10th candle triggers volume_ratio > 2.5 but < 20.
mock_historical_candles = [
    [{"volume": 1000} for _ in range(9)] + [{"volume": 85000}],
    [{"volume": 1100} for _ in range(9)] + [{"volume": 92000}],
    [{"volume": 900} for _ in range(9)] + [{"volume": 78000}],
    [{"volume": 1050} for _ in range(9)] + [{"volume": 81000}],
    [{"volume": 950} for _ in range(9)] + [{"volume": 84000}]
]

# Calculate averages for printing verification
same_time_volumes = [
    day[9]['volume'] 
    for day in mock_historical_candles[-5:] 
]
avg_volume = sum(same_time_volumes) / len(same_time_volumes)
today_volume = candles_today[9]['volume']

print("same_time_volumes:", same_time_volumes)
print(f"avg_volume: {avg_volume:.2f}")
print("today_volume:", today_volume)

print("\nInjecting into detect_absorption...")
stock = {
    "token": "2885",
    "symbol": "RELIANCE",
    "price": 2820,
    "prev_close": 2840,
    "change_pct": -0.7,
    "volume": 310000,
    "avg_volume": 500000
}

signal = signal_engine.calculate_signal(stock, candles_today, mock_historical_candles)

output = {
    "symbol": signal["symbol"],
    "smart_money": signal.get("smart_money")
}

print("\n--- OUTPUT ---")
print(json.dumps(output, indent=2))
