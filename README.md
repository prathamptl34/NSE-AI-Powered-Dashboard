---
title: Stock Dashboard
emoji: 📈
colorFrom: blue
colorTo: green
sdk: docker
pinned: false
---

# Stock Dashboard - Gemma 4 Powered

A live NSE Stock Dashboard featuring real-time market data from Angel One SmartAPI and AI-powered insights using **Gemma 4** via the Hugging Face Inference API.

## Features
- **Real-time Streaming**: Live Nifty 100 & Midcap 100 movers via WebSockets.
- **AI Analyst**: Smart market commentary powered by Google's Gemma 4.
- **Fear & Greed Index**: Visual market sentiment tracking.
- **Sector Heatmap**: Instant overview of sector performance.

## Deployment on Hugging Face
To run this project on Hugging Face Spaces:

1. Create a new Space with the **Docker** SDK.
2. Add the following **Secrets** in your Space settings:
   - `ANGEL_API_KEY`: Your Angel One API Key.
   - `ANGEL_CLIENT_ID`: Your Angel One Client ID.
   - `ANGEL_PASSWORD`: Your Angel One Password.
   - `ANGEL_TOTP_SECRET`: Your Angel One TOTP Secret.
   - `GROQ_API_KEY`: Your Groq API Key (for fallback).
   - `HUGGINGFACE_API_KEY`: Your Hugging Face Access Token.
3. Push the code to the Space repository.

## Local Setup
1. Clone the repository.
2. Install dependencies: `pip install -r requirements.txt` and `npm install`.
3. Create a `.env` file with your credentials.
4. Run the backend: `python main.py`.
5. Run the frontend: `npm start`.
