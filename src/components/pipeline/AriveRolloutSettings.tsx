'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { CheckCircle2, Clock3, FlaskConical, Loader2, Pause, RefreshCw, ShieldCheck } from 'lucide-react';
import {
  configureAriveRollout,
  configureAriveRolloutOperatorBudget,
  configureAriveRolloutRequestAllowance,
  enrollAriveRolloutFiles,
  getAriveRolloutInventory,
  getAriveRolloutReview,
  getAriveRolloutStatus,
  inspectAriveReportedAllowance,
  measureAriveTestReadTiming,
  queueAriveRolloutRefresh,
  setAriveRolloutLoanEnabled,
  transferLegacyAriveRolloutFile,
  verifyAndEnrollExistingAriveLoan,
} from '@/app/actions/ariveRolloutActions';

type Status = Extract<Awaited<ReturnType<typeof getAriveRolloutStatus>>, { success: true }>;
type Inventory = Extract<Awaited<ReturnType<typeof getAriveRolloutInventory>>, { success: true }>;
type Review = Extract<Awaited<ReturnType<typeof getAriveRolloutReview>>, { success: true }>;
type Timing = Extract<Awaited<ReturnType<typeof measureAriveTestReadTiming>>, { success: true }>['timing'];
type Controls = { collectionEnabled: boolean; applicationEnabled: boolean; enrollmentEnabled: boolean; cohortLimit: 10 | 50 | null };
type Success = { success: true; queued?: boolean; applied?: boolean; collected?: boolean; changed?: boolean; scanned?: number; verified?: number; review?: number };
type Result = Success | { success: false; error: string };
const initialControls: Controls = { collectionEnabled: false, applicationEnabled: false, enrollmentEnabled: false, cohortLimit: 10 };
const record = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
const display = (value: unknown) => value === null || value === undefined || value === '' ? 'Not supplied' : typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean' ? String(value) : 'Saved value';
const words = (value: string) => value.replace(/([a-z])([A-Z])/g, '$1 $2').replaceAll('_', ' ').replace(/^./, letter => letter.toUpperCase());
const when = (value: string | Date | null | undefined) => value ? new Date(value).toLocaleString() : 'Not yet';
const secondary = 'app-btn-secondary !h-9 !px-3 !text-xs disabled:cursor-not-allowed disabled:opacity-50';

export function ariveRolloutRefreshFeedback(result: Success): string {
  if (result.applied) {
    if (result.changed === true) return 'Arive checked. Updated values have been applied to the live BISU file.';
    if (result.changed === false) return 'Arive checked. The live BISU file was already up to date.';
    return 'Arive checked. The synchronized values are saved in the live BISU file.';
  }
  if (result.collected) return 'Arive checked. The new snapshot is saved for review; applying updates to live loans is paused.';
  if (result.queued) return 'Refresh queued. It will run when the shared request budget and file lease are available.';
  return 'Refresh request finished. Review the latest collection and application timestamps below.';
}

export function ariveRolloutEnrollmentFeedback(result: Success): string {
  if ([result.scanned, result.verified, result.review].every(value => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0)) return `${result.scanned} files checked · ${result.verified} verified · ${result.review} need review. Existing verified files may be included in the checked count.`;
  return 'Identity check finished. Review the resulting enrollment status and exceptions below.';
}

export function ariveRolloutBudgetDescription(transport: { allowanceSource?: string | null; providerRequestLimit?: number | null; operatorRequestLimit?: number | null; allowance?: number | null; windowSeconds?: number | null }): string {
  if (transport.allowanceSource === 'OPERATOR_AUTHORIZED') return `Operator-authorized cap: ${transport.operatorRequestLimit ?? transport.allowance ?? 'not configured'} requests per minute. Arive’s provider allowance is unconfirmed.`;
  if (transport.allowanceSource === 'PROVIDER_CONFIRMED' || !transport.allowanceSource && transport.providerRequestLimit != null) return `Provider-confirmed allowance: ${transport.providerRequestLimit ?? 'not configured'} requests per ${transport.windowSeconds ?? 'unconfigured'}-second window. BISU reserves at most 80%.`;
  return 'No request budget is configured.';
}

