"""
Auth service routes.

Two routers:
- public_router: /register, /login, /health — no auth required
- protected_router: /me — JWT required (applied at router level)

Router-level auth means every route added to protected_router is automatically
protected — no per-endpoint auth code needed.
"""

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import text, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from passlib.hash import bcrypt

from shared.auth import get_current_user
from app.database import get_db
from app.models import User
from app.schemas import RegisterRequest, LoginRequest, RegisterResponse, TokenResponse, MeResponse, HealthResponse
from app.jwt_utils import create_access_token


# Public routes — no authentication required
public_router = APIRouter(prefix="/api/v1")

# Protected routes — every route on this router requires a valid JWT
protected_router = APIRouter(prefix="/api/v1", dependencies=[Depends(get_current_user)])


@public_router.get("/health", response_model=HealthResponse)
async def health(db: AsyncSession = Depends(get_db)):
    """
    Health check endpoint — used by ALB target group health checks.
    Returns 200 if the service and DB are healthy, 503 if DB is unreachable.
    """
    try:
        await db.execute(text("SELECT 1"))
    except Exception:
        raise HTTPException(status_code=503, detail="Database unavailable")
    return {"status": "ok", "service": "auth"}


@public_router.post("/register", response_model=RegisterResponse, status_code=201)
async def register(body: RegisterRequest, db: AsyncSession = Depends(get_db)):
    """
    Create a new account. Returns a JWT on success.

    Returns 409 Conflict if the username is already taken.
    """
    user = User(
        username=body.username,
        password_hash=bcrypt.hash(body.password),
    )
    db.add(user)
    try:
        await db.commit()
        await db.refresh(user)
    except IntegrityError:
        await db.rollback()
        raise HTTPException(status_code=409, detail="Username already taken")

    token = create_access_token(user.id, user.username)
    return RegisterResponse(user_id=user.id, username=user.username, token=token)


@public_router.post("/login", response_model=TokenResponse)
async def login(body: LoginRequest, db: AsyncSession = Depends(get_db)):
    """
    Verify credentials and return a JWT.

    Returns 401 for unknown username or wrong password (same error to avoid
    leaking which usernames exist).
    """
    result = await db.execute(select(User).where(User.username == body.username))
    user = result.scalar_one_or_none()

    # Constant-time comparison: always call bcrypt.verify even if user not found
    # to prevent timing-based username enumeration
    if user is None or not bcrypt.verify(body.password, user.password_hash):
        raise HTTPException(status_code=401, detail="Invalid credentials")

    token = create_access_token(user.id, user.username)
    return TokenResponse(token=token)


@protected_router.get("/me", response_model=MeResponse)
async def me(user: dict = Depends(get_current_user)):
    """
    Return the current user's profile from their JWT claims.

    No DB query needed — the user info is already in the validated token.
    """
    return MeResponse(user_id=user["sub"], username=user["username"])
