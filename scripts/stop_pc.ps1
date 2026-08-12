# stop_pc.ps1 - Stop and remove the Avatar Docker container on Windows
# Run from anywhere: .\scripts\stop_pc.ps1

$ErrorActionPreference = "SilentlyContinue"

$CONTAINER_NAME = "avatar"

Write-Host "Stopping container '$CONTAINER_NAME'..." -ForegroundColor Cyan
docker stop $CONTAINER_NAME | Out-Null
docker rm $CONTAINER_NAME | Out-Null

Write-Host "Container '$CONTAINER_NAME' stopped and removed." -ForegroundColor Green
