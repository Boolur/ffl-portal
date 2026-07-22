'use server';

import { getServerSession } from 'next-auth';
import {
  PayrollCompRequestStatus,
  Prisma,
  TaskKind,
  UserRole,
} from '@prisma/client';
import { authOptions } from '@/lib/auth';
import { isAdmin } from '@/lib/adminTiers';
import { canAccessPipelinePortal } from '@/lib/pipelinePilot';
import { prisma } from '@/lib/prisma';
import { buildLoanOfficerLoanOrClauses } from '@/lib/loanOfficerVisibility';

export type PipelineRangePreset = 'daily' | 'weekly' | 'monthly' | 'ytd' | 'allTime' | 'custom';
export type PipelineMilestoneKey = 'plusOne' | 'disclosures' | 'processing' | 'fundings';
type PipelineTrendGranularity = 'monthly' | 'weekly' | 'daily';

export type PipelineReportFilters = {
  preset?: PipelineRangePreset;
  startDate?: string;
  endDate?: string;
  loanOfficerId?: string | 'all' | null;
  trendPreset?: PipelineRangePreset;
  trendStartDate?: string;
  trendEndDate?: string;
};

export type PipelineOfficerOption = {
  id: string;
  name: string;
  email: string;
};

export type PipelineMilestoneSummary = {
  key: PipelineMilestoneKey;
  label: string;
  count: number;
  priorCount: number | null;
  conversionRate: number | null;
};

export type PipelineTrendBucket = {
  label: string;
  startDate: string;
  plusOne: number;
  disclosures: number;
  processing: number;
  fundings: number;
};

export type PipelineTeamRow = {
  loanOfficerId: string;
  loanOfficerName: string;
  plusOne: number;
  disclosures: number;
  processing: number;
  fundings: number;
  pullThroughRate: number | null;
};

export type PipelineGroupRow = {
  key: string;
  label: string;
  totalCount: number;
  volumeTotal: number;
  revenueTotal: number;
  plusOne: number;
  disclosures: number;
  processing: number;
  fundings: number;
  latestActivityAt: string | null;
};

export type PipelineBoardStageMetrics = {
  plusOne: {
    volumeTotal: number;
    revenueTotal: number;
  };
  disclosures: {
    volumeTotal: number;
    units: number;
  };
  processing: {
    volumeTotal: number;
    revenueTotal: number;
  };
  fundings: {
    volumeTotal: number;
    revenueTotal: number;
  };
};

export type PipelineMilestoneRow = {
  id: string;
  loanId: string | null;
  milestone: PipelineMilestoneKey;
  milestoneLabel: string;
  borrowerName: string;
  loanNumber: string;
  loanOfficerName: string;
  amount: number | null;
  revenue: number | null;
  leadSource: string | null;
  lender: string | null;
  status: string;
  occurredAt: string;
  sharedLoanOfficerNames: string[];
  updateSignal: {
    label: string;
    tone: 'danger' | 'success' | 'info' | 'neutral';
  } | null;
  fileDetails: {
    loan: {
      borrowerPhone: string | null;
      borrowerEmail: string | null;
      program: string | null;
      propertyAddress: string | null;
      stage: string | null;
      createdAt: string | null;
      updatedAt: string | null;
    };
    task: {
      title: string | null;
      queueStage: {
        label: string;
        description: string;
        tone: 'danger' | 'success' | 'info' | 'neutral';
      };
      submittedFields: Array<{ label: string; value: string }>;
      notes: Array<{
        author: string;
        role: string | null;
        message: string;
        date: string;
        entryType: 'note' | 'qcChecklist' | 'jrChecklist';
      }>;
      checklistItems: Array<{
        label: string;
        status: 'GREEN_CHECK' | 'RED_X' | 'YELLOW' | 'ORDERED' | 'MISSING_ITEMS' | 'COMPLETED' | 'NOT_REQUIRED';
        note: string | null;
      }>;
    } | null;
    payroll: {
      loanType: string | null;
      lender: string | null;
      loanChannel: string | null;
      processingType: string | null;
      expectedRevenue: number | null;
      submittedAt: string | null;
      paidAt: string | null;
    } | null;
  };
};

export type PipelineReport = {
  filters: {
    preset: PipelineRangePreset;
    startDate: string;
    endDate: string;
    loanOfficerId: string | 'all';
    trendPreset: PipelineRangePreset;
    trendStartDate: string;
    trendEndDate: string;
  };
  canViewAll: boolean;
  loanOfficers: PipelineOfficerOption[];
  summary: PipelineMilestoneSummary[];
  totals: Record<PipelineMilestoneKey, number>;
  pullThroughRate: number | null;
  boardMetrics: PipelineBoardStageMetrics;
  trend: PipelineTrendBucket[];
  teamRows: PipelineTeamRow[];
  lenderRows: PipelineGroupRow[];
  leadSourceRows: PipelineGroupRow[];
  recentRows: PipelineMilestoneRow[];
  bucketRows: Record<PipelineMilestoneKey, PipelineMilestoneRow[]>;
};

type PipelineActor = {
  userId: string;
  name: string;
  email: string;
  role: UserRole;
};

const PROCESSING_KINDS = [TaskKind.SUBMIT_PROCESSING, TaskKind.SUBMIT_QC];
const MILESTONE_LABELS: Record<PipelineMilestoneKey, string> = {
  plusOne: '+1s',
  disclosures: 'Disclosures',
  processing: 'Processing/QC',
  fundings: 'Fundings',
};

