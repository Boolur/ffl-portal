import { beforeEach, describe, expect, it, vi } from 'vitest';
const mock = vi.hoisted(() => ({ shared: vi.fn() }));
vi.mock('server-only', () => ({}));
vi.mock('@/lib/prisma', () => ({ prisma: {} }));
vi.mock('@/lib/ariveCrypto', () => ({ decryptAriveCredentials: vi.fn() }));
vi.mock('./ariveTransportPrisma', () => ({ sharedAriveSessionIfEnabled: mock.shared }));
import { ariveReadOnlySession, ariveSession } from './ariveClient';
import { AriveTransportError } from './ariveTransport';
beforeEach(() => vi.resetAllMocks());

describe('shared Arive client boundary', () => {
  it('hides unexpected persistence/network details from saved callers', async () => {
    mock.shared.mockResolvedValue(async () => { throw new Error('synthetic-secret at private-storage-location'); });
    const api = await ariveSession();
    await expect(api('/loans/test')).rejects.toThrow('Arive request did not finish.');
    await expect(api('/loans/test')).rejects.not.toThrow('synthetic-secret');
  });
  it('retains safe budget errors and retry metadata for workers', async () => {
    const error = new AriveTransportError('BUDGET_EXHAUSTED', 'Reserved allowance reached.', new Date('2026-11-12T20:01:00Z'));
    mock.shared.mockResolvedValue(async () => { throw error; });
    const api = await ariveReadOnlySession();
    await expect(api('/loans/test')).rejects.toBe(error);
    expect(mock.shared.mock.calls[0][1]).toEqual({ readOnly: true, required: true });
  });
  it('never falls back to legacy requests when the required worker transport is absent', async () => {
    mock.shared.mockResolvedValue(null);
    await expect(ariveReadOnlySession()).rejects.toMatchObject({ code: 'DISABLED' });
  });
  it('passes provided diagnostic credentials explicitly instead of silently using a saved session', async () => {
    const provided = { clientId: 'test-client', secret: 'test-secret', apiKey: 'test-api' };
    mock.shared.mockResolvedValue(async () => ({})); await ariveSession(provided);
    expect(mock.shared.mock.calls[0][1]).toEqual({ provided });
  });
});
