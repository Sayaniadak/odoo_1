"""
Phase 1 Auth — Full End-to-End Test
Creates 3 users, tests login, /me, error paths, and refresh.
Uses admin API for signup (bypasses rate limits), then tests
the actual FastAPI endpoints for login/me/refresh.
"""

import httpx, json, time, os, sys
from dotenv import load_dotenv
from supabase import create_client

load_dotenv(os.path.join(os.path.dirname(__file__), ".env"))

URL = os.environ["SUPABASE_URL"]
SERVICE_KEY = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
API = "http://localhost:8000"

# ── Create test users via Supabase Admin API (bypasses rate limits) ───────────

TEST_USERS = [
    {"email": "alice.employee@test.com", "password": "SecurePass1!", "role": "Employee", "full_name": "Alice Employee"},
    {"email": "bob.hr@test.com",         "password": "SecurePass2!", "role": "HR",       "full_name": "Bob HRManager"},
    {"email": "carol.admin@test.com",    "password": "SecurePass3!", "role": "Admin",    "full_name": "Carol Admin"},
]

print("╔══════════════════════════════════════════════════════════╗")
print("║        Phase 1 Auth — Full E2E Test                     ║")
print("╚══════════════════════════════════════════════════════════╝")

# Step 1-2: Create all 3 users
print("\n═══ STEPS 1-2: Create 3 test users (Employee, HR, Admin) ═══")
sc = create_client(URL, SERVICE_KEY)
for u in TEST_USERS:
    try:
        resp = sc.auth.admin.create_user({
            "email": u["email"],
            "password": u["password"],
            "email_confirm": True,
            "user_metadata": {"role": u["role"], "full_name": u["full_name"]},
        })
        print(f"  ✅ Created {u['role']}: {u['email']} (id: {resp.user.id})")
    except Exception as e:
        if "already" in str(e).lower():
            print(f"  ℹ️  {u['role']}: {u['email']} already exists")
        else:
            print(f"  ❌ Failed: {e}")

# Step 3: Check public.users and profiles via service client
print("\n═══ STEP 3: Verify trigger fired — public.users + profiles ═══")
for u in TEST_USERS:
    u_email = u["email"]
    u_role = u["role"]
    u_fname = u["full_name"]
    users_row = sc.table("users").select("id, email, role").eq("email", u_email).execute()
    if users_row.data:
        row = users_row.data[0]
        actual_role = row["role"]
        role_ok = actual_role == u_role
        icon = "✅" if role_ok else "❌"
        suffix = "(correct)" if role_ok else f"(EXPECTED {u_role})"
        print(f"  {icon} users: {u_email} → role={actual_role} {suffix}")

        profile = sc.table("profiles").select("full_name").eq("user_id", row["id"]).execute()
        if profile.data:
            actual_name = profile.data[0]["full_name"]
            name_ok = actual_name == u_fname
            icon2 = "✅" if name_ok else "❌"
            suffix2 = "(correct)" if name_ok else f"(EXPECTED {u_fname})"
            print(f"  {icon2} profiles: full_name='{actual_name}' {suffix2}")
        else:
            print("  ❌ profiles: no row found!")
    else:
        print(f"  ❌ users: no row for {u_email}")

# Step 4: Login with Employee
print("\n═══ STEP 4: Login as Employee ═══")
resp = httpx.post(f"{API}/api/auth/login", json={
    "email": "alice.employee@test.com",
    "password": "SecurePass1!",
})
print(f"  HTTP {resp.status_code}")
login_data = resp.json()
print(f"  {json.dumps(login_data, indent=2)}")

if resp.status_code == 200:
    access_token = login_data["access_token"]
    refresh_token = login_data["refresh_token"]
    role_ok = login_data["user"]["role"] == "Employee"
    print(f"  {'✅' if role_ok else '❌'} user.role = {login_data['user']['role']}")
    has_tokens = bool(access_token) and bool(refresh_token)
    print(f"  {'✅' if has_tokens else '❌'} access_token present: {bool(access_token)}, refresh_token present: {bool(refresh_token)}")
