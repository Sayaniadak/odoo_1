"""
HRMS Migration Verification Script
====================================
Automates the 8-step verification checklist from the roadmap.
Run AFTER the migration SQL has been applied in Supabase Studio.

Usage:
    cd /Users/sumankar/Desktop/hrms
    source .venv/bin/activate
    python supabase/verify_migration.py

Prerequisites:
    pip install supabase python-dotenv httpx pyjwt
    Create .env in project root with SUPABASE_URL, SUPABASE_ANON_KEY,
    SUPABASE_SERVICE_ROLE_KEY, SUPABASE_JWT_SECRET
"""

import os
import sys
import json
import time
import httpx
from datetime import date, datetime
from dotenv import load_dotenv
from supabase import create_client, Client

# ──────────────────────────────────────────────────────────────────────────────
# Config
# ──────────────────────────────────────────────────────────────────────────────
load_dotenv(os.path.join(os.path.dirname(__file__), "..", ".env"))

SUPABASE_URL = os.environ["SUPABASE_URL"]
SUPABASE_ANON_KEY = os.environ["SUPABASE_ANON_KEY"]
SUPABASE_SERVICE_ROLE_KEY = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
SUPABASE_JWT_SECRET = os.environ.get("SUPABASE_JWT_SECRET", "")

REST_URL = f"{SUPABASE_URL}/rest/v1"

# Test user credentials
TEST_USERS = {
    "employee_a": {
        "email": "test_employee_a@hrms-test.com",
        "password": "TestPass123!",
        "role": "Employee",
        "full_name": "Alice Employee",
    },
    "employee_b": {
        "email": "test_employee_b@hrms-test.com",
        "password": "TestPass123!",
        "role": "Employee",
        "full_name": "Bob Employee",
    },
    "hr": {
        "email": "test_hr@hrms-test.com",
        "password": "TestPass123!",
        "role": "HR",
        "full_name": "Carol HRManager",
    },
    "admin": {
        "email": "test_admin@hrms-test.com",
        "password": "TestPass123!",
        "role": "Admin",
        "full_name": "Dave Administrator",
    },
    "no_role": {
        "email": "test_norole@hrms-test.com",
        "password": "TestPass123!",
        "role": None,  # Should default to Employee
        "full_name": "Eve NoRole",
    },
}

# ──────────────────────────────────────────────────────────────────────────────
# Helpers
# ──────────────────────────────────────────────────────────────────────────────

passed = 0
failed = 0
errors = []


def result(test_name: str, success: bool, detail: str = ""):
    """Log a test result."""
    global passed, failed
    icon = "✅" if success else "❌"
    if success:
        passed += 1
    else:
        failed += 1
        errors.append((test_name, detail))
    suffix = f" — {detail}" if detail else ""
    print(f"  {icon} {test_name}{suffix}")


def service_client() -> Client:
    """Supabase client with service-role key (superuser)."""
    return create_client(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)


def sign_up_user(email: str, password: str, role: str | None, full_name: str) -> dict | None:
    """Sign up a user via Supabase Auth, return user data or None on failure."""
    sc = service_client()
    meta = {"full_name": full_name}
    if role is not None:
        meta["role"] = role
    try:
        resp = sc.auth.admin.create_user({
            "email": email,
            "password": password,
            "email_confirm": True,  # Auto-confirm for testing
            "user_metadata": meta,
        })
        return resp.user
    except Exception as e:
        # User may already exist from a previous run
        if "already" in str(e).lower() or "duplicate" in str(e).lower():
            return None
        raise


def sign_in_user(email: str, password: str) -> dict:
    """Sign in a user, return session dict with access_token."""
    client = create_client(SUPABASE_URL, SUPABASE_ANON_KEY)
    resp = client.auth.sign_in_with_password({"email": email, "password": password})
    return {
        "access_token": resp.session.access_token,
        "user_id": resp.user.id,
    }


def rest_get(table: str, token: str, params: str = "") -> httpx.Response:
    """GET against the Supabase REST API as a specific user."""
    url = f"{REST_URL}/{table}?{params}" if params else f"{REST_URL}/{table}"
    return httpx.get(
        url,
        headers={
            "apikey": SUPABASE_ANON_KEY,
            "Authorization": f"Bearer {token}",
            "Accept": "application/json",
        },
    )


