'use client';

import React, { useState } from 'react';
import { Loader2, X, Send, ChevronDown, ChevronRight } from 'lucide-react';
import { updateLeadStatus, addLeadNote } from '@/app/actions/leadActions';
import { LeadStatusBadge } from './LeadStatusBadge';
import { useRouter } from 'next/navigation';
import { FormatDate } from '@/components/ui/FormatDate';

type LeadDetail = {
  id: string;
  status: string;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  phone: string | null;
  homePhone: string | null;
  workPhone: string | null;
  dob: string | null;
  coFirstName: string | null;
  coLastName: string | null;
  coEmail: string | null;
  coPhone: string | null;
  coHomePhone: string | null;
  coWorkPhone: string | null;
  coDob: string | null;
  mailingAddress: string | null;
  mailingCity: string | null;
  mailingState: string | null;
  mailingZip: string | null;
  mailingCounty: string | null;
  propertyAddress: string | null;
  propertyCity: string | null;
  propertyState: string | null;
  propertyZip: string | null;
  propertyCounty: string | null;
  purchasePrice: string | null;
  propertyValue: string | null;
  propertyType: string | null;
  propertyUse: string | null;
  propertyLtv: string | null;
  employer: string | null;
  jobTitle: string | null;
  income: string | null;
  selfEmployed: string | null;
  bankruptcy: string | null;
  foreclosure: string | null;
  homeowner: string | null;
  coEmployer: string | null;
  coJobTitle: string | null;
  coIncome: string | null;
  loanPurpose: string | null;
  loanAmount: string | null;
  loanTerm: string | null;
  loanType: string | null;
  loanRate: string | null;
  downPayment: string | null;
  cashOut: string | null;
  creditRating: string | null;
  currentLender: string | null;
  currentBalance: string | null;
  currentRate: string | null;
  targetRate: string | null;
  vaStatus: string | null;
  vaLoan: string | null;
  isMilitary: string | null;
  fhaLoan: string | null;
  sourceUrl: string | null;
  source: string | null;
  receivedAt: string;
  vendor: { name: string } | null;
  campaign: { name: string } | null;
  notes: Array<{
    id: string;
    content: string;
    createdAt: string;
    author: { id: string; name: string } | null;
  }>;
};

function Field({ label, value }: { label: string; value: string | null }) {
  if (!value) return null;
  return (
    <div className="flex justify-between gap-3 py-1.5">
      <span className="text-xs text-slate-500 shrink-0">{label}</span>
      <span className="text-xs font-medium text-slate-800 text-right">{value}</span>
    </div>
  );
}

function Section({
  title,
  children,
  defaultOpen = true,
}: {
  title: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border-b border-slate-100 last:border-b-0">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex w-full items-center gap-2 py-3 text-left"
      >
        {open ? <ChevronDown className="h-3.5 w-3.5 text-slate-400" /> : <ChevronRight className="h-3.5 w-3.5 text-slate-400" />}
        <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">{title}</span>
      </button>
      {open && <div className="pb-3 pl-5.5">{children}</div>}
    </div>
  );
}

