'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { FileSpreadsheet, Landmark, Loader2, RefreshCw } from 'lucide-react';
import { ProcessingPipelineSheet } from '@prisma/client';
import { getProcessingPipelineSheetCounts } from '@/app/actions/processingPipelineActions';

const cards = [
  {
    sheet: ProcessingPipelineSheet.PIPELINE,
    label: 'Active Pipeline',
    helper: 'Files currently in Processing',
    icon: FileSpreadsheet,
  },
  {
    sheet: ProcessingPipelineSheet.RESTRUCTURE,
    label: 'Restructures',
    helper: 'Files moved for restructuring',
    icon: RefreshCw,
  },
  {
    sheet: ProcessingPipelineSheet.FUNDING,
    label: 'Fundings',
    helper: 'Funded and signing records',
    icon: Landmark,
  },
] as const;

export function ProcessorPipelineOverview() {
  const [counts, setCounts] = useState<Partial<Record<ProcessingPipelineSheet, number>>>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    getProcessingPipelineSheetCounts().then((result) => {
      if (cancelled) return;
      setCounts(result.success ? result.counts : {});
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="grid gap-4 md:grid-cols-3">
      {cards.map((card) => {
        const Icon = card.icon;
        return (
          <Link
            key={card.sheet}
            href="/pipeline"
            className="app-surface-card group transition hover:-translate-y-0.5 hover:border-blue-300 hover:shadow-md"
          >
            <div className="flex items-start justify-between">
              <div className="rounded-xl bg-blue-50 p-3 text-blue-700">
                <Icon className="h-5 w-5" />
              </div>
              {loading ? (
                <Loader2 className="h-5 w-5 animate-spin text-slate-300" />
              ) : (
                <span className="text-3xl font-bold text-slate-950">{counts[card.sheet] || 0}</span>
              )}
            </div>
            <h2 className="mt-5 font-semibold text-slate-950 group-hover:text-blue-700">{card.label}</h2>
            <p className="mt-1 text-sm text-slate-500">{card.helper}</p>
          </Link>
        );
      })}
    </div>
  );
}
