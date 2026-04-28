'use client';

import React, {
  useCallback,
  useEffect,
  useMemo,
  useState,
  useTransition,
} from 'react';
import {
  ChevronDown,
  ChevronRight,
  Crown,
  Hand,
  Info,
  RefreshCw,
  UserX,
} from 'lucide-react';
import {
  getCampaignNextUpRoster,
  type CampaignNextUpRow,
} from '@/app/actions/leadActions';

type Props = {
  initialRoster: CampaignNextUpRow[];
  filterGroupId: string | null;
};

// NOTE: The panel's top-level collapsed state is intentionally NOT
// persisted - it always starts collapsed on page load / refresh / return
// so the Campaigns screen stays compact by default. Only the per-vendor
// open state (after the admin expands the panel) is persisted.
const STORAGE_KEY_VENDORS = 'ffl.campaignNextUp.vendorOpen';
const REFRESH_MS = 30_000;
const NONE_GROUP = '__none__';

// Keyed on lowercased vendor slug. Unknown vendors fall through to slate.
const VENDOR_COLORS: Record<
  string,
  { dot: string; bg: string; pill: string; text: string }
> = {
  lendingtree: {
    dot: 'bg-emerald-500',
    bg: 'bg-emerald-50/50',
    pill: 'bg-emerald-100 text-emerald-800 ring-emerald-200',
    text: 'text-emerald-700',
  },
  freerateupdate: {
    dot: 'bg-blue-500',
    bg: 'bg-blue-50/50',
    pill: 'bg-blue-100 text-blue-800 ring-blue-200',
    text: 'text-blue-700',
  },
  leadpoint: {
    dot: 'bg-amber-500',
    bg: 'bg-amber-50/50',
    pill: 'bg-amber-100 text-amber-800 ring-amber-200',
    text: 'text-amber-700',
  },
  lendgo: {
    dot: 'bg-violet-500',
    bg: 'bg-violet-50/50',
    pill: 'bg-violet-100 text-violet-800 ring-violet-200',
    text: 'text-violet-700',
  },
};
const VENDOR_FALLBACK = {
  dot: 'bg-slate-400',
  bg: 'bg-slate-50',
  pill: 'bg-slate-100 text-slate-700 ring-slate-200',
  text: 'text-slate-600',
};

function vendorColor(slug: string) {
  return VENDOR_COLORS[slug.toLowerCase()] ?? VENDOR_FALLBACK;
}

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

type VendorGroup = {
  slug: string;
  name: string;
  rows: CampaignNextUpRow[];
  readyCount: number;
  fallbackCount: number;
};

