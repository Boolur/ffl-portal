'use client';

import React, { useMemo, useState } from 'react';
import { PayrollCompRequestStatus } from '@prisma/client';
import type { PayrollRequestRow } from '@/app/actions/payrollActions';
import { PayrollRequestTable } from './PayrollRequestTable';

export function PayrollRequestsPage({ rows }: { rows: PayrollRequestRow[] }) {
  const [status, setStatus] = useState<PayrollCompRequestStatus | 'ALL'>('ALL');
  const [search, setSearch] = useState('');

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return rows.filter((row) => {
      const matchesStatus = status === 'ALL' || row.status === status;
      const matchesSearch =
        !term ||
        row.loanNumber.toLowerCase().includes(term) ||
        row.borrowerName.toLowerCase().includes(term) ||
        row.lender.toLowerCase().includes(term) ||
        row.loanOfficerName.toLowerCase().includes(term);
      return matchesStatus && matchesSearch;
    });
  }, [rows, search, status]);

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
      </div>
      <PayrollRequestTable rows={filtered} />
    </div>
  );
}
