"""
Matchmaking service configuration.

Key env vars:
- MOCK_GAMELIFT: set to "true" for local development to skip real GameLift calls.
  The service will return fake ticket IDs and immediately simulate COMPLETED status.
- DYNAMODB_ENDPOINT: override to point at DynamoDB Local (e.g. http://dynamodb-local:8000).
  Leave unset (None) to use real AWS DynamoDB.
"""

from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    # JWT (shared with auth service via Secrets Manager in production)
    jwt_secret: str = ""

    # AWS
    aws_region: str = "us-east-1"
    aws_access_key_id: str = ""     # only needed for local dev with DynamoDB Local
    aws_secret_access_key: str = "" # only needed for local dev with DynamoDB Local

    # GameLift FlexMatch
    flexmatch_config_name: str = "tank-battle-4v4"

    # DynamoDB
    dynamodb_endpoint: str | None = None  # None = real AWS
    dynamodb_tickets_table: str = "MatchmakingTickets"
    dynamodb_sessions_table: str = "GameSessions"

    # Local dev mode — skip real GameLift API calls
    mock_gamelift: bool = False


settings = Settings()