export function LeadDetailPanel({
  lead,
  onClose,
}: {
  lead: LeadDetail;
  onClose: () => void;
}) {
  const router = useRouter();
  const [noteText, setNoteText] = useState('');
  const [savingNote, setSavingNote] = useState(false);
  const [updatingStatus, setUpdatingStatus] = useState(false);

  const handleStatusChange = async (newStatus: string) => {
    setUpdatingStatus(true);
    try {
      await updateLeadStatus(lead.id, newStatus as never);
      router.refresh();
    } finally {
      setUpdatingStatus(false);
    }
  };

  const handleAddNote = async () => {
    if (!noteText.trim()) return;
    setSavingNote(true);
    try {
      await addLeadNote(lead.id, noteText.trim());
      setNoteText('');
      router.refresh();
    } finally {
      setSavingNote(false);
    }
  };

  const name = [lead.firstName, lead.lastName].filter(Boolean).join(' ') || 'Unknown Lead';

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/30 backdrop-blur-[1px]" onClick={onClose}>
      <div
        className="h-full w-full max-w-lg bg-white shadow-2xl border-l border-slate-200 overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="sticky top-0 z-10 bg-white border-b border-slate-200 px-6 py-4">
          <div className="flex items-start justify-between">
            <div>
              <h2 className="text-lg font-bold text-slate-900">{name}</h2>
              <div className="flex items-center gap-2 mt-1">
                <LeadStatusBadge status={lead.status} />
                <span className="text-xs text-slate-500">{lead.vendor?.name}</span>
                {lead.campaign && <span className="text-xs text-slate-400">/ {lead.campaign.name}</span>}
              </div>
            </div>
            <button className="app-icon-btn" onClick={onClose} aria-label="Close">
              <X className="h-5 w-5" />
            </button>
          </div>

          {/* Status changer */}
          <div className="mt-3">
            <select
              className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
              value={lead.status}
              onChange={(e) => void handleStatusChange(e.target.value)}
              disabled={updatingStatus}
            >
              <option value="NEW">New</option>
              <option value="CONTACTED">Contacted</option>
              <option value="WORKING">Working</option>
              <option value="CONVERTED">Converted</option>
              <option value="DEAD">Dead</option>
            </select>
          </div>
        </div>

        {/* Sections */}
        <div className="px-6 py-4">
          <Section title="Contact">
            <Field label="First Name" value={lead.firstName} />
            <Field label="Last Name" value={lead.lastName} />
            <Field label="Email" value={lead.email} />
            <Field label="Phone" value={lead.phone} />
            <Field label="Home Phone" value={lead.homePhone} />
            <Field label="Work Phone" value={lead.workPhone} />
            <Field label="DOB" value={lead.dob} />
            {(lead.coFirstName || lead.coLastName) && (
              <>
                <div className="mt-2 mb-1 text-[10px] font-bold uppercase tracking-wider text-slate-400">Co-Borrower</div>
                <Field label="First Name" value={lead.coFirstName} />
                <Field label="Last Name" value={lead.coLastName} />
                <Field label="Email" value={lead.coEmail} />
                <Field label="Phone" value={lead.coPhone} />
              </>
            )}
          </Section>

          <Section title="Address">
            <Field label="Mailing" value={[lead.mailingAddress, lead.mailingCity, lead.mailingState, lead.mailingZip].filter(Boolean).join(', ') || null} />
            <Field label="County" value={lead.mailingCounty} />
            <Field label="Property" value={[lead.propertyAddress, lead.propertyCity, lead.propertyState, lead.propertyZip].filter(Boolean).join(', ') || null} />
            <Field label="County" value={lead.propertyCounty} />
          </Section>

          <Section title="Property">
            <Field label="Purchase Price" value={lead.purchasePrice} />
            <Field label="Property Value" value={lead.propertyValue} />
            <Field label="Type" value={lead.propertyType} />
            <Field label="Use" value={lead.propertyUse} />
            <Field label="LTV" value={lead.propertyLtv} />
          </Section>

          <Section title="Employer">
            <Field label="Employer" value={lead.employer} />
            <Field label="Job Title" value={lead.jobTitle} />
            <Field label="Income" value={lead.income} />
            <Field label="Self Employed" value={lead.selfEmployed} />
            <Field label="Bankruptcy" value={lead.bankruptcy} />
            <Field label="Foreclosure" value={lead.foreclosure} />
            <Field label="Homeowner" value={lead.homeowner} />
            {(lead.coEmployer || lead.coIncome) && (
              <>
                <div className="mt-2 mb-1 text-[10px] font-bold uppercase tracking-wider text-slate-400">Co-Borrower</div>
                <Field label="Employer" value={lead.coEmployer} />
                <Field label="Job Title" value={lead.coJobTitle} />
                <Field label="Income" value={lead.coIncome} />
              </>
            )}
          </Section>

          <Section title="Loan">
            <Field label="Purpose" value={lead.loanPurpose} />
            <Field label="Amount" value={lead.loanAmount} />
            <Field label="Term" value={lead.loanTerm} />
            <Field label="Type" value={lead.loanType} />
            <Field label="Rate" value={lead.loanRate} />
            <Field label="Down Payment" value={lead.downPayment} />
            <Field label="Cash Out" value={lead.cashOut} />
            <Field label="Credit Rating" value={lead.creditRating} />
            <Field label="Current Lender" value={lead.currentLender} />
            <Field label="Current Balance" value={lead.currentBalance} />
            <Field label="Current Rate" value={lead.currentRate} />
            <Field label="Target Rate" value={lead.targetRate} />
            <Field label="VA Status" value={lead.vaStatus} />
            <Field label="VA Loan" value={lead.vaLoan} />
            <Field label="Military" value={lead.isMilitary} />
            <Field label="FHA Loan" value={lead.fhaLoan} />
          </Section>

          {/* Notes */}
          <Section title={`Notes (${lead.notes.length})`}>
            <div className="flex gap-2 mb-3">
              <input
                className="flex-1 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                placeholder="Add a note..."
                value={noteText}
                onChange={(e) => setNoteText(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && void handleAddNote()}
              />
              <button
                className="app-btn-primary h-[38px] px-3 disabled:opacity-70 disabled:cursor-not-allowed"
                onClick={() => void handleAddNote()}
                disabled={savingNote || !noteText.trim()}
              >
                {savingNote ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              </button>
            </div>
            {lead.notes.length === 0 ? (
              <p className="text-xs text-slate-400 text-center py-3">No notes yet</p>
            ) : (
              <div className="space-y-2">
                {lead.notes.map((note) => (
                  <div key={note.id} className="rounded-lg border border-slate-100 bg-slate-50/50 px-3 py-2">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-xs font-semibold text-slate-700">{note.author?.name ?? 'Lead Mailbox'}</span>
                      <span className="text-[10px] text-slate-400">
                        <FormatDate date={note.createdAt} mode="datetime" />
                      </span>
                    </div>
                    <p className="text-xs text-slate-600 whitespace-pre-wrap">{note.content}</p>
                  </div>
                ))}
              </div>
            )}
          </Section>

          <div className="mt-4 text-[10px] text-slate-400">
            <p>Source: {lead.source || '—'}</p>
            <p>Received: <FormatDate date={lead.receivedAt} mode="datetime" /></p>
          </div>
        </div>
      </div>
    </div>
  );
}
