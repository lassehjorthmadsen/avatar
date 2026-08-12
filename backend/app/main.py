"""FastAPI application entry point."""

from pathlib import Path

import truststore

# Inject system certificate store before any HTTPS calls
truststore.inject_into_ssl()

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from app.routes.admin import router as admin_router
from app.routes.chat import router as chat_router

app = FastAPI(title="Avatar", version="0.1.0")

# CORS — allow all origins for iframe embedding
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# API routes
app.include_router(chat_router)
app.include_router(admin_router)

# Serve the built frontend static files
# The frontend is built into frontend/dist/ and copied to backend/static/
_static_dir = Path(__file__).parent.parent / "static"
_admin_dir = _static_dir / "admin"

if _static_dir.exists():
    # Serve admin at /admin
    if _admin_dir.exists():
        app.mount("/admin", StaticFiles(directory=_admin_dir, html=True), name="admin")
    # Serve visitor chat at / (must be last mount)
    app.mount("/", StaticFiles(directory=_static_dir, html=True), name="static")
