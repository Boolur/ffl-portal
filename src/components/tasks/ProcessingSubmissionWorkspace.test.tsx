import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import { initialPilotPackage } from '../../lib/submissionPilot';
import type { Task } from './TaskList';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn(), replace: vi.fn() }) }));
vi.mock('@/app/actions/submissionPilotActions', () => ({}));
vi.mock('@/app/actions/taskActions', () => ({}));
vi.mock('@/lib/submissionPilot', async () => import('../../lib/submissionPilot'));
vi.mock('@/lib/pilotReviewChecklist', async () => import('../../lib/pilotReviewChecklist'));
vi.mock('@/lib/pilotReviewLoader', () => ({ fetchPilotReview: vi.fn(), invalidatePilotReview: vi.fn() }));
vi.mock('@/lib/processingRouting', async () => import('../../lib/processingRouting'));
vi.mock('@/components/pipeline/BorrowerWorkspaceLayout', async () => import('../pipeline/BorrowerWorkspaceLayout'));
vi.mock('../pipeline/ArivePilotPanel', () => ({ ArivePilotConnection: () => null, ArivePackagePanel: () => null }));
import { SubmissionWorkspaceContent } from './ProcessingSubmissionWorkspace';
import { SubmissionPilot } from '../pipeline/SubmissionPilot';
import { WorkspacePanel } from '../pipeline/BorrowerWorkspaceLayout';

function fixture(locked = false) {
  const task = { id: 'test', title: 'Submit for Processing', status: 'IN_PROGRESS', assignedUser: { id: 'jr', name: 'Jordan Reviewer' }, loan: { borrowerName: 'Taylor Example', loanNumber: 'TEST-001', loanOfficer: { name: 'Example Loan Officer' } } } as Task;
  const p = initialPilotPackage(); p.state = 'REVIEW'; p.reviewerId = 'jr';
  p.items.forEach((item, index) => { item.files = [{ id: `file-${index}`, name: index === 1 ? 'Homeowners insurance renewal and coverage declaration 2026.pdf' : `${item.label.split(' / ')[0]}.pdf`, path: 'synthetic', type: 'application/pdf', size: 141000, uploadedAt: '' }]; });
  p.items[0].files.push({ ...p.items[0].files[0], id: 'second-statement', name: 'Second mortgage statement.pdf' });
  p.items[0].review = 'APPROVED';
  p.items[1].review = 'CHANGES'; p.items[1].feedback = 'Please provide the current renewal showing the updated property coverage.';
  p.items[4].files = []; p.items[4].waiver = 'Not a VA loan'; p.items[4].review = 'APPROVED';
  const rows = Object.entries({ borrowerPhone: '555-0100', borrowerEmail: 'taylor@example.test', loanAmount: '325000', lender: 'Example lender', loanType: 'Conventional', loanProgram: 'Purchase', propertyAddress: '100 Example Street, Sample City, CA' }).map(([key, value]) => ({ key, label: key, value }));
  return renderToStaticMarkup(<WorkspacePanel><header className="border-b border-slate-200 bg-white px-6 py-4"><h1 className="text-2xl font-black text-slate-950">Taylor Example</h1><p className="text-sm text-slate-500">Processing submission · In review</p></header><SubmissionWorkspaceContent task={task} rows={rows} method="In house" assignment="Example processing team" startGate={locked ? <button type="button">Start Processing Request</button> : undefined} conversation={<p>Earlier LO response and reviewer notes</p>} review={<SubmissionPilot requestTaskId="test" initialData={{ owner: false, canConfigureArive: false, ariveConfigured: false, userId: 'jr', loans: [], packages: [{ id: 'documents', loanId: 'loan', borrower: 'Taylor Example', loanNumber: 'TEST-001', package: p }] }} />}><p>Existing routing and activity</p></SubmissionWorkspaceContent></WorkspacePanel>);
}

describe('submission borrower workspace', () => {
  it('makes tabs and review controls inert until Start, with the start button outside the locked region', () => {
    const html = fixture(true);
    expect(html).toContain('inert=""');
    expect(html).toContain('aria-hidden="true"');
    expect(html).toContain('Start Processing Request');
    expect(html.indexOf('Start Processing Request')).toBeGreaterThan(html.indexOf('Existing routing and activity'));
    expect(fixture()).not.toContain('inert=""');
  });
  it('places documents first and orders the right sidebar as Ownership, File at a glance, Contact', () => {
    const html = fixture();
    expect(html).toContain('Submission Details');
    expect(html).toContain('aria-label="Conversation"');
    expect(html.slice(html.indexOf('<nav'), html.indexOf('</nav>'))).not.toContain('Conversation');
    expect(html.indexOf('aria-label="Conversation"')).toBeGreaterThan(html.indexOf('>Contact</h3>'));
    expect(html).toContain('<section aria-label="Conversation"');
    expect(html).toContain('Earlier LO response and reviewer notes');
    expect(html.indexOf('data-document-category')).toBeLessThan(html.indexOf('>Ownership</h3>'));
    expect(html.indexOf('>Ownership</h3>')).toBeLessThan(html.indexOf('>File at a glance</h3>'));
    expect(html.indexOf('>File at a glance</h3>')).toBeLessThan(html.indexOf('>Contact</h3>'));
    expect(html).not.toContain('Processing snapshot');
    expect(html).toContain('Approval saved');
    expect(html).toContain('2 attachments');
    expect(html).toContain('Second mortgage statement.pdf');
    expect(html.match(/data-file-tile=/g)).toHaveLength(6);
    expect(html).toContain('Document request saved');
    expect(html).toContain('N/A · verified');
    if (process.env.RENDER_SUBMISSION_WORKSPACE === '1') {
      mkdirSync('outputs/submission-workspace', { recursive: true });
      writeFileSync('outputs/submission-workspace/preview.html', `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="preview.css"></head><body class="bg-slate-200 p-4"><div class="flex justify-center">${html}</div><script>addEventListener('load',()=>{const cards=[...document.querySelectorAll('[data-document-category]')].slice(0,2);const metrics=cards.map(card=>Object.fromEntries(['[data-review-files]','[data-review-decision]','[data-file-tile]'].map(sel=>{const r=card.querySelector(sel)?.getBoundingClientRect();return [sel,r?{top:r.top,bottom:r.bottom,left:r.left,width:r.width}:null]})));const output=document.createElement('pre');output.id='layout-metrics';output.textContent=JSON.stringify(metrics);document.body.append(output);});</script></body></html>`);
    }
  });
});