export function CampaignNextUpPanel({ initialRoster, filterGroupId }: Props) {
  const [roster, setRoster] = useState<CampaignNextUpRow[]>(initialRoster);
  // Always start collapsed on mount / refresh / navigation. The
  // top-level state is session-only by design (see note above the
  // STORAGE_KEY_VENDORS constant).
  const [collapsed, setCollapsed] = useState<boolean>(true);
  // Map of vendorSlug -> whether the vendor section is open. Vendors
  // default to collapsed so the panel never stretches down the screen
  // the moment the top-level is expanded. Admin opens the vendor they
  // care about. Hydrated lazily from localStorage so the preference
  // survives refreshes even though the top-level collapsed state does
  // not.
  const [vendorOpen, setVendorOpen] = useState<Record<string, boolean>>(() => {
    if (typeof window === 'undefined') return {};
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY_VENDORS);
      if (!raw) return {};
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as Record<string, boolean>;
      }
      return {};
    } catch {
      return {};
    }
  });
  const [lastRefreshedAt, setLastRefreshedAt] = useState<Date>(new Date());
  const [isPending, startTransition] = useTransition();

  const toggleVendor = useCallback((slug: string) => {
    setVendorOpen((prev) => {
      const next = { ...prev, [slug]: !prev[slug] };
      try {
        window.localStorage.setItem(STORAGE_KEY_VENDORS, JSON.stringify(next));
      } catch {
        /* ignore */
      }
      return next;
    });
  }, []);

  const refresh = useCallback(() => {
    startTransition(async () => {
      try {
        const next = await getCampaignNextUpRoster();
        setRoster(next);
        setLastRefreshedAt(new Date());
      } catch (err) {
        console.warn('[CampaignNextUpPanel] refresh failed:', err);
      }
    });
  }, []);

  useEffect(() => {
    const id = window.setInterval(() => {
      if (document.visibilityState === 'visible') refresh();
    }, REFRESH_MS);
    const onVisible = () => {
      if (document.visibilityState === 'visible') refresh();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.clearInterval(id);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [refresh]);

  const filtered = useMemo(() => {
    if (filterGroupId === null) return roster;
    if (filterGroupId === NONE_GROUP) {
      return roster.filter((r) => !r.groupId);
    }
    return roster.filter((r) => r.groupId === filterGroupId);
  }, [roster, filterGroupId]);

  // Group filtered rows by vendor slug. Vendors appear in first-seen
  // order (the roster is already sorted by vendor.name asc server-side).
  const vendorGroups: VendorGroup[] = useMemo(() => {
    const map = new Map<string, VendorGroup>();
    for (const row of filtered) {
      const existing = map.get(row.vendorSlug);
      if (existing) {
        existing.rows.push(row);
        if (row.upNext.kind === 'MEMBER') existing.readyCount++;
        else existing.fallbackCount++;
      } else {
        map.set(row.vendorSlug, {
          slug: row.vendorSlug,
          name: row.vendorName,
          rows: [row],
          readyCount: row.upNext.kind === 'MEMBER' ? 1 : 0,
          fallbackCount: row.upNext.kind === 'MEMBER' ? 0 : 1,
        });
      }
    }
    return Array.from(map.values());
  }, [filtered]);

  const totalReady = useMemo(
    () => filtered.filter((r) => r.upNext.kind === 'MEMBER').length,
    [filtered]
  );

  const anyVendorOpen = vendorGroups.some((g) => vendorOpen[g.slug]);

  const expandAll = useCallback(() => {
    const next: Record<string, boolean> = {};
    for (const g of vendorGroups) next[g.slug] = true;
    setVendorOpen(next);
    try {
      window.localStorage.setItem(STORAGE_KEY_VENDORS, JSON.stringify(next));
    } catch {
      /* ignore */
    }
  }, [vendorGroups]);

  const collapseAll = useCallback(() => {
    setVendorOpen({});
    try {
      window.localStorage.setItem(STORAGE_KEY_VENDORS, JSON.stringify({}));
    } catch {
      /* ignore */
    }
  }, []);

  return (
    // Cap the panel at ~half a standard laptop viewport so rows cluster
    // close together and don't stretch out to a 1500px-wide line. Still
    // responsive on narrower screens since max-w-3xl tops out at 768px.
    <div className="rounded-xl border border-slate-200 bg-white shadow-sm max-w-3xl">
      <button
        type="button"
        onClick={() => setCollapsed((c) => !c)}
        className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-slate-50 rounded-t-xl transition-colors"
        aria-expanded={!collapsed}
        aria-controls="campaign-next-up-body"
      >
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-50 text-blue-600">
          <Crown className="h-4 w-4" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-semibold text-slate-900">Up Next</h2>
            <span className="text-[11px] font-medium text-slate-500">
              {filtered.length} campaign{filtered.length === 1 ? '' : 's'}
              {filtered.length > 0 && (
                <>
                  {' '}
                  &middot; {totalReady} ready &middot;{' '}
                  {filtered.length - totalReady} needs attention
                </>
              )}
            </span>
          </div>
          <p className="text-xs text-slate-500">
            Click a vendor to reveal its campaigns and the LO who&apos;d get
            the next lead right now.
          </p>
        </div>
        <span
          className="inline-flex items-center gap-1 text-[11px] text-slate-400"
          title={`Last refreshed ${lastRefreshedAt.toLocaleTimeString()}`}
          onClick={(e) => {
            e.stopPropagation();
            refresh();
          }}
          role="button"
          tabIndex={-1}
        >
          <RefreshCw
            className={`h-3 w-3 ${isPending ? 'animate-spin text-blue-500' : ''}`}
          />
          {lastRefreshedAt.toLocaleTimeString([], {
            hour: '2-digit',
            minute: '2-digit',
          })}
        </span>
        <ChevronDown
          className={`h-4 w-4 text-slate-400 transition-transform ${
            collapsed ? '' : 'rotate-180'
          }`}
        />
      </button>

      {!collapsed && (
        <div id="campaign-next-up-body" className="border-t border-slate-100">
          {filtered.length === 0 ? (
            <div className="py-6 text-center text-sm text-slate-500">
              No active campaigns match this filter.
            </div>
          ) : (
            <>
              <div className="flex items-center justify-end gap-1 border-b border-slate-100 px-4 py-1.5 text-[11px] font-medium text-slate-500">
                <button
                  type="button"
                  onClick={expandAll}
                  disabled={vendorGroups.every((g) => vendorOpen[g.slug])}
                  className="rounded px-2 py-1 hover:bg-slate-100 hover:text-slate-700 transition-colors disabled:opacity-40 disabled:hover:bg-transparent"
                >
                  Expand all
                </button>
                <span className="text-slate-300">|</span>
                <button
                  type="button"
                  onClick={collapseAll}
                  disabled={!anyVendorOpen}
                  className="rounded px-2 py-1 hover:bg-slate-100 hover:text-slate-700 transition-colors disabled:opacity-40 disabled:hover:bg-transparent"
                >
                  Collapse all
                </button>
              </div>
              <ul className="divide-y divide-slate-100">
                {vendorGroups.map((group) => (
                  <VendorSection
                    key={group.slug}
                    group={group}
                    open={!!vendorOpen[group.slug]}
                    onToggle={() => toggleVendor(group.slug)}
                  />
                ))}
              </ul>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function VendorSection({
  group,
  open,
  onToggle,
}: {
  group: VendorGroup;
  open: boolean;
  onToggle: () => void;
}) {
  const palette = vendorColor(group.slug);
  return (
    <li>
      <button
        type="button"
        onClick={onToggle}
        className={`w-full flex items-center gap-3 px-4 py-2.5 text-left hover:bg-slate-50 transition-colors ${
          open ? palette.bg : ''
        }`}
        aria-expanded={open}
      >
        <ChevronRight
          className={`h-4 w-4 text-slate-400 transition-transform ${
            open ? 'rotate-90' : ''
          }`}
        />
        <span
          className={`inline-block h-2.5 w-2.5 rounded-full ${palette.dot}`}
          aria-hidden="true"
        />
        <span className="text-sm font-semibold text-slate-900 flex-1 min-w-0 truncate">
          {group.name}
        </span>
        <span className={`text-[11px] font-medium ${palette.text}`}>
          {group.rows.length} campaign{group.rows.length === 1 ? '' : 's'}
        </span>
        <span className="text-[11px] text-slate-400">
          &middot; {group.readyCount} ready
          {group.fallbackCount > 0 && (
            <>
              {' '}
              &middot;{' '}
              <span className="text-amber-600">
                {group.fallbackCount} needs attention
              </span>
            </>
          )}
        </span>
      </button>

      {open && (
        <ul className="divide-y divide-slate-100 border-t border-slate-100 bg-white">
          {group.rows.map((row) => (
            <CampaignRow key={row.campaignId} row={row} palette={palette} />
          ))}
        </ul>
      )}
    </li>
  );
}

function CampaignRow({
  row,
  palette,
}: {
  row: CampaignNextUpRow;
  palette: ReturnType<typeof vendorColor>;
}) {
  const roster = row.upNext.roster;
  // Every campaign with a roster is expandable now — clicking reveals
  // the full lineup with per-member quota status, not just the members
  // who were gated out. Before the live-count fix this was implicitly
  // only the skip list, which vanished once quotas started behaving.
  const canExpand = roster.length > 0;
  const [open, setOpen] = useState(false);

  return (
    <li className="border-b border-slate-100 last:border-b-0">
      <div
        className={`flex items-center gap-3 px-4 py-2 transition-colors ${
          canExpand ? 'hover:bg-slate-50 cursor-pointer' : ''
        }`}
        onClick={canExpand ? () => setOpen((o) => !o) : undefined}
        role={canExpand ? 'button' : undefined}
        aria-expanded={canExpand ? open : undefined}
      >
        {canExpand ? (
          <ChevronRight
            className={`h-3.5 w-3.5 text-slate-400 transition-transform ml-3 shrink-0 ${
              open ? 'rotate-90' : ''
            }`}
          />
        ) : (
          <span
            className={`inline-block h-1.5 w-1.5 rounded-full ${palette.dot} ml-5 shrink-0`}
            aria-hidden="true"
          />
        )}
        <span
          className="text-sm text-slate-800 flex-1 min-w-0 truncate"
          title={row.campaignName}
        >
          {row.campaignName}
        </span>
        <span className="text-[10px] text-slate-400 hidden sm:inline-block shrink-0">
          {row.memberCount} LO{row.memberCount === 1 ? '' : 's'}
        </span>
        <UpNextInline upNext={row.upNext} />
      </div>
      {canExpand && open && <RosterBreakdown roster={roster} />}
    </li>
  );
}

function RosterBreakdown({
  roster,
}: {
  roster: CampaignNextUpRow['upNext']['roster'];
}) {
  // Sort: UP_NEXT first, then QUEUED by rotation position, then SKIPPED,
  // then INACTIVE. This mirrors how an admin mentally reads the lineup:
  // "who's up, who's on deck, who's benched and why".
  const order: Record<string, number> = {
    UP_NEXT: 0, QUEUED: 1, SKIPPED: 2, INACTIVE: 3,
  };
  const sorted = [...roster].sort((a, b) => {
    const s = (order[a.status] ?? 99) - (order[b.status] ?? 99);
    if (s !== 0) return s;
    return a.roundRobinPosition - b.roundRobinPosition;
  });
  return (
    <div className="bg-slate-50/60 border-t border-slate-100 px-4 py-3">
      <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-slate-500 mb-2">
        <Info className="h-3 w-3" />
        Roster &amp; quota status
      </div>
      <ul className="space-y-1">
        {sorted.map((m) => (
          <RosterItem key={m.memberId} member={m} />
        ))}
      </ul>
    </div>
  );
}

function RosterItem({
  member: m,
}: {
  member: CampaignNextUpRow['upNext']['roster'][number];
}) {
  // The right-side status copy changes based on why the member is where
  // they are. For eligible members we show "Ready · 1/2 today" so the
  // admin can eyeball remaining capacity; for skipped we surface the
  // human-readable detail from the server; inactive is just a label.
  const statusLabel = (() => {
    if (m.status === 'INACTIVE') return 'Inactive';
    if (m.status === 'SKIPPED') {
      return m.skipDetail ?? (m.skipReason ? describeReasonFallback(m.skipReason) : 'Skipped');
    }
    const bits: string[] = [];
    if (m.dailyQuota > 0) bits.push(`${m.dailyCount}/${m.dailyQuota} today`);
    else if (m.dailyCount > 0) bits.push(`${m.dailyCount} today`);
    if (m.weeklyQuota > 0) bits.push(`${m.weeklyCount}/${m.weeklyQuota} wk`);
    if (m.monthlyQuota > 0) bits.push(`${m.monthlyCount}/${m.monthlyQuota} mo`);
    return bits.length > 0 ? bits.join(' · ') : 'No caps set';
  })();

  const statusColor = (() => {
    switch (m.status) {
      case 'UP_NEXT': return 'bg-blue-100 text-blue-800 ring-blue-200';
      case 'QUEUED': return 'bg-slate-100 text-slate-700 ring-slate-200';
      case 'SKIPPED': return 'bg-amber-100 text-amber-800 ring-amber-200';
      case 'INACTIVE': return 'bg-slate-100 text-slate-500 ring-slate-200';
    }
  })();

  const statusBadge = (() => {
    switch (m.status) {
      case 'UP_NEXT': return 'Up next';
      case 'QUEUED': return 'Queued';
      case 'SKIPPED': return 'Skipped';
      case 'INACTIVE': return 'Inactive';
    }
  })();

  return (
    <li className="flex items-center gap-2 text-sm text-slate-700 py-0.5">
      <span
        className={`inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[9px] font-bold ${
          m.status === 'UP_NEXT'
            ? 'bg-blue-100 text-blue-700 ring-1 ring-blue-200'
            : 'bg-slate-200 text-slate-600'
        }`}
        aria-hidden="true"
      >
        {initialsOf(m.name)}
      </span>
      <span
        className={`font-medium shrink-0 ${
          m.status === 'INACTIVE' ? 'text-slate-500' : 'text-slate-900'
        }`}
      >
        {m.name}
      </span>
      <span
        className={`inline-flex items-center rounded-full px-1.5 py-0.5 text-[10px] font-semibold ring-1 shrink-0 ${statusColor}`}
      >
        {statusBadge}
      </span>
      <span className="text-slate-400 shrink-0">&mdash;</span>
      <span className="text-slate-600 text-xs truncate" title={statusLabel}>
        {statusLabel}
      </span>
    </li>
  );
}

// Last-resort label if the server didn't compute a `detail` string (older
// cached response, etc.). describeSkip() in leadDistribution.ts should
// normally win, but this keeps the UI legible if it doesn't.
function describeReasonFallback(reason: string): string {
  switch (reason) {
    case 'LEADS_DISABLED':
      return 'Leads disabled';
    case 'GLOBAL_STATE':
    case 'CAMPAIGN_STATE':
      return 'Not licensed in lead state';
    case 'RECEIVE_DAY':
      return 'Not receiving today';
    case 'CAMPAIGN_DAILY':
    case 'GLOBAL_DAILY':
      return 'Daily cap hit';
    case 'CAMPAIGN_WEEKLY':
    case 'GLOBAL_WEEKLY':
      return 'Weekly cap hit';
    case 'CAMPAIGN_MONTHLY':
    case 'GLOBAL_MONTHLY':
      return 'Monthly cap hit';
    default:
      return reason;
  }
}

function UpNextInline({ upNext }: { upNext: CampaignNextUpRow['upNext'] }) {
  if (upNext.kind === 'MEMBER') {
    return (
      <span className="inline-flex items-center gap-2 shrink-0">
        <span
          className="flex h-6 w-6 items-center justify-center rounded-full bg-blue-100 text-[10px] font-bold text-blue-700 ring-1 ring-blue-200"
          aria-hidden="true"
        >
          {initialsOf(upNext.name)}
        </span>
        <span className="text-sm font-medium text-slate-900 max-w-[160px] truncate">
          {upNext.name}
        </span>
      </span>
    );
  }

  if (upNext.kind === 'DEFAULT') {
    // DEFAULT now only fires for the empty-roster case. "All members
    // gated out" routes to UNASSIGNED instead, so rotation can't be
    // silently eaten by the fallback user.
    return (
      <span
        className="inline-flex items-center gap-2 shrink-0"
        title="No members assigned - falling back to default user"
      >
        <span
          className="flex h-6 w-6 items-center justify-center rounded-full bg-amber-100 text-[10px] font-bold text-amber-700 ring-1 ring-amber-200"
          aria-hidden="true"
        >
          {initialsOf(upNext.name)}
        </span>
        <span className="text-sm font-medium text-slate-900 max-w-[160px] truncate">
          {upNext.name}
        </span>
        <span className="inline-flex items-center rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-800 ring-1 ring-amber-200">
          Fallback
        </span>
      </span>
    );
  }

  const Icon = upNext.reason === 'MANUAL' ? Hand : UserX;
  const label =
    upNext.reason === 'MANUAL'
      ? 'Manual'
      : upNext.reason === 'NO_MEMBERS_NO_DEFAULT'
      ? 'No members'
      : 'Unassigned';
  const title =
    upNext.reason === 'MANUAL'
      ? 'Manual distribution - admin assigns leads by hand'
      : upNext.reason === 'NO_MEMBERS_NO_DEFAULT'
      ? 'Campaign has no active members and no fallback user'
      : 'All members gated out - leads land in the Unassigned Pool. Expand this row to see why.';
  return (
    <span
      className="inline-flex items-center gap-1.5 shrink-0 text-slate-500"
      title={title}
    >
      <Icon className="h-3.5 w-3.5" />
      <span className="text-[11px] font-medium">{label}</span>
    </span>
  );
}
