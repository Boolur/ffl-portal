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
  MessageSquare,
  Search,
  Loader2,
  UserCog,
  UserRoundCheck,
  X,
} from 'lucide-react';
import { getTaskAttachmentDownloadUrl } from '@/app/actions/attachmentActions';
import type { LoVaBorrowerProgressItem, VaChipState } from '@/lib/loVaProgress';

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
    <div className="flex h-full min-h-[420px] flex-col rounded-2xl border border-border bg-card p-4 shadow-sm transition-all hover:shadow-md">
      <div className="mb-1.5 flex items-start justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2.5">
          {icon}
          <p className="truncate text-lg font-extrabold leading-snug tracking-tight text-foreground">
            {title}
          </p>
        </div>
        <span className="inline-flex h-7 min-w-7 shrink-0 items-center justify-center rounded-full app-pill px-2 text-xs font-bold shadow-sm ring-1 ring-border/60">
          {count}
        </span>
      </div>
      <div className="mb-3 flex flex-wrap items-center gap-1.5 border-b border-border/50 pb-1.5">
        <span className="inline-flex items-center rounded-full border border-border bg-secondary px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-muted-foreground shadow-sm">
          {chipLabel}
        </span>
      </div>
      <div className="mb-2 flex items-center rounded-md border border-border bg-card py-1.5 pl-2.5 pr-2 text-[11px] text-muted-foreground">
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
  const [expandedStageNotes, setExpandedStageNotes] = React.useState<Set<string>>(() => new Set());
  const [expandedTimelineNotes, setExpandedTimelineNotes] = React.useState<Set<string>>(
    () => new Set()
  );
  const focusedItem =
    focusedItemKey === null
      ? null
      : items.find((item) => `${item.loanNumber}-${item.borrowerName}` === focusedItemKey) || null;
  const focusedSubmissionGroups = React.useMemo(
    () => (focusedItem ? groupSubmissionSnapshot(focusedItem.submissionSnapshot) : []),
    [focusedItem]
  );
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

  React.useEffect(() => {
    setExpandedStageNotes(new Set());
    setExpandedTimelineNotes(new Set());
  }, [focusedItemKey]);

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
            <p className="mt-2 text-xs font-medium text-muted-foreground">No VA requests in queue.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {items.map((item) => (
                <article
                  key={`${item.loanNumber}-${item.borrowerName}`}
                  className="group relative flex flex-col overflow-hidden rounded-2xl border border-border bg-card p-3 shadow-sm transition-all hover:border-blue-300 hover:ring-1 hover:ring-blue-100 hover:shadow-md"
                >
                  <div className="absolute -right-6 -top-6 h-20 w-20 rounded-full bg-slate-50 opacity-50 blur-2xl group-hover:bg-blue-50 transition-colors"></div>
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-start gap-2 min-w-0">
                        <button
                          type="button"
                          onClick={() => setFocusedItemKey(`${item.loanNumber}-${item.borrowerName}`)}
                          className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-secondary text-muted-foreground shadow-sm ring-1 ring-black/5 hover:bg-muted"
                          title={`Open VA submission details for ${item.borrowerName}`}
                          aria-label={`Open VA submission details for ${item.borrowerName}`}
                        >
                          <FileText className="h-4 w-4" />
                        </button>
                        <div className="min-w-0">
                          {item.latestUpdatedAt && (
                          <p className="mb-0.5 inline-flex items-center text-[11px] font-medium text-muted-foreground leading-none">
                              <Calendar className="mr-1 h-3 w-3 text-muted-foreground" />
                              {formatCompactDateTime(item.latestUpdatedAt)}
                            </p>
                          )}
                          <p className="truncate text-sm font-bold text-foreground">
                            {item.borrowerName}
                          </p>
                          <p className="text-xs text-muted-foreground">{item.loanNumber}</p>
                          {item.earliestCreatedAt && (
                            (() => {
                              const elapsedMs = Math.max(
                                0,
                                (item.latestUpdatedAt || item.earliestCreatedAt).getTime() -
                                  item.earliestCreatedAt.getTime()
                              );
                              return (
                                <span
                                  className={`mt-1 inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold ${getTimerClassName(
                                    elapsedMs
                                  )}`}
                                  title="Elapsed time between first creation and latest update"
                                >
                                  <Clock3 className="mr-1 h-3 w-3" />
                                  Elapsed {formatElapsedTimerLabel(elapsedMs)}
                                </span>
                              );
                            })()
                          )}
                        </div>
                      </div>
                    </div>
                    <div className="flex max-w-[55%] flex-col items-end gap-1.5">
                      <div className="flex items-center gap-1.5">
                        <span className="inline-flex items-center rounded-full border border-border bg-card px-2 py-0.5 text-[10px] font-semibold text-foreground">
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
            <p className="mt-2 text-xs font-medium text-muted-foreground">Queue not active yet.</p>
            <p className="mt-1 max-w-[220px] text-[11px] text-muted-foreground">
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
            <p className="mt-2 text-xs font-medium text-muted-foreground">Queue not active yet.</p>
            <p className="mt-1 max-w-[220px] text-[11px] text-muted-foreground">
              Borrowers move here after JR Processor completion.
            </p>
          </div>
        </BucketPanel>
      </div>

      {focusedItem && (
        <div
          className="fixed inset-0 z-[80] flex items-center justify-center bg-black/60 p-4"
          onClick={() => setFocusedItemKey(null)}
        >
          <div
            className="w-full max-w-4xl max-h-[88vh] overflow-y-auto rounded-[24px] border border-border bg-background p-6 sm:p-8 shadow-2xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-5 border-b border-border pb-6">
              <div>
                <div className="mb-1.5 flex items-center gap-2">
                  <h2 className="text-2xl font-extrabold tracking-tight text-foreground">
                    {focusedItem.borrowerName}
                  </h2>
                  <span className="inline-flex items-center rounded-md bg-card px-2.5 py-1 text-sm font-mono font-bold text-muted-foreground ring-1 ring-inset ring-border shadow-sm">
                    {focusedItem.loanNumber}
                  </span>
                </div>
                <p className="text-sm font-medium text-muted-foreground">VA Submission Details</p>
              </div>
              <button
                type="button"
                onClick={() => setFocusedItemKey(null)}
                className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-card border border-border text-muted-foreground hover:text-foreground hover:bg-secondary"
                aria-label="Close VA submission details"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {focusedSubmissionGroups.length > 0 && (
              <div className="mt-6 rounded-2xl bg-card p-5 shadow-sm ring-1 ring-border">
                <h4 className="mb-4 text-sm font-bold uppercase tracking-wide text-foreground">
                  QC Submission Snapshot
                </h4>
                <div className="space-y-4">
                  {focusedSubmissionGroups.map((group) => (
                    <div key={group.title} className="rounded-xl border border-border bg-secondary p-4">
                      <p className="mb-3 text-xs font-bold uppercase tracking-wide text-foreground">
                        {group.title}
                      </p>
                      <div className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
                        {group.rows.map((row) => (
                          <div key={row.key} className="flex flex-col">
                            <span className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
                              {row.label}
                            </span>
                            <span className="text-sm font-semibold text-foreground">{row.value}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="mt-6 grid gap-4 lg:grid-cols-[1.35fr_1fr]">
              <div className="rounded-2xl bg-card p-5 shadow-sm ring-1 ring-border">
                <h4 className="mb-4 text-sm font-bold uppercase tracking-wide text-foreground">
                  VA Task Completion & Proof
                </h4>
                <div className="space-y-3">
                  {[
                    { key: 'title' as const, icon: FileText },
                    { key: 'hoi' as const, icon: Home },
                    { key: 'payoff' as const, icon: DollarSign },
                    { key: 'appraisal' as const, icon: ClipboardCheck },
                  ].map(({ key, icon: Icon }) => {
                    const label = stageLabelByKey[key];
                    const detail = focusedItem.stageDetails[key];
                    const latestNote = detail.latestNote;
                    const stageNoteKey = `${focusedItem.loanNumber}-${key}`;
                    const stageNoteExpanded = expandedStageNotes.has(stageNoteKey);
                    const notePreview = latestNote?.message || '';
                    const canToggleStageNote = notePreview.length > 180;
                    const visibleNote = canToggleStageNote && !stageNoteExpanded
                      ? `${notePreview.slice(0, 180)}...`
                      : notePreview;
                    return (
                      <div
                        key={label}
                        className={`rounded-xl border p-3.5 ${
                          detail.completed
                            ? 'border-emerald-200 bg-emerald-50'
                            : 'border-rose-200 bg-rose-50'
                        }`}
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <span className="inline-flex items-center gap-2 text-sm font-bold tracking-tight text-slate-800">
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
                          <span
                            className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${
                              detail.completed
                                ? 'border-emerald-300 bg-emerald-100 text-emerald-800'
                                : 'border-rose-300 bg-rose-100 text-rose-800'
                            }`}
                          >
                            {detail.completed ? 'Completed' : 'Incomplete'}
                          </span>
                        </div>

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

                <div className="mt-2 rounded-lg border border-border bg-card/80 px-3 py-2">
                          <div className="flex items-center justify-between gap-2">
                <p className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
                              Latest VA Note
                            </p>
                            {latestNote && (
                              <span className="text-[11px] font-medium text-muted-foreground">
                                {formatNoteDateTime(latestNote.date)}
                              </span>
                            )}
                          </div>
                          {!latestNote ? (
                            <p className="mt-1 text-xs font-medium text-muted-foreground">
                              No stage note yet.
                            </p>
                          ) : (
                            <>
                              <p className="mt-1 text-xs font-semibold text-foreground">
                                {visibleNote}
                              </p>
                              <p className="mt-1 text-[11px] text-muted-foreground">
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
                      </div>
                    );
                  })}
                </div>
              </div>

              <div className="rounded-2xl bg-card p-5 shadow-sm ring-1 ring-border">
                <div className="mb-4 flex items-center justify-between gap-2">
                  <h4 className="text-sm font-bold uppercase tracking-wide text-foreground">
                    VA Notes Timeline
                  </h4>
                  <span className="inline-flex items-center rounded-full border border-border bg-secondary px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
                    {focusedItem.notesTimeline.length} Notes
                  </span>
                </div>
                {focusedItem.notesTimeline.length === 0 ? (
                  <div className="rounded-xl border border-border bg-secondary p-3 text-xs font-medium text-muted-foreground">
                    No notes yet.
                  </div>
                ) : (
                  <div className="space-y-2.5">
                    {focusedItem.notesTimeline.map((note) => {
                      const isExpanded = expandedTimelineNotes.has(note.id);
                      const canToggle = note.message.length > 180;
                      const visibleMessage =
                        canToggle && !isExpanded
                          ? `${note.message.slice(0, 180)}...`
                          : note.message;
                      return (
                        <article
                          key={note.id}
                          className="rounded-xl border border-border bg-secondary p-3"
                        >
                          <div className="mb-1 flex items-center justify-between gap-2">
                            <span className="inline-flex items-center gap-1 rounded-full border border-blue-200 bg-blue-50 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-blue-700">
                              <MessageSquare className="h-3 w-3" />
                              {stageLabelByKey[note.stage]}
                            </span>
                            <span className="text-[11px] font-medium text-muted-foreground">
                              {formatNoteDateTime(note.date)}
                            </span>
                          </div>
                          <p className="text-xs font-semibold text-foreground">{visibleMessage}</p>
                          <p className="mt-1 text-[11px] text-muted-foreground">
                            {note.author} • {formatRoleLabel(note.role)}
                          </p>
                          {canToggle && (
                            <button
                              type="button"
                              onClick={() =>
                                setExpandedTimelineNotes((prev) => {
                                  const next = new Set(prev);
                                  if (next.has(note.id)) next.delete(note.id);
                                  else next.add(note.id);
                                  return next;
                                })
                              }
                              className="mt-1 inline-flex items-center gap-1 text-[11px] font-semibold text-blue-700 hover:text-blue-800"
                            >
                              {isExpanded ? (
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
                        </article>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
