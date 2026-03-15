"""
DynamoDB client for matchmaking tickets and game sessions.

All boto3 calls are wrapped in asyncio.to_thread() — boto3 is synchronous,
so we run it in a thread pool to avoid blocking FastAPI's event loop.

Table schemas (defined in CDK's database-stack.ts):

  MatchmakingTickets
    PK: ticket_id (String)
    Attributes: player_id, status, game_session_ip, game_session_port,
                player_session_id, created_at, expires_at (TTL)

  GameSessions
    PK: session_id (String)
    Attributes: ip, port, player_ids, status, created_at, expires_at (TTL)
"""

import time
import asyncio
import boto3
from datetime import datetime, timezone
from botocore.exceptions import ClientError

from app.config import settings


class DynamoClient:
    def __init__(self):
        kwargs: dict = {"region_name": settings.aws_region}

        # DynamoDB Local (docker-compose) requires an explicit endpoint URL.
        # Dummy credentials are needed even for local — boto3 validates their presence.
        if settings.dynamodb_endpoint:
            kwargs["endpoint_url"] = settings.dynamodb_endpoint

        resource = boto3.resource("dynamodb", **kwargs)
        self._tickets = resource.Table(settings.dynamodb_tickets_table)
        self._sessions = resource.Table(settings.dynamodb_sessions_table)

    async def ensure_tables_exist(self) -> None:
        """
        Create DynamoDB tables if they don't exist. Called on service startup.
        Idempotent: catches ResourceInUseException if the table already exists.

        This is only needed for DynamoDB Local (docker-compose). On real AWS,
        tables are created by CDK's database-stack.ts before the service starts.
        """
        client = boto3.client(
            "dynamodb",
            region_name=settings.aws_region,
            endpoint_url=settings.dynamodb_endpoint,
        )

        for table_name, pk_name in [
            (settings.dynamodb_tickets_table, "ticket_id"),
            (settings.dynamodb_sessions_table, "session_id"),
        ]:
            try:
                await asyncio.to_thread(
                    client.create_table,
                    TableName=table_name,
                    KeySchema=[{"AttributeName": pk_name, "KeyType": "HASH"}],
                    AttributeDefinitions=[{"AttributeName": pk_name, "AttributeType": "S"}],
                    BillingMode="PAY_PER_REQUEST",
                )
            except ClientError as e:
                if e.response["Error"]["Code"] not in ("ResourceInUseException", "ResourceNotFoundException"):
                    # Table already exists — that's fine
                    if e.response["Error"]["Code"] != "ResourceInUseException":
                        raise

    async def put_ticket(self, ticket_id: str, player_id: str) -> None:
        """Store a new matchmaking ticket with SEARCHING status and 1-hour TTL."""
        item = {
            "ticket_id": ticket_id,
            "player_id": player_id,
            "status": "SEARCHING",
            "created_at": datetime.now(timezone.utc).isoformat(),
            "expires_at": int(time.time()) + 3600,  # TTL: 1 hour
        }
        await asyncio.to_thread(self._tickets.put_item, Item=item)

    async def get_ticket(self, ticket_id: str) -> dict | None:
        """Look up a ticket by ID. Returns None if not found."""
        response = await asyncio.to_thread(
            self._tickets.get_item,
            Key={"ticket_id": ticket_id},
        )
        return response.get("Item")

    async def update_ticket_completed(
        self,
        ticket_id: str,
        ip: str,
        port: int,
        player_session_id: str,
    ) -> None:
        """Mark a ticket as COMPLETED and store connection info."""
        await asyncio.to_thread(
            self._tickets.update_item,
            Key={"ticket_id": ticket_id},
            UpdateExpression=(
                "SET #s = :status, game_session_ip = :ip, "
                "game_session_port = :port, player_session_id = :psid"
            ),
            ExpressionAttributeNames={"#s": "status"},  # 'status' is reserved in DynamoDB
            ExpressionAttributeValues={
                ":status": "COMPLETED",
                ":ip": ip,
                ":port": port,
                ":psid": player_session_id,
            },
        )


# Module-level singleton
dynamo = DynamoClient()
