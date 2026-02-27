'use client';

import React from 'react';
import {
  PanelLeftClose,
  PanelLeftOpen,
  Users,
  CheckSquare,
  BarChart,
  HelpCircle,
  Shield,
  Mail,
  Building2,
  LayoutGrid,
} from 'lucide-react';
import Link from 'next/link';
import Image from 'next/image';
import { useImpersonation } from '@/lib/impersonation';
import { UserRole } from '@prisma/client';
import { usePathname } from 'next/navigation';

type SidebarProps = {
  collapsed: boolean;
  onToggle: () => void;
};

export function Sidebar({ collapsed, onToggle }: SidebarProps) {
  const { activeRole } = useImpersonation();
  const pathname = usePathname();

  const navItems = [
    {
      name: 'Overview',
      icon: LayoutGrid,
      href: '/',
      roles: ['all'],
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
      ],
    },
    {
      name: 'Team',
      icon: Users,
      href: '/team',
      roles: [UserRole.MANAGER, UserRole.ADMIN],
    },
    {
      name: 'Reports',
      icon: BarChart,
      href: '/reports',
      roles: [UserRole.MANAGER, UserRole.ADMIN],
    },
    {
      name: 'User Management',
      icon: Shield,
      href: '/admin/users',
      roles: [UserRole.ADMIN],
    },
    {
      name: 'Email Settings',
      icon: Mail,
      href: '/admin/email',
      roles: [UserRole.ADMIN],
    },
    {
      name: 'Lead Mailbox',
      icon: Mail,
      href: '/admin/lead-mailbox',
      roles: [UserRole.ADMIN],
    },
    {
      name: 'Lender Mgmt',
      icon: Building2,
      href: '/admin/lenders',
      roles: [UserRole.ADMIN],
    },
    {
      name: 'Resources',
      icon: HelpCircle,
      href: '/resources',
      roles: ['all'],
    },
  ];

  const mainNavItems = navItems.filter(
    (item) =>
      (item.roles.includes('all') || item.roles.includes(activeRole)) &&
      !['User Management', 'Email Settings', 'Lead Mailbox', 'Lender Mgmt'].includes(
        item.name
      )
  );

  // Keep Tasks visible for LOs even under role switching edge cases
  if (activeRole === UserRole.LOAN_OFFICER) {
    const taskItem = navItems.find((i) => i.name === 'Tasks');
    if (taskItem && !mainNavItems.find((i) => i.name === 'Tasks')) {
      const overviewIndex = mainNavItems.findIndex((i) => i.name === 'Overview');
      if (overviewIndex !== -1) {
        mainNavItems.splice(overviewIndex + 1, 0, taskItem);
      } else {
        mainNavItems.push(taskItem);
      }
    }
  }

  const adminNavItems = navItems.filter(
    (item) =>
      (item.roles.includes('all') || item.roles.includes(activeRole)) &&
      ['User Management', 'Email Settings', 'Lead Mailbox', 'Lender Mgmt'].includes(
        item.name
      )
  );

  const linkClasses = (isActive: boolean) =>
    `group flex items-center ${collapsed ? 'justify-center px-2.5' : 'px-3.5'} py-2.5 rounded-xl transition-all ${
      isActive
        ? 'bg-gradient-to-r from-blue-600/15 to-indigo-600/10 text-blue-700 shadow-sm ring-1 ring-blue-100'
        : 'text-slate-500 hover:bg-slate-100/80 hover:text-slate-900'
    }`;

  return (
    <aside
      className={`fixed left-0 top-0 z-50 flex h-screen flex-col overflow-y-auto border-r border-slate-200/80 bg-gradient-to-b from-white to-slate-50 shadow-sm transition-all duration-300 ${
        collapsed ? 'w-20' : 'w-64'
      }`}
    >
      <div className={`border-b border-slate-200/80 ${collapsed ? 'p-3' : 'p-5'}`}>
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
            className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-500 shadow-sm transition-colors hover:bg-slate-50 hover:text-slate-900"
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
      </div>

      <nav className={`flex-1 ${collapsed ? 'p-3' : 'p-4'} space-y-1.5`}>
        {mainNavItems.map((item) => {
          const isActive = pathname === item.href;
          return (
            <Link
              key={item.name}
              href={item.href}
              className={linkClasses(isActive)}
              title={collapsed ? item.name : undefined}
            >
              <item.icon
                className={`h-5 w-5 ${collapsed ? '' : 'mr-3'} transition-colors ${
                  isActive ? 'text-blue-600' : 'text-slate-400 group-hover:text-slate-700'
                }`}
              />
              {!collapsed && <span className="text-sm font-medium">{item.name}</span>}
            </Link>
          );
        })}

        {adminNavItems.length > 0 && (
          <>
            {!collapsed && (
              <div className="px-3.5 pt-5 pb-2">
                <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400">
                  Management
                </p>
              </div>
            )}
            {adminNavItems.map((item) => {
              const isActive = pathname === item.href;
              return (
                <Link
                  key={item.name}
                  href={item.href}
                  className={linkClasses(isActive)}
                  title={collapsed ? item.name : undefined}
                >
                  <item.icon
                    className={`h-5 w-5 ${collapsed ? '' : 'mr-3'} transition-colors ${
                      isActive ? 'text-blue-600' : 'text-slate-400 group-hover:text-slate-700'
                    }`}
                  />
                  {!collapsed && <span className="text-sm font-medium">{item.name}</span>}
                </Link>
              );
            })}
          </>
        )}
      </nav>
    </aside>
  );
}

