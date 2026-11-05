import { afterEach, describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
vi.mock('@/lib/prisma', () => ({ prisma: {} }));
vi.mock('@/lib/ariveCrypto', () => ({ decryptAriveCredentials: vi.fn() }));
import { ariveSession } from './ariveClient';
import { ariveTestHistoryPreserved, buildAriveTestStageUpdate, parseAriveTestLoanStatus } from './ariveStatusTest';

function details() {
  return { ariveLoanId: 17881588, sysGUID: 'test-loan-guid', loanOriginatorEmail: 'matt@example.test',
    loanBorrowers: [{ applicantType: 'Borrower', firstName: 'TESTING', lastName: 'TESTER' }],
    currentLoanStatus: { status: 'APPLICATION_INTAKE', date: '2026-10-15' },
    loanStatusHistory: [{ status: 'APPLICATION_INTAKE', date: '2026-10-15' }],
  };
}
const parse = (value: unknown) => parseAriveTestLoanStatus(value, 'matt@example.test');
afterEach(() => vi.unstubAllGlobals());

describe('guarded Arive test stages', () => {
  it.each([
    { ariveLoanId: 123 }, { sysGUID: '' }, { loanOriginatorEmail: 'someoneelse@example.test' },
    { loanBorrowers: [{ applicantType: 'Borrower', firstName: 'Real', lastName: 'Borrower' }] },
    { loanBorrowers: [] },
  ])('rejects an identity mismatch: %j', patch => expect(() => parse({ ...details(), ...patch })).toThrow('did not confirm'));
  it('accepts harmless email and name casing/whitespace without loosening identity', () => {
    expect(parse({ ...details(), loanOriginatorEmail: ' Matt@Example.Test ', loanBorrowers: [{ applicantType: 'Borrower', firstName: ' Testing ', lastName: 'Tester' }] }).id).toBe('test-loan-guid');
  });
  it.each(['2026-02-30', 'not-a-date', '', '2026-13-01'])('rejects invalid history date %s', date => {
    expect(() => parse({ ...details(), loanStatusHistory: [{ status: 'APPLICATION_INTAKE', date }] })).toThrow('history');
  });
  it('rejects missing history, unknown stages, and adverse history rather than discarding it', () => {
    for (const loanStatusHistory of [null, [{ status: 'UNKNOWN_STAGE', date: '2026-10-15' }], [{ status: 'APPLICATION_INTAKE', date: '2026-10-15', adverseReason: 'WITHDRAWN' }]]) {
      expect(() => parse({ ...details(), loanStatusHistory })).toThrow();
    }
  });
  it('retains every previous stage/date, includes a missing current entry, and sets exactly one current flag', () => {
    const before = parse({ ...details(), loanStatusHistory: [] });
    const payload = buildAriveTestStageUpdate(before, 'APPLICATION_INTAKE', 'QUALIFICATION', '2026-11-05');
    expect(payload.loanStages).toEqual([
      { stage: 'APPLICATION_INTAKE', stageDate: '2026-10-15', current: false },
      { stage: 'QUALIFICATION', stageDate: '2026-11-05', current: true },
    ]);
  });
  it('returns to an earlier stage without replacing its historic date or losing duplicate history', () => {
    const before = parse({ ...details(), currentLoanStatus: { status: 'QUALIFICATION', date: '2026-11-05' }, loanStatusHistory: [
      ...details().loanStatusHistory, { status: 'APPLICATION_INTAKE', date: '2026-10-16' }, { status: 'QUALIFICATION', date: '2026-11-05' },
    ] });
    const payload = buildAriveTestStageUpdate(before, 'QUALIFICATION', 'APPLICATION_INTAKE', '2026-11-06');
    expect(payload.loanStages).toHaveLength(3);
    expect(payload.loanStages[0]).toEqual({ stage: 'APPLICATION_INTAKE', stageDate: '2026-10-15', current: false });
    expect(payload.loanStages[1]).toEqual({ stage: 'APPLICATION_INTAKE', stageDate: '2026-10-16', current: true });
    expect(payload.loanStages.filter(s => s.current)).toHaveLength(1);
  });
  it('blocks unsafe target/current stages, archives, stale expected stages, and no-op requests', () => {
    const before = parse(details());
    expect(() => buildAriveTestStageUpdate(before, before.stage, 'LOAN_FUNDED', '2026-11-05')).toThrow();
    expect(() => buildAriveTestStageUpdate({ ...before, stage: 'LOAN_FUNDED' }, 'LOAN_FUNDED', 'QUALIFICATION', '2026-11-05')).toThrow();
    expect(() => buildAriveTestStageUpdate({ ...before, archived: true }, before.stage, 'QUALIFICATION', '2026-11-05')).toThrow();
    expect(() => buildAriveTestStageUpdate(before, 'LOAN_SETUP', 'QUALIFICATION', '2026-11-05')).toThrow('changed');
    expect(() => buildAriveTestStageUpdate(before, before.stage, before.stage, '2026-11-05')).toThrow('different');
  });
  it('detects lost or changed historical entries even if the current stage is correct', () => {
    const before = parse(details());
    const after = { ...before, stage: 'QUALIFICATION', date: '2026-11-05', history: [...before.history, { stage: 'QUALIFICATION', date: '2026-11-05' }] };
    expect(ariveTestHistoryPreserved(before, after)).toBe(true);
    expect(ariveTestHistoryPreserved(before, { ...after, history: [{ stage: 'QUALIFICATION', date: '2026-11-05' }] })).toBe(false);
    expect(ariveTestHistoryPreserved(before, { ...after, history: [{ stage: 'APPLICATION_INTAKE', date: '2026-10-15T00:00:00.000Z' }] })).toBe(true);
  });
});

describe('PATCH transport', () => {
  it('sends PATCH with sync and bearer/API headers, preserving GET and POST defaults', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(Response.json({ AccessToken: 'synthetic-token' }, { status: 201 })).mockImplementation(() => Promise.resolve(Response.json({ ok: true })));
    vi.stubGlobal('fetch', fetcher);
    const api = await ariveSession({ clientId: 'synthetic', secret: 'synthetic', apiKey: 'synthetic-api' });
    const body = buildAriveTestStageUpdate(parse(details()), 'APPLICATION_INTAKE', 'QUALIFICATION', '2026-11-05');
    await api('/loans/test-loan-guid?sync=true', body, 'PATCH');
    await api('/loans/test-loan-guid');
    await api('/loans/test-loan-guid/documents', { fileId: 'file' });
    expect(fetcher.mock.calls[1][0]).toBe('https://gwapiconnect.myarive.com/api/loans/test-loan-guid?sync=true');
    expect(fetcher.mock.calls[1][1]).toMatchObject({ method: 'PATCH', body: JSON.stringify(body), redirect: 'error', headers: { Authorization: 'Bearer synthetic-token', 'X-API-KEY': 'synthetic-api' } });
    expect(fetcher.mock.calls[2][1].method).toBe('GET');
    expect(fetcher.mock.calls[3][1].method).toBe('POST');
  });
});
