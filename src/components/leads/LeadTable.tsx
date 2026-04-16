'use client';

import React, { useState, useMemo } from 'react';
import { Search, Inbox } from 'lucide-react';
import { LeadStatusBadge } from './LeadStatusBadge';
import { LeadDetailPanel } from './LeadDetailPanel';
import { getLead } from '@/app/actions/leadActions';
import { FormatDate } from '@/components/ui/FormatDate';

type LeadRow = {
  id: string;
  status: string;
  firstName: string | null;
  lastName: string | null;
  phone: string | null;
  propertyState: string | null;
  loanPurpose: string | null;
  loanAmount: string | null;
  receivedAt: string;
  vendor: { name: string } | null;
  campaign: { id: string; name: string } | null;
  _count: { notes: number };
};

type LeadDetail = NonNullable<Awaited<ReturnType<typeof getLead>>>;

export function LeadTable({ leads }: { leads: LeadRow[] }) {
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [selectedLead, setSelectedLead] = useState<LeadDetail | null>(null);
  const [loadingId, setLoadingId] = useState<string | null>(null);

  const filtered = useMemo(() => {
    let result = leads;
    if (statusFilter) {
      result = result.filter((l) => l.status === statusFilter);
    }
    if (search) {
      const q = search.toLowerCase();
      result = result.filter(
        (l) =>
          (l.firstName || '').toLowerCase().includes(q) ||
          (l.lastName || '').toLowerCase().includes(q) ||
          (l.phone || '').includes(q)
      );
    }
    return result;
  }, [leads, search, statusFilter]);

  const openDetail = async (id: string) => {
    setLoadingId(id);
    try {
      const detail = await getLead(id);
      if (detail) {
        setSelectedLead({
          ...detail,
          notes: detail.notes.map((n) => ({
            ...n,
            createdAt: n.createdAt.toISOString(),
          })),
          receivedAt: detail.receivedAt as unknown as string,
          createdAt: detail.createdAt as unknown as string,
          updatedAt: detail.updatedAt as unknown as string,
          assignedAt: detail.assignedAt ? (detail.assignedAt as unknown as string) : null,
        } as unknown as LeadDetail);
      }
    } finally {
      setLoadingId(null);
    }
  };

  const statusCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const l of leads) {
      counts[l.status] = (counts[l.status] || 0) + 1;
    }
    return counts;
  }, [leads]);

  return (
    <>
      <div className="space-y-4">
        {/* Filters */}
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
            <input
              className="w-full rounded-lg border border-slate-200 bg-white pl-9 pr-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
              placeholder="Search by name or phone..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <div className="flex items-center gap-1.5">
            <button
              onClick={() => setStatusFilter('')}
              className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors ${
                !statusFilter ? 'border-blue-200 bg-blue-50 text-blue-700' : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
              }`}
            >
              All ({leads.length})
            </button>
            {['NEW', 'CONTACTED', 'WORKING', 'CONVERTED', 'DEAD'].map((s) => (
              <button
                key={s}
                onClick={() => setStatusFilter(statusFilter === s ? '' : s)}
                className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors ${
                  statusFilter === s ? 'border-blue-200 bg-blue-50 text-blue-700' : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
                }`}
              >
                {s.charAt(0) + s.slice(1).toLowerCase()} ({statusCounts[s] || 0})
              </button>
            ))}
          </div>
        </div>

        {/* Lead cards */}
        {filtered.length === 0 ? (
          <div className="rounded-xl border border-slate-200 bg-white p-12 text-center shadow-sm">
            <Inbox className="mx-auto h-10 w-10 text-slate-300" />
            <p className="mt-3 text-sm font-semibold text-slate-700">No leads found</p>
            <p className="mt-1 text-sm text-slate-500">
              {leads.length === 0 ? 'Your assigned leads will appear here.' : 'Try adjusting your filters.'}
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {filtered.map((l) => (
              <button
                key={l.id}
                type="button"
                onClick={() => void openDetail(l.id)}
                disabled={loadingId === l.id}
                className="group w-full text-left rounded-2xl border border-slate-200/80 bg-white p-4 shadow-sm transition-all hover:shadow-md hover:border-blue-300 hover:ring-1 hover:ring-blue-100 disabled:opacity-70"
              >
                <div className="flex items-center justify-between gap-4">
                  <div className="flex items-center gap-4 min-w-0">
                    <LeadStatusBadge status={l.status} />
                    <div className="min-w-0">
                      <p className="text-sm font-bold text-slate-900 truncate">
                        {[l.firstName, l.lastName].filter(Boolean).join(' ') || 'Unknown'}
                      </p>
                      <p className="text-xs text-slate-500 truncate">
                        {[l.phone, l.propertyState, l.loanPurpose].filter(Boolean).join(' · ')}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-4 text-right shrink-0">
                    {l.loanAmount && (
                      <span className="text-sm font-semibold text-slate-700">
                        ${Number(l.loanAmount).toLocaleString()}
                      </span>
                    )}
                    <div>
                      <p className="text-xs text-slate-500">{l.campaign?.name || l.vendor?.name || ''}</p>
                      <p className="text-[10px] text-slate-400">
                        <FormatDate date={l.receivedAt} />
                      </p>
                    </div>
                  </div>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      {selectedLead && (
        <LeadDetailPanel
          lead={{
            ...selectedLead,
            receivedAt: typeof selectedLead.receivedAt === 'string'
              ? selectedLead.receivedAt
              : (selectedLead.receivedAt as Date).toISOString(),
            notes: selectedLead.notes.map((n) => ({
              ...n,
              createdAt: typeof n.createdAt === 'string' ? n.createdAt : (n.createdAt as Date).toISOString(),
            })),
          }}
          onClose={() => setSelectedLead(null)}
        />
      )}
    </>
  );
}
