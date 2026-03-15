"""
Matchmaking service routes.

All routes except /health require a valid JWT (applied at router level).

Flow:
  POST /join          → start FlexMatch → store ticket in DynamoDB → return ticket_id
  GET /match-status   → check DynamoDB cache → poll GameLift → update DynamoDB → return status
"""

from fastapi import APIRouter, Depends

from shared.auth import get_current_user
from app.schemas import JoinResponse, MatchStatusResponse, HealthResponse
from app.gamelift_client import gamelift
from app.dynamo_client import dynamo


# Public (no auth)
public_router = APIRouter(prefix="/api/v1")

# All routes here require a valid JWT
protected_router = APIRouter(prefix="/api/v1", dependencies=[Depends(get_current_user)])


@public_router.get("/health", response_model=HealthResponse)
async def health():
    """Health check for ALB target group. No DB check needed for matchmaking."""
    return {"status": "ok", "service": "matchmaking"}


@protected_router.post("/join", response_model=JoinResponse)
async def join(user: dict = Depends(get_current_user)):
    """
    Start matchmaking for the authenticated player.

    Calls GameLift FlexMatch (or returns mock data if MOCK_GAMELIFT=true).
    Stores the ticket in DynamoDB for fast polling.
    Returns the ticket_id for the client to use with /match-status.
    """
    player_id = user["sub"]  # UUID from the JWT's 'sub' claim

    ticket_id = await gamelift.start_matchmaking(player_id)
    await dynamo.put_ticket(ticket_id, player_id)

    return JoinResponse(ticket_id=ticket_id)


@protected_router.get("/match-status/{ticket_id}", response_model=MatchStatusResponse)
async def match_status(ticket_id: str, user: dict = Depends(get_current_user)):
    """
    Poll matchmaking status for a ticket.

    Checks DynamoDB first (cheap cache hit if already COMPLETED).
    Falls back to GameLift API if the ticket is still in progress.

    Response status values:
      "searching" — still looking for players
      "ready"     — match found; ip/port/player_session_id are set
      "failed"    — matchmaking timed out, was cancelled, or errored
    """
    # Fast path: return cached result if already COMPLETED
    cached = await dynamo.get_ticket(ticket_id)
    if cached and cached.get("status") == "COMPLETED":
        return MatchStatusResponse(
            status="ready",
            ip=cached.get("game_session_ip"),
            port=int(cached.get("game_session_port", 0)),
            player_session_id=cached.get("player_session_id"),
        )

    # Slow path: ask GameLift
    result = await gamelift.describe_matchmaking(ticket_id)
    gamelift_status = result["status"]

    if gamelift_status == "COMPLETED":
        await dynamo.update_ticket_completed(
            ticket_id,
            ip=result["ip"],
            port=result["port"],
            player_session_id=result["player_session_id"],
        )
        return MatchStatusResponse(
            status="ready",
            ip=result["ip"],
            port=result["port"],
            player_session_id=result["player_session_id"],
        )

    if gamelift_status in ("TIMED_OUT", "CANCELLED", "FAILED"):
        return MatchStatusResponse(status="failed")

    return MatchStatusResponse(status="searching")
