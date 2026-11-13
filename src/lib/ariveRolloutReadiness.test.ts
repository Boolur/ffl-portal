import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mock = vi.hoisted(() => ({ budget: vi.fn() }));
vi.mock('server-only', () => ({}));
vi.mock('./prisma', () => ({ prisma: {} }));
vi.mock('./ariveClient', () => ({ AriveError: class AriveError extends Error {}, ariveReadOnlySession: vi.fn() }));
vi.mock('./ariveTransportPrisma', () => ({ isAriveBudgetReady: mock.budget }));
import { assertAriveRolloutReady } from './ariveRollout';

beforeEach(() => { vi.resetAllMocks(); vi.stubEnv('ARIVE_ROLLOUT_ENABLED', 'true'); vi.stubEnv('VERCEL_ENV', 'production'); });
afterEach(() => vi.unstubAllEnvs());

describe('queue-only cooldown readiness', () => {
  it('surfaces cooldown as a structured deferral for normal workers', async () => {
    const cooldownUntil = new Date('2099-01-01');
    mock.budget.mockResolvedValue({ ready: false, reason: 'Provider cooldown', cooldownUntil });
    await expect(assertAriveRolloutReady()).rejects.toMatchObject({ code: 'COOLDOWN', retryAt: cooldownUntil });
    expect(mock.budget).toHaveBeenCalledWith(undefined);
  });
  it('passes queue permission explicitly and returns the deadline for skipping the immediate attempt', async () => {
    const cooldownUntil = new Date('2099-01-01');
    mock.budget.mockResolvedValue({ ready: true, reason: null, cooldownUntil });
    expect(await assertAriveRolloutReady({}, { allowCooldown: true })).toEqual({ ready: true, reason: null, cooldownUntil });
    expect(mock.budget).toHaveBeenCalledWith({ allowCooldown: true });
  });
  it('does not bypass missing quota or deployment controls for a queue request', async () => {
    mock.budget.mockResolvedValue({ ready: false, reason: 'Confirm the branch allowance' });
    await expect(assertAriveRolloutReady({}, { allowCooldown: true })).rejects.toThrow('Confirm the branch allowance');
    mock.budget.mockClear(); vi.stubEnv('ARIVE_ROLLOUT_ENABLED', 'false');
    await expect(assertAriveRolloutReady({}, { allowCooldown: true })).rejects.toThrow('disabled');
    expect(mock.budget).not.toHaveBeenCalled();
  });
});
