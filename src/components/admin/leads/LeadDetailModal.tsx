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
  Pencil,
  Save,
} from 'lucide-react';
import {
  updateLeadStatus,
  updateLeadFields,
  addLeadNote,
} from '@/app/actions/leadActions';
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
  ssn: string | null;
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
  leadCreated: string | null;
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
  {
    value: 'NEW',
    label: 'New',
    color: 'border-blue-300 bg-blue-50 text-blue-700',
    active: 'bg-blue-600 text-white border-blue-600',
  },
  {
    value: 'CONTACTED',
    label: 'Contacted',
    color: 'border-amber-300 bg-amber-50 text-amber-700',
    active: 'bg-amber-500 text-white border-amber-500',
  },
  {
    value: 'WORKING',
    label: 'Working',
    color: 'border-indigo-300 bg-indigo-50 text-indigo-700',
    active: 'bg-indigo-600 text-white border-indigo-600',
  },
  {
    value: 'CONVERTED',
    label: 'Converted',
    color: 'border-green-300 bg-green-50 text-green-700',
    active: 'bg-green-600 text-white border-green-600',
  },
  {
    value: 'DEAD',
    label: 'Dead',
    color: 'border-slate-300 bg-slate-100 text-slate-500',
    active: 'bg-slate-500 text-white border-slate-500',
  },
  {
    value: 'RETURNED',
    label: 'Returned',
    color: 'border-rose-300 bg-rose-50 text-rose-700',
    active: 'bg-rose-600 text-white border-rose-600',
  },
  {
    value: 'UNASSIGNED',
    label: 'Unassigned',
    color: 'border-orange-300 bg-orange-50 text-orange-700',
    active: 'bg-orange-500 text-white border-orange-500',
  },
];

const EDITABLE_FIELDS: Array<{ key: string; label: string }> = [
  { key: 'firstName', label: 'First Name' },
  { key: 'lastName', label: 'Last Name' },
  { key: 'email', label: 'Email' },
  { key: 'phone', label: 'Phone' },
  { key: 'homePhone', label: 'Home Phone' },
  { key: 'workPhone', label: 'Work Phone' },
  { key: 'dob', label: 'DOB' },
  { key: 'ssn', label: 'SSN' },
  { key: 'coFirstName', label: 'Co First Name' },
  { key: 'coLastName', label: 'Co Last Name' },
  { key: 'coEmail', label: 'Co Email' },
  { key: 'coPhone', label: 'Co Phone' },
  { key: 'coHomePhone', label: 'Co Home Phone' },
  { key: 'coWorkPhone', label: 'Co Work Phone' },
  { key: 'coDob', label: 'Co DOB' },
  { key: 'propertyAddress', label: 'Address' },
  { key: 'propertyCity', label: 'City' },
  { key: 'propertyState', label: 'State' },
  { key: 'propertyZip', label: 'Zip' },
  { key: 'propertyCounty', label: 'County' },
  { key: 'purchasePrice', label: 'Purchase Price' },
  { key: 'propertyValue', label: 'Property Value' },
  { key: 'propertyType', label: 'Property Type' },
  { key: 'propertyUse', label: 'Property Use' },
  { key: 'propertyLtv', label: 'Property LTV' },
  { key: 'employer', label: 'Employer' },
  { key: 'jobTitle', label: 'Job Title' },
  { key: 'income', label: 'Income' },
  { key: 'selfEmployed', label: 'Self Employed' },
  { key: 'bankruptcy', label: 'Bankruptcy' },
  { key: 'homeowner', label: 'Homeowner' },
  { key: 'coEmployer', label: 'Co Employer' },
  { key: 'coJobTitle', label: 'Co Job Title' },
  { key: 'coIncome', label: 'Co Income' },
  { key: 'loanPurpose', label: 'Loan Purpose' },
  { key: 'loanAmount', label: 'Loan Amount' },
  { key: 'loanTerm', label: 'Loan Term' },
  { key: 'loanType', label: 'Loan Type' },
  { key: 'loanRate', label: 'Loan Rate' },
  { key: 'downPayment', label: 'Down Payment' },
  { key: 'cashOut', label: 'Cash Out' },
  { key: 'creditRating', label: 'Credit Rating' },
  { key: 'currentLender', label: 'Current Lender' },
  { key: 'currentBalance', label: 'Current Balance' },
  { key: 'currentRate', label: 'Current Rate' },
  { key: 'currentPayment', label: 'Current Payment' },
  { key: 'currentTerm', label: 'Current Term' },
  { key: 'currentType', label: 'Current Type' },
  { key: 'otherBalance', label: 'Other Balance' },
  { key: 'otherPayment', label: 'Other Payment' },
  { key: 'targetRate', label: 'Target Rate' },
  { key: 'vaStatus', label: 'VA Status' },
  { key: 'vaLoan', label: 'VA Loan' },
  { key: 'isMilitary', label: 'Is Military' },
  { key: 'fhaLoan', label: 'FHA Loan' },
  { key: 'sourceUrl', label: 'Source URL' },
  { key: 'source', label: 'Source' },
  { key: 'leadCreated', label: 'Created Date' },
  { key: 'price', label: 'Price' },
];

