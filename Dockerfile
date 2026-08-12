# Stage 1: Build the Vite/TypeScript frontend
FROM node:22-alpine AS frontend-build
WORKDIR /app/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

# Stage 2: Python backend
FROM python:3.12-slim AS backend

# Install uv
COPY --from=ghcr.io/astral-sh/uv:latest /uv /usr/local/bin/uv

# Set working directory
WORKDIR /app

# Needed so uv can copy packages into the venv without hardlinks
# (avoids errors on some filesystems / Docker overlays)
ENV UV_LINK_MODE=copy

# Install backend dependencies (leverages Docker layer caching)
COPY backend/pyproject.toml backend/uv.lock backend/.python-version ./
RUN uv sync --frozen --no-dev

# Copy backend application code (tests are excluded via .dockerignore)
COPY backend/app/ ./app/

# Copy built frontend into the location the backend serves static files from
COPY --from=frontend-build /app/frontend/dist ./static/

# Copy knowledge files (owner profile, FAQ, style, photo)
COPY knowledge/ ./knowledge/

# Expose the application port
EXPOSE 8000

# Run the FastAPI app with uvicorn
CMD ["uv", "run", "uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
