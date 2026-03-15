"""
Shared authentication dependencies for FastAPI services.

Usage — apply to an entire router (protects all routes on it with one line):

    from shared.auth import get_current_user
    router = APIRouter(prefix="/api/v1", dependencies=[Depends(get_current_user)])

Or inject the user payload into a specific route handler:

    @router.get("/me")
    async def me(user: dict = Depends(get_current_user)):
        return {"user_id": user["sub"], "username": user["username"]}
"""

import os
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials, APIKeyHeader
from jose import jwt, JWTError

from shared.config import JWT_ALGORITHM

_security = HTTPBearer()
_api_key_header = APIKeyHeader(name="X-API-Key", scheme_name="ApiKey")


async def get_current_user(
    credentials: HTTPAuthorizationCredentials = Depends(_security),
) -> dict:
    """
    FastAPI dependency that validates a Bearer JWT.

    Returns the decoded JWT payload dict (contains "sub", "username", "exp", "iat").
    Raises HTTP 401 if the token is missing, malformed, or expired.
    """
    jwt_secret = os.getenv("JWT_SECRET", "")
    try:
        payload = jwt.decode(credentials.credentials, jwt_secret, algorithms=[JWT_ALGORITHM])
        return payload
    except JWTError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired token",
        )


async def verify_api_key(api_key: str = Depends(_api_key_header)) -> str:
    """
    FastAPI dependency that validates the X-API-Key header.

    Used for internal service-to-service calls (e.g. game server → stats service).
    Raises HTTP 403 if the key is missing or incorrect.
    """
    expected = os.getenv("STATS_API_KEY", "")
    if not expected or api_key != expected:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Invalid API key",
        )
    return api_key
