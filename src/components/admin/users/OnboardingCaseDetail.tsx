'use client';

import { FormEvent, useMemo, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import {
  AlertTriangle,
  CalendarDays,
  CheckCircle2,
  ChevronDown,
  Clock3,
  Download,
  FileSignature,
  FileText,
  Loader2,
  ListChecks,
  Save,
  Trash2,
  Upload,
  UserRound,
  X,
} from 'lucide-react';
import {
  OnboardingDocumentStatus,
  OnboardingDocumentVisibility,
  OnboardingItemOwner,
  OnboardingItemStatus,
  OnboardingStatus,
  UserRole,
} from '@prisma/client';
import {
  completeOnboardingCase,
  createOnboardingDocumentUploadUrl,
  deleteOnboardingCase,
  finalizeOnboardingDocument,
  getOnboardingDocumentDownloadUrl,
  requestOnboardingSignature,
  resendOnboardingInvite,
  transitionOnboardingCase,
  updateDocumentSignatureState,
  updateOnboardingCaseDetails,
  updateOnboardingItem,
} from '@/app/actions/onboardingActions';
import { getRoleDisplayLabel } from '@/lib/roleLabels';

type CaseDetail = {
  id: string;
  candidateName: string;
  personalEmail: string;
  status: OnboardingStatus;
  targetRoles: UserRole[];
  ownerId: string | null;
  userId: string | null;
  permissions: {
    canEditDetails: boolean;
    canManageDocuments: boolean;
    canApprove: boolean;
  };
  submittedAt: string | null;
  approvedAt: string | null;
  createdAt: string;
  profile: {
    firstName: string | null;
    lastName: string | null;
    preferredFirstName: string | null;
    dateOfBirth: string;
    mobilePhone: string | null;
    addressLine1: string | null;
    addressLine2: string | null;
    city: string | null;
    state: string | null;
    postalCode: string | null;
    offerDate: string;
    startDate: string;
    jobTitle: string | null;
    managerName: string | null;
    basePay: string | null;
    compensationPlan: string | null;
    location: string | null;
    department: string | null;
  } | null;
  items: Array<{
    id: string;
    category: string;
    label: string;
    description: string | null;
    owner: OnboardingItemOwner;
    assignedUserId: string | null;
    status: OnboardingItemStatus;
    required: boolean;
    dueAt: string;
    internalNote: string | null;
    candidateNote: string | null;
    response: unknown;
  }>;
  documents: Array<{
    id: string;
    name: string;
    mimeType: string;
    sizeBytes: number;
    visibility: OnboardingDocumentVisibility;
    status: OnboardingDocumentStatus;
    documentType: string | null;
    signatureProvider: string | null;
    externalEnvelopeId: string | null;
    createdAt: string;
  }>;
  events: Array<{ id: string; action: string; details: unknown; createdAt: string }>;
};

const pretty = (value: string) =>
  value.toLowerCase().replace(/_/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());

const displayValue = (value: string | null | undefined) => value || 'Not provided';

function ChecklistRow({
  item,
  managers,
}: {
  item: CaseDetail['items'][number];
  managers: Array<{ id: string; name: string }>;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [expanded, setExpanded] = useState(false);
  const [saveMessage, setSaveMessage] = useState('');
  const [draft, setDraft] = useState({
    status: item.status,
    assignedUserId: item.assignedUserId || '',
    dueAt: item.dueAt,
    note: item.internalNote || '',
  });
  const save = () => startTransition(async () => {
    setSaveMessage('');
    const result = await updateOnboardingItem({
      itemId: item.id,
      status: draft.status,
      assignedUserId: draft.assignedUserId || null,
      dueAt: draft.dueAt || null,
      note: draft.note,
    });
    setSaveMessage(result.success ? 'Saved' : result.error || 'Unable to save');
    if (result.success) router.refresh();
  });
  const complete =
    draft.status === OnboardingItemStatus.COMPLETED ||
    draft.status === OnboardingItemStatus.NOT_APPLICABLE;
  const assignee = managers.find((manager) => manager.id === draft.assignedUserId)?.name;

  return (
    <article className={`overflow-hidden rounded-2xl border bg-white transition-all ${expanded ? 'border-[#3e8dc8]/40 shadow-md' : 'border-slate-200 hover:border-slate-300 hover:shadow-sm'}`}>
      <button
        type="button"
        onClick={() => setExpanded((value) => !value)}
        aria-expanded={expanded}
        className="flex w-full items-center gap-3 p-4 text-left"
      >
        <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${complete ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>
          {complete
            ? <CheckCircle2 className="h-5 w-5" aria-hidden="true" />
            : <Clock3 className="h-5 w-5" aria-hidden="true" />}
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-2">
            <span className="truncate text-sm font-bold text-slate-900">{item.label}</span>
            {!item.required && <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-bold uppercase text-slate-500">Optional</span>}
          </span>
          <span className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-500">
            <span className={`font-semibold ${complete ? 'text-emerald-700' : 'text-slate-600'}`}>{pretty(draft.status)}</span>
            <span>{assignee || 'Unassigned'}</span>
            {draft.dueAt && <span className="flex items-center gap-1"><CalendarDays className="h-3 w-3" aria-hidden="true" />{draft.dueAt}</span>}
          </span>
        </span>
        <ChevronDown className={`h-5 w-5 shrink-0 text-slate-400 transition-transform ${expanded ? 'rotate-180' : ''}`} aria-hidden="true" />
      </button>

      {expanded && (
        <div className="border-t border-slate-100 bg-slate-50/70 p-4 sm:p-5">
          {item.description && <p className="mb-4 text-sm leading-6 text-slate-600">{item.description}</p>}
          {item.candidateNote && (
            <div className="mb-4 rounded-xl border border-[#3e8dc8]/20 bg-[#3e8dc8]/5 p-3 text-sm text-slate-700">
              <span className="font-semibold text-[#347eb5]">New hire note:</span> {item.candidateNote}
            </div>
          )}
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            <label className="text-xs font-bold uppercase tracking-wide text-slate-500">
              Status
              <select value={draft.status} onChange={(event) => setDraft({ ...draft, status: event.target.value as OnboardingItemStatus })} className="app-input mt-1.5 w-full text-sm">
                {Object.values(OnboardingItemStatus).map((status) => <option key={status} value={status}>{pretty(status)}</option>)}
              </select>
            </label>
            <label className="text-xs font-bold uppercase tracking-wide text-slate-500">
              Owner
              <select value={draft.assignedUserId} onChange={(event) => setDraft({ ...draft, assignedUserId: event.target.value })} className="app-input mt-1.5 w-full text-sm">
                <option value="">Unassigned</option>
                {managers.map((manager) => <option key={manager.id} value={manager.id}>{manager.name}</option>)}
              </select>
            </label>
            <label className="text-xs font-bold uppercase tracking-wide text-slate-500">
              Due date
              <input type="date" value={draft.dueAt} onChange={(event) => setDraft({ ...draft, dueAt: event.target.value })} className="app-input mt-1.5 w-full text-sm" />
            </label>
            <label className="text-xs font-bold uppercase tracking-wide text-slate-500 sm:col-span-2 xl:col-span-3">
              Internal note
              <textarea value={draft.note} onChange={(event) => setDraft({ ...draft, note: event.target.value })} className="app-input mt-1.5 min-h-20 w-full text-sm" placeholder="Add context visible only to the onboarding team" />
            </label>
          </div>
          <div className="mt-4 flex items-center justify-end gap-3">
            {saveMessage && <span className={`text-xs font-semibold ${saveMessage === 'Saved' ? 'text-emerald-700' : 'text-red-600'}`} role="status">{saveMessage}</span>}
            <button type="button" onClick={save} disabled={pending} className="app-btn-primary">
              {pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Save className="h-4 w-4" aria-hidden="true" />}
              Save item
            </button>
          </div>
        </div>
      )}
    </article>
  );
}

export function OnboardingCaseDetail({
  onboardingCase,
  managers,
  assignableRoles,
}: {
  onboardingCase: CaseDetail;
  managers: Array<{ id: string; name: string; email: string }>;
  assignableRoles: UserRole[];
}) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [pending, startTransition] = useTransition();
  const [uploading, setUploading] = useState(false);
  const [notice, setNotice] = useState('');
  const [note, setNote] = useState('');
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [profile, setProfile] = useState({
    ownerId: onboardingCase.ownerId || '',
    targetRoles: onboardingCase.targetRoles,
    offerDate: onboardingCase.profile?.offerDate || '',
    startDate: onboardingCase.profile?.startDate || '',
    jobTitle: onboardingCase.profile?.jobTitle || '',
    managerName: onboardingCase.profile?.managerName || '',
    basePay: onboardingCase.profile?.basePay || '',
    compensationPlan: onboardingCase.profile?.compensationPlan || '',
    location: onboardingCase.profile?.location || '',
    department: onboardingCase.profile?.department || '',
  });
  const categories = useMemo(
    () => Array.from(new Set(onboardingCase.items.map((item) => item.category))),
    [onboardingCase.items],
  );
  const [activeCategory, setActiveCategory] = useState(categories[0] || '');
  const [checklistFilter, setChecklistFilter] = useState<'all' | 'open' | 'complete'>('all');
  const required = onboardingCase.items.filter((item) => item.required);
  const complete = required.filter((item) =>
    item.status === OnboardingItemStatus.COMPLETED ||
    item.status === OnboardingItemStatus.NOT_APPLICABLE,
  ).length;
  const percent = required.length ? Math.round((complete / required.length) * 100) : 0;
  const activeCategoryItems = onboardingCase.items.filter((item) => {
    if (item.category !== activeCategory) return false;
    const itemComplete =
      item.status === OnboardingItemStatus.COMPLETED ||
      item.status === OnboardingItemStatus.NOT_APPLICABLE;
    if (checklistFilter === 'complete') return itemComplete;
    if (checklistFilter === 'open') return !itemComplete;
    return true;
  });

  const saveProfile = (event: FormEvent) => {
    event.preventDefault();
    startTransition(async () => {
      const result = await updateOnboardingCaseDetails({
        caseId: onboardingCase.id,
        ...profile,
        ownerId: profile.ownerId || null,
      });
      setNotice(result.success ? 'Onboarding details saved.' : result.error || 'Unable to save details.');
      if (result.success) router.refresh();
    });
  };

  const transition = (status: OnboardingStatus) => startTransition(async () => {
    const result = status === OnboardingStatus.COMPLETED
      ? await completeOnboardingCase(onboardingCase.id)
      : await transitionOnboardingCase({ caseId: onboardingCase.id, status, note });
    setNotice(result.success ? `Status updated to ${pretty(status)}.` : result.error || 'Unable to update status.');
    if (result.success) router.refresh();
  });

  const upload = async (file: File) => {
    setUploading(true);
    try {
      const initialized = await createOnboardingDocumentUploadUrl({
        caseId: onboardingCase.id,
        filename: file.name,
        mimeType: file.type,
        sizeBytes: file.size,
      });
      if (!initialized.success || !initialized.documentId || !initialized.signedUrl || !initialized.path) throw new Error(initialized.error || 'Unable to start upload.');
      const response = await fetch(initialized.signedUrl, { method: 'PUT', headers: { 'Content-Type': file.type }, body: file });
      if (!response.ok) throw new Error('Upload failed.');
      const result = await finalizeOnboardingDocument({
        documentId: initialized.documentId,
        caseId: onboardingCase.id,
        storagePath: initialized.path,
        filename: file.name,
        mimeType: file.type,
        sizeBytes: file.size,
      });
      if (!result.success) throw new Error(result.error || 'Unable to save document.');
      setNotice('Document uploaded.');
      router.refresh();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Upload failed.');
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const download = async (id: string) => {
    const result = await getOnboardingDocumentDownloadUrl(id);
    if (result.success && result.signedUrl) window.open(result.signedUrl, '_blank', 'noopener,noreferrer');
    else setNotice(result.error || 'Unable to open document.');
  };

  const markSignature = async (documentId: string, status: OnboardingDocumentStatus) => {
    const result = await updateDocumentSignatureState({ documentId, status });
    setNotice(result.success ? 'Document status updated.' : result.error || 'Unable to update document.');
    if (result.success) router.refresh();
  };
  const requestSignature = async (documentId: string) => {
    const result = await requestOnboardingSignature(documentId);
    setNotice(
      result.success
        ? result.mode === 'provider'
          ? 'Electronic signature envelope sent.'
          : 'Document moved to manual signature tracking.'
        : result.error || 'Unable to request signature.',
    );
    if (result.success) router.refresh();
  };
  const resendInvite = async () => {
    const result = await resendOnboardingInvite(onboardingCase.id);
    setNotice(result.success ? 'A refreshed onboarding invitation was queued.' : result.error || 'Unable to resend invitation.');
    if (result.success) router.refresh();
  };
  const deleteCase = async () => {
    setDeleting(true);
    setNotice('');
    try {
      const result = await deleteOnboardingCase(onboardingCase.id);
      if (!result.success) {
        setNotice(result.error || 'Unable to delete onboarding.');
        setDeleteDialogOpen(false);
        return;
      }
      router.push('/admin/users/onboarding');
      router.refresh();
    } catch {
      setNotice('Unable to delete onboarding. Please try again.');
      setDeleteDialogOpen(false);
    } finally {
      setDeleting(false);
    }
  };

  const nextActions: Array<{ label: string; status: OnboardingStatus; tone: string }> = [];
  if (onboardingCase.permissions.canEditDetails && onboardingCase.status === OnboardingStatus.SUBMITTED) {
    nextActions.push({ label: 'Begin review', status: OnboardingStatus.UNDER_REVIEW, tone: 'app-btn-primary' });
    nextActions.push({ label: 'Request changes', status: OnboardingStatus.CHANGES_REQUESTED, tone: 'app-btn-secondary' });
  }
  if (onboardingCase.permissions.canEditDetails && onboardingCase.status === OnboardingStatus.UNDER_REVIEW) {
    if (onboardingCase.permissions.canApprove) {
      nextActions.push({ label: 'Approve onboarding', status: OnboardingStatus.APPROVED, tone: 'app-btn-primary' });
    }
    nextActions.push({ label: 'Request changes', status: OnboardingStatus.CHANGES_REQUESTED, tone: 'app-btn-secondary' });
  }
  if (onboardingCase.permissions.canApprove && onboardingCase.status === OnboardingStatus.APPROVED) {
    nextActions.push({ label: 'Complete and grant access', status: OnboardingStatus.COMPLETED, tone: 'app-btn-primary' });
  }

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <section className="app-surface-card p-6">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <div className="flex items-center gap-3">
              <div className="rounded-xl bg-blue-50 p-3 text-blue-700"><UserRound className="h-6 w-6" aria-hidden="true" /></div>
              <div><h1 className="text-2xl font-bold text-slate-900">{onboardingCase.candidateName}</h1><p className="text-sm text-slate-500">{onboardingCase.personalEmail}</p></div>
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              <span className="rounded-full border border-blue-200 bg-blue-50 px-3 py-1 text-xs font-semibold text-blue-700">{pretty(onboardingCase.status)}</span>
              {onboardingCase.targetRoles.map((role) => <span key={role} className="rounded-full bg-slate-100 px-3 py-1 text-xs text-slate-600">{getRoleDisplayLabel(role)}</span>)}
            </div>
            {onboardingCase.permissions.canEditDetails &&
              onboardingCase.status === OnboardingStatus.INVITED &&
              !onboardingCase.userId && (
                <button type="button" onClick={resendInvite} className="app-btn-secondary mt-4">
                  Resend onboarding invite
                </button>
              )}
          </div>
          <div className="w-full max-w-sm">
            <div className="mb-2 flex justify-between text-xs text-slate-500"><span>Required checklist</span><span>{complete}/{required.length}</span></div>
            <div className="h-2 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-blue-600" style={{ width: `${percent}%` }} /></div>
          </div>
        </div>
      </section>

      {notice && <div className="rounded-xl border border-blue-200 bg-blue-50 p-4 text-sm text-blue-800" role="status">{notice}</div>}

      {onboardingCase.permissions.canEditDetails && onboardingCase.profile && (
        <section className="app-surface-card p-6">
          <h2 className="text-lg font-semibold text-slate-900">Personal information</h2>
          <p className="mt-1 text-sm text-slate-500">Private details provided by the new hire.</p>
          <dl className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <div>
              <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">Legal name</dt>
              <dd className="mt-1 text-sm text-slate-800">
                {displayValue(
                  [onboardingCase.profile.firstName, onboardingCase.profile.lastName]
                    .filter(Boolean)
                    .join(' '),
                )}
              </dd>
            </div>
            <div>
              <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">Preferred name</dt>
              <dd className="mt-1 text-sm text-slate-800">{displayValue(onboardingCase.profile.preferredFirstName)}</dd>
            </div>
            <div>
              <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">Date of birth</dt>
              <dd className="mt-1 text-sm text-slate-800">{displayValue(onboardingCase.profile.dateOfBirth)}</dd>
            </div>
            <div>
              <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">Mobile phone</dt>
              <dd className="mt-1 text-sm text-slate-800">{displayValue(onboardingCase.profile.mobilePhone)}</dd>
            </div>
            <div className="sm:col-span-2">
              <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">Home address</dt>
              <dd className="mt-1 text-sm text-slate-800">
                {onboardingCase.profile.addressLine1 ? (
                  <>
                    <span className="block">{onboardingCase.profile.addressLine1}</span>
                    {onboardingCase.profile.addressLine2 && (
                      <span className="block">{onboardingCase.profile.addressLine2}</span>
                    )}
                    <span className="block">
                      {[
                        onboardingCase.profile.city,
                        onboardingCase.profile.state,
                        onboardingCase.profile.postalCode,
                      ].filter(Boolean).join(', ').replace(/,\s(?=\d)/, ' ')}
                    </span>
                  </>
                ) : 'Not provided'}
              </dd>
            </div>
          </dl>
        </section>
      )}

      {onboardingCase.permissions.canEditDetails && (
      <form onSubmit={saveProfile} className="app-surface-card p-6">
        <h2 className="text-lg font-semibold text-slate-900">Employment and access details</h2>
        <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[
            ['offerDate', 'Offer date', 'date'],
            ['startDate', 'Start date', 'date'],
            ['jobTitle', 'Job title', 'text'],
            ['managerName', 'Manager', 'text'],
            ['basePay', 'Base pay', 'text'],
            ['compensationPlan', 'Compensation plan', 'text'],
            ['department', 'Department', 'text'],
          ].map(([key, label, type]) => (
            <label key={key} className="text-sm font-medium text-slate-700">{label}<input type={type} value={String(profile[key as keyof typeof profile] || '')} onChange={(event) => setProfile({ ...profile, [key]: event.target.value })} className="app-input mt-1.5 w-full" /></label>
          ))}
          <label className="text-sm font-medium text-slate-700">Location<select value={profile.location} onChange={(event) => setProfile({ ...profile, location: event.target.value })} className="app-input mt-1.5 w-full"><option value="">Select</option><option>Remote</option><option>LV</option><option>CA</option></select></label>
          <label className="text-sm font-medium text-slate-700">Onboarding owner<select value={profile.ownerId} onChange={(event) => setProfile({ ...profile, ownerId: event.target.value })} className="app-input mt-1.5 w-full"><option value="">Unassigned</option>{managers.map((manager) => <option key={manager.id} value={manager.id}>{manager.name}</option>)}</select></label>
        </div>
        {assignableRoles.length > 0 && (
          <fieldset className="mt-5">
            <legend className="text-sm font-medium text-slate-700">Portal roles after approval</legend>
            <div className="mt-2 flex flex-wrap gap-2">
              {assignableRoles.map((role) => <label key={role} className="flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm"><input type="checkbox" checked={profile.targetRoles.includes(role)} onChange={(event) => setProfile({ ...profile, targetRoles: event.target.checked ? [...profile.targetRoles, role] : profile.targetRoles.filter((value) => value !== role) })} />{getRoleDisplayLabel(role)}</label>)}
            </div>
          </fieldset>
        )}
        <div className="mt-5 flex justify-end"><button type="submit" disabled={pending} className="app-btn-primary">{pending && <Loader2 className="h-4 w-4 animate-spin" />} Save details</button></div>
      </form>
      )}

      <section className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-[0_18px_50px_-34px_rgba(15,23,42,0.35)]">
        <div className="border-b border-slate-200 bg-gradient-to-r from-[#3e8dc8]/10 via-white to-emerald-50 px-5 py-5 sm:px-6">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex items-start gap-3">
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-[#3e8dc8] text-white shadow-lg shadow-[#3e8dc8]/20">
                <ListChecks className="h-5 w-5" aria-hidden="true" />
              </span>
              <div>
                <h2 className="text-lg font-bold text-slate-950">Onboarding checklist workspace</h2>
                <p className="mt-1 text-sm text-slate-600">Work one category at a time without scrolling through the entire process.</p>
              </div>
            </div>
            <div className="flex min-w-64 items-center gap-3 rounded-2xl border border-emerald-200 bg-white/80 px-4 py-3">
              <div className="min-w-0 flex-1">
                <div className="mb-1.5 flex justify-between text-xs font-semibold text-slate-600">
                  <span>Required progress</span><span>{complete}/{required.length}</span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-slate-100">
                  <div className="h-full rounded-full bg-emerald-500 transition-[width] duration-300" style={{ width: `${percent}%` }} />
                </div>
              </div>
              <span className="text-lg font-black text-emerald-700">{percent}%</span>
            </div>
          </div>
        </div>

        <div className="grid lg:grid-cols-[250px_minmax(0,1fr)]">
          <aside className="border-b border-slate-200 bg-slate-50/80 p-3 lg:border-b-0 lg:border-r">
            <p className="hidden px-3 pb-2 pt-1 text-[10px] font-bold uppercase tracking-[0.16em] text-slate-400 lg:block">Categories</p>
            <div className="flex gap-2 overflow-x-auto pb-1 lg:block lg:space-y-1 lg:overflow-visible">
              {categories.map((category) => {
                const categoryItems = onboardingCase.items.filter((item) => item.category === category);
                const categoryComplete = categoryItems.filter(
                  (item) =>
                    item.status === OnboardingItemStatus.COMPLETED ||
                    item.status === OnboardingItemStatus.NOT_APPLICABLE,
                ).length;
                const active = category === activeCategory;
                return (
                  <button
                    key={category}
                    type="button"
                    onClick={() => {
                      setActiveCategory(category);
                      setChecklistFilter('all');
                    }}
                    className={`min-w-52 rounded-xl px-3 py-3 text-left transition-all lg:min-w-0 lg:w-full ${
                      active
                        ? 'bg-white text-slate-950 shadow-sm ring-1 ring-slate-200'
                        : 'text-slate-600 hover:bg-white/80 hover:text-slate-900'
                    }`}
                  >
                    <span className="block truncate text-sm font-bold">{category}</span>
                    <span className="mt-1 flex items-center gap-2 text-xs">
                      <span className={categoryComplete === categoryItems.length ? 'text-emerald-700' : 'text-slate-500'}>
                        {categoryComplete}/{categoryItems.length} complete
                      </span>
                      {categoryComplete === categoryItems.length && <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" aria-hidden="true" />}
                    </span>
                  </button>
                );
              })}
            </div>
          </aside>

          <div className="min-w-0">
            <div className="flex flex-col gap-3 border-b border-slate-100 px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-5">
              <div>
                <h3 className="font-bold text-slate-900">{activeCategory}</h3>
                <p className="text-xs text-slate-500">{onboardingCase.items.filter((item) => item.category === activeCategory).length} checklist items</p>
              </div>
              <div className="inline-flex w-fit rounded-xl bg-slate-100 p-1" aria-label="Filter checklist items">
                {(['all', 'open', 'complete'] as const).map((filter) => (
                  <button
                    key={filter}
                    type="button"
                    onClick={() => setChecklistFilter(filter)}
                    className={`rounded-lg px-3 py-1.5 text-xs font-bold capitalize transition-colors ${
                      checklistFilter === filter ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-800'
                    }`}
                  >
                    {filter}
                  </button>
                ))}
              </div>
            </div>
            <div className="max-h-[680px] space-y-3 overflow-y-auto bg-slate-50/30 p-4 sm:p-5">
              {activeCategoryItems.length > 0 ? (
                activeCategoryItems.map((item) => <ChecklistRow key={item.id} item={item} managers={managers} />)
              ) : (
                <div className="rounded-2xl border border-dashed border-slate-300 bg-white px-6 py-12 text-center">
                  <CheckCircle2 className="mx-auto h-8 w-8 text-emerald-500" aria-hidden="true" />
                  <p className="mt-3 text-sm font-bold text-slate-800">No items in this view</p>
                  <p className="mt-1 text-xs text-slate-500">Choose another filter or category.</p>
                </div>
              )}
            </div>
          </div>
        </div>
      </section>

      {onboardingCase.permissions.canManageDocuments && (
      <section className="app-surface-card p-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div><h2 className="text-lg font-semibold text-slate-900">Documents and signatures</h2><p className="text-sm text-slate-500">Secure employee files and track signature status.</p></div>
          <><input ref={fileRef} type="file" className="sr-only" accept=".pdf,.doc,.docx,.jpg,.jpeg,.png" onChange={(event) => event.target.files?.[0] && upload(event.target.files[0])} /><button type="button" onClick={() => fileRef.current?.click()} disabled={uploading} className="app-btn-secondary">{uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />} Upload</button></>
        </div>
        <div className="mt-5 divide-y divide-slate-100">
          {onboardingCase.documents.length === 0 ? <p className="py-8 text-center text-sm text-slate-500">No documents yet.</p> : onboardingCase.documents.map((document) => (
            <div key={document.id} className="flex flex-col gap-3 py-3 sm:flex-row sm:items-center">
              <FileText className="h-5 w-5 text-blue-600" />
              <div className="min-w-0 flex-1"><p className="truncate text-sm font-medium text-slate-800">{document.name}</p><p className="text-xs text-slate-500">{pretty(document.status)} · {pretty(document.visibility)}</p></div>
              <button type="button" onClick={() => download(document.id)} className="app-btn-secondary"><Download className="h-4 w-4" /> Open</button>
              {document.status === OnboardingDocumentStatus.UPLOADED && <button type="button" onClick={() => requestSignature(document.id)} className="app-btn-secondary"><FileSignature className="h-4 w-4" /> Request signature</button>}
              {document.status === OnboardingDocumentStatus.PENDING_SIGNATURE && document.signatureProvider === 'creating' && <button type="button" onClick={() => requestSignature(document.id)} className="app-btn-secondary"><FileSignature className="h-4 w-4" /> Retry signature setup</button>}
              {document.status === OnboardingDocumentStatus.PENDING_SIGNATURE && document.signatureProvider !== 'creating' && <button type="button" onClick={() => markSignature(document.id, OnboardingDocumentStatus.SIGNED)} className="app-btn-secondary">Mark signed</button>}
            </div>
          ))}
        </div>
      </section>
      )}

      {nextActions.length > 0 && (
        <section className="rounded-2xl border border-slate-200 bg-slate-50 p-6">
          <h2 className="font-semibold text-slate-900">Review decision</h2>
          <textarea value={note} onChange={(event) => setNote(event.target.value)} className="app-input mt-3 min-h-20 w-full" placeholder="Add a message for the new hire or an internal review note" />
          <div className="mt-4 flex flex-wrap justify-end gap-3">{nextActions.map((action) => <button key={action.status} type="button" onClick={() => transition(action.status)} disabled={pending} className={action.tone}>{action.label}</button>)}</div>
        </section>
      )}

      <section className="app-surface-card p-6">
        <h2 className="text-lg font-semibold text-slate-900">Activity</h2>
        <div className="mt-4 space-y-4">
          {onboardingCase.events.map((event) => <div key={event.id} className="flex gap-3 text-sm"><div className="mt-1.5 h-2 w-2 rounded-full bg-blue-500" /><div><p className="font-medium text-slate-700">{pretty(event.action)}</p><p className="text-xs text-slate-500">{new Date(event.createdAt).toLocaleString()}</p></div></div>)}
        </div>
      </section>

      {onboardingCase.permissions.canApprove &&
        onboardingCase.status !== OnboardingStatus.COMPLETED && (
          <section className="rounded-2xl border border-red-200 bg-red-50/70 p-6">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 className="font-semibold text-red-950">Delete this onboarding</h2>
                <p className="mt-1 max-w-2xl text-sm text-red-800">
                  Permanently remove the onboarding record, invitation, uploaded files, and temporary account. You can then start a new onboarding using the same email.
                </p>
              </div>
              <button type="button" onClick={() => setDeleteDialogOpen(true)} className="app-btn-danger shrink-0">
                <Trash2 className="h-4 w-4" aria-hidden="true" />
                Delete onboarding
              </button>
            </div>
          </section>
        )}

      {deleteDialogOpen && (
        <div className="fixed inset-0 z-[110] flex items-center justify-center bg-slate-950/50 p-4 backdrop-blur-sm">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="delete-onboarding-title"
            aria-describedby="delete-onboarding-description"
            className="w-full max-w-lg rounded-2xl border border-red-200 bg-white p-6 shadow-2xl"
          >
            <div className="flex items-start justify-between gap-4">
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-red-100 text-red-700">
                <AlertTriangle className="h-5 w-5" aria-hidden="true" />
              </span>
              <button type="button" onClick={() => setDeleteDialogOpen(false)} disabled={deleting} className="app-icon-btn" aria-label="Close delete confirmation">
                <X className="h-5 w-5" aria-hidden="true" />
              </button>
            </div>
            <h2 id="delete-onboarding-title" className="mt-5 text-xl font-bold text-slate-950">
              Delete {onboardingCase.candidateName}&apos;s onboarding?
            </h2>
            <p id="delete-onboarding-description" className="mt-2 text-sm leading-6 text-slate-600">
              This cannot be undone. Their invitation will stop working, their temporary login will be removed, and all onboarding documents and progress will be permanently deleted.
            </p>
            <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
              <button type="button" onClick={() => setDeleteDialogOpen(false)} disabled={deleting} className="app-btn-secondary">
                Keep onboarding
              </button>
              <button type="button" onClick={deleteCase} disabled={deleting} className="app-btn-danger">
                {deleting ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Trash2 className="h-4 w-4" aria-hidden="true" />}
                {deleting ? 'Deleting…' : 'Delete permanently'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
