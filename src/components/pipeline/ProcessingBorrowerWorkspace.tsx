'use client';

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { ReactNode } from 'react';
import { AriveWorkspacePanel } from './AriveWorkspacePanel';
import { AriveSyncStatus } from './AriveSyncStatus';
import { AriveNoteHeaderGuide, ariveNoteHeaderGuide } from './AriveNoteHeaderGuide';
import { AriveNotesPanel } from './AriveNotesTimeline';
import { AriveRequestTrackersPanel } from './AriveTrackerPanel';
import { AriveFinancialInfo } from './FinancialInfoPanel';
import { BorrowerInfoView, LoanCenterView, LoanPropertyView } from './ProcessingWorkspaceViews';
import { ariveFieldLabel, ariveFieldMissing, formatAriveCalendarDate, mergeAriveConflictDraft } from '@/lib/ariveSyncPresentation';
import { createPortal } from 'react-dom';
import { DetailCard, DetailField, DetailGrid, DetailSection, WorkspacePanel } from './BorrowerWorkspaceLayout';
import { PortalLoadingState } from '@/components/layout/PortalLoadingState';
import {
  Activity,
  Building2,
  Clipboard,
  Clock3,
  DollarSign,
  Download,
  FileText,
  Home,
  Landmark,
  Loader2,
  MapPin,
  MessageSquare,
  Pencil,
  Save,
  ShieldCheck,
  UserRound,
  Users,
  X,
} from 'lucide-react';
import {
  getProcessingBorrowerDetails,
  updateProcessingBorrowerDetails,
  type ProcessingBorrowerDetailsInput,
} from '@/app/actions/processingPipelineActions';
import { getTaskAttachmentDownloadUrl } from '@/app/actions/attachmentActions';
import {
  PROCESSING_ITEM_STATUS_OPTIONS,
  PROCESSING_PIPELINE_STATUS_OPTIONS,
  getProcessingPipelineLockedDefaults,
} from '@/lib/processingPipeline';

type DetailResult = Extract<
  Awaited<ReturnType<typeof getProcessingBorrowerDetails>>,
  { success: true }
>['details'];

type DetailSectionKey =
  | 'borrower'
  | 'property'
  | 'loan'
  | 'processing'
  | 'appraisal'
  | 'activity'
  | 'documents';

type WorkspaceTab = 'loan-property' | 'borrower-info' | 'financial-info' | 'loan-center';
type CenterSection = 'services' | 'notes' | 'documents' | 'activity';

const tabs: Array<{
  id: WorkspaceTab;
  label: string;
  icon: typeof UserRound;
}> = [
  { id: 'loan-property', label: 'Loan & Property', icon: Home },
  { id: 'borrower-info', label: 'Borrower Info', icon: UserRound },
  { id: 'financial-info', label: 'Financial Info', icon: DollarSign },
  { id: 'loan-center', label: 'Loan Center', icon: Building2 },
];

const centerSections: { id: CenterSection; label: string; icon: typeof Home }[] = [
  { id: 'services', label: 'Services & milestones', icon: ShieldCheck },
  { id: 'notes', label: 'Notes', icon: MessageSquare },
  { id: 'documents', label: 'Documents', icon: FileText },
  { id: 'activity', label: 'Activity', icon: Activity },
];

function formatDate(value: string | null | undefined) {
  if (!value) return 'Not provided';
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? 'Not provided'
    : date.toLocaleDateString(undefined, {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      });
}

function formatMoney(value: number | string | null | undefined) {
  if (value === null || value === undefined || value === '') return 'Not provided';
  const amount = Number(value);
  return Number.isFinite(amount)
    ? new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: 'USD',
        maximumFractionDigits: 0,
      }).format(amount)
    : String(value);
}

