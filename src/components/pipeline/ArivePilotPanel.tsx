'use client';

import { useEffect, useState } from 'react';
import { configurePilotArive, openArivePilotLoan, refreshPilotAriveNotes, getPilotAriveClassifications, sendPilotDocumentToArive } from '@/app/actions/submissionPilotActions';
import type { PilotPackage } from '@/lib/submissionPilot';

export function ArivePilotConnection({ configured, canConfigure, owner, onChanged, onOpen }: { configured: boolean; canConfigure: boolean; owner: boolean; onChanged: () => Promise<void>; onOpen: (id: string) => void }) {
  const [clientId, setClientId] = useState('');
  const [secret, setSecret] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [number, setNumber] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  async function perform(work: () => Promise<void>) {
    setBusy(true); setMessage('');
    try { await work(); await onChanged(); } catch (e) { setMessage(e instanceof Error ? e.message : 'Unable to connect.'); } finally { setBusy(false); }
  }
  return <section className="app-surface-card space-y-4">
    <div><h2 className="font-bold">Arive connection</h2><p className="text-sm text-muted-foreground">{configured ? 'Company credentials saved. Open a loan to import its notes and send approved documents.' : 'An Admin III must connect your company API credentials before uploads or note refreshes can run.'}</p></div>
    {canConfigure && <details><summary className="text-sm font-semibold">{configured ? 'Replace company credentials' : 'Set up company API access'}</summary>
      <form className="mt-4 grid gap-3 md:grid-cols-3" autoComplete="off" onSubmit={e => { e.preventDefault(); void perform(async () => { try { const r = await configurePilotArive({ clientId, secret, apiKey }); if (!r.success) throw new Error(r.error); setMessage('Connection verified and credentials encrypted.'); } finally { setSecret(''); setApiKey(''); setClientId(''); } }); }}>
        <label className="text-sm">Client ID<input className="app-input mt-1" required maxLength={4096} value={clientId} disabled={busy} onChange={e => setClientId(e.target.value)} /></label>
        <label className="text-sm">Client secret<input className="app-input mt-1" type="password" autoComplete="new-password" required maxLength={4096} value={secret} disabled={busy} onChange={e => setSecret(e.target.value)} /></label>
        <label className="text-sm">API key<input className="app-input mt-1" type="password" autoComplete="new-password" required maxLength={4096} value={apiKey} disabled={busy} onChange={e => setApiKey(e.target.value)} /></label>
        <p className="text-xs text-muted-foreground md:col-span-3">Use company-level API credentials. Saved secrets are encrypted and are never displayed again.</p><button className="app-btn-primary" disabled={busy} type="submit">{busy ? 'Connecting…' : 'Test and save connection'}</button>
      </form>
    </details>}
    {owner && configured && <form className="flex flex-wrap items-end gap-3" onSubmit={e => { e.preventDefault(); void perform(async () => { const r = await openArivePilotLoan(number); if (!r.success) throw new Error(r.error); onOpen(r.data); }); }}>
      <label className="text-sm">Arive loan number<input className="app-input mt-1" inputMode="numeric" pattern="[0-9]{1,15}" required value={number} disabled={busy} onChange={e => setNumber(e.target.value.trim())} placeholder="Enter your test loan number" /></label><button type="submit" className="app-btn-primary" disabled={busy}>Open Arive loan</button>
      <p className="w-full text-xs text-muted-foreground">The loan must list Matt’s portal email as its Loan Originator in Arive. New test loans can be opened without moving them into the processing pipeline.</p>
    </form>}
    <p role="status" className="text-sm">{message}</p>
  </section>;
}

