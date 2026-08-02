"""HTTP Basic Auth guard applied to the whole API (see main.py).

Credentials come from AUTH_USER / AUTH_PASSWORD (see .env.example). There is no
per-user model — systemdocu is a single-team internal tool, so one shared
credential pair guarding the whole API is the right amount of complexity.
"""
import os
import secrets
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPBasic, HTTPBasicCredentials

security = HTTPBasic()

AUTH_USER = os.getenv("AUTH_USER", "admin")
AUTH_PASSWORD = os.getenv("AUTH_PASSWORD", "admin")


def require_auth(credentials: HTTPBasicCredentials = Depends(security)) -> str:
    valid_user = secrets.compare_digest(credentials.username, AUTH_USER)
    valid_password = secrets.compare_digest(credentials.password, AUTH_PASSWORD)
    if not (valid_user and valid_password):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid credentials",
            headers={"WWW-Authenticate": "Basic"},
        )
    return credentials.username
