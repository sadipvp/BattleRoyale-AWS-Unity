"""
GameLift FlexMatch client.

Two modes controlled by the MOCK_GAMELIFT environment variable:

  MOCK_GAMELIFT=false (production):
    Calls real AWS GameLift FlexMatch API via boto3.
    start_matchmaking() → creates a FlexMatch ticket.
    describe_matchmaking() → polls ticket status.

  MOCK_GAMELIFT=true (local development):
    Simulates a realistic matchmaking queue without any AWS API calls.

    Queue behavior:
      - Tickets start in SEARCHING and join a shared queue.
      - A match only forms when at least `min_players` tickets are in the queue.
      - Once the threshold is met, each ticket transitions to COMPLETED after
        `match_delay_seconds` (simulates server negotiation time).
      - If `timeout_seconds` elapses with no match, the ticket becomes TIMED_OUT.

    Per-ticket overrides:
      - Any ticket can be force-resolved to a specific outcome via the /mock API,
        bypassing the normal queue logic. Useful for testing error paths in Unity.

All boto3 calls are wrapped in asyncio.to_thread() because boto3 is synchronous
and calling it directly would block the FastAPI event loop.
"""

import time
import uuid
import asyncio
import boto3
from botocore.config import Config
from dataclasses import dataclass

from app.config import settings


@dataclass
class _QueueConfig:
    min_players: int      # minimum tickets in queue to form a match
    timeout_seconds: int  # seconds until TIMED_OUT with no match
    match_delay_seconds: int  # seconds after threshold met until COMPLETED


@dataclass
class _TicketOverride:
    force_end_state: str  # "completed" | "timeout" | "cancelled"
    after_seconds: float  # delay before applying; 0 = resolve on next poll


@dataclass
class _MockTicket:
    ticket_id: str
    created_at: float  # time.monotonic() at creation


class GameLiftClient:
    def __init__(self):
        if settings.mock_gamelift:
            self._queue_config = _QueueConfig(
                min_players=settings.mock_min_players,
                timeout_seconds=settings.mock_timeout_seconds,
                match_delay_seconds=settings.mock_match_delay_seconds,
            )
            self._mock_tickets: dict[str, _MockTicket] = {}
            self._mock_overrides: dict[str, _TicketOverride] = {}
        else:
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
            ticket_id = f"mock-ticket-{uuid.uuid4()}"
            self._mock_tickets[ticket_id] = _MockTicket(
                ticket_id=ticket_id,
                created_at=time.monotonic(),
            )
            return ticket_id

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
            ticket = self._mock_tickets.get(ticket_id)
            if not ticket:
                return {"status": "FAILED"}

            elapsed = time.monotonic() - ticket.created_at

            # Per-ticket override bypasses the queue entirely
            override = self._mock_overrides.get(ticket_id)
            if override:
                if elapsed < override.after_seconds:
                    return {"status": "SEARCHING"}
                if override.force_end_state == "completed":
                    return {
                        "status": "COMPLETED",
                        "ip": "127.0.0.1",
                        "port": 7777,
                        "player_session_id": f"mock-psid-{ticket_id[-12:]}",
                    }
                if override.force_end_state == "timeout":
                    return {"status": "TIMED_OUT"}
                if override.force_end_state == "cancelled":
                    return {"status": "CANCELLED"}

            config = self._queue_config

            # Ticket timed out waiting for enough players
            if elapsed >= config.timeout_seconds:
                return {"status": "TIMED_OUT"}

            # Check if the queue has enough players to form a match
            if self._count_queued_tickets() >= config.min_players:
                # Require match_delay_seconds of wait after joining to simulate
                # the time it takes GameLift to spin up a session
                if elapsed >= config.match_delay_seconds:
                    return {
                        "status": "COMPLETED",
                        "ip": "127.0.0.1",
                        "port": 7777,
                        "player_session_id": f"mock-psid-{ticket_id[-12:]}",
                    }

            return {"status": "SEARCHING"}

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

    def _count_queued_tickets(self) -> int:
        """
        Count tickets currently eligible for matching (not overridden, not timed out).
        """
        now = time.monotonic()
        count = 0
        for t in self._mock_tickets.values():
            if t.ticket_id in self._mock_overrides:
                continue  # forced tickets leave the normal queue
            if now - t.created_at < self._queue_config.timeout_seconds:
                count += 1
        return count

    # ── Mock control methods (only meaningful when mock_gamelift=True) ──────────

    def mock_set_queue_config(
        self, min_players: int, timeout_seconds: int, match_delay_seconds: int
    ) -> None:
        """Update the queue config. Takes effect immediately for all in-flight tickets."""
        self._queue_config = _QueueConfig(
            min_players=min_players,
            timeout_seconds=timeout_seconds,
            match_delay_seconds=match_delay_seconds,
        )

    def mock_set_ticket_override(
        self, ticket_id: str, force_end_state: str, after_seconds: float
    ) -> None:
        """
        Force a specific ticket to a given outcome, bypassing queue logic.
        The ticket leaves the shared queue immediately (won't count toward min_players).
        """
        self._mock_overrides[ticket_id] = _TicketOverride(
            force_end_state=force_end_state,
            after_seconds=after_seconds,
        )

    def mock_clear_ticket_override(self, ticket_id: str) -> None:
        """Return a ticket to the normal queue by removing its override."""
        self._mock_overrides.pop(ticket_id, None)

    def mock_get_state(self) -> dict:
        """Return a snapshot of the full mock state."""
        now = time.monotonic()
        config = self._queue_config
        return {
            "queue_config": {
                "min_players": config.min_players,
                "timeout_seconds": config.timeout_seconds,
                "match_delay_seconds": config.match_delay_seconds,
            },
            "queued_count": self._count_queued_tickets(),
            "tickets": [
                {
                    "ticket_id": t.ticket_id,
                    "age_seconds": round(now - t.created_at, 1),
                    "override": (
                        {
                            "force_end_state": self._mock_overrides[t.ticket_id].force_end_state,
                            "after_seconds": self._mock_overrides[t.ticket_id].after_seconds,
                        }
                        if t.ticket_id in self._mock_overrides
                        else None
                    ),
                }
                for t in self._mock_tickets.values()
            ],
        }

    def mock_reset(self) -> None:
        """Clear all in-memory state and restore config-default queue settings."""
        self._queue_config = _QueueConfig(
            min_players=settings.mock_min_players,
            timeout_seconds=settings.mock_timeout_seconds,
            match_delay_seconds=settings.mock_match_delay_seconds,
        )
        self._mock_tickets.clear()
        self._mock_overrides.clear()


# Module-level singleton — created once at import time
gamelift = GameLiftClient()
