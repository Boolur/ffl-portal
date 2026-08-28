'use client';

import { FormEvent, useEffect, useMemo, useRef, useState, useTransition } from 'react';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { signOut } from 'next-auth/react';
import {
  AlertTriangle,
  CheckCircle2,
  LogOut,
} from 'lucide-react';
import { OnboardingItemStatus, OnboardingStatus } from '@prisma/client';
import {
  createOnboardingDocumentUploadUrl,
  finalizeOnboardingDocument,
  getOnboardingDocumentDownloadUrl,
  submitOnboardingCase,
  updateCandidateProfile,
} from '@/app/actions/onboardingActions';
import { isCompleteOnboardingAddress } from '@/lib/onboardingAddress';
import { OnboardingDocumentsStep } from './OnboardingDocumentsStep';
import { OnboardingPersonalStep } from './OnboardingPersonalStep';
import { OnboardingReviewStep } from './OnboardingReviewStep';
import { OnboardingWelcomeIntro } from './OnboardingWelcomeIntro';
import { OnboardingWizardProgress } from './OnboardingWizardProgress';
import {
  CandidateOnboardingCase,
  ProfileFormValues,
  WizardStep,
} from './OnboardingWizardTypes';

const STEP_ORDER: WizardStep[] = ['personal', 'documents', 'review'];
const submittedItemStatuses = new Set<OnboardingItemStatus>([
  OnboardingItemStatus.COMPLETED,
  OnboardingItemStatus.SUBMITTED,
]);

