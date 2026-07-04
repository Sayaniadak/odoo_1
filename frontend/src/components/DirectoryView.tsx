import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Search, Loader2, AlertCircle, Plane, X, User, DollarSign } from 'lucide-react';

interface UserMeta {
  id: string;
  email: string;
  role: string;
  full_name: string;
}

interface DirectoryViewProps {
  user: UserMeta;
  token: string;
  showToast: (msg: string, type: 'success' | 'error' | 'info') => void;
}

export const DirectoryView: React.FC<DirectoryViewProps> = ({ user, token }) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [deptFilter, setDeptFilter] = useState('');
  const [selectedEmp, setSelectedEmp] = useState<any | null>(null);

  const isStaff = user.role === 'Admin' || user.role === 'HR';
  const isAdmin = user.role === 'Admin';

  // Strict route protection in frontend component
  if (!isStaff) {
    return (
      <div className="card glass" style={{ padding: '40px', textAlign: 'center' }}>
        <div style={{ color: 'var(--danger)', fontSize: '3rem', marginBottom: '16px' }}>🔒</div>
        <h2>403 - Forbidden</h2>
        <p className="text-muted" style={{ marginTop: '8px' }}>
          You do not have authorization to view the Employee Directory. 
          This security check is enforced both client-side and at the API level.
        </p>
      </div>
    );
  }

  const todayStr = new Date().toLocaleDateString('en-CA');

  // ── Queries ──

  const { data: profiles = [], isLoading: isLoadingProfiles, error: profilesError } = useQuery({
    queryKey: ['directoryProfiles', token],
    queryFn: async () => {
      const res = await fetch('/api/profiles', {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.detail || "Failed to load directory.");
      }
      return res.json();
    }
  });

  // Fetch today's attendance logs for indicators
  const { data: todayAttendance = [] } = useQuery({
    queryKey: ['directoryAttendanceToday', token],
    queryFn: async () => {
      const res = await fetch(`/api/attendance?from_date=${todayStr}&to_date=${todayStr}`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (!res.ok) return [];
      return res.json();
    }
  });

  // Fetch leaves list for indicators
  const { data: leavesList = [] } = useQuery({
    queryKey: ['directoryLeaves', token],
    queryFn: async () => {
      const res = await fetch('/api/leaves?status_filter=Approved', {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (!res.ok) return [];
      return res.json();
    }
  });

  // Fetch payroll for selected employee (Admin only)
  const { data: empPayroll = [], isLoading: isLoadingPayroll } = useQuery({
    queryKey: ['empPayroll', selectedEmp?.user_id, token],
    queryFn: async () => {
      if (!selectedEmp || !isAdmin) return [];
      const res = await fetch('/api/payroll', {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (!res.ok) return [];
      const allPayroll = await res.json();
      return allPayroll.filter((pr: any) => pr.user_id === selectedEmp.user_id);
    },
    enabled: !!selectedEmp && isAdmin
  });

  const filtered = profiles.filter((p: any) => {
    const matchesSearch = (p.full_name || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
                          (p.job_title || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
                          (p.skills || []).some((s: string) => s.toLowerCase().includes(searchTerm.toLowerCase()));
    const matchesDept = !deptFilter || p.department === deptFilter;
    return matchesSearch && matchesDept;
  });

  const departments = Array.from(new Set(profiles.map((p: any) => p.department).filter(Boolean))) as string[];

  // Helper to determine status indicators
  const getStatusState = (empUserId: string) => {
    const isOnLeave = leavesList.some((lv: any) => 
      lv.user_id === empUserId && 
      todayStr >= lv.start_date && 
      todayStr <= lv.end_date
    );

    if (isOnLeave) return 'leave';

    const att = todayAttendance.find((a: any) => a.user_id === empUserId);
    if (att && att.check_in) return 'present';

    return 'absent';
  };

  return (
    <div>
      <div className="card glass" style={{ marginBottom: '24px', padding: '16px 20px' }}>
        <div className="flex-between" style={{ gap: '16px', flexWrap: 'wrap' }}>
          <div style={{ position: 'relative', flex: 1, minWidth: '240px' }}>
            <Search size={18} style={{ position: 'absolute', left: '14px', top: '12px', color: 'var(--text-muted)' }} />
            <input 
              type="text" 
              placeholder="Search by name, title, or skills..." 
              value={searchTerm} 
              onChange={e => setSearchTerm(e.target.value)} 
              style={{ paddingLeft: '44px', width: '100%', background: 'rgba(15,23,42,0.4)' }}
            />
          </div>
          
          <select 
            value={deptFilter} 
            onChange={e => setDeptFilter(e.target.value)}
            style={{ width: 'auto', minWidth: '180px', background: 'rgba(15,23,42,0.4)', color: '#fff' }}
          >
            <option value="">All Departments</option>
            {departments.map(dept => (
              <option key={dept} value={dept}>{dept}</option>
            ))}
          </select>
        </div>
      </div>

      {isLoadingProfiles ? (
        <div style={{ textAlign: 'center', padding: '40px' }}><Loader2 className="spinner" size={28} /></div>
      ) : profilesError ? (
        <div className="alert-toast error" style={{ position: 'static', margin: '20px 0', animation: 'none' }}>
          <AlertCircle size={18} />
          <span>{(profilesError as any).message}</span>
        </div>
      ) : (
        <div className="card glass" style={{ padding: '0', overflow: 'hidden' }}>
          <div className="table-container">
            <table className="data-table" style={{ width: '100%' }}>
              <thead>
                <tr>
                  <th>Employee</th>
                  <th>Department</th>
                  <th>Skills</th>
                  <th>Contact Details</th>
                  <th>Joining Date</th>
                  <th style={{ textAlign: 'center' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.length > 0 ? (
                  filtered.map((p: any) => {
                    const statusState = getStatusState(p.user_id);
                    return (
                      <tr key={p.id} style={{ verticalAlign: 'middle' }}>
                        <td>
                          <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
                            <div className="avatar-edit-wrapper" style={{ width: '38px', height: '38px', position: 'relative', border: '1px solid var(--border-light)' }}>
                              <img 
                                src={p.profile_picture_url || 'https://images.unsplash.com/photo-1472099645785-5658abf4ff4e?w=150&auto=format&fit=crop&q=60'} 
                                alt={p.full_name} 
                              />
                              {/* Status dot in bottom-right of avatar */}
                              <div style={{ position: 'absolute', bottom: '-2px', right: '-2px', background: '#0b0f19', borderRadius: '50%', padding: '2px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                {statusState === 'present' && (
                                  <span style={{ display: 'inline-block', width: '8px', height: '8px', borderRadius: '50%', backgroundColor: 'var(--success)' }} />
                                )}
                                {statusState === 'absent' && (
                                  <span style={{ display: 'inline-block', width: '8px', height: '8px', borderRadius: '50%', backgroundColor: 'var(--warning)' }} />
                                )}
                                {statusState === 'leave' && (
                                  <Plane size={10} style={{ color: 'var(--accent)' }} />
                                )}
                              </div>
                            </div>
                            <div>
                              <strong style={{ fontSize: '0.9rem', display: 'block' }}>{p.full_name}</strong>
                              <span className="text-muted" style={{ fontSize: '0.78rem' }}>{p.job_title || 'Employee'}</span>
                            </div>
                          </div>
                        </td>
                        <td>{p.department || '—'}</td>
                        <td>
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
                            {p.skills && p.skills.length > 0 ? (
                              p.skills.slice(0, 3).map((s: string) => (
                                <span 
                                  key={s} 
                                  style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid var(--border-light)', padding: '2px 8px', borderRadius: '4px', fontSize: '0.7rem', color: 'var(--text-muted)' }}
                                >
                                  {s}
                                </span>
                              ))
                            ) : (
                              <span className="text-muted" style={{ fontSize: '0.75rem' }}>—</span>
                            )}
                          </div>
                        </td>
                        <td>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', fontSize: '0.78rem' }}>
                            {p.phone && <span>📞 {p.phone}</span>}
                            <span className="text-muted" style={{ fontSize: '0.75rem' }}>{p.user_id ? `${p.user_id.substring(0, 8)}@seed.hrms.com` : '—'}</span>
                          </div>
                        </td>
                        <td>{p.joining_date || '—'}</td>
                        <td style={{ textAlign: 'center' }}>
                          <button className="btn btn-sm btn-primary" onClick={() => setSelectedEmp(p)} style={{ fontSize: '0.78rem', padding: '6px 12px' }}>
                            View Profile
                          </button>
                        </td>
                      </tr>
                    );
                  })
                ) : (
                  <tr>
                    <td colSpan={6} style={{ textAlign: 'center', padding: '20px', color: 'var(--text-muted)' }}>
                      No matches found.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Modal: View Employee Profile (View Only Mode) */}
      {selectedEmp && (
        <div className="modal open">
          <div className="modal-content glass" style={{ maxWidth: '600px' }}>
            <div className="modal-header">
              <h3 style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <User size={18} /> Employee Information File
              </h3>
              <span className="close-btn" onClick={() => setSelectedEmp(null)}><X size={18} /></span>
            </div>
            
            <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
              <div style={{ display: 'flex', gap: '20px', alignItems: 'center' }}>
                <div className="avatar-edit-wrapper" style={{ width: '80px', height: '80px' }}>
                  <img src={selectedEmp.profile_picture_url || 'https://images.unsplash.com/photo-1472099645785-5658abf4ff4e?w=150&auto=format&fit=crop&q=60'} alt="Avatar" />
                </div>
                <div>
                  <h2 style={{ fontSize: '1.4rem' }}>{selectedEmp.full_name}</h2>
                  <p className="text-muted">{selectedEmp.job_title || 'Staff member'} • {selectedEmp.department || 'General'}</p>
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', background: 'rgba(0,0,0,0.2)', padding: '16px', borderRadius: '12px' }}>
                <div>
                  <span className="text-muted" style={{ fontSize: '0.8rem', display: 'block' }}>Email Address</span>
                  <span style={{ fontSize: '0.92rem' }}>{selectedEmp.user_id ? `${selectedEmp.user_id.substring(0, 8)}@seed.hrms.com` : '—'}</span>
                </div>
                <div>
                  <span className="text-muted" style={{ fontSize: '0.8rem', display: 'block' }}>Phone Contact</span>
                  <span style={{ fontSize: '0.92rem' }}>{selectedEmp.phone || '—'}</span>
                </div>
                <div>
                  <span className="text-muted" style={{ fontSize: '0.8rem', display: 'block' }}>Postal Address</span>
                  <span style={{ fontSize: '0.92rem' }}>{selectedEmp.address || '—'}</span>
                </div>
                <div>
                  <span className="text-muted" style={{ fontSize: '0.8rem', display: 'block' }}>Joining Date</span>
                  <span style={{ fontSize: '0.92rem' }}>{selectedEmp.joining_date || '—'}</span>
                </div>
              </div>

              <div>
                <span className="text-muted" style={{ fontSize: '0.85rem', display: 'block', marginBottom: '6px' }}>Professional Skillsets</span>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                  {selectedEmp.skills && selectedEmp.skills.length > 0 ? (
                    selectedEmp.skills.map((s: string) => (
                      <span key={s} style={{ background: 'rgba(59, 130, 246, 0.1)', border: '1px solid rgba(59,130,246,0.15)', padding: '4px 10px', borderRadius: '6px', fontSize: '0.8rem', color: 'var(--primary)' }}>
                        {s}
                      </span>
                    ))
                  ) : (
                    <span className="text-muted" style={{ fontSize: '0.85rem' }}>No skills documented.</span>
                  )}
                </div>
              </div>

              {/* Priority 4: Admin Salary Tab/Section Rendered ONLY for Admin Role */}
              {isAdmin && (
                <div style={{ borderTop: '1px solid var(--border-light)', paddingTop: '20px' }}>
                  <h4 style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.95rem', marginBottom: '10px' }}>
                    <DollarSign size={16} style={{ color: 'var(--success)' }} /> Compensation & Payroll History
                  </h4>
                  {isLoadingPayroll ? (
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                      <Loader2 className="spinner" size={14} /> Loading records...
                    </div>
                  ) : empPayroll.length > 0 ? (
                    <div className="table-container" style={{ maxHeight: '150px', overflowY: 'auto' }}>
                      <table className="data-table" style={{ fontSize: '0.8rem' }}>
                        <thead>
                          <tr>
                            <th>Period</th>
                            <th>Base</th>
                            <th>Deductions</th>
                            <th>Net Pay</th>
                          </tr>
                        </thead>
                        <tbody>
                          {empPayroll.map((pr: any) => (
                            <tr key={pr.id}>
                              <td>{pr.year}-{String(pr.month).padStart(2, '0')}</td>
                              <td>${pr.base_salary.toLocaleString()}</td>
                              <td>-${pr.deductions.toLocaleString()}</td>
                              <td><strong>${pr.net_pay.toLocaleString()}</strong></td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <p className="text-muted" style={{ fontSize: '0.85rem' }}>No salary statements issued.</p>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
