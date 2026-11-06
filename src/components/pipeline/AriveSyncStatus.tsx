'use client';

import { useRef, useState } from 'react';
import { AlertCircle, CheckCircle2, Clock3, Loader2, Pause, RefreshCw } from 'lucide-react';
import type { AriveSyncView } from '@/lib/ariveSyncTypes';
import { ariveFieldLabel, ariveSyncHealth, formatAriveCalendarDate, formatAriveConflictValue, formatAriveSyncDate } from '@/lib/ariveSyncPresentation';
import { acknowledgeArivePipelineConflicts, setArivePipelineSyncEnabled, syncArivePipelineNow } from '@/app/actions/arivePipelineSyncActions';

const tones = {
  muted: 'border-slate-200 bg-slate-50 text-slate-600',
  pending: 'border-blue-200 bg-blue-50 text-blue-800',
  success: 'border-emerald-200 bg-emerald-50 text-emerald-800',
  warning: 'border-amber-300 bg-amber-50 text-amber-900',
  error: 'border-red-300 bg-red-50 text-red-800',
};

export function AriveSyncBadge({ view }: { view: AriveSyncView | null | undefined }) {
  const health = ariveSyncHealth(view);
  if (!health) return null;
  const Icon = health.tone === 'success' ? CheckCircle2 : health.tone === 'muted' ? Pause : health.tone === 'pending' ? Clock3 : AlertCircle;
  return <span title={`${health.label}${view?.lastSuccessAt ? ` · Last successful sync: ${formatAriveSyncDate(view.lastSuccessAt)}` : ''}`} className={`inline-flex max-w-full items-center gap-1 rounded-full border px-1.5 py-0.5 font-sans text-[9px] font-bold ${tones[health.tone]}`}><Icon size={11} className="shrink-0" aria-hidden="true" /><span className="truncate">{health.label}</span></span>;
}

