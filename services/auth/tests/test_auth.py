"""
Auth service tests.

Tests cover the public API contract: register, login, /me.
All tests use an in-memory SQLite DB (see conftest.py).
"""

import uuid
import pytest
import os
from passlib.hash import bcrypt

# Set JWT_SECRET before importing app code
os.environ.setdefault("JWT_SECRET", "test-secret")

from app.models import User


pytestmark = pytest.mark.asyncio


async def test_health(client):
    resp = await client.get("/api/v1/health")
    assert resp.status_code == 200
    assert resp.json()["status"] == "ok"


async def test_register_success(client):
    resp = await client.post("/api/v1/register", json={
        "username": "testuser",
        "password": "password123",
    })
    assert resp.status_code == 201
    data = resp.json()
    assert data["username"] == "testuser"
    assert "token" in data
    assert "user_id" in data


async def test_register_duplicate_username(client):
    payload = {"username": "dupeuser", "password": "password123"}
    await client.post("/api/v1/register", json=payload)
    resp = await client.post("/api/v1/register", json=payload)
    assert resp.status_code == 409


async def test_register_password_too_short(client):
    resp = await client.post("/api/v1/register", json={
        "username": "user1",
        "password": "short",
    })
    assert resp.status_code == 422


async def test_login_success(client):
    await client.post("/api/v1/register", json={
        "username": "loginuser",
        "password": "password123",
    })
    resp = await client.post("/api/v1/login", json={
        "username": "loginuser",
        "password": "password123",
    })
    assert resp.status_code == 200
    assert "token" in resp.json()


async def test_login_wrong_password(client):
    await client.post("/api/v1/register", json={
        "username": "loginuser2",
        "password": "password123",
    })
    resp = await client.post("/api/v1/login", json={
        "username": "loginuser2",
        "password": "wrongpassword",
    })
    assert resp.status_code == 401


async def test_login_unknown_user(client):
    resp = await client.post("/api/v1/login", json={
        "username": "nobody",
        "password": "password123",
    })
    assert resp.status_code == 401


async def test_me_with_valid_token(client):
    reg = await client.post("/api/v1/register", json={
        "username": "meuser",
        "password": "password123",
    })
    token = reg.json()["token"]
    resp = await client.get("/api/v1/me", headers={"Authorization": f"Bearer {token}"})
    assert resp.status_code == 200
    assert resp.json()["username"] == "meuser"


async def test_me_without_token(client):
    resp = await client.get("/api/v1/me")
    assert resp.status_code == 401


async def test_me_with_invalid_token(client):
    resp = await client.get("/api/v1/me", headers={"Authorization": "Bearer invalidtoken"})
    assert resp.status_code == 401
