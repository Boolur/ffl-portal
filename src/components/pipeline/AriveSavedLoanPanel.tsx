'use client';

import React, { useEffect, useRef, useState } from 'react';
import { Activity, MessageSquareText, RefreshCw } from 'lucide-react';
import { getProcessingAriveSnapshot } from '@/app/actions/processingPipelineActions';
import { createArivePanelRefresh, type ArivePanelRefresh } from '@/lib/arivePanelRefresh';
import { formatAriveTrackerDate } from '@/lib/ariveTrackers';
import type { SavedAriveNote } from '@/lib/ariveSavedNotes';
import { AriveNotesTimeline, type AriveTimelineNote } from './AriveNotesTimeline';

type Snapshot = Extract<Awaited<ReturnType<typeof getProcessingAriveSnapshot>>, { success: true }>;

export function ariveTimelineNotes(notes: readonly SavedAriveNote[]): AriveTimelineNote[] {
  return notes.map(note => ({ id: note.id, text: note.text, author: note.author,
    createdAt: note.createdAt ?? '', updatedAt: note.updatedAt ?? '', replies: ariveTimelineNotes(note.replies) }));
}

/** Reads only BISU's authorized saved snapshot, never a separate provider request. */
export function AriveSavedLoanPanel({ pipelineLoanId, successfulSyncAt, section }: {
  pipelineLoanId: string;
  successfulSyncAt?: string | null;
  section: 'notes' | 'trackers';
}) {
  const [loaded, setLoaded] = useState<{ pipelineLoanId: string; snapshot: Snapshot } | null>(null);
  const [failure, setFailure] = useState<{ pipelineLoanId: string; message: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const reader = useRef<ArivePanelRefresh | null>(null);
  const observed = useRef({ pipelineLoanId, successfulSyncAt });
  const snapshot = loaded?.pipelineLoanId === pipelineLoanId ? loaded.snapshot : null;
  const error = failure?.pipelineLoanId === pipelineLoanId ? failure.message : '';

  useEffect(() => {
    const current = createArivePanelRefresh({
      load: async () => {
        const result = await getProcessingAriveSnapshot(pipelineLoanId);
        return result;
      },
      apply: result => {
        if (!result.success) {
          // Revoked visibility must also clear a previously rendered saved result.
          setLoaded(null);
          setFailure({ pipelineLoanId, message: result.error });
          return;
        }
        setLoaded({ pipelineLoanId, snapshot: result });
        setFailure(null);
      },
      error: () => setFailure({ pipelineLoanId, message: 'Unable to reload the saved Arive information. Please try again.' }),
      busy: setBusy,
    });
    reader.current = current;
    void current.refresh().catch(() => {});
    return () => { current.dispose(); if (reader.current === current) reader.current = null; };
  }, [pipelineLoanId]);

  useEffect(() => {
    const prior = observed.current;
    observed.current = { pipelineLoanId, successfulSyncAt };
    if (prior.pipelineLoanId === pipelineLoanId && prior.successfulSyncAt !== successfulSyncAt) {
      void reader.current?.refresh(true).catch(() => {});
    }
  }, [pipelineLoanId, successfulSyncAt]);

  const notes = section === 'notes';
  return <section className="app-surface-card space-y-4" aria-label={notes ? 'Arive notes history' : 'Saved Arive service trackers'}>
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div><h3 className="flex items-center gap-2 font-bold text-slate-900">{notes ? <MessageSquareText size={18} className="text-violet-600" aria-hidden="true" /> : <Activity size={18} className="text-blue-600" aria-hidden="true" />}{notes ? 'Arive notes history' : 'All Arive service trackers'}</h3><p className="mt-1 text-xs text-slate-500">{notes ? 'Notes and replies from the latest successful import.' : 'Current statuses from the latest successful import.'}</p></div>
      <button type="button" className="app-btn-secondary" disabled={busy} onClick={() => { void reader.current?.refresh().catch(() => {}); }}><RefreshCw size={14} className={busy ? 'animate-spin' : ''} aria-hidden="true" />{busy ? 'Loading saved data…' : notes ? 'Reload saved history' : 'Reload saved trackers'}</button>
    </div>
    {error && <p role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-800">{error}{snapshot ? ' The last loaded information is still shown.' : ''}</p>}
    {!snapshot && !error && <p role="status" className="text-sm text-slate-500">Loading imported Arive information…</p>}
    {snapshot && (notes ? <AriveNotesTimeline notes={ariveTimelineNotes(snapshot.notes)} syncedAt={snapshot.notesSyncedAt} /> : <>
      <p className="text-xs text-slate-500">{snapshot.sync?.lastSuccessAt ? `Imported ${new Date(snapshot.sync.lastSuccessAt).toLocaleString()}` : 'No successful import yet'}. Use Sync from Arive above to request newer information.</p>
      <div className="grid items-stretch gap-3 sm:grid-cols-2 xl:grid-cols-3">{snapshot.trackers.map((tracker, index) => <article key={`${tracker.name}-${index}`} className="rounded-xl border border-slate-200 bg-slate-50 p-3"><h4 className="text-xs font-bold text-slate-500">{tracker.label}</h4><p className="mt-1 text-sm font-semibold text-slate-900">{tracker.statusLabel || 'Not supplied by Arive'}</p><p className="mt-2 text-xs text-slate-500">{tracker.date ? formatAriveTrackerDate(tracker.date) : 'Status date not supplied by Arive'}</p></article>)}</div>
      {!snapshot.trackers.length && <p className="text-sm text-slate-500">No service trackers were included in the latest import.</p>}
    </>)}
  </section>;
}
