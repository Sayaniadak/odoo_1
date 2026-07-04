"""
HRMS Backend — Projects Router (Phase 4)

Endpoints:
  POST   /api/projects               — create (Admin only)
  GET    /api/projects               — all (Admin) or assigned (Employee/HR)
  GET    /api/projects/{id}          — single project detail
  PUT    /api/projects/{id}          — Admin: all fields; Assigned: status only
  PUT    /api/projects/{id}/review   — Admin approves or requests changes
  DELETE /api/projects/{id}          — Admin only
"""

from datetime import date
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, ConfigDict
from supabase import Client

from backend.app.auth import get_current_user, require_role, security, CurrentUser
from backend.app.database import get_supabase_client

router = APIRouter(prefix="/api/projects", tags=["Projects"])

def get_db(creds=Depends(security)) -> Client:
    return get_supabase_client(creds.credentials)


# ── Models ───────────────────────────────────────────────────────────────────

class ProjectCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    title: str
    description: Optional[str] = None
    assigned_to: Optional[str] = None
    deadline: Optional[date] = None
    priority: Optional[str] = None


class ProjectUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    title: Optional[str] = None
    description: Optional[str] = None
    assigned_to: Optional[str] = None
    deadline: Optional[date] = None
    priority: Optional[str] = None
    status: Optional[str] = None


class ProjectReview(BaseModel):
    model_config = ConfigDict(extra="forbid")
    action: str  # "Approve" or "Request Changes"
    admin_comments: Optional[str] = None


# ── Endpoints ────────────────────────────────────────────────────────────────

@router.post("", summary="Create a project (HR/Admin)")
async def create_project(
    data: ProjectCreate,
    user: CurrentUser = Depends(require_role("HR", "Admin")),
    db: Client = Depends(get_db)
):
    resp = db.table("projects").insert({
        "title": data.title,
        "description": data.description,
        "assigned_to": data.assigned_to,
        "deadline": data.deadline.isoformat() if data.deadline else None,
        "priority": data.priority,
        "created_by": user.id,
        "status": "Not Started"
    }).execute()
    
    if data.assigned_to:
        try:
            db.rpc("create_notification", {
                "p_user_id": data.assigned_to,
                "p_title": "Project Assigned",
                "p_message": f"You have been assigned to project: {data.title}",
                "p_type": "system"
            }).execute()
        except:
            pass
            
    return {"message": "Project created successfully", "data": resp.data[0]}


@router.get("", summary="Get projects")
async def get_projects(
    user: CurrentUser = Depends(get_current_user),
    db: Client = Depends(get_db)
):
    query = db.table("projects").select("*")
    if user.role not in ("HR", "Admin"):
        query = query.eq("assigned_to", user.id)
        
    resp = query.order("created_at", desc=True).execute()
    records = resp.data
    
    # Sequential profile lookup to avoid relationship cache issues
    if records:
        unique_user_ids = list(set(
            [r["assigned_to"] for r in records if r.get("assigned_to")] +
            [r["created_by"] for r in records if r.get("created_by")]
        ))
        if unique_user_ids:
            prof_resp = db.table("profiles").select("user_id, full_name").in_("user_id", unique_user_ids).execute()
            prof_map = {p["user_id"]: p for p in prof_resp.data or []}
            for r in records:
                if r.get("assigned_to"):
                    r["assigned_to"] = prof_map.get(r["assigned_to"])
                if r.get("created_by"):
                    r["created_by"] = prof_map.get(r["created_by"])
                    
    return records


@router.get("/{project_id}", summary="Get single project")
async def get_project(
    project_id: str,
    user: CurrentUser = Depends(get_current_user),
    db: Client = Depends(get_db)
):
    resp = db.table("projects").select("*").eq("id", project_id).execute()
    if not resp.data:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Project not found")
        
    project = resp.data[0]
    
    if user.role not in ("HR", "Admin") and project["assigned_to"] != user.id:
        raise HTTPException(status.HTTP_403_FORBIDDEN, detail="You are not assigned to this project.")
        
    # Resolve creator and assignee profiles
    uids = [uid for uid in [project.get("assigned_to"), project.get("created_by")] if uid]
    if uids:
        prof_resp = db.table("profiles").select("user_id, full_name").in_("user_id", uids).execute()
        prof_map = {p["user_id"]: p for p in prof_resp.data or []}
        if project.get("assigned_to"):
            project["assigned_to"] = prof_map.get(project["assigned_to"])
        if project.get("created_by"):
            project["created_by"] = prof_map.get(project["created_by"])
            
    return project


