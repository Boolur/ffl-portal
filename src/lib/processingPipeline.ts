import {
  ProcessingItemStatus,
  ProcessingPipelineSheet,
  ProcessingPipelineStatus,
  UserRole,
} from '@prisma/client';
import { isAdmin } from './adminTiers';

export const PROCESSING_PIPELINE_STATUS_OPTIONS = [
  { value: ProcessingPipelineStatus.SUBBED_TO_UW, label: 'Subbed to UW' },
  { value: ProcessingPipelineStatus.APPROVED_WITH_CONDITIONS, label: 'Approved with conditions' },
  { value: ProcessingPipelineStatus.RE_SUB, label: 'Re-sub' },
  { value: ProcessingPipelineStatus.CTC, label: 'CTC' },
  { value: ProcessingPipelineStatus.DOCS_OUT, label: 'Docs out' },
  { value: ProcessingPipelineStatus.FUNDED, label: 'Funded' },
  { value: ProcessingPipelineStatus.SUSPENDED_RESTRUCTURE, label: 'Suspended/Restructure' },
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

export function calculateDaysInStatus(statusChangedAt: Date | string, now = new Date()) {
  const changedAt = new Date(statusChangedAt);
  if (Number.isNaN(changedAt.getTime())) return 0;
  return Math.max(0, Math.floor((now.getTime() - changedAt.getTime()) / 86_400_000));
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
