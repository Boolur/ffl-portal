import { redirect } from 'next/navigation';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getMyOnboardingCase } from '@/app/actions/onboardingActions';
import { OnboardingPortal } from '@/components/onboarding/OnboardingPortal';
import { isOnboardingEnabled } from '@/lib/onboardingFeature';

export default async function OnboardingPage() {
  if (!isOnboardingEnabled()) redirect('/');
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) redirect('/login');
  const onboardingCase = await getMyOnboardingCase();
  if (!onboardingCase) redirect('/');

  const data = {
    id: onboardingCase.id,
    candidateName: onboardingCase.candidateName,
    personalEmail: onboardingCase.personalEmail,
    status: onboardingCase.status,
    profile: onboardingCase.profile,
    items: onboardingCase.items.map((item) => ({
      id: item.id,
      category: item.category,
      label: item.label,
      description: item.description,
      status: item.status,
      required: item.required,
      candidateNote: item.candidateNote,
    })),
    documents: onboardingCase.documents.map((document) => ({
      id: document.id,
      name: document.name,
      mimeType: document.mimeType,
      sizeBytes: document.sizeBytes,
      status: document.status,
      createdAt: document.createdAt.toISOString(),
    })),
    events: onboardingCase.events.map((event) => ({
      id: event.id,
      action: event.action,
      details: event.details,
      createdAt: event.createdAt.toISOString(),
    })),
  };

  return <OnboardingPortal onboardingCase={data} />;
}
