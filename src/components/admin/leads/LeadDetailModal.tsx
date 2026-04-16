'use client';

import React, { useState, useCallback, useMemo } from 'react';
import {
  Loader2,
  X,
  Send,
  ChevronDown,
  ChevronRight,
  User,
  MapPin,
  Home,
  Briefcase,
  DollarSign,
  Landmark,
  Shield,
  Tag,
  MessageSquare,
} from 'lucide-react';
import { updateLeadStatus, addLeadNote } from '@/app/actions/leadActions';
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

const ALL_STATUSES = [
  { value: 'NEW', label: 'New', color: 'border-blue-300 bg-blue-50 text-blue-700', active: 'bg-blue-600 text-white border-blue-600' },
  { value: 'CONTACTED', label: 'Contacted', color: 'border-amber-300 bg-amber-50 text-amber-700', active: 'bg-amber-500 text-white border-amber-500' },
  { value: 'WORKING', label: 'Working', color: 'border-indigo-300 bg-indigo-50 text-indigo-700', active: 'bg-indigo-600 text-white border-indigo-600' },
  { value: 'CONVERTED', label: 'Converted', color: 'border-green-300 bg-green-50 text-green-700', active: 'bg-green-600 text-white border-green-600' },
  { value: 'DEAD', label: 'Dead', color: 'border-slate-300 bg-slate-100 text-slate-500', active: 'bg-slate-500 text-white border-slate-500' },
  { value: 'RETURNED', label: 'Returned', color: 'border-rose-300 bg-rose-50 text-rose-700', active: 'bg-rose-600 text-white border-rose-600' },
  { value: 'UNASSIGNED', label: 'Unassigned', color: 'border-orange-300 bg-orange-50 text-orange-700', active: 'bg-orange-500 text-white border-orange-500' },
];

function FieldRow({ label, value }: { label: string; value: string | null }) {
  if (!value) return null;
  return (
    <div className="grid grid-cols-[140px_1fr] gap-3 py-2 border-b border-slate-50 last:border-b-0">
      <span className="text-xs font-medium text-slate-400 uppercase tracking-wide pt-0.5">
        {label}
      </span>
      <span className="text-sm text-slate-800 break-words">{value}</span>
    </div>
  );
}

