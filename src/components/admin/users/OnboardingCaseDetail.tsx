'use client';

import { FormEvent, useMemo, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import {
  CheckCircle2,
  Clock3,
  Download,
  FileSignature,
  FileText,
  Loader2,
  Save,
  Upload,
  UserRound,
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
  const [draft, setDraft] = useState({
    status: item.status,
    assignedUserId: item.assignedUserId || '',
    dueAt: item.dueAt,
    note: item.internalNote || '',
  });
  const save = () => startTransition(async () => {
    await updateOnboardingItem({
      itemId: item.id,
      status: draft.status,
      assignedUserId: draft.assignedUserId || null,
      dueAt: draft.dueAt || null,
      note: draft.note,
    });
    router.refresh();
  });
  return (
    <div className="grid gap-3 border-t border-slate-100 px-4 py-4 lg:grid-cols-[minmax(220px,1fr)_150px_180px_145px_36px] lg:items-center">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          {draft.status === OnboardingItemStatus.COMPLETED
            ? <CheckCircle2 className="h-4 w-4 text-emerald-600" aria-hidden="true" />
            : <Clock3 className="h-4 w-4 text-slate-400" aria-hidden="true" />}
          <p className="text-sm font-medium text-slate-800">{item.label}</p>
          {!item.required && <span className="text-xs text-slate-400">Optional</span>}
        </div>
        {item.description && <p className="mt-1 text-xs text-slate-500">{item.description}</p>}
        {item.candidateNote && <p className="mt-1 text-xs text-blue-700">New hire: {item.candidateNote}</p>}
        <input value={draft.note} onChange={(event) => setDraft({ ...draft, note: event.target.value })} className="app-input mt-2 w-full text-xs" placeholder="Internal note" aria-label={`Internal note for ${item.label}`} />
      </div>
      <select value={draft.status} onChange={(event) => setDraft({ ...draft, status: event.target.value as OnboardingItemStatus })} className="app-input text-xs" aria-label={`Status for ${item.label}`}>
        {Object.values(OnboardingItemStatus).map((status) => <option key={status} value={status}>{pretty(status)}</option>)}
      </select>
      <select value={draft.assignedUserId} onChange={(event) => setDraft({ ...draft, assignedUserId: event.target.value })} className="app-input text-xs" aria-label={`Assignee for ${item.label}`}>
        <option value="">Unassigned</option>
        {managers.map((manager) => <option key={manager.id} value={manager.id}>{manager.name}</option>)}
      </select>
      <input type="date" value={draft.dueAt} onChange={(event) => setDraft({ ...draft, dueAt: event.target.value })} className="app-input text-xs" aria-label={`Due date for ${item.label}`} />
      <button type="button" onClick={save} disabled={pending} className="rounded-lg p-2 text-blue-600 hover:bg-blue-50" aria-label={`Save ${item.label}`}>
        {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
      </button>
    </div>
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
  const required = onboardingCase.items.filter((item) => item.required);
  const complete = required.filter((item) =>
    item.status === OnboardingItemStatus.COMPLETED ||
    item.status === OnboardingItemStatus.NOT_APPLICABLE,
  ).length;
  const percent = required.length ? Math.round((complete / required.length) * 100) : 0;

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
    <div className="space-y-6">
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

      <section className="app-surface-card overflow-hidden">
        <div className="p-6"><h2 className="text-lg font-semibold text-slate-900">Onboarding checklist</h2><p className="text-sm text-slate-500">Assign owners, due dates, and track evidence for every step.</p></div>
        {categories.map((category) => (
          <div key={category}>
            <div className="border-y border-slate-200 bg-slate-50 px-4 py-2 text-xs font-bold uppercase tracking-wide text-slate-500">{category}</div>
            {onboardingCase.items.filter((item) => item.category === category).map((item) => <ChecklistRow key={item.id} item={item} managers={managers} />)}
          </div>
        ))}
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
    </div>
  );
}
