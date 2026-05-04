'use client';

import React, { useMemo, useState, useTransition } from 'react';
import {
  AlertTriangle,
  ArrowUpRight,
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
  Sparkles,
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
  { value: 'today', label: 'Today' },
  { value: 'yesterday', label: 'Yesterday' },
  { value: 'last7', label: 'Last 7 Days' },
  { value: 'mtd', label: 'Month to Date' },
  { value: 'lastMonth', label: 'Last Month' },
  { value: 'custom', label: 'Custom' },
];

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
  tone: 'slate' | 'blue' | 'emerald' | 'amber';
}) {
  const tones = {
    slate: 'from-slate-950 to-slate-800 text-white ring-slate-700',
    blue: 'from-blue-600 to-indigo-700 text-white ring-blue-500',
    emerald: 'from-emerald-500 to-teal-700 text-white ring-emerald-400',
    amber: 'from-amber-400 to-orange-600 text-slate-950 ring-amber-300',
  };

  return (
    <div className={cx('relative overflow-hidden rounded-3xl bg-gradient-to-br p-5 shadow-sm ring-1', tones[tone])}>
      <div className="absolute -right-5 -top-5 h-24 w-24 rounded-full bg-white/10" />
      <div className="relative flex items-start justify-between gap-4">
        <div>
          <p className={cx('text-xs font-bold uppercase tracking-[0.18em]', tone === 'amber' ? 'text-slate-800/70' : 'text-white/70')}>
            {title}
          </p>
          <p className="mt-3 text-3xl font-black tracking-tight">{value}</p>
          <p className={cx('mt-2 text-sm', tone === 'amber' ? 'text-slate-800/75' : 'text-white/75')}>
            {subtitle}
          </p>
        </div>
        <div className={cx('rounded-2xl p-3 ring-1', tone === 'amber' ? 'bg-white/30 ring-slate-900/10' : 'bg-white/15 ring-white/20')}>
          <Icon className="h-5 w-5" />
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

  function applyPreset(nextPreset: Preset) {
    setPreset(nextPreset);
    if (nextPreset === 'custom') return;
    const range = rangeForPreset(nextPreset);
    setStartDate(range.startDate);
    setEndDate(range.endDate);
  }

  function refreshReport() {
    startTransition(async () => {
      const next = await getLeadSpendReport({
        startDate,
        endDate,
        vendorIds,
        campaignIds,
        assignedUserIds,
        billingFocus,
        includeUnassigned,
        includeMissingPrice,
      });
      setReport(next);
    });
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
    <div className="space-y-6">
      <section className="relative overflow-hidden rounded-[2rem] border border-slate-200 bg-slate-950 p-6 text-white shadow-xl sm:p-8">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(59,130,246,0.32),transparent_35%),radial-gradient(circle_at_bottom_left,rgba(16,185,129,0.2),transparent_30%)]" />
        <div className="relative grid gap-6 lg:grid-cols-[1.35fr_0.65fr] lg:items-end">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/10 px-3 py-1 text-xs font-semibold text-white/80">
              <Sparkles className="h-3.5 w-3.5" />
              Lead spend command center
            </div>
            <h2 className="mt-5 max-w-3xl text-3xl font-black tracking-tight sm:text-5xl">
              Billable lead spend, sliced by LO, vendor, and campaign.
            </h2>
            <p className="mt-4 max-w-2xl text-sm leading-6 text-slate-300 sm:text-base">
              A finance-grade view of where lead dollars went, who owns the
              spend, and which records still need pricing cleanup before billing.
            </p>
          </div>
          <div className="rounded-3xl border border-white/10 bg-white/10 p-5 backdrop-blur">
            <p className="text-xs font-bold uppercase tracking-[0.2em] text-white/60">
              Current report
            </p>
            <p className="mt-3 text-2xl font-black">{formatCurrency(report.summary.totalSpend)}</p>
            <p className="mt-2 text-sm text-slate-300">{rangeLabel}</p>
            <p className="mt-4 text-xs text-slate-400">
              Generated {formatDateTime(report.generatedAt)}
            </p>
          </div>
        </div>
      </section>

      <section className="rounded-[1.75rem] border border-slate-200 bg-white/95 p-5 shadow-sm">
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
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
            className="inline-flex items-center gap-2 rounded-xl bg-slate-950 px-4 py-2.5 text-sm font-bold text-white shadow-sm transition hover:bg-slate-800 disabled:opacity-60"
          >
            {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            Run report
          </button>
        </div>

        <div className="grid gap-4 xl:grid-cols-[1.05fr_1fr]">
          <div className="space-y-3">
            <p className="text-[11px] font-black uppercase tracking-[0.18em] text-slate-400">
              Billing focus
            </p>
            <div className="grid gap-2 sm:grid-cols-3">
              {BILLING_FOCUS_OPTIONS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => setBillingFocus(option.value)}
                  className={cx(
                    'rounded-2xl border px-4 py-3 text-left transition',
                    billingFocus === option.value
                      ? 'border-slate-950 bg-slate-950 text-white shadow-sm'
                      : 'border-slate-200 bg-slate-50 text-slate-700 hover:bg-white'
                  )}
                >
                  <span className="block text-sm font-black">{option.label}</span>
                  <span className={cx('mt-1 block text-xs', billingFocus === option.value ? 'text-slate-300' : 'text-slate-500')}>
                    {option.description}
                  </span>
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-3">
            <p className="text-[11px] font-black uppercase tracking-[0.18em] text-slate-400">
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
                      ? 'bg-blue-600 text-white shadow-sm'
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
              className="min-h-28 w-full rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 outline-none focus:border-blue-400 focus:ring-4 focus:ring-blue-100"
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
              className="min-h-28 w-full rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 outline-none focus:border-blue-400 focus:ring-4 focus:ring-blue-100"
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
              className="min-h-28 w-full rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 outline-none focus:border-blue-400 focus:ring-4 focus:ring-blue-100"
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
          tone="slate"
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
        <div className="overflow-hidden rounded-[1.75rem] border border-slate-200 bg-white shadow-sm">
          <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
            <div>
              <h3 className="flex items-center gap-2 text-base font-black text-slate-900">
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

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-[11px] font-black uppercase tracking-wider text-slate-500">
                <tr>
                  <th className="px-5 py-3 text-left">Loan Officer</th>
                  <th className="px-5 py-3 text-right">Spend</th>
                  <th className="px-5 py-3 text-right">Leads</th>
                  <th className="px-5 py-3 text-right">Avg</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {report.loanOfficerRows.map((row) => {
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
                            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-slate-100 text-slate-600">
                              {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                            </span>
                            <span>
                              <span className="block font-black text-slate-900">{row.loanOfficerName}</span>
                              <span className="block text-xs text-slate-500">{row.loanOfficerEmail ?? 'No assignee'}</span>
                            </span>
                          </button>
                        </td>
                        <td className="px-5 py-4 text-right font-black text-slate-900">
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
                                  className="flex items-center justify-between rounded-2xl border border-slate-200 bg-white px-4 py-3"
                                >
                                  <div>
                                    <p className="text-sm font-bold text-slate-800">{item.campaignName}</p>
                                    <p className="text-xs text-slate-500">{item.vendorName} • {formatNumber(item.leadCount)} leads</p>
                                  </div>
                                  <p className="text-sm font-black text-slate-900">{formatCurrency(item.totalSpend)}</p>
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

        <div className="overflow-hidden rounded-[1.75rem] border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-100 px-5 py-4">
            <h3 className="flex items-center gap-2 text-base font-black text-slate-900">
              <Building2 className="h-4 w-4 text-emerald-600" />
              Vendor & campaign mix
            </h3>
            <p className="mt-1 text-xs text-slate-500">
              The highest-spend campaign and assignee combinations.
            </p>
          </div>
          <div className="max-h-[520px] overflow-auto">
            {report.campaignRows.slice(0, 20).map((row) => (
              <div key={`${row.vendorId}:${row.campaignId}:${row.assignedUserId}`} className="border-b border-slate-100 px-5 py-4 last:border-b-0">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="text-sm font-black text-slate-900">{row.campaignName}</p>
                    <p className="mt-1 text-xs text-slate-500">
                      {row.vendorName} • {row.loanOfficerName}
                    </p>
                  </div>
                  <p className="whitespace-nowrap text-sm font-black text-slate-900">
                    {formatCurrency(row.totalSpend)}
                  </p>
                </div>
                <div className="mt-3 flex items-center gap-3 text-xs text-slate-500">
                  <span>{formatNumber(row.leadCount)} leads</span>
                  <span>{formatCurrency(row.averagePrice)} avg</span>
                  {row.missingPriceCount > 0 && (
                    <span className="rounded-full bg-amber-50 px-2 py-0.5 font-bold text-amber-700">
                      {row.missingPriceCount} missing price
                    </span>
                  )}
                </div>
              </div>
            ))}
            {report.campaignRows.length === 0 && (
              <div className="px-5 py-12 text-center text-sm text-slate-500">
                No campaign spend matched these filters.
              </div>
            )}
          </div>
        </div>
      </section>

      <section className="overflow-hidden rounded-[1.75rem] border border-slate-200 bg-white shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-5 py-4">
          <div>
            <h3 className="flex items-center gap-2 text-base font-black text-slate-900">
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
            <thead className="bg-slate-50 text-[11px] font-black uppercase tracking-wider text-slate-500">
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
                  <td className="px-5 py-3 text-right font-black text-slate-900">
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

      <div className="flex items-center justify-between rounded-3xl border border-blue-100 bg-blue-50/70 px-5 py-4 text-sm text-blue-900">
        <div>
          <p className="font-black">Built for expansion</p>
          <p className="mt-1 text-blue-800/80">
            Lead price powers this first report. The same surface can later add
            conversion, return rate, ROI, and vendor quality reporting.
          </p>
        </div>
        <ArrowUpRight className="hidden h-5 w-5 sm:block" />
      </div>
    </div>
  );
}
