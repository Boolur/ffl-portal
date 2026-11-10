import { validatePilotFile, type PilotPackage } from './submissionPilot';

export const MAX_DOCUMENT_DOWNLOAD_BYTES = 200 * 1024 * 1024;
export const MAX_DOCUMENT_DOWNLOAD_FILES = 300;
export type SubmissionDocumentDownloadFile = { id: string; name: string; type: string; size: number; archivePath: string; url: string };
export type SubmissionDocumentDownloadManifest = { filename: string; selectionKey: string; totalBytes: number; files: SubmissionDocumentDownloadFile[] };
type SelectedFile = Omit<SubmissionDocumentDownloadFile, 'url'> & { storagePath: string; categoryId: string; categoryLabel: string };

function safeComponent(value: string, fallback: string, limit: number, preserveExtension = false) {
  let safe = value.normalize('NFC').replace(/[<>:"/\\|?*\x00-\x1f\x7f]/g, '_').trim().replace(/[. ]+$/g, '');
  if (!safe || safe === '.' || safe === '..') safe = fallback;
  if (/^(CON|PRN|AUX|NUL|COM[1-9¹²³]|LPT[1-9¹²³]|CONIN\$|CONOUT\$)(\.|$)/i.test(safe)) safe = `_${safe}`;
  const dot = preserveExtension ? safe.lastIndexOf('.') : -1;
  if (safe.length > limit && dot > 0) {
    const extension = safe.slice(dot);
    return `${safe.slice(0, limit - extension.length).replace(/[. ]+$/g, '') || fallback}${extension}`;
  }
  return safe.slice(0, limit).replace(/[. ]+$/g, '') || fallback;
}

function uniqueComponent(value: string, used: Set<string>, isFile: boolean, limit: number) {
  const dot = isFile ? value.lastIndexOf('.') : -1;
  const extension = dot > 0 ? value.slice(dot) : '';
  const base = extension ? value.slice(0, -extension.length) : value;
  let candidate = value;
  let count = 1;
  while (used.has(candidate.normalize('NFKC').toLowerCase())) {
    const suffix = ` (${++count})`;
    candidate = `${base.slice(0, limit - extension.length - suffix.length)}${suffix}${extension}`;
  }
  used.add(candidate.normalize('NFKC').toLowerCase());
  return candidate;
}

export function selectApprovedSubmissionDocuments(pkg: PilotPackage, taskId: string, ownerId: string, loanNumber: string) {
  const files: SelectedFile[] = [];
  const usedNames = new Set<string>();
  const usedIds = new Set<string>();
  const usedPaths = new Set<string>();
  const usedCategories = new Set<string>();
  let totalBytes = 0;
  for (const item of pkg.items) {
    if (item.review !== 'APPROVED' || item.pending) continue;
    if (!Array.isArray(item.files)) throw new Error('Approved document details are invalid. Refresh the submission and try again.');
    if (!item.files.length) continue;
    if (typeof item.id !== 'string' || !item.id || usedCategories.has(item.id) || typeof item.label !== 'string') throw new Error('Approved document categories are invalid. Refresh the submission and try again.');
    usedCategories.add(item.id);
    for (const file of item.files) {
      if (!file || typeof file.id !== 'string' || !file.id || typeof file.name !== 'string' || typeof file.type !== 'string' || typeof file.path !== 'string') throw new Error('Approved document details are invalid. Refresh the submission and try again.');
      validatePilotFile(file.name, file.size, file.type);
      const prefix = [`processing-submission/${ownerId}/`, `submission-pilot/${taskId}/`].find(value => file.path.startsWith(value));
      const suffix = prefix ? file.path.slice(prefix.length) : '';
      if (!prefix || !/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}\.(pdf|jpg|jpeg|png)$/.test(suffix)) throw new Error('An approved document does not belong to this submission.');
      const extension = suffix.split('.').at(-1)!;
      const types: Record<string, string> = { pdf: 'application/pdf', jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png' };
      if (types[extension] !== file.type || usedIds.has(file.id) || usedPaths.has(file.path)) throw new Error('Approved document references are invalid. Refresh the submission and try again.');
      usedIds.add(file.id); usedPaths.add(file.path);
      totalBytes += file.size;
      if (files.length >= MAX_DOCUMENT_DOWNLOAD_FILES || totalBytes > MAX_DOCUMENT_DOWNLOAD_BYTES) throw new Error('Download All supports up to 300 files and 200 MB. Download these files individually.');
      const name = uniqueComponent(safeComponent(file.name, 'Document', 200, true), usedNames, true, 200);
      files.push({ id: file.id, name: file.name, type: file.type, size: file.size, archivePath: name, storagePath: file.path, categoryId: item.id, categoryLabel: item.label });
    }
  }
  if (!files.length) throw new Error('There are no approved documents available to download.');
  return { filename: `Arive-${safeComponent(loanNumber, 'Loan', 60)}-Approved-Documents.zip`, totalBytes, files };
}

// Hash this on the server. Notes, transfer states, and package revisions do not
// affect the archive; approved files, names, categories, and storage references do.
export function submissionDocumentSelectionSource(selection: ReturnType<typeof selectApprovedSubmissionDocuments>, taskId: string, ownerId: string) {
  return JSON.stringify({ taskId, ownerId, ...selection });
}
