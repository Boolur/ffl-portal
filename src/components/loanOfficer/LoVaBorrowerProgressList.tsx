'use client';

import React from 'react';
import Link from 'next/link';
import {
  ClipboardCheck,
  Calendar,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Clock3,
  DollarSign,
  FileText,
  FileCheck2,
  Home,
  Paperclip,
  Search,
  Loader2,
  UserCog,
  X,
} from 'lucide-react';
import { getTaskAttachmentDownloadUrl } from '@/app/actions/attachmentActions';
import type { LoVaBorrowerProgressItem, VaChipState } from '@/lib/loVaProgress';
import { getRoleBubbleClass } from '@/lib/roleColors';
import {
  formatLifecycleDuration,
  type TaskLifecycleBreakdown,
} from '@/lib/taskLifecycleTimeline';
import { UserRole } from '@prisma/client';

const chipMeta: Record<
  VaChipState,
  {
    label: string;
    className: string;
  }
> = {
  not_started: {
    label: 'Not Started',
    className: 'border-slate-200 bg-slate-50 text-slate-600',
  },
  new: {
    label: 'New',
    className: 'border-blue-200 bg-blue-50 text-blue-700',
  },
  working: {
    label: 'Working',
    className: 'border-indigo-200 bg-indigo-50 text-indigo-700',
  },
  waiting: {
    label: 'Waiting',
    className: 'border-amber-200 bg-amber-50 text-amber-700',
  },
  review: {
    label: 'Review',
    className: 'border-sky-200 bg-sky-50 text-sky-700',
  },
  completed: {
    label: 'Completed',
    className: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  },
};

