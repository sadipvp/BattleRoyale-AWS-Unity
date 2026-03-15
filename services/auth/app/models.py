"""
SQLAlchemy ORM model for the users table.

Auth service owns its own dedicated database (authdb), so no schema prefix is
needed — the users table lives at the top level of the database.

SQLAlchemy's create_all() creates this table on service startup (see main.py lifespan).
It is idempotent: CREATE TABLE IF NOT EXISTS semantics.
"""

import uuid
from datetime import datetime
from sqlalchemy import String, DateTime, func
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class User(Base):
    __tablename__ = "users"

    # UUID primary key — generated in Python so it works with both PostgreSQL and
    # SQLite (used in tests). PostgreSQL also supports gen_random_uuid() but we
    # don't need it when Python can generate UUIDs just as well.
    id: Mapped[str] = mapped_column(
        String(36),
        primary_key=True,
        default=lambda: str(uuid.uuid4()),
    )
    username: Mapped[str] = mapped_column(String(50), unique=True, nullable=False)
    password_hash: Mapped[str] = mapped_column(String(255), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )
