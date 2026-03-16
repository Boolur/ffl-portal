'use client';

import React from 'react';
import Link from 'next/link';
import {
  Calendar,
  CheckCircle2,
  Circle,
  Clock3,
  FileText,
  FileCheck2,
  Search,
  Loader2,
  UserCog,
  UserRoundCheck,
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
  const [openingAttachmentId, setOpeningAttachmentId] = React.useState<string | null>(null);
  const focusedItem =
    focusedItemKey === null
      ? null
      : items.find((item) => `${item.loanNumber}-${item.borrowerName}` === focusedItemKey) || null;
  const jrQueueCount = 0;
  const srQueueCount = 0;

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

  return (
    <section className={`${className || ''}`}>
      <div className="grid gap-3.5 md:grid-cols-3">
        <BucketPanel
          title="VA Bucket"
          icon={<FileCheck2 className="h-5 w-5 text-rose-600" />}
          chipLabel="VA Queue"
          count={items.length}
        >
          {items.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-10 text-center">
              <CheckCircle2 className="h-6 w-6 text-slate-300" />
              <p className="mt-2 text-xs font-medium text-slate-500">No VA requests in queue.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {items.map((item) => (
                <article
                  key={`${item.loanNumber}-${item.borrowerName}`}
                  className="group relative flex flex-col overflow-hidden rounded-2xl border border-slate-200/80 bg-white p-3 shadow-sm transition-all hover:border-blue-300 hover:ring-1 hover:ring-blue-100 hover:shadow-md"
                >
                  <div className="absolute -right-6 -top-6 h-20 w-20 rounded-full bg-slate-50 opacity-50 blur-2xl group-hover:bg-blue-50 transition-colors"></div>
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      {item.latestUpdatedAt && (
                        <p className="mb-0.5 inline-flex items-center text-[11px] font-medium text-slate-500 leading-none">
                          <Calendar className="mr-1 h-3 w-3 text-slate-400" />
                          {formatCompactDateTime(item.latestUpdatedAt)}
                        </p>
                      )}
                      <div className="flex items-start gap-2 min-w-0">
                        <button
                          type="button"
                          onClick={() => setFocusedItemKey(`${item.loanNumber}-${item.borrowerName}`)}
                          className="mt-0.5 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-600 shadow-sm ring-1 ring-black/5 hover:bg-slate-200"
                          title={`Open VA submission details for ${item.borrowerName}`}
                          aria-label={`Open VA submission details for ${item.borrowerName}`}
                        >
                          <FileText className="h-4 w-4" />
                        </button>
                        <div className="min-w-0">
                          <p className="truncate text-sm font-bold text-slate-900">
                            {item.borrowerName}
                          </p>
                          <p className="text-xs text-slate-500">{item.loanNumber}</p>
                          {item.earliestCreatedAt && (
                            <span
                              className={`mt-1 inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold ${getTimerClassName(
                                Date.now() - item.earliestCreatedAt.getTime()
                              )}`}
                              title="Total time from first VA task creation"
                            >
                              <Clock3 className="mr-1 h-3 w-3" />
                              Total{' '}
                              {formatElapsedTimerLabel(
                                Date.now() - item.earliestCreatedAt.getTime()
                              )}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                    <div className="flex max-w-[55%] flex-col items-end gap-1.5">
                      <div className="flex items-center gap-1.5">
                        <span className="inline-flex items-center rounded-full border border-slate-200 bg-white px-2 py-0.5 text-[10px] font-semibold text-slate-700">
                          <Clock3 className="mr-1 h-3 w-3" />
                          {item.completedCount}/{item.totalCount}
                        </span>
                        {item.needsLoResponse && item.actionTaskId ? (
                          <Link
                            href={`/tasks?taskId=${encodeURIComponent(item.actionTaskId)}`}
                            className="inline-flex items-center rounded-lg border border-amber-200 bg-amber-50 px-2 py-1 text-[10px] font-semibold text-amber-800 hover:bg-amber-100"
                          >
                            Action Needed
                          </Link>
                        ) : item.detailTaskId ? (
                          <Link
                            href={`/tasks?taskId=${encodeURIComponent(item.detailTaskId)}`}
                            className="inline-flex items-center rounded-lg border border-slate-200 bg-white px-2 py-1 text-[10px] font-semibold text-slate-700 hover:bg-slate-50"
                          >
                            View
                          </Link>
                        ) : null}
                      </div>
                      <div className="flex flex-wrap justify-end items-center gap-1.5">
                        <StatusChip label="Title" state={item.chips.title} />
                        <StatusChip label="HOI" state={item.chips.hoi} />
                        <StatusChip label="Payoff" state={item.chips.payoff} />
                        <StatusChip label="Appraisal" state={item.chips.appraisal} />
                      </div>
                    </div>
                  </div>
                </article>
              ))}
            </div>
          )}
        </BucketPanel>

        <BucketPanel
          title="JR Processor"
          icon={<UserCog className="h-5 w-5 text-slate-600" />}
          chipLabel="Processor Queue"
          count={jrQueueCount}
        >
          <div className="flex flex-col items-center justify-center py-10 text-center">
            <UserCog className="h-6 w-6 text-slate-300" />
            <p className="mt-2 text-xs font-medium text-slate-600">Queue not active yet.</p>
            <p className="mt-1 max-w-[220px] text-[11px] text-slate-500">
              Borrowers move here after VA stage is complete.
            </p>
          </div>
        </BucketPanel>

        <BucketPanel
          title="SR Processor"
          icon={<UserRoundCheck className="h-5 w-5 text-slate-600" />}
          chipLabel="Processor Queue"
          count={srQueueCount}
        >
          <div className="flex flex-col items-center justify-center py-10 text-center">
            <UserRoundCheck className="h-6 w-6 text-slate-300" />
            <p className="mt-2 text-xs font-medium text-slate-600">Queue not active yet.</p>
            <p className="mt-1 max-w-[220px] text-[11px] text-slate-500">
              Borrowers move here after JR Processor completion.
            </p>
          </div>
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
                <p className="text-sm font-medium text-slate-500">VA Submission Details</p>
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

            {focusedItem.submissionSnapshot.length > 0 && (
              <div className="mt-6 rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200/60">
                <h4 className="mb-4 text-sm font-bold uppercase tracking-wide text-slate-700">
                  QC Submission Snapshot
                </h4>
                <div className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
                  {focusedItem.submissionSnapshot.map((row) => (
                    <div key={row.key} className="flex flex-col">
                      <span className="text-[11px] font-bold uppercase tracking-wide text-slate-500">
                        {row.label}
                      </span>
                      <span className="text-sm font-semibold text-slate-900">{row.value}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="mt-6 rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200/60">
              <h4 className="mb-4 text-sm font-bold uppercase tracking-wide text-slate-700">
                VA Task Completion
              </h4>
              <div className="grid gap-2 sm:grid-cols-2">
                {[
                  ['Title', focusedItem.stageDetails.title.completed],
                  ['HOI', focusedItem.stageDetails.hoi.completed],
                  ['Payoff', focusedItem.stageDetails.payoff.completed],
                  ['Appraisal', focusedItem.stageDetails.appraisal.completed],
                ].map(([label, completed]) => (
                  <div
                    key={String(label)}
                    className={`flex items-center justify-between rounded-lg border px-3 py-2 ${
                      completed
                        ? 'border-emerald-200 bg-emerald-50'
                        : 'border-rose-200 bg-rose-50'
                    }`}
                  >
                    <span className="text-sm font-semibold text-slate-800">{label}</span>
                    {completed ? (
                      <span className="inline-flex items-center text-emerald-700">
                        <CheckCircle2 className="h-4 w-4" />
                      </span>
                    ) : (
                      <span className="inline-flex items-center text-rose-700">
                        <Circle className="h-4 w-4 fill-current" />
                      </span>
                    )}
                  </div>
                ))}
              </div>
            </div>

            <div className="mt-6 rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200/60">
              <h4 className="mb-4 text-sm font-bold uppercase tracking-wide text-slate-700">
                Proof Attachments
              </h4>
              <div className="space-y-3">
                {[
                  { label: 'Title', attachments: focusedItem.stageDetails.title.proofAttachments },
                  { label: 'HOI', attachments: focusedItem.stageDetails.hoi.proofAttachments },
                  { label: 'Payoff', attachments: focusedItem.stageDetails.payoff.proofAttachments },
                  {
                    label: 'Appraisal',
                    attachments: focusedItem.stageDetails.appraisal.proofAttachments,
                  },
                ].map(({ label, attachments }) => (
                  <div key={String(label)} className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                    <p className="mb-2 text-xs font-bold uppercase tracking-wide text-slate-600">
                      {label}
                    </p>
                    {attachments.length === 0 ? (
                      <p className="text-xs font-medium text-slate-500">No proof uploaded yet.</p>
                    ) : (
                      <div className="flex flex-col gap-2">
                        {attachments.map((att) => (
                          <button
                            key={att.id}
                            type="button"
                            onClick={() => void openAttachment(att.id)}
                            disabled={openingAttachmentId === att.id}
                            className="inline-flex w-fit items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-60"
                          >
                            {openingAttachmentId === att.id && (
                              <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            )}
                            {att.filename}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
