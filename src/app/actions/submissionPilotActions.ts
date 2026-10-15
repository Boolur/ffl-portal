'use server';

import { randomUUID } from 'crypto';
import { getServerSession } from 'next-auth';
import { Prisma, UserRole } from '@prisma/client';
import { revalidatePath } from 'next/cache';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { isAdmin } from '@/lib/adminTiers';
import { getSupabaseAdmin, getTaskAttachmentsBucket } from '@/lib/supabaseAdmin';
import { initialPilotPackage, readPilotPackage, pilotApprovalError, pilotSubmissionError, validatePilotFile, SUBMISSION_PILOT_LO_ID, type PilotPackage } from '@/lib/submissionPilot';

async function actor() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) throw new Error('Sign in to use the pilot.');
  const user = await prisma.user.findUnique({ where: { id: session.user.id }, select: { id: true, name: true, active: true, role: true, roles: true } });
  if (!user?.active) throw new Error('Account unavailable.');
  const role = (session.user.activeRole || session.user.role) as UserRole;
  if (role !== user.role && !user.roles.includes(role)) throw new Error('Role not available.');
  const reviewer = role === UserRole.PROCESSOR_JR || role === UserRole.PROCESSING_MANAGER || isAdmin(role);
  const owner = user.id === SUBMISSION_PILOT_LO_ID && role === UserRole.LOAN_OFFICER;
  if (!owner && !reviewer) throw new Error('This pilot is limited to Matt Mahjoub and the processing review team.');
  return { ...user, role, owner, reviewer };
}
type Actor = Awaited<ReturnType<typeof actor>>;
function checkReviewer(a: Actor, p: PilotPackage) {
  if (!a.reviewer || p.reviewerId !== a.id) throw new Error('Claim this review before making changes.');
}
async function taskAccess(id: string, a: Actor, db: Prisma.TransactionClient = prisma) {
  const task = await db.task.findUnique({ where: { id }, include: { loan: { select: { loanOfficerId: true, borrowerName: true, loanNumber: true } } } });
  const p = readPilotPackage(task?.submissionData);
  if (!task || task.kind !== null || task.title !== 'Processing submission pilot — documents' || !p || task.loan.loanOfficerId !== SUBMISSION_PILOT_LO_ID) throw new Error('Pilot package not found.');
  if (!a.owner && p.state === 'DRAFT') throw new Error('The LO has not submitted this package yet.');
  if (!a.owner && p.reviewerId && p.reviewerId !== a.id && !isAdmin(a.role) && a.role !== UserRole.PROCESSING_MANAGER) throw new Error('This review belongs to another processor.');
  return { task, p };
}
async function mutate(id: string, revision: number, a: Actor, edit: (p: PilotPackage) => string) {
  await prisma.$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`submission-pilot:${id}`}))`;
    const { task, p } = await taskAccess(id, a, tx);
    if (p.revision !== revision) throw new Error('This package changed. Refresh and try again.');
    const previousState = p.state;
    const message = edit(p);
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
      await tx.notification.createMany({ data: recipients.map(u => ({ userId: u.id, taskId: id, eventLabel: 'SUBMISSION_PILOT', title: 'Processing submission pilot', message: `${task.loan.borrowerName}: ${message}`, href: `/pipeline/submission-pilot?task=${id}` })) });
    }
  });
  revalidatePath('/pipeline/submission-pilot');
  revalidatePath('/tasks');
}
async function result<T>(work: () => Promise<T>) {
  try { return { success: true as const, data: await work() }; }
  catch (e) { return { success: false as const, error: e instanceof Error ? e.message : 'Unable to save. Please retry.' }; }
}
export async function getSubmissionPilot() {
  return result(async () => {
    const a = await actor();
    const tasks = await prisma.task.findMany({ where: { kind: null, title: 'Processing submission pilot — documents', loan: { loanOfficerId: SUBMISSION_PILOT_LO_ID }, submissionData: { path: ['submissionPilot', 'version'], equals: 1 } }, include: { loan: { select: { borrowerName: true, loanNumber: true } } }, orderBy: { updatedAt: 'desc' } });
    const visible = tasks.filter(t => { const p = readPilotPackage(t.submissionData)!; return a.owner || (p.state !== 'DRAFT' && (!p.reviewerId || p.reviewerId === a.id || isAdmin(a.role) || a.role === 'PROCESSING_MANAGER')); });
    const loans = a.owner ? await prisma.loan.findMany({ where: { loanOfficerId: a.id, processingPipeline: { is: { archivedAt: null, sheet: { in: ['PIPELINE', 'RESTRUCTURE'] } } } }, select: { id: true, borrowerName: true, loanNumber: true, processingPipeline: { select: { processingMethod: true, assignmentGroup: true } } }, orderBy: { borrowerName: 'asc' } }) : [];
    return { owner: a.owner, userId: a.id, loans, packages: visible.map(t => ({ id: t.id, loanId: t.loanId, borrower: t.loan.borrowerName, loanNumber: t.loan.loanNumber, package: readPilotPackage(t.submissionData)! })) };
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
export async function changeSubmissionPilot(input: { taskId: string; revision: number; action: 'WAIVER' | 'ADD' | 'REMOVE' | 'SUBMIT' | 'CLAIM' | 'REVIEW' | 'RETURN' | 'APPROVE' | 'CANCEL_UPLOAD'; itemId?: string; fileId?: string; text?: string; approved?: boolean }) {
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
          if (p.state !== 'REVIEW' || !item || (!item.files.length && !item.waiver.trim())) throw new Error('This item is not ready for review.');
          if (!input.approved && !text) throw new Error('Explain the correction the LO needs to make.');
          item.review = input.approved ? 'APPROVED' : 'CHANGES'; item.feedback = text;
          return `${input.approved ? 'Approved' : 'Requested correction for'} ${item.label}`;
        case 'RETURN':
          checkReviewer(a, p);
          if (p.state !== 'REVIEW' || !p.items.some(i => i.review === 'CHANGES')) throw new Error('Flag at least one item with a correction reason.');
          p.state = 'CHANGES'; return 'Returned package to LO for corrections';
        case 'APPROVE': {
          checkReviewer(a, p); const error = pilotApprovalError(p); if (error) throw new Error(error);
          p.state = 'APPROVED'; return 'Approved package — Arive transfer is not yet connected';
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
export async function finishPilotUpload(taskId: string, itemId: string) {
  return result(async () => {
    const a = await actor(); const { p } = await taskAccess(taskId, a);
    if (!a.owner) throw new Error('Only the LO can finalize uploads.');
    const pending = p.items.find(i => i.id === itemId)?.pending;
    if (!pending) throw new Error('No pending upload.');
    const { data, error } = await getSupabaseAdmin().storage.from(getTaskAttachmentsBucket()).info(pending.path);
    if (error || !data || Number(data.metadata?.size) !== pending.size || data.metadata?.mimetype !== pending.type) throw new Error('Uploaded file could not be verified. Cancel and retry.');
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
export async function downloadPilotFile(taskId: string, fileId: string) {
  return result(async () => {
    const a = await actor(); const { p } = await taskAccess(taskId, a);
    const file = p.items.flatMap(i => i.files).find(f => f.id === fileId);
    if (!file) throw new Error('Document not found.');
    const { data, error } = await getSupabaseAdmin().storage.from(getTaskAttachmentsBucket()).createSignedUrl(file.path, 300, { download: file.name });
    if (error || !data) throw new Error('Unable to open document.');
    return data.signedUrl;
  });
}
