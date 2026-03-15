"""
GameLift FlexMatch client.

Two modes controlled by the MOCK_GAMELIFT environment variable:

  MOCK_GAMELIFT=false (production):
    Calls real AWS GameLift FlexMatch API via boto3.
    start_matchmaking() → creates a FlexMatch ticket.
    describe_matchmaking() → polls ticket status.

  MOCK_GAMELIFT=true (local development):
    Returns fake data without any AWS API calls.
    Useful for testing the full flow (register → login → join → poll status)
    without a deployed GameLift fleet.

All boto3 calls are wrapped in asyncio.to_thread() because boto3 is synchronous
and calling it directly would block the FastAPI event loop.
"""

import uuid
import asyncio
import boto3
from botocore.config import Config

from app.config import settings


class GameLiftClient:
    def __init__(self):
        if not settings.mock_gamelift:
            self._client = boto3.client(
                "gamelift",
                region_name=settings.aws_region,
                config=Config(retries={"max_attempts": 3, "mode": "standard"}),
            )

    async def start_matchmaking(self, player_id: str) -> str:
        """
        Starts a FlexMatch matchmaking request for one player.

        Returns the ticket_id that the client should use to poll status.
        """
        if settings.mock_gamelift:
            # Return a fake ticket ID — no AWS call
            return f"mock-ticket-{uuid.uuid4()}"

        response = await asyncio.to_thread(
            self._client.start_matchmaking,
            ConfigurationName=settings.flexmatch_config_name,
            Players=[
                {
                    "PlayerId": player_id,
                    "PlayerAttributes": {},
                }
            ],
        )
        return response["MatchmakingTicket"]["TicketId"]

    async def describe_matchmaking(self, ticket_id: str) -> dict:
        """
        Polls a FlexMatch ticket for its current status.

        Returns a normalized dict:
          {"status": "SEARCHING"}
          {"status": "COMPLETED", "ip": "...", "port": 7777, "player_session_id": "..."}
          {"status": "TIMED_OUT"}   (or CANCELLED, FAILED)
        """
        if settings.mock_gamelift:
            # Always return COMPLETED with fake connection info.
            # In a real flow, the first few polls would return SEARCHING.
            # For local testing this is fine — the client gets connection info immediately.
            return {
                "status": "COMPLETED",
                "ip": "127.0.0.1",
                "port": 7777,
                "player_session_id": f"mock-psid-{uuid.uuid4()}",
            }

        response = await asyncio.to_thread(
            self._client.describe_matchmaking,
            TicketIds=[ticket_id],
        )

        if not response.get("TicketList"):
            return {"status": "FAILED"}

        ticket = response["TicketList"][0]
        ticket_status = ticket["Status"]

        if ticket_status == "COMPLETED":
            info = ticket["GameSessionConnectionInfo"]
            return {
                "status": "COMPLETED",
                "ip": info["IpAddress"],
                "port": info["Port"],
                "player_session_id": info["MatchedPlayerSessions"][0]["PlayerSessionId"],
            }

        return {"status": ticket_status}


# Module-level singleton — created once at import time
gamelift = GameLiftClient()
