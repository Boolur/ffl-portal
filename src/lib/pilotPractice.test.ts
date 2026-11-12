import { describe, expect, it } from 'vitest';
import { applyPracticeCommand, assertPracticeUploadPath, practiceInitialItems, readPracticeItems, validatePracticeDraft, type PracticeFile, type PracticeItem } from './pilotPractice';
import { selectPracticeDocuments } from './pilotPracticeDocuments';

it('retains correction feedback in conversation history after another decision', () => {
  const items: PracticeItem[] = [{ id: 'title', label: 'Title', required: true, waiver: '', review: 'PENDING', feedback: '' }];
  const files: PracticeFile[] = [{ id: 'f', itemId: 'title', name: 'Title.pdf', type: 'application/pdf', size: 50, uploaded: true, retired: false }];
  const first = applyPracticeCommand('STARTED', items, files, { persona: 'JR', action: 'REVIEW', itemId: 'title', approved: false, text: 'Please replace page two.' }, 'new');
  const second = applyPracticeCommand('STARTED', first.items, files, { persona: 'JR', action: 'REVIEW', itemId: 'title', approved: true, text: 'Corrected page received.' }, 'new');
  expect(first.message).toContain('Please replace page two.');
  expect(second.message).toContain('Corrected page received.');
});

const file = (patch: Partial<PracticeFile> = {}): PracticeFile => ({ id: 'file', itemId: 'mortgage', name: 'Statement.pdf', type: 'application/pdf', size: 10, uploaded: true, retired: false, ...patch });
const item = (patch: Partial<PracticeItem> = {}): PracticeItem => ({ id: 'mortgage', label: 'Mortgage', required: true, waiver: '', review: 'PENDING', feedback: '', ...patch });

