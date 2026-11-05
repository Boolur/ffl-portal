'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Activity, RefreshCw } from 'lucide-react';
import { getPilotAriveTrackers } from '@/app/actions/submissionPilotActions';
import { formatAriveTrackerDate } from '@/lib/ariveTrackers';

type Snapshot = Extract<Awaited<ReturnType<typeof getPilotAriveTrackers>>, { success: true }>['data'];
export function AriveTrackerPanel({ taskId }: { taskId: string }) {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const running = useRef(false);
  const generation = useRef(0);
  const refresh = useCallback(async () => {
    if (running.current) return;
    running.current = true; setBusy(true);
    const current = generation.current;
    try {
      const result = await getPilotAriveTrackers(taskId);
      if (current !== generation.current) return;
      if (!result.success) throw new Error(result.error);
      setSnapshot(result.data); setError('');
    } catch (e) { if (current === generation.current) setError(e instanceof Error ? e.message : 'Unable to refresh Arive trackers.'); }
    finally { if (current === generation.current) { running.current = false; setBusy(false); } }
  }, [taskId]);
  useEffect(() => {
    const effectGeneration = ++generation.current; setSnapshot(null); setError('');
    void refresh();
    const timer = window.setInterval(() => { if (!document.hidden) void refresh(); }, 60000);
    return () => { generation.current = effectGeneration + 1; running.current = false; window.clearInterval(timer); };
  }, [refresh]);
  return <section className="app-surface-card space-y-4">
    <div className="flex flex-wrap items-center justify-between gap-3"><h3 className="flex items-center gap-2 font-bold"><Activity size={18} className="text-blue-600" />Arive service trackers</h3><button type="button" className="app-btn-secondary" disabled={busy} onClick={() => void refresh()}><RefreshCw size={15} className={busy ? 'animate-spin' : ''} />{busy ? 'Refreshing…' : 'Refresh trackers'}</button></div>
    <p className="text-sm text-muted-foreground">Actual Arive progress for this test file. Refreshes every minute while visible. Portal assignments, financial approvals, and SLA rules are unchanged.</p>
    {error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}{snapshot ? ' Showing the last successful refresh.' : ''}</p>}
    {snapshot && <><p className="text-xs text-muted-foreground">Last successful refresh: {new Date(snapshot.checkedAt).toLocaleString()}</p><div className="grid items-stretch gap-3 sm:grid-cols-2 xl:grid-cols-3">{snapshot.trackers.map((tracker, index) => <article key={`${tracker.name}-${index}`} className="rounded-xl border border-slate-200 bg-slate-50 p-3"><h4 className="text-xs font-bold text-slate-500">{tracker.label}</h4><p className="mt-1 text-sm font-semibold text-slate-900">{tracker.statusLabel}</p><p className="mt-2 text-xs text-slate-500">{tracker.date ? formatAriveTrackerDate(tracker.date) : 'Status date not supplied by Arive'}</p></article>)}</div>{!snapshot.trackers.length && <p className="text-sm">Arive returned no service trackers.</p>}</>}
  </section>;
}
