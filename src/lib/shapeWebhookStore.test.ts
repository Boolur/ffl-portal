import { describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import { shapeIdentityFilters, storeShapeWebhook } from './shapeWebhookStore';

function fixture(matches: Array<{id: string; body: unknown}> = []) {
  const tx = {
    $executeRaw: vi.fn().mockResolvedValue(1),
    webhookInboxEvent: {
      findMany: vi.fn().mockResolvedValue(matches),
      create: vi.fn().mockResolvedValue({ id: 'new' }),
      update: vi.fn().mockResolvedValue({ id: 'existing' }),
      deleteMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
  };
  const db = { $transaction: vi.fn(fn => fn(tx)) } as unknown as PrismaClient;
  return { db, tx };
}

describe('Shape latest payload storage', () => {
  it('matches original portal ID aliases and numeric/string Shape IDs', () => {
    const filters = shapeIdentityFilters({ lead_id: 'portal-1', shape_lead_id: '480' });
    expect(filters).toContainEqual({ body: { path: ['mktentryid'], equals: 'portal-1' } });
    expect(filters).toContainEqual({ body: { path: ['shape_lead_id'], equals: 480 } });
    expect(filters).toContainEqual({ body: { path: ['shape_lead_id'], equals: '480' } });
  });
  it('does not match absent or placeholder identifiers', () => {
    expect(shapeIdentityFilters({ lead_id: '--', shape_lead_id: 0 })).toEqual([]);
    expect(shapeIdentityFilters({ shape_lead_id: true })).toEqual([]);
  });
  it('replaces the complete old payload and consolidates legacy duplicates', async () => {
    const { db, tx } = fixture([
      { id: 'existing', body: { lead_id: 'portal-1', '1_Status': 'New Lead', old: true } },
      { id: 'duplicate', body: { lead_id: 'portal-1' } },
    ]);
    const body = { lead_id: 'portal-1', '1_Status': 'Contacted - Follow Up' };
    expect(await storeShapeWebhook(db, { body, headers: {} })).toBe('existing');
    expect(tx.webhookInboxEvent.create).not.toHaveBeenCalled();
    expect(tx.webhookInboxEvent.update.mock.calls[0][0].data.body).toEqual(body);
    expect(tx.webhookInboxEvent.deleteMany).toHaveBeenCalledWith({ where: { source: 'shape', id: { in: ['duplicate'] } } });
    expect(tx.$executeRaw.mock.invocationCallOrder[0]).toBeLessThan(tx.webhookInboxEvent.findMany.mock.invocationCallOrder[0]);
  });
  it('keeps unidentified deliveries separate', async () => {
    const { db, tx } = fixture();
    await storeShapeWebhook(db, { body: { email: 'same@example.invalid' }, headers: {} });
    expect(tx.webhookInboxEvent.findMany).not.toHaveBeenCalled();
    expect(tx.webhookInboxEvent.create).toHaveBeenCalledOnce();
  });
  it('does not overwrite a different portal lead with a colliding Shape ID', async () => {
    const { db, tx } = fixture([{ id: 'existing', body: { lead_id: 'other', shape_lead_id: 480 } }]);
    await expect(storeShapeWebhook(db, { body: { lead_id: 'portal-1', shape_lead_id: 480 }, headers: {} })).rejects.toThrow('Conflicting');
    expect(tx.webhookInboxEvent.update).not.toHaveBeenCalled();
    expect(tx.webhookInboxEvent.deleteMany).not.toHaveBeenCalled();
  });
  it('handles each lead in a batch individually', async () => {
    const { db, tx } = fixture();
    tx.webhookInboxEvent.create.mockResolvedValueOnce({ id: 'one' }).mockResolvedValueOnce({ id: 'two' });
    expect(await storeShapeWebhook(db, { body: [{ shape_lead_id: 1 }, { shape_lead_id: 2 }], headers: {} })).toEqual(['one', 'two']);
    expect(tx.webhookInboxEvent.create).toHaveBeenCalledTimes(2);
  });
});
