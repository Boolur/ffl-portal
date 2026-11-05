'use server';

import { createHash } from 'node:crypto';
import { getServerSession } from 'next-auth';
import type { UserRole } from '@prisma/client';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { isAdminIII } from '@/lib/adminTiers';
import { SUBMISSION_PILOT_LO_ID } from '@/lib/submissionPilot';
import { AriveError, ariveSession } from '@/lib/ariveClient';
import {
  ARIVE_STATUS_TEST_LOAN_NUMBER, AriveStatusTestError, ariveTestHistoryPreserved,
  buildAriveTestStageUpdate, canChangeAriveTestStage, parseAriveTestLoanStatus,
  type AriveTestLoanStatus, type AriveTestStatusSnapshot,
} from '@/lib/ariveStatusTest';

type Result<T> = { success: true; data: T } | { success: false; error: string; requiresRefresh: true };
const READ = 'ARIVE_TEST_STAGE_READ';
const REQUESTED = 'ARIVE_TEST_STAGE_REQUESTED';
const VERIFIED = 'ARIVE_TEST_STAGE_VERIFIED';
const UNCERTAIN = 'ARIVE_TEST_STAGE_UNCERTAIN';
const RECEIPT_LIFETIME_MS = 5 * 60_000;
// A write has two 25-second network calls. Keep crashed/unfinished attempts
// blocked for longer than those calls, then require a new explicit read.
const UNFINISHED_ATTEMPT_MS = 5 * 60_000;

async function testContext() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) throw new AriveStatusTestError('Sign in as a portal Admin III to test Arive stages.');
  const user = await prisma.user.findUnique({ where: { id: session.user.id }, select: { active: true, role: true, roles: true } });
  const role = (session.user.activeRole || session.user.role) as UserRole;
  if (!user?.active || (role !== user.role && !user.roles.includes(role)) || !isAdminIII(role)) throw new AriveStatusTestError('Only an active portal Admin III can test Arive stages.');
  const loan = await prisma.loan.findUnique({
    where: { loanNumber: ARIVE_STATUS_TEST_LOAN_NUMBER },
    select: { id: true, loanOfficerId: true, borrowerName: true, loanOfficer: { select: { active: true, email: true } } },
  });
  if (!loan || loan.loanOfficerId !== SUBMISSION_PILOT_LO_ID || loan.borrowerName.trim().replace(/\s+/g, ' ').toUpperCase() !== 'TESTING TESTER' || !loan.loanOfficer.active || !loan.loanOfficer.email.trim()) {
    throw new AriveStatusTestError('Restore the TESTING TESTER portal loan for Matt before testing stages.');
  }
  return { userId: session.user.id, loanId: loan.id, email: loan.loanOfficer.email };
}

async function remoteStatus(api: Awaited<ReturnType<typeof ariveSession>>, email: string) {
  const search = await api(`/loans?searchField=DISPLAY_ID&searchValue=${ARIVE_STATUS_TEST_LOAN_NUMBER}&limit=100&offset=0`);
  const matches = Array.isArray(search.rows) ? search.rows.filter((row: { ariveLoanId?: unknown }) => String(row.ariveLoanId) === ARIVE_STATUS_TEST_LOAN_NUMBER) : [];
  if (matches.length !== 1 || typeof matches[0].sysGUID !== 'string') throw new AriveStatusTestError('Arive did not return one exact match for the test loan.');
  const path = `/loans/${encodeURIComponent(matches[0].sysGUID)}`;
  const status = parseAriveTestLoanStatus(await api(path), email);
  if (status.id !== matches[0].sysGUID) throw new AriveStatusTestError('Arive returned inconsistent test-loan identifiers. No update was sent.');
  return { path, status };
}
function fingerprint(status: AriveTestLoanStatus): string {
  return createHash('sha256').update(JSON.stringify(status)).digest('hex');
}
function snapshot(status: AriveTestLoanStatus, readId = ''): AriveTestStatusSnapshot {
  return { readId, stage: status.stage, date: status.date, historyCount: status.history.length, checkedAt: new Date().toISOString(), canChange: canChangeAriveTestStage(status) };
}
function failure(error: unknown): Result<never> {
  return { success: false, requiresRefresh: true, error: error instanceof AriveStatusTestError || error instanceof AriveError ? error.message : 'Unable to finish the Arive stage test. Read the current stage before trying again.' };
}

