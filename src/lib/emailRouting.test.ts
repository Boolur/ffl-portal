import { describe, expect, it } from 'vitest';
import { getTaskEmailSenderCategory } from './emailRouting';

describe('getTaskEmailSenderCategory', () => {
  it.each(['DISCLOSURE', 'QC'] as const)(
    'routes %s work to the disclosures mailbox',
    (desk) => {
      expect(getTaskEmailSenderCategory(desk)).toBe('disclosures');
    }
  );

  it.each(['JR', 'VA'] as const)(
    'routes %s work to the processing mailbox',
    (desk) => {
      expect(getTaskEmailSenderCategory(desk)).toBe('processing');
    }
  );
});
