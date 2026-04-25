'use client';

import React, { useState, useCallback } from 'react';
import Link from 'next/link';
import {
  Database,
  Globe,
  Megaphone,
  UserCog,
  Upload,
  Inbox,
  Loader2,
  Zap,
} from 'lucide-react';
import { CsvUploadModal } from './CsvUploadModal';
import { LeadDetailModal } from './LeadDetailModal';
import { getLead } from '@/app/actions/leadActions';
import { FormatDate } from '@/components/ui/FormatDate';

type DashboardStats = {
  totalToday: number;
  unassigned: number;
  recentLeads: Array<{
    id: string;
    firstName: string | null;
    lastName: string | null;
    status: string;
    receivedAt: string;
    source: string | null;
    vendor: { name: string } | null;
    campaign: { name: string } | null;
    assignedUser: { name: string } | null;
  }>;
};

const STATUS_COLORS: Record<string, string> = {
  NEW: 'border-blue-200 bg-blue-50 text-blue-700',
  CONTACTED: 'border-amber-200 bg-amber-50 text-amber-700',
  WORKING: 'border-indigo-200 bg-indigo-50 text-indigo-700',
  CONVERTED: 'border-green-200 bg-green-50 text-green-700',
  DEAD: 'border-slate-200 bg-slate-100 text-slate-500',
  RETURNED: 'border-rose-200 bg-rose-50 text-rose-700',
  UNASSIGNED: 'border-orange-200 bg-orange-50 text-orange-700',
};

type SavedMapping = { csvHeader: string; ourField: string; usageCount: number };
type EligibleUser = { id: string; name: string; email: string; role?: string };

const NAV_CARDS = [
  {
    title: 'Leads',
    subtitle: 'Browse, filter, and manage your entire lead database.',
    href: '/admin/leads/all',
    Icon: Database,
    border: 'border-emerald-200 hover:border-emerald-300',
    iconBg: 'bg-emerald-600',
    watermark: 'text-emerald-600',
    cta: 'bg-emerald-50 text-emerald-700 group-hover:bg-emerald-600 group-hover:text-white',
    ctaLabel: 'Browse Leads',
  },
  {
    title: 'Vendors',
    subtitle: 'Configure lead sources, webhook endpoints, and field mappings.',
    href: '/admin/leads/vendors',
    Icon: Globe,
    border: 'border-violet-200 hover:border-violet-300',
    iconBg: 'bg-violet-600',
    watermark: 'text-violet-600',
    cta: 'bg-violet-50 text-violet-700 group-hover:bg-violet-600 group-hover:text-white',
    ctaLabel: 'Manage Vendors',
  },
  {
    title: 'Campaigns',
    subtitle: 'Set up distribution rules, routing tags, and auto-assignment logic.',
    href: '/admin/leads/campaigns',
    Icon: Megaphone,
    border: 'border-blue-200 hover:border-blue-300',
    iconBg: 'bg-blue-600',
    watermark: 'text-blue-600',
    cta: 'bg-blue-50 text-blue-700 group-hover:bg-blue-600 group-hover:text-white',
    ctaLabel: 'Manage Campaigns',
  },
  {
    title: 'Users',
    subtitle: 'Control quotas, licensed states, schedules, and campaign access.',
    href: '/admin/leads/users',
    Icon: UserCog,
    border: 'border-orange-200 hover:border-orange-300',
    iconBg: 'bg-orange-500',
    watermark: 'text-orange-500',
    cta: 'bg-orange-50 text-orange-700 group-hover:bg-orange-500 group-hover:text-white',
    ctaLabel: 'Manage Users',
  },
  {
    title: 'Services',
    subtitle: 'Outbound push targets like Bonzo. Used by the Leads Push to Service button.',
    href: '/admin/leads/services',
    Icon: Zap,
    border: 'border-indigo-200 hover:border-indigo-300',
    iconBg: 'bg-indigo-600',
    watermark: 'text-indigo-600',
    cta: 'bg-indigo-50 text-indigo-700 group-hover:bg-indigo-600 group-hover:text-white',
    ctaLabel: 'Manage Services',
  },
] as const;

