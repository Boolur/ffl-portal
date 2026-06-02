import { UserRole } from '@prisma/client';
import type { BucketDefinition, TaskDeskKey } from '@/lib/tasks/types';

export type BucketDefinitionWithDesk = BucketDefinition & {
  deskKey?: TaskDeskKey;
};

export function getDisclosureSpecialistBuckets(): BucketDefinition[] {
  return [
    {
      id: 'new-disclosure',
      label: 'New Disclosure Requests',
      chipLabel: 'New',
      chipClassName: 'border-blue-200 bg-blue-50 text-blue-700',
    },
    {
      id: 'waiting-missing',
      label: 'Waiting Missing/Incomplete',
      chipLabel: 'Pending LO',
      chipClassName: 'border-amber-200 bg-amber-50 text-amber-700',
    },
    {
      id: 'lo-responded',
      label: 'LO Responded (Review)',
      chipLabel: 'Needs Review',
      chipClassName: 'border-sky-200 bg-sky-50 text-sky-700',
    },
    {
      id: 'waiting-approval',
      label: 'Waiting for Approval',
      chipLabel: 'Awaiting Approval',
      chipClassName: 'border-indigo-200 bg-indigo-50 text-indigo-700',
    },
    {
      id: 'completed-disclosure',
      label: 'Completed Disclosure Requests',
      chipLabel: 'Completed',
      chipClassName: 'border-emerald-200 bg-emerald-50 text-emerald-700',
      isCompleted: true,
    },
  ];
}

export function getLoDisclosureBuckets(): BucketDefinitionWithDesk[] {
  return [
    {
      id: 'submitted-disclosures',
      label: 'Submitted for Disclosures',
      chipLabel: 'Submitted',
      chipClassName: 'border-blue-200 bg-blue-50 text-blue-700',
      deskKey: 'disclosure',
    },
    {
      id: 'action-required',
      label: 'Action Required (Approve Figures / Missing Info)',
      chipLabel: 'Action Required',
      chipClassName: 'border-indigo-200 bg-indigo-50 text-indigo-700',
      deskKey: 'disclosure',
    },
    {
      id: 'returned-to-disclosure',
      label: 'Returned to Disclosure',
      chipLabel: 'Tracking',
      chipClassName: 'border-sky-200 bg-sky-50 text-sky-700',
      deskKey: 'disclosure',
    },
    {
      id: 'disclosures-sent-completed',
      label: 'Disclosures Sent / Completed',
      chipLabel: 'Completed',
      chipClassName: 'border-emerald-200 bg-emerald-50 text-emerald-700',
      isCompleted: true,
      deskKey: 'disclosure',
    },
  ];
}

export function getLoQcBuckets(): BucketDefinitionWithDesk[] {
  return [
    {
      id: 'submitted-qc',
      label: 'Submitted for QC',
      chipLabel: 'Submitted',
      chipClassName: 'border-blue-200 bg-blue-50 text-blue-700',
      deskKey: 'qc',
    },
    {
      id: 'action-required-qc',
      label: 'Action Required (QC Info / Approval)',
      chipLabel: 'Action Required',
      chipClassName: 'border-indigo-200 bg-indigo-50 text-indigo-700',
      deskKey: 'qc',
    },
    {
      id: 'returned-to-qc',
      label: 'Returned to QC',
      chipLabel: 'Tracking',
      chipClassName: 'border-violet-200 bg-violet-50 text-violet-700',
      deskKey: 'qc',
    },
    {
      id: 'qc-completed',
      label: 'QC Sent / Completed',
      chipLabel: 'Completed',
      chipClassName: 'border-emerald-200 bg-emerald-50 text-emerald-700',
      isCompleted: true,
      deskKey: 'qc',
    },
  ];
}

export function getQcBuckets(): BucketDefinition[] {
  return [
    {
      id: 'qc-new',
      label: 'New QC Requests',
      chipLabel: 'New',
      chipClassName: 'border-blue-200 bg-blue-50 text-blue-700',
    },
    {
      id: 'qc-waiting-missing',
      label: 'Waiting Missing/Incomplete',
      chipLabel: 'Pending LO',
      chipClassName: 'border-amber-200 bg-amber-50 text-amber-700',
    },
    {
      id: 'qc-lo-responded',
      label: 'LO Responded (Review)',
      chipLabel: 'Needs Review',
      chipClassName: 'border-sky-200 bg-sky-50 text-sky-700',
    },
    {
      id: 'qc-completed-requests',
      label: 'Completed QC Requests',
      chipLabel: 'Completed',
      chipClassName: 'border-emerald-200 bg-emerald-50 text-emerald-700',
      isCompleted: true,
    },
  ];
}

export function getVaTitleBuckets(): BucketDefinitionWithDesk[] {
  return [
    {
      id: 'va-new-request',
      label: 'New VA Title Requests',
      chipLabel: 'New',
      chipClassName: 'border-rose-200 bg-rose-50 text-rose-700',
      deskKey: 'va_title',
    },
    {
      id: 'va-title-started',
      label: 'Started / Ordered VA Title Requests',
      chipLabel: 'In Progress',
      chipClassName: 'border-sky-200 bg-sky-50 text-sky-700',
      deskKey: 'va_title',
    },
    {
      id: 'va-completed-requests',
      label: 'Completed VA Title Requests',
      chipLabel: 'Completed',
      chipClassName: 'border-emerald-200 bg-emerald-50 text-emerald-700',
      isCompleted: true,
      deskKey: 'va_title',
    },
  ];
}