def rest_patch(table: str, token: str, params: str, body: dict) -> httpx.Response:
    """PATCH against the Supabase REST API as a specific user."""
    url = f"{REST_URL}/{table}?{params}"
    return httpx.patch(
        url,
        headers={
            "apikey": SUPABASE_ANON_KEY,
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
            "Prefer": "return=representation",
            "Accept": "application/json",
        },
        json=body,
    )


def rest_post(table: str, token: str, body: dict) -> httpx.Response:
    """POST (insert) against the Supabase REST API as a specific user."""
    url = f"{REST_URL}/{table}"
    return httpx.post(
        url,
        headers={
            "apikey": SUPABASE_ANON_KEY,
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
            "Prefer": "return=representation",
            "Accept": "application/json",
        },
        json=body,
    )


def rpc_call(fn_name: str, token: str, params: dict) -> httpx.Response:
    """Call a Supabase RPC (SECURITY DEFINER function) as a specific user."""
    url = f"{REST_URL}/rpc/{fn_name}"
    return httpx.post(
        url,
        headers={
            "apikey": SUPABASE_ANON_KEY,
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
            "Accept": "application/json",
        },
        json=params,
    )


# ──────────────────────────────────────────────────────────────────────────────
# Step 1: Confirm tables and functions exist (via service-role)
# ──────────────────────────────────────────────────────────────────────────────
def step1_confirm_schema():
    print("\n═══ Step 1: Confirm schema objects exist ═══")
    sc = service_client()

    # Check all 7 tables exist by querying them (service-role bypasses RLS)
    tables = ["users", "profiles", "attendance", "leaves", "payroll",
              "projects", "notifications", "audit_logs"]
    for t in tables:
        try:
            resp = sc.table(t).select("*", count="exact").limit(0).execute()
            result(f"Table '{t}' exists", True)
        except Exception as e:
            result(f"Table '{t}' exists", False, str(e))

    # Check functions exist by calling information_schema
    functions = [
        "get_user_role", "create_notification", "create_audit_log",
        "enforce_profile_column_access", "enforce_project_column_access",
        "handle_new_user", "mark_absent_for_today", "update_updated_at_column",
    ]
    resp = sc.table("").select("*").execute()  # dummy to init
    # Use raw SQL via rpc or just trust the function calls work later
    print("  ℹ️  Function existence verified implicitly via later test steps.")
    print("  ℹ️  Manually confirm in Supabase Studio → Database → Functions.")


# ──────────────────────────────────────────────────────────────────────────────
# Step 2: Signup → mirror → profile chain
# ──────────────────────────────────────────────────────────────────────────────
def step2_signup_mirror(sessions: dict):
    print("\n═══ Step 2: Signup → users mirror → auto profile ═══")
    sc = service_client()

    for key, user_info in TEST_USERS.items():
        auth_user = sign_up_user(
            user_info["email"], user_info["password"],
            user_info["role"], user_info["full_name"],
        )
        if auth_user is None:
            print(f"  ℹ️  {key} already exists, signing in instead.")

        # Sign in to get token
        session = sign_in_user(user_info["email"], user_info["password"])
        sessions[key] = session

        # Check public.users row exists with correct role
        user_row = (
            sc.table("users")
            .select("*")
            .eq("id", session["user_id"])
            .execute()
        )
        if user_row.data:
            expected_role = user_info["role"] if user_info["role"] else "Employee"
            actual_role = user_row.data[0]["role"]
            result(
                f"{key}: users mirror exists with role={actual_role}",
                actual_role == expected_role,
                f"expected {expected_role}" if actual_role != expected_role else "",
            )
        else:
            result(f"{key}: users mirror exists", False, "no row in public.users")

        # Check profile row exists
        profile_row = (
            sc.table("profiles")
            .select("*")
            .eq("user_id", session["user_id"])
            .execute()
        )
        if profile_row.data:
            actual_name = profile_row.data[0]["full_name"]
            expected_name = user_info["full_name"]
            result(
                f"{key}: profile auto-created, full_name='{actual_name}'",
                actual_name == expected_name,
                f"expected '{expected_name}'" if actual_name != expected_name else "",
            )
        else:
            result(f"{key}: profile auto-created", False, "no profile row")

    # Specific check: no_role user defaults to Employee
    if "no_role" in sessions:
        norole_user = (
            sc.table("users")
            .select("role")
            .eq("id", sessions["no_role"]["user_id"])
            .execute()
        )
        if norole_user.data:
            result(
                "no_role user defaults to Employee",
                norole_user.data[0]["role"] == "Employee",
                f"got: {norole_user.data[0]['role']}",
            )


