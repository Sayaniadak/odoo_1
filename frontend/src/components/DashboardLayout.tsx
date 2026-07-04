import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { 
  LayoutDashboard, 
  Clock, 
  CalendarDays, 
  FolderGit2, 
  Wallet, 
  Sparkles, 
  LogOut, 
  User, 
  Activity,
  ArrowLeft,
  ArrowRight,
  ChevronDown,
  X
} from 'lucide-react';

// Import newly built Phase 3-6 components
import { DashboardView } from './DashboardView';
import { AttendanceView } from './AttendanceView';
import { LeavesView } from './LeavesView';
import { ProjectsView } from './ProjectsView';
import { PayrollView } from './PayrollView';
import { AiInsightsView } from './AiInsightsView';
import { DirectoryView } from './DirectoryView';

interface UserMeta {
  id: string;
  email: string;
  role: string;
  full_name: string;
}

interface DashboardLayoutProps {
  user: UserMeta;
  token: string;
  showToast: (msg: string, type: 'success' | 'error' | 'info') => void;
  onLogout: () => void;
}

type TabType = 'dashboard' | 'directory' | 'attendance' | 'leaves' | 'projects' | 'payroll' | 'ai';

export const DashboardLayout: React.FC<DashboardLayoutProps> = ({ user, token, showToast, onLogout }) => {
  const queryClient = useQueryClient();
  const [showDropdown, setShowDropdown] = useState(false);
  const [showOwnProfileModal, setShowOwnProfileModal] = useState(false);

  const menuItems = [
    { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard, roles: ['Employee', 'HR', 'Admin'] },
    { id: 'directory', label: 'Employee Directory', icon: User, roles: ['HR', 'Admin'] },
    { id: 'attendance', label: 'Attendance', icon: Clock, roles: ['Employee', 'HR', 'Admin'] },
    { id: 'leaves', label: 'Leaves', icon: CalendarDays, roles: ['Employee', 'HR', 'Admin'] },
    { id: 'projects', label: 'Projects', icon: FolderGit2, roles: ['Employee', 'HR', 'Admin'] },
    { id: 'payroll', label: 'Payroll', icon: Wallet, roles: ['Employee', 'HR', 'Admin'] },
    { id: 'ai', label: 'AI HR Insights', icon: Sparkles, roles: ['HR', 'Admin'] }
  ];

  const [activeTab, setActiveTab] = useState<TabType>(() => {
    const hash = window.location.hash.replace('#/', '');
    const validTabs: TabType[] = ['dashboard', 'directory', 'attendance', 'leaves', 'projects', 'payroll', 'ai'];
    if (validTabs.includes(hash as TabType)) {
      return hash as TabType;
    }
    return 'dashboard';
  });

  // ── Global Queries & Mutations ──

  // Fetch current user's profile for the avatar URL
  const { data: myProfile } = useQuery({
    queryKey: ['profileMe', token],
    queryFn: async () => {
      const res = await fetch('/api/profiles/me', {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (!res.ok) return null;
      return res.json();
    }
  });

  // Fetch today's clock status
  const { data: todayRecords = [] } = useQuery({
    queryKey: ['attendanceToday', token],
    queryFn: async () => {
      const res = await fetch('/api/attendance/me?limit=1', {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (!res.ok) return [];
      return res.json();
    },
    enabled: user.role === 'Employee'
  });

  const todayRecord = todayRecords.length > 0 && todayRecords[0].date === new Date().toLocaleDateString('en-CA') 
    ? todayRecords[0] 
    : null;

  const checkInMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch('/api/attendance/check-in', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || "Clock-in failed.");
      return data;
    },
    onSuccess: (data: any) => {
      showToast(data.message, 'success');
      queryClient.invalidateQueries({ queryKey: ['attendanceToday'] });
      queryClient.invalidateQueries({ queryKey: ['attendanceLogs'] });
      queryClient.invalidateQueries({ queryKey: ['dashboardMetrics'] });
    },
    onError: (err: any) => showToast(err.message, 'error')
  });

  const checkOutMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch('/api/attendance/check-out', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || "Clock-out failed.");
      return data;
    },
    onSuccess: (data: any) => {
      showToast(data.message, 'success');
      queryClient.invalidateQueries({ queryKey: ['attendanceToday'] });
      queryClient.invalidateQueries({ queryKey: ['attendanceLogs'] });
      queryClient.invalidateQueries({ queryKey: ['dashboardMetrics'] });
    },
    onError: (err: any) => showToast(err.message, 'error')
  });

  const getSinceTimeLabel = () => {
    if (!todayRecord?.check_in) return '';
    try {
      const dateObj = new Date(todayRecord.check_in);
      return dateObj.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    } catch {
      return '';
    }
  };

  React.useEffect(() => {
    const handleHashChange = () => {
      const hash = window.location.hash.replace('#/', '');
      const validTabs: TabType[] = ['dashboard', 'directory', 'attendance', 'leaves', 'projects', 'payroll', 'ai'];
      if (validTabs.includes(hash as TabType)) {
        const targetTab = hash as TabType;
        const targetMenuItem = menuItems.find(item => item.id === targetTab);
        if (targetMenuItem && !targetMenuItem.roles.includes(user.role)) {
          window.location.hash = '#/dashboard';
          setActiveTab('dashboard');
          showToast("403 - Access Forbidden for your role.", "error");
        } else {
          setActiveTab(targetTab);
        }
      }
    };

    window.addEventListener('hashchange', handleHashChange);
    handleHashChange(); // Run check on initial load
    return () => window.removeEventListener('hashchange', handleHashChange);
  }, [user.role]);

  const handleTabChange = (tab: TabType) => {
    window.location.hash = `#/${tab}`;
  };

  const allowedMenus = menuItems.filter(item => item.roles.includes(user.role));

  const pageHeadings: Record<TabType, { title: string; desc: string }> = {
    dashboard: { title: "Overview Dashboard", desc: `Welcome back, ${user.full_name}. Here is your overview.` },
    directory: { title: "Employee Directory", desc: "Corporate directory and communication profiles." },
    attendance: { title: "Attendance Logs", desc: "Clock in/out history and working hours details." },
    leaves: { title: "Leaves & Vacation", desc: "Submit, review, and track time-off applications." },
    projects: { title: "Collaborative Projects", desc: "View assignments and update completion status." },
    payroll: { title: "Payroll & Compensation", desc: "Access your compiled monthly salary payslips." },
    ai: { title: "Llama 3.1 HR Insights", desc: "Automated analysis of employee burnout and overlap risks." }
  };

  // Render content according to active tab
  const renderTabContent = () => {
    switch (activeTab) {
      case 'dashboard':
        return <DashboardView user={user} token={token} showToast={showToast} />;
      case 'directory':
        return <DirectoryView user={user} token={token} showToast={showToast} />;
      case 'attendance':
        return <AttendanceView user={user} token={token} showToast={showToast} />;
      case 'leaves':
        return <LeavesView user={user} token={token} showToast={showToast} />;
      case 'projects':
        return <ProjectsView user={user} token={token} showToast={showToast} />;
      case 'payroll':
        return <PayrollView user={user} token={token} showToast={showToast} />;
      case 'ai':
        return <AiInsightsView token={token} showToast={showToast} />;
      default:
        return <DashboardView user={user} token={token} showToast={showToast} />;
    }
  };

  const avatarUrl = myProfile?.profile_picture_url || 'https://images.unsplash.com/photo-1472099645785-5658abf4ff4e?w=150&auto=format&fit=crop&q=60';

  return (
    <div className="dashboard-screen">
      {/* Sidebar Navigation */}
      <aside className="sidebar">
        <div className="sidebar-logo">
          <Activity className="logo-icon" size={26} /> PulseHR
        </div>

        {/* Profile Card */}
        <div className="user-profile-badge">
          <div className="profile-avatar">
            <img src={avatarUrl} alt="Avatar" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
          </div>
          <div className="profile-info">
            <div className="profile-name">{user.full_name}</div>
            <div className="profile-role-tag">{user.role}</div>
          </div>
        </div>

        {/* Navigation Items */}
        <nav className="sidebar-nav">
          {allowedMenus.map(menu => {
            const Icon = menu.icon;
            return (
              <button
                key={menu.id}
                className={`nav-item ${activeTab === menu.id ? 'active' : ''}`}
                onClick={() => handleTabChange(menu.id as TabType)}
              >
                <Icon size={18} />
                <span>{menu.label}</span>
              </button>
            );
          })}
        </nav>

        {/* Sidebar Footer */}
        <div className="sidebar-footer">
          <button className="btn btn-logout" onClick={onLogout}>
            <LogOut size={16} />
            <span>Sign Out</span>
          </button>
        </div>
      </aside>

      {/* Main Page Content */}
      <main className="main-content">
        <header className="top-bar" style={{ position: 'relative' }}>
          <div className="page-title-slot">
            <h1>{pageHeadings[activeTab].title}</h1>
            <p className="text-muted" style={{ fontSize: '0.92rem', marginTop: '4px' }}>
              {pageHeadings[activeTab].desc}
            </p>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '20px' }}>
            {/* Priority 1: Prominent Check-In / Check-Out Widget for Employee */}
            {user.role === 'Employee' && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', background: 'rgba(255,255,255,0.02)', padding: '6px 12px', borderRadius: '10px', border: '1px solid var(--border-light)' }}>
                {todayRecord?.check_in && !todayRecord?.check_out ? (
                  <>
                    <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                      Since {getSinceTimeLabel()}
                    </span>
                    <button 
                      className="btn btn-sm btn-danger" 
                      style={{ padding: '6px 14px', fontSize: '0.85rem' }}
                      disabled={checkOutMutation.isPending}
                      onClick={() => checkOutMutation.mutate()}
                    >
                      <ArrowLeft size={12} /> Check Out
                    </button>
                  </>
                ) : (
                  <>
                    <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>Off Duty</span>
                    <button 
                      className="btn btn-sm btn-success" 
                      style={{ padding: '6px 14px', fontSize: '0.85rem' }}
                      disabled={checkInMutation.isPending || todayRecord?.check_out}
                      onClick={() => checkInMutation.mutate()}
                    >
                      <ArrowRight size={12} /> {todayRecord?.check_out ? "Completed" : "Check In"}
                    </button>
                  </>
                )}
              </div>
            )}

            {/* Profile Avatar with Dropdown */}
            <div style={{ position: 'relative' }}>
              <div 
                onClick={() => setShowDropdown(!showDropdown)}
                style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', background: 'rgba(255,255,255,0.02)', padding: '6px 10px', borderRadius: '20px', border: '1px solid var(--border-light)' }}
              >
                <div style={{ width: '30px', height: '30px', borderRadius: '50%', overflow: 'hidden' }}>
                  <img src={avatarUrl} alt="Nav Avatar" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                </div>
                <ChevronDown size={14} style={{ color: 'var(--text-muted)' }} />
              </div>

              {showDropdown && (
                <div 
                  className="dropdown-menu glass" 
                  style={{
                    position: 'absolute',
                    right: 0,
                    top: '40px',
                    zIndex: 999,
                    background: '#1e293b',
                    border: '1px solid var(--border-light)',
                    borderRadius: '8px',
                    width: '160px',
                    boxShadow: '0 10px 20px rgba(0,0,0,0.3)',
                    padding: '6px 0'
                  }}
                >
                  <button 
                    onClick={() => { setShowDropdown(false); setShowOwnProfileModal(true); }}
                    style={{ width: '100%', padding: '10px 14px', textAlign: 'left', border: 'none', background: 'transparent', color: '#fff', fontSize: '0.85rem', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '8px' }}
                  >
                    <User size={14} /> My Profile
                  </button>
                  <button 
                    onClick={() => { setShowDropdown(false); onLogout(); }}
                    style={{ width: '100%', padding: '10px 14px', textAlign: 'left', border: 'none', background: 'transparent', color: 'var(--danger)', fontSize: '0.85rem', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '8px', borderTop: '1px solid var(--border-light)' }}
                  >
                    <LogOut size={14} /> Log Out
                  </button>
                </div>
              )}
            </div>
          </div>
        </header>

        {/* Render Tab Content dynamically */}
        <div id="contentArea">
          {renderTabContent()}
        </div>
      </main>

      {/* Modal: View Own Profile Modal (View Mode) */}
      {showOwnProfileModal && myProfile && (
        <div className="modal open">
          <div className="modal-content glass" style={{ maxWidth: '600px' }}>
            <div className="modal-header">
              <h3 style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <User size={18} /> My Employment File
              </h3>
              <span className="close-btn" onClick={() => setShowOwnProfileModal(false)}><X size={18} /></span>
            </div>
            
            <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
              <div style={{ display: 'flex', gap: '20px', alignItems: 'center' }}>
                <div className="avatar-edit-wrapper" style={{ width: '80px', height: '80px' }}>
                  <img src={avatarUrl} alt="Avatar" />
                </div>
                <div>
                  <h2 style={{ fontSize: '1.4rem' }}>{myProfile.full_name}</h2>
                  <p className="text-muted">{myProfile.job_title || 'Staff member'} • {myProfile.department || 'General'}</p>
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', background: 'rgba(0,0,0,0.2)', padding: '16px', borderRadius: '12px' }}>
                <div>
                  <span className="text-muted" style={{ fontSize: '0.8rem', display: 'block' }}>Email Address</span>
                  <span style={{ fontSize: '0.92rem' }}>{user.email}</span>
                </div>
                <div>
                  <span className="text-muted" style={{ fontSize: '0.8rem', display: 'block' }}>Phone Contact</span>
                  <span style={{ fontSize: '0.92rem' }}>{myProfile.phone || '—'}</span>
                </div>
                <div>
                  <span className="text-muted" style={{ fontSize: '0.8rem', display: 'block' }}>Postal Address</span>
                  <span style={{ fontSize: '0.92rem' }}>{myProfile.address || '—'}</span>
                </div>
                <div>
                  <span className="text-muted" style={{ fontSize: '0.8rem', display: 'block' }}>Joining Date</span>
                  <span style={{ fontSize: '0.92rem' }}>{myProfile.joining_date || '—'}</span>
                </div>
              </div>

              <div>
                <span className="text-muted" style={{ fontSize: '0.85rem', display: 'block', marginBottom: '6px' }}>Professional Skillsets</span>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                  {myProfile.skills && myProfile.skills.length > 0 ? (
                    myProfile.skills.map((s: string) => (
                      <span key={s} style={{ background: 'rgba(59, 130, 246, 0.1)', border: '1px solid rgba(59,130,246,0.15)', padding: '4px 10px', borderRadius: '6px', fontSize: '0.8rem', color: 'var(--primary)' }}>
                        {s}
                      </span>
                    ))
                  ) : (
                    <span className="text-muted" style={{ fontSize: '0.85rem' }}>No skills documented.</span>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
