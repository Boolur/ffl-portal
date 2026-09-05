import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getServerSession } from 'next-auth';
import { UserRole } from '@prisma/client';
import { authOptions } from '@/lib/auth';
import { highestAdminTier } from '@/lib/adminTiers';
import { DashboardShell } from '@/components/layout/DashboardShell';
import { UserManagementNav } from '@/components/admin/users/UserManagementNav';
import { FormatDate } from '@/components/ui/FormatDate';
import {
  listLoginAuditEvents,
  listLoginLocationGroups,
  type LoginAuditListItem,
  type LoginLocationGroup,
} from '@/app/actions/loginAuditActions';
import type { LoginAuditOutcome } from '@/lib/loginAudit';
import { formatLoginLocation, isHqIp } from '@/lib/loginLocation';

type SearchParams = {
  query?: string;
  outcome?: string;
  days?: string;
  page?: string;
  view?: string;
};

const FAILURE_LABELS: Record<string, string> = {
  MISSING_CREDENTIALS: 'Missing credentials',
  USER_NOT_FOUND: 'Account not found',
  ACCOUNT_INACTIVE: 'Account inactive',
  PASSWORD_NOT_CONFIGURED: 'Password not configured',
  INVALID_PASSWORD: 'Incorrect password',
};

function describeUserAgent(userAgent: string | null): string {
  if (!userAgent) return 'Unknown device';

  const platform = /Android/i.test(userAgent)
    ? 'Android'
    : /iPhone|iPad|iPod/i.test(userAgent)
      ? 'iOS'
      : /Windows/i.test(userAgent)
        ? 'Windows'
        : /Macintosh|Mac OS X/i.test(userAgent)
          ? 'macOS'
          : /Linux/i.test(userAgent)
            ? 'Linux'
            : 'Unknown OS';
  const browser = /Edg\//i.test(userAgent)
    ? 'Edge'
    : /OPR\//i.test(userAgent)
      ? 'Opera'
      : /Chrome\//i.test(userAgent)
        ? 'Chrome'
        : /Firefox\//i.test(userAgent)
          ? 'Firefox'
          : /Safari\//i.test(userAgent)
            ? 'Safari'
            : 'Unknown browser';

  return `${platform} · ${browser}`;
}

function pageHref(
  params: { query: string; outcome: string; days: string; view: string },
  page: number,
): string {
  const search = new URLSearchParams();
  if (params.query) search.set('query', params.query);
  if (params.outcome !== 'ALL') search.set('outcome', params.outcome);
  if (params.days !== '30') search.set('days', params.days);
  if (params.view === 'SOURCES') search.set('view', params.view);
  if (page > 1) search.set('page', String(page));
  const suffix = search.toString();
  return `/admin/users/sign-in-activity${suffix ? `?${suffix}` : ''}`;
}

