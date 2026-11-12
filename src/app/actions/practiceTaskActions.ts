'use server';
import { randomUUID } from 'crypto';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { authorizePracticeSource, getAuthorizedPracticeTask, getPilotActor, practiceResult } from '@/lib/pilotPracticeAccess';
import { applyPracticeCommand, PRACTICE_DRAFT_FIELDS, practiceInitialItems, readPracticeItems, validatePracticeDraft, type PracticeCommand, type PracticeItem } from '@/lib/pilotPractice';
import { processingDocumentTaskId, readPilotPackage, validatePilotFile } from '@/lib/submissionPilot';
import { sanitizeProcessingSubmissionData, safeSubmissionObject, splitBorrowerName } from '@/lib/processingBorrowerDetails';

type PracticeTask = Awaited<ReturnType<typeof getAuthorizedPracticeTask>>;
function publicTask(task: PracticeTask) {
  return {
    id: task.id, ownerId: task.ownerId, sourceTaskId: task.sourceTaskId, sourceLoanId: task.sourceLoanId,
    title: task.title, kind: task.kind, state: task.state, version: task.version, snapshot: task.snapshot, draft: validatePracticeDraft(task.draft),
    createdAt: task.createdAt.toISOString(), updatedAt: task.updatedAt.toISOString(),
    package: { id: task.package.id, items: readPracticeItems(task.package.items), files: task.package.files.map(file => ({ id: file.id, itemId: file.itemId, name: file.name, type: file.type, size: file.size, uploaded: file.uploaded, retired: file.retired, source: file.path ? 'PRACTICE_UPLOAD' as const : 'LIVE_REFERENCE' as const })) },
  };
}

export async function listPracticeTasks() {
  return practiceResult(async () => {
    const actor = await getPilotActor();
    // Personal listing only; admins can open another authorized copy by explicit ID.
    const rows = await prisma.pilotPracticeTask.findMany({ where: { ownerId: actor.id }, orderBy: { updatedAt: 'desc' }, take: 100 });
    const visible = [];
    for (const row of rows) {
      try { await authorizePracticeSource(actor, row); } catch { continue; }
      visible.push({ id: row.id, title: row.title, kind: row.kind, state: row.state, version: row.version, sourceTaskId: row.sourceTaskId, sourceLoanId: row.sourceLoanId, snapshot: row.snapshot, updatedAt: row.updatedAt.toISOString() });
    }
    return visible;
  });
}

