'use client';

import React, { useState } from 'react';
import { X, ClipboardCheck, ShieldCheck } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { createSubmissionTask } from '@/app/actions/taskActions';

type NewTaskModalProps = {
  open: boolean;
  onClose: () => void;
  loanOfficerName: string;
};

type SubmissionType = 'DISCLOSURES' | 'QC';

export function NewTaskModal({ open, onClose, loanOfficerName }: NewTaskModalProps) {
  const [type, setType] = useState<SubmissionType>('DISCLOSURES');
  const [submitted, setSubmitted] = useState(false);
  const router = useRouter();

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center">
      <div className="absolute inset-0 bg-slate-900/30 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-3xl bg-white rounded-2xl shadow-xl border border-slate-200 p-6 max-h-[85vh] overflow-hidden flex flex-col">
        <div className="flex items-start justify-between">
          <div>
            <h2 className="text-xl font-bold text-slate-900">New Task Submission</h2>
            <p className="text-sm text-slate-500 mt-1">
              Choose a submission type and complete the required fields.
            </p>
          </div>
          <button
            className="p-2 rounded-lg hover:bg-slate-100 text-slate-500"
            onClick={onClose}
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="mt-6 flex gap-3">
          <TypeButton
            active={type === 'DISCLOSURES'}
            icon={ClipboardCheck}
            title="Submit for Disclosures"
            description="Send loan info to the Disclosure Team"
            onClick={() => setType('DISCLOSURES')}
          />
          <TypeButton
            active={type === 'QC'}
            icon={ShieldCheck}
            title="Submit for QC"
            description="Send loan to Quality Control"
            onClick={() => setType('QC')}
          />
        </div>

        <div className="mt-6 overflow-y-auto pr-1">
          {type === 'DISCLOSURES' ? (
            <DisclosuresForm
              loanOfficerName={loanOfficerName}
              onSubmitted={() => {
                setSubmitted(true);
                onClose();
                router.refresh();
              }}
            />
          ) : (
            <QcForm
              loanOfficerName={loanOfficerName}
              onSubmitted={() => {
                setSubmitted(true);
                onClose();
                router.refresh();
              }}
            />
          )}
        </div>

        {submitted && (
          <div className="mt-4 p-3 rounded-lg bg-emerald-50 border border-emerald-100 text-emerald-700 text-sm">
            Submission received. We will route this to the appropriate team.
          </div>
        )}
      </div>
    </div>
  );
}

type MismoPrefill = {
  loanOfficer?: string;
  borrowerFirstName?: string;
  borrowerLastName?: string;
  arriveLoanNumber?: string;
  channel?: string;
  investor?: string;
  loanType?: string;
  loanProgram?: string;
  loanAmount?: string;
};

