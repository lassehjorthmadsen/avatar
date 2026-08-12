#!/usr/bin/env bash
# start_mac.sh - Build and run the Avatar Docker container on macOS/Linux
# Run from the repo root: bash scripts/start_mac.sh
set -euo pipefail

CONTAINER_NAME="avatar"
IMAGE_NAME="avatar"
PORT=8000

# Navigate to the repo root (the directory containing this script's parent)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

echo "Stopping existing container '$CONTAINER_NAME' if running..."
docker stop "$CONTAINER_NAME" 2>/dev/null || true
docker rm   "$CONTAINER_NAME" 2>/dev/null || true

echo "Building Docker image '$IMAGE_NAME'..."
docker build -t "$IMAGE_NAME" .

echo "Starting container '$CONTAINER_NAME' on port $PORT..."
docker run -d \
    --name "$CONTAINER_NAME" \
    -p "${PORT}:${PORT}" \
    --env-file .env \
    "$IMAGE_NAME"

echo "Avatar is running at http://localhost:${PORT}"
echo "Admin panel:       http://localhost:${PORT}/admin"
