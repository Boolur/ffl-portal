import React from 'react';
import { Bell, Search } from 'lucide-react';

export function TopNav({ user }: { user: { name: string; role: string } }) {
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
        
        <div className="flex items-center space-x-3 pl-4 border-l border-slate-200">
          <div className="text-right hidden sm:block">
            <p className="text-sm font-semibold text-slate-900">{user.name}</p>
            <p className="text-[10px] text-slate-500 uppercase tracking-wider font-medium">{user.role.replace(/_/g, ' ')}</p>
          </div>
          <div className="h-9 w-9 rounded-full bg-slate-100 flex items-center justify-center text-slate-600 font-bold border border-slate-200">
            {user.name.charAt(0)}
          </div>
        </div>
      </div>
    </header>
  );
}
