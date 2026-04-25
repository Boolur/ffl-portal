'use client';

import React, { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import {
  Search, X, Plus, Trash2, Loader2, ChevronDown, ChevronRight, ChevronUp, ChevronsUpDown, Users, Check, Link2, Send, AlertTriangle, RotateCcw,
} from 'lucide-react';
import { InfoTip } from '@/components/ui/InfoTip';
import {
  updateUserLeadSettings,
  updateMemberSettings,
  addUserToCampaign,
  removeUserFromCampaign,
  sendBonzoTestForUser,
  upsertUserIntegrationCredential,
  setUserIntegrationServicePermissions,
} from '@/app/actions/leadActions';
import type { IntegrationServiceCredentialFieldDTO } from '@/lib/integrationServices/types';
import { useRouter } from 'next/navigation';
import {
  ResizeHandle,
  useColumnWidths,
  useColumnOrder,
  type ColumnDragHandlers,
  type DropIndicator,
} from '@/components/admin/leads/shared/columnCustomization';
import {
  LeadUserTeamManager,
  type LeadUserTeamSummary,
} from '@/components/admin/leads/LeadUserTeamManager';

type Membership = {
  id: string;
  campaignId: string;
  campaignName: string;
  vendorName: string;
  dailyQuota: number;
  weeklyQuota: number;
  monthlyQuota: number;
  receiveDays: number[];
  active: boolean;
  leadsReceivedToday: number;
};

type LeadUser = {
  id: string;
  name: string;
  email: string;
  role: string;
  leadsEnabled: boolean;
  licensedStates: string[];
  bonzoWebhookUrl: string;
  globalDailyQuota: number;
  globalWeeklyQuota: number;
  globalMonthlyQuota: number;
  leadsToday: number;
  leadsWeek: number;
  leadsMonth: number;
  leadsYtd: number;
  campaignCount: number;
  memberships: Membership[];
  serviceCredentials?: Array<{ serviceId: string; values: Record<string, string> }>;
  // IDs of IntegrationServices this user is permitted to manually push to.
  // Empty array = no services visible in their LO "Push to Service" picker.
  allowedServiceIds?: string[];
};

type CampaignOption = { id: string; name: string; vendorName: string };

export type LeadUserServiceSummary = {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  credentialFields: IntegrationServiceCredentialFieldDTO[];
};

const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

// ---------------------------------------------------------------------------
// Users table column config
// ---------------------------------------------------------------------------

type UserColumnId =
  | 'name'
  | 'email'
  | 'status'
  | 'states'
  | 'campaigns'
  | 'quotas'
  | 'today'
  | 'week'
  | 'month'
  | 'ytd';

type UserSortKey = UserColumnId;
type SortDir = 'asc' | 'desc';

const USER_COLUMNS: Array<{
  id: UserColumnId;
  label: string;
  defaultWidth: number;
  minWidth: number;
  align?: 'left' | 'right' | 'center';
  sortable: boolean;
  title?: string;
}> = [
  { id: 'name', label: 'Name', defaultWidth: 180, minWidth: 120, align: 'left', sortable: true },
  { id: 'email', label: 'Email', defaultWidth: 220, minWidth: 140, align: 'left', sortable: true },
  { id: 'status', label: 'Status', defaultWidth: 90, minWidth: 70, align: 'center', sortable: true },
  { id: 'states', label: 'States', defaultWidth: 120, minWidth: 80, align: 'center', sortable: true },
  { id: 'campaigns', label: 'Campaigns', defaultWidth: 100, minWidth: 80, align: 'center', sortable: true },
  {
    id: 'quotas',
    label: 'Quotas',
    defaultWidth: 110,
    minWidth: 90,
    align: 'center',
    sortable: true,
    title:
      'Daily / Weekly / Monthly effective caps. Uses the global cap when set; otherwise sums the user\'s campaign quotas. ∞ = no limit.',
  },
  { id: 'today', label: 'Today', defaultWidth: 72, minWidth: 60, align: 'right', sortable: true },
  { id: 'week', label: 'Week', defaultWidth: 72, minWidth: 60, align: 'right', sortable: true },
  { id: 'month', label: 'Month', defaultWidth: 76, minWidth: 60, align: 'right', sortable: true },
  { id: 'ytd', label: 'YTD', defaultWidth: 80, minWidth: 60, align: 'right', sortable: true },
];

const USER_COLUMN_WIDTHS_KEY = 'ffl:lead-users-column-widths:v1';
const USER_COLUMN_ORDER_KEY = 'ffl:lead-users-column-order:v1';
const LOCKED_FIRST_USER_COL: UserColumnId = 'name';

const USER_DEFAULT_ORDER: UserColumnId[] = USER_COLUMNS.map((c) => c.id);

/**
 * Effective per-user cap for one time window (daily / weekly / monthly).
 *
 * Mirrors the distributor's precedence rules:
 *   1. If the user has a global cap set (> 0), that wins — it's enforced
 *      across all campaigns so it's the real ceiling.
 *   2. Otherwise we fall back to the sum of the user's per-campaign
 *      quotas. If *any* campaign is unlimited (0), the aggregate is
 *      unlimited too.
 *   3. With no campaigns at all, "unlimited" is the neutral answer.
 */
function computeEffectiveQuota(
  globalQuota: number,
  memberships: Membership[],
  pick: (m: Membership) => number
): number | 'unlimited' {
  if (globalQuota > 0) return globalQuota;
  if (memberships.length === 0) return 'unlimited';
  let total = 0;
  for (const m of memberships) {
    const q = pick(m);
    if (q === 0) return 'unlimited';
    total += q;
  }
  return total;
}

function formatQuotaPart(q: number | 'unlimited'): string {
  // Infinity sign reads as "no limit" at a glance; em-dash felt like
  // "missing data" which is the wrong signal.
  return q === 'unlimited' ? '∞' : String(q);
}

// Numeric representation used for sorting the Quotas column. Unlimited
// bubbles to the top when sorted desc (matches "biggest cap wins" intuition).
function quotaSortValue(q: number | 'unlimited'): number {
  return q === 'unlimited' ? Number.MAX_SAFE_INTEGER : q;
}

function getUserColumnSortValue(u: LeadUser, id: UserSortKey): string | number {
  switch (id) {
    case 'name':
      return (u.name || '').toLowerCase();
    case 'email':
      return (u.email || '').toLowerCase();
    case 'status':
      // enabled first when sorted asc, disabled first when desc
      return u.leadsEnabled ? 1 : 0;
    case 'states':
      // "All" (empty licensedStates) sorts before any specific-state user
      return u.licensedStates.length === 0 ? -1 : u.licensedStates.length;
    case 'campaigns':
      return u.campaignCount;
    case 'quotas':
      // Sort by effective daily cap (global if set, else sum of
      // campaign quotas; unlimited floats to the top when desc).
      return quotaSortValue(
        computeEffectiveQuota(u.globalDailyQuota, u.memberships, (m) => m.dailyQuota)
      );
    case 'today':
      return u.leadsToday;
    case 'week':
      return u.leadsWeek;
    case 'month':
      return u.leadsMonth;
    case 'ytd':
      return u.leadsYtd;
    default:
      return 0;
  }
}

export function LeadUserManager({
  users,
  allCampaigns,
  teams = [],
  services = [],
  manualServices = [],
}: {
  users: LeadUser[];
  allCampaigns: CampaignOption[];
  teams?: LeadUserTeamSummary[];
  services?: LeadUserServiceSummary[];
  // Subset of active services with `allowManualSend = true`. Rendered in
  // the per-user "Service permissions" checklist below the credentials
  // section. Separate from `services` (which also drives the credentials
  // rows) so the permissions UI doesn't list services that can never be
  // manually pushed to anyway.
  manualServices?: LeadUserServiceSummary[];
}) {
  const router = useRouter();
  const [search, setSearch] = useState('');
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [sortBy, setSortBy] = useState<UserSortKey>('name');
  const [sortDir, setSortDir] = useState<SortDir>('asc');
  // Team chip acts as a one-shot filter: null = show everyone. Clicking
  // the active chip (or the "All" chip) clears it. Intentionally not
  // persisted to localStorage so the table always opens wide.
  const [selectedTeamId, setSelectedTeamId] = useState<string | null>(null);

  const {
    widths: columnWidths,
    resizingCol,
    startResize,
    reset: resetWidths,
  } = useColumnWidths<UserColumnId>(USER_COLUMNS, USER_COLUMN_WIDTHS_KEY);

  const {
    order: columnOrder,
    draggingColId,
    getHandlers: getColHandlers,
    getDropIndicator,
    reset: resetOrder,
  } = useColumnOrder<UserColumnId>({
    defaultOrder: USER_DEFAULT_ORDER,
    storageKey: USER_COLUMN_ORDER_KEY,
    lockedFirstId: LOCKED_FIRST_USER_COL,
  });

  const columnMap = useMemo(() => {
    const m = new Map<UserColumnId, (typeof USER_COLUMNS)[number]>();
    for (const c of USER_COLUMNS) m.set(c.id, c);
    return m;
  }, []);

  const orderedColumns = useMemo(
    () =>
      columnOrder
        .map((id) => columnMap.get(id))
        .filter((c): c is (typeof USER_COLUMNS)[number] => !!c),
    [columnOrder, columnMap]
  );

  // Build a quick lookup of team member IDs so both the chip counter
  // and the filter share the same source of truth. Only recomputes when
  // the teams array identity changes.
  const selectedTeamMemberIds = useMemo(() => {
    if (!selectedTeamId) return null;
    const team = teams.find((t) => t.id === selectedTeamId);
    return team ? new Set(team.memberIds) : null;
  }, [teams, selectedTeamId]);

  const filtered = useMemo(() => {
    let list = users;
    if (selectedTeamMemberIds) {
      list = list.filter((u) => selectedTeamMemberIds.has(u.id));
    }
    if (search) {
      const q = search.toLowerCase();
      list = list.filter(
        (u) =>
          u.name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q)
      );
    }
    return list;
  }, [users, search, selectedTeamMemberIds]);

  const sorted = useMemo(() => {
    const arr = [...filtered];
    const dir = sortDir === 'asc' ? 1 : -1;
    arr.sort((a, b) => {
      const av = getUserColumnSortValue(a, sortBy);
      const bv = getUserColumnSortValue(b, sortBy);
      if (typeof av === 'number' && typeof bv === 'number') {
        return (av - bv) * dir;
      }
      const as = String(av);
      const bs = String(bv);
      if (as < bs) return -1 * dir;
      if (as > bs) return 1 * dir;
      return 0;
    });
    return arr;
  }, [filtered, sortBy, sortDir]);

  const selectedUser = useMemo(
    () => users.find((u) => u.id === selectedUserId) ?? null,
    [users, selectedUserId]
  );

  const handleSort = useCallback(
    (key: UserSortKey) => {
      if (sortBy === key) {
        setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
      } else {
        setSortBy(key);
        setSortDir('asc');
      }
    },
    [sortBy]
  );

  const resetColumns = useCallback(() => {
    resetWidths();
    resetOrder();
  }, [resetWidths, resetOrder]);

  return (
    <div className="space-y-4">
      <LeadUserTeamManager
        teams={teams}
        users={users.map((u) => ({
          id: u.id,
          name: u.name,
          email: u.email,
          role: u.role,
        }))}
        selectedTeamId={selectedTeamId}
        onSelectTeam={setSelectedTeamId}
      />
      <div className="flex items-center gap-3">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
          <input
            className="w-full rounded-lg border border-slate-200 bg-white pl-9 pr-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
            placeholder="Search by name or email..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <button
          type="button"
          onClick={resetColumns}
          title="Reset column widths and order"
          className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-[11px] font-semibold uppercase tracking-wider text-slate-500 transition-colors hover:border-blue-300 hover:bg-blue-50 hover:text-blue-700"
        >
          <RotateCcw className="h-3.5 w-3.5" />
          Reset columns
        </button>
        <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
          {sorted.length} user{sorted.length !== 1 ? 's' : ''}
          {selectedTeamId && (
            <span className="ml-1 normal-case font-medium text-slate-400">
              in{' '}
              <span className="font-semibold text-slate-600">
                {teams.find((t) => t.id === selectedTeamId)?.name ?? 'team'}
              </span>
            </span>
          )}
        </span>
      </div>

      {sorted.length === 0 ? (
        <div className="rounded-xl border border-slate-200 bg-white p-12 text-center shadow-sm">
          <Users className="mx-auto h-10 w-10 text-slate-300" />
          <p className="mt-3 text-sm font-semibold text-slate-700">No users found</p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-slate-200">
          <table className="w-full text-sm" style={{ tableLayout: 'fixed' }}>
            <colgroup>
              {orderedColumns.map((c) => (
                <col key={c.id} style={{ width: `${columnWidths[c.id]}px` }} />
              ))}
            </colgroup>
            <thead className="sticky top-0 z-[1] bg-slate-50">
              <tr className="border-b border-slate-200">
                {orderedColumns.map((c) => (
                  <UserSortableHeader
                    key={c.id}
                    colId={c.id}
                    label={c.label}
                    align={c.align}
                    title={c.title}
                    activeKey={sortBy}
                    activeDir={sortDir}
                    onSort={handleSort}
                    onStartResize={startResize(c.id, c.minWidth)}
                    isResizing={resizingCol === c.id}
                    isDragging={draggingColId === c.id}
                    dropIndicator={getDropIndicator(c.id)}
                    dragHandlers={getColHandlers(c.id)}
                  />
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {sorted.map((u) => (
                <tr
                  key={u.id}
                  className={`align-middle cursor-pointer transition-colors ${
                    selectedUserId === u.id ? 'bg-blue-50/60' : 'hover:bg-slate-50/70'
                  }`}
                  onClick={() => setSelectedUserId(u.id)}
                >
                  {orderedColumns.map((c) => (
                    <td
                      key={c.id}
                      className={getUserCellClassName(c.id)}
                      title={c.id === 'quotas' ? c.title : undefined}
                    >
                      {renderUserCell(c.id, u)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {selectedUser && (
        <UserDetailPanel
          user={selectedUser}
          allCampaigns={allCampaigns}
          services={services}
          manualServices={manualServices}
          onClose={() => setSelectedUserId(null)}
          onRefresh={() => router.refresh()}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sortable header (table-column aware of resize + drag-reorder)
// ---------------------------------------------------------------------------

function UserSortableHeader({
  colId,
  label,
  align = 'left',
  title,
  activeKey,
  activeDir,
  onSort,
  onStartResize,
  isResizing,
  isDragging,
  dropIndicator,
  dragHandlers,
}: {
  colId: UserColumnId;
  label: string;
  align?: 'left' | 'right' | 'center';
  title?: string;
  activeKey: UserSortKey;
  activeDir: SortDir;
  onSort: (key: UserSortKey) => void;
  onStartResize: (e: React.MouseEvent) => void;
  isResizing: boolean;
  isDragging: boolean;
  dropIndicator: DropIndicator;
  dragHandlers: ColumnDragHandlers;
}) {
  const isActive = activeKey === colId;
  const justify =
    align === 'right'
      ? 'justify-end'
      : align === 'center'
      ? 'justify-center'
      : 'justify-start';
  const textAlign =
    align === 'right'
      ? 'text-right'
      : align === 'center'
      ? 'text-center'
      : 'text-left';
  return (
    <th
      scope="col"
      className={`relative px-4 py-3 text-[11px] font-bold uppercase tracking-wider text-slate-500 overflow-hidden ${textAlign} ${
        isDragging ? 'opacity-40' : ''
      }`}
      onDragOver={dragHandlers.onDragOver}
      onDragLeave={dragHandlers.onDragLeave}
      onDrop={dragHandlers.onDrop}
      title={title}
    >
      <button
        type="button"
        onClick={() => onSort(colId)}
        draggable={dragHandlers.draggable}
        onDragStart={dragHandlers.onDragStart}
        onDragEnd={dragHandlers.onDragEnd}
        className={`inline-flex items-center gap-1.5 ${justify} w-full select-none rounded-md px-1.5 py-1 -mx-1.5 transition-colors hover:bg-slate-100 ${
          dragHandlers.draggable ? 'cursor-grab active:cursor-grabbing' : ''
        } ${isActive ? 'text-slate-900' : 'text-slate-500'}`}
        aria-label={`Sort by ${label}`}
      >
        <span className="truncate">{label}</span>
        {isActive ? (
          activeDir === 'asc' ? (
            <ChevronUp className="h-3.5 w-3.5 shrink-0 text-blue-600" />
          ) : (
            <ChevronDown className="h-3.5 w-3.5 shrink-0 text-blue-600" />
          )
        ) : (
          <ChevronsUpDown className="h-3.5 w-3.5 shrink-0 text-slate-300" />
        )}
      </button>
      {dropIndicator && (
        <div
          className={`absolute top-0 bottom-0 w-0.5 bg-blue-500 pointer-events-none ${
            dropIndicator === 'left' ? 'left-0' : 'right-0'
          }`}
        />
      )}
      <ResizeHandle
        label={label}
        onStartResize={onStartResize}
        isResizing={isResizing}
      />
    </th>
  );
}

// ---------------------------------------------------------------------------
// Per-column classNames / renderers for the users table
// ---------------------------------------------------------------------------

function getUserCellClassName(id: UserColumnId): string {
  const base = 'px-4 py-3 overflow-hidden';
  switch (id) {
    case 'name':
      return `${base} font-semibold text-slate-900 truncate`;
    case 'email':
      return `${base} text-slate-500 text-xs truncate`;
    case 'status':
      return `${base} text-center`;
    case 'states':
      return `${base} text-center text-xs text-slate-600 truncate`;
    case 'campaigns':
      return `${base} text-center text-slate-700`;
    case 'quotas':
      return `${base} text-center text-slate-700 tabular-nums text-xs font-medium`;
    case 'today':
    case 'week':
    case 'month':
    case 'ytd':
      return `${base} text-right tabular-nums`;
    default:
      return base;
  }
}

function renderUserCell(id: UserColumnId, u: LeadUser): React.ReactNode {
  switch (id) {
    case 'name':
      return u.name;
    case 'email':
      return u.email;
    case 'status':
      return (
        <span
          className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold ${
            u.leadsEnabled
              ? 'border border-green-200 bg-green-50 text-green-700'
              : 'border border-red-200 bg-red-50 text-red-600'
          }`}
        >
          {u.leadsEnabled ? 'On' : 'Off'}
        </span>
      );
    case 'states':
      return u.licensedStates.length > 0 ? u.licensedStates.join(', ') : 'All';
    case 'campaigns':
      return u.campaignCount;
    case 'quotas': {
      const daily = computeEffectiveQuota(
        u.globalDailyQuota,
        u.memberships,
        (m) => m.dailyQuota
      );
      const weekly = computeEffectiveQuota(
        u.globalWeeklyQuota,
        u.memberships,
        (m) => m.weeklyQuota
      );
      const monthly = computeEffectiveQuota(
        u.globalMonthlyQuota,
        u.memberships,
        (m) => m.monthlyQuota
      );
      return (
        <span className="whitespace-nowrap">
          {formatQuotaPart(daily)}
          <span className="text-slate-300 mx-0.5">/</span>
          {formatQuotaPart(weekly)}
          <span className="text-slate-300 mx-0.5">/</span>
          {formatQuotaPart(monthly)}
        </span>
      );
    }
    case 'today':
      return <UserCountCell value={u.leadsToday} />;
    case 'week':
      return <UserCountCell value={u.leadsWeek} />;
    case 'month':
      return <UserCountCell value={u.leadsMonth} />;
    case 'ytd':
      return <UserCountCell value={u.leadsYtd} />;
    default:
      return null;
  }
}

function UserCountCell({ value }: { value: number }) {
  return (
    <span className={value > 0 ? 'text-slate-800 font-medium' : 'text-slate-300'}>
      {value}
    </span>
  );
}

// ---------------------------------------------------------------------------
// User Detail Slide-Over
// ---------------------------------------------------------------------------

function UserDetailPanel({
  user,
  allCampaigns,
  services,
  manualServices,
  onClose,
  onRefresh,
}: {
  user: LeadUser;
  allCampaigns: CampaignOption[];
  services: LeadUserServiceSummary[];
  manualServices: LeadUserServiceSummary[];
  onClose: () => void;
  onRefresh: () => void;
}) {
  const [saving, setSaving] = useState(false);
  const [leadsEnabled, setLeadsEnabled] = useState(user.leadsEnabled);
  const [stateInput, setStateInput] = useState('');
  const [licensedStates, setLicensedStates] = useState<string[]>(user.licensedStates);
  const [bonzoWebhookUrl, setBonzoWebhookUrl] = useState(user.bonzoWebhookUrl || '');
  const [bonzoError, setBonzoError] = useState<string | null>(null);
  const [bonzoTesting, setBonzoTesting] = useState(false);
  // Inline "Send test" result badge. null = no badge; ok/error drive the
  // styling and get auto-dismissed after a few seconds.
  const [bonzoTestResult, setBonzoTestResult] = useState<
    | { kind: 'ok'; message: string }
    | { kind: 'error'; message: string }
    | null
  >(null);
  const bonzoTestTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (bonzoTestTimer.current) clearTimeout(bonzoTestTimer.current);
    };
  }, []);

  const handleSendBonzoTest = useCallback(async () => {
    if (bonzoTestTimer.current) clearTimeout(bonzoTestTimer.current);
    setBonzoTestResult(null);
    const trimmed = bonzoWebhookUrl.trim();
    const savedTrimmed = (user.bonzoWebhookUrl || '').trim();
    if (!trimmed) {
      setBonzoTestResult({ kind: 'error', message: 'Paste a Bonzo webhook URL first.' });
      return;
    }
    // The test action always hits the URL currently saved in the DB. If
    // the admin edited the field without saving yet, the test would use
    // the stale value - nudge them to save first rather than silently
    // test the wrong URL.
    if (trimmed !== savedTrimmed) {
      setBonzoTestResult({
        kind: 'error',
        message: 'Save the URL first, then click Send test.',
      });
      return;
    }
    setBonzoTesting(true);
    try {
      const res = await sendBonzoTestForUser(user.id);
      if (res.ok) {
        setBonzoTestResult({
          kind: 'ok',
          message: `${res.status} ${res.statusText || 'OK'} - Bonzo accepted the test prospect "Test Bonzo"`,
        });
      } else {
        const detail = res.bodyExcerpt?.trim()
          ? ` - ${res.bodyExcerpt.slice(0, 140)}`
          : '';
        setBonzoTestResult({
          kind: 'error',
          message: `${res.status || 'Network'} ${res.statusText || 'error'}${detail}`,
        });
      }
    } catch (err) {
      setBonzoTestResult({
        kind: 'error',
        message: err instanceof Error ? err.message : 'Could not send test',
      });
    } finally {
      setBonzoTesting(false);
      bonzoTestTimer.current = setTimeout(() => setBonzoTestResult(null), 10_000);
    }
  }, [bonzoWebhookUrl, user.bonzoWebhookUrl, user.id]);
  const [globalDaily, setGlobalDaily] = useState(user.globalDailyQuota);
  const [globalWeekly, setGlobalWeekly] = useState(user.globalWeeklyQuota);
  const [globalMonthly, setGlobalMonthly] = useState(user.globalMonthlyQuota);
  const [addingCampaign, setAddingCampaign] = useState(false);
  const [selectedCampaignIds, setSelectedCampaignIds] = useState<Set<string>>(new Set());
  const [campaignSearch, setCampaignSearch] = useState('');
  const campaignSearchRef = useRef<HTMLInputElement>(null);

  const availableCampaigns = useMemo(() => {
    const memberCampaignIds = new Set(user.memberships.map((m) => m.campaignId));
    return allCampaigns.filter((c) => !memberCampaignIds.has(c.id));
  }, [allCampaigns, user.memberships]);

  const filteredAvailableCampaigns = useMemo(() => {
    const q = campaignSearch.trim().toLowerCase();
    if (!q) return availableCampaigns;
    return availableCampaigns.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        c.vendorName.toLowerCase().includes(q)
    );
  }, [availableCampaigns, campaignSearch]);

  useEffect(() => {
    if (addingCampaign) {
      const t = window.setTimeout(() => campaignSearchRef.current?.focus(), 50);
      return () => window.clearTimeout(t);
    } else {
      setCampaignSearch('');
    }
  }, [addingCampaign]);

  const saveGlobalSettings = useCallback(async () => {
    const trimmed = bonzoWebhookUrl.trim();
    if (trimmed) {
      try {
        const parsed = new URL(trimmed);
        if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
          setBonzoError('URL must start with http:// or https://');
          return;
        }
      } catch {
        setBonzoError('Please enter a valid URL.');
        return;
      }
    }
    setBonzoError(null);
    setSaving(true);
    try {
      await updateUserLeadSettings(user.id, {
        leadsEnabled,
        licensedStates,
        bonzoWebhookUrl: trimmed || null,
        globalDailyQuota: globalDaily,
        globalWeeklyQuota: globalWeekly,
        globalMonthlyQuota: globalMonthly,
      });
      onRefresh();
    } finally {
      setSaving(false);
    }
  }, [user.id, leadsEnabled, licensedStates, bonzoWebhookUrl, globalDaily, globalWeekly, globalMonthly, onRefresh]);

  const addState = () => {
    const s = stateInput.trim().toUpperCase();
    if (s && !licensedStates.includes(s)) {
      setLicensedStates([...licensedStates, s]);
    }
    setStateInput('');
  };

  const removeState = (state: string) => {
    setLicensedStates(licensedStates.filter((s) => s !== state));
  };

  const toggleCampaignSelection = (id: string) => {
    setSelectedCampaignIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const handleAddCampaigns = async () => {
    if (selectedCampaignIds.size === 0) return;
    setSaving(true);
    try {
      for (const cid of selectedCampaignIds) {
        await addUserToCampaign(user.id, cid);
      }
      setSelectedCampaignIds(new Set());
      setAddingCampaign(false);
      onRefresh();
    } finally {
      setSaving(false);
    }
  };

  const isDirty =
    leadsEnabled !== user.leadsEnabled ||
    JSON.stringify(licensedStates) !== JSON.stringify(user.licensedStates) ||
    bonzoWebhookUrl.trim() !== (user.bonzoWebhookUrl || '').trim() ||
    globalDaily !== user.globalDailyQuota ||
    globalWeekly !== user.globalWeeklyQuota ||
    globalMonthly !== user.globalMonthlyQuota;

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center" onClick={onClose}>
      <div className="absolute inset-0 bg-slate-900/30 backdrop-blur-sm" />
      <div
        role="dialog"
        aria-modal="true"
        className="relative w-full max-w-2xl bg-white rounded-2xl shadow-xl border border-slate-200 max-h-[85vh] overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="border-b border-slate-200 px-6 py-4 bg-slate-50/50">
          <div className="flex items-start justify-between">
            <div>
              <h2 className="text-lg font-bold text-slate-900">{user.name}</h2>
              <p className="text-xs text-slate-500">{user.email}</p>
            </div>
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => {
                  setLeadsEnabled(!leadsEnabled);
                }}
                className={`relative inline-flex h-7 w-12 items-center rounded-full transition-colors ${
                  leadsEnabled ? 'bg-green-500' : 'bg-slate-300'
                }`}
              >
                <span className={`inline-block h-5 w-5 rounded-full bg-white shadow-sm transition-transform ${
                  leadsEnabled ? 'translate-x-6' : 'translate-x-1'
                }`} />
              </button>
              <span className={`text-xs font-bold ${leadsEnabled ? 'text-green-700' : 'text-slate-500'}`}>
                {leadsEnabled ? 'LEADS ON' : 'LEADS OFF'}
              </span>
              <button className="text-slate-400 hover:text-slate-600 p-1 hover:bg-slate-200 rounded ml-2" onClick={onClose} aria-label="Close">
                <X className="h-5 w-5" />
              </button>
            </div>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-6">
          {/* Bonzo Webhook URL */}
          <div>
            <div className="flex items-center mb-2">
              <p className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Bonzo Webhook URL</p>
              <InfoTip text="Every lead assigned to this user will be POSTed to this Bonzo webhook as JSON. Paste the full URL from Bonzo (e.g. https://api.getbonzo.com/...)." width={256} />
            </div>
            <p className="text-xs text-slate-400 mb-2">Forwards each newly-assigned lead into this user&apos;s Bonzo CRM.</p>
            <div className="flex items-stretch gap-2">
              <div className="relative flex-1">
                <Link2 className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                <input
                  type="url"
                  className={`w-full rounded-lg border bg-white pl-9 pr-3 py-2 text-sm focus:outline-none focus:ring-2 ${
                    bonzoError
                      ? 'border-red-300 focus:border-red-500 focus:ring-red-500/20'
                      : 'border-slate-200 focus:border-blue-500 focus:ring-blue-500/20'
                  }`}
                  placeholder="https://app.getbonzo.com/webhook/..."
                  value={bonzoWebhookUrl}
                  onChange={(e) => {
                    setBonzoWebhookUrl(e.target.value);
                    if (bonzoError) setBonzoError(null);
                  }}
                  spellCheck={false}
                  autoComplete="off"
                />
              </div>
              <button
                type="button"
                onClick={() => void handleSendBonzoTest()}
                disabled={bonzoTesting || !bonzoWebhookUrl.trim()}
                title="Post a synthetic test prospect to this URL so you can confirm Bonzo receives it"
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:border-blue-300 hover:bg-blue-50 hover:text-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {bonzoTesting ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Send className="h-4 w-4" />
                )}
                Send test
              </button>
            </div>
            {bonzoError && <p className="mt-1 text-xs text-red-600">{bonzoError}</p>}
            {bonzoTestResult && (
              <div
                className={`mt-2 flex items-start gap-2 rounded-lg border px-3 py-2 text-xs ${
                  bonzoTestResult.kind === 'ok'
                    ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
                    : 'border-rose-200 bg-rose-50 text-rose-800'
                }`}
                role="status"
              >
                {bonzoTestResult.kind === 'ok' ? (
                  <Check className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                ) : (
                  <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                )}
                <span className="flex-1 break-words">{bonzoTestResult.message}</span>
                <button
                  type="button"
                  onClick={() => setBonzoTestResult(null)}
                  className="text-current opacity-60 hover:opacity-100"
                  aria-label="Dismiss"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            )}
          </div>

          {/* Licensed States */}
          <div>
            <p className="text-[11px] font-bold uppercase tracking-wider text-slate-500 mb-2">Licensed States</p>
            <p className="text-xs text-slate-400 mb-2">Leave empty to receive leads from all states.</p>
            <div className="flex flex-wrap gap-1.5 mb-2">
              {licensedStates.map((s) => (
                <span
                  key={s}
                  className="inline-flex items-center gap-1 rounded-full border border-blue-200 bg-blue-50 px-2.5 py-1 text-xs font-semibold text-blue-700"
                >
                  {s}
                  <button type="button" onClick={() => removeState(s)} className="text-blue-400 hover:text-red-500 transition-colors">
                    <X className="h-3 w-3" />
                  </button>
                </span>
              ))}
              {licensedStates.length === 0 && (
                <span className="text-xs text-slate-400 italic">All states</span>
              )}
            </div>
            <div className="flex gap-2">
              <input
                className="flex-1 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm uppercase focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                placeholder="e.g. WA"
                maxLength={2}
                value={stateInput}
                onChange={(e) => setStateInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && addState()}
              />
              <button type="button" className="app-btn-primary h-[38px] px-3 text-sm" onClick={addState}>
                <Plus className="h-4 w-4" />
              </button>
            </div>
          </div>

          {/* Global Quotas */}
          <div>
            <p className="text-[11px] font-bold uppercase tracking-wider text-slate-500 mb-2">Global Quotas</p>
            <p className="text-xs text-slate-400 mb-3">Caps across all campaigns. 0 = unlimited.</p>
            <div className="grid grid-cols-3 gap-3">
              <label className="space-y-1">
                <span className="text-xs font-medium text-slate-600">Daily</span>
                <input
                  type="number"
                  min={0}
                  className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-center focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                  value={globalDaily}
                  onChange={(e) => setGlobalDaily(Number(e.target.value) || 0)}
                />
              </label>
              <label className="space-y-1">
                <span className="text-xs font-medium text-slate-600">Weekly</span>
                <input
                  type="number"
                  min={0}
                  className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-center focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                  value={globalWeekly}
                  onChange={(e) => setGlobalWeekly(Number(e.target.value) || 0)}
                />
              </label>
              <label className="space-y-1">
                <span className="text-xs font-medium text-slate-600">Monthly</span>
                <input
                  type="number"
                  min={0}
                  className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-center focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                  value={globalMonthly}
                  onChange={(e) => setGlobalMonthly(Number(e.target.value) || 0)}
                />
              </label>
            </div>

            {user.memberships.length > 0 && (() => {
              const totalCampaignDaily = user.memberships.reduce((sum, m) => sum + m.dailyQuota, 0);
              const hasUnlimited = user.memberships.some((m) => m.dailyQuota === 0);
              const overGlobal = globalDaily > 0 && !hasUnlimited && totalCampaignDaily > globalDaily;
              return (
                <div className={`mt-3 rounded-lg px-3 py-2.5 text-xs ${
                  overGlobal
                    ? 'bg-amber-50 border border-amber-200'
                    : 'bg-slate-50 border border-slate-200'
                }`}>
                  <div className="flex items-center justify-between">
                    <span className="font-medium text-slate-600">Campaign Daily Quota Total</span>
                    <span className={`font-bold ${overGlobal ? 'text-amber-700' : 'text-slate-800'}`}>
                      {hasUnlimited ? (
                        <span className="text-slate-400 font-medium italic">Includes unlimited</span>
                      ) : (
                        <>
                          {totalCampaignDaily}
                          {globalDaily > 0 && (
                            <span className="text-slate-400 font-normal ml-1">/ {globalDaily} global</span>
                          )}
                        </>
                      )}
                    </span>
                  </div>
                  {overGlobal && (
                    <p className="mt-1 text-amber-600">
                      Campaign quotas exceed global cap — global limit will take priority.
                    </p>
                  )}
                </div>
              );
            })()}
          </div>

          {/* Save global settings */}
          {isDirty && (
            <button
              type="button"
              className="app-btn-primary w-full text-sm disabled:opacity-70 disabled:cursor-not-allowed"
              onClick={() => void saveGlobalSettings()}
              disabled={saving}
            >
              {saving && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
              Save Settings
            </button>
          )}

          {/* Integration Service credentials */}
          <UserIntegrationCredentialsSection
            userId={user.id}
            services={services}
            initialCredentials={user.serviceCredentials ?? []}
            onRefresh={onRefresh}
          />

          {/* Per-user service permissions (LO "Push to Service" allow list) */}
          <UserServicePermissionsSection
            userId={user.id}
            manualServices={manualServices}
            initialAllowedIds={user.allowedServiceIds ?? []}
            onRefresh={onRefresh}
          />

          {/* Campaigns */}
          <div>
            <p className="text-[11px] font-bold uppercase tracking-wider text-slate-500 mb-3">
              Campaigns ({user.memberships.length})
            </p>

            {user.memberships.length === 0 ? (
              <p className="text-xs text-slate-400 text-center py-4">Not assigned to any campaigns.</p>
            ) : (
              <div className="space-y-2">
                {user.memberships.map((m) => (
                  <MembershipRow key={m.id} membership={m} onRefresh={onRefresh} />
                ))}
              </div>
            )}

            {!addingCampaign && (
              <button
                type="button"
                className={`mt-3 flex w-full items-center justify-center gap-2 rounded-xl py-3 text-sm font-semibold transition-colors ${
                  availableCampaigns.length > 0
                    ? 'bg-blue-600 text-white shadow-sm hover:bg-blue-700'
                    : 'bg-slate-200 text-slate-400 cursor-not-allowed'
                }`}
                onClick={() => availableCampaigns.length > 0 && setAddingCampaign(true)}
                disabled={availableCampaigns.length === 0}
              >
                <Plus className="h-4 w-4" />
                {availableCampaigns.length > 0 ? 'Add Campaign' : 'Already in all campaigns'}
              </button>
            )}

            {addingCampaign && (
              <div className="mt-3 space-y-3">
                <p className="text-xs font-medium text-slate-600">Select campaigns to add:</p>
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400 pointer-events-none" />
                  <input
                    ref={campaignSearchRef}
                    type="text"
                    value={campaignSearch}
                    onChange={(e) => setCampaignSearch(e.target.value)}
                    placeholder="Search campaigns by name or vendor..."
                    className="w-full rounded-xl border border-slate-200 bg-white pl-9 pr-9 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                  />
                  {campaignSearch && (
                    <button
                      type="button"
                      onClick={() => {
                        setCampaignSearch('');
                        campaignSearchRef.current?.focus();
                      }}
                      className="absolute right-2 top-1/2 -translate-y-1/2 flex h-6 w-6 items-center justify-center rounded-md text-slate-400 hover:bg-slate-100 hover:text-slate-600"
                      aria-label="Clear campaign search"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
                <div className="rounded-xl border border-slate-200 bg-white overflow-hidden divide-y divide-slate-100 max-h-72 overflow-y-auto">
                  {filteredAvailableCampaigns.length === 0 ? (
                    <div className="px-4 py-6 text-center text-sm text-slate-500">
                      No campaigns match &ldquo;{campaignSearch}&rdquo;
                    </div>
                  ) : (
                    filteredAvailableCampaigns.map((c) => {
                      const checked = selectedCampaignIds.has(c.id);
                      return (
                        <button
                          key={c.id}
                          type="button"
                          onClick={() => toggleCampaignSelection(c.id)}
                          className={`w-full flex items-center gap-3 px-4 py-3 text-left transition-colors ${
                            checked ? 'bg-blue-50' : 'hover:bg-slate-50'
                          }`}
                        >
                          <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded border text-xs transition-colors ${
                            checked
                              ? 'border-blue-500 bg-blue-500 text-white'
                              : 'border-slate-300 bg-white'
                          }`}>
                            {checked && <Check className="h-3.5 w-3.5" />}
                          </span>
                          <div className="min-w-0">
                            <p className="text-sm font-semibold text-slate-900 truncate">{c.name}</p>
                            <p className="text-[11px] text-slate-500">{c.vendorName}</p>
                          </div>
                        </button>
                      );
                    })
                  )}
                </div>
                {campaignSearch && filteredAvailableCampaigns.length > 0 && (
                  <p className="text-[11px] text-slate-500">
                    Showing {filteredAvailableCampaigns.length} of {availableCampaigns.length} campaigns
                  </p>
                )}
                <div className="flex gap-2">
                  <button
                    type="button"
                    className="flex-1 flex items-center justify-center gap-2 rounded-xl bg-blue-600 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-blue-700 disabled:opacity-60 disabled:cursor-not-allowed"
                    onClick={() => void handleAddCampaigns()}
                    disabled={saving || selectedCampaignIds.size === 0}
                  >
                    {saving && <Loader2 className="h-4 w-4 animate-spin" />}
                    Add to Campaign{selectedCampaignIds.size > 1 ? 's' : ''} ({selectedCampaignIds.size})
                  </button>
                  <button
                    type="button"
                    className="app-btn-secondary text-sm"
                    onClick={() => { setAddingCampaign(false); setSelectedCampaignIds(new Set()); }}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Individual Campaign Membership Row
// ---------------------------------------------------------------------------

function MembershipRow({
  membership: m,
  onRefresh,
}: {
  membership: Membership;
  onRefresh: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [dailyQuota, setDailyQuota] = useState(m.dailyQuota);
  const [receiveDays, setReceiveDays] = useState<number[]>(m.receiveDays);
  const [active, setActive] = useState(m.active);

  const isDirty =
    dailyQuota !== m.dailyQuota ||
    JSON.stringify(receiveDays) !== JSON.stringify(m.receiveDays) ||
    active !== m.active;

  const toggleDay = (day: number) => {
    setReceiveDays((prev) =>
      prev.includes(day) ? prev.filter((d) => d !== day) : [...prev, day].sort()
    );
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await updateMemberSettings(m.id, { dailyQuota, receiveDays, active });
      onRefresh();
    } finally {
      setSaving(false);
    }
  };

  const handleRemove = async () => {
    if (!window.confirm(`Remove from "${m.campaignName}"?`)) return;
    setSaving(true);
    try {
      await removeUserFromCampaign(m.id);
      onRefresh();
    } finally {
      setSaving(false);
    }
  };

  const daysSummary = receiveDays.length === 7
    ? 'Every day'
    : receiveDays.length === 5 && [1, 2, 3, 4, 5].every((d) => receiveDays.includes(d))
    ? 'Weekdays'
    : receiveDays.length === 0
    ? 'No days'
    : receiveDays.map((d) => DAY_LABELS[d]).join(', ');

  return (
    <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
      <button
        type="button"
        className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-slate-50/70 transition-colors"
        onClick={() => setExpanded(!expanded)}
      >
        {expanded ? (
          <ChevronDown className="h-4 w-4 text-slate-400 shrink-0" />
        ) : (
          <ChevronRight className="h-4 w-4 text-slate-400 shrink-0" />
        )}
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-slate-900 truncate">{m.campaignName}</p>
          <p className="text-[11px] text-slate-500">{m.vendorName}</p>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          <span className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-bold ${
            active
              ? 'border border-green-200 bg-green-50 text-green-700'
              : 'border border-slate-200 bg-slate-100 text-slate-500'
          }`}>
            {active ? 'Active' : 'Paused'}
          </span>
          <span className="text-xs text-slate-500">{dailyQuota > 0 ? `${dailyQuota}/day` : 'Unlimited'}</span>
          <span className="text-[10px] text-slate-400">{daysSummary}</span>
        </div>
      </button>

      {expanded && (
        <div className="border-t border-slate-200 px-4 py-4 bg-slate-50/30 space-y-4">
          <div className="flex items-center gap-4">
            <label className="flex items-center gap-2 text-sm text-slate-700">
              <input
                type="checkbox"
                className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                checked={active}
                onChange={(e) => setActive(e.target.checked)}
              />
              Active in this campaign
            </label>
            <div className="flex-1" />
            <span className="text-xs text-slate-500">
              {m.leadsReceivedToday} leads today
            </span>
          </div>

          <div>
            <span className="text-xs font-medium text-slate-600 mb-1.5 block">Daily Quota</span>
            <div className="flex items-center gap-2">
              <input
                type="number"
                min={0}
                className="w-24 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-center focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                value={dailyQuota}
                onChange={(e) => setDailyQuota(Number(e.target.value) || 0)}
              />
              <span className="text-xs text-slate-400">0 = unlimited</span>
            </div>
          </div>

          <div>
            <span className="text-xs font-medium text-slate-600 mb-1.5 block">Receive Days</span>
            <div className="flex gap-1.5">
              {DAY_LABELS.map((label, idx) => (
                <button
                  key={idx}
                  type="button"
                  onClick={() => toggleDay(idx)}
                  className={`h-9 w-11 rounded-lg text-xs font-semibold transition-colors ${
                    receiveDays.includes(idx)
                      ? 'bg-blue-600 text-white shadow-sm'
                      : 'border border-slate-200 bg-white text-slate-500 hover:bg-slate-50'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
            <div className="flex gap-2 mt-2">
              <button
                type="button"
                className="text-[11px] text-blue-600 hover:text-blue-700 font-medium"
                onClick={() => setReceiveDays([1, 2, 3, 4, 5])}
              >
                Weekdays
              </button>
              <button
                type="button"
                className="text-[11px] text-blue-600 hover:text-blue-700 font-medium"
                onClick={() => setReceiveDays([0, 1, 2, 3, 4, 5, 6])}
              >
                Every Day
              </button>
              <button
                type="button"
                className="text-[11px] text-slate-500 hover:text-slate-700 font-medium"
                onClick={() => setReceiveDays([])}
              >
                None
              </button>
            </div>
          </div>

          <div className="flex items-center justify-between pt-2 border-t border-slate-200">
            <button
              type="button"
              className="text-xs font-medium text-red-500 hover:text-red-700 transition-colors flex items-center gap-1"
              onClick={() => void handleRemove()}
              disabled={saving}
            >
              <Trash2 className="h-3.5 w-3.5" />
              Remove from Campaign
            </button>
            {isDirty && (
              <button
                type="button"
                className="app-btn-primary h-8 px-4 text-xs disabled:opacity-70"
                onClick={() => void handleSave()}
                disabled={saving}
              >
                {saving && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />}
                Save
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Integration service credentials (per-user secrets, webhook URLs, etc.)
// ---------------------------------------------------------------------------

function UserIntegrationCredentialsSection({
  userId,
  services,
  initialCredentials,
  onRefresh,
}: {
  userId: string;
  services: LeadUserServiceSummary[];
  initialCredentials: Array<{ serviceId: string; values: Record<string, string> }>;
  onRefresh: () => void;
}) {
  const servicesWithFields = useMemo(
    () => services.filter((s) => s.credentialFields.length > 0),
    [services]
  );

  if (servicesWithFields.length === 0) return null;

  return (
    <div>
      <div className="flex items-center mb-2">
        <p className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
          Services ({servicesWithFields.length})
        </p>
        <InfoTip
          text="Per-user values for each integration service. Templates on the Service builder reference these via {{user.credentials.KEY}}."
          width={300}
        />
      </div>
      <p className="text-xs text-slate-400 mb-3">
        Credentials this user supplies for outbound integrations.
      </p>
      <div className="space-y-2">
        {servicesWithFields.map((svc) => {
          const current =
            initialCredentials.find((c) => c.serviceId === svc.id)?.values ?? {};
          return (
            <UserServiceCredentialRow
              key={svc.id}
              userId={userId}
              service={svc}
              initialValues={current}
              onSaved={onRefresh}
            />
          );
        })}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Service permissions (LO "Push to Service" allow list)
// ---------------------------------------------------------------------------

function UserServicePermissionsSection({
  userId,
  manualServices,
  initialAllowedIds,
  onRefresh,
}: {
  userId: string;
  manualServices: LeadUserServiceSummary[];
  initialAllowedIds: string[];
  onRefresh: () => void;
}) {
  const initialSet = useMemo(
    () => new Set(initialAllowedIds),
    [initialAllowedIds]
  );
  const [selected, setSelected] = useState<Set<string>>(initialSet);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Re-sync when a different user row is opened — otherwise the checklist
  // would keep showing the previous user's selection.
  useEffect(() => {
    setSelected(new Set(initialAllowedIds));
    setError(null);
  }, [initialAllowedIds, userId]);

  const isDirty = useMemo(() => {
    if (selected.size !== initialSet.size) return true;
    for (const id of selected) if (!initialSet.has(id)) return true;
    return false;
  }, [initialSet, selected]);

  const toggle = useCallback((id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const handleSave = useCallback(async () => {
    setError(null);
    setSaving(true);
    try {
      await setUserIntegrationServicePermissions(
        userId,
        Array.from(selected)
      );
      onRefresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  }, [onRefresh, selected, userId]);

  if (manualServices.length === 0) return null;

  return (
    <div>
      <div className="flex items-center mb-2">
        <p className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
          Service permissions ({manualServices.length})
        </p>
        <InfoTip
          text="Which services this user can manually send their leads to. Unchecked services won't appear in their Push to Service picker."
          width={320}
        />
      </div>
      <p className="text-xs text-slate-400 mb-3">
        Check every service this user is allowed to push leads to.
      </p>
      <div className="rounded-lg border border-slate-200 bg-white divide-y divide-slate-100">
        {manualServices.map((svc) => {
          const checked = selected.has(svc.id);
          return (
            <label
              key={svc.id}
              className="flex items-start gap-3 px-3 py-2 cursor-pointer hover:bg-slate-50"
            >
              <input
                type="checkbox"
                className="mt-1 h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                checked={checked}
                onChange={() => toggle(svc.id)}
              />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-sm text-slate-900 truncate">
                    {svc.name}
                  </span>
                  <span className="text-[11px] font-mono text-slate-400">
                    {svc.slug}
                  </span>
                </div>
                {svc.description && (
                  <p className="text-xs text-slate-500 truncate">
                    {svc.description}
                  </p>
                )}
              </div>
            </label>
          );
        })}
      </div>
      {error && (
        <p className="mt-2 text-xs font-medium text-red-600">{error}</p>
      )}
      <div className="mt-3 flex items-center justify-end gap-2">
        {isDirty && (
          <button
            type="button"
            className="text-xs font-medium text-slate-500 hover:text-slate-700"
            onClick={() => setSelected(new Set(initialAllowedIds))}
            disabled={saving}
          >
            Reset
          </button>
        )}
        <button
          type="button"
          className="app-btn-primary text-sm disabled:opacity-60 disabled:cursor-not-allowed"
          onClick={() => void handleSave()}
          disabled={!isDirty || saving}
        >
          {saving && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
          Save permissions
        </button>
      </div>
    </div>
  );
}

function UserServiceCredentialRow({
  userId,
  service,
  initialValues,
  onSaved,
}: {
  userId: string;
  service: LeadUserServiceSummary;
  initialValues: Record<string, string>;
  onSaved: () => void;
}) {
  const [values, setValues] = useState<Record<string, string>>(() => {
    const out: Record<string, string> = {};
    for (const f of service.credentialFields) {
      out[f.key] = initialValues[f.key] ?? '';
    }
    return out;
  });
  const [expanded, setExpanded] = useState<boolean>(() =>
    service.credentialFields.some((f) => f.required && !initialValues[f.key])
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isDirty = useMemo(() => {
    for (const f of service.credentialFields) {
      const cur = (values[f.key] ?? '').trim();
      const prev = (initialValues[f.key] ?? '').trim();
      if (cur !== prev) return true;
    }
    return false;
  }, [initialValues, service.credentialFields, values]);

  const handleSave = useCallback(async () => {
    setError(null);
    for (const f of service.credentialFields) {
      if (f.required && !(values[f.key] ?? '').trim()) {
        setError(`"${f.label}" is required.`);
        return;
      }
    }
    setSaving(true);
    try {
      await upsertUserIntegrationCredential({
        userId,
        serviceId: service.id,
        values,
      });
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  }, [onSaved, service.credentialFields, service.id, userId, values]);

  const filledCount = service.credentialFields.filter((f) =>
    (values[f.key] ?? '').trim()
  ).length;

  return (
    <div className="rounded-lg border border-slate-200 bg-white">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left hover:bg-slate-50"
        aria-expanded={expanded}
      >
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-semibold text-sm text-slate-900 truncate">
              {service.name}
            </span>
            <span className="text-[11px] font-mono text-slate-400">
              {service.slug}
            </span>
          </div>
          {service.description && (
            <p className="text-xs text-slate-500 truncate">
              {service.description}
            </p>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span
            className={`inline-flex rounded-full border px-2 py-0.5 text-[11px] font-semibold ${
              filledCount === service.credentialFields.length
                ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                : filledCount > 0
                  ? 'border-amber-200 bg-amber-50 text-amber-700'
                  : 'border-slate-200 bg-slate-50 text-slate-500'
            }`}
          >
            {filledCount}/{service.credentialFields.length} filled
          </span>
          {expanded ? (
            <ChevronUp className="h-4 w-4 text-slate-400" />
          ) : (
            <ChevronDown className="h-4 w-4 text-slate-400" />
          )}
        </div>
      </button>

      {expanded && (
        <div className="border-t border-slate-200 px-3 py-3 space-y-2">
          {service.credentialFields.map((f) => (
            <label key={f.id} className="block space-y-1 text-sm">
              <span className="flex items-center gap-1 text-xs font-medium text-slate-600">
                {f.label}
                {f.required && <span className="text-rose-600">*</span>}
                {f.helpText && <InfoTip text={f.helpText} width={260} />}
              </span>
              <input
                type={f.secret ? 'password' : 'text'}
                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-mono focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                value={values[f.key] ?? ''}
                onChange={(e) =>
                  setValues((v) => ({ ...v, [f.key]: e.target.value }))
                }
                placeholder={f.placeholder ?? ''}
                spellCheck={false}
                autoComplete="off"
              />
            </label>
          ))}
          {error && (
            <div className="rounded-md border border-rose-200 bg-rose-50 px-2.5 py-1.5 text-xs text-rose-700">
              {error}
            </div>
          )}
          {isDirty && (
            <div className="flex items-center justify-end pt-1">
              <button
                type="button"
                className="app-btn-primary h-8 px-4 text-xs disabled:opacity-70"
                onClick={() => void handleSave()}
                disabled={saving}
              >
                {saving && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />}
                Save
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