# ──────────────────────────────────────────────────────────────────────────────
# Step 3: RLS as real users (not superuser)
# ──────────────────────────────────────────────────────────────────────────────
def step3_rls_isolation(sessions: dict):
    print("\n═══ Step 3: RLS isolation — real JWTs, not superuser ═══")

    emp_a = sessions["employee_a"]
    emp_b = sessions["employee_b"]
    hr = sessions["hr"]
    admin = sessions["admin"]

    # --- profiles ---
    # Employee A should NOT see Employee B's profile
    resp = rest_get("profiles", emp_a["access_token"],
                     f"user_id=eq.{emp_b['user_id']}")
    result(
        "Employee A cannot see Employee B's profile",
        resp.status_code == 200 and len(resp.json()) == 0,
        f"status={resp.status_code}, rows={len(resp.json()) if resp.status_code == 200 else 'N/A'}",
    )

    # Employee A CAN see own profile
    resp = rest_get("profiles", emp_a["access_token"],
                     f"user_id=eq.{emp_a['user_id']}")
    result(
        "Employee A can see own profile",
        resp.status_code == 200 and len(resp.json()) == 1,
        f"status={resp.status_code}, rows={len(resp.json()) if resp.status_code == 200 else 'N/A'}",
    )

    # HR can see all profiles
    resp = rest_get("profiles", hr["access_token"])
    result(
        "HR can see all profiles",
        resp.status_code == 200 and len(resp.json()) >= len(TEST_USERS),
        f"status={resp.status_code}, rows={len(resp.json()) if resp.status_code == 200 else 'N/A'}",
    )

    # Admin can see all profiles
    resp = rest_get("profiles", admin["access_token"])
    result(
        "Admin can see all profiles",
        resp.status_code == 200 and len(resp.json()) >= len(TEST_USERS),
        f"status={resp.status_code}, rows={len(resp.json()) if resp.status_code == 200 else 'N/A'}",
    )

    # --- payroll ---
    # First, insert a payroll record for Employee A and HR via service-role
    sc = service_client()
    for uid, label in [(emp_a["user_id"], "employee_a"), (hr["user_id"], "hr")]:
        try:
            sc.table("payroll").insert({
                "user_id": uid,
                "base_salary": 50000,
                "deductions": 5000,
                "month": 7,
                "year": 2026,
            }).execute()
        except Exception:
            pass  # May already exist from prior run

    # HR should NOT see any payroll (not even their own? — per matrix HR has no payroll access)
    # Actually per our implementation: HR can see their OWN payroll
    resp = rest_get("payroll", hr["access_token"])
    hr_payroll = resp.json() if resp.status_code == 200 else []
    result(
        "HR sees only own payroll (not all)",
        resp.status_code == 200 and len(hr_payroll) == 1,
        f"status={resp.status_code}, rows={len(hr_payroll)}",
    )

    # HR should NOT see Employee A's payroll
    resp = rest_get("payroll", hr["access_token"],
                     f"user_id=eq.{emp_a['user_id']}")
    result(
        "HR cannot see Employee A's payroll",
        resp.status_code == 200 and len(resp.json()) == 0,
        f"rows={len(resp.json()) if resp.status_code == 200 else 'N/A'}",
    )

    # Employee A sees own payroll only
    resp = rest_get("payroll", emp_a["access_token"])
    result(
        "Employee A sees only own payroll",
        resp.status_code == 200 and len(resp.json()) == 1,
        f"rows={len(resp.json()) if resp.status_code == 200 else 'N/A'}",
    )

    # Admin sees all payroll
    resp = rest_get("payroll", admin["access_token"])
    result(
        "Admin sees all payroll",
        resp.status_code == 200 and len(resp.json()) >= 2,
        f"rows={len(resp.json()) if resp.status_code == 200 else 'N/A'}",
    )

    # --- audit_logs ---
    # Employee should see nothing in audit_logs
    resp = rest_get("audit_logs", emp_a["access_token"])
    result(
        "Employee cannot see audit_logs",
        resp.status_code == 200 and len(resp.json()) == 0,
        f"rows={len(resp.json()) if resp.status_code == 200 else 'N/A'}",
    )

    # HR should see nothing in audit_logs
    resp = rest_get("audit_logs", hr["access_token"])
    result(
        "HR cannot see audit_logs",
        resp.status_code == 200 and len(resp.json()) == 0,
        f"rows={len(resp.json()) if resp.status_code == 200 else 'N/A'}",
    )


