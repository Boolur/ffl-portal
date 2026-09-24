'use server';

import { unstable_noStore as noStore } from 'next/cache';
import { getServerSession } from 'next-auth';
import {
  Prisma,
  ProcessingPipelineSheet,
  ProcessingPipelineStatus,
  UserRole,
} from '@prisma/client';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { splitBorrowerName } from '@/lib/processingBorrowerDetails';
import {
  calculateDaysInStatus,
  getPayoffExpirationWarning,
  isAppraisalBackOverdue,
  isConditionItemOverdue,
  isOrderedItemOverdue,
} from '@/lib/processingPipeline';
import {
  buildProcessingFundingReportWhere,
  buildProcessingReportWhere,
  canGenerateProcessingReports,
  latestProcessingActivity,
  latestServiceActivity,
  remainingProcessingServices,
  type ProcessingReportAudit,
  type ProcessingReportType,
  validateProcessingReportDateRange,
  validateProcessingReportStatuses,
} from '@/lib/processingPipelineReports';

export type ProcessingReportCommonRow = {
  pipelineLoanId: string;
  bucket: 'Pipeline' | 'Restructures';
  rateLockRequested: boolean;
  assignmentDate: string;
  loanNumber: string;
  borrowerName: string;
  loanOfficer: string;
  juniorProcessor: string;
  seniorProcessor: string;
  state: string;
  lender: string;
  loanType: string;
  pipelineStatus: ProcessingPipelineStatus;
  statusChangedAt: string;
  daysInStatus: number;
  pendingItems: string;
};

export type ProcessingLastTouchRow = ProcessingReportCommonRow & {
  lastChangedItem: string;
  lastChangedBy: string;
  lastTouchedAt: string;
  lastTouchedAge: string;
};

export type ProcessingStatusReportRow = ProcessingReportCommonRow & {
  borrowerFirstName: string;
  borrowerLastName: string;
  leadSource: string | null;
  loanAmount: number | null;
  restructureNotes: string;
  titleStatus: string;
  hoiStatus: string;
  appraisalNeeded: string;
  payoffStatus: string;
  payoffExpiresAt: string | null;
  appraisalNotes: string;
  appraisalOrderedAt: string | null;
  appraisalScheduledAt: string | null;
  appraisalBackAt: string | null;
  cdSent: string;
  estimatedSigningAt: string | null;
  extraNotes: string;
  rateLock: string;
  projectedRevenue: number | null;
  finalRevenue: number | null;
};

export type ProcessingFundingReportRow = {
  pipelineLoanId: string;
  assignmentDate: string;
  loanNumber: string;
  loanOfficer: string;
  borrowerName: string;
  leadSource: string;
  state: string;
  loanType: string;
  lender: string;
  juniorProcessor: string;
  seniorProcessor: string;
  fundedAt: string;
  finalRevenue: number | null;
  firstPaymentAt: string | null;
  sixthPaymentAt: string | null;
};

export type ProcessingServicesReportRow = ProcessingReportCommonRow & {
  titleStatus: string;
  titleLastUpdatedAt: string;
  titleAge: string;
  titleUpdateSource: string;
  titleSla: string;
  hoiStatus: string;
  hoiOrderedAt: string | null;
  hoiLastUpdatedAt: string;
  hoiAge: string;
  hoiUpdateSource: string;
  hoiSla: string;
  appraisalNeeded: string;
  appraisalOrderedAt: string | null;
  appraisalScheduledAt: string | null;
  appraisalBackAt: string | null;
  appraisalLastUpdatedAt: string;
  appraisalAge: string;
  appraisalUpdateSource: string;
  appraisalSla: string;
  payoffStatus: string;
  payoffOrderedAt: string | null;
  payoffExpiresAt: string | null;
  payoffLastUpdatedAt: string;
  payoffAge: string;
  payoffUpdateSource: string;
  payoffSla: string;
  remainingServices: string;
};

