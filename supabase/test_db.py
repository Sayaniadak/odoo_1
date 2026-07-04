"""
Interactive DB Tester — run this and pick what you want to test.
Uses the test users already created by verify_migration.py.

Usage:
    cd /Users/sumankar/Desktop/hrms
    uv run python supabase/test_db.py
"""

import os, json, httpx
from dotenv import load_dotenv
from supabase import create_client

load_dotenv(os.path.join(os.path.dirname(__file__), "..", ".env"))

URL = os.environ["SUPABASE_URL"]
ANON = os.environ["SUPABASE_ANON_KEY"]
SERVICE = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
REST = f"{URL}/rest/v1"

# ── Sign in helpers ──────────────────────────────────────────────────────────

USERS = {
    "1": ("test_employee_a@hrms-test.com", "TestPass123!", "Employee A"),
    "2": ("test_employee_b@hrms-test.com", "TestPass123!", "Employee B"),
    "3": ("test_hr@hrms-test.com",         "TestPass123!", "HR"),
    "4": ("test_admin@hrms-test.com",      "TestPass123!", "Admin"),
}

sessions = {}  # email -> {token, user_id, label}


def sign_in(key):
    email, pw, label = USERS[key]
    if email in sessions:
        return sessions[email]
    client = create_client(URL, ANON)
    resp = client.auth.sign_in_with_password({"email": email, "password": pw})
    s = {"token": resp.session.access_token, "user_id": resp.user.id, "label": label}
    sessions[email] = s
    return s


def headers(token):
    return {
        "apikey": ANON,
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json",
        "Prefer": "return=representation",
        "Accept": "application/json",
    }


def pp(resp):
    """Pretty-print an HTTP response."""
    print(f"\n  HTTP {resp.status_code}")
    try:
        data = resp.json()
        print(f"  {json.dumps(data, indent=2, default=str)}")
    except Exception:
        print(f"  {resp.text[:500]}")
    print()


# ── Tests ────────────────────────────────────────────────────────────────────

def test_rls_profiles():
    """Employee A tries to see Employee B's profile → should get empty."""
    a = sign_in("1")
    b = sign_in("2")
    print(f"\n🔒 RLS TEST: Employee A trying to read Employee B's profile...")
    print(f"   GET {REST}/profiles?user_id=eq.{b['user_id']}")
    resp = httpx.get(f"{REST}/profiles?user_id=eq.{b['user_id']}", headers=headers(a["token"]))
    pp(resp)
    if resp.status_code == 200 and len(resp.json()) == 0:
        print("  ✅ BLOCKED — Employee A got 0 rows (correct)")
    else:
        print("  ❌ LEAKED — Employee A can see Employee B's data!")


def test_rls_own_profile():
    """Employee A reads own profile → should get 1 row."""
    a = sign_in("1")
    print(f"\n👤 RLS TEST: Employee A reading own profile...")
    print(f"   GET {REST}/profiles?user_id=eq.{a['user_id']}")
    resp = httpx.get(f"{REST}/profiles?user_id=eq.{a['user_id']}", headers=headers(a["token"]))
    pp(resp)


def test_hr_sees_all():
    """HR reads all profiles → should see everyone."""
    hr = sign_in("3")
    print(f"\n👥 RLS TEST: HR reading all profiles...")
    print(f"   GET {REST}/profiles")
    resp = httpx.get(f"{REST}/profiles", headers=headers(hr["token"]))
    pp(resp)
    print(f"  → {len(resp.json())} profiles returned")


def test_employee_edit_phone():
    """Employee updates own phone → should succeed."""
    a = sign_in("1")
    print(f"\n📱 TRIGGER TEST: Employee A updating own phone...")
    print(f'   PATCH {REST}/profiles?user_id=eq.{a["user_id"]}')
    print(f'   Body: {{"phone": "1234567890"}}')
    resp = httpx.patch(
        f"{REST}/profiles?user_id=eq.{a['user_id']}",
        headers=headers(a["token"]),
        json={"phone": "1234567890"},
    )
    pp(resp)
    if resp.status_code in (200, 204):
        print("  ✅ SUCCESS — phone updated (allowed field)")
    else:
        print("  ❌ FAILED — should have been allowed")


