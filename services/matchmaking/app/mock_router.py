"""
Mock control API — only registered when MOCK_GAMELIFT=true.

These endpoints let you inspect and change the mock matchmaking queue at runtime
without restarting the service. Useful for local development and Unity testing.

Endpoints:
  GET  /mock/state                       — view queue config and all active tickets
  POST /mock/queue-config                — change queue settings (min_players, timeouts)
  POST /mock/ticket/override             — force a specific ticket to a given outcome
  DELETE /mock/ticket/override/{id}      — return a ticket to the normal queue
  POST /mock/reset                       — wipe all state, restore config defaults

Queue behavior:
  - Tickets join a shared queue on POST /api/v1/join.
  - A match only forms when at least `min_players` tickets are queued.
  - Once the threshold is met, tickets resolve as COMPLETED after `match_delay_seconds`.
  - Tickets that wait longer than `timeout_seconds` without a match become TIMED_OUT.

Per-ticket override states (force_end_state):
  "completed"  → resolve with fake IP/port (bypasses min_players check)
  "timeout"    → resolve as TIMED_OUT
  "cancelled"  → resolve as CANCELLED
"""

from typing import Literal, Optional
from fastapi import APIRouter
from pydantic import BaseModel, Field

from app.gamelift_client import gamelift

ForceEndState = Literal["completed", "timeout", "cancelled"]


class QueueConfig(BaseModel):
    min_players: int = Field(..., ge=1, le=100, description="Minimum players to form a match")
    timeout_seconds: int = Field(..., ge=1, le=3600, description="Seconds before TIMED_OUT")
    match_delay_seconds: int = Field(
        ..., ge=0, le=60, description="Simulated delay after threshold is met"
    )


class TicketOverrideRequest(BaseModel):
    ticket_id: str
    force_end_state: ForceEndState = Field(
        ..., description="Outcome to force on this ticket, bypassing queue logic"
    )
    after_seconds: float = Field(
        0, ge=0, le=3600, description="Delay before applying the forced state"
    )


class MockTicketInfo(BaseModel):
    ticket_id: str
    age_seconds: float
    override: Optional[TicketOverrideRequest] = None


class MockStateResponse(BaseModel):
    queue_config: QueueConfig
    queued_count: int
    tickets: list[MockTicketInfo]


mock_router = APIRouter(prefix="/mock", tags=["Mock Control (local dev only)"])


@mock_router.get("/state", response_model=MockStateResponse)
async def get_mock_state():
    """
    View the current queue configuration, how many tickets are actively queued,
    and the full list of in-flight tickets with their ages and any overrides.
    """
    return gamelift.mock_get_state()


@mock_router.post("/queue-config", response_model=QueueConfig)
async def set_queue_config(body: QueueConfig):
    """
    Update the queue settings. Takes effect immediately for all in-flight tickets.

    Examples:
      Solo testing (match with just yourself):
        {"min_players": 1, "timeout_seconds": 30, "match_delay_seconds": 2}

      Simulate a slow queue (needs 4 players, 60s timeout):
        {"min_players": 4, "timeout_seconds": 60, "match_delay_seconds": 5}
    """
    gamelift.mock_set_queue_config(
        min_players=body.min_players,
        timeout_seconds=body.timeout_seconds,
        match_delay_seconds=body.match_delay_seconds,
    )
    return body


@mock_router.post("/ticket/override", response_model=TicketOverrideRequest)
async def set_ticket_override(body: TicketOverrideRequest):
    """
    Force a specific in-flight ticket to a given outcome, bypassing the queue.
    The ticket is removed from the shared queue immediately (won't count toward min_players).

    Examples:
      Immediately cancel a ticket:
        {"ticket_id": "mock-ticket-...", "force_end_state": "cancelled", "after_seconds": 0}

      Time out a ticket in 5 seconds:
        {"ticket_id": "mock-ticket-...", "force_end_state": "timeout", "after_seconds": 5}

      Force-complete a solo ticket right now:
        {"ticket_id": "mock-ticket-...", "force_end_state": "completed", "after_seconds": 0}
    """
    gamelift.mock_set_ticket_override(
        ticket_id=body.ticket_id,
        force_end_state=body.force_end_state,
        after_seconds=body.after_seconds,
    )
    return body


@mock_router.delete("/ticket/override/{ticket_id}", status_code=204)
async def clear_ticket_override(ticket_id: str):
    """
    Remove the override for a ticket, returning it to the normal queue.
    """
    gamelift.mock_clear_ticket_override(ticket_id)


@mock_router.post("/reset", status_code=204)
async def reset_mock():
    """
    Clear all in-memory ticket state and restore queue settings from config/env vars.
    DynamoDB is unaffected — stale DynamoDB entries will return FAILED on the next poll.
    """
    gamelift.mock_reset()
