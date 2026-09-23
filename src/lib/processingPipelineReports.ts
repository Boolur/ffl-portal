import {
  Prisma,
  ProcessingItemStatus,
  ProcessingPipelineSheet,
  ProcessingPipelineStatus,
  UserRole,
} from '@prisma/client';
import { isAdmin } from './adminTiers';
import {
  buildProcessingPipelineScopeWhere,
  type ProcessingPipelineScopeActor,
} from './processingPipeline';

export const PROCESSING_REPORT_ROLES = new Set<UserRole>([
  UserRole.PROCESSOR_JR,
  UserRole.PROCESSOR_SR,
  UserRole.MANAGER,
  UserRole.PROCESSING_MANAGER,
  UserRole.ADMIN,
  UserRole.ADMIN_I,
  UserRole.ADMIN_II,
  UserRole.ADMIN_III,
]);

export const PROCESSING_REPORT_STATUSES = [
  ProcessingPipelineStatus.SUBBED_TO_UW,
  ProcessingPipelineStatus.APPROVED_WITH_CONDITIONS,
  ProcessingPipelineStatus.RE_SUB,
  ProcessingPipelineStatus.CTC,
  ProcessingPipelineStatus.DOCS_OUT,
  ProcessingPipelineStatus.SUSPENDED,
  ProcessingPipelineStatus.SUSPENDED_RESTRUCTURE,
  ProcessingPipelineStatus.ADVERSE_PENDING,
  ProcessingPipelineStatus.PENDING_APPROVAL,
] as const;

export type ProcessingReportType =
  | 'LAST_TOUCH'
  | 'PIPELINE_STATUS'
  | 'SERVICES'
  | 'FUNDING';

export type ProcessingReportAudit = {
  action: string;
  details: string | null;
  createdAt: Date | string;
  actor: string;
};

export type ProcessingServiceKey =
  | 'title'
  | 'hoi'
  | 'appraisal'
  | 'payoff';

export type ProcessingServiceActivity = {
  at: string;
  age: string;
  source: 'AUDIT' | 'INITIAL';
};

const FIELD_LABELS: Record<string, string> = {
  pipelineStatus: 'Pipeline Status',
  titleStatus: 'Title Status',
  payoffStatus: 'Payoff Status',
  payoffExpiresAt: 'Payoff Expiration',
  hoiStatus: 'HOI Status',
  appraisalNeeded: 'Appraisal Needed',
  appraisalNotes: 'Appraisal Notes',
  appraisalOrderedAt: 'Appraisal Ordered',
  appraisalScheduledAt: 'Appraisal Scheduled',
  appraisalBackAt: 'Appraisal Back',
  cdSent: 'CD Sent',
  rateLock: 'Rate Lock',
  rateLockExpiresAt: 'Rate Lock Expiration',
  missingItemsCurrentStatus: 'Pending Items',
  extraNotes: 'Extra Notes',
  lender: 'Lender',
  propertyState: 'State',
  finalRevenue: 'Final Revenue',
  juniorProcessorId: 'Jr Processor',
  seniorProcessorId: 'Sr Processor',
};

const ACTION_LABELS: Record<string, string> = {
  PROCESSING_PIPELINE_CREATED: 'Pipeline record created',
  PROCESSING_PIPELINE_REFRESHED: 'Pipeline record refreshed',
  PROCESSING_PIPELINE_MOVED: 'Pipeline bucket changed',
  PROCESSING_RESTRUCTURE_REQUEST_ADVERSE: 'Adverse requested',
  PROCESSING_RESTRUCTURE_SEND_TO_UNDERWRITING: 'Sent to underwriting',
  PROCESSING_RATE_LOCK_REQUESTED: 'Rate Lock requested',
  PROCESSING_RATE_LOCK_REQUEST_FULFILLED: 'Rate Lock request fulfilled',
  PROCESSING_RATE_LOCK_REQUEST_DISMISSED: 'Rate Lock request dismissed',
  PROCESSING_PIPELINE_RATE_LOCK_CHANGED: 'Rate Lock changed',
  PROCESSING_PIPELINE_JR_PROCESSOR_REASSIGNED: 'Jr Processor reassigned',
  PROCESSING_PIPELINE_SR_PROCESSOR_REASSIGNED: 'Sr Processor reassigned',
  PROCESSING_BORROWER_DETAILS_UPDATED: 'Borrower details updated',
  PROCESSING_PIPELINE_PAYROLL_REVENUE_SYNCED: 'Final Revenue synced from payroll',
  PROCESSING_PIPELINE_FUNDING_CORRECTED: 'Funding status corrected',
};

const SERVICE_FIELDS: Record<ProcessingServiceKey, Set<string>> = {
  title: new Set(['titleStatus']),
  hoi: new Set(['hoiStatus']),
  appraisal: new Set([
    'appraisalNeeded',
    'appraisalNotes',
    'appraisalOrderedAt',
    'appraisalScheduledAt',
    'appraisalBackAt',
  ]),
  payoff: new Set(['payoffStatus', 'payoffExpiresAt']),
};

