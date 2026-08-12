"""Supabase database operations for the messages table."""

from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Any

from supabase import Client, create_client

from app.config import SUPABASE_KEY, SUPABASE_URL

_client: Client | None = None


def get_client() -> Client:
    global _client
    if _client is None:
        _client = create_client(SUPABASE_URL, SUPABASE_KEY)
    return _client


def new_conversation_id() -> str:
    return str(uuid.uuid4())


def insert_message(
    conversation_id: str,
    role: str,
    content: str,
    conversation_name: str | None = None,
    tool_use: dict | None = None,
    needs_attention: bool = False,
) -> dict[str, Any]:
    """Insert a message and return the created row."""
    row = {
        "conversation_id": conversation_id,
        "role": role,
        "content": content,
        "needs_attention": needs_attention,
        "is_read": role != "user",  # user messages start unread for admin
    }
    if conversation_name:
        row["conversation_name"] = conversation_name
    if tool_use:
        row["tool_use"] = tool_use
    result = get_client().table("messages").insert(row).execute()
    return result.data[0]


def get_conversation(conversation_id: str) -> list[dict[str, Any]]:
    """Fetch all messages for a conversation, ordered by time."""
    result = (
        get_client()
        .table("messages")
        .select("*")
        .eq("conversation_id", conversation_id)
        .order("created_at")
        .execute()
    )
    return result.data


def get_conversation_name(messages: list[dict[str, Any]]) -> str | None:
    """Derive conversation name from loaded messages (no extra query)."""
    for msg in messages:
        if msg.get("conversation_name"):
            return msg["conversation_name"]
    # Fall back to first user message content (truncated)
    for msg in messages:
        if msg["role"] == "user":
            text = msg["content"][:40]
            return text + ("..." if len(msg["content"]) > 40 else "")
    return None


def list_conversations() -> list[dict[str, Any]]:
    """List all conversations for the admin inbox.

    Returns one summary row per conversation: id, name, last message time,
    first user initial, has unread, needs attention.
    """
    # Get all messages ordered by time descending
    result = (
        get_client()
        .table("messages")
        .select("conversation_id, role, content, conversation_name, is_read, needs_attention, created_at")
        .order("created_at", desc=True)
        .execute()
    )
    # Group by conversation_id
    conversations: dict[str, dict] = {}
    for row in result.data:
        cid = row["conversation_id"]
        if cid not in conversations:
            conversations[cid] = {
                "conversation_id": cid,
                "conversation_name": None,
                "last_message_at": row["created_at"],
                "snippet": "",
                "initials": "?",
                "has_unread": False,
                "needs_attention": False,
            }
        conv = conversations[cid]
        # Set name from first non-null conversation_name found
        if not conv["conversation_name"] and row.get("conversation_name"):
            conv["conversation_name"] = row["conversation_name"]
        # Track unread / attention
        if not row["is_read"]:
            conv["has_unread"] = True
        if row["needs_attention"]:
            conv["needs_attention"] = True
        # Get initials and snippet from first user message
        if row["role"] == "user" and conv["initials"] == "?":
            conv["initials"] = row["content"][:2].upper()
            conv["snippet"] = row["content"][:60]

    # Sort by most recent first
    sorted_convos = sorted(
        conversations.values(),
        key=lambda c: c["last_message_at"],
        reverse=True,
    )
    return sorted_convos


def mark_conversation_read(conversation_id: str) -> list[dict[str, Any]]:
    """Mark all messages in a conversation as read and clear needs_attention.

    Returns the updated rows in one PostgREST call.
    """
    result = (
        get_client()
        .table("messages")
        .update({"is_read": True, "needs_attention": False})
        .eq("conversation_id", conversation_id)
        .execute()
    )
    return result.data


def get_messages_since(
    conversation_id: str, since: str
) -> list[dict[str, Any]]:
    """Get messages newer than a timestamp (for polling)."""
    result = (
        get_client()
        .table("messages")
        .select("*")
        .eq("conversation_id", conversation_id)
        .gt("created_at", since)
        .order("created_at")
        .execute()
    )
    return result.data
