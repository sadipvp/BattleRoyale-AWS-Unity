"""
JWT token creation — only the Auth service issues tokens.

Other services (matchmaking, stats) only validate tokens using the shared package's
get_current_user dependency. They never call create_access_token.
"""

from datetime import datetime, timedelta, timezone
from jose import jwt

from app.config import settings


def create_access_token(user_id: str, username: str) -> str:
    """
    Creates a signed JWT for a user.

    The token payload matches the structure expected by shared.auth.get_current_user:
    - sub: user UUID (used as player_id in GameLift)
    - username: display name
    - iat: issued at
    - exp: expiry (24 hours from now)
    """
    now = datetime.now(timezone.utc)
    payload = {
        "sub": user_id,
        "username": username,
        "iat": now,
        "exp": now + timedelta(hours=settings.jwt_expiry_hours),
    }
    return jwt.encode(payload, settings.jwt_secret, algorithm=settings.jwt_algorithm)
