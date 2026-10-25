'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { getUser, logout } from '@/lib/api';

const NAV_ITEMS = [
  { label: 'Sell', path: '/pos',                   roles: ['cashier', 'owner'] },
  { label: 'Invoices', path: '/invoices',          roles: ['cashier', 'owner'] },
  { label: 'Products', path: '/products',          roles: ['owner'] },
  { label: 'Barcode Creator', path: '/barcode',    roles: ['owner'] },
  { label: 'Out of Stock', path: '/out-of-stock',  roles: ['owner'] },
  { label: 'Returns', path: '/returns',            roles: ['owner'] },
  { label: 'Reports', path: '/reports',            roles: ['owner'] },
  { label: 'Used Purchase', path: '/used-purchase', roles: ['cashier', 'owner'] },
  { label: 'Users', path: '/settings/users',       roles: ['owner'] },
];

export default function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [user, setUser] = useState<{ username: string; role: string; name: string } | null>(null);

  useEffect(() => {
    const u = getUser();
    if (!u) {
      router.replace('/login');
    } else {
      setUser(u);
    }
  }, [router]);

  if (!user) return null; // waiting for auth check

  const visible = NAV_ITEMS.filter((item) => item.roles.includes(user.role));

  return (
    <div className="flex flex-col min-h-screen">
      {/* ── Top navigation ──────────────────────────────────────────── */}
      <nav className="sv-nav">
        {/* Brand */}
        <Link href="/pos" className="flex items-center gap-2.5 mr-5 hover:opacity-90 transition-opacity">
          <img
            src="/oshini-logo.jpg"
            alt="Oshini Phone Store"
            className="w-7 h-7 rounded-lg object-cover border border-gray-700"
          />
          <span className="text-white font-bold text-sm tracking-tight whitespace-nowrap">
            Oshini Phone Store
          </span>
        </Link>

        {/* Nav links */}
        {visible.map((item) => (
          <Link
            key={item.path}
            href={item.path}
            className={`sv-nav-link ${pathname === item.path || pathname.startsWith(item.path + '/') ? 'sv-nav-link-active' : ''}`}
          >
            {item.label}
          </Link>
        ))}

        {/* Spacer + user info */}
        <div className="ml-auto flex items-center gap-3 text-sm">
          <span className="text-gray-400 hidden sm:block">
            {user.name}
            <span className="sv-badge sv-badge-purple ml-2">{user.role}</span>
          </span>
          <button
            onClick={logout}
            className="sv-btn sv-btn-ghost py-1.5 px-3 text-xs"
          >
            Sign out
          </button>
        </div>
      </nav>

      {/* ── Page content ────────────────────────────────────────────── */}
      <main className="flex-1 p-4 sm:p-6 animate-fadeIn">
        {children}
      </main>
    </div>
  );
}
