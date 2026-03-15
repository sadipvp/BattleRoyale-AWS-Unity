"""
Test fixtures for the Matchmaking service.

All GameLift and DynamoDB calls are mocked — no AWS credentials needed in CI.
MOCK_GAMELIFT=true is set so gamelift_client returns fake data without boto3 calls.
"""

import os
import pytest
import pytest_asyncio
from httpx import AsyncClient, ASGITransport
from unittest.mock import AsyncMock, patch, MagicMock

os.environ.setdefault("JWT_SECRET", "test-secret")
os.environ.setdefault("MOCK_GAMELIFT", "true")
os.environ.setdefault("AWS_ACCESS_KEY_ID", "dummy")
os.environ.setdefault("AWS_SECRET_ACCESS_KEY", "dummy")
os.environ.setdefault("AWS_REGION", "us-east-1")

from app.main import app
from app.dynamo_client import dynamo


@pytest_asyncio.fixture
async def client():
    """HTTP test client with DynamoDB calls mocked."""

    # Mock ensure_tables_exist to avoid boto3 call at startup
    with patch.object(dynamo, "ensure_tables_exist", new_callable=AsyncMock):
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
            yield ac


@pytest_asyncio.fixture
def mock_dynamo():
    """Provides AsyncMock replacements for all DynamoClient methods."""
    with (
        patch.object(dynamo, "put_ticket", new_callable=AsyncMock) as mock_put,
        patch.object(dynamo, "get_ticket", new_callable=AsyncMock) as mock_get,
        patch.object(dynamo, "update_ticket_completed", new_callable=AsyncMock) as mock_update,
    ):
        yield {"put": mock_put, "get": mock_get, "update": mock_update}
