// PulseHR Unified Single Page Application Logic

const API_BASE = window.location.origin;

// State management
let state = {
  token: localStorage.getItem("pulsehr_token") || null,
  user: JSON.parse(localStorage.getItem("pulsehr_user")) || null,
  activeTab: "dashboard",
  authTab: "login",
  employees: [], // Cache for project/payroll forms
  todayAttendance: null
};

// ── Application Initialization ──────────────────────────────────────────────

document.addEventListener("DOMContentLoaded", () => {
  initClock();
  if (state.token && state.user) {
    showDashboard();
  } else {
    showAuth();
  }
});

function initClock() {
  const timeSlot = document.getElementById("currentTime");
  setInterval(() => {
    const now = new Date();
    timeSlot.textContent = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  }, 1000);
}

// ── Authentication Management ────────────────────────────────────────────────

function switchAuthTab(tab) {
  state.authTab = tab;
  document.getElementById("tabLogin").classList.toggle("active", tab === "login");
  document.getElementById("tabSignup").classList.toggle("active", tab === "signup");
  document.getElementById("loginForm").classList.toggle("hidden", tab !== "login");
  document.getElementById("signupForm").classList.toggle("hidden", tab !== "signup");
}

async function handleLogin(e) {
  e.preventDefault();
  showLoading(true);
  const email = document.getElementById("loginEmail").value;
  const password = document.getElementById("loginPassword").value;

  try {
    const res = await fetch(`${API_BASE}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password })
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.detail || "Authentication failed.");

    state.token = data.access_token;
    state.user = data.user;
    localStorage.setItem("pulsehr_token", state.token);
    localStorage.setItem("pulsehr_user", JSON.stringify(state.user));

    showToast("Welcome back to PulseHR!", "success");
    showDashboard();
  } catch (err) {
    showToast(err.message, "error");
  } finally {
    showLoading(false);
  }
}

async function handleSignup(e) {
  e.preventDefault();
  showLoading(true);
  const full_name = document.getElementById("signupName").value;
  const email = document.getElementById("signupEmail").value;
  const password = document.getElementById("signupPassword").value;
  const role = document.getElementById("signupRole").value;

  try {
    const res = await fetch(`${API_BASE}/api/auth/signup`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password, full_name, role })
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.detail || "Registration failed.");

    showToast("Registration successful! You can now sign in.", "success");
    switchAuthTab("login");
    document.getElementById("loginEmail").value = email;
    document.getElementById("loginPassword").value = password;
  } catch (err) {
    showToast(err.message, "error");
  } finally {
    showLoading(false);
  }
}

function handleLogout() {
  state.token = null;
  state.user = null;
  localStorage.removeItem("pulsehr_token");
  localStorage.removeItem("pulsehr_user");
  showAuth();
}

function showAuth() {
  document.getElementById("authScreen").classList.remove("hidden");
  document.getElementById("dashboardScreen").classList.add("hidden");
}

function showDashboard() {
  document.getElementById("authScreen").classList.add("hidden");
  document.getElementById("dashboardScreen").classList.remove("hidden");
  
  // Render sidebar items
  document.getElementById("sidebarName").textContent = state.user.full_name;
  document.getElementById("sidebarRole").textContent = state.user.role;
  
  // Guard Admin dashboard
  const isAdmin = state.user.role === "Admin" || state.user.role === "HR";
  document.getElementById("navAi").classList.toggle("hidden", state.user.role !== "Admin");
  document.getElementById("btnNewProject").classList.toggle("hidden", state.user.role !== "Admin");
  document.getElementById("btnCreatePayroll").classList.toggle("hidden", state.user.role !== "Admin");
  
  // Display Clock widget for Employees
  document.getElementById("clockWidget").classList.toggle("hidden", state.user.role !== "Employee");
  
  // Trigger initial loads
  switchTab("dashboard");
  if (state.user.role === "Employee") {
    checkTodayClockStatus();
  }
}

// ── Tab Management & Routing ────────────────────────────────────────────────

function switchTab(tabId) {
  state.activeTab = tabId;
  
  // Set navbar classes
  document.querySelectorAll(".nav-item").forEach(item => {
    item.classList.remove("active");
  });
  
  // Toggle sections
  document.querySelectorAll(".tab-content").forEach(sec => {
    sec.classList.add("hidden");
  });

  const headingText = {
    dashboard: "Overview Dashboard",
    attendance: "Attendance Records",
    leaves: "Leave Management",
    projects: "Collaborative Projects",
    payroll: "Payroll Statements",
    ai: "PulseHR Llama 3.1 Director"
  };

  document.getElementById("pageHeading").textContent = headingText[tabId];
  
  if (tabId === "dashboard") {
    document.getElementById("secDashboard").classList.remove("hidden");
    loadOverviewDashboard();
  } else if (tabId === "attendance") {
    document.getElementById("secAttendance").classList.remove("hidden");
    loadAttendanceData();
  } else if (tabId === "leaves") {
    document.getElementById("secLeaves").classList.remove("hidden");
    loadLeavesData();
  } else if (tabId === "projects") {
    document.getElementById("secProjects").classList.remove("hidden");
    loadProjectsData();
  } else if (tabId === "payroll") {
    document.getElementById("secPayroll").classList.remove("hidden");
    loadPayrollData();
  } else if (tabId === "ai") {
    document.getElementById("secAi").classList.remove("hidden");
    loadAiInsights();
  }
}

// ── API Fetch Client wrapper ────────────────────────────────────────────────

async function apiFetch(endpoint, options = {}) {
  const headers = options.headers || {};
  if (state.token) {
    headers["Authorization"] = `Bearer ${state.token}`;
  }

  const res = await fetch(`${API_BASE}${endpoint}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...headers
    }
  });

  if (res.status === 401) {
    handleLogout();
    throw new Error("Session expired. Please log in again.");
  }

  return res;
}