export default async function SignInActivityPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) redirect('/login');

  const fallbackRole = session.user.role as UserRole | undefined;
  const roles =
    (session.user.roles as UserRole[] | undefined) ??
    (fallbackRole ? [fallbackRole] : []);
  if (highestAdminTier(roles) !== 3) redirect('/admin/users');

  const rawParams = await searchParams;
  const query = rawParams.query?.trim() ?? '';
  const outcome: LoginAuditOutcome | 'ALL' =
    rawParams.outcome === 'SUCCESS' || rawParams.outcome === 'FAILURE'
      ? rawParams.outcome
      : 'ALL';
  const daysValue = ['1', '7', '30', '90', 'ALL'].includes(rawParams.days ?? '')
    ? rawParams.days!
    : '30';
  const days = daysValue === 'ALL' ? null : Number(daysValue);
  const view = rawParams.view === 'SOURCES' ? 'SOURCES' : 'EVENTS';
  const page = Math.max(Number.parseInt(rawParams.page ?? '1', 10) || 1, 1);
  const result =
    view === 'EVENTS'
      ? await listLoginAuditEvents({
          query,
          outcome,
          days,
          page,
        })
      : null;
  const locationGroups =
    view === 'SOURCES'
      ? await listLoginLocationGroups({
          query,
          days,
        })
      : null;
  const pageCount = result
    ? Math.max(Math.ceil(result.total / result.pageSize), 1)
    : 1;
  const hrefParams = { query, outcome, days: daysValue, view };

  return (
    <DashboardShell
      user={{
        name: session.user.name || 'Admin User',
        role: session.user.activeRole || session.user.role || 'ADMIN_III',
      }}
    >
      <div className="app-page-header">
        <h1 className="app-page-title">Sign-in Activity</h1>
        <p className="app-page-subtitle">
          Review successful and failed portal sign-ins, including source IP and
          device details.
        </p>
      </div>
      <UserManagementNav showSignInActivity />

      <div
        className="mb-4 inline-flex rounded-xl border border-slate-200 bg-white p-1 shadow-sm"
        aria-label="Sign-in activity views"
      >
        <Link
          href={pageHref({ ...hrefParams, view: 'EVENTS' }, 1)}
          className={`rounded-lg px-4 py-2 text-sm font-medium transition ${
            view === 'EVENTS'
              ? 'bg-slate-900 text-white'
              : 'text-slate-600 hover:bg-slate-100'
          }`}
        >
          Activity log
        </Link>
        <Link
          href={pageHref(
            { ...hrefParams, view: 'SOURCES', outcome: 'ALL' },
            1,
          )}
          className={`rounded-lg px-4 py-2 text-sm font-medium transition ${
            view === 'SOURCES'
              ? 'bg-slate-900 text-white'
              : 'text-slate-600 hover:bg-slate-100'
          }`}
        >
          People &amp; locations
        </Link>
      </div>

      <div className="app-surface-card overflow-hidden">
        <form
          method="get"
          className={`grid gap-3 border-b border-slate-200 p-4 ${
            view === 'EVENTS'
              ? 'md:grid-cols-[minmax(220px,1fr)_180px_160px_auto]'
              : 'md:grid-cols-[minmax(220px,1fr)_160px_auto]'
          }`}
        >
          {view === 'SOURCES' && <input type="hidden" name="view" value="SOURCES" />}
          <div>
            <label htmlFor="activity-query" className="sr-only">
              Search sign-in activity
            </label>
            <input
              id="activity-query"
              name="query"
              defaultValue={query}
              className="app-input w-full"
              placeholder="Search name, email, IP, or location"
            />
          </div>
          {view === 'EVENTS' && (
            <div>
              <label htmlFor="activity-outcome" className="sr-only">
                Sign-in result
              </label>
              <select
                id="activity-outcome"
                name="outcome"
                defaultValue={outcome}
                className="app-input w-full"
              >
                <option value="ALL">All results</option>
                <option value="SUCCESS">Successful</option>
                <option value="FAILURE">Failed</option>
              </select>
            </div>
          )}
          <div>
            <label htmlFor="activity-days" className="sr-only">
              Time range
            </label>
            <select
              id="activity-days"
              name="days"
              defaultValue={daysValue}
              className="app-input w-full"
            >
              <option value="1">Last 24 hours</option>
              <option value="7">Last 7 days</option>
              <option value="30">Last 30 days</option>
              <option value="90">Last 90 days</option>
              <option value="ALL">All recorded</option>
            </select>
          </div>
          <div className="flex gap-2">
            <button type="submit" className="app-btn-primary">
              Apply
            </button>
            <Link
              href={
                view === 'SOURCES'
                  ? '/admin/users/sign-in-activity?view=SOURCES'
                  : '/admin/users/sign-in-activity'
              }
              className="app-btn-secondary"
            >
              Reset
            </Link>
          </div>
        </form>

        {result && (
          <>
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-5 py-3 text-sm text-slate-600">
              <span>
                {result.total.toLocaleString()} recorded{' '}
                {result.total === 1 ? 'attempt' : 'attempts'}
              </span>
              <span>
                Page {Math.min(result.page, pageCount)} of {pageCount}
              </span>
            </div>

            {result.items.length === 0 ? (
              <EmptyState />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-100 bg-slate-50/60 text-[11px] font-bold uppercase tracking-wider text-slate-500">
                      <th className="px-5 py-3 text-left">Result</th>
                      <th className="px-5 py-3 text-left">Account</th>
                      <th className="px-5 py-3 text-left">IP address</th>
                      <th className="px-5 py-3 text-left">Location</th>
                      <th className="px-5 py-3 text-left">Device</th>
                      <th className="px-5 py-3 text-right">Time</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {result.items.map((event) => (
                      <ActivityRow key={event.id} event={event} />
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {pageCount > 1 && (
              <nav
                aria-label="Sign-in activity pages"
                className="flex items-center justify-between border-t border-slate-200 px-5 py-4"
              >
                {result.page > 1 ? (
                  <Link
                    href={pageHref(hrefParams, result.page - 1)}
                    className="app-btn-secondary"
                  >
                    Previous
                  </Link>
                ) : (
                  <span />
                )}
                {result.page < pageCount && (
                  <Link
                    href={pageHref(hrefParams, result.page + 1)}
                    className="app-btn-secondary"
                  >
                    Next
                  </Link>
                )}
              </nav>
            )}
          </>
        )}

        {locationGroups && (
          <>
            <div className="border-b border-slate-100 px-5 py-3 text-sm text-slate-600">
              {locationGroups.length.toLocaleString()} person/IP{' '}
              {locationGroups.length === 1 ? 'combination' : 'combinations'}
            </div>
            {locationGroups.length === 0 ? (
              <EmptyState />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-100 bg-slate-50/60 text-[11px] font-bold uppercase tracking-wider text-slate-500">
                      <th className="px-5 py-3 text-left">Account</th>
                      <th className="px-5 py-3 text-left">IP address</th>
                      <th className="px-5 py-3 text-left">Location</th>
                      <th className="px-5 py-3 text-right">Logins</th>
                      <th className="px-5 py-3 text-right">Last sign-in</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {locationGroups.map((group) => (
                      <LocationGroupRow key={group.key} group={group} />
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </div>

      <p className="mt-4 text-xs text-slate-500">
        IP addresses identify network connections, not a person&apos;s precise
        physical location. City and region are approximate network locations
        supplied by Vercel and may reflect a VPN, mobile carrier, or ISP.
      </p>
    </DashboardShell>
  );
}

function ActivityRow({ event }: { event: LoginAuditListItem }) {
  const successful = event.outcome === 'SUCCESS';
  return (
    <tr className="hover:bg-slate-50/70">
      <td className="px-5 py-3 align-top">
        <span
          className={`inline-flex rounded-full border px-2.5 py-0.5 text-[11px] font-semibold ${
            successful
              ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
              : 'border-rose-200 bg-rose-50 text-rose-700'
          }`}
        >
          {successful ? 'Successful' : 'Failed'}
        </span>
        {!successful && event.reason && (
          <div className="mt-1 text-xs text-slate-500">
            {FAILURE_LABELS[event.reason] ?? event.reason}
          </div>
        )}
      </td>
      <td className="px-5 py-3 align-top">
        {event.userName && (
          <div className="font-medium text-slate-900">{event.userName}</div>
        )}
        <div className="text-xs text-slate-600">{event.email}</div>
      </td>
      <td className="whitespace-nowrap px-5 py-3 align-top font-mono text-xs text-slate-700">
        {event.ipAddress ?? 'Unavailable'}
      </td>
      <td className="whitespace-nowrap px-5 py-3 align-top text-xs">
        <LocationLabel
          ipAddress={event.ipAddress}
          city={event.city}
          region={event.region}
          country={event.country}
        />
      </td>
      <td
        className="max-w-[260px] px-5 py-3 align-top text-xs text-slate-700"
        title={event.userAgent ?? undefined}
      >
        <div>{describeUserAgent(event.userAgent)}</div>
        <div className="mt-1 truncate text-[11px] text-slate-400">
          {event.userAgent ?? 'User-agent unavailable'}
        </div>
      </td>
      <td className="whitespace-nowrap px-5 py-3 text-right align-top text-xs text-slate-500">
        <FormatDate date={event.createdAt} mode="datetime" />
      </td>
    </tr>
  );
}

function LocationGroupRow({ group }: { group: LoginLocationGroup }) {
  return (
    <tr className="hover:bg-slate-50/70">
      <td className="px-5 py-3 align-top">
        {group.userName && (
          <div className="font-medium text-slate-900">{group.userName}</div>
        )}
        <div className="text-xs text-slate-600">{group.email}</div>
      </td>
      <td className="whitespace-nowrap px-5 py-3 align-top font-mono text-xs text-slate-700">
        {group.ipAddress ?? 'Unavailable'}
      </td>
      <td className="whitespace-nowrap px-5 py-3 align-top text-xs">
        <LocationLabel
          ipAddress={group.ipAddress}
          city={group.city}
          region={group.region}
          country={group.country}
        />
      </td>
      <td className="px-5 py-3 text-right align-top font-semibold text-slate-700">
        {group.loginCount.toLocaleString()}
      </td>
      <td className="whitespace-nowrap px-5 py-3 text-right align-top text-xs text-slate-500">
        <FormatDate date={group.lastLoginAt} mode="datetime" />
      </td>
    </tr>
  );
}

function LocationLabel({
  ipAddress,
  city,
  region,
  country,
}: {
  ipAddress: string | null;
  city: string | null;
  region: string | null;
  country: string | null;
}) {
  const hq = isHqIp(ipAddress);
  return (
    <span
      className={
        hq
          ? 'inline-flex rounded-full border border-blue-200 bg-blue-50 px-2.5 py-0.5 font-semibold text-blue-700'
          : 'text-slate-700'
      }
    >
      {formatLoginLocation({ ipAddress, city, region, country })}
    </span>
  );
}

function EmptyState() {
  return (
    <div className="px-6 py-12 text-center text-sm text-slate-500">
      No sign-in activity matches these filters.
    </div>
  );
}
