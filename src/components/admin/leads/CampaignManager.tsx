'use client';

import React, { useState, useCallback, useMemo, useRef } from 'react';
import { Loader2, Plus, Pencil, Trash2, Copy, Check, X, Megaphone, Search, HelpCircle } from 'lucide-react';
import {
  createLeadCampaign,
  updateLeadCampaign,
  deleteLeadCampaign,
  setCampaignMembers,
} from '@/app/actions/leadActions';
import { useRouter } from 'next/navigation';

type Vendor = { id: string; name: string; slug: string };
type EligibleUser = { id: string; name: string; email: string; role: string };
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
  _count: { members: number; leads: number };
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
};

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

export function CampaignManager({ campaigns, vendors, users }: Props) {
  const router = useRouter();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [userSearch, setUserSearch] = useState('');
  const [filterVendor, setFilterVendor] = useState('');

  const filtered = useMemo(() => {
    if (!filterVendor) return campaigns;
    return campaigns.filter((c) => c.vendorId === filterVendor);
  }, [campaigns, filterVendor]);

  const filteredUsers = useMemo(() => {
    if (!userSearch) return users;
    const q = userSearch.toLowerCase();
    return users.filter((u) => u.name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q));
  }, [users, userSearch]);

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
    });
    setEditingId(c.id);
    setIsCreating(false);
  }, []);

  const closeModal = useCallback(() => {
    setEditingId(null);
    setIsCreating(false);
    setUserSearch('');
  }, []);

  const handleSave = async () => {
    setSaving(true);
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
      };

      if (isCreating) {
        const campaign = await createLeadCampaign(payload);
        if (form.memberUserIds.length > 0) {
          await setCampaignMembers(campaign.id, form.memberUserIds);
        }
      } else if (editingId) {
        await updateLeadCampaign(editingId, payload);
        await setCampaignMembers(editingId, form.memberUserIds);
      }
      closeModal();
      router.refresh();
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!window.confirm('Delete this campaign? This cannot be undone.')) return;
    await deleteLeadCampaign(id);
    router.refresh();
  };

  const handleToggleActive = async (c: Campaign) => {
    await updateLeadCampaign(c.id, { active: !c.active });
    router.refresh();
  };

  const toggleMember = (userId: string) => {
    setForm((prev) => ({
      ...prev,
      memberUserIds: prev.memberUserIds.includes(userId)
        ? prev.memberUserIds.filter((id) => id !== userId)
        : [...prev.memberUserIds, userId],
    }));
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
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
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
          <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
            {filtered.length} campaign{filtered.length !== 1 ? 's' : ''}
          </span>
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
          <table className="w-full text-sm">
            <thead className="sticky top-0 z-[1] bg-slate-50">
              <tr className="border-b border-slate-200">
                <th className="px-4 py-3 text-left text-[11px] font-bold uppercase tracking-wider text-slate-500">Status</th>
                <th className="px-4 py-3 text-left text-[11px] font-bold uppercase tracking-wider text-slate-500">Campaign</th>
                <th className="px-4 py-3 text-left text-[11px] font-bold uppercase tracking-wider text-slate-500">Vendor</th>
                <th className="px-4 py-3 text-left text-[11px] font-bold uppercase tracking-wider text-slate-500">Routing Tag</th>
                <th className="px-4 py-3 text-center text-[11px] font-bold uppercase tracking-wider text-slate-500">Members</th>
                <th className="px-4 py-3 text-center text-[11px] font-bold uppercase tracking-wider text-slate-500">Leads</th>
                <th className="px-4 py-3 text-right text-[11px] font-bold uppercase tracking-wider text-slate-500">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {filtered.map((c) => (
                <tr key={c.id} className="align-middle hover:bg-slate-50/70">
                  <td className="px-4 py-3">
                    <button
                      onClick={() => void handleToggleActive(c)}
                      className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold transition-colors ${
                        c.active
                          ? 'border border-blue-200 bg-blue-50 text-blue-700'
                          : 'border border-slate-200 bg-white text-slate-500'
                      }`}
                    >
                      {c.active ? 'Enabled' : 'Disabled'}
                    </button>
                  </td>
                  <td className="px-4 py-3">
                    <p className="font-semibold text-slate-900">{c.name}</p>
                    {c.description && <p className="text-xs text-slate-500 mt-0.5 max-w-xs truncate">{c.description}</p>}
                  </td>
                  <td className="px-4 py-3 text-slate-600">{c.vendor.name}</td>
                  <td className="px-4 py-3 font-mono text-xs text-slate-500">{c.routingTag}</td>
                  <td className="px-4 py-3 text-center text-slate-700">{c._count.members}</td>
                  <td className="px-4 py-3 text-center text-slate-700">{c._count.leads}</td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex items-center justify-end gap-1">
                      <button className="app-icon-btn" onClick={() => copyWebhookInfo(c)} title="Copy webhook info">
                        {copiedId === c.id ? <Check className="h-4 w-4 text-green-600" /> : <Copy className="h-4 w-4" />}
                      </button>
                      <button className="app-icon-btn" onClick={() => void openEdit(c)} title="Edit">
                        <Pencil className="h-4 w-4" />
                      </button>
                      <button className="app-icon-btn app-icon-btn-danger" onClick={() => void handleDelete(c.id)} title="Delete">
                        <Trash2 className="h-4 w-4" />
                      </button>
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
              </div>

              {/* Assignment */}
              <div>
                <p className="text-[11px] font-bold uppercase tracking-wider text-slate-500 mb-3">Assignment</p>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <span className="text-xs font-medium text-slate-700">Assigned Users ({form.memberUserIds.length})<InfoTip text="Loan officers who will receive leads from this campaign. Check/uncheck to add or remove users. Leads are distributed among these users based on the distribution method." /></span>
                    <div className="relative">
                      <Search className="absolute left-3 top-2.5 h-3.5 w-3.5 text-slate-400" />
                      <input
                        className="w-full rounded-lg border border-slate-200 bg-white pl-8 pr-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                        placeholder="Search users..."
                        value={userSearch}
                        onChange={(e) => setUserSearch(e.target.value)}
                      />
                    </div>
                    <div className="h-48 overflow-y-auto rounded-lg border border-slate-200 bg-white">
                      {filteredUsers.map((u) => {
                        const isSelected = form.memberUserIds.includes(u.id);
                        return (
                          <button
                            key={u.id}
                            type="button"
                            onClick={() => toggleMember(u.id)}
                            className={`w-full flex items-center gap-2 px-3 py-2 text-left text-sm transition-colors ${
                              isSelected ? 'bg-blue-50 text-blue-800' : 'text-slate-700 hover:bg-slate-50'
                            }`}
                          >
                            <span className={`h-4 w-4 rounded border flex items-center justify-center text-xs ${
                              isSelected ? 'border-blue-500 bg-blue-500 text-white' : 'border-slate-300'
                            }`}>
                              {isSelected && <Check className="h-3 w-3" />}
                            </span>
                            <span className="truncate">{u.name}</span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                  <div className="space-y-2">
                    <span className="text-xs font-medium text-slate-700">Default User (Fallback)<InfoTip text="If no assigned user is eligible (all hit their quotas, wrong state, etc.), this person receives the lead as a safety net. Typically a manager." /></span>
                    <select
                      className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                      value={form.defaultUserId}
                      onChange={(e) => setForm((p) => ({ ...p, defaultUserId: e.target.value }))}
                    >
                      <option value="">None</option>
                      {users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
                    </select>
                    <p className="text-xs text-slate-500">Manager/fallback who receives unroutable leads and has oversight visibility.</p>

                    <span className="text-xs font-medium text-slate-700 block mt-4">Distribution Method<InfoTip text="Round Robin automatically rotates leads evenly across assigned users in order. Manual means leads go to the Unassigned Pool for a manager to hand-assign." /></span>
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
    </div>
  );
}
