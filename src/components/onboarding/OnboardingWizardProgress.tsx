'use client';

import { Check, FileText, Send, UserRound } from 'lucide-react';
import { WizardStep } from './OnboardingWizardTypes';

const STEPS = [
  { id: 'personal' as const, label: 'Personal information', shortLabel: 'Your details', icon: UserRound },
  { id: 'documents' as const, label: 'Documents', shortLabel: 'Documents', icon: FileText },
  { id: 'review' as const, label: 'Review & submit', shortLabel: 'Review', icon: Send },
];

export function OnboardingWizardProgress({
  currentStep,
  completedSteps,
  unlockedSteps,
  onStepChange,
}: {
  currentStep: WizardStep;
  completedSteps: Set<WizardStep>;
  unlockedSteps: Set<WizardStep>;
  onStepChange: (step: WizardStep) => void;
}) {
  const currentIndex = STEPS.findIndex((step) => step.id === currentStep);
  const progress = ((currentIndex + 1) / STEPS.length) * 100;

  return (
    <nav aria-label="Onboarding progress" className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.16em] text-[#347eb5]">Your onboarding</p>
          <p className="mt-1 text-sm font-medium text-slate-600">
            Step {currentIndex + 1} of {STEPS.length}
          </p>
        </div>
        <span className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-bold text-emerald-700">
          {Math.round(progress)}% through
        </span>
      </div>

      <div className="mb-5 h-2 overflow-hidden rounded-full bg-slate-100">
        <div
          className="h-full rounded-full bg-gradient-to-r from-emerald-500 to-emerald-400 transition-[width] duration-500 ease-out motion-reduce:transition-none"
          style={{ width: `${progress}%` }}
        />
      </div>

      <div className="grid grid-cols-3 gap-2 sm:gap-4">
        {STEPS.map((step, index) => {
          const active = currentStep === step.id;
          const complete = completedSteps.has(step.id);
          const unlocked = unlockedSteps.has(step.id);
          const Icon = step.icon;
          return (
            <button
              key={step.id}
              type="button"
              disabled={!unlocked}
              onClick={() => onStepChange(step.id)}
              aria-current={active ? 'step' : undefined}
              className={`group rounded-xl border p-2.5 text-left transition-all duration-200 motion-reduce:transition-none sm:p-3 ${
                active
                  ? 'border-[#3e8dc8] bg-[#3e8dc8]/10 shadow-sm'
                  : complete
                    ? 'border-emerald-200 bg-emerald-50/70 hover:border-emerald-300'
                    : 'border-slate-200 bg-white hover:border-slate-300'
              } disabled:cursor-not-allowed disabled:opacity-45`}
            >
              <span className="flex items-center gap-2 sm:gap-3">
                <span
                  className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg sm:h-9 sm:w-9 ${
                    complete
                      ? 'bg-emerald-500 text-white'
                      : active
                        ? 'bg-[#3e8dc8] text-white'
                        : 'bg-slate-100 text-slate-500'
                  }`}
                >
                  {complete ? <Check className="h-4 w-4" aria-hidden="true" /> : <Icon className="h-4 w-4" aria-hidden="true" />}
                </span>
                <span className="min-w-0">
                  <span className="block truncate text-xs font-bold text-slate-900 sm:text-sm">
                    <span className="sm:hidden">{step.shortLabel}</span>
                    <span className="hidden sm:inline">{step.label}</span>
                  </span>
                  <span className="mt-0.5 hidden text-xs text-slate-500 md:block">
                    {complete ? 'Complete' : active ? 'In progress' : index > currentIndex ? 'Up next' : 'Available'}
                  </span>
                </span>
              </span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}
