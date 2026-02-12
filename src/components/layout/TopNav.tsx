'use client';

import React, { useEffect, useRef, useState } from 'react';
import { Bell, ChevronDown, LogOut, Search } from 'lucide-react';
import { signOut } from 'next-auth/react';

export function TopNav({ user }: { user: { name: string; role: string } }) {
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
    <header className="h-16 bg-white border-b border-slate-200 flex items-center justify-between px-6 fixed top-0 right-0 left-64 z-10 shadow-sm">
      <div className="flex items-center flex-1 max-w-xl min-w-0">
        <div className="relative w-full">
          <span className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
            <Search className="h-4 w-4 text-slate-400" />
          </span>
          <input
            type="text"
            className="block w-full pl-10 pr-3 py-2 border border-slate-200 rounded-lg leading-5 bg-slate-50 placeholder-slate-400 focus:outline-none focus:bg-white focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 sm:text-sm transition-all"
            placeholder="Search loans, borrowers, or tasks..."
          />
        </div>
      </div>

      <div className="flex items-center space-x-4">
        <button className="p-2 text-slate-400 hover:text-slate-600 relative hover:bg-slate-50 rounded-full transition-colors">
          <Bell className="h-5 w-5" />
          <span className="absolute top-1.5 right-1.5 block h-2 w-2 rounded-full bg-red-500 ring-2 ring-white"></span>
        </button>
        
        <div ref={menuRef} className="relative flex items-center space-x-3 pl-4 border-l border-slate-200">
          <div className="text-right hidden sm:block">
            <p className="text-sm font-semibold text-slate-900">{user.name}</p>
            <p className="text-[10px] text-slate-500 uppercase tracking-wider font-medium">{user.role.replace(/_/g, ' ')}</p>
          </div>
          <button
            onClick={() => setMenuOpen((prev) => !prev)}
            className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-white pr-1 hover:bg-slate-50"
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            aria-label="Open user menu"
          >
            <div className="h-9 w-9 rounded-full bg-slate-100 flex items-center justify-center text-slate-600 font-bold border border-slate-200">
              {user.name.charAt(0)}
            </div>
            <ChevronDown className="h-4 w-4 text-slate-500" />
          </button>

          {menuOpen && (
            <div className="absolute right-0 top-12 w-44 rounded-lg border border-slate-200 bg-white shadow-lg py-1 z-20">
              <button
                onClick={handleSignOut}
                disabled={isSigningOut}
                className="w-full inline-flex items-center gap-2 px-3 py-2 text-sm text-red-700 hover:bg-red-50 disabled:opacity-60 disabled:cursor-not-allowed"
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
