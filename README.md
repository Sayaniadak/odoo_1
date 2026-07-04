# PulseHR — Unified HR Management & Intelligent Insights Platform

<p align="center">
  <strong>A full-stack HRMS with role-based access, AI-powered insights, and real-time workforce management.</strong>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/FastAPI-009688?style=for-the-badge&logo=fastapi&logoColor=white" alt="FastAPI"/>
  <img src="https://img.shields.io/badge/React-61DAFB?style=for-the-badge&logo=react&logoColor=black" alt="React"/>
  <img src="https://img.shields.io/badge/TypeScript-3178C6?style=for-the-badge&logo=typescript&logoColor=white" alt="TypeScript"/>
  <img src="https://img.shields.io/badge/Supabase-3FCF8E?style=for-the-badge&logo=supabase&logoColor=white" alt="Supabase"/>
  <img src="https://img.shields.io/badge/Vite-646CFF?style=for-the-badge&logo=vite&logoColor=white" alt="Vite"/>
  <img src="https://img.shields.io/badge/Vercel-000000?style=for-the-badge&logo=vercel&logoColor=white" alt="Vercel"/>
</p>

---

## ✨ Features

| Module | Description |
| :--- | :--- |
| **🔐 Authentication** | Supabase GoTrue auth with auto-generated secure passwords, JWT-based sessions, and in-memory token management |
| **👥 Employee Directory** | Glassmorphic table view with profile avatars, real-time attendance/leave status indicators, and department filtering |
| **⏰ Attendance** | One-click clock in/out with automatic hours calculation, daily status tracking, and monthly summaries |
| **🏖️ Leave Management** | Multi-type leave requests (Annual, Sick, Personal, Unpaid) with calendar range picker and approval workflows |
| **💰 Payroll** | Automated salary processing with deductions, downloadable PDF payslip generation (ReportLab), and payment status tracking |
| **📋 Projects** | Full project lifecycle management — create, assign, track status (Not Started → In Progress → In Review → Completed) |
| **🤖 AI HR Insights** | Groq LLM-powered analysis for department staffing, employee burnout prediction, and actionable workforce recommendations |
| **🔔 Notifications** | Real-time system notifications for project assignments, leave approvals, and attendance alerts |
| **📅 Unified Calendar** | Integrated calendar view combining attendance records and approved leave periods |

---

## 🏗️ Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    Frontend (React + Vite)                │
│  ┌─────────┐ ┌──────────┐ ┌──────────┐ ┌────────────┐  │
│  │AuthPage │ │Dashboard │ │Directory │ │ Projects   │  │
│  │         │ │  View    │ │  View    │ │   View     │  │
│  └────┬────┘ └────┬─────┘ └────┬─────┘ └─────┬──────┘  │
│       └───────────┴────────────┴──────────────┘          │
│                    TanStack Query v5                      │
└──────────────────────────┬──────────────────────────────┘
                           │ REST API (JWT Bearer)
┌──────────────────────────┴──────────────────────────────┐
│                  Backend (FastAPI)                        │
│  ┌──────┐ ┌────────┐ ┌───────┐ ┌───────┐ ┌──────────┐  │
│  │ Auth │ │Payroll │ │Leaves │ │Projects│ │AI Insights│  │
│  │Router│ │ Router │ │Router │ │ Router │ │  Router   │  │
│  └──┬───┘ └───┬────┘ └──┬────┘ └───┬───┘ └────┬─────┘  │
│     └─────────┴─────────┴──────────┴──────────┘          │
│              Role Guards + Service Client                 │
└──────────────────────────┬──────────────────────────────┘
                           │ PostgREST + RLS
