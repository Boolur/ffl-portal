'use client';
import { useEffect, useRef, useState } from 'react';
import { Download, GripVertical, Loader2 } from 'lucide-react';
import { downloadPilotFile } from '@/app/actions/submissionPilotActions';
import type { PilotFile } from '@/lib/submissionPilot';

export function PilotDocumentFile({ taskId, file }: { taskId: string; file: PilotFile }) {
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
    <div className="flex flex-wrap items-center gap-2">
      <button type="button" className="app-btn-secondary max-w-full cursor-grab active:cursor-grabbing" onMouseEnter={() => void prepare()} onFocus={() => void prepare()} onClick={() => void prepare()} draggable={!!ready} onDragStart={e => {
        if (!ready || ready.expires <= Date.now()) { e.preventDefault(); void prepare(); return; }
        e.dataTransfer.effectAllowed = 'copy';
        e.dataTransfer.setData('DownloadURL', `${file.type}:${file.name.replace(/[:\r\n]/g, '_')}:${ready.url}`);
        try { e.dataTransfer.items.add(ready.file); } catch { /* DownloadURL remains available for desktop drops. */ }
      }} aria-label={`Prepare or drag ${file.name}`}>
        {loading ? <Loader2 size={16} className="shrink-0 animate-spin" /> : <GripVertical size={16} className="shrink-0" />}<span className="truncate">{file.name}</span>
      </button>
      <button type="button" className="app-btn-secondary" aria-label={`Download ${file.name}`} onClick={() => { void downloadPilotFile(taskId, file.id).then(r => { if (r.success) window.location.assign(r.data); else setError(r.error); }).catch(() => setError('Download failed. Please retry.')); }}><Download size={15} />Download</button>
    </div>
    <p className="text-xs text-muted-foreground" role="status">{error || (loading ? 'Preparing file for dragging…' : ready ? 'Ready to drag · folder or supported upload area' : 'Hover or click the filename to prepare dragging.')}</p>
  </div>;
}
