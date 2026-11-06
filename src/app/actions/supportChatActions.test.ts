import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SupportConversationStatus, SupportDesk, UserRole } from '@prisma/client';

const mocks = vi.hoisted(() => ({
  session: vi.fn(), assignments: vi.fn(), conversations: vi.fn(), counts: vi.fn(),
}));
vi.mock('@/lib/prisma', () => ({ prisma: {
  supportDeskAssignment: { findMany: mocks.assignments },
  supportConversation: { findMany: mocks.conversations },
} }));
vi.mock('next-auth', () => ({ getServerSession: mocks.session }));
vi.mock('@/lib/auth', () => ({ authOptions: {} }));
vi.mock('@/lib/email', () => ({ sendEmail: vi.fn() }));
vi.mock('@/lib/emailPreferences', () => ({ filterEmailRecipientsByPreference: vi.fn() }));
vi.mock('@/lib/supabaseAdmin', () => ({ getSignedUrlExpirySeconds: vi.fn(), getSupabaseAdmin: vi.fn(), getSupportAttachmentsBucket: vi.fn() }));
vi.mock('@/lib/adminTiers', async () => import('../../lib/adminTiers'));
vi.mock('@/lib/supportChatRouting', () => ({ SUPPORT_DESK_LABELS: {}, resolveSupportDeskRouting: vi.fn() }));
vi.mock('@/lib/supportChatPilot', async () => import('../../lib/supportChatPilot'));
vi.mock('@/lib/supportUnreadCounts', () => ({ getSupportUnreadCounts: mocks.counts }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
import { getMySupportDeskAccess, getMySupportSummary } from './supportChatActions';

function session(role: UserRole, roles = [role]) {
  mocks.session.mockResolvedValue({ user: { id: 'viewer', name: 'Test Viewer', email: 'viewer@example.test', role, activeRole: role, roles } });
}

describe('lightweight support summaries', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.assignments.mockResolvedValue([]);
    mocks.conversations.mockResolvedValue([]);
    mocks.counts.mockImplementation(async (ids: string[]) => new Map(ids.map((id) => [id, 2])));
  });

  it('does not query support data before authentication', async () => {
    mocks.session.mockResolvedValue(null);
    expect((await getMySupportSummary()).success).toBe(false);
    expect(mocks.assignments).not.toHaveBeenCalled();
    expect(mocks.conversations).not.toHaveBeenCalled();
  });

  it('loads only requester conversation IDs for an LO, preserving latest-30 and resolved exclusions', async () => {
    session(UserRole.LOAN_OFFICER);
    mocks.conversations.mockResolvedValue([
      { id: 'open', status: SupportConversationStatus.OPEN },
      { id: 'resolved', status: SupportConversationStatus.RESOLVED },
    ]);
    expect(await getMySupportSummary()).toMatchObject({ success: true, hasAccess: false, unreadCount: 0, chatUnreadCount: 2 });
    expect(mocks.conversations).toHaveBeenCalledExactlyOnceWith({
      where: { requesterId: 'viewer', status: { not: SupportConversationStatus.ARCHIVED } },
      select: { id: true, status: true }, orderBy: { lastMessageAt: 'desc' }, take: 30,
    });
    expect(mocks.counts).toHaveBeenCalledExactlyOnceWith(['open'], 'viewer');
  });

  it('preserves assigned-user OR designated-desk staff scope and reads assignments once', async () => {
    session(UserRole.PROCESSOR_JR);
    mocks.assignments.mockResolvedValue([{ desk: SupportDesk.HELP }]);
    mocks.conversations.mockResolvedValue([{ id: 'staff-open', status: SupportConversationStatus.OPEN }]);
    expect(await getMySupportSummary()).toMatchObject({ hasAccess: true, unreadCount: 2, chatUnreadCount: 0 });
    expect(mocks.assignments).toHaveBeenCalledOnce();
    expect(mocks.conversations).toHaveBeenCalledExactlyOnceWith({
      where: { status: { notIn: [SupportConversationStatus.ARCHIVED, SupportConversationStatus.RESOLVED] }, OR: [{ assignedUserId: 'viewer' }, { desk: { in: [SupportDesk.HELP] } }] },
      select: { id: true, status: true }, take: 200,
    });
  });

  it('preserves elevated access from secondary roles without implying a desk designation', async () => {
    session(UserRole.PROCESSOR_JR, [UserRole.PROCESSOR_JR, UserRole.MANAGER]);
    expect(await getMySupportDeskAccess()).toMatchObject({ success: true, hasAccess: false });
    expect(mocks.assignments).toHaveBeenCalledOnce();
    expect(mocks.conversations.mock.calls[0][0].where).toEqual({ status: { notIn: [SupportConversationStatus.ARCHIVED, SupportConversationStatus.RESOLVED] } });
  });
});
