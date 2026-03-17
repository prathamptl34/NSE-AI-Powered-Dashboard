import os
import pyotp
from SmartApi import SmartConnect
import json

def diagnostic():
    api_key = os.environ.get("ANGEL_API_KEY")
    client_id = os.environ.get("ANGEL_CLIENT_ID")
    password = os.environ.get("ANGEL_PASSWORD")
    totp_secret = os.environ.get("ANGEL_TOTP_SECRET")

    try:
        totp = pyotp.TOTP(totp_secret).now()
        smart = SmartConnect(api_key=api_key)
        data = smart.generateSession(client_id, password, totp)
        if not data.get("status"):
            print("Login failed")
            return
            
        # 5097 = ETERNAL
        # 2031 = M&M
        tokens = ["5097", "2031", "11536"] # ETERNAL, M&M, TCS
        print(f"Fetching ltpData for: {tokens}")
        
        # getMarketData(mode, exchangeTokens)
        # MODE 1 = LTP, 2 = FULL, 3 = OHLC
        res = smart.getMarketData("FULL", {"NSE": tokens})
        print(json.dumps(res, indent=2))
        
    except Exception as e:
        print(f"Error: {e}")

if __name__ == "__main__":
    diagnostic()
