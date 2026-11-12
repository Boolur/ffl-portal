import 'server-only';
import { prisma } from '@/lib/prisma';
import { getSupabaseAdmin, getTaskAttachmentsBucket } from './supabaseAdmin';
import { getAuthorizedPracticeTask, type PilotPracticeActor } from './pilotPracticeAccess';
import { assertPracticeUploadPath } from './pilotPractice';
import { processingDocumentTaskId, readPilotPackage, validatePilotFile } from './submissionPilot';

export const practiceAttachmentsBucket = () => process.env.SUPABASE_STORAGE_BUCKET_PRACTICE_ATTACHMENTS || getTaskAttachmentsBucket();
export type AuthorizedPracticeTask = Awaited<ReturnType<typeof getAuthorizedPracticeTask>>;
export async function resolvePracticeFile(task: AuthorizedPracticeTask, fileId: string, actor: PilotPracticeActor) {
  const file = task.package.files.find(value => value.id === fileId && value.uploaded && !value.retired);
  if (!file) throw new Error('Practice document not found.');
  validatePilotFile(file.name, file.size, file.type);
  if (file.path) {
    if (file.sourceAttachmentId || file.sourceDocumentTaskId || file.sourceDocumentFileId) throw new Error('Practice document reference is invalid.');
    assertPracticeUploadPath(file.path, task.ownerId, task.id, file);
    return { file, path: file.path, bucket: practiceAttachmentsBucket() };
  }
  if (!task.sourceTaskId) throw new Error('The source document is unavailable.');
  // Reauthorize against the current original task on every delivery and archive validation.
  const current = await getAuthorizedPracticeTask(task.id, actor);
  const currentFile = current.package.files.find(value => value.id === fileId);
  if (current.sourceTaskId !== task.sourceTaskId || !currentFile?.uploaded || currentFile.retired || currentFile.name !== file.name || currentFile.type !== file.type || currentFile.size !== file.size || currentFile.sourceAttachmentId !== file.sourceAttachmentId || currentFile.sourceDocumentTaskId !== file.sourceDocumentTaskId || currentFile.sourceDocumentFileId !== file.sourceDocumentFileId) throw new Error('The practice document changed. Refresh and try again.');
  if (file.sourceAttachmentId && !file.sourceDocumentTaskId && !file.sourceDocumentFileId) {
    const source = await prisma.taskAttachment.findUnique({ where: { id: file.sourceAttachmentId } });
    if (!source || source.taskId !== task.sourceTaskId || source.filename !== file.name || source.contentType !== file.type || source.sizeBytes !== file.size || !source.storagePath.startsWith(`tasks/${source.taskId}/`) || /(?:^|\/)\.\.(?:\/|$)|[\\\x00-\x1f]/.test(source.storagePath)) throw new Error('The source document is no longer available.');
    return { file, path: source.storagePath, bucket: getTaskAttachmentsBucket() };
  }
  if (!file.sourceAttachmentId && file.sourceDocumentTaskId && file.sourceDocumentFileId) {
    const request = await prisma.task.findUnique({ where: { id: task.sourceTaskId } });
    const documentTask = await prisma.task.findUnique({ where: { id: file.sourceDocumentTaskId }, include: { loan: { select: { loanOfficerId: true } } } });
    if (!request || processingDocumentTaskId(request.submissionData) !== documentTask?.id || request.loanId !== task.sourceLoanId || documentTask.loanId !== task.sourceLoanId) throw new Error('The source document is no longer available.');
    const source = readPilotPackage(documentTask.submissionData)?.items.flatMap(item => item.files).find(value => value.id === file.sourceDocumentFileId);
    if (!source || source.name !== file.name || source.type !== file.type || source.size !== file.size) throw new Error('The source document is no longer available.');
    const prefix = [`processing-submission/${documentTask.loan.loanOfficerId}/`, `submission-pilot/${documentTask.id}/`].find(value => source.path.startsWith(value));
    if (!prefix || !/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}\.(pdf|jpg|jpeg|png)$/.test(source.path.slice(prefix.length))) throw new Error('The source document reference is invalid.');
    return { file, path: source.path, bucket: getTaskAttachmentsBucket() };
  }
  throw new Error('Practice document reference is invalid.');
}

export async function signPracticeFile(reference: Awaited<ReturnType<typeof resolvePracticeFile>>) {
  try {
    const { data, error } = await getSupabaseAdmin().storage.from(reference.bucket).createSignedUrl(reference.path, 300);
    if (error || !data?.signedUrl) throw new Error('Storage unavailable');
    return { url: data.signedUrl, name: reference.file.name, type: reference.file.type, size: reference.file.size };
  } catch { throw new Error('Unable to prepare this practice document. Please try again.'); }
}
