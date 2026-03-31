import yfinance as yf
data = yf.download("HINDALCO.NS DMART.NS", period="1d", interval="5m")
print(data.shape)
if not data.empty:
    print(data['Close'].tail())