def test_employee_edit_department():
    """Employee tries to change own department → should be BLOCKED by trigger."""
    a = sign_in("1")
    print(f"\n🚫 TRIGGER TEST: Employee A trying to change department to 'Finance'...")
    print(f'   PATCH {REST}/profiles?user_id=eq.{a["user_id"]}')
    print(f'   Body: {{"department": "Finance"}}')
    resp = httpx.patch(
        f"{REST}/profiles?user_id=eq.{a['user_id']}",
        headers=headers(a["token"]),
        json={"department": "Finance"},
    )
    pp(resp)
    if resp.status_code >= 400:
        print("  ✅ BLOCKED — trigger rejected the change (correct)")
    else:
        print("  ❌ ALLOWED — trigger did NOT fire, this is a security hole!")


def test_employee_edit_jobtitle():
    """Employee tries to change own job_title → should be BLOCKED."""
    a = sign_in("1")
    print(f"\n🚫 TRIGGER TEST: Employee A trying to change job_title to 'CEO'...")
    resp = httpx.patch(
        f"{REST}/profiles?user_id=eq.{a['user_id']}",
        headers=headers(a["token"]),
        json={"job_title": "CEO"},
    )
    pp(resp)
    if resp.status_code >= 400:
        print("  ✅ BLOCKED — trigger rejected (correct)")
    else:
        print("  ❌ ALLOWED — security hole!")


def test_admin_edit_anything():
    """Admin updates Employee A's department → should succeed (bypass)."""
    admin = sign_in("4")
    a = sign_in("1")
    print(f"\n👑 TRIGGER TEST: Admin updating Employee A's department + job_title...")
    resp = httpx.patch(
        f"{REST}/profiles?user_id=eq.{a['user_id']}",
        headers=headers(admin["token"]),
        json={"department": "Engineering", "job_title": "Senior Engineer"},
    )
    pp(resp)
    if resp.status_code in (200, 204):
        print("  ✅ SUCCESS — Admin bypass works correctly")
    else:
        print("  ❌ FAILED — Admin should be able to edit anything")


def test_payroll_isolation():
    """HR tries to see Employee A's payroll → should be empty."""
    hr = sign_in("3")
    a = sign_in("1")
    print(f"\n💰 RLS TEST: HR trying to see Employee A's payroll...")
    resp = httpx.get(
        f"{REST}/payroll?user_id=eq.{a['user_id']}",
        headers=headers(hr["token"]),
    )
    pp(resp)
    if resp.status_code == 200 and len(resp.json()) == 0:
        print("  ✅ BLOCKED — HR cannot see other people's payroll (correct)")
    else:
        print("  ❌ LEAKED — HR can see payroll data!")


def test_admin_sees_payroll():
    """Admin reads all payroll → should see everything."""
    admin = sign_in("4")
    print(f"\n💰 RLS TEST: Admin reading all payroll...")
    resp = httpx.get(f"{REST}/payroll", headers=headers(admin["token"]))
    pp(resp)
    print(f"  → {len(resp.json())} payroll records returned")


def test_project_status_update():
    """Employee updates project status → should succeed."""
    a = sign_in("1")
    admin = sign_in("4")
    # Find a project assigned to Employee A
    resp = httpx.get(
        f"{REST}/projects?assigned_to=eq.{a['user_id']}",
        headers=headers(a["token"]),
    )
    projects = resp.json()
    if not projects:
        print("\n⚠️  No projects assigned to Employee A. Skipping.")
        return
    pid = projects[0]["id"]
    print(f"\n📋 TRIGGER TEST: Employee A updating project status to 'In Progress'...")
    resp = httpx.patch(
        f"{REST}/projects?id=eq.{pid}",
        headers=headers(a["token"]),
        json={"status": "In Progress"},
    )
    pp(resp)
    if resp.status_code in (200, 204):
        print("  ✅ SUCCESS — status update allowed")
    else:
        print("  ❌ FAILED")


def test_project_priority_blocked():
    """Employee tries to change project priority → should be BLOCKED."""
    a = sign_in("1")
    resp = httpx.get(
        f"{REST}/projects?assigned_to=eq.{a['user_id']}",
        headers=headers(a["token"]),
    )
    projects = resp.json()
    if not projects:
        print("\n⚠️  No projects assigned to Employee A. Skipping.")
        return
    pid = projects[0]["id"]
    print(f"\n🚫 TRIGGER TEST: Employee A trying to change project priority...")
    resp = httpx.patch(
        f"{REST}/projects?id=eq.{pid}",
        headers=headers(a["token"]),
        json={"priority": "Critical"},
    )
    pp(resp)
    if resp.status_code >= 400:
        print("  ✅ BLOCKED — trigger rejected (correct)")
    else:
        print("  ❌ ALLOWED — security hole!")


