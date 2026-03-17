import os
import pyotp
from SmartApi import SmartConnect

api_key = os.environ.get("ANGEL_API_KEY")
client_id = os.environ.get("ANGEL_CLIENT_ID")
password = os.environ.get("ANGEL_PASSWORD")
totp_secret = os.environ.get("ANGEL_TOTP_SECRET")

def probe():
    try:
        totp = pyotp.TOTP(totp_secret).now()
        smart = SmartConnect(api_key=api_key)
        # We don't even need to login just to see dir() if it's in the class
        methods = [m for m in dir(smart) if not m.startswith("_")]
        print(f"METHODS: {methods}")
    except Exception as e:
        print(f"ERROR: {e}")

if __name__ == "__main__":
    probe()
