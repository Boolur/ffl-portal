import { describe, expect, it } from 'vitest';
import { buildBonzoPayload } from './bonzoForward';

describe('buildBonzoPayload', () => {
  it('sends the newly assigned LO email as the top-level Bonzo user_id', () => {
    const payload = buildBonzoPayload({
      id: 'lead-1',
      firstName: 'John',
      lastName: 'Borrower',
      email: 'john@example.com',
      status: 'NEW',
      assignedAt: new Date('2026-09-17T17:00:00.000Z'),
      receivedAt: new Date('2026-09-17T17:00:00.000Z'),
      vendor: { name: 'Lead Vendor', slug: 'lead-vendor' },
      campaign: null,
      assignedUser: {
        name: 'New Loan Officer',
        email: 'newlo@company.com',
      },
    } as Parameters<typeof buildBonzoPayload>[0]);

    expect(payload).toMatchObject({
      first_name: 'John',
      email: 'john@example.com',
      user_id: 'newlo@company.com',
    });
  });
});