┌──────────────────────────┴──────────────────────────────┐
│              Supabase (PostgreSQL + GoTrue)               │
│  ┌────────────────────────────────────────────────────┐  │
│  │  Row-Level Security · Triggers · SECURITY DEFINER  │  │
│  │  Functions · Column-level Access Control            │  │
│  └────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────┘
```

---

## 🔒 Role-Based Access Control (RBAC)

| Feature | Employee | HR Specialist | Administrator |
| :--- | :---: | :---: | :---: |
| View own dashboard | ✅ | ✅ | ✅ |
| Clock in/out | ✅ | ✅ | ✅ |
| Request leaves | ✅ | ✅ | ✅ |
| View own payslips | ✅ | ✅ | ✅ |
| View all projects | ❌ | ✅ | ✅ |
| Create/manage projects | ❌ | ✅ | ✅ |
| Approve/reject leaves | ❌ | ✅ | ✅ |
| Process payroll | ❌ | ❌ | ✅ |
| View employee directory | ❌ | ✅ | ✅ |
| AI HR Insights | ❌ | ✅ | ✅ |
| Manage user roles | ❌ | ❌ | ✅ |
| Change password | ✅ | ✅ | ✅ |

---

## 🚀 Tech Stack

### Backend
| Technology | Purpose |
| :--- | :--- |
| **FastAPI** | Async Python API framework serving REST endpoints + static SPA |
| **Supabase / PostgreSQL** | Database with Row-Level Security, triggers, and auth |
| **ReportLab** | Dynamic PDF generation for monthly payslip statements |
| **Groq API (Llama 3.1)** | AI-powered HR insights and burnout predictions |
| **PyJWT** | JWT verification with JWKS endpoint support |

### Frontend
| Technology | Purpose |
| :--- | :--- |
| **React 19 (TypeScript)** | Component-based SPA with hash routing |
| **Vite** | Fast bundling with HMR for development |
| **TanStack Query v5** | Cache-driven data fetching with optimistic mutations |
| **Lucide React** | Crisp, modern icon library |
| **Custom CSS** | Glassmorphic design system with HSL colors and dark mode |

---

## 🛠️ Key Architectural Decisions

1. **Defense in Depth (3-Layer Security)**:
   - **Client**: Hash-based route guards block unauthorized navigation
   - **API**: `require_role()` dependency rejects requests with `403 Forbidden`
   - **Database**: PostgreSQL RLS policies enforce row-level access on every query

2. **In-Memory Token Management**:
   - Access & refresh tokens stored in memory (not localStorage)
   - Global fetch interceptor auto-attaches Bearer token and handles 401 refresh flows

3. **Service Client Pattern**:
   - User-scoped queries use JWT passthrough (`get_supabase_client(token)`) for RLS enforcement
   - HR write operations use the service-role client (`get_service_client()`) to bypass Admin-only RLS policies
   - FastAPI role guards ensure only authorized roles reach the service client

4. **No-Orphan Joins**:
   - Profile lookups done via separate optimized queries to avoid PostgREST PGRST200 join cache issues

---

## ⚡ Setup & Installation

### Prerequisites
- Python 3.12+ (managed via [uv](https://docs.astral.sh/uv/))
- Node.js 18+ & npm

### 1. Clone the Repository
```bash
git clone https://github.com/Sayaniadak/odoo_1.git
cd odoo_1
```

### 2. Environment Variables
Create a `.env` file in the root directory:
```env
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=your-anon-public-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
SUPABASE_JWT_SECRET=your-jwt-secret
GROQ_API_KEY=your-groq-api-key
```

### 3. Install Dependencies
```bash
# Backend (Python)
uv sync

# Frontend (Node)
cd frontend && npm install && cd ..
```

### 4. Database Setup
Run the migration SQL in your Supabase SQL Editor:
```bash
# Copy contents of supabase/migrations/001_initial_schema.sql
# Paste and execute in Supabase Dashboard → SQL Editor
```

### 5. Seed Demo Data (Optional)
```bash
uv run python backend/seed.py
```

### 6. Run Development Servers
```bash
# Build frontend production assets
cd frontend && npm run build && cd ..

# Start the backend (serves both API + frontend)
uv run uvicorn backend.app.main:app --reload --host 0.0.0.0 --port 8000
```

Open **http://localhost:8000** in your browser.

---

## 🌐 Deployment

### Vercel Deployment

This project is configured for Vercel deployment with the included `vercel.json`:

1. **Import** the GitHub repo on [vercel.com/new](https://vercel.com/new)
2. **Set environment variables** in Vercel Dashboard → Settings → Environment Variables:
   - `SUPABASE_URL`
   - `SUPABASE_ANON_KEY`
   - `SUPABASE_SERVICE_ROLE_KEY`
   - `SUPABASE_JWT_SECRET`
   - `GROQ_API_KEY`
3. **Deploy** — Vercel will auto-detect the configuration

### Cloudflare Tunnel (Local Exposure)
```bash
cloudflared tunnel --url http://localhost:8000
```

---

## 👥 Demo Credentials

| Role | Email | Password |
| :--- | :--- | :--- |
| **Employee** | `antonio.burnett.0@seed.hrms.com` | `SeedPassword123!` |
| **HR Specialist** | `christopher.parrish.17@seed.hrms.com` | `SeedPassword123!` |
| **Administrator** | `jason.zuniga.16@seed.hrms.com` | `SeedPassword123!` |

---

## 📁 Project Structure

```
hrms/
├── backend/
│   └── app/
│       ├── main.py              # FastAPI app entry point
│       ├── auth.py              # JWT verification & role guards
│       ├── config.py            # Pydantic settings from .env
│       ├── database.py          # Supabase client factory
│       └── routers/
│           ├── auth.py          # Signup, login, password change
│           ├── profiles.py      # Employee profiles CRUD
│           ├── attendance.py    # Clock in/out & records
│           ├── leaves.py        # Leave requests & approvals
│           ├── payroll.py       # Salary processing & PDF slips
│           ├── projects.py      # Project lifecycle management
│           ├── dashboard.py     # Dashboard statistics
│           └── ai_insights.py   # Groq LLM analysis
├── frontend/
│   └── src/
│       ├── App.tsx              # Root app with auth state
│       ├── index.css            # Glassmorphic design system
│       └── components/
│           ├── AuthPage.tsx     # Login/signup with auto-password
│           ├── DashboardLayout.tsx  # Sidebar navigation
│           ├── DashboardView.tsx    # Profile & stats
│           ├── DirectoryView.tsx    # Employee table
│           ├── AttendanceView.tsx   # Clock in/out
│           ├── LeavesView.tsx      # Leave management
│           ├── PayrollView.tsx     # Payslip viewer
│           ├── ProjectsView.tsx    # Project board
│           ├── AiInsightsView.tsx  # AI analysis
│           └── UnifiedCalendar.tsx # Calendar view
├── supabase/
│   └── migrations/
│       └── 001_initial_schema.sql  # Full DB schema + RLS
├── vercel.json                  # Vercel deployment config
├── pyproject.toml               # Python dependencies
└── .env                         # Environment variables (git-ignored)
```

---

## 📜 License

Built for a 48-hour hackathon. MIT License.