function parseMismoXml(xmlText: string): MismoPrefill {
  const parser = new DOMParser();
  const doc = parser.parseFromString(xmlText, 'application/xml');
  if (doc.getElementsByTagName('parsererror').length > 0) {
    throw new Error('Invalid XML');
  }

  const getText = (parent: Element | Document | null, localName: string) => {
    if (!parent) return '';
    const el = parent.getElementsByTagNameNS('*', localName)[0];
    return el?.textContent?.trim() ?? '';
  };

  const getTextFromElement = (el: Element | null, localName: string) => {
    if (!el) return '';
    const node = el.getElementsByTagNameNS('*', localName)[0];
    return node?.textContent?.trim() ?? '';
  };

  const findPartyByRole = (roleType: string) => {
    const parties = Array.from(doc.getElementsByTagNameNS('*', 'PARTY'));
    for (const party of parties) {
      const roleTypes = Array.from(party.getElementsByTagNameNS('*', 'PartyRoleType')).map(
        (n) => n.textContent?.trim()
      );
      if (roleTypes.includes(roleType)) return party;
    }
    return null;
  };

  const borrowerParty = findPartyByRole('Borrower');
  const loanOriginatorParty = findPartyByRole('LoanOriginator');

  const borrowerFirstName = getTextFromElement(borrowerParty, 'FirstName');
  const borrowerLastName = getTextFromElement(borrowerParty, 'LastName');
  const loanOfficer = getTextFromElement(loanOriginatorParty, 'FullName') ||
    [getTextFromElement(loanOriginatorParty, 'FirstName'), getTextFromElement(loanOriginatorParty, 'LastName')].filter(Boolean).join(' ');

  const loanIdentifiers = Array.from(doc.getElementsByTagNameNS('*', 'LOAN_IDENTIFIER'));
  let arriveLoanNumber = '';
  for (const id of loanIdentifiers) {
    const type = getTextFromElement(id, 'LoanIdentifierType');
    if (type === 'LenderLoan') {
      arriveLoanNumber = getTextFromElement(id, 'LoanIdentifier');
      break;
    }
  }
  if (!arriveLoanNumber && loanIdentifiers.length > 0) {
    arriveLoanNumber = getTextFromElement(loanIdentifiers[0], 'LoanIdentifier');
  }

  const loanOriginatorType = getText(doc, 'LoanOriginatorType');
  const channel = loanOriginatorType === 'Broker' || loanOriginatorType === 'Correspondent'
    ? loanOriginatorType
    : '';

  const investor = getText(doc, 'ProductProviderName');

  const mortgageType = getText(doc, 'MortgageType');
  const loanType =
    ['Conventional', 'FHA', 'VA'].includes(mortgageType) ? mortgageType : '';

  const loanProgram = '';
  const loanAmount =
    getText(doc, 'BaseLoanAmount') || getText(doc, 'NoteAmount');

  return {
    loanOfficer,
    borrowerFirstName,
    borrowerLastName,
    arriveLoanNumber,
    channel,
    investor,
    loanType,
    loanProgram,
    loanAmount,
  };
}

