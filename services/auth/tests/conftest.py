"""
Test fixtures for the Auth service.

Uses an in-memory SQLite database (via aiosqlite) instead of PostgreSQL.
This avoids needing a real DB in CI and keeps tests fast.

Note: SQLite doesn't support gen_random_uuid(), so models use Python-side
UUID generation in tests. The server_default is PostgreSQL-only.
"""

import uuid
import pytest
import pytest_asyncio
from httpx import AsyncClient, ASGITransport
from sqlalchemy import event
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker, AsyncSession
from unittest.mock import patch

from app.main import app
from app.database import Base, get_db
from app.models import User


TEST_DB_URL = "sqlite+aiosqlite:///:memory:"

test_engine = create_async_engine(TEST_DB_URL, echo=False)
TestSessionLocal = async_sessionmaker(test_engine, class_=AsyncSession, expire_on_commit=False)


@pytest_asyncio.fixture(autouse=True)
async def setup_db():
    """Create all tables before each test, drop them after."""
    async with test_engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    yield
    async with test_engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)


@pytest_asyncio.fixture
async def client():
    """HTTP test client with the DB dependency overridden to use SQLite."""

    async def override_get_db():
        async with TestSessionLocal() as session:
            yield session

    app.dependency_overrides[get_db] = override_get_db

    # Patch gen_random_uuid() calls — SQLite doesn't have it.
    # Our model uses server_default for the DB side; in tests we pre-set the id.
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        yield ac

    app.dependency_overrides.clear()


@pytest_asyncio.fixture
async def db_session():
    """Direct DB session for seeding test data."""
    async with TestSessionLocal() as session:
        yield session
