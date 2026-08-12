# start_pc.ps1 - Build and run the Avatar Docker container on Windows
# Run from the repo root: .\scripts\start_pc.ps1

$ErrorActionPreference = "Stop"

$CONTAINER_NAME = "avatar"
$IMAGE_NAME = "avatar"
$PORT = 8000

Write-Host "Stopping existing container '$CONTAINER_NAME' if running..." -ForegroundColor Cyan
docker stop $CONTAINER_NAME 2>$null | Out-Null
docker rm $CONTAINER_NAME 2>$null | Out-Null

Write-Host "Building Docker image '$IMAGE_NAME'..." -ForegroundColor Cyan
docker build -t $IMAGE_NAME .

Write-Host "Starting container '$CONTAINER_NAME' on port $PORT..." -ForegroundColor Cyan
docker run -d `
    --name $CONTAINER_NAME `
    -p "${PORT}:${PORT}" `
    --env-file .env `
    $IMAGE_NAME

Write-Host "Avatar is running at http://localhost:$PORT" -ForegroundColor Green
Write-Host "Admin panel:       http://localhost:$PORT/admin" -ForegroundColor Green
