const PORTAL_ROUTE_ROOTS = [
  '/tasks', '/pipeline', '/leads', '/lenders', '/leaderboard',
  '/payroll', '/resources', '/reports', '/team', '/admin',
];

/** UI layout selection only; proxy and server actions still enforce access. */
export function isPortalWorkspacePath(pathname: string | null) {
  return pathname === '/' || Boolean(pathname && PORTAL_ROUTE_ROOTS.some(
    (root) => pathname === root || pathname.startsWith(`${root}/`),
  ));
}

export function dashboardShellIdentity(id: string, role: string, roles: readonly string[]) {
  return JSON.stringify([id, role, [...new Set(roles)].sort()]);
}
