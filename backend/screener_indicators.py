import numpy as np
import pandas as pd

def calc_ema(closes: pd.Series, period: int) -> pd.Series:
    """Exponential Moving Average."""
    return closes.ewm(span=period, adjust=False).mean()

def calc_rsi(closes: pd.Series, period: int = 14) -> pd.Series:
    """Relative Strength Index (Wilder's smoothing)."""
    delta = closes.diff()
    gain = (delta.where(delta > 0, 0)).fillna(0)
    loss = (-delta.where(delta < 0, 0)).fillna(0)

    # Wilder's smoothing
    avg_gain = gain.ewm(alpha=1/period, adjust=False).mean()
    avg_loss = loss.ewm(alpha=1/period, adjust=False).mean()
    
    rs = avg_gain / avg_loss
    rsi = 100 - (100 / (1 + rs))
    return rsi

def calc_macd(closes: pd.Series, fast: int = 12, slow: int = 26, signal: int = 9) -> dict:
    """MACD. Returns {'macd': Series, 'signal': Series, 'histogram': Series}."""
    ema_fast = closes.ewm(span=fast, adjust=False).mean()
    ema_slow = closes.ewm(span=slow, adjust=False).mean()
    macd_line = ema_fast - ema_slow
    signal_line = macd_line.ewm(span=signal, adjust=False).mean()
    histogram = macd_line - signal_line
    return {'macd': macd_line, 'signal': signal_line, 'histogram': histogram}

def calc_bollinger(closes: pd.Series, period: int = 20, num_std: float = 2.0) -> dict:
    """Bollinger Bands. Returns {'upper': Series, 'middle': Series, 'lower': Series, 'bandwidth': Series}."""
    middle = closes.rolling(window=period).mean()
    std_dev = closes.rolling(window=period).std()
    upper = middle + (std_dev * num_std)
    lower = middle - (std_dev * num_std)
    bandwidth = (upper - lower) / middle
    return {'upper': upper, 'middle': middle, 'lower': lower, 'bandwidth': bandwidth}

def calc_adx(high: pd.Series, low: pd.Series, close: pd.Series, period: int = 14) -> pd.Series:
    """Average Directional Index."""
    tr1 = high - low
    tr2 = (high - close.shift()).abs()
    tr3 = (low - close.shift()).abs()
    tr = pd.DataFrame({'tr1': tr1, 'tr2': tr2, 'tr3': tr3}).max(axis=1)

    up_move = high - high.shift()
    down_move = low.shift() - low

    plus_dm = np.where((up_move > down_move) & (up_move > 0), up_move, 0.0)
    minus_dm = np.where((down_move > up_move) & (down_move > 0), down_move, 0.0)

    tr_smoothed = pd.Series(tr).ewm(alpha=1/period, adjust=False).mean()
    plus_di = 100 * pd.Series(plus_dm, index=high.index).ewm(alpha=1/period, adjust=False).mean() / tr_smoothed
    minus_di = 100 * pd.Series(minus_dm, index=high.index).ewm(alpha=1/period, adjust=False).mean() / tr_smoothed

    dx = 100 * (abs(plus_di - minus_di) / (plus_di + minus_di)).fillna(0)
    adx = dx.ewm(alpha=1/period, adjust=False).mean()
    return adx

def calc_supertrend(high: pd.Series, low: pd.Series, close: pd.Series, period: int = 10, multiplier: float = 3.0) -> dict:
    """Supertrend. Returns {'supertrend': Series, 'direction': Series} where direction 1=bullish, -1=bearish."""
    tr1 = high - low
    tr2 = (high - close.shift()).abs()
    tr3 = (low - close.shift()).abs()
    tr = pd.DataFrame({'tr1': tr1, 'tr2': tr2, 'tr3': tr3}).max(axis=1)
    atr = tr.ewm(alpha=1/period, adjust=False).mean()
    
    hl2 = (high + low) / 2
    final_upperband = hl2 + (multiplier * atr)
    final_lowerband = hl2 - (multiplier * atr)
    
    supertrend = pd.Series(0.0, index=close.index)
    direction = pd.Series(1, index=close.index)
    
    for i in range(1, len(close)):
        if close.iloc[i] > final_upperband.iloc[i-1]:
            direction.iloc[i] = 1
        elif close.iloc[i] < final_lowerband.iloc[i-1]:
            direction.iloc[i] = -1
        else:
            direction.iloc[i] = direction.iloc[i-1]
            
            if direction.iloc[i] == 1 and final_lowerband.iloc[i] < final_lowerband.iloc[i-1]:
                final_lowerband.iloc[i] = final_lowerband.iloc[i-1]
            
            if direction.iloc[i] == -1 and final_upperband.iloc[i] > final_upperband.iloc[i-1]:
                final_upperband.iloc[i] = final_upperband.iloc[i-1]

        if direction.iloc[i] == 1:
            supertrend.iloc[i] = final_lowerband.iloc[i]
        else:
            supertrend.iloc[i] = final_upperband.iloc[i]
            
    return {'supertrend': supertrend, 'direction': direction}

