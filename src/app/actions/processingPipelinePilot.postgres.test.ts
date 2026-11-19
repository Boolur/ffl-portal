import { PrismaClient, UserRole } from '@prisma/client';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { pilotIdentityHash } from '../../lib/ariveLeadershipPilotIdentity';

// This opt-in acceptance test requires its own freshly initialized PostgreSQL
// database. The explicit loopback fixture URL is the only accepted connection.
const setup = vi.hoisted(() => {
  const url = process.env.PILOT_SQL_FIXTURE_URL;
  if (url && (new URL(url).hostname !== '127.0.0.1' || new URL(url).port !== '59183')) {
    throw new Error('Use the dedicated localhost:59183 Pilot test database.');
  }
  return { url, session: vi.fn() };
});
const db = new PrismaClient({ datasourceUrl: setup.url || 'postgresql://postgres@127.0.0.1:59183/postgres' });
vi.mock('next-auth', () => ({ getServerSession: setup.session }));
vi.mock('next/cache', () => ({ unstable_noStore: vi.fn() }));
vi.mock('@/lib/auth', () => ({ authOptions: {} }));
vi.mock('@/lib/prisma', () => ({
  get prisma() {
    return db;
  },
}));
vi.mock('@/lib/adminTiers', async () => import('../../lib/adminTiers'));
vi.mock('@/lib/currentPortalActor', async () => import('../../lib/currentPortalActor'));
vi.mock('@/lib/pilotLeadership', async () => import('../../lib/pilotLeadership'));
vi.mock('@/lib/loanOfficerVisibility', async () => import('../../lib/loanOfficerVisibility'));
vi.mock('@/lib/perf', async () => import('../../lib/perf'));
vi.mock('@/lib/processingPipeline', async () => import('../../lib/processingPipeline'));
vi.mock('@/lib/processingRouting', async () => import('../../lib/processingRouting'));
vi.mock('@/lib/processingBorrowerDetails', async () => import('../../lib/processingBorrowerDetails'));
vi.mock('@/lib/mortgageCalendar', async () => import('../../lib/mortgageCalendar'));
vi.mock('@/lib/leadPipelineSync', () => ({ syncLeadStatusForLoan: vi.fn() }));
vi.mock('@/lib/processingManagerNotifications', () => ({ notifyProcessingManagers: vi.fn() }));
import {
  acknowledgePilotRender,
  getProcessingAriveSnapshot,
  getProcessingAriveStageCounts,
  getProcessingBorrowerDetails,
  getProcessingPipeline,
  updateProcessingPipelineCell,
} from './processingPipelineActions';
import { getAllTasks } from './adminActions';
import { getTeamMembers, getMemberDetails } from './teamActions';

