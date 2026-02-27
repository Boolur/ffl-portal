'use client';

import React, { useEffect, useRef, useState } from 'react';
import { Bell, ChevronDown, LogOut, PanelLeft, Search, Shield } from 'lucide-react';
import { signOut } from 'next-auth/react';

export function TopNav({
  user,
  sidebarCollapsed,
  onToggleSidebar,
}: {
  user: { name: string; role: string };
  sidebarCollapsed: boolean;
  onToggleSidebar: () => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [isSigningOut, setIsSigningOut] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const onClickOutside = (event: MouseEvent) => {
      if (!menuRef.current) return;
      if (!menuRef.current.contains(event.target as Node)) {
        setMenuOpen(false);
      }
    };

    const onEsc = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setMenuOpen(false);
      }
    };

    document.addEventListener('mousedown', onClickOutside);
    document.addEventListener('keydown', onEsc);
    return () => {
      document.removeEventListener('mousedown', onClickOutside);
      document.removeEventListener('keydown', onEsc);
    };
  }, []);

  const handleSignOut = async () => {
    if (isSigningOut) return;
    setIsSigningOut(true);
    await signOut({ callbackUrl: '/login' });
  };

  return (
    <header
      className={`h-16 border-b border-border app-glass flex items-center justify-between px-4 sm:px-6 fixed top-0 right-0 z-10 transition-all duration-300 ${
        sidebarCollapsed ? 'left-20' : 'left-64'
      }`}
    >
      <div className="flex items-center flex-1 max-w-xl min-w-0">
        <button
          type="button"
          onClick={onToggleSidebar}
          className="mr-3 inline-flex h-9 w-9 items-center justify-center rounded-lg border border-border bg-card text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
          aria-label="Toggle sidebar"
        >
          <PanelLeft className="h-4 w-4" />
        </button>
        <div className="relative w-full">
          <span className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
            <Search className="h-4 w-4 text-muted-foreground" />
          </span>
          <input
            type="text"
            className="block w-full pl-10 pr-3 py-2 border border-input rounded-lg leading-5 bg-card placeholder:text-muted-foreground text-foreground focus:outline-none focus:bg-card focus:ring-2 focus:ring-primary/20 focus:border-primary sm:text-sm transition-all"
            placeholder="Search loans, borrowers, or tasks..."
          />
        </div>
      </div>

      <div className="flex items-center space-x-4">
        <button className="p-2 text-muted-foreground hover:text-foreground relative hover:bg-secondary rounded-full transition-colors">
          <Bell className="h-5 w-5" />
          <span className="absolute top-1.5 right-1.5 block h-2 w-2 rounded-full bg-red-500 ring-2 ring-card"></span>
        </button>

        <div ref={menuRef} className="relative flex items-center space-x-3 pl-4 border-l border-border">
          <div className="text-right hidden sm:block">
            <p className="text-sm font-semibold text-foreground">{user.name}</p>
            <p className="text-[10px] text-muted-foreground uppercase tracking-wider font-medium">
              {user.role.replace(/_/g, ' ')}
            </p>
          </div>
          <button
            onClick={() => setMenuOpen((prev) => !prev)}
            className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white pr-1.5 pl-0.5 shadow-sm transition-all hover:bg-slate-50"
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            aria-label="Open user menu"
          >
            <div className="h-9 w-9 rounded-full bg-gradient-to-br from-slate-100 to-slate-200 flex items-center justify-center text-slate-700 font-bold border border-slate-200">
              {user.name.charAt(0)}
            </div>
            <ChevronDown
              className={`h-4 w-4 text-slate-500 transition-transform ${
                menuOpen ? 'rotate-180' : ''
              }`}
            />
          </button>

          {menuOpen && (
            <div className="absolute right-0 top-[3.25rem] w-56 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xl py-1 z-20">
              <div className="px-3 py-3 border-b border-slate-100 bg-slate-50/70">
                <p className="text-sm font-semibold text-slate-900 truncate">{user.name}</p>
                <p className="mt-0.5 inline-flex items-center gap-1 rounded-full border border-slate-200 bg-white px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-slate-500">
                  <Shield className="h-3 w-3" />
                  {user.role.replace(/_/g, ' ')}
                </p>
              </div>
              <button
                onClick={handleSignOut}
                disabled={isSigningOut}
                className="m-1.5 w-[calc(100%-0.75rem)] inline-flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-semibold text-red-600 hover:bg-red-50 disabled:opacity-60 disabled:cursor-not-allowed"
                role="menuitem"
              >
                <LogOut className="h-4 w-4" />
                {isSigningOut ? 'Signing out...' : 'Log out'}
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
