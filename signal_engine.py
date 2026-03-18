"""
signal_engine.py
Pure algorithmic signal calculation — no AI needed for per-stock signals.
AI (Claude) is only used for the summary narrative at the top.
This keeps costs low and speed high.
"""

FNO_STOCKS = {
    # Nifty 50
    "RELIANCE", "TCS", "HDFCBANK", "INFY", "ICICIBANK", "HINDUNILVR",
    "ITC", "SBIN", "BHARTIARTL", "KOTAKBANK", "LT", "AXISBANK",
    "ASIANPAINT", "MARUTI", "NESTLEIND", "TITAN", "ULTRACEMCO",
    "WIPRO", "HCLTECH", "SUNPHARMA", "BAJFINANCE", "BAJAJFINSV",
    "TECHM", "NTPC", "POWERGRID", "ONGC", "COALINDIA", "TATAMOTORS",
    "TATASTEEL", "JSWSTEEL", "HINDALCO", "ADANIENT", "ADANIPORTS",
    "CIPLA", "DRREDDY", "DIVISLAB", "APOLLOHOSP", "EICHERMOT",
    "HEROMOTOCO", "BAJAJ-AUTO", "M&M", "TATACONSUM", "BRITANNIA",
    "GRASIM", "INDUSINDBK", "HDFCLIFE", "SBILIFE", "BPCL", "IOC",
    # Midcap F&O
    "DLF", "GODREJCP", "MUTHOOTFIN", "TVSMOTOR", "PERSISTENT",
    "LTIM", "MPHASIS", "COFORGE", "PIIND", "DEEPAKNTR",
    "SAIL", "NATIONALUM", "NMDC", "CONCOR", "SOLARINDS",
    "VEDL", "ZYDUSLIFE", "TORNTPHARM", "IPCALAB", "ALKEM",
    "CHOLAFIN", "ABCAPITAL", "MANAPPURAM", "PEL", "RECLTD",
    "PFC", "IRCTC", "HAL", "BEL", "BHEL",
    "GAIL", "PETRONET", "MGL", "IGL", "TRENT",
    "ZOMATO", "NYKAA", "PAYTM", "POLICYBZR", "DELHIVERY",
    "ETERNAL",
}

# Sector classification for NSE stocks
STOCK_SECTORS = {
    # IT
    'TCS': 'IT', 'INFY': 'IT', 'WIPRO': 'IT', 'HCLTECH': 'IT',
    'TECHM': 'IT', 'LTIM': 'IT', 'PERSISTENT': 'IT', 'MPHASIS': 'IT',
    'COFORGE': 'IT', 'OFSS': 'IT',

    # BANKS
    'HDFCBANK': 'BANKS', 'ICICIBANK': 'BANKS', 'KOTAKBANK': 'BANKS',
    'AXISBANK': 'BANKS', 'SBIN': 'BANKS', 'INDUSINDBK': 'BANKS',
    'BANDHANBNK': 'BANKS', 'FEDERALBNK': 'BANKS', 'IDFCFIRSTB': 'BANKS',
    'PNB': 'BANKS', 'CANBK': 'BANKS', 'BANKBARODA': 'BANKS',

    # FMCG
    'HINDUNILVR': 'FMCG', 'BRITANNIA': 'FMCG', 'TATACONSUM': 'FMCG',
    'NESTLEIND': 'FMCG', 'DABUR': 'FMCG', 'MARICO': 'FMCG',
    'GODREJCP': 'FMCG', 'COLPAL': 'FMCG', 'EMAMILTD': 'FMCG',

    # METALS
    'HINDALCO': 'METALS', 'JINDALSTEL': 'METALS', 'JSWSTEEL': 'METALS',
    'TATASTEEL': 'METALS', 'HINDZINC': 'METALS', 'NMDC': 'METALS',
    'COALINDIA': 'METALS', 'VEDL': 'METALS', 'NATIONALUM': 'METALS',

    # AUTO
    'MARUTI': 'AUTO', 'TATAMOTORS': 'AUTO', 'MAHINDRA': 'AUTO',
    'BAJAJ-AUTO': 'AUTO', 'MOTHERSON': 'AUTO', 'HEROMOTOCO': 'AUTO',
    'EICHERMOT': 'AUTO', 'BOSCHLTD': 'AUTO', 'BALKRISIND': 'AUTO',
    'MRF': 'AUTO', 'APOLLOTYRE': 'AUTO',

    # PHARMA
    'SUNPHARMA': 'PHARMA', 'DRREDDY': 'PHARMA', 'CIPLA': 'PHARMA',
    'DIVISLAB': 'PHARMA', 'AUROPHARMA': 'PHARMA', 'TORNTPHARM': 'PHARMA',
    'BIOCON': 'PHARMA', 'ALKEM': 'PHARMA', 'IPCALAB': 'PHARMA',

    # INFRA / CAPITAL GOODS
    'LT': 'INFRA', 'ADANIPORTS': 'INFRA', 'ABB': 'INFRA',
    'SIEMENS': 'INFRA', 'HAL': 'INFRA', 'BEL': 'INFRA',
    'BHEL': 'INFRA', 'IRB': 'INFRA', 'CONCOR': 'INFRA',

    # ENERGY
    'RELIANCE': 'ENERGY', 'ONGC': 'ENERGY', 'NTPC': 'ENERGY',
    'POWERGRID': 'ENERGY', 'BPCL': 'ENERGY', 'IOC': 'ENERGY',
    'TATAPOWER': 'ENERGY', 'ADANIENT': 'ENERGY', 'ADANIGREEN': 'ENERGY',
    'NTPCGREEN': 'ENERGY',

    # FINANCE / NBFC
    'BAJFINANCE': 'FINANCE', 'BAJAJFINSV': 'FINANCE', 'CHOLAFIN': 'FINANCE',
    'MUTHOOTFIN': 'FINANCE', 'LICHSGFIN': 'FINANCE', 'PNBHOUSING': 'FINANCE',
    'SBICARD': 'FINANCE', 'JIOFIN': 'FINANCE',

    # TELECOM
    'BHARTIARTL': 'TELECOM', 'IDEA': 'TELECOM',

    # CONSUMER DISCRETIONARY
    'TITAN': 'CONSUMER', 'TRENT': 'CONSUMER', 'DMART': 'CONSUMER',
    'NYKAA': 'CONSUMER', 'ZOMATO': 'CONSUMER', 'PAYTM': 'CONSUMER',
    'INDIGO': 'CONSUMER', 'INTERGLOBE': 'CONSUMER',

    # REALTY
    'DLF': 'REALTY', 'GODREJPROP': 'REALTY', 'PRESTIGE': 'REALTY',
    'OBEROIRLTY': 'REALTY', 'PHOENIXLTD': 'REALTY',
}

