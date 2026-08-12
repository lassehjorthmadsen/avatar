#!/usr/bin/env bash
# stop_mac.sh - Stop and remove the Avatar Docker container on macOS/Linux
# Run from anywhere: bash scripts/stop_mac.sh
set -euo pipefail

CONTAINER_NAME="avatar"

echo "Stopping container '$CONTAINER_NAME'..."
docker stop "$CONTAINER_NAME" 2>/dev/null || true
docker rm   "$CONTAINER_NAME" 2>/dev/null || true

echo "Container '$CONTAINER_NAME' stopped and removed."
