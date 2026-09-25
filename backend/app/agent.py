"""OpenAI Agents SDK setup with OpenRouter backend."""

from __future__ import annotations

import json
from pathlib import Path

import requests
from agents import Agent, ModelSettings, OpenAIChatCompletionsModel, RunConfig, Runner, function_tool
from openai import AsyncOpenAI
from openai.types.shared import Reasoning

from app.config import (
    KNOWLEDGE_DIR,
    MODEL,
    OPENROUTER_API_KEY,
    OWNER_NAME,
    PUSHOVER_TOKEN,
    PUSHOVER_USER,
)

# Load knowledge files
_knowledge_md = (KNOWLEDGE_DIR / "knowledge.md").read_text(encoding="utf-8")
_style_md = (KNOWLEDGE_DIR / "style.md").read_text(encoding="utf-8")

# Load FAQ
_faq_path = KNOWLEDGE_DIR / "faq.jsonl"
_faqs: list[dict] = []
if _faq_path.exists():
    with _faq_path.open(encoding="utf-8") as f:
        _faqs = [json.loads(line) for line in f if line.strip()]

_faqs_lookup = {faq["faq"]: faq for faq in _faqs}

# FAQ listing for the system prompt
_faq_listing = "\n".join(
    f"{faq['faq']}. {faq['query']}" for faq in _faqs
)


# --- Tools ---


def _find_faq(question_number: int) -> str:
    faq = _faqs_lookup.get(question_number)
    if faq:
        return f"**Q{faq['faq']}:** {faq['question']}\n\n{faq['answer']}"
    return "That question number was not found in the FAQ."


@function_tool
def faq_tool(question_number: int) -> str:
    """Retrieve the answer to a frequently asked question by its number.

    Args:
        question_number: The FAQ number to look up
    """
    return _find_faq(question_number)


@function_tool
def push_tool(message: str) -> str:
    """Send a push notification to the human operator (your human twin).

    Use this when:
    - The visitor asks something you cannot answer
    - The visitor wants to get in touch or leave contact info
    - The visitor raises something that needs human involvement

    Args:
        message: The message to send to the human operator
    """
    if not PUSHOVER_USER or not PUSHOVER_TOKEN:
        return "Push notifications are not configured."
    payload = {
        "user": PUSHOVER_USER,
        "token": PUSHOVER_TOKEN,
        "message": message,
    }
    status = requests.post(
        "https://api.pushover.net/1/messages.json",
        data=payload,
        timeout=10,
    ).status_code
    return f"Push notification sent (status {status})."


# --- Instant answer (no LLM) ---


def has_instant_answer(message: str) -> bool:
    """Check if a message is a Qn shortcut (e.g. 'Q2', 'q14')."""
    stripped = message.strip().lower()
    if not stripped.startswith("q"):
        return False
    rest = stripped[1:]
    return rest.isdigit() and 1 <= int(rest) <= len(_faqs)


def get_instant_answer(message: str) -> str:
    """Return the FAQ answer for a Qn shortcut."""
    question_number = int(message.strip()[1:])
    return _find_faq(question_number)


# --- Agent setup ---

# OpenRouter-compatible OpenAI client.
# truststore.inject_into_ssl() is called at app startup (main.py) so
# the default ssl context uses system certs (corporate proxy safe).
_openrouter_client = AsyncOpenAI(
    base_url="https://openrouter.ai/api/v1",
    api_key=OPENROUTER_API_KEY,
)

# Model instance using OpenAI Chat Completions API via OpenRouter
_model = OpenAIChatCompletionsModel(
    model=MODEL,
    openai_client=_openrouter_client,
)


async def run_agent_non_streamed(
    conversation_messages: list[dict],
) -> tuple[str, list[str]]:
    """Run the agent without streaming (fallback).

    Returns the full response text and the names of any tools it called, so
    the caller can flag the thread the same way the streamed path does.
    """
    agent = create_agent()
    prompt = build_conversation_prompt(conversation_messages)
    result = await Runner.run(agent, prompt)
    tools_used = [
        item.tool_name
        for item in result.new_items
        if item.type == "tool_call_item" and item.tool_name
    ]
    return (result.final_output or ""), tools_used

