'use server';

import { appendLifecycleHistoryEvent } from '@/lib/taskLifecycleTimeline';
import { randomUUID } from 'crypto';
import { assertStoredUpload } from '../../lib/storedUploadVerification';
import { getServerSession } from 'next-auth';
import { Prisma, UserRole } from '@prisma/client';
import { revalidatePath } from 'next/cache';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { isAdmin, isAdminIII } from '@/lib/adminTiers';
import { encryptAriveCredentials } from '@/lib/ariveCrypto';
import { ariveConfigured, ariveClassifications, ariveSession, findAriveLoan, readAriveNotes, validAriveUploadUrl, AriveError } from '@/lib/ariveClient';
import { getSupabaseAdmin, getTaskAttachmentsBucket } from '@/lib/supabaseAdmin';
import { initialPilotPackage, readPilotPackage, pilotApprovalError, pilotSubmissionError, validatePilotFile, SUBMISSION_PILOT_LO_ID, type PilotPackage } from '@/lib/submissionPilot';

async function actor() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) throw new Error('Sign in to use the pilot.');
  const user = await prisma.user.findUnique({ where: { id: session.user.id }, select: { id: true, name: true, email: true, active: true, role: true, roles: true } });
  if (!user?.active) throw new Error('Account unavailable.');
  const role = (session.user.activeRole || session.user.role) as UserRole;
  if (role !== user.role && !user.roles.includes(role)) throw new Error('Role not available.');
  const reviewer = role === UserRole.PROCESSOR_JR || role === UserRole.PROCESSING_MANAGER || role === UserRole.MANAGER || isAdmin(role);
  const owner = user.id === SUBMISSION_PILOT_LO_ID && role === UserRole.LOAN_OFFICER;
  if (!owner && !reviewer) throw new Error('This pilot is limited to Matt Mahjoub and the processing review team.');
  return { ...user, role, owner, reviewer };
}
type Actor = Awaited<ReturnType<typeof actor>>;
function checkReviewer(a: Actor, p: PilotPackage) {
  if (!a.reviewer || p.reviewerId !== a.id) throw new Error('Claim this review before making changes.');
}
async function taskAccess(id: string, a: Actor, db: Prisma.TransactionClient = prisma, linkedRequest?: { id: string; status: string; workflowState?: string; assignedUserId: string | null }) {
  const task = await db.task.findUnique({ where: { id }, include: { loan: { select: { loanOfficerId: true, borrowerName: true, loanNumber: true } } } });
  const p = readPilotPackage(task?.submissionData);
  if (!task || task.kind !== null || task.title !== 'Processing submission pilot — documents' || !p || task.loan.loanOfficerId !== SUBMISSION_PILOT_LO_ID) throw new Error('Pilot package not found.');
  const request = linkedRequest ?? await db.task.findFirst({ where: { loanId: task.loanId, kind: 'SUBMIT_PROCESSING', submissionData: { path: ['processingDocumentTaskId'], equals: id } }, select: { id: true, status: true, workflowState: true, assignedUserId: true } });
  // Older resubmissions updated only the documents. Keep those packages actionable until the task is returned too.
  if (a.owner && request?.workflowState === 'WAITING_ON_LO' && p.state === 'REVIEW') p.state = 'CHANGES';
  // The existing request's Start/reassign controls own the review assignment.
  if (request && request.status !== 'COMPLETED') p.reviewerId = !((request.status === 'IN_PROGRESS' && (!request.workflowState || request.workflowState === 'NONE')) || (request.status === 'PENDING' && request.workflowState === 'READY_TO_COMPLETE')) ? null : request.assignedUserId;
  if (!a.owner && p.state === 'DRAFT') throw new Error('The LO has not submitted this package yet.');
  if (!a.owner && p.reviewerId && p.reviewerId !== a.id && !isAdmin(a.role) && a.role !== UserRole.PROCESSING_MANAGER && a.role !== UserRole.MANAGER) throw new Error('This review belongs to another processor.');
  return { task, p, request };
}
async function mutate(id: string, revision: number, a: Actor, edit: (p: PilotPackage) => string) {
  await prisma.$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`submission-pilot:${id}`}))`;
    const { task, p, request } = await taskAccess(id, a, tx);
    if (a.reviewer && request && request.status !== 'COMPLETED' && (!((request.status === 'IN_PROGRESS' && (!request.workflowState || request.workflowState === 'NONE')) || (request.status === 'PENDING' && request.workflowState === 'READY_TO_COMPLETE')) || request.assignedUserId !== a.id)) throw new Error('Start the Processing request before reviewing its documents. Only its assigned reviewer can make changes.');
    if (p.revision !== revision) throw new Error('This package changed. Refresh and try again.');
    const previousState = p.state;
    const message = edit(p);
    // Return the real Processing task in the same transaction as its documents.
    if (a.owner && previousState === 'CHANGES' && p.state === 'REVIEW' && request) {
      const parent = await tx.task.findUnique({ where: { id: request.id } });
      if (!parent || parent.workflowState !== 'WAITING_ON_LO') throw new Error('This Processing request is no longer waiting for corrections. Refresh and try again.');
      const child = await tx.task.findFirst({ where: { parentTaskId: parent.id, kind: 'LO_NEEDS_INFO', status: { not: 'COMPLETED' } } });
      if (!child) throw new Error('The LO response task was not found. Refresh and try again.');
      const response = 'Corrected submission documents returned to Processing for review.';
      const prior = (parent.submissionData || {}) as Prisma.JsonObject;
      const notes = Array.isArray(prior.notesHistory) ? prior.notesHistory : [];
      const submissionData = appendLifecycleHistoryEvent({ ...prior, notesHistory: [...notes, { author: a.name, role: a.role, message: response, date: new Date().toISOString() }] }, {
        actorName: a.name, actorRole: a.role, eventType: 'LO_RESPONDED',
        fromStatus: parent.status, toStatus: 'PENDING', fromWorkflow: parent.workflowState,
        toWorkflow: 'READY_TO_COMPLETE', note: response,
      }) as Prisma.InputJsonObject;
      const moved = await tx.task.updateMany({ where: { id: parent.id, updatedAt: parent.updatedAt, workflowState: 'WAITING_ON_LO' }, data: { status: 'PENDING', workflowState: 'READY_TO_COMPLETE', submissionData } });
      const closed = await tx.task.updateMany({ where: { id: child.id, status: { not: 'COMPLETED' } }, data: { status: 'COMPLETED', completedAt: new Date(), submissionData } });
      if (moved.count !== 1 || closed.count !== 1) throw new Error('This response changed. Refresh and try again.');
      p.reviewerId = parent.assignedUserId;
    }
    p.revision++;
    p.history.push({ at: new Date().toISOString(), actor: a.name, message });
    const updated = await tx.task.updateMany({ where: { id, updatedAt: task.updatedAt }, data: {
      submissionData: { ...(task.submissionData as Prisma.JsonObject), submissionPilot: p as unknown as Prisma.InputJsonValue },
      status: p.state === 'APPROVED' ? 'COMPLETED' : p.state === 'REVIEW' ? 'IN_PROGRESS' : 'PENDING',
      assignedRole: p.state === 'REVIEW' ? 'PROCESSOR_JR' : 'LOAN_OFFICER',
      assignedUserId: p.state === 'REVIEW' ? p.reviewerId : SUBMISSION_PILOT_LO_ID,
      completedAt: p.state === 'APPROVED' ? new Date() : null,
    } });
    if (updated.count !== 1) throw new Error('This task changed. Refresh and try again.');
    await tx.auditLog.create({ data: { loanId: task.loanId, userId: a.id, action: 'SUBMISSION_PILOT_UPDATED', details: JSON.stringify({ taskId: id, revision: p.revision, message, state: p.state }) } });
    if (previousState !== p.state) {
      const recipients = p.state === 'REVIEW'
        ? p.reviewerId ? [{ id: p.reviewerId }] : await tx.user.findMany({ where: { active: true, OR: [{ role: 'PROCESSOR_JR' }, { roles: { has: 'PROCESSOR_JR' } }] }, select: { id: true } })
        : [{ id: SUBMISSION_PILOT_LO_ID }];
      await tx.notification.createMany({ data: recipients.map(u => ({ userId: u.id, taskId: request?.id || id, eventLabel: 'SUBMISSION_PILOT', title: 'Processing submission pilot', message: `${task.loan.borrowerName}: ${message}`, href: request ? '/tasks' : `/pipeline/submission-pilot?task=${id}` })) });
    }
  });
  revalidatePath('/pipeline/submission-pilot');
  revalidatePath('/tasks');
  revalidatePath('/');
}
async function result<T>(work: () => Promise<T>) {
  try { return { success: true as const, data: await work() }; }
  catch (e) { return { success: false as const, error: e instanceof Error ? e.message : 'Unable to save. Please retry.' }; }
}
export async function getSubmissionPilot(requestTaskId?: string) {
  return result(async () => {
    if (requestTaskId) {
      const [a, request, configured] = await Promise.all([
        actor(),
        prisma.task.findUnique({ where: { id: requestTaskId }, select: { id: true, kind: true, loanId: true, submissionData: true, status: true, workflowState: true, assignedUserId: true } }),
        ariveConfigured(),
      ]);
      const documentId = (request?.submissionData as { processingDocumentTaskId?: string } | null)?.processingDocumentTaskId;
      if (!request || !['SUBMIT_PROCESSING', 'LO_NEEDS_INFO'].includes(request.kind || '') || !documentId) throw new Error('Submission documents not found.');
      const { task, p } = await taskAccess(documentId, a, prisma, request.kind === 'SUBMIT_PROCESSING' ? request : undefined);
      if (task.loanId !== request.loanId) throw new Error('Submission documents do not match this loan.');
      return { owner: a.owner, canConfigureArive: false, ariveConfigured: configured, userId: a.id, loans: [], packages: [{ id: task.id, loanId: task.loanId, borrower: task.loan.borrowerName, loanNumber: task.loan.loanNumber, package: p }] };
    }
    const a = await actor();
    const tasks = await prisma.task.findMany({ where: { kind: null, title: 'Processing submission pilot — documents', loan: { loanOfficerId: SUBMISSION_PILOT_LO_ID }, submissionData: { path: ['submissionPilot', 'version'], equals: 1 } }, include: { loan: { select: { borrowerName: true, loanNumber: true } } }, orderBy: { updatedAt: 'desc' } });
    const visible = tasks.filter(t => { const p = readPilotPackage(t.submissionData)!; return a.owner || (p.state !== 'DRAFT' && (!p.reviewerId || p.reviewerId === a.id || isAdmin(a.role) || a.role === 'PROCESSING_MANAGER')); });
    const loans = a.owner ? await prisma.loan.findMany({ where: { loanOfficerId: a.id, processingPipeline: { is: { archivedAt: null, sheet: { in: ['PIPELINE', 'RESTRUCTURE'] } } } }, select: { id: true, borrowerName: true, loanNumber: true, processingPipeline: { select: { processingMethod: true, assignmentGroup: true } } }, orderBy: { borrowerName: 'asc' } }) : [];
    return { owner: a.owner, canConfigureArive: isAdminIII(a.role), ariveConfigured: await ariveConfigured(), userId: a.id, loans, packages: visible.map(t => ({ id: t.id, loanId: t.loanId, borrower: t.loan.borrowerName, loanNumber: t.loan.loanNumber, package: readPilotPackage(t.submissionData)! })) };
  });
}
export async function createSubmissionPilot(loanId: string) {
  return result(async () => {
    const a = await actor();
    if (!a.owner) throw new Error('Only Matt can start a pilot submission.');
    return prisma.$transaction(async tx => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`submission-pilot-loan:${loanId}`}))`;
      const loan = await tx.loan.findFirst({ where: { id: loanId, loanOfficerId: a.id, processingPipeline: { is: { archivedAt: null, sheet: { in: ['PIPELINE', 'RESTRUCTURE'] } } } }, select: { id: true } });
      if (!loan) throw new Error('Choose one of your active pipeline loans.');
      const existing = await tx.task.findFirst({ where: { loanId, kind: null, title: 'Processing submission pilot — documents', submissionData: { path: ['submissionPilot', 'version'], equals: 1 } }, select: { id: true } });
      if (existing) return existing.id;
      const task = await tx.task.create({ data: { loanId, title: 'Processing submission pilot — documents', assignedRole: 'LOAN_OFFICER', assignedUserId: a.id, submissionData: { submissionPilot: initialPilotPackage() as unknown as Prisma.InputJsonValue } } });
      return task.id;
    });
  });
}
export async function changeSubmissionPilot(input: { taskId: string; revision: number; action: 'WAIVER' | 'ADD' | 'REQUEST_DOCUMENT' | 'REMOVE' | 'SUBMIT' | 'CLAIM' | 'REVIEW' | 'RETURN' | 'APPROVE' | 'CANCEL_UPLOAD'; itemId?: string; fileId?: string; text?: string; approved?: boolean }) {
  return result(async () => {
    const a = await actor();
    await mutate(input.taskId, input.revision, a, p => {
      const item = p.items.find(i => i.id === input.itemId);
      const text = (input.text || '').trim();
      if (text.length > 2000) throw new Error('Keep notes under 2,000 characters.');
      if (['WAIVER', 'ADD', 'REMOVE', 'SUBMIT', 'CANCEL_UPLOAD'].includes(input.action)) {
        if (!a.owner || !['DRAFT', 'CHANGES'].includes(p.state)) throw new Error('Only the LO can edit a draft or returned package.');
      }
      switch (input.action) {
        case 'REQUEST_DOCUMENT':
          checkReviewer(a, p);
          if (p.state !== 'REVIEW' || !text || text.length > 150 || p.items.length >= 30) throw new Error('Enter a document request under 150 characters (maximum 30 categories).');
          p.items.push({ id: randomUUID(), label: text, required: false, files: [], waiver: '', review: 'CHANGES', feedback: `Please upload: ${text}` });
          return `Requested additional document: ${text}`;
        case 'ADD':
          if (!text || p.items.length >= 30) throw new Error('Enter a document label (maximum 30 categories).');
          p.items.push({ id: randomUUID(), label: text, required: false, files: [], waiver: '', review: 'PENDING', feedback: '' });
          return `Added additional document category: ${text}`;
        case 'WAIVER':
          if (!item || item.files.length || item.pending) throw new Error('Remove files before adding a not-applicable explanation.');
          item.waiver = text; item.review = 'PENDING'; return `Updated explanation for ${item.label}`;
        case 'REMOVE': {
          if (!item) throw new Error('Document category not found.');
          const file = item.files.find(f => f.id === input.fileId);
          if (!file) throw new Error('File not found.');
          p.retiredFiles = [...(p.retiredFiles || []), file];
          item.files = item.files.filter(f => f.id !== input.fileId); item.review = 'PENDING'; return `Removed ${file.name} from ${item.label}; retained in history`;
        }
        case 'CANCEL_UPLOAD':
          if (!item) throw new Error('Document category not found.');
          delete item.pending; return `Cancelled pending upload for ${item.label}`;
        case 'SUBMIT': {
          const error = pilotSubmissionError(p); if (error) throw new Error(error);
          p.state = 'REVIEW'; return 'Submitted documents for Jr Processor review';
        }
        case 'CLAIM':
          if (!a.reviewer || p.state !== 'REVIEW' || (p.reviewerId && p.reviewerId !== a.id)) throw new Error('This review is not available to claim.');
          p.reviewerId = a.id; return 'Claimed document review';
        case 'REVIEW':
          checkReviewer(a, p);
          if (p.state !== 'REVIEW' || !item || (input.approved && !item.files.length && !item.waiver.trim())) throw new Error('This item is not ready for review.');
          if (!input.approved && !text) throw new Error('Explain the correction the LO needs to make.');
          item.review = input.approved ? 'APPROVED' : 'CHANGES'; item.feedback = text;
          return `${input.approved ? 'Approved' : 'Requested correction for'} ${item.label}`;
        case 'RETURN':
          checkReviewer(a, p);
          if (p.state !== 'REVIEW' || !p.items.some(i => i.review === 'CHANGES')) throw new Error('Flag at least one item with a correction reason.');
          p.state = 'CHANGES'; return 'Returned package to LO for corrections';
        case 'APPROVE': {
          checkReviewer(a, p); const error = pilotApprovalError(p); if (error) throw new Error(error);
          p.state = 'APPROVED'; return 'Approved package — documents are ready for transfer to Arive';
        }
        default: throw new Error('Unknown action.');
      }
    });
  });
}
export async function preparePilotUpload(input: { taskId: string; revision: number; itemId: string; name: string; size: number; type: string }) {
  return result(async () => {
    const a = await actor(); validatePilotFile(input.name, input.size, input.type);
    const path = `submission-pilot/${input.taskId}/${randomUUID()}.${input.name.split('.').pop()!.toLowerCase()}`;
    await mutate(input.taskId, input.revision, a, p => {
      if (!a.owner || !['DRAFT', 'CHANGES'].includes(p.state)) throw new Error('Uploads are available to the LO in draft or returned packages.');
      const i = p.items.find(i => i.id === input.itemId);
      if (!i || i.pending || i.files.length >= 10) throw new Error('Finish the pending upload first; maximum 10 files per category.');
      i.pending = { path, name: input.name.slice(0, 200), size: input.size, type: input.type };
      return `Started upload for ${i.label}`;
    });
    const { data, error } = await getSupabaseAdmin().storage.from(getTaskAttachmentsBucket()).createSignedUploadUrl(path);
    if (error || !data) throw new Error('Upload could not start. Cancel the pending upload and retry.');
    return { signedUrl: data.signedUrl };
  });
}
// The modal stages files before creating the normal Processing request.
export async function prepareProcessingSubmissionUpload(input: { name: string; size: number; type: string }) {
  return result(async () => {
    const a = await actor();
    if (!a.owner) throw new Error('Document submission is limited to Matt’s Loan Officer account.');
    validatePilotFile(input.name, input.size, input.type);
    const path = `processing-submission/${a.id}/${randomUUID()}.${input.name.split('.').pop()!.toLowerCase()}`;
    const { data, error } = await getSupabaseAdmin().storage.from(getTaskAttachmentsBucket()).createSignedUploadUrl(path);
    if (error || !data) throw new Error('Unable to start the upload. Please retry.');
    return { signedUrl: data.signedUrl, file: { id: randomUUID(), path, ...input, uploadedAt: new Date().toISOString() } };
  });
}
export async function finishPilotUpload(taskId: string, itemId: string) {
  return result(async () => {
    const a = await actor(); const { p } = await taskAccess(taskId, a);
    if (!a.owner) throw new Error('Only the LO can finalize uploads.');
    const pending = p.items.find(i => i.id === itemId)?.pending;
    if (!pending) throw new Error('No pending upload.');
    const { data, error } = await getSupabaseAdmin().storage.from(getTaskAttachmentsBucket()).info(pending.path);
    assertStoredUpload({ data, error }, pending);
    await mutate(taskId, p.revision, a, latest => {
      if (!['DRAFT', 'CHANGES'].includes(latest.state)) throw new Error('Package is locked for review.');
      const i = latest.items.find(i => i.id === itemId)!;
      if (i.pending?.path !== pending.path) throw new Error('Upload changed. Refresh and retry.');
      i.files.push({ id: randomUUID(), ...pending, uploadedAt: new Date().toISOString() });
      i.waiver = ''; i.review = 'PENDING'; delete i.pending;
      return `Uploaded ${pending.name} for ${i.label}`;
    });
  });
}
export async function getPilotFileAccess(taskId: string, fileId: string, disposition: 'attachment' | 'inline' = 'inline') {
  return result(async () => {
    const a = await actor(); const { p } = await taskAccess(taskId, a);
    const file = p.items.flatMap(i => i.files).find(f => f.id === fileId);
    if (!file) throw new Error('Document not found.');
    const { data, error } = await getSupabaseAdmin().storage.from(getTaskAttachmentsBucket()).createSignedUrl(file.path, 300, disposition === 'inline' ? undefined : { download: file.name });
    if (error || !data) throw new Error('Unable to open document.');
    return { url: data.signedUrl, name: file.name, type: file.type, size: file.size };
  });
}

