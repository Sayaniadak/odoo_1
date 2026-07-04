-- ============================================================================
-- HRMS — Initial Schema Migration
-- ============================================================================
-- Tables:   users, profiles, attendance, leaves, payroll, projects,
--           notifications, audit_logs
-- Auth:     RLS policies per role (Employee/HR/Admin) per operation
-- Cron:     Auto-mark absent at end of day
--
-- DEPENDENCY ORDER:
--   1. Extensions + Enums (no deps)
--   2. Generic helper functions (no table deps)
--   3. Tables (depend on enums)
--   4. Functions that reference tables (depend on users table)
--   5. Triggers that use those functions (depend on both)
--   6. Auth trigger (depends on users + profiles tables)
--   7. SECURITY DEFINER helpers (depend on notifications + audit_logs)
--   8. RLS policies (depend on tables + get_user_role)
--   9. pg_cron (depends on users + attendance)
--  10. Realtime + Indexes
-- ============================================================================

-- ============================================================================
-- 1. EXTENSIONS
-- ============================================================================
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- ============================================================================
-- 2. CUSTOM ENUM TYPES
-- ============================================================================

CREATE TYPE public.user_role AS ENUM ('Employee', 'HR', 'Admin');

CREATE TYPE public.attendance_status AS ENUM ('Present', 'Absent', 'Half-day', 'On Leave');
CREATE TYPE public.attendance_marker AS ENUM ('system', 'employee');

CREATE TYPE public.leave_type AS ENUM ('Paid', 'Sick', 'Unpaid');
CREATE TYPE public.leave_status AS ENUM ('Pending', 'Approved', 'Rejected');

CREATE TYPE public.project_priority AS ENUM ('Low', 'Medium', 'High', 'Critical');
CREATE TYPE public.project_status AS ENUM ('Not Started', 'In Progress', 'Review', 'Completed');

-- ============================================================================
-- 3. GENERIC HELPER FUNCTIONS (no table dependencies)
-- ============================================================================

