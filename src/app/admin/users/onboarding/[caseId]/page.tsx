import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { getServerSession } from 'next-auth';
import { ArrowLeft } from 'lucide-react';
import { authOptions } from '@/lib/auth';
import { DashboardShell } from '@/components/layout/DashboardShell';
import {
  getOnboardingCaseForManagement,
  getOnboardingManagementContext,
} from '@/app/actions/onboardingActions';
import { OnboardingCaseDetail } from '@/components/admin/users/OnboardingCaseDetail';
import { isOnboardingEnabled } from '@/lib/onboardingFeature';

export default async function OnboardingCasePage({
  params,
}: {
  params: Promise<{ caseId: string }>;
}) {
  if (!isOnboardingEnabled()) redirect('/admin/users');
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) redirect('/login');
  const { caseId } = await params;
  const [onboardingCase, context] = await Promise.all([
    getOnboardingCaseForManagement(caseId),
    getOnboardingManagementContext(),
  ]);
  if (!onboardingCase || !context.authorized) notFound();

  const data = {
    id: onboardingCase.id,
    candidateName: onboardingCase.candidateName,
    personalEmail: onboardingCase.personalEmail,
    status: onboardingCase.status,
    targetRoles: onboardingCase.targetRoles,
    ownerId: onboardingCase.ownerId,
    userId: onboardingCase.userId,
    permissions: onboardingCase.permissions,
    submittedAt: onboardingCase.submittedAt?.toISOString() || null,
    approvedAt: onboardingCase.approvedAt?.toISOString() || null,
    createdAt: onboardingCase.createdAt.toISOString(),
    profile: onboardingCase.profile
      ? {
          firstName: onboardingCase.profile.firstName,
          lastName: onboardingCase.profile.lastName,
          preferredFirstName: onboardingCase.profile.preferredFirstName,
          dateOfBirth: onboardingCase.profile.dateOfBirth,
          mobilePhone: onboardingCase.profile.mobilePhone,
          addressLine1: onboardingCase.profile.addressLine1,
          addressLine2: onboardingCase.profile.addressLine2,
          city: onboardingCase.profile.city,
          state: onboardingCase.profile.state,
          postalCode: onboardingCase.profile.postalCode,
          offerDate: onboardingCase.profile.offerDate?.toISOString().slice(0, 10) || '',
          startDate: onboardingCase.profile.startDate?.toISOString().slice(0, 10) || '',
          jobTitle: onboardingCase.profile.jobTitle,
          managerName: onboardingCase.profile.managerName,
          basePay: onboardingCase.profile.basePay,
          compensationPlan: onboardingCase.profile.compensationPlan,
          location: onboardingCase.profile.location,
          department: onboardingCase.profile.department,
        }
      : null,
    items: onboardingCase.items.map((item) => ({
      id: item.id,
      category: item.category,
      label: item.label,
      description: item.description,
      owner: item.owner,
      assignedUserId: item.assignedUserId,
      status: item.status,
      required: item.required,
      dueAt: item.dueAt?.toISOString().slice(0, 10) || '',
      internalNote: item.internalNote,
      candidateNote: item.candidateNote,
      response: item.response,
    })),
    documents: onboardingCase.documents.map((document) => ({
      id: document.id,
      name: document.name,
      mimeType: document.mimeType,
      sizeBytes: document.sizeBytes,
      visibility: document.visibility,
      status: document.status,
      documentType: document.documentType,
      signatureProvider: document.signatureProvider,
      externalEnvelopeId: document.externalEnvelopeId,
      createdAt: document.createdAt.toISOString(),
    })),
    events: onboardingCase.events.map((event) => ({
      id: event.id,
      action: event.action,
      details: event.details,
      createdAt: event.createdAt.toISOString(),
    })),
  };

  return (
    <DashboardShell
      user={{
        name: session.user.name || 'User',
        role: session.user.activeRole || session.user.role || 'MANAGER',
      }}
    >
      <Link href="/admin/users/onboarding" className="mb-4 inline-flex items-center gap-2 text-sm font-medium text-slate-600 hover:text-slate-900">
        <ArrowLeft className="h-4 w-4" aria-hidden="true" /> Back to onboarding
      </Link>
      <OnboardingCaseDetail
        onboardingCase={data}
        managers={context.managers}
        assignableRoles={context.assignableRoles}
      />
    </DashboardShell>
  );
}
