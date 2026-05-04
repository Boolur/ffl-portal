'use client';

import React, { useMemo, useState, useTransition } from 'react';
import {
  AlertTriangle,
  Banknote,
  BarChart3,
  Building2,
  CalendarDays,
  ChevronDown,
  ChevronRight,
  Filter,
  Landmark,
  Loader2,
  ReceiptText,
  RefreshCw,
  Search,
  UserRound,
  Users,
} from 'lucide-react';
import {
  getLeadSpendReport,
  type LeadBillingFocus,
  type LeadReportingFilterOptions,
  type LeadSpendReport,
} from '@/app/actions/leadReportingActions';

type Preset = 'today' | 'yesterday' | 'last7' | 'mtd' | 'lastMonth' | 'custom';
type SortDirection = 'asc' | 'desc';
type OfficerSortKey = 'loanOfficerName' | 'totalSpend' | 'leadCount' | 'averagePrice';
type CampaignSortKey =
  | 'campaignName'
  | 'totalSpend'
  | 'leadCount'
  | 'averagePrice'
  | 'missingPriceCount';

type Props = {
  options: LeadReportingFilterOptions;
  initialReport: LeadSpendReport;
};

const BILLING_FOCUS_OPTIONS: Array<{
  value: LeadBillingFocus;
  label: string;
  description: string;
}> = [
  {
    value: 'company_paid',
    label: 'Company-paid',
    description: 'LeadPoint + LendingTree spend to bill back',
  },
  {
    value: 'direct_billed',
    label: 'Direct-billed',
    description: 'FRU spend billed directly to LOs',
  },
  {
    value: 'all',
    label: 'All vendors',
    description: 'Every priced lead source',
  },
];

const PRESET_OPTIONS: Array<{ value: Preset; label: string }> = [
  { value: 'today', label: 'Daily' },
  { value: 'yesterday', label: 'Yesterday' },
  { value: 'last7', label: 'Weekly' },
  { value: 'mtd', label: 'Monthly' },
  { value: 'lastMonth', label: 'Last Month' },
  { value: 'custom', label: 'Date Range' },
];

const OFFICER_SORT_LABELS: Record<OfficerSortKey, string> = {
  loanOfficerName: 'Loan Officer',
  totalSpend: 'Spend',
  leadCount: 'Leads',
  averagePrice: 'Avg',
};

const CAMPAIGN_SORT_LABELS: Record<CampaignSortKey, string> = {
  campaignName: 'Campaign',
  totalSpend: 'Spend',
  leadCount: 'Leads',
  averagePrice: 'Avg',
  missingPriceCount: 'Missing',
};

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

function dateInputValue(value: string) {
  return value.slice(0, 10);
}

function isoFromDateInput(value: string, boundary: 'start' | 'end') {
  const date = value ? new Date(`${value}T00:00:00`) : new Date();
  return (boundary === 'start' ? startOfDay(date) : endOfDay(date)).toISOString();
}

function rangeForPreset(preset: Preset) {
  const now = new Date();
  const todayStart = startOfDay(now);
  const todayEnd = endOfDay(now);

  if (preset === 'today') return { startDate: todayStart.toISOString(), endDate: todayEnd.toISOString() };

  if (preset === 'yesterday') {
    const yesterday = new Date(todayStart);
    yesterday.setDate(yesterday.getDate() - 1);
    return {
      startDate: startOfDay(yesterday).toISOString(),
      endDate: endOfDay(yesterday).toISOString(),
    };
  }

  if (preset === 'mtd') {
    const start = new Date(now.getFullYear(), now.getMonth(), 1);
    return { startDate: startOfDay(start).toISOString(), endDate: todayEnd.toISOString() };
  }

  if (preset === 'lastMonth') {
    const start = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const end = new Date(now.getFullYear(), now.getMonth(), 0);
    return { startDate: startOfDay(start).toISOString(), endDate: endOfDay(end).toISOString() };
  }

  const start = new Date(todayStart);
  start.setDate(start.getDate() - 6);
  return { startDate: start.toISOString(), endDate: todayEnd.toISOString() };
}