def get_sector(symbol: str) -> str:
    """Get sector for a symbol, default to DIVERSIFIED."""
    return STOCK_SECTORS.get(symbol.upper(), 'DIVERSIFIED')

def calculate_signal(stock: dict) -> dict:
    """
    Input stock dict must have:
      symbol, price, prev_close, change_pct,
      volume (optional), avg_volume (optional)

    Returns signal dict with:
      signal: "BULLISH" | "BEARISH" | "NEUTRAL"
      score: 0-100
      reason: one-line string
    """
    change_pct  = stock.get("change_pct", 0)
    price       = stock.get("price", 0)
    prev_close  = stock.get("prev_close", 0)
    volume      = stock.get("volume", 0)
    avg_volume  = stock.get("avg_volume", 0)

    # Only calculate vol_ratio if both values are valid and meaningful (floor of 10k avg vol)
    if avg_volume > 10000 and volume > 0:
        vol_ratio = volume / avg_volume
    else:
        vol_ratio = 1.0

    score  = 50  # start neutral
    reason = ""

    # --- Price momentum signals ---
    if change_pct >= 3.0:
        score += 25
        reason = f"Strong rally +{change_pct:.1f}% — bullish momentum"
    elif change_pct >= 1.5:
        score += 15
        reason = f"Positive momentum +{change_pct:.1f}%"
    elif change_pct >= 0.5:
        score += 8
        reason = f"Mild upward move +{change_pct:.1f}%"
        reason = f"Mild upward move"
    elif change_pct <= -3.0:
        score -= 25
        reason = f"Sharp decline {change_pct:.1f}%"
    elif change_pct <= -1.5:
        score -= 15
        reason = f"Selling pressure {change_pct:.1f}%"
    elif change_pct <= -0.5:
        score -= 8
        reason = f"Mild downward drift"
    else:
        reason = f"Flat — no clear direction"

    # --- Volume confirmation ---
    vol_ratio = 1.0
    if avg_volume > 10000 and volume > 0:
        vol_ratio = round(volume / avg_volume, 2)
        vol_ratio = min(vol_ratio, 50)  # cap at 50x

    if vol_ratio >= 2.0 and change_pct > 0:
        score += 12
        reason += " · High volume confirms rally"
    elif vol_ratio >= 2.0 and change_pct < 0:
        score -= 12
        reason += " · Heavy selling volume"
    elif vol_ratio >= 1.5:
        score += 5
        reason += " · Above-avg volume"

    # --- Circuit proximity ---
    if change_pct >= 4.5:
        reason += " · Near upper circuit ⚡"
    elif change_pct <= -4.5:
        reason += " · Near lower circuit ⚠️"

    score = max(0, min(100, score))

    # --- Signal label ---
    if score >= 62:
        signal = "BULLISH"
    elif score <= 38:
        signal = "BEARISH"
    else:
        signal = "NEUTRAL"

    # --- Action signal (more decisive than signal label) ---
    if score >= 72:
        action = "BUY"
    elif score >= 62:
        action = "WATCH BUY"
    elif score <= 28:
        action = "SELL"
    elif score <= 38:
        action = "WATCH SELL"
    else:
        action = "HOLD"

    # NEW: potential_pct and risk_pct
    if action in ["BUY", "WATCH BUY"]:
        potential_pct = round(abs(change_pct) * 2.5, 2) if change_pct != 0 else round(score * 0.05, 2)
        risk_pct      = round(abs(change_pct) * 1.2, 2) if change_pct != 0 else round((100 - score) * 0.03, 2)
    elif action in ["SELL", "WATCH SELL"]:
        potential_pct = round(abs(change_pct) * 2.0, 2) if change_pct != 0 else round((100 - score) * 0.05, 2)
        risk_pct      = round(abs(change_pct) * 1.5, 2) if change_pct != 0 else round(score * 0.03, 2)
    else:
        potential_pct = 0
        risk_pct      = 0

    return {
        "symbol":       stock.get("symbol", ""),
        "signal":       signal,
        "action":       action,
        "score":        score,
        "reason":       reason.strip(" ·"),
        "price":        round(price, 2) if price else None,
        "prev_close":   round(prev_close, 2) if prev_close else None,
        "change_pct":   change_pct,
        "vol_ratio":    vol_ratio,
        "potential_pct": potential_pct,
        "risk_pct":      risk_pct,
        "key_levels": {
            "support":    round(prev_close * 0.99, 2) if prev_close else None,
            "resistance": round(prev_close * 1.01, 2) if prev_close else None,
            "stop_loss":  round(price * (0.97 if change_pct >= 0 else 1.03), 2) if price else None,
            "target":     round(price * (1.03 if change_pct >= 0 else 0.97), 2) if price else None,
        } if price else None,
    }


