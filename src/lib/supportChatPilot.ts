import { UserRole } from '@prisma/client';
import { isAdmin } from '@/lib/adminTiers';

const PILOT_NAMES = new Set(['matt mahjoub']);

function normalize(value?: string | null) {
  return (value || '').trim().toLowerCase();
}

function getConfiguredPilotEmails() {
  return new Set(
    (process.env.NEXT_PUBLIC_SUPPORT_CHAT_PILOT_EMAILS || process.env.SUPPORT_CHAT_PILOT_EMAILS || '')
      .split(',')
      .map((email) => normalize(email))
      .filter(Boolean)
  );
}

export function canUseSupportChatPilot(input: {
  activeRole?: UserRole | null;
  roles?: UserRole[] | null;
  name?: string | null;
  email?: string | null;
}) {
  const roles = input.roles?.length
    ? input.roles
    : input.activeRole
      ? [input.activeRole]
      : [];
  if (input.activeRole === UserRole.LOAN_OFFICER || input.activeRole === UserRole.LOA) {
    return true;
  }
  if (roles.some((role) => isAdmin(role))) {
    return true;
  }
  if (PILOT_NAMES.has(normalize(input.name))) {
    return true;
  }
  const pilotEmails = getConfiguredPilotEmails();
  return pilotEmails.size > 0 && pilotEmails.has(normalize(input.email));
}
