'use client';

import React, { useEffect, useRef, useState } from 'react';
import { X, ClipboardCheck, ShieldCheck, Loader2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { createSubmissionTask } from '@/app/actions/taskActions';
import { createTaskAttachmentUploadUrl, finalizeTaskAttachment } from '@/app/actions/attachmentActions';
import { TaskAttachmentPurpose } from '@prisma/client';
import { attachClientDocumentsToTask, getClientFolderForLoan, getMyPipelineClients } from '@/app/actions/clientFolderActions';

type NewTaskModalProps = {
  open: boolean;
  onClose: () => void;
  loanOfficerName: string;
  initialType?: SubmissionType;
};

type SubmissionType = 'DISCLOSURES' | 'QC';
type PipelineLoanOption = {
  id: string;
  loanNumber: string;
  borrowerName: string;
  borrowerPhone: string | null;
  borrowerEmail: string | null;
};
type ClientFolderDocOption = { id: string; filename: string; createdAt: Date };

export function NewTaskModal({ open, onClose, loanOfficerName, initialType = 'DISCLOSURES' }: NewTaskModalProps) {
  const [type, setType] = useState<SubmissionType>(initialType);
  const [submitted, setSubmitted] = useState(false);
  const router = useRouter();
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (open) {
      setType(initialType);
      setSubmitted(false);
    }
  }, [open, initialType]);

  useEffect(() => {
    if (!open) return;

    closeButtonRef.current?.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center">
      <div className="absolute inset-0 bg-slate-900/30 backdrop-blur-sm" onClick={onClose} />
      <div
        role="dialog"
        aria-modal="true"
        className="relative w-full max-w-3xl bg-white rounded-2xl shadow-xl border border-slate-200 p-6 max-h-[85vh] overflow-hidden flex flex-col"
      >
        <div className="flex items-start justify-between">
          <div>
            <h2 className="text-xl font-bold text-slate-900">New Task Submission</h2>
            <p className="text-sm text-slate-500 mt-1">
              Choose a submission type and complete the required fields.
            </p>
          </div>
          <button
            ref={closeButtonRef}
            className="app-icon-btn"
            onClick={onClose}
            aria-label="Close modal"
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
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [form, setForm] = useState({
    loanOfficer: loanOfficerName,
    borrowerFirstName: '',
    borrowerLastName: '',
    borrowerPhone: '',
    borrowerEmail: '',
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
    if (isSubmitting) return;
    setIsSubmitting(true);
    createSubmissionTask({
      submissionType: 'DISCLOSURES',
      loanOfficerName: form.loanOfficer,
      borrowerFirstName: form.borrowerFirstName,
      borrowerLastName: form.borrowerLastName,
      borrowerPhone: form.borrowerPhone,
      borrowerEmail: form.borrowerEmail,
      arriveLoanNumber: form.arriveLoanNumber,
      loanAmount: form.loanAmount,
      notes: form.notes,
      submissionData: form,
    }).then((res) => {
      if (res.success) {
        onSubmitted();
      } else {
        setIsSubmitting(false);
      }
    }).catch(() => {
      setIsSubmitting(false);
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
        <Input label="Borrower Phone (recommended)" value={form.borrowerPhone} onChange={(v) => update('borrowerPhone', v)} />
        <Input label="Borrower Email" value={form.borrowerEmail} onChange={(v) => update('borrowerEmail', v)} />
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
        <button type="button" className="app-btn-secondary">
          Save Draft
        </button>
        <button
          type="submit"
          disabled={isSubmitting}
          className="app-btn-primary disabled:opacity-70 disabled:cursor-not-allowed"
        >
          {isSubmitting && <Loader2 className="w-4 h-4 animate-spin" />}
          {isSubmitting ? 'Processing...' : 'Submit for Disclosures'}
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
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [stipFiles, setStipFiles] = useState<File[]>([]);
  const [stipError, setStipError] = useState('');
  const [pipelineLoans, setPipelineLoans] = useState<PipelineLoanOption[]>([]);
  const [selectedPipelineLoanId, setSelectedPipelineLoanId] = useState<string>('');
  const [clientFolderDocs, setClientFolderDocs] = useState<ClientFolderDocOption[]>([]);
  const [selectedDocIds, setSelectedDocIds] = useState<string[]>([]);
  const [form, setForm] = useState({
    preApproved: '',
    loanOfficer: loanOfficerName,
    secondaryLoanOfficer: '',
    borrowerFirstName: '',
    borrowerLastName: '',
    borrowerPhone: '',
    borrowerEmail: '',
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
  const [submitError, setSubmitError] = useState('');

  const update = (key: keyof typeof form, value: string) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  useEffect(() => {
    const load = async () => {
      const result = await getMyPipelineClients();
      if (result.success && Array.isArray(result.loans)) {
        setPipelineLoans(
          result.loans.map((l) => ({
            id: l.id,
            loanNumber: l.loanNumber,
            borrowerName: l.borrowerName,
            borrowerPhone: l.borrowerPhone ?? null,
            borrowerEmail: l.borrowerEmail ?? null,
          }))
        );
      }
    };
    load();
  }, []);

  useEffect(() => {
    if (!selectedPipelineLoanId) {
      return;
    }

    const loadDocs = async () => {
      const folder = await getClientFolderForLoan(selectedPipelineLoanId);
      if (folder.success && Array.isArray(folder.documents)) {
        setClientFolderDocs(
          folder.documents.map((d) => ({
            id: d.id,
            filename: d.filename,
            createdAt: d.createdAt,
          }))
        );
      } else {
        setClientFolderDocs([]);
      }
    };
    loadDocs();
  }, [selectedPipelineLoanId, pipelineLoans]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmitting) return;
    setSubmitError('');

    if (stipFiles.length < 1) {
      setStipError('Initial STIPs are required (upload at least 1 file).');
      return;
    }

    setStipError('');
    setIsSubmitting(true);

    try {
      const res = await createSubmissionTask({
        submissionType: 'QC',
        loanOfficerName: form.loanOfficer,
        borrowerFirstName: form.borrowerFirstName,
        borrowerLastName: form.borrowerLastName,
        borrowerPhone: form.borrowerPhone,
        borrowerEmail: form.borrowerEmail,
        arriveLoanNumber: form.arriveLoanNumber,
        loanAmount: form.loanAmount,
        notes: form.notesGoals,
        submissionData: form,
      });

      if (!res.success || !res.taskId) {
        setSubmitError(res.error || 'Failed to submit QC task.');
        setIsSubmitting(false);
        return;
      }

      // Upload required STIPs and attach to task
      for (const file of stipFiles) {
        const upload = await createTaskAttachmentUploadUrl({
          taskId: res.taskId,
          purpose: TaskAttachmentPurpose.STIP,
          filename: file.name,
        });

        if (!upload.success || !upload.signedUrl || !upload.path) {
          setSubmitError(upload.error || 'Failed to create upload URL.');
          setIsSubmitting(false);
          return;
        }

        const put = await fetch(upload.signedUrl, {
          method: 'PUT',
          headers: {
            'Content-Type': file.type || 'application/octet-stream',
          },
          body: file,
        });

        if (!put.ok) {
          setSubmitError('Failed to upload a STIP file. Please try again.');
          setIsSubmitting(false);
          return;
        }

        const saved = await finalizeTaskAttachment({
          taskId: res.taskId,
          purpose: TaskAttachmentPurpose.STIP,
          storagePath: upload.path,
          filename: file.name,
          contentType: file.type || 'application/octet-stream',
          sizeBytes: file.size,
        });

        if (!saved.success) {
          setSubmitError(saved.error || 'Failed to save uploaded file.');
          setIsSubmitting(false);
          return;
        }
      }

      if (selectedDocIds.length > 0) {
        const attached = await attachClientDocumentsToTask({
          taskId: res.taskId,
          documentIds: selectedDocIds,
          purpose: TaskAttachmentPurpose.STIP,
        });
        if (!attached.success) {
          setSubmitError(attached.error || 'Failed to attach client documents.');
          setIsSubmitting(false);
          return;
        }
      }

      onSubmitted();
    } catch (error) {
      console.error(error);
      setSubmitError('Failed to submit QC task.');
      setIsSubmitting(false);
    }
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

      <div className="rounded-xl border border-slate-200 bg-white p-4">
        <p className="text-sm font-semibold text-slate-900">Select Client (optional)</p>
        <p className="text-xs text-slate-500 mt-0.5">
          Pick a client from your pipeline to auto-fill and optionally include docs from their folder.
        </p>
        <select
          value={selectedPipelineLoanId}
          onChange={(e) => {
            const nextLoanId = e.target.value;
            setSelectedPipelineLoanId(nextLoanId);
            if (!nextLoanId) {
              setClientFolderDocs([]);
              setSelectedDocIds([]);
              return;
            }
            const loan = pipelineLoans.find((l) => l.id === nextLoanId);
            if (!loan) return;
            const parts = (loan.borrowerName || '').trim().split(/\s+/).filter(Boolean);
            const first = parts[0] || '';
            const last = parts.length > 1 ? parts.slice(1).join(' ') : '';
            setForm((prev) => ({
              ...prev,
              borrowerFirstName: first || prev.borrowerFirstName,
              borrowerLastName: last || prev.borrowerLastName,
              arriveLoanNumber: loan.loanNumber || prev.arriveLoanNumber,
              borrowerPhone: loan.borrowerPhone || prev.borrowerPhone,
              borrowerEmail: loan.borrowerEmail || prev.borrowerEmail,
            }));
          }}
          disabled={isSubmitting}
          className="mt-3 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 disabled:opacity-60"
        >
          <option value="">No selection</option>
          {pipelineLoans.map((l) => (
            <option key={l.id} value={l.id}>
              {l.borrowerName} • {l.loanNumber}
            </option>
          ))}
        </select>

        {clientFolderDocs.length > 0 && (
          <div className="mt-3">
            <p className="text-xs font-semibold text-slate-600 uppercase tracking-wide">
              Include from Client Folder
            </p>
            <div className="mt-2 max-h-36 overflow-y-auto space-y-2 pr-1">
              {clientFolderDocs.map((d) => {
                const checked = selectedDocIds.includes(d.id);
                return (
                  <label
                    key={d.id}
                    className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 bg-slate-50/50 px-3 py-2"
                  >
                    <div className="min-w-0">
                      <p className="text-xs font-semibold text-slate-700 truncate">{d.filename}</p>
                      <p className="text-[10px] text-slate-400">
                        {new Date(d.createdAt).toLocaleDateString()}
                      </p>
                    </div>
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => {
                        setSelectedDocIds((prev) =>
                          checked ? prev.filter((id) => id !== d.id) : [...prev, d.id]
                        );
                      }}
                      disabled={isSubmitting}
                    />
                  </label>
                );
              })}
            </div>
          </div>
        )}
      </div>

      <div className="rounded-xl border border-slate-200 bg-slate-50/50 p-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-sm font-semibold text-slate-900">Initial STIPs (required)</p>
            <p className="text-xs text-slate-500 mt-0.5">
              Upload at least 1 file (PDF/Image/Doc). These will be attached to the QC task.
            </p>
          </div>
          <span className="text-xs font-semibold text-slate-700 rounded-full border border-slate-200 bg-white px-2 py-1">
            {stipFiles.length} selected
          </span>
        </div>

        <div className="mt-3">
          <input
            type="file"
            multiple
            accept="application/pdf,image/*,.doc,.docx"
            disabled={isSubmitting}
            onChange={(e) => {
              const files = Array.from(e.target.files || []);
              setStipFiles(files);
              if (files.length) setStipError('');
              e.currentTarget.value = '';
            }}
            className="block w-full text-sm text-slate-600 file:mr-3 file:rounded-lg file:border-0 file:bg-slate-100 file:px-3 file:py-2 file:text-sm file:font-semibold file:text-slate-700 hover:file:bg-slate-200 disabled:opacity-60"
          />
          {stipError && <p className="mt-2 text-xs text-red-600">{stipError}</p>}
        </div>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Input label="Loan Officer" value={form.loanOfficer} onChange={(v) => update('loanOfficer', v)} />
        <Input label="Secondary Loan Officer" value={form.secondaryLoanOfficer} onChange={(v) => update('secondaryLoanOfficer', v)} />
        <Input label="Borrower First Name" value={form.borrowerFirstName} onChange={(v) => update('borrowerFirstName', v)} required />
        <Input label="Borrower Last Name" value={form.borrowerLastName} onChange={(v) => update('borrowerLastName', v)} required />
        <Input label="Borrower Phone (recommended)" value={form.borrowerPhone} onChange={(v) => update('borrowerPhone', v)} />
        <Input label="Borrower Email" value={form.borrowerEmail} onChange={(v) => update('borrowerEmail', v)} />
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
      {submitError && (
        <p className="text-sm rounded-lg border border-red-200 bg-red-50 text-red-700 px-3 py-2">
          {submitError}
        </p>
      )}

      <div className="flex justify-end gap-3 pt-2">
        <button type="button" className="app-btn-secondary">
          Save Draft
        </button>
        <button
          type="submit"
          disabled={isSubmitting}
          className="app-btn-primary disabled:opacity-70 disabled:cursor-not-allowed"
        >
          {isSubmitting && <Loader2 className="w-4 h-4 animate-spin" />}
          {isSubmitting ? 'Processing...' : 'Submit for QC'}
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
