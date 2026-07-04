import React, { useState } from 'react';
import { 
  format, 
  startOfMonth, 
  endOfMonth, 
  eachDayOfInterval, 
  addMonths, 
  subMonths,
  getDay
} from 'date-fns';
import { Calendar, ChevronLeft, ChevronRight } from 'lucide-react';

interface AttendanceLog {
  date: string;
  status: 'Present' | 'Absent' | 'Half-day' | 'On Leave';
}

interface LeaveRequest {
  start_date: string;
  end_date: string;
  leave_type: string;
  status: 'Pending' | 'Approved' | 'Rejected';
}

interface ProjectDeadline {
  title: string;
  deadline: string; // YYYY-MM-DD
}

interface UnifiedCalendarProps {
  attendance: AttendanceLog[];
  leaves: LeaveRequest[];
  projects?: ProjectDeadline[];
}

export const UnifiedCalendar: React.FC<UnifiedCalendarProps> = ({ attendance, leaves, projects = [] }) => {
  const [currentMonth, setCurrentMonth] = useState(new Date());

  const monthStart = startOfMonth(currentMonth);
  const monthEnd = endOfMonth(currentMonth);
  const days = eachDayOfInterval({ start: monthStart, end: monthEnd });

  // Get the day index of the first day of the month to pad the grid correctly
  const startDayIndex = getDay(monthStart);

  const prevMonth = () => setCurrentMonth(subMonths(currentMonth, 1));
  const nextMonth = () => setCurrentMonth(addMonths(currentMonth, 1));

  // Helper to check if a date is within a leave range (Pending or Approved)
  const getLeavesForDate = (date: Date) => {
    return leaves.filter(lv => {
      if (lv.status === 'Rejected') return false;
      const start = new Date(lv.start_date);
      const end = new Date(lv.end_date);
      // Remove time component for accurate date comparison
      start.setHours(0,0,0,0);
      end.setHours(0,0,0,0);
      const target = new Date(date);
      target.setHours(0,0,0,0);
      return target >= start && target <= end;
    });
  };

  const getAttendanceForDate = (date: Date) => {
    const formattedStr = format(date, 'yyyy-MM-dd');
    return attendance.find(att => att.date === formattedStr);
  };

  const getProjectsForDate = (date: Date) => {
    const formattedStr = format(date, 'yyyy-MM-dd');
    return projects.filter(p => p.deadline === formattedStr);
  };

  return (
    <div className="card glass" style={{ padding: '20px' }}>
      <div className="card-header flex-between" style={{ borderBottom: 'none', marginBottom: '15px' }}>
        <h3 style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <Calendar size={18} style={{ color: 'var(--primary)' }} /> Unified Schedule Calendar
        </h3>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          <button className="btn btn-sm" style={{ background: 'rgba(255,255,255,0.05)', color: '#fff' }} onClick={prevMonth}>
            <ChevronLeft size={16} />
          </button>
          <span style={{ fontFamily: 'var(--font-title)', fontWeight: 600, minWidth: '110px', textAlign: 'center' }}>
            {format(currentMonth, 'MMMM yyyy')}
          </span>
          <button className="btn btn-sm" style={{ background: 'rgba(255,255,255,0.05)', color: '#fff' }} onClick={nextMonth}>
            <ChevronRight size={16} />
          </button>
        </div>
      </div>

      {/* Legend */}
      <div style={{ display: 'flex', gap: '16px', fontSize: '0.78rem', color: 'var(--text-muted)', marginBottom: '16px', flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <span style={{ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: 'var(--success)' }}></span> Present
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <span style={{ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: 'var(--danger)' }}></span> Absent
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <span style={{ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: 'var(--warning)' }}></span> Half-day
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <span style={{ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: 'var(--accent)' }}></span> Leave (Pending/Approved)
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <span style={{ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: '#e11d48', border: '1px solid #fda4af' }}></span> Project Deadline
        </div>
      </div>

      {/* Grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: '8px', textAlign: 'center' }}>
        {/* Days of Week */}
        {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(day => (
          <div key={day} style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-muted)', paddingBottom: '6px' }}>
            {day}
          </div>
        ))}

        {/* Empty padding cells */}
        {Array.from({ length: startDayIndex }).map((_, idx) => (
          <div key={`empty-${idx}`} style={{ height: '54px', background: 'rgba(255,255,255,0.01)', borderRadius: '6px' }}></div>
        ))}

        {/* Calendar Days */}
        {days.map(day => {
          const dateStr = format(day, 'd');
          const att = getAttendanceForDate(day);
          const activeLeaves = getLeavesForDate(day);
          const dayProjects = getProjectsForDate(day);

          // Determine dot color indicators
          const showPresent = att && att.status === 'Present';
          const showAbsent = att && att.status === 'Absent';
          const showHalf = att && att.status === 'Half-day';
          const showLeave = activeLeaves.length > 0;
          const showProject = dayProjects.length > 0;

          return (
            <div 
              key={day.toString()}
              style={{
                height: '54px',
                background: 'rgba(255,255,255,0.02)',
                border: '1px solid var(--border-light)',
                borderRadius: '8px',
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'space-between',
                padding: '6px',
                alignItems: 'center',
                position: 'relative'
              }}
            >
              <span style={{ fontSize: '0.85rem', fontWeight: 500, color: '#f8fafc' }}>
                {dateStr}
              </span>
              
              {/* Dot Indicators */}
              <div style={{ display: 'flex', gap: '3px', justifyContent: 'center', minHeight: '8px' }}>
                {showPresent && <span style={{ width: '6px', height: '6px', borderRadius: '50%', backgroundColor: 'var(--success)' }} title="Present"></span>}
                {showAbsent && <span style={{ width: '6px', height: '6px', borderRadius: '50%', backgroundColor: 'var(--danger)' }} title="Absent"></span>}
                {showHalf && <span style={{ width: '6px', height: '6px', borderRadius: '50%', backgroundColor: 'var(--warning)' }} title="Half-day"></span>}
                {showLeave && <span style={{ width: '6px', height: '6px', borderRadius: '50%', backgroundColor: 'var(--accent)' }} title={`Leave: ${activeLeaves[0].leave_type}`}></span>}
                {showProject && <span style={{ width: '6px', height: '6px', borderRadius: '50%', backgroundColor: '#e11d48' }} title={`Deadline: ${dayProjects[0].title}`}></span>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