@router.put("/{project_id}", summary="Update project")
async def update_project(
    project_id: str,
    data: ProjectUpdate,
    user: CurrentUser = Depends(get_current_user),
    db: Client = Depends(get_db)
):
    existing = db.table("projects").select("*").eq("id", project_id).execute()
    if not existing.data:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Project not found")
        
    project = existing.data[0]
    
    updates = data.model_dump(exclude_unset=True)
    if not updates:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="No fields to update.")
        
    if "deadline" in updates and updates["deadline"]:
        updates["deadline"] = updates["deadline"].isoformat()
        
        
    if user.role != "Admin":
        if project["assigned_to"] != user.id:
            raise HTTPException(status.HTTP_403_FORBIDDEN, detail="You are not assigned to this project.")
            
        unauthorized_fields = set(updates.keys()) - {"status"}
        if unauthorized_fields:
            # Emulate Pydantic's 422 shape for invalid fields injected manually
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail=f"Extra inputs are not permitted for Employee/HR: {', '.join(unauthorized_fields)}"
            )

    resp = db.table("projects").update(updates).eq("id", project_id).execute()
    
    # Notification: Status changed to In Review
    if updates.get("status") == "In Review" and project.get("status") != "In Review":
        try:
            db.rpc("create_notification", {
                "p_user_id": project["created_by"],
                "p_title": "Project Ready for Review",
                "p_message": f"Project '{project['title']}' has been marked for review.",
                "p_type": "system"
            }).execute()
        except:
            pass

    # Notification: Assignment changed
    if updates.get("assigned_to") and updates.get("assigned_to") != project.get("assigned_to"):
        try:
            db.rpc("create_notification", {
                "p_user_id": updates["assigned_to"],
                "p_title": "Project Assigned",
                "p_message": f"You have been newly assigned to project: {updates.get('title', project['title'])}",
                "p_type": "system"
            }).execute()
        except:
            pass
            
    return {"message": "Project updated successfully", "data": resp.data[0]}


@router.put("/{project_id}/review", summary="Review a project (HR/Admin)")
async def review_project(
    project_id: str,
    data: ProjectReview,
    user: CurrentUser = Depends(require_role("HR", "Admin")),
    db: Client = Depends(get_db)
):
    existing = db.table("projects").select("*").eq("id", project_id).execute()
    if not existing.data:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Project not found")
        
    project = existing.data[0]
    
    if project["status"] != "In Review":
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="Project must be 'In Review' to perform this action.")
        
    if data.action == "Approve":
        new_status = "Completed"
        msg = "approved"
    elif data.action == "Request Changes":
        new_status = "In Progress"
        msg = f"changes requested: {data.admin_comments}"
    else:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="Action must be 'Approve' or 'Request Changes'.")
        
    resp = db.table("projects").update({"status": new_status}).eq("id", project_id).execute()
    
    if project["assigned_to"]:
        try:
            db.rpc("create_notification", {
                "p_user_id": project["assigned_to"],
                "p_title": f"Project {data.action}",
                "p_message": f"Your project '{project['title']}' review result: {msg}",
                "p_type": "system"
            }).execute()
        except:
            pass

    return {"message": f"Project {msg} successfully", "data": resp.data[0]}


@router.delete("/{project_id}", summary="Delete a project (HR/Admin)")
async def delete_project(
    project_id: str,
    _: CurrentUser = Depends(require_role("HR", "Admin")),
    db: Client = Depends(get_db)
):
    resp = db.table("projects").delete().eq("id", project_id).execute()
    if not resp.data:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Project not found")
    return {"message": "Project deleted successfully"}
