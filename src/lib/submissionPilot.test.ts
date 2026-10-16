import { describe, expect, it } from 'vitest';
import { isSubmissionPilotEnabled, isSubmissionPilotLoanOfficer, activeProcessingDocumentTaskId, processingDocumentTaskId, SUBMISSION_PILOT_LO_ID, initialPilotPackage, pilotApprovalError, pilotSubmissionError, readPilotPackage, validatePilotFile } from './submissionPilot';

function filledPackage() {
  const p = initialPilotPackage();
  p.items.forEach(i => { i.waiver = 'Not applicable to this loan; review required.'; });
  p.items[0].waiver = '';
  p.items[0].files = [{ id: 'file1', path: 'private/file1.pdf', name: 'statement.pdf', type: 'application/pdf', size: 100, uploadedAt: '2026-10-15T12:00:00Z' }];
  return p;
}
describe('processing submission pilot gates', () => {
  it('pauses enrollment and active task routing without deleting package links or history', () => {
    const p = initialPilotPackage();
    p.history.push({ at: '2026-10-16', actor: 'Test', message: 'Preserved' });
    const data = { processingDocumentTaskId: 'saved-documents', submissionPilot: p };
    const before = JSON.stringify(data);
    expect(isSubmissionPilotEnabled()).toBe(false);
    expect(isSubmissionPilotLoanOfficer(SUBMISSION_PILOT_LO_ID)).toBe(false);
    expect(activeProcessingDocumentTaskId(data)).toBeNull();
    expect(processingDocumentTaskId(data)).toBe('saved-documents');
    expect(readPilotPackage(data)).toBe(p);
    expect(JSON.stringify(data)).toBe(before);
  });
  it('does not recognize legacy tasks as pilot packages', () => {
    expect(readPilotPackage({ workflowVersion: 'processing-v1' })).toBeNull();
    expect(readPilotPackage(null)).toBeNull();
  });
  it('requires documents or a reason for every required category', () => {
    const p = filledPackage();
    expect(pilotSubmissionError(p)).toBeNull();
    p.items[1].waiver = '  ';
    expect(pilotSubmissionError(p)).toContain('required');
  });
  it('does not accept a package consisting only of waivers', () => {
    const p = filledPackage(); p.items[0].files = []; p.items[0].waiver = 'N/A';
    expect(pilotSubmissionError(p)).toContain('at least one');
  });
  it('blocks submission while an upload is unfinished', () => {
    const p = filledPackage(); p.items[0].pending = { path: 'new', name: 'new.pdf', size: 100, type: 'application/pdf' };
    expect(pilotSubmissionError(p)).toContain('pending uploads');
  });
  it('requires corrections to be resolved before resubmission', () => {
    const p = filledPackage(); p.state = 'CHANGES'; p.items[0].review = 'CHANGES';
    expect(pilotSubmissionError(p)).toContain('correction');
    p.items[0].review = 'PENDING'; expect(pilotSubmissionError(p)).toBeNull();
  });
  it('prevents draft approval and requires review of waivers and additional files', () => {
    const p = filledPackage(); expect(pilotApprovalError(p)).toContain('Submit');
    p.state = 'REVIEW'; p.items[0].review = 'APPROVED';
    expect(pilotApprovalError(p)).toContain('every');
    p.items.forEach(i => { i.review = 'APPROVED'; });
    expect(pilotApprovalError(p)).toBeNull();
    p.items.push({ ...p.items[0], id: 'additional', required: false, review: 'PENDING' });
    expect(pilotApprovalError(p)).toContain('every');
  });
  it('rejects double submission and changes after approval', () => {
    const p = filledPackage(); p.state = 'REVIEW'; expect(pilotSubmissionError(p)).toContain('not open');
    p.state = 'APPROVED'; expect(pilotSubmissionError(p)).toContain('not open');
    expect(pilotApprovalError(p)).toContain('Submit');
  });
  it('enforces supported file types, nonempty files and the size limit', () => {
    expect(() => validatePilotFile('income.PDF', 100, 'application/pdf')).not.toThrow();
    expect(() => validatePilotFile('script.html', 100, 'text/html')).toThrow();
    expect(() => validatePilotFile('income.pdf', 100, 'text/html')).toThrow();
    expect(() => validatePilotFile('income.pdf', 0, 'application/pdf')).toThrow();
    expect(() => validatePilotFile('income.pdf', 21 * 1024 * 1024, 'application/pdf')).toThrow();
  });
});
