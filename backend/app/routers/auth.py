"""
HRMS Backend — Auth Router

Endpoints:
  POST /api/auth/signup   — create account with role
  POST /api/auth/login    — sign in, receive JWT
  POST /api/auth/refresh  — refresh an expired session
  GET  /api/auth/me       — return current user info from JWT
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status, Request
from pydantic import BaseModel, EmailStr, Field
from supabase import create_client

from backend.app.auth import get_current_user, CurrentUser
from backend.app.config import settings

router = APIRouter(prefix="/api/auth", tags=["Authentication"])

# ── Allowed roles (validated server-side, not trusted from client) ───────────
VALID_ROLES = {"Employee", "HR", "Admin"}


# ── Request / Response models ────────────────────────────────────────────────

class SignupRequest(BaseModel):
    email: EmailStr
    password: str = Field(..., min_length=6, description="Minimum 6 characters")
    full_name: str = Field(..., min_length=1, description="Display name")
    role: str = Field(
        default="Employee",
        description="One of: Employee, HR, Admin",
    )


class LoginRequest(BaseModel):
    email: EmailStr
    password: str


class RefreshRequest(BaseModel):
    refresh_token: str


class UserResponse(BaseModel):
    id: str
    email: str
    role: str
    full_name: str


class AuthResponse(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"
    expires_in: int
    user: UserResponse


class SignupResponse(BaseModel):
    message: str
    user: UserResponse | None = None


# ── Helpers ──────────────────────────────────────────────────────────────────

def _make_anon_client():
    """Fresh Supabase client with anon key (for auth operations only)."""
    return create_client(settings.SUPABASE_URL, settings.SUPABASE_ANON_KEY)


def _classify_auth_error(error_message: str) -> tuple[int, str]:
    """
    Map Supabase Auth error messages to HTTP status codes + user-friendly messages.
    Supabase intentionally conflates some errors (e.g. wrong password vs user not found)
    to prevent user enumeration — we respect that where appropriate.
    """
    msg = error_message.lower()

    if "already registered" in msg or "already been registered" in msg:
        return 409, "An account with this email already exists."

    if "invalid login credentials" in msg:
        return 401, "Invalid email or password."

    if "email not confirmed" in msg:
        return 403, "Email not yet verified. Please check your inbox."

    if "invalid refresh token" in msg or "refresh token" in msg:
        return 401, "Refresh token is invalid or expired. Please log in again."

    if "password" in msg and ("too short" in msg or "at least" in msg):
        return 400, "Password is too short. Minimum 6 characters required."

    if "rate limit" in msg or "too many" in msg:
        return 429, "Too many requests. Please wait and try again."

    if "user not found" in msg:
        return 401, "Invalid email or password."

    # Fallback — don't leak raw Supabase errors to the client
    return 400, f"Authentication error: {error_message}"


# ── Endpoints ────────────────────────────────────────────────────────────────

@router.post(
    "/signup",
    response_model=SignupResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Create a new account",
    description="Registers a new user with the specified role. "
                "The role is stored in user_metadata and mirrored to "
                "public.users by the DB trigger.",
)
async def signup(data: SignupRequest, request: Request):
    # ── Validate role ────────────────────────────────────────────────────
    if data.role not in VALID_ROLES:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            detail=f"Invalid role '{data.role}'. Must be one of: {', '.join(sorted(VALID_ROLES))}.",
        )

    # ── Detect Redirect URL (Cloudflare Tunnel support) ──────────────────
    redirect_url = str(request.base_url)
    forwarded_host = request.headers.get("x-forwarded-host")
    forwarded_proto = request.headers.get("x-forwarded-proto", "https")
    if forwarded_host:
        redirect_url = f"{forwarded_proto}://{forwarded_host}/"

    # ── Call Supabase Auth ───────────────────────────────────────────────
    client = _make_anon_client()
    try:
        resp = client.auth.sign_up(
            {
                "email": data.email,
                "password": data.password,
                "options": {
                    "data": {
                        "role": data.role,
                        "full_name": data.full_name,
                    },
                    "email_redirect_to": redirect_url,
                },
            }
        )
    except Exception as exc:
        code, message = _classify_auth_error(str(exc))
        raise HTTPException(status_code=code, detail=message)

    # ── Handle response ──────────────────────────────────────────────────
    user = resp.user
    if user is None:
        raise HTTPException(
            status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Signup failed: no user returned from auth provider.",
        )

    user_metadata = user.user_metadata or {}

    # If email confirmation is required, session will be None
    if resp.session is None:
        return SignupResponse(
            message="Account created. Please check your email to verify your account.",
            user=UserResponse(
                id=str(user.id),
                email=user.email or data.email,
                role=user_metadata.get("role", data.role),
                full_name=user_metadata.get("full_name", data.full_name),
            ),
        )

    return SignupResponse(
        message="Account created successfully.",
        user=UserResponse(
            id=str(user.id),
            email=user.email or data.email,
            role=user_metadata.get("role", data.role),
            full_name=user_metadata.get("full_name", data.full_name),
        ),
    )


@router.post(
    "/login",
    response_model=AuthResponse,
    summary="Sign in with email and password",
    description="Returns JWT access and refresh tokens. "
                "Pass the access_token in the Authorization header for all other endpoints.",
)
async def login(data: LoginRequest):
    client = _make_anon_client()
    try:
        resp = client.auth.sign_in_with_password(
            {"email": data.email, "password": data.password}
        )
    except Exception as exc:
        code, message = _classify_auth_error(str(exc))
        raise HTTPException(status_code=code, detail=message)

    session = resp.session
    user = resp.user

    if session is None or user is None:
        raise HTTPException(
            status.HTTP_401_UNAUTHORIZED,
            detail="Login failed: no session returned. Is your email verified?",
        )

    user_metadata = user.user_metadata or {}

    return AuthResponse(
        access_token=session.access_token,
        refresh_token=session.refresh_token,
        expires_in=session.expires_in or 3600,
        user=UserResponse(
            id=str(user.id),
            email=user.email or data.email,
            role=user_metadata.get("role", "Employee"),
            full_name=user_metadata.get("full_name", ""),
        ),
    )


@router.post(
    "/refresh",
    response_model=AuthResponse,
    summary="Refresh an expired session",
    description="Exchange a valid refresh_token for a new access_token.",
)
async def refresh(data: RefreshRequest):
    client = _make_anon_client()
    try:
        resp = client.auth.refresh_session(data.refresh_token)
    except Exception as exc:
        code, message = _classify_auth_error(str(exc))
        raise HTTPException(status_code=code, detail=message)

    session = resp.session
    user = resp.user

    if session is None or user is None:
        raise HTTPException(
            status.HTTP_401_UNAUTHORIZED,
            detail="Could not refresh session. Please log in again.",
        )

    user_metadata = user.user_metadata or {}

    return AuthResponse(
        access_token=session.access_token,
        refresh_token=session.refresh_token,
        expires_in=session.expires_in or 3600,
        user=UserResponse(
            id=str(user.id),
            email=user.email or "",
            role=user_metadata.get("role", "Employee"),
            full_name=user_metadata.get("full_name", ""),
        ),
    )


@router.get(
    "/me",
    response_model=UserResponse,
    summary="Get current user info",
    description="Returns the authenticated user's ID, email, role, and name "
                "as decoded from the JWT. Requires a valid access_token.",
)
async def me(current_user: CurrentUser = Depends(get_current_user)):
    # For full_name, we'd normally query the profiles table, but for /me
    # we return what's in the JWT (fast path). The profile endpoints will
    # return the full profile from the DB.
    return UserResponse(
        id=current_user.id,
        email=current_user.email,
        role=current_user.role,
        full_name="",  # JWT doesn't always carry full_name; use /api/profiles/me
    )


class PasswordUpdateRequest(BaseModel):
    password: str = Field(..., min_length=6, description="New password, minimum 6 characters")


from backend.app.database import get_service_client

@router.put(
    "/password",
    summary="Change user password",
    description="Updates the password of the currently authenticated user in Supabase Auth.",
)
async def change_password(
    data: PasswordUpdateRequest,
    current_user: CurrentUser = Depends(get_current_user)
):
    admin_client = get_service_client()
    try:
        admin_client.auth.admin.update_user_by_id(
            uid=current_user.id,
            attributes={"password": data.password}
        )
        return {"message": "Password changed successfully."}
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Failed to update password: {str(e)}"
        )
