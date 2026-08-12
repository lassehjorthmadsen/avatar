"""Application configuration loaded from environment variables."""

import os
from pathlib import Path

from dotenv import load_dotenv

PROJECT_ROOT = Path(__file__).resolve().parents[2]
load_dotenv(PROJECT_ROOT / ".env", override=True)

# LLM
OPENROUTER_API_KEY: str = os.environ["OPENROUTER_API_KEY"]
MODEL: str = os.getenv("MODEL", "openai/gpt-5.4-nano")

# Owner identity
OWNER_NAME: str = os.getenv("OWNER_NAME", "Lasse Hjorth Madsen")

# Admin auth
ADMIN_PASSWORD: str = os.environ["ADMIN_PASSWORD"]
SESSION_SECRET: str = os.getenv("SESSION_SECRET", f"avatar::{ADMIN_PASSWORD}")
COOKIE_SECURE: bool = os.getenv("COOKIE_SECURE", "0") == "1"

# Supabase
SUPABASE_URL: str = os.environ["SUPABASE_URL"]
SUPABASE_KEY: str = os.environ["SUPABASE_KEY"]

# Pushover
PUSHOVER_USER: str = os.getenv("PUSHOVER_USER", "")
PUSHOVER_TOKEN: str = os.getenv("PUSHOVER_TOKEN", "")

# Knowledge paths — works both locally (project_root/knowledge)
# and in Docker (WORKDIR/knowledge)
KNOWLEDGE_DIR = PROJECT_ROOT / "knowledge"
if not KNOWLEDGE_DIR.exists():
    # Docker: knowledge is at the same level as the app
    KNOWLEDGE_DIR = Path(__file__).resolve().parent.parent / "knowledge"
