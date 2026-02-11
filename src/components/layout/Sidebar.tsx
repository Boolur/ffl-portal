'use client';

import React, { useState } from 'react';
import { 
  Home, 
  FileText, 
  Users, 
  CheckSquare, 
  BarChart, 
  Settings, 
  HelpCircle,
  LogOut,
  Shield,
  Mail,
  Building2,
  LayoutGrid,
  Loader2
} from 'lucide-react';
import Link from 'next/link';
import Image from 'next/image';
import { useImpersonation } from '@/lib/impersonation';
import { UserRole } from '@prisma/client';
import { usePathname } from 'next/navigation';
import { signOut } from 'next-auth/react';

export function Sidebar() {
  const { activeRole } = useImpersonation();
  const pathname = usePathname();
  const [isSigningOut, setIsSigningOut] = useState(false);

  const navItems = [
    { 
      name: 'Overview', 
      icon: LayoutGrid, 
      href: '/', 
      roles: ['all'] 
    },
    { 
      name: 'My Pipeline', 
      icon: FileText, 
      href: '/pipeline', 
      roles: [UserRole.LOAN_OFFICER, UserRole.MANAGER, UserRole.PROCESSOR_SR, UserRole.PROCESSOR_JR] 
    },
    { 
      name: 'Task Queue', 
      icon: CheckSquare, 
      href: '/tasks', 
      roles: [UserRole.DISCLOSURE_SPECIALIST, UserRole.VA, UserRole.QC, UserRole.PROCESSOR_SR, UserRole.PROCESSOR_JR, UserRole.ADMIN, UserRole.MANAGER] 
    },
    { 
      name: 'Team', 
      icon: Users, 
      href: '/team', 
      roles: [UserRole.MANAGER, UserRole.ADMIN] 
    },
    { 
      name: 'Reports', 
      icon: BarChart, 
      href: '/reports', 
      roles: [UserRole.MANAGER, UserRole.ADMIN] 
    },
    // Admin Specific
    {
      name: 'User Management',
      icon: Shield,
      href: '/admin/users',
      roles: [UserRole.ADMIN]
    },
    {
      name: 'Email Settings',
      icon: Mail,
      href: '/admin/email',
      roles: [UserRole.ADMIN]
    },
    {
      name: 'Lead Mailbox',
      icon: Mail,
      href: '/admin/lead-mailbox',
      roles: [UserRole.ADMIN]
    },
    {
      name: 'Lender Mgmt',
      icon: Building2,
      href: '/admin/lenders',
      roles: [UserRole.ADMIN]
    },
    { 
      name: 'Resources', 
      icon: HelpCircle, 
      href: '/resources', 
      roles: ['all'] 
    },
  ];

  const filteredNavItems = navItems.filter(item => 
    item.roles.includes('all') || item.roles.includes(activeRole)
  );

  return (
    <div className="flex flex-col w-64 bg-white border-r border-slate-200 h-screen fixed left-0 top-0 overflow-y-auto z-50 shadow-sm">
      <div className="p-6 border-b border-slate-100">
        <div className="relative w-full h-12">
           <Image 
             src="/logo.png" 
             alt="Federal First Lending" 
             fill
             className="object-contain object-left"
             priority
           />
        </div>
        <div className="mt-4 px-3 py-1.5 bg-slate-50 rounded-md border border-slate-100">
          <p className="text-[10px] text-slate-500 uppercase tracking-wider font-bold">
            Role View
          </p>
          <p className="text-xs font-semibold text-slate-900 truncate">
            {activeRole.replace(/_/g, ' ')}
          </p>
        </div>
      </div>
      
      <nav className="flex-1 p-4 space-y-1">
        {filteredNavItems.map((item) => {
          const isActive = pathname === item.href;
          return (
            <Link 
              key={item.name} 
              href={item.href}
              className={`flex items-center px-4 py-2.5 rounded-lg transition-all group ${
                isActive 
                  ? 'bg-blue-50 text-blue-700 font-medium' 
                  : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'
              }`}
            >
              <item.icon className={`w-5 h-5 mr-3 transition-colors ${
                isActive ? 'text-blue-600' : 'text-slate-400 group-hover:text-slate-600'
              }`} />
              <span className="text-sm">{item.name}</span>
            </Link>
          );
        })}
      </nav>

      <div className="p-4 border-t border-slate-100">
        <button
          onClick={() => {
            setIsSigningOut(true);
            signOut({ callbackUrl: '/login' });
          }}
          disabled={isSigningOut}
          className="flex items-center w-full px-4 py-2 text-slate-500 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isSigningOut ? <Loader2 className="w-5 h-5 mr-3 animate-spin" /> : <LogOut className="w-5 h-5 mr-3" />}
          <span className="text-sm font-medium">{isSigningOut ? 'Signing Out...' : 'Sign Out'}</span>
        </button>
      </div>
    </div>
  );
}