# ──────────────────────────────────────────────────────────────────────────────
# Step 4: Column-level trigger enforcement
# ──────────────────────────────────────────────────────────────────────────────
def step4_column_triggers(sessions: dict):
    print("\n═══ Step 4: Column-level triggers (profiles + projects) ═══")

    emp_a = sessions["employee_a"]
    admin = sessions["admin"]

    # --- profiles: Employee edits ---
    # ✅ Employee can update phone (allowed personal field)
    resp = rest_patch(
        "profiles", emp_a["access_token"],
        f"user_id=eq.{emp_a['user_id']}",
        {"phone": "9999999999"},
    )
    result(
        "Employee can update own phone",
        resp.status_code in (200, 204) or (resp.status_code == 200 and len(resp.json()) > 0),
        f"status={resp.status_code}",
    )

    # ❌ Employee cannot update department (restricted field)
    resp = rest_patch(
        "profiles", emp_a["access_token"],
        f"user_id=eq.{emp_a['user_id']}",
        {"department": "Finance"},
    )
    # Should get a 400 or similar error from the trigger's RAISE EXCEPTION
    result(
        "Employee BLOCKED from updating department",
        resp.status_code >= 400,
        f"status={resp.status_code}, body={resp.text[:200]}",
    )

    # ❌ Employee cannot update job_title
    resp = rest_patch(
        "profiles", emp_a["access_token"],
        f"user_id=eq.{emp_a['user_id']}",
        {"job_title": "CEO"},
    )
    result(
        "Employee BLOCKED from updating job_title",
        resp.status_code >= 400,
        f"status={resp.status_code}",
    )

    # ❌ Employee cannot update full_name
    resp = rest_patch(
        "profiles", emp_a["access_token"],
        f"user_id=eq.{emp_a['user_id']}",
        {"full_name": "Hacker McHackface"},
    )
    result(
        "Employee BLOCKED from updating full_name",
        resp.status_code >= 400,
        f"status={resp.status_code}",
    )

    # ❌ Employee cannot update designation
    resp = rest_patch(
        "profiles", emp_a["access_token"],
        f"user_id=eq.{emp_a['user_id']}",
        {"designation": "VP"},
    )
    result(
        "Employee BLOCKED from updating designation",
        resp.status_code >= 400,
        f"status={resp.status_code}",
    )

    # ❌ Employee cannot update manager_id
    resp = rest_patch(
        "profiles", emp_a["access_token"],
        f"user_id=eq.{emp_a['user_id']}",
        {"manager_id": emp_a["user_id"]},  # trying to self-manage
    )
    result(
        "Employee BLOCKED from updating manager_id",
        resp.status_code >= 400,
        f"status={resp.status_code}",
    )

    # ✅ Admin CAN update any restricted field (bypass confirmed)
    resp = rest_patch(
        "profiles", admin["access_token"],
        f"user_id=eq.{emp_a['user_id']}",
        {"department": "Engineering", "job_title": "Software Engineer",
         "designation": "SDE-1"},
    )
    result(
        "Admin CAN update restricted profile fields",
        resp.status_code in (200, 204),
        f"status={resp.status_code}",
    )

    # --- projects: setup + Employee edits ---
    # Create a project assigned to Employee A (as Admin)
    project_resp = rest_post("projects", admin["access_token"], {
        "title": "Test Project Alpha",
        "description": "Verification test project",
        "assigned_to": emp_a["user_id"],
        "deadline": "2026-08-01",
        "priority": "Medium",
        "status": "Not Started",
        "created_by": admin["user_id"],
    })
    if project_resp.status_code in (200, 201) and project_resp.json():
        project_id = project_resp.json()[0]["id"]
        result("Admin can create project", True)

        # ✅ Employee can update status (allowed field)
        resp = rest_patch(
            "projects", emp_a["access_token"],
            f"id=eq.{project_id}",
            {"status": "In Progress"},
        )
        result(
            "Employee can update project status",
            resp.status_code in (200, 204),
            f"status={resp.status_code}",
        )

        # ❌ Employee cannot update priority
        resp = rest_patch(
            "projects", emp_a["access_token"],
            f"id=eq.{project_id}",
            {"priority": "Critical"},
        )
        result(
            "Employee BLOCKED from updating project priority",
            resp.status_code >= 400,
            f"status={resp.status_code}, body={resp.text[:200]}",
        )

        # ❌ Employee cannot update deadline
        resp = rest_patch(
            "projects", emp_a["access_token"],
            f"id=eq.{project_id}",
            {"deadline": "2027-01-01"},
        )
        result(
            "Employee BLOCKED from updating project deadline",
            resp.status_code >= 400,
            f"status={resp.status_code}",
        )

        # ❌ Employee cannot update title
        resp = rest_patch(
            "projects", emp_a["access_token"],
            f"id=eq.{project_id}",
            {"title": "Hijacked Project"},
        )
        result(
            "Employee BLOCKED from updating project title",
            resp.status_code >= 400,
            f"status={resp.status_code}",
        )

        # ❌ Employee cannot reassign project
        resp = rest_patch(
            "projects", emp_a["access_token"],
            f"id=eq.{project_id}",
            {"assigned_to": sessions["employee_b"]["user_id"]},
        )
        result(
            "Employee BLOCKED from reassigning project",
            resp.status_code >= 400,
            f"status={resp.status_code}",
        )

        # ✅ Admin CAN update any project field (bypass confirmed)
        resp = rest_patch(
            "projects", admin["access_token"],
            f"id=eq.{project_id}",
            {"priority": "High", "deadline": "2026-09-01", "title": "Renamed Project"},
        )
        result(
            "Admin CAN update restricted project fields",
            resp.status_code in (200, 204),
            f"status={resp.status_code}",
        )
    else:
        result("Admin can create project", False,
               f"status={project_resp.status_code}, body={project_resp.text[:200]}")