-- Generic trigger to auto-update `updated_at` columns.
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- 4. TABLES
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 4a. users — public mirror of auth.users with role + active flag
-- ---------------------------------------------------------------------------
CREATE TABLE public.users (
  id         uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email      text        NOT NULL,
  role       public.user_role NOT NULL DEFAULT 'Employee',
  is_active  boolean     NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.users IS 'Public mirror of auth.users. Synced via trigger. Adds role and is_active columns.';

-- ---------------------------------------------------------------------------
-- 4b. profiles — extended employee information, 1:1 with users
-- ---------------------------------------------------------------------------
CREATE TABLE public.profiles (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             uuid NOT NULL UNIQUE REFERENCES public.users(id) ON DELETE CASCADE,
  full_name           text NOT NULL DEFAULT '',
  phone               text,
  address             text,
  job_title           text,
  department          text,
  designation         text,
  manager_id          uuid REFERENCES public.users(id) ON DELETE SET NULL,
  skills              text[] NOT NULL DEFAULT '{}',
  profile_picture_url text,
  document_urls       text[] NOT NULL DEFAULT '{}',
  joining_date        date,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

-- updated_at trigger (uses generic function defined above — no table deps)
CREATE TRIGGER profiles_updated_at
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

COMMENT ON TABLE public.profiles IS 'Extended employee profile. One row per user. manager_id creates org hierarchy.';

-- ---------------------------------------------------------------------------
-- 4c. attendance — one record per employee per day
-- ---------------------------------------------------------------------------
CREATE TABLE public.attendance (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  date       date NOT NULL,
  check_in   timestamptz,
  check_out  timestamptz,
  hours      numeric(5,2),
  status     public.attendance_status,
  marked_by  public.attendance_marker NOT NULL DEFAULT 'employee',
  created_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT attendance_one_per_day UNIQUE (user_id, date)
);

COMMENT ON TABLE public.attendance IS 'Daily attendance log. Unique per (user, date). pg_cron marks absent if no check-in.';

-- ---------------------------------------------------------------------------
-- 4d. leaves — leave requests with approval workflow
-- ---------------------------------------------------------------------------
CREATE TABLE public.leaves (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  leave_type       public.leave_type NOT NULL,
  start_date       date NOT NULL,
  end_date         date NOT NULL,
  reason           text,
  status           public.leave_status NOT NULL DEFAULT 'Pending',
  employee_remarks text,
  admin_comments   text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT leaves_end_after_start CHECK (end_date >= start_date)
);

CREATE TRIGGER leaves_updated_at
  BEFORE UPDATE ON public.leaves
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

COMMENT ON TABLE public.leaves IS 'Leave requests. Employee creates; HR/Admin approves or rejects.';

-- ---------------------------------------------------------------------------
-- 4e. payroll — monthly payroll records
-- ---------------------------------------------------------------------------
CREATE TABLE public.payroll (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  base_salary numeric(12,2) NOT NULL,
  deductions  numeric(12,2) NOT NULL DEFAULT 0,
  net_pay     numeric(12,2) GENERATED ALWAYS AS (base_salary - deductions) STORED,
  month       integer NOT NULL,
  year        integer NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT payroll_month_range CHECK (month >= 1 AND month <= 12),
  CONSTRAINT payroll_year_range  CHECK (year >= 2000 AND year <= 2100),
  CONSTRAINT payroll_one_per_month UNIQUE (user_id, month, year)
);

COMMENT ON TABLE public.payroll IS 'Monthly payroll. net_pay is auto-computed as base_salary - deductions.';

-- ---------------------------------------------------------------------------
-- 4f. projects — single-assignee project management
-- ---------------------------------------------------------------------------
CREATE TABLE public.projects (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title       text NOT NULL,
  description text,
  assigned_to uuid REFERENCES public.users(id) ON DELETE SET NULL,
  deadline    date,
  priority    public.project_priority,
  status      public.project_status NOT NULL DEFAULT 'Not Started',
  created_by  uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- updated_at trigger (uses generic function — no table deps)
CREATE TRIGGER projects_updated_at
  BEFORE UPDATE ON public.projects
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

COMMENT ON TABLE public.projects IS 'Projects with single assignee. Admin creates; assigned employee updates status.';

-- ---------------------------------------------------------------------------
-- 4g. notifications — in-app notification feed
-- ---------------------------------------------------------------------------
CREATE TABLE public.notifications (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  type       text NOT NULL,
  message    text NOT NULL,
  is_read    boolean NOT NULL DEFAULT false,
  related_id uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.notifications IS 'User notification feed. Created by SECURITY DEFINER function, read by owning user only.';

-- ---------------------------------------------------------------------------
-- 4h. audit_logs — immutable admin action log
-- ---------------------------------------------------------------------------
CREATE TABLE public.audit_logs (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id     uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  action       text NOT NULL,
  target_table text NOT NULL,
  target_id    uuid,
  details      jsonb NOT NULL DEFAULT '{}',
  created_at   timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.audit_logs IS 'Immutable log of HR/Admin actions. Insert-only via SECURITY DEFINER function.';

-- ============================================================================
-- 5. FUNCTIONS THAT REFERENCE TABLES
-- ============================================================================
-- These must come AFTER the tables they reference are created.

-- Returns the role of the currently authenticated user.
-- SECURITY DEFINER so it can read public.users even when RLS is active.
CREATE OR REPLACE FUNCTION public.get_user_role()
RETURNS public.user_role AS $$
  SELECT role FROM public.users WHERE id = auth.uid();
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- ---------------------------------------------------------------------------
-- Column-level restriction: profiles
-- ---------------------------------------------------------------------------
-- Employees may only modify personal fields. Any attempt to change
-- HR-managed fields (full_name, job_title, department, designation,
-- manager_id, joining_date) is rejected at the DB level.
-- HR and Admin bypass this trigger entirely.
CREATE OR REPLACE FUNCTION public.enforce_profile_column_access()
RETURNS trigger AS $$
DECLARE
  v_role public.user_role;
BEGIN
  SELECT role INTO v_role FROM public.users WHERE id = auth.uid();

  -- HR and Admin can edit any column
  IF v_role IN ('HR', 'Admin') THEN
    RETURN NEW;
  END IF;

  -- Employee: reject changes to restricted columns
  IF NEW.full_name     IS DISTINCT FROM OLD.full_name     THEN RAISE EXCEPTION 'Employees cannot modify full_name';     END IF;
  IF NEW.job_title     IS DISTINCT FROM OLD.job_title     THEN RAISE EXCEPTION 'Employees cannot modify job_title';     END IF;
  IF NEW.department    IS DISTINCT FROM OLD.department    THEN RAISE EXCEPTION 'Employees cannot modify department';    END IF;
  IF NEW.designation   IS DISTINCT FROM OLD.designation   THEN RAISE EXCEPTION 'Employees cannot modify designation';   END IF;
  IF NEW.manager_id    IS DISTINCT FROM OLD.manager_id    THEN RAISE EXCEPTION 'Employees cannot modify manager_id';    END IF;
  IF NEW.joining_date  IS DISTINCT FROM OLD.joining_date  THEN RAISE EXCEPTION 'Employees cannot modify joining_date';  END IF;

  -- Also prevent employees from changing user_id or id (row identity)
  IF NEW.user_id       IS DISTINCT FROM OLD.user_id       THEN RAISE EXCEPTION 'Cannot modify user_id';                 END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ---------------------------------------------------------------------------
-- Column-level restriction: projects
-- ---------------------------------------------------------------------------
-- Non-Admin users assigned to a project may only update `status`.
-- Any attempt to change title, description, assigned_to, deadline,
-- priority, or created_by is rejected at the DB level.
-- Admin bypasses this trigger entirely.
CREATE OR REPLACE FUNCTION public.enforce_project_column_access()
RETURNS trigger AS $$
DECLARE
  v_role public.user_role;
BEGIN
  SELECT role INTO v_role FROM public.users WHERE id = auth.uid();

  -- Admin can edit any column
  IF v_role = 'Admin' THEN
    RETURN NEW;
  END IF;

  -- Employee / HR: reject changes to anything other than status
  IF NEW.title       IS DISTINCT FROM OLD.title       THEN RAISE EXCEPTION 'Only Admin can modify project title';       END IF;
  IF NEW.description IS DISTINCT FROM OLD.description THEN RAISE EXCEPTION 'Only Admin can modify project description'; END IF;
  IF NEW.assigned_to IS DISTINCT FROM OLD.assigned_to THEN RAISE EXCEPTION 'Only Admin can modify project assignment';  END IF;
  IF NEW.deadline    IS DISTINCT FROM OLD.deadline    THEN RAISE EXCEPTION 'Only Admin can modify project deadline';    END IF;
  IF NEW.priority    IS DISTINCT FROM OLD.priority    THEN RAISE EXCEPTION 'Only Admin can modify project priority';    END IF;
  IF NEW.created_by  IS DISTINCT FROM OLD.created_by  THEN RAISE EXCEPTION 'Only Admin can modify project created_by';  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================================
-- 6. COLUMN-ENFORCEMENT TRIGGERS
-- ============================================================================
-- These triggers use the functions defined in section 5, which reference
-- the users table defined in section 4. All dependencies are now satisfied.

-- Column-level enforcement: Employee can only modify personal fields.
CREATE TRIGGER profiles_enforce_columns
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.enforce_profile_column_access();

-- Column-level enforcement: non-Admin can only change project status.
CREATE TRIGGER projects_enforce_columns
  BEFORE UPDATE ON public.projects
  FOR EACH ROW EXECUTE FUNCTION public.enforce_project_column_access();

-- ============================================================================
-- 7. AUTH TRIGGER — Sync auth.users → public.users + auto-create profile
-- ============================================================================

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger AS $$
BEGIN
  -- Mirror into public.users with role from signup metadata
  INSERT INTO public.users (id, email, role)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(
      (NEW.raw_user_meta_data->>'role')::public.user_role,
      'Employee'
    )
  );

  -- Auto-create an empty profile row
  INSERT INTO public.profiles (user_id, full_name)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'full_name', '')
  );

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Trigger fires after a new user signs up via Supabase Auth
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ============================================================================
-- 8. SECURITY DEFINER HELPER FUNCTIONS
-- ============================================================================
-- These bypass RLS intentionally so the app can create cross-user
-- notifications and audit logs through the user-scoped JWT client.

-- 8a. Create a notification for any user
CREATE OR REPLACE FUNCTION public.create_notification(
  p_user_id   uuid,
  p_type      text,
  p_message   text,
  p_related_id uuid DEFAULT NULL
)
RETURNS uuid AS $$
DECLARE
  v_id uuid;
BEGIN
  INSERT INTO public.notifications (user_id, type, message, related_id)
  VALUES (p_user_id, p_type, p_message, p_related_id)
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 8b. Create an audit log entry (actor = calling user)
CREATE OR REPLACE FUNCTION public.create_audit_log(
  p_action       text,
  p_target_table text,
  p_target_id    uuid DEFAULT NULL,
  p_details      jsonb DEFAULT '{}'
)
RETURNS uuid AS $$
DECLARE
  v_id uuid;
BEGIN
  INSERT INTO public.audit_logs (actor_id, action, target_table, target_id, details)
  VALUES (auth.uid(), p_action, p_target_table, p_target_id, p_details)
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================================
-- 9. ROW-LEVEL SECURITY POLICIES
-- ============================================================================
-- Naming convention: {table}_{role}_{operation}
-- One policy per role per operation for easy debugging.
-- Policies are OR'd: if ANY matching policy grants access, the row is visible.

-- ---------------------------------------------------------------------------
-- 9a. users
-- ---------------------------------------------------------------------------
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;

-- SELECT
CREATE POLICY users_employee_select ON public.users
  FOR SELECT TO authenticated
  USING (public.get_user_role() = 'Employee' AND id = auth.uid());

CREATE POLICY users_hr_select ON public.users
  FOR SELECT TO authenticated
  USING (public.get_user_role() = 'HR');

CREATE POLICY users_admin_select ON public.users
  FOR SELECT TO authenticated
  USING (public.get_user_role() = 'Admin');

-- INSERT: handled by trigger only, no direct inserts
-- (no INSERT policies = no direct inserts allowed)

-- UPDATE: Admin only (role changes, deactivation)
CREATE POLICY users_admin_update ON public.users
  FOR UPDATE TO authenticated
  USING (public.get_user_role() = 'Admin')
  WITH CHECK (public.get_user_role() = 'Admin');

-- DELETE: never allowed via API
-- (no DELETE policies)

-- ---------------------------------------------------------------------------
-- 9b. profiles
-- ---------------------------------------------------------------------------
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- SELECT
CREATE POLICY profiles_employee_select ON public.profiles
  FOR SELECT TO authenticated
  USING (public.get_user_role() = 'Employee' AND user_id = auth.uid());

CREATE POLICY profiles_hr_select ON public.profiles
  FOR SELECT TO authenticated
  USING (public.get_user_role() = 'HR');

CREATE POLICY profiles_admin_select ON public.profiles
  FOR SELECT TO authenticated
  USING (public.get_user_role() = 'Admin');

-- INSERT: handled by handle_new_user trigger only
-- (no INSERT policies)

-- UPDATE: Employee can update own row (column restriction enforced by trigger)
CREATE POLICY profiles_employee_update ON public.profiles
  FOR UPDATE TO authenticated
  USING (public.get_user_role() = 'Employee' AND user_id = auth.uid())
  WITH CHECK (public.get_user_role() = 'Employee' AND user_id = auth.uid());

-- UPDATE: HR can update any profile
CREATE POLICY profiles_hr_update ON public.profiles
  FOR UPDATE TO authenticated
  USING (public.get_user_role() = 'HR')
  WITH CHECK (public.get_user_role() = 'HR');

-- UPDATE: Admin can update any profile
CREATE POLICY profiles_admin_update ON public.profiles
  FOR UPDATE TO authenticated
  USING (public.get_user_role() = 'Admin')
  WITH CHECK (public.get_user_role() = 'Admin');

-- DELETE: never
-- (no DELETE policies)

-- ---------------------------------------------------------------------------
-- 9c. attendance
-- ---------------------------------------------------------------------------
ALTER TABLE public.attendance ENABLE ROW LEVEL SECURITY;

-- SELECT
CREATE POLICY attendance_employee_select ON public.attendance
  FOR SELECT TO authenticated
  USING (public.get_user_role() = 'Employee' AND user_id = auth.uid());

CREATE POLICY attendance_hr_select ON public.attendance
  FOR SELECT TO authenticated
  USING (public.get_user_role() = 'HR');

CREATE POLICY attendance_admin_select ON public.attendance
  FOR SELECT TO authenticated
  USING (public.get_user_role() = 'Admin');

-- INSERT: Employee can clock in (own row only)
CREATE POLICY attendance_employee_insert ON public.attendance
  FOR INSERT TO authenticated
  WITH CHECK (public.get_user_role() = 'Employee' AND user_id = auth.uid());

-- INSERT: HR can also clock in for themselves
CREATE POLICY attendance_hr_insert ON public.attendance
  FOR INSERT TO authenticated
  WITH CHECK (public.get_user_role() = 'HR' AND user_id = auth.uid());

-- INSERT: Admin can also clock in for themselves
CREATE POLICY attendance_admin_insert ON public.attendance
  FOR INSERT TO authenticated
  WITH CHECK (public.get_user_role() = 'Admin' AND user_id = auth.uid());

-- Note: pg_cron auto-absent inserts use the SECURITY DEFINER function
-- mark_absent_for_today() which bypasses RLS.

-- UPDATE: Employee can clock out (own row only)
CREATE POLICY attendance_employee_update ON public.attendance
  FOR UPDATE TO authenticated
  USING (public.get_user_role() = 'Employee' AND user_id = auth.uid())
  WITH CHECK (public.get_user_role() = 'Employee' AND user_id = auth.uid());

-- UPDATE: HR can clock out for themselves
CREATE POLICY attendance_hr_update ON public.attendance
  FOR UPDATE TO authenticated
  USING (public.get_user_role() = 'HR' AND user_id = auth.uid())
  WITH CHECK (public.get_user_role() = 'HR' AND user_id = auth.uid());

-- UPDATE: Admin can update any attendance record
CREATE POLICY attendance_admin_update ON public.attendance
  FOR UPDATE TO authenticated
  USING (public.get_user_role() = 'Admin')
  WITH CHECK (public.get_user_role() = 'Admin');

-- DELETE: never
-- (no DELETE policies)

-- ---------------------------------------------------------------------------
-- 9d. leaves
-- ---------------------------------------------------------------------------
ALTER TABLE public.leaves ENABLE ROW LEVEL SECURITY;

-- SELECT
CREATE POLICY leaves_employee_select ON public.leaves
  FOR SELECT TO authenticated
  USING (public.get_user_role() = 'Employee' AND user_id = auth.uid());

CREATE POLICY leaves_hr_select ON public.leaves
  FOR SELECT TO authenticated
  USING (public.get_user_role() = 'HR');

CREATE POLICY leaves_admin_select ON public.leaves
  FOR SELECT TO authenticated
  USING (public.get_user_role() = 'Admin');

-- INSERT: Employee applies for leave (own only)
CREATE POLICY leaves_employee_insert ON public.leaves
  FOR INSERT TO authenticated
  WITH CHECK (public.get_user_role() = 'Employee' AND user_id = auth.uid());

-- INSERT: HR can also apply for their own leave
CREATE POLICY leaves_hr_insert ON public.leaves
  FOR INSERT TO authenticated
  WITH CHECK (public.get_user_role() = 'HR' AND user_id = auth.uid());

-- INSERT: Admin can also apply for their own leave
CREATE POLICY leaves_admin_insert ON public.leaves
  FOR INSERT TO authenticated
  WITH CHECK (public.get_user_role() = 'Admin' AND user_id = auth.uid());

-- UPDATE: HR can approve/reject (updates status + admin_comments on any row)
CREATE POLICY leaves_hr_update ON public.leaves
  FOR UPDATE TO authenticated
  USING (public.get_user_role() = 'HR')
  WITH CHECK (public.get_user_role() = 'HR');

-- UPDATE: Admin can approve/reject
CREATE POLICY leaves_admin_update ON public.leaves
  FOR UPDATE TO authenticated
  USING (public.get_user_role() = 'Admin')
  WITH CHECK (public.get_user_role() = 'Admin');

-- Note: Employee CANNOT update their own leave after submission.
-- If needed, they'd cancel and re-submit (not in current scope).

-- DELETE: never
-- (no DELETE policies)

-- ---------------------------------------------------------------------------
-- 9e. payroll
-- ---------------------------------------------------------------------------
ALTER TABLE public.payroll ENABLE ROW LEVEL SECURITY;

-- SELECT: Employee sees own payroll only
CREATE POLICY payroll_employee_select ON public.payroll
  FOR SELECT TO authenticated
  USING (public.get_user_role() = 'Employee' AND user_id = auth.uid());

-- SELECT: HR sees own payroll only (HR is also an employee with payslips)
CREATE POLICY payroll_hr_select ON public.payroll
  FOR SELECT TO authenticated
  USING (public.get_user_role() = 'HR' AND user_id = auth.uid());

-- SELECT: Admin sees all payroll
CREATE POLICY payroll_admin_select ON public.payroll
  FOR SELECT TO authenticated
  USING (public.get_user_role() = 'Admin');

-- INSERT: Admin only
CREATE POLICY payroll_admin_insert ON public.payroll
  FOR INSERT TO authenticated
  WITH CHECK (public.get_user_role() = 'Admin');

-- UPDATE: Admin only
CREATE POLICY payroll_admin_update ON public.payroll
  FOR UPDATE TO authenticated
  USING (public.get_user_role() = 'Admin')
  WITH CHECK (public.get_user_role() = 'Admin');

-- DELETE: never
-- (no DELETE policies)

-- ---------------------------------------------------------------------------
-- 9f. projects
-- ---------------------------------------------------------------------------
ALTER TABLE public.projects ENABLE ROW LEVEL SECURITY;

-- SELECT: Employee sees only projects assigned to them
CREATE POLICY projects_employee_select ON public.projects
  FOR SELECT TO authenticated
  USING (public.get_user_role() = 'Employee' AND assigned_to = auth.uid());

-- SELECT: HR sees projects assigned to them (HR can be assigned projects too)
CREATE POLICY projects_hr_select ON public.projects
  FOR SELECT TO authenticated
  USING (public.get_user_role() = 'HR' AND assigned_to = auth.uid());

-- SELECT: Admin sees all projects
CREATE POLICY projects_admin_select ON public.projects
  FOR SELECT TO authenticated
  USING (public.get_user_role() = 'Admin');

-- INSERT: Admin only
CREATE POLICY projects_admin_insert ON public.projects
  FOR INSERT TO authenticated
  WITH CHECK (public.get_user_role() = 'Admin');

-- UPDATE: Assigned employee can update (status field only — enforced by trigger)
CREATE POLICY projects_employee_update ON public.projects
  FOR UPDATE TO authenticated
  USING (public.get_user_role() = 'Employee' AND assigned_to = auth.uid())
  WITH CHECK (public.get_user_role() = 'Employee' AND assigned_to = auth.uid());

-- UPDATE: Assigned HR can also update status on their own projects
CREATE POLICY projects_hr_update ON public.projects
  FOR UPDATE TO authenticated
  USING (public.get_user_role() = 'HR' AND assigned_to = auth.uid())
  WITH CHECK (public.get_user_role() = 'HR' AND assigned_to = auth.uid());

-- UPDATE: Admin can update any project
CREATE POLICY projects_admin_update ON public.projects
  FOR UPDATE TO authenticated
  USING (public.get_user_role() = 'Admin')
  WITH CHECK (public.get_user_role() = 'Admin');

-- DELETE: Admin only
CREATE POLICY projects_admin_delete ON public.projects
  FOR DELETE TO authenticated
  USING (public.get_user_role() = 'Admin');

-- ---------------------------------------------------------------------------
-- 9g. notifications
-- ---------------------------------------------------------------------------
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

-- SELECT: All roles see only their own notifications
CREATE POLICY notifications_employee_select ON public.notifications
  FOR SELECT TO authenticated
  USING (public.get_user_role() = 'Employee' AND user_id = auth.uid());

CREATE POLICY notifications_hr_select ON public.notifications
  FOR SELECT TO authenticated
  USING (public.get_user_role() = 'HR' AND user_id = auth.uid());

CREATE POLICY notifications_admin_select ON public.notifications
  FOR SELECT TO authenticated
  USING (public.get_user_role() = 'Admin' AND user_id = auth.uid());

-- INSERT: No direct inserts. Use create_notification() SECURITY DEFINER function.
-- (no INSERT policies)

-- UPDATE: All roles can mark their own notifications as read
CREATE POLICY notifications_employee_update ON public.notifications
  FOR UPDATE TO authenticated
  USING (public.get_user_role() = 'Employee' AND user_id = auth.uid())
  WITH CHECK (public.get_user_role() = 'Employee' AND user_id = auth.uid());

CREATE POLICY notifications_hr_update ON public.notifications
  FOR UPDATE TO authenticated
  USING (public.get_user_role() = 'HR' AND user_id = auth.uid())
  WITH CHECK (public.get_user_role() = 'HR' AND user_id = auth.uid());

CREATE POLICY notifications_admin_update ON public.notifications
  FOR UPDATE TO authenticated
  USING (public.get_user_role() = 'Admin' AND user_id = auth.uid())
  WITH CHECK (public.get_user_role() = 'Admin' AND user_id = auth.uid());

-- DELETE: never
-- (no DELETE policies)

-- ---------------------------------------------------------------------------
-- 9h. audit_logs
-- ---------------------------------------------------------------------------
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;

-- SELECT: Admin only
CREATE POLICY audit_logs_admin_select ON public.audit_logs
  FOR SELECT TO authenticated
  USING (public.get_user_role() = 'Admin');

-- INSERT: No direct inserts. Use create_audit_log() SECURITY DEFINER function.
-- (no INSERT policies)

-- UPDATE: never (immutable log)
-- (no UPDATE policies)

-- DELETE: never (immutable log)
-- (no DELETE policies)

-- ============================================================================
-- 10. pg_cron — AUTO-MARK ABSENT
-- ============================================================================

-- Function that marks absent for any active user with no attendance today.
-- Runs as SECURITY DEFINER to bypass RLS (system-level insert).
CREATE OR REPLACE FUNCTION public.mark_absent_for_today()
RETURNS void AS $$
DECLARE
  v_today date;
BEGIN
  -- Use IST (Asia/Kolkata) for "today" regardless of DB timezone
  v_today := (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Kolkata')::date;

  INSERT INTO public.attendance (user_id, date, status, marked_by)
  SELECT u.id, v_today, 'Absent'::public.attendance_status, 'system'::public.attendance_marker
  FROM public.users u
  WHERE u.is_active = true
    AND NOT EXISTS (
      SELECT 1
      FROM public.attendance a
      WHERE a.user_id = u.id
        AND a.date = v_today
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Schedule: 18:00 IST = 12:30 UTC, Monday–Friday
-- pg_cron runs in UTC, so we convert.
SELECT cron.schedule(
  'mark-absent-daily',
  '30 12 * * 1-5',
  $$ SELECT public.mark_absent_for_today(); $$
);

-- ============================================================================
-- 11. SUPABASE REALTIME — Enable for notifications
-- ============================================================================

ALTER PUBLICATION supabase_realtime ADD TABLE public.notifications;

-- ============================================================================
-- 12. INDEXES
-- ============================================================================

-- attendance: fast lookups by user + date range (history pages, dashboard)
CREATE INDEX idx_attendance_user_date ON public.attendance (user_id, date DESC);

-- leaves: pending leaves for HR/Admin approval queue
CREATE INDEX idx_leaves_status ON public.leaves (status) WHERE status = 'Pending';
CREATE INDEX idx_leaves_user_id ON public.leaves (user_id, created_at DESC);

-- payroll: user + period lookups
CREATE INDEX idx_payroll_user_period ON public.payroll (user_id, year DESC, month DESC);

-- projects: assigned employee's project list + admin deadline monitoring
CREATE INDEX idx_projects_assigned ON public.projects (assigned_to) WHERE assigned_to IS NOT NULL;
CREATE INDEX idx_projects_deadline ON public.projects (deadline) WHERE status != 'Completed';

-- notifications: unread bell count + feed
CREATE INDEX idx_notifications_user_unread ON public.notifications (user_id, created_at DESC) WHERE is_read = false;
CREATE INDEX idx_notifications_user_feed ON public.notifications (user_id, created_at DESC);

-- audit_logs: admin log viewer with filters
CREATE INDEX idx_audit_logs_created ON public.audit_logs (created_at DESC);
CREATE INDEX idx_audit_logs_actor ON public.audit_logs (actor_id, created_at DESC);

-- profiles: directory search
CREATE INDEX idx_profiles_department ON public.profiles (department);
CREATE INDEX idx_profiles_full_name ON public.profiles USING gin (to_tsvector('english', full_name));
