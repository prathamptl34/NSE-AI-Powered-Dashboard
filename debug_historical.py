
import os
import pyotp
from SmartApi import SmartConnect
from streamer import NIFTY100_TOKENS
from historical import _get_smart_connect, _fetch_token_candles
from dotenv import load_dotenv

load_dotenv()

def test_fetch():
    smart = _get_smart_connect()
    # Test with a known token from Nifty 100, e.g. RELIANCE (2885)
    token = "2885"
    target_date = "11-03-2026"  # Note: The code expects YYYY-MM-DD
    
    # Wait, the frontend sends YYYY-MM-DD. 
    # March 11, 2026.
    
    res = _fetch_token_candles(smart, token, "2026-03-11")
    print(f"Fetch result for Reliance on 2026-03-11: {res}")

if __name__ == "__main__":
    try:
        test_fetch()
    except Exception as e:
        print(f"Test failed: {e}")
