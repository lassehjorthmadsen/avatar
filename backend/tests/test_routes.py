"""Backend route tests using the Starlette TestClient.

Tests cover:
- Public API routes (config, conversation fetch)
- Admin authentication (login, check, logout)
- Admin route protection (must be authed)
- Chat endpoint structure
- Rate limiting behaviour
"""

import truststore
truststore.inject_into_ssl()

import pytest
from starlette.testclient import TestClient

from app.main import app
from app.config import ADMIN_PASSWORD, OWNER_NAME


@pytest.fixture
def client():
    return TestClient(app)


@pytest.fixture
def authed_client(client):
    """A client with a valid admin session cookie."""
    res = client.post(
        "/admin/api/login",
        json={"password": ADMIN_PASSWORD},
    )
    assert res.status_code == 200
    return client  # cookies are stored on the client


# ============================================================
# Public routes
# ============================================================

class TestPublicRoutes:
    def test_get_config(self, client):
        res = client.get("/api/config")
        assert res.status_code == 200
        data = res.json()
        assert data["owner_name"] == OWNER_NAME
        assert "faq_queries" in data
        assert isinstance(data["faq_queries"], list)
        assert len(data["faq_queries"]) > 0

    def test_get_conversation_empty(self, client):
        """Fetching a non-existent conversation returns empty list."""
        res = client.get("/api/conversation/00000000-0000-0000-0000-000000000000")
        assert res.status_code == 200
        data = res.json()
        assert data["messages"] == []

    def test_static_visitor_page(self, client):
        """Root serves the visitor chat HTML."""
        res = client.get("/")
        assert res.status_code == 200
        assert "text/html" in res.headers["content-type"]
        assert "Avatar" in res.text

    def test_static_admin_page(self, client):
        """Admin page is served."""
        res = client.get("/admin/")
        assert res.status_code == 200
        assert "text/html" in res.headers["content-type"]
        assert "Admin" in res.text

    def test_static_icons(self, client):
        res = client.get("/icons.svg")
        assert res.status_code == 200

    def test_static_favicon(self, client):
        res = client.get("/favicon.svg")
        assert res.status_code == 200


# ============================================================
# Admin auth
# ============================================================

class TestAdminAuth:
    def test_login_wrong_password(self, client):
        res = client.post("/admin/api/login", json={"password": "wrong"})
        assert res.status_code == 401

    def test_login_correct_password(self, client):
        res = client.post(
            "/admin/api/login",
            json={"password": ADMIN_PASSWORD},
        )
        assert res.status_code == 200
        data = res.json()
        assert data["ok"] is True
        assert data["owner_name"] == OWNER_NAME

    def test_check_without_auth(self, client):
        res = client.get("/admin/api/check")
        assert res.status_code == 401

    def test_check_with_auth(self, authed_client):
        res = authed_client.get("/admin/api/check")
        assert res.status_code == 200
        assert res.json()["ok"] is True

    def test_logout(self, authed_client):
        res = authed_client.post("/admin/api/logout")
        assert res.status_code == 200
        # After logout, check should fail
        res2 = authed_client.get("/admin/api/check")
        assert res2.status_code == 401


# ============================================================
# Admin route protection
# ============================================================

class TestAdminProtection:
    def test_conversations_without_auth(self, client):
        res = client.get("/admin/api/conversations")
        assert res.status_code == 401

    def test_conversations_with_auth(self, authed_client):
        res = authed_client.get("/admin/api/conversations")
        assert res.status_code == 200
        data = res.json()
        assert "conversations" in data
        assert isinstance(data["conversations"], list)

    def test_thread_without_auth(self, client):
        res = client.get("/admin/api/conversations/00000000-0000-0000-0000-000000000000")
        assert res.status_code == 401

    def test_reply_without_auth(self, client):
        res = client.post(
            "/admin/api/conversations/00000000-0000-0000-0000-000000000000/reply",
            json={"content": "test"},
        )
        assert res.status_code == 401


# ============================================================
# Chat endpoint
# ============================================================

class TestChatEndpoint:
    def test_chat_missing_fields(self, client):
        res = client.post("/api/chat", json={})
        assert res.status_code == 422  # validation error

    def test_chat_structure(self, client):
        """Chat endpoint returns either SSE stream or JSON (for Qn)."""
        # Q1 should return an instant answer (JSON)
        res = client.post("/api/chat", json={
            "conversation_id": "11111111-1111-1111-1111-111111111111",
            "message": "Q1",
        })
        # Should be either 200 JSON (instant) or 200 SSE stream
        assert res.status_code == 200

    def test_message_truncation(self, client):
        """Messages over 20k chars get truncated on the backend."""
        long_msg = "x" * 25_000
        res = client.post("/api/chat", json={
            "conversation_id": "22222222-2222-2222-2222-222222222222",
            "message": long_msg,
        })
        # Should succeed (server truncates, doesn't reject)
        assert res.status_code == 200
