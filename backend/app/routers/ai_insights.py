"""
HRMS Backend — AI Insights Router

Endpoints:
  GET /api/ai/insights — Get AI burnout & shortage insights (Admin only)
"""

from datetime import datetime, timedelta
import pytz
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from supabase import Client
from groq import Groq

from backend.app.auth import require_role, security, CurrentUser
from backend.app.config import settings
from backend.app.database import get_supabase_client

router = APIRouter(prefix="/api/ai", tags=["AI Insights"])


def get_db(creds=Depends(security)) -> Client:
    return get_supabase_client(creds.credentials)


# ── Models ───────────────────────────────────────────────────────────────────

class AIInsightResponse(BaseModel):
    summary: str
    generated_at: datetime


# ── Endpoints ────────────────────────────────────────────────────────────────

@router.get("/insights", response_model=AIInsightResponse, summary="Get AI-powered HR insights (HR/Admin)")
async def get_ai_insights(
    user: CurrentUser = Depends(require_role("HR", "Admin")),
    db: Client = Depends(get_db)
):
    ist = pytz.timezone("Asia/Kolkata")
    today = datetime.now(ist).date()
    two_weeks_ago = today - timedelta(days=14)

    # 1. Fetch Attendance (last 14 days)
    try:
        att_resp = db.table("attendance") \
                     .select("date, status, user_id") \
                     .gte("date", two_weeks_ago.isoformat()) \
                     .execute()
        attendance_records = att_resp.data or []
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Database error fetching attendance data: {str(e)}"
        )

    # 2. Fetch Leaves (upcoming or pending/approved leaves)
    try:
        leaves_resp = db.table("leaves") \
                        .select("start_date, end_date, leave_type, status, user_id") \
                        .in_("status", ["Pending", "Approved"]) \
                        .gte("end_date", today.isoformat()) \
                        .execute()
        leave_records = leaves_resp.data or []
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Database error fetching leave data: {str(e)}"
        )

    # Fetch all relevant user profiles in a single query
    user_ids = list(set(
        [a["user_id"] for a in attendance_records] + [l["user_id"] for l in leave_records]
    ))
    
    prof_map = {}
    if user_ids:
        try:
            prof_resp = db.table("profiles").select("user_id, full_name").in_("user_id", user_ids).execute()
            prof_map = {p["user_id"]: p for p in prof_resp.data or []}
        except Exception as e:
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail=f"Database error fetching profile data: {str(e)}"
            )

    # 3. Format Data into Summary String
    # Group attendance by user
    att_summary = {}
    for att in attendance_records:
        prof = prof_map.get(att["user_id"]) or {}
        name = prof.get("full_name") or f"User {att['user_id'][:8]}"
        if name not in att_summary:
            att_summary[name] = {"Present": 0, "Absent": 0, "Half-day": 0}
        status_val = att["status"]
        if status_val in att_summary[name]:
            att_summary[name][status_val] += 1

    att_lines = []
    for name, counts in att_summary.items():
        att_lines.append(
            f"- {name}: Present {counts['Present']} days, Absent {counts['Absent']} days, Half-day {counts['Half-day']} days"
        )
    att_str = "\n".join(att_lines) if att_lines else "No recent attendance data."

    # Format leaves
    leave_lines = []
    for lv in leave_records:
        prof = prof_map.get(lv["user_id"]) or {}
        name = prof.get("full_name") or f"User {lv['user_id'][:8]}"
        leave_lines.append(
            f"- {name} has a {lv['status']} {lv['leave_type']} leave from {lv['start_date']} to {lv['end_date']}"
        )
    leave_str = "\n".join(leave_lines) if leave_lines else "No upcoming leaves."

    # Construct complete prompt data
    insights_data = (
        f"Recent Attendance (Last 14 Days):\n{att_str}\n\n"
        f"Upcoming / Active Leaves:\n{leave_str}"
    )

    # 4. Prompt Groq LLM
    if not settings.GROQ_API_KEY:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="AI Insights temporarily unavailable: Missing API Key."
        )

    try:
        client = Groq(api_key=settings.GROQ_API_KEY)
        completion = client.chat.completions.create(
            model="llama-3.1-8b-instant",
            messages=[
                {
                    "role": "system",
                    "content": (
                        "You are an expert HR Director. Analyze this recent attendance and leave data. "
                        "Identify any high risk of employee burnout and flag any staffing shortage risks due to overlapping leaves. "
                        "Keep the response under 150 words and format it professionally."
                    )
                },
                {
                    "role": "user",
                    "content": insights_data
                }
            ]
        )
        summary = completion.choices[0].message.content
        return AIInsightResponse(
            summary=summary,
            generated_at=datetime.now(pytz.utc)
        )
    except Exception as e:
        print(f"🔥 Groq API Error: {str(e)}")
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="AI Insights temporarily unavailable"
        )