function formatCurrency(value: number) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: value % 1 === 0 ? 0 : 2,
  }).format(value);
}

function formatNumber(value: number) {
  return new Intl.NumberFormat('en-US').format(value);
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(value));
}

function selectedValues(select: HTMLSelectElement) {
  return Array.from(select.selectedOptions).map((option) => option.value);
}

function cx(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(' ');
}

function compareText(a: string, b: string) {
  return a.localeCompare(b, undefined, { sensitivity: 'base' });
}

function sortMultiplier(direction: SortDirection) {
  return direction === 'asc' ? 1 : -1;
}

function SortHeader<T extends string>({
  label,
  sortKey,
  activeKey,
  direction,
  align = 'left',
  onSort,
}: {
  label: string;
  sortKey: T;
  activeKey: T;
  direction: SortDirection;
  align?: 'left' | 'right';
  onSort: (key: T) => void;
}) {
  const active = sortKey === activeKey;

  return (
    <button
      type="button"
      onClick={() => onSort(sortKey)}
      className={cx(
        'inline-flex items-center gap-1 rounded-md px-1 py-0.5 font-bold transition hover:bg-slate-100 hover:text-slate-700',
        align === 'right' && 'ml-auto',
        active ? 'text-slate-800' : 'text-slate-500'
      )}
      aria-label={`Sort by ${label}`}
    >
      {label}
      <ChevronDown
        className={cx(
          'h-3 w-3 transition',
          active ? 'opacity-100' : 'opacity-0',
          active && direction === 'asc' && 'rotate-180'
        )}
      />
    </button>
  );
}

function KpiCard({
  title,
  value,
  subtitle,
  Icon,
  tone,
}: {
  title: string;
  value: string;
  subtitle: string;
  Icon: React.ComponentType<{ className?: string }>;
  tone: 'sky' | 'blue' | 'emerald' | 'amber';
}) {
  const tones = {
    sky: {
      card: 'border-sky-200 bg-sky-50 text-sky-950',
      icon: 'bg-white text-sky-600 ring-sky-100',
      label: 'text-sky-700',
      subtitle: 'text-sky-700/75',
    },
    blue: {
      card: 'border-blue-200 bg-blue-50 text-blue-950',
      icon: 'bg-white text-blue-600 ring-blue-100',
      label: 'text-blue-700',
      subtitle: 'text-blue-700/75',
    },
    emerald: {
      card: 'border-emerald-200 bg-emerald-50 text-emerald-950',
      icon: 'bg-white text-emerald-600 ring-emerald-100',
      label: 'text-emerald-700',
      subtitle: 'text-emerald-700/75',
    },
    amber: {
      card: 'border-amber-200 bg-amber-50 text-amber-950',
      icon: 'bg-white text-amber-600 ring-amber-100',
      label: 'text-amber-700',
      subtitle: 'text-amber-700/75',
    },
  };
  const selectedTone = tones[tone];

  return (
    <div className={cx('relative overflow-hidden rounded-2xl border p-4 shadow-sm', selectedTone.card)}>
      <div className="relative flex items-start justify-between gap-4">
        <div>
          <p className={cx('text-[11px] font-bold uppercase tracking-[0.14em]', selectedTone.label)}>
            {title}
          </p>
          <p className="mt-2 text-2xl font-bold tracking-tight">{value}</p>
          <p className={cx('mt-1 text-xs', selectedTone.subtitle)}>
            {subtitle}
          </p>
        </div>
        <div className={cx('rounded-xl p-2 ring-1', selectedTone.icon)}>
          <Icon className="h-4 w-4" />
        </div>
      </div>
    </div>
  );
}

