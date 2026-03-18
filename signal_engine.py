"""
signal_engine.py
Pure algorithmic signal calculation — no AI needed for per-stock signals.
AI (Claude) is only used for the summary narrative at the top.
This keeps costs low and speed high.
"""

# Global Technical Cache (populated by main.py background task)
# { "SYMBOL": {"atr": 10.5, "ema20": 2500, "ema50": 2450, "rsi": 65, "swing_high": 2600, "swing_low": 2400, "ready": True} }
TECH_CACHE = {}

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

FNO_STOCKS = {
    # Nifty 50 (all are F&O)
    "RELIANCE", "TCS", "HDFCBANK", "INFY", "ICICIBANK", "HINDUNILVR",
    "ITC", "SBIN", "BHARTIARTL", "KOTAKBANK", "LT", "AXISBANK",
    "ASIANPAINT", "MARUTI", "NESTLEIND", "TITAN", "ULTRACEMCO",
    "WIPRO", "HCLTECH", "SUNPHARMA", "BAJFINANCE", "BAJAJFINSV",
    "TECHM", "NTPC", "POWERGRID", "ONGC", "COALINDIA", "TATAMOTORS",
    "TATASTEEL", "JSWSTEEL", "HINDALCO", "ADANIENT", "ADANIPORTS",
    "CIPLA", "DRREDDY", "DIVISLAB", "APOLLOHOSP", "EICHERMOT",
    "HEROMOTOCO", "BAJAJ-AUTO", "M&M", "TATACONSUM", "BRITANNIA",
    "GRASIM", "INDUSINDBK", "HDFCLIFE", "SBILIFE", "BPCL", "IOC",
    # Additional Midcap F&O stocks
    "DLF", "GODREJCP", "MUTHOOTFIN", "TVSMOTOR", "PERSISTENT",
    "LTIM", "MPHASIS", "COFORGE", "PIIND", "DEEPAKNTR",
    "SAIL", "NATIONALUM", "NMDC", "CONCOR", "SOLARINDS",
    "VEDL", "ZYDUSLIFE", "TORNTPHARM", "IPCALAB", "ALKEM",
    "CHOLAFIN", "ABCAPITAL", "MANAPPURAM", "PEL", "RECLTD",
    "PFC", "IRCTC", "HAL", "BEL", "BHEL",
    "GAIL", "PETRONET", "MGL", "IGL", "TRENT",
    "ZOMATO", "NYKAA", "PAYTM", "POLICYBZR", "DELHIVERY",
    "ETERNAL",  # formerly Zomato
}

def get_sector(symbol: str) -> str:
    """Get sector for a symbol, default to DIVERSIFIED."""
    return STOCK_SECTORS.get(symbol.upper(), 'DIVERSIFIED')
