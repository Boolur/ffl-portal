import { NextRequest, NextResponse } from 'next/server';
import { getToken } from 'next-auth/jwt';
import { UserRole } from '@prisma/client';
import { getPortalRevisions } from '@/lib/portalRevisionQueries';
import { canAccessPipelinePortal } from '@/lib/pipelinePilot';

const viewingRoles = new Set<UserRole>([
  UserRole.ADMIN, UserRole.ADMIN_I, UserRole.ADMIN_II, UserRole.ADMIN_III,
  UserRole.MANAGER, UserRole.LOAN_OFFICER, UserRole.LOA,
  UserRole.DISCLOSURE_SPECIALIST, UserRole.PROCESSOR_JR,
  UserRole.PROCESSOR_SR, UserRole.PROCESSING_MANAGER,
]);
const headers = { 'Cache-Control': 'private, no-store' };

export async function GET(request: NextRequest) {
  // Validate the signed, expiring session without a database/session refresh on
  // every heartbeat. All actual record reads still use their existing guards.
  const token = await getToken({ req: request });
  if (!token?.id) return NextResponse.json({ error: 'Sign in required.' }, { status: 401, headers });
  const role = (token.activeRole || token.role) as UserRole;
  if (!viewingRoles.has(role)) return NextResponse.json({ error: 'Not authorized.' }, { status: 403, headers });
  const topic = request.nextUrl.searchParams.get('topic');
  if (topic !== 'overview' && topic !== 'tasks' && topic !== 'pipeline') {
    return NextResponse.json({ error: 'Invalid workspace.' }, { status: 400, headers });
  }
  if (topic === 'pipeline' && !canAccessPipelinePortal({ role })) {
    return NextResponse.json({ error: 'Not authorized.' }, { status: 403, headers });
  }
  try {
    const revisions = await getPortalRevisions();
    return NextResponse.json({ topic, revision: revisions[topic] }, { headers });
  } catch {
    return NextResponse.json({ error: 'Updates are temporarily unavailable.' }, { status: 503, headers });
  }
}
