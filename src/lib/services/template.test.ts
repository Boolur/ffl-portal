import { describe, expect, it } from 'vitest';
import type { Lead } from '@prisma/client';
import { renderString, type TemplateContext } from './template';

function context(
  address: Partial<
    Pick<
      Lead,
      | 'mailingAddress'
      | 'mailingCity'
      | 'mailingState'
      | 'mailingZip'
      | 'propertyAddress'
      | 'propertyCity'
      | 'propertyState'
      | 'propertyZip'
    >
  >
): TemplateContext {
  return {
    lead: address as Lead,
    user: null,
    campaign: null,
    vendor: { id: 'vendor-1', name: 'Vendor', slug: 'vendor' },
    now: new Date('2026-09-08T12:00:00.000Z'),
  };
}

describe('integration service address merge fields', () => {
  const template = [
    '{{lead.mailingOrPropertyAddress}}',
    '{{lead.mailingOrPropertyCity}}',
    '{{lead.mailingOrPropertyState}}',
    '{{lead.mailingOrPropertyZip}}',
  ].join('|');

  it('prefers mailing address fields when both address sets exist', () => {
    expect(
      renderString(
        template,
        context({
          mailingAddress: '10 Mailing St',
          mailingCity: 'Mailtown',
          mailingState: 'CA',
          mailingZip: '90001',
          propertyAddress: '20 Property Ave',
          propertyCity: 'Propertyville',
          propertyState: 'AZ',
          propertyZip: '85001',
        })
      )
    ).toBe('10 Mailing St|Mailtown|CA|90001');
  });

  it('falls back to property address fields when mailing fields are absent', () => {
    expect(
      renderString(
        template,
        context({
          mailingAddress: null,
          mailingCity: null,
          mailingState: null,
          mailingZip: null,
          propertyAddress: '20 Property Ave',
          propertyCity: 'Propertyville',
          propertyState: 'AZ',
          propertyZip: '85001',
        })
      )
    ).toBe('20 Property Ave|Propertyville|AZ|85001');
  });
});
