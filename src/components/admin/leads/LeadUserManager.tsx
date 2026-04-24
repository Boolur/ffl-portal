'use client';

import React, { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import {
  Search, X, Plus, Trash2, Loader2, ChevronDown, ChevronRight, Users, Check, Link2,
} from 'lucide-react';
import { InfoTip } from '@/components/ui/InfoTip';
import {
  updateUserLeadSettings,
  updateMemberSettings,
  addUserToCampaign,
  removeUserFromCampaign,
} from '@/app/actions/leadActions';
import { useRouter } from 'next/navigation';

type Membership = {
  id: string;
  campaignId: string;
  campaignName: string;
  vendorName: string;
  dailyQuota: number;
  weeklyQuota: number;
  monthlyQuota: number;
  receiveDays: number[];
  active: boolean;
  leadsReceivedToday: number;
};

type LeadUser = {
  id: string;
  name: string;
  email: string;
  role: string;
  leadsEnabled: boolean;
  licensedStates: string[];
  bonzoWebhookUrl: string;
  globalDailyQuota: number;
  globalWeeklyQuota: number;
  globalMonthlyQuota: number;
  leadsToday: number;
  campaignCount: number;
  memberships: Membership[];
};

type CampaignOption = { id: string; name: string; vendorName: string };

const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function LeadUserManager({
  users,
  allCampaigns,
}: {
  users: LeadUser[];
  allCampaigns: CampaignOption[];
}) {
  const router = useRouter();
  const [search, setSearch] = useState('');
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);

  const filtered = useMemo(() => {
    if (!search) return users;
    const q = search.toLowerCase();
    return users.filter(
      (u) => u.name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q)
    );
  }, [users, search]);

  const selectedUser = useMemo(
    () => users.find((u) => u.id === selectedUserId) ?? null,
    [users, selectedUserId]
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
          <input
            className="w-full rounded-lg border border-slate-200 bg-white pl-9 pr-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
            placeholder="Search by name or email..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
          {filtered.length} user{filtered.length !== 1 ? 's' : ''}
        </span>
      </div>

      {filtered.length === 0 ? (
        <div className="rounded-xl border border-slate-200 bg-white p-12 text-center shadow-sm">
          <Users className="mx-auto h-10 w-10 text-slate-300" />
          <p className="mt-3 text-sm font-semibold text-slate-700">No users found</p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-slate-200">
          <table className="w-full text-sm">
            <thead className="sticky top-0 z-[1] bg-slate-50">
              <tr className="border-b border-slate-200">
                <th className="px-4 py-3 text-left text-[11px] font-bold uppercase tracking-wider text-slate-500">Name</th>
                <th className="px-4 py-3 text-left text-[11px] font-bold uppercase tracking-wider text-slate-500">Email</th>
                <th className="px-4 py-3 text-center text-[11px] font-bold uppercase tracking-wider text-slate-500">Status</th>
                <th className="px-4 py-3 text-center text-[11px] font-bold uppercase tracking-wider text-slate-500">States</th>
                <th className="px-4 py-3 text-center text-[11px] font-bold uppercase tracking-wider text-slate-500">Campaigns</th>
                <th className="px-4 py-3 text-center text-[11px] font-bold uppercase tracking-wider text-slate-500">Today</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {filtered.map((u) => (
                <tr
                  key={u.id}
                  className={`align-middle cursor-pointer transition-colors ${
                    selectedUserId === u.id ? 'bg-blue-50/60' : 'hover:bg-slate-50/70'
                  }`}
                  onClick={() => setSelectedUserId(u.id)}
                >
                  <td className="px-4 py-3 font-semibold text-slate-900">{u.name}</td>
                  <td className="px-4 py-3 text-slate-500 text-xs">{u.email}</td>
                  <td className="px-4 py-3 text-center">
                    <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                      u.leadsEnabled
                        ? 'border border-green-200 bg-green-50 text-green-700'
                        : 'border border-red-200 bg-red-50 text-red-600'
                    }`}>
                      {u.leadsEnabled ? 'On' : 'Off'}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-center text-xs text-slate-600">
                    {u.licensedStates.length > 0 ? u.licensedStates.join(', ') : 'All'}
                  </td>
                  <td className="px-4 py-3 text-center text-slate-700">{u.campaignCount}</td>
                  <td className="px-4 py-3 text-center text-slate-700">{u.leadsToday}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {selectedUser && (
        <UserDetailPanel
          user={selectedUser}
          allCampaigns={allCampaigns}
          onClose={() => setSelectedUserId(null)}
          onRefresh={() => router.refresh()}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// User Detail Slide-Over
// ---------------------------------------------------------------------------

function UserDetailPanel({
  user,
  allCampaigns,
  onClose,
  onRefresh,
}: {
  user: LeadUser;
  allCampaigns: CampaignOption[];
  onClose: () => void;
  onRefresh: () => void;
}) {
  const [saving, setSaving] = useState(false);
  const [leadsEnabled, setLeadsEnabled] = useState(user.leadsEnabled);
  const [stateInput, setStateInput] = useState('');
  const [licensedStates, setLicensedStates] = useState<string[]>(user.licensedStates);
  const [bonzoWebhookUrl, setBonzoWebhookUrl] = useState(user.bonzoWebhookUrl || '');
  const [bonzoError, setBonzoError] = useState<string | null>(null);
  const [globalDaily, setGlobalDaily] = useState(user.globalDailyQuota);
  const [globalWeekly, setGlobalWeekly] = useState(user.globalWeeklyQuota);
  const [globalMonthly, setGlobalMonthly] = useState(user.globalMonthlyQuota);
  const [addingCampaign, setAddingCampaign] = useState(false);
  const [selectedCampaignIds, setSelectedCampaignIds] = useState<Set<string>>(new Set());
  const [campaignSearch, setCampaignSearch] = useState('');
  const campaignSearchRef = useRef<HTMLInputElement>(null);

  const availableCampaigns = useMemo(() => {
    const memberCampaignIds = new Set(user.memberships.map((m) => m.campaignId));
    return allCampaigns.filter((c) => !memberCampaignIds.has(c.id));
  }, [allCampaigns, user.memberships]);

  const filteredAvailableCampaigns = useMemo(() => {
    const q = campaignSearch.trim().toLowerCase();
    if (!q) return availableCampaigns;
    return availableCampaigns.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        c.vendorName.toLowerCase().includes(q)
    );
  }, [availableCampaigns, campaignSearch]);

  useEffect(() => {
    if (addingCampaign) {
      const t = window.setTimeout(() => campaignSearchRef.current?.focus(), 50);
      return () => window.clearTimeout(t);
    } else {
      setCampaignSearch('');
    }
  }, [addingCampaign]);

  const saveGlobalSettings = useCallback(async () => {
    const trimmed = bonzoWebhookUrl.trim();
    if (trimmed) {
      try {
        const parsed = new URL(trimmed);
        if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
          setBonzoError('URL must start with http:// or https://');
          return;
        }
      } catch {
        setBonzoError('Please enter a valid URL.');
        return;
      }
    }
    setBonzoError(null);
    setSaving(true);
    try {
      await updateUserLeadSettings(user.id, {
        leadsEnabled,
        licensedStates,
        bonzoWebhookUrl: trimmed || null,
        globalDailyQuota: globalDaily,
        globalWeeklyQuota: globalWeekly,
        globalMonthlyQuota: globalMonthly,
      });
      onRefresh();
    } finally {
      setSaving(false);
    }
  }, [user.id, leadsEnabled, licensedStates, bonzoWebhookUrl, globalDaily, globalWeekly, globalMonthly, onRefresh]);

  const addState = () => {
    const s = stateInput.trim().toUpperCase();
    if (s && !licensedStates.includes(s)) {
      setLicensedStates([...licensedStates, s]);
    }
    setStateInput('');
  };

  const removeState = (state: string) => {
    setLicensedStates(licensedStates.filter((s) => s !== state));
  };

  const toggleCampaignSelection = (id: string) => {
    setSelectedCampaignIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const handleAddCampaigns = async () => {
    if (selectedCampaignIds.size === 0) return;
    setSaving(true);
    try {
      for (const cid of selectedCampaignIds) {
        await addUserToCampaign(user.id, cid);
      }
      setSelectedCampaignIds(new Set());
      setAddingCampaign(false);
      onRefresh();
    } finally {
      setSaving(false);
    }
  };

  const isDirty =
    leadsEnabled !== user.leadsEnabled ||
    JSON.stringify(licensedStates) !== JSON.stringify(user.licensedStates) ||
    bonzoWebhookUrl.trim() !== (user.bonzoWebhookUrl || '').trim() ||
    globalDaily !== user.globalDailyQuota ||
    globalWeekly !== user.globalWeeklyQuota ||
    globalMonthly !== user.globalMonthlyQuota;

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center" onClick={onClose}>
      <div className="absolute inset-0 bg-slate-900/30 backdrop-blur-sm" />
      <div
        role="dialog"
        aria-modal="true"
        className="relative w-full max-w-2xl bg-white rounded-2xl shadow-xl border border-slate-200 max-h-[85vh] overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="border-b border-slate-200 px-6 py-4 bg-slate-50/50">
          <div className="flex items-start justify-between">
            <div>
              <h2 className="text-lg font-bold text-slate-900">{user.name}</h2>
              <p className="text-xs text-slate-500">{user.email}</p>
            </div>
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => {
                  setLeadsEnabled(!leadsEnabled);
                }}
                className={`relative inline-flex h-7 w-12 items-center rounded-full transition-colors ${
                  leadsEnabled ? 'bg-green-500' : 'bg-slate-300'
                }`}
              >
                <span className={`inline-block h-5 w-5 rounded-full bg-white shadow-sm transition-transform ${
                  leadsEnabled ? 'translate-x-6' : 'translate-x-1'
                }`} />
              </button>
              <span className={`text-xs font-bold ${leadsEnabled ? 'text-green-700' : 'text-slate-500'}`}>
                {leadsEnabled ? 'LEADS ON' : 'LEADS OFF'}
              </span>
              <button className="text-slate-400 hover:text-slate-600 p-1 hover:bg-slate-200 rounded ml-2" onClick={onClose} aria-label="Close">
                <X className="h-5 w-5" />
              </button>
            </div>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-6">
          {/* Bonzo Webhook URL */}
          <div>
            <div className="flex items-center mb-2">
              <p className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Bonzo Webhook URL</p>
              <InfoTip text="Every lead assigned to this user will be POSTed to this Bonzo webhook as JSON. Paste the full URL from Bonzo (e.g. https://api.getbonzo.com/...)." width={256} />
            </div>
            <p className="text-xs text-slate-400 mb-2">Forwards each newly-assigned lead into this user&apos;s Bonzo CRM.</p>
            <div className="relative">
              <Link2 className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
              <input
                type="url"
                className={`w-full rounded-lg border bg-white pl-9 pr-3 py-2 text-sm focus:outline-none focus:ring-2 ${
                  bonzoError
                    ? 'border-red-300 focus:border-red-500 focus:ring-red-500/20'
                    : 'border-slate-200 focus:border-blue-500 focus:ring-blue-500/20'
                }`}
                placeholder="https://app.getbonzo.com/webhook/..."
                value={bonzoWebhookUrl}
                onChange={(e) => {
                  setBonzoWebhookUrl(e.target.value);
                  if (bonzoError) setBonzoError(null);
                }}
                spellCheck={false}
                autoComplete="off"
              />
            </div>
            {bonzoError && <p className="mt-1 text-xs text-red-600">{bonzoError}</p>}
          </div>

          {/* Licensed States */}
          <div>
            <p className="text-[11px] font-bold uppercase tracking-wider text-slate-500 mb-2">Licensed States</p>
            <p className="text-xs text-slate-400 mb-2">Leave empty to receive leads from all states.</p>
            <div className="flex flex-wrap gap-1.5 mb-2">
              {licensedStates.map((s) => (
                <span
                  key={s}
                  className="inline-flex items-center gap-1 rounded-full border border-blue-200 bg-blue-50 px-2.5 py-1 text-xs font-semibold text-blue-700"
                >
                  {s}
                  <button type="button" onClick={() => removeState(s)} className="text-blue-400 hover:text-red-500 transition-colors">
                    <X className="h-3 w-3" />
                  </button>
                </span>
              ))}
              {licensedStates.length === 0 && (
                <span className="text-xs text-slate-400 italic">All states</span>
              )}
            </div>
            <div className="flex gap-2">
              <input
                className="flex-1 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm uppercase focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                placeholder="e.g. WA"
                maxLength={2}
                value={stateInput}
                onChange={(e) => setStateInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && addState()}
              />
              <button type="button" className="app-btn-primary h-[38px] px-3 text-sm" onClick={addState}>
                <Plus className="h-4 w-4" />
              </button>
            </div>
          </div>

          {/* Global Quotas */}
          <div>
            <p className="text-[11px] font-bold uppercase tracking-wider text-slate-500 mb-2">Global Quotas</p>
            <p className="text-xs text-slate-400 mb-3">Caps across all campaigns. 0 = unlimited.</p>
            <div className="grid grid-cols-3 gap-3">
              <label className="space-y-1">
                <span className="text-xs font-medium text-slate-600">Daily</span>
                <input
                  type="number"
                  min={0}
                  className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-center focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                  value={globalDaily}
                  onChange={(e) => setGlobalDaily(Number(e.target.value) || 0)}
                />
              </label>
              <label className="space-y-1">
                <span className="text-xs font-medium text-slate-600">Weekly</span>
                <input
                  type="number"
                  min={0}
                  className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-center focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                  value={globalWeekly}
                  onChange={(e) => setGlobalWeekly(Number(e.target.value) || 0)}
                />
              </label>
              <label className="space-y-1">
                <span className="text-xs font-medium text-slate-600">Monthly</span>
                <input
                  type="number"
                  min={0}
                  className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-center focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                  value={globalMonthly}
                  onChange={(e) => setGlobalMonthly(Number(e.target.value) || 0)}
                />
              </label>
            </div>

            {user.memberships.length > 0 && (() => {
              const totalCampaignDaily = user.memberships.reduce((sum, m) => sum + m.dailyQuota, 0);
              const hasUnlimited = user.memberships.some((m) => m.dailyQuota === 0);
              const overGlobal = globalDaily > 0 && !hasUnlimited && totalCampaignDaily > globalDaily;
              return (
                <div className={`mt-3 rounded-lg px-3 py-2.5 text-xs ${
                  overGlobal
                    ? 'bg-amber-50 border border-amber-200'
                    : 'bg-slate-50 border border-slate-200'
                }`}>
                  <div className="flex items-center justify-between">
                    <span className="font-medium text-slate-600">Campaign Daily Quota Total</span>
                    <span className={`font-bold ${overGlobal ? 'text-amber-700' : 'text-slate-800'}`}>
                      {hasUnlimited ? (
                        <span className="text-slate-400 font-medium italic">Includes unlimited</span>
                      ) : (
                        <>
                          {totalCampaignDaily}
                          {globalDaily > 0 && (
                            <span className="text-slate-400 font-normal ml-1">/ {globalDaily} global</span>
                          )}
                        </>
                      )}
                    </span>
                  </div>
                  {overGlobal && (
                    <p className="mt-1 text-amber-600">
                      Campaign quotas exceed global cap — global limit will take priority.
                    </p>
                  )}
                </div>
              );
            })()}
          </div>

          {/* Save global settings */}
          {isDirty && (
            <button
              type="button"
              className="app-btn-primary w-full text-sm disabled:opacity-70 disabled:cursor-not-allowed"
              onClick={() => void saveGlobalSettings()}
              disabled={saving}
            >
              {saving && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
              Save Settings
            </button>
          )}

          {/* Campaigns */}
          <div>
            <p className="text-[11px] font-bold uppercase tracking-wider text-slate-500 mb-3">
              Campaigns ({user.memberships.length})
            </p>

            {user.memberships.length === 0 ? (
              <p className="text-xs text-slate-400 text-center py-4">Not assigned to any campaigns.</p>
            ) : (
              <div className="space-y-2">
                {user.memberships.map((m) => (
                  <MembershipRow key={m.id} membership={m} onRefresh={onRefresh} />
                ))}
              </div>
            )}

            {!addingCampaign && (
              <button
                type="button"
                className={`mt-3 flex w-full items-center justify-center gap-2 rounded-xl py-3 text-sm font-semibold transition-colors ${
                  availableCampaigns.length > 0
                    ? 'bg-blue-600 text-white shadow-sm hover:bg-blue-700'
                    : 'bg-slate-200 text-slate-400 cursor-not-allowed'
                }`}
                onClick={() => availableCampaigns.length > 0 && setAddingCampaign(true)}
                disabled={availableCampaigns.length === 0}
              >
                <Plus className="h-4 w-4" />
                {availableCampaigns.length > 0 ? 'Add Campaign' : 'Already in all campaigns'}
              </button>
            )}

            {addingCampaign && (
              <div className="mt-3 space-y-3">
                <p className="text-xs font-medium text-slate-600">Select campaigns to add:</p>
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400 pointer-events-none" />
                  <input
                    ref={campaignSearchRef}
                    type="text"
                    value={campaignSearch}
                    onChange={(e) => setCampaignSearch(e.target.value)}
                    placeholder="Search campaigns by name or vendor..."
                    className="w-full rounded-xl border border-slate-200 bg-white pl-9 pr-9 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                  />
                  {campaignSearch && (
                    <button
                      type="button"
                      onClick={() => {
                        setCampaignSearch('');
                        campaignSearchRef.current?.focus();
                      }}
                      className="absolute right-2 top-1/2 -translate-y-1/2 flex h-6 w-6 items-center justify-center rounded-md text-slate-400 hover:bg-slate-100 hover:text-slate-600"
                      aria-label="Clear campaign search"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
                <div className="rounded-xl border border-slate-200 bg-white overflow-hidden divide-y divide-slate-100 max-h-72 overflow-y-auto">
                  {filteredAvailableCampaigns.length === 0 ? (
                    <div className="px-4 py-6 text-center text-sm text-slate-500">
                      No campaigns match &ldquo;{campaignSearch}&rdquo;
                    </div>
                  ) : (
                    filteredAvailableCampaigns.map((c) => {
                      const checked = selectedCampaignIds.has(c.id);
                      return (
                        <button
                          key={c.id}
                          type="button"
                          onClick={() => toggleCampaignSelection(c.id)}
                          className={`w-full flex items-center gap-3 px-4 py-3 text-left transition-colors ${
                            checked ? 'bg-blue-50' : 'hover:bg-slate-50'
                          }`}
                        >
                          <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded border text-xs transition-colors ${
                            checked
                              ? 'border-blue-500 bg-blue-500 text-white'
                              : 'border-slate-300 bg-white'
                          }`}>
                            {checked && <Check className="h-3.5 w-3.5" />}
                          </span>
                          <div className="min-w-0">
                            <p className="text-sm font-semibold text-slate-900 truncate">{c.name}</p>
                            <p className="text-[11px] text-slate-500">{c.vendorName}</p>
                          </div>
                        </button>
                      );
                    })
                  )}
                </div>
                {campaignSearch && filteredAvailableCampaigns.length > 0 && (
                  <p className="text-[11px] text-slate-500">
                    Showing {filteredAvailableCampaigns.length} of {availableCampaigns.length} campaigns
                  </p>
                )}
                <div className="flex gap-2">
                  <button
                    type="button"
                    className="flex-1 flex items-center justify-center gap-2 rounded-xl bg-blue-600 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-blue-700 disabled:opacity-60 disabled:cursor-not-allowed"
                    onClick={() => void handleAddCampaigns()}
                    disabled={saving || selectedCampaignIds.size === 0}
                  >
                    {saving && <Loader2 className="h-4 w-4 animate-spin" />}
                    Add to Campaign{selectedCampaignIds.size > 1 ? 's' : ''} ({selectedCampaignIds.size})
                  </button>
                  <button
                    type="button"
                    className="app-btn-secondary text-sm"
                    onClick={() => { setAddingCampaign(false); setSelectedCampaignIds(new Set()); }}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Individual Campaign Membership Row
