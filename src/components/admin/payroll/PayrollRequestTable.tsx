'use client';

import React, { useState, useTransition } from 'react';
import { Check, ChevronDown, DollarSign, Loader2, RefreshCw, X } from 'lucide-react';
import { PayrollCompRequestStatus } from '@prisma/client';
import {
  approvePayrollRequest,
  markPayrollRequestPaid,
  rejectPayrollRequest,
  reopenPayrollRequest,
  type PayrollRequestRow,
} from '@/app/actions/payrollActions';
import {
  formatCurrency,
  formatDate,
  formatPercent,
  loanChannelLabel,
  payrollStatusClasses,
  payrollStatusLabel,
  processingTypeLabel,
} from './payrollFormat';

type Props = {
  rows: PayrollRequestRow[];
  compact?: boolean;
};

export function PayrollRequestTable({ rows, compact = false }: Props) {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const runAction = (id: string, action: () => Promise<void>) => {
    setBusyId(id);
    startTransition(async () => {
      try {
        await action();
      } finally {
        setBusyId(null);
      }
    });
  };

  if (rows.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-slate-200 bg-white px-6 py-14 text-center">
        <DollarSign className="mx-auto h-10 w-10 text-slate-300" />
        <p className="mt-3 text-sm font-semibold text-slate-700">No payroll requests yet</p>
        <p className="mt-1 text-sm text-slate-500">Submitted compensation requests will appear here.</p>
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-100 bg-slate-50/70">
              <th className="px-5 py-3 text-left text-[11px] font-bold uppercase tracking-wider text-slate-500">Loan</th>
              {!compact && <th className="px-5 py-3 text-left text-[11px] font-bold uppercase tracking-wider text-slate-500">Loan Officer</th>}
              <th className="px-5 py-3 text-left text-[11px] font-bold uppercase tracking-wider text-slate-500">Lender</th>
              <th className="px-5 py-3 text-right text-[11px] font-bold uppercase tracking-wider text-slate-500">Revenue</th>
              <th className="px-5 py-3 text-left text-[11px] font-bold uppercase tracking-wider text-slate-500">Status</th>
              <th className="px-5 py-3 text-right text-[11px] font-bold uppercase tracking-wider text-slate-500">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map((row) => {
              const expanded = expandedId === row.id;
              const busy = isPending && busyId === row.id;
              return (
                <React.Fragment key={row.id}>
                  <tr className="hover:bg-slate-50/70">
                    <td className="px-5 py-4">
                      <button
                        type="button"
                        className="flex items-center gap-2 text-left"
                        onClick={() => setExpandedId(expanded ? null : row.id)}
                      >
                        <ChevronDown className={`h-4 w-4 text-slate-400 transition ${expanded ? 'rotate-180' : ''}`} />
                        <span>
                          <span className="block font-semibold text-slate-900">{row.loanNumber}</span>
                          <span className="block text-xs text-slate-500">{row.borrowerName}</span>
                        </span>
                      </button>
                    </td>
                    {!compact && (
                      <td className="px-5 py-4">
                        <p className="font-medium text-slate-800">{row.loanOfficerName}</p>
                        <p className="text-xs text-slate-500">{row.loanOfficerEmail}</p>
                      </td>
                    )}
                    <td className="px-5 py-4">
                      <p className="font-medium text-slate-800">{row.lender}</p>
                      <p className="text-xs text-slate-500">{loanChannelLabel(row.loanChannel)} · {processingTypeLabel(row.processingType)}</p>
                    </td>
                    <td className="px-5 py-4 text-right font-semibold text-slate-900">{formatCurrency(row.expectedRevenue)}</td>
                    <td className="px-5 py-4">
                      <span className={`inline-flex rounded-full border px-2.5 py-0.5 text-xs font-semibold ${payrollStatusClasses(row.status)}`}>
                        {payrollStatusLabel(row.status)}
                      </span>
                    </td>
                    <td className="px-5 py-4">
                      <div className="flex justify-end gap-2">
                        {row.status === PayrollCompRequestStatus.PENDING_REVIEW && (
                          <>
                            <button
                              type="button"
                              className="app-btn-secondary !h-8 !px-3 text-rose-700"
                              disabled={busy}
                              onClick={() => runAction(row.id, () => rejectPayrollRequest(row.id, 'Rejected by payroll admin'))}
                            >
                              <X className="h-3.5 w-3.5" /> Reject
                            </button>
                            <button
                              type="button"
                              className="app-btn-primary !h-8 !px-3"
                              disabled={busy}
                              onClick={() => runAction(row.id, () => approvePayrollRequest(row.id))}
                            >
                              {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                              Approve
                            </button>
                          </>
                        )}
                        {row.status === PayrollCompRequestStatus.APPROVED && (
                          <>
                            <button
                              type="button"
                              className="app-btn-secondary !h-8 !px-3"
                              disabled={busy}
                              onClick={() => runAction(row.id, () => reopenPayrollRequest(row.id))}
                            >
                              <RefreshCw className="h-3.5 w-3.5" /> Reopen
                            </button>
                            <button
                              type="button"
                              className="app-btn-primary !h-8 !px-3"
                              disabled={busy}
                              onClick={() => runAction(row.id, () => markPayrollRequestPaid(row.id))}
                            >
                              {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <DollarSign className="h-3.5 w-3.5" />}
                              Mark Paid
                            </button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                  {expanded && (
                    <tr className="bg-slate-50/60">
                      <td colSpan={compact ? 5 : 6} className="px-5 py-4">
                        <div className="grid gap-4 lg:grid-cols-[1fr_1.2fr]">
                          <div className="rounded-xl border border-slate-200 bg-white p-4">
                            <p className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Request Details</p>
                            <dl className="mt-3 grid grid-cols-2 gap-3 text-sm">
                              <div><dt className="text-xs text-slate-500">Loan Type</dt><dd className="font-medium text-slate-800">{row.loanType}</dd></div>
                              <div><dt className="text-xs text-slate-500">Submitted</dt><dd className="font-medium text-slate-800">{formatDate(row.submittedAt)}</dd></div>
                              <div><dt className="text-xs text-slate-500">Reviewed</dt><dd className="font-medium text-slate-800">{formatDate(row.reviewedAt)}</dd></div>
                              <div><dt className="text-xs text-slate-500">Paid</dt><dd className="font-medium text-slate-800">{formatDate(row.paidAt)}</dd></div>
                            </dl>
                            {(row.submitterNotes || row.adminNotes || row.rejectionReason) && (
                              <div className="mt-4 space-y-2 text-sm text-slate-600">
                                {row.submitterNotes && <p><span className="font-semibold text-slate-800">LO notes:</span> {row.submitterNotes}</p>}
                                {row.adminNotes && <p><span className="font-semibold text-slate-800">Admin notes:</span> {row.adminNotes}</p>}
                                {row.rejectionReason && <p><span className="font-semibold text-slate-800">Rejection:</span> {row.rejectionReason}</p>}
                              </div>
                            )}
                          </div>
                          <div className="rounded-xl border border-slate-200 bg-white p-4">
                            <p className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Split Snapshot</p>
                            <div className="mt-3 divide-y divide-slate-100">
                              {row.splits.map((split) => (
                                <div key={split.id} className="flex items-center justify-between gap-4 py-2">
                                  <div>
                                    <p className="font-medium text-slate-900">{split.recipientName}</p>
                                    <p className="text-xs text-slate-500">{split.roleLabel} · {formatPercent(split.splitPercent)}</p>
                                  </div>
                                  <p className="font-semibold text-slate-900">{formatCurrency(split.amount)}</p>
                                </div>
                              ))}
                            </div>
                          </div>
                        </div>
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
