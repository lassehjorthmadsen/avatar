"""Visitor-facing chat routes."""

from __future__ import annotations

import json
import re

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import StreamingResponse
from limits import RateLimitItemPerMinute
from limits.storage import MemoryStorage
from limits.strategies import MovingWindowRateLimiter
from pydantic import BaseModel

from app.agent import (
    get_faq_queries,
    get_instant_answer,
    has_instant_answer,
    run_agent_non_streamed,
    run_agent_streamed,
)
from app.config import OWNER_NAME
from app.database import (
    get_conversation,
    get_messages_since,
    insert_message,
)

router = APIRouter(prefix="/api")

# Rate limiting: 20 messages per minute per conversation_id
_storage = MemoryStorage()
_limiter = MovingWindowRateLimiter(_storage)
_rate = RateLimitItemPerMinute(20)

# Message length limit
MAX_MESSAGE_LENGTH = 20_000


class ChatRequest(BaseModel):
    conversation_id: str
    message: str
    conversation_name: str | None = None


class PollRequest(BaseModel):
    conversation_id: str
    since: str  # ISO timestamp


@router.get("/config")
async def get_config():
    """Return public config for the frontend."""
    return {
        "owner_name": OWNER_NAME,
        "faq_queries": get_faq_queries(),
    }


@router.get("/conversation/{conversation_id}")
async def get_conversation_history(conversation_id: str):
    """Fetch the full conversation history."""
    messages = get_conversation(conversation_id)
    return {"messages": messages}


@router.post("/conversation/{conversation_id}/poll")
async def poll_for_updates(conversation_id: str, body: PollRequest):
    """Poll for new messages since a timestamp (for human messages)."""
    messages = get_messages_since(conversation_id, body.since)
    return {"messages": messages}


@router.post("/chat")
async def chat(body: ChatRequest):
    """Handle a visitor chat message. Returns SSE stream."""
    cid = body.conversation_id

    # Rate limit check
    if not _limiter.hit(_rate, cid):
        raise HTTPException(
            status_code=429,
            detail="You're sending messages too quickly. Please wait a moment.",
        )

    # Truncate overly long messages
    message = body.message
    if len(message) > MAX_MESSAGE_LENGTH:
        message = (
            message[:MAX_MESSAGE_LENGTH]
            + "\n[...message truncated as it's too long; ask the visitor to send something more concise]"
        )

    # Check for Qn instant answer
    if has_instant_answer(message):
        answer = get_instant_answer(message)
        # Store both messages
        insert_message(
            cid, "user", message, conversation_name=body.conversation_name
        )
        row = insert_message(cid, "assistant", answer)
        return {"type": "instant", "content": answer, "message": row}

    # Store user message
    insert_message(
        cid, "user", message, conversation_name=body.conversation_name
    )

    # Get full conversation for context
    conversation = get_conversation(cid)

    # Stream the agent response via SSE
    async def event_stream():
        full_response = ""
        tools_used: list[str] = []
        try:
            async for event_type, data in run_agent_streamed(conversation):
                if event_type == "text":
                    full_response += data
                    yield f"data: {json.dumps({'type': 'text', 'content': data})}\n\n"
                elif event_type == "tool_start":
                    tools_used.append(data)
                    yield f"data: {json.dumps({'type': 'tool_start', 'tool': data})}\n\n"
                elif event_type == "tool_end":
                    yield f"data: {json.dumps({'type': 'tool_end'})}\n\n"
                elif event_type == "done":
                    full_response = data if data else full_response
        except Exception as e:
            # If streaming fails, fall back to non-streamed response
            if not full_response:
                try:
                    full_response, fallback_tools = await run_agent_non_streamed(conversation)
                    tools_used.extend(fallback_tools)
                    yield f"data: {json.dumps({'type': 'text', 'content': full_response})}\n\n"
                except Exception as fallback_err:
                    yield f"data: {json.dumps({'type': 'error', 'content': str(fallback_err)})}\n\n"
                    return
            else:
                yield f"data: {json.dumps({'type': 'error', 'content': str(e)})}\n\n"

        # A stream that completes without emitting any text is a failure too —
        # retry once without streaming rather than leaving the visitor hanging.
        if not full_response:
            try:
                full_response, fallback_tools = await run_agent_non_streamed(conversation)
                tools_used.extend(fallback_tools)
                if full_response:
                    yield f"data: {json.dumps({'type': 'text', 'content': full_response})}\n\n"
            except Exception as fallback_err:
                yield f"data: {json.dumps({'type': 'error', 'content': str(fallback_err)})}\n\n"
                return

        # Store the complete assistant response. Firing push_tool means the
        # twin escalated to the human, so the thread is flagged for attention
        # in admin until they open it (SPEC Q&A #5).
        if full_response:
            row = insert_message(
                cid,
                "assistant",
                full_response,
                needs_attention="push_tool" in tools_used,
                tool_use={"tools": tools_used} if tools_used else None,
            )
            yield f"data: {json.dumps({'type': 'done', 'message': row})}\n\n"

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )
