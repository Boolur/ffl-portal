'use client';

import React, { useState, useCallback, useMemo, useRef, useEffect } from 'react';
import { Loader2, Plus, Pencil, Trash2, Copy, Check, X, Megaphone, Search, HelpCircle, ArrowUp, ArrowDown, GripVertical, Archive, ArchiveRestore, AlertTriangle } from 'lucide-react';
import {
  createLeadCampaign,
  updateLeadCampaign,
  archiveLeadCampaign,
  restoreLeadCampaign,
  hardDeleteLeadCampaign,
  reassignCampaignLeads,
  deleteAllCampaignLeads,
  getCampaignDependencyCounts,
  setCampaignMembers,
} from '@/app/actions/leadActions';
import { useRouter } from 'next/navigation';
import { FormatDate } from '@/components/ui/FormatDate';
import {
  teamColorClasses,
  type LeadUserTeamSummary,
} from './LeadUserTeamManager';

type Vendor = { id: string; name: string; slug: string };
type EligibleUser = { id: string; name: string; email: string; role: string };
type GroupRef = { id: string; name: string; color: string; colors?: string[] };
type GroupOption = { id: string; name: string; color: string; colors?: string[]; active: boolean };
type Campaign = {
  id: string;
  name: string;
  description: string | null;
  vendorId: string;
  routingTag: string;
  active: boolean;
  distributionMethod: string;
  independentRotation: boolean;
  duplicateHandling: string;
  defaultLeadStatus: string;
  enableUserQuotas: boolean;
  defaultUserId: string | null;
  stateFilter: string[];
  loanTypeFilter: string[];
  vendor: { id: string; name: string; slug: string };
  defaultUser: { id: string; name: string } | null;
  group?: GroupRef | null;
  groupId?: string | null;
  _count: { members: number; leads: number };
  createdAt: Date | string;
  updatedAt: Date | string;
  totalDailyQuota: number;
  avgLeads5bd: number;
};
type CampaignDetail = Campaign & {
  members: Array<{
    id: string;
    userId: string;
    dailyQuota: number;
    weeklyQuota: number;
    monthlyQuota: number;
    active: boolean;
    roundRobinPosition: number;
    leadsReceivedToday: number;
    leadsReceivedThisWeek: number;
    leadsReceivedThisMonth: number;
    user: { id: string; name: string; email: string; role: string };
  }>;
};

type Props = {
  campaigns: Campaign[];
  vendors: Vendor[];
  users: EligibleUser[];
  groups?: GroupOption[];
  teams?: LeadUserTeamSummary[];
  filterGroupId?: string | null;
  onChangeFilterGroupId?: (id: string | null) => void;
  campaignDetail?: CampaignDetail | null;
};

type FormState = {
  name: string;
  description: string;
  vendorId: string;
  routingTag: string;
  distributionMethod: 'ROUND_ROBIN' | 'MANUAL';
  independentRotation: boolean;
  duplicateHandling: 'NONE' | 'REJECT' | 'ALLOW';
  defaultLeadStatus: string;
  enableUserQuotas: boolean;
  defaultUserId: string;
  stateFilter: string;
  loanTypeFilter: string;
  memberUserIds: string[];
  // Per-selected-LO daily cap for this campaign. Same column that
  // LeadUserManager's drawer writes to (CampaignMember.dailyQuota), so
  // both UIs stay perfectly in sync. 0 = unlimited by product convention.
  memberQuotas: Record<string, number>;
  groupId: string;
};

const EMPTY_FORM: FormState = {
  name: '',
  description: '',
  vendorId: '',
  routingTag: '',
  distributionMethod: 'ROUND_ROBIN',
  independentRotation: true,
  duplicateHandling: 'NONE',
  defaultLeadStatus: 'NEW',
  enableUserQuotas: true,
  defaultUserId: '',
  stateFilter: '',
  loanTypeFilter: '',
  memberUserIds: [],
  memberQuotas: {},
  groupId: '',
};

// Palette for the Group column dot. Kept in sync with GROUP_COLOR_CLASSES
// in CampaignGroupManager; this small map avoids pulling the full client
// component just to render a 0.5rem dot.
const GROUP_DOT_COLOR: Record<string, string> = {
  blue: 'bg-blue-500',
  violet: 'bg-violet-500',
  emerald: 'bg-emerald-500',
  amber: 'bg-amber-500',
  rose: 'bg-rose-500',
  cyan: 'bg-cyan-500',
  fuchsia: 'bg-fuchsia-500',
  slate: 'bg-slate-500',
};
function groupDotClass(color?: string | null) {
  if (!color) return 'bg-slate-300';
  return GROUP_DOT_COLOR[color] ?? 'bg-slate-400';
}

// Renders 1-3 small dots for the Group column in the campaigns table.
// Falls back to the legacy single `color` when the row came back before
// the colors array was threaded through.
function renderGroupColDots(colors: string[] | undefined | null, fallback?: string | null) {
  const safe = (colors && colors.length > 0
    ? colors
    : fallback
      ? [fallback]
      : ['blue']
  ).slice(0, 3);
  return (
    <span className="inline-flex items-center -space-x-0.5 shrink-0">
      {safe.map((c, i) => (
        <span
          key={`${c}-${i}`}
          className={`inline-block h-2 w-2 rounded-full ring-1 ring-white ${groupDotClass(c)}`}
        />
      ))}
    </span>
  );
}

// Team-chip dot renderer. Teams use teamColorClasses (imported), not the
// local GROUP_DOT_COLOR map.
function renderTeamChipDots(colors: string[] | undefined, fallback?: string) {
  const safe = (colors && colors.length > 0
    ? colors
    : fallback
      ? [fallback]
      : ['blue']
  ).slice(0, 3);
  return (
    <span className="inline-flex items-center -space-x-0.5 shrink-0">
      {safe.map((c, i) => (
        <span
          key={`${c}-${i}`}
          className={`inline-block h-2 w-2 rounded-full ring-1 ring-white ${teamColorClasses(c).dot}`}
        />
      ))}
    </span>
  );
}