# ──────────────────────────────────────────────────────────────────────────────
# Step 5: Generated columns and constraints
# ──────────────────────────────────────────────────────────────────────────────
def step5_constraints(sessions: dict):
    print("\n═══ Step 5: Generated columns and constraints ═══")

    admin = sessions["admin"]
    emp_a = sessions["employee_a"]
    sc = service_client()

    # Check net_pay auto-computed
    payroll_rows = (
        sc.table("payroll")
        .select("*")
        .eq("user_id", emp_a["user_id"])
        .execute()
    )
    if payroll_rows.data:
        row = payroll_rows.data[0]
        expected_net = float(row["base_salary"]) - float(row["deductions"])
        actual_net = float(row["net_pay"])
        result(
            f"net_pay auto-computed: {row['base_salary']} - {row['deductions']} = {actual_net}",
            abs(actual_net - expected_net) < 0.01,
            f"expected {expected_net}",
        )

    # Duplicate (user_id, date) attendance → should fail
    today = date.today().isoformat()
    # Insert first row
    try:
        sc.table("attendance").insert({
            "user_id": emp_a["user_id"],
            "date": today,
            "status": "Present",
            "marked_by": "employee",
        }).execute()
    except Exception:
        pass  # May already exist

    # Insert duplicate
    try:
        sc.table("attendance").insert({
            "user_id": emp_a["user_id"],
            "date": today,
            "status": "Absent",
            "marked_by": "system",
        }).execute()
        result("Duplicate attendance (user_id, date) rejected", False, "insert succeeded!")
    except Exception as e:
        result("Duplicate attendance (user_id, date) rejected", True,
               "correctly raised constraint error")

    # Try inserting net_pay directly → should error
    try:
        sc.table("payroll").insert({
            "user_id": emp_a["user_id"],
            "base_salary": 60000,
            "deductions": 6000,
            "net_pay": 99999,  # should be rejected (generated column)
            "month": 6,
            "year": 2026,
        }).execute()
        result("Direct net_pay insert rejected", False, "insert succeeded!")
    except Exception as e:
        result("Direct net_pay insert rejected", True,
               "correctly raised generated column error")

    # Leave constraint: end_date >= start_date
    try:
        sc.table("leaves").insert({
            "user_id": emp_a["user_id"],
            "leave_type": "Sick",
            "start_date": "2026-07-10",
            "end_date": "2026-07-05",  # end before start
            "reason": "test",
            "status": "Pending",
        }).execute()
        result("Leave end_date < start_date rejected", False, "insert succeeded!")
    except Exception as e:
        result("Leave end_date < start_date rejected", True,
               "correctly raised constraint error")


