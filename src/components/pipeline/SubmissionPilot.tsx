'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { FileCheck2, Upload, ArrowLeft, RefreshCw, House, ShieldCheck, ReceiptText, IdCard, BadgeCheck, FileSignature, FolderPlus, Check, CircleAlert, Minus, LockKeyhole, Send, XCircle } from 'lucide-react';
import { requestInfoFromLoanOfficer } from '@/app/actions/taskActions';
import { fetchPilotReview, invalidatePilotReview } from '@/lib/pilotReviewLoader';
import { pilotDecisionError } from '@/lib/pilotReviewChecklist';
import Link from 'next/link';
import { createSubmissionPilot, getSubmissionPilot, changeSubmissionPilot, preparePilotUpload, finishPilotUpload } from '@/app/actions/submissionPilotActions';
import { PILOT_DOCUMENT_TYPES, pilotApprovalError, pilotSubmissionError } from '@/lib/submissionPilot';
import { getProcessingAssignmentLabel, getProcessingMethodLabel } from '@/lib/processingRouting';
import { ArivePilotConnection, ArivePackagePanel } from './ArivePilotPanel';
import { PilotDocumentFile } from './PilotDocumentFile';

type Data = Extract<Awaited<ReturnType<typeof getSubmissionPilot>>, { success: true }>['data'];
const labels = { DRAFT: 'Draft — LO uploading', REVIEW: 'Jr review', CHANGES: 'Corrections requested', APPROVED: 'Approved — ready for Arive' };
const documentIcons = { mortgage: House, insurance: ShieldCheck, income: ReceiptText, identity: IdCard, veteran: BadgeCheck, disclosures: FileSignature };
export function SubmissionPilot({ initialData, initialTask, requestTaskId, startControl }: { initialData: Data; initialTask?: string; requestTaskId?: string; startControl?: React.ReactNode }) {
  const router = useRouter();
  const [data, setData] = useState(initialData);
  const [selected, setSelected] = useState(initialTask || initialData.packages[0]?.id || '');
  const [loanId, setLoanId] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [extra, setExtra] = useState('');
  const [editingReviews, setEditingReviews] = useState<string[]>([]);
  const [decision, setDecision] = useState<'APPROVE_INITIAL_DISCLOSURES' | 'MISSING_ITEMS' | 'OTHER'>('APPROVE_INITIAL_DISCLOSURES');
  const [decisionNotes, setDecisionNotes] = useState('');
  const [decisionSent, setDecisionSent] = useState(false);
  const current = data.packages.find(p => p.id === selected);
  const p = current?.package;
  const editable = data.owner && p && ['DRAFT', 'CHANGES'].includes(p.state);
  const reviewing = !decisionSent && !data.owner && p?.state === 'REVIEW' && p.reviewerId === data.userId;
  async function reload() {
    if (requestTaskId) invalidatePilotReview(requestTaskId);
    const r = requestTaskId ? await fetchPilotReview(requestTaskId) : await getSubmissionPilot();
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
  async function saveReview(itemId: string, approved: boolean, text: string) {
    await change({ action: 'REVIEW', itemId, approved, text });
    setEditingReviews(ids => ids.filter(id => id !== itemId));
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
    {!requestTaskId && <><header className="app-page-header">
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
    </>}
    {requestTaskId && <div className="flex flex-wrap items-center justify-between gap-3"><div className="flex items-center gap-3"><span className="rounded-2xl bg-violet-100 p-3 text-violet-700"><FileCheck2 size={24} /></span><div><h3 className="text-lg font-bold">Document review</h3><p className="text-sm text-muted-foreground">One checklist. Every file and decision, together.</p></div></div><button type="button" className="app-btn-secondary" disabled={busy} onClick={() => void run(reload)}><RefreshCw size={14} />Refresh</button></div>}
    {startControl}
    <div role="status" aria-live="polite" className={message ? 'rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800' : 'text-sm text-muted-foreground'}>{message || (busy ? 'Saving…' : '')}</div>
    <div className={requestTaskId ? 'space-y-5' : 'grid items-start gap-6 lg:grid-cols-[300px_1fr]'}>
      {!requestTaskId && <aside className="app-surface-card space-y-5">
        {data.owner && <div className="space-y-3"><label className="block text-sm font-semibold" htmlFor="pilot-loan">Existing pipeline loan</label>
          <select id="pilot-loan" className="app-input" value={loanId} disabled={busy} onChange={e => setLoanId(e.target.value)}><option value="">Choose a loan</option>{data.loans.map(l => <option key={l.id} value={l.id}>{l.borrowerName} · {l.loanNumber}</option>)}</select>
          {loanId && <p className="text-xs text-muted-foreground">{getProcessingMethodLabel(data.loans.find(l => l.id === loanId)?.processingPipeline?.processingMethod)} · {getProcessingAssignmentLabel(data.loans.find(l => l.id === loanId)?.processingPipeline?.assignmentGroup)}. Existing routing is retained.</p>}
          <button type="button" className="app-btn-primary w-full" disabled={busy || !loanId} onClick={() => void run(async () => { const r = await createSubmissionPilot(loanId); if (!r.success) throw new Error(r.error); setSelected(r.data); router.replace(`/pipeline/submission-pilot?task=${r.data}`); })}>Start / open submission</button>
        </div>}
        <h2 className="text-sm font-bold">{data.owner ? 'Your submissions' : 'Review queue'}</h2>
        {!data.packages.length && <p className="text-sm text-muted-foreground">{data.owner ? 'Choose an existing loan to begin.' : 'No pilot submissions yet. Submitted packages will appear here.'}</p>}
        <div className="space-y-2">{data.packages.map(entry => <button type="button" key={entry.id} disabled={busy} aria-pressed={selected === entry.id} className={`w-full rounded-lg border p-3 text-left focus-visible:outline-2 focus-visible:outline-primary ${selected === entry.id ? 'border-primary bg-secondary' : 'border-border'}`} onClick={() => { setSelected(entry.id); setNotes({}); setEditingReviews([]); setMessage(''); router.replace(`/pipeline/submission-pilot?task=${entry.id}`); }}><span className="block text-sm font-semibold">{entry.borrower}</span><span className="block text-xs text-muted-foreground">{entry.loanNumber} · {labels[entry.package.state]}</span></button>)}</div>
      </aside>}
      {current && p ? <main className="space-y-5" aria-busy={busy}>
        <section className="app-surface-card space-y-3"><div className="flex flex-wrap items-center justify-between gap-3"><h2 className="text-xl font-bold">{current.borrower}</h2><span className="app-count-badge">{labels[p.state]}</span></div>
          <p className="text-sm text-muted-foreground">Arive #{current.loanNumber} · {p.items.filter(i => i.review === 'APPROVED').length} of {p.items.length} categories approved</p>
          <div className="space-y-2"><div className="flex justify-between text-sm"><span className="font-semibold">Review progress</span><span>{p.items.filter(i => i.review === 'APPROVED').length} / {p.items.length} verified</span></div><progress className="h-2 w-full accent-emerald-600" aria-label="Document categories verified" max={p.items.length || 1} value={p.items.filter(i => i.review === 'APPROVED').length} /></div>
          {!data.owner && p.state === 'REVIEW' && !p.reviewerId && (requestTaskId ? <p className="flex items-center gap-2 rounded-xl bg-secondary p-3 text-sm"><LockKeyhole size={18} />Read-only until you start this Processing request. Adding a role alone does not assign the task.</p> : <button type="button" className="app-btn-primary" disabled={busy} onClick={() => void run(() => change({ action: 'CLAIM' }))}>Claim review</button>)}
          {!data.owner && p.reviewerId && p.reviewerId !== data.userId && <p className="text-sm text-muted-foreground">Assigned to another Jr Processor. Read-only view.</p>}
        </section>
        <div className="flex flex-wrap gap-4 text-xs font-medium"><span className="text-rose-700">● Red · needs attention</span><span className="text-emerald-700">● Green · approved</span><span className="text-slate-600">● Grey · not applicable</span></div>
        {[true, false].map(required => <section key={String(required)} className="space-y-3"><h3 className="font-bold">{required ? 'Submission checklist' : 'Additional documents'}</h3><p className="text-sm text-muted-foreground">{data.owner ? 'Upload documents or explain why an item does not apply.' : 'Review the attached files, then approve or describe what the LO needs to provide.'}</p>
          <div className="grid gap-4 xl:grid-cols-2">{p.items.filter(i => i.required === required).map(item => {
            const Icon = documentIcons[item.id as keyof typeof documentIcons] || FolderPlus;
            const waived = !!item.waiver && item.review !== 'CHANGES';
            const approved = item.review === 'APPROVED';
            const tone = waived ? 'border-slate-200 bg-slate-50/80' : approved ? 'border-emerald-200 bg-emerald-50/60' : 'border-rose-200 bg-rose-50/40';
            const iconTone = waived ? 'bg-slate-200 text-slate-600' : approved ? 'bg-emerald-100 text-emerald-700' : 'bg-rose-100 text-rose-600';
            return <article key={item.id} className={`rounded-2xl border p-4 shadow-sm space-y-4 ${tone}`}>
            <div className="flex items-start gap-3"><span className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl ${iconTone}`}><Icon size={25} strokeWidth={1.7} aria-hidden="true" /></span><div className="min-w-0"><h4 className="text-sm font-bold">{item.label}</h4><span className={`mt-2 inline-flex items-center gap-1 rounded-full px-2 py-1 text-xs font-semibold ${iconTone}`}>{waived ? <Minus size={13} /> : approved ? <Check size={13} /> : <CircleAlert size={13} />}{waived ? approved ? 'N/A · verified' : 'N/A · verify explanation' : approved ? 'Approved' : item.review === 'CHANGES' ? 'Requested from LO' : item.files.length ? 'Ready for your review' : 'Document needed'}</span></div></div>
            {item.feedback && <p className="rounded-lg bg-secondary p-3 text-sm"><strong>Jr feedback:</strong> {item.feedback}</p>}
            {item.waiver && <p className="text-sm"><strong>Not applicable:</strong> {item.waiver}</p>}
            <ul className="space-y-2">{item.files.map(file => <li key={file.id} className="flex flex-col items-center gap-3 rounded-xl border border-border bg-white/60 p-4 text-sm"><PilotDocumentFile taskId={current.id} file={file} />{editable && <button type="button" className="app-btn-danger" disabled={busy} onClick={() => void run(() => change({ action: 'REMOVE', itemId: item.id, fileId: file.id }))}>Remove</button>}</li>)}</ul>
            {editable && !item.pending && <label className="block space-y-2 text-sm"><span className="flex items-center gap-2 font-medium"><Upload size={16} /> Add file · PDF, JPG, PNG · up to 20 MB</span><input className="app-input" type="file" accept=".pdf,.jpg,.jpeg,.png" disabled={busy} onChange={e => { const file = e.target.files?.[0]; e.target.value = ''; if (file) void run(() => upload(item.id, file)); }} /></label>}
            {editable && item.pending && <div className="space-y-2 text-sm"><p>Upload pending: {item.pending.name}</p><div className="flex gap-2"><button type="button" className="app-btn-secondary" disabled={busy} onClick={() => void run(async () => { const r = await finishPilotUpload(current.id, item.id); if (!r.success) throw new Error(r.error); })}>Verify upload</button><button type="button" className="app-btn-secondary" disabled={busy} onClick={() => void run(() => change({ action: 'CANCEL_UPLOAD', itemId: item.id }))}>Cancel upload</button></div></div>}
            {editable && !item.files.length && !item.pending && <div className="space-y-2"><label className="block text-sm">Not applicable explanation<textarea className="app-input mt-1" maxLength={2000} value={notes[item.id] ?? item.waiver} disabled={busy} onChange={e => setNotes(n => ({ ...n, [item.id]: e.target.value }))} placeholder="Example: Purchase loan — no existing mortgage statement." /></label><button type="button" className="app-btn-secondary" disabled={busy} onClick={() => void run(() => change({ action: 'WAIVER', itemId: item.id, text: notes[item.id] ?? item.waiver }))}>Save explanation</button></div>}
            {!data.owner && item.review !== 'PENDING' && !editingReviews.includes(item.id) && <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-3"><p className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground"><Check size={14} />{item.review === 'APPROVED' ? 'Approval saved' : 'Document request saved'}</p>{reviewing && <button type="button" className="app-btn-secondary" disabled={busy} aria-label={`Edit decision for ${item.label}`} onClick={() => setEditingReviews(ids => [...ids, item.id])}>Edit decision</button>}</div>}
            {!data.owner && (item.review === 'PENDING' || editingReviews.includes(item.id)) && <fieldset disabled={busy || !reviewing} className="space-y-3 border-t border-border pt-3 disabled:opacity-60"><legend className="sr-only">Review {item.label}</legend><label className="block text-xs font-semibold">Review note<textarea className="app-input mt-1 bg-white" maxLength={2000} value={notes[item.id] ?? item.feedback} onChange={e => setNotes(n => ({ ...n, [item.id]: e.target.value }))} placeholder="What is missing or needs to change? Required to request documents." /></label><div className="flex flex-wrap gap-2"><button type="button" className="app-btn-success" disabled={!item.files.length && !item.waiver} onClick={() => void run(() => saveReview(item.id, true, notes[item.id] ?? item.feedback))}><Check size={16} />{item.waiver ? 'Accept N/A' : 'Approve'}</button><button type="button" className="app-btn-danger" disabled={!(notes[item.id] ?? item.feedback).trim()} onClick={() => void run(() => saveReview(item.id, false, notes[item.id] ?? item.feedback))}><CircleAlert size={16} />Request document / correction</button>{editingReviews.includes(item.id) && <button type="button" className="app-btn-secondary" onClick={() => { setEditingReviews(ids => ids.filter(id => id !== item.id)); setNotes(previous => { const next = { ...previous }; delete next[item.id]; return next; }); }}>Cancel edit</button>}</div></fieldset>}
          </article>; })}</div>
          {!required && reviewing && <div className="rounded-2xl border border-dashed border-violet-300 bg-violet-50/50 p-4"><label className="block text-sm font-semibold">Request an additional document<input className="app-input mt-2 bg-white" maxLength={150} value={extra} disabled={busy} onChange={e => setExtra(e.target.value)} placeholder="e.g. Updated bank statement for September" /></label><button type="button" className="app-btn-secondary mt-3" disabled={busy || !extra.trim()} onClick={() => void run(async () => { await change({ action: 'REQUEST_DOCUMENT', text: extra }); setExtra(''); setDecision('MISSING_ITEMS'); })}><FolderPlus size={16} />Add to requested documents</button><p className="mt-2 text-xs text-muted-foreground">Send all requests together using the final decision below.</p></div>}
          {!required && editable && <div className="app-surface-card space-y-2"><label className="block text-sm">Additional document label<input className="app-input mt-1" maxLength={150} disabled={busy} value={extra} onChange={e => setExtra(e.target.value)} placeholder="Example: Letter of explanation" /></label><button type="button" className="app-btn-secondary" disabled={busy || !extra.trim()} onClick={() => void run(async () => { await change({ action: 'ADD', text: extra }); setExtra(''); })}>Add document category</button></div>}
        </section>)}
        <section className="app-surface-card space-y-3">
          {editable && <><p className="text-sm text-muted-foreground">{pilotSubmissionError(p) || 'All required categories are ready to send for review.'}</p><button type="button" className="app-btn-primary" disabled={busy || !!pilotSubmissionError(p)} onClick={() => void run(() => change({ action: 'SUBMIT' }))}>{p.state === 'CHANGES' ? 'Resubmit corrections' : 'Submit to Jr Processor'}</button></>}
          {reviewing && !requestTaskId && <><p className="text-sm text-muted-foreground">{pilotApprovalError(p) || 'All documents and explanations have been approved.'}</p><div className="flex flex-wrap gap-2"><button type="button" className="app-btn-success" disabled={busy || !!pilotApprovalError(p)} onClick={() => void run(() => change({ action: 'APPROVE' }))}>Approve package</button><button type="button" className="app-btn-danger" disabled={busy || !p.items.some(i => i.review === 'CHANGES')} onClick={() => void run(() => change({ action: 'RETURN' }))}>Return corrections to LO</button></div></>}
          {requestTaskId && !data.owner && <div className="space-y-4">
            <div><h3 className="font-bold">Processing decision</h3><p className="mt-1 text-sm text-muted-foreground">Your document decisions above are the checklist. No duplicate entries.</p></div>
            <fieldset disabled={busy || !reviewing} className="space-y-4 disabled:opacity-60"><legend className="sr-only">Final processing decision</legend>
              <div className="grid gap-2 sm:grid-cols-3">{([
                ['APPROVE_INITIAL_DISCLOSURES', 'Approve submission', Check, 'border-emerald-300 bg-emerald-50 text-emerald-800'],
                ['MISSING_ITEMS', 'Request documents', FolderPlus, 'border-rose-300 bg-rose-50 text-rose-800'],
                ['OTHER', 'Reject submission', XCircle, 'border-slate-300 bg-slate-100 text-slate-700'],
              ] as const).map(([value, label, Icon, tone]) => <button key={value} type="button" aria-pressed={decision === value} onClick={() => setDecision(value)} className={`flex flex-col items-center gap-2 rounded-xl border p-4 text-sm font-semibold transition focus-visible:outline-2 focus-visible:outline-primary ${decision === value ? `${tone} ring-2 ring-primary/30` : 'border-border bg-white text-muted-foreground'}`}><Icon size={22} />{label}</button>)}</div>
              <label className="block text-sm font-semibold">{decision === 'OTHER' ? 'Reason for rejection' : 'Notes for the Loan Officer'} <span className="text-rose-600">· Required</span><textarea className="app-input mt-2 bg-white" maxLength={2000} value={decisionNotes} onChange={e => setDecisionNotes(e.target.value)} placeholder="Summarize your decision and the next steps for the LO." /></label>
              <p className="text-xs text-muted-foreground">{decision === 'OTHER' ? 'Returns this submission to the LO for revision. The loan and documents are retained.' : pilotDecisionError(p, decision) || 'All checklist items are approved. Ready to complete Processing.'}</p>
              <button type="button" className={decision === 'OTHER' ? 'app-btn-danger' : decision === 'APPROVE_INITIAL_DISCLOSURES' ? 'app-btn-success' : 'app-btn-primary'} disabled={!decisionNotes.trim() || !!pilotDecisionError(p, decision)} onClick={() => void run(async () => { const r = await requestInfoFromLoanOfficer(requestTaskId, { reason: decision, message: decisionNotes }); if (!r.success) throw new Error(r.error); setDecisionSent(true); router.refresh(); })}><Send size={16} />{busy ? 'Saving…' : decision === 'APPROVE_INITIAL_DISCLOSURES' ? 'Approve & complete Processing' : decision === 'OTHER' ? 'Reject & return to LO' : 'Send document request to LO'}</button>
            </fieldset>
            {decisionSent && <p role="status" className="text-sm font-semibold text-emerald-700">Decision saved and sent to the Loan Officer.</p>}
          </div>}
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
