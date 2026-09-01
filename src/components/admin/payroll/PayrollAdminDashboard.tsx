'use client';

import Link from 'next/link';
import React, { useState, useTransition } from 'react';
import { Banknote, CheckCircle2, ChevronDown, Clock, Database, DollarSign, Loader2, RefreshCw, Users, XCircle } from 'lucide-react';
import {
  reopenPayrollSubmissionCompletion,
  type getPayrollAdminDashboardData,
  type PayrollTeamCompletionStats,
} from '@/app/actions/payrollActions';
import { formatCurrency } from './payrollFormat';
import { PayrollRequestTable } from './PayrollRequestTable';

type Props = Awaited<ReturnType<typeof getPayrollAdminDashboardData>>;

function KpiCard({
  title,
  value,
  subtitle,
  Icon,
}: {
  title: string;
  value: string;
  subtitle: string;
  Icon: React.ComponentType<{ className?: string }>;
}) {
  return (
    <div className="rounded-2xl border border-emerald-100 bg-emerald-50/70 p-5 shadow-sm">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-xs font-bold uppercase tracking-wider text-emerald-700">{title}</p>
          <p className="mt-2 text-2xl font-bold text-slate-950">{value}</p>
          <p className="mt-1 text-sm text-emerald-700/80">{subtitle}</p>
        </div>
        <div className="rounded-xl bg-white p-2.5 text-emerald-600 shadow-sm ring-1 ring-emerald-100">
          <Icon className="h-5 w-5" />
        </div>
      </div>
    </div>
  );
}