function normalizeRole(role?: string | null): UserRole | null {
  const normalized = String(role || '').trim().toUpperCase();
  return (Object.values(UserRole) as string[]).includes(normalized)
    ? (normalized as UserRole)
    : null;
}

async function getPipelineActor(): Promise<PipelineActor | null> {
  const session = await getServerSession(authOptions);
  const role = normalizeRole(session?.user?.activeRole || session?.user?.role);
  if (!session?.user?.id || !role) return null;
  return {
    userId: session.user.id,
    name: session.user.name || 'User',
    email: session.user.email || '',
    role,
  };
}

async function assertPipelineActor() {
  const actor = await getPipelineActor();
  if (
    !actor ||
    !canAccessPipelinePortal({
      role: actor.role,
    })
  ) {
    throw new Error('Unauthorized');
  }
  return actor;
}

function startOfDay(date: Date) {
  const next = new Date(date);
  next.setHours(0, 0, 0, 0);
  return next;
}

function endOfDay(date: Date) {
  const next = new Date(date);
  next.setHours(23, 59, 59, 999);
  return next;
}

function resolveDateRange(filters: PipelineReportFilters = {}) {
  const preset = filters.preset || 'monthly';
  const now = new Date();
  const todayStart = startOfDay(now);
  const todayEnd = endOfDay(now);

  if (preset === 'custom' && filters.startDate && filters.endDate) {
    return {
      preset,
      start: startOfDay(new Date(filters.startDate)),
      end: endOfDay(new Date(filters.endDate)),
    };
  }

  if (preset === 'daily') {
    return { preset, start: todayStart, end: todayEnd };
  }

  if (preset === 'weekly') {
    const start = new Date(todayStart);
    start.setDate(start.getDate() - 6);
    return { preset, start, end: todayEnd };
  }

  if (preset === 'ytd') {
    return {
      preset,
      start: startOfDay(new Date(now.getFullYear(), 0, 1)),
      end: todayEnd,
    };
  }

  if (preset === 'allTime') {
    return {
      preset,
      // Portal history starts well after this, and this keeps all-time charts month-sized.
      start: startOfDay(new Date(2020, 0, 1)),
      end: todayEnd,
    };
  }

  return {
    preset: 'monthly' as const,
    start: startOfDay(new Date(now.getFullYear(), now.getMonth(), 1)),
    end: todayEnd,
  };
}

function percent(numerator: number, denominator: number) {
  if (!denominator) return null;
  return Math.round((numerator / denominator) * 1000) / 10;
}

