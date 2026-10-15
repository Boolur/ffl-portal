'use client';

import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Activity, FileText, Home, Landmark, MapPin, Phone, UserRound, Users, X } from 'lucide-react';
import { DetailCard, DetailField, WorkspacePanel } from '@/components/pipeline/BorrowerWorkspaceLayout';
import type { Task } from './TaskList';

type Row = { key: string; label: string; value: string };
type Tab = 'submission' | 'borrower' | 'property' | 'loan' | 'activity';
const tabs = [
  { id: 'submission', label: 'Submission Details', icon: Home },
  { id: 'borrower', label: 'Borrower', icon: UserRound },
  { id: 'property', label: 'Property', icon: MapPin },
  { id: 'loan', label: 'Loan', icon: Landmark },
  { id: 'activity', label: 'Activity & routing', icon: Activity },
] as const;

export function SubmissionWorkspaceContent({ task, rows, method, assignment, review, startGate, conversation, children }: {
  task: Task; rows: Row[]; method: string; assignment: string; review: React.ReactNode; startGate?: React.ReactNode; conversation: React.ReactNode; children: React.ReactNode;
}) {
  const [tab, setTab] = useState<Tab>('submission');
  const value = (...keys: string[]) => keys.map(key => rows.find(row => row.key === key)?.value).find(Boolean);
  const amount = value('loanAmount');
  const address = value('propertyAddress', 'subjectPropertyAddress') || [value('propertyStreet'), value('propertyUnit'), value('propertyCity'), value('propertyState'), value('propertyZip')].filter(Boolean).join(', ');
  const officer = task.loan.secondaryLoanOfficer?.name || task.loan.loanOfficer?.name || value('loanOfficerName');
  const phone = value('borrowerPhone');
  const email = value('borrowerEmail');
  const borrowerKeys = /borrower|employment|employer|income|credit|citizen|veteran/i;
  const propertyKeys = /property|homeValue|occupancy|yearBuilt|yearA[cq]|titleWill/i;
  const filtered = rows.filter(row => tab === 'borrower' ? borrowerKeys.test(row.key) : tab === 'property' ? propertyKeys.test(row.key) : !borrowerKeys.test(row.key) && !propertyKeys.test(row.key));
  return <div className="relative flex min-h-0 flex-1 flex-col">
    <div inert={!!startGate} aria-hidden={startGate ? true : undefined} className={`flex min-h-0 flex-1 flex-col ${startGate ? 'select-none grayscale opacity-45' : ''}`}>
    <nav className="flex shrink-0 gap-1 overflow-x-auto border-b border-slate-200 bg-white px-3 py-2 sm:px-5" aria-label="Submission workspace sections">
      {tabs.map(({ id, label, icon: Icon }) => <button key={id} type="button" aria-pressed={tab === id} onClick={() => setTab(id)} className={`inline-flex shrink-0 items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-bold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-300 ${tab === id ? 'bg-blue-600 text-white shadow-sm' : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'}`}><Icon size={14} aria-hidden="true" />{label}</button>)}
    </nav>
    <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-3 sm:p-5" style={{ scrollbarGutter: 'stable' }}>
      <div hidden={tab !== 'submission'}>
        <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_320px]">
          <div className="min-w-0 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">{review}</div>
          <aside className="min-w-0 space-y-4" aria-label="Borrower contact and file summary">
            <DetailCard title="Ownership" description="Current request assignment and routing." icon={Users}><div className="space-y-2"><DetailField label="Selected processor / team" value={assignment} /><DetailField label="Junior Processor" value={task.assignedUser?.name || 'Not started'} /><DetailField label="Processing method" value={method} /></div></DetailCard>
            <DetailCard title="File at a glance" description="Details from this processing submission." icon={Home}><div className="space-y-2"><DetailField label="Loan amount" value={amount && Number.isFinite(Number(amount)) ? new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(Number(amount)) : amount} /><DetailField label="Lender" value={value('lender')} /><DetailField label="Loan type" value={value('loanType')} /><DetailField label="Program" value={value('loanProgram', 'loanPurpose')} /><DetailField label="Property" value={address} copyable /><DetailField label="Effective Loan Officer" value={officer} /></div></DetailCard>
            <DetailCard title="Contact" description="Reach the borrower without leaving the file." icon={Phone}><div className="space-y-2"><DetailField label="Phone" value={phone ? <a className="text-blue-700 hover:underline" href={`tel:${phone}`}>{phone}</a> : null} /><DetailField label="Email" value={email ? <a className="text-blue-700 hover:underline" href={`mailto:${email}`}>{email}</a> : null} /></div></DetailCard>
          </aside>
        </div>
        <section aria-label="Conversation" className="mt-5 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-6">
          <p className="mb-5 text-sm text-slate-500">Document requests, Loan Officer responses, and notes for this task. Task response controls are under Activity &amp; routing.</p>
          {conversation}
        </section>
      </div>
      {tab !== 'submission' && tab !== 'activity' && <DetailCard title={tabs.find(item => item.id === tab)!.label} description="Information captured with this submission." icon={FileText}><div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{filtered.map(row => <DetailField key={row.key} label={row.label} value={row.value} />)}</div>{!filtered.length && <p className="text-sm text-slate-500">No details were provided for this section.</p>}</DetailCard>}
      <div hidden={tab !== 'activity'}>{children}</div>
    </div>
    </div>
    {startGate && <div className="absolute inset-0 z-10 flex items-center justify-center bg-slate-200/60 p-5 backdrop-blur-[2px]">{startGate}</div>}
  </div>;
}

