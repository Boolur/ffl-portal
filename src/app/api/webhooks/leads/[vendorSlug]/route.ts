import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { LeadStatus, type Prisma } from '@prisma/client';
import { distributeLead } from '@/app/actions/leadActions';
import { runServiceTriggers } from '@/lib/services';
import { IntegrationServiceTrigger } from '@prisma/client';
import { normalizeMilitaryFlag } from '@/lib/militaryFlag';

type FieldMapping = Record<string, string>;

function getNestedValue(obj: Record<string, unknown>, path: string): unknown {
  return path.split('.').reduce<unknown>((acc, key) => {
    if (acc && typeof acc === 'object' && key in (acc as Record<string, unknown>)) {
      return (acc as Record<string, unknown>)[key];
    }
    return undefined;
  }, obj);
}

function applyFieldMapping(
  payload: Record<string, unknown>,
  mapping: FieldMapping
): Record<string, string | null> {
  const result: Record<string, string | null> = {};
  for (const [vendorField, ourField] of Object.entries(mapping)) {
    const raw = getNestedValue(payload, vendorField);
    result[ourField] = raw != null ? String(raw) : null;
  }
  return result;
}

const LEAD_FIELDS = new Set([
  'firstName', 'lastName', 'email', 'phone', 'homePhone', 'workPhone', 'dob',
  // SSN is a sensitive identity column but we *do* persist it — the leads
  // UI shows it to admins and assigned LOs, and the Bonzo forwarder passes
  // it through when the LO's destination CRM wants it. Dropping it here
  // was the quiet reason LendingTree-style vendors that include SSN in
  // their webhook payload never had the field populated on our side.
  'ssn',
  'coFirstName', 'coLastName', 'coEmail', 'coPhone', 'coHomePhone', 'coWorkPhone', 'coDob',
  'mailingAddress', 'mailingCity', 'mailingState', 'mailingZip', 'mailingCounty',
  'propertyAddress', 'propertyCity', 'propertyState', 'propertyZip', 'propertyCounty',
  'purchasePrice', 'propertyValue', 'propertyType', 'propertyUse', 'propertyAcquired', 'propertyLtv',
  'employer', 'jobTitle', 'employmentLength', 'selfEmployed', 'income', 'bankruptcy', 'foreclosure', 'homeowner',
  'coEmployer', 'coJobTitle', 'coEmploymentLength', 'coSelfEmployed', 'coIncome',
  'loanPurpose', 'loanAmount', 'loanTerm', 'loanType', 'loanRate',
  'downPayment', 'cashOut', 'creditRating',
  'currentLender', 'currentBalance', 'currentRate', 'currentPayment', 'currentTerm', 'currentType',
  'otherBalance', 'otherPayment', 'targetRate',
  'vaStatus', 'vaLoan', 'isMilitary', 'fhaLoan', 'sourceUrl',
  'leadCreated',
]);

export async function POST(
  request: Request,
  { params }: { params: Promise<{ vendorSlug: string }> }
) {
  const { vendorSlug } = await params;

  const vendor = await prisma.leadVendor.findUnique({
    where: { slug: vendorSlug },
  });

  if (!vendor || !vendor.active) {
    return NextResponse.json({ error: 'Unknown or inactive vendor' }, { status: 404 });
  }

  let payload: Record<string, unknown>;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  if (vendor.webhookSecret) {
    const sig = request.headers.get('x-webhook-secret') || request.headers.get('authorization');
    if (sig !== vendor.webhookSecret && sig !== `Bearer ${vendor.webhookSecret}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
  }

  const routingTagValue = getNestedValue(payload, vendor.routingTagField);
  const routingTag = routingTagValue != null ? String(routingTagValue) : null;

  let campaign = null;
  if (routingTag) {
    const match = await prisma.leadCampaign.findUnique({
      where: { vendorId_routingTag: { vendorId: vendor.id, routingTag } },
    });
    if (match?.active) campaign = match;
  }

  const vendorLeadId =
    (payload.lead_id as string) ||
    (payload.leadId as string) ||
    (payload.id as string) ||
    null;

  if (campaign?.duplicateHandling === 'REJECT' && vendorLeadId) {
    const existing = await prisma.lead.findFirst({
      where: { vendorId: vendor.id, vendorLeadId },
    });
    if (existing) {
      return NextResponse.json({ error: 'Duplicate lead rejected', leadId: existing.id }, { status: 409 });
    }
  }

  const mapping = (vendor.fieldMapping as FieldMapping) || {};
  const mapped = applyFieldMapping(payload, mapping);

  const leadFields: Record<string, string> = {};
  for (const [key, value] of Object.entries(mapped)) {
    if (!LEAD_FIELDS.has(key) || value == null) continue;
    if (key === 'isMilitary') {
      // Canonicalize every vendor's True/Yes/1/etc. to the portal's
      // "Yes"/"No" so reporting, filters, and Bonzo-native campaign
      // triggers (which are boolean-strict on Bonzo's end) all see a
      // stable value. Unknown values (typos, "maybe") pass through so
      // admins can still triage them in the detail panel.
      const canonical = normalizeMilitaryFlag(value);
      leadFields[key] = canonical ?? value;
      continue;
    }
    leadFields[key] = value;
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
    source: routingTag || vendor.name,
    rawPayload: payload as Prisma.InputJsonValue,
    receivedAt: new Date(),
  };

  for (const [k, v] of Object.entries(leadFields)) {
    (createData as Record<string, unknown>)[k] = v;
  }

  const lead = await prisma.lead.create({ data: createData });

  void runServiceTriggers(lead.id, IntegrationServiceTrigger.ON_RECEIVE);
  void runServiceTriggers(
    lead.id,
    IntegrationServiceTrigger.DELAY_AFTER_RECEIVE
  );

  try {
    await distributeLead(lead.id);
  } catch (err) {
    console.error('[lead-webhook] distribution failed for lead', lead.id, err);
  }

  return NextResponse.json({ success: true, leadId: lead.id }, { status: 201 });
}
