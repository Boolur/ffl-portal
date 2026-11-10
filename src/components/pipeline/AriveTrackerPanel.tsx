'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Activity, RefreshCw } from 'lucide-react';
import { getAriveTestWorkspace, getPilotAriveTrackers } from '@/app/actions/submissionPilotActions';
import { formatAriveTrackerDate } from '@/lib/ariveTrackers';
import { createArivePanelRefresh, type ArivePanelRefresh } from '../../lib/arivePanelRefresh';

type Snapshot = Extract<Awaited<ReturnType<typeof getPilotAriveTrackers>>, { success: true }>['data'];

export async function resolveAriveTrackerPackageTask(requestTaskId: string): Promise<string> {
  const result = await getAriveTestWorkspace(requestTaskId);
  if (!result.success) throw new Error(result.error);
  const packageTaskId = result.data.packages?.[0]?.id;
  if (typeof packageTaskId !== 'string' || !packageTaskId.trim()) throw new Error('The Arive document package is unavailable for this processing request.');
  return packageTaskId;
}

export function AriveRequestTrackersPanel({ requestTaskId, refreshSignal = null }: { requestTaskId: string; refreshSignal?: string | null }) {
  const [resolved, setResolved] = useState<{ requestTaskId: string; packageTaskId: string } | null>(null);
  const [failure, setFailure] = useState<{ requestTaskId: string; message: string } | null>(null);
  const packageTaskId = resolved?.requestTaskId === requestTaskId ? resolved.packageTaskId : null;
  const error = failure?.requestTaskId === requestTaskId ? failure.message : '';
  useEffect(() => {
    let active = true;
    void resolveAriveTrackerPackageTask(requestTaskId).then(id => {
      if (active) { setResolved({ requestTaskId, packageTaskId: id }); setFailure(null); }
    }).catch(cause => {
      if (active) setFailure({ requestTaskId, message: cause instanceof Error ? cause.message : 'Unable to load Arive trackers for this request.' });
    });
    return () => { active = false; };
  }, [requestTaskId]);
  if (packageTaskId) return <AriveTrackerPanel taskId={packageTaskId} refreshSignal={refreshSignal} />;
  return <section className="app-surface-card text-sm">{error ? <p role="alert" className="text-red-700">{error}</p> : <p role="status" className="text-slate-500">Loading Arive service trackers…</p>}</section>;
}

export function AriveTrackerPanel({ taskId, refreshSignal = null }: { taskId: string; refreshSignal?: string | null }) {
  const [loaded, setLoaded] = useState<{ taskId: string; snapshot: Snapshot } | null>(null);
  const [failure, setFailure] = useState<{ taskId: string; message: string } | null>(null);
  const snapshot = loaded?.taskId === taskId ? loaded.snapshot : null;
  const error = failure?.taskId === taskId ? failure.message : '';
  const [busy, setBusy] = useState(false);
  const reader = useRef<ArivePanelRefresh | null>(null);
  const observedRefresh = useRef({ taskId, refreshSignal });
  const refresh = useCallback(() => { void reader.current?.refresh().catch(() => {}); }, []);
  useEffect(() => {
    const current = createArivePanelRefresh({
      load: async () => {
        const result = await getPilotAriveTrackers(taskId);
        if (!result.success) throw new Error(result.error);
        return result.data;
      },
      apply: value => { setLoaded({ taskId, snapshot: value }); setFailure(null); },
      error: cause => setFailure({ taskId, message: cause instanceof Error ? cause.message : 'Unable to refresh Arive trackers.' }),
      busy: setBusy,
    });
    reader.current = current;
    void current.refresh().catch(() => {});
    const timer = window.setInterval(() => { if (!document.hidden) void current.refresh().catch(() => {}); }, 60000);
    return () => { current.dispose(); if (reader.current === current) reader.current = null; window.clearInterval(timer); };
  }, [taskId]);
  useEffect(() => {
    const prior = observedRefresh.current;
    observedRefresh.current = { taskId, refreshSignal };
    if (prior.taskId === taskId && prior.refreshSignal !== refreshSignal) void reader.current?.refresh(true).catch(() => {});
  }, [taskId, refreshSignal]);
  return <section className="app-surface-card space-y-4">
    <div className="flex flex-wrap items-center justify-between gap-3"><h3 className="flex items-center gap-2 font-bold"><Activity size={18} className="text-blue-600" />Arive service trackers</h3><button type="button" className="app-btn-secondary" disabled={busy} onClick={() => void refresh()}><RefreshCw size={15} className={busy ? 'animate-spin' : ''} />{busy ? 'Refreshing…' : 'Refresh trackers'}</button></div>
    <p className="text-sm text-muted-foreground">Actual Arive progress for this test file. Refreshes every minute while visible. Portal assignments, financial approvals, and SLA rules are unchanged.</p>
    {error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}{snapshot ? ' Showing the last successful refresh.' : ''}</p>}
    {snapshot && <><p className="text-xs text-muted-foreground">Last successful refresh: {new Date(snapshot.checkedAt).toLocaleString()}</p><div className="grid items-stretch gap-3 sm:grid-cols-2 xl:grid-cols-3">{snapshot.trackers.map((tracker, index) => <article key={`${tracker.name}-${index}`} className="rounded-xl border border-slate-200 bg-slate-50 p-3"><h4 className="text-xs font-bold text-slate-500">{tracker.label}</h4><p className="mt-1 text-sm font-semibold text-slate-900">{tracker.statusLabel}</p><p className="mt-2 text-xs text-slate-500">{tracker.date ? formatAriveTrackerDate(tracker.date) : 'Status date not supplied by Arive'}</p></article>)}</div>{!snapshot.trackers.length && <p className="text-sm">Arive returned no service trackers.</p>}</>}
  </section>;
}
