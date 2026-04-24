'use client';

import React, { useState, useMemo, useEffect, useRef } from 'react';
import {
  Loader2,
  Search,
  UserPlus,
  Inbox,
  ArrowRightLeft,
  Check,
  AlertTriangle,
  X,
} from 'lucide-react';
import {
  assignLead,
  bulkAssignLeads,
  bulkReassignLeadsToCampaign,
} from '@/app/actions/leadActions';
import { useRouter } from 'next/navigation';
import { FormatDate } from '@/components/ui/FormatDate';

type LeadRow = {
  id: string;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  phone: string | null;
  propertyState: string | null;
  loanPurpose: string | null;
  loanAmount: string | null;
  receivedAt: string;
  source: string | null;
  vendor: { name: string } | null;
  campaign: { name: string } | null;
};

type EligibleUser = { id: string; name: string };
type CampaignOption = { id: string; name: string; vendorName: string };

export function LeadPool({
  leads,
  users,
  campaigns,
}: {
  leads: LeadRow[];
  users: EligibleUser[];
  campaigns: CampaignOption[];
}) {
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [assignUserId, setAssignUserId] = useState('');
  const [assigning, setAssigning] = useState(false);
  const [search, setSearch] = useState('');
  const [reassignCampaignId, setReassignCampaignId] = useState('');
  const [reassigning, setReassigning] = useState(false);
  // Inline feedback badge for the reassignment action. Auto-dismisses
  // after a few seconds so the admin's attention goes back to the table.
  const [reassignResult, setReassignResult] = useState<
    | { kind: 'ok'; message: string }
    | { kind: 'error'; message: string }
    | null
  >(null);
  const reassignTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (reassignTimer.current) clearTimeout(reassignTimer.current);
    };
  }, []);

  // Campaigns grouped by vendor for a readable picker. The admin's
  // mental model in the Pool is usually "which vendor should this lead
  // have belonged to?", and optgroups mirror that.
  const campaignsByVendor = useMemo(() => {
    const groups = new Map<string, CampaignOption[]>();
    for (const c of campaigns) {
      const list = groups.get(c.vendorName) ?? [];
      list.push(c);
      groups.set(c.vendorName, list);
    }
    return [...groups.entries()]
      .map(([vendorName, items]) => ({
        vendorName,
        items: [...items].sort((a, b) => a.name.localeCompare(b.name)),
      }))
      .sort((a, b) => a.vendorName.localeCompare(b.vendorName));
  }, [campaigns]);

  const filtered = useMemo(() => {
    if (!search) return leads;
    const q = search.toLowerCase();
    return leads.filter(
      (l) =>
        (l.firstName || '').toLowerCase().includes(q) ||
        (l.lastName || '').toLowerCase().includes(q) ||
        (l.email || '').toLowerCase().includes(q) ||
        (l.phone || '').includes(q)
    );
  }, [leads, search]);

  const toggleSelect = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    if (selected.size === filtered.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(filtered.map((l) => l.id)));
    }
  };

  const handleAssign = async () => {
    if (!assignUserId || selected.size === 0) return;
    setAssigning(true);
    try {
      if (selected.size === 1) {
        await assignLead([...selected][0], assignUserId);
      } else {
        await bulkAssignLeads([...selected], assignUserId);
      }
      setSelected(new Set());
      setAssignUserId('');
      router.refresh();
    } finally {
      setAssigning(false);
    }
  };

  const handleReassignCampaign = async () => {
    if (!reassignCampaignId || selected.size === 0) return;
    if (reassignTimer.current) clearTimeout(reassignTimer.current);
    setReassignResult(null);
    setReassigning(true);
    try {
      const res = await bulkReassignLeadsToCampaign(
        [...selected],
        reassignCampaignId
      );
      setReassignResult({
        kind: 'ok',
        message: `Moved ${res.count} lead${res.count === 1 ? '' : 's'} to ${res.vendorName} — ${res.campaignName}.`,
      });
      setSelected(new Set());
      setReassignCampaignId('');
      router.refresh();
    } catch (err) {
      setReassignResult({
        kind: 'error',
        message: err instanceof Error ? err.message : 'Could not move leads.',
      });
    } finally {
      setReassigning(false);
      reassignTimer.current = setTimeout(() => setReassignResult(null), 8_000);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
          <input
            className="w-full rounded-lg border border-slate-200 bg-white pl-9 pr-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
            placeholder="Search leads..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        {selected.size > 0 && (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-semibold text-blue-700">{selected.size} selected</span>
            <select
              className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
              value={reassignCampaignId}
              onChange={(e) => setReassignCampaignId(e.target.value)}
              title="Move these leads to a different vendor + campaign (e.g. fix a mis-routed webhook)"
            >
              <option value="">Move to campaign...</option>
              {campaignsByVendor.map((group) => (
                <optgroup key={group.vendorName} label={group.vendorName}>
                  {group.items.map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </optgroup>
              ))}
            </select>
            <button
              className="inline-flex items-center rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 transition-colors hover:border-blue-300 hover:bg-blue-50 hover:text-blue-700 disabled:opacity-60 disabled:cursor-not-allowed"
              onClick={() => void handleReassignCampaign()}
              disabled={!reassignCampaignId || reassigning}
              title="Rewrite the vendor + campaign for the selected leads"
            >
              {reassigning ? (
                <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
              ) : (
                <ArrowRightLeft className="mr-1.5 h-4 w-4" />
              )}
              Move
            </button>
            <span className="mx-1 h-5 w-px bg-slate-200" aria-hidden />
            <select
              className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
              value={assignUserId}
              onChange={(e) => setAssignUserId(e.target.value)}
            >
              <option value="">Assign to...</option>
              {users.map((u) => (
                <option key={u.id} value={u.id}>{u.name}</option>
              ))}
            </select>
            <button
              className="app-btn-primary h-9 text-sm disabled:opacity-70 disabled:cursor-not-allowed"
              onClick={() => void handleAssign()}
              disabled={!assignUserId || assigning}
            >
              {assigning ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <UserPlus className="mr-1.5 h-4 w-4" />}
              Assign
            </button>
          </div>
        )}
      </div>

      {reassignResult && (
        <div
          className={`flex items-start gap-2 rounded-lg border px-3 py-2 text-xs ${
            reassignResult.kind === 'ok'
              ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
              : 'border-rose-200 bg-rose-50 text-rose-800'
          }`}
          role="status"
        >
          {reassignResult.kind === 'ok' ? (
            <Check className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          ) : (
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          )}
          <span className="flex-1 break-words">{reassignResult.message}</span>
          <button
            type="button"
            onClick={() => setReassignResult(null)}
            className="text-current opacity-60 hover:opacity-100"
            aria-label="Dismiss"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {filtered.length === 0 ? (
        <div className="rounded-xl border border-slate-200 bg-white p-12 text-center shadow-sm">
          <Inbox className="mx-auto h-10 w-10 text-slate-300" />
          <p className="mt-3 text-sm font-semibold text-slate-700">No unassigned leads</p>
          <p className="mt-1 text-sm text-slate-500">All leads have been distributed or no leads match your search.</p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-slate-200">
          <table className="w-full text-sm">
            <thead className="sticky top-0 z-[1] bg-slate-50">
              <tr className="border-b border-slate-200">
                <th className="px-4 py-3 text-left">
                  <input
                    type="checkbox"
                    className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                    checked={selected.size === filtered.length && filtered.length > 0}
                    onChange={toggleAll}
                  />
                </th>
                <th className="px-4 py-3 text-left text-[11px] font-bold uppercase tracking-wider text-slate-500">Name</th>
                <th className="px-4 py-3 text-left text-[11px] font-bold uppercase tracking-wider text-slate-500">Phone</th>
                <th className="px-4 py-3 text-left text-[11px] font-bold uppercase tracking-wider text-slate-500">State</th>
                <th className="px-4 py-3 text-left text-[11px] font-bold uppercase tracking-wider text-slate-500">Loan Purpose</th>
                <th className="px-4 py-3 text-left text-[11px] font-bold uppercase tracking-wider text-slate-500">Vendor</th>
                <th className="px-4 py-3 text-left text-[11px] font-bold uppercase tracking-wider text-slate-500">Campaign</th>
                <th className="px-4 py-3 text-left text-[11px] font-bold uppercase tracking-wider text-slate-500">Received</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {filtered.map((l) => (
                <tr key={l.id} className={`align-middle transition-colors ${selected.has(l.id) ? 'bg-blue-50/50' : 'hover:bg-slate-50/70'}`}>
                  <td className="px-4 py-3">
                    <input
                      type="checkbox"
                      className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                      checked={selected.has(l.id)}
                      onChange={() => toggleSelect(l.id)}
                    />
                  </td>
                  <td className="px-4 py-3 font-semibold text-slate-900">
                    {[l.firstName, l.lastName].filter(Boolean).join(' ') || '—'}
                  </td>
                  <td className="px-4 py-3 text-slate-600">{l.phone || '—'}</td>
                  <td className="px-4 py-3 text-slate-600">{l.propertyState || '—'}</td>
                  <td className="px-4 py-3 text-slate-600">{l.loanPurpose || '—'}</td>
                  <td className="px-4 py-3 text-slate-600">{l.vendor?.name || '—'}</td>
                  <td className="px-4 py-3 text-slate-600">{l.campaign?.name || '—'}</td>
                  <td className="px-4 py-3 text-xs text-slate-500">
                    <FormatDate date={l.receivedAt} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
