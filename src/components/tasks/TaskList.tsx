'use client';

import React from 'react';
import {
  Calendar,
  CheckCircle,
  Clock3,
  ChevronDown,
  ChevronUp,
  FileText,
  Trash2,
  Loader2,
  X,
  User,
  DollarSign,
  Briefcase,
  Fingerprint,
  Hash,
  MessageSquare,
} from 'lucide-react';
import { useRouter } from 'next/navigation';
import {
  deleteTask,
  reviewInitialDisclosureFigures,
  requestInfoFromLoanOfficer,
  respondToDisclosureRequest,
  startDisclosureRequest,
  startQcRequest,
  updateTaskStatus,
} from '@/app/actions/taskActions';
import {
  createTaskAttachmentUploadUrl,
  deleteTaskAttachment,
  finalizeTaskAttachment,
  getTaskAttachmentDownloadUrl,
} from '@/app/actions/attachmentActions';
import {
  DisclosureDecisionReason,
  Prisma,
  TaskAttachmentPurpose,
  TaskKind,
  TaskStatus,
  TaskWorkflowState,
  UserRole,
} from '@prisma/client';

const disclosureReasonOptions: Array<{
  value: DisclosureDecisionReason;
  label: string;
}> = [
  {
    value: DisclosureDecisionReason.APPROVE_INITIAL_DISCLOSURES,
    label: 'Approve Initial Disclosures',
  },
  { value: DisclosureDecisionReason.MISSING_ITEMS, label: 'Missing Items' },
];

const qcReasonOptions: Array<{
  value: DisclosureDecisionReason;
  label: string;
}> = [
  {
    value: DisclosureDecisionReason.APPROVE_INITIAL_DISCLOSURES,
    label: 'Complete QC',
  },
  { value: DisclosureDecisionReason.MISSING_ITEMS, label: 'Missing Items' },
];

const disclosureReasonLabel: Record<DisclosureDecisionReason, string> = {
  [DisclosureDecisionReason.APPROVE_INITIAL_DISCLOSURES]:
    'Approve Initial Disclosures',
  [DisclosureDecisionReason.MISSING_ITEMS]: 'Missing Items',
  [DisclosureDecisionReason.OTHER]: 'Other',
};

const workflowStateLabel: Record<TaskWorkflowState, string> = {
  [TaskWorkflowState.NONE]: 'None',
  [TaskWorkflowState.WAITING_ON_LO]: 'Waiting on LO',
  [TaskWorkflowState.WAITING_ON_LO_APPROVAL]: 'Waiting on LO Approval',
  [TaskWorkflowState.READY_TO_COMPLETE]: 'Ready to Complete',
};

type SubmissionDetailRow = {
  key: string;
  label: string;
  value: string;
};

type SubmissionDetailGroup = {
  title: string;
  rows: SubmissionDetailRow[];
};

type NoteHistoryEntry = {
  author: string;
  role: UserRole | null;
  message: string;
  date: string;
  entryType?: 'note' | 'qcChecklist';
  checklist?: QcChecklistItem[];
};

type TimelineItem = {
  id: string;
  type: 'note' | 'attachment';
  createdAt: string;
  actorName: string;
  actorRole: UserRole | null;
  message?: string;
  attachmentId?: string;
  attachmentFilename?: string;
  attachmentPurpose?: TaskAttachmentPurpose;
  noteEntryType?: 'note' | 'qcChecklist';
  checklist?: QcChecklistItem[];
};

type ContributorSummary = {
  visibleContributors: Array<{ name: string; role: UserRole | null }>;
  overflowCount: number;
};

type QcChecklistStatus = 'GREEN_CHECK' | 'RED_X' | 'YELLOW';
type QcChecklistNoteOption =
  | 'CONFIRMED_IN_FILE'
  | 'NOT_NEEDED'
  | 'FREE_AND_CLEAR'
  | 'PURCHASE_NOT_NEEDED'
  | 'NOT_APPLICABLE'
  | 'MISSING_FROM_FILE'
  | 'OTHER';

type QcChecklistItem = {
  id: string;
  label: string;
  status: QcChecklistStatus;
  noteOption: QcChecklistNoteOption;
  noteText?: string;
};

type QcChecklistDraftItem = {
  id: string;
  label: string;
  noteOption: QcChecklistNoteOption | '';
  noteText: string;
};

const qcChecklistTemplate: Array<{ id: string; label: string }> = [
  { id: 'mortgage-documents', label: 'Verify Mortgage Documents' },
  { id: 'homeowners-insurance', label: 'Verify Homeowners Insurance Policy' },
  { id: 'income-documents', label: 'Verify Income Documents (Employed / Self Employed / Retired)' },
  { id: 'drivers-license', label: 'Verify Driver License' },
  { id: 'dd214-veteran', label: 'Verify DD-214 (Veteran, if applicable)' },
];

const qcChecklistNoteOptions: Array<{ value: QcChecklistNoteOption; label: string }> = [
  { value: 'CONFIRMED_IN_FILE', label: 'Confirmed in File' },
  { value: 'MISSING_FROM_FILE', label: 'Missing from File' },
  { value: 'FREE_AND_CLEAR', label: 'Not Required, Free and Clear' },
  { value: 'PURCHASE_NOT_NEEDED', label: 'Not Required, Purchase' },
  { value: 'NOT_APPLICABLE', label: 'Not Required, Not Applicable' },
  { value: 'OTHER', label: 'Other' },
];

const qcChecklistGreenOptions = new Set<QcChecklistNoteOption>([
  'CONFIRMED_IN_FILE',
  'NOT_NEEDED',
  'FREE_AND_CLEAR',
  'PURCHASE_NOT_NEEDED',
  'NOT_APPLICABLE',
]);

function getQcChecklistStatusFromOption(
  option: QcChecklistDraftItem['noteOption']
): QcChecklistStatus | null {
  if (!option) return null;
  if (option === 'MISSING_FROM_FILE') return 'RED_X';
  if (qcChecklistGreenOptions.has(option)) return 'GREEN_CHECK';
  return 'YELLOW';
}

function getQcChecklistStatusPresentation(status: QcChecklistStatus | null) {
  if (status === 'GREEN_CHECK') {
    return {
      label: 'Green Check',
      className: 'border-emerald-300 bg-emerald-100 text-emerald-800',
    };
  }
  if (status === 'RED_X') {
    return {
      label: 'Red X',
      className: 'border-rose-300 bg-rose-100 text-rose-800',
    };
  }
  if (status === 'YELLOW') {
    return {
      label: 'Other',
      className: 'border-yellow-300 bg-yellow-100 text-yellow-800',
    };
  }
  return {
    label: 'Select option',
    className: 'border-slate-200 bg-white text-slate-500',
  };
}

function getQcChecklistStatusIcon(status: QcChecklistStatus | null) {
  if (status === 'GREEN_CHECK') return CheckCircle;
  if (status === 'RED_X') return X;
  return Clock3;
}

function isQcChecklistGreenOnly(items: QcChecklistDraftItem[]) {
  return (
    items.length > 0 &&
    items.every((item) => getQcChecklistStatusFromOption(item.noteOption) === 'GREEN_CHECK')
  );
}

function hasQcChecklistRedItem(items: QcChecklistDraftItem[]) {
  return items.some((item) => getQcChecklistStatusFromOption(item.noteOption) === 'RED_X');
}

function hasQcChecklistMissingSelections(items: QcChecklistDraftItem[]) {
  return items.some((item) => {
    if (!item.noteOption) return true;
    const status = getQcChecklistStatusFromOption(item.noteOption);
    if (status === 'RED_X' && !item.noteText.trim()) return true;
    return false;
  });
}

function buildQcChecklistSummary(items: QcChecklistDraftItem[]) {
  const green = items.filter(
    (item) => getQcChecklistStatusFromOption(item.noteOption) === 'GREEN_CHECK'
  ).length;
  const red = items.filter(
    (item) => getQcChecklistStatusFromOption(item.noteOption) === 'RED_X'
  ).length;
  const yellow = items.filter(
    (item) => getQcChecklistStatusFromOption(item.noteOption) === 'YELLOW'
  ).length;
  return `QC checklist: ${green} green, ${red} red, ${yellow} other.`;
}

function getChecklistNoteOptionLabel(option: QcChecklistNoteOption) {
  if (option === 'NOT_NEEDED') return 'Not Required';
  return qcChecklistNoteOptions.find((entry) => entry.value === option)?.label || option;
}

function createDefaultQcChecklistRows(): QcChecklistDraftItem[] {
  return qcChecklistTemplate.map((item) => ({
    id: item.id,
    label: item.label,
    noteOption: '',
    noteText: '',
  }));
}

function injectLoanOfficerContributor(
  summary: ContributorSummary | null,
  loanOfficerName?: string | null
): ContributorSummary | null {
  const normalizedLoanOfficer = loanOfficerName?.trim();
  if (!normalizedLoanOfficer) return summary;

  const existing = summary?.visibleContributors ?? [];
  const alreadyPresent = existing.some(
    (contributor) => contributor.name.trim().toLowerCase() === normalizedLoanOfficer.toLowerCase()
  );
  if (alreadyPresent) return summary;

  const contributors = [
    { name: normalizedLoanOfficer, role: UserRole.LOAN_OFFICER as UserRole | null },
    ...existing,
  ];

  const totalCount = contributors.length + (summary?.overflowCount ?? 0);
  return {
    visibleContributors: contributors.slice(0, 2),
    overflowCount: Math.max(0, totalCount - 2),
  };
}

const submissionDetailOrder = [
  'qualificationStatus',
  'arriveLoanNumber',
  'borrowerFirstName',
  'borrowerLastName',
  'borrowerPhone',
  'borrowerEmail',
  'loanAmount',
  'homeValue',
  'loanType',
  'loanProgram',
  'loanPurpose',
  'employerName',
  'employerAddress',
  'employerDurationLineOfWork',
  'yearBuiltProperty',
  'originalCost',
  'yearAquired',
  'mannerInWhichTitleWillBeHeld',
  'channel',
  'investor',
  'runId',
  'pricingOption',
  'creditReportType',
  'aus',
  'loanOfficer',
  'notes',
] as const;

