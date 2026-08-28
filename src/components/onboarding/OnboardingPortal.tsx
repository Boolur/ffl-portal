'use client';

import { FormEvent, useMemo, useRef, useState, useTransition } from 'react';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { signOut } from 'next-auth/react';
import {
  CheckCircle2,
  Circle,
  Clock3,
  FileText,
  Loader2,
  LogOut,
  ShieldCheck,
  Upload,
} from 'lucide-react';
import { OnboardingItemStatus, OnboardingStatus } from '@prisma/client';
import {
  createOnboardingDocumentUploadUrl,
  finalizeOnboardingDocument,
  getOnboardingDocumentDownloadUrl,
  submitOnboardingCase,
  updateCandidateProfile,
} from '@/app/actions/onboardingActions';

type CandidateCase = {
  id: string;
  candidateName: string;
  personalEmail: string;
  status: OnboardingStatus;
  profile: {
    firstName: string | null;
    lastName: string | null;
    preferredFirstName: string | null;
    dateOfBirth: string;
    mobilePhone: string | null;
    homeAddress: string | null;
  } | null;
  items: Array<{
    id: string;
    category: string;
    label: string;
    description: string | null;
    status: OnboardingItemStatus;
    required: boolean;
    candidateNote: string | null;
  }>;
  documents: Array<{
    id: string;
    name: string;
    mimeType: string;
    sizeBytes: number;
    status: string;
    createdAt: string;
  }>;
  events: Array<{
    id: string;
    action: string;
    details: unknown;
    createdAt: string;
  }>;
};

const statusCopy: Record<OnboardingStatus, { label: string; message: string }> = {
  INVITED: { label: 'Invited', message: 'Create your profile to begin.' },
  IN_PROGRESS: { label: 'In progress', message: 'Complete the items below when you are ready.' },
  SUBMITTED: { label: 'Submitted', message: 'Your information is waiting for management review.' },
  UNDER_REVIEW: { label: 'Under review', message: 'The BISU team is reviewing your onboarding.' },
  CHANGES_REQUESTED: { label: 'Changes requested', message: 'Please review the requested updates and resubmit.' },
  APPROVED: { label: 'Approved', message: 'Your onboarding is approved and your workspace is being prepared.' },
  COMPLETED: { label: 'Complete', message: 'Your assigned BISU Portal access is ready.' },
  CANCELLED: { label: 'Cancelled', message: 'This onboarding process is no longer active.' },
};

function ItemIcon({ status }: { status: OnboardingItemStatus }) {
  if (status === OnboardingItemStatus.COMPLETED) {
    return <CheckCircle2 className="h-5 w-5 text-emerald-600" aria-hidden="true" />;
  }
  if (status === OnboardingItemStatus.SUBMITTED) {
    return <Clock3 className="h-5 w-5 text-amber-600" aria-hidden="true" />;
  }
  return <Circle className="h-5 w-5 text-slate-300" aria-hidden="true" />;
}

