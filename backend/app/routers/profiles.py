"""
HRMS Backend — Profiles Router

Endpoints:
  GET  /api/profiles/me         — Own profile
  GET  /api/profiles            — All profiles (HR/Admin)
  GET  /api/profiles/{user_id}  — Single profile
  PUT  /api/profiles/me         — Edit own profile (restricted fields)
  PUT  /api/profiles/{user_id}  — Edit any profile (HR/Admin)
  POST /api/profiles/upload-photo — Upload to Supabase Storage
"""

import uuid
from typing import Optional, List
from datetime import date
from fastapi import APIRouter, Depends, HTTPException, status, UploadFile, File
from fastapi.security import HTTPAuthorizationCredentials
from pydantic import BaseModel, ConfigDict
from supabase import Client

from backend.app.auth import get_current_user, require_role, security, CurrentUser
from backend.app.database import get_supabase_client, get_service_client

router = APIRouter(prefix="/api/profiles", tags=["Profiles"])


# ── Dependencies ─────────────────────────────────────────────────────────────

def get_db(creds: HTTPAuthorizationCredentials = Depends(security)) -> Client:
    """Dependency to get a user-scoped Supabase client for the request."""
    return get_supabase_client(creds.credentials)


# ── Models ───────────────────────────────────────────────────────────────────

class ProfileUpdateMe(BaseModel):
    # extra="forbid" ensures we return a 422 Unprocessable Entity if the
    # client sends fields they aren't allowed to edit (e.g. job_title),
    # rather than silently ignoring them.
    model_config = ConfigDict(extra="forbid")

    phone: Optional[str] = None
    address: Optional[str] = None
    skills: Optional[List[str]] = None
    profile_picture_url: Optional[str] = None
    document_urls: Optional[List[str]] = None


class ProfileUpdateAdmin(BaseModel):
    full_name: Optional[str] = None
    phone: Optional[str] = None
    address: Optional[str] = None
    job_title: Optional[str] = None
    department: Optional[str] = None
    designation: Optional[str] = None
    manager_id: Optional[str] = None
    skills: Optional[List[str]] = None
    profile_picture_url: Optional[str] = None
    document_urls: Optional[List[str]] = None
    joining_date: Optional[date] = None


# ── Endpoints ────────────────────────────────────────────────────────────────

@router.get("/me")
async def get_profile_me(
    user: CurrentUser = Depends(get_current_user),
    db: Client = Depends(get_db)
):
    resp = db.table("profiles").select("*").eq("user_id", user.id).execute()
    if not resp.data:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Profile not found.")
    return resp.data[0]


@router.get("")
async def get_all_profiles(
    # Defense-in-depth: RLS prevents Employees from seeing all profiles,
    # but we also explicitly restrict the endpoint.
    _: CurrentUser = Depends(require_role("HR", "Admin")),
    db: Client = Depends(get_db)
):
    resp = db.table("profiles").select("*").execute()
    return resp.data


@router.get("/{user_id}")
async def get_single_profile(
    user_id: str,
    db: Client = Depends(get_db)
):
    resp = db.table("profiles").select("*").eq("user_id", user_id).execute()
    if not resp.data:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Profile not found.")
    return resp.data[0]


@router.put("/me")
async def update_profile_me(
    data: ProfileUpdateMe,
    user: CurrentUser = Depends(get_current_user),
    db: Client = Depends(get_db)
):
    update_dict = data.model_dump(exclude_unset=True)
    if not update_dict:
        return await get_profile_me(user, db)

    resp = db.table("profiles").update(update_dict).eq("user_id", user.id).execute()
    if not resp.data:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Profile not found or update failed.")
    return resp.data[0]


@router.put("/{user_id}")
async def update_profile_admin(
    user_id: str,
    data: ProfileUpdateAdmin,
    _: CurrentUser = Depends(require_role("HR", "Admin")),
    db: Client = Depends(get_db)
):
    update_dict = data.model_dump(exclude_unset=True)
    # Convert dates to strings for JSON serialization in Supabase payload
    if "joining_date" in update_dict and update_dict["joining_date"]:
        update_dict["joining_date"] = update_dict["joining_date"].isoformat()

    if not update_dict:
        return await get_single_profile(user_id, db)

    resp = db.table("profiles").update(update_dict).eq("user_id", user_id).execute()
    if not resp.data:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Profile not found or update failed.")
    return resp.data[0]


@router.post("/upload-photo")
async def upload_photo(
    file: UploadFile = File(...),
    user: CurrentUser = Depends(get_current_user),
    db: Client = Depends(get_db)
):
    contents = await file.read()
    ext = file.filename.split(".")[-1] if "." in file.filename else "jpg"
    filename = f"{user.id}_{uuid.uuid4().hex[:8]}.{ext}"

    try:
        service_client = get_service_client()
        # Upload to Supabase Storage bucket 'profile_pictures'
        service_client.storage.from_("profile_pictures").upload(
            path=filename,
            file=contents,
            file_options={"content-type": file.content_type}
        )
        # Get public URL
        public_url = service_client.storage.from_("profile_pictures").get_public_url(filename)
        
        # Update user's profile record in the database
        db.table("profiles").update({"profile_picture_url": public_url}).eq("user_id", user.id).execute()
        
        return {"profile_picture_url": public_url}
    except Exception as e:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail=f"Upload failed: {str(e)}")
