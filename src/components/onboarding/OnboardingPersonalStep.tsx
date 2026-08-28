'use client';

import { FormEvent } from 'react';
import { ArrowRight, CheckCircle2, Loader2, LockKeyhole, MapPin, UserRound } from 'lucide-react';
import { ONBOARDING_US_STATES } from '@/lib/onboardingAddress';
import { ProfileFormValues } from './OnboardingWizardTypes';

export function OnboardingPersonalStep({
  profile,
  personalEmail,
  editable,
  pending,
  onChange,
  onSubmit,
}: {
  profile: ProfileFormValues;
  personalEmail: string;
  editable: boolean;
  pending: boolean;
  onChange: (profile: ProfileFormValues) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  const update = (field: keyof ProfileFormValues, value: string) =>
    onChange({ ...profile, [field]: value });

  return (
    <form onSubmit={onSubmit} className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-[0_20px_60px_-32px_rgba(15,23,42,0.35)]">
      <div className="border-b border-slate-100 bg-gradient-to-r from-[#3e8dc8]/10 via-white to-emerald-50 px-5 py-6 sm:px-8">
        <div className="flex items-start gap-4">
          <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-[#3e8dc8] text-white shadow-lg shadow-[#3e8dc8]/20">
            <UserRound className="h-6 w-6" aria-hidden="true" />
          </span>
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-[#347eb5]">Step one</p>
            <h2 className="mt-1 text-2xl font-bold tracking-tight text-slate-950">Tell us about yourself</h2>
            <p className="mt-1 max-w-2xl text-sm leading-6 text-slate-600">
              We use this information to prepare your employee profile and onboarding documents.
            </p>
          </div>
        </div>
      </div>

      <div className="space-y-8 px-5 py-6 sm:px-8 sm:py-8">
        <fieldset disabled={!editable || pending}>
          <legend className="flex items-center gap-2 text-sm font-bold text-slate-900">
            <UserRound className="h-4 w-4 text-[#3e8dc8]" aria-hidden="true" />
            Personal details
          </legend>
          <div className="mt-4 grid gap-5 sm:grid-cols-2">
            <Field label="First name" required>
              <input value={profile.firstName} onChange={(event) => update('firstName', event.target.value)} className="app-input mt-1.5 w-full" autoComplete="given-name" required />
            </Field>
            <Field label="Last name" required>
              <input value={profile.lastName} onChange={(event) => update('lastName', event.target.value)} className="app-input mt-1.5 w-full" autoComplete="family-name" required />
            </Field>
            <Field label="Preferred first name" hint="Optional">
              <input value={profile.preferredFirstName} onChange={(event) => update('preferredFirstName', event.target.value)} className="app-input mt-1.5 w-full" autoComplete="nickname" />
            </Field>
            <Field label="Date of birth" required>
              <input type="date" value={profile.dateOfBirth} onChange={(event) => update('dateOfBirth', event.target.value)} className="app-input mt-1.5 w-full" autoComplete="bday" required />
            </Field>
            <Field label="Mobile phone" required>
              <input type="tel" value={profile.mobilePhone} onChange={(event) => update('mobilePhone', event.target.value)} className="app-input mt-1.5 w-full" autoComplete="tel" placeholder="(555) 555-0123" required />
            </Field>
            <Field label="Personal email">
              <div className="relative mt-1.5">
                <input value={personalEmail} className="app-input w-full bg-slate-50 pr-10 text-slate-500" disabled />
                <LockKeyhole className="absolute right-3 top-2.5 h-4 w-4 text-slate-400" aria-hidden="true" />
              </div>
            </Field>
          </div>
        </fieldset>

        <div className="h-px bg-slate-100" />

        <fieldset disabled={!editable || pending}>
          <legend className="flex items-center gap-2 text-sm font-bold text-slate-900">
            <MapPin className="h-4 w-4 text-[#3e8dc8]" aria-hidden="true" />
            Home address
          </legend>
          <p className="mt-1 text-sm text-slate-500">Enter the address that should appear on your employment records.</p>
          <div className="mt-4 grid gap-5 sm:grid-cols-6">
            <div className="sm:col-span-4">
              <Field label="Address line 1" required>
                <input value={profile.addressLine1} onChange={(event) => update('addressLine1', event.target.value)} className="app-input mt-1.5 w-full" autoComplete="address-line1" placeholder="Street address" required />
              </Field>
            </div>
            <div className="sm:col-span-2">
              <Field label="Address line 2" hint="Optional">
                <input value={profile.addressLine2} onChange={(event) => update('addressLine2', event.target.value)} className="app-input mt-1.5 w-full" autoComplete="address-line2" placeholder="Apt, suite, unit" />
              </Field>
            </div>
            <div className="sm:col-span-3">
              <Field label="City" required>
                <input value={profile.city} onChange={(event) => update('city', event.target.value)} className="app-input mt-1.5 w-full" autoComplete="address-level2" required />
              </Field>
            </div>
            <div className="sm:col-span-1">
              <Field label="State" required>
                <select value={profile.state} onChange={(event) => update('state', event.target.value)} className="app-input mt-1.5 w-full" autoComplete="address-level1" required>
                  <option value="">--</option>
                  {ONBOARDING_US_STATES.map((state) => <option key={state} value={state}>{state}</option>)}
                </select>
              </Field>
            </div>
            <div className="sm:col-span-2">
              <Field label="ZIP code" required>
                <input value={profile.postalCode} onChange={(event) => update('postalCode', event.target.value)} className="app-input mt-1.5 w-full" autoComplete="postal-code" inputMode="numeric" placeholder="12345" pattern="\d{5}(-\d{4})?" required />
              </Field>
            </div>
          </div>
        </fieldset>
      </div>

      <div className="flex flex-col gap-3 border-t border-slate-100 bg-slate-50/70 px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-8">
        <p className="flex items-center gap-2 text-xs text-slate-500">
          <CheckCircle2 className="h-4 w-4 text-emerald-500" aria-hidden="true" />
          Your information is encrypted and only visible to authorized staff.
        </p>
        {editable && (
          <button type="submit" disabled={pending} className="app-btn-primary h-11 shrink-0 px-5">
            {pending ? <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" /> : <ArrowRight className="h-4 w-4" aria-hidden="true" />}
            Save & continue
          </button>
        )}
      </div>
    </form>
  );
}

function Field({
  label,
  hint,
  required,
  children,
}: {
  label: string;
  hint?: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <label className="block text-sm font-semibold text-slate-700">
      <span className="flex items-center justify-between gap-2">
        <span>{label}{required && <span className="ml-1 text-[#347eb5]">*</span>}</span>
        {hint && <span className="text-xs font-normal text-slate-400">{hint}</span>}
      </span>
      {children}
    </label>
  );
}