export function OnboardingPortal({ onboardingCase }: { onboardingCase: CandidateCase }) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [pending, startTransition] = useTransition();
  const [uploading, setUploading] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [profile, setProfile] = useState({
    firstName: onboardingCase.profile?.firstName || '',
    lastName: onboardingCase.profile?.lastName || '',
    preferredFirstName: onboardingCase.profile?.preferredFirstName || '',
    dateOfBirth: onboardingCase.profile?.dateOfBirth || '',
    mobilePhone: onboardingCase.profile?.mobilePhone || '',
    homeAddress: onboardingCase.profile?.homeAddress || '',
  });
  const editableStatuses = new Set<OnboardingStatus>([
    OnboardingStatus.INVITED,
    OnboardingStatus.IN_PROGRESS,
    OnboardingStatus.CHANGES_REQUESTED,
  ]);
  const editable = editableStatuses.has(onboardingCase.status);
  const completed = onboardingCase.items.filter(
    (item) =>
      item.status === OnboardingItemStatus.COMPLETED ||
      item.status === OnboardingItemStatus.SUBMITTED,
  ).length;
  const percent = onboardingCase.items.length
    ? Math.round((completed / onboardingCase.items.length) * 100)
    : 0;
  const latestRequestedChange = useMemo(
    () => onboardingCase.events.find((event) => event.action === 'CHANGES_REQUESTED'),
    [onboardingCase.events],
  );
  const requestedChangeNote =
    latestRequestedChange?.details &&
    typeof latestRequestedChange.details === 'object' &&
    !Array.isArray(latestRequestedChange.details) &&
    typeof (latestRequestedChange.details as { note?: unknown }).note === 'string'
      ? (latestRequestedChange.details as { note: string }).note
      : '';

  const saveProfile = (event: FormEvent) => {
    event.preventDefault();
    setMessage(null);
    startTransition(async () => {
      const result = await updateCandidateProfile(profile);
      setMessage({
        type: result.success ? 'success' : 'error',
        text: result.success ? 'Personal information saved.' : result.error || 'Unable to save.',
      });
      if (result.success) router.refresh();
    });
  };

  const submit = () => {
    setMessage(null);
    startTransition(async () => {
      const result = await submitOnboardingCase();
      setMessage({
        type: result.success ? 'success' : 'error',
        text: result.success ? 'Onboarding submitted for review.' : result.error || 'Unable to submit.',
      });
      if (result.success) router.refresh();
    });
  };

  const upload = async (file: File) => {
    setUploading(true);
    setMessage(null);
    try {
      const initialized = await createOnboardingDocumentUploadUrl({
        caseId: onboardingCase.id,
        filename: file.name,
        mimeType: file.type,
        sizeBytes: file.size,
      });
      if (!initialized.success || !initialized.documentId || !initialized.signedUrl || !initialized.path) {
        throw new Error(initialized.error || 'Unable to start upload.');
      }
      const response = await fetch(initialized.signedUrl, {
        method: 'PUT',
        headers: { 'Content-Type': file.type },
        body: file,
      });
      if (!response.ok) throw new Error('The document could not be uploaded.');
      const finalized = await finalizeOnboardingDocument({
        documentId: initialized.documentId,
        caseId: onboardingCase.id,
        storagePath: initialized.path,
        filename: file.name,
        mimeType: file.type,
        sizeBytes: file.size,
      });
      if (!finalized.success) throw new Error(finalized.error || 'Unable to save document.');
      setMessage({ type: 'success', text: `${file.name} uploaded securely.` });
      router.refresh();
    } catch (error) {
      setMessage({
        type: 'error',
        text: error instanceof Error ? error.message : 'Document upload failed.',
      });
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const download = async (documentId: string) => {
    const result = await getOnboardingDocumentDownloadUrl(documentId);
    if (result.success && result.signedUrl) window.open(result.signedUrl, '_blank', 'noopener,noreferrer');
    else setMessage({ type: 'error', text: result.error || 'Unable to open document.' });
  };

  return (
    <main className="min-h-screen bg-slate-50">
      <header className="border-b border-[#3e8dc8]/25 bg-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3 sm:px-6">
          <Image src="/logo.png" alt="BISU Home Loans" width={260} height={126} className="h-auto w-44 object-contain sm:w-64" priority />
          <button type="button" onClick={() => signOut({ callbackUrl: '/login' })} className="app-btn-secondary">
            <LogOut className="h-4 w-4" aria-hidden="true" />
            Sign out
          </button>
        </div>
      </header>

      <div className="mx-auto max-w-6xl space-y-6 px-4 py-8 sm:px-6">
        <section className="overflow-hidden rounded-2xl bg-[#3e8dc8] p-6 text-slate-950 shadow-sm sm:p-8">
          <div className="flex flex-col gap-6 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <p className="text-sm font-semibold text-slate-950/75">Welcome to BISU</p>
              <h1 className="mt-1 text-3xl font-bold">Hi, {profile.preferredFirstName || onboardingCase.candidateName}</h1>
              <p className="mt-2 max-w-2xl text-sm text-slate-950/80">{statusCopy[onboardingCase.status].message}</p>
            </div>
            <div className="rounded-xl bg-white/30 px-4 py-3 backdrop-blur">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-950/70">Status</p>
              <p className="mt-1 font-semibold">{statusCopy[onboardingCase.status].label}</p>
            </div>
          </div>
          <div className="mt-6">
            <div className="mb-2 flex justify-between text-xs font-medium text-slate-950/75">
              <span>Your checklist</span><span>{percent}%</span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-slate-950/15">
              <div className="h-full rounded-full bg-white transition-all" style={{ width: `${percent}%` }} />
            </div>
          </div>
        </section>

        {latestRequestedChange && (
          <section className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900" role="status">
            <strong>Changes requested.</strong>{' '}
            {requestedChangeNote || 'Review your information and documents, then submit again.'}
          </section>
        )}
        {message && (
          <div className={`rounded-xl border p-4 text-sm ${message.type === 'success' ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-red-200 bg-red-50 text-red-800'}`} role="status">
            {message.text}
          </div>
        )}

        <div className="grid gap-6 lg:grid-cols-[1.35fr_0.65fr]">
          <form onSubmit={saveProfile} className="app-surface-card p-6">
            <div className="flex items-start gap-3">
              <div className="rounded-lg bg-blue-50 p-2 text-blue-700"><ShieldCheck className="h-5 w-5" aria-hidden="true" /></div>
              <div>
                <h2 className="text-lg font-semibold text-slate-900">Personal information</h2>
                <p className="text-sm text-slate-500">Only authorized onboarding staff can review this information.</p>
              </div>
            </div>
            <div className="mt-6 grid gap-4 sm:grid-cols-2">
              {[
                ['firstName', 'First name', 'text'],
                ['lastName', 'Last name', 'text'],
                ['preferredFirstName', 'Preferred first name', 'text'],
                ['dateOfBirth', 'Date of birth', 'date'],
                ['mobilePhone', 'Mobile phone', 'tel'],
              ].map(([key, label, type]) => (
                <label key={key} className="block text-sm font-medium text-slate-700">
                  {label}
                  <input
                    type={type}
                    value={profile[key as keyof typeof profile]}
                    onChange={(event) => setProfile((current) => ({ ...current, [key]: event.target.value }))}
                    className="app-input mt-1.5 w-full"
                    disabled={!editable || pending}
                    required={!['preferredFirstName'].includes(key)}
                    autoComplete={key === 'mobilePhone' ? 'tel' : key === 'firstName' ? 'given-name' : key === 'lastName' ? 'family-name' : undefined}
                  />
                </label>
              ))}
              <label className="block text-sm font-medium text-slate-700 sm:col-span-2">
                Home address
                <textarea
                  value={profile.homeAddress}
                  onChange={(event) => setProfile((current) => ({ ...current, homeAddress: event.target.value }))}
                  className="app-input mt-1.5 min-h-24 w-full"
                  disabled={!editable || pending}
                  required
                  autoComplete="street-address"
                />
              </label>
            </div>
            {editable && (
              <div className="mt-5 flex justify-end">
                <button type="submit" disabled={pending} className="app-btn-primary">
                  {pending && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
                  Save information
                </button>
              </div>
            )}
          </form>

          <section className="app-surface-card p-6">
            <h2 className="text-lg font-semibold text-slate-900">Your checklist</h2>
            <div className="mt-4 space-y-3">
              {onboardingCase.items.map((item) => (
                <div key={item.id} className="flex gap-3 rounded-xl border border-slate-200 p-3">
                  <ItemIcon status={item.status} />
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-slate-800">{item.label}</p>
                    <p className="text-xs text-slate-500">{item.required ? 'Required' : 'Optional'}</p>
                  </div>
                </div>
              ))}
            </div>
          </section>
        </div>

        <section className="app-surface-card p-6">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-lg font-semibold text-slate-900">Documents</h2>
              <p className="text-sm text-slate-500">PDF, Word, JPG, or PNG files up to 15 MB.</p>
            </div>
            {editable && (
              <>
                <input
                  ref={fileRef}
                  type="file"
                  className="sr-only"
                  accept=".pdf,.doc,.docx,.jpg,.jpeg,.png"
                  onChange={(event) => event.target.files?.[0] && upload(event.target.files[0])}
                />
                <button type="button" onClick={() => fileRef.current?.click()} disabled={uploading} className="app-btn-secondary">
                  {uploading ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Upload className="h-4 w-4" aria-hidden="true" />}
                  Upload document
                </button>
              </>
            )}
          </div>
          <div className="mt-5 divide-y divide-slate-100">
            {onboardingCase.documents.length === 0 ? (
              <p className="py-8 text-center text-sm text-slate-500">No documents have been added yet.</p>
            ) : onboardingCase.documents.map((document) => (
              <button key={document.id} type="button" onClick={() => download(document.id)} className="flex w-full items-center gap-3 py-3 text-left hover:bg-slate-50">
                <FileText className="h-5 w-5 text-blue-600" aria-hidden="true" />
                <span className="min-w-0 flex-1 truncate text-sm font-medium text-slate-800">{document.name}</span>
                <span className="text-xs text-slate-500">{Math.max(1, Math.round(document.sizeBytes / 1024))} KB</span>
              </button>
            ))}
          </div>
        </section>

        {editable && (
          <section className="flex flex-col gap-4 rounded-2xl border border-blue-200 bg-blue-50 p-6 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="font-semibold text-blue-950">Ready for review?</h2>
              <p className="text-sm text-blue-800">Confirm your information is accurate before submitting.</p>
            </div>
            <button type="button" onClick={submit} disabled={pending} className="app-btn-primary">
              {pending && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
              Submit onboarding
            </button>
          </section>
        )}
      </div>
    </main>
  );
}
