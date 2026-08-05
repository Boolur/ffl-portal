'use client';

import { useState } from 'react';
import { BarChart3, Sheet } from 'lucide-react';
import { UserRole } from '@prisma/client';
import type { PipelineReport } from '@/app/actions/pipelineReportingActions';
import type { getProcessingPipeline } from '@/app/actions/processingPipelineActions';
import { PipelinePage } from '@/components/pipeline/PipelinePage';
import { ProcessingPipelineGrid } from '@/components/pipeline/ProcessingPipelineGrid';

type ProcessingResult = Extract<Awaited<ReturnType<typeof getProcessingPipeline>>, { success: true }>;

type Props = {
  role: UserRole;
  initialReport: PipelineReport | null;
  initialProcessing: ProcessingResult;
};

export function PipelineWorkspace({ role, initialReport, initialProcessing }: Props) {
  const isProcessingRole = role === UserRole.PROCESSOR_JR || role === UserRole.PROCESSOR_SR;
  const [view, setView] = useState<'pre-processing' | 'processing'>(
    isProcessingRole || !initialReport ? 'processing' : 'pre-processing',
  );

  return (
    <div>
      {!isProcessingRole && initialReport && (
        <div className="mb-5 inline-flex rounded-xl border border-slate-200 bg-slate-50 p-1" role="tablist" aria-label="Pipeline phase">
          <button
            type="button"
            role="tab"
            aria-selected={view === 'pre-processing'}
            onClick={() => setView('pre-processing')}
            className={`inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold transition ${
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
            className={`inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold transition ${
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
        <div>
          <header className="app-page-header">
            <h1 className="app-page-title">Processing Pipeline</h1>
            <p className="app-page-subtitle">
              {initialProcessing.canEdit
                ? 'Manage active files, restructures, fundings, and audited updates.'
                : 'Track your loans after they enter Processing. This view is read-only.'}
            </p>
          </header>
          <ProcessingPipelineGrid initialData={initialProcessing} role={role} />
        </div>
      )}
    </div>
  );
}
