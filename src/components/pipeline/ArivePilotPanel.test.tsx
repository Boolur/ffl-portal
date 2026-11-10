import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { initialPilotPackage } from '../../lib/submissionPilot';
vi.mock('@/lib/ariveNoteText', async () => import('../../lib/ariveNoteText'));
vi.mock('@/app/actions/submissionPilotActions', () => ({
  checkAriveTestLoanAccess: vi.fn(), configurePilotArive: vi.fn(), openArivePilotLoan: vi.fn(),
  refreshPilotAriveNotes: vi.fn(), getPilotAriveClassifications: vi.fn(), sendPilotDocumentToArive: vi.fn(),
}));
import { ArivePackagePanel } from './ArivePilotPanel';

function packageData() {
  const pkg = initialPilotPackage();
  pkg.state = 'APPROVED';
  pkg.ariveLink = { id: 'arive-test-id', loanNumber: '17881588' };
  pkg.ariveNotes = { syncedAt: '2026-11-10T18:00:00Z', notes: [{ id: 'note', text: '<p>Existing imported note</p>', author: 'Test processor', createdAt: '2026-11-10T17:00:00Z', updatedAt: '', replies: [] }] };
  pkg.items[0].files = [{ id: 'file', name: 'Synthetic Statement.pdf', type: 'application/pdf', size: 12, path: 'synthetic', uploadedAt: '' }];
  return pkg;
}

describe('document transfer without duplicate notes', () => {
  it('retains the existing combined panel by default', () => {
    const html = renderToStaticMarkup(<ArivePackagePanel taskId="package" pkg={packageData()} configured parentBusy={false} onChanged={async () => {}} />);
    expect(html).toContain('Arive documents and notes'); expect(html).toContain('Existing imported note');
    expect(html).toContain('Refresh notes from Arive'); expect(html).toContain('Load Arive classifications');
    expect(html).toContain('Edit notes in Arive');
  });
  it('hides note content and refresh controls while retaining approved-file transfer controls', () => {
    const html = renderToStaticMarkup(<ArivePackagePanel taskId="package" pkg={packageData()} configured parentBusy={false} onChanged={async () => {}} hideNotes />);
    expect(html).not.toContain('Arive documents and notes'); expect(html).not.toContain('Existing imported note');
    expect(html).not.toContain('Refresh notes from Arive'); expect(html).not.toContain('Notes refresh every minute');
    expect(html).toContain('Send approved documents'); expect(html).toContain('Load Arive classifications');
    expect(html).toContain('Synthetic Statement.pdf'); expect(html).toContain('Not sent');
  });
  it('keeps the approval and connection gates on document transfer', () => {
    const pkg = packageData(); pkg.state = 'REVIEW';
    const html = renderToStaticMarkup(<ArivePackagePanel taskId="package" pkg={pkg} configured={false} parentBusy={false} onChanged={async () => {}} hideNotes />);
    expect(html).toContain('Document transfer becomes available after Jr approval');
    expect(html).not.toContain('Load Arive classifications'); expect(html).not.toContain('Send to Arive');
    pkg.state = 'APPROVED';
    expect(renderToStaticMarkup(<ArivePackagePanel taskId="package" pkg={pkg} configured={false} parentBusy={false} onChanged={async () => {}} hideNotes />)).toContain('disabled=""');
  });
});