function humanize(value: string | null | undefined) {
  if (!value) return 'Not provided';
  return value
    .replaceAll('_', ' ')
    .toLowerCase()
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function statusLabel(value: string) {
  return PROCESSING_PIPELINE_STATUS_OPTIONS.find(
    (option) => option.value === value,
  )?.label || humanize(value);
}

function itemStatusLabel(value: string) {
  return PROCESSING_ITEM_STATUS_OPTIONS.find(
    (option) => option.value === value,
  )?.label || humanize(value);
}

function dateInputValue(value: string | null | undefined) {
  return value ? value.slice(0, 10) : '';
}

function buildEditDraft(details: DetailResult): ProcessingBorrowerDetailsInput {
  return {
    id: details.id,
    version: details.version,
    borrowerFirstName: details.borrower.firstName || '',
    borrowerLastName: details.borrower.lastName || '',
    borrowerPhone: details.borrower.phone || '',
    borrowerEmail: details.borrower.email || '',
    coBorrowerFirstName: details.borrower.coBorrower.firstName || '',
    coBorrowerLastName: details.borrower.coBorrower.lastName || '',
    coBorrowerPhone: details.borrower.coBorrower.phone || '',
    coBorrowerEmail: details.borrower.coBorrower.email || '',
    propertyStreet: details.property.street || '',
    propertyUnit: details.property.unit || '',
    propertyCity: details.property.city || '',
    propertyState: details.property.state || '',
    propertyZip: details.property.zip || '',
    propertyOccupancy: details.property.occupancy || '',
    estimatedValue: details.property.estimatedValue || '',
    yearBuilt: details.property.yearBuilt || '',
    yearAcquired: details.property.yearAcquired || '',
    titleHeldAs: details.property.titleHeldAs || '',
    loanAmount: String(details.loan.amount ?? ''),
    loanType: details.loan.loanType || '',
    loanProgram: details.loan.program || '',
    lender: details.loan.lender || '',
    channel: details.loan.channel || '',
    loanPurpose: details.loan.purpose || '',
    leadSource: details.loan.leadSource || '',
    cashBack: details.loan.cashBack || '',
    projectedRevenue: String(details.loan.projectedRevenue ?? ''),
    appraisalNeeded: details.appraisal.needed,
    appraisalWaiver: details.appraisal.waiver || '',
    appraisalOrderedAt: dateInputValue(details.appraisal.orderedAt),
    appraisalScheduledAt: dateInputValue(details.appraisal.scheduledAt),
    appraisalBackAt: dateInputValue(details.appraisal.backAt),
    appraisalNotes: details.appraisal.notes || '',
    sheet: details.processing.sheet,
    pipelineStatus: details.processing.pipelineStatus,
    dateAssigned: dateInputValue(details.processing.dateAssigned),
    estimatedSigningAt: dateInputValue(details.processing.estimatedSigningAt),
    titleStatus: details.processing.titleStatus,
    payoffStatus: details.processing.payoffStatus,
    payoffExpiresAt: dateInputValue(details.processing.payoffExpiresAt),
    hoiStatus: details.processing.hoiStatus,
    missingItemsCurrentStatus:
      details.processing.missingItemsCurrentStatus || '',
    extraNotes: details.processing.extraNotes || '',
    restructureNotes: details.processing.restructureNotes || '',
    rateLock: details.processing.rateLock,
    rateLockExpiresAt: dateInputValue(details.processing.rateLockExpiresAt),
    cdSent: details.processing.cdSent,
    fundedAt: dateInputValue(details.processing.fundedAt),
  };
}

function EditField({
  label,
  value,
  onChange,
  type = 'text',
  required = false,
  multiline = false,
  placeholder,
  disabled = false,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: 'text' | 'email' | 'tel' | 'number' | 'date';
  required?: boolean;
  multiline?: boolean;
  placeholder?: string;
  disabled?: boolean;
}) {
  const classes =
    'mt-1.5 w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm font-semibold text-slate-900 shadow-sm outline-none transition placeholder:text-slate-400 focus:border-blue-400 focus:ring-2 focus:ring-blue-100';
  return (
    <label className="block min-w-0">
      <span className="text-[10px] font-black uppercase tracking-[0.1em] text-slate-500">
        {label}
        {required && <span className="ml-1 text-red-500">*</span>}
      </span>
      {multiline ? (
        <textarea
          value={value}
          onChange={(event) => onChange(event.target.value)}
          className={`${classes} min-h-24 resize-y`}
          placeholder={placeholder}
          required={required}
          disabled={disabled}
        />
      ) : (
        <input
          type={type}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          className={classes}
          placeholder={placeholder}
          required={required}
          disabled={disabled}
          min={type === 'number' ? 0 : undefined}
          step={type === 'number' ? 'any' : undefined}
        />
      )}
    </label>
  );
}

function EditSelect({
  label,
  value,
  options,
  onChange,
  disabled = false,
}: {
  label: string;
  value: string;
  options: ReadonlyArray<{ value: string; label: string }>;
  onChange: (value: string) => void;
  disabled?: boolean;
}) {
  return (
    <label className="block min-w-0">
      <span className="text-[10px] font-black uppercase tracking-[0.1em] text-slate-500">
        {label}
      </span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        disabled={disabled}
        className="mt-1.5 w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm font-semibold text-slate-900 shadow-sm outline-none transition focus:border-blue-400 focus:ring-2 focus:ring-blue-100 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-500"
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

export function ProcessingBorrowerWorkspace({
  pipelineLoanId,
  onClose,
  onSaved,
}: {
  pipelineLoanId: string;
  onClose: () => void;
  onSaved?: () => void;
}) {
  const [details, setDetails] = useState<DetailResult | null>(null);
  const [error, setError] = useState('');
  const [activeTab, setActiveTab] = useState<WorkspaceTab>('loan-center');
  const [centerSection, setCenterSection] = useState<CenterSection>('services');
  const [allTrackersOpen, setAllTrackersOpen] = useState(false);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<ProcessingBorrowerDetailsInput | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState('');
  const [saveError, setSaveError] = useState('');
  const [ariveBlockedFields, setAriveBlockedFields] = useState<string[]>([]);
  const [ariveLatestDraft, setAriveLatestDraft] = useState<ProcessingBorrowerDetailsInput | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);

  const requestClose = useCallback(() => {
    if (
      editing &&
      !saving &&
      !window.confirm('Discard your unsaved borrower detail changes?')
    ) {
      return;
    }
    if (!saving) onClose();
  }, [editing, onClose, saving]);

  useEffect(() => {
    restoreFocusRef.current = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    closeButtonRef.current?.focus();
    return () => {
      document.body.style.overflow = previousOverflow;
      restoreFocusRef.current?.focus();
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    getProcessingBorrowerDetails(pipelineLoanId).then((result) => {
      if (cancelled) return;
      if (!result.success) {
        setError(result.error);
        return;
      }
      setDetails(result.details);
    }).catch(() => {
      if (!cancelled) setError('Unable to load borrower details. Close this file and try again.');
    });
    return () => {
      cancelled = true;
    };
  }, [pipelineLoanId]);

  const refreshAriveDetails = useCallback(async () => {
    const result = await getProcessingBorrowerDetails(pipelineLoanId);
    onSaved?.();
    if (!result.success) throw new Error(result.error);
    setDetails(result.details);
  }, [pipelineLoanId, onSaved]);

  useEffect(() => {
    if (!details?.ariveSync?.enabled || editing || saving) return;
    let active = true;
    const timer = window.setInterval(async () => {
      if (document.visibilityState !== 'visible') return;
      try {
        const result = await getProcessingBorrowerDetails(pipelineLoanId);
        if (active && result.success) setDetails(result.details);
      } catch { /* Retain the last visible file until the next refresh. */ }
    }, 60_000);
    return () => { active = false; window.clearInterval(timer); };
  }, [details?.ariveSync?.enabled, editing, saving, pipelineLoanId]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        requestClose();
        return;
      }
      if (event.key !== 'Tab' || !panelRef.current) return;
      const focusable = Array.from(
        panelRef.current.querySelectorAll<HTMLElement>(
          'button:not([disabled]), summary, a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      ).filter(element => element.getClientRects().length > 0);
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [requestClose]);

  const initials = useMemo(
    () =>
      (details?.borrower.name || 'Borrower')
        .split(/\s+/)
        .slice(0, 2)
        .map((part) => part[0]?.toUpperCase())
        .join(''),
    [details?.borrower.name],
  );

  const openAttachment = async (attachmentId: string) => {
    setDownloadingId(attachmentId);
    const result = await getTaskAttachmentDownloadUrl(attachmentId);
    setDownloadingId(null);
    if (!result.success) {
      setError(result.error || 'Unable to open this document.');
      return;
    }
    window.open(result.url, '_blank', 'noopener,noreferrer');
  };

  const patchDraft = <Key extends keyof ProcessingBorrowerDetailsInput>(
    key: Key,
    value: ProcessingBorrowerDetailsInput[Key],
  ) => {
    setDraft((current) => (current ? { ...current, [key]: value } : current));
  };

  const beginEditing = () => {
    if (!details?.canEdit) return;
    setDraft(buildEditDraft(details));
    setSaveMessage('');
    setSaveError('');
    setAriveBlockedFields([]);
    setAriveLatestDraft(null);
    setEditing(true);
    if (activeTab === 'financial-info') setActiveTab('loan-property');
    if (activeTab === 'loan-center') setCenterSection('services');
  };

  const saveDetails = async () => {
    if (!draft) return;
    setSaving(true);
    setSaveError('');
    setSaveMessage('');
    const result = await updateProcessingBorrowerDetails(draft);
    if (!result.success) {
      setSaving(false);
      setSaveError(result.error);
      if ('ariveConflict' in result && result.ariveConflict) {
        const blocked = 'blockedFields' in result && Array.isArray(result.blockedFields) ? result.blockedFields.filter((field): field is string => typeof field === 'string') : [];
        setAriveBlockedFields(blocked);
        const latest = await getProcessingBorrowerDetails(pipelineLoanId);
        if (latest.success) {
          setDetails(latest.details);
          setAriveLatestDraft(buildEditDraft(latest.details));
        }
        onSaved?.();
      }
      return;
    }
    const refreshed = await getProcessingBorrowerDetails(pipelineLoanId);
    setSaving(false);
    if (!refreshed.success) {
      setError(refreshed.error);
      return;
    }
    setDetails(refreshed.details);
    setDraft(null);
    setAriveBlockedFields([]);
    setAriveLatestDraft(null);
    setEditing(false);
    setSaveMessage('Changes saved and added to the activity history.');
    onSaved?.();
  };

  const stageDisplay = details?.ariveSync?.enabled ? details.ariveSync.stageLabel || 'Stage missing in Arive' : details ? statusLabel(details.processing.pipelineStatus) : '';
  const missingAriveValue = (field: string, value: ReactNode) => ariveFieldMissing(details?.ariveSync, field)
    ? <span className="inline-flex rounded-md border border-red-300 bg-red-50 px-2 py-1 text-xs font-semibold text-red-800">Missing in Arive</span> : value;
  const milestoneDate = (field: string, value: string | null) => missingAriveValue(field, details?.ariveSync?.enabled ? formatAriveCalendarDate(value) : formatDate(value));
  const daysDisplay = details?.ariveSync?.enabled && !details.ariveSync.stageDate
    ? <span className="text-red-700">Stage date missing</span> : details?.processing.daysInStatus;

  const renderSection = (activeTab: DetailSectionKey) => {
    if (!details) return null;
    if (activeTab === 'borrower') {
      if (editing && draft) {
        return (
          <div className="grid gap-4 xl:grid-cols-2">
            <DetailCard title="Primary borrower" description="At least one primary borrower name is required." icon={UserRound}>
              <DetailGrid columns={2}>
                <EditField label="First name" value={draft.borrowerFirstName} onChange={(value) => patchDraft('borrowerFirstName', value)} />
                <EditField label="Last name" value={draft.borrowerLastName} onChange={(value) => patchDraft('borrowerLastName', value)} />
                <EditField label="Phone" type="tel" value={draft.borrowerPhone} onChange={(value) => patchDraft('borrowerPhone', value)} />
                <EditField label="Email" type="email" value={draft.borrowerEmail} onChange={(value) => patchDraft('borrowerEmail', value)} />
              </DetailGrid>
            </DetailCard>
            <DetailCard title="Co-borrower" description="Optional co-borrower identity and contact details." icon={Users}>
              <DetailGrid columns={2}>
                <EditField label="First name" value={draft.coBorrowerFirstName} onChange={(value) => patchDraft('coBorrowerFirstName', value)} />
                <EditField label="Last name" value={draft.coBorrowerLastName} onChange={(value) => patchDraft('coBorrowerLastName', value)} />
                <EditField label="Phone" type="tel" value={draft.coBorrowerPhone} onChange={(value) => patchDraft('coBorrowerPhone', value)} />
                <EditField label="Email" type="email" value={draft.coBorrowerEmail} onChange={(value) => patchDraft('coBorrowerEmail', value)} />
              </DetailGrid>
            </DetailCard>
          </div>
        );
      }
      const coBorrowerName = [
        details.borrower.coBorrower.firstName,
        details.borrower.coBorrower.lastName,
      ].filter(Boolean).join(' ');
      return (
        <div className="grid gap-4 xl:grid-cols-2">
          <DetailCard title="Primary borrower" description="Contact details captured at submission." icon={UserRound}>
            <DetailGrid columns={2}>
              <div className="sm:col-span-2"><DetailField label="Full name" value={[details.borrower.firstName, details.borrower.lastName].filter(Boolean).join(' ') || details.borrower.name} copyable /></div>
              <DetailField label="Phone" value={details.borrower.phone} copyable />
              <DetailField label="Email" value={details.borrower.email} copyable />
            </DetailGrid>
          </DetailCard>
          <DetailCard title="Co-borrower" description="Shown when included in the MISMO or submission." icon={Users}>
            <DetailGrid columns={2}>
              <div className="sm:col-span-2"><DetailField label="Full name" value={coBorrowerName} copyable /></div>
              <DetailField label="Phone" value={details.borrower.coBorrower.phone} copyable />
              <DetailField label="Email" value={details.borrower.coBorrower.email} copyable />
            </DetailGrid>
          </DetailCard>
        </div>
      );
    }
    if (activeTab === 'property') {
      if (editing && draft) {
        return (
          <DetailCard title="Subject property" description="Update the structured property details used throughout processing." icon={MapPin}>
            <DetailSection title="Property address">
              <EditField label="Street" value={draft.propertyStreet} onChange={(value) => patchDraft('propertyStreet', value)} />
              <EditField label="Unit" value={draft.propertyUnit} onChange={(value) => patchDraft('propertyUnit', value)} />
              <EditField label="City" value={draft.propertyCity} onChange={(value) => patchDraft('propertyCity', value)} />
              <EditField label="State" value={draft.propertyState} onChange={(value) => patchDraft('propertyState', value.toUpperCase())} placeholder="FL" />
              <EditField label="ZIP" value={draft.propertyZip} onChange={(value) => patchDraft('propertyZip', value)} />
              </DetailSection>
              <DetailSection title="Occupancy and valuation">
              <EditField label="Occupancy" value={draft.propertyOccupancy} onChange={(value) => patchDraft('propertyOccupancy', value)} />
              <EditField label="Estimated value" type="number" value={draft.estimatedValue} onChange={(value) => patchDraft('estimatedValue', value)} />
              <EditField label="Year built" type="number" value={draft.yearBuilt} onChange={(value) => patchDraft('yearBuilt', value)} />
              </DetailSection>
              <DetailSection title="Ownership and vesting">
              <EditField label="Year acquired" type="number" value={draft.yearAcquired} onChange={(value) => patchDraft('yearAcquired', value)} />
              <EditField label="Title held as" value={draft.titleHeldAs} onChange={(value) => patchDraft('titleHeldAs', value)} />
            </DetailSection>
          </DetailCard>
        );
      }
      return (
        <DetailCard title="Subject property" description="Structured MISMO and submission address details." icon={MapPin}>
          <DetailSection title="Property address">
            <div className="sm:col-span-2 xl:col-span-3"><DetailField label="Complete address" value={details.property.address} copyable /></div>
            <DetailField label="Street" value={details.property.street} />
            <DetailField label="Unit" value={details.property.unit} />
            <DetailField label="City" value={details.property.city} />
            <DetailField label="State" value={details.property.state} />
            <DetailField label="ZIP" value={details.property.zip} />
            </DetailSection>
              <DetailSection title="Occupancy and valuation">
              <DetailField label="Occupancy" value={humanize(details.property.occupancy)} />
            <DetailField label="Estimated value" value={formatMoney(details.property.estimatedValue)} />
            <DetailField label="Year built" value={details.property.yearBuilt} />
            </DetailSection>
              <DetailSection title="Ownership and vesting">
              <DetailField label="Year acquired" value={details.property.yearAcquired} />
            <DetailField label="Title held as" value={details.property.titleHeldAs} />
          </DetailSection>
        </DetailCard>
      );
    }
    if (activeTab === 'loan') {
      if (editing && draft) {
        return (
          <DetailCard title="Loan structure" description="Arive # is the permanent file identifier and cannot be changed." icon={Landmark}>
            <DetailSection title="Loan terms">
              <DetailField label="Arive # · locked" value={details.loan.loanNumber} copyable />
              <EditField label="Loan amount" type="number" value={draft.loanAmount} onChange={(value) => patchDraft('loanAmount', value)} required />
              <EditField label="Loan type" value={draft.loanType} onChange={(value) => patchDraft('loanType', value)} />
              <EditField label="Program" value={draft.loanProgram} onChange={(value) => patchDraft('loanProgram', value)} />
              <EditField label="Purpose" value={draft.loanPurpose} onChange={(value) => patchDraft('loanPurpose', value)} />
              </DetailSection>
              <DetailSection title="Lender and origination">
              <EditField label="Lender" value={draft.lender} onChange={(value) => patchDraft('lender', value)} />
              <EditField label="Channel" value={draft.channel} onChange={(value) => patchDraft('channel', value)} />
              <EditField label="Lead source" value={draft.leadSource} onChange={(value) => patchDraft('leadSource', value)} />
              </DetailSection>
              <DetailSection title="Proceeds and revenue">
              <EditField label="Cash back" type="number" value={draft.cashBack} onChange={(value) => patchDraft('cashBack', value)} />
              <EditField label="Projected revenue" type="number" value={draft.projectedRevenue} onChange={(value) => patchDraft('projectedRevenue', value)} />
            </DetailSection>
          <DetailSection title="Loan team">
              <DetailField label="Primary Loan Officer" value={details.ownership.primaryLoanOfficer?.name} />
              <DetailField label="Secondary Loan Officer" value={details.ownership.secondaryLoanOfficer?.name || 'Not assigned'} />
              <DetailField label="Effective Loan Officer" value={details.ownership.loanOfficer?.name} />
            </DetailSection>
          </DetailCard>
        );
      }
      return (
        <DetailCard title="Loan structure" description="Origination and revenue information." icon={Landmark}>
          <DetailSection title="Loan terms">
            <DetailField label="Arive #" value={details.loan.loanNumber} copyable />
            <DetailField label="Loan amount" value={formatMoney(details.loan.amount)} />
            <DetailField label="Loan type" value={details.loan.loanType} />
            <DetailField label="Program" value={details.loan.program} />
            <DetailField label="Purpose" value={details.loan.purpose} />
            </DetailSection>
              <DetailSection title="Lender and origination">
              <DetailField label="Lender" value={details.loan.lender} />
            <DetailField label="Channel" value={details.loan.channel} />
            <DetailField label="Lead source" value={details.loan.leadSource} />
            </DetailSection>
              <DetailSection title="Proceeds and revenue">
              <DetailField label="Cash back" value={formatMoney(details.loan.cashBack)} />
            <DetailField label="Projected revenue" value={formatMoney(details.loan.projectedRevenue)} />
          </DetailSection>
        <DetailSection title="Loan team">
              <DetailField label="Primary Loan Officer" value={details.ownership.primaryLoanOfficer?.name} />
              <DetailField label="Secondary Loan Officer" value={details.ownership.secondaryLoanOfficer?.name || 'Not assigned'} />
              <DetailField label="Effective Loan Officer" value={details.ownership.loanOfficer?.name} />
            </DetailSection>
          </DetailCard>
      );
    }
    if (activeTab === 'processing') {
      if (editing && draft) {
        const restructureStatusValues = new Set([
          'SUSPENDED_RESTRUCTURE',
          'ADVERSE_PENDING',
          'PENDING_APPROVAL',
        ]);
        const statusOptions = PROCESSING_PIPELINE_STATUS_OPTIONS.filter(
          (option) =>
            draft.sheet === 'FUNDING'
              ? option.value === 'FUNDED'
              : draft.sheet === 'RESTRUCTURE'
                ? restructureStatusValues.has(option.value)
                : option.value !== 'FUNDED' &&
                  !restructureStatusValues.has(option.value),
        );
        const payoffLocked = !details.ariveSync?.enabled && Boolean(
          getProcessingPipelineLockedDefaults(
            draft.lender,
            details.ownership.processingMethod,
          )?.lockedFields.includes('payoffStatus'),
        );
        return (
          <div className="space-y-4">
            <DetailCard title="Milestones" description="Workflow changes are validated and audited when saved." icon={Building2}>
              <DetailSection title="Status and key dates">
                <EditSelect
                  label="Sheet"
                  value={draft.sheet}
                  options={[
                    { value: 'PIPELINE', label: 'Pipeline' },
                    { value: 'RESTRUCTURE', label: 'Restructures' },
                    { value: 'FUNDING', label: 'Fundings' },
                  ]}
                  onChange={(value) => {
                    const sheet =
                      value as ProcessingBorrowerDetailsInput['sheet'];
                    const pipelineStatus =
                      sheet === 'FUNDING'
                        ? 'FUNDED'
                        : sheet === 'RESTRUCTURE'
                          ? 'SUSPENDED_RESTRUCTURE'
                          : 'RE_SUB';
                    if (
                      details.requiresStatusConfirmation &&
                      !window.confirm(
                        `Are you sure you want to move this to ${statusLabel(pipelineStatus)}?`,
                      )
                    ) {
                      return;
                    }
                    setDraft((current) => {
                      if (!current) return current;
                      return { ...current, sheet, pipelineStatus };
                    });
                  }}
                />
                <EditSelect
                  label="Pipeline status"
                  value={draft.pipelineStatus}
                  options={statusOptions}
                  onChange={(value) => {
                    if (
                      details.requiresStatusConfirmation &&
                      !window.confirm(
                        `Are you sure you want to move this to ${statusLabel(value)}?`,
                      )
                    ) {
                      return;
                    }
                    patchDraft(
                      'pipelineStatus',
                      value as ProcessingBorrowerDetailsInput['pipelineStatus'],
                    );
                  }}
                />
                <EditField label="Assigned" type="date" value={draft.dateAssigned} onChange={(value) => patchDraft('dateAssigned', value)} required />
                <EditField label="Estimated signing" type="date" value={draft.estimatedSigningAt} onChange={(value) => patchDraft('estimatedSigningAt', value)} />
                {draft.sheet === 'FUNDING' && (
                  <EditField label="Funded date" type="date" value={draft.fundedAt} onChange={(value) => patchDraft('fundedAt', value)} required />
                )}
                </DetailSection>
              <DetailSection title="Third-party services">
              <EditSelect
                  label="Title"
                  value={draft.titleStatus}
                  options={PROCESSING_ITEM_STATUS_OPTIONS}
                  onChange={(value) => patchDraft('titleStatus', value as ProcessingBorrowerDetailsInput['titleStatus'])}
                />
                <EditSelect
                  label="Payoff"
                  value={draft.payoffStatus}
                  options={PROCESSING_ITEM_STATUS_OPTIONS}
                  disabled={payoffLocked}
                  onChange={(value) => {
                    const payoffStatus =
                      value as ProcessingBorrowerDetailsInput['payoffStatus'];
                    setDraft((current) =>
                      current
                        ? {
                            ...current,
                            payoffStatus,
                            payoffExpiresAt:
                              payoffStatus === 'RECEIVED'
                                ? current.payoffExpiresAt
                                : '',
                          }
                        : current,
                    );
                  }}
                />
                {draft.payoffStatus === 'RECEIVED' && !payoffLocked && (
                  <EditField
                    label="Payoff expiration"
                    type="date"
                    value={draft.payoffExpiresAt}
                    onChange={(value) =>
                      patchDraft('payoffExpiresAt', value)
                    }
                    required
                  />
                )}
                <EditSelect
                  label="HOI"
                  value={draft.hoiStatus}
                  options={PROCESSING_ITEM_STATUS_OPTIONS}
                  onChange={(value) => patchDraft('hoiStatus', value as ProcessingBorrowerDetailsInput['hoiStatus'])}
                />
                </DetailSection>
              <DetailSection title="Rate lock and disclosures">
              <EditSelect
                  label="Rate lock"
                  value={draft.rateLock ? 'true' : 'false'}
                  options={[
                    { value: 'false', label: 'No' },
                    { value: 'true', label: 'Yes' },
                  ]}
                  onChange={(value) => patchDraft('rateLock', value === 'true')}
                />
                {draft.rateLock && (
                  <EditField label="Lock expiration" type="date" value={draft.rateLockExpiresAt} onChange={(value) => patchDraft('rateLockExpiresAt', value)} />
                )}
                <EditSelect
                  label="CD sent"
                  value={draft.cdSent ? 'true' : 'false'}
                  options={[
                    { value: 'false', label: 'No' },
                    { value: 'true', label: 'Yes' },
                  ]}
                  onChange={(value) => patchDraft('cdSent', value === 'true')}
                />
              </DetailSection>
            </DetailCard>
            <DetailCard title="Processor notes" description="Open items and workflow context." icon={Clipboard}>
              <div className="grid gap-3 lg:grid-cols-3">
                <EditField label="Pending items" value={draft.missingItemsCurrentStatus} onChange={(value) => patchDraft('missingItemsCurrentStatus', value)} multiline />
                <EditField label="Extra notes" value={draft.extraNotes} onChange={(value) => patchDraft('extraNotes', value)} multiline />
                <EditField label="Restructure notes" value={draft.restructureNotes} onChange={(value) => patchDraft('restructureNotes', value)} multiline />
              </div>
            </DetailCard>
          </div>
        );
      }
      return (
        <div className="space-y-4">
          <DetailCard title="Milestones" description="Current processing status and checklist." icon={Building2}>
            <DetailSection title="Status and key dates">
              <DetailField label="Pipeline status" value={stageDisplay} />
              <DetailField label="Sheet" value={humanize(details.processing.sheet)} />
              <DetailField label="Days in status" value={daysDisplay} />
              <DetailField label="Assigned" value={formatDate(details.processing.dateAssigned)} />
              <DetailField label="Estimated signing" value={milestoneDate('estimatedSigningAt', details.processing.estimatedSigningAt)} />
              <DetailField label="Funded date" value={milestoneDate('fundedAt', details.processing.fundedAt)} />
              </DetailSection>
              <DetailSection title="Third-party services">
              <DetailField label="Title" value={missingAriveValue('titleStatus', itemStatusLabel(details.processing.titleStatus))} />
              <DetailField label="Payoff" value={missingAriveValue('payoffStatus', itemStatusLabel(details.processing.payoffStatus))} />
              <DetailField
                label="Payoff expiration"
                value={milestoneDate('payoffExpiresAt', details.processing.payoffExpiresAt)}
              />
              <DetailField label="HOI" value={missingAriveValue('hoiStatus', itemStatusLabel(details.processing.hoiStatus))} />
              </DetailSection>
              <DetailSection title="Rate lock and disclosures">
              <DetailField label="Rate lock" value={missingAriveValue('rateLock', details.processing.rateLock ? 'Yes' : 'No')} />
              <DetailField label="Lock expiration" value={milestoneDate('rateLockExpiresAt', details.processing.rateLockExpiresAt)} />
              <DetailField label="CD sent" value={missingAriveValue('cdSent', details.processing.cdSent ? 'Yes' : 'No')} />
            </DetailSection>
          </DetailCard>
          <DetailCard title="Processor notes" description="Open items and workflow context." icon={Clipboard}>
            <DetailGrid>
              <div className="sm:col-span-2 xl:col-span-3 whitespace-pre-wrap"><DetailField label="Pending items" value={details.processing.missingItemsCurrentStatus} /></div>
              <DetailField label="Extra notes" value={details.processing.extraNotes} />
              <DetailField label="Restructure notes" value={details.processing.restructureNotes} />
            </DetailGrid>
          </DetailCard>
        </div>
      );
    }
    if (activeTab === 'appraisal') {
      if (editing && draft) {
        return (
          <div className="space-y-4">
            <DetailCard title="Appraisal workflow" description="Update appraisal intent, dates, waiver, and notes." icon={ShieldCheck}>
              <DetailSection title="Requirements">
                <label className="block min-w-0">
                  <span className="text-[10px] font-black uppercase tracking-[0.1em] text-slate-500">Appraisal needed</span>
                  <select
                    value={draft.appraisalNeeded === null ? '' : draft.appraisalNeeded ? 'true' : 'false'}
                    onChange={(event) => patchDraft('appraisalNeeded', event.target.value === '' ? null : event.target.value === 'true')}
                    className="mt-1.5 w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm font-semibold text-slate-900 shadow-sm outline-none transition focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
                  >
                    <option value="">Not set</option>
                    <option value="true">Yes</option>
                    <option value="false">No</option>
                  </select>
                </label>
                <EditField label="Waiver" value={draft.appraisalWaiver} onChange={(value) => patchDraft('appraisalWaiver', value)} />
                </DetailSection>
              <DetailSection title="Appraisal milestones">
              <EditField label="Ordered" type="date" value={draft.appraisalOrderedAt} onChange={(value) => patchDraft('appraisalOrderedAt', value)} />
                <EditField label="Scheduled" type="date" value={draft.appraisalScheduledAt} onChange={(value) => patchDraft('appraisalScheduledAt', value)} />
                <EditField label="Received" type="date" value={draft.appraisalBackAt} onChange={(value) => patchDraft('appraisalBackAt', value)} />
                </DetailSection>
              <DetailSection title="Appraisal notes">
              <div className="sm:col-span-2 xl:col-span-3"><EditField label="Notes" value={draft.appraisalNotes} onChange={(value) => patchDraft('appraisalNotes', value)} multiline /></div>
              </DetailSection>
            </DetailCard>
          </div>
        );
      }
      return (
        <div className="space-y-4">
          <DetailCard title="Appraisal workflow" description="Submission intent and processing dates." icon={ShieldCheck}>
            <DetailSection title="Requirements">
              <DetailField label="Appraisal needed" value={details.appraisal.needed === null ? 'Not set' : details.appraisal.needed ? 'Yes' : 'No'} />
              <DetailField label="Waiver" value={details.appraisal.waiver} />
              </DetailSection>
              <DetailSection title="Appraisal milestones">
              <DetailField label="Ordered" value={milestoneDate('appraisalOrderedAt', details.appraisal.orderedAt)} />
              <DetailField label="Scheduled" value={milestoneDate('appraisalScheduledAt', details.appraisal.scheduledAt)} />
              <DetailField label="Received" value={milestoneDate('appraisalBackAt', details.appraisal.backAt)} />
              </DetailSection>
              <DetailSection title="Appraisal notes">
              <div className="sm:col-span-2 xl:col-span-3 whitespace-pre-wrap"><DetailField label="Notes" value={details.appraisal.notes} /></div>
            </DetailSection>
          </DetailCard>
        </div>
      );
    }
    if (activeTab === 'activity') {
      const combined = [
        ...details.notes.map((note) => ({
          id: note.id,
          date: note.date,
          title: note.author,
          description: note.message,
          meta: note.role ? humanize(note.role) : 'Note',
        })),
        ...details.activity.map((entry) => ({
          id: entry.id,
          date: entry.createdAt,
          title: entry.actor,
          description: humanize(entry.action),
          meta: humanize(entry.actorRole),
        })),
      ].sort(
        (left, right) =>
          new Date(right.date || 0).getTime() -
          new Date(left.date || 0).getTime(),
      );
      return (
        <DetailCard title="Portal activity" description="Submission conversations and audited BISU changes, newest first." icon={Activity}>
          <div className="space-y-3">
            {combined.length === 0 ? (
              <p className="py-8 text-center text-sm font-medium text-slate-500">No activity has been recorded.</p>
            ) : combined.map((entry) => (
              <div key={entry.id} className="flex gap-3 rounded-xl border border-slate-100 bg-slate-50/70 p-3">
                <span className="mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white text-blue-700 shadow-sm">
                  <Clock3 className="h-4 w-4" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-sm font-bold text-slate-900">{entry.title}</p>
                    <span className="text-[11px] font-semibold text-slate-500">{formatDate(entry.date)}</span>
                  </div>
                  <p className="mt-1 whitespace-pre-wrap text-sm font-medium text-slate-700">{entry.description}</p>
                  <p className="mt-1 text-[10px] font-black uppercase tracking-wider text-slate-400">{entry.meta}</p>
                </div>
              </div>
            ))}
          </div>
        </DetailCard>
      );
    }
    return (
      <DetailCard title="Documents" description="Files attached to the original Submit to Processing task." icon={FileText}>
        <div className="space-y-2">
          {details.attachments.length === 0 ? (
            <p className="py-8 text-center text-sm font-medium text-slate-500">{details.loan.loanNumber === '17881588' ? 'Reviewed submission documents are shown below.' : 'No documents are attached to this request.'}</p>
          ) : details.attachments.map((attachment) => (
            <button
              key={attachment.id}
              type="button"
              onClick={() => void openAttachment(attachment.id)}
              disabled={downloadingId === attachment.id}
              className="flex w-full items-center gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3 text-left transition hover:border-blue-200 hover:bg-blue-50/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-300 disabled:opacity-60"
            >
              <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-slate-100 text-slate-600">
                {downloadingId === attachment.id ? <Loader2 className="h-5 w-5 animate-spin" /> : <FileText className="h-5 w-5" />}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-bold text-slate-900">{attachment.filename}</span>
                <span className="mt-0.5 block text-xs font-medium text-slate-500">
                  {humanize(attachment.purpose)} · {(attachment.sizeBytes / 1024).toFixed(0)} KB · {attachment.uploadedBy}
                </span>
              </span>
              <Download className="h-4 w-4 text-slate-400" />
            </button>
          ))}
        </div>
      </DetailCard>
    );
  };

  const renderWorkspace = () => {
    if (!details) return null;
    if (activeTab === 'loan-property') return editing ? <div className="space-y-4">{renderSection('loan')}{renderSection('property')}</div> : <LoanPropertyView details={details} />;
    if (activeTab === 'borrower-info') return editing ? renderSection('borrower') : <BorrowerInfoView details={details} />;
    if (activeTab === 'financial-info') return <AriveFinancialInfo application={details.ariveApplication} />;
    return <div className="space-y-4">
      <nav className="flex flex-wrap gap-1.5 border-b border-slate-200 pb-3" aria-label="Loan Center sections">{centerSections.map(section => {
        const Icon = section.icon;
        return <button type="button" key={section.id} aria-pressed={centerSection === section.id} onClick={() => setCenterSection(section.id)} className={`inline-flex items-center gap-2 rounded-lg px-3 py-2 text-xs font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 ${centerSection === section.id ? 'bg-slate-900 text-white shadow-sm' : 'text-slate-600 hover:bg-white hover:text-slate-900'}`}><Icon size={15} aria-hidden="true" />{section.label}</button>;
      })}</nav>
      {centerSection === 'services' && (editing ? <div className="space-y-4">{renderSection('processing')}{renderSection('appraisal')}</div> : <LoanCenterView details={details} stageLabel={stageDisplay} onNotes={() => setCenterSection('notes')} appraisal={renderSection('appraisal')} />)}
      {centerSection === 'services' && !editing && details.ariveSync && details.loan.loanNumber === '17881588' && <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"><button type="button" aria-expanded={allTrackersOpen} onClick={() => setAllTrackersOpen(value => !value)} className="flex w-full items-center justify-between text-left text-sm font-semibold text-slate-700">All Arive trackers<span className="text-xs text-blue-600">{allTrackersOpen ? 'Hide' : 'Show'}</span></button>{allTrackersOpen && <div className="mt-4"><AriveRequestTrackersPanel requestTaskId={details.sourceTask.id} refreshSignal={details.ariveSync?.lastSuccessAt} /></div>}</section>}
      {centerSection === 'notes' && <div className="space-y-4">
        {details.ariveSync && <><AriveNoteHeaderGuide />{Boolean(details.ariveSync.structuredFields?.length) && <details className="rounded-2xl border border-blue-100 bg-white p-4 shadow-sm"><summary className="cursor-pointer text-sm font-bold text-slate-800">Current values from note headers</summary><p className="mt-2 text-xs text-slate-500">The latest value for each header. The full imported conversation is below.</p><div className="mt-3 grid items-start gap-3 sm:grid-cols-2 xl:grid-cols-3">{[...details.ariveSync.structuredFields!].sort((a, b) => ariveNoteHeaderGuide.findIndex(item => item.key === a.key) - ariveNoteHeaderGuide.findIndex(item => item.key === b.key)).map(field => <DetailField key={field.key} label={field.label} value={<span className="whitespace-pre-wrap">{field.value || 'Not supplied'}</span>} />)}</div></details>}</>}
        {details.loan.loanNumber === '17881588' && <AriveNotesPanel requestTaskId={details.sourceTask.id} successfulSyncAt={details.ariveSync?.lastSuccessAt} />}
        <DetailCard title="Portal conversation" description="Notes recorded in the submission task, newest first." icon={MessageSquare}>
          {details.notes.length ? <div className="space-y-3">{[...details.notes].sort((left, right) => new Date(right.date || 0).getTime() - new Date(left.date || 0).getTime()).map(note => <article key={note.id} className="rounded-xl border border-slate-100 bg-slate-50/60 p-4"><div className="flex flex-wrap items-center justify-between gap-2"><h4 className="text-sm font-bold text-slate-800">{note.author}</h4><span className="text-xs text-slate-500">{note.date ? new Date(note.date).toLocaleString() : 'Date not supplied'}</span></div><p className="mt-2 whitespace-pre-wrap break-words text-sm leading-6 text-slate-700">{note.message}</p>{note.role && <p className="mt-2 text-[10px] font-semibold uppercase tracking-wide text-slate-400">{humanize(note.role)}</p>}</article>)}</div> : <p className="text-sm text-slate-500">No portal conversation has been recorded for this file.</p>}
        </DetailCard>
      </div>}
      {centerSection === 'documents' && <div className="space-y-4">{(details.attachments.length > 0 || details.loan.loanNumber !== '17881588' || editing) && renderSection('documents')}{details.loan.loanNumber === '17881588' && !editing && <AriveWorkspacePanel requestTaskId={details.sourceTask.id} refreshSignal={details.ariveSync?.lastSuccessAt} />}</div>}
      {centerSection === 'activity' && renderSection('activity')}
    </div>;
  };

  return createPortal(
    <div
      className="fixed inset-0 z-[220] flex items-center justify-center bg-slate-950/55 p-2 backdrop-blur-sm sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="processing-borrower-workspace-title"
      data-live-refresh-pause="true"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) requestClose();
      }}
    >
      <WorkspacePanel ref={panelRef}>
        <header className="relative overflow-hidden border-b border-slate-200 bg-white px-4 py-4 sm:px-6">
          <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(37,99,235,0.12),transparent_42%),radial-gradient(circle_at_top_right,rgba(14,165,233,0.1),transparent_40%)]" />
          <div className="relative flex items-start gap-3 sm:items-center">
            <span className="inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-blue-600 to-indigo-700 text-sm font-black text-white shadow-lg shadow-blue-200">
              {initials}
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <h2 id="processing-borrower-workspace-title" className="truncate text-xl font-black tracking-tight text-slate-950 sm:text-2xl">
                  {details?.borrower.name || 'Borrower workspace'}
                </h2>
                {details && (
                  <span className="rounded-full border border-blue-200 bg-blue-50 px-2.5 py-1 font-mono text-[11px] font-bold text-blue-800">
                    Arive #{details.loan.loanNumber}
                  </span>
                )}
              </div>
              <p className="mt-1 text-xs font-semibold text-slate-500 sm:text-sm">
                {details
                  ? `${stageDisplay} · ${details.ownership.loanOfficer?.name || 'Unassigned LO'}`
                  : 'Loading the complete processing file…'}
              </p>
            </div>
            {details?.canEdit && !editing && (
              <button
                type="button"
                onClick={beginEditing}
                className="app-btn-secondary !h-10 !rounded-xl"
              >
                <Pencil className="h-4 w-4" />
                Edit details
              </button>
            )}
            {editing && (
              <button
                type="button"
                onClick={() => {
                  setEditing(false);
                  setDraft(null);
                  setSaveError('');
                  setAriveBlockedFields([]);
                  setAriveLatestDraft(null);
                }}
                disabled={saving}
                className="app-btn-secondary !h-10 !rounded-xl"
              >
                Cancel
              </button>
            )}
            <button
              ref={closeButtonRef}
              type="button"
              onClick={requestClose}
              disabled={saving}
              className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-500 shadow-sm transition hover:bg-slate-50 hover:text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-300"
              aria-label="Close borrower workspace"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </header>

        {details && (
          <div className="border-b border-slate-200 bg-white px-3 py-2 sm:px-5">
            <nav className="grid grid-cols-2 gap-1.5 sm:grid-cols-4" aria-label="Borrower detail sections">
              {tabs.map((tab) => {
                const Icon = tab.icon;
                const selected = activeTab === tab.id;
                return (
                  <button
                    key={tab.id}
                    type="button"
                    aria-pressed={selected}
                    onClick={() => setActiveTab(tab.id)}
                    className={`inline-flex items-center justify-center gap-2 rounded-xl px-3 py-3 text-xs font-bold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-300 sm:text-sm ${
                      selected
                        ? 'bg-blue-600 text-white shadow-sm'
                        : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                    }`}
                  >
                    <Icon className="h-4 w-4" aria-hidden="true" />
                    {tab.label}
                  </button>
                );
              })}
            </nav>
          </div>
        )}

        <main className="min-h-0 flex-1 overflow-y-auto p-3 sm:p-5">
          {error ? (
            <div role="alert" className="mx-auto mt-16 max-w-lg rounded-2xl border border-red-200 bg-red-50 p-6 text-center">
              <p className="font-bold text-red-900">Unable to open this borrower file</p>
              <p className="mt-2 text-sm font-medium text-red-700">{error}</p>
            </div>
          ) : !details ? (
            <PortalLoadingState
              variant="compact"
              label="Opening borrower file"
              description="Preparing loan details, documents, and activity."
            />
          ) : (
            <>
              <AriveSyncStatus compact view={details.ariveSync} pipelineLoanId={pipelineLoanId} onChanged={refreshAriveDetails} editing={editing || saving} responsibilityLabel={getProcessingPipelineLockedDefaults(details.loan.lender, details.ownership.processingMethod)?.label} />
              {saveError && (
                <div role="alert" className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-bold text-red-800">
                  {saveError}
                  {ariveBlockedFields.length > 0 && <div className="mt-2 space-y-2"><p className="text-xs font-medium">Review: {ariveBlockedFields.map(ariveFieldLabel).join(', ')}. Your other unsaved edits have been kept.</p>{ariveLatestDraft && <button type="button" className="app-btn-secondary !bg-white" onClick={() => { setDraft(current => current ? mergeAriveConflictDraft(current, ariveLatestDraft, ariveBlockedFields) : current); setAriveBlockedFields([]); setAriveLatestDraft(null); setSaveError(''); setSaveMessage('Current Arive values restored. Review and save your remaining portal changes.'); }}>Use current Arive values</button>}</div>}
                </div>
              )}
              {saveMessage && (
                <div role="status" className="mb-4 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-bold text-emerald-800">
                  {saveMessage}
                </div>
              )}
              {renderWorkspace()}
            </>
          )}
        </main>

        {details && (
          <footer className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-200 bg-white px-4 py-3 text-xs font-semibold text-slate-500 sm:px-6">
            <span>Source: {details.sourceTask.title} · {formatDate(details.sourceTask.createdAt)}</span>
            {editing ? (
              <button
                type="button"
                onClick={() => void saveDetails()}
                disabled={saving || ariveBlockedFields.length > 0}
                className="app-btn-primary !h-10 !rounded-xl disabled:cursor-wait disabled:opacity-60"
              >
                {saving ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Save className="h-4 w-4" />
                )}
                {saving ? 'Saving…' : 'Save changes'}
              </button>
            ) : (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-1 text-emerald-700">
                <ShieldCheck className="h-3.5 w-3.5" />
                {details.canEdit ? 'Audited editing enabled' : 'Role-scoped file access'}
              </span>
            )}
          </footer>
        )}
      </WorkspacePanel>
    </div>,
    document.body,
  );
}
