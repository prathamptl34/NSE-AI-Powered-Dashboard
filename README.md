---
title: Stock Dashboard
emoji: 📈
colorFrom: blue
colorTo: black
sdk: docker
pinned: false
---

# 📈 Market Pulse — Live Stock Dashboard

Real-time **Nifty 100** and **Nifty Midcap 100** Gainers & Losers dashboard powered by Angel One SmartAPI, FastAPI, and React.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                         Google Cloud Run                         │
│  ┌────────────────┐    ┌─────────────────────────────────────┐  │
│  │  React (build) │◄───│  FastAPI  main.py                   │  │
│  │   /static      │    │  GET /api/market-summary            │  │
│  └────────────────┘    │  GET /api/health                    │  │
│                         │                 │                   │  │
│                         │     streamer.py │                   │  │
│                         │   SmartWebSocketV2 (background)     │  │
│                         └──────────────────────────────────── ┘  │
│                                    │ WSS                          │
│                         ┌──────────▼─────────┐                   │
│                         │  Angel One SmartAPI │                   │
│                         └─────────────────────┘                  │
└─────────────────────────────────────────────────────────────────┘
```

---

## Project Structure

```
stock-dashboard/
├── main.py               # FastAPI app — API routes + SPA serving
├── streamer.py           # Angel One WebSocket feed + tick store
├── requirements.txt      # Python dependencies
├── Dockerfile            # Multi-stage: Node build → Python runtime
├── antigravity.yaml      # Google Cloud Run service config
├── .env.example          # Credential template (copy → .env)
├── package.json          # React app metadata
├── public/
│   └── index.html        # HTML shell with Google Fonts
└── src/
    ├── index.js          # React entry point
    └── App.js            # Full dashboard UI
```

---

## Local Development

### 1. Prerequisites
- Python 3.12+
- Node.js 20+
- Angel One SmartAPI account with TOTP enabled

### 2. Backend setup
```bash
# Clone / enter the directory
cd stock-dashboard

# Create virtualenv
python -m venv .venv && source .venv/bin/activate

# Install Python deps
pip install -r requirements.txt

# Configure credentials
cp .env.example .env
# Edit .env with your Angel One API Key, Client Code, Password, TOTP secret

# Start FastAPI server
uvicorn main:app --reload --port 8000
```

### 3. Frontend setup (development mode)
```bash
# In a separate terminal
npm install
npm start       # proxies /api/* to localhost:8000
```

Open [http://localhost:3000](http://localhost:3000)

### 4. Build for production (served by FastAPI)
```bash
npm run build   # outputs to ./build/
uvicorn main:app --port 8000
# Visit http://localhost:8000
```

---

## Docker Build & Run

```bash
# Build the image
docker build -t stock-dashboard .

# Run with your .env file
docker run --env-file .env -p 8080:8080 stock-dashboard
```

---

## Deploy to Google Cloud Run (Antigravity)

### 1. Create secrets in Secret Manager
```bash
PROJECT_ID=your-gcp-project-id

echo -n "YOUR_API_KEY"      | gcloud secrets create angel-api-key       --data-file=- --project=$PROJECT_ID
echo -n "YOUR_CLIENT_CODE"  | gcloud secrets create angel-client-code   --data-file=- --project=$PROJECT_ID
echo -n "YOUR_PASSWORD"     | gcloud secrets create angel-password       --data-file=- --project=$PROJECT_ID
echo -n "YOUR_TOTP_SECRET"  | gcloud secrets create angel-totp-secret   --data-file=- --project=$PROJECT_ID
```

### 2. Build and push the image
```bash
gcloud builds submit --tag gcr.io/$PROJECT_ID/stock-dashboard
```

### 3. Deploy with antigravity.yaml
```bash
# Update PROJECT_ID in antigravity.yaml first, then:
gcloud run services replace antigravity.yaml --region=asia-south1
```

---

## API Reference

| Endpoint | Method | Description |
|---|---|---|
| `/api/health` | GET | Liveness probe — returns streamer status |
| `/api/market-summary` | GET | Top 5 gainers & losers for both indices |
| `/api/market-summary/raw` | GET | All tracked tokens (debug) |

### Sample `/api/market-summary` response
```json
{
  "nifty100": {
    "gainers": [
      {
        "token": "2885",
        "symbol": "RELIANCE",
        "index": "nifty100",
        "ltp": 2987.45,
        "prev_close": 2920.50,
        "change_pct": 2.29,
        "volume": 4500000,
        "updated_at": "2024-01-15T09:45:00+00:00"
      }
    ],
    "losers": [ ... ]
  },
  "midcap100": { "gainers": [...], "losers": [...] },
  "last_updated": "2024-01-15T09:45:02.123456+00:00",
  "total_tokens_tracked": 35
}
```

---

## Extending Token Coverage

Edit `NIFTY100_TOKENS` and `MIDCAP100_TOKENS` in `streamer.py`.
You can get the full token list from Angel One's scrip master CSV:
```
https://margincalculator.angelbroking.com/OpenAPI_File/files/OpenAPIScripMaster.json
```

---

## Disclaimer

This dashboard is for **informational purposes only**. It is not financial advice. Data is sourced from Angel One SmartAPI; accuracy depends on market connectivity.
