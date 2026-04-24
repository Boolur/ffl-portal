'use client';

import React, { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import {
  Search,
  UserPlus,
  Loader2,
  Inbox,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  ChevronDown,
  ChevronsUpDown,
  Trash2,
  RefreshCw,
  Zap,
  X,
  Filter,
  Database,
  TrendingUp,
  Calendar,
  AlertCircle,
  Globe,
  Megaphone,
  Download,
} from 'lucide-react';
import { LeadStatusBadge } from '@/components/leads/LeadStatusBadge';
import { LeadDetailModal } from './LeadDetailModal';
import {
  getLeads,
  getLead,
  bulkAssignLeads,
  bulkUpdateLeadStatus,
  bulkDeleteLeads,
  bulkDeleteLeadsBatch,
  getAllLeadIds,
  getLeadsForExport,
  revalidateLeadPaths,
} from '@/app/actions/leadActions';
import { useRouter } from 'next/navigation';
import { FormatDate, FormatNumber } from '@/components/ui/FormatDate';

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

type CrmStats = {
  totalLeads: number;
  newToday: number;
  newThisWeek: number;
  newThisMonth: number;
  unassigned: number;
  byVendor: Array<{ vendorId: string; vendorName: string; count: number }>;
  byCampaign: Array<{
    campaignId: string;
    campaignName: string;
    vendorName: string;
    count: number;
  }>;
};

type SortKey =
  | 'receivedAt'
  | 'status'
  | 'firstName'
  | 'email'
  | 'phone'
  | 'propertyState'
  | 'vendor'
  | 'campaign'
  | 'assignedUser'
  | 'source';

type SortDir = 'asc' | 'desc';

function SortableHeader({
  label,
  columnKey,
  activeKey,
  activeDir,
  onSort,
  align = 'left',
  width,
}: {
  label: string;
  columnKey: SortKey;
  activeKey: SortKey;
  activeDir: SortDir;
  onSort: (key: SortKey) => void;
  align?: 'left' | 'right';
  width?: string;
}) {
  const isActive = activeKey === columnKey;
  const justify = align === 'right' ? 'justify-end' : 'justify-start';
  return (
    <th
      scope="col"
      className={`px-4 py-3 text-[11px] font-bold uppercase tracking-wider text-slate-500 ${
        align === 'right' ? 'text-right' : 'text-left'
      } ${width ?? ''}`}
    >
      <button
        type="button"
        onClick={() => onSort(columnKey)}
        className={`inline-flex items-center gap-1.5 ${justify} w-full select-none rounded-md px-1.5 py-1 -mx-1.5 transition-colors hover:bg-slate-100 ${
          isActive ? 'text-slate-900' : 'text-slate-500'
        }`}
        aria-label={`Sort by ${label}`}
      >
        <span className="truncate">{label}</span>
        {isActive ? (
          activeDir === 'asc' ? (
            <ChevronUp className="h-3.5 w-3.5 shrink-0 text-blue-600" />
          ) : (
            <ChevronDown className="h-3.5 w-3.5 shrink-0 text-blue-600" />
          )
        ) : (
          <ChevronsUpDown className="h-3.5 w-3.5 shrink-0 text-slate-300" />
        )}
      </button>
    </th>
  );
}

const VENDOR_COLORS = [
  'bg-blue-500',
  'bg-violet-500',
  'bg-emerald-500',
  'bg-amber-500',
  'bg-rose-500',
  'bg-cyan-500',
  'bg-indigo-500',
  'bg-orange-500',
];

export function LeadsCRM({
  initialLeads,
  initialTotal,
  vendors,
  campaigns,
  users,
  sources,
  stats,
}: {
  initialLeads: LeadRow[];
  initialTotal: number;
  vendors: FilterOption[];
  campaigns: FilterOption[];
  users: FilterOption[];
  sources: string[];
  stats?: CrmStats;
}) {
  const router = useRouter();

  const [leads, setLeads] = useState<LeadRow[]>(initialLeads);
  const [total, setTotal] = useState(initialTotal);
  const [loading, setLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);

  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [vendorFilter, setVendorFilter] = useState('');
  const [campaignFilter, setCampaignFilter] = useState('');
  const [userFilter, setUserFilter] = useState('');
  const [stateFilter, setStateFilter] = useState('');
  const [sourceFilter, setSourceFilter] = useState('');
  const [loanPurposeFilter, setLoanPurposeFilter] = useState('');
  const [loanTypeFilter, setLoanTypeFilter] = useState('');
  const [propertyTypeFilter, setPropertyTypeFilter] = useState('');
  const [propertyUseFilter, setPropertyUseFilter] = useState('');
  const [propertyCityFilter, setPropertyCityFilter] = useState('');
  const [propertyZipFilter, setPropertyZipFilter] = useState('');
  const [employerFilter, setEmployerFilter] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [page, setPage] = useState(0);
  const [filtersExpanded, setFiltersExpanded] = useState(false);
  const [activeQuickFilter, setActiveQuickFilter] = useState<string | null>(
    null
  );
  const [sortBy, setSortBy] = useState<SortKey>('receivedAt');
  const [sortDir, setSortDir] = useState<SortDir>('desc');

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [selectAllGlobal, setSelectAllGlobal] = useState(false);
  const [globalIds, setGlobalIds] = useState<string[] | null>(null);
  const [detailLead, setDetailLead] = useState<LeadDetailData | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [assignOpen, setAssignOpen] = useState(false);
  const [statusChangeOpen, setStatusChangeOpen] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const [exportLoading, setExportLoading] = useState(false);
  const [progressOverlay, setProgressOverlay] = useState<{
    label: string;
    percent: number;
    detail?: string;
  } | null>(null);

  const activeFilterCount = useMemo(() => {
    let count = 0;
    if (search) count++;
    if (statusFilter) count++;
    if (vendorFilter) count++;
    if (campaignFilter) count++;
    if (userFilter) count++;
    if (stateFilter) count++;
    if (sourceFilter) count++;
    if (loanPurposeFilter) count++;
    if (loanTypeFilter) count++;
    if (propertyTypeFilter) count++;
    if (propertyUseFilter) count++;
    if (propertyCityFilter) count++;
    if (propertyZipFilter) count++;
    if (employerFilter) count++;
    if (dateFrom) count++;
    if (dateTo) count++;
    return count;
  }, [
    search,
    statusFilter,
    vendorFilter,
    campaignFilter,
    userFilter,
    stateFilter,
    sourceFilter,
    loanPurposeFilter,
    loanTypeFilter,
    propertyTypeFilter,
    propertyUseFilter,
    propertyCityFilter,
    propertyZipFilter,
    employerFilter,
    dateFrom,
    dateTo,
  ]);

  const buildFilters = useCallback(
    (pageOverride?: number) => {
      const f: Record<string, unknown> = {
        take: PAGE_SIZE,
        skip: (pageOverride ?? page) * PAGE_SIZE,
        sortBy,
        sortDir,
      };
      if (search) f.search = search;
      if (statusFilter) f.status = statusFilter;
      if (vendorFilter) f.vendorId = vendorFilter;
      if (campaignFilter) f.campaignId = campaignFilter;
      if (userFilter === '__unassigned__') f.unassigned = true;
      else if (userFilter) f.assignedUserId = userFilter;
      if (stateFilter) f.propertyState = stateFilter;
      if (sourceFilter) f.source = sourceFilter;
      if (loanPurposeFilter) f.loanPurpose = loanPurposeFilter;
      if (loanTypeFilter) f.loanType = loanTypeFilter;
      if (propertyTypeFilter) f.propertyType = propertyTypeFilter;
      if (propertyUseFilter) f.propertyUse = propertyUseFilter;
      if (propertyCityFilter) f.propertyCity = propertyCityFilter;
      if (propertyZipFilter) f.propertyZip = propertyZipFilter;
      if (employerFilter) f.employer = employerFilter;
      if (dateFrom) f.dateFrom = dateFrom;
      if (dateTo) f.dateTo = dateTo;
      return f;
    },
    [
      page,
      search,
      statusFilter,
      vendorFilter,
      campaignFilter,
      userFilter,
      stateFilter,
      sourceFilter,
      loanPurposeFilter,
      loanTypeFilter,
      propertyTypeFilter,
      propertyUseFilter,
      propertyCityFilter,
      propertyZipFilter,
      employerFilter,
      dateFrom,
      dateTo,
      sortBy,
      sortDir,
    ]
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

  const handleSort = useCallback(
    (key: SortKey) => {
      if (sortBy === key) {
        setSortDir((prev) => (prev === 'asc' ? 'desc' : 'asc'));
      } else {
        setSortBy(key);
        setSortDir('desc');
      }
    },
    [sortBy]
  );

  // Refetch when sort changes (skip first render)
  const didMountRef = useRef(false);
  useEffect(() => {
    if (!didMountRef.current) {
      didMountRef.current = true;
      return;
    }
    setPage(0);
    void fetchLeads(0);
  }, [sortBy, sortDir, fetchLeads]);

  const handlePageChange = useCallback(
    (newPage: number) => {
      setPage(newPage);
      void fetchLeads(newPage);
    },
    [fetchLeads]
  );

  const clearAllFilters = useCallback(() => {
    setSearch('');
    setStatusFilter('');
    setVendorFilter('');
    setCampaignFilter('');
    setUserFilter('');
    setStateFilter('');
    setSourceFilter('');
    setLoanPurposeFilter('');
    setLoanTypeFilter('');
    setPropertyTypeFilter('');
    setPropertyUseFilter('');
    setPropertyCityFilter('');
    setPropertyZipFilter('');
    setEmployerFilter('');
    setDateFrom('');
    setDateTo('');
    setPage(0);
    setActiveQuickFilter(null);
    setLoading(true);
    getLeads({ take: PAGE_SIZE, skip: 0, sortBy, sortDir } as never).then((result) => {
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
  }, [sortBy, sortDir]);

  // Quick filter from stat cards
  const applyQuickFilter = useCallback(
    (key: string) => {
      setSearch('');
      setStatusFilter('');
      setVendorFilter('');
      setCampaignFilter('');
      setUserFilter('');
      setStateFilter('');
      setSourceFilter('');
      setLoanPurposeFilter('');
      setLoanTypeFilter('');
      setPropertyTypeFilter('');
      setPropertyUseFilter('');
      setPropertyCityFilter('');
      setPropertyZipFilter('');
      setEmployerFilter('');

      const now = new Date();
      const todayStr = now.toISOString().split('T')[0];

      const weekStart = new Date(now);
      weekStart.setDate(weekStart.getDate() - weekStart.getDay() + 1);
      if (weekStart > now) weekStart.setDate(weekStart.getDate() - 7);
      const weekStr = weekStart.toISOString().split('T')[0];

      const monthStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;

      if (key === activeQuickFilter) {
        setDateFrom('');
        setDateTo('');
        setActiveQuickFilter(null);
        setPage(0);
        setLoading(true);
        getLeads({ take: PAGE_SIZE, skip: 0, sortBy, sortDir } as never).then((result) => {
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
        return;
      }

      setActiveQuickFilter(key);

      let filters: Record<string, unknown> = {
        take: PAGE_SIZE,
        skip: 0,
        sortBy,
        sortDir,
      };

      switch (key) {
        case 'total':
          setDateFrom('');
          setDateTo('');
          break;
        case 'today':
          setDateFrom(todayStr);
          setDateTo(todayStr);
          filters = { ...filters, dateFrom: todayStr, dateTo: todayStr };
          break;
        case 'week':
          setDateFrom(weekStr);
          setDateTo(todayStr);
          filters = { ...filters, dateFrom: weekStr, dateTo: todayStr };
          break;
        case 'month':
          setDateFrom(monthStr);
          setDateTo(todayStr);
          filters = { ...filters, dateFrom: monthStr, dateTo: todayStr };
          break;
        case 'unassigned':
          setDateFrom('');
          setDateTo('');
          setUserFilter('__unassigned__');
          filters = { ...filters, unassigned: true };
          break;
      }

      setPage(0);
      setLoading(true);
      getLeads(filters as never).then((result) => {
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
    },
    [activeQuickFilter, sortBy, sortDir]
  );

  const applyVendorFilter = useCallback(
    (vendorId: string) => {
      setSearch('');
      setStatusFilter('');
      setCampaignFilter('');
      setUserFilter('');
      setStateFilter('');
      setSourceFilter('');
      setLoanPurposeFilter('');
      setLoanTypeFilter('');
      setPropertyTypeFilter('');
      setPropertyUseFilter('');
      setPropertyCityFilter('');
      setPropertyZipFilter('');
      setEmployerFilter('');
      setDateFrom('');
      setDateTo('');
      setVendorFilter(vendorId);
      setActiveQuickFilter(null);
      setPage(0);
      setLoading(true);
      getLeads({
        take: PAGE_SIZE,
        skip: 0,
        vendorId,
        sortBy,
        sortDir,
      } as never).then((result) => {
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
    },
    [sortBy, sortDir]
  );

  const applyCampaignFilter = useCallback(
    (campaignId: string) => {
      setSearch('');
      setStatusFilter('');
      setVendorFilter('');
      setUserFilter('');
      setStateFilter('');
      setSourceFilter('');
      setLoanPurposeFilter('');
      setLoanTypeFilter('');
      setPropertyTypeFilter('');
      setPropertyUseFilter('');
      setPropertyCityFilter('');
      setPropertyZipFilter('');
      setEmployerFilter('');
      setDateFrom('');
      setDateTo('');
      setCampaignFilter(campaignId);
      setActiveQuickFilter(null);
      setPage(0);
      setLoading(true);
      getLeads({
        take: PAGE_SIZE,
        skip: 0,
        campaignId,
        sortBy,
        sortDir,
      } as never).then((result) => {
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
    },
    [sortBy, sortDir]
  );

  const toggleSelect = (id: string) => {
    setSelectAllGlobal(false);
    setGlobalIds(null);
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    if (selected.size === leads.length) {
      setSelected(new Set());
      setSelectAllGlobal(false);
      setGlobalIds(null);
    } else {
      setSelected(new Set(leads.map((l) => l.id)));
      setSelectAllGlobal(false);
      setGlobalIds(null);
    }
  };

  const selectAllMatching = useCallback(async () => {
    setActionLoading(true);
    try {
      const filters = buildFilters(0);
      delete filters.take;
      delete filters.skip;
      const ids = await getAllLeadIds(filters as never);
      setGlobalIds(ids);
      setSelected(new Set(ids));
      setSelectAllGlobal(true);
    } finally {
      setActionLoading(false);
    }
  }, [buildFilters]);

  const clearSelection = useCallback(() => {
    setSelected(new Set());
    setSelectAllGlobal(false);
    setGlobalIds(null);
  }, []);

  const getEffectiveIds = useCallback((): string[] => {
    if (selectAllGlobal && globalIds) return globalIds;
    return [...selected];
  }, [selected, selectAllGlobal, globalIds]);

  const handleExportCsv = useCallback(async () => {
    const ids = getEffectiveIds();
    if (ids.length === 0) return;
    setExportLoading(true);
    setProgressOverlay({
      label: 'Exporting leads...',
      percent: 0,
      detail: `Preparing ${ids.length.toLocaleString()} leads`,
    });
    try {
      const csvHeaders = [
        'First Name',
        'Last Name',
        'Email',
        'Phone',
        'Property State',
        'Loan Purpose',
        'Loan Amount',
        'Credit Rating',
        'Status',
        'Source',
        'Vendor',
        'Campaign',
        'Assigned To',
        'Received At',
      ];

      const escCsv = (val: string | null | undefined) => {
        if (val == null || val === '') return '';
        const s = String(val);
        if (s.includes(',') || s.includes('"') || s.includes('\n'))
          return `"${s.replace(/"/g, '""')}"`;
        return s;
      };

      const batchSize = 200;
      const totalBatches = Math.ceil(ids.length / batchSize);
      const allRows: string[] = [];

      for (let i = 0; i < ids.length; i += batchSize) {
        const batchIds = ids.slice(i, i + batchSize);
        const exportLeads = await getLeadsForExport(batchIds);
        for (const l of exportLeads) {
          allRows.push(
            [
              escCsv(l.firstName),
              escCsv(l.lastName),
              escCsv(l.email),
              escCsv(l.phone),
              escCsv(l.propertyState),
              escCsv(l.loanPurpose),
              escCsv(l.loanAmount),
              escCsv(l.creditRating),
              escCsv(l.status),
              escCsv(l.source),
              escCsv(l.vendor?.name),
              escCsv(l.campaign?.name),
              escCsv(l.assignedUser?.name),
              escCsv(l.receivedAt.toISOString()),
            ].join(',')
          );
        }
        const completed = Math.min(Math.floor(i / batchSize) + 1, totalBatches);
        setProgressOverlay({
          label: 'Exporting leads...',
          percent: Math.round((completed / totalBatches) * 100),
          detail: `${Math.min(i + batchSize, ids.length).toLocaleString()} of ${ids.length.toLocaleString()} leads`,
        });
      }

      const csvContent = [csvHeaders.join(','), ...allRows].join('\n');
      const blob = new Blob([csvContent], {
        type: 'text/csv;charset=utf-8;',
      });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `leads-export-${new Date().toISOString().split('T')[0]}.csv`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } finally {
      setExportLoading(false);
      setProgressOverlay(null);
    }
  }, [getEffectiveIds]);

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

  const handleBulkAssign = useCallback(
    async (userId: string) => {
      const ids = getEffectiveIds();
      if (ids.length === 0) return;
      setActionLoading(true);
      try {
        await bulkAssignLeads(ids, userId);
        setAssignOpen(false);
        clearSelection();
        router.refresh();
        await fetchLeads();
      } finally {
        setActionLoading(false);
      }
    },
    [getEffectiveIds, clearSelection, fetchLeads, router]
  );

  const handleBulkStatus = useCallback(
    async (status: string) => {
      const ids = getEffectiveIds();
      if (ids.length === 0) return;
      setActionLoading(true);
      try {
        await bulkUpdateLeadStatus(ids, status as never);
        setStatusChangeOpen(false);
        clearSelection();
        router.refresh();
        await fetchLeads();
      } finally {
        setActionLoading(false);
      }
    },
    [getEffectiveIds, clearSelection, fetchLeads, router]
  );

  const handleBulkDelete = useCallback(async () => {
    const ids = getEffectiveIds();
    if (ids.length === 0) return;
    setDeleteConfirm(false);

    if (ids.length <= 200) {
      setActionLoading(true);
      try {
        await bulkDeleteLeads(ids);
        clearSelection();
        router.refresh();
        await fetchLeads();
      } finally {
        setActionLoading(false);
      }
      return;
    }

    setProgressOverlay({
      label: 'Deleting leads...',
      percent: 0,
      detail: `0 of ${ids.length.toLocaleString()} leads`,
    });
    try {
      const batchSize = 100;
      const totalBatches = Math.ceil(ids.length / batchSize);
      for (let i = 0; i < ids.length; i += batchSize) {
        const batchIds = ids.slice(i, i + batchSize);
        await bulkDeleteLeadsBatch(batchIds);
        const completed = Math.min(Math.floor(i / batchSize) + 1, totalBatches);
        setProgressOverlay({
          label: 'Deleting leads...',
          percent: Math.round((completed / totalBatches) * 100),
          detail: `${Math.min(i + batchSize, ids.length).toLocaleString()} of ${ids.length.toLocaleString()} leads`,
        });
      }
      await revalidateLeadPaths();
      clearSelection();
      router.refresh();
      await fetchLeads();
    } finally {
      setProgressOverlay(null);
    }
  }, [getEffectiveIds, clearSelection, fetchLeads, router]);

  const totalPages = Math.ceil(total / PAGE_SIZE);
  const startIdx = page * PAGE_SIZE + 1;
  const endIdx = Math.min((page + 1) * PAGE_SIZE, total);

  const maxVendorCount = stats
    ? Math.max(...stats.byVendor.map((v) => v.count), 1)
    : 1;

  const maxCampaignCount = stats
    ? Math.max(...stats.byCampaign.map((c) => c.count), 1)
    : 1;

  const STAT_CARDS = stats
    ? [
        {
          key: 'total',
          label: 'Total Leads',
          value: stats.totalLeads,
          Icon: Database,
          accent: 'text-slate-600',
          bg: 'bg-slate-50',
          ring: 'ring-slate-300',
        },
        {
          key: 'today',
          label: 'New Today',
          value: stats.newToday,
          Icon: Inbox,
          accent: 'text-blue-600',
          bg: 'bg-blue-50',
          ring: 'ring-blue-300',
        },
        {
          key: 'week',
          label: 'This Week',
          value: stats.newThisWeek,
          Icon: TrendingUp,
          accent: 'text-indigo-600',
          bg: 'bg-indigo-50',
          ring: 'ring-indigo-300',
        },
        {
          key: 'month',
          label: 'This Month',
          value: stats.newThisMonth,
          Icon: Calendar,
          accent: 'text-violet-600',
          bg: 'bg-violet-50',
          ring: 'ring-violet-300',
        },
        {
          key: 'unassigned',
          label: 'Unassigned',
          value: stats.unassigned,
          Icon: AlertCircle,
          accent: 'text-orange-600',
          bg: 'bg-orange-50',
          ring: 'ring-orange-300',
        },
      ]
    : [];

  return (
    <div className="space-y-5">
      {/* Full-screen progress overlay (export, delete, etc.) */}
      {progressOverlay && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-slate-900/40 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 p-8 w-80 flex flex-col items-center gap-5">
            <Loader2 className="h-10 w-10 animate-spin text-blue-600" />
            <div className="w-full">
              <div className="flex items-center justify-between mb-1.5">
                <p className="text-sm font-semibold text-slate-700">
                  {progressOverlay.label}
                </p>
                <span className="text-sm font-bold text-blue-600">
                  {progressOverlay.percent}%
                </span>
              </div>
              <div className="w-full h-3 bg-slate-200 rounded-full overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-blue-500 to-blue-600 rounded-full transition-all duration-300 ease-out"
                  style={{ width: `${progressOverlay.percent}%` }}
                />
              </div>
              {progressOverlay.detail && (
                <p className="text-xs text-slate-500 mt-2 text-center">
                  {progressOverlay.detail}
                </p>
              )}
            </div>
            <p className="text-xs text-slate-400">
              Please wait, do not navigate away.
            </p>
          </div>
        </div>
      )}

      {actionLoading && !progressOverlay && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-900/40 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 p-8 flex flex-col items-center gap-4">
            <Loader2 className="h-10 w-10 animate-spin text-blue-600" />
            <p className="text-sm font-semibold text-slate-700">
              Processing...
            </p>
            <p className="text-xs text-slate-400">
              Please wait, do not navigate away.
            </p>
          </div>
        </div>
      )}

      {detailLoading && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-white/80 backdrop-blur-[1px]">
          <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
        </div>
      )}

      {/* Analytics: Stat Cards */}
      {stats && (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-5 gap-4">
            {STAT_CARDS.map((card) => {
              const isActive = activeQuickFilter === card.key;
              return (
                <button
                  key={card.key}
                  type="button"
                  onClick={() => applyQuickFilter(card.key)}
                  className={`relative bg-white border rounded-2xl p-4 text-left transition-all hover:shadow-md group ${
                    isActive
                      ? `border-transparent ring-2 ${card.ring} shadow-md`
                      : 'border-slate-200 shadow-sm hover:border-slate-300'
                  }`}
                >
                  <div className="flex items-center justify-between mb-3">
                    <div
                      className={`w-9 h-9 rounded-lg flex items-center justify-center ${card.bg}`}
                    >
                      <card.Icon className={`h-4.5 w-4.5 ${card.accent}`} />
                    </div>
                    {isActive && (
                      <span className="text-[10px] font-bold uppercase tracking-wider text-blue-600">
                        Active
                      </span>
                    )}
                  </div>
                  <p className="text-2xl font-bold text-slate-900">
                    <FormatNumber value={card.value} />
                  </p>
                  <p className="text-xs font-medium text-slate-500 mt-0.5">
                    {card.label}
                  </p>
                </button>
              );
            })}
          </div>

          {/* Vendor Breakdown + Campaign Volume */}
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
            {/* Vendor Breakdown */}
            {stats.byVendor.length > 0 && (
              <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
                <div className="px-5 py-3.5 border-b border-slate-100 flex items-center gap-2">
                  <Globe className="h-4 w-4 text-slate-400" />
                  <h3 className="text-sm font-bold text-slate-900">
                    Leads by Vendor
                  </h3>
                  <span className="text-[11px] text-slate-400 ml-auto">
                    All time
                  </span>
                </div>
                <div className="px-5 py-3 space-y-2.5">
                  {stats.byVendor.map((v, i) => {
                    const pct = Math.round((v.count / maxVendorCount) * 100);
                    const isActiveVendor = vendorFilter === v.vendorId;
                    return (
                      <button
                        key={v.vendorId}
                        type="button"
                        onClick={() => applyVendorFilter(v.vendorId)}
                        className={`w-full text-left group/row rounded-lg px-2 py-1.5 -mx-2 transition-colors ${
                          isActiveVendor
                            ? 'bg-blue-50'
                            : 'hover:bg-slate-50'
                        }`}
                      >
                        <div className="flex items-center justify-between mb-1">
                          <span
                            className={`text-sm font-medium ${isActiveVendor ? 'text-blue-700' : 'text-slate-700'}`}
                          >
                            {v.vendorName}
                          </span>
                          <span
                            className={`text-sm font-bold ${isActiveVendor ? 'text-blue-700' : 'text-slate-900'}`}
                          >
                            <FormatNumber value={v.count} />
                          </span>
                        </div>
                        <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
                          <div
                            className={`h-full rounded-full transition-all ${
                              VENDOR_COLORS[i % VENDOR_COLORS.length]
                            }`}
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Leads by Campaign */}
            <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
              <div className="px-5 py-3.5 border-b border-slate-100 flex items-center gap-2">
                <Megaphone className="h-4 w-4 text-slate-400" />
                <h3 className="text-sm font-bold text-slate-900">
                  Leads by Campaign
                </h3>
                <span className="text-[11px] text-slate-400 ml-auto">
                  All time
                </span>
              </div>
              <div className="px-5 py-3">
                {stats.byCampaign.length === 0 ? (
                  <p className="text-sm text-slate-400 text-center py-4">
                    No campaign leads yet
                  </p>
                ) : (
                  <div className="space-y-2.5 max-h-[360px] overflow-y-auto pr-1">
                    {stats.byCampaign.map((c, i) => {
                      const pct = Math.round(
                        (c.count / maxCampaignCount) * 100
                      );
                      const isActiveCampaign =
                        campaignFilter === c.campaignId;
                      return (
                        <button
                          key={c.campaignId}
                          type="button"
                          onClick={() => applyCampaignFilter(c.campaignId)}
                          className={`w-full text-left group/row rounded-lg px-2 py-1.5 -mx-2 transition-colors ${
                            isActiveCampaign
                              ? 'bg-blue-50'
                              : 'hover:bg-slate-50'
                          }`}
                        >
                          <div className="flex items-center justify-between mb-1 gap-3">
                            <div className="min-w-0">
                              <p
                                className={`text-sm font-medium truncate ${isActiveCampaign ? 'text-blue-700' : 'text-slate-700'}`}
                              >
                                {c.campaignName}
                              </p>
                              <p className="text-[11px] text-slate-400 truncate">
                                {c.vendorName}
                              </p>
                            </div>
                            <span
                              className={`text-sm font-bold shrink-0 ${isActiveCampaign ? 'text-blue-700' : 'text-slate-900'}`}
                            >
                              <FormatNumber value={c.count} />
                            </span>
                          </div>
                          <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
                            <div
                              className={`h-full rounded-full transition-all ${
                                VENDOR_COLORS[i % VENDOR_COLORS.length]
                              }`}
                              style={{ width: `${pct}%` }}
                            />
                          </div>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          </div>
        </>
      )}

      {/* Filter bar */}
      <div className="bg-white border border-slate-200 rounded-xl shadow-sm">
        <div className="px-4 py-3 flex items-center gap-3">
          <div className="relative w-full max-w-sm">
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
            className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-2 text-sm font-medium transition-colors shrink-0 ${
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
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50 transition-colors shrink-0"
            onClick={() => void fetchLeads()}
          >
            <RefreshCw
              className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`}
            />
          </button>
          {(activeFilterCount > 0 || activeQuickFilter) && (
            <button
              type="button"
              className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50 transition-colors shrink-0"
              onClick={clearAllFilters}
            >
              <X className="h-3.5 w-3.5" />
              Clear
            </button>
          )}
        </div>

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
                  onChange={(e) => setStatusFilter(e.target.value)}
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
                  onChange={(e) => setVendorFilter(e.target.value)}
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
                  onChange={(e) => setCampaignFilter(e.target.value)}
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
                  onChange={(e) => setUserFilter(e.target.value)}
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
                  onChange={(e) => setStateFilter(e.target.value)}
                />
              </div>
              <div>
                <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-500 mb-1">
                  Source
                </label>
                <select
                  className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                  value={sourceFilter}
                  onChange={(e) => setSourceFilter(e.target.value)}
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
                  onChange={(e) => setDateFrom(e.target.value)}
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
                  onChange={(e) => setDateTo(e.target.value)}
                />
              </div>
              <div>
                <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-500 mb-1">
                  Loan Purpose
                </label>
                <input
                  className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                  placeholder="e.g. Refinance"
                  value={loanPurposeFilter}
                  onChange={(e) => setLoanPurposeFilter(e.target.value)}
                />
              </div>
              <div>
                <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-500 mb-1">
                  Loan Type
                </label>
                <input
                  className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                  placeholder="e.g. Conventional"
                  value={loanTypeFilter}
                  onChange={(e) => setLoanTypeFilter(e.target.value)}
                />
              </div>
              <div>
                <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-500 mb-1">
                  Property Type
                </label>
                <input
                  className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                  placeholder="e.g. Single Family"
                  value={propertyTypeFilter}
                  onChange={(e) => setPropertyTypeFilter(e.target.value)}
                />
              </div>
              <div>
                <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-500 mb-1">
                  Property Use
                </label>
                <input
                  className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                  placeholder="e.g. Primary"
                  value={propertyUseFilter}
                  onChange={(e) => setPropertyUseFilter(e.target.value)}
                />
              </div>
              <div>
                <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-500 mb-1">
                  Property City
                </label>
                <input
                  className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                  placeholder="City name"
                  value={propertyCityFilter}
                  onChange={(e) => setPropertyCityFilter(e.target.value)}
                />
              </div>
              <div>
                <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-500 mb-1">
                  Property Zip
                </label>
                <input
                  className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                  placeholder="Zip code"
                  value={propertyZipFilter}
                  onChange={(e) => setPropertyZipFilter(e.target.value)}
                />
              </div>
              <div>
                <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-500 mb-1">
                  Employer
                </label>
                <input
                  className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                  placeholder="Employer name"
                  value={employerFilter}
                  onChange={(e) => setEmployerFilter(e.target.value)}
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
                  onClick={clearAllFilters}
                >
                  <X className="h-3.5 w-3.5" />
                  Clear All
                </button>
              )}
            </div>
          </div>
        )}
      </div>

      {/* "Select all matching" banner */}
      {selected.size === leads.length &&
        leads.length > 0 &&
        !selectAllGlobal &&
        total > leads.length && (
          <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-2.5 flex items-center justify-center gap-2 text-sm">
            <span className="text-amber-800">
              All <span className="font-bold">{leads.length}</span> leads on
              this page are selected.
            </span>
            <button
              type="button"
              className="font-bold text-amber-700 underline underline-offset-2 hover:text-amber-900 transition-colors"
              onClick={() => void selectAllMatching()}
            >
              Select all <FormatNumber value={total} /> matching leads
            </button>
          </div>
        )}

      {selectAllGlobal && (
        <div className="bg-emerald-50 border border-emerald-200 rounded-xl px-4 py-2.5 flex items-center justify-center gap-2 text-sm">
          <span className="text-emerald-800">
            All{' '}
            <span className="font-bold">
              <FormatNumber value={globalIds?.length ?? total} />
            </span>{' '}
            matching leads are selected.
          </span>
          <button
            type="button"
            className="font-bold text-emerald-700 underline underline-offset-2 hover:text-emerald-900 transition-colors"
            onClick={clearSelection}
          >
            Clear selection
          </button>
        </div>
      )}

      {/* Batch action toolbar */}
      {selected.size > 0 && (
        <div className="bg-blue-50 border border-blue-200 rounded-xl px-4 py-3 flex flex-wrap items-center gap-3">
          <span className="text-sm font-bold text-blue-800" suppressHydrationWarning>
            {selectAllGlobal
              ? `${(globalIds?.length ?? total).toLocaleString()} leads selected`
              : `${selected.size} lead${selected.size !== 1 ? 's' : ''} selected`}
          </span>
          <div className="h-5 w-px bg-blue-200" />

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

          <button
            type="button"
            className="inline-flex items-center gap-1.5 rounded-lg bg-white border border-slate-200 px-3 py-1.5 text-sm font-semibold text-slate-400 cursor-not-allowed"
            disabled
            title="Coming soon — Services integration"
          >
            <Zap className="h-3.5 w-3.5" />
            Push to Service
          </button>

          <button
            type="button"
            className="inline-flex items-center gap-1.5 rounded-lg bg-white border border-emerald-300 px-3 py-1.5 text-sm font-semibold text-emerald-700 hover:bg-emerald-50 transition-colors"
            onClick={() => void handleExportCsv()}
            disabled={exportLoading}
          >
            {exportLoading ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Download className="h-3.5 w-3.5" />
            )}
            Export to CSV
          </button>

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
                <span className="text-xs font-semibold text-red-700" suppressHydrationWarning>
                  Delete{' '}
                  {selectAllGlobal
                    ? (globalIds?.length ?? total).toLocaleString()
                    : selected.size}{' '}
                  lead
                  {(selectAllGlobal
                    ? (globalIds?.length ?? total)
                    : selected.size) !== 1
                    ? 's'
                    : ''}
                  ?
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
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100">
          <p className="text-sm text-slate-600">
            <span className="font-bold text-slate-900">
              <FormatNumber value={total} />
            </span>{' '}
            leads
            {total > 0 && (
              <span className="text-slate-400 ml-1">
                &middot; showing {startIdx}&ndash;{endIdx}
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
              {activeFilterCount > 0 || activeQuickFilter
                ? 'No leads match your filters'
                : 'No leads yet'}
            </p>
            <p className="mt-1 text-sm text-slate-500">
              {activeFilterCount > 0 || activeQuickFilter
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
                  <SortableHeader label="Status" columnKey="status" activeKey={sortBy} activeDir={sortDir} onSort={handleSort} />
                  <SortableHeader label="Name" columnKey="firstName" activeKey={sortBy} activeDir={sortDir} onSort={handleSort} />
                  <SortableHeader label="Email" columnKey="email" activeKey={sortBy} activeDir={sortDir} onSort={handleSort} />
                  <SortableHeader label="Phone" columnKey="phone" activeKey={sortBy} activeDir={sortDir} onSort={handleSort} />
                  <SortableHeader label="State" columnKey="propertyState" activeKey={sortBy} activeDir={sortDir} onSort={handleSort} />
                  <SortableHeader label="Vendor" columnKey="vendor" activeKey={sortBy} activeDir={sortDir} onSort={handleSort} />
                  <SortableHeader label="Campaign" columnKey="campaign" activeKey={sortBy} activeDir={sortDir} onSort={handleSort} />
                  <SortableHeader label="Assigned To" columnKey="assignedUser" activeKey={sortBy} activeDir={sortDir} onSort={handleSort} />
                  <SortableHeader label="Source" columnKey="source" activeKey={sortBy} activeDir={sortDir} onSort={handleSort} />
                  <SortableHeader label="Received" columnKey="receivedAt" activeKey={sortBy} activeDir={sortDir} onSort={handleSort} align="right" />
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
                    <td className="px-4 py-3 text-right text-xs text-slate-500 whitespace-nowrap">
                      <FormatDate date={l.receivedAt} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

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