export async function downloadPilotFile(taskId: string, fileId: string, disposition: 'attachment' | 'inline' = 'attachment') {
  const access = await getPilotFileAccess(taskId, fileId, disposition);
  return access.success ? { success: true as const, data: access.data.url } : access;
}

export async function configurePilotArive(input: { clientId: string; secret: string; apiKey: string }) {
  return result(async () => {
    const a = await actor();
    if (!isAdminIII(a.role)) throw new Error('Only an Admin III can configure company API access.');
    const c = { clientId: input.clientId.trim(), secret: input.secret.trim(), apiKey: input.apiKey.trim() };
    if (Object.values(c).some(v => !v || v.length > 4096)) throw new Error('Enter all three company API credentials.');
    const encryptedCredentials = encryptAriveCredentials(JSON.stringify(c), process.env.NEXTAUTH_SECRET || '');
    await ariveClassifications(c);
    await prisma.$transaction(async tx => {
      await tx.ariveIntegrationConfig.upsert({ where: { id: 'company' }, create: { id: 'company', encryptedCredentials, updatedById: a.id }, update: { encryptedCredentials, updatedById: a.id } });
      await tx.auditLog.create({ data: { userId: a.id, action: 'ARIVE_CONNECTION_CONFIGURED', details: JSON.stringify({ companyDocumentAccessVerified: true }) } });
    });
  });
}

