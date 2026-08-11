import { describe, expect, it } from 'vitest';
import { isEmailSenderCategoryDisabled, resolveSenderEmail } from './email';

describe('resolveSenderEmail', () => {
  it('routes each category to its dedicated sender', () => {
    const env = {
      MS_SENDER_NOREPLY_EMAIL: 'noreply@bisuhomeloans.com',
      MS_SENDER_LEADS_EMAIL: 'leads@bisuhomeloans.com',
      MS_SENDER_DISCLOSURES_EMAIL: 'disclosures@bisuhomeloans.com',
      MS_SENDER_ORIGINATIONS_EMAIL: 'originations@bisuhomeloans.com',
      MS_SENDER_PROCESSING_EMAIL: 'processing@bisuhomeloans.com',
    };

    expect(resolveSenderEmail('noreply', env)).toBe('noreply@bisuhomeloans.com');
    expect(resolveSenderEmail('leads', env)).toBe('leads@bisuhomeloans.com');
    expect(resolveSenderEmail('disclosures', env)).toBe(
      'disclosures@bisuhomeloans.com'
    );
    expect(resolveSenderEmail('originations', env)).toBe(
      'originations@bisuhomeloans.com'
    );
    expect(resolveSenderEmail('processing', env)).toBe(
      'processing@bisuhomeloans.com'
    );
  });

  it('uses the legacy sender during the backward-compatible rollout', () => {
    expect(
      resolveSenderEmail('leads', {
        MS_SENDER_EMAIL: 'noreply@federalfirstlending.com',
      })
    ).toBe('noreply@federalfirstlending.com');
  });

  it('rejects a missing category sender after strict mode is enabled', () => {
    expect(() =>
      resolveSenderEmail('leads', {
        MS_REQUIRE_CATEGORY_SENDERS: 'true',
        MS_SENDER_EMAIL: 'noreply@federalfirstlending.com',
      })
    ).toThrow('MS_SENDER_LEADS_EMAIL');
  });

  it('reports both accepted configuration paths when no sender exists', () => {
    expect(() => resolveSenderEmail('noreply', {})).toThrow(
      'MS_SENDER_NOREPLY_EMAIL or MS_SENDER_EMAIL'
    );
  });
});

describe('isEmailSenderCategoryDisabled', () => {
  it('pauses processing emails when the processing pause flag is enabled', () => {
    expect(
      isEmailSenderCategoryDisabled('processing', {
        MS_DISABLE_PROCESSING_EMAILS: 'true',
      })
    ).toBe(true);
  });

  it('does not pause any other email category', () => {
    expect(
      isEmailSenderCategoryDisabled('disclosures', {
        MS_DISABLE_PROCESSING_EMAILS: 'true',
      })
    ).toBe(false);
  });
});
