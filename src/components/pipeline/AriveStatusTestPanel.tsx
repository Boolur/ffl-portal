'use client';

import { useRef, useState } from 'react';
import { CheckCircle2, Loader2, RefreshCw } from 'lucide-react';
import { readAriveTestStatus, updateAriveTestStatus } from '@/app/actions/ariveStatusTestActions';
import { ARIVE_TEST_STAGES, type AriveTestStatusSnapshot } from '@/lib/ariveStatusTest';

const labels: Record<typeof ARIVE_TEST_STAGES[number], string> = {
  APPLICATION_INTAKE: 'Application intake', QUALIFICATION: 'Qualification',
  LOAN_SETUP: 'Loan setup', UNDERWRITING_SUBMITTED: 'Submitted to underwriting',
};
export function AriveStatusTestPanel() {
  const [current, setCurrent] = useState<AriveTestStatusSnapshot | null>(null);
  const [target, setTarget] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [verified, setVerified] = useState(false);
  const lock = useRef(false);
  async function perform(change: boolean) {
    if (lock.current) return;
    if (change && (!current?.readId || !target)) return;
    lock.current = true; setBusy(true); setError(''); setVerified(false);
    try {
      const result = change
        ? await updateAriveTestStatus({ readId: current!.readId, expected: current!.stage, target })
        : await readAriveTestStatus();
      if (!result.success) {
        setCurrent(value => value ? { ...value, readId: '' } : null);
        throw new Error(result.error);
      }
      setCurrent(result.data); setTarget(''); setVerified(change);
    } catch (e) {
      setCurrent(value => value ? { ...value, readId: '' } : null);
      setError(e instanceof Error ? e.message : 'Read the current Arive stage before trying again.');
    } finally { lock.current = false; setBusy(false); }
  }
  return <section className="app-surface-card space-y-4">
    <div><h3 className="font-bold">Arive stage test</h3><p className="mt-1 text-sm text-muted-foreground">Admin III · TESTING TESTER · 17881588. Read the current stage, then choose an early-stage change to verify in Arive.</p></div>
    <button type="button" className="app-btn-secondary" disabled={busy} onClick={() => void perform(false)}>{busy ? <Loader2 size={16} className="animate-spin" /> : <RefreshCw size={16} />}Read current stage from Arive</button>
    {current && <div className="rounded-xl border border-border bg-slate-50 p-3 text-sm"><p><span className="font-semibold">Current Arive stage:</span> {labels[current.stage as keyof typeof labels] || current.stage.replaceAll('_', ' ')}</p><p className="mt-1 text-muted-foreground">Stage date: {current.date.slice(0, 10)} · {current.historyCount} history entries · Checked {new Date(current.checkedAt).toLocaleString()}</p></div>}
    {current && <div className="rounded-xl border border-border p-3 text-sm"><h4 className="font-semibold">Stage history from Arive</h4><ol className="mt-2 max-h-56 divide-y divide-border overflow-y-auto">{current.history.map((entry, index) => <li key={`${entry.stage}-${entry.date}-${index}`} className="flex flex-wrap justify-between gap-x-4 gap-y-1 py-2"><span>{labels[entry.stage as keyof typeof labels] || entry.stage.replaceAll('_', ' ')}</span><time dateTime={entry.date} className="text-xs text-muted-foreground">{entry.date}</time></li>)}</ol></div>}
    {current?.canChange && <div className="flex flex-wrap items-end gap-3"><label className="min-w-56 flex-1 text-sm font-medium">Test stage<select className="app-input mt-1" value={target} disabled={busy || !current.readId} onChange={e => setTarget(e.target.value)}><option value="">Choose a different stage</option>{ARIVE_TEST_STAGES.filter(stage => stage !== current.stage).map(stage => <option key={stage} value={stage}>{labels[stage]}</option>)}</select></label><button type="button" className="app-btn-primary" disabled={busy || !current.readId || !target} onClick={() => void perform(true)}>{busy && <Loader2 size={16} className="animate-spin" />}Change test stage in Arive</button></div>}
    {current && !current.canChange && <p className="text-sm text-muted-foreground">Stage changes are unavailable for archived files or files beyond the permitted early test stages.</p>}
    <p className="text-xs text-muted-foreground">This changes the test loan in Arive. Moving backwards can remove later milestone entries in Arive. Submitted changes include existing stage dates; readback checks whether Arive retained them. A newly visited stage uses today’s UTC date. Read again before each change. Portal pipeline stages are not updated by this test.</p>
    {verified && <p role="status" className="flex items-center gap-2 text-sm text-emerald-700"><CheckCircle2 size={16} />Stage confirmed in Arive and existing history verified.</p>}
    {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
  </section>;
}
