# Market Pulse - Project Summary for LLM Models

This document provides a comprehensive summary of the Market Pulse project, detailing its architecture, tech stack, file structure, and key features. It is designed to be shared with LLMs to provide context about the codebase.

## 1. Project Overview
**Market Pulse** is a high-performance, real-time financial dashboard for the National Stock Exchange (NSE) of India. It provides live streaming of top gainers/losers, technical signal scanning, sector heatmaps, and AI-powered market analysis. The system is optimized to handle high-frequency data updates with minimal latency and UI lag.

## 2. Technology Stack
*   **Frontend**: React 18 (using Hooks, Memoization, and optimized rendering)
*   **Styling**: Custom CSS with Glassmorphism aesthetics and a responsive grid system.
*   **Backend**: FastAPI (Asynchronous Python 3.11)
*   **Data Source**: Angel One SmartAPI (WebSocket V2 for live ticks & REST for fallback/historical)
*   **AI Engine**: Google Gemini Pro / Gemma 4 (via Hugging Face Inference API or direct API)
*   **Database**: SQLAlchemy with PostgreSQL (indicated in requirements, likely for persistent state or caching)
*   **Deployment**: Docker (Multi-stage build) on Hugging Face Spaces (runs as a non-root user UID 1000).

## 3. Architecture & Data Flow
The project follows a decoupled architecture where the backend handles data ingestion and heavy processing, and the frontend polls for updates to maintain high performance.

1.  **Data Ingestion (`backend/streamer.py`)**:
    *   Establishes an asynchronous WebSocket connection to Angel One SmartAPI.
    *   Processes raw binary tick data and normalizes it into JSON.
    *   Maintains a thread-safe local state of the Top 20 Gainers/Losers.
    *   Throttles updates to prevent UI bottlenecking.

2.  **API & Orchestration (`main.py`)**:
    *   Exposes REST endpoints for the frontend (e.g., `/api/movers`, `/api/market-summary`, `/api/ai-insight`).
    *   Orchestrates LLM analysis by piping real-time stock data into structured prompts to generate "Why it's moving" narratives.
    *   Serves the built React frontend in production.

3.  **Frontend Engine (`src/App.js` & Components)**:
    *   **Polling Strategy**: The frontend polls the backend every 2 seconds for live data to avoid overwhelming the browser with raw WebSocket streams.
    *   **Performance Optimization**: Uses `React.memo` and `useRef` to skip expensive re-renders on high-frequency updates.
    *   **Animations**: Uses CSS transforms and `requestAnimationFrame` for "Price Flashes" without unmounting components, eliminating layout shifts.
    *   **Server-Sent Events (SSE)**: Used in the Heatmap component for streaming updates.

## 4. Key Features
*   **Real-Time Movers**: Live tracking of Top 20 Gainers and Losers in Nifty 100 & Midcap 100.
*   **Sector Heatmap**: Visual grid representation of sector-wise performance.
*   **Signal Scanner**: Real-time tracking of volume breakouts, RSI momentum, and technical signals.
*   **AI Analyst**: On-demand AI deep-dives into specific stock catalysts ("Why it's moving").
*   **Fear & Greed Index**: Visual market sentiment tracking.

## 5. Directory Structure
```text
gainer-looser/
├── backend/                  # Backend core modules
│   ├── streamer.py           # Angel One WebSocket client & data processor
│   ├── signal_engine.py      # Technical signal generation logic
│   ├── historical.py         # Historical data fetching
│   ├── fno_universe.py       # F&O symbol definitions
│   └── tv_mcp_client.py      # TradingView / MCP client integration
├── src/                      # React Frontend Source
│   ├── App.js                # Main application component & polling logic
│   ├── Heatmap.js            # Sectoral heatmap visualization
│   ├── SignalScanner.js      # Technical signals interface
│   ├── InsightsPage.js       # AI analysis and commentary view
│   ├── MoversSection.js      # Top gainers/losers display
│   ├── StockDeepDive.js      # Detailed stock analysis view
│   └── index.css             # Global styles (Glassmorphism, Dark mode)
├── main.py                   # FastAPI application server & API routes
├── Dockerfile                # Multi-stage production build configuration
├── requirements.txt          # Python dependencies (FastAPI, AngelOne, AI libs)
└── package.json              # Frontend dependencies (React, Recharts)
```

## 6. Key Optimizations
*   **UI Stability**: Prevented forced component remounts during price updates to fix blank space glitches.
*   **Security**: Runs as user `1000` in Docker for Hugging Face Spaces compliance.
*   **Fallback Mechanisms**: Implements fallback URLs in the frontend if the primary API path fails.
