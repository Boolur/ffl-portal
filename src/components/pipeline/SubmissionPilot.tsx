'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { FileCheck2, Upload, ArrowLeft, RefreshCw } from 'lucide-react';
import Link from 'next/link';
import { createSubmissionPilot, getSubmissionPilot, changeSubmissionPilot, preparePilotUpload, finishPilotUpload, downloadPilotFile } from '@/app/actions/submissionPilotActions';
import { PILOT_DOCUMENT_TYPES, pilotApprovalError, pilotSubmissionError } from '@/lib/submissionPilot';
import { getProcessingAssignmentLabel, getProcessingMethodLabel } from '@/lib/processingRouting';
import { ArivePilotConnection, ArivePackagePanel } from './ArivePilotPanel';

type Data = Extract<Awaited<ReturnType<typeof getSubmissionPilot>>, { success: true }>['data'];
const labels = { DRAFT: 'Draft — LO uploading', REVIEW: 'Jr review', CHANGES: 'Corrections requested', APPROVED: 'Approved — ready for Arive' };
export function SubmissionPilot({ initialData, initialTask }: { initialData: Data; initialTask?: string }) {
  const router = useRouter();
  const [data, setData] = useState(initialData);
  const [selected, setSelected] = useState(initialTask || initialData.packages[0]?.id || '');
  const [loanId, setLoanId] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [extra, setExtra] = useState('');
  const current = data.packages.find(p => p.id === selected);
  const p = current?.package;
  const editable = data.owner && p && ['DRAFT', 'CHANGES'].includes(p.state);
  const reviewing = !data.owner && p?.state === 'REVIEW' && p.reviewerId === data.userId;
  async function reload() {
    const r = await getSubmissionPilot();
    if (!r.success) throw new Error(r.error);
    setData(r.data);
  }
  async function run(work: () => Promise<void>) {
    setBusy(true); setMessage('');
    try { await work(); await reload(); }
    catch (e) { setMessage(e instanceof Error ? e.message : 'Please retry.'); try { await reload(); } catch { /* Preserve the actionable original error. */ } }
    finally { setBusy(false); }
  }
  async function change(input: Omit<Parameters<typeof changeSubmissionPilot>[0], 'taskId' | 'revision'>) {
    if (!current || !p) return;
    const r = await changeSubmissionPilot({ ...input, taskId: current.id, revision: p.revision });
    if (!r.success) throw new Error(r.error);
  }
  async function upload(itemId: string, file: File) {
    if (!current || !p) return;
    const prepared = await preparePilotUpload({ taskId: current.id, revision: p.revision, itemId, name: file.name, size: file.size, type: file.type });
    if (!prepared.success) throw new Error(prepared.error);
    const response = await fetch(prepared.data.signedUrl, { method: 'PUT', headers: { 'Content-Type': file.type }, body: file });
    if (!response.ok) throw new Error('Upload failed. Retry verification or cancel this upload.');
    const finished = await finishPilotUpload(current.id, itemId);
    if (!finished.success) throw new Error(finished.error);
  }
  return <div className="mx-auto max-w-7xl space-y-6">
    <header className="app-page-header">
      <Link href="/pipeline" className="app-btn-secondary mb-4"><ArrowLeft size={16} /> Pipeline</Link>
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div><p className="text-sm font-semibold text-primary">Matt Mahjoub · Live submission pilot</p><h1 className="app-page-title">{data.owner ? 'Submit to Processing' : 'Review processing submissions'}</h1>
          <p className="app-page-subtitle">{data.owner ? 'Upload each item, send it for review, and resolve corrections in one place.' : 'Check every document and explanation. Return specific corrections or approve the package.'}</p></div>
        <button type="button" className="app-btn-secondary" disabled={busy} onClick={() => void run(reload)}><RefreshCw size={16} /> Refresh</button>
      </div>
    </header>
    <ol aria-label="Submission steps" className="grid gap-3 md:grid-cols-3">
      {[
        ['Build your package', 'Choose your loan and upload documents into each required category.'],
        ['Jr Processor review', 'Each document is checked. Specific corrections come back here.'],
        ['Approved for Arive', 'Approved files are ready to send to the linked Arive loan.'],
      ].map(([title, description], index) => <li key={title} className="app-surface-card flex gap-3"><span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-secondary font-bold text-primary" aria-hidden="true">{index + 1}</span><div><h2 className="font-semibold">{title}</h2><p className="mt-1 text-sm text-muted-foreground">{description}</p></div></li>)}
    </ol>
    <ArivePilotConnection configured={data.ariveConfigured} canConfigure={data.canConfigureArive} owner={data.owner} onChanged={reload} onOpen={id => { setSelected(id); router.replace(`/pipeline/submission-pilot?task=${id}`); }} />
    <div role="status" aria-live="polite" className={message ? 'rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800' : 'text-sm text-muted-foreground'}>{message || (busy ? 'Saving…' : '')}</div>
    <div className="grid items-start gap-6 lg:grid-cols-[300px_1fr]">
      <aside className="app-surface-card space-y-5">
        {data.owner && <div className="space-y-3"><label className="block text-sm font-semibold" htmlFor="pilot-loan">Existing pipeline loan</label>
          <select id="pilot-loan" className="app-input" value={loanId} disabled={busy} onChange={e => setLoanId(e.target.value)}><option value="">Choose a loan</option>{data.loans.map(l => <option key={l.id} value={l.id}>{l.borrowerName} · {l.loanNumber}</option>)}</select>
          {loanId && <p className="text-xs text-muted-foreground">{getProcessingMethodLabel(data.loans.find(l => l.id === loanId)?.processingPipeline?.processingMethod)} · {getProcessingAssignmentLabel(data.loans.find(l => l.id === loanId)?.processingPipeline?.assignmentGroup)}. Existing routing is retained.</p>}
          <button type="button" className="app-btn-primary w-full" disabled={busy || !loanId} onClick={() => void run(async () => { const r = await createSubmissionPilot(loanId); if (!r.success) throw new Error(r.error); setSelected(r.data); router.replace(`/pipeline/submission-pilot?task=${r.data}`); })}>Start / open submission</button>
        </div>}
        <h2 className="text-sm font-bold">{data.owner ? 'Your submissions' : 'Review queue'}</h2>
        {!data.packages.length && <p className="text-sm text-muted-foreground">{data.owner ? 'Choose an existing loan to begin.' : 'No pilot submissions yet. Submitted packages will appear here.'}</p>}
        <div className="space-y-2">{data.packages.map(entry => <button type="button" key={entry.id} disabled={busy} aria-pressed={selected === entry.id} className={`w-full rounded-lg border p-3 text-left focus-visible:outline-2 focus-visible:outline-primary ${selected === entry.id ? 'border-primary bg-secondary' : 'border-border'}`} onClick={() => { setSelected(entry.id); setNotes({}); setMessage(''); router.replace(`/pipeline/submission-pilot?task=${entry.id}`); }}><span className="block text-sm font-semibold">{entry.borrower}</span><span className="block text-xs text-muted-foreground">{entry.loanNumber} · {labels[entry.package.state]}</span></button>)}</div>
      </aside>
      {current && p ? <main className="space-y-5" aria-busy={busy}>
        <section className="app-surface-card space-y-3"><div className="flex flex-wrap items-center justify-between gap-3"><h2 className="text-xl font-bold">{current.borrower}</h2><span className="app-count-badge">{labels[p.state]}</span></div>
          <p className="text-sm text-muted-foreground">Arive #{current.loanNumber} · {p.items.filter(i => i.review === 'APPROVED').length} of {p.items.length} categories approved</p>
          <div className="space-y-2"><div className="flex justify-between text-sm"><span>Required documents prepared</span><span>{p.items.filter(i => i.required && (i.files.length > 0 || i.waiver.trim()) && !i.pending).length} / {p.items.filter(i => i.required).length}</span></div><progress className="h-2 w-full accent-primary" aria-label="Required documents prepared" max={p.items.filter(i => i.required).length} value={p.items.filter(i => i.required && (i.files.length > 0 || i.waiver.trim()) && !i.pending).length} /></div>
          {!data.owner && p.state === 'REVIEW' && !p.reviewerId && <button type="button" className="app-btn-primary" disabled={busy} onClick={() => void run(() => change({ action: 'CLAIM' }))}>Claim review</button>}
          {!data.owner && p.reviewerId && p.reviewerId !== data.userId && <p className="text-sm text-muted-foreground">Assigned to another Jr Processor. Read-only view.</p>}
        </section>
        {[true, false].map(required => <section key={String(required)} className="space-y-3"><h3 className="font-bold">{required ? 'Required document checklist' : 'Additional documents'}</h3><p className="text-sm text-muted-foreground">{required ? 'Upload all applicable documents, or explain why an item is not applicable. The Jr Processor reviews each explanation.' : 'Add supporting documents such as letters of explanation. Your Jr Processor reviews these with the rest of your package.'}</p>
          {p.items.filter(i => i.required === required).map(item => <article key={item.id} className={`app-surface-card space-y-3 ${item.review === 'CHANGES' ? 'border-red-300' : ''}`}>
            <div className="flex flex-wrap justify-between gap-2"><h4 className="font-semibold">{item.label}</h4><span className="app-count-badge">{item.review === 'APPROVED' ? 'Approved' : item.review === 'CHANGES' ? 'Correction needed' : item.files.length || item.waiver ? 'Awaiting review' : 'Missing'}</span></div>
            {item.feedback && <p className="rounded-lg bg-secondary p-3 text-sm"><strong>Jr feedback:</strong> {item.feedback}</p>}
            {item.waiver && <p className="text-sm"><strong>Not applicable:</strong> {item.waiver}</p>}
            <ul className="space-y-2">{item.files.map(file => <li key={file.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border p-2 text-sm"><button type="button" className="app-btn-secondary max-w-full" disabled={busy} onClick={() => void run(async () => { const r = await downloadPilotFile(current.id, file.id); if (!r.success) throw new Error(r.error); window.location.assign(r.data); })}><FileCheck2 size={16} /><span className="truncate">{file.name}</span></button><span className="text-xs text-muted-foreground">{(file.size / 1024 / 1024).toFixed(1)} MB</span>{editable && <button type="button" className="app-btn-danger" disabled={busy} onClick={() => void run(() => change({ action: 'REMOVE', itemId: item.id, fileId: file.id }))}>Remove</button>}</li>)}</ul>
            {editable && !item.pending && <label className="block space-y-2 text-sm"><span className="flex items-center gap-2 font-medium"><Upload size={16} /> Add file · PDF, JPG, PNG · up to 20 MB</span><input className="app-input" type="file" accept=".pdf,.jpg,.jpeg,.png" disabled={busy} onChange={e => { const file = e.target.files?.[0]; e.target.value = ''; if (file) void run(() => upload(item.id, file)); }} /></label>}
            {editable && item.pending && <div className="space-y-2 text-sm"><p>Upload pending: {item.pending.name}</p><div className="flex gap-2"><button type="button" className="app-btn-secondary" disabled={busy} onClick={() => void run(async () => { const r = await finishPilotUpload(current.id, item.id); if (!r.success) throw new Error(r.error); })}>Verify upload</button><button type="button" className="app-btn-secondary" disabled={busy} onClick={() => void run(() => change({ action: 'CANCEL_UPLOAD', itemId: item.id }))}>Cancel upload</button></div></div>}
            {editable && !item.files.length && !item.pending && <div className="space-y-2"><label className="block text-sm">Not applicable explanation<textarea className="app-input mt-1" maxLength={2000} value={notes[item.id] ?? item.waiver} disabled={busy} onChange={e => setNotes(n => ({ ...n, [item.id]: e.target.value }))} placeholder="Example: Purchase loan — no existing mortgage statement." /></label><button type="button" className="app-btn-secondary" disabled={busy} onClick={() => void run(() => change({ action: 'WAIVER', itemId: item.id, text: notes[item.id] ?? item.waiver }))}>Save explanation</button></div>}
            {reviewing && (item.files.length > 0 || item.waiver) && <div className="space-y-2 border-t border-border pt-3"><label className="block text-sm">Review feedback<textarea className="app-input mt-1" maxLength={2000} value={notes[item.id] ?? item.feedback} disabled={busy} onChange={e => setNotes(n => ({ ...n, [item.id]: e.target.value }))} placeholder="Explain what needs to be corrected. Required when returning an item." /></label><div className="flex flex-wrap gap-2"><button type="button" className="app-btn-primary" disabled={busy} onClick={() => void run(() => change({ action: 'REVIEW', itemId: item.id, approved: true, text: notes[item.id] ?? item.feedback }))}>Approve {item.waiver ? 'explanation' : 'documents'}</button><button type="button" className="app-btn-danger" disabled={busy} onClick={() => void run(() => change({ action: 'REVIEW', itemId: item.id, approved: false, text: notes[item.id] ?? item.feedback }))}>Request correction</button></div></div>}
          </article>)}
          {!required && editable && <div className="app-surface-card space-y-2"><label className="block text-sm">Additional document label<input className="app-input mt-1" maxLength={150} disabled={busy} value={extra} onChange={e => setExtra(e.target.value)} placeholder="Example: Letter of explanation" /></label><button type="button" className="app-btn-secondary" disabled={busy || !extra.trim()} onClick={() => void run(async () => { await change({ action: 'ADD', text: extra }); setExtra(''); })}>Add document category</button></div>}
        </section>)}
        <section className="app-surface-card space-y-3">
          {editable && <><p className="text-sm text-muted-foreground">{pilotSubmissionError(p) || 'All required categories are ready to send for review.'}</p><button type="button" className="app-btn-primary" disabled={busy || !!pilotSubmissionError(p)} onClick={() => void run(() => change({ action: 'SUBMIT' }))}>{p.state === 'CHANGES' ? 'Resubmit corrections' : 'Submit to Jr Processor'}</button></>}
          {reviewing && <><p className="text-sm text-muted-foreground">{pilotApprovalError(p) || 'All documents and explanations have been approved.'}</p><div className="flex flex-wrap gap-2"><button type="button" className="app-btn-primary" disabled={busy || !!pilotApprovalError(p)} onClick={() => void run(() => change({ action: 'APPROVE' }))}>Approve package</button><button type="button" className="app-btn-danger" disabled={busy || !p.items.some(i => i.review === 'CHANGES')} onClick={() => void run(() => change({ action: 'RETURN' }))}>Return corrections to LO</button></div></>}
          {p.state === 'APPROVED' && <p className="text-sm font-semibold">Package approved. Check each file’s transfer status in Arive documents and notes below.</p>}
          <details><summary className="text-sm font-semibold">Submission history ({p.history.length})</summary><ol className="mt-3 space-y-2 text-sm">{[...p.history].reverse().map((h, index) => <li key={index}><span className="font-medium">{h.actor}</span> · {h.message}<span className="block text-xs text-muted-foreground">{new Date(h.at).toLocaleString()}</span></li>)}</ol></details>
        </section>
        <ArivePackagePanel key={current.id} taskId={current.id} pkg={p} configured={data.ariveConfigured} parentBusy={busy} onChanged={reload} />
      </main> : data.owner ? <section className="app-surface-card space-y-6">
        <div><span className="app-count-badge">Your submission checklist</span><h2 className="mt-3 text-2xl font-bold">A complete file starts here</h2><p className="mt-2 text-sm text-muted-foreground">Choose an existing loan on the left, or open your Arive loan above. You can save your progress and return before submitting.</p></div>
        <div className="grid gap-3 sm:grid-cols-2">{PILOT_DOCUMENT_TYPES.map(([id, label]) => <div key={id} className="flex items-start gap-3 rounded-xl border border-border p-4"><FileCheck2 size={20} className="shrink-0 text-primary" /><div><h3 className="text-sm font-semibold">{label}</h3><p className="mt-1 text-xs text-muted-foreground">Document or explanation required</p></div></div>)}</div>
        <div className="rounded-xl bg-secondary p-4 text-sm"><h3 className="font-semibold">Before you can submit</h3><p className="mt-1 text-muted-foreground">Complete every required category and upload at least one document. If an item does not apply, explain why. Your Jr Processor must approve each document and explanation.</p></div>
        <p className="text-xs text-muted-foreground">PDF, JPG, or PNG · Up to 20 MB per file · Additional documents welcome</p>
      </section> : <div className="app-surface-card text-muted-foreground">Choose a submission to see its documents and review history.</div>}
    </div>
  </div>;
}
