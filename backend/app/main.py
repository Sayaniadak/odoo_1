"""
HRMS Backend — FastAPI Application

Entry point: uvicorn backend.app.main:app --reload
Swagger docs: http://localhost:8000/docs
"""

from __future__ import annotations

from contextlib import asynccontextmanager
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse, HTMLResponse
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from starlette.exceptions import HTTPException as StarletteHTTPException
from postgrest.exceptions import APIError as PostgrestAPIError

from backend.app.config import settings
from backend.app.routers import auth as auth_router
from backend.app.routers import profiles as profiles_router
from backend.app.routers import dashboard as dashboard_router
from backend.app.routers import attendance as attendance_router
from backend.app.routers import leaves as leaves_router
from backend.app.routers import projects as projects_router
from backend.app.routers import payroll as payroll_router
from backend.app.routers import ai_insights as ai_insights_router


# ── Lifespan (startup / shutdown hooks) ──────────────────────────────────────

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup: verify Supabase connection
    print(f"🚀 HRMS Backend starting...")
    print(f"   Supabase URL: {settings.SUPABASE_URL}")
    print(f"   CORS origin:  {settings.FRONTEND_URL}")
    yield
    # Shutdown
    print("👋 HRMS Backend shutting down.")


# ── App ──────────────────────────────────────────────────────────────────────

app = FastAPI(
    title="HRMS API",
    description=(
        "Human Resource Management System — Backend API.\n\n"
        "**Auth:** Supabase JWT passthrough. Every request is authorized "
        "by Postgres RLS using the calling user's JWT.\n\n"
        "**Roles:** Employee, HR, Admin"
    ),
    version="1.0.0",
    lifespan=lifespan,
    docs_url="/docs",
    redoc_url="/redoc",
)


# ── Exception Handlers ────────────────────────────────────────────────────────

@app.exception_handler(StarletteHTTPException)
async def http_exception_handler(request: Request, exc: StarletteHTTPException):
    return JSONResponse(
        status_code=exc.status_code,
        content={"detail": exc.detail}
    )


@app.exception_handler(PostgrestAPIError)
async def postgrest_exception_handler(request: Request, exc: PostgrestAPIError):
    # Log the database failure privately
    print(f"🔥 Database Error: {exc.message} ({exc.code})")
    
    # Check for specific DB errors like invalid date ranges or formats
    detail = "A database query error occurred."
    if "date/time field value out of range" in exc.message.lower() or "invalid input syntax for type date" in exc.message.lower():
        status_code = 400
        detail = "Invalid date format provided. Please use standard ISO 8601 (YYYY-MM-DD)."
    else:
        status_code = 500
        
    return JSONResponse(
        status_code=status_code,
        content={"detail": detail}
    )


@app.exception_handler(Exception)
async def generic_exception_handler(request: Request, exc: Exception):
    print(f"🔥 Unhandled Error: {str(exc)}")
    import traceback
    traceback.print_exc()
    
    return JSONResponse(
        status_code=500,
        content={"detail": "An internal server error occurred."}
    )

# ── CORS ─────────────────────────────────────────────────────────────────────

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        settings.FRONTEND_URL,
        "http://localhost:3000",     # Next.js dev
        "http://localhost:3001",     # Next.js alt port
        "http://127.0.0.1:3000",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Routers ──────────────────────────────────────────────────────────────────

app.include_router(auth_router.router)
app.include_router(profiles_router.router)
app.include_router(dashboard_router.router)
app.include_router(attendance_router.router)
app.include_router(leaves_router.router)
app.include_router(projects_router.router)
app.include_router(payroll_router.router)
app.include_router(ai_insights_router.router)

# Future routers (Phase 6):
# app.include_router(profiles_router.router)
# app.include_router(attendance_router.router)
# app.include_router(leaves_router.router)
# app.include_router(payroll_router.router)
# app.include_router(projects_router.router)
# app.include_router(notifications_router.router)
# app.include_router(audit_logs_router.router)
# app.include_router(dashboard_router.router)


# ── Health check ─────────────────────────────────────────────────────────────

@app.get(
    "/health",
    tags=["System"],
    summary="Health check",
    description="Returns OK if the server is running and Supabase URL is configured.",
)
async def health():
    return {
        "status": "ok",
        "supabase_url": settings.SUPABASE_URL,
        "version": "1.0.0",
    }


# ── Serve Frontend SPA ───────────────────────────────────────────────────────

app.mount("/assets", StaticFiles(directory="frontend/dist/assets"), name="assets")

@app.get(
    "/",
    tags=["System"],
    summary="Root Redirect Frontend",
    response_class=HTMLResponse
)
async def root():
    try:
        with open("frontend/dist/index.html", "r", encoding="utf-8") as f:
            html_content = f.read()
        return HTMLResponse(content=html_content)
    except FileNotFoundError:
        return HTMLResponse(content="<h1>PulseHR Front-end assets not found. Run npm run build in frontend directory.</h1>", status_code=404)
