"""
Auth service configuration.

All values are read from environment variables. In docker-compose, these come
from the `environment:` block. On AWS ECS, they come from Secrets Manager via
the task definition secrets.
"""

from pydantic import computed_field
from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    # Database connection — individual fields so ECS can inject each from Secrets Manager
    db_host: str = "localhost"
    db_port: int = 5432
    db_user: str = "dev"
    db_password: str = "devpassword"
    db_name: str = "authdb"

    # JWT signing key — same value shared across all services via Secrets Manager
    jwt_secret: str = ""
    jwt_algorithm: str = "HS256"
    jwt_expiry_hours: int = 24

    debug: bool = False

    @computed_field
    @property
    def database_url(self) -> str:
        # asyncpg requires the postgresql+asyncpg:// scheme
        return (
            f"postgresql+asyncpg://{self.db_user}:{self.db_password}"
            f"@{self.db_host}:{self.db_port}/{self.db_name}"
        )


settings = Settings()