function parseAuditDetails(details: string | null): Record<string, unknown> {
  if (!details) return {};
  try {
    const parsed = JSON.parse(details);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {};
  } catch {
    return {};
  }
}

function displayAuditValue(value: unknown) {
  if (value === null || value === undefined || value === '') return 'blank';
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  const raw = String(value);
  const labels: Record<string, string> = {
    NOT_STARTED: 'Not started',
    NOT_APPLICABLE: 'N/A',
    APPROVED_WITH_CONDITIONS: 'Approved with conditions',
    SUBBED_TO_UW: 'Subbed to UW',
    RE_SUB: 'Re-sub',
    DOCS_OUT: 'Docs out',
    SUSPENDED_RESTRUCTURE: 'Suspended/Restructure',
    ADVERSE_PENDING: 'Adverse Pending',
    PENDING_APPROVAL: 'Pending Approval',
  };
  return labels[raw] || raw.replaceAll('_', ' ').toLowerCase();
}

export function canGenerateProcessingReports(role: UserRole | null | undefined) {
  return Boolean(
    role &&
      (PROCESSING_REPORT_ROLES.has(role) || isAdmin(role)),
  );
}

export function formatProcessingAuditActivity(audit: ProcessingReportAudit) {
  const details = parseAuditDetails(audit.details);
  if (
    audit.action === 'PROCESSING_PIPELINE_FIELD_CHANGED' &&
    typeof details.field === 'string'
  ) {
    const field = FIELD_LABELS[details.field] || displayAuditValue(details.field);
    return `${field}: ${displayAuditValue(details.previousValue)} → ${displayAuditValue(details.newValue)}`;
  }
  if (audit.action === 'PROCESSING_PIPELINE_MOVED') {
    return `Moved ${displayAuditValue(details.fromSheet)} → ${displayAuditValue(details.toSheet)}`;
  }
  return ACTION_LABELS[audit.action] ||
    audit.action.replace(/^PROCESSING_/, '').replaceAll('_', ' ').toLowerCase();
}

export function formatProcessingElapsed(
  value: Date | string,
  now = new Date(),
) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Unknown';
  const difference = now.getTime() - date.getTime();
  const future = difference < 0;
  const absolute = Math.abs(difference);
  const minutes = Math.floor(absolute / 60_000);
  const hours = Math.floor(absolute / 3_600_000);
  const days = Math.floor(absolute / 86_400_000);
  const amount =
    days >= 1
      ? `${days} day${days === 1 ? '' : 's'}`
      : hours >= 1
        ? `${hours} hour${hours === 1 ? '' : 's'}`
        : `${minutes} minute${minutes === 1 ? '' : 's'}`;
  return future ? `in ${amount}` : `${amount} ago`;
}

export function latestProcessingActivity(
  audits: ProcessingReportAudit[],
  fallbackAt: Date | string,
  now = new Date(),
  fallbackItem = 'Pipeline record created',
) {
  const latest = [...audits].sort(
    (left, right) =>
      new Date(right.createdAt).getTime() -
      new Date(left.createdAt).getTime(),
  )[0];
  const at = latest ? new Date(latest.createdAt) : new Date(fallbackAt);
  return {
    at: at.toISOString(),
    age: formatProcessingElapsed(at, now),
    item: latest
      ? formatProcessingAuditActivity(latest)
      : fallbackItem,
    actor: latest?.actor || 'System',
  };
}

export function latestServiceActivity(
  service: ProcessingServiceKey,
  audits: ProcessingReportAudit[],
  fallbackAt: Date | string,
  now = new Date(),
): ProcessingServiceActivity {
  const latest = [...audits].sort(
    (left, right) =>
      new Date(right.createdAt).getTime() -
      new Date(left.createdAt).getTime(),
  ).find((audit) => {
    const details = parseAuditDetails(audit.details);
    if (audit.action === 'PROCESSING_PIPELINE_FIELD_CHANGED') {
      return (
        typeof details.field === 'string' &&
        SERVICE_FIELDS[service].has(details.field)
      );
    }
    if (
      audit.action === 'PROCESSING_BORROWER_DETAILS_UPDATED' &&
      Array.isArray(details.fields)
    ) {
      return details.fields.some(
        (field) =>
          typeof field === 'string' && SERVICE_FIELDS[service].has(field),
      );
    }
    return false;
  });
  const at = new Date(latest?.createdAt || fallbackAt);
  return {
    at: at.toISOString(),
    age: formatProcessingElapsed(at, now),
    source: latest ? 'AUDIT' : 'INITIAL',
  };
}