function TypeButton({
  active,
  icon: Icon,
  title,
  description,
  onClick,
}: {
  active: boolean;
  icon: React.ElementType;
  title: string;
  description: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex-1 text-left p-4 rounded-xl border transition-all ${
        active
          ? 'border-blue-500 bg-blue-50 shadow-sm'
          : 'border-slate-200 hover:border-slate-300 hover:bg-slate-50'
      }`}
    >
      <div className="flex items-center gap-3">
        <div
          className={`w-10 h-10 rounded-lg flex items-center justify-center ${
            active ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-600'
          }`}
        >
          <Icon className="w-5 h-5" />
        </div>
        <div>
          <p className="font-semibold text-slate-900">{title}</p>
          <p className="text-xs text-slate-500 mt-0.5">{description}</p>
        </div>
      </div>
    </button>
  );
}

function DisclosuresForm({
  loanOfficerName,
  onSubmitted,
}: {
  loanOfficerName: string;
  onSubmitted: () => void;
}) {
  const [form, setForm] = useState({
    loanOfficer: loanOfficerName,
    borrowerFirstName: '',
    borrowerLastName: '',
    arriveLoanNumber: '',
    channel: '',
    investor: '',
    loanType: '',
    loanProgram: '',
    loanAmount: '',
    aus: '',
    creditReportType: '',
    notes: '',
  });
  const [importError, setImportError] = useState('');

  const update = (key: keyof typeof form, value: string) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    createSubmissionTask({
      submissionType: 'DISCLOSURES',
      loanOfficerName: form.loanOfficer,
      borrowerFirstName: form.borrowerFirstName,
      borrowerLastName: form.borrowerLastName,
      arriveLoanNumber: form.arriveLoanNumber,
      loanAmount: form.loanAmount,
      notes: form.notes,
    }).then((res) => {
      if (res.success) onSubmitted();
    });
  };

  const handleFileUpload = async (file: File | null) => {
    if (!file) return;
    try {
      const text = await file.text();
      const prefill = parseMismoXml(text);
      setImportError('');
      setForm((prev) => ({
        ...prev,
        loanOfficer: prefill.loanOfficer || prev.loanOfficer,
        borrowerFirstName: prefill.borrowerFirstName || prev.borrowerFirstName,
        borrowerLastName: prefill.borrowerLastName || prev.borrowerLastName,
        arriveLoanNumber: prefill.arriveLoanNumber || prev.arriveLoanNumber,
        channel: prefill.channel || prev.channel,
        investor: prefill.investor || prev.investor,
        loanType: prefill.loanType || prev.loanType,
        loanProgram: prefill.loanProgram || prev.loanProgram,
        loanAmount: prefill.loanAmount || prev.loanAmount,
      }));
    } catch {
      setImportError('Could not read this MISMO file. Please verify the XML export.');
    }
  };

  return (
    <form onSubmit={submit} className="space-y-4">
      <SectionTitle title="Disclosure Submission Details" />
      <FileUpload onFileSelected={handleFileUpload} />
      {importError && (
        <p className="text-xs text-red-600">{importError}</p>
      )}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Input label="Loan Officer" value={form.loanOfficer} onChange={(v) => update('loanOfficer', v)} />
        <Input label="Arrive Loan Number" value={form.arriveLoanNumber} onChange={(v) => update('arriveLoanNumber', v)} required />
        <Input label="Borrower First Name" value={form.borrowerFirstName} onChange={(v) => update('borrowerFirstName', v)} required />
        <Input label="Borrower Last Name" value={form.borrowerLastName} onChange={(v) => update('borrowerLastName', v)} required />
        <Select label="Channel" value={form.channel} onChange={(v) => update('channel', v)} options={['Broker', 'Correspondent']} required />
        <Input label="Investor" value={form.investor} onChange={(v) => update('investor', v)} required />
        <Select label="Loan Type" value={form.loanType} onChange={(v) => update('loanType', v)} options={['Conventional', 'FHA', 'VA', 'Heloc', 'Heloan', 'Non QM']} required />
        <Select label="Loan Program" value={form.loanProgram} onChange={(v) => update('loanProgram', v)} options={['Cash out', 'Rate and Term', 'IRRRL', 'Streamline', 'Purchase']} required />
        <Input label="Loan Amount" value={form.loanAmount} onChange={(v) => update('loanAmount', v)} required />
        <Select label="AUS" value={form.aus} onChange={(v) => update('aus', v)} options={['DU', 'LP', 'Manual UW']} required />
        <Select label="Credit Report Type" value={form.creditReportType} onChange={(v) => update('creditReportType', v)} options={['Soft Check', 'Hard Report']} required />
      </div>
      <Textarea label="Notes / Special Instructions" value={form.notes} onChange={(v) => update('notes', v)} />

      <div className="flex justify-end gap-3 pt-2">
        <button type="button" className="px-4 py-2 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50">
          Save Draft
        </button>
        <button type="submit" className="px-4 py-2 rounded-lg bg-blue-600 text-white hover:bg-blue-700 shadow-sm">
          Submit for Disclosures
        </button>
      </div>
    </form>
  );
}

function QcForm({
  loanOfficerName,
  onSubmitted,
}: {
  loanOfficerName: string;
  onSubmitted: () => void;
}) {
  const [form, setForm] = useState({
    preApproved: '',
    loanOfficer: loanOfficerName,
    secondaryLoanOfficer: '',
    borrowerFirstName: '',
    borrowerLastName: '',
    arriveLoanNumber: '',
    channel: '',
    investor: '',
    loanType: '',
    loanProgram: '',
    loanAmount: '',
    cashBack: '',
    projectedRevenue: '',
    aus: '',
    creditReportType: '',
    uwmFreeCreditUsed: '',
    communityPropertyState: '',
    creditReportNotesExp: '',
    creditReportNotesEqf: '',
    creditReportNotesTui: '',
    titleCompany: '',
    appraisalWaiver: '',
    notesGoals: '',
  });
  const [importError, setImportError] = useState('');

  const update = (key: keyof typeof form, value: string) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    createSubmissionTask({
      submissionType: 'QC',
      loanOfficerName: form.loanOfficer,
      borrowerFirstName: form.borrowerFirstName,
      borrowerLastName: form.borrowerLastName,
      arriveLoanNumber: form.arriveLoanNumber,
      loanAmount: form.loanAmount,
      notes: form.notesGoals,
    }).then((res) => {
      if (res.success) onSubmitted();
    });
  };

  const handleFileUpload = async (file: File | null) => {
    if (!file) return;
    try {
      const text = await file.text();
      const prefill = parseMismoXml(text);
      setImportError('');
      setForm((prev) => ({
        ...prev,
        loanOfficer: prefill.loanOfficer || prev.loanOfficer,
        borrowerFirstName: prefill.borrowerFirstName || prev.borrowerFirstName,
        borrowerLastName: prefill.borrowerLastName || prev.borrowerLastName,
        arriveLoanNumber: prefill.arriveLoanNumber || prev.arriveLoanNumber,
        channel: prefill.channel || prev.channel,
        investor: prefill.investor || prev.investor,
        loanType: prefill.loanType || prev.loanType,
        loanProgram: prefill.loanProgram || prev.loanProgram,
        loanAmount: prefill.loanAmount || prev.loanAmount,
      }));
    } catch {
      setImportError('Could not read this MISMO file. Please verify the XML export.');
    }
  };

  return (
    <form onSubmit={submit} className="space-y-4">
      <SectionTitle title="QC Submission Details" />
      <FileUpload onFileSelected={handleFileUpload} />
      {importError && (
        <p className="text-xs text-red-600">{importError}</p>
      )}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Input label="Loan Officer" value={form.loanOfficer} onChange={(v) => update('loanOfficer', v)} />
        <Input label="Secondary Loan Officer" value={form.secondaryLoanOfficer} onChange={(v) => update('secondaryLoanOfficer', v)} />
        <Input label="Borrower First Name" value={form.borrowerFirstName} onChange={(v) => update('borrowerFirstName', v)} required />
        <Input label="Borrower Last Name" value={form.borrowerLastName} onChange={(v) => update('borrowerLastName', v)} required />
        <Input label="Arrive Loan Number" value={form.arriveLoanNumber} onChange={(v) => update('arriveLoanNumber', v)} required />
        <RadioGroup
          label="Is loan in Pre-Approved Status in Arrive?"
          value={form.preApproved}
          onChange={(v) => update('preApproved', v)}
          options={['Yes', 'No']}
          required
        />
        <Select label="Channel" value={form.channel} onChange={(v) => update('channel', v)} options={['Broker', 'Correspondent']} required />
        <Input label="Investor" value={form.investor} onChange={(v) => update('investor', v)} required />
        <Select label="Loan Type" value={form.loanType} onChange={(v) => update('loanType', v)} options={['Conventional', 'FHA', 'VA', 'Heloc', 'Heloan', 'Non QM']} required />
        <Select label="Loan Program" value={form.loanProgram} onChange={(v) => update('loanProgram', v)} options={['Cash out', 'Rate and Term', 'IRRRL', 'Streamline', 'Purchase']} required />
        <Input label="Loan Amount" value={form.loanAmount} onChange={(v) => update('loanAmount', v)} required />
        <Input label="Cash Back" value={form.cashBack} onChange={(v) => update('cashBack', v)} />
        <Input label="Projected Revenue" value={form.projectedRevenue} onChange={(v) => update('projectedRevenue', v)} />
        <Select label="AUS" value={form.aus} onChange={(v) => update('aus', v)} options={['DU', 'LP', 'Manual UW']} required />
        <Select label="Credit Report Type" value={form.creditReportType} onChange={(v) => update('creditReportType', v)} options={['Soft Check', 'Hard Report']} required />
        <RadioGroup
          label="Was UWM free credit used?"
          value={form.uwmFreeCreditUsed}
          onChange={(v) => update('uwmFreeCreditUsed', v)}
          options={['Yes', 'No']}
          required
        />
        <RadioGroup
          label="Community Property State - is NBS credit pulled and in liabilities? (FHA/VA)"
          value={form.communityPropertyState}
          onChange={(v) => update('communityPropertyState', v)}
          options={['Yes', 'No']}
          required
        />
        <CreditReportNotes
          label="Credit Report Notes (scores/bureaus used)"
          exp={form.creditReportNotesExp}
          eqf={form.creditReportNotesEqf}
          tui={form.creditReportNotesTui}
          onChange={(field, value) =>
            update(
              field === 'EXP'
                ? 'creditReportNotesExp'
                : field === 'EQF'
                ? 'creditReportNotesEqf'
                : 'creditReportNotesTui',
              value
            )
          }
        />
        <Select label="Title" value={form.titleCompany} onChange={(v) => update('titleCompany', v)} options={['Acrisure', 'Unisource', 'BCHH', 'ServiceLink']} required />
        <RadioGroup
          label="Appraisal Waiver"
          value={form.appraisalWaiver}
          onChange={(v) => update('appraisalWaiver', v)}
          options={['Yes', 'No']}
          required
        />
      </div>
      <Textarea label="Notes / Goals" value={form.notesGoals} onChange={(v) => update('notesGoals', v)} />

      <div className="flex justify-end gap-3 pt-2">
        <button type="button" className="px-4 py-2 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50">
          Save Draft
        </button>
        <button type="submit" className="px-4 py-2 rounded-lg bg-blue-600 text-white hover:bg-blue-700 shadow-sm">
          Submit for QC
        </button>
      </div>
    </form>
  );
}

function SectionTitle({ title }: { title: string }) {
  return <h3 className="text-sm font-semibold text-slate-900">{title}</h3>;
}

function FileUpload({ onFileSelected }: { onFileSelected: (file: File | null) => void }) {
  return (
    <label className="block">
      <span className="text-xs font-semibold text-slate-600 uppercase tracking-wider">
        Upload MISMO 3.4 (.xml) to auto-fill
      </span>
      <div className="mt-2 flex items-center gap-3">
        <input
          type="file"
          accept=".xml"
          onChange={(e) => onFileSelected(e.target.files?.[0] || null)}
          className="text-sm text-slate-600 file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-medium file:bg-slate-100 file:text-slate-700 hover:file:bg-slate-200"
        />
      </div>
    </label>
  );
}

function Input({
  label,
  value,
  onChange,
  required,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  required?: boolean;
}) {
  return (
    <label className="space-y-1 text-sm">
      <span className="text-slate-700 font-medium">{label}{required ? ' *' : ''}</span>
      <input
        className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        required={required}
      />
    </label>
  );
}

function Textarea({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <label className="space-y-1 text-sm block">
      <span className="text-slate-700 font-medium">{label}</span>
      <textarea
        className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 min-h-[96px]"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </label>
  );
}

function Select({
  label,
  value,
  onChange,
  options,
  required,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: string[];
  required?: boolean;
}) {
  return (
    <label className="space-y-1 text-sm">
      <span className="text-slate-700 font-medium">{label}{required ? ' *' : ''}</span>
      <select
        className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        required={required}
      >
        <option value="">Select...</option>
        {options.map((opt) => (
          <option key={opt} value={opt}>
            {opt}
          </option>
        ))}
      </select>
    </label>
  );
}

function RadioGroup({
  label,
  value,
  onChange,
  options,
  required,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: string[];
  required?: boolean;
}) {
  return (
    <fieldset className="space-y-2 text-sm">
      <legend className="text-slate-700 font-medium">{label}{required ? ' *' : ''}</legend>
      <div className="flex flex-wrap gap-4">
        {options.map((opt) => (
          <label key={opt} className="inline-flex items-center gap-2 text-slate-600">
            <input
              type="radio"
              name={label}
              value={opt}
              checked={value === opt}
              onChange={(e) => onChange(e.target.value)}
              required={required}
            />
            {opt}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

function CreditReportNotes({
  label,
  exp,
  eqf,
  tui,
  onChange,
}: {
  label: string;
  exp: string;
  eqf: string;
  tui: string;
  onChange: (field: 'EXP' | 'EQF' | 'TUI', value: string) => void;
}) {
  return (
    <div className="space-y-1 text-sm md:col-span-1">
      <span className="text-slate-700 font-medium block">{label}</span>
      <div className="grid grid-cols-3 gap-2">
        <input
          className="w-full rounded-lg border border-slate-200 bg-white px-2 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 text-center"
          placeholder="EXP"
          maxLength={3}
          value={exp}
          onChange={(e) => onChange('EXP', e.target.value)}
        />
        <input
          className="w-full rounded-lg border border-slate-200 bg-white px-2 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 text-center"
          placeholder="EQF"
          maxLength={3}
          value={eqf}
          onChange={(e) => onChange('EQF', e.target.value)}
        />
        <input
          className="w-full rounded-lg border border-slate-200 bg-white px-2 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 text-center"
          placeholder="TUI"
          maxLength={3}
          value={tui}
          onChange={(e) => onChange('TUI', e.target.value)}
        />
      </div>
    </div>
  );
}
