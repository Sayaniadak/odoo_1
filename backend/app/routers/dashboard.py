"""
HRMS Backend — Dashboard Router

Aggregates metrics for the frontend based on the user's role.
Returns flat responses to easily drive frontend stat cards.
"""

from datetime import datetime
import pytz
from typing import Dict, Any, List
from fastapi import APIRouter, Depends
from supabase import Client

from backend.app.auth import get_current_user, security, CurrentUser
from backend.app.database import get_supabase_client

router = APIRouter(prefix="/api/dashboard", tags=["Dashboard"])


def get_db(creds=Depends(security)) -> Client:
    return get_supabase_client(creds.credentials)


def get_today_ist() -> str:
    # Use IST since the pg_cron attendance job is scheduled in IST
    ist = pytz.timezone("Asia/Kolkata")
    return datetime.now(ist).strftime("%Y-%m-%d")


@router.get("")
async def get_dashboard(
    user: CurrentUser = Depends(get_current_user),
    db: Client = Depends(get_db)
) -> Dict[str, Any]:
    
    today = get_today_ist()
    role = user.role
    
    # ── 1. EMPLOYEE METRICS ──────────────────────────────────────────────────
    if role == "Employee":
        # Today's attendance
        att_resp = db.table("attendance").select("status").eq("user_id", user.id).eq("date", today).execute()
        attendance_status = att_resp.data[0]["status"] if att_resp.data else "Not Checked In"
        
        # Pending leave count
        leave_resp = db.table("leaves").select("id", count="exact").eq("user_id", user.id).eq("status", "Pending").execute()
        pending_leaves = leave_resp.count if leave_resp.count is not None else 0
        
        # Assigned project count (not completed)
        proj_resp = db.table("projects").select("id", count="exact").eq("assigned_to", user.id).neq("status", "Completed").execute()
        active_projects = proj_resp.count if proj_resp.count is not None else 0
        
        # 5 most recent notifications
        notif_resp = db.table("notifications").select("*").eq("user_id", user.id).order("created_at", desc=True).limit(5).execute()
        
        return {
            "role": "Employee",
            "attendance_status_today": attendance_status,
            "pending_leave_count": pending_leaves,
            "active_project_count": active_projects,
            "recent_notifications": notif_resp.data,
        }

    # ── 2. HR METRICS ────────────────────────────────────────────────────────
    # Common metrics for HR and Admin
    emp_resp = db.table("users").select("id", count="exact").eq("role", "Employee").eq("is_active", True).execute()
    total_employees = emp_resp.count if emp_resp.count is not None else 0

    all_leave_resp = db.table("leaves").select("id", count="exact").eq("status", "Pending").execute()
    total_pending_leaves = all_leave_resp.count if all_leave_resp.count is not None else 0

    att_today_resp = db.table("attendance").select("id", count="exact").eq("date", today).execute()
    checked_in_today = att_today_resp.count if att_today_resp.count is not None else 0

    attendance_rate = 0.0
    if total_employees > 0:
        attendance_rate = round((checked_in_today / total_employees) * 100, 1)

    if role == "HR":
        return {
            "role": "HR",
            "total_employees": total_employees,
            "total_pending_leaves": total_pending_leaves,
            "attendance_completion_rate": attendance_rate,
            "checked_in_today": checked_in_today,
        }

    # ── 3. ADMIN METRICS ─────────────────────────────────────────────────────
    if role == "Admin":
        # Project status breakdown
        projects_all = db.table("projects").select("status").execute()
        proj_breakdown = {"Not Started": 0, "In Progress": 0, "Review": 0, "Completed": 0}
        for p in projects_all.data:
            s = p.get("status")
            if s in proj_breakdown:
                proj_breakdown[s] += 1
                
        # Payroll summary count
        payroll_resp = db.table("payroll").select("id", count="exact").execute()
        total_payroll_records = payroll_resp.count if payroll_resp.count is not None else 0

        return {
            "role": "Admin",
            "total_employees": total_employees,
            "total_pending_leaves": total_pending_leaves,
            "attendance_completion_rate": attendance_rate,
            "checked_in_today": checked_in_today,
            "project_status_breakdown": proj_breakdown,
            "total_payroll_records": total_payroll_records,
        }

    return {"role": role, "message": "Unknown role"}
