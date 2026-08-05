import { describe, expect, it } from 'vitest';
import { applyEmailNotificationPreferences } from './emailPreferences';

describe('applyEmailNotificationPreferences', () => {
  it('removes portal users who disabled email notifications', () => {
    expect(
      applyEmailNotificationPreferences(
        ['enabled@bisuhomeloans.com', 'disabled@bisuhomeloans.com'],
        [
          {
            email: 'enabled@bisuhomeloans.com',
            emailNotificationsEnabled: true,
          },
          {
            email: 'disabled@bisuhomeloans.com',
            emailNotificationsEnabled: false,
          },
        ]
      )
    ).toEqual(['enabled@bisuhomeloans.com']);
  });

  it('keeps external recipients and normalizes duplicates', () => {
    expect(
      applyEmailNotificationPreferences(
        [' External@example.com ', 'external@example.com'],
        []
      )
    ).toEqual(['external@example.com']);
  });
});
