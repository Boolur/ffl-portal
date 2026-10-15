'use client';
import { useEffect, useRef, useState } from 'react';
import { Download, GripVertical, Loader2, FileText, FileImage } from 'lucide-react';
import { downloadPilotFile } from '@/app/actions/submissionPilotActions';
import type { PilotFile } from '@/lib/submissionPilot';

export function PilotDocumentFile({ taskId, file }: { taskId: string; file: PilotFile }) {
  const FileIcon = file.type.startsWith('image/') ? FileImage : FileText;
  const fileLabel = file.name.split('.').pop()?.toUpperCase() || 'FILE';
  const [ready, setReady] = useState<{ url: string; file: File; expires: number } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const pending = useRef(false);
  const active = useRef(true);
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  useEffect(() => {
    if (!ready) return;
    const timer = window.setTimeout(() => setReady(null), Math.max(0, ready.expires - Date.now()));
    return () => window.clearTimeout(timer);
  }, [ready]);
  async function prepare() {
    if (pending.current || (ready && ready.expires > Date.now())) return;
    pending.current = true; setLoading(true); setError('');
    try {
      const result = await downloadPilotFile(taskId, file.id);
      if (!result.success) throw new Error(result.error);
      const response = await fetch(result.data, { cache: 'no-store', signal: AbortSignal.timeout(20000) });
      if (!response.ok) throw new Error('Unable to prepare this file. Use Download or try again.');
      const blob = await response.blob();
      if (blob.size !== file.size) throw new Error('The file download was incomplete. Please retry.');
      if (active.current) setReady({ url: result.data, file: new File([blob], file.name, { type: file.type }), expires: Date.now() + 60000 });
    } catch (e) { if (active.current) setError(e instanceof Error ? e.message : 'Unable to prepare file.'); }
    finally { pending.current = false; if (active.current) setLoading(false); }
  }
  return <div className="min-w-0 space-y-1">
    <div className="flex flex-wrap items-end gap-3">
      <button type="button" title={file.name} className="group flex aspect-square w-40 max-w-full cursor-grab flex-col items-center justify-center gap-2 rounded-xl border-2 border-violet-200 bg-white p-3 text-center shadow-sm transition hover:border-violet-400 hover:bg-violet-50 hover:shadow-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-500 active:cursor-grabbing" onMouseEnter={() => void prepare()} onFocus={() => void prepare()} onClick={() => void prepare()} draggable={!!ready} onDragStart={e => {
        if (!ready || ready.expires <= Date.now()) { e.preventDefault(); void prepare(); return; }
        e.dataTransfer.effectAllowed = 'copy';
        e.dataTransfer.setData('DownloadURL', `${file.type}:${file.name.replace(/[:\r\n]/g, '_')}:${ready.url}`);
        try { e.dataTransfer.items.add(ready.file); } catch { /* DownloadURL remains available for desktop drops. */ }
      }} aria-label={`Prepare or drag ${file.name}`}>
        <span className="relative flex h-14 w-14 shrink-0 items-center justify-center rounded-xl bg-violet-100 text-violet-700"><FileIcon size={32} strokeWidth={1.6} aria-hidden="true" /><span className="absolute -bottom-1 rounded border border-violet-200 bg-white px-1.5 text-[10px] font-bold tracking-wide">{fileLabel}</span></span>
        <span className="line-clamp-2 w-full break-all text-xs font-semibold leading-4 text-slate-800">{file.name}</span>
        <span className="flex items-center gap-1 text-[10px] font-medium text-violet-700">{loading ? <Loader2 size={12} className="animate-spin" aria-hidden="true" /> : <GripVertical size={12} aria-hidden="true" />}{loading ? 'Preparing…' : ready ? 'Drag attachment' : 'Prepare to drag'}</span>
      </button>
      <button type="button" className="app-btn-secondary" aria-label={`Download ${file.name}`} onClick={() => { void downloadPilotFile(taskId, file.id).then(r => { if (r.success) window.location.assign(r.data); else setError(r.error); }).catch(() => setError('Download failed. Please retry.')); }}><Download size={15} />Download</button>
    </div>
    <p className="text-xs text-muted-foreground" role="status">{error || (loading ? 'Preparing file for dragging…' : ready ? 'Ready to drag · folder or supported upload area' : 'Hover or click the filename to prepare dragging.')}</p>
  </div>;
}