export async function readAriveTestStatus(): Promise<Result<AriveTestStatusSnapshot>> {
  try {
    const context = await testContext();
    const api = await ariveSession();
    const { status } = await remoteStatus(api, context.email);
    const read = await prisma.auditLog.create({ data: {
      loanId: context.loanId, userId: context.userId, action: READ,
      details: JSON.stringify({ fingerprint: fingerprint(status), stage: status.stage }),
    } });
    return { success: true, data: snapshot(status, read.id) };
  } catch (error) { return failure(error); }
}

export async function updateAriveTestStatus(input: { readId: string; expected: string; target: string }): Promise<Result<AriveTestStatusSnapshot>> {
  try {
    const context = await testContext();
    if (!input || typeof input.readId !== 'string' || !/^[a-zA-Z0-9-]{1,100}$/.test(input.readId) || typeof input.expected !== 'string' || typeof input.target !== 'string') throw new AriveStatusTestError('Read the current Arive stage before choosing a change.');
    const api = await ariveSession();
    const { path, status: before } = await remoteStatus(api, context.email);
    const body = buildAriveTestStageUpdate(before, input.expected, input.target, new Date().toISOString().slice(0, 10));
    const attempt = await prisma.$transaction(async tx => {
      // Claim one attempt without holding a database transaction over network IO.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`arive-test-stage:${context.loanId}`}))`;
      const read = await tx.auditLog.findFirst({ where: { id: input.readId, loanId: context.loanId, userId: context.userId, action: READ } });
      const latest = await tx.auditLog.findFirst({ where: { loanId: context.loanId, action: { in: [REQUESTED, VERIFIED, UNCERTAIN] } }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }] });
      const now = Date.now();
      if (!read || now - read.createdAt.getTime() > RECEIPT_LIFETIME_MS || read.createdAt.getTime() > now) throw new AriveStatusTestError('Your stage read expired. Read the current Arive stage again.');
      let saved: { fingerprint?: unknown; stage?: unknown };
      try { saved = JSON.parse(read.details || '{}'); } catch { throw new AriveStatusTestError('Read the current Arive stage again.'); }
      if (!saved || saved.fingerprint !== fingerprint(before) || saved.stage !== input.expected) throw new AriveStatusTestError('The Arive stage or history changed. Read it again before updating.');
      if (latest && read.createdAt.getTime() <= latest.createdAt.getTime()) throw new AriveStatusTestError('That stage read has already been used. Read the current Arive stage again.');
      if (latest?.action === REQUESTED && (now - latest.createdAt.getTime() < UNFINISHED_ATTEMPT_MS || read.createdAt.getTime() <= latest.createdAt.getTime() + UNFINISHED_ATTEMPT_MS)) throw new AriveStatusTestError('A stage change is still being verified. Wait five minutes, then read the current Arive stage before another change.');
      return tx.auditLog.create({ data: { loanId: context.loanId, userId: context.userId, action: REQUESTED, details: JSON.stringify({ readId: input.readId, from: before.stage, target: input.target, previousStages: before.history }) } });
    });

    let acknowledged = false;
    let requestError = '';
    try { await api(`${path}?sync=true`, body, 'PATCH'); acknowledged = true; }
    catch (error) { requestError = error instanceof AriveError ? error.message : 'Arive did not acknowledge the stage update.'; }
    let after: AriveTestLoanStatus | null = null;
    try {
      after = parseAriveTestLoanStatus(await api(path), context.email);
      if (after.id !== before.id) after = null;
    } catch { /* Never resend a write after an ambiguous response. */ }
    const preserved = after !== null && ariveTestHistoryPreserved(before, after);
    const verified = after !== null && after.stage === input.target && preserved;
    await prisma.auditLog.create({ data: { loanId: context.loanId, userId: context.userId, action: verified ? VERIFIED : UNCERTAIN, details: JSON.stringify({
      attemptId: attempt.id, from: before.stage, target: input.target, acknowledged,
      observedStage: after?.stage ?? null, historyPreserved: preserved, ...(requestError ? { error: requestError } : {}),
    }) } });
    if (!verified || !after) {
      const observed = after ? `Readback stage: ${after.stage}. ${preserved ? 'Existing history was preserved.' : 'Existing history could not be verified.'}` : 'Arive readback was unavailable or did not confirm the test-loan identity.';
      throw new AriveStatusTestError(`${requestError ? `${requestError} ` : ''}${observed} The requested stage and preserved history were not both confirmed. Inspect Arive and read its current stage before another change. No automatic retry was sent.`);
    }
    return { success: true, data: snapshot(after) };
  } catch (error) { return failure(error); }
}
