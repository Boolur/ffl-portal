'use client';
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import Link from 'next/link';
import { ChevronDown, FileUp, Loader2, Wrench } from 'lucide-react';
import { getAriveTestWorkspace, linkExistingAriveTestPackage } from '@/app/actions/submissionPilotActions';
import { PilotDocumentFile } from './PilotDocumentFile';
import { ArivePackagePanel } from './ArivePilotPanel';
import { AriveStatusTestPanel } from './AriveStatusTestPanel';
import { createArivePanelRefresh, type ArivePanelRefresh } from '../../lib/arivePanelRefresh';
type Data = Extract<Awaited<ReturnType<typeof getAriveTestWorkspace>>, { success: true }>['data'];
export function AriveWorkspacePanel({ requestTaskId, refreshSignal = null }: { requestTaskId: string; refreshSignal?: string | null }) {
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [transferOpen, setTransferOpen] = useState(false);
  const [diagnosticsOpen, setDiagnosticsOpen] = useState(false);
  const transferId = useId();
  const diagnosticsId = useId();
  const lock = useRef(false);
  const reader = useRef<ArivePanelRefresh | null>(null);
  const observedRefresh = useRef({ requestTaskId, refreshSignal });
  const reload = useCallback(async () => { await reader.current?.refresh(true); }, []);
  useEffect(() => {
    const current = createArivePanelRefresh({
      load: async () => {
        const result = await getAriveTestWorkspace(requestTaskId);
        if (!result.success) throw new Error(result.error);
        return result.data;
      },
      apply: value => { setData(value); setError(''); },
      error: cause => setError(cause instanceof Error ? cause.message : 'Unable to load Arive integration.'),
    });
    reader.current = current;
    setData(null); setError('');
    void current.refresh().catch(() => {});
    return () => { current.dispose(); if (reader.current === current) reader.current = null; };
  }, [requestTaskId]);
  useEffect(() => {
    const prior = observedRefresh.current;
    observedRefresh.current = { requestTaskId, refreshSignal };
    if (prior.requestTaskId === requestTaskId && prior.refreshSignal !== refreshSignal) void reader.current?.refresh(true).catch(() => {});
  }, [requestTaskId, refreshSignal]);
  const entry = data?.packages[0];
  const documentItems = entry?.package.items.filter(item => item.files.length || item.waiver) ?? [];
  const showConnection = Boolean(error || !data || !data.ariveConfigured || !entry?.package.ariveLink);
  return <div className="space-y-4">
    {documentItems.length > 0 && entry && <section className="app-surface-card space-y-3">
      <div><h3 className="font-bold">Submission documents</h3><p className="mt-1 text-xs text-muted-foreground">Open, download, or drag the files submitted for processing.</p></div>
      <div className="grid items-start gap-3 md:grid-cols-2">{documentItems.map(item => <div key={item.id} className="min-w-0 space-y-2 rounded-xl border border-border bg-white p-3">
        <div className="flex items-start justify-between gap-2"><h4 className="text-sm font-semibold">{item.label}</h4><span className="app-count-badge">{item.review === 'APPROVED' ? 'Approved' : 'Awaiting review'}</span></div>
        {item.files.map(file => <PilotDocumentFile key={file.id} taskId={entry.id} file={file} />)}
        {item.waiver && <p className="text-sm text-muted-foreground">Not applicable: {item.waiver}</p>}
      </div>)}</div>
    </section>}
    {showConnection && <div className="rounded-xl border border-slate-200 bg-white p-4 text-sm">
      {error && <p role="alert" className="text-red-700">{error}</p>}
      {!data && !error && <p role="status" className="text-slate-500">Loading submission documents…</p>}
      {data && !data.ariveConfigured && <p className="text-slate-600">An Admin III can connect the branch credentials in <Link href="/admin/arive" className="font-semibold text-primary underline">Arive integration settings</Link>.</p>}
      {entry && data?.ariveConfigured && !entry.package.ariveLink && <div className="space-y-2"><p className="text-slate-600">Link the existing Arive file to make its transfer controls available.</p><button type="button" className="app-btn-secondary" disabled={busy} onClick={async () => {
        if (lock.current) return;
        lock.current = true; setBusy(true); setError('');
        try { const result = await linkExistingAriveTestPackage(entry.id); if (!result.success) throw new Error(result.error); await reload(); }
        catch (cause) { setError(cause instanceof Error ? cause.message : 'Unable to link Arive.'); }
        finally { setBusy(false); lock.current = false; }
      }}>{busy && <Loader2 size={15} className="animate-spin" aria-hidden="true" />}{busy ? 'Verifying Arive loan…' : 'Link TESTING TESTER in Arive'}</button></div>}
    </div>}
    {entry?.package.ariveLink && data && <section className="overflow-hidden rounded-xl border border-slate-200 bg-white">
      <button type="button" className="flex w-full items-center justify-between gap-3 p-4 text-left" aria-expanded={transferOpen} aria-controls={transferId} onClick={() => setTransferOpen(open => !open)}>
        <span className="flex items-center gap-2 text-sm font-semibold text-slate-700"><FileUp size={17} aria-hidden="true" />Arive document transfer</span><ChevronDown size={16} className={`transition-transform ${transferOpen ? 'rotate-180' : ''}`} aria-hidden="true" />
      </button>
      {transferOpen && <div id={transferId} className="border-t border-slate-100 p-3"><ArivePackagePanel taskId={entry.id} pkg={entry.package} configured={data.ariveConfigured} parentBusy={busy} onChanged={reload} hideNotes /></div>}
    </section>}
    {data?.canConfigureArive && data.ariveConfigured && <section className="overflow-hidden rounded-xl border border-slate-200 bg-slate-50/60">
      <button type="button" className="flex w-full items-center justify-between gap-3 p-4 text-left" aria-expanded={diagnosticsOpen} aria-controls={diagnosticsId} onClick={() => setDiagnosticsOpen(open => !open)}>
        <span className="flex items-center gap-2 text-xs font-semibold text-slate-500"><Wrench size={15} aria-hidden="true" />Integration diagnostics · Admin</span><ChevronDown size={15} className={`transition-transform ${diagnosticsOpen ? 'rotate-180' : ''}`} aria-hidden="true" />
      </button>
      {diagnosticsOpen && <div id={diagnosticsId} className="space-y-3 border-t border-slate-200 p-3"><AriveStatusTestPanel /></div>}
    </section>}
  </div>;
}
