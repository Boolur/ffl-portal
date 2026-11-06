import type { AriveSyncView } from './ariveSyncTypes';
import type { ProcessingItemStatus } from '@prisma/client';
import { getProcessingPipelineLockedDefaults, getPayoffExpirationWarning, isAppraisalBackOverdue, isCdSentOverdue, isConditionItemOverdue, isOrderedItemOverdue, isRateLockExpiring, isRateLockOverdueAfterAppraisal, type LockedProcessingPipelineField } from './processingPipeline';

const labels: Record<string, string> = {
  pipelineStatus: 'Loan stage', statusChangedAt: 'Stage date', stageDate: 'Stage date',
  sheet: 'Pipeline bucket', borrowerFirstName: 'Borrower first name', borrowerLastName: 'Borrower last name',
  borrowerPhone: 'Borrower phone', borrowerEmail: 'Borrower email',
  coBorrowerFirstName: 'Co-borrower first name', coBorrowerLastName: 'Co-borrower last name',
  coBorrowerPhone: 'Co-borrower phone', coBorrowerEmail: 'Co-borrower email',
  propertyStreet: 'Property street', propertyUnit: 'Unit', propertyCity: 'Property city',
  propertyState: 'Property state', propertyZip: 'Property ZIP', propertyOccupancy: 'Occupancy',
  estimatedValue: 'Estimated value', yearBuilt: 'Year built', yearAcquired: 'Year acquired',
  titleHeldAs: 'Title held as', loanAmount: 'Loan amount', loanType: 'Loan type',
  loanProgram: 'Loan program', lender: 'Lender', channel: 'Channel', loanPurpose: 'Loan purpose',
  titleStatus: 'Title', payoffStatus: 'Payoff', payoffOrderedAt: 'Payoff ordered date',
  payoffExpiresAt: 'Payoff expiration', hoiStatus: 'Homeowners insurance', hoiOrderedAt: 'Insurance ordered date',
  appraisalNeeded: 'Appraisal required', appraisalOrderedAt: 'Appraisal ordered date',
  appraisalScheduledAt: 'Appraisal appointment', appraisalBackAt: 'Appraisal received date',
  appraisalNotes: 'Appraisal notes', estimatedSigningAt: 'Scheduled signing', fundedAt: 'Funded date',
  cdSent: 'Closing disclosure sent', cdWarningStartsAt: 'Closing disclosure reminder date',
  rateLock: 'Rate lock', rateLockExpiresAt: 'Rate lock expiration', rateLockConfirmedAt: 'Rate lock confirmed date',
  missingItemsCurrentStatus: 'Pending items', approvedWithConditionsAt: 'Conditional approval date',
};

export function ariveFieldLabel(field: string): string {
  return labels[field] || field.replace(/^(loan|pipeline|submission)\./, '')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2').replaceAll('_', ' ').replace(/^./, letter => letter.toUpperCase());
}

export function ariveSyncHealth(view: AriveSyncView | null | undefined, now = Date.now()) {
  if (!view) return null;
  if (!view.enabled) return { tone: 'muted', label: 'Arive sync paused' } as const;
  if (view.error) return { tone: 'error', label: 'Arive sync needs attention' } as const;
  if (view.conflicts.length) return { tone: 'warning', label: 'Arive values retained' } as const;
  if (view.missingFields.length || view.issues.length) return { tone: 'warning', label: 'Arive details need review' } as const;
  const succeeded = view.lastSuccessAt ? Date.parse(view.lastSuccessAt) : NaN;
  if (!Number.isFinite(succeeded)) return { tone: 'pending', label: 'Awaiting first Arive sync' } as const;
  if (now - succeeded > 15 * 60_000) return { tone: 'warning', label: 'Arive sync delayed' } as const;
  return { tone: 'success', label: 'Synced with Arive' } as const;
}

export function formatAriveSyncDate(value: string | null | undefined): string {
  if (!value) return 'Not supplied';
  // Calendar dates are not timestamps: do not move them into the previous day in Pacific time.
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toLocaleString() : 'Not supplied';
}

