"""
Matchmaking Service entry point.
"""

from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.dynamo_client import dynamo
from app.routes import public_router, protected_router


@asynccontextmanager
async def lifespan(app: FastAPI):
    """
    On startup, ensure DynamoDB tables exist.

    On real AWS, CDK creates the tables before the service starts.
    On DynamoDB Local (docker-compose), this creates them on first run.
    """
    await dynamo.ensure_tables_exist()
    yield


app = FastAPI(
    title="Matchmaking Service",
    description="FlexMatch matchmaking bridge for Tank Battle Royale",
    version="1.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(public_router)
app.include_router(protected_router)
