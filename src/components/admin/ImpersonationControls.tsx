'use client';

import React, { useState } from 'react';
import { useImpersonation } from '@/lib/impersonation';
import { UserRole } from '@prisma/client';
import { Eye, X, ChevronDown, ChevronUp } from 'lucide-react';

export function ImpersonationControls({ currentUserRole }: { currentUserRole: UserRole }) {
  const { activeRole, isImpersonating, startImpersonating, stopImpersonating } = useImpersonation();
  const [isOpen, setIsOpen] = useState(true);

  // Only show if the REAL user is Admin or Manager
  if (currentUserRole !== 'ADMIN' && currentUserRole !== 'MANAGER') {
    return null;
  }

  const roles: UserRole[] = [
    'LOAN_OFFICER',
    'DISCLOSURE_SPECIALIST',
    'VA',
    'VA_TITLE',
    'VA_HOI',
    'VA_PAYOFF',
    'VA_APPRAISAL',
    'QC',
    'PROCESSOR_JR',
    'PROCESSOR_SR',
    'MANAGER',
    'ADMIN'
  ];

  return (
    <div className="fixed bottom-6 right-6 z-50 flex flex-col items-end space-y-2">
      {isImpersonating && (
        <div className="bg-amber-500 text-white px-4 py-2 rounded-lg shadow-lg flex items-center animate-pulse">
          <Eye className="w-4 h-4 mr-2" />
          <span className="text-sm font-bold">Viewing as {activeRole.replace(/_/g, ' ')}</span>
          <button 
            onClick={stopImpersonating}
            className="ml-3 p-1 hover:bg-amber-600 rounded-full"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      <div className="bg-white text-slate-900 rounded-xl shadow-xl border border-slate-200 w-64">
        <button
          onClick={() => setIsOpen((prev) => !prev)}
          className="w-full flex items-center justify-between px-4 py-3 text-left"
        >
          <div className="flex items-center gap-2">
            <ShieldIcon className="w-3 h-3 text-slate-400" />
            <p className="text-xs text-slate-500 uppercase tracking-wider font-bold">
              Impersonate Role
            </p>
          </div>
          {isOpen ? (
            <ChevronDown className="w-4 h-4 text-slate-400" />
          ) : (
            <ChevronUp className="w-4 h-4 text-slate-400" />
          )}
        </button>

        {isOpen && (
          <div className="px-4 pb-4">
            <div className="grid grid-cols-2 gap-2">
              {roles.map((role) => (
                <button 
                  key={role}
                  onClick={() => startImpersonating(role)}
                  className={`px-2 py-1.5 text-[10px] rounded-md transition-colors text-left truncate ${
                    activeRole === role 
                      ? 'bg-blue-600 text-white' 
                      : 'bg-slate-50 text-slate-600 hover:bg-slate-100 border border-slate-100'
                  }`}
                >
                  {role.replace(/_/g, ' ')}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function ShieldIcon({ className }: { className?: string }) {
  return (
    <svg 
      xmlns="http://www.w3.org/2000/svg" 
      viewBox="0 0 24 24" 
      fill="none" 
      stroke="currentColor" 
      strokeWidth="2" 
      strokeLinecap="round" 
      strokeLinejoin="round" 
      className={className}
    >
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
    </svg>
  );
}