describe.skipIf(!setup.url)('isolated Pilot and Standard server actions against PostgreSQL', () => {
  afterAll(async () => {
    await db.$disconnect();
    vi.unstubAllEnvs();
  });

  it('projects a private funding while a Junior and LO work on the same canonical file, then fails closed on rotation', async () => {
    expect(await db.user.count(), 'The Pilot SQL fixture database must be empty').toBe(0);
    vi.stubEnv('PILOT_VIEW_ENABLED', 'true');
    vi.stubEnv('ARIVE_CANONICAL_APPLY_ENABLED', 'false');
    const login = (user: { id: string; role: UserRole }) =>
      setup.session.mockResolvedValue({ user: { ...user, activeRole: user.role } });
    const user = (name: string, role: UserRole, pilotViewEnabled = false) =>
      db.user.create({ data: { name, email: `${name}@example.test`, role, pilotViewEnabled } });
    const manager = await user('fixture-manager', 'MANAGER', true);
    const administrator = await user('fixture-admin', 'ADMIN_III');
    const junior = await user('fixture-junior', 'PROCESSOR_JR');
    const lo = await user('fixture-originator', 'LOAN_OFFICER');
    const loan = await db.loan.create({
      data: {
        loanNumber: '90000000',
        borrowerName: 'Fixture Borrower',
        borrowerFirstName: 'Fixture',
        borrowerLastName: 'Borrower',
        loanOfficerId: lo.id,
        amount: 240000,
      },
      include: { loanOfficer: true, secondaryLoanOfficer: true },
    });
    const task = await db.task.create({
      data: {
        loanId: loan.id,
        assignedUserId: junior.id,
        kind: 'SUBMIT_PROCESSING',
        title: 'Synthetic fixture',
        submissionData: {
          leadershipPilotTest: true,
          leadershipTestSubmitterId: manager.id,
          processingDocumentTaskId: 'internal-package',
        },
      },
    });
    await db.task.create({
      data: { loanId: loan.id, assignedUserId: junior.id, title: 'Processing submission pilot — documents' },
    });
    await db.auditLog.create({
      data: {
        loanId: loan.id,
        userId: manager.id,
        action: 'PROCESSING_ARIVE_SYNC_APPLIED',
        details: 'SOURCE_PAYLOAD_FIXTURE',
      },
    });
    const row = await db.processingPipelineLoan.create({
      data: {
        loanId: loan.id,
        sourceTaskId: task.id,
        juniorProcessorId: junior.id,
        processingMethod: 'SELF_PROCESSED',
      },
    });
    const connection = await db.ariveIntegrationConfig.create({
      data: { id: 'company', encryptedCredentials: 'fixture', updatedById: manager.id },
    });
    const collectedAt = new Date();
    const createdAt = new Date(collectedAt.getTime() - 6000);
    await db.pilotAriveProjection.create({
      data: {
        pipelineId: row.id,
        ariveLoanId: loan.loanNumber,
        ariveGuid: 'synthetic-guid',
        identityHash: pilotIdentityHash(loan),
        connectionRevision: connection.updatedAt,
        enrollmentStatus: 'VERIFIED',
        projectionVersion: 1,
        collectedAt,
        sourceStage: 'LOAN_FUNDED',
        sheet: 'FUNDING',
        pipelineStatus: 'FUNDED',
        snapshot: {
          managed: { sheet: 'FUNDING', pipelineStatus: 'FUNDED', titleStatus: 'RECEIVED' },
          source: { stage: 'LOAN_FUNDED', stageLabel: 'Loan funded' },
          canonicalLoan: { amount: '270000' },
          noteChangeEvidence: [{ noteId: 'new-note', parentNoteId: null, createdAt: createdAt.toISOString() }],
        },
        notes: [
          { id: 'new-note', author: 'Synthetic', text: 'Pending Items: fixture', createdAt: createdAt.toISOString() },
        ],
      },
    });
    login(manager);
    expect(await getProcessingPipeline()).toMatchObject({ success: true, rows: [], total: 0 });
    const projected = await getProcessingPipeline({
      sheet: 'FUNDING',
      filters: { ariveStages: ['LOAN_FUNDED'], titleStatuses: ['RECEIVED'] },
    });
    expect(projected).toMatchObject({
      success: true,
      canEdit: false,
      total: 1,
      rows: [{ id: row.id, sheet: 'FUNDING', loan: { amount: 270000 } }],
    });
    expect(await getProcessingAriveStageCounts({ sheet: 'FUNDING' })).toMatchObject({
      counts: [{ value: 'LOAN_FUNDED', count: 1 }],
    });
    expect(await getProcessingBorrowerDetails(row.id)).toMatchObject({
      details: { canEdit: false, processing: { sheet: 'FUNDING' } },
    });
    expect(await getProcessingAriveSnapshot(row.id)).toMatchObject({ success: true, notes: [{ id: 'new-note' }] });
    expect(
      await acknowledgePilotRender('NOTES', [{ id: row.id, version: 1, noteId: 'new-note', parentNoteId: null }]),
    ).toBe(true);
    expect(await db.pilotAriveRenderAck.findFirst()).toMatchObject({ pipelineId: row.id, sourceChangedAt: createdAt });
    expect(
      await updateProcessingPipelineCell({ id: row.id, version: row.version, field: 'titleStatus', value: 'ORDERED' }),
    ).toMatchObject({ success: false });

    for (const [staff, field] of [
      [junior, 'titleStatus'],
      [lo, 'payoffStatus'],
    ] as const) {
      login(staff);
      const current = await db.processingPipelineLoan.findUniqueOrThrow({ where: { id: row.id } });
      expect(await getProcessingPipeline()).toMatchObject({
        success: true,
        rows: [{ id: row.id, sheet: 'PIPELINE', ariveSync: null, loan: { amount: 240000 } }],
      });
      expect(await getProcessingAriveSnapshot(row.id)).toMatchObject({ success: false });
      const workspace = await getProcessingBorrowerDetails(row.id);
      expect(workspace).toMatchObject({
        success: true,
        details: {
          activity: expect.not.arrayContaining([expect.objectContaining({ action: 'PROCESSING_ARIVE_SYNC_APPLIED' })]),
        },
      });
      expect(JSON.stringify(workspace)).not.toMatch(
        /SOURCE_PAYLOAD_FIXTURE|leadershipPilotTest|leadershipTestSubmitterId|internal-package/,
      );
      expect(
        await updateProcessingPipelineCell({ id: row.id, version: current.version, field, value: 'ORDERED' }),
      ).toMatchObject({ success: true });
    }
    expect(await db.processingPipelineLoan.findUnique({ where: { id: row.id } })).toMatchObject({
      sheet: 'PIPELINE',
      titleStatus: 'ORDERED',
      payoffStatus: 'ORDERED',
    });
    expect(await db.notification.count()).toBe(0);
    expect(await getMemberDetails(junior.id)).toBeNull();
    const tasks = await getAllTasks();
    expect(tasks).toHaveLength(1);
    expect(JSON.stringify(tasks)).not.toMatch(/leadershipPilotTest|leadershipTestSubmitterId|internal-package/);
    expect(await getAllTasks({ role: 'ADMIN_III', userId: administrator.id })).toEqual([]);
    login(administrator);
    expect((await getTeamMembers()).find((item) => item.id === junior.id)?.taskCount).toBe(1);
    expect((await getMemberDetails(junior.id))?.tasks.map((item) => item.id)).toEqual([task.id]);
    login(manager);
    expect(await getProcessingPipeline({ sheet: 'FUNDING' })).toMatchObject({
      success: true,
      rows: [{ titleStatus: 'RECEIVED', payoffStatus: 'ORDERED' }],
    });
    await db.ariveIntegrationConfig.update({
      where: { id: 'company' },
      data: { encryptedCredentials: 'rotated-fixture' },
    });
    expect(await getProcessingPipeline({ sheet: 'FUNDING' })).toMatchObject({ success: true, total: 0 });
    expect(await getProcessingPipeline()).toMatchObject({
      success: true,
      rows: [{ id: row.id, ariveSync: { enabled: false, enrollmentStatus: 'REVIEW' } }],
    });
    expect(await getProcessingAriveSnapshot(row.id)).toMatchObject({ success: false });
  }, 30_000);
});