function StatusChip({ label, state }: { label: string; state: VaChipState }) {
  const completed = state === 'completed';
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
        completed
          ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
          : 'border-rose-200 bg-rose-50 text-rose-700'
      }`}
      title={`${label}: ${completed ? 'Completed' : 'Incomplete'}`}
    >
      {label}: {completed ? 'Completed' : 'Incomplete'}
    </span>
  );
}

function formatCompactDateTime(value: Date) {
  return new Intl.DateTimeFormat('en-US', {
    month: 'numeric',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(value);
}

function formatElapsedTimerLabel(elapsedMs: number) {
  const totalMinutes = Math.max(1, Math.floor(elapsedMs / 60000));
  const days = Math.floor(totalMinutes / (24 * 60));
  const hours = Math.floor((totalMinutes % (24 * 60)) / 60);
  const minutes = totalMinutes % 60;
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

function getTimerClassName(elapsedMs: number) {
  const elapsedMinutes = Math.floor(elapsedMs / 60000);
  if (elapsedMinutes < 45) return 'border-emerald-300 bg-emerald-100 text-emerald-800';
  if (elapsedMinutes < 90) return 'border-green-300 bg-green-100 text-green-800';
  if (elapsedMinutes < 135) return 'border-yellow-300 bg-yellow-100 text-yellow-800';
  if (elapsedMinutes < 175) return 'border-orange-300 bg-orange-100 text-orange-800';
  return 'border-rose-400 bg-rose-100 text-rose-800';
}

function getLifecycleBucketBubbleClass(key: string, label: string, stageLabel: string) {
  const normalizedKey = key.trim().toUpperCase();
  const normalizedLabel = label.trim().toLowerCase();
  const normalizedStage = stageLabel.trim().toLowerCase();

  if (normalizedKey === 'COMPLETED' || normalizedKey === '__COMPLETED__' || normalizedLabel.includes('completed')) {
    return 'border-emerald-300 bg-emerald-100 text-emerald-800';
  }

  const isNewBucketLike =
    normalizedKey === 'NONE' ||
    normalizedKey === 'PENDING' ||
    normalizedLabel.includes('new') ||
    normalizedLabel === 'none' ||
    normalizedLabel.includes('pending');
  if (isNewBucketLike) {
    if (normalizedStage.includes('jr processor')) {
      return 'border-cyan-300 bg-cyan-100 text-cyan-800';
    }
    if (normalizedStage.includes('va')) {
      return 'border-rose-300 bg-rose-100 text-rose-800';
    }
  }

  if (
    normalizedKey === 'WAITING_ON_LO_APPROVAL' ||
    normalizedLabel.includes('approval') ||
    normalizedLabel.includes('review')
  ) {
    return 'border-purple-300 bg-purple-100 text-purple-800';
  }
  if (
    normalizedKey === 'WAITING_ON_LO' ||
    normalizedKey === 'BLOCKED' ||
    normalizedLabel.includes('waiting on lo') ||
    normalizedLabel.includes('blocked')
  ) {
    return 'border-amber-300 bg-amber-100 text-amber-800';
  }
  if (normalizedKey === 'IN_PROGRESS' || normalizedLabel.includes('in progress')) {
    return 'border-sky-300 bg-sky-100 text-sky-800';
  }
  if (
    normalizedKey === 'PENDING' ||
    normalizedKey === 'NONE' ||
    normalizedLabel.includes('pending') ||
    normalizedLabel === 'none'
  ) {
    return 'border-blue-300 bg-blue-100 text-blue-800';
  }
  return 'border-slate-300 bg-slate-100 text-slate-800';
}

function getOrderedLifecycleRows(breakdown: TaskLifecycleBreakdown) {
  const useStatus = breakdown.statusDurations.length > 0;
  const rowKeyFromSegment = (segment: TaskLifecycleBreakdown['segments'][number]) =>
    useStatus ? segment.status || 'PENDING' : segment.workflowState || 'NONE';
  const rowKeyFromEventFrom = (event: TaskLifecycleBreakdown['events'][number]) =>
    useStatus ? event.fromStatus || null : event.fromWorkflow || null;
  const rowKeyFromEventTo = (event: TaskLifecycleBreakdown['events'][number]) =>
    useStatus
      ? event.toStatus || null
      : event.toStatus === 'COMPLETED'
        ? '__COMPLETED__'
        : event.toWorkflow || null;

  const collectActors = (rowKey: string) => {
    const actors = new Map<string, { name: string; role: UserRole | null }>();
    const addActor = (name: string | null | undefined, role: UserRole | null | undefined) => {
      const normalizedName = (name || '').trim();
      if (!normalizedName) return;
      if (normalizedName.toLowerCase() === 'system') return;
      const actorKey = `${normalizedName}::${role || 'NONE'}`;
      if (!actors.has(actorKey)) {
        actors.set(actorKey, { name: normalizedName, role: role || null });
      }
    };
    for (const event of breakdown.events) {
      const toKey = rowKeyFromEventTo(event);
      const fromKey = rowKeyFromEventFrom(event);
      if (toKey !== rowKey && fromKey !== rowKey) continue;
      addActor(event.actorName, event.actorRole || null);
    }
    for (const segment of breakdown.segments) {
      const targetKey = rowKeyFromSegment(segment);
      if (targetKey !== rowKey) continue;
      addActor(segment.assignedUserName, segment.assignedRole || null);
    }
    return Array.from(actors.values()).slice(0, 4);
  };

  const rowsFromSegments: Array<{
    id: string;
    key: string;
    label: string;
    durationMs: number;
    actors: Array<{ name: string; role: UserRole | null }>;
  }> = [];
  for (const segment of breakdown.segments) {
    const rawKey = rowKeyFromSegment(segment);
    const label =
      (useStatus
        ? breakdown.statusDurations.find((row) => row.key === rawKey)?.label
        : breakdown.workflowDurations.find((row) => row.key === rawKey)?.label) || rawKey;
    const rowActors = collectActors(rawKey);
    const previous = rowsFromSegments[rowsFromSegments.length - 1];
    if (previous && previous.key === rawKey) {
      previous.durationMs += segment.durationMs;
      for (const actor of rowActors) {
        if (!previous.actors.some((entry) => entry.name === actor.name && entry.role === actor.role)) {
          previous.actors.push(actor);
        }
      }
      continue;
    }
    rowsFromSegments.push({
      id: `${rawKey}-${rowsFromSegments.length}`,
      key: rawKey,
      label,
      durationMs: segment.durationMs,
      actors: rowActors,
    });
  }

  const rows = [...rowsFromSegments];
  const initialRawKey =
    breakdown.events.length > 0 ? rowKeyFromEventFrom(breakdown.events[0]) || 'NONE' : rows[0]?.key || null;
  if (initialRawKey && (rows.length === 0 || rows[0].key !== initialRawKey)) {
    rows.unshift({
      id: `${initialRawKey}-initial`,
      key: initialRawKey,
      label:
        (useStatus
          ? breakdown.statusDurations.find((row) => row.key === initialRawKey)?.label
          : breakdown.workflowDurations.find((row) => row.key === initialRawKey)?.label) || initialRawKey,
      durationMs: 0,
      actors: collectActors(initialRawKey),
    });
  }

  if (rows.length === 0 && breakdown.events.length > 0) {
    const fallbackRows: typeof rows = [];
    const pushRow = (key: string | null) => {
      if (!key) return;
      const previous = fallbackRows[fallbackRows.length - 1];
      if (previous && previous.key === key) return;
      fallbackRows.push({
        id: `${key}-${fallbackRows.length}`,
        key,
        label:
          (useStatus
            ? breakdown.statusDurations.find((row) => row.key === key)?.label
            : breakdown.workflowDurations.find((row) => row.key === key)?.label) || key,
        durationMs: 0,
        actors: collectActors(key),
      });
    };
    pushRow(initialRawKey);
    for (const event of breakdown.events) pushRow(rowKeyFromEventTo(event));
    return fallbackRows;
  }

  const completedKey = useStatus ? 'COMPLETED' : '__COMPLETED__';
  const hasCompletedTransition = breakdown.events.some((event) => rowKeyFromEventTo(event) === completedKey);
  if (hasCompletedTransition && !rows.some((row) => row.key === completedKey)) {
    rows.push({
      id: `${completedKey}-completion`,
      key: completedKey,
      label:
        (useStatus
          ? breakdown.statusDurations.find((row) => row.key === completedKey)?.label
          : breakdown.workflowDurations.find((row) => row.key === completedKey)?.label) || completedKey,
      durationMs: 0,
      actors: collectActors(completedKey),
    });
  }

  return rows;
}

function getStageElapsedMs(
  createdAt: Date | null,
  updatedAt: Date | null,
  completed: boolean,
  nowMs: number
) {
  if (!createdAt) return null;
  const startMs = createdAt.getTime();
  if (!Number.isFinite(startMs)) return null;
  const endMs = completed && updatedAt ? updatedAt.getTime() : nowMs;
  if (!Number.isFinite(endMs) || endMs < startMs) return null;
  return endMs - startMs;
}

type SortOption =
  | 'created_asc'
  | 'created_desc'
  | 'updated_desc'
  | 'updated_asc'
  | 'borrower_asc'
  | 'borrower_desc';
type LocalSortOption = 'global' | SortOption;

const sortOptions: Array<{ value: SortOption; label: string }> = [
  { value: 'created_asc', label: 'Queue Time (Oldest First)' },
  { value: 'created_desc', label: 'Queue Time (Newest First)' },
  { value: 'updated_desc', label: 'Updated (Newest)' },
  { value: 'updated_asc', label: 'Updated (Oldest)' },
  { value: 'borrower_asc', label: 'Borrower (A to Z)' },
  { value: 'borrower_desc', label: 'Borrower (Z to A)' },
];

const sortLabelByValue: Record<SortOption, string> = {
  created_asc: 'Queue Time (Oldest First)',
  created_desc: 'Queue Time (Newest First)',
  updated_desc: 'Updated (Newest)',
  updated_asc: 'Updated (Oldest)',
  borrower_asc: 'Borrower (A to Z)',
  borrower_desc: 'Borrower (Z to A)',
};

function normalizeCreatedAt(item: LoVaBorrowerProgressItem) {
  return item.earliestCreatedAt?.getTime() || 0;
}

function normalizeUpdatedAt(item: LoVaBorrowerProgressItem) {
  return item.latestUpdatedAt?.getTime() || 0;
}

function normalizeBorrower(item: LoVaBorrowerProgressItem) {
  return item.borrowerName.trim().toLowerCase();
}

function normalizeSearch(item: LoVaBorrowerProgressItem) {
  return `${item.borrowerName} ${item.loanNumber}`.toLowerCase();
}

function sortBorrowerItems(items: LoVaBorrowerProgressItem[], sortBy: SortOption) {
  return items
    .map((item, index) => ({ item, index }))
    .sort((a, b) => {
      if (sortBy === 'created_asc') {
        return normalizeCreatedAt(a.item) - normalizeCreatedAt(b.item) || a.index - b.index;
      }
      if (sortBy === 'created_desc') {
        return normalizeCreatedAt(b.item) - normalizeCreatedAt(a.item) || a.index - b.index;
      }
      if (sortBy === 'updated_desc') {
        return normalizeUpdatedAt(b.item) - normalizeUpdatedAt(a.item) || a.index - b.index;
      }
      if (sortBy === 'updated_asc') {
        return normalizeUpdatedAt(a.item) - normalizeUpdatedAt(b.item) || a.index - b.index;
      }
      if (sortBy === 'borrower_asc') {
        return normalizeBorrower(a.item).localeCompare(normalizeBorrower(b.item)) || a.index - b.index;
      }
      return normalizeBorrower(b.item).localeCompare(normalizeBorrower(a.item)) || a.index - b.index;
    })
    .map((entry) => entry.item);
}

function getIconButtonClassByState(state: 'not_started' | 'working' | 'completed') {
  if (state === 'completed') {
    return 'border-emerald-200 bg-emerald-100 text-emerald-700';
  }
  if (state === 'working') {
    return 'border-blue-200 bg-blue-100 text-blue-700';
  }
  return 'border-slate-200 bg-white text-slate-600';
}

const submissionDetailGroups = [
  {
    title: 'Borrower Details',
    keys: ['borrowerFirstName', 'borrowerLastName', 'borrowerPhone', 'borrowerEmail'],
  },
  {
    title: 'Property Details',
    keys: [
      'subjectPropertyAddress',
      'yearBuiltProperty',
      'originalCost',
      'yearAquired',
      'mannerInWhichTitleWillBeHeld',
    ],
  },
  {
    title: 'Loan Details',
    keys: [
      'arriveLoanNumber',
      'loanAmount',
      'homeValue',
      'loanType',
      'loanProgram',
      'loanPurpose',
      'channel',
      'investor',
      'runId',
      'pricingOption',
      'creditReportType',
      'aus',
    ],
  },
] as const;

function groupSubmissionSnapshot(
  rows: Array<{ key: string; label: string; value: string }>
) {
  const byKey = new Map(rows.map((row) => [row.key, row]));
  return submissionDetailGroups
    .map((group) => ({
      title: group.title,
      rows: group.keys
        .map((key) => byKey.get(key))
        .filter((row): row is { key: string; label: string; value: string } => Boolean(row)),
    }))
    .filter((group) => group.rows.length > 0);
}

const stageLabelByKey: Record<'title' | 'hoi' | 'payoff' | 'appraisal', string> = {
  title: 'Title',
  hoi: 'HOI',
  payoff: 'Payoff',
  appraisal: 'Appraisal',
};

function formatRoleLabel(role: string | null) {
  if (!role) return 'Team Member';
  return role
    .toLowerCase()
    .split('_')
    .map((part) => (part.length ? part[0].toUpperCase() + part.slice(1) : part))
    .join(' ');
}

function formatNoteDateTime(value: string) {
  const dt = new Date(value);
  if (Number.isNaN(dt.getTime())) return '';
  return new Intl.DateTimeFormat('en-US', {
    month: 'numeric',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(dt);
}

function formatJrChecklistStatus(status: 'ORDERED' | 'MISSING_ITEMS' | 'COMPLETED') {
  if (status === 'MISSING_ITEMS') return 'Missing Items / Action Required';
  if (status === 'COMPLETED') return 'Completed';
  return 'Ordered';
}

function getJrChecklistStatusClass(status: 'ORDERED' | 'MISSING_ITEMS' | 'COMPLETED') {
  if (status === 'MISSING_ITEMS') return 'border-rose-300 bg-rose-100 text-rose-800';
  if (status === 'COMPLETED') return 'border-emerald-300 bg-emerald-100 text-emerald-800';
  return 'border-yellow-300 bg-yellow-100 text-yellow-800';
}

function SummaryRows({
  rows,
  className,
  boxed = true,
}: {
  rows: Array<{ label: string; done: boolean }>;
  className?: string;
  boxed?: boolean;
}) {
  const containerClassName = boxed
    ? 'space-y-1.5 rounded-lg border border-slate-200 bg-white/80 px-2.5 py-2'
    : 'space-y-1.5';
  return (
    <div className={`${className || 'mt-2'} ${containerClassName}`}>
      {rows.map((row) => (
        <div key={row.label} className="flex items-center justify-between gap-2">
          <span className="text-xs font-semibold text-slate-700">{row.label}</span>
          <span
            className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${
              row.done
                ? 'border-emerald-300 bg-emerald-100 text-emerald-800'
                : 'border-rose-300 bg-rose-100 text-rose-800'
            }`}
          >
            {row.done ? 'Completed' : 'Incomplete'}
          </span>
        </div>
      ))}
    </div>
  );
}

