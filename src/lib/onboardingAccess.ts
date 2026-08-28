import { OnboardingItemOwner, OnboardingStatus, UserRole } from '@prisma/client';
import { hasAnyAdminRole } from './adminTiers';

export type OnboardingActor = {
  userId: string;
  roles: UserRole[];
};

export type OnboardingCaseAccessShape = {
  userId: string | null;
  ownerId: string | null;
  items?: Array<{ assignedUserId: string | null }>;
};

export function isOnboardingCandidate(actor: OnboardingActor) {
  return actor.roles.includes(UserRole.ONBOARDING);
}

export function canViewOnboardingCase(
  actor: OnboardingActor,
  onboardingCase: OnboardingCaseAccessShape,
) {
  if (hasAnyAdminRole(actor.roles)) return true;
  if (onboardingCase.userId === actor.userId) return true;
  if (!actor.roles.includes(UserRole.MANAGER)) return false;
  return (
    onboardingCase.ownerId === actor.userId ||
    Boolean(onboardingCase.items?.some((item) => item.assignedUserId === actor.userId))
  );
}

export function canManageOnboardingCase(
  actor: OnboardingActor,
  onboardingCase: OnboardingCaseAccessShape,
) {
  if (hasAnyAdminRole(actor.roles)) return true;
  if (!actor.roles.includes(UserRole.MANAGER)) return false;
  return (
    onboardingCase.ownerId === actor.userId ||
    Boolean(onboardingCase.items?.some((item) => item.assignedUserId === actor.userId))
  );
}

export function canEditOnboardingItem(
  actor: OnboardingActor,
  onboardingCase: OnboardingCaseAccessShape,
  assignedUserId: string | null,
) {
  if (hasAnyAdminRole(actor.roles)) return true;
  if (!actor.roles.includes(UserRole.MANAGER)) return false;
  return onboardingCase.ownerId === actor.userId || assignedUserId === actor.userId;
}

export function canCandidateEdit(status: OnboardingStatus) {
  const editableStatuses = new Set<OnboardingStatus>([
    OnboardingStatus.INVITED,
    OnboardingStatus.IN_PROGRESS,
    OnboardingStatus.CHANGES_REQUESTED,
  ]);
  return editableStatuses.has(status);
}

export function canCandidateEditItem(owner: OnboardingItemOwner) {
  return owner === OnboardingItemOwner.NEW_HIRE;
}

const onboardingTransitions: Partial<Record<OnboardingStatus, OnboardingStatus[]>> = {
  [OnboardingStatus.SUBMITTED]: [
    OnboardingStatus.UNDER_REVIEW,
    OnboardingStatus.CHANGES_REQUESTED,
  ],
  [OnboardingStatus.UNDER_REVIEW]: [
    OnboardingStatus.CHANGES_REQUESTED,
    OnboardingStatus.APPROVED,
  ],
  [OnboardingStatus.APPROVED]: [OnboardingStatus.COMPLETED],
};

export function canTransitionOnboardingStatus(
  current: OnboardingStatus,
  next: OnboardingStatus,
) {
  if (next === OnboardingStatus.CANCELLED && current !== OnboardingStatus.COMPLETED) return true;
  return Boolean(onboardingTransitions[current]?.includes(next));
}