// ---------------------------------------------------------------------------

function MembershipRow({
  membership: m,
  onRefresh,
}: {
  membership: Membership;
  onRefresh: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [dailyQuota, setDailyQuota] = useState(m.dailyQuota);
  const [receiveDays, setReceiveDays] = useState<number[]>(m.receiveDays);
  const [active, setActive] = useState(m.active);

  const isDirty =
    dailyQuota !== m.dailyQuota ||
    JSON.stringify(receiveDays) !== JSON.stringify(m.receiveDays) ||
    active !== m.active;

  const toggleDay = (day: number) => {
    setReceiveDays((prev) =>
      prev.includes(day) ? prev.filter((d) => d !== day) : [...prev, day].sort()
    );
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await updateMemberSettings(m.id, { dailyQuota, receiveDays, active });
      onRefresh();
    } finally {
      setSaving(false);
    }
  };

  const handleRemove = async () => {
    if (!window.confirm(`Remove from "${m.campaignName}"?`)) return;
    setSaving(true);
    try {
      await removeUserFromCampaign(m.id);
      onRefresh();
    } finally {
      setSaving(false);
    }
  };

  const daysSummary = receiveDays.length === 7
    ? 'Every day'
    : receiveDays.length === 5 && [1, 2, 3, 4, 5].every((d) => receiveDays.includes(d))
    ? 'Weekdays'
    : receiveDays.length === 0
    ? 'No days'
    : receiveDays.map((d) => DAY_LABELS[d]).join(', ');

  return (
    <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
      <button
        type="button"
        className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-slate-50/70 transition-colors"
        onClick={() => setExpanded(!expanded)}
      >
        {expanded ? (
          <ChevronDown className="h-4 w-4 text-slate-400 shrink-0" />
        ) : (
          <ChevronRight className="h-4 w-4 text-slate-400 shrink-0" />
        )}
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-slate-900 truncate">{m.campaignName}</p>
          <p className="text-[11px] text-slate-500">{m.vendorName}</p>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          <span className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-bold ${
            active
              ? 'border border-green-200 bg-green-50 text-green-700'
              : 'border border-slate-200 bg-slate-100 text-slate-500'
          }`}>
            {active ? 'Active' : 'Paused'}
          </span>
          <span className="text-xs text-slate-500">{dailyQuota > 0 ? `${dailyQuota}/day` : 'Unlimited'}</span>
          <span className="text-[10px] text-slate-400">{daysSummary}</span>
        </div>
      </button>

      {expanded && (
        <div className="border-t border-slate-200 px-4 py-4 bg-slate-50/30 space-y-4">
          <div className="flex items-center gap-4">
            <label className="flex items-center gap-2 text-sm text-slate-700">
              <input
                type="checkbox"
                className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                checked={active}
                onChange={(e) => setActive(e.target.checked)}
              />
              Active in this campaign
            </label>
            <div className="flex-1" />
            <span className="text-xs text-slate-500">
              {m.leadsReceivedToday} leads today
            </span>
          </div>

          <div>
            <span className="text-xs font-medium text-slate-600 mb-1.5 block">Daily Quota</span>
            <div className="flex items-center gap-2">
              <input
                type="number"
                min={0}
                className="w-24 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-center focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                value={dailyQuota}
                onChange={(e) => setDailyQuota(Number(e.target.value) || 0)}
              />
              <span className="text-xs text-slate-400">0 = unlimited</span>
            </div>
          </div>

          <div>
            <span className="text-xs font-medium text-slate-600 mb-1.5 block">Receive Days</span>
            <div className="flex gap-1.5">
              {DAY_LABELS.map((label, idx) => (
                <button
                  key={idx}
                  type="button"
                  onClick={() => toggleDay(idx)}
                  className={`h-9 w-11 rounded-lg text-xs font-semibold transition-colors ${
                    receiveDays.includes(idx)
                      ? 'bg-blue-600 text-white shadow-sm'
                      : 'border border-slate-200 bg-white text-slate-500 hover:bg-slate-50'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
            <div className="flex gap-2 mt-2">
              <button
                type="button"
                className="text-[11px] text-blue-600 hover:text-blue-700 font-medium"
                onClick={() => setReceiveDays([1, 2, 3, 4, 5])}
              >
                Weekdays
              </button>
              <button
                type="button"
                className="text-[11px] text-blue-600 hover:text-blue-700 font-medium"
                onClick={() => setReceiveDays([0, 1, 2, 3, 4, 5, 6])}
              >
                Every Day
              </button>
              <button
                type="button"
                className="text-[11px] text-slate-500 hover:text-slate-700 font-medium"
                onClick={() => setReceiveDays([])}
              >
                None
              </button>
            </div>
          </div>

          <div className="flex items-center justify-between pt-2 border-t border-slate-200">
            <button
              type="button"
              className="text-xs font-medium text-red-500 hover:text-red-700 transition-colors flex items-center gap-1"
              onClick={() => void handleRemove()}
              disabled={saving}
            >
              <Trash2 className="h-3.5 w-3.5" />
              Remove from Campaign
            </button>
            {isDirty && (
              <button
                type="button"
                className="app-btn-primary h-8 px-4 text-xs disabled:opacity-70"
                onClick={() => void handleSave()}
                disabled={saving}
              >
                {saving && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />}
                Save
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
