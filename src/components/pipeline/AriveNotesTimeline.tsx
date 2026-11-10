'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Clock3, MessageSquareText, RefreshCw, Reply, Search } from 'lucide-react';
import { getAriveTestWorkspace } from '@/app/actions/submissionPilotActions';
import { ariveNotePlainText } from '../../lib/ariveNoteText';
import { createArivePanelRefresh, type ArivePanelRefresh } from '../../lib/arivePanelRefresh';

export type AriveTimelineNote = {
  id: string; text: string; author: string; createdAt: string; updatedAt: string;
  replies?: readonly AriveTimelineNote[];
};
type TimelineEntry = {
  key: string; note: AriveTimelineNote; text: string; postedAt: number | null;
  parent: { author: string; text: string } | null;
};
const PAGE_SIZE = 50;

function timestamp(value: string) {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}
function displayDate(value: string) {
  const parsed = timestamp(value);
  return parsed === null ? 'Date not supplied' : new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Los_Angeles', month: 'short', day: 'numeric', year: 'numeric',
    hour: 'numeric', minute: '2-digit', timeZoneName: 'short',
  }).format(parsed);
}

/** Every imported entry, without changing the saved note text or source order. */
export function buildAriveNotesTimeline(notes: readonly AriveTimelineNote[]): TimelineEntry[] {
  const entries: TimelineEntry[] = [];
  function add(note: AriveTimelineNote, parent: AriveTimelineNote | null, path: string) {
    const key = `${path}/${encodeURIComponent(note.id)}`;
    entries.push({ key, note, text: ariveNotePlainText(note.text), postedAt: timestamp(note.createdAt) ?? timestamp(note.updatedAt),
      parent: parent ? { author: parent.author, text: ariveNotePlainText(parent.text) } : null });
    for (const reply of note.replies ?? []) add(reply, note, key);
  }
  for (const note of notes) add(note, null, 'note');
  return entries.sort((a, b) => {
    if (a.postedAt !== b.postedAt) return a.postedAt === null ? 1 : b.postedAt === null ? -1 : b.postedAt - a.postedAt;
    return a.key === b.key ? 0 : a.key < b.key ? 1 : -1;
  });
}

export function filterAriveNotesTimeline(entries: readonly TimelineEntry[], query: string) {
  const search = query.trim().toLocaleLowerCase('en-US');
  return search ? entries.filter(entry => `${entry.note.author}\n${entry.text}\n${entry.parent?.author ?? ''}\n${entry.parent?.text ?? ''}`.toLocaleLowerCase('en-US').includes(search)) : entries;
}

