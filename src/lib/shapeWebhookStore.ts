import { Prisma, PrismaClient } from '@prisma/client';
import type { ShapeWebhookCapture } from './shapeWebhook';

const originalIdFields = ['lead_id', 'original_id', 'mktentryid'];
export function originalId(body: Record<string, unknown>): string | null {
  const ids = new Set<string>();
  for (const key of originalIdFields) {
    const value = body[key];
    if (typeof value === 'string' && value.trim() && value.trim() !== '--') ids.add(value.trim());
  }
  if (ids.size > 1) throw new Error('Conflicting original portal IDs');
  return [...ids][0] ?? null;
}

export function shapeIdentityFilters(body: Record<string, unknown>): Prisma.WebhookInboxEventWhereInput[] {
  const filters: Prisma.WebhookInboxEventWhereInput[] = [];
  const portalId = originalId(body);
  if (portalId) {
    for (const field of originalIdFields) filters.push({ body: { path: [field], equals: portalId } });
    return filters;
  }
  const raw = body.shape_lead_id;
  const shapeId = typeof raw === 'number' || (typeof raw === 'string' && /^\d+$/.test(raw.trim())) ? Number(raw) : NaN;
  if (Number.isSafeInteger(shapeId) && shapeId > 0) {
    for (const value of [shapeId, String(shapeId)]) filters.push({ body: { path: ['shape_lead_id'], equals: value } });
  }
  return filters;
}

// Only a portal Lead.id can identify a Lead Distribution record. In particular,
// Shape's own ID, borrower identity and vendorLeadId are never lookup fallbacks.
export async function attachShapePayloadToLead(
  tx: Prisma.TransactionClient,
  body: Record<string, unknown>,
  inboxEventId: string,
): Promise<string | null> {
  const portalId = originalId(body);
  if (!portalId) return null;
  const leads = await tx.$queryRaw<Array<{ id: string; customData: Prisma.JsonValue }>>`
    SELECT "id", "customData" FROM "Lead" WHERE "id" = ${portalId} FOR UPDATE
  `;
  if (!leads.length) return null;
  const customData = leads[0].customData;
  const saved = customData && typeof customData === 'object' && !Array.isArray(customData)
    ? customData.shapeRecordId : null;
  if (saved != null && body.shape_lead_id != null && String(saved) !== String(body.shape_lead_id)) {
    return null;
  }
  const snapshot = JSON.stringify({
    payload: body,
    status: typeof body['1_Status'] === 'string' ? body['1_Status'] : null,
    receivedAt: new Date().toISOString(),
    inboxEventId,
    processing: 'awaiting_mapping',
  });
  // Merge only this namespace so inbound vendor data, assignment, notes, other
  // integrations and the original lead's source/received time remain intact.
  await tx.$executeRaw`
    UPDATE "Lead"
    SET "customData" = COALESCE("customData", '{}'::jsonb)
      || jsonb_build_object('shapeWebhook', ${snapshot}::jsonb),
      "updatedAt" = NOW()
    WHERE "id" = ${portalId}
  `;
  return portalId;
}

export async function storeShapeWebhook(db: PrismaClient, capture: ShapeWebhookCapture): Promise<string | string[]> {
  return db.$transaction(async tx => {
    // All receiver instances serialize the lookup/update, including first delivery.
    // A transaction-scoped lock also prevents concurrent requests creating twins.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(739246, 1)`;
    const records = Array.isArray(capture.body) ? capture.body : [capture.body];
    const ids: string[] = [];
    for (const record of records) {
      const object = record && typeof record === 'object' && !Array.isArray(record)
        ? record as Record<string, unknown> : null;
      const filters = object ? shapeIdentityFilters(object) : [];
      const matches = filters.length ? await tx.webhookInboxEvent.findMany({
        where: { source: 'shape', OR: filters },
        orderBy: [{ receivedAt: 'desc' }, { id: 'asc' }],
        select: { id: true, body: true },
      }) : [];
      // Never merge two different portal leads just because a Shape ID was reused.
      const portalId = object && originalId(object);
      if (portalId && matches.some(row => {
        const existing = originalId(row.body as Record<string, unknown>);
        return existing && existing !== portalId;
      })) throw new Error('Conflicting Shape lead identity');
      const data = {
        source: 'shape', vendorSlug: null, method: 'POST',
        headers: capture.headers,
        body: record === null ? Prisma.JsonNull : record as Prisma.InputJsonValue,
        status: 'PENDING' as const, receivedAt: new Date(), processedAt: null,
        attempts: 0,
        errorMessage: 'Captured; awaiting Shape field mapping. No downstream actions performed.',
      };
      const event = matches.length
        ? await tx.webhookInboxEvent.update({ where: { id: matches[0].id }, data, select: { id: true } })
        : await tx.webhookInboxEvent.create({ data, select: { id: true } });
      const matchedLeadId = object ? await attachShapePayloadToLead(tx, object, event.id) : null;
      await tx.webhookInboxEvent.update({
        where: { id: event.id },
        data: {
          leadId: matchedLeadId,
          errorMessage: matchedLeadId
            ? 'Shape payload saved on exact portal lead ID; disposition mapping pending.'
            : 'Captured without updating a lead: portal lead ID missing, unmatched, or Shape ID conflicts.',
        },
        select: { id: true },
      });
      // Consolidate pre-existing duplicate inbox rows as well. Never delete leads.
      if (matches.length > 1) await tx.webhookInboxEvent.deleteMany({
        where: { source: 'shape', id: { in: matches.slice(1).map(row => row.id) } },
      });
      ids.push(event.id);
    }
    return Array.isArray(capture.body) ? [...new Set(ids)] : ids[0];
  }, { maxWait: 10000, timeout: 20000 });
}
