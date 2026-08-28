'use client';

import { OnboardingItemStatus } from '@prisma/client';
import { ArrowLeft, Check, CheckCircle2, Circle, FileCheck2, Loader2, Mail, MapPin, Send, UserRound } from 'lucide-react';
import { CandidateOnboardingCase, ProfileFormValues } from './OnboardingWizardTypes';

const finishedStatuses = new Set<OnboardingItemStatus>([
  OnboardingItemStatus.COMPLETED,
  OnboardingItemStatus.SUBMITTED,
]);

export function OnboardingReviewStep({
  profile,
  personalEmail,
  items,
  documents,
  editable,
  pending,
  ready,
  onBack,
  onEditPersonal,
  onSubmit,
}: {
  profile: ProfileFormValues;
  personalEmail: string;
  items: CandidateOnboardingCase['items'];
  documents: CandidateOnboardingCase['documents'];
  editable: boolean;
  pending: boolean;
  ready: boolean;
  onBack: () => void;
  onEditPersonal: () => void;
  onSubmit: () => void;
}) {
  const requiredItems = items.filter((item) => item.required);
  const requiredComplete = requiredItems.filter((item) => finishedStatuses.has(item.status)).length;
  const address = [
    profile.addressLine1,
    profile.addressLine2,
    [profile.city, profile.state].filter(Boolean).join(', '),
    profile.postalCode,
  ].filter(Boolean).join(' · ');

  return (
    <section className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-[0_20px_60px_-32px_rgba(15,23,42,0.35)]">
      <div className="border-b border-slate-100 bg-gradient-to-r from-emerald-50 via-white to-[#3e8dc8]/10 px-5 py-6 sm:px-8">
        <div className="flex items-start gap-4">
          <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-emerald-500 text-white shadow-lg shadow-emerald-500/20">
            <Send className="h-6 w-6" aria-hidden="true" />
          </span>
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-emerald-700">Final step</p>
            <h2 className="mt-1 text-2xl font-bold tracking-tight text-slate-950">Review your onboarding</h2>
            <p className="mt-1 max-w-2xl text-sm leading-6 text-slate-600">
              Make sure everything looks right. You can return to any completed step before submitting.
            </p>
          </div>
        </div>
      </div>

      <div className="space-y-5 px-5 py-6 sm:px-8 sm:py-8">
        <ReviewCard
          icon={<UserRound className="h-5 w-5" aria-hidden="true" />}
          title="Personal information"
          action={editable ? <button type="button" onClick={onEditPersonal} className="text-xs font-bold text-[#347eb5] hover:underline">Edit</button> : null}
        >
          <div className="grid gap-4 text-sm sm:grid-cols-2">
            <Summary label="Legal name" value={`${profile.firstName} ${profile.lastName}`.trim() || 'Not provided'} />
            <Summary label="Preferred name" value={profile.preferredFirstName || 'Not provided'} />
            <Summary label="Date of birth" value={profile.dateOfBirth || 'Not provided'} />
            <Summary label="Mobile phone" value={profile.mobilePhone || 'Not provided'} />
            <Summary label="Personal email" value={personalEmail} icon={<Mail className="h-3.5 w-3.5" aria-hidden="true" />} />
            <Summary label="Home address" value={address || 'Not provided'} icon={<MapPin className="h-3.5 w-3.5" aria-hidden="true" />} />
          </div>
        </ReviewCard>

        <div className="grid gap-5 lg:grid-cols-2">
          <ReviewCard icon={<CheckCircle2 className="h-5 w-5" aria-hidden="true" />} title="Required checklist">
            <div className="mb-4 flex items-end justify-between">
              <div>
                <p className="text-2xl font-black text-slate-950">{requiredComplete}/{requiredItems.length}</p>
                <p className="text-xs text-slate-500">required items complete</p>
              </div>
              {requiredComplete === requiredItems.length && (
                <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-bold text-emerald-700">Ready</span>
              )}
            </div>
            <div className="space-y-2">
              {items.map((item) => {
                const complete = finishedStatuses.has(item.status);
                return (
                  <div key={item.id} className="flex items-center gap-2.5 text-sm">
                    <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full ${complete ? 'bg-emerald-500 text-white' : 'border border-slate-300 text-transparent'}`}>
                      {complete ? <Check className="h-3 w-3" aria-hidden="true" /> : <Circle className="h-2 w-2" aria-hidden="true" />}
                    </span>
                    <span className={complete ? 'text-slate-700' : 'text-slate-500'}>{item.label}</span>
                    {!item.required && <span className="ml-auto text-[10px] font-semibold uppercase text-slate-400">Optional</span>}
                  </div>
                );
              })}
            </div>
          </ReviewCard>

          <ReviewCard icon={<FileCheck2 className="h-5 w-5" aria-hidden="true" />} title="Documents">
            {documents.length ? (
              <div className="space-y-2">
                {documents.map((document) => (
                  <div key={document.id} className="flex items-center gap-3 rounded-xl bg-slate-50 p-3">
                    <FileCheck2 className="h-4 w-4 shrink-0 text-emerald-500" aria-hidden="true" />
                    <span className="min-w-0 flex-1 truncate text-sm font-semibold text-slate-700">{document.name}</span>
                  </div>
                ))}
              </div>
            ) : (
              <div className="rounded-xl bg-slate-50 px-4 py-7 text-center">
                <p className="text-sm font-semibold text-slate-700">No documents added</p>
                <p className="mt-1 text-xs text-slate-500">Documents are optional unless your onboarding team requests them.</p>
              </div>
            )}
          </ReviewCard>
        </div>

        <div className={`rounded-2xl border p-5 ${ready ? 'border-emerald-200 bg-emerald-50' : 'border-amber-200 bg-amber-50'}`}>
          <div className="flex items-start gap-3">
            {ready ? <CheckCircle2 className="mt-0.5 h-6 w-6 shrink-0 text-emerald-600" aria-hidden="true" /> : <Circle className="mt-0.5 h-6 w-6 shrink-0 text-amber-600" aria-hidden="true" />}
            <div>
              <h3 className={`font-bold ${ready ? 'text-emerald-950' : 'text-amber-950'}`}>
                {ready ? 'Everything is ready' : 'A few details still need attention'}
              </h3>
              <p className={`mt-1 text-sm ${ready ? 'text-emerald-800' : 'text-amber-800'}`}>
                {ready
                  ? 'Submitting securely sends your information to the BISU onboarding team for review.'
                  : 'Return to personal information and complete all required fields before submitting.'}
              </p>
            </div>
          </div>
        </div>
      </div>

      <div className="flex flex-col-reverse gap-3 border-t border-slate-100 bg-slate-50/70 px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-8">
        <button type="button" onClick={onBack} className="app-btn-secondary h-11">
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          Back
        </button>
        {editable && (
          <button type="button" onClick={onSubmit} disabled={pending || !ready} className="app-btn-primary h-11 px-6 disabled:cursor-not-allowed disabled:opacity-50">
            {pending ? <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" /> : <Send className="h-4 w-4" aria-hidden="true" />}
            Submit for review
          </button>
        )}
      </div>
    </section>
  );
}

function ReviewCard({
  icon,
  title,
  action,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5">
      <div className="mb-4 flex items-center justify-between gap-3">
        <h3 className="flex items-center gap-2 font-bold text-slate-900">
          <span className="text-[#347eb5]">{icon}</span>
          {title}
        </h3>
        {action}
      </div>
      {children}
    </section>
  );
}

function Summary({ label, value, icon }: { label: string; value: string; icon?: React.ReactNode }) {
  return (
    <div>
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">{label}</p>
      <p className="mt-1 flex items-start gap-1.5 font-medium leading-5 text-slate-800">
        {icon && <span className="mt-0.5 text-slate-400">{icon}</span>}
        <span>{value}</span>
      </p>
    </div>
  );
}
