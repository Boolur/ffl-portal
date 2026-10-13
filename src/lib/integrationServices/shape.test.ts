import { describe, expect, it } from 'vitest';
import { buildShapePayload, SHAPE_ENDPOINT, validateShapeDestination } from './shape';

const lead = {
  id: 'portal-123', firstName: 'Jane "JJ"', lastName: 'Borrower', email: 'jane@example.com',
  phone: ' ', homePhone: '5550100123', propertyAddress: '12 Main St',
  vendor: { name: 'Vendor' }, campaign: { name: 'VA Leads' }, loanAmount: '250000',
} as Parameters<typeof buildShapePayload>[0];

describe('Shape mapping', () => {
  it('uses the tenant field names, portal entry ID and explicit Shape assignee', () => {
    expect(buildShapePayload(lead, ' 3 ')).toMatchObject({
      firstname: 'Jane "JJ"', lastname: 'Borrower', email: 'jane@example.com',
      recordtype: 3, mstrstatus1: 'New Lead', depursLi: '3', mktentryid: 'portal-123',
      phone: '5550100123', address2: '12 Main St', prStreetAddress: '12 Main St',
    });
    expect(buildShapePayload(lead, '3').notes).toContain('Loan amount: 250000');
    expect(buildShapePayload(lead, '3')).not.toHaveProperty('leadsource');
  });
  it.each(['firstName', 'lastName', 'email'] as const)('rejects missing %s', (key) => {
    expect(() => buildShapePayload({ ...lead, [key]: ' ' }, '3')).toThrow(key);
  });
  it.each(['', '0', '-1', 'Nick', '3.5'])('rejects invalid user ID %s', (id) => {
    expect(() => buildShapePayload(lead, id)).toThrow('Shape user ID');
  });
  it('restricts the company credential to the exact Shape POST endpoint', () => {
    expect(() => validateShapeDestination(SHAPE_ENDPOINT, 'POST_JSON')).not.toThrow();
    expect(() => validateShapeDestination(SHAPE_ENDPOINT + '/other', 'POST_JSON')).toThrow();
    expect(() => validateShapeDestination('https://example.com', 'POST_JSON')).toThrow();
    expect(() => validateShapeDestination(SHAPE_ENDPOINT, 'GET')).toThrow();
  });
  it('routes CLR and administration users to their actual Shape departments', () => {
    expect(buildShapePayload(lead, '40', 'depursLo')).toMatchObject({depursLo: '40'});
    expect(buildShapePayload(lead, '40', 'depursLo')).not.toHaveProperty('depursLi');
    expect(buildShapePayload(lead, '142', 'depursAa')).toMatchObject({depursAa: '142'});
    expect(() => buildShapePayload(lead, '3', 'unverified')).toThrow('department');
  });
});
