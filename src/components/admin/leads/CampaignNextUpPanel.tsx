'use client';

import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
} from 'react';
import {
  ChevronDown,
  ChevronUp,
  Crown,
  Hand,
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

const STORAGE_KEY = 'ffl.campaignNextUp.collapsed';
const REFRESH_MS = 30_000;
const NONE_GROUP = '__none__';

// Keyed on lowercased vendor slug. Unknown vendors fall through to slate.
// Adding a new vendor? Add it here + keep the palette in the docs in sync.
const VENDOR_COLORS: Record<
  string,
  { rail: string; bg: string; pill: string; ring: string }
> = {
  lendingtree: {
    rail: 'bg-emerald-500',
    bg: 'bg-emerald-50/60',
    pill: 'bg-emerald-100 text-emerald-800 ring-emerald-200',
    ring: 'ring-emerald-100',
  },
  freerateupdate: {
    rail: 'bg-blue-500',
    bg: 'bg-blue-50/60',
    pill: 'bg-blue-100 text-blue-800 ring-blue-200',
    ring: 'ring-blue-100',
  },
  leadpoint: {
    rail: 'bg-amber-500',
    bg: 'bg-amber-50/60',
    pill: 'bg-amber-100 text-amber-800 ring-amber-200',
    ring: 'ring-amber-100',
  },
  lendgo: {
    rail: 'bg-violet-500',
    bg: 'bg-violet-50/60',
    pill: 'bg-violet-100 text-violet-800 ring-violet-200',
    ring: 'ring-violet-100',
  },
};
const VENDOR_FALLBACK = {
  rail: 'bg-slate-400',
  bg: 'bg-slate-50',
  pill: 'bg-slate-100 text-slate-700 ring-slate-200',
  ring: 'ring-slate-100',
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

export function CampaignNextUpPanel({ initialRoster, filterGroupId }: Props) {
  const [roster, setRoster] = useState<CampaignNextUpRow[]>(initialRoster);
  const [collapsed, setCollapsed] = useState<boolean>(false);
  const [lastRefreshedAt, setLastRefreshedAt] = useState<Date>(new Date());
  const [isPending, startTransition] = useTransition();
  // Track whether we've hydrated collapsed state from localStorage yet so
  // SSR markup and the first client paint stay in sync.
  const hydratedRef = useRef(false);

  useEffect(() => {
    // Hydrate collapsed state from localStorage once on mount. We can't
    // read localStorage during useState init because the first paint is
    // SSR where `window` is undefined, so this is the canonical React
    // pattern for persisting a UI toggle - the cascading-renders lint
    // doesn't really apply when we're syncing state FROM an external
    // store rather than doing derived-state calculations.
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (raw === '1') {
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setCollapsed(true);
      }
    } catch {
      // localStorage can throw in private mode; ignore.
    }
    hydratedRef.current = true;
  }, []);

  const setCollapsedPersisted = useCallback((next: boolean) => {
    setCollapsed(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, next ? '1' : '0');
    } catch {
      // ignore
    }
  }, []);

  const refresh = useCallback(() => {
    startTransition(async () => {
      try {
        const next = await getCampaignNextUpRoster();
        setRoster(next);
        setLastRefreshedAt(new Date());
      } catch (err) {
        // Surface to console only; stale data is safer than tearing the
        // panel down mid-session.
        console.warn('[CampaignNextUpPanel] refresh failed:', err);
      }
    });
  }, []);

  // Poll every REFRESH_MS while the tab is visible. Also refresh the
  // moment the tab regains focus so admins don't see hour-old data.
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

  const readyCount = useMemo(
    () => filtered.filter((r) => r.upNext.kind === 'MEMBER').length,
    [filtered]
  );

  return (
    <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
      <button
        type="button"
        onClick={() => setCollapsedPersisted(!collapsed)}
        className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-slate-50 rounded-t-xl transition-colors"
        aria-expanded={!collapsed}
        aria-controls="campaign-next-up-grid"
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
                  &middot; {readyCount} ready &middot;{' '}
                  {filtered.length - readyCount} fallback
                </>
              )}
            </span>
          </div>
          <p className="text-xs text-slate-500">
            The loan officer who&apos;d get the next lead on each active
            campaign right now, honoring receive-days, quotas, and global
            flags.
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
        {collapsed ? (
          <ChevronDown className="h-4 w-4 text-slate-400" />
        ) : (
          <ChevronUp className="h-4 w-4 text-slate-400" />
        )}
      </button>

      {!collapsed && (
        <div
          id="campaign-next-up-grid"
          className="border-t border-slate-100 px-4 py-4"
        >
          {filtered.length === 0 ? (
            <div className="py-6 text-center text-sm text-slate-500">
              No active campaigns match this filter.
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {filtered.map((row) => (
                <NextUpCard key={row.campaignId} row={row} />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function NextUpCard({ row }: { row: CampaignNextUpRow }) {
  const palette = vendorColor(row.vendorSlug);
  const { upNext } = row;

  return (
    <div
      className={`relative overflow-hidden rounded-lg border border-slate-200 ${palette.bg} pl-3 pr-3 py-3 transition-shadow hover:shadow-sm`}
    >
      <span
        className={`absolute inset-y-0 left-0 w-1 ${palette.rail}`}
        aria-hidden="true"
      />
      <div className="flex items-start justify-between gap-2 mb-2">
        <div className="min-w-0 flex-1">
          <h3
            className="text-sm font-semibold text-slate-900 truncate"
            title={row.campaignName}
          >
            {row.campaignName}
          </h3>
          <div className="mt-0.5 flex items-center gap-1.5">
            <span
              className={`inline-flex items-center rounded-full px-1.5 py-0.5 text-[10px] font-medium ring-1 ${palette.pill}`}
            >
              {row.vendorName}
            </span>
            <span className="text-[10px] text-slate-400">
              {row.memberCount} LO{row.memberCount === 1 ? '' : 's'}
            </span>
          </div>
        </div>
      </div>

      <UpNextBody upNext={upNext} />
    </div>
  );
}

function UpNextBody({ upNext }: { upNext: CampaignNextUpRow['upNext'] }) {
  if (upNext.kind === 'MEMBER') {
    return (
      <div className="flex items-center gap-2.5 rounded-md border border-white/60 bg-white/70 px-2 py-1.5">
        <Avatar name={upNext.name} tone="blue" />
        <div className="min-w-0 flex-1">
          <p
            className="text-[11px] font-medium uppercase tracking-wider text-slate-500 leading-tight"
          >
            Up Next
          </p>
          <p
            className="text-sm font-semibold text-slate-900 truncate"
            title={upNext.name}
          >
            {upNext.name}
          </p>
        </div>
      </div>
    );
  }

  if (upNext.kind === 'DEFAULT') {
    return (
      <div className="flex items-center gap-2.5 rounded-md border border-amber-200 bg-amber-50/80 px-2 py-1.5">
        <Avatar name={upNext.name} tone="amber" />
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-medium uppercase tracking-wider text-amber-700 leading-tight">
            Default fallback
          </p>
          <p
            className="text-sm font-semibold text-slate-900 truncate"
            title={upNext.name}
          >
            {upNext.name}
          </p>
          <p className="text-[10px] text-amber-700">
            {upNext.reason === 'NO_MEMBERS'
              ? 'No members assigned'
              : 'All members gated out'}
          </p>
        </div>
      </div>
    );
  }

  // UNASSIGNED
  const icon = upNext.reason === 'MANUAL' ? Hand : UserX;
  const label =
    upNext.reason === 'MANUAL'
      ? 'Manual assignment'
      : upNext.reason === 'NO_MEMBERS_NO_DEFAULT'
      ? 'No members, no default'
      : 'All gated, no default';
  const Icon = icon;
  return (
    <div className="flex items-center gap-2.5 rounded-md border border-slate-200 bg-white/70 px-2 py-1.5">
      <div className="flex h-7 w-7 items-center justify-center rounded-full bg-slate-100 text-slate-500">
        <Icon className="h-3.5 w-3.5" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-[11px] font-medium uppercase tracking-wider text-slate-500 leading-tight">
          {upNext.reason === 'MANUAL' ? 'Not auto-assigned' : 'Unassigned Pool'}
        </p>
        <p className="text-sm font-medium text-slate-700 truncate">{label}</p>
      </div>
    </div>
  );
}

function Avatar({
  name,
  tone,
}: {
  name: string;
  tone: 'blue' | 'amber';
}) {
  const cls =
    tone === 'blue'
      ? 'bg-blue-100 text-blue-700 ring-blue-200'
      : 'bg-amber-100 text-amber-700 ring-amber-200';
  return (
    <div
      className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[11px] font-bold ring-1 ${cls}`}
      aria-hidden="true"
    >
      {initialsOf(name)}
    </div>
  );
}
