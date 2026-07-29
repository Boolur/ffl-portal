'use client';

import React from 'react';
import { getLeadStatusOption } from '@/lib/leadStatuses';

export function LeadStatusBadge({ status }: { status: string }) {
  const option = getLeadStatusOption(status);
  return (
    <span className={`inline-flex rounded-full border px-2.5 py-0.5 text-xs font-semibold ${option.className}`}>
      {option.label}
    </span>
  );
}