export function formatAriveCalendarDate(value: string | null | undefined): string {
  if (!value) return 'Not supplied';
  const day = value.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return 'Not supplied';
  const date = new Date(`${day}T00:00:00.000Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== day) return 'Not supplied';
  return new Intl.DateTimeFormat('en-US', { month: '2-digit', day: '2-digit', year: '2-digit', timeZone: 'UTC' }).format(date);
}

export function formatAriveConflictValue(field: string, value: string | null): string {
  if (value === null || value === '') return 'Not supplied';
  if (field.endsWith('At') || field === 'stageDate') {
    const formatted = formatAriveCalendarDate(value);
    if (formatted !== 'Not supplied') return formatted;
  }
  if (['rateLock', 'cdSent', 'appraisalNeeded'].includes(field) && ['true', 'false'].includes(value)) return value === 'true' ? 'Yes' : 'No';
  if (['pipelineStatus', 'sheet', 'titleStatus', 'payoffStatus', 'hoiStatus'].includes(field)) return value.toLowerCase().replaceAll('_', ' ').replace(/^./, letter => letter.toUpperCase());
  return value;
}

export function ariveFieldMissing(view: AriveSyncView | null | undefined, field: string): boolean {
  return Boolean(view?.enabled && view.missingFields.includes(field));
}

export function ariveDateForSla(view: AriveSyncView | null | undefined, field: string, value: string | null): string | null {
  return ariveFieldMissing(view, field) ? null : value;
}

type AriveReminderRow = {
  ariveSync?: AriveSyncView | null;
  lender: string | null;
  processingMethod: string | null;
  approvedWithConditionsAt: string | null;
  titleStatus: ProcessingItemStatus;
  payoffStatus: ProcessingItemStatus;
  payoffOrderedAt: string | null;
  payoffExpiresAt: string | null;
  hoiStatus: ProcessingItemStatus;
  hoiOrderedAt: string | null;
  appraisalOrderedAt: string | null;
  appraisalBackAt: string | null;
  cdSent: boolean;
  cdWarningStartsAt: string | null;
  rateLock: boolean;
  rateLockExpiresAt: string | null;
};

export function arivePipelineWarnings(row: AriveReminderRow, now = new Date()) {
  // Responsibility affects reminders only. Never replace actual Arive progress with lender defaults.
  const exceptions = row.ariveSync?.enabled
    ? getProcessingPipelineLockedDefaults(row.lender, row.processingMethod)?.lockedFields ?? []
    : [];
  const responsible = (field: LockedProcessingPipelineField) => !exceptions.includes(field);
  const date = (field: keyof AriveReminderRow) => ariveDateForSla(row.ariveSync, field, row[field] as string | null);
  return {
    title: responsible('titleStatus') && isConditionItemOverdue(date('approvedWithConditionsAt'), row.titleStatus, now),
    payoff: responsible('payoffStatus') && (isConditionItemOverdue(date('approvedWithConditionsAt'), row.payoffStatus, now) || isOrderedItemOverdue(date('payoffOrderedAt'), row.payoffStatus, now)),
    payoffExpiration: responsible('payoffStatus') ? getPayoffExpirationWarning(row.payoffStatus, date('payoffExpiresAt'), now) : 'none' as const,
    hoi: responsible('hoiStatus') && isOrderedItemOverdue(date('hoiOrderedAt'), row.hoiStatus, now),
    appraisalBack: responsible('appraisalNeeded') && isAppraisalBackOverdue(date('appraisalOrderedAt'), date('appraisalBackAt'), now),
    cdSent: responsible('cdSent') && isCdSentOverdue(row.cdSent, date('cdWarningStartsAt'), now),
    rateLockExpiring: responsible('rateLock') && isRateLockExpiring(row.rateLock, date('rateLockExpiresAt'), now),
    rateLockAfterAppraisal: responsible('rateLock') && isRateLockOverdueAfterAppraisal(row.rateLock, date('appraisalBackAt'), now),
  };
}

export function mergeAriveConflictDraft<T extends { version: number }>(draft: T, latest: T, blockedFields: string[]): T {
  const next = { ...draft, version: latest.version };
  for (const field of blockedFields) {
    if (field !== 'id' && field !== 'version' && Object.prototype.hasOwnProperty.call(latest, field)) {
      const key = field as keyof T;
      next[key] = latest[key];
    }
  }
  return next;
}
