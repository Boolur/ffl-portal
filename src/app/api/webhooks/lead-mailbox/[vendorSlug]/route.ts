import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { LeadStatus, type Prisma } from '@prisma/client';
import { distributeLead } from '@/app/actions/leadActions';
import {
  LEAD_MAILBOX_FIELD_MAP,
  LEAD_MAILBOX_TARGET_FIELDS,
  extractBridgeNotes,
} from '@/lib/leadMailboxBridge';

/**
 * Matches an unsubstituted Lead Mailbox placeholder, e.g. "{FirstName}" or
 * "{Co_DateOfBirth}". When LM doesn't recognize a placeholder in the Service's
 * Content template, it passes the literal token through — we must not write
 * those strings onto real Lead fields.
 */
const UNSUBSTITUTED_PLACEHOLDER = /^\{[A-Za-z0-9_]+\}$/;

function normalizeStringValue(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const str = String(value).trim();
  if (str.length === 0) return null;
  if (UNSUBSTITUTED_PLACEHOLDER.test(str)) return null;
  return str;
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ vendorSlug: string }> }
) {
  const { vendorSlug } = await params;

  const vendor = await prisma.leadVendor.findUnique({
    where: { slug: vendorSlug },
  });

  if (!vendor || !vendor.active) {
    return NextResponse.json(
      { error: 'Unknown or inactive vendor' },
      { status: 404 }
    );
  }

  let payload: Record<string, unknown>;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  if (vendor.webhookSecret) {
    const sig =
      request.headers.get('x-webhook-secret') ||
      request.headers.get('authorization');
    if (sig !== vendor.webhookSecret && sig !== `Bearer ${vendor.webhookSecret}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
  }

  const routingTag = normalizeStringValue(payload.routing_tag);

  let campaign = null;
  if (routingTag) {
    campaign = await prisma.leadCampaign.findUnique({
      where: {
        vendorId_routingTag: { vendorId: vendor.id, routingTag },
      },
    });
  }

  const vendorLeadId =
    normalizeStringValue(payload.lead_id) ??
    normalizeStringValue(payload.leadId) ??
    normalizeStringValue(payload.leadid) ??
    normalizeStringValue(payload.id);

  if (campaign?.duplicateHandling === 'REJECT' && vendorLeadId) {
    const existing = await prisma.lead.findFirst({
      where: { vendorId: vendor.id, vendorLeadId },
    });
    if (existing) {
      return NextResponse.json(
        { error: 'Duplicate lead rejected', leadId: existing.id },
        { status: 409 }
      );
    }
  }

  const leadFields: Record<string, string> = {};
  for (const [payloadKey, rawValue] of Object.entries(payload)) {
    const target = LEAD_MAILBOX_FIELD_MAP[payloadKey];
    if (!target) continue;
    if (!LEAD_MAILBOX_TARGET_FIELDS.has(target)) continue;
    const value = normalizeStringValue(rawValue);
    if (value === null) continue;
    if (leadFields[target]) continue;
    leadFields[target] = value;
  }

  const statusStr = campaign?.defaultLeadStatus ?? 'UNASSIGNED';
  const status = (Object.values(LeadStatus) as string[]).includes(statusStr)
    ? (statusStr as LeadStatus)
    : LeadStatus.UNASSIGNED;

  const createData: Prisma.LeadUncheckedCreateInput = {
    vendorLeadId,
    vendorId: vendor.id,
    campaignId: campaign?.id ?? null,
    status,
    source: `Lead Mailbox (${vendor.name})`,
    rawPayload: payload as Prisma.InputJsonValue,
    receivedAt: new Date(),
  };

  for (const [k, v] of Object.entries(leadFields)) {
    (createData as Record<string, unknown>)[k] = v;
  }

  const lead = await prisma.lead.create({ data: createData });

  const noteContents = extractBridgeNotes(payload);
  if (noteContents.length > 0) {
    try {
      await prisma.leadNote.createMany({
        data: noteContents.map((content) => ({
          leadId: lead.id,
          authorId: null,
          content,
        })),
      });
    } catch (err) {
      // Non-fatal: notes failing should never block lead distribution.
      console.warn(
        '[lead-mailbox-bridge] failed to persist vendor notes for lead',
        lead.id,
        err
      );
    }
  }

  try {
    await distributeLead(lead.id);
  } catch (err) {
    console.error(
      '[lead-mailbox-bridge] distribution failed for lead',
      lead.id,
      err
    );
  }

  // `status: "ok"` is intentional: Lead Mailbox's default Success String is
  // `"status":"ok"` and it matches against the raw response body. Keeping this
  // field stable means every LM Service pointed at the bridge reports success
  // without per-Service config changes.
  return NextResponse.json(
    {
      status: 'ok',
      success: true,
      leadId: lead.id,
      source: 'lead-mailbox-bridge',
      vendor: vendor.slug,
      campaign: campaign?.routingTag ?? null,
    },
    { status: 201 }
  );
}
