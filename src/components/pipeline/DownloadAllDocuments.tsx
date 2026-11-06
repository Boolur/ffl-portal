'use client';

import React, { useEffect, useRef, useState } from 'react';
import { Download, Loader2 } from 'lucide-react';
import { preparePilotDocumentDownload, validatePilotDocumentDownload } from '@/app/actions/submissionPilotActions';
import { buildDocumentArchive, DocumentArchiveError } from '../../lib/documentArchive';

type Props = {
  taskId: string;
  revision: number;
  approvedFileCount: number;
  selectionSignature: string;
  disabled?: boolean;
};

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url; anchor.download = filename; anchor.hidden = true;
  document.body.appendChild(anchor);
  try { anchor.click(); }
  finally { anchor.remove(); window.setTimeout(() => URL.revokeObjectURL(url), 60000); }
}

export function DownloadAllDocuments({ taskId, revision, approvedFileCount, selectionSignature, disabled = false }: Props) {
  // Background notes/transfer updates may increment the package revision without
  // changing this selection. Only a different package or document set cancels it.
  const scope = JSON.stringify([taskId, selectionSignature]);
  const flight = useRef<{ controller: AbortController; scope: string } | null>(null);
  const [status, setStatus] = useState({ scope, busy: false, label: '', error: '' });
  const visible = status.scope === scope ? status : { busy: false, label: '', error: '' };

  useEffect(() => () => {
    if (flight.current?.scope === scope) {
      flight.current.controller.abort();
      flight.current = null;
    }
  }, [scope]);

  async function downloadAll() {
    if (disabled || approvedFileCount < 1 || flight.current) return;
    const operation = { scope, controller: new AbortController() };
    flight.current = operation;
    const active = () => flight.current === operation && !operation.controller.signal.aborted;
    setStatus({ scope, busy: true, label: 'Preparing documents…', error: '' });
    try {
      const prepared = await preparePilotDocumentDownload(taskId, revision);
      if (!active()) return;
      if (!prepared.success) throw new DocumentArchiveError(prepared.error);
      const archive = await buildDocumentArchive(prepared.data, {
        signal: operation.controller.signal,
        onProgress: ({ current, total }) => {
          if (active()) setStatus({ scope, busy: true, label: `Preparing ${current} of ${total}`, error: '' });
        },
        validateSelection: async () => {
          if (!active()) return false;
          setStatus({ scope, busy: true, label: 'Verifying documents…', error: '' });
          const validated = await validatePilotDocumentDownload(taskId, prepared.data.selectionKey);
          if (!validated.success) throw new DocumentArchiveError(validated.error);
          return active();
        },
      });
      if (active()) downloadBlob(archive, prepared.data.filename);
    } catch (error) {
      if (active()) setStatus({ scope, busy: false, label: '', error: error instanceof DocumentArchiveError ? error.message : 'Unable to download documents. Please try again.' });
    } finally {
      if (active()) {
        flight.current = null;
        setStatus(previous => previous.scope === scope ? { ...previous, busy: false, label: '' } : previous);
      }
    }
  }

  return <div className="flex min-w-0 flex-col items-end gap-1">
    <button type="button" className="app-btn-secondary" disabled={disabled || visible.busy || approvedFileCount < 1} onClick={() => void downloadAll()} aria-busy={visible.busy} title="Download approved documents together as a ZIP file">
      {visible.busy ? <Loader2 size={15} className="animate-spin" aria-hidden="true" /> : <Download size={15} aria-hidden="true" />}
      <span aria-live="polite">{visible.busy ? visible.label : 'Download All'}</span>
    </button>
    <span className="text-[11px] text-muted-foreground">{approvedFileCount} approved {approvedFileCount === 1 ? 'file' : 'files'} · ZIP</span>
    {visible.error && <p role="alert" className="max-w-sm text-right text-xs text-rose-700">{visible.error}</p>}
  </div>;
}
