import React, { useEffect, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Clock, Filter, ArrowRight, ArrowLeft, Loader2, AlertCircle, ChevronLeft, ChevronRight } from 'lucide-react';
import { format, startOfWeek, eachDayOfInterval, addDays } from 'date-fns';

interface UserMeta {
  id: string;
  email: string;
  role: string;
  full_name: string;
}

interface AttendanceViewProps {
  user: UserMeta;
  token: string;
  showToast: (msg: string, type: 'success' | 'error' | 'info') => void;
}

export const AttendanceView: React.FC<AttendanceViewProps> = ({ user, token, showToast }) => {
  const queryClient = useQueryClient();
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [userIdFilter, setUserIdFilter] = useState('');
  const [dateFormat, setDateFormat] = useState<'iso' | 'local'>('iso');

  const shiftWeek = (direction: 'prev' | 'next') => {
    const amount = direction === 'prev' ? -7 : 7;
    const today = new Date();
    const from = fromDate ? new Date(fromDate) : today;
    const to = toDate ? new Date(toDate) : today;
    from.setDate(from.getDate() + amount);
    to.setDate(to.getDate() + amount);
    setFromDate(from.toLocaleDateString('en-CA'));
    setToDate(to.toLocaleDateString('en-CA'));
  };

  const getFormattedDate = (dateStr: string) => {
    if (dateFormat === 'iso') return dateStr;
    try {
      const parts = dateStr.split('-');
      const d = new Date(parseInt(parts[0]), parseInt(parts[1]) - 1, parseInt(parts[2]));
      return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
    } catch {
      return dateStr;
    }
  };
  
  // Timer state for clocked-in session
  const [elapsedTime, setElapsedTime] = useState('00:00:00');

  const isStaff = user.role === 'Admin' || user.role === 'HR';

  // ── Queries ──

  // Fetch all employees (HR/Admin only)
  const { data: employees = [] } = useQuery({
    queryKey: ['employees', token],
    queryFn: async () => {
      const res = await fetch('/api/profiles', {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (!res.ok) throw new Error("Failed to fetch employee profiles");
      return res.json();
    },
    enabled: isStaff
  });

  // Fetch today's clock status (Employee only)
  const { data: todayRecords = [], isLoading: isLoadingToday, error: todayError } = useQuery({
    queryKey: ['attendanceToday', token],
    queryFn: async () => {
      const res = await fetch('/api/attendance/me?limit=1', {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (!res.ok) throw new Error("Failed to fetch today's attendance status.");
      return res.json();
    },
    enabled: !isStaff
  });

  // Fetch full attendance logs
  const { data: logs = [], isLoading: isLoadingLogs, error: logsError, refetch: refetchLogs } = useQuery({
    queryKey: ['attendanceLogs', token, fromDate, toDate, userIdFilter],
    queryFn: async () => {
      let endpoint = isStaff ? '/api/attendance?limit=100' : '/api/attendance/me?limit=50';
      const params: string[] = [];
      if (fromDate) params.push(`from_date=${fromDate}`);
      if (toDate) params.push(`to_date=${toDate}`);
      if (isStaff && userIdFilter) params.push(`user_id=${userIdFilter}`);
      
      if (params.length > 0) {
        endpoint += (endpoint.includes('?') ? '&' : '?') + params.join('&');
      }

      const res = await fetch(endpoint, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (!res.ok) throw new Error("Failed to load timesheet history.");
      return res.json();
    }
  });

  // ── Live Running Timer ──
  const todayRecord = !isStaff && todayRecords.length > 0 && todayRecords[0].date === new Date().toLocaleDateString('en-CA') 
    ? todayRecords[0] 
    : null;

  useEffect(() => {
    let interval: any;

    if (todayRecord?.check_in && !todayRecord?.check_out) {
      const checkInTime = new Date(todayRecord.check_in).getTime();

      const updateTimer = () => {
        const now = new Date().getTime();
        const diff = now - checkInTime;

        if (diff > 0) {
          const hours = String(Math.floor(diff / 3600000)).padStart(2, '0');
          const minutes = String(Math.floor((diff % 3600000) / 60000)).padStart(2, '0');
          const seconds = String(Math.floor((diff % 60000) / 1000)).padStart(2, '0');
          setElapsedTime(`${hours}:${minutes}:${seconds}`);
        } else {
          setElapsedTime('00:00:00');
        }
      };

      updateTimer();
      interval = setInterval(updateTimer, 1000);
    } else {
      setElapsedTime('00:00:00');
    }

    return () => clearInterval(interval);
  }, [todayRecord]);

  // ── Mutations ──

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
    onSuccess: (data) => {
      showToast(data.message, 'success');
      queryClient.invalidateQueries({ queryKey: ['attendanceToday'] });
      queryClient.invalidateQueries({ queryKey: ['attendanceLogs'] });
    },
    onError: (err: any) => {
      showToast(err.message, 'error');
    }
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
    onSuccess: (data) => {
      showToast(data.message, 'success');
      queryClient.invalidateQueries({ queryKey: ['attendanceToday'] });
      queryClient.invalidateQueries({ queryKey: ['attendanceLogs'] });
    },
    onError: (err: any) => {
      showToast(err.message, 'error');
    }
  });

  // ── Weekly History Grid ──
  const startOfCurrentWeek = startOfWeek(new Date(), { weekStartsOn: 1 });
  const weeklyDays = eachDayOfInterval({
    start: startOfCurrentWeek,
    end: addDays(startOfCurrentWeek, 6)
  });

  const getWeeklyStatus = (day: Date) => {
    const formatted = format(day, 'yyyy-MM-dd');
    const match = logs.find((l: any) => l.date === formatted);
    if (!match) return 'Empty';
    return match.status; // Present, Absent, Half-day, On Leave
  };

  return (
    <div>
      {/* Clock Widget for Employees */}
      {!isStaff && (
        <div className="card glass" style={{ marginBottom: '24px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '20px 24px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
            <Clock size={28} style={{ color: 'var(--primary)' }} />
            <div>
              <h4 style={{ fontSize: '1.1rem' }}>Timesheet Clock</h4>
              {todayRecord?.check_in && !todayRecord?.check_out && (
                <div style={{ fontSize: '1.4rem', fontFamily: 'var(--font-title)', color: 'var(--primary)', fontWeight: 700, marginTop: '2px' }}>
                  Active Shift: {elapsedTime}
                </div>
              )}
              <p className="text-muted" style={{ fontSize: '0.85rem', marginTop: '2px' }}>
                {todayRecord?.check_out ? 'Shift completed today.' : (todayRecord?.check_in ? 'Clocked in.' : 'You are currently off-duty.')}
              </p>
            </div>
          </div>
          
          {isLoadingToday ? (
            <Loader2 className="spinner" size={20} />
          ) : todayError ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: 'var(--danger)', fontSize: '0.85rem' }}>
              <AlertCircle size={16} /> Error loading widget.
            </div>
          ) : (
            <div style={{ display: 'flex', gap: '12px' }}>
              {!todayRecord?.check_in && (
                <button 
                  className="btn btn-sm btn-success" 
                  disabled={checkInMutation.isPending}
                  onClick={() => checkInMutation.mutate()}
                >
                  {checkInMutation.isPending ? "Checking in..." : <><ArrowRight size={14} /> Clock In</>}
                </button>
              )}
              {todayRecord?.check_in && !todayRecord?.check_out && (
                <button 
                  className="btn btn-sm btn-danger" 
                  disabled={checkOutMutation.isPending}
                  onClick={() => checkOutMutation.mutate()}
                >
                  {checkOutMutation.isPending ? "Checking out..." : <><ArrowLeft size={14} /> Clock Out</>}
                </button>
              )}
              {todayRecord?.check_out && (
                <span className="badge badge-success">Completed today</span>
              )}
            </div>
          )}
        </div>
      )}

      {/* Weekly History Grid (Visual Block Grid) */}
      {!isStaff && (
        <div className="card glass" style={{ marginBottom: '24px', padding: '20px' }}>
          <h4 style={{ fontSize: '0.98rem', marginBottom: '14px', fontWeight: 600 }}>Weekly Attendance Grid</h4>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: '10px' }}>
            {weeklyDays.map(day => {
              const statusVal = getWeeklyStatus(day);
              let color = 'rgba(255,255,255,0.03)';
              let border = '1px solid var(--border-light)';
              if (statusVal === 'Present') color = 'rgba(16, 185, 129, 0.2)';
              if (statusVal === 'Absent') color = 'rgba(239, 68, 68, 0.2)';
              if (statusVal === 'Half-day') color = 'rgba(245, 158, 11, 0.2)';
              if (statusVal === 'On Leave') color = 'rgba(139, 92, 246, 0.2)';

              return (
                <div 
                  key={day.toString()} 
                  style={{
                    background: color,
                    border: border,
                    borderRadius: '8px',
                    padding: '12px 6px',
                    textAlign: 'center',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    gap: '4px'
                  }}
                >
                  <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', fontWeight: 600 }}>
                    {format(day, 'EEE')}
                  </span>
                  <span style={{ fontSize: '0.95rem', fontWeight: 700 }}>
                    {format(day, 'd')}
                  </span>
                  <span style={{ fontSize: '0.62rem', color: statusVal === 'Empty' ? 'var(--text-muted)' : '#fff', fontWeight: 600 }}>
                    {statusVal === 'Empty' ? '—' : statusVal}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Full History logs */}
      <div className="card glass">
        <div className="card-header flex-between">
          <h3>Timesheets & Activity Logs</h3>
          <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
            {/* Week shift buttons */}
            <button className="btn btn-sm" style={{ background: 'rgba(255,255,255,0.05)', color: '#fff', padding: '6px 8px' }} onClick={() => shiftWeek('prev')} title="Previous Week">
              <ChevronLeft size={14} />
            </button>
            <button className="btn btn-sm" style={{ background: 'rgba(255,255,255,0.05)', color: '#fff', padding: '6px 8px' }} onClick={() => shiftWeek('next')} title="Next Week">
              <ChevronRight size={14} />
            </button>

            {/* Date format toggle */}
            <button 
              className="btn btn-sm" 
              style={{ background: 'rgba(255,255,255,0.05)', color: '#fff', fontSize: '0.78rem', padding: '6px 12px' }} 
              onClick={() => setDateFormat(dateFormat === 'iso' ? 'local' : 'iso')}
            >
              Format: {dateFormat.toUpperCase()}
            </button>

            {isStaff && (
              <select 
                value={userIdFilter} 
                onChange={e => setUserIdFilter(e.target.value)}
                style={{ background: 'rgba(15,23,42,0.4)', border: '1px solid var(--border-light)', color: '#fff', padding: '6px 12px', borderRadius: '8px', fontSize: '0.85rem', outline: 'none' }}
              >
                <option value="">All Employees</option>
                {employees.map((emp: any) => (
                  <option key={emp.user_id} value={emp.user_id}>{emp.full_name}</option>
                ))}
              </select>
            )}
            <input 
              type="date" 
              value={fromDate} 
              onChange={e => setFromDate(e.target.value)} 
              style={{ background: 'rgba(15,23,42,0.4)', border: '1px solid var(--border-light)', color: '#fff', padding: '6px 12px', borderRadius: '8px', fontSize: '0.85rem', outline: 'none' }}
            />
            <input 
              type="date" 
              value={toDate} 
              onChange={e => setToDate(e.target.value)} 
              style={{ background: 'rgba(15,23,42,0.4)', border: '1px solid var(--border-light)', color: '#fff', padding: '6px 12px', borderRadius: '8px', fontSize: '0.85rem', outline: 'none' }}
            />
            <button className="btn btn-sm btn-primary" onClick={() => refetchLogs()}>
              <Filter size={14} /> Filter
            </button>
          </div>
        </div>
        <div className="card-body">
          {isLoadingLogs ? (
            <div style={{ textAlign: 'center', padding: '20px' }}><Loader2 className="spinner" size={24} /></div>
          ) : logsError ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--danger)', background: 'rgba(239,68,68,0.1)', padding: '12px', borderRadius: '8px' }}>
              <AlertCircle size={18} />
              <span>{(logsError as any).message}</span>
            </div>
          ) : (
            <div className="table-container">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Employee</th>
                    <th>Check In</th>
                    <th>Check Out</th>
                    <th>Work Hours</th>
                    <th>Extra Hours</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {logs.length > 0 ? (
                    logs.map((row: any) => {
                      const clockIn = row.check_in ? new Date(row.check_in).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : "—";
                      const clockOut = row.check_out ? new Date(row.check_out).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : "—";
                      const empName = row.profiles ? row.profiles.full_name : user.full_name;
                      const formattedDate = getFormattedDate(row.date);
                      
                      const extraHours = row.hours !== null && row.hours > 8 
                        ? `${(row.hours - 8).toFixed(2)} hrs` 
                        : "—";

                      let statusBadge = <span className="badge badge-success">Present</span>;
                      if (row.status === "Absent") statusBadge = <span className="badge badge-danger">Absent</span>;
                      if (row.status === "Half-day") statusBadge = <span className="badge badge-warning">Half-day</span>;
                      if (row.status === "On Leave") statusBadge = <span className="badge badge-purple">On Leave</span>;

                      return (
                        <tr key={row.id}>
                          <td>
                            <strong>{empName}</strong>
                            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '2px' }}>{formattedDate}</div>
                          </td>
                          <td>{clockIn}</td>
                          <td>{clockOut}</td>
                          <td>{row.hours !== null ? `${row.hours} hrs` : "—"}</td>
                          <td>{extraHours}</td>
                          <td>{statusBadge}</td>
                        </tr>
                      );
                    })
                  ) : (
                    <tr>
                      <td colSpan={6} style={{ textAlign: 'center', padding: '20px', color: 'var(--text-muted)' }}>
                        No attendance logs found.
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
  );
};
