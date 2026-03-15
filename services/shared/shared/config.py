import os

# Shared JWT configuration — all services read JWT_SECRET from the environment.
# The Auth service uses this to sign tokens; all other services use it to verify them.
JWT_SECRET: str = os.getenv("JWT_SECRET", "")
JWT_ALGORITHM: str = "HS256"
JWT_EXPIRY_HOURS: int = 24
