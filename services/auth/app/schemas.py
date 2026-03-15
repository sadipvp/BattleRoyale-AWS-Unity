"""
Pydantic v2 request and response schemas for the Auth service.
"""

from pydantic import BaseModel, Field


class RegisterRequest(BaseModel):
    username: str = Field(min_length=3, max_length=50)
    password: str = Field(min_length=8)


class LoginRequest(BaseModel):
    username: str
    password: str


class RegisterResponse(BaseModel):
    user_id: str
    username: str
    token: str


class TokenResponse(BaseModel):
    token: str


class MeResponse(BaseModel):
    user_id: str
    username: str


class HealthResponse(BaseModel):
    status: str
    service: str
