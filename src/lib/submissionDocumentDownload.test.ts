import { describe, expect, it } from 'vitest';
import type { PilotFile, PilotItem, PilotPackage } from './submissionPilot';
import { MAX_DOCUMENT_DOWNLOAD_BYTES, selectApprovedSubmissionDocuments, submissionDocumentSelectionSource } from './submissionDocumentDownload';

function file(index = 1, patch: Partial<PilotFile> = {}): PilotFile {
  return { id: `file-${index}`, name: 'Mortgage Statement.pdf', type: 'application/pdf', size: 3, uploadedAt: '', path: `submission-pilot/package/00000000-0000-0000-0000-${index.toString(16).padStart(12, '0')}.pdf`, ...patch };
}
function item(files = [file()], patch: Partial<PilotItem> = {}): PilotItem { return { id: 'mortgage', label: 'Mortgage documents', required: true, review: 'APPROVED', feedback: '', waiver: '', files, ...patch }; }
function pkg(items = [item()]): PilotPackage { return { version: 1, revision: 1, state: 'REVIEW', reviewerId: 'reviewer', history: [], items }; }
const select = (value: PilotPackage) => selectApprovedSubmissionDocuments(value, 'package', 'owner', '17881588');

describe('approved submission download selection', () => {
  it('includes every approved active attachment, including additional categories in a reopened review', () => {
    const result = select(pkg([item([file(), file(2, { name: 'Second Statement.pdf' })]), item([file(3)], { id: 'extra', label: 'Bank statement', required: false })]));
    expect(result.files.map(value => value.id)).toEqual(['file-1', 'file-2', 'file-3']);
    expect(result.totalBytes).toBe(9);
    expect(result.filename).toBe('Arive-17881588-Approved-Documents.zip');
    expect(result.files[0].archivePath).toBe('Mortgage documents/Mortgage Statement.pdf');
  });
  it('excludes retired, unapproved, correction-requested, pending-upload, and no-file N/A categories', () => {
    const value = pkg([item(), item([file(2)], { id: 'unapproved', review: 'PENDING' }), item([file(3)], { id: 'correction', review: 'CHANGES' }), item([file(4)], { id: 'uploading', pending: { path: 'pending', name: 'New.pdf', type: 'application/pdf', size: 3 } }), item([], { id: 'na', waiver: 'Not applicable' })]);
    value.retiredFiles = [file(5)];
    expect(select(value).files.map(entry => entry.id)).toEqual(['file-1']);
    expect(() => select(pkg([item([], { waiver: 'Not applicable' })]))).toThrow('no approved documents');
  });
  it('accepts files uploaded from the LO popup only for this owner', () => {
    const uploaded = file(1, { path: 'processing-submission/owner/00000000-0000-0000-0000-000000000001.pdf' });
    expect(select(pkg([item([uploaded])])).files).toHaveLength(1);
  });
  it.each(['../file.pdf', '/absolute.pdf', 'submission-pilot/other/00000000-0000-0000-0000-000000000001.pdf', 'processing-submission/other/00000000-0000-0000-0000-000000000001.pdf', 'submission-pilot/package/../file.pdf', 'submission-pilot/package/%2e%2e/file.pdf', 'submission-pilot/package/00000000-0000-0000-0000-000000000001.pdf/extra', 'submission-pilot/package/00000000-0000-0000-0000-000000000001\\.pdf'])('rejects storage references outside the exact owned path: %s', path => {
    expect(() => select(pkg([item([file(1, { path })])]))).toThrow('does not belong');
  });
  it('rejects duplicate file IDs and storage references rather than silently losing an attachment', () => {
    expect(() => select(pkg([item([file(), file(2, { id: 'file-1' })])]))).toThrow('references are invalid');
    expect(() => select(pkg([item([file(), file(2, { path: file().path })])]))).toThrow('references are invalid');
  });
  it.each([{ size: 0 }, { size: 1.5 }, { size: 20 * 1024 * 1024 + 1 }, { type: 'text/html' }, { name: 'unsafe.exe' }, { path: 'submission-pilot/package/00000000-0000-0000-0000-000000000001.png' }])('rejects invalid stored file metadata %j', patch => {
    expect(() => select(pkg([item([file(1, patch)])]))).toThrow();
  });
  it('sanitizes Windows paths and preserves distinct files after case-insensitive collisions', () => {
    const result = select(pkg([
      item([file(1, { name: 'Statement.pdf' }), file(2, { name: 'statement.PDF' }), file(3, { name: 'a:b.pdf' }), file(4, { name: 'a?b.pdf' }), file(5, { name: 'CON.pdf' })], { label: 'Mortgage/Title' }),
      item([file(6, { name: '..\\outside.pdf' })], { id: 'second', label: 'Mortgage\\Title' }),
      item([file(7)], { id: 'reserved', label: 'NUL' }),
    ]));
    expect(result.files.map(value => value.archivePath)).toEqual(['Mortgage_Title/Statement.pdf', 'Mortgage_Title/statement (2).PDF', 'Mortgage_Title/a_b.pdf', 'Mortgage_Title/a_b (2).pdf', 'Mortgage_Title/_CON.pdf', 'Mortgage_Title (2)/.._outside.pdf', '_NUL/Mortgage Statement.pdf']);
    expect(new Set(result.files.map(value => value.archivePath.toLowerCase())).size).toBe(7);
  });
  it('accepts the exact size/file limits and refuses larger archives', () => {
    const maximum = pkg([item(Array.from({ length: 10 }, (_, index) => file(index, { size: 20 * 1024 * 1024 })))]);
    expect(select(maximum).totalBytes).toBe(MAX_DOCUMENT_DOWNLOAD_BYTES);
    maximum.items[0].files.push(file(11)); expect(() => select(maximum)).toThrow('200 MB');
    expect(select(pkg([item(Array.from({ length: 300 }, (_, index) => file(index)))])).files).toHaveLength(300);
    expect(() => select(pkg([item(Array.from({ length: 301 }, (_, index) => file(index))) ]))).toThrow('300 files');
  });
  it('deduplicates compatibility-equivalent Unicode names and directories consistently with the archive builder', () => {
    const result = select(pkg([
      item([file(1, { name: 'Statement.pdf' }), file(2, { name: 'Ｓtatement.pdf' })], { label: 'Mortgage' }),
      item([file(3)], { id: 'extra', label: 'Ｍortgage' }),
    ]));
    expect(result.files.map(value => value.archivePath)).toEqual([
      'Mortgage/Statement.pdf', 'Mortgage/Ｓtatement (2).pdf', 'Ｍortgage (2)/Mortgage Statement.pdf',
    ]);
    expect(new Set(result.files.map(value => value.archivePath.normalize('NFKC').toLowerCase())).size).toBe(3);
  });
  it('preserves a valid document extension when sanitization or duplicate suffixes lengthen a maximum-length name', () => {
    const name = `CON.${'x'.repeat(192)}.pdf`;
    expect(name.length).toBe(200);
    const result = select(pkg([item([file(1, { name }), file(2, { name })])]));
    const names = result.files.map(value => value.archivePath.split('/')[1]);
    expect(names[0]).toMatch(/^_CON\..*\.pdf$/);
    expect(names[1]).toMatch(/^_CON\..* \(2\)\.pdf$/);
    expect(names.every(value => value.length <= 200)).toBe(true);
    expect(result.files.every(value => value.name === name)).toBe(true);
  });
  it('tracks approval/file changes but ignores unrelated note and transfer revisions', () => {
    const value = pkg([item([file(), file(2)])]);
    const source = () => submissionDocumentSelectionSource(select(value), 'package', 'owner');
    const original = source();
    value.revision++; value.history.push({ actor: 'Reviewer', message: 'Imported notes', at: '' }); value.ariveTransfers = { 'file-1': { state: 'SENT', attemptId: 'transfer', at: '' } };
    expect(source()).toBe(original);
    value.items[0].files[1].name = 'Replacement.pdf'; expect(source()).not.toBe(original);
    value.items[0].files[1] = file(2); value.items.push(item([file(3)], { id: 'extra', review: 'PENDING' })); expect(source()).toBe(original);
    value.items[1].review = 'APPROVED'; expect(source()).not.toBe(original);
  });
});
