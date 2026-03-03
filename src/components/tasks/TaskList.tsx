'use client';

import React from 'react';
import {
  Calendar,
  CheckCircle,
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
  { value: DisclosureDecisionReason.MISSING_ITEMS, label: 'Missing Items' },
  { value: DisclosureDecisionReason.OTHER, label: 'Other' },
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
};

type ContributorSummary = {
  visibleContributors: Array<{ name: string; role: UserRole | null }>;
  overflowCount: number;
};

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
          className={`inline-flex items-center rounded-full border font-semibold ${chipSize} ${
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
          {contributor.name}
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

type Task = {
  id: string;
  title: string;
  description: string | null;
  status: TaskStatus;
  dueDate: Date | null;
  kind: TaskKind | null;
  workflowState: TaskWorkflowState;
  disclosureReason: DisclosureDecisionReason | null;
  parentTaskId: string | null;
  loanOfficerApprovedAt: Date | null;
  submissionData?: Prisma.JsonValue | null;
  loan: {
    loanNumber: string;
    borrowerName: string;
    stage?: string;
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
}: {
  tasks: Task[];
  canDelete?: boolean;
  currentRole: string;
  currentUserId?: string;
  initialFocusedTaskId?: string | null;
}) {
  const router = useRouter();
  const [updatingId, setUpdatingId] = React.useState<string | null>(null);
  const [deletingId, setDeletingId] = React.useState<string | null>(null);
  const [uploadingId, setUploadingId] = React.useState<string | null>(null);
  const [deletingAttachmentId, setDeletingAttachmentId] = React.useState<string | null>(null);
  const [focusedTaskId, setFocusedTaskId] = React.useState<string | null>(null);
  const [initialFocusConsumed, setInitialFocusConsumed] = React.useState(false);
  const [startingDisclosureId, setStartingDisclosureId] = React.useState<string | null>(
    null
  );
  const [sendingToLoId, setSendingToLoId] = React.useState<string | null>(null);
  const [respondingId, setRespondingId] = React.useState<string | null>(null);
  const [disclosureReasonByTask, setDisclosureReasonByTask] = React.useState<
    Record<string, DisclosureDecisionReason>
  >({});
  const [disclosureMessageByTask, setDisclosureMessageByTask] = React.useState<
    Record<string, string>
  >({});
  const [loResponseByTask, setLoResponseByTask] = React.useState<
    Record<string, string>
  >({});

  React.useEffect(() => {
    if (!initialFocusedTaskId || initialFocusConsumed) return;
    const existsInList = tasks.some((task) => task.id === initialFocusedTaskId);
    if (existsInList) {
      setFocusedTaskId(initialFocusedTaskId);
      setInitialFocusConsumed(true);
    }
  }, [initialFocusedTaskId, initialFocusConsumed, tasks]);

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
    const message = (disclosureMessageByTask[task.id] || '').trim();
    if (!message) {
      alert('Please add a note before routing this task.');
      return;
    }
    setSendingToLoId(task.id);
    const result = await requestInfoFromLoanOfficer(task.id, { reason, message });
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
  const isQcRole = currentRole === UserRole.QC;
  const isDisclosureSubmissionTask = (task: Task) =>
    task.kind === TaskKind.SUBMIT_DISCLOSURES;
  const isQcSubmissionTask = (task: Task) => task.kind === TaskKind.SUBMIT_QC;
  const isLoResponseTask = (task: Task) => task.kind === TaskKind.LO_NEEDS_INFO;

  if (tasks.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center">
        <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-slate-50 shadow-sm ring-1 ring-slate-200/60">
          <CheckCircle className="h-6 w-6 text-slate-400" />
        </div>
        <h3 className="text-lg font-bold text-slate-900">All caught up!</h3>
        <p className="mt-1 text-sm font-medium text-slate-500">No pending tasks in your queue.</p>
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
          disclosureReasonByTask[task.id] || DisclosureDecisionReason.MISSING_ITEMS;
        const canDisclosureEditProofAttachments =
          isDisclosureRole &&
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
          isDisclosureSubmissionTask(task) ||
          isQcSubmissionTask(task);
        const canCompleteTask = !requiresProofForCompletion || proofCount > 0;
        const isLoTaskForCurrentLoanOfficer =
          currentRole === UserRole.LOAN_OFFICER && isLoResponseTask(task);
        const isLoanOfficerSubmissionTask =
          currentRole === UserRole.LOAN_OFFICER && isDisclosureSubmissionTask(task);
        const isApprovalReviewTask =
          isLoTaskForCurrentLoanOfficer &&
          task.disclosureReason ===
            DisclosureDecisionReason.APPROVE_INITIAL_DISCLOSURES;
        const isDisclosureInitialRoutingState =
          isDisclosureRole &&
          isDisclosureSubmissionTask(task) &&
          task.status !== TaskStatus.COMPLETED &&
          task.workflowState === TaskWorkflowState.NONE;
        const isDisclosureReturnedRoutingState =
          isDisclosureRole &&
          isDisclosureSubmissionTask(task) &&
          task.status !== TaskStatus.COMPLETED &&
          task.workflowState === TaskWorkflowState.READY_TO_COMPLETE;
        const shouldHideGenericStartForDisclosureSubmission =
          isDisclosureRole && isDisclosureSubmissionTask(task);
        const shouldRouteFromFooter =
          task.status !== TaskStatus.COMPLETED &&
          ((isDisclosureInitialRoutingState ||
            isDisclosureReturnedRoutingState) ||
            (isQcRole && isQcSubmissionTask(task)));
        const isDisclosureMissingItemsRoute =
          isDisclosureRole &&
          isDisclosureSubmissionTask(task) &&
          (isDisclosureInitialRoutingState || isDisclosureReturnedRoutingState) &&
          selectedReason === DisclosureDecisionReason.MISSING_ITEMS;
        const shouldShowProofUploader =
          task.status !== 'COMPLETED' &&
          ((isVaSubRole && isVaTaskKind(task.kind)) ||
            (canDisclosureEditProofAttachments && !isDisclosureMissingItemsRoute) ||
            (isQcRole && isQcSubmissionTask(task)));
        const requiresProofForRouting =
          (isDisclosureRole &&
            isDisclosureSubmissionTask(task) &&
            selectedReason === DisclosureDecisionReason.APPROVE_INITIAL_DISCLOSURES) ||
          (isQcRole && isQcSubmissionTask(task));
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
        const disclosureFooterMessage = (disclosureMessageByTask[task.id] || '').trim();
        const loFooterResponse = (loResponseByTask[task.id] || '').trim();
        const parsedSubmissionData =
          task.submissionData &&
          typeof task.submissionData === 'object' &&
          !Array.isArray(task.submissionData)
            ? task.submissionData
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
        const workedBySummary = getContributorSummaryFromSubmissionData(
          parsedSubmissionData as Record<string, unknown> | null
        );
        const timelineItems: TimelineItem[] = [
          ...noteHistoryEntries.map((entry, index) => ({
            id: `note-${index}-${entry.date}`,
            type: 'note' as const,
            createdAt: entry.date,
            actorName: entry.author,
            actorRole: entry.role,
            message: entry.message,
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
        const loReturnBadge =
          currentRole === UserRole.LOAN_OFFICER &&
          task.kind === TaskKind.SUBMIT_DISCLOSURES &&
          task.workflowState === TaskWorkflowState.READY_TO_COMPLETE
            ? task.disclosureReason ===
              DisclosureDecisionReason.APPROVE_INITIAL_DISCLOSURES
              ? {
                  label: 'Sent to Disclosure: Approved',
                  className: 'border-blue-200 bg-blue-50 text-blue-700',
                }
              : {
                  label: 'Sent to Disclosure: Revision Needed',
                  className: 'border-amber-200 bg-amber-50 text-amber-700',
                }
            : null;
        const isFocused = focusedTaskId === task.id;

        return (
          <React.Fragment key={task.id}>
            <div className="group relative flex flex-col overflow-hidden rounded-2xl border border-slate-200/80 bg-white p-4 shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md hover:border-blue-300 hover:ring-1 hover:ring-blue-100 min-h-[96px]">
              <div className="absolute -right-6 -top-6 h-24 w-24 rounded-full bg-slate-50 opacity-50 blur-2xl group-hover:bg-blue-50 transition-colors"></div>
              <div className="relative flex items-center space-x-4 min-w-0 flex-1">
                <div
                  className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-xl shadow-sm ring-1 ring-black/5 ${
                    task.status === 'COMPLETED'
                      ? 'bg-emerald-100 text-emerald-600'
                      : task.status === 'IN_PROGRESS'
                      ? 'bg-blue-100 text-blue-600'
                      : 'bg-slate-100 text-slate-500'
                  }`}
                >
                  <FileText className="h-6 w-6" />
                </div>
                <div className="min-w-0 w-full">
                  <button
                    type="button"
                    onClick={() => setFocusedTaskId(task.id)}
                    className="w-full text-left focus:outline-none"
                    title="Open Task"
                  >
                    <span className="block text-sm font-bold leading-snug text-slate-900 group-hover:text-blue-950 transition-colors whitespace-normal break-words pr-1">
                      {task.loan.borrowerName}
                    </span>
                    <span className="block text-xs font-medium text-slate-500 whitespace-normal break-words pr-1">
                      {task.loan.loanNumber}
                    </span>
                    {assignedSpecialistName && isDisclosureSubmissionTask(task) && (
                      <span className="mt-1 inline-flex items-center rounded-full border border-blue-200 bg-blue-50 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-blue-700">
                        Assigned: {assignedSpecialistName}
                      </span>
                    )}
                    <WorkedByTags
                      summary={workedBySummary}
                      compact
                      className="mt-2"
                    />
                    {loReturnBadge && (
                      <span
                        className={`mt-2 inline-flex items-center rounded-full border px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider shadow-sm ${loReturnBadge.className}`}
                      >
                        {loReturnBadge.label}
                      </span>
                    )}
                  </button>
                </div>
              </div>
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

                  {task.description && (
                    <div className="mt-6 rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200/60">
                      <p className="text-sm font-medium leading-relaxed text-slate-600 break-words">
                        {task.description}
                      </p>
                    </div>
                  )}

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
                                <p className="text-sm font-medium leading-relaxed text-slate-700">
                                  {item.message}
                                </p>
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
                            <p className="text-sm font-bold text-slate-900">Proof Attachment</p>
                            <p className="text-xs font-medium text-slate-600">
                              Upload proof before completing or routing this task.
                            </p>
                          </div>
                        </div>
                        <span className="inline-flex items-center rounded-full border border-amber-200 bg-white px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide text-amber-700">
                          Required
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
                            Uploading proof...
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

                  {isQcRole && isQcSubmissionTask(task) && task.status !== 'COMPLETED' && (
                    <div className="mt-8 rounded-2xl border border-blue-100 bg-blue-50/50 p-6 shadow-sm space-y-4">
                      <div className="flex items-center gap-3 mb-2">
                        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-100 text-blue-700">
                          <MessageSquare className="h-4 w-4" />
                        </div>
                        <h4 className="text-sm font-bold text-blue-900">QC Action</h4>
                      </div>
                      <select
                        value={selectedQcReason}
                        onChange={(event) =>
                          setDisclosureReasonByTask((prev) => ({
                            ...prev,
                            [task.id]: event.target.value as DisclosureDecisionReason,
                          }))
                        }
                        className="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm font-medium shadow-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                      >
                        {qcReasonOptions.map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                      <textarea
                        value={disclosureMessageByTask[task.id] || ''}
                        onChange={(event) =>
                          setDisclosureMessageByTask((prev) => ({
                            ...prev,
                            [task.id]: event.target.value,
                          }))
                        }
                        placeholder="Add context for LO (what is missing or what needs correction)..."
                        className="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm font-medium shadow-sm min-h-[100px] focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                      />
                      <p className="text-xs font-semibold text-slate-500">
                        Add a note, then use the bottom action bar to route this task.
                      </p>
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
                      <button
                        type="button"
                        onClick={() => void handleSendToLoanOfficer(task)}
                        disabled={
                          sendingToLoId === task.id ||
                          (requiresProofForRouting && proofCount < 1) ||
                          !disclosureFooterMessage
                        }
                        className={`disabled:opacity-60 disabled:cursor-not-allowed ${
                          isDisclosureRole ? 'app-btn-primary' : 'app-btn-secondary'
                        }`}
                      >
                        {sendingToLoId === task.id && (
                          <Loader2 className="w-4 h-4 animate-spin" />
                        )}
                        {isDisclosureRole
                          ? selectedReason ===
                            DisclosureDecisionReason.APPROVE_INITIAL_DISCLOSURES
                            ? 'Send to LO for Approval'
                            : 'Send Back to LO'
                          : 'Send Back to LO'}
                      </button>
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