def calculate_all_signals(stocks: list) -> list:
    if not stocks:
        return []

    results = [calculate_signal(s) for s in stocks if s.get('symbol')]

    # Always apply relative ranking to create meaningful spread
    changes = [s.get('change_pct', 0) for s in stocks if s.get('symbol')]
    if changes and len(changes) > 5:
        import statistics
        median_chg = statistics.median(changes)
        try:
            std_chg = statistics.stdev(changes)
        except:
            std_chg = 0.001
        if std_chg < 0.001:
            std_chg = 0.001

        for result in results:
            stock = next((s for s in stocks if s.get('symbol') == result['symbol']), None)
            if not stock:
                continue
            chg = stock.get('change_pct', 0)
            z = (chg - median_chg) / std_chg
            score = min(100, max(0, round(50 + z * 18)))
            result['score'] = score

            if score >= 62:
                result['signal'] = 'BULLISH'
                result['action'] = 'BUY' if score >= 72 else 'WATCH BUY'
            elif score <= 38:
                result['signal'] = 'BEARISH'
                result['action'] = 'SELL' if score <= 28 else 'WATCH SELL'
            else:
                result['signal'] = 'NEUTRAL'
                result['action'] = 'HOLD'

            result['reason'] = (
                f'Above average momentum vs peers' if chg > median_chg
                else f'Below average vs peers'
                if chg < median_chg else 'In line with market average'
            )

    # Sort: BULLISH first, NEUTRAL middle, BEARISH last
    order = {'BULLISH': 0, 'NEUTRAL': 1, 'BEARISH': 2}
    results.sort(key=lambda x: (order.get(x['signal'], 1), -x['score']))
    return results


def get_summary_stats(signals: list) -> dict:
    """Count bullish/bearish/neutral for summary strip."""
    bullish = [s for s in signals if s["signal"] == "BULLISH"]
    bearish = [s for s in signals if s["signal"] == "BEARISH"]
    neutral = [s for s in signals if s["signal"] == "NEUTRAL"]
    strong  = [s for s in signals if s["score"] >= 75 or s["score"] <= 25]

    return {
        "bullish_count": len(bullish),
        "bearish_count": len(bearish),
        "neutral_count": len(neutral),
        "strong_count":  len(strong),
        "total":         len(signals),
        "market_bias":   "BULLISH" if len(bullish) > len(bearish) * 1.3
                         else "BEARISH" if len(bearish) > len(bullish) * 1.3
                         else "NEUTRAL",
    }