const submissionDetailLabels: Record<string, string> = {
  qualificationStatus: 'Qualification Status',
  arriveLoanNumber: 'Arrive Loan Number',
  borrowerFirstName: 'Borrower First Name',
  borrowerLastName: 'Borrower Last Name',
  borrowerPhone: 'Borrower Phone',
  borrowerEmail: 'Borrower Email',
  loanAmount: 'Loan Amount',
  homeValue: 'Home Value',
  loanType: 'Loan Type',
  loanProgram: 'Loan Program',
  loanPurpose: 'Loan Purpose',
  employerName: 'Employer Name',
  employerAddress: 'Employer Address',
  employerDurationLineOfWork: 'Employer - Duration in Line of Work',
  yearBuiltProperty: 'Year Built (Property)',
  originalCost: 'Original Cost',
  yearAquired: 'Year Aquired',
  mannerInWhichTitleWillBeHeld: 'Manner in Which Title Will be Held',
  channel: 'Channel',
  investor: 'Investor',
  runId: 'Run ID',
  pricingOption: 'Pricing Option',
  creditReportType: 'Credit Report Type',
  aus: 'AUS',
  loanOfficer: 'Loan Officer',
  notes: 'Notes',
};

const submissionDetailGroupConfig = [
  {
    title: 'Qualification',
    keys: ['qualificationStatus'],
  },
  {
    title: 'Loan Identity',
    keys: ['arriveLoanNumber'],
  },
  {
    title: 'Borrower',
    keys: ['borrowerFirstName', 'borrowerLastName', 'borrowerPhone', 'borrowerEmail'],
  },
  {
    title: 'Loan Terms',
    keys: [
      'loanAmount',
      'homeValue',
      'loanType',
      'loanProgram',
      'loanPurpose',
      'yearBuiltProperty',
      'originalCost',
      'yearAquired',
      'mannerInWhichTitleWillBeHeld',
    ],
  },
  {
    title: 'Employment',
    keys: ['employerName', 'employerAddress', 'employerDurationLineOfWork'],
  },
  {
    title: 'Origination & Underwriting',
    keys: ['channel', 'investor', 'runId', 'pricingOption', 'creditReportType', 'aus'],
  },
  {
    title: 'Loan Officer & Notes',
    keys: ['loanOfficer', 'notes'],
  },
] as const;

function toReadableLabel(key: string) {
  if (submissionDetailLabels[key]) return submissionDetailLabels[key];
  const spaced = key
    .replace(/_/g, ' ')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .trim();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

function getOrderedSubmissionDetails(
  data: Record<string, unknown> | null
): SubmissionDetailRow[] {
  if (!data) return [];

  const primitiveEntries = Object.entries(data).filter(([, value]) => {
    return (
      value !== null &&
      (typeof value === 'string' ||
        typeof value === 'number' ||
        typeof value === 'boolean')
    );
  });

  const valueByKey = new Map(primitiveEntries);
  const orderedRows: SubmissionDetailRow[] = [];

  for (const key of submissionDetailOrder) {
    if (!valueByKey.has(key)) continue;
    orderedRows.push({
      key,
      label: toReadableLabel(key),
      value: String(valueByKey.get(key)),
    });
    valueByKey.delete(key);
  }

  const remainingRows = Array.from(valueByKey.entries())
    .map(([key, value]) => ({
      key,
      label: toReadableLabel(key),
      value: String(value),
    }))
    .sort((a, b) => a.label.localeCompare(b.label));

  return [...orderedRows, ...remainingRows];
}

function getGroupedSubmissionDetails(
  data: Record<string, unknown> | null
): SubmissionDetailGroup[] {
  const rows = getOrderedSubmissionDetails(data);
  if (rows.length === 0) return [];

  const byKey = new Map(rows.map((row) => [row.key, row]));
  const groups: SubmissionDetailGroup[] = [];

  for (const groupConfig of submissionDetailGroupConfig) {
    const groupRows: SubmissionDetailRow[] = [];
    for (const key of groupConfig.keys) {
      const row = byKey.get(key);
      if (!row) continue;
      groupRows.push(row);
      byKey.delete(key);
    }
    if (groupRows.length > 0) {
      groups.push({
        title: groupConfig.title,
        rows: groupRows,
      });
    }
  }

  const remaining = Array.from(byKey.values());
  if (remaining.length > 0) {
    groups.push({
      title: 'Additional Details',
      rows: remaining,
    });
  }

  return groups;
}

function getWorkflowChip(
  workflowState: TaskWorkflowState,
  reason: DisclosureDecisionReason | null
): { label: string; className: string } | null {
  if (workflowState === TaskWorkflowState.WAITING_ON_LO_APPROVAL) {
    return {
      label: 'Awaiting LO Approval',
      className: 'border-blue-200 bg-blue-50 text-blue-700',
    };
  }
  if (workflowState === TaskWorkflowState.WAITING_ON_LO) {
    return {
      label:
        reason === DisclosureDecisionReason.MISSING_ITEMS
          ? 'Missing Items from LO'
          : 'Waiting on LO Response',
      className: 'border-amber-200 bg-amber-50 text-amber-700',
    };
  }
  if (workflowState === TaskWorkflowState.READY_TO_COMPLETE) {
    return {
      label:
        reason === DisclosureDecisionReason.APPROVE_INITIAL_DISCLOSURES
          ? 'Returned to Disclosure: Approved'
          : 'Returned to Disclosure: Revision Needed',
      className:
        reason === DisclosureDecisionReason.APPROVE_INITIAL_DISCLOSURES
          ? 'border-blue-200 bg-blue-50 text-blue-700'
          : 'border-amber-200 bg-amber-50 text-amber-700',
    };
  }
  return null;
}

function getAttachmentPurposeMeta(purpose: TaskAttachmentPurpose): {
  label: string;
  badgeClassName: string;
} {
  if (purpose === TaskAttachmentPurpose.PROOF) {
    return {
      label: 'Proof',
      badgeClassName: 'border-amber-200 bg-amber-50 text-amber-700',
    };
  }

  return {
    label: 'Submission',
    badgeClassName: 'border-blue-200 bg-blue-50 text-blue-700',
  };
}

const groupIcons: Record<string, React.ElementType> = {
  'Qualification': CheckCircle,
  'Loan Identity': Fingerprint,
  'Borrower': User,
  'Loan Terms': DollarSign,
  'Employment': Briefcase,
  'Origination & Underwriting': Briefcase,
  'Loan Officer & Notes': FileText,
  'Additional Details': Hash,
};

function getInitials(name: string) {
  if (!name) return '?';
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].substring(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function formatDisplayValue(key: string, value: string) {
  if ((key === 'loanAmount' || key === 'homeValue') && !isNaN(Number(value))) {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(Number(value));
  }
  return value;
}

function formatPacificTimestamp(value: string | Date) {
  const dt = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(dt.getTime())) return '';
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Los_Angeles',
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
    timeZoneName: 'short',
  }).format(dt);
}

function formatCompactDateTime(value: string | Date) {
  const dt = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(dt.getTime())) return '';
  return new Intl.DateTimeFormat('en-US', {
    month: 'numeric',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  }).format(dt);
}

function formatElapsedTimerLabel(elapsedMs: number) {
  const elapsedMinutes = Math.max(0, Math.floor(elapsedMs / 60000));
  if (elapsedMinutes < 60) return `${elapsedMinutes}m`;
  const hours = Math.floor(elapsedMinutes / 60);
  const minutes = elapsedMinutes % 60;
  return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
}

function getDisclosureSlaTimerMeta(startValue: Date | string | undefined, nowMs: number) {
  if (!startValue) return null;
  const startDate = startValue instanceof Date ? startValue : new Date(startValue);
  if (Number.isNaN(startDate.getTime())) return null;

  const elapsedMs = Math.max(0, nowMs - startDate.getTime());
  const elapsedMinutes = Math.floor(elapsedMs / 60000);
  const label = formatElapsedTimerLabel(elapsedMs);

  if (elapsedMinutes < 45) {
    return {
      label,
      className: 'border-emerald-300 bg-emerald-100 text-emerald-800',
    };
  }

  if (elapsedMinutes < 90) {
    return {
      label,
      className: 'border-green-300 bg-green-100 text-green-800',
    };
  }

  if (elapsedMinutes < 135) {
    return {
      label,
      className: 'border-yellow-300 bg-yellow-100 text-yellow-800',
    };
  }

  if (elapsedMinutes < 175) {
    return {
      label,
      className: 'border-orange-300 bg-orange-100 text-orange-800',
    };
  }

  return {
    label,
    className:
      'border-rose-400 bg-rose-100 text-rose-800 ring-1 ring-rose-200 animate-pulse',
  };
}

function parseNoteHistory(data: Record<string, unknown> | null): NoteHistoryEntry[] {
  if (!data || typeof data !== 'object') return [];
  const notesHistory = (data as { notesHistory?: unknown }).notesHistory;
  if (!Array.isArray(notesHistory)) return [];

  const entries: NoteHistoryEntry[] = [];
  for (const item of notesHistory) {
    if (!item || typeof item !== 'object') continue;
    const author = (item as { author?: unknown }).author;
    const message = (item as { message?: unknown }).message;
    const date = (item as { date?: unknown }).date;
    const roleRaw = (item as { role?: unknown }).role;
    const entryTypeRaw = (item as { entryType?: unknown }).entryType;
    const checklistRaw = (item as { checklist?: unknown }).checklist;
    const role =
      typeof roleRaw === 'string' &&
      (Object.values(UserRole) as string[]).includes(roleRaw)
        ? (roleRaw as UserRole)
        : null;
    if (typeof author !== 'string' || typeof message !== 'string' || typeof date !== 'string') {
      continue;
    }
    entries.push({
      author: author.trim() || 'Team Member',
      role,
      message: message.trim(),
      date,
      entryType: entryTypeRaw === 'qcChecklist' ? 'qcChecklist' : 'note',
      checklist:
        entryTypeRaw === 'qcChecklist' && Array.isArray(checklistRaw)
          ? checklistRaw
              .map((row): QcChecklistItem | null => {
                if (!row || typeof row !== 'object') return null;
                const id = String((row as { id?: unknown }).id ?? '').trim();
                const label = String((row as { label?: unknown }).label ?? '').trim();
                const statusRaw = (row as { status?: unknown }).status;
                const noteOptionRaw = (row as { noteOption?: unknown }).noteOption;
                const noteText = String((row as { noteText?: unknown }).noteText ?? '').trim();
                if (!id || !label) return null;
                if (
                  statusRaw !== 'GREEN_CHECK' &&
                  statusRaw !== 'RED_X' &&
                  statusRaw !== 'YELLOW'
                ) {
                  return null;
                }
                const validNoteOption = qcChecklistNoteOptions.some(
                  (option) => option.value === noteOptionRaw
                );
                if (!validNoteOption) return null;
                return {
                  id,
                  label,
                  status: statusRaw,
                  noteOption: noteOptionRaw as QcChecklistNoteOption,
                  noteText,
                };
              })
              .filter((row): row is QcChecklistItem => Boolean(row))
          : undefined,
    });
  }
  return entries;
}

