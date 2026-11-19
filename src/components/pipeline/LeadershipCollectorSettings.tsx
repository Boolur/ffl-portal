'use client';
import { useCallback, useEffect, useState } from 'react';
import { configureLeadershipCollector, getLeadershipCollectorStatus } from '@/app/actions/ariveRolloutActions';

type Status = Extract<Awaited<ReturnType<typeof getLeadershipCollectorStatus>>, { success: true }>;

export function LeadershipCollectorSettings() {
  const [status, setStatus] = useState<Status | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [firstLoan, setFirstLoan] = useState('');
  const refresh = useCallback(async () => {
    const result = await getLeadershipCollectorStatus();
    if (result.success) setStatus(result);
    else { setStatus(null); setError(result.error); }
  }, []);
  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => { if (!document.hidden) void refresh(); }, 15_000);
    return () => window.clearInterval(timer);
  }, [refresh]);
  async function configure(enabled: boolean, cohortLimit: number | null) {
    setBusy(true);
    setError('');
    try {
      const result = await configureLeadershipCollector({ enabled, cohortLimit,
        ...(enabled && !status?.enabled && cohortLimit === 10 && firstLoan.trim() && { firstLoanNumber: firstLoan.trim() }) });
      if (!result.success) setError(result.error);
      await refresh();
    } catch { setError('Could not load the collector. Refresh to check its saved status.'); }
    finally { setBusy(false); }
  }
  return <section className="app-surface-card space-y-3 p-5" aria-label="Leadership Pilot collection">
    <h2 className="text-lg font-semibold">Leadership Pilot collection</h2>
    {status && <>
      <p>{status.enabled ? 'Collecting' : 'Paused'} · {status.limit === null ? 'All verified files' : 'Cohort of ' + status.limit}</p>
      <dl className="grid gap-3 text-sm sm:grid-cols-3">
        {Object.entries({ 'Files eligible for Pilot verification': status.coverage.eligible,
          'Verified files': status.coverage.verified, 'Pending verification': status.coverage.pending,
          'Waiting for a cohort opening': status.coverage.waiting, 'Arive access denied': status.coverage.inaccessible,
          'Other matches needing review': status.coverage.review, 'Excluded practice files': status.coverage.excluded,
          'Verified active files checked in the past minute': `${status.coverage.activeFresh} / ${status.coverage.verifiedActive}`,
          'Verified funded or archived files checked in the past hour': `${status.coverage.quietFresh} / ${status.coverage.verifiedQuiet}`,
          'Requests completed per minute': status.requests,
          'Throttled requests in the past minute': status.throttled, 'Oldest overdue verified refresh': status.coverage.oldestDueSeconds + ' s',
          'Arive response time (p95)': status.p95Ms === null ? 'No recent sample' : status.p95Ms + ' ms',
          'Total time per reserved request (p95)': status.reservedP95Ms === null ? 'No recent sample' : status.reservedP95Ms + ' ms',
          'Limit reported by Arive': status.reportedPerMinute ? status.reportedPerMinute + ' per minute' : 'No header received',
          'Provider allowance': status.providerLimit ? status.providerLimit + ' per ' + status.providerWindow + ' s' : 'Unconfirmed',
          'Timed changes shown in 24 hours': status.display.measured,
          'Displays without a verified change time': status.display.unknown,
          'Timed displays over 60 seconds': status.display.late,
          'Longest source-to-screen delay': status.display.worstSeconds === null ? 'No timed changes yet' : status.display.worstSeconds + ' s',
          'Longest collection-to-screen delay': status.display.afterCollectionSeconds === null ? 'No display receipts yet' : status.display.afterCollectionSeconds + ' s',
        }).map(([label, value]) =>
          <div key={label}><dt className="text-muted-foreground">{label}</dt><dd className="font-semibold">{value}</dd></div>)}
      </dl>
      {status.cooldownUntil && new Date(status.cooldownUntil) > new Date() && <p>Arive requested a pause until {new Date(status.cooldownUntil).toLocaleTimeString()}.</p>}
      {!status.enabled && status.limit === 10 && <label className="block text-sm">
        First file to check (optional Arive #)
        <input value={firstLoan} onChange={event => setFirstLoan(event.target.value)} inputMode="numeric" maxLength={15}
          className="ml-2 rounded border border-border bg-background px-2 py-1" />
      </label>}
      <div className="flex flex-wrap gap-2">
        {!status.enabled && <button className="app-btn-primary" disabled={busy} onClick={() => void configure(true, status.limit)}>{status.limit === null ? 'Resume all verified files' : 'Start ' + status.limit + '-file Pilot'}</button>}
        {status.enabled && status.limit !== null && <button className="app-btn-secondary" disabled={busy} onClick={() => void configure(true, status.limit === 10 ? 50 : null)}>{status.limit === 10 ? 'Expand to 50 files' : 'Expand to all verified files'}</button>}
        {status.enabled && <button className="app-btn-secondary" disabled={busy} onClick={() => void configure(false, status.limit)}>Pause Pilot collection</button>}
      </div>
    </>}
    {error && <p role="alert">{error}</p>}
  </section>;
}
