'use client';
import React, { useRef, useState } from 'react';
import { UploadCloud, Loader2 } from 'lucide-react';

export function SubmissionUploadDropzone({ label, disabled, progress, remaining, onFiles }: {
  label: string; disabled: boolean; progress?: string; remaining: number; onFiles: (files: File[]) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const locked = disabled || remaining <= 0;
  return <div>
    <input ref={input} type="file" multiple accept=".pdf,.jpg,.jpeg,.png" className="sr-only" tabIndex={-1} aria-label={`Choose files for ${label}`} disabled={locked} onChange={event => { const files = Array.from(event.target.files || []); event.target.value = ''; if (files.length && !locked) onFiles(files); }} />
    <button type="button" disabled={locked} aria-label={`Upload ${label}: drag documents here or click to browse`} aria-busy={!!progress}
      onClick={() => input.current?.click()}
      onDragEnter={event => { event.preventDefault(); if (!locked) setDragging(true); }}
      onDragOver={event => { event.preventDefault(); event.dataTransfer.dropEffect = locked ? 'none' : 'copy'; }}
      onDragLeave={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false); }}
      onDrop={event => { event.preventDefault(); event.stopPropagation(); setDragging(false); if (!locked) onFiles(Array.from(event.dataTransfer.files)); }}
      className={`flex min-h-36 w-full flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed px-4 py-4 text-center transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60 ${dragging && !locked ? 'border-violet-500 bg-violet-100' : 'border-violet-300 bg-white hover:border-violet-500 hover:bg-violet-50'}`}>
      <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-violet-100 text-violet-700">{progress ? <Loader2 size={22} className="animate-spin" aria-hidden="true" /> : <UploadCloud size={24} aria-hidden="true" />}</span>
      <span className="text-sm font-semibold text-slate-900">{progress || (remaining <= 0 ? '10-file limit reached' : dragging ? 'Drop documents to upload' : 'Drag documents here')}</span>
      {!progress && remaining > 0 && <span className="text-xs font-semibold text-violet-700 underline underline-offset-2">or click to browse</span>}
      <span className="text-[11px] text-slate-500">PDF, JPG or PNG · up to 20 MB each · {Math.max(0, remaining)} file slots available</span>
    </button>
  </div>;
}
