"""
Auth Service entry point.

FastAPI app with:
- CORS middleware (allows all origins — restrict in production if needed)
- Lifespan: creates DB tables on startup (idempotent)
- Public routes: /register, /login, /health
- Protected routes: /me
"""

from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.database import engine, Base
from app.routes import public_router, protected_router


@asynccontextmanager
async def lifespan(app: FastAPI):
    """
    Runs once when the service starts. Creates the users table if it doesn't exist.
    The 'auth-db' PostgreSQL instance must be running and reachable at this point.
    """
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    yield
    # No cleanup needed — connection pool is closed automatically


app = FastAPI(
    title="Auth Service",
    description="User registration, login, and JWT issuance for Tank Battle Royale",
    version="1.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # tighten to ALB DNS in production if desired
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(public_router)
app.include_router(protected_router)