SYSTEM_PROMPT = f"""# Your role

You are the Digital Twin of {OWNER_NAME}, running on their personal website.
You represent {OWNER_NAME} and answer questions from visitors about their
career, writing, journalism, data science projects, books, talks, and background.

You are having a multi-party conversation. There are up to 3 participants:
- **Visitor**: The person chatting with you (their messages are marked [Visitor])
- **You (Avatar)**: The digital twin — that's you
- **Human ({OWNER_NAME})**: The real person may occasionally join the conversation
  (their messages are marked [Human]). When they do, acknowledge their presence
  naturally but don't repeat or rephrase what they said.

# About {OWNER_NAME}

{_knowledge_md}

# Your style and personality

{_style_md}

# FAQ tool

You have a FAQ tool with numbered answers. Below is the routing list — if the
visitor's question matches one of these topics, use the faq_tool to retrieve
the full answer. Keep its content and all of its links, but the FAQ is written
in English: if the visitor writes in Danish, translate the answer into Danish.

{_faq_listing}

# Push notification tool

Use the push_tool to notify the real {OWNER_NAME} when:
- You can't answer a question (tell the visitor you've notified the human)
- The visitor wants to get in touch or leaves contact info
- Something clearly needs human involvement

# Rules

- Always stay in character as the digital twin of {OWNER_NAME}
- Reply in the language of the visitor's most recent message: Danish if it is
  in Danish, English if it is in English. Use that one language for the whole
  reply, even when the material you draw on (this prompt, the FAQ, earlier
  turns) is in the other language.
- Never make up information. If you don't know, say so and use push_tool.
- Use markdown formatting for readability
- Never use emojis
- Keep responses concise and engaging
"""


def build_conversation_prompt(messages: list[dict]) -> str:
    """Build a single user prompt summarizing the full conversation so far.

    Per the spec, we send 1 user prompt with the full conversation history
    (all roles) rather than alternating user/assistant messages, because
    this is a multi-party conversation.
    """
    lines = []
    for msg in messages:
        role = msg["role"]
        content = msg["content"]
        if role == "user":
            name = msg.get("conversation_name") or "Visitor"
            lines.append(f"[Visitor ({name})]: {content}")
        elif role == "assistant":
            lines.append(f"[Avatar]: {content}")
        elif role == "human":
            lines.append(f"[Human ({OWNER_NAME})]: {content}")
    return "\n\n".join(lines)


def create_agent() -> Agent:
    """Create a fresh agent instance.

    max_tokens is capped: without it OpenRouter reserves the model's full
    context for the completion and rejects the request (402) unless the
    account balance covers that worst case. The budget must also cover the
    model's *reasoning* tokens, which are spent before any visible text — too
    low a cap and the reply comes back empty. Low reasoning effort keeps most
    of the budget (and the latency) on the answer itself, which is what a
    conversational twin needs.
    """
    return Agent(
        name="Avatar",
        model=_model,
        instructions=SYSTEM_PROMPT,
        tools=[faq_tool, push_tool],
        model_settings=ModelSettings(
            max_tokens=16000,
            reasoning=Reasoning(effort="low"),
        ),
    )


async def run_agent_streamed(conversation_messages: list[dict]):
    """Run the agent with streaming, yielding text deltas and tool events.

    Yields tuples of (event_type, data):
    - ("text", str) for text content
    - ("tool_start", tool_name) when a tool is called
    - ("tool_end", None) when a tool returns
    - ("done", full_response) when complete
    """
    from openai.types.responses import ResponseTextDeltaEvent

    agent = create_agent()
    prompt = build_conversation_prompt(conversation_messages)

    result = Runner.run_streamed(agent, prompt)

    full_text = ""
    async for event in result.stream_events():
        if event.type == "raw_response_event":
            # The SDK normalises OpenRouter's chat-completion chunks into
            # Responses-API events, so watch for text deltas — not `choices`.
            if isinstance(event.data, ResponseTextDeltaEvent) and event.data.delta:
                full_text += event.data.delta
                yield ("text", event.data.delta)
        elif event.type == "run_item_stream_event":
            if event.name == "tool_called":
                tool_name = getattr(event.item, "tool_name", "tool")
                yield ("tool_start", tool_name)
            elif event.name == "tool_output":
                yield ("tool_end", None)

    yield ("done", full_text)


def get_faq_queries() -> list[dict]:
    """Return FAQ numbers and questions for the frontend's example prompts.

    The `query` field is routing shorthand for the model ("books / novels /
    fiction"); it reads as machine input, and clicking a suggestion submits the
    text verbatim. So the frontend gets the first sentence of the real
    `question` instead — a question a visitor would plausibly ask.
    """
    return [
        {"faq": f["faq"], "query": _first_question(f["question"])} for f in _faqs
    ]


def _first_question(question: str) -> str:
    """Most FAQ questions are a pair ("What books...? What are they about?").
    Take just the first for a compact suggestion chip."""
    head, sep, _ = question.partition("?")
    return f"{head}{sep}" if sep else question