export function AriveNotesTimeline({ notes, syncedAt }: { notes: readonly AriveTimelineNote[]; syncedAt?: string | null }) {
  const [query, setQuery] = useState('');
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const entries = useMemo(() => buildAriveNotesTimeline(notes), [notes]);
  const filtered = useMemo(() => filterAriveNotesTimeline(entries, query), [entries, query]);
  const noteCount = entries.filter(entry => !entry.parent).length;
  const replyCount = entries.length - noteCount;
  return <div className="space-y-4">
    <div className="rounded-xl border border-blue-100 bg-blue-50/60 px-4 py-3 text-xs leading-relaxed text-blue-900">
      Current processor fields use the latest matching note. This history includes earlier imported notes and replies as well.
    </div>
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="space-y-1"><p className="text-xs font-semibold text-slate-600">{noteCount} {noteCount === 1 ? 'note' : 'notes'} · {replyCount} {replyCount === 1 ? 'reply' : 'replies'} · Newest entries first</p><p className="flex items-center gap-1.5 text-[11px] text-slate-500"><Clock3 size={12} aria-hidden="true" />{syncedAt ? `History imported ${displayDate(syncedAt)}` : 'No successful note import yet'}</p></div>
      <label className="relative block w-full sm:max-w-xs"><span className="sr-only">Search Arive notes by author or text</span><Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" aria-hidden="true" /><input type="search" value={query} onChange={event => { setQuery(event.target.value); setVisibleCount(PAGE_SIZE); }} placeholder="Search notes or author…" className="app-input !pl-9" /></label>
    </div>
    {!entries.length ? <p className="rounded-xl border border-dashed border-slate-200 bg-slate-50 p-6 text-center text-sm text-slate-500">{syncedAt ? 'No Arive notes were returned in the latest successful import.' : 'Use Sync now to import the Arive notes for this file.'}</p> : !filtered.length ? <p role="status" className="rounded-xl border border-dashed border-slate-200 p-6 text-center text-sm text-slate-500">No notes match this search.</p> : <>
      <ol className="space-y-3" aria-label="Arive notes, newest first">{filtered.slice(0, visibleCount).map(entry => {
        const created = timestamp(entry.note.createdAt);
        const updated = timestamp(entry.note.updatedAt);
        return <li key={entry.key}><article className="min-w-0 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-2"><div className="flex min-w-0 items-center gap-2"><span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${entry.parent ? 'bg-slate-100 text-slate-600' : 'bg-violet-50 text-violet-600'}`}>{entry.parent ? <Reply size={16} aria-hidden="true" /> : <MessageSquareText size={16} aria-hidden="true" />}</span><div className="min-w-0"><p className="break-words text-sm font-bold text-slate-900">{entry.note.author || 'Arive user'}</p><p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">{entry.parent ? 'Reply' : 'Arive note'}</p></div></div><div className="text-right text-[11px] text-slate-500"><p>{displayDate(created !== null ? entry.note.createdAt : entry.note.updatedAt)}</p>{created !== null && updated !== null && updated !== created && <p className="mt-0.5">Edited {displayDate(entry.note.updatedAt)}</p>}</div></div>
          {entry.parent && <details className="mt-3 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600"><summary className="cursor-pointer font-medium">Reply to {entry.parent.author || 'Arive user'}</summary><p className="mt-2 whitespace-pre-wrap break-words leading-relaxed">{entry.parent.text || 'No note text supplied.'}</p></details>}
          <p className="mt-3 whitespace-pre-wrap break-words text-sm leading-relaxed text-slate-700">{entry.text || 'No note text supplied.'}</p>
        </article></li>;
      })}</ol>
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500"><p role="status">Showing {Math.min(visibleCount, filtered.length)} of {filtered.length} {query.trim() ? 'matching ' : ''}entries</p>{visibleCount < filtered.length && <button type="button" className="app-btn-secondary" onClick={() => setVisibleCount(count => count + PAGE_SIZE)}>Show {Math.min(PAGE_SIZE, filtered.length - visibleCount)} more</button>}</div>
    </>}
    <p className="text-[11px] leading-relaxed text-slate-400">This is the latest successfully imported Arive history. Deleted notes and previous versions of edited notes are not included. Edit notes in Arive, then sync this file.</p>
  </div>;
}

type SavedNotes = { requestTaskId: string; notes: readonly AriveTimelineNote[]; syncedAt: string | null; linked: boolean };
export function AriveNotesPanel({ requestTaskId, successfulSyncAt = null }: { requestTaskId: string; successfulSyncAt?: string | null }) {
  const [loaded, setLoaded] = useState<SavedNotes | null>(null);
  const [failure, setFailure] = useState<{ requestTaskId: string; message: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const reader = useRef<ArivePanelRefresh | null>(null);
  const observed = useRef({ requestTaskId, successfulSyncAt });
  const data = loaded?.requestTaskId === requestTaskId ? loaded : null;
  const error = failure?.requestTaskId === requestTaskId ? failure.message : '';
  useEffect(() => {
    const current = createArivePanelRefresh({
      load: async (): Promise<SavedNotes> => {
        const result = await getAriveTestWorkspace(requestTaskId);
        if (!result.success) throw new Error(result.error);
        const pkg = result.data.packages[0]?.package;
        if (!pkg) throw new Error('The Arive notes package is unavailable for this file.');
        return { requestTaskId, notes: pkg.ariveNotes?.notes ?? [], syncedAt: pkg.ariveNotes?.syncedAt ?? null, linked: Boolean(pkg.ariveLink) };
      },
      apply: value => { setLoaded(value); setFailure(null); },
      error: cause => setFailure({ requestTaskId, message: cause instanceof Error ? cause.message : 'Unable to load Arive notes.' }),
      busy: setBusy,
    });
    reader.current = current;
    void current.refresh().catch(() => {});
    return () => { current.dispose(); if (reader.current === current) reader.current = null; };
  }, [requestTaskId]);
  useEffect(() => {
    const prior = observed.current;
    observed.current = { requestTaskId, successfulSyncAt };
    if (prior.requestTaskId === requestTaskId && prior.successfulSyncAt !== successfulSyncAt) void reader.current?.refresh(true).catch(() => {});
  }, [requestTaskId, successfulSyncAt]);
  return <section className="app-surface-card space-y-4" aria-label="Arive notes history">
    <div className="flex flex-wrap items-start justify-between gap-3"><div><h3 className="flex items-center gap-2 font-bold text-slate-900"><MessageSquareText size={18} className="text-violet-600" aria-hidden="true" />Arive notes history</h3><p className="mt-1 text-xs text-slate-500">Notes and replies from the latest successful import.</p></div><button type="button" className="app-btn-secondary" disabled={busy} onClick={() => { void reader.current?.refresh().catch(() => {}); }}><RefreshCw size={14} className={busy ? 'animate-spin' : ''} aria-hidden="true" />{busy ? 'Loading history…' : 'Reload saved history'}</button></div>
    {error && <p role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-800">{error}{data ? ' The last loaded history is still shown.' : ''}</p>}
    {!data && !error && <p role="status" className="text-sm text-slate-500">Loading imported notes…</p>}
    {data && !data.linked && <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">This submission is not linked to Arive yet. Link the test file before importing notes.</p>}
    {data && <AriveNotesTimeline notes={data.notes} syncedAt={data.syncedAt} />}
  </section>;
}
