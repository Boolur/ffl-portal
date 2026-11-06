'use client';

import { Activity, useEffect, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import { useSession } from 'next-auth/react';
import { BarChart3, CheckCircle2, Loader2, Sheet } from 'lucide-react';
import { UserRole } from '@prisma/client';
import type { PipelineReport } from '@/app/actions/pipelineReportingActions';
import { getProcessingPipelineWorkspace, type ProcessingPipelineWorkspaceData } from '@/app/actions/pipelineWorkspaceActions';
import { createPipelineRefresh } from '@/lib/pipelineRefresh';
import { pipelineScopeMatches, readPipelineWorkspaceCache, setPipelineWorkspaceCachedTab } from '@/lib/pipelineWorkspaceCache';
import type { ProcessingPipelineViewSnapshot } from './ProcessingPipelineGrid';
const PipelinePage = dynamic(() => import('@/components/pipeline/PipelinePage').then((module) => module.PipelinePage));
const ProcessingPipelineGrid = dynamic(() => import('@/components/pipeline/ProcessingPipelineGrid').then((module) => module.ProcessingPipelineGrid));

type Props = {
  cacheScope: string;
  role: UserRole;
  initialReport: PipelineReport | null;
  initialWorkspace: ProcessingPipelineWorkspaceData | null;
  submissionConfig: {
    disclosureEnabled: boolean;
    qcEnabled: boolean;
    loanOfficerOptions: Array<{ id: string; name: string }>;
  } | null;
};

export function PipelineWorkspace(props: Props) {
  const { data: session, status } = useSession();
  if (status !== 'authenticated' || !pipelineScopeMatches(props.cacheScope, session?.user)) {
    return <div className="app-card p-6 text-sm text-muted-foreground" role="status">Loading your pipeline...</div>;
  }
  return <PipelineWorkspaceContent key={props.cacheScope} {...props} />;
}

function PipelineWorkspaceContent({
  cacheScope,
  role,
  initialReport,
  initialWorkspace,
  submissionConfig,
}: Props) {
  const isProcessingRole =
    role === UserRole.PROCESSOR_JR ||
    role === UserRole.PROCESSOR_SR ||
    role === UserRole.PROCESSING_MANAGER;
  const [restored] = useState(() => readPipelineWorkspaceCache<ProcessingPipelineViewSnapshot>(cacheScope));
  const [view, setView] = useState<'pre-processing' | 'processing'>(
    isProcessingRole || !initialReport ? 'processing' : restored?.snapshot.tab || 'pre-processing',
  );
  const [workspace, setWorkspace] = useState(restored?.snapshot.workspace || initialWorkspace);
  useEffect(() => setPipelineWorkspaceCachedTab(cacheScope, view), [cacheScope, view]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [needsReload, setNeedsReload] = useState(false);
  const loaderRef = useRef<ReturnType<typeof createPipelineRefresh<void, Awaited<ReturnType<typeof getProcessingPipelineWorkspace>>>> | null>(null);
  useEffect(() => {
    const loader = createPipelineRefresh<void, Awaited<ReturnType<typeof getProcessingPipelineWorkspace>>>({
      load: getProcessingPipelineWorkspace,
      onStart: () => { setLoading(true); setLoadError(''); },
      onSuccess: (result) => {
        if (result.success) setWorkspace(result);
        else setLoadError(result.error);
      },
      onError: (timedOut) => {
        setNeedsReload(timedOut);
        setLoadError(timedOut ? 'Loading took too long. Reload the page to reconnect.' : 'Unable to load Processing. Please try again.');
      },
      onIdle: () => setLoading(false),
    });
    loaderRef.current = loader;
    return () => { loader.dispose(); loaderRef.current = null; };
  }, []);
  useEffect(() => {
    if (view === 'processing' && !workspace && !loaderRef.current?.isBusy()) loaderRef.current?.request();
  }, [view, workspace]);
  const initialProcessing = workspace?.data;

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

      {initialReport && (
        <Activity mode={view === 'pre-processing' ? 'visible' : 'hidden'}>
        <PipelinePage
          active={view === 'pre-processing'}
          initialReport={initialReport}
          submissionConfig={submissionConfig}
        />
        </Activity>
      )}
      {(workspace || view === 'processing') && (
      <Activity mode={view === 'processing' ? 'visible' : 'hidden'}>
      {!initialProcessing ? (
        <div className="app-card p-6" aria-live="polite" aria-busy={loading}>
          {loading ? <p className="flex items-center gap-2 text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />Loading Processing...</p> : (
            <>
              <p role="alert" className="mb-3 text-muted-foreground">{loadError || 'Open the Processing pipeline.'}</p>
              <button type="button" className="app-btn-secondary" onClick={() => needsReload ? window.location.reload() : loaderRef.current?.request()}>
                {needsReload ? 'Reload page' : 'Try again'}
              </button>
            </>
          )}
        </div>
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
            cacheScope={cacheScope}
            active={view === 'processing'}
            restoredView={restored?.snapshot.view}
            restoredObservedAt={restored?.observedAt}
            restoredStale={restored?.stale}
            initialData={initialProcessing}
            initialLayouts={workspace?.layouts || []}
            role={role}
          />
        </div>
      )}
      </Activity>
      )}
    </div>
  );
}