// ── Overview Dashboard Tab ──────────────────────────────────────────────────

async function loadOverviewDashboard() {
  showLoading(true);
  try {
    // 1. Fetch dashboard metrics
    const res = await apiFetch("/api/dashboard");
    const data = await res.json();

    const isAdmin = state.user.role === "Admin" || state.user.role === "HR";
    document.getElementById("adminMetricsGrid").classList.toggle("hidden", !isAdmin);
    document.getElementById("employeeStatsGrid").classList.toggle("hidden", isAdmin);

    if (isAdmin) {
      document.getElementById("metricTotalEmployees").textContent = data.total_employees || 0;
      document.getElementById("metricActiveLeaves").textContent = data.active_leaves_today || 0;
      document.getElementById("metricPendingApprovals").textContent = data.pending_leaves_count || 0;
      document.getElementById("metricActiveProjects").textContent = data.active_projects_count || 0;
    } else {
      document.getElementById("empLeavesCount").textContent = `${data.leave_days_taken || 0} days`;
      document.getElementById("empProjectsCount").textContent = `${data.assigned_projects_count || 0} Active`;
    }

    // 2. Fetch own Profile info
    const profRes = await apiFetch("/api/profiles/me");
    const profile = await profRes.json();

    document.getElementById("profileNameText").textContent = profile.full_name || state.user.full_name;
    document.getElementById("profileJobText").textContent = profile.job_title || state.user.role;
    
    // Set fields
    document.getElementById("profilePhone").value = profile.phone || "";
    document.getElementById("profileAddress").value = profile.address || "";
    document.getElementById("profileSkills").value = profile.skills ? profile.skills.join(", ") : "";

    if (profile.profile_picture_url) {
      document.getElementById("profilePicturePreview").src = profile.profile_picture_url;
      document.getElementById("sidebarAvatar").innerHTML = `<img src="${profile.profile_picture_url}">`;
    }

    // 3. If Admin/HR, cache list of employees for project/payroll forms
    if (isAdmin) {
      const empRes = await apiFetch("/api/profiles");
      state.employees = await empRes.json();
      populateDropdowns();
    }

  } catch (err) {
    showToast(err.message, "error");
  } finally {
    showLoading(false);
  }
}

