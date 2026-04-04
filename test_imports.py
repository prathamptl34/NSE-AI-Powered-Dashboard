import sys
print("Imports starting...")
import fastapi
print("FastAPI imported")
import uvicorn
print("Uvicorn imported")
print("Importing streamer...")
from backend.streamer import MarketStreamer
print("Streamer imported")
print("Done!")
