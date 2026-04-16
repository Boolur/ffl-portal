'use client';

import React, { useState, useMemo, useCallback } from 'react';
import {
  Search,
  UserPlus,
  Loader2,
  Inbox,
  ChevronLeft,
  ChevronRight,
  Trash2,
  RefreshCw,
  Zap,
  X,
  Filter,
} from 'lucide-react';
import { LeadStatusBadge } from '@/components/leads/LeadStatusBadge';
import { LeadDetailModal } from './LeadDetailModal';
import {
  getLeads,
  getLead,
  bulkAssignLeads,
  bulkUpdateLeadStatus,
  bulkDeleteLeads,
} from '@/app/actions/leadActions';
import { useRouter } from 'next/navigation';

const PAGE_SIZE = 200;

const ALL_STATUSES = [
  'NEW',
  'CONTACTED',
  'WORKING',
  'CONVERTED',
  'DEAD',
  'RETURNED',
  'UNASSIGNED',
] as const;

type LeadRow = {
  id: string;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  phone: string | null;
  propertyState: string | null;
  loanPurpose: string | null;
  loanAmount: string | null;
  status: string;
  source: string | null;
  receivedAt: string;
  vendor: { id: string; name: string } | null;
  campaign: { id: string; name: string } | null;
  assignedUser: { id: string; name: string } | null;
  _count: { notes: number };
};

type FilterOption = { id: string; name: string };

type LeadDetailData = React.ComponentProps<typeof LeadDetailModal>['lead'];

