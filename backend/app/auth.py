"""JWT authentication for MCP Grid."""

import os
import time
from typing import Any

import bcrypt as _bcrypt
import jwt

SECRET_KEY = os.getenv("MCP_JWT_SECRET", "mcp-grid-secret-change-in-production")
ALGORITHM = "HS256"
TOKEN_EXPIRE_SECONDS = 86400 * 7  # 7 days


def hash_password(password: str) -> str:
    """Hash a password with bcrypt."""
    return _bcrypt.hashpw(password.encode(), _bcrypt.gensalt()).decode()


def verify_password(password: str, hashed: str) -> bool:
    """Verify a password against its hash."""
    return _bcrypt.checkpw(password.encode(), hashed.encode())


def create_token(user_id: int, username: str) -> str:
    """Create a JWT token."""
    payload = {
        "sub": str(user_id),
        "username": username,
        "iat": time.time(),
        "exp": time.time() + TOKEN_EXPIRE_SECONDS,
    }
    return jwt.encode(payload, SECRET_KEY, algorithm=ALGORITHM)


def decode_token(token: str) -> dict[str, Any] | None:
    """Decode and validate a JWT token. Returns payload or None."""
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        # Convert sub back to int for database lookups
        payload["sub"] = int(payload["sub"])
        return payload
    except (jwt.InvalidTokenError, jwt.ExpiredSignatureError, KeyError, ValueError):
        return None
