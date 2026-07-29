export const LEAD_STATUS_OPTIONS = [
  {
    value: 'NEW',
    label: 'New',
    className: 'border-blue-200 bg-blue-50 text-blue-700',
  },
  {
    value: 'HOT',
    label: 'Hot',
    className: 'border-rose-200 bg-rose-50 text-rose-700',
  },
  {
    value: 'COLD',
    label: 'Cold',
    className: 'border-slate-200 bg-slate-100 text-slate-600',
  },
  {
    value: 'DNQ',
    label: 'DNQ',
    className: 'border-zinc-300 bg-zinc-100 text-zinc-700',
  },
  {
    value: 'SUBMITTED_PLUS_ONE',
    label: 'Submitted to +1',
    className: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  },
  {
    value: 'SUBMITTED_DISCLOSURES',
    label: 'Submitted to Disclosures',
    className: 'border-sky-200 bg-sky-50 text-sky-700',
  },
  {
    value: 'SUBMITTED_PROCESSING',
    label: 'Submitted to Processing',
    className: 'border-purple-200 bg-purple-50 text-purple-700',
  },
  {
    value: 'UNASSIGNED',
    label: 'Unassigned',
    className: 'border-orange-200 bg-orange-50 text-orange-700',
  },
] as const;

export type LeadStatusValue = (typeof LEAD_STATUS_OPTIONS)[number]['value'];

export const LEAD_STATUS_VALUES = LEAD_STATUS_OPTIONS.map((status) => status.value);

export function getLeadStatusOption(status: string | null | undefined) {
  return (
    LEAD_STATUS_OPTIONS.find((option) => option.value === status) ??
    LEAD_STATUS_OPTIONS[0]
  );
}
