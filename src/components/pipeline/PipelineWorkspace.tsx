'use client';

import { useState } from 'react';
import { BarChart3, CheckCircle2, Sheet } from 'lucide-react';
import { UserRole } from '@prisma/client';
import type { PipelineReport } from '@/app/actions/pipelineReportingActions';
import type { getProcessingPipeline } from '@/app/actions/processingPipelineActions';
import type { ProcessingPipelineSavedLayout } from '@/app/actions/processingPipelineLayoutActions';
import { PipelinePage } from '@/components/pipeline/PipelinePage';
import { ProcessingPipelineGrid } from '@/components/pipeline/ProcessingPipelineGrid';

type ProcessingResult = Extract<Awaited<ReturnType<typeof getProcessingPipeline>>, { success: true }>;

type Props = {
  role: UserRole;
  initialReport: PipelineReport | null;
  initialProcessing: ProcessingResult;
  initialLayouts: ProcessingPipelineSavedLayout[];
};

export function PipelineWorkspace({
  role,
  initialReport,
  initialProcessing,
  initialLayouts,
}: Props) {
  const isProcessingRole = role === UserRole.PROCESSOR_JR || role === UserRole.PROCESSOR_SR;
  const [view, setView] = useState<'pre-processing' | 'processing'>(
    isProcessingRole || !initialReport ? 'processing' : 'pre-processing',
  );

  return (
    <div className="w-full space-y-6">
      {!isProcessingRole && initialReport && (
        <div className="inline-flex rounded-2xl border border-slate-200 bg-slate-50 p-1.5 shadow-sm" role="tablist" aria-label="Pipeline phase">
          <button
            type="button"
            role="tab"
            aria-selected={view === 'pre-processing'}
            onClick={() => setView('pre-processing')}
            className={`inline-flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-bold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-300 ${
              view === 'pre-processing'
                ? 'bg-white text-slate-950 shadow-sm'
                : 'text-slate-500 hover:text-slate-800'
            }`}
          >
            <BarChart3 className="h-4 w-4" />
            Pre-Processing
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={view === 'processing'}
            onClick={() => setView('processing')}
            className={`inline-flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-bold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-300 ${
              view === 'processing'
                ? 'bg-white text-slate-950 shadow-sm'
                : 'text-slate-500 hover:text-slate-800'
            }`}
          >
            <Sheet className="h-4 w-4" />
            Processing
          </button>
        </div>
      )}

      {view === 'pre-processing' && initialReport ? (
        <PipelinePage initialReport={initialReport} />
      ) : (
        <div className="space-y-6">
          <header className="app-page-header flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <div className="inline-flex items-center gap-2 rounded-full border border-blue-100 bg-blue-50 px-3 py-1 text-xs font-bold uppercase tracking-[0.14em] text-blue-700">
                <Sheet className="h-3.5 w-3.5" />
                Processing Operations
              </div>
              <h1 className="mt-3 text-3xl font-black tracking-tight text-slate-950">Processing Pipeline</h1>
              <p className="mt-1 max-w-2xl text-sm font-medium text-slate-500">
                {role === UserRole.LOAN_OFFICER
                  ? 'Manage your Self Processed and Contract/3rd Party loans. In-House loans remain read-only.'
                  : role === UserRole.LOA
                  ? 'Review company-wide processing milestones, restructures, and fundings in a read-only workspace.'
                  : initialProcessing.canEdit
                  ? 'Manage assignments, milestones, restructures, fundings, and audited updates from one workspace.'
                  : 'Track every milestone after your loans enter Processing. This view is read-only.'}
              </p>
            </div>
            <div className="flex items-center gap-3 rounded-2xl border border-emerald-100 bg-emerald-50 px-4 py-3 text-sm font-bold text-emerald-800">
              <CheckCircle2 className="h-5 w-5" />
              {initialProcessing.canEdit
                ? role === UserRole.LOAN_OFFICER
                  ? 'Audited edits on eligible loans'
                  : 'Audited autosave enabled'
                : 'Live processing visibility'}
            </div>
          </header>
          <ProcessingPipelineGrid
            initialData={initialProcessing}
            initialLayouts={initialLayouts}
            role={role}
          />
        </div>
      )}
    </div>
  );
}
