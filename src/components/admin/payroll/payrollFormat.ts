import {
  PayrollCompPlanType,
  PayrollCompRequestStatus,
  PayrollLeadProvidedBy,
  PayrollLeadSource,
  PayrollLoanChannel,
  PayrollProcessingType,
  PayrollUserClassification,
} from '@prisma/client';

export function formatCurrency(value: number) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: value % 1 === 0 ? 0 : 2,
  }).format(value);
}

export function formatPercent(value: number) {
  return `${new Intl.NumberFormat('en-US', {
    maximumFractionDigits: 4,
  }).format(value)}%`;
}

export function formatDate(value: string | null) {
  if (!value) return 'Not yet';
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(new Date(value));
}

export function payrollStatusLabel(status: PayrollCompRequestStatus) {
  const labels: Record<PayrollCompRequestStatus, string> = {
    PENDING_REVIEW: 'Pending Review',
    APPROVED: 'Approved',
    REJECTED: 'Rejected',
    PAID: 'Paid',
  };
  return labels[status];
}

export function payrollStatusClasses(status: PayrollCompRequestStatus) {
  const classes: Record<PayrollCompRequestStatus, string> = {
    PENDING_REVIEW: 'border-amber-200 bg-amber-50 text-amber-700',
    APPROVED: 'border-blue-200 bg-blue-50 text-blue-700',
    REJECTED: 'border-rose-200 bg-rose-50 text-rose-700',
    PAID: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  };
  return classes[status];
}

export function loanChannelLabel(channel: PayrollLoanChannel) {
  const labels: Record<PayrollLoanChannel, string> = {
    BROKER: 'Broker',
    NON_DELEGATED: 'Non-Delegated',
  };
  return labels[channel];
}

export function processingTypeLabel(type: PayrollProcessingType) {
  const labels: Record<PayrollProcessingType, string> = {
    IN_HOUSE: 'In-House',
    CONTRACT: 'Contract',
    LENDER: 'Lender',
    OTHER: 'Other',
  };
  return labels[type];
}

export function payrollUserClassificationLabel(type: PayrollUserClassification) {
  const labels: Record<PayrollUserClassification, string> = {
    BROKER: 'Broker',
    RETAIL: 'Retail',
    SUPPORT_STAFF: 'Support Staff',
  };
  return labels[type];
}

export function payrollPlanTypeLabel(type: PayrollCompPlanType) {
  const labels: Record<PayrollCompPlanType, string> = {
    BROKER: 'Broker Split',
    RETAIL: 'Retail Split',
  };
  return labels[type];
}

export function payrollLeadSourceLabel(source: PayrollLeadSource) {
  const labels: Record<PayrollLeadSource, string> = {
    LEAD_BUY: 'Lead Buy',
    MAILER: 'Mailer',
    WARM_TRANSFER: 'Warm Transfer',
    REFERRAL: 'Referral',
    RETURN_CLIENT: 'Return Client',
    OTHER: 'Other',
  };
  return labels[source];
}

export function payrollLeadProvidedByLabel(provider: PayrollLeadProvidedBy) {
  const labels: Record<PayrollLeadProvidedBy, string> = {
    SELF_SOURCED: 'Self Sourced',
    COMPANY_PROVIDED: 'Company Provided',
    BRANCH_PROVIDED: 'Branch Provided',
  };
  return labels[provider];
}
