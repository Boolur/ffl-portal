import { describe, expect, it, vi } from 'vitest';
import { strFromU8, unzipSync } from 'fflate';
import { buildDocumentArchive } from './documentArchive';
import { MAX_DOCUMENT_DOWNLOAD_BYTES, MAX_DOCUMENT_DOWNLOAD_FILES, selectApprovedSubmissionDocuments, type SubmissionDocumentDownloadManifest } from './submissionDocumentDownload';
import type { PilotItem, PilotPackage } from './submissionPilot';

const bytes = new TextEncoder().encode('%PDF-synthetic');
function manifest(): SubmissionDocumentDownloadManifest {
  return {
    filename: 'approved-documents.zip', selectionKey: 'synthetic-selection', totalBytes: bytes.length * 2,
    files: [
      { id: 'one', name: 'statement.pdf', type: 'application/pdf', size: bytes.length, archivePath: 'statement.pdf', url: 'https://storage.example/one?token=synthetic' },
      { id: 'two', name: 'statement.pdf', type: 'application/pdf', size: bytes.length, archivePath: 'statement (2).pdf', url: 'https://storage.example/two?token=synthetic' },
    ],
  };
}
function setup() {
  const controller = new AbortController();
  const fetchFile = vi.fn(async () => new Response(bytes, { headers: { 'content-type': 'application/pdf' } }));
  const validateSelection = vi.fn().mockResolvedValue(true);
  const onProgress = vi.fn();
  return { controller, fetchFile, validateSelection, onProgress,
    options: { signal: controller.signal, fetchFile, validateSelection, onProgress } };
}