describe('isolated practice workflow', () => {
  it('allows bounded simulation fields without accepting IDs, ownership, payment details or storage paths', () => {
    expect(validatePracticeDraft({ borrowerFirstName: ' Test ', loanAmount: '250000', notesGoals: 'Practice only' })).toEqual({ borrowerFirstName: 'Test', loanAmount: '250000', notesGoals: 'Practice only' });
    for (const key of ['loanId', 'loanOfficerId', 'secondaryLoanOfficerId', 'assignedUserId', 'processingAssignmentGroup', 'path', 'clientSecret', 'cardNumber', '__proto__']) {
      expect(() => validatePracticeDraft({ [key]: 'forged' })).toThrow('unsupported');
    }
    expect(() => validatePracticeDraft({ borrowerFirstName: 'x'.repeat(201) })).toThrow();
    expect(() => validatePracticeDraft({ notesGoals: { html: 'bad' } })).toThrow();
  });
  it('supports Submit, Start, correction, return, replacement, resubmit, Start and approval without touching the original input', () => {
    const original = [item()];
    const submitted = applyPracticeCommand('DRAFT', original, [file()], { persona: 'LO', action: 'SUBMIT' }, 'new');
    expect(submitted.state).toBe('REVIEW'); expect(submitted.simulatedRecipient).toBe('JR');
    const started = applyPracticeCommand(submitted.state, submitted.items, [file()], { persona: 'JR', action: 'START' }, 'new');
    const correction = applyPracticeCommand(started.state, started.items, [file()], { persona: 'JR', action: 'REVIEW', itemId: 'mortgage', approved: false, text: 'Latest statement needed' }, 'new');
    const returned = applyPracticeCommand(correction.state, correction.items, [file()], { persona: 'JR', action: 'RETURN' }, 'new');
    expect(returned.state).toBe('CHANGES'); expect(returned.simulatedRecipient).toBe('LO');
    expect(() => applyPracticeCommand(returned.state, returned.items, [file()], { persona: 'LO', action: 'SUBMIT' }, 'new')).toThrow('Resolve');
    const replaced = returned.items.map(value => ({ ...value, review: 'PENDING' as const }));
    const resubmitted = applyPracticeCommand('CHANGES', replaced, [file({ id: 'replacement' })], { persona: 'LO', action: 'SUBMIT' }, 'new');
    const restarted = applyPracticeCommand(resubmitted.state, resubmitted.items, [file()], { persona: 'JR', action: 'START' }, 'new');
    const reviewed = applyPracticeCommand(restarted.state, restarted.items, [file()], { persona: 'JR', action: 'REVIEW', itemId: 'mortgage', approved: true }, 'new');
    const approved = applyPracticeCommand(reviewed.state, reviewed.items, [file()], { persona: 'JR', action: 'APPROVE' }, 'new');
    expect(approved.state).toBe('APPROVED'); expect(original[0].review).toBe('PENDING');
  });
  it.each(['REVIEW', 'APPROVE', 'RETURN', 'REJECT', 'REQUEST_DOCUMENT'] as const)('enforces Start before %s', action => {
    expect(() => applyPracticeCommand('REVIEW', [item()], [file()], { persona: 'JR', action, itemId: 'mortgage', approved: true, text: 'Reason' }, 'new')).toThrow('Start');
  });
  it('does not treat a practice persona as a session role; wrong workflow persona is rejected', () => {
    expect(() => applyPracticeCommand('REVIEW', [item()], [file()], { persona: 'LO', action: 'START' }, 'new')).toThrow();
    expect(() => applyPracticeCommand('DRAFT', [item()], [file()], { persona: 'JR', action: 'SUBMIT' }, 'new')).toThrow();
  });
  it('supports additional requests, explanations, review and explicit rejection reasons', () => {
    const requested = applyPracticeCommand('STARTED', [item()], [file()], { persona: 'JR', action: 'REQUEST_DOCUMENT', text: 'Bank statement' }, 'extra');
    expect(requested.items[1]).toMatchObject({ id: 'extra', required: true, review: 'CHANGES' });
    const waived = applyPracticeCommand('CHANGES', requested.items, [file()], { persona: 'LO', action: 'WAIVER', itemId: 'extra', text: 'No account used' }, 'new');
    expect(waived.items[1]).toMatchObject({ waiver: 'No account used', review: 'PENDING' });
    expect(() => applyPracticeCommand('STARTED', [item()], [file()], { persona: 'JR', action: 'REJECT' }, 'new')).toThrow('Explain');
    expect(applyPracticeCommand('STARTED', [item()], [file()], { persona: 'JR', action: 'REJECT', text: 'Wrong loan' }, 'new').state).toBe('REJECTED');
  });
  it('lets the LO add a labelled category and clear an incorrect N/A choice', () => {
    const added = applyPracticeCommand('DRAFT', [item()], [file()], { persona: 'LO', action: 'ADD_DOCUMENT', text: 'Tax return' }, 'extra');
    expect(added.items[1]).toMatchObject({ id: 'extra', label: 'Tax return', required: false });
    const waived = applyPracticeCommand('DRAFT', added.items, [file()], { persona: 'LO', action: 'WAIVER', itemId: 'extra', text: 'Not required' }, 'new');
    const cleared = applyPracticeCommand('DRAFT', waived.items, [file()], { persona: 'LO', action: 'CLEAR_WAIVER', itemId: 'extra' }, 'new');
    expect(cleared.items[1]).toMatchObject({ waiver: '', review: 'PENDING' });
  });
  it('does not let removal of an optional file bypass a JR correction request', () => {
    const correction = applyPracticeCommand('STARTED', [item({ required: false })], [file()], { persona: 'JR', action: 'REVIEW', itemId: 'mortgage', approved: false, text: 'Replace this' }, 'new');
    const removed = applyPracticeCommand('CHANGES', correction.items, [file()], { persona: 'LO', action: 'RETIRE_FILE', fileId: 'file' }, 'new');
    expect(() => applyPracticeCommand('CHANGES', removed.items, [], { persona: 'LO', action: 'SUBMIT' }, 'new')).toThrow('required');
  });
  it('requires each upload to finish and does not accept missing files as N/A', () => {
    expect(() => applyPracticeCommand('DRAFT', [item()], [file({ uploaded: false })], { persona: 'LO', action: 'SUBMIT' }, 'new')).toThrow('pending');
    expect(() => applyPracticeCommand('DRAFT', [item()], [], { persona: 'LO', action: 'SUBMIT' }, 'new')).toThrow('required');
    expect(() => applyPracticeCommand('DRAFT', [item()], [file()], { persona: 'LO', action: 'WAIVER', itemId: 'mortgage', text: 'N/A' }, 'new')).toThrow('Remove');
  });
  it('retires a pending or completed upload without deleting its history or source', () => {
    const originalFile = file({ uploaded: false });
    const result = applyPracticeCommand('DRAFT', [item({ review: 'APPROVED' })], [originalFile], { persona: 'LO', action: 'RETIRE_FILE', fileId: originalFile.id }, 'new');
    expect(result.retiredFileId).toBe('file'); expect(result.items[0].review).toBe('PENDING'); expect(originalFile.retired).toBe(false);
  });
  it('rejects malformed/duplicate categories', () => {
    expect(readPracticeItems(practiceInitialItems())).toHaveLength(6);
    expect(() => readPracticeItems([item(), item()])).toThrow();
    expect(() => readPracticeItems([{ ...item(), review: 'UNKNOWN' }])).toThrow();
  });
  it('requires exact private workspace ownership and file type in new storage paths', () => {
    const path = 'pilot-practice/owner/task/00000000-0000-0000-0000-000000000001.pdf';
    expect(() => assertPracticeUploadPath(path, 'owner', 'task', file())).not.toThrow();
    for (const bad of [path.replace('/owner/', '/other/'), path.replace('/task/', '/other/'), path.replace('.pdf', '.png'), path.replace('00000000-', '../00000000-')]) expect(() => assertPracticeUploadPath(bad, 'owner', 'task', file())).toThrow();
  });
});

