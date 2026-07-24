"""Bearer-token validation for the /stats API.

Validates the platform's self-issued HS256 tokens against the shared secret
(same SHA-256 key derivation as core's LocalTokenService). Applied as a
router-level dependency in main.py; /health stays open for probes.
AUTH_ENABLED=false disables the check for tests and local tooling.
"""

import hashlib

import jwt
from fastapi import HTTPException, Request

from .config import settings


def _derive_key() -> bytes:
    return hashlib.sha256(settings.local_auth_jwt_secret.encode("utf-8")).digest()


async def require_token(request: Request) -> None:
    if not settings.auth_enabled:
        return
    authorization = request.headers.get("authorization", "")
    if not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing bearer token")
    token = authorization[len("Bearer "):]
    try:
        jwt.decode(token, _derive_key(), algorithms=["HS256"])
    except jwt.InvalidTokenError as e:
        raise HTTPException(status_code=401, detail="Invalid token") from e
