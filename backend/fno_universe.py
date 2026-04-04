# F&O Universe — NSE Cash Segment Tokens
# Last updated: April 2026
# DO NOT EDIT MANUALLY — regenerate using Phase 1 Method A or C

import json, os

def _build_map():
    path = os.path.join(os.path.dirname(__file__), "OpenAPIScripMaster.json")
    
    # Try loading from scrip master file
    try:
        with open(path) as f:
            data = json.load(f)
        rows = data if isinstance(data, list) else list(data.values())
        fno_syms = {
            r.get("symbol","").split("-")[0]
            for r in rows
            if r.get("exch_seg") == "NFO" and r.get("instrumenttype") == "FUTSTK"
        }
        eq_rows = {
            r.get("symbol","").split("-")[0]: {
                "token": r.get("token"),
                "symbol": r.get("symbol","").split("-")[0],
                "sector": "Unknown"
            }
            for r in rows
            if r.get("exch_seg") == "NSE" and r.get("instrumenttype") == "EQ"
        }
        result = {s: eq_rows[s] for s in fno_syms if s in eq_rows}
        if len(result) > 100:
            return result
    except Exception as e:
        print(f"[fno_universe] ScripMaster load failed: {e}, using hardcoded fallback")

    # Hardcoded fallback — token=None means streamer will skip WebSocket sub
    # and rely on yfinance for prev_close
    FALLBACK = [
        "RELIANCE","TCS","HDFCBANK","INFY","ICICIBANK","HINDUNILVR","SBIN",
        "BHARTIARTL","KOTAKBANK","ITC","LT","AXISBANK","ASIANPAINT","MARUTI",
        "SUNPHARMA","TITAN","BAJFINANCE","ULTRACEMCO","WIPRO","ONGC","NTPC",
        "POWERGRID","TECHM","HCLTECH","INDUSINDBK","TATAMOTORS","ADANIPORTS",
        "BAJAJFINSV","JSWSTEEL","TATASTEEL","HINDALCO","COALINDIA","DIVISLAB",
        "DRREDDY","CIPLA","EICHERMOT","BRITANNIA","HEROMOTOCO","GRASIM","UPL",
        "APOLLOHOSP","TATACONSUM","SBILIFE","HDFCLIFE","BPCL","IOC","ADANIENT",
        "AMBUJACEM","AUROPHARMA","BANDHANBNK","BANKBARODA","BEL","BIOCON",
        "CANBK","CHOLAFIN","CONCOR","DABUR","DLF","FEDERALBNK","GAIL",
        "GODREJCP","GODREJPROP","HAL","HAVELLS","HINDPETRO","IRCTC","JUBLFOOD",
        "LICHSGFIN","LUPIN","M&M","MARICO","MCX","MPHASIS","MRF","MUTHOOTFIN",
        "NAUKRI","NMDC","OFSS","PAGEIND","PERSISTENT","PETRONET","PFC",
        "PIDILITIND","PNB","POLYCAB","RBLBANK","RECLTD","SAIL","SBICARD",
        "SIEMENS","SRF","TATACHEM","TATAPOWER","TVSMOTOR","VEDL","VOLTAS",
        "YESBANK","ZOMATO","PAYTM","DELHIVERY","ABCAPITAL","ACC","AUBANK",
        "BALKRISIND","BATAINDIA","EXIDEIND","GLENMARK","INDIAMART","INDIANB",
        "JSWENERGY","LTTS","MAXHEALTH","MOTHERSON","NAVINFLUOR","NHPC",
        "PHOENIXLTD","SUNDARMFIN","TORNTPHARM","TORNTPOWER","TRENT","TRIDENT",
        "ZYDUSLIFE","DEEPAKNTR","IDFCFIRSTB","IDEA","IGL","LALPATHLAB",
        "MFSL","NIACL","OBEROIRLTY","PEL","RAMCOCEM","SRF","SUPREMEIND",
        "SYNGENE","TATACOMM","UNITDSPR","WHIRLPOOL","ZEEL"
    ]
    return {s: {"token": None, "symbol": s, "sector": "Unknown"} for s in FALLBACK}


FNO_SYMBOL_TOKEN_MAP = _build_map()


if __name__ == "__main__":
    print(f"Total F&O symbols: {len(FNO_SYMBOL_TOKEN_MAP)}")
    has_tokens = sum(1 for v in FNO_SYMBOL_TOKEN_MAP.values() if v['token'])
    print(f"Symbols with tokens: {has_tokens}")
    print("Sample:", list(FNO_SYMBOL_TOKEN_MAP.items())[:3])
