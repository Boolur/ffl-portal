'use client';

import React, { useState } from 'react';
import { 
  PanelLeftClose,
  PanelLeftOpen,
  FileText, 
  Users, 
  CheckSquare, 
  BarChart, 
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

type SidebarProps = {
  collapsed: boolean;
  onToggle: () => void;
};

export function Sidebar({ collapsed, onToggle }: SidebarProps) {
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
      name: 'Tasks', 
      icon: CheckSquare, 
      href: '/tasks', 
      roles: [
        UserRole.LOAN_OFFICER,
        UserRole.DISCLOSURE_SPECIALIST,
        UserRole.VA,
        UserRole.VA_TITLE,
        UserRole.VA_HOI,
        UserRole.VA_PAYOFF,
        UserRole.VA_APPRAISAL,
        UserRole.QC,
        UserRole.PROCESSOR_SR,
        UserRole.PROCESSOR_JR,
        UserRole.ADMIN,
        UserRole.MANAGER,
      ] 
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

  const mainNavItems = navItems.filter(item => 
    (item.roles.includes('all') || item.roles.includes(activeRole)) &&
    !['User Management', 'Email Settings', 'Lead Mailbox', 'Lender Mgmt'].includes(item.name)
  );

  // Ensure LOs see the Tasks link
  if (activeRole === UserRole.LOAN_OFFICER) {
    const taskItem = navItems.find(i => i.name === 'Tasks');
    if (taskItem && !mainNavItems.find(i => i.name === 'Tasks')) {
      // Insert it after My Pipeline
      const pipelineIndex = mainNavItems.findIndex(i => i.name === 'My Pipeline');
      if (pipelineIndex !== -1) {
        mainNavItems.splice(pipelineIndex + 1, 0, taskItem);
      } else {
        mainNavItems.push(taskItem);
      }
    }
  }

  const adminNavItems = navItems.filter(item => 
    (item.roles.includes('all') || item.roles.includes(activeRole)) &&
    ['User Management', 'Email Settings', 'Lead Mailbox', 'Lender Mgmt'].includes(item.name)
  );

  return (
    <div
      className={`flex flex-col bg-card border-r border-border h-screen fixed left-0 top-0 overflow-y-auto z-50 shadow-sm transition-all duration-300 ${
        collapsed ? 'w-20' : 'w-64'
      }`}
    >
      <div className={`border-b border-border ${collapsed ? 'p-3' : 'p-6'}`}>
        <div className="flex items-center justify-between gap-2">
          <div className={`relative h-12 ${collapsed ? 'w-9' : 'w-full'}`}>
           <Image 
             src="/logo.png" 
             alt="Federal First Lending" 
             fill
             className="object-contain object-left"
             priority
           />
          </div>
          <button
            type="button"
            onClick={onToggle}
            className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-border text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          >
            {collapsed ? (
              <PanelLeftOpen className="h-4 w-4" />
            ) : (
              <PanelLeftClose className="h-4 w-4" />
            )}
          </button>
        </div>
        {!collapsed && (
          <div className="mt-4 px-3 py-1.5 bg-secondary rounded-md border border-border">
            <p className="text-[10px] text-muted-foreground uppercase tracking-wider font-bold">
              Role View
            </p>
            <p className="text-xs font-semibold text-foreground truncate">
              {activeRole.replace(/_/g, ' ')}
            </p>
          </div>
        )}
      </div>
      
      <nav className="flex-1 p-4 space-y-1">
        {mainNavItems.map((item) => {
          const isActive = pathname === item.href;
          return (
            <Link 
              key={item.name} 
              href={item.href}
              className={`flex items-center ${collapsed ? 'justify-center px-2' : 'px-4'} py-2.5 rounded-lg transition-all group ${
                isActive 
                  ? 'bg-primary/15 text-primary font-medium' 
                  : 'text-muted-foreground hover:bg-secondary hover:text-foreground'
              }`}
              title={collapsed ? item.name : undefined}
            >
              <item.icon className={`w-5 h-5 ${collapsed ? '' : 'mr-3'} transition-colors ${
                isActive ? 'text-primary' : 'text-muted-foreground group-hover:text-foreground'
              }`} />
              {!collapsed && <span className="text-sm">{item.name}</span>}
            </Link>
          );
        })}

        {adminNavItems.length > 0 && !collapsed && (
          <>
            <div className="pt-4 pb-2 px-4">
              <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">
                Management
              </p>
            </div>
            {adminNavItems.map((item) => {
              const isActive = pathname === item.href;
              return (
                <Link 
                  key={item.name} 
                  href={item.href}
                  className={`flex items-center px-4 py-2.5 rounded-lg transition-all group ${
                    isActive 
                      ? 'bg-primary/15 text-primary font-medium' 
                      : 'text-muted-foreground hover:bg-secondary hover:text-foreground'
                  }`}
                >
                  <item.icon className={`w-5 h-5 mr-3 transition-colors ${
                    isActive ? 'text-primary' : 'text-muted-foreground group-hover:text-foreground'
                  }`} />
                  <span className="text-sm">{item.name}</span>
                </Link>
              );
            })}
          </>
        )}
      </nav>

      <div className="p-4 border-t border-border">
        <button
          onClick={() => {
            setIsSigningOut(true);
            signOut({ callbackUrl: '/login' });
          }}
          disabled={isSigningOut}
          className={`flex items-center w-full ${collapsed ? 'justify-center px-2' : 'px-4'} py-2 text-muted-foreground hover:text-red-500 hover:bg-red-500/10 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed`}
          title={collapsed ? 'Sign Out' : undefined}
        >
          {isSigningOut ? (
            <Loader2 className={`w-5 h-5 ${collapsed ? '' : 'mr-3'} animate-spin`} />
          ) : (
            <LogOut className={`w-5 h-5 ${collapsed ? '' : 'mr-3'}`} />
          )}
          {!collapsed && (
            <span className="text-sm font-medium">{isSigningOut ? 'Signing Out...' : 'Sign Out'}</span>
          )}
        </button>
      </div>
    </div>
  );
}
