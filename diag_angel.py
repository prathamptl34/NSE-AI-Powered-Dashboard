
import os
import sys
import asyncio
import pyotp
import logging
from dotenv import load_dotenv
from SmartApi import SmartConnect

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("Diagnostic")

# Search for .env in current and parent dirs
load_dotenv()

async def diag():
    api_key = os.getenv("ANGEL_API_KEY", "").strip()
    client_id = os.getenv("ANGEL_CLIENT_ID", "").strip()
    password = os.getenv("ANGEL_PASSWORD", "").strip()
    totp_secret = os.getenv("ANGEL_TOTP_SECRET", "").strip()

    logger.info(f"Checking credentials for {client_id}...")
    
    if not all([api_key, client_id, password, totp_secret]):
        logger.error("Missing credentials in .env")
        return

    try:
        totp = pyotp.TOTP(totp_secret).now()
        smart = SmartConnect(api_key=api_key)
        data = smart.generateSession(client_id, password, totp)
        
        if data["status"] is False:
            logger.error(f"Login Failed: {data['message']}")
            if "Static IP" in data['message']:
                logger.error("ACTION REQUIRED: Update your IP on Angel One portal.")
            return
        
        logger.info("Login Successful!")
        feed_token = smart.getfeedToken()
        logger.info(f"Feed Token obtained: {feed_token[:5]}...")

        # Test historical
        logger.info("Testing historical API (SBIN token 3045)...")
        res = smart.getCandleData({
            "exchange": "NSE",
            "symboltoken": "3045",
            "interval": "ONE_DAY",
            "fromdate": "2026-03-25 09:15",
            "todate": "2026-04-01 15:30"
        })
        if res and res.get('status'):
            logger.info(f"Historical API OK. Received {len(res.get('data', []))} rows.")
        else:
            logger.error(f"Historical API Failed: {res.get('message')}")

    except Exception as e:
        logger.error(f"Diagnostic Error: {e}")

if __name__ == "__main__":
    asyncio.run(diag())
