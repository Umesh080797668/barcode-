'use client';

import { useState, useEffect, useCallback } from 'react';
import AppShell from '../../components/AppShell';
import {
  getUsers,
  createUser,
  updateUser,
  resetUserPassword,
  deactivateUser,
} from '@/lib/api';

export default function UsersManagementPage() {
  const [users, setUsers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  // Create User Modal
  const [createModal, setCreateModal] = useState(false);
  const [username, setUsername] = useState('');
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<'cashier' | 'owner'>('cashier');
  const [creating, setCreating] = useState(false);

  // Reset Password Modal
  const [resetModalUser, setResetModalUser] = useState<any | null>(null);
  const [newPassword, setNewPassword] = useState('');
  const [resetting, setResetting] = useState(false);

  // Edit User Modal
  const [editModalUser, setEditModalUser] = useState<any | null>(null);
  const [editName, setEditName] = useState('');
  const [editRole, setEditRole] = useState<'cashier' | 'owner'>('cashier');
  const [editActive, setEditActive] = useState(true);
  const [editing, setEditing] = useState(false);

  const showStatus = (msg: string, isErr = false) => {
    if (isErr) {
      setError(msg);
      setSuccessMsg('');
    } else {
      setSuccessMsg(msg);
      setError('');
    }
    setTimeout(() => {
      setError('');
      setSuccessMsg('');
    }, 4000);
  };

  const loadUsers = useCallback(async () => {
    setLoading(true);
    try {
      const data = await getUsers();
      setUsers(Array.isArray(data) ? data : []);
      setError('');
    } catch (err: any) {
      setError(err.message || 'Failed to load users');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadUsers();
  }, [loadUsers]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!username.trim() || !password.trim()) {
      showStatus('Username and password are required', true);
      return;
    }
    setCreating(true);
    try {
      await createUser({
        username: username.trim().toLowerCase(),
        display_name: name.trim() || username.trim(),
        name: name.trim() || username.trim(),
        password,
        role,
      });
      showStatus(`User "${username}" created successfully!`);
      setCreateModal(false);
      setUsername('');
      setName('');
      setPassword('');
      setRole('cashier');
      await loadUsers();
    } catch (err: any) {
      showStatus(err.message || 'Failed to create user', true);
    } finally {
      setCreating(false);
    }
  };

  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!resetModalUser) return;
    if (newPassword.length < 8) {
      showStatus('Password must be at least 8 characters', true);
      return;
    }
    setResetting(true);
    try {
      await resetUserPassword(resetModalUser._id || resetModalUser.id, newPassword);
      showStatus(`Password reset for ${resetModalUser.username}`);
      setResetModalUser(null);
      setNewPassword('');
    } catch (err: any) {
      showStatus(err.message || 'Password reset failed', true);
    } finally {
      setResetting(false);
    }
  };

  const handleUpdateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editModalUser) return;
    setEditing(true);
    try {
      await updateUser(editModalUser._id || editModalUser.id, {
        display_name: editName.trim(),
        name: editName.trim(),
        role: editRole,
        active: editActive,
      });
      showStatus(`User ${editModalUser.username} updated!`);
      setEditModalUser(null);
      await loadUsers();
    } catch (err: any) {
      showStatus(err.message || 'Failed to update user', true);
    } finally {
      setEditing(false);
    }
  };

  const handleToggleDeactivate = async (u: any) => {
    const id = u._id || u.id;
    const isDeactivating = u.active !== false;
    const msg = isDeactivating
      ? `Deactivate account for "${u.username}"? They won't be able to sign in.`
      : `Re-activate account for "${u.username}"?`;
    if (!window.confirm(msg)) return;

    try {
      if (isDeactivating) {
        await deactivateUser(id);
      } else {
        await updateUser(id, { active: true });
      }
      showStatus(`User ${u.username} ${isDeactivating ? 'deactivated' : 'activated'}.`);
      await loadUsers();
    } catch (err: any) {
      showStatus(err.message || 'Action failed', true);
    }
  };

  return (
    <AppShell>
      <div className="max-w-6xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex justify-between items-center flex-wrap gap-4">
          <div>
            <h1 className="text-2xl font-bold text-white tracking-tight">User Management</h1>
            <p className="text-sm text-gray-400">Manage cashier and owner logins with role-based access</p>
          </div>
          <button
            onClick={() => setCreateModal(true)}
            className="sv-btn sv-btn-primary text-xs"
          >
            + Add New User
          </button>
        </div>

        {/* Notifications */}
        {error && (
          <div className="p-3 bg-red-950/60 border border-red-800 text-red-300 rounded-lg text-sm animate-fadeIn">
            {error}
          </div>
        )}
        {successMsg && (
          <div className="p-3 bg-green-950/60 border border-green-800 text-green-300 rounded-lg text-sm animate-fadeIn">
            {successMsg}
          </div>
        )}

        {/* Users Table */}
        <div className="sv-card">
          <div className="flex justify-between items-center mb-4">
            <h2 className="text-base font-semibold text-white">Registered Users</h2>
            <span className="text-xs text-gray-400">{users.length} accounts</span>
          </div>

          {loading ? (
            <div className="text-center py-12 text-gray-500 text-sm">Loading users…</div>
          ) : users.length === 0 ? (
            <div className="text-center py-12 text-gray-500 text-sm">No users found.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="sv-table text-xs">
                <thead>
                  <tr>
                    <th>User</th>
                    <th>Role</th>
                    <th>Status</th>
                    <th>Created</th>
                    <th className="text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {users.map((u: any) => {
                    const id = u._id || u.id;
                    const isActive = u.active !== false;
                    const isOwner = u.role === 'owner';

                    return (
                      <tr key={id} className="hover:bg-gray-800/40 transition-colors">
                        <td>
                          <div className="font-semibold text-white">{u.name || u.username}</div>
                          <div className="text-[11px] font-mono text-gray-400">@{u.username}</div>
                        </td>
                        <td>
                          <span className={`sv-badge ${isOwner ? 'sv-badge-purple' : 'sv-badge-blue'}`}>
                            {u.role}
                          </span>
                        </td>
                        <td>
                          <span className={`sv-badge ${isActive ? 'sv-badge-green' : 'sv-badge-red'}`}>
                            {isActive ? 'Active' : 'Deactivated'}
                          </span>
                        </td>
                        <td className="text-gray-400 whitespace-nowrap">
                          {u.created_at ? new Date(u.created_at).toLocaleDateString() : '—'}
                        </td>
                        <td className="text-right whitespace-nowrap space-x-2">
                          <button
                            onClick={() => {
                              setEditModalUser(u);
                              setEditName(u.name || '');
                              setEditRole(u.role || 'cashier');
                              setEditActive(u.active !== false);
                            }}
                            className="sv-btn sv-btn-ghost py-1 px-2.5 text-[11px]"
                          >
                            Edit
                          </button>
                          <button
                            onClick={() => {
                              setResetModalUser(u);
                              setNewPassword('');
                            }}
                            className="sv-btn sv-btn-ghost py-1 px-2.5 text-[11px]"
                          >
                            Reset Password
                          </button>
                          <button
                            onClick={() => handleToggleDeactivate(u)}
                            className={`py-1 px-2.5 text-[11px] rounded font-medium transition-colors ${isActive ? 'text-red-400 hover:bg-red-950/40' : 'text-green-400 hover:bg-green-950/40'}`}
                          >
                            {isActive ? 'Deactivate' : 'Activate'}
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* ── CREATE USER MODAL ────────────────────────────────────── */}
        {createModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm animate-fadeIn">
            <div className="sv-card max-w-md w-full shadow-2xl space-y-4">
              <div className="flex justify-between items-center border-b border-gray-800 pb-3">
                <h3 className="text-base font-semibold text-white">Create New User</h3>
                <button onClick={() => setCreateModal(false)} className="text-gray-400 hover:text-white">✕</button>
              </div>

              <form onSubmit={handleCreate} className="space-y-4">
                <div>
                  <label className="sv-label">Username *</label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. cashier1"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    className="sv-input font-mono"
                    autoFocus
                  />
                </div>

                <div>
                  <label className="sv-label">Full Name</label>
                  <input
                    type="text"
                    placeholder="e.g. Jane Doe"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    className="sv-input"
                  />
                </div>

                <div>
                  <label className="sv-label">Initial Password * (min 8 chars)</label>
                  <input
                    type="password"
                    required
                    minLength={8}
                    placeholder="••••••••"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="sv-input"
                  />
                </div>

                <div>
                  <label className="sv-label">Role</label>
                  <select
                    value={role}
                    onChange={(e) => setRole(e.target.value as any)}
                    className="sv-input"
                  >
                    <option value="cashier">Cashier (POS & Invoices)</option>
                    <option value="owner">Owner (Full Admin Access)</option>
                  </select>
                </div>

                <div className="flex justify-end gap-2 pt-2 border-t border-gray-800">
                  <button
                    type="button"
                    onClick={() => setCreateModal(false)}
                    className="sv-btn sv-btn-ghost text-xs"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={creating}
                    className="sv-btn sv-btn-primary text-xs"
                  >
                    {creating ? 'Creating…' : 'Create User'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* ── RESET PASSWORD MODAL ─────────────────────────────────── */}
        {resetModalUser && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm animate-fadeIn">
            <div className="sv-card max-w-sm w-full shadow-2xl space-y-4">
              <div className="flex justify-between items-center border-b border-gray-800 pb-3">
                <h3 className="text-base font-semibold text-white">Reset Password</h3>
                <button onClick={() => setResetModalUser(null)} className="text-gray-400 hover:text-white">✕</button>
              </div>

              <p className="text-xs text-gray-400">
                Set a new password for <span className="text-white font-medium">@{resetModalUser.username}</span>:
              </p>

              <form onSubmit={handleResetPassword} className="space-y-4">
                <div>
                  <label className="sv-label">New Password (min 8 chars) *</label>
                  <input
                    type="password"
                    required
                    minLength={8}
                    placeholder="••••••••"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    className="sv-input"
                    autoFocus
                  />
                </div>

                <div className="flex justify-end gap-2 pt-2">
                  <button
                    type="button"
                    onClick={() => setResetModalUser(null)}
                    className="sv-btn sv-btn-ghost text-xs"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={resetting}
                    className="sv-btn sv-btn-primary text-xs"
                  >
                    {resetting ? 'Updating…' : 'Update Password'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* ── EDIT USER MODAL ──────────────────────────────────────── */}
        {editModalUser && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm animate-fadeIn">
            <div className="sv-card max-w-sm w-full shadow-2xl space-y-4">
              <div className="flex justify-between items-center border-b border-gray-800 pb-3">
                <h3 className="text-base font-semibold text-white">Edit User</h3>
                <button onClick={() => setEditModalUser(null)} className="text-gray-400 hover:text-white">✕</button>
              </div>

              <form onSubmit={handleUpdateUser} className="space-y-4">
                <div>
                  <label className="sv-label">Full Name</label>
                  <input
                    type="text"
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    className="sv-input"
                  />
                </div>

                <div>
                  <label className="sv-label">Role</label>
                  <select
                    value={editRole}
                    onChange={(e) => setEditRole(e.target.value as any)}
                    className="sv-input"
                  >
                    <option value="cashier">Cashier</option>
                    <option value="owner">Owner</option>
                  </select>
                </div>

                <div className="flex items-center gap-2 pt-1">
                  <input
                    type="checkbox"
                    id="editActive"
                    checked={editActive}
                    onChange={(e) => setEditActive(e.target.checked)}
                    className="rounded text-indigo-600 focus:ring-indigo-500"
                  />
                  <label htmlFor="editActive" className="text-xs text-gray-300 cursor-pointer">
                    Account is active and allowed to login
                  </label>
                </div>

                <div className="flex justify-end gap-2 pt-2 border-t border-gray-800">
                  <button
                    type="button"
                    onClick={() => setEditModalUser(null)}
                    className="sv-btn sv-btn-ghost text-xs"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={editing}
                    className="sv-btn sv-btn-primary text-xs"
                  >
                    {editing ? 'Saving…' : 'Save Changes'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}
      </div>
    </AppShell>
  );
}