def test_notification_function():
    """HR creates a notification for Employee A via function."""
    hr = sign_in("3")
    a = sign_in("1")
    print(f"\n🔔 SECURITY DEFINER TEST: HR creating notification for Employee A...")
    resp = httpx.post(
        f"{REST}/rpc/create_notification",
        headers=headers(hr["token"]),
        json={
            "p_user_id": a["user_id"],
            "p_type": "manual_test",
            "p_message": "Hello from terminal test!",
        },
    )
    pp(resp)
    if resp.status_code == 200:
        print("  ✅ SUCCESS — notification created via function")
    else:
        print("  ❌ FAILED")


def test_direct_notification_blocked():
    """HR tries direct INSERT into notifications → should fail."""
    hr = sign_in("3")
    a = sign_in("1")
    print(f"\n🚫 SECURITY TEST: HR trying direct INSERT into notifications...")
    resp = httpx.post(
        f"{REST}/notifications",
        headers=headers(hr["token"]),
        json={
            "user_id": a["user_id"],
            "type": "hack_attempt",
            "message": "This should be blocked",
        },
    )
    pp(resp)
    if resp.status_code >= 400:
        print("  ✅ BLOCKED — direct insert rejected (correct)")
    else:
        print("  ❌ ALLOWED — security hole!")


def test_audit_log_visibility():
    """Employee tries to see audit logs → should be empty."""
    a = sign_in("1")
    admin = sign_in("4")
    print(f"\n📋 RLS TEST: Employee trying to read audit_logs...")
    resp = httpx.get(f"{REST}/audit_logs", headers=headers(a["token"]))
    pp(resp)
    emp_rows = len(resp.json()) if resp.status_code == 200 else -1

    print(f"   Admin reading audit_logs...")
    resp = httpx.get(f"{REST}/audit_logs", headers=headers(admin["token"]))
    admin_rows = len(resp.json()) if resp.status_code == 200 else -1
    print(f"  Employee sees: {emp_rows} rows | Admin sees: {admin_rows} rows")
    if emp_rows == 0 and admin_rows > 0:
        print("  ✅ CORRECT — only Admin can see audit logs")


def run_all():
    """Run all tests in sequence."""
    tests = [
        test_rls_profiles,
        test_rls_own_profile,
        test_hr_sees_all,
        test_employee_edit_phone,
        test_employee_edit_department,
        test_employee_edit_jobtitle,
        test_admin_edit_anything,
        test_payroll_isolation,
        test_admin_sees_payroll,
        test_project_status_update,
        test_project_priority_blocked,
        test_notification_function,
        test_direct_notification_blocked,
        test_audit_log_visibility,
    ]
    for t in tests:
        t()
        input("  Press Enter to continue...")


# ── Menu ─────────────────────────────────────────────────────────────────────

MENU = """
╔══════════════════════════════════════════════════╗
║        HRMS Database — Interactive Tester        ║
╚══════════════════════════════════════════════════╝

Pick a test to run:

  RLS (Row-Level Security):
    1  → Employee A tries to see Employee B's profile
    2  → Employee A reads own profile
    3  → HR reads all profiles
    4  → HR tries to see Employee A's payroll
    5  → Admin reads all payroll
    6  → Employee tries to read audit logs

  Column-Level Triggers:
    7  → Employee updates own phone (should work)
    8  → Employee tries to change department (should be BLOCKED)
    9  → Employee tries to change job_title (should be BLOCKED)
    10 → Admin changes Employee's department (should work)

  Projects:
    11 → Employee updates project status (should work)
    12 → Employee tries to change project priority (should be BLOCKED)

  Security Functions:
    13 → HR creates notification via function (should work)
    14 → HR tries direct INSERT into notifications (should be BLOCKED)

  All:
    a  → Run ALL tests in sequence

  q  → Quit
"""

if __name__ == "__main__":
    test_map = {
        "1": test_rls_profiles,
        "2": test_rls_own_profile,
        "3": test_hr_sees_all,
        "4": test_payroll_isolation,
        "5": test_admin_sees_payroll,
        "6": test_audit_log_visibility,
        "7": test_employee_edit_phone,
        "8": test_employee_edit_department,
        "9": test_employee_edit_jobtitle,
        "10": test_admin_edit_anything,
        "11": test_project_status_update,
        "12": test_project_priority_blocked,
        "13": test_notification_function,
        "14": test_direct_notification_blocked,
        "a": run_all,
    }

    while True:
        print(MENU)
        choice = input("Enter number (or q to quit): ").strip().lower()
        if choice == "q":
            print("Bye! 👋")
            break
        if choice in test_map:
            test_map[choice]()
        else:
            print("Invalid choice, try again.")
