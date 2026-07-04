import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Loader2, AlertCircle, Trash2, Plus } from 'lucide-react';

interface UserMeta {
  id: string;
  email: string;
  role: string;
  full_name: string;
}

interface ProjectsViewProps {
  user: UserMeta;
  token: string;
  showToast: (msg: string, type: 'success' | 'error' | 'info') => void;
}

export const ProjectsView: React.FC<ProjectsViewProps> = ({ user, token, showToast }) => {
  const queryClient = useQueryClient();
  const [showCreateModal, setShowCreateModal] = useState(false);

  // Form states
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [assignedTo, setAssignedTo] = useState('');
  const [deadline, setDeadline] = useState('');
  const [startDate, setStartDate] = useState('');
  const [priority, setPriority] = useState('Medium');

  const canManage = user.role === 'Admin' || user.role === 'HR';

  // ── Queries ──

  const { data: projects = [], isLoading: isLoadingProjects, error: projectsError } = useQuery({
    queryKey: ['projectsList', token],
    queryFn: async () => {
      const res = await fetch('/api/projects', {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (!res.ok) throw new Error("Failed to load projects.");
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
    enabled: canManage
  });

  // ── Mutations ──

  const createProjectMutation = useMutation({
    mutationFn: async (payload: any) => {
      const res = await fetch('/api/projects', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify(payload)
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || "Failed to create project.");
      return data;
    },
    onSuccess: () => {
      showToast("Project created and assigned successfully!", "success");
      setShowCreateModal(false);
      setTitle('');
      setDescription('');
      setAssignedTo('');
      setDeadline('');
      setStartDate('');
      setPriority('Medium');
      queryClient.invalidateQueries({ queryKey: ['projectsList'] });
    },
    onError: (err: any) => {
      showToast(err.message, 'error');
    }
  });

  const updateStatusMutation = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: string }) => {
      const res = await fetch(`/api/projects/${id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ status })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || "Failed to update project status.");
      return data;
    },
    onSuccess: () => {
      showToast("Project status updated!", "success");
      queryClient.invalidateQueries({ queryKey: ['projectsList'] });
    },
    onError: (err: any) => {
      showToast(err.message, 'error');
    }
  });

  const reviewProjectMutation = useMutation({
    mutationFn: async ({ id, action, admin_comments }: { id: string; action: 'Approve' | 'Request Changes'; admin_comments?: string }) => {
      const res = await fetch(`/api/projects/${id}/review`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ action, admin_comments })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || "Review action failed.");
      return data;
    },
    onSuccess: (_, variables) => {
      showToast(`Project review successfully completed: ${variables.action}`, "success");
      queryClient.invalidateQueries({ queryKey: ['projectsList'] });
    },
    onError: (err: any) => {
      showToast(err.message, 'error');
    }
  });

  const deleteProjectMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/projects/${id}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.detail || "Delete failed.");
      }
      return id;
    },
    onSuccess: () => {
      showToast("Project permanently deleted.", "success");
      queryClient.invalidateQueries({ queryKey: ['projectsList'] });
    },
    onError: (err: any) => {
      showToast(err.message, 'error');
    }
  });

  // ── Actions Handlers ──

  const handleCreateSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    createProjectMutation.mutate({
      title,
      description,
      assigned_to: assignedTo || null,
      deadline: deadline || null,
      start_date: startDate || null,
      priority
    });
  };

  const handleRequestChanges = (id: string) => {
    const comments = prompt("Enter modifications requested:");
    if (comments === null) return;
    reviewProjectMutation.mutate({ id, action: 'Request Changes', admin_comments: comments });
  };

  return (
    <div>
      <div className="card glass">
        <div className="card-header flex-between">
          <h3>Active Projects Board</h3>
          {canManage && (
            <button className="btn btn-sm btn-primary" onClick={() => setShowCreateModal(true)}>
              <Plus size={14} /> New Project
            </button>
          )}
        </div>
        <div className="card-body">
          {isLoadingProjects ? (
            <div style={{ textAlign: 'center', padding: '20px' }}><Loader2 className="spinner" size={24} /></div>
          ) : projectsError ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--danger)', background: 'rgba(239,68,68,0.1)', padding: '12px', borderRadius: '8px' }}>
              <AlertCircle size={18} />
              <span>{(projectsError as any).message}</span>
            </div>
          ) : (
            <div className="projects-grid-list">
              {projects.length > 0 ? (
                projects.map((proj: any) => {
                  const assigneeName = proj.assigned_to ? proj.assigned_to.full_name : "Unassigned";
                  const creatorName = proj.created_by ? proj.created_by.full_name : "Admin";

                  let statusClass = "badge-warning";
                  if (proj.status === "Completed") statusClass = "badge-success";
                  if (proj.status === "In Review") statusClass = "badge-purple";
                  if (proj.status === "Not Started") statusClass = "badge-danger";

                  return (
                    <div className="project-card" key={proj.id}>
                      <div className="project-card-header">
                        <span className="project-title">{proj.title}</span>
                        <span className={`badge ${statusClass}`}>{proj.status}</span>
                      </div>
                      <p className="project-desc">{proj.description || 'No description provided.'}</p>
                      
                      <div className="project-meta-row">
                        <span><i className="fa-regular fa-user"></i> {assigneeName}</span>
                        <span><i className="fa-solid fa-flag"></i> {proj.priority}</span>
                      </div>
                      <div className="project-meta-row" style={{ marginTop: '6px' }}>
                        <span><i className="fa-regular fa-calendar"></i> Period: {proj.start_date || 'N/A'} to {proj.deadline || 'N/A'}</span>
                        <span>By: {creatorName}</span>
                      </div>

                      {/* Row-Based Operations Gated via Role */}
                      {canManage ? (
                        proj.status === 'In Review' ? (
                          <div style={{ display: 'flex', gap: '8px', marginTop: '14px' }}>
                            <button 
                              className="btn btn-sm btn-success" 
                              onClick={() => reviewProjectMutation.mutate({ id: proj.id, action: 'Approve' })}
                            >
                              Approve
                            </button>
                            <button 
                              className="btn btn-sm btn-danger" 
                              onClick={() => handleRequestChanges(proj.id)}
                            >
                              Fixes
                            </button>
                          </div>
                        ) : (
                          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '14px' }}>
                            <button 
                              className="btn btn-sm btn-danger" 
                              onClick={() => deleteProjectMutation.mutate(proj.id)}
                            >
                              <Trash2 size={12} /> Delete
                            </button>
                          </div>
                        )
                      ) : (
                        <div style={{ marginTop: '14px' }}>
                          <select 
                            className="project-status-select" 
                            value={proj.status}
                            onChange={e => updateStatusMutation.mutate({ id: proj.id, status: e.target.value })}
                          >
                            <option value="Not Started">Not Started</option>
                            <option value="In Progress">In Progress</option>
                            <option value="In Review">Ready for Review</option>
                          </select>
                        </div>
                      )}
                    </div>
                  );
                })
              ) : (
                <p className="text-center text-muted" style={{ gridColumn: '1/-1', padding: '20px' }}>
                  No assigned projects found.
                </p>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Modal: Create Project (Admin Only) */}
      {showCreateModal && (
        <div className="modal open">
          <div className="modal-content glass">
            <div className="modal-header">
              <h3>Create New Project</h3>
              <span className="close-btn" onClick={() => setShowCreateModal(false)}>&times;</span>
            </div>
            <form onSubmit={handleCreateSubmit}>
              <div className="form-group">
                <label>Project Name</label>
                <input 
                  type="text" 
                  value={title} 
                  onChange={e => setTitle(e.target.value)} 
                  placeholder="HRMS Dashboard v2" 
                  required 
                />
              </div>
              <div className="form-group">
                <label>Description</label>
                <textarea 
                  value={description} 
                  onChange={e => setDescription(e.target.value)} 
                  rows={3} 
                  placeholder="Define scopes..." 
                  style={{ width: '100%', background: 'rgba(15, 23, 42, 0.6)', border: '1px solid var(--border-light)', color: '#fff', borderRadius: '12px', padding: '10px', fontSize: '0.9rem', outline: 'none' }}
                />
              </div>
              <div className="form-group">
                <label>Assign Employee</label>
                <select value={assignedTo} onChange={e => setAssignedTo(e.target.value)} required>
                  <option value="">-- Select Employee --</option>
                  {employees.map((emp: any) => (
                    <option key={emp.user_id} value={emp.user_id}>{emp.full_name}</option>
                  ))}
                </select>
              </div>
              <div className="form-row" style={{ display: 'flex', gap: '16px', marginBottom: '16px' }}>
                <div className="form-group" style={{ flex: 1, marginBottom: '0' }}>
                  <label>Start Date</label>
                  <input 
                    type="date" 
                    value={startDate} 
                    onChange={e => setStartDate(e.target.value)} 
                    required 
                  />
                </div>
                <div className="form-group" style={{ flex: 1, marginBottom: '0' }}>
                  <label>Deadline Date</label>
                  <input 
                    type="date" 
                    value={deadline} 
                    onChange={e => setDeadline(e.target.value)} 
                    required 
                  />
                </div>
              </div>
              <div className="form-group">
                <label>Priority Level</label>
                <select value={priority} onChange={e => setPriority(e.target.value)} required>
                  <option value="Low">Low</option>
                  <option value="Medium">Medium</option>
                  <option value="High">High</option>
                </select>
              </div>
              <button type="submit" disabled={createProjectMutation.isPending} className="btn btn-primary btn-block">
                {createProjectMutation.isPending ? "Creating..." : "Launch Project"}
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