export async function getPracticeTask(id: string) {
  return practiceResult(async () => {
    const actor = await getPilotActor();
    return prisma.$transaction(async tx => {
      const task = await getAuthorizedPracticeTask(id, actor, tx);
      const [events, notifications] = await Promise.all([
        tx.pilotPracticeEvent.findMany({ where: { taskId: id }, orderBy: { createdAt: 'desc' }, take: 500 }),
        tx.pilotPracticeNotification.findMany({ where: { taskId: id }, orderBy: { createdAt: 'desc' }, take: 100 }),
      ]);
      return { ...publicTask(task), events: events.reverse().map(event => ({ ...event, createdAt: event.createdAt.toISOString() })), simulatedNotifications: notifications.reverse().map(value => ({ ...value, createdAt: value.createdAt.toISOString() })) };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
  });
}

export async function createPracticeTask(input: { sourceTaskId?: string; sourceLoanId?: string; title?: string; draft?: unknown }) {
  return practiceResult(async () => {
    const actor = await getPilotActor();
    if (!input || (input.sourceTaskId && input.sourceLoanId) || [input.sourceTaskId, input.sourceLoanId].some(value => value !== undefined && (typeof value !== 'string' || !value || value.length > 100))) throw new Error('Choose one existing task or loan for the practice copy.');
    if (input.title !== undefined && (typeof input.title !== 'string' || !input.title.trim() || input.title.length > 200)) throw new Error('Enter a practice title under 200 characters.');
    return prisma.$transaction(async tx => {
      const source = await authorizePracticeSource(actor, { sourceTaskId: input.sourceTaskId || null, sourceLoanId: input.sourceLoanId || null }, tx);
      const kind = source?.task?.kind || 'SUBMIT_PROCESSING';
      let items: PracticeItem[] = ['SUBMIT_PROCESSING', 'SUBMIT_QC'].includes(kind) ? practiceInitialItems() : [{ id: 'documents', label: 'Requested documents', required: true, waiver: '', review: 'PENDING', feedback: '' }];
      const files: Prisma.PilotPracticeFileCreateWithoutPackageInput[] = [];
      if (source?.task) {
        const documentId = processingDocumentTaskId(source.task.submissionData);
        if (documentId) {
          const documentTask = await tx.task.findUnique({ where: { id: documentId } });
          const pkg = readPilotPackage(documentTask?.submissionData);
          if (!documentTask || documentTask.loanId !== source.loan.id || !pkg) throw new Error('The source document package is unavailable.');
          items = pkg.items.map(item => ({ id: item.id, label: item.label, required: item.required, waiver: item.waiver, review: 'PENDING', feedback: '' }));
          for (const item of pkg.items) for (const file of item.files) {
            validatePilotFile(file.name, file.size, file.type);
            files.push({ id: randomUUID(), itemId: item.id, name: file.name, type: file.type, size: file.size, uploaded: true, sourceDocumentTaskId: documentId, sourceDocumentFileId: file.id });
          }
        }
        const attachments = await tx.taskAttachment.findMany({ where: { taskId: source.task.id }, orderBy: { createdAt: 'asc' } });
        for (const file of attachments) {
          // Existing unsupported attachment types remain in live work; practice supports the upload allowlist only.
          try { validatePilotFile(file.filename, file.sizeBytes, file.contentType); } catch { continue; }
          const itemId = `source-${file.id}`;
          if (items.length >= 30) throw new Error('This task has too many document categories for a practice copy.');
          items.push({ id: itemId, label: file.filename.slice(0, 150), required: false, waiver: '', review: 'PENDING', feedback: '' });
          files.push({ id: randomUUID(), itemId, name: file.filename, type: file.contentType, size: file.sizeBytes, uploaded: true, sourceAttachmentId: file.id });
        }
      }
      readPracticeItems(items);
      if (files.length > 300 || files.reduce((sum, file) => sum + file.size, 0) > 200 * 1024 * 1024) throw new Error('A practice copy supports up to 300 documents and 200 MB.');
      const data = safeSubmissionObject(sanitizeProcessingSubmissionData(source?.task?.submissionData));
      const submissionDetails = Object.fromEntries(Object.entries(data).filter(([key, value]) => !/password|secret|token|storage|attachment|processingDocumentTaskId|submissionPilot/i.test(key) && (value === null || ['string', 'number', 'boolean'].includes(typeof value))));
      const borrower = splitBorrowerName(source?.loan.borrowerName);
      const sourceDraft = source ? {
        borrowerFirstName: borrower.firstName, borrowerLastName: borrower.lastName,
        borrowerPhone: source.loan.borrowerPhone || '', borrowerEmail: source.loan.borrowerEmail || '', arriveLoanNumber: source.loan.loanNumber,
        loanAmount: source.loan.amount?.toString() || '', loanProgram: source.loan.program || '',
        ...Object.fromEntries(Object.entries(submissionDetails).filter(([key, value]) => (PRACTICE_DRAFT_FIELDS as readonly string[]).includes(key) && typeof value === 'string')),
      } : {};
      const draft = validatePracticeDraft(input.draft === undefined ? sourceDraft : input.draft);
      const snapshot = {
        borrowerName: source?.loan.borrowerName || 'Practice borrower', loanNumber: source?.loan.loanNumber || null,
        sourceStatus: source?.task?.status || null, sourceWorkflowState: source?.task?.workflowState || null,
        capturedAt: new Date().toISOString(), sourceUpdatedAt: source?.task?.updatedAt?.toISOString() || null,
        sourceLoanUpdatedAt: source?.loan.updatedAt?.toISOString() || null, sourcePipelineId: source?.pipeline?.id || null, sourcePipelineVersion: source?.pipeline?.version ?? null,
        loan: source ? { amount: source.loan.amount?.toString() || null, program: source.loan.program || null, propertyAddress: source.loan.propertyAddress || null, borrowerPhone: source.loan.borrowerPhone || null, borrowerEmail: source.loan.borrowerEmail || null } : null,
        pipeline: source?.pipeline ? { ...source.pipeline, updatedAt: source.pipeline.updatedAt.toISOString() } : null,
        submissionDetails,
      } as Prisma.InputJsonObject;
      const task = await tx.pilotPracticeTask.create({ data: {
        ownerId: actor.id, sourceTaskId: source?.task?.id || null, sourceLoanId: source?.loan.id || null,
        title: input.title?.trim() || source?.task?.title || 'Practice processing submission', kind, snapshot, draft: draft as Prisma.InputJsonObject,
        package: { create: { items: items as unknown as Prisma.InputJsonValue, files: { create: files } } },
        events: { create: { actorId: actor.id, persona: 'LO', action: 'CREATE', message: source ? 'Created a separate practice copy. The original task and loan are unchanged.' : 'Created a synthetic practice submission.' } },
      }, include: { package: { include: { files: true } } } });
      return publicTask(task as PracticeTask);
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  });
}

export async function savePracticeSubmission(input: { id: string; version: number; persona: 'LO'; draft: unknown }) {
  return practiceResult(async () => {
    const actor = await getPilotActor();
    const draft = validatePracticeDraft(input.draft);
    if (input.persona !== 'LO' || !Number.isInteger(input.version)) throw new Error('Use the Loan Officer practice view to edit this draft.');
    return prisma.$transaction(async tx => {
      const task = await getAuthorizedPracticeTask(input.id, actor, tx);
      if (task.version !== input.version) throw new Error('This practice task changed. Refresh and try again.');
      if (!['DRAFT', 'CHANGES'].includes(task.state)) throw new Error('This practice submission is locked for review.');
      const changed = await tx.pilotPracticeTask.updateMany({ where: { id: task.id, version: input.version }, data: { draft: draft as Prisma.InputJsonObject, version: { increment: 1 } } });
      if (changed.count !== 1) throw new Error('This practice task changed. Refresh and try again.');
      await tx.pilotPracticeEvent.create({ data: { taskId: task.id, actorId: actor.id, persona: 'LO', action: 'SAVE_DRAFT', message: 'Updated simulated submission details. Original source information is unchanged.' } });
      return { id: task.id, version: input.version + 1 };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  });
}

export async function changePracticeTask(input: { id: string; version: number } & PracticeCommand) {
  return practiceResult(async () => {
    const actor = await getPilotActor();
    if (!Number.isInteger(input.version) || input.version < 0) throw new Error('Refresh this practice task and try again.');
    return prisma.$transaction(async tx => {
      const task = await getAuthorizedPracticeTask(input.id, actor, tx);
      if (task.version !== input.version) throw new Error('This practice task changed. Refresh and try again.');
      const result = applyPracticeCommand(task.state, readPracticeItems(task.package.items), task.package.files, input, randomUUID());
      const changed = await tx.pilotPracticeTask.updateMany({ where: { id: task.id, version: input.version }, data: { state: result.state, version: { increment: 1 } } });
      if (changed.count !== 1) throw new Error('This practice task changed. Refresh and try again.');
      await tx.pilotPracticePackage.update({ where: { id: task.package.id }, data: { items: result.items as unknown as Prisma.InputJsonValue } });
      if (result.retiredFileId) await tx.pilotPracticeFile.update({ where: { id: result.retiredFileId }, data: { retired: true } });
      await tx.pilotPracticeEvent.create({ data: { taskId: task.id, actorId: actor.id, persona: input.persona, action: input.action, message: result.message } });
      if (result.simulatedRecipient) await tx.pilotPracticeNotification.create({ data: { taskId: task.id, persona: result.simulatedRecipient, message: result.message } });
      return { id: task.id, version: input.version + 1, state: result.state };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  });
}