export function ArivePackagePanel({ taskId, pkg, configured, parentBusy, onChanged }: { taskId: string; pkg: PilotPackage; configured: boolean; parentBusy: boolean; onChanged: () => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [classes, setClasses] = useState<{ name: string; subName: string }[] | null>(null);
  const [selection, setSelection] = useState<Record<string, string>>({});
  async function perform(work: () => Promise<void>) {
    setBusy(true); setMessage('');
    try { await work(); } catch (e) { setMessage(e instanceof Error ? e.message : 'Unable to finish.'); }
    finally { try { await onChanged(); } catch { setMessage('Unable to refresh the package. Refresh before retrying.'); } setBusy(false); }
  }
  useEffect(() => {
    if (!configured || !pkg.ariveLink || parentBusy || busy) return;
    let active = true;
    let running = false;
    const timer = window.setInterval(async () => {
      if (document.hidden || running) return;
      running = true;
      try {
        const r = await refreshPilotAriveNotes(taskId);
        if (!active) return;
        if (!r.success) setMessage(r.error);
        else { await onChanged(); setMessage(''); }
      } catch { if (active) setMessage('Automatic note refresh failed. Use Refresh notes to retry.'); }
      finally { running = false; }
    }, 60000);
    return () => { active = false; window.clearInterval(timer); };
  }, [configured, pkg.ariveLink, parentBusy, busy, taskId, onChanged]);
  const disabled = busy || parentBusy;
  return <section className="app-surface-card space-y-4">
    <h3 className="font-bold">Arive documents and notes</h3>
    {!pkg.ariveLink ? <p className="text-sm text-muted-foreground">Matt can enter this loan number under Arive connection to link the existing package.</p> : <>
      <p className="text-sm text-muted-foreground">Linked to Arive #{pkg.ariveLink.loanNumber}. Notes refresh every minute while this page is visible. All imports are read-only.</p>
      <button type="button" className="app-btn-secondary" disabled={disabled || !configured} onClick={() => void perform(async () => { const r = await refreshPilotAriveNotes(taskId); if (!r.success) throw new Error(r.error); })}>Refresh notes from Arive</button>
      <p className="text-xs text-muted-foreground">{pkg.ariveNotes ? `Last successful refresh: ${new Date(pkg.ariveNotes.syncedAt).toLocaleString()}` : 'No notes have been imported yet.'}</p>
      {pkg.ariveNotes && !pkg.ariveNotes.notes.length && <p className="text-sm">Arive returned no notes for this loan.</p>}
      <div className="max-h-96 space-y-3 overflow-y-auto">{[...(pkg.ariveNotes?.notes || [])].sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || '')).map(note => <article key={note.id} className="rounded-lg border border-border p-3 text-sm"><p className="font-semibold">{note.author}</p><p className="text-xs text-muted-foreground">{note.createdAt ? new Date(note.createdAt).toLocaleString() : 'Date not supplied'}</p><p className="mt-2 whitespace-pre-wrap break-words">{note.text}</p>{note.replies.map(reply => <div key={reply.id} className="ml-3 mt-2 border-l border-border pl-3"><strong>{reply.author}</strong><p className="whitespace-pre-wrap break-words">{reply.text}</p></div>)}</article>)}</div>
      {pkg.state === 'APPROVED' ? <div className="space-y-3 border-t border-border pt-4"><h4 className="font-semibold">Send approved documents</h4><p className="text-sm text-muted-foreground">Documents are not borrower-visible. Select a classification or let Arive classify the file. Only documents marked Sent have a confirmed Arive attachment.</p>
        {!classes && <button type="button" className="app-btn-secondary" disabled={disabled || !configured} onClick={() => void perform(async () => { const r = await getPilotAriveClassifications(); if (!r.success) throw new Error(r.error); setClasses(r.data); })}>Load Arive classifications</button>}
        {pkg.items.flatMap(i => i.files).map(file => { const transfer = pkg.ariveTransfers?.[file.id]; return <div key={file.id} className="space-y-2 rounded-lg border border-border p-3 text-sm"><p className="break-words font-medium">{file.name}</p><p>{transfer?.state === 'SENT' ? `Sent · Arive document ${transfer.documentId}` : transfer?.state === 'SENDING' ? 'Transfer started — refresh to check. Do not resend until verified in Arive.' : transfer?.state === 'UNKNOWN' ? 'Needs verification in Arive' : transfer?.state === 'FAILED' ? 'Failed — retry available' : 'Not sent'}</p>{transfer?.error && <p className="text-red-700">{transfer.error}</p>}
          {classes && (!transfer || transfer.state === 'FAILED') && <div className="flex flex-wrap gap-2"><label className="flex-1">Classification<select className="app-input mt-1" value={selection[file.id] || ''} disabled={disabled} onChange={e => setSelection(s => ({ ...s, [file.id]: e.target.value }))}><option value="">Automatic classification in Arive</option>{[...new Set(classes.map(c => c.name))].map(name => <option key={name} value={name}>{name}</option>)}</select></label><button type="button" className="app-btn-primary self-end" disabled={disabled || !configured} onClick={() => void perform(async () => { const r = await sendPilotDocumentToArive({ taskId, fileId: file.id, classification: selection[file.id] || '' }); if (!r.success) throw new Error(r.error); })}>Send to Arive</button></div>}
        </div>; })}
      </div> : <p className="text-sm text-muted-foreground">Document transfer becomes available after Jr approval of this package.</p>}
    </>}
    <p role="status" aria-live="polite" className="text-sm text-red-700">{busy ? 'Working…' : message}</p>
  </section>;
}