function FieldRow({
  label,
  value,
  editing,
  fieldKey,
  editValues,
  onEditChange,
}: {
  label: string;
  value: string | null;
  editing: boolean;
  fieldKey: string;
  editValues: Record<string, string>;
  onEditChange: (key: string, value: string) => void;
}) {
  return (
    <div className="grid grid-cols-[140px_1fr] gap-3 py-2 border-b border-slate-50 last:border-b-0">
      <span className="text-xs font-medium text-slate-400 uppercase tracking-wide pt-1.5">
        {label}
      </span>
      {editing ? (
        <input
          type="text"
          className="rounded-md border border-slate-200 bg-white px-2.5 py-1 text-sm text-slate-800 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500/20"
          value={editValues[fieldKey] ?? ''}
          onChange={(e) => onEditChange(fieldKey, e.target.value)}
          placeholder={`Enter ${label.toLowerCase()}...`}
        />
      ) : (
        <span
          className={`text-sm break-words pt-0.5 ${value ? 'text-slate-800' : 'text-slate-300 italic'}`}
        >
          {value || '—'}
        </span>
      )}
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
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editValues, setEditValues] = useState<Record<string, string>>({});

  const startEditing = useCallback(() => {
    const vals: Record<string, string> = {};
    for (const f of EDITABLE_FIELDS) {
      const v = lead[f.key as keyof LeadDetail];
      vals[f.key] = typeof v === 'string' ? v : '';
    }
    setEditValues(vals);
    setEditing(true);
  }, [lead]);

  const cancelEditing = useCallback(() => {
    setEditing(false);
    setEditValues({});
  }, []);

  const handleEditChange = useCallback((key: string, value: string) => {
    setEditValues((prev) => ({ ...prev, [key]: value }));
  }, []);

  const handleSave = useCallback(async () => {
    const changed: Record<string, string | null> = {};
    for (const f of EDITABLE_FIELDS) {
      const original = lead[f.key as keyof LeadDetail];
      const originalStr = typeof original === 'string' ? original : '';
      const newVal = editValues[f.key] ?? '';
      if (newVal !== originalStr) {
        changed[f.key] = newVal || null;
      }
    }

    if (Object.keys(changed).length === 0) {
      setEditing(false);
      return;
    }

    setSaving(true);
    try {
      await updateLeadFields(lead.id, changed);
      setEditing(false);
      router.refresh();
      onUpdated?.();
    } finally {
      setSaving(false);
    }
  }, [lead, editValues, router, onUpdated]);

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
  const initials =
    [lead.firstName?.[0], lead.lastName?.[0]]
      .filter(Boolean)
      .join('')
      .toUpperCase() || '?';

  const metaChips = useMemo(() => {
    const chips: Array<{ label: string; value: string }> = [];
    if (lead.vendor) chips.push({ label: 'Vendor', value: lead.vendor.name });
    if (lead.campaign)
      chips.push({ label: 'Campaign', value: lead.campaign.name });
    if (lead.assignedUser)
      chips.push({ label: 'Assigned', value: lead.assignedUser.name });
    if (lead.source) chips.push({ label: 'Source', value: lead.source });
    return chips;
  }, [lead.vendor, lead.campaign, lead.assignedUser, lead.source]);

  const fp = {
    editing,
    editValues,
    onEditChange: handleEditChange,
  };

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
        {/* Saving overlay */}
        {saving && (
          <div className="absolute inset-0 z-20 flex items-center justify-center bg-white/90 backdrop-blur-[1px] rounded-2xl">
            <div className="flex flex-col items-center gap-3">
              <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
              <p className="text-sm font-medium text-slate-600">
                Saving changes...
              </p>
            </div>
          </div>
        )}

        {/* Hero Header */}
        <div className="border-b border-slate-200 px-6 py-5 bg-gradient-to-b from-slate-50 to-white">
          <div className="flex items-start gap-4">
            <div className="w-12 h-12 rounded-full bg-gradient-to-br from-blue-600 to-blue-700 flex items-center justify-center text-white font-bold text-lg shadow-sm shrink-0">
              {initials}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h2 className="text-xl font-bold text-slate-900 truncate">
                    {name}
                  </h2>
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
                <div className="flex items-center gap-1.5 shrink-0">
                  {!editing ? (
                    <button
                      type="button"
                      className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50 transition-colors"
                      onClick={startEditing}
                    >
                      <Pencil className="h-3.5 w-3.5" />
                      Edit
                    </button>
                  ) : (
                    <>
                      <button
                        type="button"
                        className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50 transition-colors"
                        onClick={cancelEditing}
                      >
                        Cancel
                      </button>
                      <button
                        type="button"
                        className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-700 transition-colors"
                        onClick={() => void handleSave()}
                        disabled={saving}
                      >
                        <Save className="h-3.5 w-3.5" />
                        Save
                      </button>
                    </>
                  )}
                  <button
                    className="text-slate-400 hover:text-slate-600 p-1.5 hover:bg-slate-100 rounded-lg transition-colors"
                    onClick={onClose}
                  >
                    <X className="h-5 w-5" />
                  </button>
                </div>
              </div>
            </div>
          </div>

          {/* Status dropdown */}
          <div className="mt-4 flex items-center gap-3">
            <span className="text-xs font-medium text-slate-400 uppercase tracking-wide">
              Status
            </span>
            <div className="relative">
              <select
                className={`appearance-none rounded-lg border border-slate-300 bg-white pl-3 pr-8 py-1.5 text-sm font-semibold text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500/20 transition-colors ${
                  lead.assignedUser
                    ? 'cursor-pointer hover:border-slate-400'
                    : 'opacity-60 cursor-not-allowed bg-slate-50'
                }`}
                value={lead.status}
                onChange={(e) => void handleStatusChange(e.target.value)}
                disabled={updatingStatus || !lead.assignedUser}
              >
                {ALL_STATUSES.map((s) => (
                  <option key={s.value} value={s.value}>
                    {s.label}
                  </option>
                ))}
              </select>
              <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 pointer-events-none text-slate-400" />
            </div>
            {updatingStatus && (
              <Loader2 className="h-4 w-4 animate-spin text-blue-600" />
            )}
            {!lead.assignedUser && (
              <span className="text-xs text-slate-400">
                Assign a user to change status
              </span>
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
          <Section title="Contact — Borrower" icon={User}>
            <FieldRow label="First Name" value={lead.firstName} fieldKey="firstName" {...fp} />
            <FieldRow label="Last Name" value={lead.lastName} fieldKey="lastName" {...fp} />
            <FieldRow label="Email" value={lead.email} fieldKey="email" {...fp} />
            <FieldRow label="Phone" value={lead.phone} fieldKey="phone" {...fp} />
            <FieldRow label="Home Phone" value={lead.homePhone} fieldKey="homePhone" {...fp} />
            <FieldRow label="Work Phone" value={lead.workPhone} fieldKey="workPhone" {...fp} />
            <FieldRow label="DOB" value={lead.dob} fieldKey="dob" {...fp} />
            <FieldRow label="SSN" value={lead.ssn} fieldKey="ssn" {...fp} />
          </Section>

          <Section title="Contact — Co-Borrower" icon={User} defaultOpen={false}>
            <FieldRow label="First Name" value={lead.coFirstName} fieldKey="coFirstName" {...fp} />
            <FieldRow label="Last Name" value={lead.coLastName} fieldKey="coLastName" {...fp} />
            <FieldRow label="Email" value={lead.coEmail} fieldKey="coEmail" {...fp} />
            <FieldRow label="Phone" value={lead.coPhone} fieldKey="coPhone" {...fp} />
            <FieldRow label="Home Phone" value={lead.coHomePhone} fieldKey="coHomePhone" {...fp} />
            <FieldRow label="Work Phone" value={lead.coWorkPhone} fieldKey="coWorkPhone" {...fp} />
            <FieldRow label="DOB" value={lead.coDob} fieldKey="coDob" {...fp} />
          </Section>

          <Section title="Address" icon={MapPin}>
            <FieldRow label="Address" value={lead.propertyAddress} fieldKey="propertyAddress" {...fp} />
            <FieldRow label="City" value={lead.propertyCity} fieldKey="propertyCity" {...fp} />
            <FieldRow label="State" value={lead.propertyState} fieldKey="propertyState" {...fp} />
            <FieldRow label="Zip" value={lead.propertyZip} fieldKey="propertyZip" {...fp} />
            <FieldRow label="County" value={lead.propertyCounty} fieldKey="propertyCounty" {...fp} />
          </Section>

          <Section title="Property Details" icon={Home}>
            <FieldRow label="Purchase Price" value={lead.purchasePrice} fieldKey="purchasePrice" {...fp} />
            <FieldRow label="Property Value" value={lead.propertyValue} fieldKey="propertyValue" {...fp} />
            <FieldRow label="Type" value={lead.propertyType} fieldKey="propertyType" {...fp} />
            <FieldRow label="Use" value={lead.propertyUse} fieldKey="propertyUse" {...fp} />
            <FieldRow label="LTV" value={lead.propertyLtv} fieldKey="propertyLtv" {...fp} />
          </Section>

          <Section title="Employment — Borrower" icon={Briefcase}>
            <FieldRow label="Employer" value={lead.employer} fieldKey="employer" {...fp} />
            <FieldRow label="Job Title" value={lead.jobTitle} fieldKey="jobTitle" {...fp} />
            <FieldRow label="Income" value={lead.income} fieldKey="income" {...fp} />
            <FieldRow label="Self Employed" value={lead.selfEmployed} fieldKey="selfEmployed" {...fp} />
            <FieldRow label="Bankruptcy" value={lead.bankruptcy} fieldKey="bankruptcy" {...fp} />
            <FieldRow label="Homeowner" value={lead.homeowner} fieldKey="homeowner" {...fp} />
          </Section>

          <Section title="Employment — Co-Borrower" icon={Briefcase} defaultOpen={false}>
            <FieldRow label="Employer" value={lead.coEmployer} fieldKey="coEmployer" {...fp} />
            <FieldRow label="Job Title" value={lead.coJobTitle} fieldKey="coJobTitle" {...fp} />
            <FieldRow label="Income" value={lead.coIncome} fieldKey="coIncome" {...fp} />
          </Section>

          <Section title="Loan Details" icon={DollarSign}>
            <FieldRow label="Purpose" value={lead.loanPurpose} fieldKey="loanPurpose" {...fp} />
            <FieldRow label="Amount" value={lead.loanAmount} fieldKey="loanAmount" {...fp} />
            <FieldRow label="Term" value={lead.loanTerm} fieldKey="loanTerm" {...fp} />
            <FieldRow label="Type" value={lead.loanType} fieldKey="loanType" {...fp} />
            <FieldRow label="Rate" value={lead.loanRate} fieldKey="loanRate" {...fp} />
            <FieldRow label="Down Payment" value={lead.downPayment} fieldKey="downPayment" {...fp} />
            <FieldRow label="Cash Out" value={lead.cashOut} fieldKey="cashOut" {...fp} />
            <FieldRow label="Credit Rating" value={lead.creditRating} fieldKey="creditRating" {...fp} />
          </Section>

          <Section title="Current Loan" icon={Landmark} defaultOpen={false}>
            <FieldRow label="Lender" value={lead.currentLender} fieldKey="currentLender" {...fp} />
            <FieldRow label="Balance" value={lead.currentBalance} fieldKey="currentBalance" {...fp} />
            <FieldRow label="Rate" value={lead.currentRate} fieldKey="currentRate" {...fp} />
            <FieldRow label="Payment" value={lead.currentPayment} fieldKey="currentPayment" {...fp} />
            <FieldRow label="Term" value={lead.currentTerm} fieldKey="currentTerm" {...fp} />
            <FieldRow label="Type" value={lead.currentType} fieldKey="currentType" {...fp} />
            <FieldRow label="Other Balance" value={lead.otherBalance} fieldKey="otherBalance" {...fp} />
            <FieldRow label="Other Payment" value={lead.otherPayment} fieldKey="otherPayment" {...fp} />
            <FieldRow label="Target Rate" value={lead.targetRate} fieldKey="targetRate" {...fp} />
          </Section>

          <Section title="Military / VA" icon={Shield} defaultOpen={false}>
            <FieldRow label="VA Status" value={lead.vaStatus} fieldKey="vaStatus" {...fp} />
            <FieldRow label="VA Loan" value={lead.vaLoan} fieldKey="vaLoan" {...fp} />
            <FieldRow label="Military" value={lead.isMilitary} fieldKey="isMilitary" {...fp} />
            <FieldRow label="FHA Loan" value={lead.fhaLoan} fieldKey="fhaLoan" {...fp} />
          </Section>

          <Section title="Source / Meta" icon={Tag} defaultOpen={false}>
            <FieldRow label="Source" value={lead.source} fieldKey="source" {...fp} />
            <FieldRow label="Source URL" value={lead.sourceUrl} fieldKey="sourceUrl" {...fp} />
            <FieldRow label="Created Date" value={lead.leadCreated} fieldKey="leadCreated" {...fp} />
            <FieldRow label="Price" value={lead.price} fieldKey="price" {...fp} />
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
