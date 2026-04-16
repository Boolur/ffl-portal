'use client';

import React from 'react';

const STATUS_STYLES: Record<string, string> = {
  NEW: 'border-blue-200 bg-blue-50 text-blue-700',
  CONTACTED: 'border-amber-200 bg-amber-50 text-amber-700',
  WORKING: 'border-indigo-200 bg-indigo-50 text-indigo-700',
  CONVERTED: 'border-green-200 bg-green-50 text-green-700',
  DEAD: 'border-slate-200 bg-slate-100 text-slate-500',
  RETURNED: 'border-rose-200 bg-rose-50 text-rose-700',
  UNASSIGNED: 'border-orange-200 bg-orange-50 text-orange-700',
};

export function LeadStatusBadge({ status }: { status: string }) {
  return (
    <span className={`inline-flex rounded-full border px-2.5 py-0.5 text-xs font-semibold ${STATUS_STYLES[status] || STATUS_STYLES.NEW}`}>
      {status}
    </span>
  );
}
