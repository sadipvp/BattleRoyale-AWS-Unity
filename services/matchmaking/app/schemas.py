"""Pydantic v2 schemas for the Matchmaking service."""

from typing import Optional
from pydantic import BaseModel


class JoinResponse(BaseModel):
    ticket_id: str


class MatchStatusResponse(BaseModel):
    # "searching" | "ready" | "failed"
    status: str
    ip: Optional[str] = None
    port: Optional[int] = None
    player_session_id: Optional[str] = None


class HealthResponse(BaseModel):
    status: str
    service: str
