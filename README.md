# PulseHR — Unified HR Management & Intelligent Insights Platform

PulseHR is a high-performance, real-time HR Management System (HRMS) built for fast-paced corporate environments. It features role-based access control (RBAC), database-level row-level security (RLS), automated payroll PDF generation, and an intelligent AI analysis engine for predicting employee burnout.

---

## 🚀 Tech Stack

### Backend
*   **FastAPI**: Python async framework serving both JSON APIs and static React bundle files.
*   **Supabase / PostgreSQL**: Secure database layer with Row-Level Security (RLS) policies, triggers, and relational integrity.
*   **ReportLab**: Dynamic PDF compilation engine generating inline, downloadable monthly payslip statements.
*   **Groq API / Llama-3.1-8b**: AI analysis model for predicting department staffing bottlenecks and employee burnout.

### Frontend
*   **React (TypeScript)**: Structured single-page application (SPA).
*   **Vite**: Fast bundling and hot module replacement.
*   **TanStack Query (v5)**: Declarative, cache-driven data synchronization, automated mutations, and loading skeleton states.
*   **Tailwind CSS**: Harmonies of HSL colors, dark modes, and micro-animations.

---

## 🛠️ Key Architectural Decisions

1.  **Defense in Depth**:
    *   Client-side routing is strictly gated via hash-based path listeners. If an `Employee` attempts to access Admin paths, the SPA blocks rendering and redirects.
    *   API-level route guards (e.g., `Depends(require_role("Admin"))`) reject requests server-side, returning `403 Forbidden`.
    *   Database-layer RLS policies enforce access control rules directly on rows.
2.  **In-Memory Session Storage**:
    *   Tokens (`access_token` and `refresh_token`) are held in memory.
    *   A global `fetch` interceptor automatically appends the Bearer token to all headers, handles `401 Unauthorized` token refreshes, and handles logouts on token expiry.
3.  **No-Orphan Joins**:
    *   To bypass PGRST200 join cache issues, the backend fetches relationships using highly-optimized, separate queries mapped on the server, avoiding PostgREST relational dependencies.

---

## ⚡ Setup & Installation

### 1. Prerequisites
*   Python 3.12+ (managed via `uv`)
*   Node.js 18+ & `npm`

### 2. Environment Variables (`.env`)
Create a `.env` file in the root directory:
```env
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_KEY=your-service-role-key
SUPABASE_ANON_KEY=your-anon-client-key
GROQ_API_KEY=your-groq-api-key
JWT_SECRET=your-jwt-auth-secret
```

### 3. Run Development Servers
Start the backend (which also serves the frontend):
```bash
# In the root hrms directory
uv run uvicorn backend.app.main:app --reload --host 0.0.0.0 --port 8000
```

Start the frontend Vite HMR server:
```bash
# In the frontend directory
npm run dev
```

To build the production assets served by FastAPI:
```bash
# In the frontend directory
npm run build
```

---

## 👥 Demo Credentials

| Role | Email | Password |
| :--- | :--- | :--- |
| **Employee** | `antonio.burnett.0@seed.hrms.com` | `SeedPassword123!` |
| **HR Specialist** | `christopher.parrish.17@seed.hrms.com` | `SeedPassword123!` |
| **Administrator** | `jason.zuniga.16@seed.hrms.com` | `SeedPassword123!` |