else:
    print(f"  ❌ Login failed!")
    access_token = None
    refresh_token = None

# Step 5: /me with the Employee token
print("\n═══ STEP 5: GET /api/auth/me with Employee token ═══")
if access_token:
    resp = httpx.get(f"{API}/api/auth/me", headers={"Authorization": f"Bearer {access_token}"})
    print(f"  HTTP {resp.status_code}")
    me_data = resp.json()
    print(f"  {json.dumps(me_data, indent=2)}")
    if resp.status_code == 200:
        id_ok = me_data["id"] == login_data["user"]["id"]
        role_ok = me_data["role"] == "Employee"
        print(f"  {'✅' if id_ok else '❌'} Same user ID as login: {id_ok}")
        print(f"  {'✅' if role_ok else '❌'} Role = Employee: {role_ok}")
    else:
        print(f"  ❌ /me failed with {resp.status_code}")

# Step 6a: Wrong password
print("\n═══ STEP 6a: Login with WRONG PASSWORD ═══")
resp = httpx.post(f"{API}/api/auth/login", json={
    "email": "alice.employee@test.com",
    "password": "totallyWrongPassword",
})
print(f"  HTTP {resp.status_code}")
print(f"  {json.dumps(resp.json(), indent=2)}")
wrong_pw_ok = resp.status_code == 401
print(f"  {'✅' if wrong_pw_ok else '❌'} Got 401: {wrong_pw_ok}")

# Step 6b: Nonexistent email
print("\n═══ STEP 6b: Login with NONEXISTENT EMAIL ═══")
resp = httpx.post(f"{API}/api/auth/login", json={
    "email": "nobody.exists@fake.com",
    "password": "anypassword",
})
print(f"  HTTP {resp.status_code}")
print(f"  {json.dumps(resp.json(), indent=2)}")
no_user_ok = resp.status_code == 401
print(f"  {'✅' if no_user_ok else '❌'} Got 401: {no_user_ok}")

# Step 6c: Unverified email (create a user WITHOUT email_confirm)
print("\n═══ STEP 6c: Login with UNVERIFIED EMAIL ═══")
try:
    sc.auth.admin.create_user({
        "email": "unverified@test.com",
        "password": "SecurePass4!",
        "email_confirm": False,
        "user_metadata": {"role": "Employee", "full_name": "Unverified User"},
    })
    print("  Created unverified user: unverified@test.com")
except Exception as e:
    if "already" in str(e).lower():
        print("  ℹ️  unverified@test.com already exists")
    else:
        print(f"  ⚠️  {e}")

resp = httpx.post(f"{API}/api/auth/login", json={
    "email": "unverified@test.com",
    "password": "SecurePass4!",
})
print(f"  HTTP {resp.status_code}")
print(f"  {json.dumps(resp.json(), indent=2)}")
unverified_msg = resp.json().get("detail", "")
has_verify_msg = "verif" in unverified_msg.lower() or "confirm" in unverified_msg.lower()
print(f"  {'✅' if has_verify_msg else '⚠️'} Distinct 'email not verified' message: {has_verify_msg}")
if not has_verify_msg:
    print(f"     Note: Supabase may not distinguish this from 'invalid credentials' depending on settings.")

# Step 7: Refresh
print("\n═══ STEP 7: Refresh token ═══")
if refresh_token:
    resp = httpx.post(f"{API}/api/auth/refresh", json={
        "refresh_token": refresh_token,
    })
    print(f"  HTTP {resp.status_code}")
    refresh_data = resp.json()
    if resp.status_code == 200:
        new_token = refresh_data.get("access_token", "")
        different = new_token != access_token
        print(f"  ✅ Got new access_token: {bool(new_token)}")
        print(f"  {'✅' if different else '⚠️'} Token is different from original: {different}")
        print(f"  ✅ user.role = {refresh_data['user']['role']}")
    else:
        print(f"  ❌ Refresh failed: {json.dumps(refresh_data, indent=2)}")

# Summary
print("\n" + "═" * 58)
print("All tests complete. Review results above.")
print("═" * 58)
