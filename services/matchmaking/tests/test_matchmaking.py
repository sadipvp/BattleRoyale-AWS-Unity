"""
Matchmaking service tests.

Uses MOCK_GAMELIFT=true and mocked DynamoDB (no real AWS calls).
JWT tokens are generated using the test-secret set in conftest.py.
"""

import os
import pytest
from datetime import datetime, timedelta, timezone
from jose import jwt
from unittest.mock import AsyncMock, patch

os.environ.setdefault("JWT_SECRET", "test-secret")
os.environ.setdefault("MOCK_GAMELIFT", "true")

from app.dynamo_client import dynamo


pytestmark = pytest.mark.asyncio

JWT_SECRET = "test-secret"


def make_token(user_id: str = "user-123", username: str = "testplayer") -> str:
    """Helper: create a valid test JWT."""
    now = datetime.now(timezone.utc)
    payload = {
        "sub": user_id,
        "username": username,
        "iat": now,
        "exp": now + timedelta(hours=1),
    }
    return jwt.encode(payload, JWT_SECRET, algorithm="HS256")


async def test_health(client):
    resp = await client.get("/api/v1/health")
    assert resp.status_code == 200
    assert resp.json()["status"] == "ok"


async def test_join_requires_jwt(client, mock_dynamo):
    resp = await client.post("/api/v1/join")
    assert resp.status_code == 403  # HTTPBearer returns 403 when header missing


async def test_join_success(client, mock_dynamo):
    token = make_token()
    mock_dynamo["put"].return_value = None

    resp = await client.post(
        "/api/v1/join",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert resp.status_code == 200
    data = resp.json()
    assert "ticket_id" in data
    assert data["ticket_id"].startswith("mock-ticket-")

    # Verify DynamoDB put was called
    mock_dynamo["put"].assert_called_once()


async def test_match_status_searching(client, mock_dynamo):
    """When DynamoDB has no completed ticket, should return searching."""
    token = make_token()
    mock_dynamo["get"].return_value = {"ticket_id": "t1", "status": "SEARCHING"}

    # In mock mode, gamelift always returns COMPLETED, so we patch it to SEARCHING
    with patch("app.routes.gamelift.describe_matchmaking", new_callable=AsyncMock) as mock_gl:
        mock_gl.return_value = {"status": "SEARCHING"}
        resp = await client.get(
            "/api/v1/match-status/t1",
            headers={"Authorization": f"Bearer {token}"},
        )

    assert resp.status_code == 200
    assert resp.json()["status"] == "searching"


async def test_match_status_ready_from_cache(client, mock_dynamo):
    """When DynamoDB already has COMPLETED status, return ready without calling GameLift."""
    token = make_token()
    mock_dynamo["get"].return_value = {
        "ticket_id": "t1",
        "status": "COMPLETED",
        "game_session_ip": "10.0.0.1",
        "game_session_port": 7777,
        "player_session_id": "psid-abc",
    }

    resp = await client.get(
        "/api/v1/match-status/t1",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["status"] == "ready"
    assert data["ip"] == "10.0.0.1"
    assert data["port"] == 7777


async def test_match_status_failed(client, mock_dynamo):
    """GameLift TIMED_OUT should map to 'failed'."""
    token = make_token()
    mock_dynamo["get"].return_value = {"ticket_id": "t1", "status": "SEARCHING"}

    with patch("app.routes.gamelift.describe_matchmaking", new_callable=AsyncMock) as mock_gl:
        mock_gl.return_value = {"status": "TIMED_OUT"}
        resp = await client.get(
            "/api/v1/match-status/t1",
            headers={"Authorization": f"Bearer {token}"},
        )

    assert resp.status_code == 200
    assert resp.json()["status"] == "failed"


async def test_match_status_invalid_token(client, mock_dynamo):
    resp = await client.get(
        "/api/v1/match-status/t1",
        headers={"Authorization": "Bearer badtoken"},
    )
    assert resp.status_code == 401
