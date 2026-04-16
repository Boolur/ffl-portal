'use client';

import React, { useState, useCallback } from 'react';
import { Loader2, X, Send, ChevronDown, ChevronRight } from 'lucide-react';
import { updateLeadStatus, addLeadNote } from '@/app/actions/leadActions';
import { LeadStatusBadge } from '@/components/leads/LeadStatusBadge';
import { useRouter } from 'next/navigation';

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
  currentPayment: string | null;
  currentTerm: string | null;
  currentType: string | null;
  otherBalance: string | null;
  otherPayment: string | null;
  targetRate: string | null;
  vaStatus: string | null;
  vaLoan: string | null;
  isMilitary: string | null;
  fhaLoan: string | null;
  sourceUrl: string | null;
  source: string | null;
  price: string | null;
  receivedAt: string;
  assignedAt: string | null;
  vendor: { name: string } | null;
  campaign: { name: string } | null;
  assignedUser: { name: string } | null;
  notes: Array<{
    id: string;
    content: string;
    createdAt: string;
    author: { id: string; name: string };
  }>;
};

function Field({ label, value }: { label: string; value: string | null }) {
  if (!value) return null;
  return (
    <div className="flex justify-between gap-3 py-1.5">
      <span className="text-xs text-slate-500 shrink-0">{label}</span>
      <span className="text-xs font-medium text-slate-800 text-right break-all">{value}</span>
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
  const hasContent = React.Children.toArray(children).some(Boolean);
  if (!hasContent) return null;
  return (
    <div className="border-b border-slate-100 last:border-b-0">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex w-full items-center gap-2 py-3 text-left"
      >
        {open ? (
          <ChevronDown className="h-3.5 w-3.5 text-slate-400" />
        ) : (
          <ChevronRight className="h-3.5 w-3.5 text-slate-400" />
        )}
        <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
          {title}
        </span>
      </button>
      {open && <div className="pb-3 pl-5">{children}</div>}
    </div>
  );
}

export function LeadDetailModal({
  lead,
  onClose,
  onUpdated,
}: {
  lead: LeadDetail;
  onClose: () => void;
  onUpdated?: () => void;
}) {
  const router = useRouter();
  const [noteText, setNoteText] = useState('');
  const [savingNote, setSavingNote] = useState(false);
  const [updatingStatus, setUpdatingStatus] = useState(false);

  const handleStatusChange = useCallback(
    async (newStatus: string) => {
      setUpdatingStatus(true);
      try {
        await updateLeadStatus(lead.id, newStatus as never);
        router.refresh();
        onUpdated?.();
      } finally {
        setUpdatingStatus(false);
      }
    },
    [lead.id, router, onUpdated]
  );

  const handleAddNote = useCallback(async () => {
    if (!noteText.trim()) return;
    setSavingNote(true);
    try {
      await addLeadNote(lead.id, noteText.trim());
      setNoteText('');
      router.refresh();
      onUpdated?.();
    } finally {
      setSavingNote(false);
    }
  }, [lead.id, noteText, router, onUpdated]);

  const name =
    [lead.firstName, lead.lastName].filter(Boolean).join(' ') || 'Unknown Lead';

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center"
      onClick={onClose}
    >
      <div className="absolute inset-0 bg-slate-900/30 backdrop-blur-sm" />
      <div
        role="dialog"
        aria-modal="true"
        className="relative w-full max-w-2xl bg-white rounded-2xl shadow-xl border border-slate-200 max-h-[90vh] overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="border-b border-slate-200 px-6 py-4 bg-slate-50/50">
          <div className="flex items-start justify-between">
            <div className="min-w-0">
              <h2 className="text-lg font-bold text-slate-900 truncate">
                {name}
              </h2>
              <div className="flex items-center gap-2 mt-1 flex-wrap">
                <LeadStatusBadge status={lead.status} />
                {lead.vendor && (
                  <span className="text-xs text-slate-500">
                    {lead.vendor.name}
                  </span>
                )}
                {lead.campaign && (
                  <span className="text-xs text-slate-400">
                    / {lead.campaign.name}
                  </span>
                )}
                {lead.assignedUser && (
                  <span className="text-xs font-medium text-blue-600">
                    → {lead.assignedUser.name}
                  </span>
                )}
              </div>
            </div>
            <button
              className="text-slate-400 hover:text-slate-600 p-1 hover:bg-slate-200 rounded ml-3 shrink-0"
              onClick={onClose}
            >
              <X className="h-5 w-5" />
            </button>
          </div>
          <div className="mt-3">
            <select
              className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 disabled:opacity-60"
              value={lead.status}
              onChange={(e) => void handleStatusChange(e.target.value)}
              disabled={updatingStatus}
            >
              <option value="NEW">New</option>
              <option value="CONTACTED">Contacted</option>
              <option value="WORKING">Working</option>
              <option value="CONVERTED">Converted</option>
              <option value="DEAD">Dead</option>
              <option value="RETURNED">Returned</option>
              <option value="UNASSIGNED">Unassigned</option>
            </select>
          </div>
        </div>

        {/* Scrollable body */}
        <div className="flex-1 overflow-y-auto px-6 py-4">
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
                <div className="mt-2 mb-1 text-[10px] font-bold uppercase tracking-wider text-slate-400">
                  Co-Borrower
                </div>
                <Field label="First Name" value={lead.coFirstName} />
                <Field label="Last Name" value={lead.coLastName} />
                <Field label="Email" value={lead.coEmail} />
                <Field label="Phone" value={lead.coPhone} />
                <Field label="Home Phone" value={lead.coHomePhone} />
                <Field label="Work Phone" value={lead.coWorkPhone} />
                <Field label="DOB" value={lead.coDob} />
              </>
            )}
          </Section>

          <Section title="Address">
            <Field
              label="Mailing"
              value={
                [
                  lead.mailingAddress,
                  lead.mailingCity,
                  lead.mailingState,
                  lead.mailingZip,
                ]
                  .filter(Boolean)
                  .join(', ') || null
              }
            />
            <Field label="County" value={lead.mailingCounty} />
            <Field
              label="Property"
              value={
                [
                  lead.propertyAddress,
                  lead.propertyCity,
                  lead.propertyState,
                  lead.propertyZip,
                ]
                  .filter(Boolean)
                  .join(', ') || null
              }
            />
            <Field label="Property County" value={lead.propertyCounty} />
          </Section>

          <Section title="Property">
            <Field label="Purchase Price" value={lead.purchasePrice} />
            <Field label="Property Value" value={lead.propertyValue} />
            <Field label="Type" value={lead.propertyType} />
            <Field label="Use" value={lead.propertyUse} />
            <Field label="LTV" value={lead.propertyLtv} />
          </Section>

          <Section title="Employment">
            <Field label="Employer" value={lead.employer} />
            <Field label="Job Title" value={lead.jobTitle} />
            <Field label="Income" value={lead.income} />
            <Field label="Self Employed" value={lead.selfEmployed} />
            <Field label="Bankruptcy" value={lead.bankruptcy} />
            <Field label="Homeowner" value={lead.homeowner} />
            {(lead.coEmployer || lead.coIncome) && (
              <>
                <div className="mt-2 mb-1 text-[10px] font-bold uppercase tracking-wider text-slate-400">
                  Co-Borrower
                </div>
                <Field label="Employer" value={lead.coEmployer} />
                <Field label="Job Title" value={lead.coJobTitle} />
                <Field label="Income" value={lead.coIncome} />
              </>
            )}
          </Section>

          <Section title="Loan Details">
            <Field label="Purpose" value={lead.loanPurpose} />
            <Field label="Amount" value={lead.loanAmount} />
            <Field label="Term" value={lead.loanTerm} />
            <Field label="Type" value={lead.loanType} />
            <Field label="Rate" value={lead.loanRate} />
            <Field label="Down Payment" value={lead.downPayment} />
            <Field label="Cash Out" value={lead.cashOut} />
            <Field label="Credit Rating" value={lead.creditRating} />
          </Section>

          <Section title="Current Loan" defaultOpen={false}>
            <Field label="Lender" value={lead.currentLender} />
            <Field label="Balance" value={lead.currentBalance} />
            <Field label="Rate" value={lead.currentRate} />
            <Field label="Payment" value={lead.currentPayment} />
            <Field label="Term" value={lead.currentTerm} />
            <Field label="Type" value={lead.currentType} />
            <Field label="Other Balance" value={lead.otherBalance} />
            <Field label="Other Payment" value={lead.otherPayment} />
            <Field label="Target Rate" value={lead.targetRate} />
          </Section>

          <Section title="Military / VA" defaultOpen={false}>
            <Field label="VA Status" value={lead.vaStatus} />
            <Field label="VA Loan" value={lead.vaLoan} />
            <Field label="Military" value={lead.isMilitary} />
            <Field label="FHA Loan" value={lead.fhaLoan} />
          </Section>

          <Section title="Pricing / Source" defaultOpen={false}>
            <Field label="Price" value={lead.price} />
            <Field label="Source" value={lead.source} />
            <Field label="Source URL" value={lead.sourceUrl} />
            <Field
              label="Received"
              value={new Date(lead.receivedAt).toLocaleString()}
            />
            {lead.assignedAt && (
              <Field
                label="Assigned"
                value={new Date(lead.assignedAt).toLocaleString()}
              />
            )}
          </Section>

          {/* Notes */}
          <Section title={`Notes (${lead.notes.length})`}>
            <div className="flex gap-2 mb-3">
              <input
                className="flex-1 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                placeholder="Add a note..."
                value={noteText}
                onChange={(e) => setNoteText(e.target.value)}
                onKeyDown={(e) =>
                  e.key === 'Enter' && !e.shiftKey && void handleAddNote()
                }
              />
              <button
                className="inline-flex items-center justify-center rounded-lg bg-blue-600 px-3 h-[38px] text-white hover:bg-blue-700 disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
                onClick={() => void handleAddNote()}
                disabled={savingNote || !noteText.trim()}
              >
                {savingNote ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Send className="h-4 w-4" />
                )}
              </button>
            </div>
            {lead.notes.length === 0 ? (
              <p className="text-xs text-slate-400 text-center py-3">
                No notes yet
              </p>
            ) : (
              <div className="space-y-2">
                {lead.notes.map((note) => (
                  <div
                    key={note.id}
                    className="rounded-lg border border-slate-100 bg-slate-50/50 px-3 py-2"
                  >
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-xs font-semibold text-slate-700">
                        {note.author.name}
                      </span>
                      <span className="text-[10px] text-slate-400">
                        {new Date(note.createdAt).toLocaleString()}
                      </span>
                    </div>
                    <p className="text-xs text-slate-600 whitespace-pre-wrap">
                      {note.content}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </Section>
        </div>
      </div>
    </div>
  );
}
