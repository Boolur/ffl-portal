import {
  ProcessingItemStatus,
  ProcessingPipelineSheet,
  ProcessingPipelineStatus,
  UserRole,
} from '@prisma/client';
import { isAdmin } from './adminTiers';
import {
  PROCESSING_METHOD_SELF_PROCESSED,
  PROCESSING_METHOD_THIRD_PARTY,
} from './processingRouting';

export const PROCESSING_PIPELINE_STATUS_OPTIONS = [
  { value: ProcessingPipelineStatus.SUBBED_TO_UW, label: 'Subbed to UW' },
  { value: ProcessingPipelineStatus.APPROVED_WITH_CONDITIONS, label: 'Approved with conditions' },
  { value: ProcessingPipelineStatus.RE_SUB, label: 'Re-sub' },
  { value: ProcessingPipelineStatus.CTC, label: 'CTC' },
  { value: ProcessingPipelineStatus.DOCS_OUT, label: 'Docs out' },
  { value: ProcessingPipelineStatus.FUNDED, label: 'Funded' },
  { value: ProcessingPipelineStatus.SUSPENDED_RESTRUCTURE, label: 'Suspended/Restructure' },
  { value: ProcessingPipelineStatus.ADVERSE_PENDING, label: 'Adverse Pending' },
  { value: ProcessingPipelineStatus.PENDING_APPROVAL, label: 'Pending Approval' },
] as const;

export const PROCESSING_ITEM_STATUS_OPTIONS = [
  { value: ProcessingItemStatus.NOT_STARTED, label: 'Not started' },
  { value: ProcessingItemStatus.ORDERED, label: 'Ordered' },
  { value: ProcessingItemStatus.RECEIVED, label: 'Received' },
  { value: ProcessingItemStatus.NOT_APPLICABLE, label: 'N/A' },
] as const;

export const PROCESSING_PIPELINE_SHEETS = [
  { value: ProcessingPipelineSheet.PIPELINE, label: 'Pipeline' },
  { value: ProcessingPipelineSheet.RESTRUCTURE, label: 'Restructures' },
  { value: ProcessingPipelineSheet.FUNDING, label: 'Fundings' },
] as const;

export type ProcessingPipelineAccess = {
  canView: boolean;
  canEdit: boolean;
  scope: 'NONE' | 'OWN_LOANS' | 'ASSIGNED' | 'COMPANY';
};

export function getProcessingPipelineAccess(role?: UserRole | null): ProcessingPipelineAccess {
  if (!role) return { canView: false, canEdit: false, scope: 'NONE' };
  if (role === UserRole.LOAN_OFFICER) {
    return { canView: true, canEdit: false, scope: 'OWN_LOANS' };
  }
  if (role === UserRole.LOA) {
    return { canView: true, canEdit: false, scope: 'COMPANY' };
  }
  if (role === UserRole.PROCESSOR_SR) {
    return { canView: true, canEdit: true, scope: 'ASSIGNED' };
  }
  if (
    role === UserRole.PROCESSOR_JR ||
    role === UserRole.MANAGER ||
    isAdmin(role)
  ) {
    return { canView: true, canEdit: true, scope: 'COMPANY' };
  }
  return { canView: false, canEdit: false, scope: 'NONE' };
}

export function canEditProcessingPipelineMethod(
  role: UserRole | null | undefined,
  processingMethod: string | null | undefined,
) {
  if (getProcessingPipelineAccess(role).canEdit) return true;
  return role === UserRole.LOAN_OFFICER && (
    processingMethod === PROCESSING_METHOD_SELF_PROCESSED ||
    processingMethod === PROCESSING_METHOD_THIRD_PARTY
  );
}

export function calculateDaysInStatus(statusChangedAt: Date | string, now = new Date()) {
  const changedAt = new Date(statusChangedAt);
  if (Number.isNaN(changedAt.getTime())) return 0;
  return Math.max(0, Math.floor((now.getTime() - changedAt.getTime()) / 86_400_000));
}

const DAY_MS = 86_400_000;

export type LockedProcessingPipelineField =
  | 'titleStatus'
  | 'payoffStatus'
  | 'hoiStatus'
  | 'appraisalNeeded'
  | 'cdSent'
  | 'rateLock';

export type ProcessingPipelineLockedDefaults = {
  kind: 'SPECIAL_LENDER' | 'THIRD_PARTY';
  label: string;
  lockedFields: readonly LockedProcessingPipelineField[];
  values: {
    titleStatus: ProcessingItemStatus;
    payoffStatus: ProcessingItemStatus;
    hoiStatus: ProcessingItemStatus;
    appraisalNeeded?: boolean;
    cdSent?: boolean;
    rateLock?: boolean;
  };
};

const SPECIAL_PIPELINE_LENDERS = ['AVEN', 'FIGURE', 'NFTY'] as const;