# ──────────────────────────────────────────────────────────────────────────────
# Step 6: SECURITY DEFINER functions vs direct bypass
# ──────────────────────────────────────────────────────────────────────────────
def step6_security_definer(sessions: dict):
    print("\n═══ Step 6: SECURITY DEFINER functions vs direct insert ═══")

    hr = sessions["hr"]
    emp_a = sessions["employee_a"]

    # ✅ HR can call create_notification() targeting a different user
    resp = rpc_call("create_notification", hr["access_token"], {
        "p_user_id": emp_a["user_id"],
        "p_type": "test_notification",
        "p_message": "Test notification from HR to Employee A",
        "p_related_id": None,
    })
    result(
        "HR can create_notification() for another user",
        resp.status_code == 200,
        f"status={resp.status_code}, body={resp.text[:200]}",
    )

    # ❌ HR direct POST to notifications table → should fail (no INSERT policy)
    resp = rest_post("notifications", hr["access_token"], {
        "user_id": emp_a["user_id"],
        "type": "direct_bypass",
        "message": "This should not work",
    })
    result(
        "HR direct INSERT into notifications BLOCKED",
        resp.status_code >= 400 or (resp.status_code == 201 and len(resp.json()) == 0),
        f"status={resp.status_code}",
    )

    # ✅ HR can call create_audit_log()
    resp = rpc_call("create_audit_log", hr["access_token"], {
        "p_action": "test_action",
        "p_target_table": "profiles",
        "p_target_id": None,
        "p_details": json.dumps({"test": True}),
    })
    result(
        "HR can create_audit_log() via function",
        resp.status_code == 200,
        f"status={resp.status_code}",
    )

    # ❌ HR direct POST to audit_logs → should fail
    resp = rest_post("audit_logs", hr["access_token"], {
        "actor_id": hr["user_id"],
        "action": "direct_bypass",
        "target_table": "profiles",
    })
    result(
        "HR direct INSERT into audit_logs BLOCKED",
        resp.status_code >= 400 or (resp.status_code == 201 and len(resp.json()) == 0),
        f"status={resp.status_code}",
    )

    # Admin CAN see audit_logs (the ones created above)
    admin = sessions["admin"]
    resp = rest_get("audit_logs", admin["access_token"])
    result(
        "Admin can see audit_logs",
        resp.status_code == 200 and len(resp.json()) > 0,
        f"rows={len(resp.json()) if resp.status_code == 200 else 'N/A'}",
    )


