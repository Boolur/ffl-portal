import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { sendWebsiteLeadAdminEmailsOnly } from '@/lib/websiteLeadNotifications';

function isAuthorized(request: Request): boolean {
  const allowedSecrets = [
    process.env.NOTIFICATION_OUTBOX_SECRET?.trim(),
    process.env.CRON_SECRET?.trim(),
  ].filter((secret): secret is string => Boolean(secret));
  if (allowedSecrets.length === 0) return false;

  const authHeader = request.headers.get('authorization') || '';
  const bearer = authHeader.toLowerCase().startsWith('bearer ')
    ? authHeader.slice(7).trim()
    : '';
  const headerSecret = request.headers.get('x-cron-secret')?.trim() || '';
  return allowedSecrets.includes(bearer) || allowedSecrets.includes(headerSecret);
}

async function parseLeadIds(request: Request) {
  const url = new URL(request.url);
  const fromQuery = url.searchParams
    .getAll('leadId')
    .flatMap((value) => value.split(','))
    .map((value) => value.trim())
    .filter(Boolean);

  if (fromQuery.length > 0) return Array.from(new Set(fromQuery));

  const body = await request.json().catch(() => null);
  const bodyIds = Array.isArray(body?.leadIds)
    ? body.leadIds
        .map((value: unknown) => String(value).trim())
        .filter(Boolean)
    : [];
  return Array.from(new Set(bodyIds));
}

export async function POST(request: Request) {
  if (!isAuthorized(request)) {
    return NextResponse.json(
      { success: false, error: 'Unauthorized' },
      { status: 401 }
    );
  }

  const leadIds = await parseLeadIds(request);
  if (leadIds.length === 0) {
    return NextResponse.json(
      { success: false, error: 'At least one leadId is required.' },
      { status: 400 }
    );
  }

  const leads = await prisma.lead.findMany({
    where: {
      id: { in: leadIds },
      assignedUserId: null,
      OR: [{ source: 'WebLead' }, { vendor: { slug: 'bisu-website' } }],
    },
    select: { id: true },
  });
  const allowedLeadIds = new Set(leads.map((lead) => lead.id));
  const results = [];

  for (const leadId of leadIds) {
    if (!allowedLeadIds.has(leadId)) {
      results.push({
        leadId,
        sent: 0,
        failed: 0,
        skipped: true,
        reason: 'Lead is not an unassigned BISU Website lead.',
      });
      continue;
    }

    try {
      const result = await sendWebsiteLeadAdminEmailsOnly(leadId);
      results.push({ leadId, ...result, skipped: false });
    } catch (error) {
      console.error('[website-lead-notifications] resend failed:', leadId, error);
      results.push({
        leadId,
        sent: 0,
        failed: 0,
        skipped: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  const totalSent = results.reduce((sum, row) => sum + (row.sent ?? 0), 0);
  const totalFailed = results.reduce((sum, row) => sum + (row.failed ?? 0), 0);
  const errors = results.filter((row) => row.error);

  return NextResponse.json({
    success: errors.length === 0 && totalFailed === 0,
    leadIds,
    totalSent,
    totalFailed,
    results,
  });
}

export async function GET(request: Request) {
  return POST(request);
}