function BucketPanel({
  title,
  icon,
  chipLabel,
  count,
  searchValue,
  onSearchChange,
  sortValue,
  onSortChange,
  globalSort,
  children,
}: {
  title: string;
  icon: React.ReactNode;
  chipLabel: string;
  count: number;
  searchValue: string;
  onSearchChange: (value: string) => void;
  sortValue: LocalSortOption;
  onSortChange: (value: LocalSortOption) => void;
  globalSort: SortOption;
  children: React.ReactNode;
}) {
  return (
    <div className="flex h-full min-h-[420px] flex-col rounded-2xl border border-slate-200/80 bg-white p-4 shadow-sm transition-all hover:shadow-md">
      <div className="mb-1.5 flex items-start justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2.5">
          {icon}
          <p className="truncate text-lg font-extrabold leading-snug tracking-tight text-slate-900">
            {title}
          </p>
        </div>
        <span className="inline-flex h-7 min-w-7 shrink-0 items-center justify-center rounded-full bg-slate-100 px-2 text-xs font-bold text-slate-700 shadow-sm ring-1 ring-slate-200/60">
          {count}
        </span>
      </div>
      <div className="mb-3 flex flex-wrap items-center gap-1.5 border-b border-border/50 pb-1.5">
        <span className="inline-flex items-center rounded-full border border-slate-200 bg-slate-50 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-slate-600 shadow-sm">
          {chipLabel}
        </span>
      </div>
      <div className="mb-2 flex flex-wrap items-center gap-1.5">
        <label className="relative min-w-[120px] flex-1">
          <Search className="pointer-events-none absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2 text-slate-400" />
          <input
            value={searchValue}
            onChange={(event) => onSearchChange(event.target.value)}
            placeholder="Search bucket"
            className="w-full rounded-md border border-slate-200 bg-white py-1.5 pl-7 pr-2 text-[11px] font-medium text-slate-700 focus:border-blue-400 focus:outline-none focus:ring-1 focus:ring-blue-300"
          />
        </label>
        <select
          value={sortValue}
          onChange={(event) => onSortChange(event.target.value as LocalSortOption)}
          className="min-w-[125px] rounded-md border border-slate-200 bg-white px-2 py-1.5 text-[11px] font-medium text-slate-700 focus:border-blue-400 focus:outline-none focus:ring-1 focus:ring-blue-300"
        >
          <option value="global">Use Global ({sortLabelByValue[globalSort]})</option>
          {sortOptions.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </div>
      <div className="h-[300px] overflow-y-auto pr-1">{children}</div>
    </div>
  );
}

export function LoVaBorrowerProgressList({
  items,
  className,
  mode = 'all',
}: {
  items: LoVaBorrowerProgressItem[];
  className?: string;
  mode?: 'all' | 'completed_only';
}) {
  const completedOnlyMode = mode === 'completed_only';
  const [focusedItemKey, setFocusedItemKey] = React.useState<string | null>(null);
  const [focusedQueue, setFocusedQueue] = React.useState<'va' | 'jr' | 'completed'>('va');
  const [openingAttachmentId, setOpeningAttachmentId] = React.useState<string | null>(null);
  const jrDetailSectionRef = React.useRef<HTMLDivElement | null>(null);
  const [expandedStageNotes, setExpandedStageNotes] = React.useState<Set<string>>(() => new Set());
  const [expandedTaskDetails, setExpandedTaskDetails] = React.useState<Set<string>>(() => new Set());
  const [expandedBorrowerCards, setExpandedBorrowerCards] = React.useState<Set<string>>(
    () => new Set()
  );
  const [globalSearch, setGlobalSearch] = React.useState('');
  const [globalSort, setGlobalSort] = React.useState<SortOption>('created_asc');
  const [bucketControls, setBucketControls] = React.useState<
    Record<'va' | 'jr' | 'completed', { search: string; sort: LocalSortOption }>
  >({
    va: { search: '', sort: 'global' },
    jr: { search: '', sort: 'global' },
    completed: { search: '', sort: 'global' },
  });
  const [timerNowMs, setTimerNowMs] = React.useState(() => Date.now());
  const [lifecyclePopup, setLifecyclePopup] = React.useState<{
    title: string;
    stages: Array<{
      label: string;
      breakdown: TaskLifecycleBreakdown;
      fallbackActors: Array<{ name: string; role: UserRole | null }>;
    }>;
  } | null>(null);
  const focusedItem =
    focusedItemKey === null
      ? null
      : items.find((item) => `${item.loanNumber}-${item.borrowerName}` === focusedItemKey) || null;
  const focusedSubmissionGroups = React.useMemo(
    () => (focusedItem ? groupSubmissionSnapshot(focusedItem.submissionSnapshot) : []),
    [focusedItem]
  );
  const vaItems = React.useMemo(
    () => items.filter((item) => !item.isFullyComplete && item.hasIncompleteVa),
    [items]
  );
  const jrItems = React.useMemo(
    () => items.filter((item) => !item.isFullyComplete && item.hasIncompleteJr),
    [items]
  );
  const completedItems = React.useMemo(() => items.filter((item) => item.isFullyComplete), [items]);
  const filteredAndSorted = React.useMemo(() => {
    const normalizedGlobalSearch = globalSearch.trim().toLowerCase();
    const processBucket = (bucketItems: LoVaBorrowerProgressItem[], bucketKey: 'va' | 'jr' | 'completed') => {
      const localSearch = bucketControls[bucketKey].search.trim().toLowerCase();
      const selectedSort =
        bucketControls[bucketKey].sort === 'global' ? globalSort : bucketControls[bucketKey].sort;
      const filtered = bucketItems.filter((item) => {
        const searchable = normalizeSearch(item);
        if (normalizedGlobalSearch && !searchable.includes(normalizedGlobalSearch)) return false;
        if (localSearch && !searchable.includes(localSearch)) return false;
        return true;
      });
      return sortBorrowerItems(filtered, selectedSort);
    };
    return {
      va: processBucket(vaItems, 'va'),
      jr: processBucket(jrItems, 'jr'),
      completed: processBucket(completedItems, 'completed'),
    };
  }, [bucketControls, completedItems, globalSearch, globalSort, jrItems, vaItems]);
  const showVaDetails = focusedQueue !== 'jr';
  const showJrDetails = focusedQueue !== 'va';

  const openBorrowerDetail = React.useCallback(
    (item: LoVaBorrowerProgressItem, queue: 'va' | 'jr' | 'completed') => {
      setFocusedQueue(queue);
      setFocusedItemKey(`${item.loanNumber}-${item.borrowerName}`);
    },
    []
  );
  const openLifecycleFromCard = React.useCallback(
    (item: LoVaBorrowerProgressItem, queue: 'va' | 'jr' | 'completed') => {
      const stages: Array<{
        label: string;
        breakdown: TaskLifecycleBreakdown;
        fallbackActors: Array<{ name: string; role: UserRole | null }>;
      }> = [];
      const maybePush = (label: string, breakdown: TaskLifecycleBreakdown | null) => {
        if (!breakdown || breakdown.totalDurationMs < 1) return;
        stages.push({
          label,
          breakdown,
          fallbackActors: item.workedByContributors,
        });
      };

      if (queue !== 'jr') {
        maybePush('VA Title', item.vaStageDetails.title.lifecycleBreakdown);
        maybePush('VA Payoff', item.vaStageDetails.payoff.lifecycleBreakdown);
        maybePush('VA Appraisal', item.vaStageDetails.appraisal.lifecycleBreakdown);
      }
      maybePush('JR Processor (HOI/VOE/Underwriting)', item.jrStageDetails.hoi.lifecycleBreakdown);

      if (queue === 'jr' && stages.length === 0) {
        maybePush('VA Title', item.vaStageDetails.title.lifecycleBreakdown);
        maybePush('VA Payoff', item.vaStageDetails.payoff.lifecycleBreakdown);
        maybePush('VA Appraisal', item.vaStageDetails.appraisal.lifecycleBreakdown);
      }

      if (stages.length === 0) return;
      setLifecyclePopup({
        title: `${item.borrowerName} • ${item.loanNumber}`,
        stages,
      });
    },
    []
  );

  const openAttachment = async (attachmentId: string) => {
    setOpeningAttachmentId(attachmentId);
    const result = await getTaskAttachmentDownloadUrl(attachmentId);
    if (!result.success || !result.url) {
      alert(result.error || 'Unable to open attachment.');
      setOpeningAttachmentId(null);
      return;
    }
    window.open(result.url, '_blank', 'noopener,noreferrer');
    setOpeningAttachmentId(null);
  };

  React.useEffect(() => {
    setExpandedStageNotes(new Set());
    setExpandedTaskDetails(new Set());
  }, [focusedItemKey]);

  React.useEffect(() => {
    if (!focusedItem || focusedQueue !== 'jr') return;
    const timer = window.setTimeout(() => {
      jrDetailSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 80);
    return () => window.clearTimeout(timer);
  }, [focusedItem, focusedQueue]);

  React.useEffect(() => {
    const intervalId = window.setInterval(() => {
      setTimerNowMs(Date.now());
    }, 30_000);
    return () => window.clearInterval(intervalId);
  }, []);

  return (
    <section className={`${className || ''}`}>
      <div className="mb-3.5 w-full rounded-2xl border border-slate-200/80 bg-white p-3 shadow-sm">
        <div className="flex flex-wrap items-center gap-2">
          <label className="relative w-full md:w-[420px]">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
            <input
              value={globalSearch}
              onChange={(event) => setGlobalSearch(event.target.value)}
              placeholder="Search all VA/JR buckets..."
              className="w-full rounded-lg border border-slate-200 bg-white py-2 pl-8 pr-3 text-xs font-medium text-slate-700 focus:border-blue-400 focus:outline-none focus:ring-1 focus:ring-blue-300"
            />
          </label>
          <select
            value={globalSort}
            onChange={(event) => setGlobalSort(event.target.value as SortOption)}
            className="min-w-[170px] rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700 focus:border-blue-400 focus:outline-none focus:ring-1 focus:ring-blue-300"
          >
            {sortOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={() => {
              setGlobalSearch('');
              setGlobalSort('created_asc');
              setBucketControls({
                va: { search: '', sort: 'global' },
                jr: { search: '', sort: 'global' },
                completed: { search: '', sort: 'global' },
              });
            }}
            className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-100"
          >
            Reset
          </button>
        </div>
      </div>
      <div className="grid gap-3.5 md:grid-cols-3">
        {!completedOnlyMode && (
          <BucketPanel
            title="VA Bucket"
            icon={<FileCheck2 className="h-5 w-5 text-rose-600" />}
            chipLabel="VA Queue"
            count={filteredAndSorted.va.length}
            searchValue={bucketControls.va.search}
            onSearchChange={(value) =>
              setBucketControls((prev) => ({ ...prev, va: { ...prev.va, search: value } }))
            }
            sortValue={bucketControls.va.sort}
            onSortChange={(value) =>
              setBucketControls((prev) => ({ ...prev, va: { ...prev.va, sort: value } }))
            }
            globalSort={globalSort}
          >
            {filteredAndSorted.va.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-10 text-center">
                <CheckCircle2 className="h-6 w-6 text-slate-300" />
                <p className="mt-2 text-xs font-medium text-slate-500">No VA requests in queue.</p>
              </div>
            ) : (
              <div className="space-y-3">
              {filteredAndSorted.va.map((item) => {
                const cardKey = `${item.loanNumber}-${item.borrowerName}-va`;
                const cardExpanded = expandedBorrowerCards.has(cardKey);
                const workedBy = item.workedByContributors;
                const vaAllComplete = item.vaCompletedCount >= item.vaTotalCount;
                const vaAnyWorking =
                  !vaAllComplete &&
                  (item.vaStageDetails.title.completed ||
                    item.vaStageDetails.payoff.completed ||
                    item.vaStageDetails.appraisal.completed ||
                    item.vaStageDetails.title.proofAttachments.length > 0 ||
                    item.vaStageDetails.payoff.proofAttachments.length > 0 ||
                    item.vaStageDetails.appraisal.proofAttachments.length > 0 ||
                    Boolean(item.vaStageDetails.title.latestNote) ||
                    Boolean(item.vaStageDetails.payoff.latestNote) ||
                    Boolean(item.vaStageDetails.appraisal.latestNote));
                const vaIconState: 'not_started' | 'working' | 'completed' = vaAllComplete
                  ? 'completed'
                  : vaAnyWorking
                    ? 'working'
                    : 'not_started';
                const vaStatusPills = [
                  { label: 'Title', done: item.vaStageDetails.title.completed },
                  { label: 'Payoff', done: item.vaStageDetails.payoff.completed },
                  { label: 'Appraisal', done: item.vaStageDetails.appraisal.completed },
                ];
                return (
                <article
                  key={`${item.loanNumber}-${item.borrowerName}`}
                  className="group relative flex flex-col overflow-hidden rounded-2xl border border-slate-200/80 bg-white p-3 shadow-sm transition-all hover:border-blue-300 hover:ring-1 hover:ring-blue-100 hover:shadow-md"
                >
                  <div className="absolute -right-6 -top-6 h-20 w-20 rounded-full bg-slate-50 opacity-50 blur-2xl group-hover:bg-blue-50 transition-colors"></div>
                  <div className="relative flex items-start gap-3 min-w-0">
                    <button
                      type="button"
                      onClick={() => openBorrowerDetail(item, 'va')}
                      className={`mt-0.5 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg shadow-sm ring-1 ring-black/5 transition-all duration-150 hover:scale-[1.03] hover:border-blue-300 hover:bg-blue-50 hover:text-blue-700 hover:ring-blue-200 ${getIconButtonClassByState(
                        vaIconState
                      )}`}
                      title="Open submission details"
                      aria-label="Open submission details"
                    >
                      <FileText className="h-4 w-4" />
                    </button>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          {item.latestUpdatedAt && (
                            <div className="mb-0.5 flex flex-wrap items-center gap-1.5">
                              <p className="inline-flex items-center text-[11px] font-medium text-slate-500 leading-none">
                                <Calendar className="mr-1 h-3 w-3 text-slate-400" />
                                {formatCompactDateTime(item.latestUpdatedAt)}
                              </p>
                            </div>
                          )}
                          <p className="text-sm font-bold leading-snug text-slate-900 line-clamp-1">
                            {item.borrowerName}
                          </p>
                          <p className="text-xs font-medium text-slate-500 truncate">{item.loanNumber}</p>
                          {item.earliestCreatedAt && (
                            <div className="mt-1 flex flex-wrap items-center gap-1.5">
                              <button
                                type="button"
                                onClick={() => openLifecycleFromCard(item, 'va')}
                                className={`inline-flex items-center rounded-full border px-1.5 py-0.5 text-[10px] font-bold leading-none transition hover:brightness-95 ${getTimerClassName(
                                  Date.now() - item.earliestCreatedAt.getTime()
                                )}`}
                                title="Total time from first VA task creation (click for lifecycle timeline)"
                              >
                                <Clock3 className="mr-1 h-2.5 w-2.5" />
                                Total {formatElapsedTimerLabel(Date.now() - item.earliestCreatedAt.getTime())}
                              </button>
                            </div>
                          )}
                        </div>
                        <div className="inline-flex items-start gap-1.5 shrink-0">
                          <div className="flex max-w-[230px] flex-wrap justify-end gap-1">
                            {vaStatusPills.map((row) => (
                              <span
                                key={row.label}
                                className={`inline-flex items-center rounded-full border px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide ${
                                  row.done
                                    ? 'border-emerald-300 bg-emerald-100 text-emerald-800'
                                    : 'border-rose-300 bg-rose-100 text-rose-800'
                                }`}
                                title={`${row.label}: ${row.done ? 'Completed' : 'Incomplete'}`}
                              >
                                {row.label}
                              </span>
                            ))}
                          </div>
                          <button
                            type="button"
                            onClick={() =>
                              setExpandedBorrowerCards((prev) => {
                                const next = new Set(prev);
                                if (next.has(cardKey)) next.delete(cardKey);
                                else next.add(cardKey);
                                return next;
                              })
                            }
                            className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-slate-200 bg-white text-slate-500 hover:bg-slate-50 hover:text-slate-700"
                            title={cardExpanded ? 'Collapse card' : 'Expand card'}
                            aria-label={cardExpanded ? 'Collapse card' : 'Expand card'}
                          >
                            {cardExpanded ? (
                              <ChevronUp className="h-4 w-4" />
                            ) : (
                              <ChevronDown className="h-4 w-4" />
                            )}
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                  {cardExpanded && (
                    <div className="mt-2 border-t border-slate-200 pt-2">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="inline-flex items-center rounded-full border border-slate-200 bg-white px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-600">
                          Worked By
                        </span>
                        {(workedBy.length > 0
                          ? workedBy
                          : [{ name: 'Unassigned', role: null as null }]).map((contributor) => (
                          <span
                            key={contributor.name}
                            className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold ${getRoleBubbleClass(
                              contributor.role
                            )}`}
                          >
                            {contributor.name}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                </article>
              );
            })}
              </div>
            )}
          </BucketPanel>
        )}

        {!completedOnlyMode && (
          <BucketPanel
            title="JR Processor"
            icon={<UserCog className="h-5 w-5 text-slate-600" />}
            chipLabel="Processor Queue"
            count={filteredAndSorted.jr.length}
            searchValue={bucketControls.jr.search}
            onSearchChange={(value) =>
              setBucketControls((prev) => ({ ...prev, jr: { ...prev.jr, search: value } }))
            }
            sortValue={bucketControls.jr.sort}
            onSortChange={(value) =>
              setBucketControls((prev) => ({ ...prev, jr: { ...prev.jr, sort: value } }))
            }
            globalSort={globalSort}
          >
            {filteredAndSorted.jr.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-10 text-center">
                <CheckCircle2 className="h-6 w-6 text-slate-300" />
                <p className="mt-2 text-xs font-medium text-slate-500">No JR Processor requests in queue.</p>
              </div>
            ) : (
              <div className="space-y-3">
              {filteredAndSorted.jr.map((item) => {
                const cardKey = `${item.loanNumber}-${item.borrowerName}-jr`;
                const cardExpanded = expandedBorrowerCards.has(cardKey);
                const workedBy = item.workedByContributors;
                const jrRowsForState =
                  item.jrStageDetails.hoi.checklist.length > 0
                    ? item.jrStageDetails.hoi.checklist
                    : [
                        {
                          id: 'ordered-hoi',
                          label: 'HOI',
                          status: item.jrStageDetails.hoi.completed ? 'COMPLETED' : 'MISSING_ITEMS',
                          proofAttachmentId: null,
                          proofFilename: null,
                          note: null,
                          noteUpdatedAt: null,
                          noteAuthor: null,
                          noteRole: null,
                        },
                        {
                          id: 'ordered-voe',
                          label: 'VOE',
                          status: item.jrStageDetails.hoi.completed ? 'COMPLETED' : 'MISSING_ITEMS',
                          proofAttachmentId: null,
                          proofFilename: null,
                          note: null,
                          noteUpdatedAt: null,
                          noteAuthor: null,
                          noteRole: null,
                        },
                        {
                          id: 'submitted-underwriting',
                          label: 'Submitted to Underwriting',
                          status: item.jrStageDetails.hoi.completed ? 'COMPLETED' : 'MISSING_ITEMS',
                          proofAttachmentId: null,
                          proofFilename: null,
                          note: null,
                          noteUpdatedAt: null,
                          noteAuthor: null,
                          noteRole: null,
                        },
                      ];
                const jrAllComplete = jrRowsForState.every((row) => row.status === 'COMPLETED');
                const jrAnyWorking =
                  !jrAllComplete &&
                  jrRowsForState.some(
                    (row) =>
                      row.status === 'ORDERED' ||
                      row.status === 'COMPLETED' ||
                      Boolean(row.proofAttachmentId) ||
                      Boolean((row.note || '').trim())
                  );
                const jrIconState: 'not_started' | 'working' | 'completed' = jrAllComplete
                  ? 'completed'
                  : jrAnyWorking
                    ? 'working'
                    : 'not_started';
                type JrStatus = 'ORDERED' | 'MISSING_ITEMS' | 'COMPLETED';
                const jrRows: Array<{ label: string; status: JrStatus }> =
                  item.jrStageDetails.hoi.checklist.length > 0
                    ? item.jrStageDetails.hoi.checklist.map((row) => ({
                        label: row.label,
                        status: row.status as JrStatus,
                      }))
                    : [
                        {
                          label: 'HOI',
                          status: item.jrStageDetails.hoi.completed ? 'COMPLETED' : 'MISSING_ITEMS',
                        },
                      ];
                const jrStatusPills: Array<{ label: string; status: JrStatus }> = [
                  {
                    label: 'HOI',
                    status:
                      jrRows.find((row) => row.label.toLowerCase().includes('hoi'))?.status ||
                      'MISSING_ITEMS',
                  },
                  {
                    label: 'VOE',
                    status:
                      jrRows.find((row) => row.label.toLowerCase().includes('voe'))?.status ||
                      'MISSING_ITEMS',
                  },
                  {
                    label: 'Underwriting',
                    status:
                      jrRows.find((row) => row.label.toLowerCase().includes('underwriting'))?.status ||
                      'MISSING_ITEMS',
                  },
                ];
                return (
                <article
                  key={`${item.loanNumber}-${item.borrowerName}`}
                  className="group relative flex flex-col overflow-hidden rounded-2xl border border-slate-200/80 bg-white p-3 shadow-sm transition-all hover:border-blue-300 hover:ring-1 hover:ring-blue-100 hover:shadow-md"
                >
                  <div className="absolute -right-6 -top-6 h-20 w-20 rounded-full bg-slate-50 opacity-50 blur-2xl group-hover:bg-blue-50 transition-colors"></div>
                  <div className="relative flex items-start gap-3 min-w-0">
                    <button
                      type="button"
                      onClick={() => openBorrowerDetail(item, 'jr')}
                      className={`mt-0.5 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg shadow-sm ring-1 ring-black/5 transition-all duration-150 hover:scale-[1.03] hover:border-blue-300 hover:bg-blue-50 hover:text-blue-700 hover:ring-blue-200 ${getIconButtonClassByState(
                        jrIconState
                      )}`}
                      title="Open submission details"
                      aria-label="Open submission details"
                    >
                      <FileText className="h-4 w-4" />
                    </button>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          {item.latestUpdatedAt && (
                            <div className="mb-0.5 flex flex-wrap items-center gap-1.5">
                              <p className="inline-flex items-center text-[11px] font-medium text-slate-500 leading-none">
                                <Calendar className="mr-1 h-3 w-3 text-slate-400" />
                                {formatCompactDateTime(item.latestUpdatedAt)}
                              </p>
                            </div>
                          )}
                          <p className="text-sm font-bold leading-snug text-slate-900 line-clamp-1">
                            {item.borrowerName}
                          </p>
                          <p className="text-xs font-medium text-slate-500 truncate">{item.loanNumber}</p>
                          {item.earliestCreatedAt && (
                            <div className="mt-1 flex flex-wrap items-center gap-1.5">
                              <button
                                type="button"
                                onClick={() => openLifecycleFromCard(item, 'jr')}
                                className={`inline-flex items-center rounded-full border px-1.5 py-0.5 text-[10px] font-bold leading-none transition hover:brightness-95 ${getTimerClassName(
                                  Date.now() - item.earliestCreatedAt.getTime()
                                )}`}
                                title="Total time from first VA/JR task creation (click for lifecycle timeline)"
                              >
                                <Clock3 className="mr-1 h-2.5 w-2.5" />
                                Total {formatElapsedTimerLabel(Date.now() - item.earliestCreatedAt.getTime())}
                              </button>
                            </div>
                          )}
                        </div>
                        <div className="inline-flex items-start gap-1.5 shrink-0">
                          <div className="flex max-w-[240px] flex-wrap justify-end gap-1">
                            {jrStatusPills.map((row) => (
                              <span
                                key={row.label}
                                className={`inline-flex items-center rounded-full border px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide ${getJrChecklistStatusClass(
                                  row.status
                                )}`}
                                title={`${row.label}: ${formatJrChecklistStatus(row.status)}`}
                              >
                                {row.label}
                              </span>
                            ))}
                          </div>
                          <button
                            type="button"
                            onClick={() =>
                              setExpandedBorrowerCards((prev) => {
                                const next = new Set(prev);
                                if (next.has(cardKey)) next.delete(cardKey);
                                else next.add(cardKey);
                                return next;
                              })
                            }
                            className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-slate-200 bg-white text-slate-500 hover:bg-slate-50 hover:text-slate-700"
                            title={cardExpanded ? 'Collapse card' : 'Expand card'}
                            aria-label={cardExpanded ? 'Collapse card' : 'Expand card'}
                          >
                            {cardExpanded ? (
                              <ChevronUp className="h-4 w-4" />
                            ) : (
                              <ChevronDown className="h-4 w-4" />
                            )}
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                  {cardExpanded && (
                    <div className="mt-2 border-t border-slate-200 pt-2">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="inline-flex items-center rounded-full border border-slate-200 bg-white px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-600">
                          Worked By
                        </span>
                        {(workedBy.length > 0
                          ? workedBy
                          : [{ name: 'Unassigned', role: null as null }]).map((contributor) => (
                          <span
                            key={contributor.name}
                            className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold ${getRoleBubbleClass(
                              contributor.role
                            )}`}
                          >
                            {contributor.name}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                </article>
              );
            })}
              </div>
            )}
          </BucketPanel>
        )}

        <BucketPanel
          title="Completed VA & JR Processing"
          icon={<CheckCircle2 className="h-5 w-5 text-emerald-600" />}
          chipLabel="Completed Queue"
          count={filteredAndSorted.completed.length}
          searchValue={bucketControls.completed.search}
          onSearchChange={(value) =>
            setBucketControls((prev) => ({
              ...prev,
              completed: { ...prev.completed, search: value },
            }))
          }
          sortValue={bucketControls.completed.sort}
          onSortChange={(value) =>
            setBucketControls((prev) => ({ ...prev, completed: { ...prev.completed, sort: value } }))
          }
          globalSort={globalSort}
        >
          {filteredAndSorted.completed.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-10 text-center">
              <CheckCircle2 className="h-6 w-6 text-slate-300" />
              <p className="mt-2 text-xs font-medium text-slate-500">
                No fully completed VA/JR requests yet.
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {filteredAndSorted.completed.map((item) => {
                const cardKey = `${item.loanNumber}-${item.borrowerName}-completed`;
                const cardExpanded = expandedBorrowerCards.has(cardKey);
                const workedBy = item.workedByContributors;
                const jrChecklistRows = item.jrStageDetails.hoi.checklist;
                const getJrDone = (keyword: 'hoi' | 'voe' | 'underwriting') => {
                  if (jrChecklistRows.length === 0) {
                    if (keyword === 'hoi') return item.jrStageDetails.hoi.completed;
                    return false;
                  }
                  const match = jrChecklistRows.find((row) =>
                    row.label.toLowerCase().includes(keyword)
                  );
                  return Boolean(match && match.status === 'COMPLETED');
                };
                const combinedRows = [
                  { label: 'Title', done: item.vaStageDetails.title.completed },
                  { label: 'Payoff', done: item.vaStageDetails.payoff.completed },
                  { label: 'Appraisal', done: item.vaStageDetails.appraisal.completed },
                  { label: 'HOI', done: getJrDone('hoi') },
                  { label: 'VOE', done: getJrDone('voe') },
                  { label: 'Underwriting', done: getJrDone('underwriting') },
                ];
                const vaRows = combinedRows.slice(0, 3);
                const jrRows = combinedRows.slice(3, 6);
                const allComplete = combinedRows.every((row) => row.done);
                const iconState: 'not_started' | 'working' | 'completed' = allComplete
                  ? 'completed'
                  : 'working';
                return (
                  <article
                    key={`${item.loanNumber}-${item.borrowerName}`}
                    className="group relative flex flex-col overflow-hidden rounded-2xl border border-slate-200/80 bg-white p-3 shadow-sm transition-all hover:border-blue-300 hover:ring-1 hover:ring-blue-100 hover:shadow-md"
                  >
                    <div className="absolute -right-6 -top-6 h-20 w-20 rounded-full bg-slate-50 opacity-50 blur-2xl group-hover:bg-blue-50 transition-colors"></div>
                    <div className="relative flex items-start gap-3 min-w-0">
                      <button
                        type="button"
                        onClick={() => openBorrowerDetail(item, 'completed')}
                        className={`mt-0.5 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg shadow-sm ring-1 ring-black/5 transition-all duration-150 hover:scale-[1.03] hover:border-blue-300 hover:bg-blue-50 hover:text-blue-700 hover:ring-blue-200 ${getIconButtonClassByState(
                          iconState
                        )}`}
                        title="Open submission details"
                        aria-label="Open submission details"
                      >
                        <FileText className="h-4 w-4" />
                      </button>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            {item.latestUpdatedAt && (
                              <div className="mb-0.5 flex flex-wrap items-center gap-1.5">
                                <p className="inline-flex items-center text-[11px] font-medium text-slate-500 leading-none">
                                  <Calendar className="mr-1 h-3 w-3 text-slate-400" />
                                  {formatCompactDateTime(item.latestUpdatedAt)}
                                </p>
                              </div>
                            )}
                            <p className="text-sm font-bold leading-snug text-slate-900 line-clamp-1">
                              {item.borrowerName}
                            </p>
                            <p className="text-xs font-medium text-slate-500 truncate">{item.loanNumber}</p>
                            {item.earliestCreatedAt && (
                              <div className="mt-1 flex flex-wrap items-center gap-1.5">
                                <button
                                  type="button"
                                  onClick={() => openLifecycleFromCard(item, 'completed')}
                                  className={`inline-flex items-center rounded-full border px-1.5 py-0.5 text-[10px] font-bold leading-none transition hover:brightness-95 ${getTimerClassName(
                                    Date.now() - item.earliestCreatedAt.getTime()
                                  )}`}
                                  title="Total time from first VA/JR task creation (click for lifecycle timeline)"
                                >
                                  <Clock3 className="mr-1 h-2.5 w-2.5" />
                                  Total {formatElapsedTimerLabel(Date.now() - item.earliestCreatedAt.getTime())}
                                </button>
                              </div>
                            )}
                          </div>
                          <div className="inline-flex items-start gap-1.5 shrink-0">
                            <div className="flex w-[270px] flex-col gap-1">
                              <div className="grid grid-cols-3 gap-1">
                                {vaRows.map((row) => (
                                  <span
                                    key={row.label}
                                    className={`inline-flex w-full min-w-0 items-center justify-center whitespace-nowrap rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${
                                      row.done
                                        ? 'border-emerald-300 bg-emerald-100 text-emerald-800'
                                        : 'border-rose-300 bg-rose-100 text-rose-800'
                                    }`}
                                    title={`${row.label}: ${row.done ? 'Completed' : 'Incomplete'}`}
                                  >
                                    {row.label}
                                  </span>
                                ))}
                              </div>
                              <div className="grid grid-cols-3 gap-1">
                                {jrRows.map((row) => (
                                  <span
                                    key={row.label}
                                    className={`inline-flex w-full min-w-0 items-center justify-center whitespace-nowrap rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${
                                      row.done
                                        ? 'border-emerald-300 bg-emerald-100 text-emerald-800'
                                        : 'border-rose-300 bg-rose-100 text-rose-800'
                                    }`}
                                    title={`${row.label}: ${row.done ? 'Completed' : 'Incomplete'}`}
                                  >
                                    {row.label}
                                  </span>
                                ))}
                              </div>
                            </div>
                            <button
                              type="button"
                              onClick={() =>
                                setExpandedBorrowerCards((prev) => {
                                  const next = new Set(prev);
                                  if (next.has(cardKey)) next.delete(cardKey);
                                  else next.add(cardKey);
                                  return next;
                                })
                              }
                              className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-slate-200 bg-white text-slate-500 hover:bg-slate-50 hover:text-slate-700"
                              title={cardExpanded ? 'Collapse card' : 'Expand card'}
                              aria-label={cardExpanded ? 'Collapse card' : 'Expand card'}
                            >
                              {cardExpanded ? (
                                <ChevronUp className="h-4 w-4" />
                              ) : (
                                <ChevronDown className="h-4 w-4" />
                              )}
                            </button>
                          </div>
                        </div>
                      </div>
                    </div>
                    {cardExpanded && (
                      <div className="mt-2 border-t border-slate-200 pt-2">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="inline-flex items-center rounded-full border border-slate-200 bg-white px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-600">
                            Worked By
                          </span>
                          {(workedBy.length > 0
                            ? workedBy
                            : [{ name: 'Unassigned', role: null as null }]).map((contributor) => (
                            <span
                              key={contributor.name}
                              className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold ${getRoleBubbleClass(
                                contributor.role
                              )}`}
                            >
                              {contributor.name}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}
                  </article>
                );
              })}
            </div>
          )}
        </BucketPanel>
      </div>

      {focusedItem && (
        <div
          className="fixed inset-0 z-[80] flex items-center justify-center bg-slate-900/45 p-4"
          onClick={() => setFocusedItemKey(null)}
        >
          <div
            className="w-full max-w-4xl max-h-[88vh] overflow-y-auto rounded-[24px] border border-slate-200/60 bg-slate-50 p-6 sm:p-8 shadow-2xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-5 border-b border-slate-200/60 pb-6">
              <div>
                <div className="mb-1.5 flex items-center gap-2">
                  <h2 className="text-2xl font-extrabold tracking-tight text-slate-900">
                    {focusedItem.borrowerName}
                  </h2>
                  <span className="inline-flex items-center rounded-md bg-white px-2.5 py-1 text-sm font-mono font-bold text-slate-600 ring-1 ring-inset ring-slate-200 shadow-sm">
                    {focusedItem.loanNumber}
                  </span>
                </div>
                <p className="text-sm font-medium text-slate-500">VA & JR Processing Details</p>
              </div>
              <button
                type="button"
                onClick={() => setFocusedItemKey(null)}
                className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white border border-slate-200 text-slate-400 hover:text-slate-600 hover:bg-slate-50"
                aria-label="Close VA submission details"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {focusedSubmissionGroups.length > 0 && (
              <div className="mt-6 rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200/60">
                <h4 className="mb-4 text-sm font-bold uppercase tracking-wide text-slate-700">
                  QC Submission Snapshot
                </h4>
                <div className="space-y-4">
                  {focusedSubmissionGroups.map((group) => (
                    <div key={group.title} className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                      <p className="mb-3 text-xs font-bold uppercase tracking-wide text-slate-700">
                        {group.title}
                      </p>
                      <div className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
                        {group.rows.map((row) => (
                          <div key={row.key} className="flex flex-col">
                            <span className="text-[11px] font-bold uppercase tracking-wide text-slate-500">
                              {row.label}
                            </span>
                            <span className="text-sm font-semibold text-slate-900">{row.value}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="mt-6 space-y-4">
              <div className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200/60">
                <h4 className="mb-4 text-sm font-bold uppercase tracking-wide text-slate-700">
                  {focusedQueue === 'jr'
                    ? 'JR Task Completion & Proof'
                    : focusedQueue === 'va'
                    ? 'VA Task Completion & Proof'
                    : 'VA & JR Task Completion & Proof'}
                </h4>
                <div className="space-y-3">
                  {showVaDetails &&
                    [
                      { key: 'title' as const, icon: FileText },
                      { key: 'payoff' as const, icon: DollarSign },
                      { key: 'appraisal' as const, icon: ClipboardCheck },
                    ].map(({ key, icon: Icon }) => {
                    const label = stageLabelByKey[key];
                    const detail = focusedItem.vaStageDetails[key];
                    const latestNote = detail.latestNote;
                    const stageNoteKey = `${focusedItem.loanNumber}-${key}`;
                    const stageDetailKey = `${focusedItem.loanNumber}-${key}-detail`;
                    const stageDetailsExpanded = expandedTaskDetails.has(stageDetailKey);
                    const stageNoteExpanded = expandedStageNotes.has(stageNoteKey);
                    const notePreview = latestNote?.message || '';
                    const canToggleStageNote = notePreview.length > 180;
                    const visibleNote = canToggleStageNote && !stageNoteExpanded
                      ? `${notePreview.slice(0, 180)}...`
                      : notePreview;
                    const stageElapsedMs = getStageElapsedMs(
                      detail.createdAt,
                      detail.updatedAt,
                      detail.completed,
                      timerNowMs
                    );
                    return (
                      <div
                        key={label}
                        className={`rounded-xl border p-3.5 ${
                          detail.completed
                            ? 'border-emerald-200 bg-emerald-50'
                            : 'border-rose-200 bg-rose-50'
                        }`}
                      >
                        <div className="flex items-center justify-between gap-3">
                          <span className="inline-flex items-center gap-2 text-lg font-extrabold tracking-tight text-slate-900">
                            <span
                              className={`inline-flex h-6 w-6 items-center justify-center rounded-md ${
                                detail.completed
                                  ? 'bg-emerald-100 text-emerald-700'
                                  : 'bg-rose-100 text-rose-700'
                              }`}
                            >
                              <Icon className="h-3.5 w-3.5" />
                            </span>
                            {label}
                          </span>
                          <div className="inline-flex items-center gap-2.5 shrink-0">
                            {stageElapsedMs !== null && (
                              <span
                                className={`inline-flex items-center rounded-full border px-2.5 py-1 text-[11px] font-bold ${getTimerClassName(
                                  stageElapsedMs
                                )}`}
                                title={
                                  detail.completed
                                    ? 'Total elapsed time for this completed VA task'
                                    : 'Elapsed time for this active VA task'
                                }
                              >
                                <Clock3 className="mr-1 h-3 w-3" />
                                Total {formatElapsedTimerLabel(stageElapsedMs)}
                              </span>
                            )}
                            <span
                              className={`inline-flex items-center rounded-full border px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide ${
                                detail.completed
                                  ? 'border-emerald-300 bg-emerald-100 text-emerald-800'
                                  : 'border-rose-300 bg-rose-100 text-rose-800'
                              }`}
                            >
                              {detail.completed ? 'Completed' : 'Incomplete'}
                            </span>
                            <button
                              type="button"
                              onClick={() =>
                                setExpandedTaskDetails((prev) => {
                                  const next = new Set(prev);
                                  if (next.has(stageDetailKey)) next.delete(stageDetailKey);
                                  else next.add(stageDetailKey);
                                  return next;
                                })
                              }
                              className="inline-flex h-10 items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-700 shadow-sm hover:bg-slate-100"
                            >
                              <FileText className="h-4 w-4" />
                              {stageDetailsExpanded ? 'Hide Details' : 'Show Details'}
                            </button>
                          </div>
                        </div>
                        {stageDetailsExpanded && (
                          <>
                            {detail.proofAttachments.length === 0 ? (
                              <p className="mt-2 text-xs font-medium text-slate-600">
                                No proof uploaded yet.
                              </p>
                            ) : (
                              <div className="mt-2 flex flex-wrap items-center gap-2">
                                {detail.proofAttachments.map((att) => (
                                  <button
                                    key={att.id}
                                    type="button"
                                    onClick={() => void openAttachment(att.id)}
                                    disabled={openingAttachmentId === att.id}
                                    className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-60"
                                    title={`Open ${att.filename}`}
                                  >
                                    {openingAttachmentId === att.id ? (
                                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                    ) : (
                                      <FileText className="h-3.5 w-3.5" />
                                    )}
                                    <span className="max-w-[200px] truncate">{att.filename}</span>
                                  </button>
                                ))}
                              </div>
                            )}

                            <div className="mt-2 rounded-lg border border-slate-200 bg-white/80 px-3 py-2">
                              <div className="flex items-center justify-between gap-2">
                                <p className="text-[11px] font-bold uppercase tracking-wide text-slate-500">
                                  Latest VA Note
                                </p>
                                {latestNote && (
                                  <span className="text-[11px] font-medium text-slate-500">
                                    {formatNoteDateTime(latestNote.date)}
                                  </span>
                                )}
                              </div>
                              {!latestNote ? (
                                <p className="mt-1 text-xs font-medium text-slate-500">
                                  No stage note yet.
                                </p>
                              ) : (
                                <>
                                  <p className="mt-1 text-xs font-semibold text-slate-700">
                                    {visibleNote}
                                  </p>
                                  <p className="mt-1 text-[11px] text-slate-500">
                                    {latestNote.author} • {formatRoleLabel(latestNote.role)}
                                  </p>
                                  {canToggleStageNote && (
                                    <button
                                      type="button"
                                      onClick={() =>
                                        setExpandedStageNotes((prev) => {
                                          const next = new Set(prev);
                                          if (next.has(stageNoteKey)) next.delete(stageNoteKey);
                                          else next.add(stageNoteKey);
                                          return next;
                                        })
                                      }
                                      className="mt-1 inline-flex items-center gap-1 text-[11px] font-semibold text-blue-700 hover:text-blue-800"
                                    >
                                      {stageNoteExpanded ? (
                                        <>
                                          Show Less <ChevronUp className="h-3 w-3" />
                                        </>
                                      ) : (
                                        <>
                                          Show More <ChevronDown className="h-3 w-3" />
                                        </>
                                      )}
                                    </button>
                                  )}
                                </>
                              )}
                            </div>
                          </>
                        )}
                      </div>
                    );
                  })}
                  {showJrDetails && (
                    <div ref={jrDetailSectionRef} className="space-y-3">
                      {[
                        { key: 'hoi' as const, icon: Home },
                      ].map(({ key }) => {
                        const detail = focusedItem.jrStageDetails[key];
                        const jrRows: Array<{
                          id: string;
                          label: string;
                          status: 'ORDERED' | 'MISSING_ITEMS' | 'COMPLETED';
                          proofAttachmentId: string | null;
                          proofFilename: string | null;
                          note: string | null;
                          noteUpdatedAt: string | null;
                          noteAuthor: string | null;
                          noteRole: string | null;
                        }> =
                          detail.checklist.length > 0
                            ? (detail.checklist as Array<{
                                id: string;
                                label: string;
                                status: 'ORDERED' | 'MISSING_ITEMS' | 'COMPLETED';
                                proofAttachmentId: string | null;
                                proofFilename: string | null;
                                note: string | null;
                                noteUpdatedAt: string | null;
                                noteAuthor: string | null;
                                noteRole: string | null;
                              }>)
                            : [
                                {
                                  id: 'ordered-hoi',
                                  label: 'HOI',
                                  status: detail.completed ? 'COMPLETED' : 'MISSING_ITEMS',
                                  proofAttachmentId: null,
                                  proofFilename: null,
                                  note: null,
                                  noteUpdatedAt: null,
                                  noteAuthor: null,
                                  noteRole: null,
                                },
                                {
                                  id: 'ordered-voe',
                                  label: 'VOE',
                                  status: detail.completed ? 'COMPLETED' : 'MISSING_ITEMS',
                                  proofAttachmentId: null,
                                  proofFilename: null,
                                  note: null,
                                  noteUpdatedAt: null,
                                  noteAuthor: null,
                                  noteRole: null,
                                },
                                {
                                  id: 'submitted-underwriting',
                                  label: 'Submitted to Underwriting',
                                  status: detail.completed ? 'COMPLETED' : 'MISSING_ITEMS',
                                  proofAttachmentId: null,
                                  proofFilename: null,
                                  note: null,
                                  noteUpdatedAt: null,
                                  noteAuthor: null,
                                  noteRole: null,
                                },
                              ];
                        const stageElapsedMs = getStageElapsedMs(
                          detail.createdAt,
                          detail.updatedAt,
                          detail.completed,
                          timerNowMs
                        );

                        return jrRows.map((row) => {
                          const rowComplete = row.status === 'COMPLETED';
                          const rowIsOrdered = row.status === 'ORDERED';
                          const rowPanelClass = rowComplete
                            ? 'border-emerald-200 bg-emerald-50'
                            : rowIsOrdered
                              ? 'border-yellow-200 bg-yellow-50'
                              : 'border-rose-200 bg-rose-50';
                          const rowIconClass = rowComplete
                            ? 'bg-emerald-100 text-emerald-700'
                            : rowIsOrdered
                              ? 'bg-yellow-100 text-yellow-700'
                              : 'bg-rose-100 text-rose-700';
                          const stageNoteKey = `${focusedItem.loanNumber}-${key}-${row.id}`;
                          const stageDetailKey = `${focusedItem.loanNumber}-${key}-${row.id}-detail`;
                          const stageDetailsExpanded = expandedTaskDetails.has(stageDetailKey);
                          const stageNoteExpanded = expandedStageNotes.has(stageNoteKey);
                          const fallbackLatestNote = detail.latestNote;
                          const noteMessage = (row.note || '').trim() || fallbackLatestNote?.message || '';
                          const noteDate = row.noteUpdatedAt || fallbackLatestNote?.date || null;
                          const noteAuthor = row.noteAuthor || fallbackLatestNote?.author || null;
                          const noteRole = row.noteRole || fallbackLatestNote?.role || null;
                          const notePreview = noteMessage;
                          const canToggleStageNote = notePreview.length > 180;
                          const visibleNote =
                            canToggleStageNote && !stageNoteExpanded
                              ? `${notePreview.slice(0, 180)}...`
                              : notePreview;
                          const proofAttachmentId = row.proofAttachmentId;

                          return (
                            <div
                              key={row.id}
                              className={`rounded-xl border p-3.5 ${rowPanelClass}`}
                            >
                              <div className="flex items-center justify-between gap-3">
                                <span className="inline-flex items-center gap-2 text-lg font-extrabold tracking-tight text-slate-900">
                                  <span className={`inline-flex h-6 w-6 items-center justify-center rounded-md ${rowIconClass}`}>
                                    <FileText className="h-3.5 w-3.5" />
                                  </span>
                                  {row.label}
                                </span>
                                <div className="inline-flex items-center gap-2.5 shrink-0">
                                  {stageElapsedMs !== null && (
                                    <span
                                      className={`inline-flex items-center rounded-full border px-2.5 py-1 text-[11px] font-bold ${getTimerClassName(
                                        stageElapsedMs
                                      )}`}
                                      title={
                                        rowComplete
                                          ? 'Total elapsed time for this completed JR task'
                                          : 'Elapsed time for this active JR task'
                                      }
                                    >
                                      <Clock3 className="mr-1 h-3 w-3" />
                                      Total {formatElapsedTimerLabel(stageElapsedMs)}
                                    </span>
                                  )}
                                  <span
                                    className={`inline-flex items-center rounded-full border px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide ${getJrChecklistStatusClass(
                                      row.status
                                    )}`}
                                  >
                                    {formatJrChecklistStatus(row.status)}
                                  </span>
                                  <button
                                    type="button"
                                    onClick={() =>
                                      setExpandedTaskDetails((prev) => {
                                        const next = new Set(prev);
                                        if (next.has(stageDetailKey)) next.delete(stageDetailKey);
                                        else next.add(stageDetailKey);
                                        return next;
                                      })
                                    }
                                    className="inline-flex h-10 items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-700 shadow-sm hover:bg-slate-100"
                                  >
                                    <FileText className="h-4 w-4" />
                                    {stageDetailsExpanded ? 'Hide Details' : 'Show Details'}
                                  </button>
                                </div>
                              </div>

                              {stageDetailsExpanded && (
                                <>
                                  <div className="mt-2 rounded-lg border border-slate-200 bg-white/80 px-3 py-2">
                                    <div className="flex items-center justify-between gap-2">
                                      <p className="text-[11px] font-bold uppercase tracking-wide text-slate-500">
                                        Proof
                                      </p>
                                      {proofAttachmentId ? (
                                        <button
                                          type="button"
                                          onClick={() => void openAttachment(proofAttachmentId)}
                                          disabled={openingAttachmentId === proofAttachmentId}
                                          className="inline-flex items-center gap-1 rounded-md border border-blue-200 bg-blue-50 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-blue-700 hover:bg-blue-100 disabled:opacity-60"
                                        >
                                          {openingAttachmentId === proofAttachmentId ? (
                                            <>
                                              <Loader2 className="h-3 w-3 animate-spin" />
                                              Opening
                                            </>
                                          ) : (
                                            <>
                                              <Paperclip className="h-3 w-3" />
                                              {row.proofFilename || 'Open Proof'}
                                            </>
                                          )}
                                        </button>
                                      ) : (
                                        <span className="inline-flex items-center rounded-md border border-rose-200 bg-rose-50 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-rose-700">
                                          Missing
                                        </span>
                                      )}
                                    </div>
                                  </div>

                                  <div className="mt-2 rounded-lg border border-slate-200 bg-white/80 px-3 py-2">
                                    <div className="flex items-center justify-between gap-2">
                                      <p className="text-[11px] font-bold uppercase tracking-wide text-slate-500">
                                        {row.label} Note
                                      </p>
                                      {noteDate && (
                                        <span className="text-[11px] font-medium text-slate-500">
                                          {formatNoteDateTime(noteDate)}
                                        </span>
                                      )}
                                    </div>
                                    {!noteMessage ? (
                                      <p className="mt-1 text-xs font-medium text-slate-500">
                                        No note yet for this checklist item.
                                      </p>
                                    ) : (
                                      <>
                                        <p className="mt-1 text-xs font-semibold text-slate-700">
                                          {visibleNote}
                                        </p>
                                        {noteAuthor && (
                                          <p className="mt-1 text-[11px] text-slate-500">
                                            {noteAuthor}
                                            {noteRole ? ` • ${formatRoleLabel(noteRole)}` : ''}
                                          </p>
                                        )}
                                        {canToggleStageNote && (
                                          <button
                                            type="button"
                                            onClick={() =>
                                              setExpandedStageNotes((prev) => {
                                                const next = new Set(prev);
                                                if (next.has(stageNoteKey)) next.delete(stageNoteKey);
                                                else next.add(stageNoteKey);
                                                return next;
                                              })
                                            }
                                            className="mt-1 inline-flex items-center gap-1 text-[11px] font-semibold text-blue-700 hover:text-blue-800"
                                          >
                                            {stageNoteExpanded ? (
                                              <>
                                                Show Less <ChevronUp className="h-3 w-3" />
                                              </>
                                            ) : (
                                              <>
                                                Show More <ChevronDown className="h-3 w-3" />
                                              </>
                                            )}
                                          </button>
                                        )}
                                      </>
                                    )}
                                  </div>
                                </>
                              )}
                            </div>
                          );
                        });
                      })}
                    </div>
                  )}
                </div>
              </div>

            </div>
          </div>
        </div>
      )}
      {lifecyclePopup && (
        <div
          className="fixed inset-0 z-[95] flex items-center justify-center bg-slate-900/45 p-4"
          onClick={() => setLifecyclePopup(null)}
        >
          <div
            className="w-[96vw] max-w-[1400px] max-h-[calc(100vh-3.5rem)] overflow-y-auto rounded-2xl border border-slate-200 bg-slate-50 p-6 shadow-2xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="mb-4 flex items-center justify-between gap-3 border-b border-slate-200 pb-3">
              <div className="flex items-start gap-3">
                <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-blue-200 bg-blue-50 text-blue-700 shadow-sm">
                  <Clock3 className="h-5 w-5" />
                </span>
                <div>
                  <p className="text-2xl font-extrabold tracking-tight text-slate-900">
                    Lifecycle Timeline
                  </p>
                  <p className="mt-0.5 text-sm font-semibold text-slate-700">
                    {lifecyclePopup.title}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setLifecyclePopup(null)}
                className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-500 hover:text-slate-700"
                aria-label="Close lifecycle modal"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="space-y-3">
              {lifecyclePopup.stages.map((stage) => (
                <div key={stage.label} className="rounded-xl border border-slate-200 bg-white p-3">
                  <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                    <p className="text-sm font-bold text-slate-900">{stage.label}</p>
                    <div className="flex items-center gap-2">
                      <span className="inline-flex items-center rounded-full border border-emerald-300 bg-emerald-100 px-2 py-0.5 text-[11px] font-bold text-emerald-800">
                        Completed Total {formatLifecycleDuration(stage.breakdown.totalDurationMs)}
                      </span>
                    </div>
                  </div>
                  <div className="rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-2">
                    <div className="mb-3 grid grid-cols-12 items-center gap-2 border-b border-slate-200 pb-2">
                      <p className="col-span-5 text-[10px] font-bold uppercase tracking-wide text-slate-600">
                        Bucket
                      </p>
                      <p className="col-span-2 text-[10px] font-bold uppercase tracking-wide text-slate-600">
                        Time
                      </p>
                      <p className="col-span-5 text-[10px] font-bold uppercase tracking-wide text-slate-600">
                        Worked By
                      </p>
                    </div>
                    <div className="flex flex-col items-start gap-2">
                      {getOrderedLifecycleRows(stage.breakdown).length > 0 ? (
                        getOrderedLifecycleRows(stage.breakdown).map((row) => (
                          <div
                            key={row.id}
                            className="grid w-full grid-cols-12 items-center gap-2 rounded-lg border border-slate-100 bg-slate-50/60 px-2 py-2"
                          >
                            <div className="col-span-5 flex items-center">
                              <span
                                className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-bold ${getLifecycleBucketBubbleClass(
                                  row.key,
                                  row.label,
                                  stage.label
                                )}`}
                                title={`Bucket: ${row.label}`}
                              >
                                {row.label}
                              </span>
                            </div>
                            <div className="col-span-2 flex items-center">
                              <span
                                className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-bold ${getTimerClassName(
                                  row.durationMs
                                )}`}
                                title={`${row.label}: ${formatLifecycleDuration(row.durationMs)}`}
                              >
                                {formatLifecycleDuration(row.durationMs)}
                              </span>
                            </div>
                            <div className="col-span-5 flex flex-wrap items-center gap-1">
                              {(() => {
                                const isNewBucketRow = row.key === 'NONE' || row.key === 'PENDING';
                                const mergedActors = [...row.actors];
                                if (isNewBucketRow) {
                                  for (const actor of stage.fallbackActors) {
                                    if (
                                      !mergedActors.some(
                                        (entry) =>
                                          entry.name === actor.name && entry.role === actor.role
                                      )
                                    ) {
                                      mergedActors.push(actor);
                                    }
                                  }
                                }

                                return mergedActors.length > 0 ? (
                                  mergedActors.map((actor) => (
                                  <span
                                    key={`${row.key}-${actor.name}-${actor.role || 'none'}`}
                                    className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold ${getRoleBubbleClass(
                                      actor.role
                                    )}`}
                                    title={`${row.label} updated by ${actor.name}`}
                                  >
                                    {actor.name}
                                  </span>
                                  ))
                                ) : (
                                  <span className="text-[11px] font-medium text-slate-500">
                                    No user captured
                                  </span>
                                );
                              })()}
                            </div>
                          </div>
                        ))
                      ) : (
                        <span className="text-[11px] font-medium text-slate-500">
                          No bucket duration data captured for this stage.
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