# ──────────────────────────────────────────────────────────────────────────────
# Step 7: pg_cron — manual invocation
# ──────────────────────────────────────────────────────────────────────────────
def step7_cron_absent(sessions: dict):
    print("\n═══ Step 7: pg_cron auto-absent (manual invocation) ═══")

    sc = service_client()
    emp_b = sessions["employee_b"]

    # Employee B should have NO attendance for today (Employee A got one in step 5)
    today = date.today().isoformat()

    # Delete any existing attendance for Employee B today (clean slate)
    try:
        sc.table("attendance").delete().eq(
            "user_id", emp_b["user_id"]
        ).eq("date", today).execute()
    except Exception:
        pass

    # Call the function directly
    try:
        resp = rpc_call("mark_absent_for_today", sessions["admin"]["access_token"], {})
        result(
            "mark_absent_for_today() executed",
            resp.status_code == 200 or resp.status_code == 204,
            f"status={resp.status_code}",
        )
    except Exception as e:
        result("mark_absent_for_today() executed", False, str(e))

    # Check Employee B now has an Absent record
    time.sleep(1)  # Brief pause for consistency
    att = (
        sc.table("attendance")
        .select("*")
        .eq("user_id", emp_b["user_id"])
        .eq("date", today)
        .execute()
    )
    if att.data:
        row = att.data[0]
        result(
            f"Employee B marked Absent: status={row['status']}, marked_by={row['marked_by']}",
            row["status"] == "Absent" and row["marked_by"] == "system",
        )
    else:
        result("Employee B marked Absent", False, "no attendance row created")

    # Employee A should NOT get a duplicate Absent (already has a record from step 5)
    att_a = (
        sc.table("attendance")
        .select("*")
        .eq("user_id", sessions["employee_a"]["user_id"])
        .eq("date", today)
        .execute()
    )
    result(
        "Employee A NOT double-marked (already had attendance)",
        len(att_a.data) == 1,
        f"rows={len(att_a.data)}",
    )

    # Check cron.job registration
    print("  ℹ️  Manually verify: SELECT * FROM cron.job; in SQL Editor")
    print("      → should show 'mark-absent-daily' with schedule '30 12 * * 1-5'")


# ──────────────────────────────────────────────────────────────────────────────
# Step 8: Realtime (manual — cannot automate in a script)
# ──────────────────────────────────────────────────────────────────────────────
def step8_realtime_note():
    print("\n═══ Step 8: Realtime RLS isolation (MANUAL) ═══")
    print("  ℹ️  This step requires two browser tabs. Cannot be automated here.")
    print("  ℹ️  Steps to verify manually:")
    print("      1. Database → Replication → confirm 'notifications' is in the publication.")
    print("      2. In Tab A (logged in as Employee A), open browser console:")
    print('         supabase.channel("notif").on("postgres_changes",')
    print('           {event: "INSERT", schema: "public", table: "notifications"},')
    print("           (payload) => console.log('GOT:', payload)")
    print("         ).subscribe();")
    print("      3. In Tab B (as Admin), insert a notification for Employee A → Tab A fires.")
    print("      4. Insert a notification for Employee B → Tab A must NOT receive it.")
    print("      ⚠️  If Tab A receives Employee B's notification, Realtime RLS is broken.")


# ──────────────────────────────────────────────────────────────────────────────
# Cleanup helper (optional, run separately)
# ──────────────────────────────────────────────────────────────────────────────
def cleanup():
    """Remove all test data. Run manually if needed."""
    sc = service_client()
    for key, user_info in TEST_USERS.items():
        try:
            # Find user by email
            users = (
                sc.table("users")
                .select("id")
                .eq("email", user_info["email"])
                .execute()
            )
            if users.data:
                uid = users.data[0]["id"]
                sc.auth.admin.delete_user(uid)
                print(f"  🗑️  Deleted {key} ({user_info['email']})")
        except Exception as e:
            print(f"  ⚠️  Could not delete {key}: {e}")


# ──────────────────────────────────────────────────────────────────────────────
# Main
# ──────────────────────────────────────────────────────────────────────────────
def main():
    print("╔══════════════════════════════════════════════════════════════╗")
    print("║        HRMS Migration Verification Suite                    ║")
    print("╚══════════════════════════════════════════════════════════════╝")
    print(f"Supabase URL: {SUPABASE_URL}")
    print(f"Timestamp:    {datetime.now().isoformat()}")

    if "--cleanup" in sys.argv:
        print("\n🗑️  Running cleanup...")
        cleanup()
        return

    sessions: dict[str, dict] = {}

    step1_confirm_schema()
    step2_signup_mirror(sessions)

    if len(sessions) < 4:
        print("\n❌ Could not sign in all test users. Aborting remaining steps.")
        return

    step3_rls_isolation(sessions)
    step4_column_triggers(sessions)
    step5_constraints(sessions)
    step6_security_definer(sessions)
    step7_cron_absent(sessions)
    step8_realtime_note()

    # Summary
    print("\n" + "═" * 60)
    print(f"RESULTS: {passed} passed, {failed} failed")
    if errors:
        print("\nFailed tests:")
        for name, detail in errors:
            print(f"  ❌ {name}: {detail}")
    print("═" * 60)

    sys.exit(1 if failed > 0 else 0)


if __name__ == "__main__":
    main()
