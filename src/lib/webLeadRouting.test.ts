import { describe, expect, it } from 'vitest';
import { UserRole } from '@prisma/client';
import { buildWebLeadMetadata, resolveWebLeadTarget } from './webLeadRouting';

const validTarget = {
  id: 'user-1',
  active: true,
  role: UserRole.LOAN_OFFICER,
  roles: [UserRole.LOAN_OFFICER],
  websiteLoanOfficerProfile: {
    slug: 'jane-doe',
    publishedAt: new Date('2026-08-03T00:00:00.000Z'),
  },
};

describe('resolveWebLeadTarget', () => {
  it('directs a published active loan officer without applying campaign gates', () => {
    expect(resolveWebLeadTarget(validTarget, 'jane-doe')).toBe('user-1');
  });

  it.each([
    ['missing target', null],
    ['inactive target', { ...validTarget, active: false }],
    [
      'non-loan-officer target',
      { ...validTarget, role: UserRole.MANAGER, roles: [UserRole.MANAGER] },
    ],
    [
      'unpublished target',
      {
        ...validTarget,
        websiteLoanOfficerProfile: {
          ...validTarget.websiteLoanOfficerProfile,
          publishedAt: null,
        },
      },
    ],
    [
      'missing profile',
      {
        ...validTarget,
        websiteLoanOfficerProfile: null,
      },
    ],
  ])('leaves a %s unassigned', (_label, target) => {
    expect(resolveWebLeadTarget(target, 'jane-doe')).toBeNull();
  });

  it('rejects a mismatched officer slug', () => {
    expect(resolveWebLeadTarget(validTarget, 'different-officer')).toBeNull();
  });
});

describe('buildWebLeadMetadata', () => {
  it('preserves strategist data and normalized attribution fields', () => {
    expect(
      buildWebLeadMetadata({
        source: 'strategist',
        officerSlug: 'jane-doe',
        partnerSlug: 'partner-a',
        consent: 'yes',
        consent_text_version: 'v1',
        customData: { recommendation: 'Conventional' },
      }),
    ).toEqual({
      recommendation: 'Conventional',
      formSource: 'strategist',
      officerSlug: 'jane-doe',
      partnerSlug: 'partner-a',
      consent: 'yes',
      consentTextVersion: 'v1',
    });
  });

  it('ignores non-object custom data', () => {
    expect(buildWebLeadMetadata({ customData: 'invalid' })).toEqual({});
  });
});
