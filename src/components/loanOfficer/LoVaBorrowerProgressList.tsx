'use client';

import React from 'react';
import Link from 'next/link';
import {
  AlertTriangle,
  CheckCircle2,
  Circle,
  CircleDot,
  Clock3,
  Loader2,
  SearchCheck,
  ShieldCheck,
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

function summary(items: LoVaBorrowerProgressItem[]) {
  const borrowerCount = items.length;
  const completedTasks = items.reduce((sum, item) => sum + item.completedCount, 0);
  const requiredResponses = items.filter((item) => item.needsLoResponse).length;
  return { borrowerCount, completedTasks, requiredResponses };
}

function StatusChip({ label, state }: { label: string; state: VaChipState }) {
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${chipMeta[state].className}`}
      title={`${label}: ${chipMeta[state].label}`}
    >
      {label}: {chipMeta[state].label}
    </span>
  );
}

function StageCard({
  title,
  icon,
  subtitle,
  children,
}: {
  title: string;
  icon: React.ReactNode;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50/40 p-3">
      <div className="mb-2 flex items-center gap-1.5">
        {icon}
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-700">{title}</p>
      </div>
      {subtitle ? <p className="mb-2 text-[11px] text-slate-500">{subtitle}</p> : null}
      <div className="flex flex-wrap items-center gap-1.5">{children}</div>
    </div>
  );
}

export function LoVaBorrowerProgressList({
  items,
  title = 'VA Borrower Progress',
  subtitle = 'Track each borrower across Title, HOI, Payoff, and Appraisal without opening long bucket rows.',
  className,
}: {
  items: LoVaBorrowerProgressItem[];
  title?: string;
  subtitle?: string;
  className?: string;
}) {
  const [focusedItemKey, setFocusedItemKey] = React.useState<string | null>(null);
  const [openingAttachmentId, setOpeningAttachmentId] = React.useState<string | null>(null);
  const totals = summary(items);
  const focusedItem =
    focusedItemKey === null
      ? null
      : items.find((item) => `${item.loanNumber}-${item.borrowerName}` === focusedItemKey) || null;

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
    <section
      className={`max-w-6xl rounded-2xl border border-slate-200 bg-white shadow-sm ${className || ''}`}
    >
      <div className="border-b border-slate-100 px-5 py-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">{title}</h2>
            <p className="mt-0.5 text-sm text-slate-500">{subtitle}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-semibold text-slate-700">
              <CircleDot className="mr-1 h-3.5 w-3.5" />
              {totals.borrowerCount} Borrowers
            </span>
            <span className="inline-flex items-center rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700">
              <CheckCircle2 className="mr-1 h-3.5 w-3.5" />
              {totals.completedTasks} Completed Tasks
            </span>
            <span className="inline-flex items-center rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-xs font-semibold text-amber-700">
              <AlertTriangle className="mr-1 h-3.5 w-3.5" />
              {totals.requiredResponses} Need LO Response
            </span>
          </div>
        </div>
      </div>

      {items.length === 0 ? (
        <div className="px-5 py-8 text-sm text-slate-500">
          No VA borrower tasks yet. This section will populate after QC completion creates VA work.
        </div>
      ) : (
        <div className="divide-y divide-slate-100">
          {items.map((item) => (
            <article key={`${item.loanNumber}-${item.borrowerName}`} className="px-5 py-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setFocusedItemKey(`${item.loanNumber}-${item.borrowerName}`)}
                      className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md border border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
                      title={`Open VA submission details for ${item.borrowerName}`}
                      aria-label={`Open VA submission details for ${item.borrowerName}`}
                    >
                      <CircleDot className="h-3.5 w-3.5" />
                    </button>
                    <p className="truncate text-sm font-semibold text-slate-900">{item.borrowerName}</p>
                  </div>
                  <p className="text-xs text-slate-500">{item.loanNumber}</p>
                </div>
                <div className="flex items-center gap-2">
                  <span className="inline-flex items-center rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-semibold text-slate-700">
                    <Clock3 className="mr-1 h-3.5 w-3.5" />
                    {item.completedCount}/{item.totalCount} Complete
                  </span>
                  {item.needsLoResponse && item.actionTaskId ? (
                    <Link
                      href={`/tasks?taskId=${encodeURIComponent(item.actionTaskId)}`}
                      className="inline-flex items-center rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-1.5 text-xs font-semibold text-amber-800 hover:bg-amber-100"
                    >
                      Action Needed
                    </Link>
                  ) : item.detailTaskId ? (
                    <Link
                      href={`/tasks?taskId=${encodeURIComponent(item.detailTaskId)}`}
                      className="inline-flex items-center rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                    >
                      View
                    </Link>
                  ) : null}
                </div>
              </div>

              <div className="mt-3 grid gap-2.5 md:grid-cols-3">
                <StageCard
                  title="VA Bucket"
                  icon={<CircleDot className="h-3.5 w-3.5 text-rose-600" />}
                  subtitle="QC gate in progress"
                >
                  <span className="inline-flex items-center rounded-full border border-rose-200 bg-rose-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-rose-700">
                    <ShieldCheck className="mr-1 h-3 w-3" />
                    QC
                  </span>
                  <StatusChip label="Title" state={item.chips.title} />
                  <StatusChip label="HOI" state={item.chips.hoi} />
                  <StatusChip label="Payoff" state={item.chips.payoff} />
                  <StatusChip label="Appraisal" state={item.chips.appraisal} />
                </StageCard>

                <StageCard
                  title="JR Processor"
                  icon={<UserCog className="h-3.5 w-3.5 text-slate-600" />}
                  subtitle="Future auto-handoff placeholder"
                >
                  <span className="inline-flex items-center rounded-full border border-slate-200 bg-white px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-600">
                    Not Started
                  </span>
                </StageCard>

                <StageCard
                  title="SR Processor"
                  icon={<UserRoundCheck className="h-3.5 w-3.5 text-slate-600" />}
                  subtitle="Future auto-handoff placeholder"
                >
                  <span className="inline-flex items-center rounded-full border border-slate-200 bg-white px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-600">
                    Not Started
                  </span>
                </StageCard>
              </div>
            </article>
          ))}
        </div>
      )}
      <div className="border-t border-slate-100 bg-slate-50/50 px-5 py-2.5 text-xs text-slate-500">
        <span className="inline-flex items-center">
          <SearchCheck className="mr-1 h-3.5 w-3.5" />
          Appraisal shows Action Needed when your response is required.
        </span>
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
