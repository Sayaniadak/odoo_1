"""
HRMS Backend — Leaves Router

Endpoints:
  POST /api/leaves               — Apply for leave
  GET  /api/leaves/me            — View own leave requests
  GET  /api/leaves               — View all leaves (HR/Admin)
  PUT  /api/leaves/{id}/approve  — Approve leave (HR/Admin)
  PUT  /api/leaves/{id}/reject   — Reject leave (HR/Admin)
"""

from datetime import date
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, ConfigDict
from supabase import Client

from backend.app.auth import get_current_user, require_role, security, CurrentUser
from backend.app.database import get_supabase_client

router = APIRouter(prefix="/api/leaves", tags=["Leaves"])


def get_db(creds=Depends(security)) -> Client:
    return get_supabase_client(creds.credentials)


# ── Models ───────────────────────────────────────────────────────────────────

class LeaveRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    leave_type: str  # e.g., "Paid", "Sick", "Unpaid"
    start_date: date
    end_date: date
    reason: str


class RejectRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    admin_comments: str


# ── Endpoints ────────────────────────────────────────────────────────────────

@router.post("", summary="Apply for leave")
async def apply_leave(
    data: LeaveRequest,
    user: CurrentUser = Depends(get_current_user),
    db: Client = Depends(get_db)
):
    if data.start_date > data.end_date:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="start_date cannot be after end_date."
        )

    # Check for overlaps: 
    # Existing leave overlaps if existing.start <= new.end AND existing.end >= new.start
    # Only consider Pending or Approved leaves.
    existing = db.table("leaves").select("id")\
        .eq("user_id", user.id)\
        .in_("status", ["Pending", "Approved"])\
        .lte("start_date", data.end_date.isoformat())\
        .gte("end_date", data.start_date.isoformat())\
        .execute()
        
    if existing.data:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Requested dates overlap with an existing Pending or Approved leave."
        )
        
    try:
        resp = db.table("leaves").insert({
            "user_id": user.id,
            "leave_type": data.leave_type,
            "start_date": data.start_date.isoformat(),
            "end_date": data.end_date.isoformat(),
            "reason": data.reason,
            "status": "Pending"
        }).execute()
        return {"message": "Leave application submitted.", "data": resp.data[0]}
    except Exception as e:
        raise HTTPException(status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(e))


@router.get("/me", summary="Get own leave requests")
async def get_my_leaves(
    user: CurrentUser = Depends(get_current_user),
    db: Client = Depends(get_db)
):
    resp = db.table("leaves").select("*").eq("user_id", user.id).order("start_date", desc=True).execute()
    return resp.data


@router.get("", summary="Get all leave requests (HR/Admin)")
async def get_all_leaves(
    status_filter: Optional[str] = None,
    _: CurrentUser = Depends(require_role("HR", "Admin")),
    db: Client = Depends(get_db)
):
    query = db.table("leaves").select("*")
    if status_filter:
        query = query.eq("status", status_filter)
        
    resp = query.order("start_date", desc=True).execute()
    records = resp.data
    
    # Fetch profiles sequentially to avoid relationship cache error
    if records:
        unique_user_ids = list(set(r["user_id"] for r in records))
        prof_resp = db.table("profiles").select("user_id, full_name, department").in_("user_id", unique_user_ids).execute()
        prof_map = {p["user_id"]: p for p in prof_resp.data or []}
        for r in records:
            r["profiles"] = prof_map.get(r["user_id"])
            
    return records


@router.put("/{leave_id}/approve", summary="Approve a leave request (HR/Admin)")
async def approve_leave(
    leave_id: str,
    _: CurrentUser = Depends(require_role("HR", "Admin")),
    db: Client = Depends(get_db)
):
    # Fetch leave to verify it is Pending
    leave = db.table("leaves").select("*").eq("id", leave_id).execute()
    if not leave.data:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Leave request not found.")
        
    if leave.data[0]["status"] != "Pending":
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            detail=f"Cannot approve. Current status is {leave.data[0]['status']}."
        )

    # Update status
    resp = db.table("leaves").update({"status": "Approved"}).eq("id", leave_id).execute()
    
    # Notify employee (ignore errors so we don't fail the API call if notification fails)
    try:
        db.rpc("create_notification", {
            "p_user_id": leave.data[0]["user_id"],
            "p_title": "Leave Approved",
            "p_message": f"Your leave from {leave.data[0]['start_date']} to {leave.data[0]['end_date']} has been approved.",
            "p_type": "leave"
        }).execute()
    except Exception:
        pass
        
    return {"message": "Leave approved.", "data": resp.data[0]}


@router.put("/{leave_id}/reject", summary="Reject a leave request (HR/Admin)")
async def reject_leave(
    leave_id: str,
    data: RejectRequest,
    _: CurrentUser = Depends(require_role("HR", "Admin")),
    db: Client = Depends(get_db)
):
    leave = db.table("leaves").select("*").eq("id", leave_id).execute()
    if not leave.data:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Leave request not found.")
        
    if leave.data[0]["status"] != "Pending":
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            detail=f"Cannot reject. Current status is {leave.data[0]['status']}."
        )

    resp = db.table("leaves").update({
        "status": "Rejected",
        "admin_comments": data.admin_comments
    }).eq("id", leave_id).execute()
    
    try:
        db.rpc("create_notification", {
            "p_user_id": leave.data[0]["user_id"],
            "p_title": "Leave Rejected",
            "p_message": f"Your leave request has been rejected. Reason: {data.admin_comments}",
            "p_type": "leave"
        }).execute()
    except Exception:
        pass
        
    return {"message": "Leave rejected.", "data": resp.data[0]}
