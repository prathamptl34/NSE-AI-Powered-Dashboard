import requests
import json
from datetime import datetime

DASHBOARD_URL = "http://localhost:8000/api/market-summary"

def verify():
    print(f"--- Market Pulse Data Verification ({datetime.now().strftime('%Y-%m-%d %H:%M:%S')}) ---")
    try:
        resp = requests.get(DASHBOARD_URL)
        resp.raise_for_status()
        data = resp.json()
        
        print(f"\nLast Updated: {data.get('last_updated')}")
        print(f"Total Tokens Tracked: {data.get('total_tokens_tracked')}")
        
        for idx in ['nifty100', 'midcap100']:
            print(f"\n===== {idx.upper()} =====")
            print(f"{'SYMBOL':<15} | {'LTP':<10} | {'PREV CLOSE':<10} | {'CHANGE %':<10} | {'CONFIRMED?'}")
            print("-" * 65)
            
            gainers = data.get(idx, {}).get('gainers', [])
            for s in gainers:
                confirmed = "✅" if s.get('prev_close_confirmed') else "⚠️"
                print(f"{s['symbol']:<15} | {s['ltp']:<10.2f} | {s['prev_close']:<10.2f} | {s['change_pct']:<10.2f} | {confirmed}")

    except Exception as e:
        print(f"Error fetching data from {DASHBOARD_URL}: {e}")
        print("Make sure your local dashboard server is running (uvicorn main:app --port 8000)")

if __name__ == "__main__":
    verify()