def calculate_signal(stock: dict) -> dict:
    """
    UPGRADED: 5-Component Scoring (0-100 pts)
    1. Price Momentum (25 pts)
    2. Volume vs 20-day Avg (20 pts)
    3. EMA Trend Alignment (20 pts)
    4. RSI Zone (20 pts)
    5. Price vs Key Level (15 pts)
    """
    symbol      = stock.get("symbol", "").upper()
    change_pct  = stock.get("change_pct", 0)
    price       = stock.get("price", 0)
    volume      = stock.get("volume", 0)
    tech        = TECH_CACHE.get(symbol, {})

    score = 0
    reasons = []

    # 1. Price Momentum (Max 25 pts)
    if change_pct >= 2.0:   score += 25; reasons.append("Strong Momentum")
    elif change_pct >= 0.8: score += 15; reasons.append("Positive Momentum")
    elif change_pct <= -2.0: score += 0; reasons.append("Strong Downward Momentum")
    elif change_pct <= -0.8: score += 5; reasons.append("Negative Momentum")
    else:                   score += 12; reasons.append("Neutral Price")

    # 2. Volume vs 20-day Avg (Max 20 pts)
    vol_ratio = stock.get("vol_ratio", 1.0)
    if vol_ratio >= 2.0:   score += 20; reasons.append("High Volume Confirmation")
    elif vol_ratio >= 1.3: score += 12; reasons.append("Above-Avg Volume")
    elif vol_ratio <= 0.7: score += 5;  reasons.append("Low Volume")
    else:                  score += 10; reasons.append("Normal Volume")

    # 3. EMA Trend Alignment (Max 20 pts)
    # Score 20 if Price > EMA20 > EMA50 (Bullish), 0 if reverse, 10 if mixed
    ema20 = tech.get("ema20")
    ema50 = tech.get("ema50")
    if price and ema20 and ema50:
        if price > ema20 > ema50:   score += 20; reasons.append("Full Bullish Trend Alignment")
        elif price < ema20 < ema50: score += 0;  reasons.append("Full Bearish Trend")
        elif price > ema50:         score += 12; reasons.append("Above Long-term Trend")
        else:                       score += 5;  reasons.append("Below Long-term Trend")
    else:
        score += 10 # Neutral if no tech data

    # 4. RSI Zone (Max 20 pts)
    rsi = tech.get("rsi")
    if rsi:
        if 40 <= rsi <= 60:   score += 20; reasons.append("Healthy RSI Zone")
        elif rsi > 70:        score += 5;  reasons.append("Overbought RSI")
        elif rsi < 30:        score += 15; reasons.append("Oversold / Rebound zone")
        elif rsi > 60:        score += 12; reasons.append("Strong RSI")
        else:                 score += 10; reasons.append("Weak RSI")
    else:
        score += 10 # Neutral

    # 5. Price vs Key Level (Max 15 pts)
    s_high = tech.get("swing_high")
    s_low  = tech.get("swing_low")
    if price and s_high and s_low:
        dist_to_high = (s_high - price) / price
        if dist_to_high < 0.01: score += 5;  reasons.append("Near Resistance")
        elif price > s_low:      score += 15; reasons.append("Holding above Swing Low")
        else:                    score += 8;  reasons.append("Neutral vs Levels")
    else:
        score += 7 # Neutral

    score = max(0, min(100, score))
    
    # Signal mapping
    if score >= 65:   signal = "BULLISH"
    elif score <= 35: signal = "BEARISH"
    else:             signal = "NEUTRAL"

    # Action mapping
    if score >= 75:   action = "BUY"
    elif score >= 65: action = "WATCH BUY"
    elif score <= 25: action = "SELL"
    elif score <= 35: action = "WATCH SELL"
    else:             action = "HOLD"

    return {
        "symbol":     symbol,
        "signal":     signal,
        "action":     action,
        "score":      score,
        "reason":     " · ".join(reasons[:3]),
        "price":      round(price, 2) if price else None,
        "change_pct": change_pct,
        "vol_ratio":  vol_ratio,
        "tech_ready": tech.get("ready", False)
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

def calculate_price_levels(symbol: str, current_price: float, signal: str, score: int) -> dict:
    """
    UPGRADED: Multi-timeframe volatility levels.
    Uses ATR from Daily for buffer, Swing High/Low for targets.
    """
    tech = TECH_CACHE.get(symbol.upper(), {})
    atr  = tech.get("atr")
    s_high = tech.get("swing_high")
    s_low  = tech.get("swing_low")
    
    # Default approximation if tech data missing
    if not atr:
        atr = current_price * 0.015 
    
    if signal == "BULLISH":
        entry = round(current_price * 1.002, 2)
        # Stop Loss: tighter of (entry - 1x ATR) OR nearest Swing Low
        sl_atr = entry - (1.0 * atr)
        stop_loss = round(max(sl_atr, s_low) if s_low else sl_atr, 2)
        
        # Target: nearest resistance (swing high) that gives min 1.5:1 R:R
        risk = entry - stop_loss
        min_target = entry + (1.5 * risk)
        target = round(max(min_target, s_high) if s_high and s_high > entry else min_target, 2)
        
    elif signal == "BEARISH":
        entry = round(current_price * 0.998, 2)
        # Stop Loss: tighter of (entry + 1x ATR) OR nearest Swing High
        sl_atr = entry + (1.0 * atr)
        stop_loss = round(min(sl_atr, s_high) if s_high else sl_atr, 2)
        
        # Target: nearest support (swing low) that gives min 1.5:1 R:R
        risk = stop_loss - entry
        min_target = entry - (1.5 * risk)
        target = round(min(min_target, s_low) if s_low and s_low < entry else min_target, 2)
        
    else: # NEUTRAL
        entry = round(current_price, 2)
        target = round(entry + (1.5 * atr), 2)
        stop_loss = round(entry - (1.0 * atr), 2)

    risk_val = abs(entry - stop_loss)
    reward_val = abs(target - entry)
    
    return {
        "entry_price": entry,
        "exit_price":  target,
        "stop_loss":   stop_loss,
        "risk_pct":    round((risk_val / entry) * 100, 2) if entry > 0 else 0,
        "reward_pct":  round((reward_val / entry) * 100, 2) if entry > 0 else 0,
        "rr_ratio":    round(reward_val / risk_val, 2) if risk_val > 0 else 0,
        "is_approx":   not tech.get("ready", False)
    }
