import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { ActivePipelineDiagnosticRun } from '../../lib/ariveActivePipelineDiagnosticTypes';

vi.mock('@/app/actions/ariveActivePipelineDiagnosticActions', () => ({}));
import { ActivePipelineDiagnosticResults, activeDiagnosticCsv, activeDiagnosticCsvCell, continueActiveDiagnosticSequence } from './AriveActivePipelineDiagnostic';

function run(patch: Partial<ActivePipelineDiagnosticRun> = {}): ActivePipelineDiagnosticRun {
  return { id: 'diagnostic-test', status: 'READY', startedAt: '2026-11-17T18:00:00.000Z', finishedAt: null, total: 2,
    checked: 0, matched: 0, needsReview: 0, realTotal: 1, syntheticTotal: 1, realMatched: 0, syntheticMatched: 0,
    getRequests: 0, authenticationRequests: 0, retryAt: null, message: null, automaticSyncPaused: true,
    currentActiveCount: 2, addedSinceStart: 0, changedSinceStart: 0, rows: [], ...patch };
}

describe('active pipeline diagnostic execution', () => {
  it('processes one chunk at a time and stops after completion', async () => {
    let inflight = 0; let maximum = 0;
    const accept = vi.fn();
    const next = vi.fn(async () => {
      maximum = Math.max(maximum, ++inflight);
      await Promise.resolve(); --inflight;
      return { success: true as const, run: next.mock.calls.length === 1 ? run({ checked: 1 }) : run({ checked: 2, status: 'COMPLETE' }) };
    });
    await continueActiveDiagnosticSequence(run(), next, () => true, accept);
    expect(next).toHaveBeenCalledTimes(2); expect(maximum).toBe(1); expect(accept).toHaveBeenCalledTimes(2);
  });

  it('never sends requests for a stopped, deferred, leased, or unpaused check', async () => {
    const next = vi.fn();
    for (const saved of [run({ status: 'DEFERRED' }), run({ status: 'RUNNING' }), run({ status: 'COMPLETE' }), run({ automaticSyncPaused: false }), run({ retryAt: '2026-11-18T00:00:00Z' })]) {
      await continueActiveDiagnosticSequence(saved, next, () => true, vi.fn());
    }
    await continueActiveDiagnosticSequence(run(), next, () => false, vi.fn());
    expect(next).not.toHaveBeenCalled();
  });

  it('stops after cooldown and requires a separate explicit resume', async () => {
    const next = vi.fn(async () => ({ success: true as const, run: run({ status: 'DEFERRED', retryAt: '2026-11-18T00:00:00Z' }) }));
    const accept = vi.fn();
    await continueActiveDiagnosticSequence(run(), next, () => true, accept);
    expect(next).toHaveBeenCalledOnce(); expect(accept).toHaveBeenCalledOnce();
  });

  it('does not accept stale results or request another chunk after account change or pause', async () => {
    let allowed = true;
    const next = vi.fn(async () => { allowed = false; return { success: true as const, run: run({ checked: 1 }) }; });
    const accept = vi.fn();
    await continueActiveDiagnosticSequence(run(), next, () => allowed, accept);
    expect(next).toHaveBeenCalledOnce(); expect(accept).not.toHaveBeenCalled();
  });

  it('surfaces server authorization failures without retrying', async () => {
    const next = vi.fn(async () => ({ success: false as const, error: 'Your account is no longer authorized.' }));
    await expect(continueActiveDiagnosticSequence(run(), next, () => true, vi.fn())).rejects.toThrow('no longer authorized');
    expect(next).toHaveBeenCalledOnce();
  });

  it('does not loop forever or accept a different diagnostic when no progress is saved', async () => {
    const next = vi.fn(async () => ({ success: true as const, run: run() }));
    await expect(continueActiveDiagnosticSequence(run(), next, () => true, vi.fn())).rejects.toThrow('no progress');
    expect(next).toHaveBeenCalledOnce();
    await expect(continueActiveDiagnosticSequence(run(), async () => ({ success: true, run: run({ id: 'other-run' }) }), () => true, vi.fn())).rejects.toThrow('diagnostic changed');
  });
});

describe('diagnostic result delivery', () => {
  it('neutralizes spreadsheet formulas even after leading spaces or control characters', () => {
    for (const text of ['=HYPERLINK("bad")', '+SUM(1,1)', '-1+2', '@SUM(1,1)', '  =1+1', '\t=1+1', '\r\n@x', '\u0000=1+1']) {
      expect(activeDiagnosticCsvCell(text).startsWith('"\'')).toBe(true);
    }
    expect(activeDiagnosticCsvCell('A "quoted", name')).toBe('"A ""quoted"", name"');
    expect(activeDiagnosticCsvCell('17881588')).toBe('"17881588"');
    expect(activeDiagnosticCsvCell(null)).toBe('""');
  });

  it('exports every cohort row including pending and synthetic files without implying that they passed', () => {
    const saved = run({ rows: [
      { pipelineId: 'real', loanNumber: '1234', borrowerName: '=Unsafe formula', loanOfficer: 'Example LO', synthetic: false, outcome: 'PENDING', message: 'Not checked yet.', checkedAt: null, searchHttpStatus: null, detailHttpStatus: null, requestId: null },
      { pipelineId: 'test', loanNumber: '5678', borrowerName: 'Synthetic Borrower', loanOfficer: 'Example LO', synthetic: true, outcome: 'VERIFIED', message: 'Identity verified.', checkedAt: '2026-11-17T18:01:00Z', searchHttpStatus: 200, detailHttpStatus: 200, requestId: 'request-id' },
    ] });
    const csv = activeDiagnosticCsv(saved);
    expect(csv).toContain('"\'=Unsafe formula"'); expect(csv).toContain('"PENDING"'); expect(csv).toContain('"Synthetic test"');
    expect(csv.split('\r\n')).toHaveLength(3);
    const html = renderToStaticMarkup(createElement(ActivePipelineDiagnosticResults, { run: saved }));
    expect(html).toContain('Synthetic test'); expect(html).toContain('Pending'); expect(html).toContain('Verified');
    expect(html).toContain('Search: HTTP 200'); expect(html).toContain('Details: HTTP 200'); expect(html).not.toContain('request-id');
  });
});