function MiniStatsPanel({
  title,
  subtitle,
  rows,
}: {
  title: string;
  subtitle: string;
  rows: Array<{ label: string; count: number }>;
}) {
  const maxCount = Math.max(...rows.map((row) => row.count), 1);

  return (
    <section className="rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="border-b border-slate-100 px-5 py-4">
        <h2 className="font-bold text-slate-900">{title}</h2>
        <p className="text-sm text-slate-500">{subtitle}</p>
      </div>
      {rows.length === 0 ? (
        <p className="px-5 py-8 text-center text-sm text-slate-500">No pending data yet.</p>
      ) : (
        <div className="space-y-3 p-5">
          {rows.map((row) => (
            <div key={row.label} className="space-y-1.5">
              <div className="flex items-center justify-between gap-3 text-sm">
                <span className="font-semibold text-slate-800">{row.label}</span>
                <span className="rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs font-bold text-emerald-700">{row.count}</span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-slate-100">
                <div
                  className="h-full rounded-full bg-emerald-500"
                  style={{ width: `${Math.max((row.count / maxCount) * 100, 8)}%` }}
                />
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function TeamStatsPanel({
  teams,
  expandedTeamIds,
  reportingWindowLabel,
  pending,
  reopeningUserId,
  onToggleTeam,
  onReopenMember,
}: {
  teams: PayrollTeamCompletionStats[];
  expandedTeamIds: Set<string>;
  reportingWindowLabel: string;
  pending: boolean;
  reopeningUserId: string | null;
  onToggleTeam: (teamId: string) => void;
  onReopenMember: (teamId: string, userId: string) => void;
}) {
  const maxMembers = Math.max(...teams.map((team) => team.totalMembers), 1);

  return (
    <section className="rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="border-b border-slate-100 px-5 py-4">
        <h2 className="font-bold text-slate-900">Team Stats</h2>
        <p className="text-sm text-slate-500">Payroll completion for {reportingWindowLabel}</p>
      </div>
      {teams.length === 0 ? (
        <p className="px-5 py-8 text-center text-sm text-slate-500">No active teams found.</p>
      ) : (
        <div className="space-y-3 p-5">
          {teams.map((team) => {
            const expanded = expandedTeamIds.has(team.teamId);
            const completionPercent = team.totalMembers > 0
              ? (team.completedCount / team.totalMembers) * 100
              : 0;
            const widthPercent = Math.max((team.totalMembers / maxMembers) * 100, 8);
            return (
              <div key={team.teamId} className="rounded-xl border border-slate-100 bg-slate-50/60 p-3">
                <button
                  type="button"
                  onClick={() => onToggleTeam(team.teamId)}
                  className="w-full text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-300"
                  aria-expanded={expanded}
                >
                  <div className="flex items-center justify-between gap-3 text-sm">
                    <span className="flex min-w-0 items-center gap-2 font-semibold text-slate-800">
                      <ChevronDown className={`h-4 w-4 shrink-0 text-slate-400 transition ${expanded ? 'rotate-180' : ''}`} />
                      <span className="truncate">{team.teamName}</span>
                    </span>
                    <span className={`rounded-full px-2.5 py-0.5 text-xs font-bold ${
                      team.incompleteCount === 0 && team.totalMembers > 0
                        ? 'bg-emerald-50 text-emerald-700'
                        : 'bg-rose-50 text-rose-700'
                    }`}>
                      {team.completedCount}/{team.totalMembers}
                    </span>
                  </div>
                  <div className="mt-2 h-2 overflow-hidden rounded-full bg-white">
                    <div className="h-full rounded-full bg-slate-200" style={{ width: `${widthPercent}%` }}>
                      <div className="h-full rounded-full bg-emerald-500" style={{ width: `${completionPercent}%` }} />
                    </div>
                  </div>
                </button>
                {expanded && (
                  <div className="mt-3 space-y-2 border-t border-slate-200 pt-3">
                    {team.members.length === 0 ? (
                      <p className="text-xs font-medium text-slate-500">No payroll-eligible members in this team.</p>
                    ) : (
                      team.members.map((member) => (
                        <div key={member.userId} className="flex items-center justify-between gap-3 rounded-lg bg-white px-3 py-2 text-sm">
                          <div className="flex min-w-0 items-center gap-2">
                            {member.complete ? (
                              <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" />
                            ) : (
                              <XCircle className="h-4 w-4 shrink-0 text-rose-600" />
                            )}
                            <div className="min-w-0">
                              <p className="truncate font-semibold text-slate-900">{member.name}</p>
                              <p className="truncate text-xs text-slate-500">
                                {member.requestCount} requests{member.completedAt ? ` · completed ${formatPayrollTeamDate(member.completedAt)}` : ''}
                              </p>
                            </div>
                          </div>
                          {member.complete && (
                            <button
                              type="button"
                              disabled={pending && reopeningUserId === member.userId}
                              onClick={() => onReopenMember(team.teamId, member.userId)}
                              className="inline-flex h-7 shrink-0 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 text-xs font-bold text-slate-600 transition hover:border-blue-200 hover:bg-blue-50 hover:text-blue-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-300 disabled:opacity-60"
                            >
                              {pending && reopeningUserId === member.userId ? (
                                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                              ) : (
                                <RefreshCw className="h-3.5 w-3.5" />
                              )}
                              Reopen
                            </button>
                          )}
                        </div>
                      ))
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

function formatPayrollTeamDate(value: string) {
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
  }).format(new Date(value));
}

export function PayrollAdminDashboard({ summary, pendingRequests, recentRequests, submissionWindow, teamStats }: Props) {
  const reviewRows = pendingRequests.length > 0 ? pendingRequests : recentRequests;
  const [expandedTeamIds, setExpandedTeamIds] = useState<Set<string>>(new Set());
  const [teams, setTeams] = useState(teamStats);
  const [reopeningUserId, setReopeningUserId] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const loanTypeStats = Array.from(
    reviewRows.reduce((map, row) => {
      const loanType = row.loanType.trim() || 'Unknown Loan Type';
      map.set(loanType, (map.get(loanType) ?? 0) + 1);
      return map;
    }, new Map<string, number>())
  )
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
  const toggleTeam = (teamId: string) => {
    setExpandedTeamIds((current) => {
      const next = new Set(current);
      if (next.has(teamId)) next.delete(teamId);
      else next.add(teamId);
      return next;
    });
  };
  const reopenMember = (teamId: string, userId: string) => {
    setReopeningUserId(userId);
    startTransition(async () => {
      try {
        await reopenPayrollSubmissionCompletion(userId, submissionWindow.start, submissionWindow.end);
        setTeams((current) => current.map((team) => {
          if (team.teamId !== teamId) return team;
          const members = team.members.map((member) => (
            member.userId === userId
              ? { ...member, complete: false, completedAt: null }
              : member
          ));
          return {
            ...team,
            members,
            completedCount: members.filter((member) => member.complete).length,
            incompleteCount: members.filter((member) => !member.complete).length,
          };
        }));
      } finally {
        setReopeningUserId(null);
      }
    });
  };

  return (
    <div className="space-y-6">
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <KpiCard title="Pending Review" value={String(summary.pendingCount)} subtitle={formatCurrency(summary.pendingRevenue)} Icon={Clock} />
        <KpiCard title="Approved" value={String(summary.approvedCount)} subtitle={formatCurrency(summary.approvedRevenue)} Icon={CheckCircle2} />
        <KpiCard title="Paid" value={String(summary.paidCount)} subtitle={formatCurrency(summary.paidRevenue)} Icon={DollarSign} />
        <KpiCard title="Submitted Revenue" value={formatCurrency(summary.submittedRevenue)} subtitle={`${summary.totalRequests} total requests`} Icon={Banknote} />
      </div>

      <div className="grid gap-4 lg:grid-cols-4">
        <Link href="/admin/payroll/users" className="group rounded-2xl border border-orange-200 bg-white p-5 shadow-sm transition hover:border-orange-300 hover:shadow-md">
          <Users className="h-8 w-8 rounded-xl bg-orange-500 p-1.5 text-white" />
          <h2 className="mt-4 text-base font-bold text-slate-900">User Split Settings</h2>
          <p className="mt-1 text-sm text-slate-500">Configure LO compensation splits and recipients.</p>
          <span className="mt-4 inline-flex rounded-xl bg-orange-50 px-3 py-2 text-sm font-semibold text-orange-700 group-hover:bg-orange-500 group-hover:text-white">Manage Users</span>
        </Link>
        <Link href="/admin/payroll/requests" className="group rounded-2xl border border-blue-200 bg-white p-5 shadow-sm transition hover:border-blue-300 hover:shadow-md">
          <Clock className="h-8 w-8 rounded-xl bg-blue-600 p-1.5 text-white" />
          <h2 className="mt-4 text-base font-bold text-slate-900">Request Review</h2>
          <p className="mt-1 text-sm text-slate-500">Approve, reject, reopen, and mark payroll paid.</p>
          <span className="mt-4 inline-flex rounded-xl bg-blue-50 px-3 py-2 text-sm font-semibold text-blue-700 group-hover:bg-blue-600 group-hover:text-white">Review Requests</span>
        </Link>
        <Link href="/admin/payroll/reporting" className="group rounded-2xl border border-emerald-200 bg-white p-5 shadow-sm transition hover:border-emerald-300 hover:shadow-md">
          <DollarSign className="h-8 w-8 rounded-xl bg-emerald-600 p-1.5 text-white" />
          <h2 className="mt-4 text-base font-bold text-slate-900">Payroll Reporting</h2>
          <p className="mt-1 text-sm text-slate-500">Summarize revenue and payout splits by user.</p>
          <span className="mt-4 inline-flex rounded-xl bg-emerald-50 px-3 py-2 text-sm font-semibold text-emerald-700 group-hover:bg-emerald-600 group-hover:text-white">View Reports</span>
        </Link>
        <Link href="/admin/payroll/settings" className="group rounded-2xl border border-purple-200 bg-white p-5 shadow-sm transition hover:border-purple-300 hover:shadow-md">
          <Database className="h-8 w-8 rounded-xl bg-purple-600 p-1.5 text-white" />
          <h2 className="mt-4 text-base font-bold text-slate-900">Settings & Database</h2>
          <p className="mt-1 text-sm text-slate-500">Manage lender fees, required checks, and calculation rules.</p>
          <span className="mt-4 inline-flex rounded-xl bg-purple-50 px-3 py-2 text-sm font-semibold text-purple-700 group-hover:bg-purple-600 group-hover:text-white">Manage Rules</span>
        </Link>
      </div>

      <section className="grid items-start gap-5 xl:grid-cols-[minmax(0,1.25fr)_minmax(320px,0.85fr)]">
        <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="flex items-center justify-between gap-4 border-b border-slate-100 px-5 py-4">
            <div>
              <h2 className="font-bold text-slate-900">Pending Review Queue</h2>
              <p className="text-sm text-slate-500">Newest compensation requests awaiting payroll approval.</p>
            </div>
            <Link href="/admin/payroll/requests" className="text-sm font-semibold text-blue-600 hover:text-blue-700">View all</Link>
          </div>
          <PayrollRequestTable rows={reviewRows} compact embedded />
        </div>
        <div className="grid gap-5">
          <TeamStatsPanel
            teams={teams}
            expandedTeamIds={expandedTeamIds}
            reportingWindowLabel={submissionWindow.label}
            pending={isPending}
            reopeningUserId={reopeningUserId}
            onToggleTeam={toggleTeam}
            onReopenMember={reopenMember}
          />
          <MiniStatsPanel title="Loan Type Stats" subtitle="Pending/recent loans by loan type" rows={loanTypeStats} />
        </div>
      </section>
    </div>
  );
}
