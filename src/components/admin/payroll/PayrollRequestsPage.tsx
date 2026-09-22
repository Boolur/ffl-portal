'use client';

import React, { useMemo, useState } from 'react';
import { PayrollCompRequestStatus } from '@prisma/client';
import { Users2 } from 'lucide-react';
import type { PayrollRequestRow } from '@/app/actions/payrollActions';
import { teamColorClasses } from '@/components/admin/leads/LeadUserTeamManager';
import { PayrollRequestTable } from './PayrollRequestTable';

type PayrollTeamFilter = {
  id: string;
  name: string;
  color: string;
  colors: string[];
  memberCount: number;
  memberIds: string[];
};

export function PayrollRequestsPage({
  rows,
  teams,
}: {
  rows: PayrollRequestRow[];
  teams: PayrollTeamFilter[];
}) {
  const [status, setStatus] = useState<PayrollCompRequestStatus | 'ALL'>('ALL');
  const [search, setSearch] = useState('');
  const [selectedTeamIds, setSelectedTeamIds] = useState<string[]>([]);
  const selectedTeamIdSet = useMemo(() => new Set(selectedTeamIds), [selectedTeamIds]);
  const selectedTeamMemberIds = useMemo(() => {
    if (selectedTeamIds.length === 0) return null;
    return new Set(
      teams
        .filter((team) => selectedTeamIdSet.has(team.id))
        .flatMap((team) => team.memberIds),
    );
  }, [selectedTeamIdSet, selectedTeamIds.length, teams]);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return rows.filter((row) => {
      const matchesStatus = status === 'ALL' || row.status === status;
      const matchesTeam = !selectedTeamMemberIds || selectedTeamMemberIds.has(row.loanOfficerId);
      const matchesSearch =
        !term ||
        row.loanNumber.toLowerCase().includes(term) ||
        row.borrowerName.toLowerCase().includes(term) ||
        row.lender.toLowerCase().includes(term) ||
        row.loanOfficerName.toLowerCase().includes(term);
      return matchesStatus && matchesTeam && matchesSearch;
    });
  }, [rows, search, selectedTeamMemberIds, status]);

  const toggleTeam = (teamId: string) => {
    setSelectedTeamIds((current) =>
      current.includes(teamId)
        ? current.filter((id) => id !== teamId)
        : [...current, teamId],
    );
  };

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="grid gap-3 md:grid-cols-[1fr_220px]">
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search loan number, borrower, lender, or LO"
            className="rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20"
          />
          <select
            value={status}
            onChange={(event) => setStatus(event.target.value as PayrollCompRequestStatus | 'ALL')}
            className="rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20"
          >
            <option value="ALL">All statuses</option>
            <option value="PENDING_REVIEW">Pending Review</option>
            <option value="APPROVED">Approved</option>
            <option value="REJECTED">Rejected</option>
            <option value="PAID">Paid</option>
          </select>
        </div>
        {teams.length > 0 && (
          <div className="mt-4 flex min-w-0 items-center gap-2 overflow-x-auto border-t border-slate-100 pt-4 whitespace-nowrap [scrollbar-width:thin]">
            <div className="mr-1 flex shrink-0 items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-slate-500">
              <Users2 className="h-3.5 w-3.5" aria-hidden="true" />
              Teams
            </div>
            <button
              type="button"
              onClick={() => setSelectedTeamIds([])}
              aria-pressed={selectedTeamIds.length === 0}
              className={`inline-flex shrink-0 items-center rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${
                selectedTeamIds.length === 0
                  ? 'border-slate-300 bg-slate-100 text-slate-800 ring-1 ring-slate-300'
                  : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
              }`}
            >
              All
            </button>
            {teams.map((team) => {
              const accent = team.colors[0] ?? team.color;
              const colors = teamColorClasses(accent);
              const active = selectedTeamIdSet.has(team.id);
              return (
                <button
                  key={team.id}
                  type="button"
                  onClick={() => toggleTeam(team.id)}
                  aria-pressed={active}
                  title={active ? `Remove ${team.name} filter` : `Filter to ${team.name}`}
                  className={`inline-flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${
                    active
                      ? `${colors.chipActive} ring-1 ${colors.ring}`
                      : colors.chipInactive
                  }`}
                >
                  <span className="inline-flex shrink-0 items-center -space-x-0.5" aria-hidden="true">
                    {(team.colors.length > 0 ? team.colors : [team.color]).slice(0, 3).map((color, index) => (
                      <span
                        key={`${color}-${index}`}
                        className={`h-2 w-2 rounded-full ring-1 ring-white ${teamColorClasses(color).dot}`}
                      />
                    ))}
                  </span>
                  <span className="max-w-[150px] truncate">{team.name}</span>
                  <span className="text-[10px] font-semibold tabular-nums opacity-70">{team.memberCount}</span>
                </button>
              );
            })}
          </div>
        )}
      </div>
      <PayrollRequestTable rows={filtered} />
    </div>
  );
}
