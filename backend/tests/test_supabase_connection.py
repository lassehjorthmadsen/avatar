"""Connectivity check for the Supabase messages table.

Verifies that the credentials in the project-root .env work and that the
expected table is reachable via the Data API using the secret key.
"""

import os
from pathlib import Path

import pytest
import truststore
from dotenv import load_dotenv
from supabase import Client, create_client

# Inject Windows/macOS system certificate store into Python's SSL defaults.
# This ensures corporate proxy CA certs are trusted without manual config.
truststore.inject_into_ssl()

PROJECT_ROOT = Path(__file__).resolve().parents[2]
load_dotenv(PROJECT_ROOT / ".env", override=True)

EXPECTED_COLUMNS = {
    "id",
    "conversation_id",
    "conversation_name",
    "role",
    "content",
    "tool_use",
    "needs_attention",
    "is_read",
    "created_at",
}


@pytest.fixture(scope="module")
def client() -> Client:
    url = os.environ["SUPABASE_URL"]
    key = os.environ["SUPABASE_KEY"]
    return create_client(url, key)


def test_env_present():
    assert os.environ.get("SUPABASE_URL", "").startswith("https://")
    # Accept both legacy JWT keys and newer sb_secret_ format
    key = os.environ.get("SUPABASE_KEY", "")
    assert key.startswith("eyJ") or key.startswith("sb_secret_")


def test_messages_table_reachable(client: Client):
    """The table is queryable through the Data API with the secret key."""
    result = client.table("messages").select("*").limit(1).execute()
    assert isinstance(result.data, list)


def test_insert_and_delete_roundtrip(client: Client):
    """A full write/read/delete cycle works and stores the expected columns."""
    conversation_id = "00000000-0000-0000-0000-000000000000"
    inserted = (
        client.table("messages")
        .insert(
            {
                "conversation_id": conversation_id,
                "role": "user",
                "content": "connectivity test",
            }
        )
        .execute()
    )
    row = inserted.data[0]
    try:
        assert EXPECTED_COLUMNS.issubset(row.keys())
        assert row["role"] == "user"
        assert row["needs_attention"] is False
        assert row["is_read"] is True
    finally:
        client.table("messages").delete().eq("id", row["id"]).execute()