function Section({
  title,
  icon: Icon,
  children,
  defaultOpen = true,
}: {
  title: string;
  icon: React.ElementType;
  children: React.ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const childArray = React.Children.toArray(children).filter(Boolean);
  if (childArray.length === 0) return null;

  return (
    <div className="rounded-xl border border-slate-200/80 bg-white overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex w-full items-center gap-2.5 px-4 py-3 bg-slate-50/60 hover:bg-slate-50 transition-colors text-left"
      >
        <Icon className="h-4 w-4 text-slate-400 shrink-0" />
        <span className="text-xs font-bold uppercase tracking-wider text-slate-500 flex-1">
          {title}
        </span>
        {open ? (
          <ChevronDown className="h-3.5 w-3.5 text-slate-400" />
        ) : (
          <ChevronRight className="h-3.5 w-3.5 text-slate-400" />
        )}
      </button>
      {open && <div className="px-4 py-2">{children}</div>}
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
      if (newStatus === lead.status) return;
      setUpdatingStatus(true);
      try {
        await updateLeadStatus(lead.id, newStatus as never);
        router.refresh();
        onUpdated?.();
      } finally {
        setUpdatingStatus(false);
      }
    },
    [lead.id, lead.status, router, onUpdated]
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
  const initials = [lead.firstName?.[0], lead.lastName?.[0]]
    .filter(Boolean)
    .join('')
    .toUpperCase() || '?';

  const metaChips = useMemo(() => {
    const chips: Array<{ label: string; value: string }> = [];
    if (lead.vendor) chips.push({ label: 'Vendor', value: lead.vendor.name });
    if (lead.campaign) chips.push({ label: 'Campaign', value: lead.campaign.name });
    if (lead.assignedUser) chips.push({ label: 'Assigned', value: lead.assignedUser.name });
    if (lead.source) chips.push({ label: 'Source', value: lead.source });
    return chips;
  }, [lead.vendor, lead.campaign, lead.assignedUser, lead.source]);

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center"
      onClick={onClose}
    >
      <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm" />
      <div
        role="dialog"
        aria-modal="true"
        className="relative w-full max-w-2xl bg-white rounded-2xl shadow-2xl border border-slate-200 max-h-[92vh] overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Hero Header */}
        <div className="border-b border-slate-200 px-6 py-5 bg-gradient-to-b from-slate-50 to-white">
          <div className="flex items-start gap-4">
            {/* Monogram */}
            <div className="w-12 h-12 rounded-full bg-gradient-to-br from-blue-600 to-blue-700 flex items-center justify-center text-white font-bold text-lg shadow-sm shrink-0">
              {initials}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h2 className="text-xl font-bold text-slate-900 truncate">
                    {name}
                  </h2>
                  {/* Meta chips */}
                  {metaChips.length > 0 && (
                    <div className="flex flex-wrap gap-2 mt-2">
                      {metaChips.map((chip) => (
                        <span
                          key={chip.label}
                          className="inline-flex items-center gap-1.5 rounded-lg bg-slate-100 px-2.5 py-1 text-xs"
                        >
                          <span className="font-medium text-slate-400">
                            {chip.label}
                          </span>
                          <span className="font-semibold text-slate-700">
                            {chip.value}
                          </span>
                        </span>
                      ))}
                    </div>
                  )}
                </div>
                <button
                  className="text-slate-400 hover:text-slate-600 p-1.5 hover:bg-slate-100 rounded-lg transition-colors shrink-0"
                  onClick={onClose}
                >
                  <X className="h-5 w-5" />
                </button>
              </div>
            </div>
          </div>

          {/* Status pills */}
          <div className="mt-4 flex flex-wrap gap-1.5">
            {ALL_STATUSES.map((s) => (
              <button
                key={s.value}
                type="button"
                disabled={updatingStatus}
                onClick={() => void handleStatusChange(s.value)}
                className={`rounded-full border px-3 py-1 text-[11px] font-semibold transition-all disabled:opacity-60 ${
                  lead.status === s.value
                    ? s.active + ' shadow-sm'
                    : s.color + ' hover:opacity-80'
                }`}
              >
                {s.label}
              </button>
            ))}
            {updatingStatus && (
              <Loader2 className="h-4 w-4 animate-spin text-blue-600 self-center ml-1" />
            )}
          </div>

          {/* Timestamps */}
          <div className="mt-3 flex items-center gap-4 text-[11px] text-slate-400">
            <span>
              Received{' '}
              <span className="font-medium text-slate-500">
                {new Date(lead.receivedAt).toLocaleString()}
              </span>
            </span>
            {lead.assignedAt && (
              <span>
                Assigned{' '}
                <span className="font-medium text-slate-500">
                  {new Date(lead.assignedAt).toLocaleString()}
                </span>
              </span>
            )}
            {lead.price && (
              <span>
                Price{' '}
                <span className="font-semibold text-emerald-600">
                  ${lead.price}
                </span>
              </span>
            )}
          </div>
        </div>

        {/* Scrollable body */}
        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-3 bg-slate-50/30">
          <Section title="Contact" icon={User}>
            <FieldRow label="First Name" value={lead.firstName} />
            <FieldRow label="Last Name" value={lead.lastName} />
            <FieldRow label="Email" value={lead.email} />
            <FieldRow label="Phone" value={lead.phone} />
            <FieldRow label="Home Phone" value={lead.homePhone} />
            <FieldRow label="Work Phone" value={lead.workPhone} />
            <FieldRow label="DOB" value={lead.dob} />
            {(lead.coFirstName || lead.coLastName) && (
              <>
                <div className="mt-3 mb-1 text-[10px] font-bold uppercase tracking-wider text-slate-400 border-t border-slate-100 pt-3">
                  Co-Borrower
                </div>
                <FieldRow label="First Name" value={lead.coFirstName} />
                <FieldRow label="Last Name" value={lead.coLastName} />
                <FieldRow label="Email" value={lead.coEmail} />
                <FieldRow label="Phone" value={lead.coPhone} />
                <FieldRow label="Home Phone" value={lead.coHomePhone} />
                <FieldRow label="Work Phone" value={lead.coWorkPhone} />
                <FieldRow label="DOB" value={lead.coDob} />
              </>
            )}
          </Section>

          <Section title="Address" icon={MapPin}>
            <FieldRow
              label="Mailing"
              value={
                [lead.mailingAddress, lead.mailingCity, lead.mailingState, lead.mailingZip]
                  .filter(Boolean)
                  .join(', ') || null
              }
            />
            <FieldRow label="County" value={lead.mailingCounty} />
            <FieldRow
              label="Property"
              value={
                [lead.propertyAddress, lead.propertyCity, lead.propertyState, lead.propertyZip]
                  .filter(Boolean)
                  .join(', ') || null
              }
            />
            <FieldRow label="Prop. County" value={lead.propertyCounty} />
          </Section>

          <Section title="Property" icon={Home}>
            <FieldRow label="Purchase Price" value={lead.purchasePrice} />
            <FieldRow label="Property Value" value={lead.propertyValue} />
            <FieldRow label="Type" value={lead.propertyType} />
            <FieldRow label="Use" value={lead.propertyUse} />
            <FieldRow label="LTV" value={lead.propertyLtv} />
          </Section>

          <Section title="Employment" icon={Briefcase}>
            <FieldRow label="Employer" value={lead.employer} />
            <FieldRow label="Job Title" value={lead.jobTitle} />
            <FieldRow label="Income" value={lead.income} />
            <FieldRow label="Self Employed" value={lead.selfEmployed} />
            <FieldRow label="Bankruptcy" value={lead.bankruptcy} />
            <FieldRow label="Homeowner" value={lead.homeowner} />
            {(lead.coEmployer || lead.coIncome) && (
              <>
                <div className="mt-3 mb-1 text-[10px] font-bold uppercase tracking-wider text-slate-400 border-t border-slate-100 pt-3">
                  Co-Borrower
                </div>
                <FieldRow label="Employer" value={lead.coEmployer} />
                <FieldRow label="Job Title" value={lead.coJobTitle} />
                <FieldRow label="Income" value={lead.coIncome} />
              </>
            )}
          </Section>

          <Section title="Loan Details" icon={DollarSign}>
            <FieldRow label="Purpose" value={lead.loanPurpose} />
            <FieldRow label="Amount" value={lead.loanAmount} />
            <FieldRow label="Term" value={lead.loanTerm} />
            <FieldRow label="Type" value={lead.loanType} />
            <FieldRow label="Rate" value={lead.loanRate} />
            <FieldRow label="Down Payment" value={lead.downPayment} />
            <FieldRow label="Cash Out" value={lead.cashOut} />
            <FieldRow label="Credit Rating" value={lead.creditRating} />
          </Section>

          <Section title="Current Loan" icon={Landmark} defaultOpen={false}>
            <FieldRow label="Lender" value={lead.currentLender} />
            <FieldRow label="Balance" value={lead.currentBalance} />
            <FieldRow label="Rate" value={lead.currentRate} />
            <FieldRow label="Payment" value={lead.currentPayment} />
            <FieldRow label="Term" value={lead.currentTerm} />
            <FieldRow label="Type" value={lead.currentType} />
            <FieldRow label="Other Balance" value={lead.otherBalance} />
            <FieldRow label="Other Payment" value={lead.otherPayment} />
            <FieldRow label="Target Rate" value={lead.targetRate} />
          </Section>

          <Section title="Military / VA" icon={Shield} defaultOpen={false}>
            <FieldRow label="VA Status" value={lead.vaStatus} />
            <FieldRow label="VA Loan" value={lead.vaLoan} />
            <FieldRow label="Military" value={lead.isMilitary} />
            <FieldRow label="FHA Loan" value={lead.fhaLoan} />
          </Section>

          <Section title="Source / Meta" icon={Tag} defaultOpen={false}>
            <FieldRow label="Source" value={lead.source} />
            <FieldRow label="Source URL" value={lead.sourceUrl} />
            <FieldRow label="Price" value={lead.price} />
          </Section>

          {/* Notes */}
          <div className="rounded-xl border border-slate-200/80 bg-white overflow-hidden">
            <div className="flex items-center gap-2.5 px-4 py-3 bg-slate-50/60">
              <MessageSquare className="h-4 w-4 text-slate-400 shrink-0" />
              <span className="text-xs font-bold uppercase tracking-wider text-slate-500 flex-1">
                Notes ({lead.notes.length})
              </span>
            </div>
            <div className="px-4 py-3">
              {/* Note input */}
              <div className="flex gap-2 mb-3">
                <textarea
                  className="flex-1 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 resize-none min-h-[38px]"
                  placeholder="Write a note..."
                  rows={2}
                  value={noteText}
                  onChange={(e) => setNoteText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      void handleAddNote();
                    }
                  }}
                />
                <button
                  className="self-end inline-flex items-center justify-center rounded-lg bg-blue-600 px-3 h-[38px] text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors shrink-0"
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
                <p className="text-xs text-slate-400 text-center py-4">
                  No notes yet. Add one above.
                </p>
              ) : (
                <div className="space-y-2 max-h-48 overflow-y-auto">
                  {lead.notes.map((note) => (
                    <div
                      key={note.id}
                      className="rounded-lg bg-slate-50 px-3 py-2.5"
                    >
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-xs font-bold text-slate-700">
                          {note.author.name}
                        </span>
                        <span className="text-[10px] text-slate-400">
                          {new Date(note.createdAt).toLocaleString()}
                        </span>
                      </div>
                      <p className="text-xs text-slate-600 whitespace-pre-wrap leading-relaxed">
                        {note.content}
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