export function AriveRolloutSettings() {
  const [status, setStatus] = useState<Status | null>(null);
  const [inventory, setInventory] = useState<Inventory | null>(null);
  const [controls, setControls] = useState<Controls>(initialControls);
  const [requestLimit, setRequestLimit] = useState('');
  const [windowSeconds, setWindowSeconds] = useState('');
  const [allowRequests, setAllowRequests] = useState(false);
  const [confirmedAllowance, setConfirmedAllowance] = useState(false);
  const [operatorRequestLimit, setOperatorRequestLimit] = useState('120');
  const [allowOperatorRequests, setAllowOperatorRequests] = useState(false);
  const [review, setReview] = useState<{ loanNumber: string; value: Review } | null>(null);
  const [timing, setTiming] = useState<Timing | null>(null);
  const [busy, setBusy] = useState('');
  const [loading, setLoading] = useState(true);
  const [feedback, setFeedback] = useState<{ error: boolean; text: string } | null>(null);
  const [page, setPage] = useState<{ cursor?: string; previous: (string | undefined)[] }>({ previous: [] });
  const [candidatePage, setCandidatePage] = useState<{ cursor?: string; previous: (string | undefined)[] }>({ previous: [] });
  const alive = useRef(false);
  const locked = useRef(false);
  const firstLoad = useRef(true);
  const loadVersion = useRef(0);

  const load = useCallback(async () => {
    const version = ++loadVersion.current;
    const [nextStatus, nextInventory] = await Promise.all([
      getAriveRolloutStatus({ cursor: page.cursor }),
      getAriveRolloutInventory({ cursor: candidatePage.cursor }),
    ]);
    if (!alive.current || version !== loadVersion.current) return;
    if (!nextStatus.success || !nextInventory.success) {
      // A revoked account/role must not leave previously authorized records visible.
      setStatus(null); setInventory(null); setReview(null); setTiming(null);
      throw new Error(!nextStatus.success ? nextStatus.error : !nextInventory.success ? nextInventory.error : 'Unable to load rollout status.');
    }
    setStatus(nextStatus);
    setInventory(nextInventory);
    if (firstLoad.current) {
      firstLoad.current = false;
      setControls({ ...nextStatus.control, cohortLimit: nextStatus.control.cohortLimit as 10 | 50 | null });
      setRequestLimit(nextStatus.transport.providerRequestLimit?.toString() ?? '');
      setWindowSeconds(nextStatus.transport.windowSeconds?.toString() ?? '');
      setAllowRequests(nextStatus.transport.enabled);
      setOperatorRequestLimit(nextStatus.transport.operatorRequestLimit?.toString() ?? '120');
      setAllowOperatorRequests(nextStatus.transport.allowanceSource === 'OPERATOR_AUTHORIZED' && nextStatus.transport.enabled);
    }
  }, [page.cursor, candidatePage.cursor]);

  useEffect(() => {
    alive.current = true;
    setLoading(true);
    void load().catch(error => {
      if (alive.current) setFeedback({ error: true, text: error instanceof Error ? error.message : 'Unable to load Arive rollout status.' });
    }).finally(() => { if (alive.current) setLoading(false); });
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible' && !locked.current) void load().catch(() => { /* Keep the last complete status. */ });
    }, 30_000);
    return () => { alive.current = false; window.clearInterval(timer); };
  }, [load]);

  const perform = async (label: string, work: () => Promise<Result>, message: string | ((result: Success) => string)) => {
    if (locked.current) return;
    locked.current = true;
    setBusy(label);
    setFeedback(null);
    try {
      const result = await work();
      if (!alive.current) return;
      if (!result.success) throw new Error(result.error);
      await load();
      if (alive.current) setFeedback({ error: false, text: typeof message === 'function' ? message(result) : message });
    } catch (error) {
      if (alive.current) setFeedback({ error: true, text: error instanceof Error ? error.message : 'Unable to complete this action. Please try again.' });
    } finally {
      locked.current = false;
      if (alive.current) setBusy('');
    }
  };

  const refreshStatus = () => perform('Refreshing status', async () => ({ success: true }), 'Status refreshed from BISU. No new Arive request was made.');
  const openReview = (pipelineId: string, loanNumber: string) => perform('Loading review', async () => {
    const result = await getAriveRolloutReview({ pipelineId });
    if (result.success && alive.current) setReview({ loanNumber, value: result });
    return result;
  }, 'Saved collection review loaded.');
  const inspectAllowance = () => perform('Checking Arive-reported limit', async () => {
    const result = await inspectAriveReportedAllowance();
    if (!result.success) return result;
    if (!result.providerRequestLimit) return { success: false as const, error: result.message };
    if (alive.current) {
      setRequestLimit(String(result.providerRequestLimit));
      setWindowSeconds(String(result.providerWindowSeconds));
      setConfirmedAllowance(false);
    }
    return result;
  }, 'Arive’s reported allowance filled the form. Review and save it before activating shared requests.');
  const measureTiming = () => perform('Measuring TESTING TESTER response times', async () => {
    const result = await measureAriveTestReadTiming();
    if (result.success && alive.current) setTiming(result.timing);
    return result;
  }, 'Bounded timing sample finished. This measures response time; it does not establish an approved request allowance or activate synchronization.');
  const totals = status?.counts.reduce((sum, group) => {
    sum.enrolled += group._count._all;
    if (group.enabled) sum.enabled += group._count._all;
    if (group.enrollmentStatus !== 'VERIFIED') sum.review += group._count._all;
    return sum;
  }, { enrolled: 0, enabled: 0, review: 0 });

  return (
    <section aria-label="Arive pipeline rollout" className="app-surface-card space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div><h2 className="flex items-center gap-2 text-lg font-bold"><RefreshCw className="h-5 w-5 text-primary" />Live pipeline synchronization</h2><p className="mt-1 max-w-2xl text-sm text-muted-foreground">Arive updates enrolled real loans for everyone, in Standard and Pilot modes. Assignment, payroll, and financial approvals stay in BISU.</p></div>
        <button type="button" className={secondary} disabled={Boolean(busy) || loading} onClick={() => void refreshStatus()}><RefreshCw className="h-3.5 w-3.5" />Refresh status</button>
      </div>
      {(loading || busy) && <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />{busy || 'Loading integration status…'}</p>}
      {feedback && <p role={feedback.error ? 'alert' : 'status'} className={`rounded-xl border p-3 text-sm ${feedback.error ? 'border-red-200 bg-red-50 text-red-800 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300' : 'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-300'}`}>{feedback.text}</p>}
      {status && inventory && <>
        <div className="grid gap-3 sm:grid-cols-3">
          <Metric title="Enabled loans" value={totals?.enabled ?? 0} detail={`${totals?.enrolled ?? 0} enrollment records`} />
          <Metric title="Matching exceptions" value={totals?.review ?? 0} detail="These loans do not apply Arive updates" />
          <Metric title="Latest successful update" value={when(status.freshness._max.lastSuccessAt)} detail={`Oldest enabled update: ${when(status.freshness._min.lastSuccessAt)}`} />
        </div>
        <div className="flex flex-wrap gap-2 text-xs">
          <Flag label="Rollout deployment" enabled={inventory.gates.rollout} />
          <Flag label="Shared API budget" enabled={inventory.gates.sharedTransport} />
          <Flag label="Collecting" enabled={status.control.collectionEnabled} />
          <Flag label="Applying to live loans" enabled={status.control.applicationEnabled} />
        </div>
        <p className="text-xs leading-relaxed text-muted-foreground">Active-loan refresh target: {inventory.targets.activeSeconds} seconds. Recent Fundings and sync-archived files: {inventory.targets.quietSeconds / 60} minutes. The timestamps show actual freshness; capacity limits or Arive errors can delay a check.</p>
        {(!inventory.gates.rollout || !inventory.gates.sharedTransport) && <p className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200">Broad synchronization is not activated in this deployment. Saving a request allowance does not activate it.{inventory.tests.some(test => test.kind === 'LEGACY') && ' Existing TESTING TESTER synchronization uses its current separate control until cutover.'}</p>}

        <section aria-label="Operator-authorized rollout cap" className="space-y-3 rounded-xl border border-border bg-background/50 p-4">
          <h3 className="text-sm font-semibold">Operator-authorized rollout cap</h3>
          <p className="text-xs leading-relaxed text-muted-foreground">An Admin III can authorize a bounded rollout before Arive confirms its allowance. This is a BISU request cap, not a provider-confirmed quota. Authentication, loan reads, retries, and manual refreshes share the cap and two concurrent requests. Arive throttling pauses requests and reduces this cap automatically.</p>
          <p role="status" className="rounded-lg border border-border p-3 text-xs font-medium">{ariveRolloutBudgetDescription(status.transport)}</p>
          <form className="space-y-3" onSubmit={event => {
            event.preventDefault();
            void perform('Saving operator request cap', () => configureAriveRolloutOperatorBudget({ requestsPerMinute: Number(operatorRequestLimit), enabled: allowOperatorRequests }), 'Operator-authorized cap saved. It does not confirm Arive’s allowance or activate collection/application by itself.');
          }}>
            <label className="block max-w-sm text-xs font-medium">Operator requests per minute<input className="app-input mt-1" type="number" min="10" max="600" step="1" required value={operatorRequestLimit} onChange={event => setOperatorRequestLimit(event.target.value)} disabled={Boolean(busy)} /></label>
            <label className="flex items-start gap-2 text-xs"><input type="checkbox" className="mt-0.5 accent-blue-600" checked={allowOperatorRequests} onChange={event => setAllowOperatorRequests(event.target.checked)} disabled={Boolean(busy)} />Enable shared requests within this operator cap</label>
            <button type="submit" className="app-btn-primary !h-9 !text-xs" disabled={Boolean(busy)}>Save operator cap</button>
          </form>
          {status.transport.allowanceSource === 'OPERATOR_AUTHORIZED' && <p className="text-xs text-muted-foreground">Current effective cap: {status.transport.operatorRequestLimit ?? status.transport.allowance ?? 'Not configured'} per minute. The saved value updates here after automatic backoff; editing the form does not change it until saved.</p>}
        </section>

        <details className="rounded-xl border border-border bg-background/50 p-4" open={!status.transport.enabled || undefined}>
          <summary className="cursor-pointer text-sm font-semibold">Branch API request allowance</summary>
          <p className="mt-2 text-xs leading-relaxed text-muted-foreground">Use the allowance confirmed by Arive for this branch API key. BISU reserves at most 80% of it, shared by authentication, loan reads, retries, and manual refreshes. There is no assumed default.</p>
          <button type="button" className={`${secondary} mt-3`} disabled={Boolean(busy)} onClick={() => void inspectAllowance()}><ShieldCheck className="h-3.5 w-3.5" />Check Arive-reported limit</button>
          <button type="button" className={`${secondary} ml-2 mt-3`} disabled={Boolean(busy) || inventory.gates.sharedTransport} onClick={() => void measureTiming()}><Clock3 className="h-3.5 w-3.5" />Measure test-file response time</button>
          <p className="mt-2 text-xs text-muted-foreground">The timing sample makes at most 12 sequential reads on TESTING TESTER, stops on the first error, and is limited to one run per ten minutes. It changes no loan values.</p>
          {timing && <div role="status" className="mt-3 rounded-xl border border-border p-3 text-xs leading-relaxed">
            <p className="font-semibold">Sample taken {when(timing.checkedAt)}</p>
            <p>{timing.completedRequests} successful reads · {timing.completedCycles} complete cycles · median {timing.medianRequestMs ?? '—'} ms · 95th percentile {timing.p95RequestMs ?? '—'} ms</p>
            {timing.apiOnlySweepEstimateSeconds !== null && <p>At these observed response times, {timing.activeLoans} active Pipeline and Restructures files need approximately {timing.apiOnlySweepEstimateSeconds} seconds of API time per full sweep with two concurrent requests. Authentication, database work, pagination, cron timing and quota delays add time.</p>}
            <p>This small test measures latency, not sustained capacity or the branch’s approved limit.</p>
            {timing.error && <p className="mt-1 text-red-700 dark:text-red-300">Sample stopped: {timing.error}</p>}
          </div>}
          <form className="mt-4 space-y-3" onSubmit={event => {
            event.preventDefault();
            if (!confirmedAllowance) return;
            void perform('Saving request allowance', () => configureAriveRolloutRequestAllowance({ providerRequestLimit: Number(requestLimit), providerWindowSeconds: Number(windowSeconds), enabled: allowRequests }), 'Provider-confirmed allowance saved. Deployment and collection controls remain separate.');
          }}>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="text-xs font-medium">Confirmed requests per window<input className="app-input mt-1" type="number" min="2" step="1" required value={requestLimit} onChange={event => { setRequestLimit(event.target.value); setConfirmedAllowance(false); }} disabled={Boolean(busy)} placeholder="Enter Arive’s confirmed limit" /></label>
              <label className="text-xs font-medium">Window length in seconds<input className="app-input mt-1" type="number" min="1" step="1" required value={windowSeconds} onChange={event => { setWindowSeconds(event.target.value); setConfirmedAllowance(false); }} disabled={Boolean(busy)} placeholder="Enter the confirmed window" /></label>
            </div>
            <label className="flex items-start gap-2 text-xs"><input type="checkbox" className="mt-0.5 accent-blue-600" checked={allowRequests} onChange={event => setAllowRequests(event.target.checked)} disabled={Boolean(busy)} />Enable shared requests within this allowance</label>
            <label className="flex items-start gap-2 text-xs"><input type="checkbox" className="mt-0.5 accent-blue-600" checked={confirmedAllowance} onChange={event => setConfirmedAllowance(event.target.checked)} disabled={Boolean(busy)} />Arive has confirmed these values for the current branch API key.</label>
            <button type="submit" className="app-btn-primary !h-9 !text-xs" disabled={Boolean(busy) || !confirmedAllowance}>Save confirmed allowance</button>
          </form>
        </details>
        <div className="grid gap-3 sm:grid-cols-3">
          <Metric title="API budget remaining" value={status.transport.remaining === null ? status.transport.allowance === null ? 'Not configured' : 'Not active' : `${status.transport.remaining} / ${status.transport.allowance}`} detail={status.transport.windowSeconds ? `${status.transport.allowanceSource === 'OPERATOR_AUTHORIZED' ? 'Operator cap' : 'Provider allowance'} · Per ${status.transport.windowSeconds}-second window` : 'Choose an authorized request budget'} />
          <Metric title="Requests in progress" value={status.transport.activeRequests === null ? 'Not active' : `${status.transport.activeRequests} / 2`} detail="Shared across all running workers" />
          <Metric title="Next API availability" value={status.transport.ready ? 'Ready' : when(status.transport.nextAvailableAt)} detail={status.transport.reason || 'Requests use the shared queue'} />
        </div>

        <form className="space-y-4 rounded-xl border border-border p-4" onSubmit={event => { event.preventDefault(); void perform('Saving collection settings', () => configureAriveRollout(controls), 'Collection settings saved. In-flight reads respect the new settings.'); }}>
          <div className="flex flex-wrap items-center justify-between gap-3"><h3 className="text-sm font-semibold">Collection and application</h3><label className="flex items-center gap-2 text-xs">Live cohort<select className="app-input !h-9 !w-auto !py-1" aria-label="Live cohort" value={controls.cohortLimit ?? 'all'} disabled={Boolean(busy)} onChange={event => setControls(value => ({ ...value, cohortLimit: event.target.value === 'all' ? null : Number(event.target.value) as 10 | 50 }))}><option value="10">First 10 verified loans</option><option value="50">First 50 verified loans</option><option value="all">All eligible verified loans</option></select></label></div>
          <div className="grid gap-3 sm:grid-cols-3">
            <Control label="Collect from Arive" detail="Save complete read snapshots in the queue." checked={controls.collectionEnabled} disabled={Boolean(busy)} onChange={checked => setControls(value => ({ ...value, collectionEnabled: checked, ...(!checked ? { applicationEnabled: false, enrollmentEnabled: false } : {}) }))} />
            <Control label="Enroll new eligible loans" detail="Verify existing portal files before adding them." checked={controls.enrollmentEnabled} disabled={Boolean(busy) || !controls.collectionEnabled} onChange={checked => setControls(value => ({ ...value, enrollmentEnabled: checked }))} />
            <Control label="Apply to live loans" detail="Update shared pipeline fields and routing." checked={controls.applicationEnabled} disabled={Boolean(busy) || !controls.collectionEnabled} onChange={checked => setControls(value => ({ ...value, applicationEnabled: checked }))} />
          </div>
          <p className="text-xs text-muted-foreground">Collect first to review matching and proposed changes. Applying updates affects real loans in both portal modes. Pausing stops future updates and does not reverse completed changes.</p>
          <div className="flex flex-wrap gap-2"><button type="submit" className="app-btn-primary !h-9 !text-xs" disabled={Boolean(busy)}>Save collection settings</button><button type="button" className={secondary} disabled={Boolean(busy)} onClick={() => void perform('Pausing rollout', async () => { const result = await configureAriveRollout({ ...controls, collectionEnabled: false, applicationEnabled: false, enrollmentEnabled: false }); if (result.success) setControls(value => ({ ...value, collectionEnabled: false, applicationEnabled: false, enrollmentEnabled: false })); return result; }, 'Rollout paused. Previously completed updates are retained.')}><Pause className="h-3.5 w-3.5" />Pause rollout</button><button type="button" className={secondary} disabled={Boolean(busy) || !status.control.collectionEnabled || !status.control.enrollmentEnabled} onClick={() => void perform('Verifying next files', async () => { const result = await enrollAriveRolloutFiles(); if (result.success && result.skipped) return { success: false, error: 'Enrollment is paused or not enabled for this deployment.' }; return result; }, ariveRolloutEnrollmentFeedback)}><ShieldCheck className="h-3.5 w-3.5" />Verify next files</button></div>
        </form>

        <div className="space-y-3"><div><h3 className="text-sm font-semibold">Enrolled files and matching exceptions</h3><p className="mt-1 text-xs text-muted-foreground">Sync now requests an immediate Arive check within the shared budget. If another check is running or capacity is unavailable, it stays queued. Refresh status only reloads saved BISU information.</p></div>
          {!status.rows.length ? <p className="rounded-xl border border-dashed border-border p-5 text-center text-sm text-muted-foreground">No generalized enrollment records yet. The existing test-file integration remains separate.</p> : <div className="divide-y divide-border overflow-hidden rounded-xl border border-border">{status.rows.map(row => <article key={row.pipelineId} className="space-y-2 p-3"><div className="flex flex-wrap items-start justify-between gap-2"><div><h4 className="text-sm font-semibold">{row.borrowerName || `Arive #${row.ariveLoanId}`}</h4><p className="mt-0.5 text-xs text-muted-foreground">Arive #{row.ariveLoanId} · {words(row.sheet)} · {words(row.enrollmentStatus)} · {row.enabled ? 'Enabled' : 'Paused / waiting'}{row.sourceStage ? ` · ${words(row.sourceStage)}` : ''}</p></div><span className={`rounded-full px-2 py-1 text-[10px] font-semibold ${row.enrollmentStatus === 'VERIFIED' ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300' : 'bg-red-100 text-red-800 dark:bg-red-950/40 dark:text-red-300'}`}>{row.enrollmentStatus === 'VERIFIED' ? 'Identity verified' : 'Review match'}</span></div>
            {(row.enrollmentIssue || row.lastError) && <p className="rounded-lg bg-secondary p-2 text-xs leading-relaxed text-foreground">{row.enrollmentIssue || row.lastError}</p>}
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted-foreground"><span>Collected: {when(row.collectedAt)}</span><span>Applied: {when(row.lastSuccessAt)}</span><span>Next check: {when(row.nextAttemptAt)}</span>{row.manualRefreshRequestedAt && <span className="font-semibold text-primary">Refresh queued</span>}</div>
            <div className="flex flex-wrap gap-2"><button type="button" className={secondary} disabled={Boolean(busy) || !row.enabled || !status.control.collectionEnabled || Boolean(row.manualRefreshRequestedAt)} onClick={() => void perform('Checking Arive for this file', () => queueAriveRolloutRefresh({ pipelineId: row.pipelineId }), ariveRolloutRefreshFeedback)}><RefreshCw className="h-3.5 w-3.5" />{row.manualRefreshRequestedAt ? 'Sync queued' : 'Sync now'}</button><button type="button" className={secondary} disabled={Boolean(busy) || (!row.enabled && (row.enrollmentStatus !== 'VERIFIED' || !status.control.collectionEnabled))} onClick={() => void perform(row.enabled ? 'Pausing file' : 'Enabling file', () => setAriveRolloutLoanEnabled({ pipelineId: row.pipelineId, enabled: !row.enabled }), row.enabled ? 'File paused. Enrollment will not silently re-enable it.' : 'Verified file enabled. It will enter the shared queue.')}>{row.enabled ? 'Pause file' : 'Enable file'}</button><button type="button" className={secondary} disabled={Boolean(busy) || !row.collectedAt} onClick={() => void openReview(row.pipelineId, row.ariveLoanId)}>Review saved changes</button>{row.enrollmentStatus !== 'VERIFIED' && <button type="button" className={secondary} disabled={Boolean(busy) || !status.control.collectionEnabled} onClick={() => void perform('Rechecking identity', () => verifyAndEnrollExistingAriveLoan({ pipelineId: row.pipelineId }), ariveRolloutEnrollmentFeedback)}>Recheck match</button>}</div>
          </article>)}</div>}
          <div className="flex justify-between gap-2"><button type="button" className={secondary} disabled={Boolean(busy) || loading || !page.previous.length} onClick={() => setPage(value => ({ cursor: value.previous.at(-1), previous: value.previous.slice(0, -1) }))}>Previous</button><button type="button" className={secondary} disabled={Boolean(busy) || loading || !status.nextCursor} onClick={() => setPage(value => ({ cursor: status.nextCursor || undefined, previous: [...value.previous, value.cursor] }))}>Next 50</button></div>
        </div>

        <details className="rounded-xl border border-border p-4"><summary className="cursor-pointer text-sm font-semibold">Eligible portal inventory</summary><p className="mt-2 text-xs text-muted-foreground">Existing Pipeline and Restructures files, plus eligible recent Fundings. Missing or ambiguous matches remain excluded from live updates.</p><div className="mt-3 flex flex-wrap gap-2">{inventory.counts.map(group => <span key={group.sheet} className="rounded-full bg-secondary px-2.5 py-1 text-xs font-medium">{words(group.sheet)}: {group.count}</span>)}</div><div className="mt-3 divide-y divide-border">{inventory.candidates.map(candidate => <article key={candidate.pipelineId} className="flex flex-wrap items-start justify-between gap-3 py-3"><div className="min-w-0 flex-1"><h4 className="text-sm font-semibold">{candidate.borrowerName}</h4><p className="mt-0.5 text-xs text-muted-foreground">Arive #{candidate.loanNumber} · {words(candidate.sheet)} · {candidate.enrollmentStatus ? words(candidate.enrollmentStatus) : 'Not enrolled'}</p>{candidate.reason && <p className="mt-1 text-xs text-muted-foreground">{candidate.reason}</p>}</div><button type="button" className={secondary} disabled={Boolean(busy) || !status.control.collectionEnabled} onClick={() => void perform('Verifying file identity', () => verifyAndEnrollExistingAriveLoan({ pipelineId: candidate.pipelineId }), ariveRolloutEnrollmentFeedback)}>Verify file</button></article>)}</div><div className="mt-3 flex justify-between gap-2"><button type="button" className={secondary} disabled={Boolean(busy) || loading || !candidatePage.previous.length} onClick={() => setCandidatePage(value => ({ cursor: value.previous.at(-1), previous: value.previous.slice(0, -1) }))}>Previous files</button><button type="button" className={secondary} disabled={Boolean(busy) || loading || !inventory.nextCursor} onClick={() => setCandidatePage(value => ({ cursor: inventory.nextCursor || undefined, previous: [...value.previous, value.cursor] }))}>Next files</button></div></details>

        {review && <SavedReview loanNumber={review.loanNumber} review={review.value} onClose={() => setReview(null)} />}
        <div className="space-y-3"><h3 className="flex items-center gap-2 text-sm font-semibold"><FlaskConical className="h-4 w-4 text-primary" />Test files</h3><p className="text-xs text-muted-foreground">Registered practice-only files are excluded from live enrollment. Moving the existing TESTING TESTER integration to the shared collector preserves its submission packages and history.</p>{!inventory.tests.length ? <p className="text-sm text-muted-foreground">No test files found in the registry.</p> : <div className="grid gap-3 sm:grid-cols-2">{inventory.tests.map(test => <article key={`${test.kind}:${test.ariveLoanId}`} className="rounded-xl border border-border bg-background/50 p-3"><h4 className="text-sm font-semibold">{test.label}</h4><p className="mt-1 text-xs text-muted-foreground">Arive #{test.ariveLoanId} · {test.kind === 'LEGACY' ? 'Existing live test integration' : test.kind === 'PRACTICE' ? 'Practice only — excluded from live sync' : 'Shared live test integration'}</p><p className="mt-1 text-xs text-muted-foreground">{test.enabled ? 'Enabled' : 'Disabled'}</p>{test.kind === 'LEGACY' && test.pipelineId && <button type="button" className={`${secondary} mt-3`} disabled={Boolean(busy) || !status.control.collectionEnabled} onClick={() => void perform('Transferring test-file collector', () => transferLegacyAriveRolloutFile({ pipelineId: test.pipelineId! }), 'Test-file collector transferred. Existing submission packages and history were preserved.')}>Use shared collector</button>}</article>)}</div>}</div>
      </>}
      {!status && !loading && <button type="button" className={secondary} disabled={Boolean(busy)} onClick={() => void refreshStatus()}>Retry loading status</button>}
    </section>
  );
}

function Metric({ title, value, detail }: { title: string; value: string | number; detail: string }) {
  return <div className="rounded-xl border border-border bg-background/50 p-3"><p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{title}</p><p className="mt-1 break-words text-sm font-semibold">{value}</p><p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">{detail}</p></div>;
}
function Flag({ label, enabled }: { label: string; enabled: boolean }) {
  return <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 ${enabled ? 'border-emerald-200 text-emerald-700 dark:border-emerald-800 dark:text-emerald-300' : 'border-border text-muted-foreground'}`}>{enabled ? <CheckCircle2 className="h-3 w-3" /> : <Clock3 className="h-3 w-3" />}{label}: {enabled ? 'On' : 'Off'}</span>;
}
function Control({ label, detail, checked, disabled, onChange }: { label: string; detail: string; checked: boolean; disabled: boolean; onChange: (checked: boolean) => void }) {
  return <label className="flex items-start gap-2 rounded-lg border border-border p-3"><input type="checkbox" className="mt-0.5 accent-blue-600" checked={checked} disabled={disabled} onChange={event => onChange(event.target.checked)} /><span><span className="block text-xs font-semibold">{label}</span><span className="mt-1 block text-[11px] leading-relaxed text-muted-foreground">{detail}</span></span></label>;
}
function SavedReview({ loanNumber, review, onClose }: { loanNumber: string; review: Review; onClose: () => void }) {
  const snapshot = record(review.collectedSnapshot);
  const changes = Array.isArray(snapshot.changes) ? snapshot.changes.map(record) : [];
  const issues = Array.isArray(snapshot.issues) ? snapshot.issues.map(record) : [];
  return <section aria-label={`Saved Arive review for ${loanNumber}`} className="space-y-3 rounded-xl border border-primary/30 bg-primary/5 p-4"><div className="flex items-start justify-between gap-3"><div><h3 className="text-sm font-semibold">Saved changes · Arive #{loanNumber}</h3><p className="mt-1 text-xs text-muted-foreground">Collected {when(review.collectedAt)} · Last applied {when(review.lastSuccessAt)}</p></div><button type="button" className={secondary} onClick={onClose}>Close review</button></div>{!changes.length ? <p className="text-sm text-muted-foreground">No changed fields were recorded in this collection.</p> : <div className="overflow-x-auto rounded-lg border border-border"><table className="w-full text-left text-xs"><thead className="bg-secondary"><tr><th className="p-2 font-semibold">Field</th><th className="p-2 font-semibold">BISU before collection</th><th className="p-2 font-semibold">Arive value</th></tr></thead><tbody className="divide-y divide-border">{changes.map((change, index) => <tr key={index}><th className="p-2 align-top font-medium">{words(display(change.field))}</th><td className="max-w-xs whitespace-pre-wrap break-words p-2 align-top">{display(change.previous)}</td><td className="max-w-xs whitespace-pre-wrap break-words p-2 align-top">{display(change.next)}</td></tr>)}</tbody></table></div>}{issues.length > 0 && <ul className="space-y-2 text-xs text-amber-800 dark:text-amber-300">{issues.map((issue, index) => <li key={index} className="rounded-lg border border-amber-200 bg-amber-50 p-2 dark:border-amber-900 dark:bg-amber-950/30">{display(issue.message)}</li>)}</ul>}</section>;
}
