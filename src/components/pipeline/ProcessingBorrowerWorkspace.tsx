'use client';

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { createPortal } from 'react-dom';
import {
  Activity,
  Building2,
  Check,
  Clipboard,
  Clock3,
  DollarSign,
  Download,
  FileText,
  Home,
  Landmark,
  Loader2,
  MapPin,
  Pencil,
  Phone,
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

type WorkspaceTab =
  | 'overview'
  | 'borrower'
  | 'property'
  | 'loan'
  | 'processing'
  | 'appraisal'
  | 'activity'
  | 'documents';

const tabs: Array<{
  id: WorkspaceTab;
  label: string;
  icon: typeof UserRound;
}> = [
  { id: 'overview', label: 'Overview', icon: Home },
  { id: 'borrower', label: 'Borrower', icon: UserRound },
  { id: 'property', label: 'Property', icon: MapPin },
  { id: 'loan', label: 'Loan', icon: Landmark },
  { id: 'processing', label: 'Processing', icon: Building2 },
  { id: 'appraisal', label: 'Appraisal', icon: ShieldCheck },
  { id: 'activity', label: 'Activity', icon: Activity },
  { id: 'documents', label: 'Documents', icon: FileText },
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

function DetailCard({
  title,
  description,
  icon: Icon,
  children,
}: {
  title: string;
  description?: string;
  icon: typeof UserRound;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="mb-4 flex items-start gap-3">
        <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-blue-50 text-blue-700">
          <Icon className="h-5 w-5" aria-hidden="true" />
        </span>
        <div>
          <h3 className="text-sm font-black text-slate-950">{title}</h3>
          {description && (
            <p className="mt-0.5 text-xs font-medium text-slate-500">
              {description}
            </p>
          )}
        </div>
      </div>
      {children}
    </section>
  );
}

function DetailField({
  label,
  value,
  copyable = false,
}: {
  label: string;
  value: React.ReactNode;
  copyable?: boolean;
}) {
  const [copied, setCopied] = useState(false);
  const textValue =
    typeof value === 'string' || typeof value === 'number'
      ? String(value)
      : '';
  return (
    <div className="min-w-0 rounded-xl border border-slate-100 bg-slate-50/70 px-3 py-2.5">
      <p className="text-[10px] font-black uppercase tracking-[0.1em] text-slate-400">
        {label}
      </p>
      <div className="mt-1 flex min-w-0 items-center gap-2">
        <div className="min-w-0 flex-1 break-words text-sm font-bold text-slate-800">
          {value || <span className="font-medium text-slate-400">Not provided</span>}
        </div>
        {copyable && textValue && (
          <button
            type="button"
            onClick={async () => {
              await navigator.clipboard.writeText(textValue);
              setCopied(true);
              window.setTimeout(() => setCopied(false), 1400);
            }}
            className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-500 transition hover:border-blue-200 hover:text-blue-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-300"
            aria-label={`Copy ${label}`}
          >
            {copied ? (
              <Check className="h-3.5 w-3.5" />
            ) : (
              <Clipboard className="h-3.5 w-3.5" />
            )}
          </button>
        )}
      </div>
    </div>
  );
}

function DetailGrid({ children }: { children: React.ReactNode }) {
  return <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{children}</div>;
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
  const [activeTab, setActiveTab] = useState<WorkspaceTab>('overview');
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<ProcessingBorrowerDetailsInput | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState('');
  const [saveError, setSaveError] = useState('');
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
    });
    return () => {
      cancelled = true;
    };
  }, [pipelineLoanId]);

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
          'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      );
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
    setEditing(true);
    if (activeTab === 'overview') setActiveTab('borrower');
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
    setEditing(false);
    setSaveMessage('Changes saved and added to the activity history.');
    onSaved?.();
  };

  const renderOverview = () =>
    details && (
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.6fr)_minmax(280px,0.8fr)]">
        <div className="space-y-4">
          <DetailCard
            title="File at a glance"
            description="The operational facts processors need most often."
            icon={Home}
          >
            <DetailGrid>
              <DetailField label="Loan amount" value={formatMoney(details.loan.amount)} />
              <DetailField label="Lender" value={details.loan.lender} />
              <DetailField label="Loan type" value={details.loan.loanType} />
              <DetailField label="Program" value={details.loan.program} />
              <DetailField label="Property" value={details.property.address} copyable />
              <DetailField label="Effective Loan Officer" value={details.ownership.loanOfficer?.name} />
            </DetailGrid>
          </DetailCard>
          <DetailCard
            title="Processing snapshot"
            description="Live milestones from the processing pipeline."
            icon={Building2}
          >
            <DetailGrid>
              <DetailField label="Pipeline status" value={statusLabel(details.processing.pipelineStatus)} />
              <DetailField label="Days in status" value={details.processing.daysInStatus} />
              <DetailField label="Title" value={itemStatusLabel(details.processing.titleStatus)} />
              <DetailField label="Payoff" value={itemStatusLabel(details.processing.payoffStatus)} />
              <DetailField
                label="Payoff expiration"
                value={formatDate(details.processing.payoffExpiresAt)}
              />
              <DetailField label="HOI" value={itemStatusLabel(details.processing.hoiStatus)} />
              <DetailField label="CD sent" value={details.processing.cdSent ? 'Yes' : 'No'} />
            </DetailGrid>
          </DetailCard>
        </div>
        <div className="space-y-4">
          <DetailCard
            title="Contact"
            description="Reach the borrower without leaving the file."
            icon={Phone}
          >
            <div className="space-y-2">
              <DetailField
                label="Phone"
                value={
                  details.borrower.phone ? (
                    <a className="text-blue-700 hover:underline" href={`tel:${details.borrower.phone}`}>
                      {details.borrower.phone}
                    </a>
                  ) : null
                }
                copyable={false}
              />
              <DetailField
                label="Email"
                value={
                  details.borrower.email ? (
                    <a className="text-blue-700 hover:underline" href={`mailto:${details.borrower.email}`}>
                      {details.borrower.email}
                    </a>
                  ) : null
                }
              />
            </div>
          </DetailCard>
          <DetailCard
            title="Ownership"
            description="Current file routing and accountability."
            icon={Users}
          >
            <div className="space-y-2">
              <DetailField label="Senior Processor" value={details.ownership.seniorProcessor?.name} />
              <DetailField label="Junior Processor" value={details.ownership.juniorProcessor?.name} />
              <DetailField label="Processing method" value={humanize(details.ownership.processingMethod)} />
            </div>
          </DetailCard>
        </div>
      </div>
    );

  const renderTab = () => {
    if (!details) return null;
    if (activeTab === 'overview') return renderOverview();
    if (activeTab === 'borrower') {
      if (editing && draft) {
        return (
          <div className="grid gap-4 xl:grid-cols-2">
            <DetailCard title="Primary borrower" description="At least one primary borrower name is required." icon={UserRound}>
              <DetailGrid>
                <EditField label="First name" value={draft.borrowerFirstName} onChange={(value) => patchDraft('borrowerFirstName', value)} />
                <EditField label="Last name" value={draft.borrowerLastName} onChange={(value) => patchDraft('borrowerLastName', value)} />
                <EditField label="Phone" type="tel" value={draft.borrowerPhone} onChange={(value) => patchDraft('borrowerPhone', value)} />
                <EditField label="Email" type="email" value={draft.borrowerEmail} onChange={(value) => patchDraft('borrowerEmail', value)} />
              </DetailGrid>
            </DetailCard>
            <DetailCard title="Co-borrower" description="Optional co-borrower identity and contact details." icon={Users}>
              <DetailGrid>
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
            <DetailGrid>
              <DetailField label="Full name" value={details.borrower.name} copyable />
              <DetailField label="Phone" value={details.borrower.phone} copyable />
              <DetailField label="Email" value={details.borrower.email} copyable />
            </DetailGrid>
          </DetailCard>
          <DetailCard title="Co-borrower" description="Shown when included in the MISMO or submission." icon={Users}>
            <DetailGrid>
              <DetailField label="Full name" value={coBorrowerName} copyable />
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
            <DetailGrid>
              <EditField label="Street" value={draft.propertyStreet} onChange={(value) => patchDraft('propertyStreet', value)} />
              <EditField label="Unit" value={draft.propertyUnit} onChange={(value) => patchDraft('propertyUnit', value)} />
              <EditField label="City" value={draft.propertyCity} onChange={(value) => patchDraft('propertyCity', value)} />
              <EditField label="State" value={draft.propertyState} onChange={(value) => patchDraft('propertyState', value.toUpperCase())} placeholder="FL" />
              <EditField label="ZIP" value={draft.propertyZip} onChange={(value) => patchDraft('propertyZip', value)} />
              <EditField label="Occupancy" value={draft.propertyOccupancy} onChange={(value) => patchDraft('propertyOccupancy', value)} />
              <EditField label="Estimated value" type="number" value={draft.estimatedValue} onChange={(value) => patchDraft('estimatedValue', value)} />
              <EditField label="Year built" type="number" value={draft.yearBuilt} onChange={(value) => patchDraft('yearBuilt', value)} />
              <EditField label="Year acquired" type="number" value={draft.yearAcquired} onChange={(value) => patchDraft('yearAcquired', value)} />
              <EditField label="Title held as" value={draft.titleHeldAs} onChange={(value) => patchDraft('titleHeldAs', value)} />
            </DetailGrid>
          </DetailCard>
        );
      }
      return (
        <DetailCard title="Subject property" description="Structured MISMO and submission address details." icon={MapPin}>
          <DetailGrid>
            <DetailField label="Complete address" value={details.property.address} copyable />
            <DetailField label="Street" value={details.property.street} />
            <DetailField label="Unit" value={details.property.unit} />
            <DetailField label="City" value={details.property.city} />
            <DetailField label="State" value={details.property.state} />
            <DetailField label="ZIP" value={details.property.zip} />
            <DetailField label="Occupancy" value={humanize(details.property.occupancy)} />
            <DetailField label="Estimated value" value={formatMoney(details.property.estimatedValue)} />
            <DetailField label="Year built" value={details.property.yearBuilt} />
            <DetailField label="Year acquired" value={details.property.yearAcquired} />
            <DetailField label="Title held as" value={details.property.titleHeldAs} />
          </DetailGrid>
        </DetailCard>
      );
    }
    if (activeTab === 'loan') {
      if (editing && draft) {
        return (
          <DetailCard title="Loan structure" description="Arive # is the permanent file identifier and cannot be changed." icon={Landmark}>
            <DetailGrid>
              <DetailField label="Arive # · locked" value={details.loan.loanNumber} copyable />
              <EditField label="Loan amount" type="number" value={draft.loanAmount} onChange={(value) => patchDraft('loanAmount', value)} required />
              <EditField label="Loan type" value={draft.loanType} onChange={(value) => patchDraft('loanType', value)} />
              <EditField label="Program" value={draft.loanProgram} onChange={(value) => patchDraft('loanProgram', value)} />
              <EditField label="Lender" value={draft.lender} onChange={(value) => patchDraft('lender', value)} />
              <EditField label="Channel" value={draft.channel} onChange={(value) => patchDraft('channel', value)} />
              <EditField label="Purpose" value={draft.loanPurpose} onChange={(value) => patchDraft('loanPurpose', value)} />
              <EditField label="Lead source" value={draft.leadSource} onChange={(value) => patchDraft('leadSource', value)} />
              <EditField label="Cash back" type="number" value={draft.cashBack} onChange={(value) => patchDraft('cashBack', value)} />
              <EditField label="Projected revenue" type="number" value={draft.projectedRevenue} onChange={(value) => patchDraft('projectedRevenue', value)} />
            </DetailGrid>
          </DetailCard>
        );
      }
      return (
        <DetailCard title="Loan structure" description="Origination and revenue information." icon={Landmark}>
          <DetailGrid>
            <DetailField label="Arive #" value={details.loan.loanNumber} copyable />
            <DetailField label="Loan amount" value={formatMoney(details.loan.amount)} />
            <DetailField label="Loan type" value={details.loan.loanType} />
            <DetailField label="Program / purpose" value={details.loan.program || details.loan.purpose} />
            <DetailField label="Lender" value={details.loan.lender} />
            <DetailField label="Channel" value={details.loan.channel} />
            <DetailField label="Lead source" value={details.loan.leadSource} />
            <DetailField label="Cash back" value={formatMoney(details.loan.cashBack)} />
            <DetailField label="Projected revenue" value={formatMoney(details.loan.projectedRevenue)} />
          </DetailGrid>
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
        const payoffLocked = Boolean(
          getProcessingPipelineLockedDefaults(
            draft.lender,
            details.ownership.processingMethod,
          )?.lockedFields.includes('payoffStatus'),
        );
        return (
          <div className="space-y-4">
            <DetailCard title="Milestones" description="Workflow changes are validated and audited when saved." icon={Building2}>
              <DetailGrid>
                <EditSelect
                  label="Sheet"
                  value={draft.sheet}
                  options={[
                    { value: 'PIPELINE', label: 'Pipeline' },
                    { value: 'RESTRUCTURE', label: 'Restructures' },
                    { value: 'FUNDING', label: 'Fundings' },
                  ]}
                  onChange={(value) => {
                    setDraft((current) => {
                      if (!current) return current;
                      const sheet = value as ProcessingBorrowerDetailsInput['sheet'];
                      const pipelineStatus =
                        sheet === 'FUNDING'
                          ? 'FUNDED'
                          : sheet === 'RESTRUCTURE'
                            ? 'SUSPENDED_RESTRUCTURE'
                            : 'RE_SUB';
                      return { ...current, sheet, pipelineStatus };
                    });
                  }}
                />
                <EditSelect
                  label="Pipeline status"
                  value={draft.pipelineStatus}
                  options={statusOptions}
                  onChange={(value) =>
                    patchDraft(
                      'pipelineStatus',
                      value as ProcessingBorrowerDetailsInput['pipelineStatus'],
                    )
                  }
                />
                <EditField label="Assigned" type="date" value={draft.dateAssigned} onChange={(value) => patchDraft('dateAssigned', value)} required />
                <EditField label="Estimated signing" type="date" value={draft.estimatedSigningAt} onChange={(value) => patchDraft('estimatedSigningAt', value)} />
                {draft.sheet === 'FUNDING' && (
                  <EditField label="Funded date" type="date" value={draft.fundedAt} onChange={(value) => patchDraft('fundedAt', value)} required />
                )}
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
              </DetailGrid>
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
            <DetailGrid>
              <DetailField label="Pipeline status" value={statusLabel(details.processing.pipelineStatus)} />
              <DetailField label="Sheet" value={humanize(details.processing.sheet)} />
              <DetailField label="Days in status" value={details.processing.daysInStatus} />
              <DetailField label="Assigned" value={formatDate(details.processing.dateAssigned)} />
              <DetailField label="Estimated signing" value={formatDate(details.processing.estimatedSigningAt)} />
              <DetailField label="Title" value={itemStatusLabel(details.processing.titleStatus)} />
              <DetailField label="Payoff" value={itemStatusLabel(details.processing.payoffStatus)} />
              <DetailField
                label="Payoff expiration"
                value={formatDate(details.processing.payoffExpiresAt)}
              />
              <DetailField label="HOI" value={itemStatusLabel(details.processing.hoiStatus)} />
              <DetailField label="Rate lock" value={details.processing.rateLock ? 'Yes' : 'No'} />
              <DetailField label="Lock expiration" value={formatDate(details.processing.rateLockExpiresAt)} />
              <DetailField label="CD sent" value={details.processing.cdSent ? 'Yes' : 'No'} />
              <DetailField label="Funded date" value={formatDate(details.processing.fundedAt)} />
            </DetailGrid>
          </DetailCard>
          <DetailCard title="Processor notes" description="Open items and workflow context." icon={Clipboard}>
            <DetailGrid>
              <DetailField label="Pending items" value={details.processing.missingItemsCurrentStatus} />
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
          <div className="grid gap-4 xl:grid-cols-[minmax(0,1.4fr)_minmax(300px,0.8fr)]">
            <DetailCard title="Appraisal workflow" description="Update appraisal intent, dates, waiver, and notes." icon={ShieldCheck}>
              <DetailGrid>
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
                <EditField label="Ordered" type="date" value={draft.appraisalOrderedAt} onChange={(value) => patchDraft('appraisalOrderedAt', value)} />
                <EditField label="Received" type="date" value={draft.appraisalBackAt} onChange={(value) => patchDraft('appraisalBackAt', value)} />
                <EditField label="Notes" value={draft.appraisalNotes} onChange={(value) => patchDraft('appraisalNotes', value)} multiline />
              </DetailGrid>
            </DetailCard>
            <DetailCard title="Payment method" description="Card data is intentionally not stored in this portal." icon={DollarSign}>
              <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
                <p className="text-sm font-bold text-amber-900">Secure capture not configured</p>
                <p className="mt-1 text-xs font-medium leading-5 text-amber-800">Payment card details remain outside this editable workspace.</p>
              </div>
            </DetailCard>
          </div>
        );
      }
      return (
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1.4fr)_minmax(300px,0.8fr)]">
          <DetailCard title="Appraisal workflow" description="Submission intent and processing dates." icon={ShieldCheck}>
            <DetailGrid>
              <DetailField label="Appraisal needed" value={details.appraisal.needed === null ? 'Not set' : details.appraisal.needed ? 'Yes' : 'No'} />
              <DetailField label="Waiver" value={details.appraisal.waiver} />
              <DetailField label="Ordered" value={formatDate(details.appraisal.orderedAt)} />
              <DetailField label="Received" value={formatDate(details.appraisal.backAt)} />
              <DetailField label="Notes" value={details.appraisal.notes} />
            </DetailGrid>
          </DetailCard>
          <DetailCard title="Payment method" description="Card data is intentionally not stored in this portal." icon={DollarSign}>
            <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
              <p className="text-sm font-bold text-amber-900">Secure capture not configured</p>
              <p className="mt-1 text-xs font-medium leading-5 text-amber-800">
                A future PCI-compliant provider can supply a masked card summary and payment status here.
              </p>
            </div>
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
        <DetailCard title="Notes and activity" description="Submission notes and audited pipeline changes." icon={Activity}>
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
            <p className="py-8 text-center text-sm font-medium text-slate-500">No documents are attached to this request.</p>
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
      <div
        ref={panelRef}
        className="flex h-[min(94vh,980px)] w-full max-w-[1480px] flex-col overflow-hidden rounded-[28px] border border-white/40 bg-slate-100 shadow-2xl"
      >
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
                  ? `${statusLabel(details.processing.pipelineStatus)} · ${details.ownership.loanOfficer?.name || 'Unassigned LO'}`
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
            <nav className="flex gap-1 overflow-x-auto" aria-label="Borrower detail sections">
              {tabs.map((tab) => {
                const Icon = tab.icon;
                const selected = activeTab === tab.id;
                return (
                  <button
                    key={tab.id}
                    type="button"
                    aria-pressed={selected}
                    onClick={() => setActiveTab(tab.id)}
                    className={`inline-flex shrink-0 items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-bold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-300 ${
                      selected
                        ? 'bg-blue-600 text-white shadow-sm'
                        : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                    }`}
                  >
                    <Icon className="h-3.5 w-3.5" />
                    {tab.label}
                  </button>
                );
              })}
            </nav>
          </div>
        )}

        <main className="min-h-0 flex-1 overflow-y-auto p-3 sm:p-5">
          {error ? (
            <div className="mx-auto mt-16 max-w-lg rounded-2xl border border-red-200 bg-red-50 p-6 text-center">
              <p className="font-bold text-red-900">Unable to open this borrower file</p>
              <p className="mt-2 text-sm font-medium text-red-700">{error}</p>
            </div>
          ) : !details ? (
            <div className="flex h-full min-h-72 flex-col items-center justify-center gap-3 text-center">
              <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
              <div>
                <p className="font-bold text-slate-900">Building borrower workspace</p>
                <p className="mt-1 text-sm font-medium text-slate-500">Combining submission, loan, processing, and activity data.</p>
              </div>
            </div>
          ) : (
            <>
              {saveError && (
                <div role="alert" className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-bold text-red-800">
                  {saveError}
                </div>
              )}
              {saveMessage && (
                <div role="status" className="mb-4 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-bold text-emerald-800">
                  {saveMessage}
                </div>
              )}
              {renderTab()}
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
                disabled={saving}
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
      </div>
    </div>,
    document.body,
  );
}