export function remainingProcessingServices(input: {
  titleStatus: ProcessingItemStatus;
  hoiStatus: ProcessingItemStatus;
  payoffStatus: ProcessingItemStatus;
  appraisalNeeded: boolean | null;
  appraisalBackAt: Date | string | null;
}) {
  const remaining: string[] = [];
  if (
    input.titleStatus !== ProcessingItemStatus.RECEIVED &&
    input.titleStatus !== ProcessingItemStatus.NOT_APPLICABLE
  ) remaining.push('Title');
  if (
    input.hoiStatus !== ProcessingItemStatus.RECEIVED &&
    input.hoiStatus !== ProcessingItemStatus.NOT_APPLICABLE
  ) remaining.push('HOI');
  if (
    input.payoffStatus !== ProcessingItemStatus.RECEIVED &&
    input.payoffStatus !== ProcessingItemStatus.NOT_APPLICABLE
  ) remaining.push('Payoff');
  if (input.appraisalNeeded !== false && !input.appraisalBackAt) {
    remaining.push('Appraisal');
  }
  return remaining;
}

export function validateProcessingReportStatuses(values: unknown) {
  if (!Array.isArray(values) || values.length === 0) {
    return { success: false as const, error: 'Select at least one pipeline status.' };
  }
  const allowed = new Set<string>(PROCESSING_REPORT_STATUSES);
  const rawStatuses = values.map(String);
  if (rawStatuses.some((value) => !allowed.has(value))) {
    return { success: false as const, error: 'One or more pipeline statuses are invalid.' };
  }
  const statuses = Array.from(new Set(rawStatuses)) as ProcessingPipelineStatus[];
  return { success: true as const, statuses };
}

export function validateProcessingReportDateRange(
  fundedFrom: unknown,
  fundedTo: unknown,
) {
  const fromValue = String(fundedFrom ?? '').trim();
  const toValue = String(fundedTo ?? '').trim();
  const datePattern = /^\d{4}-\d{2}-\d{2}$/;
  if (!datePattern.test(fromValue) || !datePattern.test(toValue)) {
    return {
      success: false as const,
      error: 'Choose both a valid start date and end date.',
    };
  }
  const from = new Date(`${fromValue}T00:00:00.000Z`);
  const to = new Date(`${toValue}T23:59:59.999Z`);
  if (
    Number.isNaN(from.getTime()) ||
    Number.isNaN(to.getTime()) ||
    from.toISOString().slice(0, 10) !== fromValue ||
    to.toISOString().slice(0, 10) !== toValue
  ) {
    return {
      success: false as const,
      error: 'Choose both a valid start date and end date.',
    };
  }
  if (from.getTime() > to.getTime()) {
    return {
      success: false as const,
      error: 'The funding start date must be on or before the end date.',
    };
  }
  return {
    success: true as const,
    from,
    to,
    fundedFrom: fromValue,
    fundedTo: toValue,
  };
}

function processingTeamScopeWhere(
  teamLoanOfficerIds: string[],
): Prisma.ProcessingPipelineLoanWhereInput | null {
  if (teamLoanOfficerIds.length === 0) return null;
  return {
    loan: {
      OR: [
        {
          secondaryLoanOfficerId: {
            in: teamLoanOfficerIds,
          },
        },
        {
          AND: [
            { secondaryLoanOfficerId: null },
            { loanOfficerId: { in: teamLoanOfficerIds } },
          ],
        },
      ],
    },
  };
}

export function buildProcessingReportWhere(
  actor: ProcessingPipelineScopeActor,
  teamLoanOfficerIds: string[] = [],
  statuses: ProcessingPipelineStatus[] = [],
): Prisma.ProcessingPipelineLoanWhereInput {
  const teamScope = processingTeamScopeWhere(teamLoanOfficerIds);
  return {
    AND: [
      buildProcessingPipelineScopeWhere(actor),
      {
        sheet: {
          in: [
            ProcessingPipelineSheet.PIPELINE,
            ProcessingPipelineSheet.RESTRUCTURE,
          ],
        },
      },
      ...(teamScope ? [teamScope] : []),
      ...(statuses.length
        ? [{ pipelineStatus: { in: statuses } }]
        : []),
    ],
  };
}

export function buildProcessingFundingReportWhere(
  actor: ProcessingPipelineScopeActor,
  teamLoanOfficerIds: string[],
  fundedFrom: Date,
  fundedTo: Date,
): Prisma.ProcessingPipelineLoanWhereInput {
  const teamScope = processingTeamScopeWhere(teamLoanOfficerIds);
  return {
    AND: [
      buildProcessingPipelineScopeWhere(actor),
      ...(teamScope ? [teamScope] : []),
      {
        sheet: ProcessingPipelineSheet.FUNDING,
        pipelineStatus: ProcessingPipelineStatus.FUNDED,
        fundedAt: {
          not: null,
          gte: fundedFrom,
          lte: fundedTo,
        },
      },
    ],
  };
}
