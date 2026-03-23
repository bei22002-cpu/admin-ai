"""JWT authentication for MCP Grid."""

import os
import time
from typing import Any

import jwt
from passlib.hash import bcrypt

SECRET_KEY = os.getenv("MCP_JWT_SECRET", "mcp-grid-secret-change-in-production")
ALGORITHM = "HS256"
TOKEN_EXPIRE_SECONDS = 86400 * 7  # 7 days


def hash_password(password: str) -> str:
    """Hash a password with bcrypt."""
    return bcrypt.hash(password)


def verify_password(password: str, hashed: str) -> bool:
    """Verify a password against its hash."""
    return bcrypt.verify(password, hashed)


def create_token(user_id: int, username: str) -> str:
    """Create a JWT token."""
    payload = {
        "sub": user_id,
        "username": username,
        "iat": time.time(),
        "exp": time.time() + TOKEN_EXPIRE_SECONDS,
    }
    return jwt.encode(payload, SECRET_KEY, algorithm=ALGORITHM)


def decode_token(token: str) -> dict[str, Any] | None:
    """Decode and validate a JWT token. Returns payload or None."""
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        if payload.get("exp", 0) < time.time():
            return None
        return payload
    except (jwt.InvalidTokenError, jwt.ExpiredSignatureError):
        return None