export function LeadReportingPanel({ options, initialReport }: Props) {
  const [report, setReport] = useState(initialReport);
  const [preset, setPreset] = useState<Preset>('last7');
  const [startDate, setStartDate] = useState(initialReport.filters.startDate);
  const [endDate, setEndDate] = useState(initialReport.filters.endDate);
  const [billingFocus, setBillingFocus] = useState<LeadBillingFocus>(
    initialReport.filters.billingFocus
  );
  const [vendorIds, setVendorIds] = useState<string[]>(initialReport.filters.vendorIds);
  const [campaignIds, setCampaignIds] = useState<string[]>(initialReport.filters.campaignIds);
  const [assignedUserIds, setAssignedUserIds] = useState<string[]>(
    initialReport.filters.assignedUserIds
  );
  const [includeUnassigned, setIncludeUnassigned] = useState(
    initialReport.filters.includeUnassigned
  );
  const [includeMissingPrice, setIncludeMissingPrice] = useState(
    initialReport.filters.includeMissingPrice
  );
  const [expandedOfficerIds, setExpandedOfficerIds] = useState<Set<string>>(new Set());
  const [officerSort, setOfficerSort] = useState<{
    key: OfficerSortKey;
    direction: SortDirection;
  }>({ key: 'totalSpend', direction: 'desc' });
  const [campaignSort, setCampaignSort] = useState<{
    key: CampaignSortKey;
    direction: SortDirection;
  }>({ key: 'totalSpend', direction: 'desc' });
  const [isPending, startTransition] = useTransition();

  const filteredCampaigns = useMemo(() => {
    if (vendorIds.length === 0) return options.campaigns;
    return options.campaigns.filter((campaign) => vendorIds.includes(campaign.vendorId));
  }, [options.campaigns, vendorIds]);

  const rangeLabel = useMemo(() => {
    const start = new Date(report.filters.startDate);
    const end = new Date(report.filters.endDate);
    return `${start.toLocaleDateString()} - ${end.toLocaleDateString()}`;
  }, [report.filters.endDate, report.filters.startDate]);

  const sortedOfficerRows = useMemo(() => {
    const multiplier = sortMultiplier(officerSort.direction);
    return [...report.loanOfficerRows].sort((a, b) => {
      if (officerSort.key === 'loanOfficerName') {
        return compareText(a.loanOfficerName, b.loanOfficerName) * multiplier;
      }

      return (a[officerSort.key] - b[officerSort.key]) * multiplier;
    });
  }, [officerSort.direction, officerSort.key, report.loanOfficerRows]);

  const sortedCampaignRows = useMemo(() => {
    const multiplier = sortMultiplier(campaignSort.direction);
    return [...report.campaignRows].sort((a, b) => {
      if (campaignSort.key === 'campaignName') {
        const campaignCompare = compareText(a.campaignName, b.campaignName);
        return campaignCompare !== 0
          ? campaignCompare * multiplier
          : compareText(a.loanOfficerName, b.loanOfficerName) * multiplier;
      }

      return (a[campaignSort.key] - b[campaignSort.key]) * multiplier;
    });
  }, [campaignSort.direction, campaignSort.key, report.campaignRows]);

  function updateOfficerSort(key: OfficerSortKey) {
    setOfficerSort((current) => ({
      key,
      direction: current.key === key && current.direction === 'desc' ? 'asc' : 'desc',
    }));
  }

  function updateCampaignSort(key: CampaignSortKey) {
    setCampaignSort((current) => ({
      key,
      direction: current.key === key && current.direction === 'desc' ? 'asc' : 'desc',
    }));
  }

  function buildReportParams(overrides?: Partial<{
    startDate: string;
    endDate: string;
    vendorIds: string[];
    campaignIds: string[];
    assignedUserIds: string[];
    billingFocus: LeadBillingFocus;
    includeUnassigned: boolean;
    includeMissingPrice: boolean;
  }>) {
    return {
      startDate: overrides?.startDate ?? startDate,
      endDate: overrides?.endDate ?? endDate,
      vendorIds: overrides?.vendorIds ?? vendorIds,
      campaignIds: overrides?.campaignIds ?? campaignIds,
      assignedUserIds: overrides?.assignedUserIds ?? assignedUserIds,
      billingFocus: overrides?.billingFocus ?? billingFocus,
      includeUnassigned: overrides?.includeUnassigned ?? includeUnassigned,
      includeMissingPrice: overrides?.includeMissingPrice ?? includeMissingPrice,
    };
  }

  function runReport(overrides?: Partial<ReturnType<typeof buildReportParams>>) {
    startTransition(async () => {
      const next = await getLeadSpendReport(buildReportParams(overrides));
      setReport(next);
    });
  }

  function applyPreset(nextPreset: Preset) {
    setPreset(nextPreset);
    if (nextPreset === 'custom') return;
    const range = rangeForPreset(nextPreset);
    setStartDate(range.startDate);
    setEndDate(range.endDate);
    runReport({ startDate: range.startDate, endDate: range.endDate });
  }

  function refreshReport() {
    runReport();
  }

  function toggleOfficer(id: string) {
    setExpandedOfficerIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <div className="space-y-5">
      <section className="rounded-2xl border border-slate-200 bg-white p-5 text-slate-900 shadow-sm">
        <div className="grid gap-4 lg:grid-cols-[1fr_auto] lg:items-center">
          <div>
            <h2 className="text-lg font-bold tracking-tight text-slate-900">
              Lead spend summary
            </h2>
            <p className="mt-1 max-w-2xl text-sm leading-6 text-slate-500">
              Review billable lead price by loan officer, vendor, campaign, and date range.
            </p>
          </div>
          <div className="grid gap-3 sm:grid-cols-3 lg:min-w-[520px]">
            <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
              <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-slate-400">
                Spend
              </p>
              <p className="mt-1 text-xl font-bold text-slate-900">
                {formatCurrency(report.summary.totalSpend)}
              </p>
            </div>
            <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
              <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-slate-400">
                Date range
              </p>
              <p className="mt-1 text-sm font-semibold text-slate-700">{rangeLabel}</p>
            </div>
            <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
              <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-slate-400">
                Generated
              </p>
              <p className="mt-1 text-sm font-semibold text-slate-700">
                {formatDateTime(report.generatedAt)}
              </p>
            </div>
          </div>
        </div>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2 text-sm font-bold text-slate-900">
              <Filter className="h-4 w-4 text-blue-600" />
              Report controls
            </div>
            <p className="mt-1 text-xs text-slate-500">
              Narrow spend by billing model, date range, source, campaign, or loan officer.
            </p>
          </div>
          <button
            type="button"
            onClick={refreshReport}
            disabled={isPending}
            className="inline-flex items-center gap-2 rounded-xl border border-blue-200 bg-white px-4 py-2.5 text-sm font-bold text-blue-700 shadow-sm transition hover:bg-blue-50 disabled:opacity-60"
          >
            {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            Apply filters
          </button>
        </div>

        <div className="grid gap-4 xl:grid-cols-[1.05fr_1fr]">
          <div className="space-y-3">
            <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-slate-400">
              Billing focus
            </p>
            <div className="grid gap-2 sm:grid-cols-3">
              {BILLING_FOCUS_OPTIONS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => {
                    setBillingFocus(option.value);
                    runReport({ billingFocus: option.value });
                  }}
                  className={cx(
                    'rounded-xl border px-3 py-2.5 text-left transition',
                    billingFocus === option.value
                      ? 'border-blue-200 bg-blue-50 text-blue-950 shadow-sm'
                      : 'border-slate-200 bg-slate-50 text-slate-700 hover:bg-white'
                  )}
                >
                  <span className="block text-sm font-bold">{option.label}</span>
                  <span className={cx('mt-1 block text-xs', billingFocus === option.value ? 'text-blue-700/75' : 'text-slate-500')}>
                    {option.description}
                  </span>
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-3">
            <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-slate-400">
              Date range
            </p>
            <div className="flex flex-wrap gap-2">
              {PRESET_OPTIONS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => applyPreset(option.value)}
                  className={cx(
                    'rounded-full px-3 py-1.5 text-xs font-bold transition',
                    preset === option.value
                      ? 'bg-blue-100 text-blue-700 ring-1 ring-blue-200'
                      : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                  )}
                >
                  {option.label}
                </button>
              ))}
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="space-y-1.5">
                <span className="text-xs font-bold text-slate-500">Start</span>
                <input
                  type="date"
                  value={dateInputValue(startDate)}
                  onChange={(event) => {
                    setPreset('custom');
                    setStartDate(isoFromDateInput(event.target.value, 'start'));
                  }}
                  className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 outline-none focus:border-blue-400 focus:ring-4 focus:ring-blue-100"
                />
              </label>
              <label className="space-y-1.5">
                <span className="text-xs font-bold text-slate-500">End</span>
                <input
                  type="date"
                  value={dateInputValue(endDate)}
                  onChange={(event) => {
                    setPreset('custom');
                    setEndDate(isoFromDateInput(event.target.value, 'end'));
                  }}
                  className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 outline-none focus:border-blue-400 focus:ring-4 focus:ring-blue-100"
                />
              </label>
            </div>
          </div>
        </div>

        <div className="mt-5 grid gap-4 lg:grid-cols-3">
          <label className="space-y-1.5">
            <span className="text-xs font-bold text-slate-500">Vendors</span>
            <select
              multiple
              value={vendorIds}
              onChange={(event) => {
                const next = selectedValues(event.currentTarget);
                setVendorIds(next);
                setCampaignIds((current) =>
                  next.length === 0
                    ? current
                    : current.filter((id) => options.campaigns.some((c) => c.id === id && next.includes(c.vendorId)))
                );
              }}
              className="min-h-24 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 outline-none focus:border-blue-400 focus:ring-4 focus:ring-blue-100"
            >
              {options.vendors.map((vendor) => (
                <option key={vendor.id} value={vendor.id}>
                  {vendor.name}
                </option>
              ))}
            </select>
          </label>

          <label className="space-y-1.5">
            <span className="text-xs font-bold text-slate-500">Campaigns</span>
            <select
              multiple
              value={campaignIds}
              onChange={(event) => setCampaignIds(selectedValues(event.currentTarget))}
              className="min-h-24 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 outline-none focus:border-blue-400 focus:ring-4 focus:ring-blue-100"
            >
              {filteredCampaigns.map((campaign) => (
                <option key={campaign.id} value={campaign.id}>
                  {campaign.vendorName} / {campaign.name}
                </option>
              ))}
            </select>
          </label>

          <label className="space-y-1.5">
            <span className="text-xs font-bold text-slate-500">Loan officers</span>
            <select
              multiple
              value={assignedUserIds}
              onChange={(event) => setAssignedUserIds(selectedValues(event.currentTarget))}
              className="min-h-24 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 outline-none focus:border-blue-400 focus:ring-4 focus:ring-blue-100"
            >
              {options.loanOfficers.map((user) => (
                <option key={user.id} value={user.id}>
                  {user.name}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="mt-4 flex flex-wrap gap-3">
          <label className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-semibold text-slate-700">
            <input
              type="checkbox"
              checked={includeUnassigned}
              onChange={(event) => setIncludeUnassigned(event.target.checked)}
              className="h-4 w-4 rounded border-slate-300 text-blue-600"
            />
            Include unassigned leads
          </label>
          <label className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-semibold text-slate-700">
            <input
              type="checkbox"
              checked={includeMissingPrice}
              onChange={(event) => setIncludeMissingPrice(event.target.checked)}
              className="h-4 w-4 rounded border-slate-300 text-blue-600"
            />
            Show missing-price leads
          </label>
        </div>
      </section>

      <section className="grid gap-4 lg:grid-cols-4">
        <KpiCard
          title="Total spend"
          value={formatCurrency(report.summary.totalSpend)}
          subtitle={`${formatNumber(report.summary.pricedLeadCount)} priced leads`}
          Icon={Banknote}
          tone="sky"
        />
        <KpiCard
          title="Company-paid"
          value={formatCurrency(report.summary.companyPaidSpend)}
          subtitle="LeadPoint + LendingTree billing base"
          Icon={Landmark}
          tone="blue"
        />
        <KpiCard
          title="Direct-billed"
          value={formatCurrency(report.summary.directBilledSpend)}
          subtitle="FRU and direct-vendor spend"
          Icon={ReceiptText}
          tone="emerald"
        />
        <KpiCard
          title="Missing price"
          value={formatNumber(report.summary.missingPriceCount)}
          subtitle={`${formatNumber(report.summary.totalLeadCount)} total leads in scope`}
          Icon={AlertTriangle}
          tone="amber"
        />
      </section>

      <section className="grid gap-5 xl:grid-cols-[1.1fr_0.9fr]">
        <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
            <div>
              <h3 className="flex items-center gap-2 text-base font-bold text-slate-900">
                <Users className="h-4 w-4 text-blue-600" />
                Billing by loan officer
              </h3>
              <p className="mt-1 text-xs text-slate-500">
                Expand a row to see vendor and campaign spend behind each total.
              </p>
            </div>
            <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-bold text-slate-500">
              {report.loanOfficerRows.length} owners
            </span>
          </div>

          <div className="max-h-[560px] overflow-auto">
            <table className="w-full text-sm">
              <thead className="sticky top-0 z-[1] bg-slate-50 text-[11px] font-bold uppercase tracking-wider text-slate-500">
                <tr>
                  <th className="px-5 py-3 text-left">
                    <SortHeader
                      label={OFFICER_SORT_LABELS.loanOfficerName}
                      sortKey="loanOfficerName"
                      activeKey={officerSort.key}
                      direction={officerSort.direction}
                      onSort={updateOfficerSort}
                    />
                  </th>
                  <th className="px-5 py-3 text-right">
                    <SortHeader
                      label={OFFICER_SORT_LABELS.totalSpend}
                      sortKey="totalSpend"
                      activeKey={officerSort.key}
                      direction={officerSort.direction}
                      align="right"
                      onSort={updateOfficerSort}
                    />
                  </th>
                  <th className="px-5 py-3 text-right">
                    <SortHeader
                      label={OFFICER_SORT_LABELS.leadCount}
                      sortKey="leadCount"
                      activeKey={officerSort.key}
                      direction={officerSort.direction}
                      align="right"
                      onSort={updateOfficerSort}
                    />
                  </th>
                  <th className="px-5 py-3 text-right">
                    <SortHeader
                      label={OFFICER_SORT_LABELS.averagePrice}
                      sortKey="averagePrice"
                      activeKey={officerSort.key}
                      direction={officerSort.direction}
                      align="right"
                      onSort={updateOfficerSort}
                    />
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {sortedOfficerRows.map((row) => {
                  const key = row.assignedUserId ?? '__unassigned__';
                  const expanded = expandedOfficerIds.has(key);
                  return (
                    <React.Fragment key={key}>
                      <tr className="hover:bg-slate-50/70">
                        <td className="px-5 py-4">
                          <button
                            type="button"
                            onClick={() => toggleOfficer(key)}
                            className="flex items-center gap-3 text-left"
                          >
                            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-slate-100 text-slate-600">
                              {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                            </span>
                            <span>
                              <span className="block font-semibold text-slate-900">{row.loanOfficerName}</span>
                              <span className="block text-xs text-slate-500">{row.loanOfficerEmail ?? 'No assignee'}</span>
                            </span>
                          </button>
                        </td>
                        <td className="px-5 py-4 text-right font-bold text-slate-900">
                          {formatCurrency(row.totalSpend)}
                        </td>
                        <td className="px-5 py-4 text-right text-slate-600">
                          {formatNumber(row.leadCount)}
                        </td>
                        <td className="px-5 py-4 text-right text-slate-600">
                          {formatCurrency(row.averagePrice)}
                        </td>
                      </tr>
                      {expanded && (
                        <tr>
                          <td colSpan={4} className="bg-slate-50/70 px-5 py-4">
                            <div className="grid gap-2">
                              {row.breakdown.map((item) => (
                                <div
                                  key={`${item.vendorId}:${item.campaignId ?? 'none'}`}
                                  className="flex items-center justify-between rounded-xl border border-slate-200 bg-white px-4 py-3"
                                >
                                  <div>
                                    <p className="text-sm font-bold text-slate-800">{item.campaignName}</p>
                                    <p className="text-xs text-slate-500">{item.vendorName} • {formatNumber(item.leadCount)} leads</p>
                                  </div>
                                  <p className="text-sm font-bold text-slate-900">{formatCurrency(item.totalSpend)}</p>
                                </div>
                              ))}
                            </div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })}
                {report.loanOfficerRows.length === 0 && (
                  <tr>
                    <td colSpan={4} className="px-5 py-12 text-center text-sm text-slate-500">
                      No lead spend matched these filters.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-100 px-5 py-4">
            <h3 className="flex items-center gap-2 text-base font-bold text-slate-900">
              <Building2 className="h-4 w-4 text-emerald-600" />
              Vendor & campaign mix
            </h3>
            <p className="mt-1 text-xs text-slate-500">
              The highest-spend campaign and assignee combinations.
            </p>
          </div>
          <div className="max-h-[560px] overflow-auto">
            <table className="w-full text-sm">
              <thead className="sticky top-0 z-[1] bg-slate-50 text-[11px] font-bold uppercase tracking-wider text-slate-500">
                <tr>
                  <th className="px-5 py-3 text-left">
                    <SortHeader
                      label={CAMPAIGN_SORT_LABELS.campaignName}
                      sortKey="campaignName"
                      activeKey={campaignSort.key}
                      direction={campaignSort.direction}
                      onSort={updateCampaignSort}
                    />
                  </th>
                  <th className="px-5 py-3 text-right">
                    <SortHeader
                      label={CAMPAIGN_SORT_LABELS.totalSpend}
                      sortKey="totalSpend"
                      activeKey={campaignSort.key}
                      direction={campaignSort.direction}
                      align="right"
                      onSort={updateCampaignSort}
                    />
                  </th>
                  <th className="px-5 py-3 text-right">
                    <SortHeader
                      label={CAMPAIGN_SORT_LABELS.leadCount}
                      sortKey="leadCount"
                      activeKey={campaignSort.key}
                      direction={campaignSort.direction}
                      align="right"
                      onSort={updateCampaignSort}
                    />
                  </th>
                  <th className="px-5 py-3 text-right">
                    <SortHeader
                      label={CAMPAIGN_SORT_LABELS.averagePrice}
                      sortKey="averagePrice"
                      activeKey={campaignSort.key}
                      direction={campaignSort.direction}
                      align="right"
                      onSort={updateCampaignSort}
                    />
                  </th>
                  <th className="px-5 py-3 text-right">
                    <SortHeader
                      label={CAMPAIGN_SORT_LABELS.missingPriceCount}
                      sortKey="missingPriceCount"
                      activeKey={campaignSort.key}
                      direction={campaignSort.direction}
                      align="right"
                      onSort={updateCampaignSort}
                    />
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {sortedCampaignRows.map((row) => (
                  <tr
                    key={`${row.vendorId}:${row.campaignId}:${row.assignedUserId}`}
                    className="hover:bg-slate-50/70"
                  >
                    <td className="px-5 py-4">
                      <p className="font-semibold text-slate-900">{row.campaignName}</p>
                      <p className="mt-1 text-xs text-slate-500">
                        {row.vendorName} • {row.loanOfficerName}
                      </p>
                    </td>
                    <td className="whitespace-nowrap px-5 py-4 text-right font-bold text-slate-900">
                      {formatCurrency(row.totalSpend)}
                    </td>
                    <td className="px-5 py-4 text-right text-slate-600">
                      {formatNumber(row.leadCount)}
                    </td>
                    <td className="px-5 py-4 text-right text-slate-600">
                      {formatCurrency(row.averagePrice)}
                    </td>
                    <td className="px-5 py-4 text-right text-slate-600">
                      {row.missingPriceCount > 0 ? (
                        <span className="rounded-full bg-amber-50 px-2 py-1 text-xs font-bold text-amber-700">
                          {formatNumber(row.missingPriceCount)}
                        </span>
                      ) : (
                        '0'
                      )}
                    </td>
                  </tr>
                ))}
                {report.campaignRows.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-5 py-12 text-center text-sm text-slate-500">
                      No campaign spend matched these filters.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-5 py-4">
          <div>
            <h3 className="flex items-center gap-2 text-base font-bold text-slate-900">
              <Search className="h-4 w-4 text-slate-600" />
              Audit detail
            </h3>
            <p className="mt-1 text-xs text-slate-500">
              Latest 300 matching leads for spot-checking billing records.
            </p>
          </div>
          <div className="inline-flex items-center gap-2 rounded-full bg-slate-100 px-3 py-1.5 text-xs font-bold text-slate-500">
            <CalendarDays className="h-3.5 w-3.5" />
            {rangeLabel}
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-[11px] font-bold uppercase tracking-wider text-slate-500">
              <tr>
                <th className="px-5 py-3 text-left">Received</th>
                <th className="px-5 py-3 text-left">Borrower</th>
                <th className="px-5 py-3 text-left">Loan Officer</th>
                <th className="px-5 py-3 text-left">Campaign</th>
                <th className="px-5 py-3 text-right">Price</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {report.detailRows.map((lead) => (
                <tr key={lead.id} className="hover:bg-slate-50/70">
                  <td className="whitespace-nowrap px-5 py-3 text-xs text-slate-500">
                    {formatDateTime(lead.receivedAt)}
                  </td>
                  <td className="px-5 py-3">
                    <p className="font-bold text-slate-900">{lead.borrowerName}</p>
                    <p className="text-xs text-slate-500">Lead ID {lead.vendorLeadId ?? '—'}</p>
                  </td>
                  <td className="px-5 py-3 text-slate-700">
                    <span className="inline-flex items-center gap-2">
                      <UserRound className="h-3.5 w-3.5 text-slate-400" />
                      {lead.loanOfficerName}
                    </span>
                  </td>
                  <td className="px-5 py-3">
                    <p className="font-semibold text-slate-800">{lead.campaignName}</p>
                    <p className="text-xs text-slate-500">{lead.vendorName} / {lead.routingTag ?? 'no tag'}</p>
                  </td>
                  <td className="px-5 py-3 text-right font-bold text-slate-900">
                    {lead.price === null ? (
                      <span className="rounded-full bg-amber-50 px-2 py-1 text-xs font-bold text-amber-700">
                        Missing
                      </span>
                    ) : (
                      formatCurrency(lead.price)
                    )}
                  </td>
                </tr>
              ))}
              {report.detailRows.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-5 py-12 text-center">
                    <BarChart3 className="mx-auto h-10 w-10 text-slate-300" />
                    <p className="mt-3 text-sm font-bold text-slate-700">
                      No matching lead records
                    </p>
                    <p className="mt-1 text-sm text-slate-500">
                      Adjust the filters or date range to widen the report.
                    </p>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

    </div>
  );
}
