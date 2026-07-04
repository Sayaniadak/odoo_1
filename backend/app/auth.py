"""
HRMS Backend — JWT Verification & Auth Dependencies

Supports both:
  • ES256 (ECC P-256) — current Supabase signing key, verified via JWKS endpoint
  • HS256 (legacy) — fallback using SUPABASE_JWT_SECRET from .env

The algorithm is auto-detected from the token header's `kid` field.
"""

from __future__ import annotations

import jwt as pyjwt
from jwt import PyJWKClient
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from pydantic import BaseModel

from backend.app.config import settings

# ── Security scheme ──────────────────────────────────────────────────────────
# HTTPBearer extracts the token from `Authorization: Bearer <token>`
security = HTTPBearer(
    scheme_name="Supabase JWT",
    description="Paste the access_token returned by /api/auth/login",
)

# ── JWKS client (caches keys for 5 minutes) ─────────────────────────────────
_jwks_client = PyJWKClient(
    f"{settings.SUPABASE_URL}/auth/v1/.well-known/jwks.json",
    cache_jwk_set=True,
    lifespan=300,
)


# ── Models ───────────────────────────────────────────────────────────────────
class CurrentUser(BaseModel):
    """Authenticated user extracted from a verified JWT."""
    id: str
    email: str
    role: str  # "Employee" | "HR" | "Admin"


# ── JWT verification ────────────────────────────────────────────────────────
def verify_jwt(token: str) -> dict:
    """
    Verify a Supabase-issued JWT and return the decoded payload.

    Strategy:
      1. Read the unverified header.
      2. If the header contains a `kid` → token was signed with an asymmetric
         key (ES256).  Fetch the public key from the JWKS endpoint.
      3. If no `kid` → legacy HS256, verify with the shared secret.
    """
    # ── Parse header ─────────────────────────────────────────────────────
    try:
        header = pyjwt.get_unverified_header(token)
    except pyjwt.DecodeError:
        raise HTTPException(
            status.HTTP_401_UNAUTHORIZED,
            detail="Malformed token: could not decode header.",
        )

    # ── Pick key + algorithm ─────────────────────────────────────────────
    try:
        if "kid" in header:
            # Modern ECC key — resolve via JWKS
            signing_key = _jwks_client.get_signing_key_from_jwt(token)
            key = signing_key.key
            algorithms = [header.get("alg", "ES256")]
        else:
            # Legacy shared secret
            key = settings.SUPABASE_JWT_SECRET
            algorithms = ["HS256"]
    except pyjwt.PyJWKClientError as exc:
        raise HTTPException(
            status.HTTP_401_UNAUTHORIZED,
            detail=f"Could not retrieve signing key: {exc}",
        )

    # ── Decode + verify ──────────────────────────────────────────────────
    try:
        payload = pyjwt.decode(
            token,
            key,
            algorithms=algorithms,
            audience="authenticated",
            options={
                "require": ["sub", "email", "exp", "aud"],
            },
        )
        return payload
    except pyjwt.ExpiredSignatureError:
        raise HTTPException(
            status.HTTP_401_UNAUTHORIZED,
            detail="Token has expired. Please log in again.",
        )
    except pyjwt.InvalidAudienceError:
        raise HTTPException(
            status.HTTP_401_UNAUTHORIZED,
            detail="Invalid token audience.",
        )
    except pyjwt.MissingRequiredClaimError as exc:
        raise HTTPException(
            status.HTTP_401_UNAUTHORIZED,
            detail=f"Token missing required claim: {exc}",
        )
    except pyjwt.InvalidTokenError as exc:
        raise HTTPException(
            status.HTTP_401_UNAUTHORIZED,
            detail=f"Invalid token: {exc}",
        )


# ── FastAPI dependencies ─────────────────────────────────────────────────────

async def get_current_user(
    credentials: HTTPAuthorizationCredentials = Depends(security),
) -> CurrentUser:
    """
    FastAPI dependency: verifies the JWT from the Authorization header
    and returns a CurrentUser object.
    """
    payload = verify_jwt(credentials.credentials)

    user_id = payload.get("sub")
    email = payload.get("email")

    # Role lives in user_metadata (set at signup, mirrored to public.users
    # by the DB trigger).  JWT metadata is the fast path; the DB (via RLS's
    # get_user_role()) is the ground truth.
    user_metadata = payload.get("user_metadata", {})
    role = user_metadata.get("role", "Employee")

    if not user_id or not email:
        raise HTTPException(
            status.HTTP_401_UNAUTHORIZED,
            detail="Token payload missing user ID or email.",
        )

    return CurrentUser(id=user_id, email=email, role=role)


def require_role(*allowed_roles: str):
    """
    Factory that returns a FastAPI dependency enforcing role membership.

    Usage:
        @router.get("/admin-only")
        async def admin_endpoint(
            user: CurrentUser = Depends(require_role("Admin")),
        ):
            ...

    This is defense-in-depth — RLS is the primary enforcement.
    """
    async def _role_checker(
        current_user: CurrentUser = Depends(get_current_user),
    ) -> CurrentUser:
        if current_user.role not in allowed_roles:
            raise HTTPException(
                status.HTTP_403_FORBIDDEN,
                detail=(
                    f"This endpoint requires role: {', '.join(allowed_roles)}. "
                    f"Your role: {current_user.role}."
                ),
            )
        return current_user
    return _role_checker