def calc_vwap(high: pd.Series, low: pd.Series, close: pd.Series, volume: pd.Series) -> pd.Series:
    """Volume Weighted Average Price."""
    typical_price = (high + low + close) / 3
    cum_vol_price = (typical_price * volume).cumsum()
    cum_vol = volume.cumsum()
    # Avoid div by 0
    vwap = cum_vol_price / cum_vol.replace(0, np.nan)
    return vwap.fillna(close)

def detect_candle_patterns(open_: pd.Series, high: pd.Series, low: pd.Series, close: pd.Series) -> dict:
    """Detect candle patterns on the LAST candle. Returns dict of pattern_name: bool."""
    if len(close) < 3:
        return {
            'bullish_engulfing': False, 'bearish_engulfing': False, 'doji': False, 
            'hammer': False, 'hanging_man': False, 'morning_star': False, 'evening_star': False
        }

    # Use only last two days for most patterns, last 3 for stars
    O = open_.iloc[-1]
    H = high.iloc[-1]
    L = low.iloc[-1]
    C = close.iloc[-1]
    
    O_prev = open_.iloc[-2]
    H_prev = high.iloc[-2]
    L_prev = low.iloc[-2]
    C_prev = close.iloc[-2]

    O_prev2 = open_.iloc[-3]
    C_prev2 = close.iloc[-3]

    body = abs(C - O)
    upper_shadow = H - max(O, C)
    lower_shadow = min(O, C) - L
    
    prev_body = abs(C_prev - O_prev)
    
    # Doji
    doji = body <= (H - L) * 0.1
    
    # Hammer
    hammer = lower_shadow >= 2 * body and upper_shadow <= 0.1 * body and (C_prev < O_prev)
    
    # Hanging Man
    hanging_man = lower_shadow >= 2 * body and upper_shadow <= 0.1 * body and (C_prev > O_prev)
    
    # Bullish Engulfing
    bullish_engulfing = C_prev < O_prev and C > O and O <= C_prev and C >= O_prev
    
    # Bearish Engulfing
    bearish_engulfing = C_prev > O_prev and C < O and O >= C_prev and C <= O_prev
    
    # Morning Star (approximate)
    morning_star = C_prev2 < O_prev2 and (C > O and C > (O_prev2 + C_prev2)/2) and (prev_body <= (H_prev - L_prev) * 0.3) and (C_prev < C_prev2)
    
    # Evening Star (approximate)
    evening_star = C_prev2 > O_prev2 and (C < O and C < (O_prev2 + C_prev2)/2) and (prev_body <= (H_prev - L_prev) * 0.3) and (C_prev > C_prev2)
    
    return {
        'bullish_engulfing': bool(bullish_engulfing),
        'bearish_engulfing': bool(bearish_engulfing),
        'doji': bool(doji),
        'hammer': bool(hammer),
        'hanging_man': bool(hanging_man),
        'morning_star': bool(morning_star),
        'evening_star': bool(evening_star),
    }

def compute_all_indicators(df: pd.DataFrame) -> pd.DataFrame:
    """Takes a DataFrame with columns [open, high, low, close, volume] and adds all indicator columns."""
    if len(df) < 50:
        # Not enough data, return with empty columns
        for c in ['ema_9', 'ema_20', 'ema_50', 'ema_200', 'rsi_14', 'macd', 'macd_signal', 'macd_histogram', 
                  'bb_upper', 'bb_lower', 'bb_bandwidth', 'adx', 'supertrend', 'supertrend_direction', 'vwap',
                  'bullish_engulfing', 'bearish_engulfing', 'doji', 'hammer', 'hanging_man', 'morning_star', 'evening_star']:
            df[c] = np.nan
        return df

    # EMA
    df['ema_9'] = calc_ema(df['close'], 9)
    df['ema_20'] = calc_ema(df['close'], 20)
    df['ema_50'] = calc_ema(df['close'], 50)
    df['ema_200'] = calc_ema(df['close'], 200)
    
    # RSI
    df['rsi_14'] = calc_rsi(df['close'], 14)
    
    # MACD
    macd_res = calc_macd(df['close'])
    df['macd'] = macd_res['macd']
    df['macd_signal'] = macd_res['signal']
    df['macd_histogram'] = macd_res['histogram']
    
    # Bollinger Bands
    bb_res = calc_bollinger(df['close'])
    df['bb_upper'] = bb_res['upper']
    df['bb_lower'] = bb_res['lower']
    df['bb_bandwidth'] = bb_res['bandwidth']
    
    # ADX
    df['adx'] = calc_adx(df['high'], df['low'], df['close'])
    
    # Supertrend
    st_res = calc_supertrend(df['high'], df['low'], df['close'])
    df['supertrend'] = st_res['supertrend']
    df['supertrend_direction'] = st_res['direction']
    
    # VWAP (Intraday VWAP requires intraday data. For daily charts, this is a daily rolling VWAP which isn't standard.
    # But as per spec, we'll calculate it over the available timeframe)
    df['vwap'] = calc_vwap(df['high'], df['low'], df['close'], df['volume'])
    
    # Patterns on last candle
    patterns = detect_candle_patterns(df['open'], df['high'], df['low'], df['close'])
    for k, v in patterns.items():
        # Set all to False, then set the last one
        df[k] = False
        if len(df) > 0:
            df.loc[df.index[-1], k] = v
            
    return df
