import time
print("Importing SmartApi...")
start = time.time()
from SmartApi import SmartConnect
print(f"SmartConnect imported in {time.time()-start:.2f}s")

print("Importing smartWebSocketV2...")
start = time.time()
from SmartApi.smartWebSocketV2 import SmartWebSocketV2
print(f"SmartWebSocketV2 imported in {time.time()-start:.2f}s")

print("Importing fno_universe...")
start = time.time()
from backend.fno_universe import FNO_SYMBOL_TOKEN_MAP
print(f"fno_universe imported in {time.time()-start:.2f}s")
print("Done!")
