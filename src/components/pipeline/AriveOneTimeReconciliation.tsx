'use client';

import { useRef, useState } from 'react';
import { CheckCircle2, Loader2, PauseCircle } from 'lucide-react';
import {
  applyAriveOneTimeReconciliation, getAriveOneTimeReconciliationStatus, prepareAriveOneTimeReconciliation,
  type AriveOneTimePreview,
} from '@/app/actions/ariveOneTimeReconciliationActions';

type LoadedStatus = Extract<Awaited<ReturnType<typeof getAriveOneTimeReconciliationStatus>>, { success: true }>;
const displayValue = (value: string | null) => value === null ? 'Not supplied' : value === '' ? '(empty)' : value;

export function AriveOneTimeReconciliation({ initial }: { initial: LoadedStatus }) {
  const [status, setStatus] = useState(initial);
  const [previews, setPreviews] = useState<Record<string, AriveOneTimePreview>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const inFlight = useRef(false);

  async function execute(label: string, work: () => Promise<void>) {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(label); setMessage(''); setError('');
    try { await work(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'The operation did not finish. Refresh saved status before retrying.'); }
    finally { setBusy(null); inFlight.current = false; }
  }

  async function refresh() {
    const result = await getAriveOneTimeReconciliationStatus();
    if (!result.success) throw new Error(result.error);
    setStatus(result);
    return result;
  }
  async function prepare(pipelineIds: string[]) {
    for (const pipelineId of pipelineIds) {
      const row = status.rows.find(item => item.pipelineId === pipelineId);
      setMessage(`Reading current Arive data for ${row?.borrower || 'this file'}…`);
      setPreviews(prior => { const next = { ...prior }; delete next[pipelineId]; return next; });
      const result = await prepareAriveOneTimeReconciliation({ pipelineId });
      if (!result.success) throw new Error(`${row?.borrower || 'This file'}: ${result.error}`);
      setPreviews(prior => ({ ...prior, [pipelineId]: result.preview }));
    }
    setMessage('Fresh comparisons are ready. No loan changes have been applied by this review.');
  }
  async function apply(pipelineIds: string[]) {
    for (const pipelineId of pipelineIds) {
      const preview = previews[pipelineId];
      if (!preview) throw new Error('Prepare a fresh comparison before applying.');
      setMessage(`Applying reviewed Arive values for ${preview.borrower}…`);
      const result = await applyAriveOneTimeReconciliation({ planId: preview.planId, digest: preview.digest });
      if (!result.success) throw new Error(`${preview.borrower}: ${result.error}`);
      await refresh();
    }
    setMessage('Selected files reconciled. Automatic synchronization remains paused.');
  }
  const remaining = status.rows.filter(row => !row.appliedAt);
  const allPrepared = remaining.length > 0 && remaining.every(row => previews[row.pipelineId]);
  return <section aria-label="One-time Arive reconciliation" className="space-y-4">
    <div className="app-surface-card space-y-3 p-5">
      <div className="flex items-center gap-2 font-semibold"><PauseCircle aria-hidden="true" size={18} />
        {status.controls.paused ? 'Automatic synchronization paused' : 'Stop: automatic synchronization is not paused'}</div>
      <p className="text-sm text-muted-foreground">Arive supplies the reviewed loan details, services, notes, and routing. BISU retains ownership, task decisions, payroll, and financial approvals. These changes update the actual loan records in both portal modes.</p>
      <div className="flex flex-wrap gap-2">
        <button className="app-btn-secondary !h-9 !px-3 !text-xs disabled:opacity-50" disabled={Boolean(busy)} onClick={() => execute('Refresh', async () => { await refresh(); setMessage('Saved status refreshed.'); })}>Refresh saved status</button>
        <button className="app-btn-secondary !h-9 !px-3 !text-xs disabled:opacity-50" disabled={Boolean(busy) || !status.controls.paused || !remaining.length} onClick={() => execute('Prepare', () => prepare(remaining.map(row => row.pipelineId)))}>Prepare remaining comparisons</button>
        <button className="app-btn-primary !h-9 !px-3 !text-xs disabled:opacity-50" disabled={Boolean(busy) || !status.controls.paused || !allPrepared} onClick={() => execute('Apply', () => apply(remaining.map(row => row.pipelineId)))}>Apply reviewed files once</button>
      </div>
      <p className="text-sm font-medium">{status.rows.length - remaining.length} of {status.rows.length} files reconciled</p>
      <div role="status" aria-live="polite" className="flex items-center gap-2 text-sm">{busy && <Loader2 size={16} className="animate-spin" aria-hidden="true" />}{message}</div>
      {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
    </div>
    {status.rows.map(row => {
      const preview = previews[row.pipelineId];
      return <article key={row.pipelineId} aria-label={row.borrower} className="app-surface-card space-y-3 p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div><h2 className="font-semibold">{row.borrower}</h2><p className="mt-1 break-all text-sm text-muted-foreground">{row.oldNumber} → Arive #{row.ariveLoanId}</p></div>
          {row.appliedAt ? <span className="flex items-center gap-1 text-sm font-medium text-emerald-700"><CheckCircle2 size={16} aria-hidden="true" />Reconciled</span> : <div className="flex gap-2">
            <button className="app-btn-secondary !h-9 !px-3 !text-xs disabled:opacity-50" disabled={Boolean(busy) || !status.controls.paused} onClick={() => execute(row.pipelineId, () => prepare([row.pipelineId]))}>Prepare comparison</button>
            <button className="app-btn-primary !h-9 !px-3 !text-xs disabled:opacity-50" disabled={Boolean(busy) || !status.controls.paused || !preview} onClick={() => execute(row.pipelineId, () => apply([row.pipelineId]))}>Apply reviewed values</button>
          </div>}
        </div>
        {row.appliedAt && <p className="text-sm text-muted-foreground">Saved {new Date(row.appliedAt).toLocaleString()}. Background updates remain paused.</p>}
        {preview && <>
          <p className="text-sm">Arive stage: <strong>{preview.sourceStage || 'Not supplied'}</strong> · {preview.noteCount} notes · {preview.changes.length} field changes</p>
          <details><summary className="cursor-pointer text-sm font-medium">Review field changes</summary>
            <div className="mt-3 overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr className="border-b"><th className="p-2">Field</th><th className="p-2">BISU before</th><th className="p-2">Arive value</th></tr></thead>
              <tbody>{preview.changes.map(change => <tr key={`${change.entity}.${change.field}`} className="border-b align-top"><th className="p-2 font-medium">{change.field}</th><td className="max-w-xs break-words p-2">{displayValue(change.previous)}</td><td className="max-w-xs break-words p-2">{displayValue(change.next)}</td></tr>)}</tbody>
            </table></div>
          </details>
          {preview.issues.length > 0 && <details><summary className="cursor-pointer text-sm font-medium">Review notes ({preview.issues.length})</summary><ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-muted-foreground">{preview.issues.map((issue, index) => <li key={`${issue.field}.${issue.code}.${index}`}>{issue.message}</li>)}</ul></details>}
        </>}
      </article>;
    })}
  </section>;
}