export function LeadsCRM({
  initialLeads,
  initialTotal,
  vendors,
  campaigns,
  users,
  sources,
}: {
  initialLeads: LeadRow[];
  initialTotal: number;
  vendors: FilterOption[];
  campaigns: FilterOption[];
  users: FilterOption[];
  sources: string[];
}) {
  const router = useRouter();

  // Data state
  const [leads, setLeads] = useState<LeadRow[]>(initialLeads);
  const [total, setTotal] = useState(initialTotal);
  const [loading, setLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);

  // Filters
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [vendorFilter, setVendorFilter] = useState('');
  const [campaignFilter, setCampaignFilter] = useState('');
  const [userFilter, setUserFilter] = useState('');
  const [stateFilter, setStateFilter] = useState('');
  const [sourceFilter, setSourceFilter] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [page, setPage] = useState(0);
  const [filtersExpanded, setFiltersExpanded] = useState(false);

  // Selection
  const [selected, setSelected] = useState<Set<string>>(new Set());

  // Detail modal
  const [detailLead, setDetailLead] = useState<LeadDetailData | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  // Batch action dropdowns
  const [assignOpen, setAssignOpen] = useState(false);
  const [statusChangeOpen, setStatusChangeOpen] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState(false);

  const activeFilterCount = useMemo(() => {
    let count = 0;
    if (search) count++;
    if (statusFilter) count++;
    if (vendorFilter) count++;
    if (campaignFilter) count++;
    if (userFilter) count++;
    if (stateFilter) count++;
    if (sourceFilter) count++;
    if (dateFrom) count++;
    if (dateTo) count++;
    return count;
  }, [search, statusFilter, vendorFilter, campaignFilter, userFilter, stateFilter, sourceFilter, dateFrom, dateTo]);

  const buildFilters = useCallback(
    (pageOverride?: number) => {
      const f: Record<string, unknown> = {
        take: PAGE_SIZE,
        skip: (pageOverride ?? page) * PAGE_SIZE,
      };
      if (search) f.search = search;
      if (statusFilter) f.status = statusFilter;
      if (vendorFilter) f.vendorId = vendorFilter;
      if (campaignFilter) f.campaignId = campaignFilter;
      if (userFilter === '__unassigned__') f.unassigned = true;
      else if (userFilter) f.assignedUserId = userFilter;
      if (stateFilter) f.propertyState = stateFilter;
      if (sourceFilter) f.source = sourceFilter;
      if (dateFrom) f.dateFrom = dateFrom;
      if (dateTo) f.dateTo = dateTo;
      return f;
    },
    [page, search, statusFilter, vendorFilter, campaignFilter, userFilter, stateFilter, sourceFilter, dateFrom, dateTo]
  );

  const fetchLeads = useCallback(
    async (pageOverride?: number) => {
      setLoading(true);
      try {
        const result = await getLeads(buildFilters(pageOverride) as never);
        setLeads(
          result.leads.map((l) => ({
            ...l,
            receivedAt: l.receivedAt.toISOString(),
          })) as unknown as LeadRow[]
        );
        setTotal(result.total);
        setSelected(new Set());
      } finally {
        setLoading(false);
      }
    },
    [buildFilters]
  );

  const handleFilterChange = useCallback(() => {
    setPage(0);
    void fetchLeads(0);
  }, [fetchLeads]);

  const handlePageChange = useCallback(
    (newPage: number) => {
      setPage(newPage);
      void fetchLeads(newPage);
    },
    [fetchLeads]
  );

  const clearFilters = useCallback(() => {
    setSearch('');
    setStatusFilter('');
    setVendorFilter('');
    setCampaignFilter('');
    setUserFilter('');
    setStateFilter('');
    setSourceFilter('');
    setDateFrom('');
    setDateTo('');
    setPage(0);
    setLoading(true);
    getLeads({ take: PAGE_SIZE, skip: 0 } as never).then((result) => {
      setLeads(
        result.leads.map((l) => ({
          ...l,
          receivedAt: l.receivedAt.toISOString(),
        })) as unknown as LeadRow[]
      );
      setTotal(result.total);
      setSelected(new Set());
      setLoading(false);
    });
  }, []);

  // Selection handlers
  const toggleSelect = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    if (selected.size === leads.length) setSelected(new Set());
    else setSelected(new Set(leads.map((l) => l.id)));
  };

  // Open lead detail
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
        } as LeadDetailData);
      }
    } finally {
      setDetailLoading(false);
    }
  }, []);

  // Batch actions
  const handleBulkAssign = useCallback(
    async (userId: string) => {
      if (selected.size === 0) return;
      setActionLoading(true);
      try {
        await bulkAssignLeads([...selected], userId);
        setAssignOpen(false);
        router.refresh();
        await fetchLeads();
      } finally {
        setActionLoading(false);
      }
    },
    [selected, fetchLeads, router]
  );

  const handleBulkStatus = useCallback(
    async (status: string) => {
      if (selected.size === 0) return;
      setActionLoading(true);
      try {
        await bulkUpdateLeadStatus([...selected], status as never);
        setStatusChangeOpen(false);
        router.refresh();
        await fetchLeads();
      } finally {
        setActionLoading(false);
      }
    },
    [selected, fetchLeads, router]
  );

  const handleBulkDelete = useCallback(async () => {
    if (selected.size === 0) return;
    setActionLoading(true);
    try {
      await bulkDeleteLeads([...selected]);
      setDeleteConfirm(false);
      router.refresh();
      await fetchLeads();
    } finally {
      setActionLoading(false);
    }
  }, [selected, fetchLeads, router]);

  const totalPages = Math.ceil(total / PAGE_SIZE);
  const startIdx = page * PAGE_SIZE + 1;
  const endIdx = Math.min((page + 1) * PAGE_SIZE, total);

  return (
    <div className="space-y-4">
      {/* Loading overlays */}
      {actionLoading && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-white/80 backdrop-blur-[1px]">
          <div className="flex flex-col items-center gap-3">
            <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
            <p className="text-sm font-medium text-slate-600">
              Processing...
            </p>
          </div>
        </div>
      )}

      {detailLoading && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-white/80 backdrop-blur-[1px]">
          <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
        </div>
      )}

      {/* Filter bar */}
      <div className="bg-white border border-slate-200 rounded-xl shadow-sm">
        {/* Primary row: search + toggle */}
        <div className="px-4 py-3 flex items-center gap-3">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
            <input
              className="w-full rounded-lg border border-slate-200 bg-white pl-9 pr-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
              placeholder="Search by name, email, or phone..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleFilterChange()}
            />
          </div>
          <button
            type="button"
            className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-2 text-sm font-medium transition-colors ${
              filtersExpanded || activeFilterCount > 0
                ? 'border-blue-300 bg-blue-50 text-blue-700'
                : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
            }`}
            onClick={() => setFiltersExpanded(!filtersExpanded)}
          >
            <Filter className="h-4 w-4" />
            Filters
            {activeFilterCount > 0 && (
              <span className="ml-0.5 flex h-5 w-5 items-center justify-center rounded-full bg-blue-600 text-[10px] font-bold text-white">
                {activeFilterCount}
              </span>
            )}
          </button>
          <button
            type="button"
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50 transition-colors"
            onClick={() => void fetchLeads()}
          >
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>

        {/* Expanded filters */}
        {filtersExpanded && (
          <div className="border-t border-slate-100 px-4 py-3">
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
              <div>
                <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-500 mb-1">
                  Status
                </label>
                <select
                  className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                  value={statusFilter}
                  onChange={(e) => {
                    setStatusFilter(e.target.value);
                  }}
                >
                  <option value="">All Statuses</option>
                  {ALL_STATUSES.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-500 mb-1">
                  Vendor
                </label>
                <select
                  className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                  value={vendorFilter}
                  onChange={(e) => {
                    setVendorFilter(e.target.value);
                  }}
                >
                  <option value="">All Vendors</option>
                  {vendors.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-500 mb-1">
                  Campaign
                </label>
                <select
                  className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                  value={campaignFilter}
                  onChange={(e) => {
                    setCampaignFilter(e.target.value);
                  }}
                >
                  <option value="">All Campaigns</option>
                  {campaigns.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-500 mb-1">
                  Assigned To
                </label>
                <select
                  className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                  value={userFilter}
                  onChange={(e) => {
                    setUserFilter(e.target.value);
                  }}
                >
                  <option value="">All Users</option>
                  <option value="__unassigned__">Unassigned</option>
                  {users.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-500 mb-1">
                  State
                </label>
                <input
                  className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                  placeholder="e.g. CA, TX"
                  value={stateFilter}
                  onChange={(e) => {
                    setStateFilter(e.target.value);
                  }}
                />
              </div>
              <div>
                <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-500 mb-1">
                  Source
                </label>
                <select
                  className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                  value={sourceFilter}
                  onChange={(e) => {
                    setSourceFilter(e.target.value);
                  }}
                >
                  <option value="">All Sources</option>
                  {sources.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-500 mb-1">
                  Date From
                </label>
                <input
                  type="date"
                  className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                  value={dateFrom}
                  onChange={(e) => {
                    setDateFrom(e.target.value);
                  }}
                />
              </div>
              <div>
                <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-500 mb-1">
                  Date To
                </label>
                <input
                  type="date"
                  className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                  value={dateTo}
                  onChange={(e) => {
                    setDateTo(e.target.value);
                  }}
                />
              </div>
            </div>
            <div className="mt-3 flex items-center gap-2">
              <button
                type="button"
                className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-blue-700 transition-colors"
                onClick={handleFilterChange}
              >
                <Search className="h-3.5 w-3.5" />
                Apply Filters
              </button>
              {activeFilterCount > 0 && (
                <button
                  type="button"
                  className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50 transition-colors"
                  onClick={clearFilters}
                >
                  <X className="h-3.5 w-3.5" />
                  Clear All
                </button>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Batch action toolbar */}
      {selected.size > 0 && (
        <div className="bg-blue-50 border border-blue-200 rounded-xl px-4 py-3 flex flex-wrap items-center gap-3">
          <span className="text-sm font-bold text-blue-800">
            {selected.size} lead{selected.size !== 1 ? 's' : ''} selected
          </span>
          <div className="h-5 w-px bg-blue-200" />

          {/* Assign */}
          <div className="relative">
            <button
              type="button"
              className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-blue-700 transition-colors"
              onClick={() => {
                setAssignOpen(!assignOpen);
                setStatusChangeOpen(false);
                setDeleteConfirm(false);
              }}
            >
              <UserPlus className="h-3.5 w-3.5" />
              Assign
            </button>
            {assignOpen && (
              <div className="absolute top-full left-0 mt-1 z-30 w-56 rounded-xl border border-slate-200 bg-white shadow-lg py-1 max-h-60 overflow-y-auto">
                {users.map((u) => (
                  <button
                    key={u.id}
                    className="w-full text-left px-4 py-2 text-sm text-slate-700 hover:bg-blue-50 hover:text-blue-700 transition-colors"
                    onClick={() => void handleBulkAssign(u.id)}
                  >
                    {u.name}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Change Status */}
          <div className="relative">
            <button
              type="button"
              className="inline-flex items-center gap-1.5 rounded-lg bg-white border border-slate-200 px-3 py-1.5 text-sm font-semibold text-slate-700 hover:bg-slate-50 transition-colors"
              onClick={() => {
                setStatusChangeOpen(!statusChangeOpen);
                setAssignOpen(false);
                setDeleteConfirm(false);
              }}
            >
              <RefreshCw className="h-3.5 w-3.5" />
              Change Status
            </button>
            {statusChangeOpen && (
              <div className="absolute top-full left-0 mt-1 z-30 w-44 rounded-xl border border-slate-200 bg-white shadow-lg py-1">
                {ALL_STATUSES.map((s) => (
                  <button
                    key={s}
                    className="w-full text-left px-4 py-2 text-sm text-slate-700 hover:bg-blue-50 hover:text-blue-700 transition-colors"
                    onClick={() => void handleBulkStatus(s)}
                  >
                    {s}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Push to Service (placeholder) */}
          <button
            type="button"
            className="inline-flex items-center gap-1.5 rounded-lg bg-white border border-slate-200 px-3 py-1.5 text-sm font-semibold text-slate-400 cursor-not-allowed"
            disabled
            title="Coming soon — Services integration"
          >
            <Zap className="h-3.5 w-3.5" />
            Push to Service
          </button>

          {/* Delete */}
          <div className="relative ml-auto">
            {!deleteConfirm ? (
              <button
                type="button"
                className="inline-flex items-center gap-1.5 rounded-lg bg-white border border-red-200 px-3 py-1.5 text-sm font-semibold text-red-600 hover:bg-red-50 transition-colors"
                onClick={() => {
                  setDeleteConfirm(true);
                  setAssignOpen(false);
                  setStatusChangeOpen(false);
                }}
              >
                <Trash2 className="h-3.5 w-3.5" />
                Delete
              </button>
            ) : (
              <div className="flex items-center gap-2">
                <span className="text-xs font-semibold text-red-700">
                  Delete {selected.size} lead{selected.size !== 1 ? 's' : ''}?
                </span>
                <button
                  type="button"
                  className="rounded-lg bg-red-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-red-700 transition-colors"
                  onClick={() => void handleBulkDelete()}
                >
                  Confirm
                </button>
                <button
                  type="button"
                  className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-50 transition-colors"
                  onClick={() => setDeleteConfirm(false)}
                >
                  Cancel
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Table */}
      <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
        {/* Table header with counts and pagination info */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100">
          <p className="text-sm text-slate-600">
            <span className="font-bold text-slate-900">{total.toLocaleString()}</span> total leads
            {total > 0 && (
              <span className="text-slate-400 ml-1">
                · showing {startIdx}–{endIdx}
              </span>
            )}
          </p>
          {loading && (
            <Loader2 className="h-4 w-4 animate-spin text-blue-600" />
          )}
        </div>

        {leads.length === 0 ? (
          <div className="p-12 text-center">
            <Inbox className="mx-auto h-10 w-10 text-slate-300" />
            <p className="mt-3 text-sm font-semibold text-slate-700">
              {activeFilterCount > 0
                ? 'No leads match your filters'
                : 'No leads yet'}
            </p>
            <p className="mt-1 text-sm text-slate-500">
              {activeFilterCount > 0
                ? 'Try adjusting your filters or clearing them.'
                : 'Leads will appear here as they are received.'}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="sticky top-0 z-[1] bg-slate-50">
                <tr className="border-b border-slate-200">
                  <th className="px-4 py-3 text-left w-10">
                    <input
                      type="checkbox"
                      className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                      checked={
                        selected.size === leads.length && leads.length > 0
                      }
                      onChange={toggleAll}
                    />
                  </th>
                  <th className="px-4 py-3 text-left text-[11px] font-bold uppercase tracking-wider text-slate-500">
                    Status
                  </th>
                  <th className="px-4 py-3 text-left text-[11px] font-bold uppercase tracking-wider text-slate-500">
                    Name
                  </th>
                  <th className="px-4 py-3 text-left text-[11px] font-bold uppercase tracking-wider text-slate-500">
                    Email
                  </th>
                  <th className="px-4 py-3 text-left text-[11px] font-bold uppercase tracking-wider text-slate-500">
                    Phone
                  </th>
                  <th className="px-4 py-3 text-left text-[11px] font-bold uppercase tracking-wider text-slate-500">
                    State
                  </th>
                  <th className="px-4 py-3 text-left text-[11px] font-bold uppercase tracking-wider text-slate-500">
                    Vendor
                  </th>
                  <th className="px-4 py-3 text-left text-[11px] font-bold uppercase tracking-wider text-slate-500">
                    Campaign
                  </th>
                  <th className="px-4 py-3 text-left text-[11px] font-bold uppercase tracking-wider text-slate-500">
                    Assigned To
                  </th>
                  <th className="px-4 py-3 text-left text-[11px] font-bold uppercase tracking-wider text-slate-500">
                    Source
                  </th>
                  <th className="px-4 py-3 text-left text-[11px] font-bold uppercase tracking-wider text-slate-500">
                    Received
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {leads.map((l) => (
                  <tr
                    key={l.id}
                    className={`align-middle transition-colors cursor-pointer ${
                      selected.has(l.id)
                        ? 'bg-blue-50/50'
                        : 'hover:bg-slate-50/70'
                    }`}
                    onClick={() => void openLeadDetail(l.id)}
                  >
                    <td
                      className="px-4 py-3"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <input
                        type="checkbox"
                        className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                        checked={selected.has(l.id)}
                        onChange={() => toggleSelect(l.id)}
                      />
                    </td>
                    <td className="px-4 py-3">
                      <LeadStatusBadge status={l.status} />
                    </td>
                    <td className="px-4 py-3 font-semibold text-slate-900 whitespace-nowrap">
                      {[l.firstName, l.lastName].filter(Boolean).join(' ') ||
                        '—'}
                    </td>
                    <td className="px-4 py-3 text-slate-600 max-w-[180px] truncate">
                      {l.email || '—'}
                    </td>
                    <td className="px-4 py-3 text-slate-600 whitespace-nowrap">
                      {l.phone || '—'}
                    </td>
                    <td className="px-4 py-3 text-slate-600">
                      {l.propertyState || '—'}
                    </td>
                    <td className="px-4 py-3 text-slate-600 whitespace-nowrap">
                      {l.vendor?.name || '—'}
                    </td>
                    <td className="px-4 py-3 text-slate-600 whitespace-nowrap">
                      {l.campaign?.name || '—'}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      {l.assignedUser?.name || (
                        <span className="text-orange-600 font-medium text-xs">
                          Unassigned
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-slate-500 text-xs whitespace-nowrap">
                      {l.source || '—'}
                    </td>
                    <td className="px-4 py-3 text-xs text-slate-500 whitespace-nowrap">
                      {new Date(l.receivedAt).toLocaleDateString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-slate-100">
            <button
              type="button"
              className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              disabled={page === 0}
              onClick={() => handlePageChange(page - 1)}
            >
              <ChevronLeft className="h-4 w-4" />
              Previous
            </button>
            <span className="text-sm text-slate-600">
              Page{' '}
              <span className="font-bold text-slate-900">{page + 1}</span> of{' '}
              <span className="font-bold text-slate-900">{totalPages}</span>
            </span>
            <button
              type="button"
              className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              disabled={page >= totalPages - 1}
              onClick={() => handlePageChange(page + 1)}
            >
              Next
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        )}
      </div>

      {/* Lead Detail Modal */}
      {detailLead && (
        <LeadDetailModal
          lead={detailLead}
          onClose={() => setDetailLead(null)}
          onUpdated={() => void fetchLeads()}
        />
      )}
    </div>
  );
}
