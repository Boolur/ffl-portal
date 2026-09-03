import { prisma } from '@/lib/prisma';

export type LoginAuditOutcome = 'SUCCESS' | 'FAILURE';
export type LoginFailureReason =
  | 'MISSING_CREDENTIALS'
  | 'USER_NOT_FOUND'
  | 'ACCOUNT_INACTIVE'
  | 'PASSWORD_NOT_CONFIGURED'
  | 'INVALID_PASSWORD';

export async function recordLoginAttempt(input: {
  email: string;
  userId?: string;
  outcome: LoginAuditOutcome;
  reason?: LoginFailureReason;
  ipAddress?: string | null;
  userAgent?: string | null;
}): Promise<void> {
  try {
    await prisma.loginAudit.create({
      data: {
        email: input.email.trim().toLowerCase().slice(0, 320) || '(not provided)',
        userId: input.userId ?? null,
        outcome: input.outcome,
        reason: input.reason ?? null,
        ipAddress: input.ipAddress?.slice(0, 64) ?? null,
        userAgent: input.userAgent?.slice(0, 512) ?? null,
      },
    });
  } catch (error) {
    // Authentication must remain available if audit persistence has a
    // transient failure or the migration has not reached an environment yet.
    console.warn('[auth] failed to persist login audit', error);
  }
}