export async function openArivePilotLoan(loanNumber: string) {
  return result(async () => {
    const a = await actor();
    if (!a.owner) throw new Error('Open this loan from Matt’s Loan Officer account.');
    const number = loanNumber.trim();
    const remote = await findAriveLoan(number);
    if (!remote.loanOriginatorEmail || remote.loanOriginatorEmail.toLowerCase().trim() !== a.email.toLowerCase().trim()) throw new Error('The Arive loan must list Matt’s portal email as its Loan Originator before it can be opened in this pilot.');
    const primary = remote.loanBorrowers?.find(b => b.applicantType === 'Borrower');
    if (!primary?.firstName || !primary.lastName) throw new Error('The Arive loan needs a named primary borrower first.');
    return prisma.$transaction(async tx => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`arive-pilot-loan:${number}`}))`;
      let loan = await tx.loan.findUnique({ where: { loanNumber: number } });
      if (loan && loan.loanOfficerId !== a.id) throw new Error('That loan belongs to another portal Loan Officer.');
      if (!loan) loan = await tx.loan.create({ data: { loanNumber: number, loanOfficerId: a.id, borrowerName: `${primary.firstName} ${primary.lastName}`, borrowerFirstName: primary.firstName, borrowerLastName: primary.lastName, amount: typeof remote.baseLoanAmount === 'number' && Number.isFinite(remote.baseLoanAmount) ? remote.baseLoanAmount : 0 } });
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`submission-pilot-loan:${loan.id}`}))`;
      const existing = await tx.task.findFirst({ where: { loanId: loan.id, kind: null, title: 'Processing submission pilot — documents', submissionData: { path: ['submissionPilot', 'version'], equals: 1 } } });
      if (existing) {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`submission-pilot:${existing.id}`}))`;
        const fresh = await tx.task.findUniqueOrThrow({ where: { id: existing.id } });
        const p = readPilotPackage(fresh.submissionData)!;
        if (p.ariveLink && p.ariveLink.id !== remote.sysGUID) throw new Error('This package is already linked to a different Arive loan.');
        p.ariveLink = { id: remote.sysGUID, loanNumber: number }; p.revision++;
        await tx.task.update({ where: { id: fresh.id }, data: { submissionData: { ...(fresh.submissionData as Prisma.JsonObject), submissionPilot: p as unknown as Prisma.InputJsonValue } } });
        return fresh.id;
      }
      const p = initialPilotPackage(); p.ariveLink = { id: remote.sysGUID, loanNumber: number };
      p.history.push({ at: new Date().toISOString(), actor: a.name, message: `Linked Arive loan ${number}` });
      const task = await tx.task.create({ data: { loanId: loan.id, title: 'Processing submission pilot — documents', assignedRole: 'LOAN_OFFICER', assignedUserId: a.id, submissionData: { submissionPilot: p as unknown as Prisma.InputJsonValue } } });
      await tx.auditLog.create({ data: { loanId: loan.id, userId: a.id, action: 'ARIVE_PILOT_LOAN_LINKED', details: JSON.stringify({ loanNumber: number, taskId: task.id }) } });
      return task.id;
    });
  });
}

// Integration changes merge into the current package under the same lock used by review edits.
async function integrationUpdate(id: string, a: Actor, edit: (p: PilotPackage) => void) {
  await prisma.$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`submission-pilot:${id}`}))`;
    const { task, p } = await taskAccess(id, a, tx); edit(p); p.revision++;
    const updated = await tx.task.updateMany({ where: { id, updatedAt: task.updatedAt }, data: { submissionData: { ...(task.submissionData as Prisma.JsonObject), submissionPilot: p as unknown as Prisma.InputJsonValue } } });
    if (updated.count !== 1) throw new Error('The package changed. Refresh and retry.');
  });
}
export async function refreshPilotAriveNotes(taskId: string) {
  return result(async () => {
    const a = await actor(); const { p } = await taskAccess(taskId, a);
    if (!p.ariveLink) throw new Error('Open this Arive loan number in the pilot to link it first.');
    const started = new Date().toISOString();
    const notes = await readAriveNotes(p.ariveLink.id);
    await integrationUpdate(taskId, a, latest => {
      if (!latest.ariveNotes || latest.ariveNotes.syncedAt < started) latest.ariveNotes = { syncedAt: started, notes };
    });
  });
}
export async function getPilotAriveClassifications() {
  return result(async () => { await actor(); return ariveClassifications(); });
}
export async function sendPilotDocumentToArive(input: { taskId: string; fileId: string; classification: string }) {
  return result(async () => {
    const a = await actor(); const { p } = await taskAccess(input.taskId, a);
    if (!p.ariveLink || p.state !== 'APPROVED') throw new Error('Link the loan and have the Jr Processor approve the package first.');
    const file = p.items.flatMap(i => i.files).find(f => f.id === input.fileId);
    if (!file) throw new Error('Document not found.');
    const classifications = await ariveClassifications();
    if (input.classification && !classifications.some(c => c.name === input.classification)) throw new Error('Choose a current Arive classification.');
    const attemptId = randomUUID();
    await integrationUpdate(input.taskId, a, latest => {
      const previous = latest.ariveTransfers?.[file.id];
      if (previous && previous.state !== 'FAILED') throw new Error(previous.state === 'SENT' ? 'This file has already been sent.' : 'This transfer needs verification in Arive before another attempt.');
      latest.ariveTransfers = { ...latest.ariveTransfers, [file.id]: { state: 'SENDING', attemptId, at: new Date().toISOString() } };
    });
    let attaching = false;
    try {
      const { data: blob, error } = await getSupabaseAdmin().storage.from(getTaskAttachmentsBucket()).download(file.path);
      if (error || !blob || blob.size !== file.size) throw new AriveError('Unable to read the saved document.');
      const api = await ariveSession();
      const access = await api(`/loans/${encodeURIComponent(p.ariveLink.id)}/file-access?fileName=${encodeURIComponent(file.name)}`);
      if (typeof access.fileId !== 'string' || typeof access.fileUploadSignedUrl !== 'string') throw new AriveError('Arive did not return valid document upload access.');
      const destination = validAriveUploadUrl(access.fileUploadSignedUrl);
      const uploaded = await fetch(destination, { method: 'PUT', body: new Uint8Array(await blob.arrayBuffer()), headers: { 'Content-Type': file.type }, redirect: 'error', signal: AbortSignal.timeout(60000) });
      if (!uploaded.ok) throw new AriveError('Arive file storage rejected the upload.');
      attaching = true;
      // Omission makes the document private. An empty array would expose it to ALL borrowers.
      const attached = await api(`/loans/${encodeURIComponent(p.ariveLink.id)}/documents`, { fileId: access.fileId, documentName: file.name, ...(input.classification ? { classificationType: input.classification } : {}) });
      if (typeof attached.id !== 'number') throw new AriveError('Arive attachment confirmation was incomplete.');
      await integrationUpdate(input.taskId, a, latest => {
        if (latest.ariveTransfers?.[file.id]?.attemptId !== attemptId) throw new Error('Transfer changed unexpectedly.');
        latest.ariveTransfers[file.id] = { state: 'SENT', attemptId, at: new Date().toISOString(), documentId: attached.id };
        latest.history.push({ actor: a.name, at: new Date().toISOString(), message: `Sent ${file.name} to Arive; document ${attached.id}` });
      });
    } catch (e) {
      const message = attaching ? 'Arive may have attached this document. Verify it in Arive before retrying; automatic retry is blocked to prevent duplicates.' : e instanceof AriveError ? e.message : 'Document transfer failed before attachment. You can retry.';
      await integrationUpdate(input.taskId, a, latest => {
        if (latest.ariveTransfers?.[file.id]?.attemptId === attemptId && latest.ariveTransfers[file.id].state !== 'SENT') latest.ariveTransfers[file.id] = { state: attaching ? 'UNKNOWN' : 'FAILED', attemptId, at: new Date().toISOString(), error: message };
      });
      throw new Error(message);
    }
  });
}