describe('approved document archive', () => {
  it('archives actual bytes at the ZIP root, sequentially, then revalidates approval before returning', async () => {
    const h = setup();
    const order: string[] = [];
    h.fetchFile.mockImplementation(async () => {
      const index = h.fetchFile.mock.calls.length;
      order.push(`fetch-${index}`);
      let part = 0;
      return new Response(new ReadableStream({ pull(stream) {
        if (part++ === 0) stream.enqueue(bytes.slice(0, 4));
        else if (part === 2) stream.enqueue(bytes.slice(4));
        else { order.push(`complete-${index}`); stream.close(); }
      } }), { headers: { 'content-type': 'application/pdf; charset=binary' } });
    });
    h.validateSelection.mockImplementation(async () => { order.push('validate'); return true; });
    const archive = await buildDocumentArchive(manifest(), h.options);
    const extracted = unzipSync(new Uint8Array(await archive.arrayBuffer()));
    expect(archive.type).toBe('application/zip');
    expect(Object.keys(extracted)).toEqual(['statement.pdf', 'statement (2).pdf']);
    expect(Object.values(extracted).map(value => strFromU8(value))).toEqual(['%PDF-synthetic', '%PDF-synthetic']);
    expect(order).toEqual(['fetch-1', 'complete-1', 'fetch-2', 'complete-2', 'validate']);
    expect(h.onProgress.mock.calls).toEqual([[{ current: 1, total: 2 }], [{ current: 2, total: 2 }]]);
    expect(h.fetchFile.mock.calls[0]).toEqual([manifest().files[0].url, expect.objectContaining({
      credentials: 'omit', cache: 'no-store', redirect: 'error', referrerPolicy: 'no-referrer', signal: expect.any(AbortSignal),
    })]);
  });

  it('still accepts safe legacy category paths from an already-prepared manifest', async () => {
    const h = setup(); const data = manifest();
    data.files.forEach(file => { file.archivePath = `Mortgage/${file.archivePath}`; });
    const archive = await buildDocumentArchive(data, h.options);
    const extracted = unzipSync(new Uint8Array(await archive.arrayBuffer()));
    expect(Object.keys(extracted)).toEqual(['Mortgage/statement.pdf', 'Mortgage/statement (2).pdf']);
    expect(Object.values(extracted).map(value => strFromU8(value))).toEqual(['%PDF-synthetic', '%PDF-synthetic']);
  });

  it('keeps every attachment and its bytes when names collide within and across approved categories', async () => {
    const contents = ['%PDF-first attachment', '%PDF-second attachment', '%PDF-third attachment'];
    const files = contents.map((content, index) => ({
      id: `file-${index}`, name: index === 2 ? 'STATEMENT.PDF' : 'Statement.pdf', type: 'application/pdf',
      size: new TextEncoder().encode(content).length, uploadedAt: '',
      path: `submission-pilot/package/00000000-0000-0000-0000-${index.toString(16).padStart(12, '0')}.pdf`,
    }));
    const item = (id: string, attachments: typeof files): PilotItem => ({ id, label: id, required: true, review: 'APPROVED', feedback: '', waiver: '', files: attachments });
    const pkg: PilotPackage = { version: 1, revision: 1, state: 'REVIEW', reviewerId: 'reviewer', history: [], items: [item('Income', files.slice(0, 2)), item('Additional', files.slice(2))] };
    const selected = selectApprovedSubmissionDocuments(pkg, 'package', 'owner', '17881588');
    const data: SubmissionDocumentDownloadManifest = {
      ...selected, selectionKey: 'synthetic-selection',
      files: selected.files.map((file, index) => ({ ...file, url: `https://storage.example/${index}` })),
    };
    const h = setup();
    h.fetchFile.mockImplementation(async (url?: string) => new Response(contents[Number(new URL(url!).pathname.slice(1))], { headers: { 'content-type': 'application/pdf' } }));
    const archive = await buildDocumentArchive(data, h.options);
    const extracted = unzipSync(new Uint8Array(await archive.arrayBuffer()));
    expect(Object.keys(extracted)).toEqual(['Statement.pdf', 'Statement (2).pdf', 'STATEMENT (3).PDF']);
    expect(Object.values(extracted).map(value => strFromU8(value))).toEqual(contents);
    expect(h.validateSelection).toHaveBeenCalledTimes(1);
  });

  it.each([false, true])('rejects a file-versus-directory collision regardless of manifest order: %s', async reverse => {
    const h = setup(); const data = manifest();
    data.files[1].archivePath = 'STATEMENT.pdf/second.pdf';
    if (reverse) data.files.reverse();
    await expect(buildDocumentArchive(data, h.options)).rejects.toThrow('download list is invalid');
    expect(h.fetchFile).not.toHaveBeenCalled();
  });

  it.each(['application/octet-stream', null])('accepts exact-sized storage bytes with content type %s', async type => {
    const h = setup();
    h.fetchFile.mockImplementation(async () => new Response(bytes, { headers: type ? { 'content-type': type } : {} }));
    await expect(buildDocumentArchive(manifest(), h.options)).resolves.toBeInstanceOf(Blob);
  });

  it.each(['too short', 'too large', 'wrong type', 'HTML error', 'expired link', 'network error', 'missing body'])('returns no partial archive when a later document is %s', async failure => {
    const h = setup();
    h.fetchFile.mockImplementationOnce(async () => new Response(bytes, { headers: { 'content-type': 'application/pdf' } }));
    h.fetchFile.mockImplementationOnce(async () => {
      if (failure === 'network error') throw new Error('Private storage URL must never appear in an error');
      if (failure === 'missing body') return new Response(null);
      return new Response(failure === 'too short' ? bytes.slice(1) : failure === 'too large' ? new Uint8Array(bytes.length + 1) : bytes, {
        status: failure === 'expired link' ? 403 : 200,
        headers: { 'content-type': failure === 'wrong type' ? 'image/png' : failure === 'HTML error' ? 'text/html' : 'application/pdf' },
      });
    });
    await expect(buildDocumentArchive(manifest(), h.options)).rejects.toThrow(/document|archive/i);
    expect(h.validateSelection).not.toHaveBeenCalled();
  });

  it('discards the finished archive if an approval or file changed during preparation', async () => {
    const h = setup(); h.validateSelection.mockResolvedValue(false);
    await expect(buildDocumentArchive(manifest(), h.options)).rejects.toThrow('approved documents changed');
    expect(h.fetchFile).toHaveBeenCalledTimes(2);
    expect(h.validateSelection).toHaveBeenCalledTimes(1);
  });

  it('does not return an archive when final authorization is unavailable', async () => {
    const h = setup(); h.validateSelection.mockRejectedValue(new Error('Internal secret should not escape'));
    await expect(buildDocumentArchive(manifest(), h.options)).rejects.toThrow('The document download could not be completed. Refresh and try again.');
  });

  it('stops before fetching when already cancelled', async () => {
    const h = setup(); h.controller.abort();
    await expect(buildDocumentArchive(manifest(), h.options)).rejects.toMatchObject({ name: 'AbortError' });
    expect(h.fetchFile).not.toHaveBeenCalled(); expect(h.validateSelection).not.toHaveBeenCalled();
  });

  it('cancels an in-progress body and skips later files and final approval after a package change', async () => {
    const h = setup(); const cancelled = vi.fn();
    h.fetchFile.mockImplementationOnce(async () => new Response(new ReadableStream({
      pull(stream) { stream.enqueue(bytes.slice(0, 2)); h.controller.abort(); }, cancel: cancelled,
    }), { headers: { 'content-type': 'application/pdf' } }));
    await expect(buildDocumentArchive(manifest(), h.options)).rejects.toMatchObject({ name: 'AbortError' });
    expect(h.fetchFile).toHaveBeenCalledTimes(1); expect(h.validateSelection).not.toHaveBeenCalled();
    expect(cancelled).toHaveBeenCalledTimes(1);
  });

  it('discards validated bytes if the component unmounts during final verification', async () => {
    const h = setup(); h.validateSelection.mockImplementation(async () => { h.controller.abort(); return true; });
    await expect(buildDocumentArchive(manifest(), h.options)).rejects.toMatchObject({ name: 'AbortError' });
  });

  it.each(['', '.', '..', '../outside.pdf', '/statement.pdf', '/Mortgage/statement.pdf', 'Mortgage/../statement.pdf', 'Mortgage/Nested/statement.pdf', 'Mortgage\\statement.pdf', 'CON.pdf', 'LPT¹.pdf', 'CONIN$.pdf', 'Mortgage/CON.pdf', 'file:stream.pdf', 'Mortgage/file:stream.pdf', 'file.pdf\u0000', 'Mortgage/file.pdf\u0000', 'file.pdf ', 'Mortgage/file.pdf '])('rejects unsafe archive path %j before any download', async path => {
    const h = setup(); const data = manifest(); data.files[0].archivePath = path;
    await expect(buildDocumentArchive(data, h.options)).rejects.toThrow('download list is invalid');
    expect(h.fetchFile).not.toHaveBeenCalled();
  });

  it.each(['duplicates', 'wrong total', 'too many files', 'too many bytes', 'invalid size', 'unsafe URL', 'unsafe ZIP name', 'empty selection'])('rejects %s before downloading', async invalid => {
    const h = setup(); const data = manifest();
    if (invalid === 'duplicates') data.files[1].archivePath = data.files[0].archivePath.toUpperCase();
    if (invalid === 'wrong total') data.totalBytes++;
    if (invalid === 'too many files') data.files = Array.from({ length: MAX_DOCUMENT_DOWNLOAD_FILES + 1 }, () => data.files[0]);
    if (invalid === 'too many bytes') { data.files[0].size = MAX_DOCUMENT_DOWNLOAD_BYTES; data.totalBytes = MAX_DOCUMENT_DOWNLOAD_BYTES + bytes.length; }
    if (invalid === 'invalid size') data.files[0].size = 1.5;
    if (invalid === 'unsafe URL') data.files[0].url = 'http://storage.example/file';
    if (invalid === 'unsafe ZIP name') data.filename = '../approved.zip';
    if (invalid === 'empty selection') { data.files = []; data.totalBytes = 0; }
    await expect(buildDocumentArchive(data, h.options)).rejects.toThrow('download list is invalid');
    expect(h.fetchFile).not.toHaveBeenCalled(); expect(h.validateSelection).not.toHaveBeenCalled();
  });
});
