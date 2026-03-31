import sys, os
from datetime import datetime
from dotenv import load_dotenv

load_dotenv()
from historical import _get_smart_connect

smart = _get_smart_connect()
today_str = datetime.now().strftime('%Y-%m-%d')
req = {
    "exchange": "NSE",
    "symboltoken": "2885", # RELIANCE
    "interval": "FIVE_MINUTE",
    "fromdate": f"{today_str} 09:15",
    "todate": f"{today_str} 15:30"
}
try:
    res = smart.getCandleData(req)
    if not res:
        print("Empty response")
    else:
        print(f"Status: {res.get('status')}")
        print(f"Message: {res.get('message')}")
        # print len of data
        data = res.get('data', [])
        if data:
            print(f"Has {len(data)} candles. First candle: {data[0]}")
        else:
            print("null data")
except Exception as e:
    print(f"Error: {e}")
