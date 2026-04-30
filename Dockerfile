# Deployment Version: 1.0.2 - Heatmap Color Fix
# Stage 1: Build React Frontend
FROM node:20-slim AS build-stage
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
RUN npm run build

# Stage 2: Serve with Python/FastAPI
FROM python:3.11-slim
WORKDIR /app

# Install system dependencies for psycopg2-binary and others
RUN apt-get update && apt-get install -y \
    build-essential \
    libpq-dev \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy backend code
COPY . .

# Copy built frontend from Stage 1 into the 'build' directory in backend
COPY --from=build-stage /app/build ./build

# Create a non-root user for Hugging Face Spaces (UID 1000)
RUN useradd -m -u 1000 user && \
    chown -R user:user /app

# Switch to the non-root user
USER user

# Hugging Face Spaces use port 7860 by default
EXPOSE 7860

# Command to run the app
# We use uvicorn directly to ensure it binds to the correct port
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "7860"]
