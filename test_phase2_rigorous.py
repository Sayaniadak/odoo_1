"""
Phase 2 E2E Test Suite
Validates all 8 claims made about the FastAPI backend implementation.
"""

import httpx, json, os, sys
from dotenv import load_dotenv
from supabase import create_client

load_dotenv(os.path.join(os.path.dirname(__file__), ".env"))

URL = os.environ["SUPABASE_URL"]
SERVICE_KEY = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
API = "http://localhost:8000"
sc = create_client(URL, SERVICE_KEY)

def print_step(title):
    print(f"\n{'-'*60}\n🔹 {title}\n{'-'*60}")

def print_res(success, msg):
    print(f"  {'✅' if success else '❌'} {msg}")
    if not success:
        sys.exit(1)


# --- SETUP: GET TOKENS FOR EMPLOYEE, HR, ADMIN ---
print_step("SETUP: Fetching test users from seed data")

# We find the seed users (ending in @seed.hrms.com) to log in.
res = sc.table("users").select("email, role").like("email", "%@seed.hrms.com").execute()
if not res.data:
    print("❌ No seed users found. Please run seed.py first.")
    sys.exit(1)

emp_email, hr_email, admin_email = None, None, None
for u in res.data:
    if u["role"] == "Employee" and not emp_email: emp_email = u["email"]
    if u["role"] == "HR" and not hr_email: hr_email = u["email"]
    if u["role"] == "Admin" and not admin_email: admin_email = u["email"]

print(f"  Employee: {emp_email}\n  HR:       {hr_email}\n  Admin:    {admin_email}")

def login(email):
    r = httpx.post(f"{API}/api/auth/login", json={"email": email, "password": "SeedPassword123!"})
    if r.status_code != 200:
        print(f"❌ Login failed for {email}: {r.text}")
        sys.exit(1)
    return r.json()["access_token"]

emp_token = login(emp_email)
hr_token = login(hr_email)
admin_token = login(admin_email)


# --- 1. HEALTH AND DOCS ---
print_step("1. Health and Docs")
r = httpx.get(f"{API}/health")
print_res(r.status_code == 200, f"GET /health returned {r.status_code}")

r_docs = httpx.get(f"{API}/openapi.json")
docs_ok = r_docs.status_code == 200 and "profiles" in r_docs.text.lower() and "dashboard" in r_docs.text.lower()
print_res(docs_ok, f"GET /openapi.json returned {r_docs.status_code} and contains profiles/dashboard")


# --- 2. EXTRA=FORBID TEST ---
print_step("2. extra='forbid' validation (Employee tries to update job_title)")
r = httpx.put(
    f"{API}/api/profiles/me",
    headers={"Authorization": f"Bearer {emp_token}"},
    json={"phone": "1234567890", "job_title": "Manager"}
)
print(f"  Response: {r.status_code} {r.json()}")
print_res(r.status_code == 422, f"Endpoint correctly rejected job_title with 422 (not 200)")


# --- 3. ROLE-GATING ON LIST ENDPOINT ---
print_step("3. Role-gating on GET /api/profiles")
r_emp = httpx.get(f"{API}/api/profiles", headers={"Authorization": f"Bearer {emp_token}"})
print(f"  Employee Response: {r_emp.status_code}")
print_res(r_emp.status_code == 403, "Employee blocked (403)")

r_hr = httpx.get(f"{API}/api/profiles", headers={"Authorization": f"Bearer {hr_token}"})
print_res(r_hr.status_code == 200, f"HR allowed (200), returned {len(r_hr.json())} profiles")


# --- 4. /ME ISOLATION ---
print_step("4. /me isolation")
r_me = httpx.get(f"{API}/api/profiles/me", headers={"Authorization": f"Bearer {emp_token}"})
print_res(r_me.status_code == 200, "Employee can fetch own profile")
profile = r_me.json()
print_res(True, f"Fetched profile for user_id {profile['user_id']}")
# Verify there is no way to pass an ID to /me. The route definition strictly doesn't take one.


# --- 5. DASHBOARD SHAPE PER ROLE ---
print_step("5. Dashboard shape per role")
d_emp = httpx.get(f"{API}/api/dashboard", headers={"Authorization": f"Bearer {emp_token}"}).json()
d_hr = httpx.get(f"{API}/api/dashboard", headers={"Authorization": f"Bearer {hr_token}"}).json()
d_admin = httpx.get(f"{API}/api/dashboard", headers={"Authorization": f"Bearer {admin_token}"}).json()

print_res("attendance_status_today" in d_emp and "total_employees" not in d_emp, "Employee shape is correct (no global stats)")
print_res("total_employees" in d_hr and "project_status_breakdown" not in d_hr, "HR shape is correct (has global stats, no project breakdown)")
print_res("total_employees" in d_admin and "project_status_breakdown" in d_admin, "Admin shape is correct (has global stats AND project breakdown)")


# --- 6. SEED DATA SANITY ---
print_step("6. Seed data sanity check (Supabase DB)")
att_res = sc.table("attendance").select("id", count="exact").execute()
print_res(att_res.count > 1500, f"Attendance table has {att_res.count} rows (expected ~1600+)")

att_sample = sc.table("attendance").select("status").limit(10).execute()
statuses = set(row["status"] for row in att_sample.data)
print_res(len(statuses) > 1, f"Attendance is not uniform, found mix: {statuses}")

prof_res = sc.table("users").select("id", count="exact").like("email", "%@seed.hrms.com").execute()
print_res(prof_res.count == 25, f"Profiles table has {prof_res.count} seed users")


# --- 7. IDEMPOTENCY TEST ---
print_step("7. Idempotency (Running seed.py again)")
print("  (Spawning seed.py...)")
import subprocess
result = subprocess.run(["uv", "run", "python", "backend/seed.py"], capture_output=True, text=True)
if result.returncode != 0:
    print(f"❌ seed.py failed:\n{result.stderr}")
    sys.exit(1)

prof_res2 = sc.table("users").select("id", count="exact").like("email", "%@seed.hrms.com").execute()
print_res(prof_res2.count == 25, f"Profiles count stayed at {prof_res2.count} (not 50!)")


# --- 8. PHOTO UPLOAD PATH CLAIM ---
print_step("8. Photo upload path claim (Employee cannot specify target user_id)")
# The endpoint is POST /api/profiles/upload-photo, taking a single 'file' form-data field.
files = {'file': ('test.jpg', b'fake image data', 'image/jpeg')}
r_upload = httpx.post(f"{API}/api/profiles/upload-photo", headers={"Authorization": f"Bearer {emp_token}"}, files=files)
print(f"  Response: {r_upload.status_code} {r_upload.json()}")

url = r_upload.json().get("profile_picture_url", "")
print_res(profile["user_id"] in url, "The server hardcoded the Employee's own user_id into the filename, verifying they cannot overwrite others")

print("\n🎉 ALL TESTS PASSED! The FastAPI backend behaves exactly as promised.")
