import { describe, expect, it } from 'vitest';
import { OnboardingItemOwner, OnboardingStatus, UserRole } from '@prisma/client';
import {
  canCandidateEdit,
  canCandidateEditItem,
  canEditOnboardingItem,
  canManageOnboardingCase,
  canTransitionOnboardingStatus,
  canViewOnboardingCase,
} from './onboardingAccess';

const onboardingCase = {
  userId: 'candidate',
  ownerId: 'owner',
  items: [{ assignedUserId: 'assignee' }],
};

describe('onboarding access', () => {
  it('limits candidates to their own case without management access', () => {
    const actor = { userId: 'candidate', roles: [UserRole.ONBOARDING] };
    expect(canViewOnboardingCase(actor, onboardingCase)).toBe(true);
    expect(canManageOnboardingCase(actor, onboardingCase)).toBe(false);
    expect(canCandidateEditItem(OnboardingItemOwner.NEW_HIRE)).toBe(true);
    expect(canCandidateEditItem(OnboardingItemOwner.INTERNAL)).toBe(false);
  });

  it('limits managers to owned or assigned cases', () => {
    expect(
      canManageOnboardingCase(
        { userId: 'owner', roles: [UserRole.MANAGER] },
        onboardingCase,
      ),
    ).toBe(true);
    expect(
      canManageOnboardingCase(
        { userId: 'assignee', roles: [UserRole.MANAGER] },
        onboardingCase,
      ),
    ).toBe(true);
    expect(
      canViewOnboardingCase(
        { userId: 'unrelated', roles: [UserRole.MANAGER] },
        onboardingCase,
      ),
    ).toBe(false);
    expect(
      canEditOnboardingItem(
        { userId: 'assignee', roles: [UserRole.MANAGER] },
        onboardingCase,
        'assignee',
      ),
    ).toBe(true);
    expect(
      canEditOnboardingItem(
        { userId: 'assignee', roles: [UserRole.MANAGER] },
        onboardingCase,
        'someone-else',
      ),
    ).toBe(false);
  });

  it('allows administrators to manage every case', () => {
    expect(
      canManageOnboardingCase(
        { userId: 'admin', roles: [UserRole.ADMIN_I] },
        onboardingCase,
      ),
    ).toBe(true);
  });
});

describe('onboarding lifecycle', () => {
  it('allows candidates to edit only active revision states', () => {
    expect(canCandidateEdit(OnboardingStatus.IN_PROGRESS)).toBe(true);
    expect(canCandidateEdit(OnboardingStatus.CHANGES_REQUESTED)).toBe(true);
    expect(canCandidateEdit(OnboardingStatus.SUBMITTED)).toBe(false);
    expect(canCandidateEdit(OnboardingStatus.COMPLETED)).toBe(false);
  });

  it('enforces review and approval transitions', () => {
    expect(
      canTransitionOnboardingStatus(
        OnboardingStatus.SUBMITTED,
        OnboardingStatus.UNDER_REVIEW,
      ),
    ).toBe(true);
    expect(
      canTransitionOnboardingStatus(
        OnboardingStatus.UNDER_REVIEW,
        OnboardingStatus.APPROVED,
      ),
    ).toBe(true);
    expect(
      canTransitionOnboardingStatus(
        OnboardingStatus.IN_PROGRESS,
        OnboardingStatus.APPROVED,
      ),
    ).toBe(false);
    expect(
      canTransitionOnboardingStatus(
        OnboardingStatus.CHANGES_REQUESTED,
        OnboardingStatus.UNDER_REVIEW,
      ),
    ).toBe(false);
    expect(
      canTransitionOnboardingStatus(
        OnboardingStatus.COMPLETED,
        OnboardingStatus.CANCELLED,
      ),
    ).toBe(false);
  });
});