function populateDropdowns() {
  const projSelect = document.getElementById("projAssignee");
  const paySelect = document.getElementById("payUser");

  let options = `<option value="">-- Select Employee --</option>`;
  state.employees.forEach(emp => {
    options += `<option value="${emp.user_id}">${emp.full_name} (${emp.department || "No Department"})</option>`;
  });

  if (projSelect) projSelect.innerHTML = options;
  if (paySelect) paySelect.innerHTML = options;
}

async function handleProfileUpdate(e) {
  e.preventDefault();
  showLoading(true);
  const phone = document.getElementById("profilePhone").value;
  const address = document.getElementById("profileAddress").value;
  const skillsInput = document.getElementById("profileSkills").value;
  
  const skills = skillsInput ? skillsInput.split(",").map(s => s.trim()).filter(Boolean) : [];

  try {
    const res = await apiFetch("/api/profiles/me", {
      method: "PUT",
      body: JSON.stringify({ phone, address, skills })
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.detail || "Update failed.");

    showToast("Profile details updated successfully!", "success");
    loadOverviewDashboard();
  } catch (err) {
    showToast(err.message, "error");
  } finally {
    showLoading(false);
  }
}

async function uploadProfilePhoto(e) {
  const file = e.target.files[0];
  if (!file) return;

  const formData = new FormData();
  formData.append("file", file);

  showLoading(true);
  try {
    const res = await fetch(`${API_BASE}/api/profiles/upload-photo`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${state.token}`
      },
      body: formData
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.detail || "Upload failed.");

    showToast("Avatar photo uploaded successfully!", "success");
    loadOverviewDashboard();
  } catch (err) {
    showToast(err.message, "error");
  } finally {
    showLoading(false);
  }
}

// ── Attendance Tab ──────────────────────────────────────────────────────────

async function checkTodayClockStatus() {
  try {
    const res = await apiFetch("/api/attendance/me?limit=1");
    const data = await res.json();
    const todayStr = new Date().toLocaleDateString('en-CA'); // YYYY-MM-DD local

    if (data.length > 0 && data[0].date === todayStr) {
      state.todayAttendance = data[0];
      const hasCheckedIn = !!data[0].check_in;
      const hasCheckedOut = !!data[0].check_out;

      document.getElementById("btnCheckIn").classList.toggle("hidden", hasCheckedIn);
      document.getElementById("btnCheckOut").classList.toggle("hidden", !hasCheckedIn || hasCheckedOut);
      document.getElementById("empTodayStatus").textContent = hasCheckedOut ? "Completed" : (hasCheckedIn ? "Active (In)" : "Absent");
    } else {
      state.todayAttendance = null;
      document.getElementById("btnCheckIn").classList.remove("hidden");
      document.getElementById("btnCheckOut").classList.add("hidden");
    }
  } catch (err) {
    console.error(err);
  }
}

async function triggerClockAction(type) {
  showLoading(true);
  try {
    const res = await apiFetch(`/api/attendance/${type}`, { method: "POST" });
    const data = await res.json();

    if (!res.ok) throw new Error(data.detail || "Clock operation failed.");

    showToast(data.message, "success");
    checkTodayClockStatus();
    if (state.activeTab === "attendance") loadAttendanceData();
    if (state.activeTab === "dashboard") loadOverviewDashboard();
  } catch (err) {
    showToast(err.message, "error");
  } finally {
    showLoading(false);
  }
}

async function loadAttendanceData() {
  showLoading(true);
  const fromDate = document.getElementById("attendanceFilterFrom").value;
  const toDate = document.getElementById("attendanceFilterTo").value;
  
  let endpoint = state.user.role === "Employee" ? "/api/attendance/me?limit=50" : "/api/attendance?limit=100";
  if (fromDate) endpoint += `&from_date=${fromDate}`;
  if (toDate) endpoint += `&to_date=${toDate}`;

  try {
    const res = await apiFetch(endpoint);
    const data = await res.json();

    const tbody = document.getElementById("attendanceTableBody");
    tbody.innerHTML = "";

    if (!data.length) {
      tbody.innerHTML = `<tr><td colspan="6" class="text-center text-muted">No attendance logs found.</td></tr>`;
      return;
    }

    data.forEach(row => {
      const clockIn = row.check_in ? new Date(row.check_in).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : "—";
      const clockOut = row.check_out ? new Date(row.check_out).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : "—";
      const empName = row.profiles ? `<br><small class="text-muted">${row.profiles.full_name}</small>` : "";

      let statusBadge = `<span class="badge badge-success">Present</span>`;
      if (row.status === "Absent") statusBadge = `<span class="badge badge-danger">Absent</span>`;
      if (row.status === "Half-day") statusBadge = `<span class="badge badge-warning">Half-day</span>`;
      if (row.status === "On Leave") statusBadge = `<span class="badge badge-purple">On Leave</span>`;

      tbody.innerHTML += `
        <tr>
          <td><b>${row.date}</b>${empName}</td>
          <td>${clockIn}</td>
          <td>${clockOut}</td>
          <td>${row.hours !== null ? row.hours + ' hrs' : '—'}</td>
          <td>${statusBadge}</td>
          <td><span class="text-muted" style="text-transform: capitalize;">${row.marked_by}</span></td>
        </tr>
      `;
    });

  } catch (err) {
    showToast(err.message, "error");
  } finally {
    showLoading(false);
  }
}

// ── Leaves Tab ──────────────────────────────────────────────────────────────

async function loadLeavesData() {
  showLoading(true);
  const isAdmin = state.user.role === "Admin" || state.user.role === "HR";
  document.getElementById("leaveApplicationBlock").classList.toggle("hidden", isAdmin);
  document.getElementById("leavesTableTitle").textContent = isAdmin ? "All Leaves Applications" : "My Leave Requests";
  document.getElementById("leavesActionHeader").classList.toggle("hidden", !isAdmin);

  try {
    const endpoint = isAdmin ? "/api/leaves" : "/api/leaves/me";
    const res = await apiFetch(endpoint);
    const data = await res.json();

    const tbody = document.getElementById("leavesTableBody");
    tbody.innerHTML = "";

    if (!data.length) {
      tbody.innerHTML = `<tr><td colspan="6" class="text-center text-muted">No leave applications found.</td></tr>`;
      return;
    }

    data.forEach(row => {
      let statusBadge = `<span class="badge badge-warning">Pending</span>`;
      if (row.status === "Approved") statusBadge = `<span class="badge badge-success">Approved</span>`;
      if (row.status === "Rejected") statusBadge = `<span class="badge badge-danger">Rejected</span>`;

      const empDetails = row.profiles ? `<br><small class="text-muted">${row.profiles.full_name} (${row.profiles.department || 'No Dept'})</small>` : "";

      let actionsCell = "";
      if (isAdmin) {
        if (row.status === "Pending") {
          actionsCell = `
            <td class="actions-col">
              <button class="btn btn-sm btn-success" onclick="reviewLeave('${row.id}', 'approve')"><i class="fa-solid fa-check"></i></button>
              <button class="btn btn-sm btn-danger" onclick="reviewLeave('${row.id}', 'reject')"><i class="fa-solid fa-xmark"></i></button>
            </td>
          `;
        } else {
          actionsCell = `<td class="actions-col">—</td>`;
        }
      }

      tbody.innerHTML += `
        <tr>
          <td><b>${row.leave_type}</b>${empDetails}</td>
          <td>${row.start_date} to ${row.end_date}</td>
          <td><span class="text-muted">${row.reason}</span></td>
          <td>${statusBadge}</td>
          <td><span class="text-muted">${row.admin_comments || '—'}</span></td>
          ${actionsCell}
        </tr>
      `;
    });

  } catch (err) {
    showToast(err.message, "error");
  } finally {
    showLoading(false);
  }
}

async function handleApplyLeave(e) {
  e.preventDefault();
  showLoading(true);
  const leave_type = document.getElementById("leaveType").value;
  const start_date = document.getElementById("leaveStart").value;
  const end_date = document.getElementById("leaveEnd").value;
  const reason = document.getElementById("leaveReason").value;

  try {
    const res = await apiFetch("/api/leaves", {
      method: "POST",
      body: JSON.stringify({ leave_type, start_date, end_date, reason })
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.detail || "Application failed.");

    showToast("Leave request submitted successfully!", "success");
    document.getElementById("leaveRequestForm").reset();
    loadLeavesData();
  } catch (err) {
    showToast(err.message, "error");
  } finally {
    showLoading(false);
  }
}

async function reviewLeave(id, action) {
  let admin_comments = null;
  if (action === "reject") {
    admin_comments = prompt("Please provide a reason/comment for rejection:");
    if (admin_comments === null) return; // Cancel
    if (!admin_comments.trim()) {
      showToast("Reason is required to reject leaves.", "error");
      return;
    }
  }

  showLoading(true);
  try {
    const body = action === "reject" ? JSON.stringify({ admin_comments }) : null;
    const res = await apiFetch(`/api/leaves/${id}/${action}`, {
      method: "PUT",
      body
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.detail || "Operation failed.");

    showToast(`Leave application successfully ${action}d!`, "success");
    loadLeavesData();
  } catch (err) {
    showToast(err.message, "error");
  } finally {
    showLoading(false);
  }
}

// ── Projects Tab ────────────────────────────────────────────────────────────

async function loadProjectsData() {
  showLoading(true);
  try {
    const res = await apiFetch("/api/projects");
    const data = await res.json();

    const grid = document.getElementById("projectsGrid");
    grid.innerHTML = "";

    if (!data.length) {
      grid.innerHTML = `<p class="text-center text-muted" style="grid-column: 1/-1;">No assigned projects found.</p>`;
      return;
    }

    const isAdmin = state.user.role === "Admin";

    data.forEach(proj => {
      const assigneeName = proj.assigned_to ? proj.assigned_to.full_name : "Unassigned";
      const creatorName = proj.created_by ? proj.created_by.full_name : "Admin";
      
      let statusClass = "badge-warning";
      if (proj.status === "Completed") statusClass = "badge-success";
      if (proj.status === "In Review") statusClass = "badge-purple";
      if (proj.status === "Not Started") statusClass = "badge-danger";

      let actionsHtml = "";
      if (isAdmin) {
        if (proj.status === "In Review") {
          actionsHtml = `
            <div style="display:flex; gap:8px; margin-top:14px;">
              <button class="btn btn-sm btn-success" onclick="reviewProject('${proj.id}', 'Approve')">Approve</button>
              <button class="btn btn-sm btn-danger" onclick="reviewProject('${proj.id}', 'Request Changes')">Fixes</button>
            </div>
          `;
        } else {
          actionsHtml = `
            <div style="display:flex; justify-content: flex-end; margin-top:14px;">
              <button class="btn btn-sm btn-danger" onclick="deleteProject('${proj.id}')"><i class="fa-regular fa-trash-can"></i> Delete</button>
            </div>
          `;
        }
      } else {
        // Employee Status Select
        actionsHtml = `
          <div style="margin-top:14px;">
            <select class="project-status-select" onchange="updateProjectStatus('${proj.id}', this.value)">
              <option value="Not Started" ${proj.status === 'Not Started' ? 'selected' : ''}>Not Started</option>
              <option value="In Progress" ${proj.status === 'In Progress' ? 'selected' : ''}>In Progress</option>
              <option value="In Review" ${proj.status === 'In Review' ? 'selected' : ''}>Ready for Review</option>
            </select>
          </div>
        `;
      }

      grid.innerHTML += `
        <div class="project-card">
          <div class="project-card-header">
            <span class="project-title">${proj.title}</span>
            <span class="badge ${statusClass}">${proj.status}</span>
          </div>
          <p class="project-desc">${proj.description || 'No description provided.'}</p>
          <div class="project-meta-row">
            <span><i class="fa-regular fa-user"></i> ${assigneeName}</span>
            <span><i class="fa-solid fa-flag"></i> ${proj.priority}</span>
          </div>
          <div class="project-meta-row" style="margin-top: 6px;">
            <span><i class="fa-regular fa-calendar"></i> Deadline: ${proj.deadline || 'None'}</span>
            <span>By: ${creatorName}</span>
          </div>
          ${actionsHtml}
        </div>
      `;
    });

  } catch (err) {
    showToast(err.message, "error");
  } finally {
    showLoading(false);
  }
}

async function handleCreateProject(e) {
  e.preventDefault();
  showLoading(true);
  const title = document.getElementById("projTitle").value;
  const description = document.getElementById("projDesc").value;
  const assigned_to = document.getElementById("projAssignee").value;
  const deadline = document.getElementById("projDeadline").value;
  const priority = document.getElementById("projPriority").value;

  try {
    const res = await apiFetch("/api/projects", {
      method: "POST",
      body: JSON.stringify({ title, description, assigned_to, deadline, priority })
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.detail || "Creation failed.");

    showToast("Project created and assigned!", "success");
    closeModal("newProjectModal");
    document.getElementById("createProjectForm").reset();
    loadProjectsData();
  } catch (err) {
    showToast(err.message, "error");
  } finally {
    showLoading(false);
  }
}

async function updateProjectStatus(id, statusVal) {
  showLoading(true);
  try {
    const res = await apiFetch(`/api/projects/${id}`, {
      method: "PUT",
      body: JSON.stringify({ status: statusVal })
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.detail || "Update failed.");

    showToast("Project status updated!", "success");
    loadProjectsData();
  } catch (err) {
    showToast(err.message, "error");
  } finally {
    showLoading(false);
  }
}

async function reviewProject(id, action) {
  let admin_comments = "";
  if (action === "Request Changes") {
    admin_comments = prompt("Explain details / requested changes:");
    if (admin_comments === null) return;
  }

  showLoading(true);
  try {
    const res = await apiFetch(`/api/projects/${id}/review`, {
      method: "PUT",
      body: JSON.stringify({ action, admin_comments })
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.detail || "Review failed.");

    showToast(`Project successfully reviewed as: ${action}`, "success");
    loadProjectsData();
  } catch (err) {
    showToast(err.message, "error");
  } finally {
    showLoading(false);
  }
}

async function deleteProject(id) {
  if (!confirm("Are you sure you want to permanently delete this project?")) return;
  showLoading(true);
  try {
    const res = await apiFetch(`/api/projects/${id}`, { method: "DELETE" });
    const data = await res.json();

    if (!res.ok) throw new Error(data.detail || "Deletion failed.");

    showToast("Project deleted successfully.", "success");
    loadProjectsData();
  } catch (err) {
    showToast(err.message, "error");
  } finally {
    showLoading(false);
  }
}

// ── Payroll Tab ─────────────────────────────────────────────────────────────

async function loadPayrollData() {
  showLoading(true);
  try {
    const res = await apiFetch("/api/payroll");
    const data = await res.json();

    const tbody = document.getElementById("payrollTableBody");
    tbody.innerHTML = "";

    if (!data.length) {
      tbody.innerHTML = `<tr><td colspan="7" class="text-center text-muted">No salary slips found.</td></tr>`;
      return;
    }

    data.forEach(row => {
      const empName = row.profiles ? row.profiles.full_name : `User ${row.user_id.substring(0, 8)}`;
      const period = `${row.year}-${String(row.month).padStart(2, '0')}`;

      tbody.innerHTML += `
        <tr>
          <td><b>${empName}</b></td>
          <td>${period}</td>
          <td>$${row.base_salary.toLocaleString()}</td>
          <td>-$${row.deductions.toLocaleString()}</td>
          <td><b>$${row.net_pay.toLocaleString()}</b></td>
          <td><span class="badge badge-success">Paid</span></td>
          <td>
            <button class="btn btn-sm btn-primary" onclick="downloadPayslip('${row.id}', '${period}')">
              <i class="fa-solid fa-download"></i> Payslip
            </button>
          </td>
        </tr>
      `;
    });

  } catch (err) {
    showToast(err.message, "error");
  } finally {
    showLoading(false);
  }
}

async function handleCreatePayroll(e) {
  e.preventDefault();
  showLoading(true);
  const user_id = document.getElementById("payUser").value;
  const monthVal = document.getElementById("payMonth").value; // YYYY-MM
  const base_salary = parseFloat(document.getElementById("payBase").value);
  const deductions = parseFloat(document.getElementById("payDeductions").value);

  try {
    const res = await apiFetch("/api/payroll", {
      method: "POST",
      body: JSON.stringify({ user_id, month: monthVal, base_salary, deductions })
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.detail || "Failed to process payroll.");

    showToast("Payroll processed successfully!", "success");
    closeModal("createPayrollModal");
    document.getElementById("createPayrollForm").reset();
    loadPayrollData();
  } catch (err) {
    showToast(err.message, "error");
  } finally {
    showLoading(false);
  }
}

async function downloadPayslip(id, period) {
  showLoading(true);
  try {
    const response = await fetch(`${API_BASE}/api/payroll/${id}/download`, {
      method: "GET",
      headers: {
        "Authorization": `Bearer ${state.token}`
      }
    });

    if (!response.ok) {
      const errData = await response.json();
      throw new Error(errData.detail || "Failed to download payslip.");
    }

    const blob = await response.blob();
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `payslip_${period}.pdf`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.URL.revokeObjectURL(url);
    showToast("PDF downloaded successfully!", "success");
  } catch (err) {
    showToast(err.message, "error");
  } finally {
    showLoading(false);
  }
}

// ── AI Insights Tab (Admin Only) ────────────────────────────────────────────

async function loadAiInsights() {
  showLoading(true);
  const output = document.getElementById("aiInsightOutput");
  output.innerHTML = `<p class="text-muted"><i class="fa-solid fa-spinner fa-spin"></i> Querying Llama 3.1 model. Please wait...</p>`;
  
  try {
    const res = await apiFetch("/api/ai/insights");
    const data = await res.json();

    if (!res.ok) throw new Error(data.detail || "Failed to load insights.");

    // Simple parser to convert Llama Markdown to HTML elements
    let text = data.summary;
    text = text.replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>");
    text = text.replace(/\*(.*?)\*/g, "<em>$1</em>");
    text = text.replace(/-\s(.*)/g, "<li>$1</li>");
    text = text.replace(/(<li>.*?<\/li>)/gs, "<ul>$1</ul>");
    text = text.replace(/<\/ul>\s*<ul>/g, ""); // Collapse adjacent lists
    text = text.replace(/\n/g, "<br>");

    output.innerHTML = text;
    document.getElementById("aiGeneratedTime").textContent = `Analyzed: ${new Date(data.generated_at).toLocaleString()}`;
  } catch (err) {
    output.innerHTML = `<p class="text-danger"><i class="fa-solid fa-triangle-exclamation"></i> AI Analysis failed: ${err.message}</p>`;
    showToast(err.message, "error");
  } finally {
    showLoading(false);
  }
}

// ── Overlay Loading & Toast Notifications Helpers ───────────────────────────

function showLoading(show) {
  document.getElementById("loadingOverlay").classList.toggle("hidden", !show);
}

function showToast(message, type = "info") {
  const container = document.getElementById("toastContainer");
  const toast = document.createElement("div");
  toast.className = `toast toast-${type}`;
  
  let icon = '<i class="fa-solid fa-circle-info"></i>';
  if (type === "success") icon = '<i class="fa-solid fa-circle-check"></i>';
  if (type === "error") icon = '<i class="fa-solid fa-triangle-exclamation"></i>';

  toast.innerHTML = `${icon} <span>${message}</span>`;
  container.appendChild(toast);

  // Auto remove toast
  setTimeout(() => {
    toast.style.animation = "toastIn 0.35s reverse forwards";
    setTimeout(() => toast.remove(), 400);
  }, 4000);
}

// ── Modal Handlers ──────────────────────────────────────────────────────────

function openModal(id) {
  document.getElementById(id).classList.add("open");
}

function closeModal(id) {
  document.getElementById(id).classList.remove("open");
}
window.onclick = function(e) {
  if (e.target.classList.contains("modal")) {
    e.target.classList.remove("open");
  }
};
