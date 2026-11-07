import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PipelineMilestoneRow, PipelineReport } from '@/app/actions/pipelineReportingActions';

const loading = vi.hoisted(() => ({ report: false, deferredSearch: null as string | null }));
vi.mock('react', async () => {
  const original = await vi.importActual<typeof import('react')>('react');
  return {
    ...original,
    useTransition: () => [loading.report, vi.fn()],
    useDeferredValue: (value: string) => loading.deferredSearch ?? value,
  };
});
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock('@/app/actions/leaderboardActions', () => ({ actionPendingStpLoan: vi.fn() }));
vi.mock('@/app/actions/pipelineReportingActions', () => ({ getPipelineReport: vi.fn() }));
vi.mock('@/app/actions/taskActions', () => ({ getSubmissionPrefillContext: vi.fn() }));
vi.mock('@/components/loanOfficer/NewTaskModal', () => ({ NewTaskModal: () => null }));
vi.mock('@/components/layout/PortalLoadingState', async () => import('../layout/PortalLoadingState'));
vi.mock('@/lib/portalLiveUpdates', () => ({ publishPortalUpdates: vi.fn(), subscribePortalUpdates: vi.fn() }));
vi.mock('@/lib/pipelineWorkspaceCache', () => ({ pipelineWorkspaceCacheRevision: () => 0 }));
import { PipelinePage } from './PipelinePage';

const borrower: PipelineMilestoneRow = {
  id: 'loan-1', loanId: 'loan-1', milestone: 'plusOne', milestoneLabel: '+1',
  borrowerName: 'Mindy Example', loanNumber: '12345', loanOfficerName: 'Officer',
  amount: 200000, revenue: null, leadSource: null, lender: null, status: 'ACTIVE',
  occurredAt: '2026-11-06T12:00:00Z', sharedLoanOfficerNames: [], updateSignal: null,
  availableSubmissions: { disclosures: false, processing: false },
  fileDetails: {
    loan: { borrowerPhone: null, borrowerEmail: null, program: null, propertyAddress: null, stage: null, createdAt: null, updatedAt: null },
    task: null, payroll: null,
  },
};
const report: PipelineReport = {
  filters: { preset: 'daily', startDate: '2026-11-06', endDate: '2026-11-06', loanOfficerId: 'all', trendPreset: 'daily', trendStartDate: '2026-11-06', trendEndDate: '2026-11-06' },
  canViewAll: false, loanOfficers: [], summary: [],
  totals: { plusOne: 1, disclosures: 0, pendingStp: 0, processing: 0, fundings: 0 },
  pullThroughRate: null,
  boardMetrics: {
    plusOne: { volumeTotal: 200000, revenueTotal: 0 },
    disclosures: { volumeTotal: 0, units: 0 },
    pendingStp: { volumeTotal: 0, units: 0 },
    processing: { volumeTotal: 0, revenueTotal: 0 },
    fundings: { volumeTotal: 0, revenueTotal: 0 },
  },
  trend: [], teamRows: [], lenderRows: [], leadSourceRows: [], recentRows: [],
  bucketRows: { plusOne: [borrower], disclosures: [], pendingStp: [], processing: [], fundings: [] },
};
const render = () => renderToStaticMarkup(<PipelinePage initialReport={report} submissionConfig={null} />);

beforeEach(() => { loading.report = false; loading.deferredSearch = null; });

describe('Pre-Processing loading feedback', () => {
  it('renders ready cards immediately without an artificial search loading state', () => {
    const html = render();
    expect(html).toContain('Mindy Example');
    expect(html).toContain('1 visible client');
    expect(html).not.toContain('Filtering clients');
    expect(html).not.toContain('Loading...');
  });

  it('keeps the previous cards and usable search while a local filter catches up', () => {
    loading.deferredSearch = 'mindy';
    const html = render();
    expect(html).toContain('Mindy Example');
    expect(html).toContain('Filtering clients');
    expect(html.match(/role="status"/g)).toHaveLength(1);
    const input = html.match(/<input[^>]*aria-label="Search pipeline clients"[^>]*>/)?.[0];
    expect(input).toBeDefined();
    expect(input).not.toContain('disabled');
    expect(html).not.toContain('Searching this bucket.');
  });

  it('keeps loaded cards visible during a server refresh and uses one nonblocking shared status', () => {
    loading.report = true;
    const html = render();
    expect(html).toContain('Mindy Example');
    expect(html).toContain('Updating pipeline');
    expect(html).toContain('pointer-events-none absolute inset-x-3 top-3');
    expect(html.match(/role="status"/g)).toHaveLength(1);
  });
});