function InfoTip({ text }: { text: string }) {
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const timeout = useRef<ReturnType<typeof setTimeout>>(undefined);
  const iconRef = useRef<HTMLSpanElement>(null);
  const tipWidth = 224;

  const open = () => {
    clearTimeout(timeout.current);
    if (iconRef.current) {
      const rect = iconRef.current.getBoundingClientRect();
      let left = rect.left + rect.width / 2 - tipWidth / 2;
      if (left < 8) left = 8;
      if (left + tipWidth > window.innerWidth - 8) left = window.innerWidth - tipWidth - 8;
      setPos({ top: rect.top - 8, left });
    }
  };
  const close = () => { timeout.current = setTimeout(() => setPos(null), 150); };

  return (
    <span ref={iconRef} className="inline-flex ml-1 align-middle" onMouseEnter={open} onMouseLeave={close}>
      <HelpCircle className="h-3.5 w-3.5 text-slate-400 hover:text-slate-600 cursor-help transition-colors" />
      {pos && (
        <span
          className="fixed z-[9999] w-56 rounded-lg border border-slate-200 bg-slate-800 px-3 py-2 text-[11px] leading-relaxed text-white shadow-lg"
          style={{ top: pos.top, left: pos.left, transform: 'translateY(-100%)' }}
          onMouseEnter={() => clearTimeout(timeout.current)}
          onMouseLeave={close}
        >
          {text}
        </span>
      )}
    </span>
  );
}

