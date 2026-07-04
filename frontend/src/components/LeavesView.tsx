import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { DayPicker } from 'react-day-picker';
import type { DateRange } from 'react-day-picker';
import { format, differenceInCalendarDays } from 'date-fns';
import { Loader2, AlertCircle, Check, X } from 'lucide-react';
import 'react-day-picker/dist/style.css';

interface UserMeta {
  id: string;
  email: string;
  role: string;
  full_name: string;
}

interface LeavesViewProps {
  user: UserMeta;
  token: string;
  showToast: (msg: string, type: 'success' | 'error' | 'info') => void;
}

export const LeavesView: React.FC<LeavesViewProps> = ({ user, token, showToast }) => {
  const queryClient = useQueryClient();
  const [leaveType, setLeaveType] = useState('Paid');
  const [reason, setReason] = useState('');
  
  // Date Range selection state for react-day-picker
  const [selectedRange, setSelectedRange] = useState<DateRange | undefined>(undefined);
  const [statusFilter, setStatusFilter] = useState('');

  const isStaff = user.role === 'Admin' || user.role === 'HR';

  // ── Queries ──

  const { data: leaves = [], isLoading: isLoadingLeaves, error: leavesError } = useQuery({
    queryKey: ['leavesList', token, statusFilter],
    queryFn: async () => {
      let endpoint = isStaff ? '/api/leaves' : '/api/leaves/me';
      if (isStaff && statusFilter) {
        endpoint += `?status_filter=${statusFilter}`;
      }
      const res = await fetch(endpoint, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (!res.ok) throw new Error("Failed to load leaves logs.");
      return res.json();
    }
  });

  const getBalances = () => {
    let paidUsed = 0;
    let sickUsed = 0;
    let unpaidUsed = 0;

    leaves.forEach((lv: any) => {
      if (lv.status === 'Approved') {
        const start = new Date(lv.start_date);
        const end = new Date(lv.end_date);
        const diff = differenceInCalendarDays(end, start) + 1;
        if (lv.leave_type === 'Paid') paidUsed += diff;
        else if (lv.leave_type === 'Sick') sickUsed += diff;
        else if (lv.leave_type === 'Unpaid') unpaidUsed += diff;
      }
    });

    return {
      paid: Math.max(0, 20 - paidUsed),
      sick: Math.max(0, 10 - sickUsed),
      unpaid: unpaidUsed
    };
  };

  const balances = getBalances();

  // ── Mutations ──

  const applyLeaveMutation = useMutation({
    mutationFn: async (payload: any) => {
      const res = await fetch('/api/leaves', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify(payload)
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || "Leave application failed.");
      return data;
    },
    onSuccess: (data) => {
      showToast(data.message, 'success');
      setSelectedRange(undefined);
      setReason('');
      queryClient.invalidateQueries({ queryKey: ['leavesList'] });
    },
    onError: (err: any) => {
      showToast(err.message, 'error');
    }
  });

  const reviewLeaveMutation = useMutation({
    mutationFn: async ({ id, action, admin_comments }: { id: string; action: 'approve' | 'reject'; admin_comments?: string }) => {
      const body = action === 'reject' ? JSON.stringify({ admin_comments }) : null;
      const res = await fetch(`/api/leaves/${id}/${action}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || `Failed to ${action} leave request.`);
      return data;
    },
    onSuccess: (_, variables) => {
      showToast(`Leave request ${variables.action}d successfully.`, 'success');
      queryClient.invalidateQueries({ queryKey: ['leavesList'] });
    },
    onError: (err: any) => {
      showToast(err.message, 'error');
    }
  });

  // ── Form Submission ──

  const handleApplyLeaveSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedRange?.from || !selectedRange?.to) {
      showToast("Please drag/select a valid date range.", "error");
      return;
    }

    const payload = {
      leave_type: leaveType,
      start_date: format(selectedRange.from, 'yyyy-MM-dd'),
      end_date: format(selectedRange.to, 'yyyy-MM-dd'),
      reason
    };

    applyLeaveMutation.mutate(payload);
  };

  const handleRejectClick = (id: string) => {
    const reason = prompt("Enter rejection comments:");
    if (reason === null) return;
    if (!reason.trim()) {
      showToast("Reason is required to reject a leave.", "error");
      return;
    }
    reviewLeaveMutation.mutate({ id, action: 'reject', admin_comments: reason });
  };

  // Compute selected days count
  const selectedDaysCount = selectedRange?.from && selectedRange?.to
    ? differenceInCalendarDays(selectedRange.to, selectedRange.from) + 1
    : 0;

  return (
    <div className="dashboard-splits">
      {/* Leave Application Block (Visible to Employees) */}
      {!isStaff && (
        <div className="split-left" style={{ maxWidth: '350px' }}>
          <div className="card glass">
            <div className="card-header">
              <h3>Apply for Leave</h3>
            </div>
            <div className="card-body">
              <form onSubmit={handleApplyLeaveSubmit}>
                <div className="form-group">
                  <label>Leave Type</label>
                  <select value={leaveType} onChange={e => setLeaveType(e.target.value)}>
                    <option value="Paid">Paid Annual Leave</option>
                    <option value="Sick">Medical / Sick Leave</option>
                    <option value="Unpaid">Unpaid Personal Leave</option>
                  </select>
                </div>

                <div className="form-group" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                  <label style={{ alignSelf: 'flex-start' }}>Select Dates Range</label>
                  <div className="react-day-picker-container" style={{ background: 'rgba(15,23,42,0.4)', padding: '10px', borderRadius: '8px', border: '1px solid var(--border-light)' }}>
                    <DayPicker 
                      mode="range"
                      selected={selectedRange}
                      onSelect={setSelectedRange}
                      modifiers={{
                        disabled: { before: new Date() }
                      }}
                    />
                  </div>
                  {selectedDaysCount > 0 && (
                    <div style={{ alignSelf: 'flex-start', marginTop: '8px', fontSize: '0.85rem', color: 'var(--primary)', fontWeight: 600 }}>
                      Selected Duration: {selectedDaysCount} Days
                    </div>
                  )}
                </div>

                <div className="form-group">
                  <label>Reason for Absence</label>
                  <textarea 
                    value={reason} 
                    onChange={e => setReason(e.target.value)} 
                    rows={3} 
                    placeholder="Provide details..." 
                    required 
                    style={{ width: '100%', background: 'rgba(15, 23, 42, 0.6)', border: '1px solid var(--border-light)', color: '#fff', borderRadius: '12px', padding: '10px', fontSize: '0.9rem', outline: 'none' }}
                  />
                </div>

                <button 
                  type="submit" 
                  disabled={applyLeaveMutation.isPending}
                  className="btn btn-primary btn-block"
                >
                  {applyLeaveMutation.isPending ? "Submitting..." : "Submit Application"}
                </button>
              </form>
            </div>
          </div>
        </div>
      )}

      {/* Leaves Logs Table */}
      <div className="split-right" style={{ flex: 2 }}>
        <div className="card glass">
          <div className="card-header flex-between">
            <h3>{isStaff ? "Employee Leave Applications" : "My Leave History"}</h3>
            {isStaff && (
              <select 
                value={statusFilter} 
                onChange={e => setStatusFilter(e.target.value)}
                style={{ background: 'rgba(15,23,42,0.4)', border: '1px solid var(--border-light)', color: '#fff', padding: '6px 12px', borderRadius: '8px', fontSize: '0.85rem', outline: 'none' }}
              >
                <option value="">All Statuses</option>
                <option value="Pending">Pending</option>
                <option value="Approved">Approved</option>
                <option value="Rejected">Rejected</option>
              </select>
            )}
          </div>
          <div className="card-body">
            {/* Priority 3: Leave Balance Summary Header */}
            {!isLoadingLeaves && !leavesError && (
              <div style={{ display: 'flex', gap: '14px', marginBottom: '20px', flexWrap: 'wrap' }}>
                <div style={{ flex: 1, minWidth: '130px', background: 'rgba(16, 185, 129, 0.08)', border: '1px solid rgba(16, 185, 129, 0.15)', padding: '10px 14px', borderRadius: '10px' }}>
                  <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', display: 'block', fontWeight: 600 }}>PAID LEAVE AVAIL</span>
                  <strong style={{ fontSize: '1.2rem', color: 'var(--success)' }}>{balances.paid} / 20 days</strong>
                </div>
                <div style={{ flex: 1, minWidth: '130px', background: 'rgba(59, 130, 246, 0.08)', border: '1px solid rgba(59, 130, 246, 0.15)', padding: '10px 14px', borderRadius: '10px' }}>
                  <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', display: 'block', fontWeight: 600 }}>SICK LEAVE AVAIL</span>
                  <strong style={{ fontSize: '1.2rem', color: 'var(--primary)' }}>{balances.sick} / 10 days</strong>
                </div>
                <div style={{ flex: 1, minWidth: '130px', background: 'rgba(139, 92, 246, 0.08)', border: '1px solid rgba(139, 92, 246, 0.15)', padding: '10px 14px', borderRadius: '10px' }}>
                  <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', display: 'block', fontWeight: 600 }}>UNPAID LEAVE TAKEN</span>
                  <strong style={{ fontSize: '1.2rem', color: 'var(--accent)' }}>{balances.unpaid} days</strong>
                </div>
              </div>
            )}

            {isLoadingLeaves ? (
              <div style={{ textAlign: 'center', padding: '20px' }}><Loader2 className="spinner" size={24} /></div>
            ) : leavesError ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--danger)', background: 'rgba(239,68,68,0.1)', padding: '12px', borderRadius: '8px' }}>
                <AlertCircle size={18} />
                <span>{(leavesError as any).message}</span>
              </div>
            ) : (
              <div className="table-container">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Type</th>
                      <th>Period</th>
                      <th>Reason</th>
                      <th>Status</th>
                      <th>Manager Comments</th>
                      {isStaff && <th style={{ textAlign: 'center' }}>Actions</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {leaves.length > 0 ? (
                      leaves.map((row: any) => {
                        let statusBadge = <span className="badge badge-warning">Pending</span>;
                        if (row.status === "Approved") statusBadge = <span className="badge badge-success">Approved</span>;
                        if (row.status === "Rejected") statusBadge = <span className="badge badge-danger">Rejected</span>;

                        const empDetails = row.profiles ? (
                          <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '2px' }}>
                            {row.profiles.full_name} ({row.profiles.department || 'No Dept'})
                          </div>
                        ) : null;

                        return (
                          <tr key={row.id}>
                            <td>
                              <strong>{row.leave_type}</strong>
                              {empDetails}
                            </td>
                            <td>{row.start_date} to {row.end_date}</td>
                            <td><span className="text-muted" style={{ fontSize: '0.88rem' }}>{row.reason}</span></td>
                            <td>{statusBadge}</td>
                            <td><span className="text-muted" style={{ fontSize: '0.88rem' }}>{row.admin_comments || '—'}</span></td>
                            {isStaff && (
                              <td style={{ display: 'flex', gap: '6px', justifyContent: 'center' }}>
                                {row.status === 'Pending' ? (
                                  <>
                                    <button 
                                      className="btn btn-sm btn-success" 
                                      title="Approve"
                                      disabled={reviewLeaveMutation.isPending}
                                      onClick={() => reviewLeaveMutation.mutate({ id: row.id, action: 'approve' })}
                                    >
                                      <Check size={12} />
                                    </button>
                                    <button 
                                      className="btn btn-sm btn-danger" 
                                      title="Reject"
                                      disabled={reviewLeaveMutation.isPending}
                                      onClick={() => handleRejectClick(row.id)}
                                    >
                                      <X size={12} />
                                    </button>
                                  </>
                                ) : (
                                  <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Reviewed</span>
                                )}
                              </td>
                            )}
                          </tr>
                        );
                      })
                    ) : (
                      <tr>
                        <td colSpan={isStaff ? 6 : 5} style={{ textAlign: 'center', padding: '20px', color: 'var(--text-muted)' }}>
                          No leave applications found.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
