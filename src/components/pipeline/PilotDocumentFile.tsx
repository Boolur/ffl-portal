'use client';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Loader2, FileText, FileImage, Download } from 'lucide-react';
import type { downloadPilotFile } from '@/app/actions/submissionPilotActions';
import { populateDocumentDrag } from '../../lib/documentDelivery';
import type { PilotFile } from '@/lib/submissionPilot';

export function PilotDocumentFile({ taskId, file }: { taskId: string; file: PilotFile }) {
  const FileIcon = file.type.startsWith('image/') ? FileImage : FileText;
  const fileLabel = file.name.split('.').pop()?.toUpperCase() || 'FILE';
  const [ready, setReady] = useState<{ url: string; expires: number } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [dragNotice, setDragNotice] = useState('');
  const pending = useRef(false);
  const active = useRef(true);
  const readyUntil = useRef(0);
  const prepare = useCallback(async (renew = false) => {
    if (pending.current || (!renew && readyUntil.current > Date.now())) return;
    pending.current = true; setLoading(true); setError('');
    try {
      const startedAt = Date.now();
      const linkResponse = await fetch(`/api/processing-submission/${encodeURIComponent(taskId)}/files/${encodeURIComponent(file.id)}?prepare=1`, { cache: 'no-store', signal: AbortSignal.timeout(20000) });
      if (!linkResponse.ok && linkResponse.status !== 403) throw new Error('Unable to prepare attachment. Please try again.');
      const result: Awaited<ReturnType<typeof downloadPilotFile>> = await linkResponse.json();
      if (!active.current) return;
      if (!result.success) throw new Error(result.error);
      if (active.current) {
        readyUntil.current = startedAt + 240000;
        setReady({ url: result.data, expires: readyUntil.current });
        setDragNotice('');
      }
    } catch (e) {
      if (active.current) { readyUntil.current = 0; setReady(null); setDragNotice(''); setError(e instanceof Error ? e.message : 'Unable to prepare file.'); }
    } finally { pending.current = false; if (active.current) setLoading(false); }
  }, [taskId, file.id]);
  useEffect(() => {
    active.current = true;
    // Start automatically after mounting; no hover or click is required.
    const timer = window.setTimeout(() => void prepare(), 0);
    return () => { active.current = false; window.clearTimeout(timer); };
  }, [prepare]);
  useEffect(() => {
    if (!ready) return;
    const timer = window.setTimeout(() => void prepare(true), Math.max(0, ready.expires - Date.now() - 15000));
    return () => window.clearTimeout(timer);
  }, [ready, prepare]);
  const dragReady = !!ready && ready.expires > Date.now();
  return <div className="w-full min-w-0 select-none">
    <div className="flex min-w-0 items-center gap-1">
    <button type="button" data-file-tile="true" onClick={() => window.open(`/api/processing-submission/${encodeURIComponent(taskId)}/files/${encodeURIComponent(file.id)}`, '_blank', 'noopener,noreferrer')} title={`Open ${file.name}. ${dragReady ? 'Drag to supported desktop folders.' : 'Attachment is preparing for folder dragging.'} For Arive or Outlook, download the file first.`} className={`group flex min-w-0 flex-1 ${dragReady ? 'cursor-grab active:cursor-grabbing' : 'cursor-progress'} items-center gap-3 rounded-lg p-2 text-left transition hover:bg-violet-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-500`} onMouseEnter={() => void prepare()} onFocus={() => void prepare()} draggable={true} onDragStart={e => {
      e.stopPropagation();
      if (!ready || ready.expires <= Date.now()) { e.preventDefault(); void prepare(); setDragNotice('Preparing attachment. Please try dragging again in a moment.'); return; }
      try { populateDocumentDrag(e.dataTransfer, file, ready.url); setError(''); setDragNotice(''); }
      catch (cause) { e.preventDefault(); setDragNotice(''); setError(cause instanceof Error ? cause.message : 'Unable to drag this attachment. Use the download icon, then attach the saved file.'); }
    }} onDragEnd={e => e.stopPropagation()} aria-label={`Open ${file.name} in a new tab, or drag to supported desktop folders. For Arive or Outlook, download the file first.`}>
      <span className="relative flex h-16 w-16 shrink-0 items-center justify-center rounded-xl border border-violet-200 bg-violet-50 text-violet-700 shadow-sm"><FileIcon size={28} strokeWidth={1.6} aria-hidden="true" />{loading && <Loader2 size={12} className="absolute right-1 top-1 animate-spin" aria-label="Preparing attachment" />}<span className="absolute bottom-0.5 rounded bg-white px-1 text-[9px] font-bold tracking-wide">{fileLabel}</span></span>
      <span className="min-w-0 flex-1"><span className="line-clamp-3 break-words text-xs font-semibold leading-4 text-slate-800">{file.name}</span><span className="mt-1 block text-[11px] text-muted-foreground">{file.size < 1024 * 1024 ? `${Math.max(1, Math.round(file.size / 1024))} KB` : `${(file.size / 1024 / 1024).toFixed(1)} MB`}</span></span>
    </button>
    <a href={`/api/processing-submission/${encodeURIComponent(taskId)}/files/${encodeURIComponent(file.id)}?download=1`} download={file.name} draggable={false} aria-label={`Download ${file.name}`} title={`Download ${file.name}`} className="mr-2 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-500 transition hover:border-violet-300 hover:bg-violet-50 hover:text-violet-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-500"><Download size={17} aria-hidden="true" /></a>
    </div>
    {dragNotice && <p className="mt-2 text-xs text-muted-foreground" role="status">{dragNotice}</p>}
    {error && <p className="mt-2 text-xs text-rose-700" role="status">{error}</p>}
  </div>;
}