export function normalizeProcessingLender(value: string | null | undefined) {
  return String(value ?? '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, ' ')
    .replace(/\s+/g, ' ');
}

export function getProcessingPipelineLockedDefaults(
  lender: string | null | undefined,
  processingMethod: string | null | undefined,
): ProcessingPipelineLockedDefaults | null {
  const normalizedLender = normalizeProcessingLender(lender);
  const specialLender = SPECIAL_PIPELINE_LENDERS.find(
    (name) => normalizedLender === name || normalizedLender.startsWith(`${name} `),
  );
  if (specialLender) {
    return {
      kind: 'SPECIAL_LENDER',
      label: specialLender,
      lockedFields: [
        'titleStatus',
        'payoffStatus',
        'hoiStatus',
        'appraisalNeeded',
        'cdSent',
        'rateLock',
      ],
      values: {
        titleStatus: ProcessingItemStatus.RECEIVED,
        payoffStatus: ProcessingItemStatus.RECEIVED,
        hoiStatus: ProcessingItemStatus.RECEIVED,
        appraisalNeeded: false,
        cdSent: true,
        rateLock: true,
      },
    };
  }
  if (
    String(processingMethod ?? '').trim().toUpperCase() ===
    PROCESSING_METHOD_THIRD_PARTY
  ) {
    return {
      kind: 'THIRD_PARTY',
      label: '3rd Party Processing',
      lockedFields: ['titleStatus', 'payoffStatus', 'hoiStatus'],
      values: {
        titleStatus: ProcessingItemStatus.NOT_APPLICABLE,
        payoffStatus: ProcessingItemStatus.NOT_APPLICABLE,
        hoiStatus: ProcessingItemStatus.NOT_APPLICABLE,
      },
    };
  }
  return null;
}

export function isProcessingPipelineFieldLocked(
  field: LockedProcessingPipelineField,
  lender: string | null | undefined,
  processingMethod: string | null | undefined,
) {
  return Boolean(
    getProcessingPipelineLockedDefaults(lender, processingMethod)?.lockedFields.includes(field),
  );
}

function validDate(value: Date | string | null | undefined) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function isRateLockExpiring(
  rateLock: boolean,
  expiresAt: Date | string | null,
  now = new Date(),
) {
  const expiration = validDate(expiresAt);
  if (!rateLock || !expiration) return false;
  return expiration.getTime() - now.getTime() <= 3 * DAY_MS;
}

export function isRateLockOverdueAfterAppraisal(
  rateLock: boolean,
  appraisalBackAt: Date | string | null,
  now = new Date(),
) {
  const appraisalBack = validDate(appraisalBackAt);
  if (rateLock || !appraisalBack) return false;
  return now.getTime() - appraisalBack.getTime() >= 5 * DAY_MS;
}

export function isCdSentOverdue(
  cdSent: boolean,
  warningStartsAt: Date | string | null,
  now = new Date(),
) {
  const startsAt = validDate(warningStartsAt);
  if (cdSent || !startsAt) return false;
  return now.getTime() - startsAt.getTime() >= 2 * DAY_MS;
}

export function isConditionItemOverdue(
  approvedWithConditionsAt: Date | string | null,
  status: ProcessingItemStatus,
  now = new Date(),
) {
  const approvedAt = validDate(approvedWithConditionsAt);
  if (!approvedAt || status !== ProcessingItemStatus.NOT_STARTED) return false;
  return now.getTime() - approvedAt.getTime() >= 2 * DAY_MS;
}

export function isOrderedItemOverdue(
  orderedAt: Date | string | null,
  status: ProcessingItemStatus,
  now = new Date(),
) {
  const ordered = validDate(orderedAt);
  if (!ordered || status !== ProcessingItemStatus.ORDERED) return false;
  return now.getTime() - ordered.getTime() >= 2 * DAY_MS;
}

export function isAppraisalBackOverdue(
  appraisalOrderedAt: Date | string | null,
  appraisalBackAt: Date | string | null,
  now = new Date(),
) {
  const orderedAt = validDate(appraisalOrderedAt);
  if (!orderedAt || validDate(appraisalBackAt)) return false;
  return now.getTime() - orderedAt.getTime() >= 7 * DAY_MS;
}

export function getCdWarningStartsAt(
  rateLock: boolean,
  currentValue: Date | null,
  now = new Date(),
) {
  return rateLock ? currentValue ?? now : null;
}

export function getItemOrderedAt(
  status: ProcessingItemStatus,
  currentValue: Date | null,
  now = new Date(),
) {
  return status === ProcessingItemStatus.ORDERED ? currentValue ?? now : null;
}

export function getApprovedWithConditionsAt(
  status: ProcessingPipelineStatus,
  currentValue: Date | null,
  now = new Date(),
) {
  return status === ProcessingPipelineStatus.APPROVED_WITH_CONDITIONS
    ? now
    : currentValue;
}

export function parseOptionalBoolean(value: unknown): boolean | null {
  if (typeof value === 'boolean') return value;
  const normalized = String(value ?? '').trim().toLowerCase();
  if (['true', 'yes', '1', 'y'].includes(normalized)) return true;
  if (['false', 'no', '0', 'n'].includes(normalized)) return false;
  return null;
}

export function parseOptionalMoney(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const normalized = String(value ?? '').replace(/[$,\s]/g, '');
  if (!normalized) return null;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

export function addMonthsClamped(date: Date, months: number) {
  const originalDay = date.getUTCDate();
  const result = new Date(date);
  result.setUTCDate(1);
  result.setUTCMonth(result.getUTCMonth() + months);
  const lastDay = new Date(Date.UTC(result.getUTCFullYear(), result.getUTCMonth() + 1, 0)).getUTCDate();
  result.setUTCDate(Math.min(originalDay, lastDay));
  return result;
}
