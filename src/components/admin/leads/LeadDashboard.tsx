'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { Inbox, Megaphone, Globe, ArrowRight, Users, UserCog, Upload } from 'lucide-react';
import { CsvUploadModal } from './CsvUploadModal';

type DashboardStats = {
  totalToday: number;
  unassigned: number;
  recentLeads: Array<{
    id: string;
    firstName: string | null;
    lastName: string | null;
    status: string;
    receivedAt: string;
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

export function LeadDashboard({
  stats,
  csvMappings = [],
}: {
  stats: DashboardStats;
  csvMappings?: SavedMapping[];
}) {
  const [csvOpen, setCsvOpen] = useState(false);

  return (
    <div className="space-y-6">
      {/* Stat cards + Upload button */}
      <div className="flex items-center justify-between">
        <div />
        <button
          type="button"
          className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-blue-700 transition-colors"
          onClick={() => setCsvOpen(true)}
        >
          <Upload className="h-4 w-4" />
          Upload CSV
        </button>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-4">
        <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-50 text-blue-600">
              <Inbox className="h-5 w-5" />
            </div>
            <div>
              <p className="text-2xl font-bold text-slate-900">{stats.totalToday}</p>
              <p className="text-xs text-slate-500">Leads Today</p>
            </div>
          </div>
        </div>
        <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-orange-50 text-orange-600">
              <Users className="h-5 w-5" />
            </div>
            <div>
              <p className="text-2xl font-bold text-slate-900">{stats.unassigned}</p>
              <p className="text-xs text-slate-500">Unassigned</p>
            </div>
          </div>
        </div>
        <Link
          href="/admin/leads/vendors"
          className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm hover:shadow-md hover:border-blue-300 transition-all group"
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-slate-50 text-slate-600">
                <Globe className="h-5 w-5" />
              </div>
              <div>
                <p className="text-sm font-semibold text-slate-900">Vendors</p>
                <p className="text-xs text-slate-500">Manage sources</p>
              </div>
            </div>
            <ArrowRight className="h-4 w-4 text-slate-400 group-hover:text-blue-600 transition-colors" />
          </div>
        </Link>
        <Link
          href="/admin/leads/campaigns"
          className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm hover:shadow-md hover:border-blue-300 transition-all group"
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-slate-50 text-slate-600">
                <Megaphone className="h-5 w-5" />
              </div>
              <div>
                <p className="text-sm font-semibold text-slate-900">Campaigns</p>
                <p className="text-xs text-slate-500">Distribution rules</p>
              </div>
            </div>
            <ArrowRight className="h-4 w-4 text-slate-400 group-hover:text-blue-600 transition-colors" />
          </div>
        </Link>
        <Link
          href="/admin/leads/users"
          className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm hover:shadow-md hover:border-blue-300 transition-all group"
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-slate-50 text-slate-600">
                <UserCog className="h-5 w-5" />
              </div>
              <div>
                <p className="text-sm font-semibold text-slate-900">Users</p>
                <p className="text-xs text-slate-500">Quotas &amp; schedules</p>
              </div>
            </div>
            <ArrowRight className="h-4 w-4 text-slate-400 group-hover:text-blue-600 transition-colors" />
          </div>
        </Link>
      </div>

      {/* Recent leads table */}
      <div className="bg-white border border-slate-200 rounded-xl shadow-sm">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200">
          <h2 className="text-lg font-semibold text-slate-900">Recent Leads</h2>
          <Link href="/admin/leads/pool" className="text-sm font-medium text-blue-600 hover:text-blue-700 transition-colors">
            View Pool &rarr;
          </Link>
        </div>
        {stats.recentLeads.length === 0 ? (
          <div className="p-12 text-center">
            <Inbox className="mx-auto h-10 w-10 text-slate-300" />
            <p className="mt-3 text-sm font-semibold text-slate-700">No leads yet</p>
            <p className="mt-1 text-sm text-slate-500">Leads will appear here as they are received from vendors.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50">
                <tr className="border-b border-slate-200">
                  <th className="px-6 py-3 text-left text-[11px] font-bold uppercase tracking-wider text-slate-500">Status</th>
                  <th className="px-6 py-3 text-left text-[11px] font-bold uppercase tracking-wider text-slate-500">Name</th>
                  <th className="px-6 py-3 text-left text-[11px] font-bold uppercase tracking-wider text-slate-500">Vendor</th>
                  <th className="px-6 py-3 text-left text-[11px] font-bold uppercase tracking-wider text-slate-500">Campaign</th>
                  <th className="px-6 py-3 text-left text-[11px] font-bold uppercase tracking-wider text-slate-500">Assigned To</th>
                  <th className="px-6 py-3 text-left text-[11px] font-bold uppercase tracking-wider text-slate-500">Received</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {stats.recentLeads.map((l) => (
                  <tr key={l.id} className="hover:bg-slate-50/70">
                    <td className="px-6 py-3">
                      <span className={`inline-flex rounded-full border px-2.5 py-0.5 text-xs font-semibold ${STATUS_COLORS[l.status] || STATUS_COLORS.NEW}`}>
                        {l.status}
                      </span>
                    </td>
                    <td className="px-6 py-3 font-semibold text-slate-900">
                      {[l.firstName, l.lastName].filter(Boolean).join(' ') || '—'}
                    </td>
                    <td className="px-6 py-3 text-slate-600">{l.vendor?.name || '—'}</td>
                    <td className="px-6 py-3 text-slate-600">{l.campaign?.name || '—'}</td>
                    <td className="px-6 py-3 text-slate-600">{l.assignedUser?.name || <span className="text-orange-600 font-medium">Unassigned</span>}</td>
                    <td className="px-6 py-3 text-xs text-slate-500">
                      {new Date(l.receivedAt).toLocaleString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <CsvUploadModal
        open={csvOpen}
        onClose={() => setCsvOpen(false)}
        savedMappings={csvMappings}
      />
    </div>
  );
}