export function getJrProcessorBuckets(labelAssigned = 'My Requests'): BucketDefinitionWithDesk[] {
  return [
    {
      id: 'va-new-request',
      label: 'New JR Processor Requests',
      chipLabel: 'New',
      chipClassName: 'border-rose-200 bg-rose-50 text-rose-700',
      deskKey: 'va_hoi',
    },
    {
      id: 'jr-my-requests',
      label: labelAssigned,
      chipLabel: 'In Progress',
      chipClassName: 'border-sky-200 bg-sky-50 text-sky-700',
      deskKey: 'va_hoi',
    },
    {
      id: 'va-completed-requests',
      label: 'Completed JR Processor Requests',
      chipLabel: 'Completed',
      chipClassName: 'border-emerald-200 bg-emerald-50 text-emerald-700',
      isCompleted: true,
      deskKey: 'va_hoi',
    },
  ];
}

export function getVaPayoffBuckets(): BucketDefinitionWithDesk[] {
  return [
    {
      id: 'va-payoff-new',
      label: 'New VA Payoff Requests',
      chipLabel: 'New',
      chipClassName: 'border-rose-200 bg-rose-50 text-rose-700',
      deskKey: 'va_payoff',
    },
    {
      id: 'va-payoff-started',
      label: 'Started / Ordered VA Payoff Requests',
      chipLabel: 'In Progress',
      chipClassName: 'border-sky-200 bg-sky-50 text-sky-700',
      deskKey: 'va_payoff',
    },
    {
      id: 'va-payoff-waiting-missing',
      label: 'Waiting Missing/Incomplete',
      chipLabel: 'Pending LO',
      chipClassName: 'border-amber-200 bg-amber-50 text-amber-700',
      deskKey: 'va_payoff',
    },
    {
      id: 'va-payoff-lo-responded',
      label: 'LO Responded (Review)',
      chipLabel: 'Needs Review',
      chipClassName: 'border-sky-200 bg-sky-50 text-sky-700',
      deskKey: 'va_payoff',
    },
    {
      id: 'va-payoff-completed',
      label: 'Completed VA Payoff Requests',
      chipLabel: 'Completed',
      chipClassName: 'border-emerald-200 bg-emerald-50 text-emerald-700',
      isCompleted: true,
      deskKey: 'va_payoff',
    },
  ];
}

export function getVaAppraisalBuckets(): BucketDefinitionWithDesk[] {
  return [
    {
      id: 'va-appraisal-new',
      label: 'New Appraisal Specialist Requests',
      chipLabel: 'New',
      chipClassName: 'border-rose-200 bg-rose-50 text-rose-700',
      deskKey: 'va_appraisal',
    },
    {
      id: 'va-appraisal-started',
      label: 'Started / Ordered Appraisal Requests',
      chipLabel: 'In Progress',
      chipClassName: 'border-sky-200 bg-sky-50 text-sky-700',
      deskKey: 'va_appraisal',
    },
    {
      id: 'va-appraisal-waiting-missing',
      label: 'Waiting Missing/Incomplete',
      chipLabel: 'Pending LO',
      chipClassName: 'border-amber-200 bg-amber-50 text-amber-700',
      deskKey: 'va_appraisal',
    },
    {
      id: 'va-appraisal-lo-responded',
      label: 'LO Responded (Review)',
      chipLabel: 'Needs Review',
      chipClassName: 'border-sky-200 bg-sky-50 text-sky-700',
      deskKey: 'va_appraisal',
    },
    {
      id: 'va-appraisal-completed',
      label: 'Completed Appraisal Specialist Requests',
      chipLabel: 'Completed',
      chipClassName: 'border-emerald-200 bg-emerald-50 text-emerald-700',
      isCompleted: true,
      deskKey: 'va_appraisal',
    },
  ];
}

export function getBucketDefinitionsForRole(role: UserRole): BucketDefinitionWithDesk[] {
  switch (role) {
    case UserRole.DISCLOSURE_SPECIALIST:
      return getDisclosureSpecialistBuckets();
    case UserRole.QC:
      return getQcBuckets();
    case UserRole.VA_TITLE:
      return getVaTitleBuckets();
    case UserRole.PROCESSOR_JR:
      return getJrProcessorBuckets();
    case UserRole.VA_PAYOFF:
      return getVaPayoffBuckets();
    case UserRole.VA_APPRAISAL:
      return getVaAppraisalBuckets();
    default:
      return [];
  }
}

export function getManagerDeskBucketSets() {
  return {
    disclosureBuckets: getDisclosureSpecialistBuckets().map((b) => ({
      ...b,
      deskKey: 'disclosure' as const,
    })),
    qcBuckets: getQcBuckets().map((b) => ({ ...b, deskKey: 'qc' as const })),
  };
}

export function getManagerVaDeskBucketSets() {
  return {
    vaTitleBuckets: getVaTitleBuckets(),
    vaHoiBuckets: getJrProcessorBuckets('Assigned Requests'),
    vaPayoffBuckets: getVaPayoffBuckets(),
    vaAppraisalBuckets: getVaAppraisalBuckets(),
  };
}

export function getLoPilotBucketSets() {
  return {
    disclosureBuckets: getLoDisclosureBuckets(),
    qcBuckets: getLoQcBuckets(),
  };
}