export type ProcessingPipelineReport =
  | {
      type: 'LAST_TOUCH';
      generatedAt: string;
      rows: ProcessingLastTouchRow[];
    }
  | {
      type: 'PIPELINE_STATUS';
      generatedAt: string;
      selectedStatuses: ProcessingPipelineStatus[];
      includesRestrictedColumns: boolean;
      rows: ProcessingStatusReportRow[];
    }
  | {
      type: 'SERVICES';
      generatedAt: string;
      rows: ProcessingServicesReportRow[];
    }
  | {
      type: 'FUNDING';
      generatedAt: string;
      fundedFrom: string;
      fundedTo: string;
      rows: ProcessingFundingReportRow[];
    };

type ReportActor = {
  id: string;
  role: UserRole;
  processingAssignmentGroups: string[];
};

async function getReportActor(): Promise<ReportActor | null> {
  const session = await getServerSession(authOptions);
  const id = session?.user?.id;
  const role = (session?.user?.activeRole || session?.user?.role) as
    | UserRole
    | undefined;
  if (!id || !role || !canGenerateProcessingReports(role)) return null;
  const user = await prisma.user.findUnique({
    where: { id },
    select: { active: true, processingAssignmentGroups: true },
  });
  if (!user?.active) return null;
  return { id, role, processingAssignmentGroups: user.processingAssignmentGroups };
}

function iso(value: Date | null) {
  return value?.toISOString() || null;
}

function commonRow(row: ReportQueryRow): ProcessingReportCommonRow {
  return {
    pipelineLoanId: row.id,
    bucket:
      row.sheet === ProcessingPipelineSheet.RESTRUCTURE
        ? 'Restructures'
        : 'Pipeline',
    rateLockRequested: Boolean(row.rateLockRequestedAt),
    assignmentDate: row.dateAssigned.toISOString(),
    loanNumber: row.loan.loanNumber,
    borrowerName: row.loan.borrowerName,
    loanOfficer:
      row.loan.secondaryLoanOfficer?.name || row.loan.loanOfficer.name,
    juniorProcessor: row.juniorProcessor?.name || 'Unassigned',
    seniorProcessor: row.seniorProcessor?.name || 'Unassigned',
    state: row.propertyState || '',
    lender: row.lender || '',
    loanType: row.loanType || '',
    pipelineStatus: row.pipelineStatus,
    statusChangedAt: row.statusChangedAt.toISOString(),
    daysInStatus: calculateDaysInStatus(row.statusChangedAt),
    pendingItems: row.missingItemsCurrentStatus || '',
  };
}

const reportRowSelect = {
  id: true,
  loanId: true,
  sheet: true,
  pipelineStatus: true,
  statusChangedAt: true,
  estimatedSigningAt: true,
  dateAssigned: true,
  titleStatus: true,
  payoffStatus: true,
  payoffOrderedAt: true,
  payoffExpiresAt: true,
  hoiStatus: true,
  hoiOrderedAt: true,
  appraisalNeeded: true,
  appraisalNotes: true,
  appraisalOrderedAt: true,
  appraisalScheduledAt: true,
  appraisalBackAt: true,
  approvedWithConditionsAt: true,
  rateLockRequestedAt: true,
  cdSent: true,
  missingItemsCurrentStatus: true,
  extraNotes: true,
  restructureNotes: true,
  rateLock: true,
  propertyState: true,
  lender: true,
  loanType: true,
  leadSource: true,
  fundedAt: true,
  finalRevenue: true,
  projectedRevenue: true,
  firstPaymentAt: true,
  sixthPaymentAt: true,
  createdAt: true,
  updatedAt: true,
  loan: {
    select: {
      loanNumber: true,
      borrowerName: true,
      borrowerFirstName: true,
      borrowerLastName: true,
      amount: true,
      loanOfficer: { select: { name: true } },
      secondaryLoanOfficer: { select: { name: true } },
    },
  },
  juniorProcessor: { select: { name: true } },
  seniorProcessor: { select: { name: true } },
} satisfies Prisma.ProcessingPipelineLoanSelect;

