'use server';
import { createHash, randomUUID } from 'crypto';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { assertStoredUpload } from '@/lib/storedUploadVerification';
import { getAuthorizedPracticeTask, getPilotActor, practiceResult } from '@/lib/pilotPracticeAccess';
import { assertPracticeUploadPath, readPracticeItems } from '@/lib/pilotPractice';
import { practiceAttachmentsBucket, resolvePracticeFile, signPracticeFile } from '@/lib/pilotPracticeFileAccess';
import { validatePilotFile } from '@/lib/submissionPilot';
import { selectPracticeDocuments } from '@/lib/pilotPracticeDocuments';
import type { SubmissionDocumentDownloadManifest } from '@/lib/submissionDocumentDownload';

export async function preparePracticeUpload(input: { id: string; version: number; itemId: string; name: string; type: string; size: number }) {
  return practiceResult(async () => {
    const actor = await getPilotActor();
    validatePilotFile(input.name, input.size, input.type);
    return prisma.$transaction(async tx => {
      const task = await getAuthorizedPracticeTask(input.id, actor, tx);
      if (!Number.isInteger(input.version) || task.version !== input.version) throw new Error('This practice task changed. Refresh and try again.');
      const items = readPracticeItems(task.package.items);
      if (!['DRAFT', 'CHANGES'].includes(task.state) || !items.some(item => item.id === input.itemId)) throw new Error('Practice uploads are available in a draft or returned task.');
      const active = task.package.files.filter(file => !file.retired);
      if (active.filter(file => file.itemId === input.itemId).length >= 10 || active.length >= 300 || active.reduce((total, file) => total + file.size, input.size) > 200 * 1024 * 1024) throw new Error('Use no more than 10 files per category, 300 files total, and 200 MB per practice task.');
      const fileId = randomUUID();
      const path = `pilot-practice/${task.ownerId}/${task.id}/${fileId}.${input.name.split('.').pop()!.toLowerCase()}`;
      const storage = getSupabaseAdmin().storage;
      const bucket = practiceAttachmentsBucket();
      const info = await storage.getBucket(bucket).catch(() => null);
      if (!info?.data || info.error || info.data.public) throw new Error('Private practice document storage is unavailable.');
      const signed = await storage.from(bucket).createSignedUploadUrl(path).catch(() => null);
      if (!signed?.data?.signedUrl || signed.error) throw new Error('Unable to prepare the practice upload. Please try again.');
      const changed = await tx.pilotPracticeTask.updateMany({ where: { id: task.id, version: input.version }, data: { version: { increment: 1 } } });
      if (changed.count !== 1) throw new Error('This practice task changed. Refresh and try again.');
      await tx.pilotPracticeFile.create({ data: { id: fileId, packageId: task.package.id, itemId: input.itemId, name: input.name, type: input.type, size: input.size, path } });
      await tx.pilotPracticeEvent.create({ data: { taskId: task.id, actorId: actor.id, persona: 'LO', action: 'PREPARE_UPLOAD', message: `Prepared practice upload: ${input.name}` } });
      return { id: task.id, version: input.version + 1, fileId, signedUrl: signed.data.signedUrl, path, token: signed.data.token };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  });
}

export async function finalizePracticeUpload(input: { id: string; version: number; fileId: string }) {
  return practiceResult(async () => {
    const actor = await getPilotActor();
    return prisma.$transaction(async tx => {
      const task = await getAuthorizedPracticeTask(input.id, actor, tx);
      if (!Number.isInteger(input.version) || task.version !== input.version) throw new Error('This practice task changed. Refresh and try again.');
      const file = task.package.files.find(value => value.id === input.fileId && !value.uploaded && !value.retired && value.path);
      const items = readPracticeItems(task.package.items);
      const item = file && items.find(value => value.id === file.itemId);
      if (!file?.path || !item || !['DRAFT', 'CHANGES'].includes(task.state)) throw new Error('This practice upload is no longer available.');
      assertPracticeUploadPath(file.path, task.ownerId, task.id, file);
      const info = await getSupabaseAdmin().storage.from(practiceAttachmentsBucket()).info(file.path).catch(() => null);
      if (!info) throw new Error('Unable to verify practice storage. Keep the uploaded file and try again.');
      assertStoredUpload(info, file);
      const changed = await tx.pilotPracticeTask.updateMany({ where: { id: task.id, version: input.version }, data: { version: { increment: 1 } } });
      if (changed.count !== 1) throw new Error('This practice task changed. Refresh and try again.');
      item.waiver = ''; item.review = 'PENDING';
      await tx.pilotPracticePackage.update({ where: { id: task.package.id }, data: { items: items as unknown as Prisma.InputJsonValue } });
      await tx.pilotPracticeFile.update({ where: { id: file.id }, data: { uploaded: true } });
      await tx.pilotPracticeEvent.create({ data: { taskId: task.id, actorId: actor.id, persona: 'LO', action: 'UPLOAD', message: `Uploaded ${file.name} to practice only.` } });
      return { id: task.id, version: input.version + 1, fileId: file.id };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  });
}

export async function getPracticeFileAccess(id: string, fileId: string) {
  return practiceResult(async () => {
    const actor = await getPilotActor();
    const task = await getAuthorizedPracticeTask(id, actor);
    return signPracticeFile(await resolvePracticeFile(task, fileId, actor));
  });
}

async function approvedSelection(id: string) {
  const actor = await getPilotActor();
  const task = await getAuthorizedPracticeTask(id, actor);
  const selection = selectPracticeDocuments(readPracticeItems(task.package.items), task.package.files);
  const references = [];
  for (const file of selection.files) references.push(await resolvePracticeFile(task, file.id, actor));
  const selectionKey = createHash('sha256').update(JSON.stringify({ id, ownerId: task.ownerId, selection, sources: references.map(value => ({ path: value.path, bucket: value.bucket })) })).digest('hex');
  return { task, selection, references, selectionKey };
}
export async function preparePracticeDocumentDownload(id: string, version: number) {
  return practiceResult(async (): Promise<SubmissionDocumentDownloadManifest> => {
    const current = await approvedSelection(id);
    if (!Number.isInteger(version) || current.task.version !== version) throw new Error('This practice task changed. Refresh its documents and try again.');
    const files: SubmissionDocumentDownloadManifest['files'] = [];
    for (let index = 0; index < current.selection.files.length; index++) {
      const file = current.selection.files[index];
      const access = await signPracticeFile(current.references[index]);
      files.push({ id: file.id, name: file.name, type: file.type, size: file.size, archivePath: file.archivePath, url: access.url });
    }
    return { filename: current.selection.filename, selectionKey: current.selectionKey, totalBytes: current.selection.totalBytes, files };
  });
}
export async function validatePracticeDocumentDownload(id: string, selectionKey: string) {
  return practiceResult(async () => {
    const current = await approvedSelection(id);
    if (typeof selectionKey !== 'string' || !/^[a-f0-9]{64}$/.test(selectionKey) || current.selectionKey !== selectionKey) throw new Error('The approved practice documents changed. Download them again.');
    return { valid: true };
  });
}
