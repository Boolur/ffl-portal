import { beforeEach, describe, expect, it, vi } from 'vitest';
import { UserRole } from '@prisma/client';

const mocks = vi.hoisted(() => ({ session: vi.fn(), requests: vi.fn(), summary: vi.fn() }));
vi.mock('next-auth', () => ({ getServerSession: mocks.session }));
vi.mock('@/lib/auth', () => ({ authOptions: {} }));
vi.mock('@/lib/dashboardQueries', () => ({ getRecentDashboardRequests: mocks.requests, getDashboardSummary: mocks.summary }));
import { loadDashboardSnapshot, loadRecentDashboardRequests } from './dashboardActions';

const cursor = { id: 'last-visible-request', createdAt: '2026-11-06T12:00:00.000Z' };

describe('dashboard request pagination authorization', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requests.mockResolvedValue({ items: [], nextCursor: null });
  });

  it('does not query requests for a signed-out user', async () => {
    mocks.session.mockResolvedValue(null);
    expect(await loadRecentDashboardRequests(cursor)).toEqual({ success: false, error: 'Please sign in again.' });
    expect(mocks.requests).not.toHaveBeenCalled();
  });

  it('uses the active role and session identity for every page', async () => {
    mocks.session.mockResolvedValue({ user: { id: 'current-user', role: UserRole.ADMIN, activeRole: UserRole.LOAN_OFFICER, name: 'Current LO' } });
    expect((await loadRecentDashboardRequests(cursor)).success).toBe(true);
    expect(mocks.requests).toHaveBeenCalledExactlyOnceWith({ id: 'current-user', role: UserRole.LOAN_OFFICER, name: 'Current LO' }, cursor);
  });

  it('rejects a role that cannot use the recent-request list', async () => {
    mocks.session.mockResolvedValue({ user: { id: 'current-user', role: UserRole.LOAN_OFFICER, activeRole: UserRole.PROCESSOR_JR } });
    expect(await loadRecentDashboardRequests(cursor)).toEqual({ success: false, error: 'Not authorized.' });
    expect(mocks.requests).not.toHaveBeenCalled();
  });

  it('keeps missing-name behavior consistent with the initial dashboard page', async () => {
    mocks.session.mockResolvedValue({ user: { id: 'current-user', role: UserRole.LOAN_OFFICER, name: null } });
    await loadRecentDashboardRequests(cursor);
    expect(mocks.requests).toHaveBeenCalledExactlyOnceWith({ id: 'current-user', role: UserRole.LOAN_OFFICER, name: 'User' }, cursor);
  });

  it('returns a retryable message without exposing database details', async () => {
    mocks.session.mockResolvedValue({ user: { id: 'current-user', role: UserRole.LOA } });
    mocks.requests.mockRejectedValue(new Error('private database detail'));
    expect(await loadRecentDashboardRequests(cursor)).toEqual({ success: false, error: 'Unable to load more requests. Please try again.' });
  });

  it('authenticates live summary reads without accepting a caller-supplied identity', async () => {
    mocks.session.mockResolvedValue({ user: { id: 'current-user', role: UserRole.ADMIN, activeRole: UserRole.LOAN_OFFICER, name: 'Current LO' } });
    mocks.summary.mockResolvedValue({ requests: { total: 3 } });
    const result = await loadDashboardSnapshot();
    expect(result).toMatchObject({ userId: 'current-user', role: UserRole.LOAN_OFFICER, summary: { requests: { total: 3 } } });
    expect(mocks.summary).toHaveBeenCalledExactlyOnceWith({ id: 'current-user', role: UserRole.LOAN_OFFICER, name: 'Current LO' });
  });

  it('does not load summary data for onboarding or signed-out sessions', async () => {
    mocks.session.mockResolvedValue({ user: { id: 'onboarding-user', role: UserRole.ONBOARDING } });
    await expect(loadDashboardSnapshot()).rejects.toThrow('Not authorized.');
    mocks.session.mockResolvedValue(null);
    await expect(loadDashboardSnapshot()).rejects.toThrow('Please sign in again.');
    expect(mocks.summary).not.toHaveBeenCalled();
    expect(mocks.requests).not.toHaveBeenCalled();
  });
});