function getRoleBubbleClass(role: UserRole | null) {
  if (role === UserRole.LOAN_OFFICER) {
    return 'border-violet-200 bg-violet-50 text-violet-700';
  }
  if (role === UserRole.DISCLOSURE_SPECIALIST) {
    return 'border-blue-200 bg-blue-50 text-blue-700';
  }
  if (role === UserRole.QC) {
    return 'border-indigo-200 bg-indigo-50 text-indigo-700';
  }
  return 'border-slate-200 bg-slate-50 text-slate-500';
}

function getContributorSummaryFromSubmissionData(
  data: Record<string, unknown> | null
): ContributorSummary | null {
  if (!data || typeof data !== 'object') return null;

  const notesHistory = (data as { notesHistory?: unknown }).notesHistory;
  if (!Array.isArray(notesHistory)) return null;

  const uniqueContributors: Array<{ name: string; role: UserRole | null }> = [];
  const seen = new Set<string>();

  // Read newest to oldest so the tag order reflects latest contributors first.
  for (let i = notesHistory.length - 1; i >= 0; i -= 1) {
    const entry = notesHistory[i];
    if (!entry || typeof entry !== 'object') continue;
    const author = (entry as { author?: unknown }).author;
    if (typeof author !== 'string') continue;
    const normalized = author.trim();
    if (!normalized) continue;
    const dedupeKey = normalized.toLowerCase();
    if (seen.has(dedupeKey)) continue;
    const roleRaw = (entry as { role?: unknown }).role;
    const normalizedRole =
      typeof roleRaw === 'string' &&
      (Object.values(UserRole) as string[]).includes(roleRaw)
        ? (roleRaw as UserRole)
        : null;
    seen.add(dedupeKey);
    uniqueContributors.push({ name: normalized, role: normalizedRole });
  }

  if (uniqueContributors.length === 0) return null;

  return {
    visibleContributors: uniqueContributors.slice(0, 2),
    overflowCount: Math.max(0, uniqueContributors.length - 2),
  };
}

function WorkedByTags({
  summary,
  compact = false,
  className = '',
}: {
  summary: ContributorSummary | null;
  compact?: boolean;
  className?: string;
}) {
  if (!summary) return null;
  const chipSize = compact ? 'text-[10px] px-2 py-0.5' : 'text-xs px-2.5 py-1';
  const labelSize = compact ? 'text-[10px] px-2 py-0.5' : 'text-[11px] px-2.5 py-1';

  return (
    <div className={`flex flex-wrap items-center gap-1.5 ${className}`.trim()}>
      <span
        className={`inline-flex items-center rounded-full border border-slate-200 bg-slate-50 font-bold uppercase tracking-wide text-slate-600 ${labelSize}`}
      >
        Worked By
      </span>
      {summary.visibleContributors.map((contributor) => (
        <span
          key={contributor.name}
          className={`inline-flex max-w-[130px] items-center truncate rounded-full border font-semibold ${chipSize} ${
            contributor.role === UserRole.LOAN_OFFICER
              ? 'border-violet-200 bg-violet-50 text-violet-700'
              : 'border-blue-200 bg-blue-50 text-blue-700'
          }`}
          title={
            contributor.role === UserRole.LOAN_OFFICER
              ? `${contributor.name} (Loan Officer)`
              : contributor.name
          }
        >
          <span className="truncate">{contributor.name}</span>
        </span>
      ))}
      {summary.overflowCount > 0 && (
        <span
          className={`inline-flex items-center rounded-full border border-indigo-200 bg-indigo-50 font-semibold text-indigo-700 ${chipSize}`}
          title={`${summary.overflowCount} more contributor${summary.overflowCount === 1 ? '' : 's'}`}
        >
          +{summary.overflowCount} more
        </span>
      )}
    </div>
  );
}

export type Task = {
  id: string;
  title: string;
  description: string | null;
  status: TaskStatus;
  createdAt?: Date | string;
  completedAt?: Date | string | null;
  updatedAt?: Date;
  dueDate: Date | null;
  kind: TaskKind | null;
  workflowState: TaskWorkflowState;
  disclosureReason: DisclosureDecisionReason | null;
  parentTaskId: string | null;
  parentTask?: {
    kind: TaskKind | null;
    assignedRole: UserRole | null;
    title: string;
    submissionData?: Prisma.JsonValue | null;
  } | null;
  loanOfficerApprovedAt: Date | null;
  submissionData?: Prisma.JsonValue | null;
  loan: {
    loanNumber: string;
    borrowerName: string;
    stage?: string;
    loanOfficer?: { name?: string } | null;
  };
  assignedRole: string | null;
  assignedUser?: {
    id?: string;
    name: string;
  } | null;
  attachments?: {
    id: string;
    filename: string;
    purpose: TaskAttachmentPurpose;
    createdAt: Date;
    uploadedByName?: string | null;
    uploadedByRole?: UserRole | null;
  }[];
  timelineAttachments?: {
    id: string;
    filename: string;
    purpose: TaskAttachmentPurpose;
    createdAt: Date;
    uploadedByName?: string | null;
    uploadedByRole?: UserRole | null;
  }[];
};