export function CampaignManager({
  campaigns,
  vendors,
  users,
  groups = [],
  teams = [],
  filterGroupId = null,
  onChangeFilterGroupId,
}: Props) {
  const router = useRouter();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deletingCampaign, setDeletingCampaign] = useState<Campaign | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [availableSearch, setAvailableSearch] = useState('');
  const [assignedSearch, setAssignedSearch] = useState('');
  const [filterVendor, setFilterVendor] = useState('');
  const [campaignSearch, setCampaignSearch] = useState('');
  const [showArchived, setShowArchived] = useState(false);
  const [sortCol, setSortCol] = useState<string>('created');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [colWidths, setColWidths] = useState<Record<string, number>>({});
  const resizingCol = useRef<string | null>(null);
  const resizeStartX = useRef(0);
  const resizeStartW = useRef(0);
  const tableRef = useRef<HTMLTableElement>(null);

  const toggleSort = useCallback((col: string) => {
    setSortCol((prev) => {
      if (prev === col) {
        setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
        return col;
      }
      setSortDir('asc');
      return col;
    });
  }, []);

  const onResizeStart = useCallback((col: string, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    resizingCol.current = col;
    resizeStartX.current = e.clientX;
    const th = (e.target as HTMLElement).closest('th');
    resizeStartW.current = th?.offsetWidth ?? 120;
  }, []);

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!resizingCol.current) return;
      const diff = e.clientX - resizeStartX.current;
      const newW = Math.max(60, resizeStartW.current + diff);
      setColWidths((prev) => ({ ...prev, [resizingCol.current!]: newW }));
    };
    const onUp = () => { resizingCol.current = null; };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, []);

  const archivedCount = useMemo(
    () => campaigns.filter((c) => !c.active).length,
    [campaigns]
  );

  const filtered = useMemo(() => {
    let list = campaigns;
    if (!showArchived) list = list.filter((c) => c.active);
    if (filterVendor) list = list.filter((c) => c.vendorId === filterVendor);
    if (filterGroupId !== null) {
      // "__none__" is the sentinel for "campaigns with no group". Any
      // other id means match that specific group only.
      if (filterGroupId === '__none__') {
        list = list.filter((c) => !c.groupId);
      } else {
        list = list.filter((c) => c.groupId === filterGroupId);
      }
    }
    if (campaignSearch) {
      const q = campaignSearch.toLowerCase();
      list = list.filter(
        (c) =>
          c.name.toLowerCase().includes(q) ||
          c.routingTag.toLowerCase().includes(q) ||
          c.vendor.name.toLowerCase().includes(q) ||
          (c.description && c.description.toLowerCase().includes(q)) ||
          (c.group?.name && c.group.name.toLowerCase().includes(q))
      );
    }

    const sorted = [...list].sort((a, b) => {
      let cmp = 0;
      switch (sortCol) {
        case 'name': cmp = a.name.localeCompare(b.name); break;
        case 'vendor': cmp = a.vendor.name.localeCompare(b.vendor.name); break;
        case 'group': cmp = (a.group?.name || '').localeCompare(b.group?.name || ''); break;
        case 'tag': cmp = a.routingTag.localeCompare(b.routingTag); break;
        case 'members': cmp = a._count.members - b._count.members; break;
        case 'leads': cmp = a._count.leads - b._count.leads; break;
        case 'status': cmp = (a.active === b.active ? 0 : a.active ? -1 : 1); break;
        case 'created': cmp = new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(); break;
        case 'modified': cmp = new Date(a.updatedAt).getTime() - new Date(b.updatedAt).getTime(); break;
        case 'quota': cmp = a.totalDailyQuota - b.totalDailyQuota; break;
        case 'avg5bd': cmp = a.avgLeads5bd - b.avgLeads5bd; break;
        default: cmp = 0;
      }
      return sortDir === 'asc' ? cmp : -cmp;
    });
    return sorted;
  }, [campaigns, filterVendor, filterGroupId, campaignSearch, sortCol, sortDir, showArchived]);

  const memberIdSet = useMemo(
    () => new Set(form.memberUserIds),
    [form.memberUserIds]
  );

  const availableUsers = useMemo(() => {
    const pool = users.filter((u) => !memberIdSet.has(u.id));
    if (!availableSearch) return pool;
    const q = availableSearch.toLowerCase();
    return pool.filter(
      (u) =>
        u.name.toLowerCase().includes(q) ||
        u.email.toLowerCase().includes(q)
    );
  }, [users, memberIdSet, availableSearch]);

  const assignedUsers = useMemo(() => {
    const pool = users.filter((u) => memberIdSet.has(u.id));
    if (!assignedSearch) return pool;
    const q = assignedSearch.toLowerCase();
    return pool.filter(
      (u) =>
        u.name.toLowerCase().includes(q) ||
        u.email.toLowerCase().includes(q)
    );
  }, [users, memberIdSet, assignedSearch]);

  const openCreate = useCallback(() => {
    setForm({ ...EMPTY_FORM, vendorId: vendors[0]?.id || '' });
    setIsCreating(true);
    setEditingId(null);
  }, [vendors]);

  const openEdit = useCallback(async (c: Campaign) => {
    const { getLeadCampaign } = await import('@/app/actions/leadActions');
    const detail = await getLeadCampaign(c.id);
    setForm({
      name: c.name,
      description: c.description || '',
      vendorId: c.vendorId,
      routingTag: c.routingTag,
      distributionMethod: c.distributionMethod as 'ROUND_ROBIN' | 'MANUAL',
      independentRotation: c.independentRotation,
      duplicateHandling: c.duplicateHandling as 'NONE' | 'REJECT' | 'ALLOW',
      defaultLeadStatus: c.defaultLeadStatus,
      enableUserQuotas: c.enableUserQuotas,
      defaultUserId: c.defaultUserId || '',
      stateFilter: c.stateFilter.join(', '),
      loanTypeFilter: c.loanTypeFilter.join(', '),
      memberUserIds: detail?.members.map((m) => m.userId) || [],
      memberQuotas: Object.fromEntries(
        (detail?.members ?? []).map((m) => [m.userId, m.dailyQuota ?? 0])
      ),
      groupId: c.groupId || '',
    });
    setEditingId(c.id);
    setIsCreating(false);
  }, []);

  const closeModal = useCallback(() => {
    setEditingId(null);
    setIsCreating(false);
    setAvailableSearch('');
    setAssignedSearch('');
  }, []);

  const handleSave = async () => {
    setSaving(true);
    setLoading(true);
    try {
      const payload = {
        name: form.name,
        description: form.description || undefined,
        vendorId: form.vendorId,
        routingTag: form.routingTag,
        distributionMethod: form.distributionMethod as 'ROUND_ROBIN' | 'MANUAL',
        independentRotation: form.independentRotation,
        duplicateHandling: form.duplicateHandling as 'NONE' | 'REJECT' | 'ALLOW',
        defaultLeadStatus: form.defaultLeadStatus,
        enableUserQuotas: form.enableUserQuotas,
        defaultUserId: form.defaultUserId || undefined,
        stateFilter: form.stateFilter ? form.stateFilter.split(',').map((s) => s.trim()).filter(Boolean) : [],
        loanTypeFilter: form.loanTypeFilter ? form.loanTypeFilter.split(',').map((s) => s.trim()).filter(Boolean) : [],
        groupId: form.groupId ? form.groupId : null,
      };

      // Build the rich members payload once — each entry carries the
      // per-LO daily cap that lives on CampaignMember.dailyQuota. Same
      // column the Lead Users drawer writes to, so the two UIs are a
      // single source of truth.
      const memberPayload = form.memberUserIds.map((userId) => ({
        userId,
        dailyQuota: form.memberQuotas[userId] ?? 0,
      }));

      if (isCreating) {
        const campaign = await createLeadCampaign(payload);
        if (memberPayload.length > 0) {
          await setCampaignMembers(campaign.id, memberPayload);
        }
      } else if (editingId) {
        await updateLeadCampaign(editingId, payload);
        await setCampaignMembers(editingId, memberPayload);
      }
      closeModal();
      router.refresh();
    } finally {
      setSaving(false);
      setLoading(false);
    }
  };

  const handleArchive = async (c: Campaign) => {
    if (
      !window.confirm(
        `Archive campaign "${c.name}"? Incoming leads tagged with its routing tag will fall to the Unassigned Pool. Fully reversible — click Restore to bring it back. No data is lost.`
      )
    )
      return;
    setLoading(true);
    try {
      await archiveLeadCampaign(c.id);
      router.refresh();
    } finally {
      setLoading(false);
    }
  };

  const handleRestore = async (c: Campaign) => {
    setLoading(true);
    try {
      await restoreLeadCampaign(c.id);
      router.refresh();
    } finally {
      setLoading(false);
    }
  };

  const openDeleteDialog = (c: Campaign) => setDeletingCampaign(c);
  const closeDeleteDialog = () => setDeletingCampaign(null);

  const toggleMember = (userId: string) => {
    setForm((prev) => {
      const isOn = prev.memberUserIds.includes(userId);
      const nextIds = isOn
        ? prev.memberUserIds.filter((id) => id !== userId)
        : [...prev.memberUserIds, userId];
      // Seed a default of 0 (unlimited) when adding; leave existing
      // entries alone on remove so re-selecting the LO restores the
      // number they had before.
      const nextQuotas = { ...prev.memberQuotas };
      if (!isOn && nextQuotas[userId] === undefined) {
        nextQuotas[userId] = 0;
      }
      return { ...prev, memberUserIds: nextIds, memberQuotas: nextQuotas };
    });
  };

  const setMemberQuota = (userId: string, value: number) => {
    const clamped = Number.isFinite(value) ? Math.max(0, Math.trunc(value)) : 0;
    setForm((prev) => ({
      ...prev,
      memberQuotas: { ...prev.memberQuotas, [userId]: clamped },
    }));
  };

  // Batch-toggle a team's users in/out of the current selection. Toggle
  // semantics (per product decision): if every team member is already
  // selected, clicking removes all of them; otherwise clicking adds the
  // missing ones. We intentionally only mutate memberUserIds +
  // memberQuotas so the inline /day input logic behaves identically to a
  // row of individual toggleMember clicks.
  const toggleTeam = (team: LeadUserTeamSummary) => {
    if (team.memberIds.length === 0) return;
    setForm((prev) => {
      const current = new Set(prev.memberUserIds);
      const allIn = team.memberIds.every((id) => current.has(id));
      const nextQuotas = { ...prev.memberQuotas };
      if (allIn) {
        for (const id of team.memberIds) current.delete(id);
      } else {
        for (const id of team.memberIds) {
          if (!current.has(id)) {
            current.add(id);
            if (nextQuotas[id] === undefined) nextQuotas[id] = 0;
          }
        }
      }
      return {
        ...prev,
        memberUserIds: Array.from(current),
        memberQuotas: nextQuotas,
      };
    });
  };

  const copyWebhookInfo = (c: Campaign) => {
    const vendor = vendors.find((v) => v.id === c.vendorId);
    const url = `${window.location.origin}/api/webhooks/leads/${vendor?.slug || ''}`;
    navigator.clipboard.writeText(`URL: ${url}\nRouting Tag: ${c.routingTag}`);
    setCopiedId(c.id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const showModal = isCreating || editingId !== null;

  return (
    <div className="space-y-6">
      {loading && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-white/70 backdrop-blur-[2px]">
          <div className="flex flex-col items-center gap-3">
            <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
            <p className="text-sm font-medium text-slate-600">Saving changes...</p>
          </div>
        </div>
      )}
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="relative">
            <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
            <input
              className="rounded-lg border border-slate-200 bg-white pl-9 pr-3 py-2 text-sm w-56 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
              placeholder="Search campaigns..."
              value={campaignSearch}
              onChange={(e) => setCampaignSearch(e.target.value)}
            />
          </div>
          <select
            className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
            value={filterVendor}
            onChange={(e) => setFilterVendor(e.target.value)}
          >
            <option value="">All Vendors</option>
            {vendors.map((v) => (
              <option key={v.id} value={v.id}>{v.name}</option>
            ))}
          </select>
          {groups.length > 0 && onChangeFilterGroupId && (
            <select
              className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
              value={filterGroupId ?? ''}
              onChange={(e) => onChangeFilterGroupId(e.target.value || null)}
              title="Filter by group"
            >
              <option value="">All Groups</option>
              <option value="__none__">No group</option>
              {groups
                .filter((g) => g.active)
                .map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.name}
                  </option>
                ))}
            </select>
          )}
          <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
            {filtered.length} campaign{filtered.length !== 1 ? 's' : ''}
          </span>
          {archivedCount > 0 && (
            <button
              type="button"
              onClick={() => setShowArchived((p) => !p)}
              className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-colors ${
                showArchived
                  ? 'border-amber-300 bg-amber-50 text-amber-700'
                  : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
              }`}
              title="Archived campaigns are hidden from the default list but their data and members are preserved."
            >
              <Archive className="h-3.5 w-3.5" />
              {showArchived ? 'Hide' : 'Show'} archived ({archivedCount})
            </button>
          )}
        </div>
        {vendors.length === 0 ? (
          <span className="text-xs text-amber-600 font-medium" title="You need at least one vendor before creating a campaign">
            Add a vendor first to create campaigns
          </span>
        ) : (
          <button className="app-btn-primary" onClick={openCreate}>
            <Plus className="mr-1.5 h-4 w-4" />
            Add Campaign
          </button>
        )}
      </div>

      {filtered.length === 0 ? (
        <div className="rounded-xl border border-slate-200 bg-white p-12 text-center shadow-sm">
          <Megaphone className="mx-auto h-10 w-10 text-slate-300" />
          <p className="mt-3 text-sm font-semibold text-slate-700">No campaigns yet</p>
          <p className="mt-1 text-sm text-slate-500">
            {vendors.length === 0
              ? 'Add a vendor first, then create campaigns to start routing leads.'
              : 'Create a campaign to start routing leads to loan officers.'}
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-slate-200">
          <table ref={tableRef} className="w-full text-sm" style={{ tableLayout: Object.keys(colWidths).length ? 'fixed' : undefined }}>
            <thead className="sticky top-0 z-[1] bg-slate-50">
              <tr className="border-b border-slate-200">
                {([
                  { key: 'status', label: 'Status', align: 'left' },
                  { key: 'name', label: 'Campaign', align: 'left' },
                  { key: 'vendor', label: 'Vendor', align: 'left' },
                  { key: 'group', label: 'Group', align: 'left' },
                  { key: 'tag', label: 'Routing Tag', align: 'left' },
                  { key: 'members', label: 'Members', align: 'center' },
                  { key: 'leads', label: 'Leads', align: 'center' },
                  { key: 'quota', label: 'Total Quotas', align: 'center' },
                  { key: 'avg5bd', label: 'Avg / 5 BD', align: 'center' },
                  { key: 'created', label: 'Created', align: 'left' },
                  { key: 'modified', label: 'Modified', align: 'left' },
                ] as const).map((col) => (
                  <th
                    key={col.key}
                    className={`relative px-4 py-3 text-${col.align} text-[11px] font-bold uppercase tracking-wider text-slate-500 cursor-pointer select-none hover:text-slate-700 transition-colors group/th`}
                    style={colWidths[col.key] ? { width: colWidths[col.key] } : undefined}
                    onClick={() => toggleSort(col.key)}
                  >
                    <span className="inline-flex items-center gap-1">
                      {col.label}
                      {sortCol === col.key && (
                        sortDir === 'asc'
                          ? <ArrowUp className="h-3 w-3 text-blue-600" />
                          : <ArrowDown className="h-3 w-3 text-blue-600" />
                      )}
                    </span>
                    <div
                      className="absolute right-0 top-0 bottom-0 w-[5px] cursor-col-resize flex items-center justify-center opacity-0 group-hover/th:opacity-100 hover:!opacity-100 transition-opacity z-[2]"
                      onMouseDown={(e) => onResizeStart(col.key, e)}
                      onClick={(e) => e.stopPropagation()}
                    >
                      <div className="h-4 w-[3px] rounded-sm border-x border-slate-300" />
                    </div>
                  </th>
                ))}
                {/*
                  Fixed width + nowrap on the Actions column so auto-layout
                  always reserves space for it. Without this, `whitespace-nowrap`
                  on Created/Modified pushes the table past its container and
                  the Actions column renders off-screen to the right on first
                  paint — it only appears once a user-initiated resize flips
                  the table to `tableLayout: fixed`.
                */}
                <th
                  className="px-4 py-3 text-right text-[11px] font-bold uppercase tracking-wider text-slate-500 whitespace-nowrap"
                  style={{ width: 140, minWidth: 140 }}
                >
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {filtered.map((c) => (
                <tr
                  key={c.id}
                  className={`align-middle hover:bg-slate-50/70 ${
                    c.active ? '' : 'bg-amber-50/30'
                  }`}
                >
                  <td className="px-4 py-3">
                    <span
                      className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                        c.active
                          ? 'border border-blue-200 bg-blue-50 text-blue-700'
                          : 'border border-amber-200 bg-amber-50 text-amber-700'
                      }`}
                    >
                      {c.active ? 'Active' : 'Archived'}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <p className="font-semibold text-slate-900">{c.name}</p>
                    {c.description && <p className="text-xs text-slate-500 mt-0.5 max-w-xs truncate">{c.description}</p>}
                  </td>
                  <td className="px-4 py-3 text-slate-600">{c.vendor.name}</td>
                  <td className="px-4 py-3 text-slate-600">
                    {c.group ? (
                      <span className="inline-flex items-center gap-1.5">
                        {renderGroupColDots(c.group.colors, c.group.color)}
                        <span className="truncate">{c.group.name}</span>
                      </span>
                    ) : (
                      <span className="text-slate-300">&mdash;</span>
                    )}
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-slate-500">{c.routingTag}</td>
                  <td className="px-4 py-3 text-center text-slate-700">{c._count.members}</td>
                  <td className="px-4 py-3 text-center text-slate-700">{c._count.leads}</td>
                  <td className="px-4 py-3 text-center text-slate-700">{c.totalDailyQuota}</td>
                  <td className="px-4 py-3 text-center text-slate-700">{c.avgLeads5bd}</td>
                  <td className="px-4 py-3 text-xs text-slate-500 whitespace-nowrap">
                    <FormatDate date={c.createdAt} mode="datetime" />
                  </td>
                  <td className="px-4 py-3 text-xs text-slate-500 whitespace-nowrap">
                    <FormatDate date={c.updatedAt} mode="datetime" />
                  </td>
                  <td className="px-4 py-3 text-right whitespace-nowrap">
                    <div className="flex items-center justify-end gap-1">
                      <button className="app-icon-btn" onClick={() => copyWebhookInfo(c)} title="Copy webhook info">
                        {copiedId === c.id ? <Check className="h-4 w-4 text-green-600" /> : <Copy className="h-4 w-4" />}
                      </button>
                      <button className="app-icon-btn" onClick={() => void openEdit(c)} title="Edit">
                        <Pencil className="h-4 w-4" />
                      </button>
                      {c.active ? (
                        <button
                          className="app-icon-btn text-amber-600 hover:bg-amber-50"
                          onClick={() => void handleArchive(c)}
                          title="Archive campaign"
                        >
                          <Archive className="h-4 w-4" />
                        </button>
                      ) : (
                        <>
                          <button
                            className="app-icon-btn text-emerald-600 hover:bg-emerald-50"
                            onClick={() => void handleRestore(c)}
                            title="Restore campaign"
                          >
                            <ArchiveRestore className="h-4 w-4" />
                          </button>
                          <button
                            className="app-icon-btn app-icon-btn-danger"
                            onClick={() => openDeleteDialog(c)}
                            title="Permanently delete…"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center" onClick={closeModal}>
          <div className="absolute inset-0 bg-slate-900/30 backdrop-blur-sm" />
          <div
            role="dialog"
            aria-modal="true"
            className="relative w-full max-w-2xl rounded-xl border border-slate-200 bg-white p-6 shadow-lg max-h-[85vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-lg font-semibold text-slate-900">
                {isCreating ? 'Create Campaign' : 'Edit Campaign'}
              </h2>
              <button className="app-icon-btn" onClick={closeModal} aria-label="Close">
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="space-y-6">
              {/* Basic Info */}
              <div>
                <p className="text-[11px] font-bold uppercase tracking-wider text-slate-500 mb-3">Basic Info</p>
                <div className="grid grid-cols-2 gap-4">
                  <label className="space-y-1 text-sm">
                    <span className="font-medium text-slate-700">Name *<InfoTip text="A friendly name for this campaign, e.g. 'CA Retail - Leadpoint'. Used throughout the portal to identify this lead product." /></span>
                    <input
                      className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                      value={form.name}
                      onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))}
                      placeholder="Campaign name"
                    />
                  </label>
                  <label className="space-y-1 text-sm">
                    <span className="font-medium text-slate-700">Vendor *<InfoTip text="The lead vendor/source that sends leads for this campaign. Must be set up in the Vendors page first." /></span>
                    <select
                      className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                      value={form.vendorId}
                      onChange={(e) => setForm((p) => ({ ...p, vendorId: e.target.value }))}
                    >
                      {vendors.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
                    </select>
                  </label>
                </div>
                <div className="grid grid-cols-2 gap-4 mt-4">
                  <label className="space-y-1 text-sm">
                    <span className="font-medium text-slate-700">Description<InfoTip text="Optional details about this campaign — loan type, filters, date range, etc. Helps admins distinguish between similar campaigns." /></span>
                    <input
                      className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                      value={form.description}
                      onChange={(e) => setForm((p) => ({ ...p, description: e.target.value }))}
                      placeholder="(1-2026)HELOC/HELOAN_(700) 0-80LTV"
                    />
                  </label>
                  <label className="space-y-1 text-sm">
                    <span className="font-medium text-slate-700">Routing Tag *<InfoTip text="A unique identifier (usually a number) provided by the vendor that tells the system which campaign an incoming lead belongs to. Must match what the vendor sends." /></span>
                    <input
                      className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-mono focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                      value={form.routingTag}
                      onChange={(e) => setForm((p) => ({ ...p, routingTag: e.target.value }))}
                      placeholder="927726"
                    />
                  </label>
                </div>
                <div className="grid grid-cols-2 gap-4 mt-4">
                  <label className="space-y-1 text-sm">
                    <span className="font-medium text-slate-700">Group<InfoTip text="Optional. Bundles this campaign with related ones so admins can filter, sort, and bulk-assign users at the group level." /></span>
                    <select
                      className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                      value={form.groupId}
                      onChange={(e) => setForm((p) => ({ ...p, groupId: e.target.value }))}
                    >
                      <option value="">(no group)</option>
                      {groups
                        .filter((g) => g.active)
                        .map((g) => (
                          <option key={g.id} value={g.id}>
                            {g.name}
                          </option>
                        ))}
                    </select>
                  </label>
                </div>
              </div>

              {/* Assignment */}
              <div>
                <p className="text-[11px] font-bold uppercase tracking-wider text-slate-500 mb-3">Assignment</p>

                <div className="grid grid-cols-2 gap-4">
                  {/* Left box: Available (unassigned) users */}
                  <div className="space-y-2">
                    <div className="flex items-center justify-between min-h-[22px]">
                      <span className="text-xs font-medium text-slate-700">
                        Available Users ({availableUsers.length})
                        <InfoTip text="Loan officers not yet assigned to this campaign. Click a user to add them to the Assigned list." />
                      </span>
                    </div>
                    <div className="relative">
                      <Search className="absolute left-3 top-2.5 h-3.5 w-3.5 text-slate-400" />
                      <input
                        className="w-full rounded-lg border border-slate-200 bg-white pl-8 pr-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                        placeholder="Search available..."
                        value={availableSearch}
                        onChange={(e) => setAvailableSearch(e.target.value)}
                      />
                    </div>
                    <div className="h-48 overflow-y-auto rounded-lg border border-slate-200 bg-white">
                      {availableUsers.length === 0 ? (
                        <div className="flex h-full items-center justify-center px-3 py-6 text-center text-xs text-slate-400">
                          {availableSearch
                            ? 'No users match your search.'
                            : users.length === 0
                              ? 'No users exist yet.'
                              : 'Every user is already assigned.'}
                        </div>
                      ) : (
                        availableUsers.map((u) => (
                          <div
                            key={u.id}
                            role="button"
                            aria-label={`Assign ${u.name} to this campaign`}
                            tabIndex={0}
                            onClick={() => toggleMember(u.id)}
                            onKeyDown={(e) => {
                              if (e.key === ' ' || e.key === 'Enter') {
                                e.preventDefault();
                                toggleMember(u.id);
                              }
                            }}
                            className="group w-full flex items-center gap-2 px-3 py-2 text-left text-sm text-slate-700 transition-colors cursor-pointer outline-none hover:bg-slate-50 focus-visible:bg-slate-100"
                          >
                            <span className="truncate">{u.name}</span>
                            <Plus
                              className="ml-auto h-3.5 w-3.5 text-slate-300 transition-colors group-hover:text-blue-500 group-focus-visible:text-blue-500"
                              aria-hidden="true"
                            />
                          </div>
                        ))
                      )}
                    </div>
                  </div>

                  {/* Right box: Assigned users */}
                  <div className="space-y-2">
                    <div className="flex items-center justify-between min-h-[22px]">
                      <span className="text-xs font-medium text-slate-700">
                        Assigned Users ({form.memberUserIds.length})
                        <InfoTip text="Loan officers who will receive leads from this campaign. Click a user to remove them. Leads are distributed among these users based on the distribution method." />
                      </span>
                    </div>
                    {teams.length > 0 && (
                      <div className="flex flex-wrap gap-1.5 pb-1" aria-label="Teams">
                        {teams.map((t) => {
                          const memberIds = t.memberIds;
                          const selectedCount = memberIds.filter((id) =>
                            form.memberUserIds.includes(id)
                          ).length;
                          const total = memberIds.length;
                          const allSelected = total > 0 && selectedCount === total;
                          const accent = t.colors?.[0] ?? t.color;
                          const cls = teamColorClasses(accent);
                          return (
                            <button
                              key={t.id}
                              type="button"
                              onClick={() => toggleTeam(t)}
                              disabled={total === 0}
                              title={
                                total === 0
                                  ? `${t.name} has no members yet`
                                  : allSelected
                                    ? `Click to remove all ${total} ${t.name} members`
                                    : `Click to add ${total - selectedCount} missing ${t.name} member${total - selectedCount === 1 ? '' : 's'}`
                              }
                              className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors ${
                                allSelected ? cls.chipActive : cls.chipInactive
                              } ${allSelected ? `ring-1 ${cls.ring}` : ''} ${total === 0 ? 'opacity-50 cursor-not-allowed' : ''}`}
                            >
                              {renderTeamChipDots(t.colors, accent)}
                              <span className="truncate max-w-[140px]">{t.name}</span>
                              <span className="text-[10px] font-semibold opacity-70 tabular-nums">
                                {selectedCount}/{total}
                              </span>
                            </button>
                          );
                        })}
                      </div>
                    )}
                    <div className="relative">
                      <Search className="absolute left-3 top-2.5 h-3.5 w-3.5 text-slate-400" />
                      <input
                        className="w-full rounded-lg border border-slate-200 bg-white pl-8 pr-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                        placeholder="Search assigned..."
                        value={assignedSearch}
                        onChange={(e) => setAssignedSearch(e.target.value)}
                      />
                    </div>
                    <div className="h-48 overflow-y-auto rounded-lg border border-slate-200 bg-white">
                      {assignedUsers.length === 0 ? (
                        <div className="flex h-full items-center justify-center px-3 py-6 text-center text-xs text-slate-400">
                          {form.memberUserIds.length === 0
                            ? 'No users assigned yet. Click a user on the left to add them.'
                            : 'No assigned users match your search.'}
                        </div>
                      ) : (
                        assignedUsers.map((u) => (
                          <div
                            key={u.id}
                            role="button"
                            aria-label={`Remove ${u.name} from this campaign`}
                            tabIndex={0}
                            onClick={() => toggleMember(u.id)}
                            onKeyDown={(e) => {
                              if (e.key === ' ' || e.key === 'Enter') {
                                e.preventDefault();
                                toggleMember(u.id);
                              }
                            }}
                            className="group w-full flex items-center gap-2 px-3 py-2 text-left text-sm text-blue-800 bg-blue-50 transition-colors cursor-pointer outline-none hover:bg-blue-100 focus-visible:bg-blue-100"
                          >
                            <span className="truncate">{u.name}</span>
                            <span
                              className="ml-auto flex items-center gap-1"
                              onClick={(e) => e.stopPropagation()}
                              onKeyDown={(e) => e.stopPropagation()}
                            >
                              <input
                                type="number"
                                min={0}
                                value={form.memberQuotas[u.id] ?? 0}
                                onChange={(e) =>
                                  setMemberQuota(u.id, Number(e.target.value) || 0)
                                }
                                onClick={(e) => e.stopPropagation()}
                                onKeyDown={(e) => e.stopPropagation()}
                                onFocus={(e) => e.stopPropagation()}
                                className="w-14 rounded-md border border-slate-200 bg-white px-1.5 py-1 text-xs text-center tabular-nums text-slate-700 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                                title="Daily cap for this LO on this campaign. 0 = unlimited. Mirrors the 'Daily Quota' in the Lead Users drawer."
                              />
                              <span className="text-[10px] font-medium uppercase tracking-wider text-slate-400">
                                /day
                              </span>
                            </span>
                            <X
                              className="h-3.5 w-3.5 text-blue-300 opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100"
                              aria-hidden="true"
                            />
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                </div>

                {/* Config row: Default User (Fallback) + Distribution Method */}
                <div className="mt-4 grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <span className="text-xs font-medium text-slate-700">
                      Default User (Fallback)
                      <InfoTip text="If no assigned user is eligible (all hit their quotas, wrong state, etc.), this person receives the lead as a safety net. Typically a manager." />
                    </span>
                    <select
                      className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                      value={form.defaultUserId}
                      onChange={(e) => setForm((p) => ({ ...p, defaultUserId: e.target.value }))}
                    >
                      <option value="">None</option>
                      {users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
                    </select>
                    <p className="text-xs text-slate-500">Manager/fallback who receives unroutable leads and has oversight visibility.</p>
                  </div>
                  <div className="space-y-2">
                    <span className="text-xs font-medium text-slate-700">
                      Distribution Method
                      <InfoTip text="Round Robin automatically rotates leads evenly across assigned users in order. Manual means leads go to the Unassigned Pool for a manager to hand-assign." />
                    </span>
                    <select
                      className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                      value={form.distributionMethod}
                      onChange={(e) => setForm((p) => ({ ...p, distributionMethod: e.target.value as 'ROUND_ROBIN' | 'MANUAL' }))}
                    >
                      <option value="ROUND_ROBIN">Round Robin</option>
                      <option value="MANUAL">Manual</option>
                    </select>
                  </div>
                </div>
              </div>

              {/* Options */}
              <div>
                <p className="text-[11px] font-bold uppercase tracking-wider text-slate-500 mb-3">Options</p>
                <div className="grid grid-cols-2 gap-4">
                  <label className="space-y-1 text-sm">
                    <span className="font-medium text-slate-700">Duplicate Handling<InfoTip text="Controls what happens when a lead with the same vendor ID arrives again. 'None' does nothing special. 'Reject' blocks the duplicate. 'Allow' lets it through as a new lead." /></span>
                    <select
                      className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                      value={form.duplicateHandling}
                      onChange={(e) => setForm((p) => ({ ...p, duplicateHandling: e.target.value as 'NONE' | 'REJECT' | 'ALLOW' }))}
                    >
                      <option value="NONE">None</option>
                      <option value="REJECT">Reject Duplicates</option>
                      <option value="ALLOW">Allow Duplicates</option>
                    </select>
                  </label>
                  <label className="space-y-1 text-sm">
                    <span className="font-medium text-slate-700">Default Lead Status<InfoTip text="The initial status a lead gets when it enters this campaign. 'New' means it's ready for the assigned LO. 'Unassigned' means it goes to the pool for manual assignment." /></span>
                    <select
                      className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                      value={form.defaultLeadStatus}
                      onChange={(e) => setForm((p) => ({ ...p, defaultLeadStatus: e.target.value }))}
                    >
                      <option value="NEW">New</option>
                      <option value="UNASSIGNED">Unassigned</option>
                    </select>
                  </label>
                </div>
                <div className="mt-4 flex flex-wrap gap-4">
                  <label className="flex items-center gap-2 text-sm text-slate-700">
                    <input
                      type="checkbox"
                      className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                      checked={form.enableUserQuotas}
                      onChange={(e) => setForm((p) => ({ ...p, enableUserQuotas: e.target.checked }))}
                    />
                    Enable User Quotas<InfoTip text="When enabled, the system enforces daily/weekly/monthly lead limits per user in this campaign. When off, users receive unlimited leads." />
                  </label>
                  <label className="flex items-center gap-2 text-sm text-slate-700">
                    <input
                      type="checkbox"
                      className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                      checked={form.independentRotation}
                      onChange={(e) => setForm((p) => ({ ...p, independentRotation: e.target.checked }))}
                    />
                    Independent Rotation<InfoTip text="When enabled, this campaign maintains its own round-robin order separate from other campaigns. When off, the rotation position is shared across campaigns." />
                  </label>
                </div>
                <div className="grid grid-cols-2 gap-4 mt-4">
                  <label className="space-y-1 text-sm">
                    <span className="font-medium text-slate-700">State Filter<InfoTip text="Restrict this campaign to leads from specific states. Leave empty to accept leads from all states. Enter comma-separated 2-letter state codes." /></span>
                    <input
                      className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                      value={form.stateFilter}
                      onChange={(e) => setForm((p) => ({ ...p, stateFilter: e.target.value }))}
                      placeholder="WA, CA, TX (comma separated, empty = all)"
                    />
                  </label>
                </div>
              </div>
            </div>

            <div className="mt-6 flex justify-end gap-3 border-t border-slate-200 pt-4">
              <button className="app-btn-secondary" onClick={closeModal}>Cancel</button>
              <button
                className="app-btn-primary disabled:opacity-70 disabled:cursor-not-allowed"
                onClick={() => void handleSave()}
                disabled={saving || !form.name.trim() || !form.vendorId || !form.routingTag.trim()}
              >
                {saving && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
                {saving ? 'Saving...' : isCreating ? 'Create Campaign' : 'Save Changes'}
              </button>
            </div>
          </div>
        </div>
      )}

      {deletingCampaign && (
        <CampaignDeleteDialog
          campaign={deletingCampaign}
          siblingCampaigns={campaigns.filter(
            (c) =>
              c.id !== deletingCampaign.id &&
              c.vendorId === deletingCampaign.vendorId &&
              c.active
          )}
          onClose={closeDeleteDialog}
        />
      )}
    </div>
  );
}

/**
 * Permanent-delete dialog for a single archived campaign. Leads on the
 * campaign must either be reassigned to a sibling (same-vendor) campaign
 * or bulk-deleted before the campaign row itself can be removed. The
 * "same vendor" constraint prevents leads from ending up with a
 * vendorId that disagrees with their campaign's vendorId.
 */
function CampaignDeleteDialog({
  campaign,
  siblingCampaigns,
  onClose,
}: {
  campaign: Campaign;
  siblingCampaigns: Campaign[];
  onClose: () => void;
}) {
  const router = useRouter();
  const [leadCount, setLeadCount] = useState(campaign._count.leads);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [targetCampaignId, setTargetCampaignId] = useState('');
  const [confirmName, setConfirmName] = useState('');

  const refreshCounts = useCallback(async () => {
    try {
      const c = await getCampaignDependencyCounts(campaign.id);
      setLeadCount(c.leads);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [campaign.id]);

  const runAction = useCallback(
    async (fn: () => Promise<void>) => {
      setBusy(true);
      setError(null);
      try {
        await fn();
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setBusy(false);
      }
    },
    []
  );

  const handleReassign = () =>
    runAction(async () => {
      if (!targetCampaignId) {
        setError('Pick a target campaign first.');
        return;
      }
      await reassignCampaignLeads(campaign.id, targetCampaignId);
      await refreshCounts();
      router.refresh();
    });

  const handleDeleteLeads = () =>
    runAction(async () => {
      if (
        !window.confirm(
          `Delete all ${leadCount} lead(s) on "${campaign.name}"? This cannot be undone.`
        )
      )
        return;
      await deleteAllCampaignLeads(campaign.id);
      await refreshCounts();
      router.refresh();
    });

  const handleFinalDelete = () =>
    runAction(async () => {
      await hardDeleteLeadCampaign(campaign.id, confirmName);
      onClose();
      router.refresh();
    });

  const dependenciesCleared = leadCount === 0;
  const confirmMatches = confirmName.trim() === campaign.name;
  const canFinalDelete = dependenciesCleared && confirmMatches && !busy;

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center"
      onClick={busy ? undefined : onClose}
    >
      <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm" />
      <div
        role="dialog"
        aria-modal="true"
        className="relative w-full max-w-xl rounded-xl border border-red-200 bg-white shadow-2xl max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4 border-b border-red-100 bg-red-50/60 px-6 py-4">
          <div className="flex items-start gap-3">
            <div className="mt-0.5 rounded-full bg-red-100 p-2">
              <AlertTriangle className="h-5 w-5 text-red-600" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-slate-900">
                Permanently delete &quot;{campaign.name}&quot;
              </h2>
              <p className="mt-1 text-xs text-slate-600">
                Clear the campaign&apos;s leads, then confirm by typing the campaign name.
              </p>
            </div>
          </div>
          <button
            className="app-icon-btn"
            onClick={onClose}
            disabled={busy}
            aria-label="Close"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="px-6 py-5 space-y-5">
          <div className={`rounded-xl border p-3 ${leadCount === 0 ? 'border-emerald-200 bg-emerald-50/40' : 'border-amber-200 bg-amber-50/40'}`}>
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
                Leads on this campaign
              </span>
              {leadCount === 0 ? (
                <Check className="h-4 w-4 text-emerald-600" />
              ) : (
                <AlertTriangle className="h-4 w-4 text-amber-600" />
              )}
            </div>
            <p className="mt-1 text-2xl font-bold text-slate-900">{leadCount}</p>
          </div>

          {error && (
            <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
              {error}
            </div>
          )}

          {leadCount > 0 && (
            <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-4 space-y-3">
              <p className="text-[11px] font-bold uppercase tracking-wider text-slate-600">
                Step 1 — Handle Leads
              </p>

              <div className="space-y-2">
                <label className="block text-xs font-medium text-slate-700">
                  Reassign all {leadCount} lead{leadCount !== 1 ? 's' : ''} to another campaign on the same vendor:
                </label>
                <div className="flex gap-2">
                  <select
                    className="flex-1 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                    value={targetCampaignId}
                    onChange={(e) => setTargetCampaignId(e.target.value)}
                    disabled={busy || siblingCampaigns.length === 0}
                  >
                    <option value="">
                      {siblingCampaigns.length === 0
                        ? 'No other active campaigns for this vendor'
                        : 'Select target campaign…'}
                    </option>
                    {siblingCampaigns.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name} ({c.routingTag})
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    className="app-btn-secondary"
                    onClick={handleReassign}
                    disabled={!targetCampaignId || busy}
                  >
                    Reassign
                  </button>
                </div>
              </div>

              <div className="flex items-center gap-3 pt-1">
                <div className="h-px flex-1 bg-slate-200" />
                <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                  OR
                </span>
                <div className="h-px flex-1 bg-slate-200" />
              </div>

              <button
                type="button"
                className="w-full rounded-lg border border-red-200 bg-white px-3 py-2 text-xs font-semibold text-red-600 hover:bg-red-50 disabled:opacity-60"
                onClick={handleDeleteLeads}
                disabled={busy}
              >
                Delete all {leadCount} lead{leadCount !== 1 ? 's' : ''}
              </button>
            </div>
          )}

          <div
            className={`rounded-xl border p-4 space-y-3 ${
              dependenciesCleared ? 'border-red-200 bg-red-50/40' : 'border-slate-200 bg-slate-50/40 opacity-60'
            }`}
          >
            <p className="text-[11px] font-bold uppercase tracking-wider text-slate-600">
              Final confirmation
            </p>
            <label className="block space-y-1 text-xs">
              <span className="font-medium text-slate-700">
                Type <code className="rounded bg-white border border-slate-200 px-1.5 py-0.5 font-mono text-[11px]">{campaign.name}</code> to confirm:
              </span>
              <input
                type="text"
                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:border-red-500 focus:outline-none focus:ring-2 focus:ring-red-500/20"
                value={confirmName}
                onChange={(e) => setConfirmName(e.target.value)}
                disabled={!dependenciesCleared || busy}
                autoComplete="off"
                data-lpignore="true"
              />
            </label>
          </div>
        </div>

        <div className="flex items-center justify-end gap-3 border-t border-slate-200 bg-slate-50/60 px-6 py-4">
          <button className="app-btn-secondary" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button
            type="button"
            className="inline-flex items-center rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed"
            onClick={handleFinalDelete}
            disabled={!canFinalDelete}
          >
            {busy && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
            Delete Permanently
          </button>
        </div>
      </div>
    </div>
  );
}
