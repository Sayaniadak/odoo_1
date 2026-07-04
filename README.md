# HRMS — Human Resource Management System

> Every workday, perfectly aligned.

A full-stack Human Resource Management System built for [Hackathon Name] — covering authentication, role-based access control, attendance tracking, leave management, project management, payroll, and AI-powered HR insights.

---

##  Live Demo

- **App:** `<https://domains-connected-rocks-hand.trycloudflare.com/#/>`
- **API Docs (Swagger):** `<https://domains-connected-rocks-hand.trycloudflare.com/docs#/AI%20Insights/get_ai_insights_api_ai_insights_get>`

### Demo Accounts

| Role | Email | Password |

| Admin | `john11@gmail.com` | `john11` |

---

##  Overview

HRMS digitizes core HR operations for small-to-medium organizations: onboarding, attendance, leave requests, project assignment, and payroll visibility — with strict role-based permissions across three user types: **Employee**, **HR**, and **Admin**.

### Core Features

- 🔐 **Authentication** — Email/password signup and login with role selection, JWT-based sessions
- 👤 **Profile Management** — View/edit personal info, department, skills, documents, profile picture
- 🕐 **Attendance Tracking** — Clock in/out with automatic half-day/present status calculation, auto-marked absences via scheduled job
- 🌴 **Leave Management** — Apply for Paid/Sick/Unpaid leave with date-range overlap prevention, HR/Admin approval workflow
- 📁 **Project Management** — Create, assign, and track projects through a status lifecycle with an admin review step
- 💰 **Payroll** — Salary structure management with automatic net pay calculation and downloadable PDF payslips
- 🤖 **AI HR Insights** — LLM-generated summaries flagging burnout risk and leave clustering (Admin only)
- 🔔 **Notifications** — Real-time in-app notifications for leave decisions and project updates
- 📊 **Role-Based Dashboards** — Distinct views and permissions for Employee, HR, and Admin

---

## 🛠️ Tech Stack

| Layer | Technology |
|---|---|
| Frontend | Next.js (React) + TypeScript, Tailwind CSS, Shadcn/ui, TanStack Query |
| Backend | FastAPI (Python) |
| Database & Auth | Supabase (PostgreSQL, Row-Level Security, Auth, Storage) |
| Realtime | Supabase Realtime |
| Scheduled Jobs | Supabase pg_cron |
| AI Insights | Groq API (`llama-3.1-8b-instant`) |
| PDF Generation | ReportLab |
| Deployment | Vercel (frontend), Cloudflare Tunnel / Render (backend) |

### Why this stack

- **Supabase** provides production-ready Postgres, authentication, and file storage without building auth infrastructure from scratch.
- **FastAPI** handles business logic (half-day rules, leave overlap checks, payroll calculations) with auto-generated API docs.
- **Row-Level Security (RLS)** enforces permissions at the database layer — even if the API layer had a bug, the database itself refuses unauthorized reads/writes. FastAPI adds a second layer of role checks on top for defense-in-depth.

---

## 🔒 Security Architecture

Every request is authorized twice:

1. **FastAPI dependency layer** — `require_role()` checks reject requests from the wrong role before touching the database.
2. **Postgres Row-Level Security** — every table has RLS policies keyed to the calling user's JWT, enforced by the database itself regardless of what the API layer does.

The backend never uses Supabase's service-role key for user-facing requests — it passes the user's own JWT through to Postgres on every query, so RLS applies end-to-end. The service-role key is used only for system operations (database seeding, scheduled jobs).

Column-level write restrictions (e.g., an Employee can edit their `phone` but not their `department`) are enforced by database triggers, not just API validation — closing the gap where standard RLS can restrict *which rows* but not *which columns* are writable.

---

## 👥 Roles & Permissions

| Action | Employee | HR | Admin |
|---|:---:|:---:|:---:|
| View/edit own profile (limited fields) | ✅ | ✅ | ✅ |
| View all employees (Directory) | ❌ | ✅ | ✅ |
| Edit any employee's profile | ❌ | ✅ | ✅ |
| Approve/reject leave | ❌ | ✅ | ✅ |
| View all attendance | ❌ | ✅ | ✅ |
| Create/assign projects | ❌ | ❌ | ✅ |
| Edit payroll | ❌ | ❌ | ✅ |
| View AI Insights | ❌ | ❌ | ✅ |

---

## 🗄️ Database Schema