export function OnboardingPortal({ onboardingCase }: { onboardingCase: CandidateOnboardingCase }) {
  const router = useRouter();
  const stepRegionRef = useRef<HTMLDivElement>(null);
  const [pending, startTransition] = useTransition();
  const [uploading, setUploading] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [profile, setProfile] = useState<ProfileFormValues>({
    firstName: onboardingCase.profile?.firstName || '',
    lastName: onboardingCase.profile?.lastName || '',
    preferredFirstName: onboardingCase.profile?.preferredFirstName || '',
    dateOfBirth: onboardingCase.profile?.dateOfBirth || '',
    mobilePhone: onboardingCase.profile?.mobilePhone || '',
    addressLine1: onboardingCase.profile?.addressLine1 || '',
    addressLine2: onboardingCase.profile?.addressLine2 || '',
    city: onboardingCase.profile?.city || '',
    state: onboardingCase.profile?.state || '',
    postalCode: onboardingCase.profile?.postalCode || '',
  });
  const [profileDirty, setProfileDirty] = useState(false);
  const editableStatuses = new Set<OnboardingStatus>([
    OnboardingStatus.INVITED,
    OnboardingStatus.IN_PROGRESS,
    OnboardingStatus.CHANGES_REQUESTED,
  ]);
  const editable = editableStatuses.has(onboardingCase.status);
  const profileComplete = Boolean(
    profile.firstName.trim() &&
      profile.lastName.trim() &&
      profile.dateOfBirth &&
      profile.mobilePhone.trim() &&
      isCompleteOnboardingAddress(profile),
  );
  const requiredItemsComplete = onboardingCase.items
    .filter((item) => item.required)
    .every((item) => submittedItemStatuses.has(item.status));
  const readyToSubmit = profileComplete && requiredItemsComplete;
  const savedProfileComplete = profileComplete && !profileDirty;
  const [documentsVisited, setDocumentsVisited] = useState(!editable && profileComplete);
  const [currentStep, setCurrentStep] = useState<WizardStep>(
    !editable ? 'review' : profileComplete ? 'documents' : 'personal',
  );
  const [stepMotion, setStepMotion] = useState<'forward' | 'back'>('forward');
  const [stepRenderKey, setStepRenderKey] = useState(0);

  useEffect(() => {
    const reviewedKey = `bisu-onboarding-documents-reviewed:${onboardingCase.id}`;
    if (window.sessionStorage.getItem(reviewedKey) && savedProfileComplete) {
      setDocumentsVisited(true);
      setCurrentStep((step) => step === 'documents' ? 'review' : step);
    }
  }, [onboardingCase.id, savedProfileComplete]);

  useEffect(() => {
    if (stepRenderKey === 0) return;
    const timeout = window.setTimeout(() => stepRegionRef.current?.focus(), 0);
    return () => window.clearTimeout(timeout);
  }, [stepRenderKey]);

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

  const goToStep = (step: WizardStep, preserveMessage = false) => {
    if (uploading && step !== 'documents') return;
    const currentIndex = STEP_ORDER.indexOf(currentStep);
    const nextIndex = STEP_ORDER.indexOf(step);
    setStepMotion(nextIndex >= currentIndex ? 'forward' : 'back');
    setCurrentStep(step);
    setStepRenderKey((key) => key + 1);
    if (!preserveMessage) setMessage(null);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const saveProfile = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setMessage(null);
    startTransition(async () => {
      const result = await updateCandidateProfile(profile);
      setMessage({
        type: result.success ? 'success' : 'error',
        text: result.success ? 'Personal information saved.' : result.error || 'Unable to save.',
      });
      if (result.success) {
        setProfileDirty(false);
        router.refresh();
        goToStep('documents', true);
      }
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
      if (result.success) {
        router.refresh();
        window.scrollTo({ top: 0, behavior: 'smooth' });
      }
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
    }
  };

  const download = async (documentId: string) => {
    const result = await getOnboardingDocumentDownloadUrl(documentId);
    if (result.success && result.signedUrl) window.open(result.signedUrl, '_blank', 'noopener,noreferrer');
    else setMessage({ type: 'error', text: result.error || 'Unable to open document.' });
  };

  const completeDocumentsStep = () => {
    window.sessionStorage.setItem(`bisu-onboarding-documents-reviewed:${onboardingCase.id}`, 'true');
    setDocumentsVisited(true);
    goToStep('review');
  };

  const completedSteps = new Set<WizardStep>();
  if (savedProfileComplete) completedSteps.add('personal');
  if (documentsVisited || !editable) completedSteps.add('documents');
  if (!editable || onboardingCase.status === OnboardingStatus.SUBMITTED) completedSteps.add('review');

  const unlockedSteps = new Set<WizardStep>(['personal']);
  if (savedProfileComplete || !editable) unlockedSteps.add('documents');
  if (((savedProfileComplete && documentsVisited) || !editable) && !uploading) unlockedSteps.add('review');

  return (
    <main className="min-h-screen overflow-x-hidden bg-[radial-gradient(circle_at_50%_0%,rgba(62,141,200,0.12),transparent_34%),#f8fafc]">
      <OnboardingWelcomeIntro caseId={onboardingCase.id} />

      <header className="border-b border-[#3e8dc8]/20 bg-white/90 backdrop-blur-xl">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-2 sm:px-6">
          <Image src="/logo.png" alt="BISU Home Loans" width={260} height={126} className="h-auto w-40 object-contain sm:w-56" priority />
          <button type="button" onClick={() => signOut({ callbackUrl: '/login' })} className="app-btn-secondary shrink-0">
            <LogOut className="h-4 w-4" aria-hidden="true" />
            Sign out
          </button>
        </div>
      </header>

      <div className="mx-auto max-w-6xl space-y-5 px-4 py-6 sm:px-6 sm:py-8">
        <section className="py-1 sm:py-2">
          <p className="text-xs font-bold uppercase tracking-[0.14em] text-[#347eb5]">Welcome to BISU</p>
          <h1 className="mt-1.5 text-3xl font-black tracking-tight text-slate-950 sm:text-4xl">
            Hi, {profile.preferredFirstName || onboardingCase.candidateName}
          </h1>
          <p className="mt-1.5 text-sm font-medium text-slate-600">Complete the items below when you are ready.</p>
        </section>

        {latestRequestedChange && (
          <section className="flex items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900 shadow-sm" role="status">
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" aria-hidden="true" />
            <p><strong>Changes requested.</strong>{' '}{requestedChangeNote || 'Review your information and documents, then submit again.'}</p>
          </section>
        )}
        {message && (
          <div className={`flex items-center gap-3 rounded-2xl border p-4 text-sm font-medium shadow-sm ${message.type === 'success' ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-red-200 bg-red-50 text-red-800'}`} role="status">
            {message.type === 'success' ? <CheckCircle2 className="h-5 w-5 shrink-0" aria-hidden="true" /> : <AlertTriangle className="h-5 w-5 shrink-0" aria-hidden="true" />}
            {message.text}
          </div>
        )}

        <OnboardingWizardProgress
          currentStep={currentStep}
          completedSteps={completedSteps}
          unlockedSteps={unlockedSteps}
          onStepChange={goToStep}
        />

        <div
          key={`${currentStep}-${stepRenderKey}`}
          ref={stepRegionRef}
          tabIndex={-1}
          aria-label={`${currentStep === 'personal' ? 'Personal information' : currentStep === 'documents' ? 'Documents' : 'Review and submit'} step`}
          className={`${stepMotion === 'forward' ? 'onboarding-step-forward' : 'onboarding-step-back'} outline-none`}
        >
          {currentStep === 'personal' && (
            <OnboardingPersonalStep
              profile={profile}
              personalEmail={onboardingCase.personalEmail}
              editable={editable}
              pending={pending}
              onChange={(nextProfile) => {
                setProfile(nextProfile);
                setProfileDirty(true);
              }}
              onSubmit={saveProfile}
            />
          )}
          {currentStep === 'documents' && (
            <OnboardingDocumentsStep
              documents={onboardingCase.documents}
              editable={editable}
              uploading={uploading}
              onUpload={upload}
              onDownload={download}
              onBack={() => goToStep('personal')}
              onContinue={completeDocumentsStep}
            />
          )}
          {currentStep === 'review' && (
            <OnboardingReviewStep
              profile={profile}
              personalEmail={onboardingCase.personalEmail}
              items={onboardingCase.items}
              documents={onboardingCase.documents}
              editable={editable}
              pending={pending}
              ready={readyToSubmit && !profileDirty}
              onBack={() => goToStep('documents')}
              onEditPersonal={() => goToStep('personal')}
              onSubmit={submit}
            />
          )}
        </div>
      </div>
    </main>
  );
}