export function LeadDashboard({
  stats,
  csvMappings = [],
  eligibleUsers = [],
  onOpenCsv,
}: {
  stats: DashboardStats;
  csvMappings?: SavedMapping[];
  eligibleUsers?: EligibleUser[];
  onOpenCsv?: () => void;
}) {
  const [csvOpen, setCsvOpen] = useState(false);
  const [detailLead, setDetailLead] = useState<React.ComponentProps<typeof LeadDetailModal>['lead'] | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const handleCsvOpen = () => {
    if (onOpenCsv) onOpenCsv();
    else setCsvOpen(true);
  };

  const openLeadDetail = useCallback(async (leadId: string) => {
    setDetailLoading(true);
    try {
      const full = await getLead(leadId);
      if (full) {
        setDetailLead({
          ...full,
          receivedAt: full.receivedAt.toISOString(),
          assignedAt: full.assignedAt?.toISOString() ?? null,
          notes: full.notes.map((n) => ({
            ...n,
            createdAt: n.createdAt.toISOString(),
          })),
        } as React.ComponentProps<typeof LeadDetailModal>['lead']);
      }
    } finally {
      setDetailLoading(false);
    }
  }, []);

  return (
    <div className="space-y-8">
      {/* Primary Navigation Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-5">
        {NAV_CARDS.map((card) => (
          <Link
            key={card.href}
            href={card.href}
            className={`group relative flex flex-col items-start p-5 sm:p-6 rounded-2xl border shadow-sm text-left overflow-hidden bg-white hover:shadow-md transition-all ${card.border}`}
          >
            <div className="absolute top-0 right-0 p-6 opacity-[0.04] group-hover:opacity-[0.08] transition-opacity">
              <card.Icon className={`w-24 h-24 ${card.watermark}`} />
            </div>
            <div
              className={`w-12 h-12 rounded-xl flex items-center justify-center mb-4 shadow-sm text-white group-hover:scale-105 transition-transform ${card.iconBg}`}
            >
              <card.Icon className="w-6 h-6" />
            </div>
            <h3 className="text-lg font-bold text-slate-900 mb-1">
              {card.title}
            </h3>
            <p className="text-slate-500 text-sm mb-6 leading-relaxed">
              {card.subtitle}
            </p>
            <div
              className={`mt-auto w-full inline-flex items-center justify-center px-4 py-2.5 rounded-xl font-semibold text-sm transition-colors ${card.cta}`}
            >
              {card.ctaLabel}
            </div>
          </Link>
        ))}
      </div>

      {/* Quick Actions Bar */}
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-blue-700 transition-colors"
          onClick={handleCsvOpen}
        >
          <Upload className="h-4 w-4" />
          Upload CSV
        </button>
        <Link
          href="/admin/leads/pool"
          className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-5 py-2.5 text-sm font-semibold text-slate-700 shadow-sm hover:bg-slate-50 transition-colors"
        >
          View Unassigned Pool &rarr;
        </Link>
      </div>

      {/* Recent Leads */}
      <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-100">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-base font-bold text-slate-900">
                Recent Leads
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Latest incoming leads across all sources
              </p>
            </div>
            <Link
              href="/admin/leads/all"
              className="text-sm font-semibold text-blue-600 hover:text-blue-700 transition-colors"
            >
              View All &rarr;
            </Link>
          </div>
        </div>
        {stats.recentLeads.length === 0 ? (
          <div className="px-6 py-16 text-center">
            <Inbox className="mx-auto h-10 w-10 text-slate-300" />
            <p className="mt-3 text-sm font-semibold text-slate-700">
              No leads yet
            </p>
            <p className="mt-1 text-sm text-slate-500">
              Leads will appear here as they are received from vendors or
              uploaded via CSV.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100 bg-slate-50/60">
                  <th className="px-6 py-3 text-left text-[11px] font-bold uppercase tracking-wider text-slate-500">
                    Status
                  </th>
                  <th className="px-6 py-3 text-left text-[11px] font-bold uppercase tracking-wider text-slate-500">
                    Name
                  </th>
                  <th className="px-6 py-3 text-left text-[11px] font-bold uppercase tracking-wider text-slate-500">
                    Source
                  </th>
                  <th className="px-6 py-3 text-left text-[11px] font-bold uppercase tracking-wider text-slate-500">
                    Vendor
                  </th>
                  <th className="px-6 py-3 text-left text-[11px] font-bold uppercase tracking-wider text-slate-500">
                    Assigned To
                  </th>
                  <th className="px-6 py-3 text-right text-[11px] font-bold uppercase tracking-wider text-slate-500">
                    Received
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {stats.recentLeads.map((l) => (
                  <tr
                    key={l.id}
                    className="hover:bg-slate-50/70 transition-colors cursor-pointer"
                    onClick={() => void openLeadDetail(l.id)}
                  >
                    <td className="px-6 py-3">
                      <span
                        className={`inline-flex rounded-full border px-2.5 py-0.5 text-[11px] font-semibold ${STATUS_COLORS[l.status] || STATUS_COLORS.NEW}`}
                      >
                        {l.status}
                      </span>
                    </td>
                    <td className="px-6 py-3 font-semibold text-slate-900 whitespace-nowrap">
                      {[l.firstName, l.lastName].filter(Boolean).join(' ') ||
                        '—'}
                    </td>
                    <td className="px-6 py-3 text-slate-500 text-xs">
                      {l.source || '—'}
                    </td>
                    <td className="px-6 py-3 text-slate-600">
                      {l.vendor?.name || '—'}
                    </td>
                    <td className="px-6 py-3">
                      {l.assignedUser?.name || (
                        <span className="text-orange-600 font-medium text-xs">
                          Unassigned
                        </span>
                      )}
                    </td>
                    <td className="px-6 py-3 text-right text-xs text-slate-500 whitespace-nowrap">
                      <FormatDate date={l.receivedAt} mode="datetime" />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {detailLoading && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-white/80 backdrop-blur-[1px]">
          <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
        </div>
      )}

      {detailLead && (
        <LeadDetailModal
          lead={detailLead}
          onClose={() => setDetailLead(null)}
          onUpdated={() => {}}
        />
      )}

      <CsvUploadModal
        open={csvOpen}
        onClose={() => setCsvOpen(false)}
        savedMappings={csvMappings}
        eligibleUsers={eligibleUsers}
      />
    </div>
  );
}
