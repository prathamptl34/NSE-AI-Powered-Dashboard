# ─────────────────────────────────────────────────────────────────────────────
# Stage 1 — Build React frontend
# ─────────────────────────────────────────────────────────────────────────────
FROM node:20-alpine AS frontend-builder

WORKDIR /app

# Cache node_modules layer
COPY package.json package-lock.json* ./
RUN npm ci --silent

# Copy source and build (resilient to flat structure)
COPY . .
RUN mkdir -p public src && \
    [ -f index.html ] && mv index.html public/ || true && \
    [ -f App.js ]     && mv App.js src/     || true && \
    [ -f index.js ]   && mv index.js src/    || true && \
    [ -f index.css ]  && mv index.css src/   || true && \
    npm run build


# ─────────────────────────────────────────────────────────────────────────────
# Stage 2 — Python backend + compiled frontend
# ─────────────────────────────────────────────────────────────────────────────
FROM python:3.12-slim AS final

# Security: run as non-root
RUN addgroup --system appgroup && adduser --system --ingroup appgroup --home /app appuser

WORKDIR /app

# Install Python dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy backend source
COPY main.py streamer.py historical.py nse_holidays.py signal_engine.py ./
COPY tokens.json* .env.example* ./

# Copy compiled React build from stage 1
COPY --from=frontend-builder /app/build ./build

# Switch to non-root user
USER appuser

# Hugging Face Spaces listens on port 7860
ENV PORT=7860

EXPOSE 7860

# Uvicorn with multiple workers
CMD ["sh", "-c", "uvicorn main:app --host 0.0.0.0 --port $PORT --workers 2"]
