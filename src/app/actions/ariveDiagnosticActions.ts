'use server';

import { getServerSession } from 'next-auth';
import type { UserRole } from '@prisma/client';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { isAdminIII } from '@/lib/adminTiers';
import { AriveError, ariveSession } from '@/lib/ariveClient';
import {
  AriveDiagnosticInputError, collectAriveEgressDiagnostic, compareAriveCredentials,
  normalizeDiagnosticCredentials, parseAriveComparisonCode,
  type AriveCredentialDiagnostic, type AriveEgressDiagnostic,
} from '@/lib/ariveDiagnostics';

type Result<T> = { success: true; data: T } | { success: false; error: string };
class DiagnosticAccessError extends Error {}

async function requireDiagnosticAdmin() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) throw new DiagnosticAccessError('Sign in as a portal Admin III to run diagnostics.');
  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { active: true, role: true, roles: true },
  });
  if (!user?.active) throw new DiagnosticAccessError('Account unavailable.');
  const role = (session.user.activeRole || session.user.role) as UserRole;
  if (role !== user.role && !user.roles.includes(role)) throw new DiagnosticAccessError('Role not available.');
  if (!isAdminIII(role)) throw new DiagnosticAccessError('Only a portal Admin III can run Arive diagnostics.');
}

function safeFailure(error: unknown): { success: false; error: string } {
  return { success: false, error: error instanceof DiagnosticAccessError || error instanceof AriveDiagnosticInputError ? error.message : 'Unable to complete the Arive diagnostic.' };
}

function authenticationFailure(error: unknown): string {
  if (!(error instanceof AriveError)) return 'Unable to complete the Arive authentication test.';
  // AriveError normally already contains safe diagnostics. Keep a strict boundary here
  // as well so future client changes cannot expose arbitrary provider response text.
  const fixed = new Set(['Unable to connect to Arive.', 'Arive did not issue an access token.', 'Arive returned an unexpected response.']);
  if (fixed.has(error.message)) return error.message;
  const safe = /^Arive authentication returned HTTP [1-5]\d{2}\. (?:Check the credentials and Arive-provisioned permission for this operation\.|Rate limit reached; try again later\.|Please retry or contact your administrator\.)(?: Gateway code: (?:ForbiddenException|MissingAuthenticationTokenException|InvalidSignatureException|AccessDeniedException|UnauthorizedException|NotAuthorizedException|WAFForbiddenException)\.)?(?: Request ID: [a-zA-Z0-9-]{8,100}\.)?$/;
  return safe.test(error.message) ? error.message : 'Unable to complete the Arive authentication test.';
}

export async function runAriveEgressDiagnostic(): Promise<Result<AriveEgressDiagnostic>> {
  try {
    await requireDiagnosticAdmin();
    return { success: true, data: await collectAriveEgressDiagnostic() };
  } catch (error) { return safeFailure(error); }
}

export async function runAriveCredentialDiagnostic(input: { clientId: string; secret: string; apiKey: string; comparisonCode: string }): Promise<Result<AriveCredentialDiagnostic>> {
  try {
    await requireDiagnosticAdmin();
    const credentials = normalizeDiagnosticCredentials(input);
    const code = parseAriveComparisonCode(input.comparisonCode);
    const matches = compareAriveCredentials(credentials, code);
    let authentication: AriveCredentialDiagnostic['authentication'] = {
      attempted: false, ok: false, message: 'Authentication was skipped because the credentials do not match the local comparison code.',
    };
    if (Object.values(matches).every(Boolean)) {
      try {
        await ariveSession(credentials);
        authentication = { attempted: true, ok: true, message: 'Authentication succeeded. Credentials were not saved and no loan APIs were called.' };
      } catch (error) { authentication = { attempted: true, ok: false, message: authenticationFailure(error) }; }
    }
    const egress = await collectAriveEgressDiagnostic();
    return { success: true, data: { matches, authentication, egress } };
  } catch (error) { return safeFailure(error); }
}
