import os
import pyotp
from SmartApi import SmartConnect

def test_ltp():
    api_key = os.environ.get("ANGEL_API_KEY")
    client_id = os.environ.get("ANGEL_CLIENT_ID")
    password = os.environ.get("ANGEL_PASSWORD")
    totp_secret = os.environ.get("ANGEL_TOTP_SECRET")

    try:
        totp = pyotp.TOTP(totp_secret).now()
        smart = SmartConnect(api_key=api_key)
        sess = smart.generateSession(client_id, password, totp)
        if sess.get("status"):
            print("Login OK")
            # Try a very simple ltpData call
            res = smart.ltpData("NSE", "SBIN", "3045")
            print(f"LTP Result: {res}")
        else:
            print(f"Login failed: {sess}")
    except Exception as e:
        print(f"EXCEPTION: {e}")

if __name__ == "__main__":
    test_ltp()
