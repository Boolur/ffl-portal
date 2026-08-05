import { prisma } from './prisma';

type UserEmailPreference = {
  email: string;
  emailNotificationsEnabled: boolean;
};

function normalizeEmail(value: string) {
  return value.trim().toLowerCase();
}

export function applyEmailNotificationPreferences(
  recipients: string[],
  userPreferences: UserEmailPreference[]
): string[] {
  const preferenceByEmail = new Map(
    userPreferences.map((user) => [
      normalizeEmail(user.email),
      user.emailNotificationsEnabled,
    ])
  );

  return Array.from(
    new Set(
      recipients
        .map(normalizeEmail)
        .filter(Boolean)
        .filter((email) => preferenceByEmail.get(email) !== false)
    )
  );
}

export async function filterEmailRecipientsByPreference(
  recipients: string[]
): Promise<string[]> {
  const normalizedRecipients = Array.from(
    new Set(recipients.map(normalizeEmail).filter(Boolean))
  );
  if (normalizedRecipients.length === 0) return [];

  const users = await prisma.user.findMany({
    where: {
      email: {
        in: normalizedRecipients,
        mode: 'insensitive',
      },
    },
    select: {
      email: true,
      emailNotificationsEnabled: true,
    },
  });

  return applyEmailNotificationPreferences(normalizedRecipients, users);
}
