"""Admin dashboard routes — protected by session cookie."""

from __future__ import annotations

from fastapi import APIRouter, Cookie, HTTPException, Response
from itsdangerous import BadSignature, URLSafeTimedSerializer
from pydantic import BaseModel

from app.config import ADMIN_PASSWORD, COOKIE_SECURE, OWNER_NAME, SESSION_SECRET
from app.database import (
    get_conversation,
    insert_message,
    list_conversations,
    mark_conversation_read,
)

router = APIRouter(prefix="/admin/api")

_serializer = URLSafeTimedSerializer(SESSION_SECRET)
_COOKIE_NAME = "avatar_admin_session"
_MAX_AGE = 60 * 60 * 24 * 7  # 7 days


def _sign_token() -> str:
    return _serializer.dumps({"role": "admin"})


def _verify_token(token: str) -> bool:
    try:
        _serializer.loads(token, max_age=_MAX_AGE)
        return True
    except BadSignature:
        return False


def _require_auth(avatar_admin_session: str | None):
    if not avatar_admin_session or not _verify_token(avatar_admin_session):
        raise HTTPException(status_code=401, detail="Not authenticated")


class LoginRequest(BaseModel):
    password: str


class HumanMessageRequest(BaseModel):
    content: str


@router.post("/login")
async def login(body: LoginRequest, response: Response):
    """Authenticate with the admin password."""
    if body.password != ADMIN_PASSWORD:
        raise HTTPException(status_code=401, detail="Invalid password")
    token = _sign_token()
    response.set_cookie(
        key=_COOKIE_NAME,
        value=token,
        httponly=True,
        secure=COOKIE_SECURE,
        samesite="lax",
        max_age=_MAX_AGE,
        path="/",
    )
    return {"ok": True, "owner_name": OWNER_NAME}


@router.post("/logout")
async def logout(response: Response):
    """Clear the admin session."""
    response.delete_cookie(key=_COOKIE_NAME, path="/")
    return {"ok": True}


@router.get("/check")
async def check_auth(avatar_admin_session: str | None = Cookie(None)):
    """Check if the current session is authenticated."""
    if not avatar_admin_session or not _verify_token(avatar_admin_session):
        raise HTTPException(status_code=401, detail="Not authenticated")
    return {"ok": True, "owner_name": OWNER_NAME}


@router.get("/conversations")
async def get_conversations(avatar_admin_session: str | None = Cookie(None)):
    """List all conversations for the admin inbox."""
    _require_auth(avatar_admin_session)
    conversations = list_conversations()
    return {"conversations": conversations}


@router.get("/conversations/{conversation_id}")
async def get_thread(
    conversation_id: str,
    avatar_admin_session: str | None = Cookie(None),
):
    """Get full conversation thread and mark it as read."""
    _require_auth(avatar_admin_session)
    # Mark read and clear attention in one call
    mark_conversation_read(conversation_id)
    # Fetch the conversation
    messages = get_conversation(conversation_id)
    return {"messages": messages}


@router.post("/conversations/{conversation_id}/reply")
async def post_human_reply(
    conversation_id: str,
    body: HumanMessageRequest,
    avatar_admin_session: str | None = Cookie(None),
):
    """Post a human message into a conversation thread."""
    _require_auth(avatar_admin_session)
    row = insert_message(conversation_id, "human", body.content)
    return {"message": row}
