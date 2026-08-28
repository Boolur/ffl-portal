import { OnboardingItemStatus, OnboardingStatus } from '@prisma/client';

export type WizardStep = 'personal' | 'documents' | 'review';

export type ProfileFormValues = {
  firstName: string;
  lastName: string;
  preferredFirstName: string;
  dateOfBirth: string;
  mobilePhone: string;
  addressLine1: string;
  addressLine2: string;
  city: string;
  state: string;
  postalCode: string;
};

export type CandidateOnboardingCase = {
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
    addressLine1: string | null;
    addressLine2: string | null;
    city: string | null;
    state: string | null;
    postalCode: string | null;
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
