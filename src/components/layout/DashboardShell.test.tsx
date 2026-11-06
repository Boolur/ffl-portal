import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { UserRole } from '@prisma/client';

const state = vi.hoisted(() => ({
  pathname: '/', userId: 'viewer', role: 'LOAN_OFFICER', status: 'authenticated',
  roles: ['LOAN_OFFICER'],
}));
vi.mock('next/navigation', () => ({ usePathname: () => state.pathname, useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock('next-auth/react', () => ({ useSession: () => ({
  data: state.userId ? { user: { id: state.userId, name: 'Example User', role: state.role } } : null,
  status: state.status, update: vi.fn(),
}) }));
vi.mock('@/lib/impersonation', () => ({ useImpersonation: () => ({ activeRole: state.role, availableRoles: state.roles, setActiveRole: vi.fn() }) }));
vi.mock('@/lib/dashboardShellRoutes', async () => import('../../lib/dashboardShellRoutes'));
vi.mock('@/lib/supportSummaryLoader', () => ({ invalidateSupportSummary: vi.fn() }));
vi.mock('@/lib/portalLiveUpdates', () => ({ resetPortalIdentity: vi.fn() }));
vi.mock('./Sidebar', () => ({ Sidebar: () => <aside data-test="sidebar" /> }));
vi.mock('./TopNav', () => ({ TopNav: () => <header data-test="top-nav" /> }));
vi.mock('./PortalLiveProvider', () => ({ PortalLiveProvider: ({ children }: { children: React.ReactNode }) => children }));
vi.mock('next/dynamic', () => ({ default: () => () => <div data-test="support-widget" /> }));
vi.mock('@/components/layout/DashboardShellContext', async () => import('./DashboardShellContext'));
import { DashboardShell, PersistentDashboardShell } from './DashboardShell';
import { AppRouteLoading } from '../ui/AppRouteLoading';
import { dashboardShellIdentity, isPortalWorkspacePath } from '../../lib/dashboardShellRoutes';

function render(children: React.ReactNode = <p>Page contents</p>) {
  return renderToStaticMarkup(<PersistentDashboardShell>
    <DashboardShell user={{ name: 'Example User', role: UserRole.LOAN_OFFICER }}>{children}</DashboardShell>
  </PersistentDashboardShell>);
}

describe('persistent portal shell', () => {
  beforeEach(() => Object.assign(state, { pathname: '/', userId: 'viewer', role: 'LOAN_OFFICER', status: 'authenticated', roles: ['LOAN_OFFICER'] }));

  it.each(['/', '/tasks', '/pipeline', '/pipeline/submission-pilot', '/admin/users/onboarding/example', '/admin/leads/all', '/payroll'])('renders one shell, even with legacy page wrappers, at %s', (pathname) => {
    state.pathname = pathname;
    const html = render();
    expect(html.match(/data-test="sidebar"/g)).toHaveLength(1);
    expect(html.match(/data-test="top-nav"/g)).toHaveLength(1);
    expect(html.match(/id="app-main-scroll"/g)).toHaveLength(1);
    expect(html.match(/data-test="support-widget"/g)).toHaveLength(1);
    expect(html).toContain('Page contents');
  });

  it.each(['/login', '/auth/reset', '/auth/reset/token', '/auth/invite/token', '/onboarding', '/public', '/admin-lookalike'])('leaves %s without portal navigation', (pathname) => {
    state.pathname = pathname;
    expect(render()).not.toContain('data-test="sidebar"');
    expect(render()).toContain('Page contents');
  });

  it('removes chrome for signed-out and onboarding-only sessions', () => {
    state.userId = '';
    state.status = 'unauthenticated';
    expect(render()).not.toContain('data-test="sidebar"');
    expect(render()).not.toContain('Page contents');
    state.userId = 'onboarding-user';
    state.status = 'authenticated';
    state.role = 'ONBOARDING';
    expect(render()).not.toContain('data-test="sidebar"');
    expect(render()).not.toContain('Page contents');
  });

  it('keeps route loading inside the workspace without covering navigation', () => {
    const html = render(<AppRouteLoading label="Loading tasks..." />);
    expect(html).toContain('role="status"');
    expect(html).toContain('Loading tasks...');
    expect(html).not.toContain('fixed inset-0');
    expect(html).toContain('data-test="sidebar"');
  });

  it('resets shell state for account, active-role or permission changes, not role order', () => {
    const a = dashboardShellIdentity('u1', 'LOAN_OFFICER', ['LOAN_OFFICER', 'MANAGER']);
    expect(a).toBe(dashboardShellIdentity('u1', 'LOAN_OFFICER', ['MANAGER', 'LOAN_OFFICER']));
    expect(a).not.toBe(dashboardShellIdentity('u2', 'LOAN_OFFICER', ['LOAN_OFFICER', 'MANAGER']));
    expect(a).not.toBe(dashboardShellIdentity('u1', 'MANAGER', ['LOAN_OFFICER', 'MANAGER']));
    expect(a).not.toBe(dashboardShellIdentity('u1', 'LOAN_OFFICER', ['LOAN_OFFICER']));
    expect(isPortalWorkspacePath(null)).toBe(false);
  });
});