export function AriveSyncStatus({ view, pipelineLoanId, onChanged, editing = false, responsibilityLabel }: {
  view: AriveSyncView | null | undefined;
  pipelineLoanId: string;
  onChanged: () => Promise<void>;
  editing?: boolean;
  responsibilityLabel?: string;
}) {
  const [busy, setBusy] = useState<'sync' | 'enable' | 'pause' | 'acknowledge' | null>(null);
  const [error, setError] = useState('');
  const lock = useRef(false);
  const health = ariveSyncHealth(view);
  if (!view || !health) return null;
  async function perform(action: 'sync' | 'enable' | 'pause' | 'acknowledge') {
    if (lock.current || editing) return;
    lock.current = true; setBusy(action); setError('');
    try {
      const result = action === 'sync'
        ? await syncArivePipelineNow({ id: pipelineLoanId })
        : action === 'acknowledge' ? await acknowledgeArivePipelineConflicts({ id: pipelineLoanId })
          : await setArivePipelineSyncEnabled({ id: pipelineLoanId, enabled: action === 'enable' });
      if (!result.success) setError(result.error);
      await onChanged();
    } catch (e) { setError(e instanceof Error ? e.message : 'Unable to refresh the Arive connection. Please try again.'); }
    finally { lock.current = false; setBusy(null); }
  }
  return <section aria-label="Arive synchronization" className={`mb-4 rounded-2xl border p-4 ${tones[health.tone]}`}>
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0"><h3 className="flex items-center gap-2 text-sm font-bold"><RefreshCw size={16} aria-hidden="true" />{health.label}</h3>
        <p className="mt-1 text-xs leading-relaxed">{view.enabled ? 'Arive supplies this file’s stage, service progress, milestone dates, and headed processor notes. A conflicting portal entry is flagged, and the Arive value is retained.' : 'Automatic updates from Arive are paused for this test file.'}</p>
        {view.stageLabel && <p className="mt-2 text-sm font-semibold">Arive stage: {view.stageLabel} <span className="font-normal">· {formatAriveCalendarDate(view.stageDate)}</span></p>}
        <p className="mt-1 text-xs">{view.lastSuccessAt ? `Last successful sync: ${formatAriveSyncDate(view.lastSuccessAt)}` : 'No successful sync recorded.'}{view.nextAttemptAt && view.enabled ? ` · Next check: ${formatAriveSyncDate(view.nextAttemptAt)}` : ''}</p>
      </div>
      {view.canManage && <div className="flex shrink-0 flex-wrap gap-2">
        {view.enabled && <button type="button" className="app-btn-secondary !h-9 !bg-white" disabled={Boolean(busy) || editing} onClick={() => void perform('sync')}>{busy === 'sync' ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}{busy === 'sync' ? 'Syncing…' : 'Sync now'}</button>}
        <button type="button" className="app-btn-secondary !h-9 !bg-white" disabled={Boolean(busy) || editing} onClick={() => void perform(view.enabled ? 'pause' : 'enable')}>{busy === 'pause' || busy === 'enable' ? <Loader2 size={14} className="animate-spin" /> : view.enabled ? <Pause size={14} /> : <RefreshCw size={14} />}{busy === 'pause' ? 'Pausing…' : busy === 'enable' ? 'Enabling…' : view.enabled ? 'Pause sync' : 'Enable test-file sync'}</button>
      </div>}
    </div>
    {responsibilityLabel && view.enabled && <p className="mt-3 rounded-lg bg-white/70 px-3 py-2 text-xs">Service responsibility follows the {responsibilityLabel} processing rules. The status and dates shown here reflect actual Arive progress.</p>}
    {(error || view.error) && <p role="alert" className="mt-3 rounded-lg border border-red-200 bg-white p-3 text-xs font-semibold text-red-800">{error || view.error}{view.lastSuccessAt ? ' Previously synced information is still displayed.' : ''}</p>}
    {view.enabled && view.missingFields.length > 0 && <div role="status" className="mt-3 rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-900"><p className="font-bold">Missing or invalid source information</p><ul className="mt-1 list-inside list-disc space-y-1">{view.missingFields.map(field => <li key={field}>{ariveFieldLabel(field)}</li>)}</ul></div>}
    {view.enabled && view.issues.length > 0 && <div className="mt-3 rounded-lg border border-amber-200 bg-white/80 p-3 text-xs text-amber-950"><p className="font-bold">Review these Arive details</p><ul className="mt-1 list-inside list-disc space-y-1">{view.issues.map((issue, index) => <li key={`${issue.field}-${issue.code}-${index}`}>{issue.message}</li>)}</ul></div>}
    {view.enabled && Boolean(view.structuredFields?.length) && <details className="mt-3 rounded-lg border border-blue-100 bg-white/90 p-3"><summary className="cursor-pointer text-xs font-bold text-slate-800">Processor updates from Arive notes</summary><div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">{view.structuredFields!.map(field => <article key={field.key} className="min-w-0 rounded-lg border border-slate-100 bg-slate-50 p-3 text-xs text-slate-700"><h4 className="font-semibold text-slate-500">{field.label}</h4><p className="mt-1 whitespace-pre-wrap break-words font-medium">{field.value || 'Not supplied'}</p><p className="mt-2 text-[10px] text-slate-500">{field.author}{field.updatedAt ? ` · ${formatAriveSyncDate(field.updatedAt)}` : ''}</p></article>)}</div></details>}
    {view.conflicts.length > 0 && <details className="mt-3 rounded-lg border border-amber-200 bg-white/90 p-3" open><summary className="cursor-pointer text-xs font-bold text-amber-950">{view.conflicts.length} portal {view.conflicts.length === 1 ? 'entry differs' : 'entries differ'} from Arive</summary><p className="mt-1 text-xs text-slate-600">Arive values were retained. Make the correction in Arive if its information needs to change.</p><div className="mt-3 grid max-h-80 gap-2 overflow-y-auto sm:grid-cols-2">{view.conflicts.map((conflict, index) => <article key={`${conflict.field}-${conflict.detectedAt}-${index}`} className="min-w-0 rounded-lg border border-amber-100 p-2.5 text-xs text-slate-700"><p className="font-bold">{conflict.label || ariveFieldLabel(conflict.field)}</p><dl className="mt-2 grid grid-cols-[70px_minmax(0,1fr)] gap-x-2 gap-y-1"><dt className="text-slate-500">Portal entry</dt><dd className="break-words">{formatAriveConflictValue(conflict.field, conflict.portalValue)}</dd><dt className="text-slate-500">Arive value</dt><dd className="break-words font-semibold">{formatAriveConflictValue(conflict.field, conflict.ariveValue)}</dd></dl><p className="mt-2 text-[10px] text-slate-500">{formatAriveSyncDate(conflict.detectedAt)}</p></article>)}</div>{view.canManage && <button type="button" className="app-btn-secondary mt-3 !h-8 !bg-white !text-xs" disabled={Boolean(busy) || editing} onClick={() => void perform('acknowledge')}>{busy === 'acknowledge' && <Loader2 size={13} className="animate-spin" />}{busy === 'acknowledge' ? 'Acknowledging…' : 'Acknowledge differences'}</button>}</details>}
  </section>;
}