function money(value: Prisma.Decimal | number | string | null | undefined) {
  if (value === null || value === undefined) return null;
  const normalized =
    typeof value === 'string'
      ? value.replace(/[$,\s]/g, '').trim()
      : value;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function toReadableLabel(key: string) {
  const labelOverrides: Record<string, string> = {
    arriveLoanNumber: 'ARIVE Loan Number',
    loanOfficer: 'Primary Loan Officer',
    secondaryLoanOfficerName: 'Secondary Loan Officer',
    loanAmount: 'Loan Amount',
    projectedRevenue: 'Projected Revenue',
    loanType: 'Loan Type',
    loanProgram: 'Loan Program',
    cashBack: 'Cash Back',
    creditReportType: 'Credit Report Type',
    aus: 'AUS',
    investor: 'Investor',
    titleCompany: 'Title Company',
    appraisalWaiver: 'Appraisal Waiver',
    notesGoals: 'Notes / Goals',
  };
  if (labelOverrides[key]) return labelOverrides[key];
  const spaced = key
    .replace(/_/g, ' ')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .trim();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

function submittedFieldsFromJson(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
  return Object.entries(value as Record<string, unknown>)
    .filter(([, fieldValue]) => {
      return (
        fieldValue !== null &&
        fieldValue !== undefined &&
        fieldValue !== '' &&
        (typeof fieldValue === 'string' ||
          typeof fieldValue === 'number' ||
          typeof fieldValue === 'boolean')
      );
    })
    .map(([key, fieldValue]) => ({
      label: toReadableLabel(key),
      value: String(fieldValue),
    }))
    .sort((a, b) => a.label.localeCompare(b.label))
    .slice(0, 80);
}

function submissionObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function firstStringFromSubmission(value: unknown, keys: string[]) {
  const data = submissionObject(value);
  if (!data) return null;
  for (const key of keys) {
    const raw = data[key];
    if (typeof raw === 'string' && raw.trim()) return raw.trim();
  }
  return null;
}

function propertyAddressFromSubmission(value: unknown) {
  const direct = firstStringFromSubmission(value, [
    'propertyAddress',
    'subjectPropertyAddress',
    'subjectProperty',
    'address',
    'property_address',
    'subject_property_address',
  ]);
  if (direct) return direct;

  const data = submissionObject(value);
  if (!data) return null;
  const street = firstStringFromSubmission(value, ['propertyStreet', 'street', 'propertyStreetAddress']);
  const city = firstStringFromSubmission(value, ['propertyCity', 'city']);
  const state = firstStringFromSubmission(value, ['propertyState', 'state']);
  const zip = firstStringFromSubmission(value, ['propertyZip', 'zip', 'propertyZipCode']);
  const cityStateZip = [city, state, zip].filter(Boolean).join(', ').replace(', ,', ',');
  return [street, cityStateZip].filter(Boolean).join(', ') || null;
}

function parseTaskNotesFromJson(value: unknown): NonNullable<PipelineMilestoneRow['fileDetails']['task']>['notes'] {
  const data = submissionObject(value);
  const notesHistory = Array.isArray(data?.notesHistory) ? data.notesHistory : [];
  return notesHistory
    .flatMap((entry) => {
      if (!entry || typeof entry !== 'object') return [];
      const item = entry as Record<string, unknown>;
      const author = typeof item.author === 'string' && item.author.trim() ? item.author.trim() : 'Team Member';
      const message = typeof item.message === 'string' ? item.message.trim() : '';
      const date = typeof item.date === 'string' ? item.date : '';
      if (!message || !date) return [];
      const entryType: 'note' | 'qcChecklist' | 'jrChecklist' =
        item.entryType === 'qcChecklist'
          ? 'qcChecklist'
          : item.entryType === 'jrChecklist'
            ? 'jrChecklist'
            : 'note';
      return [{
        author,
        role: typeof item.role === 'string' ? item.role : null,
        message,
        date,
        entryType,
      }];
    })
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
    .slice(0, 8);
}

function checklistItemsFromJson(value: unknown) {
  const data = submissionObject(value);
  const notesHistory = Array.isArray(data?.notesHistory) ? data.notesHistory : [];
  const latestChecklistEntry = [...notesHistory].reverse().find((entry) => {
    return (
      entry &&
      typeof entry === 'object' &&
      ((entry as Record<string, unknown>).entryType === 'qcChecklist' ||
        (entry as Record<string, unknown>).entryType === 'jrChecklist')
    );
  }) as Record<string, unknown> | undefined;

  const rawRows = Array.isArray(latestChecklistEntry?.checklist)
    ? latestChecklistEntry.checklist
    : Array.isArray(latestChecklistEntry?.jrChecklist)
      ? latestChecklistEntry.jrChecklist
      : [];

  return rawRows
    .flatMap((row) => {
      if (!row || typeof row !== 'object') return [];
      const item = row as Record<string, unknown>;
      const label = typeof item.label === 'string' ? item.label.trim() : '';
      const rawStatus = typeof item.status === 'string' ? item.status : '';
      if (!label) return [];
      if (
        ![
          'GREEN_CHECK',
          'RED_X',
          'YELLOW',
          'ORDERED',
          'MISSING_ITEMS',
          'COMPLETED',
          'NOT_REQUIRED',
        ].includes(rawStatus)
      ) {
        return [];
      }
      const noteOption = typeof item.noteOption === 'string' ? item.noteOption.replace(/_/g, ' ') : '';
      const noteText = typeof item.noteText === 'string' ? item.noteText.trim() : '';
      const note = [noteOption, noteText].filter(Boolean).join(' - ') || null;
      return [{
        label,
        status: rawStatus as 'GREEN_CHECK' | 'RED_X' | 'YELLOW' | 'ORDERED' | 'MISSING_ITEMS' | 'COMPLETED' | 'NOT_REQUIRED',
        note,
      }];
    })
    .filter((row) => row.status === 'RED_X' || row.status === 'YELLOW' || row.status === 'MISSING_ITEMS' || row.status === 'ORDERED')
    .slice(0, 10);
}

function projectedRevenueFromJson(value: unknown) {
  const data = submissionObject(value);
  if (!data) return null;
  const raw = data.projectedRevenue ?? data.revenue ?? data.expectedRevenue;
  if (typeof raw !== 'string' && typeof raw !== 'number') return null;
  return money(raw);
}

function leadSourceAliasKey(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function canonicalLeadBuyVendor(value: string | null) {
  if (!value) return null;
  const key = leadSourceAliasKey(value);
  if (key === 'freerateupdate' || key === 'fru') return 'FreeRateUpdate';
  if (key === 'leadpoint') return 'LeadPoint';
  if (key === 'lendingtree') return 'Lending Tree';
  return value.trim();
}

function canonicalLeadSourceLabel(value: string | null) {
  if (!value) return null;
  const trimmed = value.trim();
  const separators = [' - ', ' – ', ' — ', ': ', ' / ', ' | '];
  const leadBuyKey = leadSourceAliasKey('Lead Buy');
  for (const separator of separators) {
    const [source, ...rest] = trimmed.split(separator);
    if (rest.length && leadSourceAliasKey(source) === leadBuyKey) {
      const vendor = canonicalLeadBuyVendor(rest.join(separator).trim());
      return vendor ? `Lead Buy - ${vendor}` : 'Lead Buy';
    }
  }
  return leadSourceAliasKey(trimmed) === leadBuyKey ? 'Lead Buy' : trimmed;
}

function leadSourceFromJson(value: unknown) {
  const data = submissionObject(value);
  if (!data) return null;
  const raw = data.leadSource ?? data.lead_source;
  const vendor = data.leadVendor ?? data.lead_vendor;
  const source = typeof raw === 'string' && raw.trim() ? raw.trim() : null;
  const leadVendor = canonicalLeadBuyVendor(typeof vendor === 'string' && vendor.trim() ? vendor.trim() : null);
  if (source && leadSourceAliasKey(source) === leadSourceAliasKey('Lead Buy') && leadVendor) return `Lead Buy - ${leadVendor}`;
  if (!source && leadVendor) return `Lead Buy - ${leadVendor}`;
  return canonicalLeadSourceLabel(source);
}

function lenderFromJson(value: unknown) {
  const data = submissionObject(value);
  if (!data) return null;
  const raw =
    data.lender ??
    data.investor ??
    data.investorName ??
    data.lenderName ??
    data.productProviderName;
  return typeof raw === 'string' && raw.trim() ? raw.trim() : null;
}

function loanFileDetails(loan: {
  borrowerPhone?: string | null;
  borrowerEmail?: string | null;
  program?: string | null;
  propertyAddress?: string | null;
  stage?: string | null;
  createdAt?: Date | null;
  updatedAt?: Date | null;
}, submissionData?: unknown) {
  return {
    borrowerPhone: loan.borrowerPhone || null,
    borrowerEmail: loan.borrowerEmail || null,
    program: loan.program || null,
    propertyAddress: loan.propertyAddress || propertyAddressFromSubmission(submissionData) || null,
    stage: loan.stage || null,
    createdAt: loan.createdAt ? loan.createdAt.toISOString() : null,
    updatedAt: loan.updatedAt ? loan.updatedAt.toISOString() : null,
  };
}

function taskUpdateSignal(task: {
  kind: TaskKind | null;
  status: string;
  workflowState?: string | null;
  completedAt?: Date | null;
}) {
  const canNotifyLoanOfficer =
    task.kind === TaskKind.SUBMIT_DISCLOSURES ||
    task.kind === TaskKind.SUBMIT_PROCESSING ||
    task.kind === TaskKind.SUBMIT_QC;
  if (!canNotifyLoanOfficer) return null;

  if (
    task.workflowState === 'WAITING_ON_LO' ||
    task.workflowState === 'WAITING_ON_LO_APPROVAL' ||
    task.workflowState === 'READY_TO_COMPLETE' ||
    task.status === 'BLOCKED'
  ) {
    return { label: 'Action needed', tone: 'danger' as const };
  }
  if (task.completedAt || task.status === 'COMPLETED') {
    return { label: 'New update', tone: 'danger' as const };
  }
  if (task.status === 'IN_PROGRESS') {
    return { label: 'In progress', tone: 'info' as const };
  }
  return null;
}

function taskQueueStage(task: {
  status: string;
  workflowState?: string | null;
  completedAt?: Date | null;
}): NonNullable<PipelineMilestoneRow['fileDetails']['task']>['queueStage'] {
  if (task.workflowState === 'WAITING_ON_LO') {
    return {
      label: 'Waiting on Loan Officer',
      description: 'The Tasks queue is waiting for missing or incomplete items from the loan officer.',
      tone: 'danger',
    };
  }
  if (task.workflowState === 'WAITING_ON_LO_APPROVAL') {
    return {
      label: 'Waiting on LO Approval',
      description: 'The request is ready for the loan officer to review and approve in Tasks.',
      tone: 'danger',
    };
  }
  if (task.workflowState === 'READY_TO_COMPLETE') {
    return {
      label: 'Returned to Specialist',
      description: 'The loan officer response was received and the assigned team can complete the request.',
      tone: 'info',
    };
  }
  if (task.completedAt || task.status === 'COMPLETED') {
    return {
      label: 'Completed in Tasks',
      description: 'This request was completed by the assigned team. Open the task to review final details or history.',
      tone: 'success',
    };
  }
  if (task.status === 'IN_PROGRESS') {
    return {
      label: 'In Progress',
      description: 'The assigned team has started working this request in the Tasks queue.',
      tone: 'info',
    };
  }
  if (task.status === 'BLOCKED') {
    return {
      label: 'Blocked / Needs Attention',
      description: 'The request is blocked in Tasks and likely needs a response before it can move forward.',
      tone: 'danger',
    };
  }
  return {
    label: 'New Request in Queue',
    description: 'The request has been submitted and is waiting in the assigned Tasks queue.',
    tone: 'neutral',
  };
}

function fundingUpdateSignal(status: string) {
  if (status === PayrollCompRequestStatus.REJECTED) return { label: 'Revision needed', tone: 'danger' as const };
  if (status === PayrollCompRequestStatus.APPROVED) return { label: 'Payroll approved', tone: 'danger' as const };
  if (status === PayrollCompRequestStatus.PAID) return { label: 'Payroll paid', tone: 'danger' as const };
  return null;
}

function taskKindToMilestone(kind: TaskKind | null): PipelineMilestoneKey | null {
  if (kind === TaskKind.SUBMIT_PLUS_ONE) return 'plusOne';
  if (kind === TaskKind.SUBMIT_DISCLOSURES) return 'disclosures';
  if (kind === TaskKind.SUBMIT_PROCESSING || kind === TaskKind.SUBMIT_QC) return 'processing';
  return null;
}

function loanOfficerLoanWhere(loanOfficerId: string): Prisma.LoanWhereInput {
  return { OR: buildLoanOfficerLoanOrClauses(loanOfficerId) };
}

function taskScopeWhere(loanOfficerId: string | 'all'): Prisma.TaskWhereInput {
  if (loanOfficerId === 'all') return {};
  return { loan: loanOfficerLoanWhere(loanOfficerId) };
}

function payrollScopeWhere(loanOfficerId: string | 'all'): Prisma.PayrollCompRequestWhereInput {
  if (loanOfficerId === 'all') return {};
  return {
    OR: [
      { loanOfficerId },
      {
        loan: loanOfficerLoanWhere(loanOfficerId),
      },
    ],
  };
}

function fundingDateWhere(start: Date, end: Date): Prisma.PayrollCompRequestWhereInput {
  return {
    status: PayrollCompRequestStatus.PAID,
    OR: [
      { paidAt: { gte: start, lte: end } },
      {
        paidAt: null,
        submittedAt: { gte: start, lte: end },
      },
    ],
  };
}

function trendDateLabel(date: Date) {
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' }).format(date);
}

function weeklyTrendLabel(start: Date, end: Date) {
  return `${trendDateLabel(start)} - ${trendDateLabel(end)}`;
}

function trendGranularityForPreset(preset: PipelineRangePreset): PipelineTrendGranularity {
  if (preset === 'daily') return 'daily';
  if (preset === 'weekly') return 'weekly';
  return 'monthly';
}

function buildTrendBuckets(
  start: Date,
  end: Date,
  granularity: PipelineTrendGranularity
): PipelineTrendBucket[] {
  const buckets: PipelineTrendBucket[] = [];
  const cursor = startOfDay(start);

  while (cursor <= end) {
    const bucketStart = new Date(cursor);
    const bucketEnd = new Date(bucketStart);
    if (granularity === 'weekly') bucketEnd.setDate(bucketEnd.getDate() + 6);
    if (granularity === 'monthly') bucketEnd.setMonth(bucketEnd.getMonth() + 1, 0);
    const cappedBucketEnd = endOfDay(bucketEnd > end ? end : bucketEnd);
    buckets.push({
      label:
        granularity === 'daily'
          ? trendDateLabel(bucketStart)
          : granularity === 'monthly'
          ? new Intl.DateTimeFormat('en-US', { month: 'short', year: 'numeric' }).format(bucketStart)
          : weeklyTrendLabel(bucketStart, cappedBucketEnd),
      startDate: bucketStart.toISOString(),
      plusOne: 0,
      disclosures: 0,
      processing: 0,
      fundings: 0,
    });

    if (granularity === 'monthly') cursor.setMonth(cursor.getMonth() + 1, 1);
    else cursor.setDate(cursor.getDate() + (granularity === 'daily' ? 1 : 7));
  }

  return buckets;
}

function incrementTrend(
  buckets: PipelineTrendBucket[],
  occurredAt: Date,
  milestone: PipelineMilestoneKey
) {
  for (let index = buckets.length - 1; index >= 0; index -= 1) {
    if (occurredAt >= new Date(buckets[index].startDate)) {
      buckets[index][milestone] += 1;
      return;
    }
  }
}

function createSummary(totals: Record<PipelineMilestoneKey, number>) {
  return [
    {
      key: 'plusOne' as const,
      label: MILESTONE_LABELS.plusOne,
      count: totals.plusOne,
      priorCount: null,
      conversionRate: null,
    },
    {
      key: 'disclosures' as const,
      label: MILESTONE_LABELS.disclosures,
      count: totals.disclosures,
      priorCount: totals.plusOne,
      conversionRate: percent(totals.disclosures, totals.plusOne),
    },
    {
      key: 'processing' as const,
      label: MILESTONE_LABELS.processing,
      count: totals.processing,
      priorCount: totals.disclosures,
      conversionRate: percent(totals.processing, totals.disclosures),
    },
    {
      key: 'fundings' as const,
      label: MILESTONE_LABELS.fundings,
      count: totals.fundings,
      priorCount: totals.processing,
      conversionRate: percent(totals.fundings, totals.processing),
    },
  ];
}

function createBoardMetrics(
  taskRows: Array<{
    kind: TaskKind | null;
    submissionData: unknown;
    loan: { amount: Prisma.Decimal | number | string | null };
  }>,
  fundingRows: Array<{
    expectedRevenue: Prisma.Decimal | number | string | null;
    loan: { amount: Prisma.Decimal | number | string | null } | null;
  }>
): PipelineBoardStageMetrics {
  return taskRows.reduce<PipelineBoardStageMetrics>(
    (metrics, task) => {
      const amount = money(task.loan.amount) || 0;
      if (task.kind === TaskKind.SUBMIT_PLUS_ONE) {
        metrics.plusOne.volumeTotal += amount;
        metrics.plusOne.revenueTotal += projectedRevenueFromJson(task.submissionData) || 0;
      } else if (task.kind === TaskKind.SUBMIT_DISCLOSURES) {
        metrics.disclosures.volumeTotal += amount;
        metrics.disclosures.units += 1;
      } else if (task.kind === TaskKind.SUBMIT_PROCESSING || task.kind === TaskKind.SUBMIT_QC) {
        metrics.processing.volumeTotal += amount;
        metrics.processing.revenueTotal += projectedRevenueFromJson(task.submissionData) || 0;
      }
      return metrics;
    },
    fundingRows.reduce<PipelineBoardStageMetrics>(
      (metrics, funding) => {
        metrics.fundings.volumeTotal += money(funding.loan?.amount) || 0;
        metrics.fundings.revenueTotal += money(funding.expectedRevenue) || 0;
        return metrics;
      },
      {
        plusOne: { volumeTotal: 0, revenueTotal: 0 },
        disclosures: { volumeTotal: 0, units: 0 },
        processing: { volumeTotal: 0, revenueTotal: 0 },
        fundings: { volumeTotal: 0, revenueTotal: 0 },
      }
    )
  );
}

function uniqueLoanOfficerIds(loan: {
  loanOfficerId: string;
  secondaryLoanOfficerId?: string | null;
}) {
  return Array.from(new Set([loan.loanOfficerId, loan.secondaryLoanOfficerId].filter(Boolean))) as string[];
}

function sharedLoanOfficerNames(loan: {
  loanOfficer: { name: string };
  secondaryLoanOfficer?: { name: string } | null;
}) {
  return Array.from(
    new Set([loan.loanOfficer.name, loan.secondaryLoanOfficer?.name].filter(Boolean))
  ) as string[];
}

function buildPipelineGroupRows(
  rows: PipelineMilestoneRow[],
  groupBy: 'lender' | 'leadSource'
): PipelineGroupRow[] {
  const groups = new Map<string, PipelineGroupRow>();
  for (const row of rows) {
    const rawLabel = groupBy === 'lender' ? row.lender : row.leadSource;
    const label = groupBy === 'leadSource'
      ? canonicalLeadSourceLabel(rawLabel?.trim() || null) || 'Unknown Lead Source'
      : rawLabel?.trim() || 'Unknown Lender';
    const key = groupBy === 'leadSource'
      ? leadSourceAliasKey(label)
      : label.toLowerCase();
    const group =
      groups.get(key) ??
      {
        key,
        label,
        totalCount: 0,
        volumeTotal: 0,
        revenueTotal: 0,
        plusOne: 0,
        disclosures: 0,
        processing: 0,
        fundings: 0,
        latestActivityAt: null,
      };

    group.totalCount += 1;
    group[row.milestone] += 1;
    group.volumeTotal += row.amount || 0;
    group.revenueTotal += row.revenue || 0;
    if (
      !group.latestActivityAt ||
      new Date(row.occurredAt).getTime() > new Date(group.latestActivityAt).getTime()
    ) {
      group.latestActivityAt = row.occurredAt;
    }
    groups.set(key, group);
  }

  return Array.from(groups.values()).sort(
    (a, b) =>
      b.volumeTotal - a.volumeTotal ||
      b.totalCount - a.totalCount ||
      a.label.localeCompare(b.label)
  );
}

export async function getPipelineReport(filters: PipelineReportFilters = {}): Promise<PipelineReport> {
  const actor = await assertPipelineActor();
  const canViewAll = actor.role === UserRole.MANAGER || isAdmin(actor.role);
  const { preset, start, end } = resolveDateRange(filters);
  const {
    preset: trendPreset,
    start: trendStart,
    end: trendEnd,
  } = resolveDateRange({
    preset: filters.trendPreset || 'weekly',
    startDate: filters.trendStartDate,
    endDate: filters.trendEndDate,
  });
  const trendGranularity = trendGranularityForPreset(trendPreset);
  const loanOfficers = canViewAll
    ? await prisma.user.findMany({
        where: {
          active: true,
          OR: [{ role: UserRole.LOAN_OFFICER }, { roles: { has: UserRole.LOAN_OFFICER } }],
        },
        select: { id: true, name: true, email: true },
        orderBy: { name: 'asc' },
      })
    : await prisma.user.findMany({
        where: { id: actor.userId },
        select: { id: true, name: true, email: true },
      });

  const requestedOfficer = filters.loanOfficerId || 'all';
  const selectedLoanOfficerId =
    canViewAll && requestedOfficer !== 'all'
      ? loanOfficers.some((officer) => officer.id === requestedOfficer)
        ? requestedOfficer
        : 'all'
      : canViewAll
        ? 'all'
        : actor.userId;

  const dateWhere = { createdAt: { gte: start, lte: end } };
  const trendDateWhere = { createdAt: { gte: trendStart, lte: trendEnd } };
  const scopedTaskWhere = taskScopeWhere(selectedLoanOfficerId);
  const scopedPayrollWhere = payrollScopeWhere(selectedLoanOfficerId);

  const [
    plusOne,
    disclosures,
    processing,
    fundings,
    taskRows,
    fundingRows,
    trendTaskRows,
    trendFundingRows,
    comparisonTasks,
    comparisonFundings,
  ] =
    await Promise.all([
      prisma.task.count({
        where: { ...scopedTaskWhere, kind: TaskKind.SUBMIT_PLUS_ONE, ...dateWhere },
      }),
      prisma.task.count({
        where: { ...scopedTaskWhere, kind: TaskKind.SUBMIT_DISCLOSURES, ...dateWhere },
      }),
      prisma.task.count({
        where: { ...scopedTaskWhere, kind: { in: PROCESSING_KINDS }, ...dateWhere },
      }),
      prisma.payrollCompRequest.count({
        where: { ...scopedPayrollWhere, ...fundingDateWhere(start, end) },
      }),
      prisma.task.findMany({
        where: {
          ...scopedTaskWhere,
          kind: { in: [TaskKind.SUBMIT_PLUS_ONE, TaskKind.SUBMIT_DISCLOSURES, ...PROCESSING_KINDS] },
          ...dateWhere,
        },
        select: {
          id: true,
          kind: true,
          title: true,
          status: true,
          workflowState: true,
          createdAt: true,
          completedAt: true,
          submissionData: true,
          loan: {
            select: {
              loanNumber: true,
              id: true,
              borrowerName: true,
              borrowerPhone: true,
              borrowerEmail: true,
              amount: true,
              program: true,
              propertyAddress: true,
              stage: true,
              createdAt: true,
              updatedAt: true,
              loanOfficerId: true,
              secondaryLoanOfficerId: true,
              loanOfficer: { select: { name: true } },
              secondaryLoanOfficer: { select: { name: true } },
            },
          },
        },
        orderBy: { createdAt: 'desc' },
        take: 5000,
      }),
      prisma.payrollCompRequest.findMany({
        where: { ...scopedPayrollWhere, ...fundingDateWhere(start, end) },
        select: {
          id: true,
          borrowerName: true,
          loanNumber: true,
          expectedRevenue: true,
          lender: true,
          loanType: true,
          loanChannel: true,
          processingType: true,
          status: true,
          paidAt: true,
          submittedAt: true,
          mismoDetails: true,
          loanOfficerId: true,
          loanId: true,
          loanOfficer: { select: { name: true } },
          loan: {
            select: {
              borrowerPhone: true,
              borrowerEmail: true,
              amount: true,
              program: true,
              propertyAddress: true,
              stage: true,
              createdAt: true,
              updatedAt: true,
              loanOfficerId: true,
              secondaryLoanOfficerId: true,
              loanOfficer: { select: { name: true } },
              secondaryLoanOfficer: { select: { name: true } },
            },
          },
        },
        orderBy: [{ paidAt: 'desc' }, { submittedAt: 'desc' }],
        take: 5000,
      }),
      prisma.task.findMany({
        where: {
          ...scopedTaskWhere,
          kind: { in: [TaskKind.SUBMIT_PLUS_ONE, TaskKind.SUBMIT_DISCLOSURES, ...PROCESSING_KINDS] },
          ...trendDateWhere,
        },
        select: {
          kind: true,
          createdAt: true,
        },
        take: 10000,
      }),
      prisma.payrollCompRequest.findMany({
        where: { ...scopedPayrollWhere, ...fundingDateWhere(trendStart, trendEnd) },
        select: {
          paidAt: true,
          submittedAt: true,
        },
        take: 10000,
      }),
      canViewAll
        ? prisma.task.findMany({
            where: {
              kind: { in: [TaskKind.SUBMIT_PLUS_ONE, TaskKind.SUBMIT_DISCLOSURES, ...PROCESSING_KINDS] },
              ...dateWhere,
            },
            select: {
              kind: true,
              loan: { select: { loanOfficerId: true, secondaryLoanOfficerId: true } },
            },
            take: 5000,
          })
        : Promise.resolve([]),
      canViewAll
        ? prisma.payrollCompRequest.findMany({
            where: fundingDateWhere(start, end),
            select: {
              loanOfficerId: true,
              loan: { select: { loanOfficerId: true, secondaryLoanOfficerId: true } },
            },
            take: 5000,
          })
        : Promise.resolve([]),
    ]);

  const totals = { plusOne, disclosures, processing, fundings };
  const boardMetrics = createBoardMetrics(taskRows, fundingRows);
  const trend = buildTrendBuckets(trendStart, trendEnd, trendGranularity);
  for (const task of trendTaskRows) {
    const milestone = taskKindToMilestone(task.kind);
    if (milestone) incrementTrend(trend, task.createdAt, milestone);
  }
  for (const funding of trendFundingRows) {
    incrementTrend(trend, funding.paidAt || funding.submittedAt, 'fundings');
  }

  const teamMap = new Map<string, PipelineTeamRow>();
  for (const officer of loanOfficers) {
    teamMap.set(officer.id, {
      loanOfficerId: officer.id,
      loanOfficerName: officer.name,
      plusOne: 0,
      disclosures: 0,
      processing: 0,
      fundings: 0,
      pullThroughRate: null,
    });
  }

  if (canViewAll) {
    for (const task of comparisonTasks) {
      const milestone = taskKindToMilestone(task.kind);
      if (!milestone) continue;
      for (const officerId of uniqueLoanOfficerIds(task.loan)) {
        const row = teamMap.get(officerId);
        if (row) row[milestone] += 1;
      }
    }
    for (const funding of comparisonFundings) {
      const officerIds = funding.loan
        ? uniqueLoanOfficerIds(funding.loan)
        : [funding.loanOfficerId];
      for (const officerId of officerIds) {
        const row = teamMap.get(officerId);
        if (row) row.fundings += 1;
      }
    }
  } else {
    const row = teamMap.get(actor.userId);
    if (row) {
      row.plusOne = plusOne;
      row.disclosures = disclosures;
      row.processing = processing;
      row.fundings = fundings;
    }
  }

  const teamRows = Array.from(teamMap.values())
    .map((row) => ({
      ...row,
      pullThroughRate: percent(row.fundings, row.plusOne),
    }))
    .filter((row) => row.plusOne + row.disclosures + row.processing + row.fundings > 0)
    .sort((a, b) => b.fundings - a.fundings || b.plusOne - a.plusOne || a.loanOfficerName.localeCompare(b.loanOfficerName));

  const recentTaskRows: PipelineMilestoneRow[] = taskRows.slice(0, 24).flatMap((task) => {
    const milestone = taskKindToMilestone(task.kind);
    if (!milestone) return [];
    return [
      {
        id: task.id,
        loanId: task.loan.id,
        milestone,
        milestoneLabel: MILESTONE_LABELS[milestone],
        borrowerName: task.loan.borrowerName,
        loanNumber: task.loan.loanNumber,
        loanOfficerName: task.loan.loanOfficer.name,
        sharedLoanOfficerNames: sharedLoanOfficerNames(task.loan),
        amount: money(task.loan.amount),
        revenue: projectedRevenueFromJson(task.submissionData),
        leadSource: leadSourceFromJson(task.submissionData),
        lender: lenderFromJson(task.submissionData),
        status: task.status,
        occurredAt: task.createdAt.toISOString(),
        updateSignal: taskUpdateSignal(task),
        fileDetails: {
          loan: loanFileDetails(task.loan, task.submissionData),
          task: {
            title: task.title,
            queueStage: taskQueueStage(task),
            submittedFields: submittedFieldsFromJson(task.submissionData),
            notes: parseTaskNotesFromJson(task.submissionData),
            checklistItems: checklistItemsFromJson(task.submissionData),
          },
          payroll: null,
        },
      },
    ];
  });

  const recentFundingRows: PipelineMilestoneRow[] = fundingRows.slice(0, 12).map((funding) => ({
    id: funding.id,
    loanId: funding.loanId,
    milestone: 'fundings',
    milestoneLabel: MILESTONE_LABELS.fundings,
    borrowerName: funding.borrowerName,
    loanNumber: funding.loanNumber,
    loanOfficerName: funding.loanOfficer.name,
    sharedLoanOfficerNames: funding.loan
      ? sharedLoanOfficerNames(funding.loan)
      : [funding.loanOfficer.name],
    amount: money(funding.expectedRevenue),
  revenue: money(funding.expectedRevenue),
  leadSource: null,
    lender: funding.lender,
    status: funding.status,
    occurredAt: (funding.paidAt || funding.submittedAt).toISOString(),
    updateSignal: fundingUpdateSignal(funding.status),
    fileDetails: {
      loan: funding.loan
        ? loanFileDetails(funding.loan, funding.mismoDetails)
        : {
            borrowerPhone: null,
            borrowerEmail: null,
            program: null,
            propertyAddress: null,
            stage: null,
            createdAt: null,
            updatedAt: null,
          },
      task: null,
      payroll: {
        loanType: funding.loanType,
        lender: funding.lender,
        loanChannel: funding.loanChannel,
        processingType: funding.processingType,
        expectedRevenue: money(funding.expectedRevenue),
        submittedAt: funding.submittedAt.toISOString(),
        paidAt: funding.paidAt ? funding.paidAt.toISOString() : null,
      },
    },
  }));

  const recentRows = [...recentTaskRows, ...recentFundingRows]
    .sort((a, b) => new Date(b.occurredAt).getTime() - new Date(a.occurredAt).getTime())
    .slice(0, 24);
  const allTaskRows: PipelineMilestoneRow[] = taskRows.flatMap((task) => {
    const milestone = taskKindToMilestone(task.kind);
    if (!milestone) return [];
    return [
      {
        id: task.id,
        loanId: task.loan.id,
        milestone,
        milestoneLabel: MILESTONE_LABELS[milestone],
        borrowerName: task.loan.borrowerName,
        loanNumber: task.loan.loanNumber,
        loanOfficerName: task.loan.loanOfficer.name,
        sharedLoanOfficerNames: sharedLoanOfficerNames(task.loan),
        amount: money(task.loan.amount),
        revenue: projectedRevenueFromJson(task.submissionData),
        leadSource: leadSourceFromJson(task.submissionData),
        lender: lenderFromJson(task.submissionData),
        status: task.status,
        occurredAt: task.createdAt.toISOString(),
        updateSignal: taskUpdateSignal(task),
        fileDetails: {
          loan: loanFileDetails(task.loan, task.submissionData),
          task: {
            title: task.title,
            queueStage: taskQueueStage(task),
            submittedFields: submittedFieldsFromJson(task.submissionData),
            notes: parseTaskNotesFromJson(task.submissionData),
            checklistItems: checklistItemsFromJson(task.submissionData),
          },
          payroll: null,
        },
      },
    ];
  });
  const allFundingRows: PipelineMilestoneRow[] = fundingRows.map((funding) => ({
    id: funding.id,
    loanId: funding.loanId,
    milestone: 'fundings',
    milestoneLabel: MILESTONE_LABELS.fundings,
    borrowerName: funding.borrowerName,
    loanNumber: funding.loanNumber,
    loanOfficerName: funding.loanOfficer.name,
    sharedLoanOfficerNames: funding.loan
      ? sharedLoanOfficerNames(funding.loan)
      : [funding.loanOfficer.name],
    amount: money(funding.expectedRevenue),
  revenue: money(funding.expectedRevenue),
  leadSource: null,
    lender: funding.lender,
    status: funding.status,
    occurredAt: (funding.paidAt || funding.submittedAt).toISOString(),
    updateSignal: fundingUpdateSignal(funding.status),
    fileDetails: {
      loan: funding.loan
        ? loanFileDetails(funding.loan, funding.mismoDetails)
        : {
            borrowerPhone: null,
            borrowerEmail: null,
            program: null,
            propertyAddress: null,
            stage: null,
            createdAt: null,
            updatedAt: null,
          },
      task: null,
      payroll: {
        loanType: funding.loanType,
        lender: funding.lender,
        loanChannel: funding.loanChannel,
        processingType: funding.processingType,
        expectedRevenue: money(funding.expectedRevenue),
        submittedAt: funding.submittedAt.toISOString(),
        paidAt: funding.paidAt ? funding.paidAt.toISOString() : null,
      },
    },
  }));
  const bucketRows = {
    plusOne: allTaskRows.filter((row) => row.milestone === 'plusOne').slice(0, 100),
    disclosures: allTaskRows.filter((row) => row.milestone === 'disclosures').slice(0, 100),
    processing: allTaskRows.filter((row) => row.milestone === 'processing').slice(0, 100),
    fundings: allFundingRows.slice(0, 100),
  };
  const allPipelineRows = [...allTaskRows, ...allFundingRows];

  return {
    filters: {
      preset,
      startDate: start.toISOString(),
      endDate: end.toISOString(),
      loanOfficerId: selectedLoanOfficerId,
      trendPreset,
      trendStartDate: trendStart.toISOString(),
      trendEndDate: trendEnd.toISOString(),
    },
    canViewAll,
    loanOfficers,
    summary: createSummary(totals),
    totals,
    pullThroughRate: percent(fundings, plusOne),
    boardMetrics,
    trend,
    teamRows,
    lenderRows: buildPipelineGroupRows(allPipelineRows, 'lender'),
    leadSourceRows: buildPipelineGroupRows(allPipelineRows, 'leadSource'),
    recentRows,
    bucketRows,
  };
}
