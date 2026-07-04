"""
HRMS Backend — Attendance Router

Endpoints:
  POST /api/attendance/check-in  — Clock in for the day
  POST /api/attendance/check-out — Clock out for the day
  GET  /api/attendance/me        — Get own attendance history
  GET  /api/attendance           — Get all attendance (HR/Admin)
"""

from datetime import datetime, date
import pytz
from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException, status
from supabase import Client

from backend.app.auth import get_current_user, require_role, security, CurrentUser
from backend.app.database import get_supabase_client

router = APIRouter(prefix="/api/attendance", tags=["Attendance"])


def get_db(creds=Depends(security)) -> Client:
    return get_supabase_client(creds.credentials)


def get_current_ist_time():
    ist = pytz.timezone("Asia/Kolkata")
    return datetime.now(ist)


# ── Endpoints ────────────────────────────────────────────────────────────────

@router.post("/check-in", summary="Check in for today")
async def check_in(
    user: CurrentUser = Depends(get_current_user),
    db: Client = Depends(get_db)
):
    now_ist = get_current_ist_time()
    today_str = now_ist.strftime("%Y-%m-%d")
    now_iso = now_ist.isoformat()

    # Verify not already checked in
    existing = db.table("attendance").select("id, check_in").eq("user_id", user.id).eq("date", today_str).execute()
    if existing.data and existing.data[0].get("check_in"):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Already checked in today."
        )

    # Insert check-in record (or update if pg_cron already inserted 'Absent' at midnight, 
    # though usually check-in happens before midnight cron. If the row exists without check_in, update it)
    try:
        if existing.data:
            resp = db.table("attendance").update({
                "check_in": now_iso,
                "status": "Present",
                "marked_by": "employee"
            }).eq("id", existing.data[0]["id"]).execute()
        else:
            resp = db.table("attendance").insert({
                "user_id": user.id,
                "date": today_str,
                "check_in": now_iso,
                "status": "Present",
                "marked_by": "employee"
            }).execute()
        return {"message": "Checked in successfully", "data": resp.data[0]}
    except Exception as e:
        raise HTTPException(status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(e))


@router.post("/check-out", summary="Check out for today")
async def check_out(
    user: CurrentUser = Depends(get_current_user),
    db: Client = Depends(get_db)
):
    now_ist = get_current_ist_time()
    today_str = now_ist.strftime("%Y-%m-%d")
    now_iso = now_ist.isoformat()

    # Find today's record
    existing = db.table("attendance").select("*").eq("user_id", user.id).eq("date", today_str).execute()
    if not existing.data:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="No check-in found for today. Please check in first."
        )

    record = existing.data[0]
    if record.get("check_out"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Already checked out for today."
        )

    if not record.get("check_in"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid attendance record: missing check_in time."
        )

    # Calculate hours worked
    check_in_time = datetime.fromisoformat(record["check_in"])
    diff = now_ist - check_in_time
    hours_worked = round(diff.total_seconds() / 3600, 2)
    
    # Apply half-day rule
    new_status = "Half-day" if hours_worked < 4 else "Present"

    # Update check-out, hours, and status
    resp = db.table("attendance").update({
        "check_out": now_iso,
        "hours": hours_worked,
        "status": new_status
    }).eq("id", record["id"]).execute()

    return {"message": "Checked out successfully", "hours_worked": hours_worked, "data": resp.data[0]}


@router.get("/me", summary="Get own attendance history")
async def get_my_attendance(
    from_date: Optional[date] = None,
    to_date: Optional[date] = None,
    limit: int = 30,
    user: CurrentUser = Depends(get_current_user),
    db: Client = Depends(get_db)
):
    # Retrieve own history, ordered by date descending
    query = db.table("attendance").select("*").eq("user_id", user.id)
    if from_date:
        query = query.gte("date", from_date.isoformat())
    if to_date:
        query = query.lte("date", to_date.isoformat())
        
    resp = query.order("date", desc=True).limit(limit).execute()
    return resp.data


@router.get("", summary="Get all attendance (HR/Admin)")
async def get_all_attendance(
    user_id: Optional[str] = None,
    from_date: Optional[date] = None,
    to_date: Optional[date] = None,
    limit: int = 100,
    _: CurrentUser = Depends(require_role("HR", "Admin")),
    db: Client = Depends(get_db)
):
    # Defense-in-depth: restricted to HR/Admin.
    query = db.table("attendance").select("*")
    if user_id:
        query = query.eq("user_id", user_id)
    if from_date:
        query = query.gte("date", from_date.isoformat())
    if to_date:
        query = query.lte("date", to_date.isoformat())
    
    resp = query.order("date", desc=True).limit(limit).execute()
    records = resp.data
    
    # Fetch profiles sequentially to avoid relationship cache error
    if records:
        unique_user_ids = list(set(r["user_id"] for r in records))
        prof_resp = db.table("profiles").select("user_id, full_name, department").in_("user_id", unique_user_ids).execute()
        prof_map = {p["user_id"]: p for p in prof_resp.data or []}
        for r in records:
            r["profiles"] = prof_map.get(r["user_id"])
            
    return records
