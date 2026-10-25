'use client';

import { useState, FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { login } from '@/lib/api';

export default function LoginPage() {
  const router = useRouter();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await login(username, password);
      router.push('/pos');
    } catch (err: any) {
      setError(err.message || 'Login failed');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-950 p-4">
      <div className="w-full max-w-sm animate-fadeIn">
        {/* Logo / Brand */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center mb-4">
            <img
              src="/oshini-logo.jpg"
              alt="Oshini Phone Store"
              className="w-20 h-20 rounded-2xl object-cover shadow-xl border border-gray-800"
            />
          </div>
          <h1 className="text-2xl font-bold text-white tracking-tight">Oshini Phone Store</h1>
          <p className="text-sm text-gray-400 mt-1">Smart Choice. Better Life</p>
        </div>

        {/* Card */}
        <div className="sv-card shadow-2xl shadow-black/50">
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label htmlFor="username" className="sv-label">Username</label>
              <input
                id="username"
                type="text"
                autoComplete="username"
                autoFocus
                required
                className="sv-input"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="owner / cashier"
              />
            </div>
            <div>
              <label htmlFor="password" className="sv-label">Password</label>
              <input
                id="password"
                type="password"
                autoComplete="current-password"
                required
                className="sv-input"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
              />
            </div>

            {error && (
              <p className="text-sm text-red-400 bg-red-950/50 border border-red-900 rounded-lg px-3 py-2">
                {error}
              </p>
            )}

            <button
              type="submit"
              disabled={loading}
              className="sv-btn sv-btn-primary w-full py-2.5"
            >
              {loading ? (
                <span className="flex items-center gap-2">
                  <svg className="w-4 h-4 animate-spin" viewBox="0 0 24 24" fill="none">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"/>
                  </svg>
                  Signing in…
                </span>
              ) : 'Sign In'}
            </button>
          </form>
        </div>

        <p className="text-center text-xs text-gray-600 mt-6">
          Oshini Phone Store · {new Date().getFullYear()}
        </p>
      </div>
    </div>
  );
}
