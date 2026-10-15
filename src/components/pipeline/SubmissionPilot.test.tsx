import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { initialPilotPackage } from '../../lib/submissionPilot';
vi.mock('@/lib/submissionPilot', async () => import('../../lib/submissionPilot'));
vi.mock('@/lib/pilotReviewLoader', () => ({ fetchPilotReview: vi.fn(), invalidatePilotReview: vi.fn() }));
vi.mock('@/lib/pilotReviewChecklist', async () => import('../../lib/pilotReviewChecklist'));
vi.mock('@/lib/processingRouting', async () => import('../../lib/processingRouting'));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn(), replace: vi.fn() }) }));
vi.mock('@/app/actions/submissionPilotActions', () => ({}));
vi.mock('@/app/actions/taskActions', () => ({}));
vi.mock('./ArivePilotPanel', () => ({ ArivePilotConnection: () => null, ArivePackagePanel: () => null }));
vi.mock('./PilotDocumentFile', () => ({ PilotDocumentFile: () => <span>Attached file</span> }));
import { SubmissionPilot } from './SubmissionPilot';

describe('integrated document checklist', () => {
  function render(reviewerId: string | null) {
    const p = initialPilotPackage(); p.state = 'REVIEW'; p.reviewerId = reviewerId;
    p.items[0].review = 'APPROVED'; p.items[0].waiver = 'Not applicable';
    p.items[1].files = [{ id: 'file', name: 'insurance.pdf', path: 'test', type: 'application/pdf', size: 12, uploadedAt: '' }];
    return renderToStaticMarkup(<SubmissionPilot requestTaskId="request" initialData={{ owner: false, canConfigureArive: false, ariveConfigured: false, userId: 'jr', loans: [], packages: [{ id: 'documents', loanId: 'loan', borrower: 'Test Borrower', loanNumber: 'TEST', package: p }] }} />);
  }
  it('gives the LO a multi-file drop area for requested documents', () => {
    const p = initialPilotPackage(); p.state = 'CHANGES';
    p.items.push({ id: 'bank', label: 'Bank statement', required: false, files: [], waiver: '', review: 'CHANGES', feedback: 'Please upload the latest statement.' });
    const html = renderToStaticMarkup(<SubmissionPilot requestTaskId="request" initialData={{ owner: true, canConfigureArive: false, ariveConfigured: false, userId: 'lo', loans: [], packages: [{ id: 'documents', loanId: 'loan', borrower: 'Test Borrower', loanNumber: 'TEST', package: p }] }} />);
    expect(html).toContain('Upload Bank statement: drag documents here or click to browse');
    expect(html).toContain('Drag documents here');
    expect(html).toContain('or click to browse');
    expect(html).toContain('multiple=""');
    expect(html).toContain('border-dashed');
    expect(html).toContain('Please upload the latest statement.');
  });
  it('renders attached files, N/A verification, and one final decision instead of a second checklist', () => {
    const html = render('jr');
    expect(html).toContain('Attached file');
    expect(html).toContain('N/A · verified');
    expect(html).toContain('Approval saved');
    expect(html).toContain('Edit decision for Mortgage statement / mortgage documents');
    expect(html).not.toContain('Review Mortgage statement / mortgage documents</legend>');
    expect(html).toContain('Approve &amp; complete Processing');
    expect(html).toContain('Reject submission');
    expect(html).not.toContain('Processing Action Checklist');
    expect(html).not.toContain('Approve package');
  });
  it('shows locked review controls before Start rather than hiding the reviewer experience', () => {
    const html = render(null);
    expect(html).toContain('Read-only until you start');
    expect(html).toContain('<fieldset disabled=""');
    expect(html).toContain('Request document / correction');
  });
});