describe('practice flat archive selection', () => {
  it('preserves multiple files and deduplicates globally, including Unicode and Windows names', () => {
    const files = [file(), file({ id: 'two', name: 'statement.PDF' }), file({ id: 'three', name: 'CON.pdf', itemId: 'extra' }), file({ id: 'four', name: 'Ｓｔａｔｅｍｅｎｔ.pdf' })];
    const selection = selectPracticeDocuments([item({ review: 'APPROVED' }), item({ id: 'extra', review: 'APPROVED' })], files);
    expect(selection.files.map(value => value.archivePath)).toEqual(['Statement.pdf', 'statement (2).PDF', 'Ｓｔａｔｅｍｅｎｔ (3).pdf', '_CON.pdf']);
    expect(selection.totalBytes).toBe(40); expect(selection.files.every(value => !value.archivePath.includes('/'))).toBe(true);
  });
  it('excludes pending, retired and correction-requested documents and blocks partial categories', () => {
    expect(() => selectPracticeDocuments([item({ review: 'APPROVED' })], [file(), file({ id: 'pending', uploaded: false })])).toThrow('no approved');
    expect(() => selectPracticeDocuments([item({ review: 'CHANGES' })], [file()])).toThrow('no approved');
    const result = selectPracticeDocuments([item({ review: 'APPROVED' })], [file(), file({ id: 'retired', retired: true })]);
    expect(result.files).toHaveLength(1);
  });
  it('enforces aggregate byte/count and per-file limits', () => {
    const items = [item({ review: 'APPROVED' })];
    expect(() => selectPracticeDocuments(items, [file({ size: 0 })])).toThrow();
    expect(() => selectPracticeDocuments(items, Array.from({ length: 11 }, (_, index) => file({ id: String(index), size: 20 * 1024 * 1024 })))).toThrow('200 MB');
    expect(() => selectPracticeDocuments(items, Array.from({ length: 301 }, (_, index) => file({ id: String(index) })))).toThrow('300');
  });
});
