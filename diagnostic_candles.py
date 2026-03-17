import os
import pyotp
from SmartApi import SmartConnect
from datetime import datetime, timedelta
import json

def diagnostic():
    api_key = os.environ.get("ANGEL_API_KEY")
    client_id = os.environ.get("ANGEL_CLIENT_ID")
    password = os.environ.get("ANGEL_PASSWORD")
    totp_secret = os.environ.get("ANGEL_TOTP_SECRET")

    try:
        totp = pyotp.TOTP(totp_secret).now()
        smart = SmartConnect(api_key=api_key)
        sess = smart.generateSession(client_id, password, totp)
        if not sess.get("status"):
            print(f"Login failed: {sess.get('message')}")
            return
            
        token = "5097" # ETERNAL
        symbol = "ETERNAL"
        
        # Fetch ONE_DAY candles for last 7 days
        to_date = datetime.now().strftime("%Y-%m-%d %H:%M")
        from_date = (datetime.now() - timedelta(days=7)).strftime("%Y-%m-%d %H:%M")
        
        print(f"Fetching ONE_DAY candles for {symbol} ({token}) from {from_date} to {to_date}")
        res = smart.getCandleData({
            "exchange": "NSE",
            "symboltoken": token,
            "interval": "ONE_DAY",
            "fromdate": from_date,
            "todate": to_date
        })
        
        if res.get("status"):
            candles = res.get("data", [])
            print(f"Candles found: {len(candles)}")
            for c in candles:
                print(f"  Date: {c[0]}, Open: {c[1]}, High: {c[2]}, Low: {c[3]}, Close: {c[4]}, Vol: {c[5]}")
        else:
            print(f"Error fetching candles: {res.get('message')}")
            
    except Exception as e:
        print(f"Error: {e}")

if __name__ == "__main__":
    diagnostic()