type ReportQueryRow = Prisma.ProcessingPipelineLoanGetPayload<{
  select: typeof reportRowSelect;
}>;

export async function getProcessingPipelineReport(input: {
  type: ProcessingReportType;
  statuses?: ProcessingPipelineStatus[];
  teamLoanOfficerIds?: string[];
  fundedFrom?: string;
  fundedTo?: string;
}) {
  noStore();
  const actor = await getReportActor();
  if (!actor) {
    return { success: false as const, error: 'Not authorized to generate processing reports.' };
  }
  if (!['LAST_TOUCH', 'PIPELINE_STATUS', 'SERVICES', 'FUNDING'].includes(input.type)) {
    return { success: false as const, error: 'Invalid processing report type.' };
  }

  let selectedStatuses: ProcessingPipelineStatus[] | undefined;
  let fundingRange:
    | Extract<
        ReturnType<typeof validateProcessingReportDateRange>,
        { success: true }
      >
    | undefined;
  if (input.type === 'PIPELINE_STATUS') {
    const validation = validateProcessingReportStatuses(input.statuses);
    if (!validation.success) return validation;
    selectedStatuses = validation.statuses;
  }
  if (input.type === 'FUNDING') {
    const validation = validateProcessingReportDateRange(
      input.fundedFrom,
      input.fundedTo,
    );
    if (!validation.success) return validation;
    fundingRange = validation;
  }
  const teamLoanOfficerIds = Array.from(
    new Set((input.teamLoanOfficerIds || []).map(String).filter(Boolean)),
  ).slice(0, 500);
  const where =
    input.type === 'FUNDING' && fundingRange
      ? buildProcessingFundingReportWhere(
          actor,
          teamLoanOfficerIds,
          fundingRange.from,
          fundingRange.to,
        )
      : buildProcessingReportWhere(
          actor,
          teamLoanOfficerIds,
          selectedStatuses,
        );

  const rows = await prisma.processingPipelineLoan.findMany({
    where,
    select: reportRowSelect,
    orderBy:
      input.type === 'FUNDING'
        ? [{ fundedAt: 'desc' }, { loan: { borrowerName: 'asc' } }]
        : [{ dateAssigned: 'asc' }, { loan: { borrowerName: 'asc' } }],
  });
  const generatedAt = new Date();
  if (input.type === 'FUNDING' && fundingRange) {
    const report: ProcessingPipelineReport = {
      type: 'FUNDING',
      generatedAt: generatedAt.toISOString(),
      fundedFrom: fundingRange.fundedFrom,
      fundedTo: fundingRange.fundedTo,
      rows: rows.flatMap((row) =>
        row.fundedAt
          ? [{
              pipelineLoanId: row.id,
              assignmentDate: row.dateAssigned.toISOString(),
              loanNumber: row.loan.loanNumber,
              loanOfficer:
                row.loan.secondaryLoanOfficer?.name ||
                row.loan.loanOfficer.name,
              borrowerName: row.loan.borrowerName,
              leadSource: row.leadSource || '',
              state: row.propertyState || '',
              loanType: row.loanType || '',
              lender: row.lender || '',
              juniorProcessor: row.juniorProcessor?.name || 'Unassigned',
              seniorProcessor: row.seniorProcessor?.name || 'Unassigned',
              fundedAt: row.fundedAt.toISOString(),
              finalRevenue:
                row.finalRevenue === null ? null : Number(row.finalRevenue),
              firstPaymentAt: iso(row.firstPaymentAt),
              sixthPaymentAt: iso(row.sixthPaymentAt),
            }]
          : [],
      ),
    };
    return { success: true as const, report };
  }
  const pipelineIdByLoanId = new Map(
    rows.map((row) => [row.loanId, row.id]),
  );
  const audits = rows.length
    ? await prisma.auditLog.findMany({
        where: {
          loanId: { in: rows.map((row) => row.loanId) },
          action: { startsWith: 'PROCESSING_' },
        },
        orderBy: { createdAt: 'desc' },
        select: {
          loanId: true,
          action: true,
          details: true,
          createdAt: true,
          user: { select: { name: true } },
        },
      })
    : [];
  const auditsByPipelineId = new Map<string, ProcessingReportAudit[]>();
  for (const audit of audits) {
    if (!audit.loanId) continue;
    const pipelineId = pipelineIdByLoanId.get(audit.loanId);
    if (!pipelineId) continue;
    const list = auditsByPipelineId.get(pipelineId) || [];
    list.push({
      action: audit.action,
      details: audit.details,
      createdAt: audit.createdAt,
      actor: audit.user.name,
    });
    auditsByPipelineId.set(pipelineId, list);
  }

  if (input.type === 'LAST_TOUCH') {
    const report: ProcessingPipelineReport = {
      type: 'LAST_TOUCH',
      generatedAt: generatedAt.toISOString(),
      rows: rows
        .map((row) => {
          const activity = latestProcessingActivity(
            auditsByPipelineId.get(row.id) || [],
            row.updatedAt || row.createdAt,
            generatedAt,
            row.updatedAt.getTime() > row.createdAt.getTime() + 1_000
              ? 'Pipeline record updated (audit unavailable)'
              : 'Pipeline record created',
          );
          return {
            ...commonRow(row),
            lastChangedItem: activity.item,
            lastChangedBy: activity.actor,
            lastTouchedAt: activity.at,
            lastTouchedAge: activity.age,
          };
        })
        .sort(
          (left, right) =>
            new Date(left.lastTouchedAt).getTime() -
            new Date(right.lastTouchedAt).getTime(),
        ),
    };
    return { success: true as const, report };
  }

  if (input.type === 'PIPELINE_STATUS') {
    const includesRestrictedColumns =
      actor.role !== UserRole.PROCESSOR_JR &&
      actor.role !== UserRole.PROCESSOR_SR;
    const report: ProcessingPipelineReport = {
      type: 'PIPELINE_STATUS',
      generatedAt: generatedAt.toISOString(),
      selectedStatuses: selectedStatuses || [],
      includesRestrictedColumns,
      rows: rows
        .map((row) => {
          const splitName = splitBorrowerName(row.loan.borrowerName);
          return {
            ...commonRow(row),
            borrowerFirstName:
              row.loan.borrowerFirstName || splitName.firstName,
            borrowerLastName:
              row.loan.borrowerLastName || splitName.lastName,
            leadSource: includesRestrictedColumns
              ? row.leadSource || ''
              : null,
            loanAmount: includesRestrictedColumns
              ? Number(row.loan.amount)
              : null,
            restructureNotes: row.restructureNotes || '',
            titleStatus: row.titleStatus,
            hoiStatus: row.hoiStatus,
            appraisalNeeded:
              row.appraisalNeeded === null
                ? 'Not set'
                : row.appraisalNeeded
                  ? 'Yes'
                  : 'No',
            payoffStatus: row.payoffStatus,
            payoffExpiresAt: iso(row.payoffExpiresAt),
            appraisalNotes: row.appraisalNotes || '',
            appraisalOrderedAt: iso(row.appraisalOrderedAt),
            appraisalScheduledAt: iso(row.appraisalScheduledAt),
            appraisalBackAt: iso(row.appraisalBackAt),
            cdSent: row.cdSent ? 'Yes' : 'No',
            estimatedSigningAt: iso(row.estimatedSigningAt),
            extraNotes: row.extraNotes || '',
            rateLock: row.rateLock ? 'Yes' : 'No',
            projectedRevenue: includesRestrictedColumns
              ? row.projectedRevenue === null
                ? null
                : Number(row.projectedRevenue)
              : null,
            finalRevenue:
              row.finalRevenue === null ? null : Number(row.finalRevenue),
          };
        })
        .sort(
          (left, right) =>
            left.pipelineStatus.localeCompare(right.pipelineStatus) ||
            right.daysInStatus - left.daysInStatus,
        ),
    };
    return { success: true as const, report };
  }

  const report: ProcessingPipelineReport = {
    type: 'SERVICES',
    generatedAt: generatedAt.toISOString(),
    rows: rows.map((row) => {
      const rowAudits = auditsByPipelineId.get(row.id) || [];
      const titleActivity = latestServiceActivity(
        'title',
        rowAudits,
        row.createdAt,
        generatedAt,
      );
      const hoiActivity = latestServiceActivity(
        'hoi',
        rowAudits,
        row.createdAt,
        generatedAt,
      );
      const appraisalActivity = latestServiceActivity(
        'appraisal',
        rowAudits,
        row.createdAt,
        generatedAt,
      );
      const payoffActivity = latestServiceActivity(
        'payoff',
        rowAudits,
        row.createdAt,
        generatedAt,
      );
      const remaining = remainingProcessingServices(row);
      const payoffExpiration = getPayoffExpirationWarning(
        row.payoffStatus,
        row.payoffExpiresAt,
        generatedAt,
      );
      return {
        ...commonRow(row),
        titleStatus: row.titleStatus,
        titleLastUpdatedAt: titleActivity.at,
        titleAge: titleActivity.age,
        titleUpdateSource: titleActivity.source,
        titleSla: isConditionItemOverdue(
          row.approvedWithConditionsAt,
          row.titleStatus,
          generatedAt,
        ) ? 'OVERDUE' : 'CURRENT',
        hoiStatus: row.hoiStatus,
        hoiOrderedAt: iso(row.hoiOrderedAt),
        hoiLastUpdatedAt: hoiActivity.at,
        hoiAge: hoiActivity.age,
        hoiUpdateSource: hoiActivity.source,
        hoiSla:
          isConditionItemOverdue(
            row.approvedWithConditionsAt,
            row.hoiStatus,
            generatedAt,
          ) ||
          isOrderedItemOverdue(
            row.hoiOrderedAt,
            row.hoiStatus,
            generatedAt,
          )
            ? 'OVERDUE'
            : 'CURRENT',
        appraisalNeeded:
          row.appraisalNeeded === null
            ? 'Not set'
            : row.appraisalNeeded
              ? 'Yes'
              : 'No',
        appraisalOrderedAt: iso(row.appraisalOrderedAt),
        appraisalScheduledAt: iso(row.appraisalScheduledAt),
        appraisalBackAt: iso(row.appraisalBackAt),
        appraisalLastUpdatedAt: appraisalActivity.at,
        appraisalAge: appraisalActivity.age,
        appraisalUpdateSource: appraisalActivity.source,
        appraisalSla:
          row.appraisalNeeded !== false &&
          isAppraisalBackOverdue(
            row.appraisalOrderedAt,
            row.appraisalBackAt,
            generatedAt,
          )
            ? 'OVERDUE'
            : 'CURRENT',
        payoffStatus: row.payoffStatus,
        payoffOrderedAt: iso(row.payoffOrderedAt),
        payoffExpiresAt: iso(row.payoffExpiresAt),
        payoffLastUpdatedAt: payoffActivity.at,
        payoffAge: payoffActivity.age,
        payoffUpdateSource: payoffActivity.source,
        payoffSla:
          isOrderedItemOverdue(
            row.payoffOrderedAt,
            row.payoffStatus,
            generatedAt,
          ) ||
          isConditionItemOverdue(
            row.approvedWithConditionsAt,
            row.payoffStatus,
            generatedAt,
          ) ||
          payoffExpiration === 'danger'
            ? 'OVERDUE'
            : payoffExpiration === 'warning'
              ? 'WARNING'
              : 'CURRENT',
        remainingServices: remaining.length ? remaining.join(', ') : 'Complete',
      };
    }),
  };
  return { success: true as const, report };
}
