import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Users, CalendarRange, Hourglass, FolderKanban, Clock, Briefcase, Camera, Save, Award, Loader2 } from 'lucide-react';
import { UnifiedCalendar } from './UnifiedCalendar';

interface UserMeta {
  id: string;
  email: string;
  role: string;
  full_name: string;
}

interface DashboardViewProps {
  user: UserMeta;
  token: string;
  showToast: (msg: string, type: 'success' | 'error' | 'info') => void;
}

export const DashboardView: React.FC<DashboardViewProps> = ({ user, token, showToast }) => {
  const queryClient = useQueryClient();
  const [skillsInput, setSkillsInput] = useState('');
  const [avatarPreview, setAvatarPreview] = useState('https://images.unsplash.com/photo-1472099645785-5658abf4ff4e?w=150&auto=format&fit=crop&q=60');

  const isAdmin = user.role === 'Admin' || user.role === 'HR';

  // ── Queries via TanStack Query ──

  // 1. Fetch dashboard metrics
  const { data: metrics, isLoading: isLoadingMetrics } = useQuery({
    queryKey: ['dashboardMetrics', token],
    queryFn: async () => {
      const res = await fetch('/api/dashboard', {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (!res.ok) throw new Error("Failed to fetch dashboard metrics");
      return res.json();
    }
  });

  // 2. Fetch profile data
  const { data: profile, isLoading: isLoadingProfile } = useQuery({
    queryKey: ['profileMe', token],
    queryFn: async () => {
      const res = await fetch('/api/profiles/me', {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (!res.ok) throw new Error("Failed to fetch profile");
      const data = await res.json();
      setSkillsInput(data.skills ? data.skills.join(', ') : '');
      if (data.profile_picture_url) {
        setAvatarPreview(data.profile_picture_url);
      }
      return data;
    }
  });

  // 3. Fetch attendance logs for calendar
  const { data: attendanceLogs = [] } = useQuery({
    queryKey: ['calendarAttendance', token],
    queryFn: async () => {
      const endpoint = isAdmin ? '/api/attendance?limit=200' : '/api/attendance/me?limit=100';
      const res = await fetch(endpoint, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (!res.ok) throw new Error("Failed to load attendance logs");
      return res.json();
    }
  });

  // 4. Fetch leaves requests for calendar
  const { data: leaves = [] } = useQuery({
    queryKey: ['calendarLeaves', token],
    queryFn: async () => {
      const endpoint = isAdmin ? '/api/leaves' : '/api/leaves/me';
      const res = await fetch(endpoint, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (!res.ok) throw new Error("Failed to load leaves logs");
      return res.json();
    }
  });

  // 5. Fetch projects for calendar deadlines
  const { data: projects = [] } = useQuery({
    queryKey: ['calendarProjects', token],
    queryFn: async () => {
      const res = await fetch('/api/projects', {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (!res.ok) throw new Error("Failed to load projects");
      return res.json();
    }
  });

  const [newPassword, setNewPassword] = useState('');

  // ── Mutations ──

  const changePasswordMutation = useMutation({
    mutationFn: async (password: string) => {
      const res = await fetch('/api/auth/password', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ password })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || "Failed to update password");
      return data;
    },
    onSuccess: (data: any) => {
      showToast(data.message || "Password changed successfully.", "success");
      setNewPassword('');
    },
    onError: (err: any) => {
      showToast(err.message, 'error');
    }
  });

  const saveProfileMutation = useMutation({
    mutationFn: async (payload: any) => {
      const res = await fetch('/api/profiles/me', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify(payload)
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || "Profile save failed");
      return data;
    },
    onSuccess: () => {
      showToast("Profile details updated successfully!", "success");
      queryClient.invalidateQueries({ queryKey: ['profileMe'] });
    },
    onError: (err: any) => {
      showToast(err.message, 'error');
    }
  });

  const handleProfileSave = (e: React.FormEvent) => {
    e.preventDefault();
    const skills = skillsInput ? skillsInput.split(',').map(s => s.trim()).filter(Boolean) : [];
    saveProfileMutation.mutate({
      phone: profile?.phone || '',
      address: profile?.address || '',
      skills
    });
  };

  const handleAvatarUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const formData = new FormData();
    formData.append('file', file);

    try {
      const res = await fetch('/api/profiles/upload-photo', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` },
        body: formData
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || "Upload failed");
      showToast("Avatar photo uploaded successfully!", "success");
      queryClient.invalidateQueries({ queryKey: ['profileMe'] });
    } catch (err: any) {
      showToast(err.message, 'error');
    }
  };

  if (isLoadingMetrics || isLoadingProfile) {
    return <div style={{ textAlign: 'center', padding: '40px' }}><Loader2 className="spinner" size={24} /></div>;
  }

  return (
    <div>
      {/* Metrics Grid */}
      {isAdmin ? (
        <div className="metrics-grid">
          <div className="metric-card">
            <div className="metric-icon bg-blue-tint"><Users size={22} /></div>
            <div className="metric-data">
              <span className="metric-label">Total Employees</span>
              <span className="metric-value">{metrics?.total_employees || 0}</span>
            </div>
          </div>
          <div className="metric-card">
            <div className="metric-icon bg-green-tint"><CalendarRange size={22} /></div>
            <div className="metric-data">
              <span className="metric-label">On Leave Today</span>
              <span className="metric-value">{metrics?.active_leaves_today || 0}</span>
            </div>
          </div>
          <div className="metric-card">
            <div className="metric-icon bg-purple-tint"><Hourglass size={22} /></div>
            <div className="metric-data">
              <span className="metric-label">Pending Leaves</span>
              <span className="metric-value">{metrics?.pending_leaves_count || 0}</span>
            </div>
          </div>
          <div className="metric-card">
            <div className="metric-icon bg-amber-tint"><FolderKanban size={22} /></div>
            <div className="metric-data">
              <span className="metric-label">Active Projects</span>
              <span className="metric-value">{metrics?.active_projects_count || 0}</span>
            </div>
          </div>
        </div>
      ) : (
        <div className="metrics-grid">
          <div className="metric-card">
            <div className="metric-icon bg-green-tint"><Clock size={22} /></div>
            <div className="metric-data">
              <span className="metric-label">Today Status</span>
              <span className="metric-value">{metrics?.attendance_status_today || 'Absent'}</span>
            </div>
          </div>
          <div className="metric-card">
            <div className="metric-icon bg-blue-tint"><Briefcase size={22} /></div>
            <div className="metric-data">
              <span className="metric-label">Leaves Taken</span>
              <span className="metric-value">{metrics?.leave_days_taken || 0} Days</span>
            </div>
          </div>
          <div className="metric-card">
            <div className="metric-icon bg-purple-tint"><FolderKanban size={22} /></div>
            <div className="metric-data">
              <span className="metric-label">My Projects</span>
              <span className="metric-value">{metrics?.assigned_projects_count || 0} Active</span>
            </div>
          </div>
        </div>
      )}

      {/* Unified Calendar Block */}
      <div style={{ marginBottom: '24px' }}>
        <UnifiedCalendar 
          attendance={attendanceLogs} 
          leaves={leaves} 
          projects={projects.filter((p: any) => p.deadline).map((p: any) => ({ title: p.title, deadline: p.deadline }))} 
        />
      </div>

      {/* Splits */}
      <div className="dashboard-splits">
        <div className="split-left">
          <div className="card glass">
            <div className="card-header">
              <h3><Award size={18} /> My Professional Profile</h3>
            </div>
            <div className="card-body">
              <form onSubmit={handleProfileSave}>
                <div className="profile-photo-row">
                  <div className="avatar-edit-wrapper">
                    <img src={avatarPreview} alt="Avatar" />
                    <label htmlFor="photoInput" className="avatar-edit-btn">
                      <Camera size={14} />
                    </label>
                    <input 
                      type="file" 
                      id="photoInput" 
                      accept="image/*" 
                      onChange={handleAvatarUpload} 
                      style={{ display: 'none' }} 
                    />
                  </div>
                  <div className="profile-summary-meta">
                    <h4>{profile?.full_name || user.full_name}</h4>
                    <p className="text-muted">{profile?.job_title || user.role}</p>
                  </div>
                </div>
                
                <div className="form-row">
                  <div className="form-group col-6">
                    <label>Phone Number</label>
                    <input 
                      type="text" 
                      value={profile?.phone || ''} 
                      onChange={e => queryClient.setQueryData(['profileMe', token], { ...profile, phone: e.target.value })} 
                      placeholder="+91 99999 99999" 
                    />
                  </div>
                  <div className="form-group col-6">
                    <label>Postal Address</label>
                    <input 
                      type="text" 
                      value={profile?.address || ''} 
                      onChange={e => queryClient.setQueryData(['profileMe', token], { ...profile, address: e.target.value })} 
                      placeholder="City, State" 
                    />
                  </div>
                </div>
                
                <div className="form-group">
                  <label>Professional Skills (Comma separated)</label>
                  <input 
                    type="text" 
                    value={skillsInput} 
                    onChange={e => setSkillsInput(e.target.value)} 
                    placeholder="React, Node.js, Python, SQL" 
                  />
                </div>
                
                <button type="submit" disabled={saveProfileMutation.isPending} className="btn btn-sm btn-primary">
                  <Save size={14} /> {saveProfileMutation.isPending ? "Saving..." : "Save Profile Info"}
                </button>
              </form>

              {/* Password update section */}
              <div style={{ borderTop: '1px solid var(--border-light)', marginTop: '20px', paddingTop: '20px' }}>
                <h4 style={{ fontSize: '0.92rem', marginBottom: '12px' }}>Change Password</h4>
                <div style={{ display: 'flex', gap: '10px' }}>
                  <input 
                    type="password" 
                    placeholder="New Password (min 6 chars)" 
                    value={newPassword}
                    onChange={e => setNewPassword(e.target.value)}
                    style={{ flex: 1, padding: '8px 12px', background: 'rgba(15,23,42,0.4)', borderRadius: '8px', border: '1px solid var(--border-light)', color: '#fff', fontSize: '0.85rem' }}
                  />
                  <button 
                    type="button" 
                    onClick={() => {
                      if (newPassword.length < 6) {
                        showToast("Password must be at least 6 characters.", "error");
                        return;
                      }
                      changePasswordMutation.mutate(newPassword);
                    }}
                    disabled={changePasswordMutation.isPending}
                    className="btn btn-sm btn-primary"
                    style={{ whiteSpace: 'nowrap' }}
                  >
                    {changePasswordMutation.isPending ? "Updating..." : "Update Password"}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="split-right">
          <div className="card glass">
            <div className="card-header">
              <h3>Announcement Feed</h3>
            </div>
            <div className="card-body">
              <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                <div style={{ background: 'rgba(255,255,255,0.02)', padding: '12px', borderRadius: '8px', border: '1px solid var(--border-light)' }}>
                  <strong style={{ display: 'block', fontSize: '0.9rem' }}>Welcome to PulseHR</strong>
                  <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>FastAPI and Supabase power this real-time system.</span>
                </div>
                <div style={{ background: 'rgba(255,255,255,0.02)', padding: '12px', borderRadius: '8px', border: '1px solid var(--border-light)' }}>
                  <strong style={{ display: 'block', fontSize: '0.9rem' }}>ISO-8601 Date Formatting</strong>
                  <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>All date integrations must follow YYYY-MM-DD standard format.</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