export function ProcessingSubmissionWorkspace({ task, onClose, children, ...content }: Parameters<typeof SubmissionWorkspaceContent>[0] & { onClose: () => void }) {
  const panel = useRef<HTMLDivElement>(null);
  const close = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const previousFocus = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    close.current?.focus();
    return () => { document.body.style.overflow = overflow; previousFocus?.focus(); };
  }, []);
  useEffect(() => {
    const handle = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); onClose(); }
      if (event.key !== 'Tab') return;
      const focusable = Array.from(panel.current?.querySelectorAll<HTMLElement>('button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex="0"]') || []).filter(element => element.getClientRects().length > 0 && !element.closest('fieldset[disabled], [inert]'));
      const first = focusable[0]; const last = focusable.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    document.addEventListener('keydown', handle);
    return () => document.removeEventListener('keydown', handle);
  }, [onClose]);
  return createPortal(<div role="dialog" aria-modal="true" aria-labelledby={`submission-title-${task.id}`} data-live-refresh-pause="true" className="fixed inset-0 z-[80] flex items-center justify-center bg-slate-950/55 p-2 backdrop-blur-sm sm:p-4" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
    <WorkspacePanel ref={panel}>
      <header className="relative shrink-0 overflow-hidden border-b border-slate-200 bg-white px-4 py-4 sm:px-6"><div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(37,99,235,0.12),transparent_42%),radial-gradient(circle_at_top_right,rgba(14,165,233,0.1),transparent_40%)]" /><div className="relative flex items-center gap-3"><span className="inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-blue-600 to-indigo-700 text-sm font-black text-white shadow-lg shadow-blue-200">{task.loan.borrowerName.split(/\s+/).slice(0, 2).map(part => part[0]).join('')}</span><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><h2 id={`submission-title-${task.id}`} className="text-xl font-black tracking-tight text-slate-950 sm:text-2xl">{task.loan.borrowerName}</h2><span className="rounded-full border border-blue-200 bg-blue-50 px-2.5 py-1 font-mono text-[11px] font-bold text-blue-800">Arive #{task.loan.loanNumber}</span></div><p className="mt-1 text-xs font-semibold text-slate-500">Processing submission · {task.status === 'PENDING' ? 'Awaiting review' : task.status === 'COMPLETED' ? 'Completed' : task.status === 'BLOCKED' ? 'Waiting on Loan Officer' : 'In review'}</p></div><button ref={close} type="button" onClick={onClose} aria-label="Close submission workspace" className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-500 shadow-sm hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-300"><X size={20} /></button></div></header>
      <SubmissionWorkspaceContent task={task} {...content}>{children}</SubmissionWorkspaceContent>
    </WorkspacePanel>
  </div>, document.body);
}

export function TaskModalShell({ pilot, task, rows, method, assignment, review, startGate, conversation, onClose, children }: Parameters<typeof ProcessingSubmissionWorkspace>[0] & { pilot: boolean }) {
  if (pilot) return <ProcessingSubmissionWorkspace task={task} rows={rows} method={method} assignment={assignment} review={review} startGate={startGate} conversation={conversation} onClose={onClose}>{children}</ProcessingSubmissionWorkspace>;
  return <div data-live-refresh-pause="true" className="fixed inset-0 z-[80] flex items-center justify-center bg-slate-900/45 p-4" onClick={onClose}><div className="w-full max-w-5xl max-h-[90vh] overflow-y-auto overflow-x-hidden rounded-[24px] border border-slate-200/60 bg-slate-50 p-6 sm:p-10 shadow-2xl" style={{ scrollbarGutter: 'stable' }} onClick={event => event.stopPropagation()}>{children}</div></div>;
}