export function TaskList({
  tasks,
  canDelete = false,
  currentRole,
  currentUserId,
  initialFocusedTaskId = null,
  emptyState = 'all_caught_up',
}: {
  tasks: Task[];
  canDelete?: boolean;
  currentRole: string;
  currentUserId?: string;
  initialFocusedTaskId?: string | null;
  emptyState?: 'all_caught_up' | 'no_results';
}) {
  const router = useRouter();
  const [updatingId, setUpdatingId] = React.useState<string | null>(null);
  const [deletingId, setDeletingId] = React.useState<string | null>(null);
  const [uploadingId, setUploadingId] = React.useState<string | null>(null);
  const [deletingAttachmentId, setDeletingAttachmentId] = React.useState<string | null>(null);
  const [focusedTaskId, setFocusedTaskId] = React.useState<string | null>(null);
  const [expandedTaskIds, setExpandedTaskIds] = React.useState<Set<string>>(
    () => new Set()
  );
  const [initialFocusConsumed, setInitialFocusConsumed] = React.useState(false);
  const [startingDisclosureId, setStartingDisclosureId] = React.useState<string | null>(
    null
  );
  const [startingQcId, setStartingQcId] = React.useState<string | null>(null);
  const [sendingToLoId, setSendingToLoId] = React.useState<string | null>(null);
  const [respondingId, setRespondingId] = React.useState<string | null>(null);
  const [disclosureReasonByTask, setDisclosureReasonByTask] = React.useState<
    Record<string, DisclosureDecisionReason>
  >({});
  const [disclosureMessageByTask, setDisclosureMessageByTask] = React.useState<
    Record<string, string>
  >({});
  const [qcChecklistByTask, setQcChecklistByTask] = React.useState<
    Record<string, QcChecklistDraftItem[]>
  >({});
  const [loResponseByTask, setLoResponseByTask] = React.useState<
    Record<string, string>
  >({});
  const [timerNowMs, setTimerNowMs] = React.useState(() => Date.now());

  const getQcChecklistRows = React.useCallback(
    (taskId: string) => qcChecklistByTask[taskId] ?? createDefaultQcChecklistRows(),
    [qcChecklistByTask]
  );

  const updateQcChecklistRow = React.useCallback(
    (
      taskId: string,
      rowId: string,
      updates: Partial<Pick<QcChecklistDraftItem, 'noteOption' | 'noteText'>>
    ) => {
      setQcChecklistByTask((prev) => {
        const current = prev[taskId] ?? createDefaultQcChecklistRows();
        const next = current.map((row) => {
          if (row.id !== rowId) return row;
          return { ...row, ...updates };
        });
        return { ...prev, [taskId]: next };
      });
    },
    []
  );

  React.useEffect(() => {
    if (!initialFocusedTaskId || initialFocusConsumed) return;
    const existsInList = tasks.some((task) => task.id === initialFocusedTaskId);
    if (existsInList) {
      setFocusedTaskId(initialFocusedTaskId);
      setInitialFocusConsumed(true);
    }
  }, [initialFocusedTaskId, initialFocusConsumed, tasks]);

  React.useEffect(() => {
    const canViewDisclosureSlaTimer =
      currentRole === UserRole.DISCLOSURE_SPECIALIST ||
      currentRole === UserRole.LOAN_OFFICER ||
      currentRole === UserRole.QC ||
      currentRole === UserRole.MANAGER;
    if (!canViewDisclosureSlaTimer) return;
    const intervalId = window.setInterval(() => {
      setTimerNowMs(Date.now());
    }, 30_000);
    return () => window.clearInterval(intervalId);
  }, [currentRole]);

  const handleStatusChange = async (taskId: string, newStatus: TaskStatus) => {
    if (updatingId) return;
    setUpdatingId(taskId);
    // In a real app, we'd use optimistic UI here
    const result = await updateTaskStatus(taskId, newStatus);
    if (!result.success) {
      alert(result.error || 'Failed to update task.');
    }
    router.refresh();
    setUpdatingId(null);
  };

  const handleUploadProof = async (taskId: string, file: File) => {
    if (uploadingId) return;
    setUploadingId(taskId);

    try {
      const upload = await createTaskAttachmentUploadUrl({
        taskId,
        purpose: TaskAttachmentPurpose.PROOF,
        filename: file.name,
      });

      if (!upload.success || !upload.signedUrl || !upload.path) {
        alert(upload.error || 'Failed to create upload URL.');
        setUploadingId(null);
        return;
      }

      const put = await fetch(upload.signedUrl, {
        method: 'PUT',
        headers: {
          'Content-Type': file.type || 'application/octet-stream',
        },
        body: file,
      });

      if (!put.ok) {
        console.error('Upload failed', await put.text());
        alert('Upload failed. Please try again.');
        setUploadingId(null);
        return;
      }

      const saved = await finalizeTaskAttachment({
        taskId,
        purpose: TaskAttachmentPurpose.PROOF,
        storagePath: upload.path,
        filename: file.name,
        contentType: file.type || 'application/octet-stream',
        sizeBytes: file.size,
      });

      if (!saved.success) {
        alert(saved.error || 'Failed to save attachment.');
        setUploadingId(null);
        return;
      }

      router.refresh();
    } catch (error) {
      console.error(error);
      alert('Upload failed. Please try again.');
    } finally {
      setUploadingId(null);
    }
  };

  const handleViewAttachment = async (attachmentId: string) => {
    const result = await getTaskAttachmentDownloadUrl(attachmentId);
    if (!result.success) {
      alert(result.error || 'Failed to open attachment.');
      return;
    }
    window.open(result.url, '_blank', 'noopener,noreferrer');
  };

  const handleDeleteProofAttachment = async (attachmentId: string) => {
    if (deletingAttachmentId) return;
    const confirmed = window.confirm('Delete this proof attachment?');
    if (!confirmed) return;
    setDeletingAttachmentId(attachmentId);
    const result = await deleteTaskAttachment(attachmentId);
    if (!result.success) {
      alert(result.error || 'Failed to delete attachment.');
      setDeletingAttachmentId(null);
      return;
    }
    router.refresh();
    setDeletingAttachmentId(null);
  };

  const handleSendToLoanOfficer = async (task: Task) => {
    if (sendingToLoId) return;
    const reason =
      disclosureReasonByTask[task.id] ||
      DisclosureDecisionReason.APPROVE_INITIAL_DISCLOSURES;
    let message = (disclosureMessageByTask[task.id] || '').trim();
    const isQcTask = task.kind === TaskKind.SUBMIT_QC;
    let qcChecklistPayload:
      | {
          items: QcChecklistItem[];
          summaryMessage: string;
        }
      | undefined;

    if (isQcTask) {
      const checklistRows = getQcChecklistRows(task.id);
      const missingRequiredChecklistFields = hasQcChecklistMissingSelections(checklistRows);
      if (missingRequiredChecklistFields) {
        alert('Please complete all QC checklist items before routing this task.');
        return;
      }
      const checklistItems: QcChecklistItem[] = checklistRows.map((row) => ({
        id: row.id,
        label: row.label,
        status: getQcChecklistStatusFromOption(row.noteOption) as QcChecklistStatus,
        noteOption: row.noteOption as QcChecklistNoteOption,
        noteText: row.noteText.trim() || undefined,
      }));
      const hasRedXItems = hasQcChecklistRedItem(checklistRows);
      const isAllGreenSelection = isQcChecklistGreenOnly(checklistRows);
      if (
        hasRedXItems &&
        reason === DisclosureDecisionReason.APPROVE_INITIAL_DISCLOSURES
      ) {
        alert('Complete QC is blocked while checklist items are marked Red X. Use Missing Items.');
        return;
      }
      if (
        isAllGreenSelection &&
        reason === DisclosureDecisionReason.MISSING_ITEMS
      ) {
        alert('Missing Items is blocked while all checklist items are green.');
        return;
      }
      if (!message) {
        message = buildQcChecklistSummary(checklistRows);
      }
      qcChecklistPayload = {
        items: checklistItems,
        summaryMessage: message,
      };
    } else if (!message) {
      alert('Please add a note before routing this task.');
      return;
    }
    setSendingToLoId(task.id);
    const result = await requestInfoFromLoanOfficer(task.id, {
      reason,
      message,
      qcChecklist: qcChecklistPayload,
    });
    if (!result.success) {
      alert(result.error || 'Failed to send task to Loan Officer.');
      setSendingToLoId(null);
      return;
    }
    router.refresh();
    setSendingToLoId(null);
  };

  const handleStartDisclosureRequest = async (taskId: string) => {
    if (startingDisclosureId) return;
    setStartingDisclosureId(taskId);
    const result = await startDisclosureRequest(taskId);
    if (!result.success) {
      alert(result.error || 'Failed to start disclosure request.');
      setStartingDisclosureId(null);
      return;
    }
    router.refresh();
    setStartingDisclosureId(null);
  };

  const handleStartQcRequest = async (taskId: string) => {
    if (startingQcId) return;
    setStartingQcId(taskId);
    const result = await startQcRequest(taskId);
    if (!result.success) {
      alert(result.error || 'Failed to start QC request.');
      setStartingQcId(null);
      return;
    }
    router.refresh();
    setStartingQcId(null);
  };

  const handleLoanOfficerResponse = async (task: Task) => {
    if (respondingId) return;
    const response = (loResponseByTask[task.id] || '').trim();
    if (!response) {
      alert('Please add a response before sending this back to Disclosure.');
      return;
    }
    setRespondingId(task.id);
    const result = await respondToDisclosureRequest(task.id, response);
    if (!result.success) {
      alert(result.error || 'Failed to send response.');
      setRespondingId(null);
      return;
    }
    router.refresh();
    setRespondingId(null);
  };

  const handleLoanOfficerDisclosureReview = async (
    task: Task,
    decision: 'APPROVE' | 'REVISION_REQUIRED'
  ) => {
    if (respondingId) return;
    const response = (loResponseByTask[task.id] || '').trim();
    if (!response) {
      alert('Please add a response note before submitting your review.');
      return;
    }
    setRespondingId(task.id);
    const result = await reviewInitialDisclosureFigures({
      taskId: task.id,
      decision,
      message: response,
    });
    if (!result.success) {
      alert(result.error || 'Failed to submit review.');
      setRespondingId(null);
      return;
    }
    router.refresh();
    setRespondingId(null);
  };

  const handleDelete = async (taskId: string) => {
    if (deletingId) return;
    const confirmed = window.confirm('Delete this task? This cannot be undone.');
    if (!confirmed) return;
    
    setDeletingId(taskId);
    const result = await deleteTask(taskId);
    if (!result.success) {
      alert(result.error || 'Failed to delete task.');
      setDeletingId(null);
      return;
    }
    router.refresh();
    setDeletingId(null);
  };

  const toggleTaskExpanded = (taskId: string) => {
    setExpandedTaskIds((prev) => {
      const next = new Set(prev);
      if (next.has(taskId)) {
        next.delete(taskId);
      } else {
        next.add(taskId);
      }
      return next;
    });
  };

  const isVaSubRole =
    currentRole === UserRole.VA_TITLE ||
    currentRole === UserRole.VA_HOI ||
    currentRole === UserRole.VA_PAYOFF ||
    currentRole === UserRole.VA_APPRAISAL;

  const isVaTaskKind = (kind: TaskKind | null) =>
    kind === TaskKind.VA_TITLE ||
    kind === TaskKind.VA_HOI ||
    kind === TaskKind.VA_PAYOFF ||
    kind === TaskKind.VA_APPRAISAL;

  const isDisclosureRole = currentRole === UserRole.DISCLOSURE_SPECIALIST;
  const isLoanOfficerRole = currentRole === UserRole.LOAN_OFFICER;
  const isQcRole = currentRole === UserRole.QC;
  const isManagerRole = currentRole === UserRole.MANAGER;
  const canManageDisclosureDesk = isDisclosureRole || isManagerRole;
  const canManageQcDesk = isQcRole || isManagerRole;
  const isDisclosureSubmissionTask = (task: Task) =>
    task.kind === TaskKind.SUBMIT_DISCLOSURES;
  const isQcSubmissionTask = (task: Task) => task.kind === TaskKind.SUBMIT_QC;
  const isLoResponseTask = (task: Task) => task.kind === TaskKind.LO_NEEDS_INFO;

  if (tasks.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-5 text-center">
        <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-slate-50 shadow-sm ring-1 ring-slate-200/60">
          <CheckCircle className="h-6 w-6 text-slate-400" />
        </div>
        {emptyState === 'no_results' && (
          <>
            <h3 className="text-lg font-bold text-slate-900">No Results</h3>
            <p className="mt-1 text-sm font-medium text-slate-500">
              No tasks match your current search.
            </p>
          </>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {tasks.map((task) => {
        const selectedReason =
          disclosureReasonByTask[task.id] ||
          DisclosureDecisionReason.APPROVE_INITIAL_DISCLOSURES;
        const selectedQcReason =
          disclosureReasonByTask[task.id] ||
          DisclosureDecisionReason.APPROVE_INITIAL_DISCLOSURES;
        const qcChecklistRows = getQcChecklistRows(task.id);
        const qcChecklistHasRedXItems = hasQcChecklistRedItem(qcChecklistRows);
        const qcChecklistAllGreen = isQcChecklistGreenOnly(qcChecklistRows);
        const qcChecklistMissingFields = hasQcChecklistMissingSelections(qcChecklistRows);
        const qcChecklistBlocksCompleteAction =
          isQcSubmissionTask(task) &&
          selectedQcReason === DisclosureDecisionReason.APPROVE_INITIAL_DISCLOSURES &&
          qcChecklistHasRedXItems;
        const qcChecklistBlocksMissingItemsAction =
          isQcSubmissionTask(task) &&
          selectedQcReason === DisclosureDecisionReason.MISSING_ITEMS &&
          qcChecklistAllGreen;
        const canDisclosureEditProofAttachments =
          canManageDisclosureDesk &&
          isDisclosureSubmissionTask(task) &&
          task.status !== TaskStatus.BLOCKED &&
          task.status !== TaskStatus.COMPLETED &&
          task.workflowState !== TaskWorkflowState.WAITING_ON_LO &&
          task.workflowState !== TaskWorkflowState.WAITING_ON_LO_APPROVAL;
        const proofCount =
          task.attachments?.filter((att) => att.purpose === TaskAttachmentPurpose.PROOF)
            .length || 0;
        const proofAttachments =
          task.attachments?.filter((att) => att.purpose === TaskAttachmentPurpose.PROOF) ||
          [];
        const requiresProofForCompletion =
          isVaTaskKind(task.kind) ||
          isDisclosureSubmissionTask(task);
        const canCompleteTask = !requiresProofForCompletion || proofCount > 0;
        const isLoTaskForCurrentLoanOfficer =
          currentRole === UserRole.LOAN_OFFICER && isLoResponseTask(task);
        const isQcLinkedLoResponseTask =
          isLoResponseTask(task) &&
          Boolean(task.parentTask) &&
          (task.parentTask?.kind === TaskKind.SUBMIT_QC ||
            (task.parentTask?.assignedRole === UserRole.QC &&
              task.parentTask?.title.toLowerCase().includes('qc')));
        const isLoanOfficerSubmissionTask =
          currentRole === UserRole.LOAN_OFFICER &&
          (isDisclosureSubmissionTask(task) || isQcSubmissionTask(task));
        const isApprovalReviewTask =
          isLoTaskForCurrentLoanOfficer &&
          task.disclosureReason ===
            DisclosureDecisionReason.APPROVE_INITIAL_DISCLOSURES;
        const isDisclosureInitialRoutingState =
          canManageDisclosureDesk &&
          isDisclosureSubmissionTask(task) &&
          task.status !== TaskStatus.COMPLETED &&
          task.workflowState === TaskWorkflowState.NONE;
        const isDisclosureReturnedRoutingState =
          canManageDisclosureDesk &&
          isDisclosureSubmissionTask(task) &&
          task.status !== TaskStatus.COMPLETED &&
          task.workflowState === TaskWorkflowState.READY_TO_COMPLETE;
        const shouldHideGenericStartForDisclosureSubmission =
          canManageDisclosureDesk && isDisclosureSubmissionTask(task);
        const shouldRouteFromFooter =
          task.status !== TaskStatus.COMPLETED &&
          ((isDisclosureInitialRoutingState ||
            isDisclosureReturnedRoutingState) ||
            (canManageQcDesk && isQcSubmissionTask(task)));
        const isDisclosureMissingItemsRoute =
          canManageDisclosureDesk &&
          isDisclosureSubmissionTask(task) &&
          (isDisclosureInitialRoutingState || isDisclosureReturnedRoutingState) &&
          selectedReason === DisclosureDecisionReason.MISSING_ITEMS;
        const shouldShowProofUploader =
          task.status !== 'COMPLETED' &&
          ((isVaSubRole && isVaTaskKind(task.kind)) ||
            (canDisclosureEditProofAttachments && !isDisclosureMissingItemsRoute) ||
            (canManageQcDesk && isQcSubmissionTask(task)));
        const isQcAttachmentSection = canManageQcDesk && isQcSubmissionTask(task);
        const requiresProofForRouting =
          (canManageDisclosureDesk &&
            isDisclosureSubmissionTask(task) &&
            selectedReason === DisclosureDecisionReason.APPROVE_INITIAL_DISCLOSURES);
        const isQcCompleteRouteAction =
          canManageQcDesk &&
          isQcSubmissionTask(task) &&
          selectedQcReason === DisclosureDecisionReason.APPROVE_INITIAL_DISCLOSURES;
        const isMissingItemsRouteAction =
          (canManageDisclosureDesk &&
            isDisclosureSubmissionTask(task) &&
            selectedReason === DisclosureDecisionReason.MISSING_ITEMS) ||
          (canManageQcDesk &&
            isQcSubmissionTask(task) &&
            selectedQcReason === DisclosureDecisionReason.MISSING_ITEMS);
        const shouldLoRespondFromFooter =
          isLoTaskForCurrentLoanOfficer && task.status !== TaskStatus.COMPLETED;
        const assignedSpecialistName = task.assignedUser?.name?.trim() || '';
        const hasAssignedSpecialist = Boolean(task.assignedUser?.id);
        const isAssignedToCurrentUser =
          Boolean(currentUserId) && task.assignedUser?.id === currentUserId;
        const showDisclosureStartButton =
          isDisclosureInitialRoutingState && task.status === TaskStatus.PENDING;
        const disableDisclosureStartButton =
          hasAssignedSpecialist && !isAssignedToCurrentUser;
        const isQcInitialRoutingState =
          canManageQcDesk &&
          isQcSubmissionTask(task) &&
          task.status !== TaskStatus.COMPLETED &&
          task.workflowState === TaskWorkflowState.NONE;
        const showQcStartButton =
          isQcInitialRoutingState && task.status === TaskStatus.PENDING;
        const disableQcStartButton =
          hasAssignedSpecialist && !isAssignedToCurrentUser;
        const disclosureFooterMessage = (disclosureMessageByTask[task.id] || '').trim();
        const loFooterResponse = (loResponseByTask[task.id] || '').trim();
        const parsedSubmissionData =
          task.submissionData &&
          typeof task.submissionData === 'object' &&
          !Array.isArray(task.submissionData)
            ? task.submissionData
            : task.parentTask?.submissionData &&
              typeof task.parentTask.submissionData === 'object' &&
              !Array.isArray(task.parentTask.submissionData)
            ? task.parentTask.submissionData
            : null;
        const workflowChip = getWorkflowChip(task.workflowState, task.disclosureReason);
        const submissionDataRows = getOrderedSubmissionDetails(
          parsedSubmissionData as Record<string, unknown> | null
        );
        const submissionDataGroups = getGroupedSubmissionDetails(
          parsedSubmissionData as Record<string, unknown> | null
        );
        const noteHistoryEntries = parseNoteHistory(
          parsedSubmissionData as Record<string, unknown> | null
        );
        const workedBySummary = injectLoanOfficerContributor(
          getContributorSummaryFromSubmissionData(
            parsedSubmissionData as Record<string, unknown> | null
          ),
          task.loan.loanOfficer?.name || null
        );
        const timelineItems: TimelineItem[] = [
          ...noteHistoryEntries.map((entry, index) => ({
            id: `note-${index}-${entry.date}`,
            type: 'note' as const,
            createdAt: entry.date,
            actorName: entry.author,
            actorRole: entry.role,
            message: entry.message,
            noteEntryType: entry.entryType || 'note',
            checklist: entry.checklist,
          })),
          ...((task.timelineAttachments && task.timelineAttachments.length > 0
            ? task.timelineAttachments
            : task.attachments || []
          ).map((att) => ({
            id: `attachment-${att.id}`,
            type: 'attachment' as const,
            createdAt:
              att.createdAt instanceof Date
                ? att.createdAt.toISOString()
                : new Date(att.createdAt).toISOString(),
            actorName: att.uploadedByName || 'Team Member',
            actorRole: att.uploadedByRole || null,
            attachmentId: att.id,
            attachmentFilename: att.filename,
            attachmentPurpose: att.purpose,
          }))),
        ].sort(
          (a, b) =>
            new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
        );
        const isFocused = focusedTaskId === task.id;
        const isExpanded = expandedTaskIds.has(task.id);
        const compactStatusChipClassName =
          task.status === TaskStatus.COMPLETED
            ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
            : task.status === TaskStatus.IN_PROGRESS
            ? 'border-blue-200 bg-blue-50 text-blue-700'
            : task.status === TaskStatus.BLOCKED
            ? 'border-amber-200 bg-amber-50 text-amber-700'
            : 'border-slate-200 bg-slate-50 text-slate-600';
        const compactDateSource = task.updatedAt || task.dueDate;
        const compactDateTime = compactDateSource ? formatCompactDateTime(compactDateSource) : '';
        const isReturnedToDisclosure =
          task.workflowState === TaskWorkflowState.READY_TO_COMPLETE;
        const returnedToDisclosureIconClassName =
          task.disclosureReason === DisclosureDecisionReason.APPROVE_INITIAL_DISCLOSURES
            ? 'bg-blue-100 text-blue-600'
            : 'bg-amber-100 text-amber-600';
        const defaultIconClassName =
          task.status === TaskStatus.COMPLETED
            ? 'bg-emerald-100 text-emerald-600'
            : task.status === TaskStatus.IN_PROGRESS
            ? 'bg-blue-100 text-blue-600'
            : 'bg-slate-100 text-slate-500';
        const iconClassName = isReturnedToDisclosure
          ? returnedToDisclosureIconClassName
          : defaultIconClassName;
        const shouldShowDisclosureSlaTimer =
          (isDisclosureRole || isLoanOfficerRole || isQcRole || isManagerRole) &&
          (isDisclosureSubmissionTask(task) ||
            isQcSubmissionTask(task) ||
            isQcLinkedLoResponseTask) &&
          task.status !== TaskStatus.COMPLETED;
        const disclosureSlaTimerMeta = shouldShowDisclosureSlaTimer
          ? getDisclosureSlaTimerMeta(task.updatedAt, timerNowMs)
          : null;
        const completionEndValue = task.completedAt || task.updatedAt;
        const completedTotalTimeMeta =
          task.status === TaskStatus.COMPLETED && task.createdAt && completionEndValue
            ? getDisclosureSlaTimerMeta(task.createdAt, new Date(completionEndValue).getTime())
            : null;

        return (
          <React.Fragment key={task.id}>
            <div className="group relative flex flex-col overflow-hidden rounded-2xl border border-slate-200/80 bg-white p-3 shadow-sm transition-all hover:shadow-md hover:border-blue-300 hover:ring-1 hover:ring-blue-100">
              <div className="absolute -right-6 -top-6 h-20 w-20 rounded-full bg-slate-50 opacity-50 blur-2xl group-hover:bg-blue-50 transition-colors"></div>
              <div
                role="button"
                tabIndex={0}
                onClick={() => toggleTaskExpanded(task.id)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    toggleTaskExpanded(task.id);
                  }
                }}
                aria-expanded={isExpanded}
                aria-controls={`task-expanded-${task.id}`}
                className="relative flex items-start gap-3 min-w-0"
              >
                <button
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation();
                    setFocusedTaskId(task.id);
                  }}
                  className={`mt-0.5 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg shadow-sm ring-1 ring-black/5 ${iconClassName}`}
                  title="Open task details"
                  aria-label={`Open details for ${task.loan.borrowerName}`}
                >
                  <FileText className="h-4 w-4" />
                </button>
                <div className="min-w-0 flex-1">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      {compactDateTime && (
                        <div className="mb-0.5 flex flex-wrap items-center gap-1.5">
                          <p className="inline-flex items-center text-[11px] font-medium text-slate-500 leading-none">
                            <Calendar className="mr-1 h-3 w-3 text-slate-400" />
                            {compactDateTime}
                          </p>
                        </div>
                      )}
                      <p className="text-sm font-bold leading-snug text-slate-900 line-clamp-1">
                        {task.loan.borrowerName}
                      </p>
                      <p className="text-xs font-medium text-slate-500 truncate">
                        {task.loan.loanNumber}
                      </p>
                      {(disclosureSlaTimerMeta || completedTotalTimeMeta) && (
                        <div className="mt-1 flex flex-wrap items-center gap-1.5">
                          {disclosureSlaTimerMeta && (
                            <span
                              className={`inline-flex items-center rounded-full border px-1.5 py-0.5 text-[10px] font-bold leading-none ${disclosureSlaTimerMeta.className}`}
                              title="Disclosure SLA timer (resets when task updates)"
                            >
                              <Clock3 className="mr-1 h-2.5 w-2.5" />
                              {disclosureSlaTimerMeta.label}
                            </span>
                          )}
                          {completedTotalTimeMeta && (
                            <span
                              className="inline-flex items-center rounded-full border border-slate-300 bg-slate-100 px-1.5 py-0.5 text-[10px] font-bold leading-none text-slate-700"
                              title="Total time from submission to completion"
                            >
                              <Clock3 className="mr-1 h-2.5 w-2.5" />
                              Total {completedTotalTimeMeta.label}
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation();
                        toggleTaskExpanded(task.id);
                      }}
                      className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-slate-200 bg-white text-slate-500 hover:bg-slate-50"
                      aria-label={isExpanded ? 'Collapse task card' : 'Expand task card'}
                    >
                      {isExpanded ? (
                        <ChevronUp className="h-4 w-4" />
                      ) : (
                        <ChevronDown className="h-4 w-4" />
                      )}
                    </button>
                  </div>
                </div>
              </div>

              {isExpanded && (
                <div
                  id={`task-expanded-${task.id}`}
                  className="relative mt-3 border-t border-slate-200/80 pt-3"
                >
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span
                      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${compactStatusChipClassName}`}
                    >
                      {task.status}
                    </span>
                    {assignedSpecialistName && isDisclosureSubmissionTask(task) && (
                      <span className="inline-flex max-w-full items-center rounded-full border border-blue-200 bg-blue-50 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-blue-700 truncate">
                        Assigned: {assignedSpecialistName}
                      </span>
                    )}
                  </div>
                  <WorkedByTags summary={workedBySummary} compact className="mt-1.5" />
                </div>
              )}
            </div>

            {isFocused && (
              <div
                data-live-refresh-pause="true"
                className="fixed inset-0 z-[80] flex items-center justify-center bg-slate-900/45 p-4"
                onClick={() => setFocusedTaskId(null)}
              >
                <div
                  className="w-full max-w-5xl max-h-[90vh] overflow-y-auto rounded-[24px] border border-slate-200/60 bg-slate-50 p-6 sm:p-10 shadow-2xl"
                  onClick={(event) => event.stopPropagation()}
                >
                  <div className="flex items-start justify-between gap-6 border-b border-slate-200/60 pb-8">
                    <div className="flex items-center gap-5">
                      <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-blue-600 to-indigo-600 text-xl font-bold text-white shadow-lg shadow-blue-600/20 ring-4 ring-white">
                        {getInitials(task.loan.borrowerName)}
                      </div>
                      <div>
                        <div className="mb-1.5 flex items-center gap-3">
                          <h2 className="text-2xl font-extrabold tracking-tight text-slate-900">
                            {task.loan.borrowerName}
                          </h2>
                          <span className="inline-flex items-center rounded-md bg-white px-2.5 py-1 text-sm font-mono font-bold text-slate-600 ring-1 ring-inset ring-slate-200 shadow-sm">
                            {task.loan.loanNumber}
                          </span>
                        </div>
                        <WorkedByTags summary={workedBySummary} className="mb-2" />
                        <div className="flex items-center gap-2 text-sm font-medium text-slate-500">
                          <span className="flex h-2 w-2 rounded-full bg-blue-500"></span>
                          {task.title}
                        </div>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => setFocusedTaskId(null)}
                      className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white border border-slate-200 text-slate-400 hover:text-slate-600 hover:bg-slate-50 hover:shadow-sm transition-all"
                      aria-label="Close task modal"
                    >
                      <X className="h-5 w-5" />
                    </button>
                  </div>

                  <div className="mt-8">
                    <h4 className="mb-5 flex items-center gap-3 text-lg font-bold tracking-tight text-slate-900">
                      <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-100 text-blue-700">
                        <FileText className="h-4 w-4" />
                      </div>
                      Submission Details
                    </h4>
                    {submissionDataRows.length > 0 ? (
                      <div className="space-y-5">
                        {submissionDataGroups.map((group) => {
                          const Icon = groupIcons[group.title] || FileText;
                          return (
                            <div
                              key={group.title}
                              className="relative overflow-hidden rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200/60"
                            >
                              <div className="absolute -right-6 -top-6 h-24 w-24 rounded-full bg-slate-50 opacity-50 blur-2xl"></div>
                              <div className="relative">
                                <div className="mb-5 flex items-center gap-3 border-b border-slate-100 pb-4">
                                  <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-slate-50 text-slate-500 ring-1 ring-slate-200/50">
                                    <Icon className="h-4 w-4" />
                                  </div>
                                  <h5 className="text-sm font-bold text-slate-900">{group.title}</h5>
                                </div>
                                <div className="grid grid-cols-1 gap-x-8 gap-y-6 sm:grid-cols-2">
                                  {group.rows.map((row) => (
                                    <div key={row.key} className="flex flex-col">
                                      <span className="mb-1.5 text-[11px] font-bold uppercase tracking-widest text-slate-400">
                                        {row.label}
                                      </span>
                                      <span className="text-[15px] font-semibold text-slate-900 break-words">
                                        {formatDisplayValue(row.key, row.value)}
                                      </span>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    ) : (
                      <div className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200/60">
                        <p className="text-sm italic text-slate-500">
                          No additional submitted fields were captured for this task.
                        </p>
                      </div>
                    )}
                  </div>

                  <div className="mt-8 flex flex-wrap items-center gap-3 text-sm">
                    {task.dueDate && (
                      <p className="inline-flex items-center rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-bold text-slate-600 shadow-sm">
                        <Calendar className="mr-1.5 h-3.5 w-3.5 text-slate-400" />
                        {new Date(task.dueDate).toLocaleDateString()}
                      </p>
                    )}
                    {task.disclosureReason && (
                      <p className="inline-flex items-center rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-xs font-bold text-amber-700 shadow-sm">
                        Reason: {disclosureReasonLabel[task.disclosureReason]}
                      </p>
                    )}
                    {workflowChip ? (
                      <p className={`inline-flex items-center rounded-full border px-3 py-1 text-xs font-bold shadow-sm ${workflowChip.className}`}>
                        {workflowChip.label}
                      </p>
                    ) : task.workflowState !== TaskWorkflowState.NONE ? (
                      <p className="inline-flex items-center rounded-full border border-indigo-200 bg-indigo-50 px-3 py-1 text-xs font-bold text-indigo-700 shadow-sm">
                        {workflowStateLabel[task.workflowState]}
                      </p>
                    ) : null}
                    {assignedSpecialistName && isDisclosureSubmissionTask(task) && (
                      <p className="inline-flex items-center rounded-full border border-blue-200 bg-blue-50 px-3 py-1 text-xs font-bold text-blue-700 shadow-sm">
                        Assigned Specialist: {assignedSpecialistName}
                      </p>
                    )}
                  </div>

                  {timelineItems.length > 0 && (
                    <div className="mt-8">
                      <div className="mb-5 flex items-center justify-between">
                        <h4 className="flex items-center gap-3 text-lg font-bold tracking-tight text-slate-900">
                          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-100 text-indigo-700">
                            <MessageSquare className="h-4 w-4" />
                          </div>
                          Notes & Attachments
                        </h4>
                        <span className="inline-flex items-center rounded-full bg-slate-100 px-2.5 py-1 text-xs font-bold text-slate-600">
                          {timelineItems.length} update{timelineItems.length === 1 ? '' : 's'}
                        </span>
                      </div>
                      <div className="space-y-3">
                        {timelineItems.map((item) => {
                          const purposeMeta =
                            item.type === 'attachment' && item.attachmentPurpose
                              ? getAttachmentPurposeMeta(item.attachmentPurpose)
                              : null;
                          return (
                            <div
                              key={item.id}
                              className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm"
                            >
                              <div className="mb-2 flex flex-wrap items-center gap-2 text-xs">
                                <span className="font-bold text-slate-800">
                                  {item.actorName}
                                </span>
                                {item.actorRole && (
                                  <span
                                    className={`inline-flex items-center rounded-full border px-2 py-0.5 font-semibold uppercase tracking-wide ${getRoleBubbleClass(item.actorRole)}`}
                                  >
                                    {item.actorRole.replace(/_/g, ' ')}
                                  </span>
                                )}
                                <span className="text-slate-400">•</span>
                                <span className="font-medium text-slate-500">
                                  {formatPacificTimestamp(item.createdAt)}
                                </span>
                              </div>
                              {item.type === 'note' ? (
                                item.noteEntryType === 'qcChecklist' &&
                                Array.isArray(item.checklist) &&
                                item.checklist.length > 0 ? (
                                  <div className="space-y-3">
                                    {item.message && (
                                      <p className="text-sm font-semibold leading-relaxed text-slate-700">
                                        {item.message}
                                      </p>
                                    )}
                                    <div className="space-y-2">
                                      {item.checklist.map((row) => {
                                        const statusMeta = getQcChecklistStatusPresentation(row.status);
                                        const StatusIcon = getQcChecklistStatusIcon(row.status);
                                        return (
                                          <div
                                            key={`${item.id}-${row.id}`}
                                            className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2"
                                          >
                                            <div className="flex flex-wrap items-center gap-2">
                                              <span
                                                className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-bold ${statusMeta.className}`}
                                              >
                                                <StatusIcon className="h-3 w-3" />
                                                {statusMeta.label}
                                              </span>
                                              <span className="text-xs font-semibold text-slate-800">
                                                {row.label}
                                              </span>
                                            </div>
                                            <div className="mt-1.5 text-xs font-medium text-slate-600">
                                              <span className="font-semibold text-slate-700">
                                                Note:
                                              </span>{' '}
                                              {getChecklistNoteOptionLabel(row.noteOption)}
                                              {row.noteText ? ` - ${row.noteText}` : ''}
                                            </div>
                                          </div>
                                        );
                                      })}
                                    </div>
                                  </div>
                                ) : (
                                  <p className="text-sm font-medium leading-relaxed text-slate-700">
                                    {item.message}
                                  </p>
                                )
                              ) : (
                                <button
                                  type="button"
                                  onClick={() =>
                                    item.attachmentId &&
                                    handleViewAttachment(item.attachmentId)
                                  }
                                  className="inline-flex max-w-full items-center gap-3 rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-100"
                                >
                                  <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-white text-slate-600 ring-1 ring-slate-200">
                                    <FileText className="h-4 w-4" />
                                  </span>
                                  <span className="max-w-[360px] truncate">
                                    {item.attachmentFilename}
                                  </span>
                                  {purposeMeta && (
                                    <span
                                      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-bold ${purposeMeta.badgeClassName}`}
                                    >
                                      {purposeMeta.label}
                                    </span>
                                  )}
                                </button>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {shouldShowProofUploader && (
                    <div className="mt-6 rounded-2xl border border-amber-200 bg-gradient-to-b from-amber-50/70 to-white p-5 shadow-sm">
                      <div className="mb-3 flex items-start justify-between gap-3">
                        <div className="flex items-center gap-3">
                          <span className="inline-flex h-9 w-9 items-center justify-center rounded-xl bg-amber-100 text-amber-700">
                            <FileText className="h-4 w-4" />
                          </span>
                          <div>
                            <p className="text-sm font-bold text-slate-900">
                              {isQcAttachmentSection ? 'Attach Documents' : 'Proof Attachment'}
                            </p>
                            <p className="text-xs font-medium text-slate-600">
                              {isQcAttachmentSection
                                ? 'Add supporting documents if needed before routing or completing this task.'
                                : 'Upload proof before completing or routing this task.'}
                            </p>
                          </div>
                        </div>
                        <span
                          className={`inline-flex items-center rounded-full border px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide ${
                            isQcAttachmentSection
                              ? 'border-slate-200 bg-white text-slate-600'
                              : 'border-amber-200 bg-white text-amber-700'
                          }`}
                        >
                          {isQcAttachmentSection ? 'Optional' : 'Required'}
                        </span>
                      </div>
                      <div className="flex flex-wrap items-center gap-3">
                        <input
                          type="file"
                          accept="application/pdf,image/*"
                          disabled={!!uploadingId}
                          onChange={(e) => {
                            const f = e.target.files?.[0];
                            e.currentTarget.value = '';
                            if (!f) return;
                            void handleUploadProof(task.id, f);
                          }}
                          className="block w-full text-sm text-slate-600 file:mr-3 file:rounded-lg file:border file:border-slate-300 file:bg-white file:px-4 file:py-2 file:text-sm file:font-semibold file:text-slate-700 hover:file:bg-slate-50 disabled:opacity-60"
                        />
                        {uploadingId === task.id && (
                          <div className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-600">
                            <Loader2 className="h-4 w-4 animate-spin" />
                            {isQcAttachmentSection
                              ? 'Uploading attachment...'
                              : 'Uploading proof...'}
                          </div>
                        )}
                      </div>
                      {canDisclosureEditProofAttachments && proofAttachments.length > 0 && (
                        <div className="mt-4 space-y-2">
                          <p className="text-xs font-bold uppercase tracking-wide text-slate-500">
                            Uploaded Proof
                          </p>
                          {proofAttachments.map((att) => (
                            <div
                              key={att.id}
                              className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white px-3 py-2"
                            >
                              <button
                                type="button"
                                onClick={() => handleViewAttachment(att.id)}
                                className="min-w-0 truncate text-left text-sm font-semibold text-slate-700 hover:text-blue-700"
                              >
                                {att.filename}
                              </button>
                              <button
                                type="button"
                                onClick={() => void handleDeleteProofAttachment(att.id)}
                                disabled={deletingAttachmentId === att.id}
                                className="inline-flex items-center gap-1 rounded-lg border border-red-200 bg-red-50 px-2.5 py-1 text-xs font-semibold text-red-700 hover:bg-red-100 disabled:opacity-60 disabled:cursor-not-allowed"
                              >
                                {deletingAttachmentId === att.id && (
                                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                )}
                                Delete
                              </button>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                  {isDisclosureMissingItemsRoute && (
                    <div className="mt-6 rounded-2xl border border-slate-200 bg-slate-50 p-5 shadow-sm">
                      <div className="flex items-start gap-3">
                        <span className="inline-flex h-9 w-9 items-center justify-center rounded-xl bg-slate-200 text-slate-600">
                          <FileText className="h-4 w-4" />
                        </span>
                        <div>
                          <p className="text-sm font-bold text-slate-800">
                            Proof Attachment Not Required
                          </p>
                          <p className="text-xs font-medium text-slate-600">
                            For <span className="font-semibold">Missing Items / Incomplete</span>,
                            you can route this task back to LO without uploading proof.
                          </p>
                        </div>
                      </div>
                    </div>
                  )}

                  {(isDisclosureInitialRoutingState ||
                    isDisclosureReturnedRoutingState) && (
                      <div className="mt-8 rounded-2xl border border-blue-200 bg-gradient-to-b from-blue-50/80 to-white p-6 shadow-sm space-y-4">
                        <div className="mb-2 flex items-start justify-between gap-3">
                          <div className="flex items-center gap-3">
                            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-blue-100 text-blue-700">
                              <MessageSquare className="h-4 w-4" />
                            </div>
                            <div>
                              <h4 className="text-sm font-bold text-blue-900">Disclosure Action</h4>
                              <p className="text-xs font-medium text-blue-800/80">
                                Choose action type and include context for the LO.
                              </p>
                            </div>
                          </div>
                          <span className="inline-flex items-center rounded-full border border-blue-200 bg-white px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide text-blue-700">
                            Required Note
                          </span>
                        </div>
                        <div className="space-y-2">
                          <label className="text-[11px] font-bold uppercase tracking-widest text-slate-500">
                            Action Type
                          </label>
                          <select
                            value={selectedReason}
                            onChange={(event) =>
                              setDisclosureReasonByTask((prev) => ({
                                ...prev,
                                [task.id]: event.target.value as DisclosureDecisionReason,
                              }))
                            }
                            className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm font-semibold text-slate-800 shadow-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                          >
                            {disclosureReasonOptions.map((option) => (
                              <option key={option.value} value={option.value}>
                                {option.label}
                              </option>
                            ))}
                          </select>
                        </div>
                        <div className="space-y-2">
                          <label className="text-[11px] font-bold uppercase tracking-widest text-slate-500">
                            LO Context / Notes
                          </label>
                          <textarea
                            value={disclosureMessageByTask[task.id] || ''}
                            onChange={(event) =>
                              setDisclosureMessageByTask((prev) => ({
                                ...prev,
                                [task.id]: event.target.value,
                              }))
                            }
                            placeholder="Add context for the LO (what changed, what is missing, next steps)..."
                            className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm font-medium text-slate-800 shadow-sm min-h-[110px] focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                          />
                        </div>
                        <div className="rounded-lg border border-slate-200 bg-white px-3 py-2">
                          <p className="text-xs font-semibold text-slate-600">
                            Add a clear note, then use the bottom action bar to route this task.
                          </p>
                        </div>
                      </div>
                    )}

                  {canManageQcDesk && isQcSubmissionTask(task) && task.status !== 'COMPLETED' && (
                    <div className="mt-8 rounded-2xl border border-violet-100 bg-violet-50/50 p-6 shadow-sm space-y-4">
                      <div className="flex items-center gap-3 mb-2">
                        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-violet-100 text-violet-700">
                          <MessageSquare className="h-4 w-4" />
                        </div>
                        <h4 className="text-sm font-bold text-violet-900">QC Action Checklist</h4>
                      </div>
                      <div className="space-y-3">
                        {qcChecklistRows.map((row) => {
                          const status = getQcChecklistStatusFromOption(row.noteOption);
                          const statusMeta = getQcChecklistStatusPresentation(status);
                          const StatusIcon = getQcChecklistStatusIcon(status);
                          const noteRequired = status === 'RED_X';
                          return (
                            <div
                              key={row.id}
                              className="rounded-xl border border-violet-100 bg-white p-4 shadow-sm"
                            >
                              <p className="text-sm font-semibold text-slate-900">{row.label}</p>
                              <div className="mt-3 grid grid-cols-1 gap-2 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
                                <div className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-2">
                                  <span
                                    className={`inline-flex h-9 w-9 items-center justify-center rounded-full border ${statusMeta.className}`}
                                    aria-label={statusMeta.label}
                                    title={statusMeta.label}
                                  >
                                    <StatusIcon className="h-4 w-4" />
                                  </span>
                                  <select
                                    value={row.noteOption}
                                    onChange={(event) =>
                                      updateQcChecklistRow(task.id, row.id, {
                                        noteOption: event.target.value as QcChecklistNoteOption,
                                        noteText: row.noteText,
                                      })
                                    }
                                    className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700 focus:border-violet-500 focus:ring-1 focus:ring-violet-500"
                                  >
                                    <option value="">Select note option</option>
                                    {qcChecklistNoteOptions.map((option) => (
                                      <option key={option.value} value={option.value}>
                                        {option.label}
                                      </option>
                                    ))}
                                  </select>
                                </div>
                                <input
                                  value={row.noteText}
                                  onChange={(event) =>
                                    updateQcChecklistRow(task.id, row.id, {
                                      noteText: event.target.value,
                                    })
                                  }
                                  placeholder="Notes"
                                  className={`w-full rounded-lg border bg-white px-3 py-2 text-xs font-medium text-slate-700 focus:border-violet-500 focus:ring-1 focus:ring-violet-500 ${
                                    noteRequired && !row.noteText.trim()
                                      ? 'border-rose-300'
                                      : 'border-slate-200'
                                  }`}
                                />
                              </div>
                            </div>
                          );
                        })}
                      </div>
                      {qcChecklistMissingFields && (
                        <p className="text-xs font-semibold text-rose-700">
                          Complete each checklist row with a dropdown selection. Red items require a note.
                        </p>
                      )}
                      {qcChecklistBlocksCompleteAction && (
                        <p className="text-xs font-semibold text-amber-700">
                          Complete QC is blocked because at least one checklist item is Red X. Use Missing Items.
                        </p>
                      )}
                      {qcChecklistBlocksMissingItemsAction && (
                        <p className="text-xs font-semibold text-amber-700">
                          Missing Items is blocked because all checklist items are green.
                        </p>
                      )}
                      <div className="rounded-xl border border-violet-200 bg-white p-4 shadow-sm">
                        <p className="mb-2 text-[11px] font-bold uppercase tracking-widest text-violet-700">
                          QC Final Decision
                        </p>
                        <select
                          value={selectedQcReason}
                          onChange={(event) =>
                            setDisclosureReasonByTask((prev) => ({
                              ...prev,
                              [task.id]: event.target.value as DisclosureDecisionReason,
                            }))
                          }
                          className="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm font-medium shadow-sm focus:border-violet-500 focus:ring-1 focus:ring-violet-500"
                        >
                          {qcReasonOptions.map((option) => (
                            <option key={option.value} value={option.value}>
                              {option.label}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>
                  )}

                  {isLoTaskForCurrentLoanOfficer && task.status !== 'COMPLETED' && (
                    <div className="mt-8 rounded-2xl border border-blue-200 bg-blue-50/60 p-6 shadow-sm space-y-4">
                      <div className="flex items-center gap-3 mb-2">
                        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-100 text-blue-700">
                          <MessageSquare className="h-4 w-4" />
                        </div>
                        <h4 className="text-sm font-bold text-blue-900">Loan Officer Response</h4>
                      </div>
                      <textarea
                        value={loResponseByTask[task.id] || ''}
                        onChange={(event) =>
                          setLoResponseByTask((prev) => ({
                            ...prev,
                            [task.id]: event.target.value,
                          }))
                        }
                        placeholder="Describe your response and what you updated for Disclosure..."
                        className="w-full rounded-xl border border-blue-200 bg-white px-4 py-3 text-sm font-medium shadow-sm min-h-[100px] focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                      />
                      <p className="text-xs font-semibold text-blue-700/80">
                        Notes are required before submitting from the footer.
                      </p>
                    </div>
                  )}

                  <div className="mt-8 flex flex-wrap items-center justify-end gap-3 border-t border-slate-200/60 pt-6">
                    <WorkedByTags summary={workedBySummary} className="mr-auto" />
                    {showDisclosureStartButton && (
                      <button
                        type="button"
                        onClick={() => void handleStartDisclosureRequest(task.id)}
                        disabled={startingDisclosureId === task.id || disableDisclosureStartButton}
                        className="app-btn-primary disabled:opacity-60 disabled:cursor-not-allowed"
                        title={
                          disableDisclosureStartButton
                            ? `Already started by ${assignedSpecialistName || 'another specialist'}`
                            : 'Claim and start this disclosure request'
                        }
                      >
                        {startingDisclosureId === task.id && (
                          <Loader2 className="w-4 h-4 animate-spin" />
                        )}
                        {disableDisclosureStartButton
                          ? `Started by ${assignedSpecialistName || 'another specialist'}`
                          : 'Start'}
                      </button>
                    )}
                    {showQcStartButton && (
                      <button
                        type="button"
                        onClick={() => void handleStartQcRequest(task.id)}
                        disabled={startingQcId === task.id || disableQcStartButton}
                        className="app-btn-secondary disabled:opacity-60 disabled:cursor-not-allowed"
                        title={
                          disableQcStartButton
                            ? `Already started by ${assignedSpecialistName || 'another specialist'}`
                            : 'Claim and start this QC request'
                        }
                      >
                        {startingQcId === task.id && (
                          <Loader2 className="w-4 h-4 animate-spin" />
                        )}
                        {disableQcStartButton
                          ? `Started by ${assignedSpecialistName || 'another specialist'}`
                          : 'Start'}
                      </button>
                    )}
                    {task.status === 'PENDING' &&
                      !shouldHideGenericStartForDisclosureSubmission &&
                      !isDisclosureInitialRoutingState &&
                      !shouldRouteFromFooter &&
                      !shouldLoRespondFromFooter &&
                      !isLoanOfficerSubmissionTask && (
                      <button
                        onClick={() => handleStatusChange(task.id, 'IN_PROGRESS')}
                        disabled={!!updatingId}
                        className="inline-flex h-9 items-center px-3 text-slate-600 text-sm font-semibold hover:text-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed gap-2"
                      >
                        {updatingId === task.id && <Loader2 className="w-3 h-3 animate-spin" />}
                        Start
                      </button>
                    )}
                    {!isLoTaskForCurrentLoanOfficer &&
                      task.status !== 'COMPLETED' &&
                      !isDisclosureInitialRoutingState &&
                      !(
                        shouldRouteFromFooter && !isDisclosureReturnedRoutingState
                      ) &&
                      !isLoanOfficerSubmissionTask && (
                      <button
                        onClick={() => {
                          if (isDisclosureRole) {
                            const confirmed = window.confirm(
                              'Are you Sure you want to complete this task?'
                            );
                            if (!confirmed) return;
                          }
                          handleStatusChange(task.id, 'COMPLETED');
                        }}
                        disabled={!!updatingId || !canCompleteTask}
                        className="inline-flex h-9 items-center px-3 rounded-lg border border-emerald-300 bg-white text-emerald-700 text-sm font-semibold shadow-sm hover:border-emerald-400 hover:bg-emerald-50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        {updatingId === task.id ? (
                          <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />
                        ) : (
                          <CheckCircle className="w-4 h-4 mr-1.5" />
                        )}
                        {updatingId === task.id
                          ? 'Saving...'
                          : !canCompleteTask
                          ? 'Upload Proof First'
                          : 'Complete'}
                      </button>
                    )}
                    {shouldRouteFromFooter && (
                      (() => {
                        const isQcRouteTask = isQcSubmissionTask(task);
                        const disableRouteButton =
                          sendingToLoId === task.id ||
                          (requiresProofForRouting && proofCount < 1) ||
                          (isQcRouteTask
                            ? qcChecklistMissingFields ||
                              qcChecklistBlocksCompleteAction ||
                              qcChecklistBlocksMissingItemsAction
                            : !disclosureFooterMessage);
                        return (
                      <button
                        type="button"
                        onClick={() => void handleSendToLoanOfficer(task)}
                        disabled={disableRouteButton}
                        className={`disabled:opacity-60 disabled:cursor-not-allowed ${
                          isMissingItemsRouteAction
                            ? 'inline-flex h-9 items-center rounded-lg border border-amber-200 bg-amber-50 px-4 text-sm font-semibold text-amber-700 transition-colors hover:bg-amber-100'
                            : isDisclosureSubmissionTask(task)
                            ? 'app-btn-primary'
                            : isQcCompleteRouteAction
                            ? 'inline-flex h-9 items-center rounded-lg border border-emerald-300 bg-white px-4 text-sm font-semibold text-emerald-700 shadow-sm hover:border-emerald-400 hover:bg-emerald-50 transition-colors'
                            : 'app-btn-secondary'
                        }`}
                      >
                        {sendingToLoId === task.id && (
                          <Loader2 className="w-4 h-4 animate-spin" />
                        )}
                        {isDisclosureSubmissionTask(task)
                          ? selectedReason ===
                            DisclosureDecisionReason.APPROVE_INITIAL_DISCLOSURES
                            ? 'Send to LO for Approval'
                            : 'Send Back to LO'
                          : selectedQcReason ===
                            DisclosureDecisionReason.APPROVE_INITIAL_DISCLOSURES
                          ? 'Complete QC'
                          : 'Send Back to LO'}
                      </button>
                        );
                      })()
                    )}
                    {shouldLoRespondFromFooter &&
                      (isApprovalReviewTask ? (
                        <>
                          <button
                            type="button"
                            onClick={() =>
                              void handleLoanOfficerDisclosureReview(task, 'APPROVE')
                            }
                            disabled={respondingId === task.id || !loFooterResponse}
                            className="app-btn-primary disabled:opacity-60 disabled:cursor-not-allowed"
                          >
                            {respondingId === task.id && (
                              <Loader2 className="w-4 h-4 animate-spin" />
                            )}
                            Approve Figures
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              void handleLoanOfficerDisclosureReview(
                                task,
                                'REVISION_REQUIRED'
                              )
                            }
                            disabled={respondingId === task.id || !loFooterResponse}
                            className="inline-flex h-9 items-center rounded-lg border border-amber-200 bg-amber-50 px-4 text-sm font-semibold text-amber-700 hover:bg-amber-100 disabled:opacity-60 disabled:cursor-not-allowed"
                          >
                            {respondingId === task.id && (
                              <Loader2 className="w-4 h-4 animate-spin" />
                            )}
                            Request Revision
                          </button>
                        </>
                      ) : (
                        <button
                          type="button"
                          onClick={() => void handleLoanOfficerResponse(task)}
                          disabled={respondingId === task.id || !loFooterResponse}
                          className="app-btn-primary disabled:opacity-60 disabled:cursor-not-allowed"
                        >
                          {respondingId === task.id && (
                            <Loader2 className="w-4 h-4 animate-spin" />
                          )}
                          Respond to Disclosure
                        </button>
                      ))}
                    {canDelete && (
                      <button
                        onClick={() => handleDelete(task.id)}
                        disabled={!!deletingId}
                        className="inline-flex h-9 w-9 items-center justify-center text-red-600 hover:text-red-700 hover:bg-red-50 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                        aria-label="Delete task"
                      >
                        {deletingId === task.id ? (
                          <Loader2 className="w-4 h-4 animate-spin" />
                        ) : (
                          <Trash2 className="w-4 h-4" />
                        )}
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => setFocusedTaskId(null)}
                      className="app-btn-secondary h-9 px-3 text-sm"
                    >
                      Close
                    </button>
                  </div>
                </div>
              </div>
            )}
          </React.Fragment>
        );
      })}
    </div>
  );
}