```
users            — mirrors auth.users, adds role (Employee/HR/Admin)
profiles         — personal & job details, skills, documents
attendance       — daily check-in/out, computed hours, status
leaves           — leave requests with type, date range, status
payroll          — salary structure, auto-computed net pay
projects         — title, assignee, deadline, priority, status
notifications    — in-app notifications per user
audit_logs       — admin action history
```

Full schema and RLS policies: [`supabase/migrations/001_initial_schema.sql`](./supabase/migrations/001_initial_schema.sql)

---

## ⚙️ Setup & Installation

### Prerequisites
- Node.js 18+
- Python 3.12+
- A Supabase project ([supabase.com](https://supabase.com))
- A Groq API key ([console.groq.com](https://console.groq.com)) for AI Insights (optional)

### 1. Clone the repo
```bash
git clone https://github.com/<your-org>/<your-repo>.git
cd <your-repo>
```

### 2. Set up the database
1. Create a new Supabase project.
2. Run the migration in Supabase Studio → SQL Editor:
   ```
   supabase/migrations/001_initial_schema.sql
   ```
3. Create Storage buckets: `profile_pictures` (public) and `documents` (private), each with an RLS policy scoping uploads to `auth.uid()`.
4. Authentication → Providers → Email — for local demo/dev convenience, you may disable "Confirm email"; for production use, keep it enabled and configure a real Site URL under Authentication → URL Configuration.

### 3. Backend setup
```bash
cd backend
uv sync   # or: pip install -r requirements.txt --break-system-packages
```

Create `backend/.env`:
```
SUPABASE_URL=https://<your-project-ref>.supabase.co
SUPABASE_ANON_KEY=<anon key>
SUPABASE_SERVICE_ROLE_KEY=<service role key>
SUPABASE_JWT_SECRET=<jwt secret>
GROQ_API_KEY=<groq api key>
```

Run the server:
```bash
uv run uvicorn backend.app.main:app --reload --host 0.0.0.0 --port 8000
```

API docs available at `http://localhost:8000/docs`.

### 4. Seed demo data
```bash
python backend/seed.py
```
Creates 25 employees across 5 departments with 3 months of attendance, leave, and project history. Safe to re-run — it's idempotent.

### 5. Frontend setup
```bash
cd frontend
npm install
```

Create `frontend/.env.local`:
```
NEXT_PUBLIC_SUPABASE_URL=https://<your-project-ref>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon key>
NEXT_PUBLIC_API_URL=http://localhost:8000
```

```bash
npm run dev
```

App available at `http://localhost:3000`.

---

## 📖 API Reference

Full interactive API documentation is auto-generated by FastAPI and available at `/docs` (Swagger UI) once the backend is running. Key endpoint groups:

- `POST /api/auth/signup`, `/login`, `/refresh`, `GET /api/auth/me`
- `GET/PUT /api/profiles/me`, `GET /api/profiles`, `GET/PUT /api/profiles/{user_id}`
- `POST /api/attendance/check-in`, `/check-out`, `GET /api/attendance/me`, `GET /api/attendance`
- `POST /api/leaves`, `GET /api/leaves/me`, `GET /api/leaves`, `PUT /api/leaves/{id}/approve`, `/reject`
- `GET/POST /api/projects`, `PUT /api/projects/{id}`, `/review`, `DELETE /api/projects/{id}`
- `GET/POST /api/payroll`, `GET /api/payroll/{id}/download`
- `GET /api/ai/insights`

All error responses follow the shape `{"detail": "message"}`.

---

## ⚠️ Known Limitations & Tradeoffs

Built under hackathon time constraints — documented here for transparency rather than hidden:

- **Email verification is disabled by default** in this build's Supabase configuration. The backend fully supports it (distinct error messages for unverified accounts), but the confirmation email's redirect requires a deployed frontend URL to be configured as the Site URL, which wasn't finalized during the hackathon window. Re-enable in Authentication → Providers → Email once a stable frontend URL exists.
- **Single assignee per project** — `projects.assigned_to` is a single foreign key, not a many-to-many relationship. Multi-person project assignment would require a junction table.
- **Payroll deductions are a single numeric field**, not itemized (no separate tax/PF/insurance breakdown).
- **AI Insights** calls an external LLM (Groq) with a timeout and fallback response to avoid blocking the dashboard if the call is slow — the fallback is a generic message, not a cached real insight, if the live call fails.

---
