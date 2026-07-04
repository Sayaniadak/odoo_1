import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Loader2, AlertCircle, Plus, Download } from 'lucide-react';

interface UserMeta {
  id: string;
  email: string;
  role: string;
  full_name: string;
}

interface PayrollViewProps {
  user: UserMeta;
  token: string;
  showToast: (msg: string, type: 'success' | 'error' | 'info') => void;
}

export const PayrollView: React.FC<PayrollViewProps> = ({ user, token, showToast }) => {
  const queryClient = useQueryClient();
  const [showCreateModal, setShowCreateModal] = useState(false);

  // Form states
  const [targetUserId, setTargetUserId] = useState('');
  const [payMonth, setPayMonth] = useState('');
  const [baseSalary, setBaseSalary] = useState('');
  const [deductions, setDeductions] = useState('0');

  const isAdmin = user.role === 'Admin';

  // ── Queries ──

  const { data: payrollList = [], isLoading: isLoadingPayroll, error: payrollError } = useQuery({
    queryKey: ['payrollList', token],
    queryFn: async () => {
      const res = await fetch('/api/payroll', {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (!res.ok) throw new Error("Failed to load payroll records.");
      return res.json();
    }
  });

  const { data: employees = [] } = useQuery({
    queryKey: ['employees', token],
    queryFn: async () => {
      const res = await fetch('/api/profiles', {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (!res.ok) throw new Error("Failed to fetch employee profiles");
      return res.json();
    },
    enabled: isAdmin
  });

  // ── Mutations ──

  const processPayrollMutation = useMutation({
    mutationFn: async (payload: any) => {
      const res = await fetch('/api/payroll', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify(payload)
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || "Failed to process payroll.");
      return data;
    },
    onSuccess: () => {
      showToast("Payroll processed and issued successfully!", "success");
      setShowCreateModal(false);
      setTargetUserId('');
      setPayMonth('');
      setBaseSalary('');
      setDeductions('0');
      queryClient.invalidateQueries({ queryKey: ['payrollList'] });
    },
    onError: (err: any) => {
      showToast(err.message, 'error');
    }
  });

  // ── Action Handlers ──

  const handleCreateSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    processPayrollMutation.mutate({
      user_id: targetUserId,
      month: payMonth,
      base_salary: parseFloat(baseSalary),
      deductions: parseFloat(deductions)
    });
  };

  const handleDownloadPDF = async (id: string, month: number, year: number) => {
    showToast("Compiling payslip PDF...", "info");
    try {
      const res = await fetch(`/api/payroll/${id}/download`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.detail || "PDF compile failed.");
      }

      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `payslip_${year}_${month}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
      showToast("Payslip downloaded successfully!", "success");
    } catch (err: any) {
      showToast(err.message, "error");
    }
  };

  return (
    <div>
      <div className="card glass">
        <div className="card-header flex-between">
          <h3>Payslip Statements</h3>
          {isAdmin && (
            <button className="btn btn-sm btn-primary" onClick={() => setShowCreateModal(true)}>
              <Plus size={14} /> Process Payroll
            </button>
          )}
        </div>
        <div className="card-body">
          {isLoadingPayroll ? (
            <div style={{ textAlign: 'center', padding: '20px' }}><Loader2 className="spinner" size={24} /></div>
          ) : payrollError ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--danger)', background: 'rgba(239,68,68,0.1)', padding: '12px', borderRadius: '8px' }}>
              <AlertCircle size={18} />
              <span>{(payrollError as any).message}</span>
            </div>
          ) : (
            <div className="table-container">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Employee</th>
                    <th>Month / Period</th>
                    <th>Base Salary</th>
                    <th>Deductions</th>
                    <th>Net Take-Home</th>
                    <th>Status</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {payrollList.length > 0 ? (
                    payrollList.map((row: any) => {
                      const empName = row.profiles ? row.profiles.full_name : `User ${row.user_id.substring(0, 8)}`;
                      const period = `${row.year}-${String(row.month).padStart(2, '0')}`;

                      return (
                        <tr key={row.id}>
                          <td><b>{empName}</b></td>
                          <td>{period}</td>
                          <td>${row.base_salary.toLocaleString()}</td>
                          <td>-${row.deductions.toLocaleString()}</td>
                          <td><strong>${row.net_pay.toLocaleString()}</strong></td>
                          <td><span className="badge badge-success">Paid</span></td>
                          <td>
                            <button 
                              className="btn btn-sm btn-primary" 
                              onClick={() => handleDownloadPDF(row.id, row.month, row.year)}
                            >
                              <Download size={12} /> Payslip
                            </button>
                          </td>
                        </tr>
                      );
                    })
                  ) : (
                    <tr>
                      <td colSpan={7} style={{ textAlign: 'center', padding: '20px', color: 'var(--text-muted)' }}>
                        No compiled payroll statements.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* Modal: Process Payroll (Admin Only) */}
      {showCreateModal && (
        <div className="modal open">
          <div className="modal-content glass">
            <div className="modal-header">
              <h3>Issue Salary Statement</h3>
              <span className="close-btn" onClick={() => setShowCreateModal(false)}>&times;</span>
            </div>
            <form onSubmit={handleCreateSubmit}>
              <div className="form-group">
                <label>Select Employee</label>
                <select value={targetUserId} onChange={e => setTargetUserId(e.target.value)} required>
                  <option value="">-- Select Employee --</option>
                  {employees.map((emp: any) => (
                    <option key={emp.user_id} value={emp.user_id}>{emp.full_name}</option>
                  ))}
                </select>
              </div>
              <div className="form-group">
                <label>Statement Period (YYYY-MM)</label>
                <input 
                  type="month" 
                  value={payMonth} 
                  onChange={e => setPayMonth(e.target.value)} 
                  required 
                />
              </div>
              <div className="form-row">
                <div className="form-group col-6">
                  <label>Base Salary ($)</label>
                  <input 
                    type="number" 
                    value={baseSalary} 
                    onChange={e => setBaseSalary(e.target.value)} 
                    step="0.01" 
                    min="0" 
                    placeholder="5000.00" 
                    required 
                  />
                </div>
                <div className="form-group col-6">
                  <label>Total Deductions ($)</label>
                  <input 
                    type="number" 
                    value={deductions} 
                    onChange={e => setDeductions(e.target.value)} 
                    step="0.01" 
                    min="0" 
                    placeholder="200.00" 
                    required 
                  />
                </div>
              </div>
              <button type="submit" disabled={processPayrollMutation.isPending} className="btn btn-primary btn-block">
                {processPayrollMutation.isPending ? "Issuing..." : "Confirm & Issue Salary"}
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
