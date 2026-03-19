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
  return 'border-blue-300 bg-blue-100 text-blue-800';
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
  children,
}: {
  title: string;
  icon: React.ReactNode;
  chipLabel: string;
  count: number;
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
      <div className="mb-2 flex items-center rounded-md border border-slate-200 bg-white py-1.5 pl-2.5 pr-2 text-[11px] text-slate-400">
        <Search className="mr-1.5 h-3 w-3" />
        Search bucket
      </div>
      <div className="h-[300px] overflow-y-auto pr-1">{children}</div>
    </div>
  );
}

export function LoVaBorrowerProgressList({
  items,
  className,
}: {
  items: LoVaBorrowerProgressItem[];
  className?: string;
}) {
  const [focusedItemKey, setFocusedItemKey] = React.useState<string | null>(null);
  const [focusedQueue, setFocusedQueue] = React.useState<'va' | 'jr' | 'completed'>('va');
  const [openingAttachmentId, setOpeningAttachmentId] = React.useState<string | null>(null);
  const jrDetailSectionRef = React.useRef<HTMLDivElement | null>(null);
  const [expandedStageNotes, setExpandedStageNotes] = React.useState<Set<string>>(() => new Set());
  const [expandedTaskDetails, setExpandedTaskDetails] = React.useState<Set<string>>(() => new Set());
  const [expandedBorrowerCards, setExpandedBorrowerCards] = React.useState<Set<string>>(
    () => new Set()
  );
  const [timerNowMs, setTimerNowMs] = React.useState(() => Date.now());
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
  const showVaDetails = focusedQueue !== 'jr';
  const showJrDetails = focusedQueue !== 'va';

  const openBorrowerDetail = React.useCallback(
    (item: LoVaBorrowerProgressItem, queue: 'va' | 'jr' | 'completed') => {
      setFocusedQueue(queue);
      setFocusedItemKey(`${item.loanNumber}-${item.borrowerName}`);
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
      <div className="grid gap-3.5 md:grid-cols-3">
        <BucketPanel
          title="VA Bucket"
          icon={<FileCheck2 className="h-5 w-5 text-rose-600" />}
          chipLabel="VA Queue"
          count={vaItems.length}
        >
          {vaItems.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-10 text-center">
              <CheckCircle2 className="h-6 w-6 text-slate-300" />
              <p className="mt-2 text-xs font-medium text-slate-500">No VA requests in queue.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {vaItems.map((item) => {
                const cardKey = `${item.loanNumber}-${item.borrowerName}-va`;
                const cardExpanded = expandedBorrowerCards.has(cardKey);
                const workedBy = item.workedByNames;
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
                      className="mt-0.5 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-emerald-100 text-emerald-700 shadow-sm ring-1 ring-black/5 hover:bg-emerald-200/80"
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
                              <span
                                className={`inline-flex items-center rounded-full border px-1.5 py-0.5 text-[10px] font-bold leading-none ${getTimerClassName(
                                  Date.now() - item.earliestCreatedAt.getTime()
                                )}`}
                                title="Total time from first VA task creation"
                              >
                                <Clock3 className="mr-1 h-2.5 w-2.5" />
                                Total {formatElapsedTimerLabel(Date.now() - item.earliestCreatedAt.getTime())}
                              </span>
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
                        {(workedBy.length > 0 ? workedBy : ['Unassigned']).map((name) => (
                          <span
                            key={name}
                            className="inline-flex items-center rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10px] font-semibold text-amber-700"
                          >
                            {name}
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

        <BucketPanel
          title="JR Processor"
          icon={<UserCog className="h-5 w-5 text-slate-600" />}
          chipLabel="Processor Queue"
          count={jrItems.length}
        >
          {jrItems.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-10 text-center">
              <CheckCircle2 className="h-6 w-6 text-slate-300" />
              <p className="mt-2 text-xs font-medium text-slate-500">No JR Processor requests in queue.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {jrItems.map((item) => {
                const cardKey = `${item.loanNumber}-${item.borrowerName}-jr`;
                const cardExpanded = expandedBorrowerCards.has(cardKey);
                const workedBy = item.workedByNames;
                const jrRows =
                  item.jrStageDetails.hoi.checklist.length > 0
                    ? item.jrStageDetails.hoi.checklist.map((row) => ({
                        label: row.label,
                        done: row.status === 'COMPLETED',
                      }))
                    : [{ label: 'HOI', done: item.jrStageDetails.hoi.completed }];
                const jrStatusPills = [
                  {
                    label: 'HOI',
                    done:
                      (jrRows.find((row) => row.label.toLowerCase().includes('hoi'))?.done ?? false) ||
                      false,
                  },
                  {
                    label: 'VOE',
                    done:
                      (jrRows.find((row) => row.label.toLowerCase().includes('voe'))?.done ?? false) ||
                      false,
                  },
                  {
                    label: 'Underwriting',
                    done:
                      (jrRows.find((row) =>
                        row.label.toLowerCase().includes('underwriting')
                      )?.done ?? false) || false,
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
                      className="mt-0.5 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-emerald-100 text-emerald-700 shadow-sm ring-1 ring-black/5 hover:bg-emerald-200/80"
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
                              <span
                                className={`inline-flex items-center rounded-full border px-1.5 py-0.5 text-[10px] font-bold leading-none ${getTimerClassName(
                                  Date.now() - item.earliestCreatedAt.getTime()
                                )}`}
                                title="Total time from first VA/JR task creation"
                              >
                                <Clock3 className="mr-1 h-2.5 w-2.5" />
                                Total {formatElapsedTimerLabel(Date.now() - item.earliestCreatedAt.getTime())}
                              </span>
                            </div>
                          )}
                        </div>
                        <div className="inline-flex items-start gap-1.5 shrink-0">
                          <div className="flex max-w-[240px] flex-wrap justify-end gap-1">
                            {jrStatusPills.map((row) => (
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
                        {(workedBy.length > 0 ? workedBy : ['Unassigned']).map((name) => (
                          <span
                            key={name}
                            className="inline-flex items-center rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10px] font-semibold text-amber-700"
                          >
                            {name}
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

        <BucketPanel
          title="Completed VA & JR Processing"
          icon={<CheckCircle2 className="h-5 w-5 text-emerald-600" />}
          chipLabel="Completed Queue"
          count={completedItems.length}
        >
          {completedItems.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-10 text-center">
              <CheckCircle2 className="h-6 w-6 text-slate-300" />
              <p className="mt-2 text-xs font-medium text-slate-500">
                No fully completed VA/JR requests yet.
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {completedItems.map((item) => (
                <article
                  key={`${item.loanNumber}-${item.borrowerName}`}
                  className="group relative flex flex-col overflow-hidden rounded-2xl border border-emerald-200/80 bg-emerald-50/40 p-3 shadow-sm transition-all hover:border-emerald-300 hover:shadow-md"
                >
                  <div className="absolute -right-6 -top-6 h-20 w-20 rounded-full bg-emerald-100/70 opacity-60 blur-2xl"></div>
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="min-w-0">
                        {item.latestUpdatedAt && (
                          <p className="mb-0.5 inline-flex items-center text-[11px] font-medium text-slate-500 leading-none">
                            <Calendar className="mr-1 h-3 w-3 text-slate-400" />
                            {formatCompactDateTime(item.latestUpdatedAt)}
                          </p>
                        )}
                        <div className="flex items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => openBorrowerDetail(item, 'completed')}
                            className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-600 shadow-sm hover:border-blue-300 hover:bg-slate-50 hover:text-blue-700"
                            title="Open borrower submission details"
                            aria-label="Open borrower submission details"
                          >
                            <FileText className="h-3.5 w-3.5" />
                          </button>
                          <p className="truncate text-sm font-bold text-slate-900">
                            {item.borrowerName}
                          </p>
                        </div>
                        <p className="text-xs text-slate-500">{item.loanNumber}</p>
                      </div>
                    </div>
                    <div className="flex max-w-[60%] flex-col items-end gap-1.5">
                      <span className="inline-flex items-center rounded-full border border-emerald-300 bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold text-emerald-800">
                        Completed
                      </span>
                      <div className="flex flex-wrap justify-end items-center gap-1.5">
                        <span className="inline-flex items-center rounded-full border border-slate-200 bg-white px-2 py-0.5 text-[10px] font-semibold text-slate-700">
                          VA {item.vaCompletedCount}/{item.vaTotalCount}
                        </span>
                        <span className="inline-flex items-center rounded-full border border-slate-200 bg-white px-2 py-0.5 text-[10px] font-semibold text-slate-700">
                          JR {item.jrCompletedCount}/{item.jrTotalCount}
                        </span>
                      </div>
                    </div>
                  </div>
                  <SummaryRows
                    rows={[
                      { label: 'Title', done: item.vaStageDetails.title.completed },
                      { label: 'Payoff', done: item.vaStageDetails.payoff.completed },
                      { label: 'Appraisal', done: item.vaStageDetails.appraisal.completed },
                      ...(item.jrStageDetails.hoi.checklist.length > 0
                        ? item.jrStageDetails.hoi.checklist.map((row) => ({
                            label: row.label,
                            done: row.status === 'COMPLETED',
                          }))
                        : [{ label: 'HOI', done: item.jrStageDetails.hoi.completed }]),
                    ]}
                  />
                </article>
              ))}
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
                        const jrRows =
                          detail.checklist.length > 0
                            ? detail.checklist
                            : [
                                {
                                  id: 'ordered-hoi',
                                  label: 'HOI',
                                  status: detail.completed ? 'COMPLETED' : 'MISSING_ITEMS',
                                  proofAttachmentId: null,
                                  proofFilename: null,
                                },
                                {
                                  id: 'ordered-voe',
                                  label: 'VOE',
                                  status: detail.completed ? 'COMPLETED' : 'MISSING_ITEMS',
                                  proofAttachmentId: null,
                                  proofFilename: null,
                                },
                                {
                                  id: 'submitted-underwriting',
                                  label: 'Submitted to Underwriting',
                                  status: detail.completed ? 'COMPLETED' : 'MISSING_ITEMS',
                                  proofAttachmentId: null,
                                  proofFilename: null,
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
                          const stageNoteKey = `${focusedItem.loanNumber}-${key}-${row.id}`;
                          const stageDetailKey = `${focusedItem.loanNumber}-${key}-${row.id}-detail`;
                          const stageDetailsExpanded = expandedTaskDetails.has(stageDetailKey);
                          const stageNoteExpanded = expandedStageNotes.has(stageNoteKey);
                          const latestNote = detail.latestNote;
                          const notePreview = latestNote?.message || '';
                          const canToggleStageNote = notePreview.length > 180;
                          const visibleNote =
                            canToggleStageNote && !stageNoteExpanded
                              ? `${notePreview.slice(0, 180)}...`
                              : notePreview;
                          const proofAttachmentId = row.proofAttachmentId;

                          return (
                            <div
                              key={row.id}
                              className={`rounded-xl border p-3.5 ${
                                rowComplete
                                  ? 'border-emerald-200 bg-emerald-50'
                                  : 'border-rose-200 bg-rose-50'
                              }`}
                            >
                              <div className="flex items-center justify-between gap-3">
                                <span className="inline-flex items-center gap-2 text-lg font-extrabold tracking-tight text-slate-900">
                                  <span
                                    className={`inline-flex h-6 w-6 items-center justify-center rounded-md ${
                                      rowComplete
                                        ? 'bg-emerald-100 text-emerald-700'
                                        : 'bg-rose-100 text-rose-700'
                                    }`}
                                  >
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
                                    className={`inline-flex items-center rounded-full border px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide ${
                                      rowComplete
                                        ? 'border-emerald-300 bg-emerald-100 text-emerald-800'
                                        : 'border-rose-300 bg-rose-100 text-rose-800'
                                    }`}
                                  >
                                    {rowComplete ? 'Completed' : 'Incomplete'}
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
                                        Latest JR Note
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
    </section>
  );
}
