import { Zip, ZipPassThrough } from 'fflate';
import {
  MAX_DOCUMENT_DOWNLOAD_BYTES,
  MAX_DOCUMENT_DOWNLOAD_FILES,
  type SubmissionDocumentDownloadManifest,
} from './submissionDocumentDownload';

export class DocumentArchiveError extends Error {}

export type DocumentArchiveProgress = { current: number; total: number };
type ArchiveOptions = {
  signal: AbortSignal;
  fetchFile?: (url: string, init: RequestInit) => Promise<Response>;
  onProgress?: (progress: DocumentArchiveProgress) => void;
  validateSelection: () => Promise<boolean>;
};

function assertActive(signal: AbortSignal) {
  if (signal.aborted) throw new DOMException('Document download cancelled.', 'AbortError');
}

function safeSegment(segment: string) {
  return !!segment && segment !== '.' && segment !== '..' &&
    !/[<>:"\\|?*\u0000-\u001f\u007f]/.test(segment) && !/[. ]$/.test(segment) &&
    !/^(?:CON|PRN|AUX|NUL|COM[1-9¹²³]|LPT[1-9¹²³]|CONIN\$|CONOUT\$)(?:\.|$)/i.test(segment);
}

function validateManifest(manifest: SubmissionDocumentDownloadManifest) {
  const invalid = () => { throw new DocumentArchiveError('The document download list is invalid. Refresh and try again.'); };
  if (!Array.isArray(manifest.files) || !manifest.files.length || manifest.files.length > MAX_DOCUMENT_DOWNLOAD_FILES) invalid();
  if (typeof manifest.filename !== 'string' || manifest.filename.includes('/') || !safeSegment(manifest.filename) || !/\.zip$/i.test(manifest.filename)) invalid();
  if (!Number.isSafeInteger(manifest.totalBytes) || manifest.totalBytes <= 0 || manifest.totalBytes > MAX_DOCUMENT_DOWNLOAD_BYTES) invalid();
  const paths = new Set<string>();
  const directories = new Set<string>();
  const ids = new Set<string>();
  let total = 0;
  for (const file of manifest.files) {
    if (!file || typeof file.id !== 'string' || !file.id || ids.has(file.id) || !Number.isSafeInteger(file.size) || file.size <= 0) invalid();
    if (!['application/pdf', 'image/jpeg', 'image/png'].includes(file.type)) invalid();
    if (typeof file.archivePath !== 'string' || file.archivePath.length > 1024) invalid();
    const segments = file.archivePath.split('/');
    // New manifests use root filenames; safe legacy category/file paths are
    // also valid here. Final authorization still validates the current selection.
    if (segments.length > 2 || !segments.every(safeSegment)) invalid();
    const pathKey = file.archivePath.normalize('NFKC').toLowerCase();
    if (paths.has(pathKey) || directories.has(pathKey)) invalid();
    if (segments.length === 2) {
      const directoryKey = segments[0].normalize('NFKC').toLowerCase();
      if (paths.has(directoryKey)) invalid();
      directories.add(directoryKey);
    }
    paths.add(pathKey); ids.add(file.id); total += file.size;
    if (!Number.isSafeInteger(total) || total > MAX_DOCUMENT_DOWNLOAD_BYTES) invalid();
    try {
      const url = new URL(file.url);
      if (url.protocol !== 'https:' || url.username || url.password || url.hash) invalid();
    } catch { invalid(); }
  }
  if (total !== manifest.totalBytes) invalid();
}

/** Builds a complete archive in memory. It never initiates a browser download. */
export async function buildDocumentArchive(manifest: SubmissionDocumentDownloadManifest, options: ArchiveOptions): Promise<Blob> {
  assertActive(options.signal);
  validateManifest(manifest);
  const fetchFile = options.fetchFile ?? fetch;
  const chunks: ArrayBuffer[] = [];
  let zipError: Error | null = null;
  let finished = false;
  let downloadedBytes = 0;
  const zip = new Zip((error, chunk, final) => {
    if (error) { zipError = error; return; }
    // Retain only ZIP output, not a second full copy of every source document.
    chunks.push(new Uint8Array(chunk).buffer);
    if (final) finished = true;
  });
  try {
    for (let index = 0; index < manifest.files.length; index++) {
      assertActive(options.signal);
      options.onProgress?.({ current: index + 1, total: manifest.files.length });
      const file = manifest.files[index];
      const signal = AbortSignal.any([options.signal, AbortSignal.timeout(30000)]);
      const response = await fetchFile(file.url, {
        signal, cache: 'no-store', credentials: 'omit', redirect: 'error', referrerPolicy: 'no-referrer',
      });
      if (signal.aborted) {
        await response.body?.cancel().catch(() => {});
        assertActive(options.signal);
        signal.throwIfAborted();
      }
      assertActive(options.signal);
      const contentType = response.headers.get('content-type')?.split(';')[0].trim().toLowerCase();
      // Signed object storage may use the generic binary MIME type. A supplied
      // HTML/JSON or conflicting document type is never accepted into the ZIP.
      if (response.status !== 200 || !response.body || (contentType && contentType !== file.type && contentType !== 'application/octet-stream')) {
        await response.body?.cancel();
        throw new DocumentArchiveError('A document could not be downloaded or its type did not match. Refresh and try again.');
      }
      const reader = response.body.getReader();
      const entry = new ZipPassThrough(file.archivePath);
      zip.add(entry);
      let fileBytes = 0;
      let completed = false;
      const cancelRead = () => { void reader.cancel().catch(() => {}); };
      signal.addEventListener('abort', cancelRead, { once: true });
      try {
        while (true) {
          assertActive(options.signal);
          signal.throwIfAborted();
          const { done, value } = await reader.read();
          assertActive(options.signal);
          signal.throwIfAborted();
          if (done) break;
          fileBytes += value.byteLength;
          downloadedBytes += value.byteLength;
          if (fileBytes > file.size || downloadedBytes > MAX_DOCUMENT_DOWNLOAD_BYTES) {
            throw new DocumentArchiveError('A document did not match its stored size. No archive was downloaded.');
          }
          entry.push(value, false);
          if (zipError) throw zipError;
        }
        if (fileBytes !== file.size) throw new DocumentArchiveError('A document download was incomplete. No archive was downloaded.');
        entry.push(new Uint8Array(0), true);
        if (zipError) throw zipError;
        completed = true;
      } finally {
        signal.removeEventListener('abort', cancelRead);
        if (!completed) await reader.cancel().catch(() => {});
        reader.releaseLock();
      }
    }
    assertActive(options.signal);
    zip.end();
    if (zipError || !finished || downloadedBytes !== manifest.totalBytes) throw new DocumentArchiveError('The document archive could not be completed. Please try again.');
    if (!await options.validateSelection()) throw new DocumentArchiveError('The approved documents changed. Refresh and try again.');
    assertActive(options.signal);
    return new Blob(chunks, { type: 'application/zip' });
  } catch (error) {
    zip.terminate();
    assertActive(options.signal);
    if (error instanceof DocumentArchiveError) throw error;
    throw new DocumentArchiveError('The document download could not be completed. Refresh and try again.');
  } finally {
    chunks.length = 0;
  }
}
