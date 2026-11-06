import { beforeEach, describe, expect, it, vi } from 'vitest';
const { query } = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock('./prisma', () => ({ prisma: { $queryRaw: query } }));

const rows = ['overview', 'pipeline', 'tasks'].map(topic => ({ topic, version: BigInt(1) }));

describe('bounded portal marker reads', () => {
  beforeEach(() => { vi.resetModules(); query.mockReset(); vi.useRealTimers(); });

  it('coalesces requests and exposes only opaque topic revisions', async () => {
    let resolve!: (value: typeof rows) => void;
    query.mockReturnValue(new Promise(done => { resolve = done; }));
    const { getPortalRevisions } = await import('./portalRevisionQueries');
    const first = getPortalRevisions();
    const second = getPortalRevisions();
    expect(query).toHaveBeenCalledOnce();
    resolve(rows);
    const values = await first;
    expect(await second).toEqual(values);
    expect(await getPortalRevisions()).toEqual(values);
    expect(query).toHaveBeenCalledOnce();
    expect(Object.keys(values).sort()).toEqual(['overview', 'pipeline', 'tasks']);
    for (const value of Object.values(values)) expect(value).toMatch(/^[0-9a-f]{64}$/);
    expect(new Set(Object.values(values)).size).toBe(3);
  });

  it('refreshes after one second and changes only the modified topic marker', async () => {
    vi.useFakeTimers();
    query.mockResolvedValueOnce(rows).mockResolvedValue(rows.map(row => ({ ...row, version: row.topic === 'tasks' ? BigInt(2) : BigInt(1) })));
    const { getPortalRevisions } = await import('./portalRevisionQueries');
    const first = await getPortalRevisions();
    await vi.advanceTimersByTimeAsync(1001);
    const second = await getPortalRevisions();
    expect(second.tasks).not.toBe(first.tasks);
    expect(second.pipeline).toBe(first.pipeline);
    expect(second.overview).toBe(first.overview);
    expect(query).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });

  it('retries database failure and incomplete migration results without caching them', async () => {
    query.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(rows.slice(0, 2)).mockResolvedValue(rows);
    const { getPortalRevisions } = await import('./portalRevisionQueries');
    await expect(getPortalRevisions()).rejects.toThrow('offline');
    await expect(getPortalRevisions()).rejects.toThrow('not installed');
    await expect(getPortalRevisions()).resolves.toHaveProperty('tasks');
    expect(query).toHaveBeenCalledTimes(3);
  });
});
