'use client';

import { useEffect, useRef, useState } from 'react';
import { useSession } from 'next-auth/react';
import { CheckCircle2, Download, FlaskConical, Loader2, Pause, Play, RefreshCw, ShieldCheck, X } from 'lucide-react';
import {
  cancelActivePipelineDiagnostic,
  continueActivePipelineDiagnostic,
  getActivePipelineDiagnostic,
  startActivePipelineDiagnostic,
  startActivePipelineDiagnosticFollowUp,
} from '@/app/actions/ariveActivePipelineDiagnosticActions';
import type { ActiveDiagnosticEvidence, ActivePipelineDiagnosticResponse, ActivePipelineDiagnosticRow, ActivePipelineDiagnosticRun } from '@/lib/ariveActivePipelineDiagnosticTypes';

const secondary = 'app-btn-secondary !h-9 !px-3 !text-xs disabled:cursor-not-allowed disabled:opacity-50';
const terminal = new Set(['COMPLETE', 'CANCELLED', 'INVALIDATED']);
const when = (value: string | null) => value ? new Date(value).toLocaleString() : 'Not checked';
const words = (value: string) => value.toLowerCase().replaceAll('_', ' ').replace(/^./, letter => letter.toUpperCase());

export function activeDiagnosticRowMatched(row: Pick<ActivePipelineDiagnosticRow, 'outcome'>) {
  return row.outcome === 'MATCHED' || row.outcome === 'VERIFIED';
}

/** Quoted CSV cells still need a formula guard when opened in a spreadsheet. */
export function activeDiagnosticCsvCell(value: string | number | null) {
  const text = String(value ?? '');
  const firstVisible = [...text].find(character => character.charCodeAt(0) > 32 && character.charCodeAt(0) !== 127 && !/\s/.test(character));
  const safe = firstVisible && '=+-@'.includes(firstVisible) || /^[\t\r\n]/.test(text) ? `'${text}` : text;
  return `"${safe.replaceAll('"', '""')}"`;
}

export function activeDiagnosticCsv(run: ActivePipelineDiagnosticRun) {
  const header = ['Run ID', 'Cohort captured', 'Loan number', 'Borrower', 'Loan officer', 'File type', 'Outcome', 'Explanation', 'Search HTTP', 'Detail HTTP', 'Request ID', 'Checked at', 'Check scope', 'Parent run', 'Portal originator', 'Portal secondary originator', 'Saved originator', 'Expected borrower', 'Arive originator', 'Arive borrowers', 'Direct-number HTTP', 'Direct-number request ID', 'Borrower search HTTP', 'Borrower search count', 'Identity evidence'];
  const rows = run.rows.map(row => {
    const evidence = row.evidence; const observed = evidence?.detail || evidence?.search || evidence?.numericProbe?.identity;
    return [run.id, run.startedAt, row.loanNumber, row.borrowerName, row.loanOfficer, row.synthetic ? 'Synthetic test' : 'Real loan', row.outcome, row.message, row.searchHttpStatus, row.detailHttpStatus, row.requestId, row.checkedAt,
      run.scope || 'FULL', run.parentRunId || null, evidence?.portal.primaryOriginatorEmail || null, evidence?.portal.secondaryOriginatorEmail || null, evidence?.portal.savedOriginatorEmail || null,
      evidence?.portal.borrowerName || null, observed?.originatorEmail || null, observed?.borrowers.join(' | ') || null, evidence?.numericProbe?.httpStatus ?? null, evidence?.numericProbe?.requestId || null,
      evidence?.borrowerSearch?.httpStatus ?? null, evidence?.borrowerSearch?.count ?? null, evidence ? JSON.stringify(evidence) : null];
  });
  return [header, ...rows].map(row => row.map(activeDiagnosticCsvCell).join(',')).join('\r\n');
}

export function ActiveDiagnosticEvidenceDetails({ evidence }: { evidence: ActiveDiagnosticEvidence }) {
  const observed = evidence.detail || evidence.search || evidence.numericProbe?.identity;
  const items: Array<[string, string | null | undefined]> = [
    ['BISU loan officer', evidence.portal.primaryOriginatorEmail], ['BISU secondary officer', evidence.portal.secondaryOriginatorEmail],
    ['Previously verified originator', evidence.portal.savedOriginatorEmail], ['Arive originator', observed?.originatorEmail],
    ['Expected borrower', evidence.portal.borrowerName], ['Arive primary borrowers', observed?.borrowers.join('; ')],
  ];
  return <details className="mt-2 rounded-lg border border-border bg-muted/30 p-2.5">
    <summary className="cursor-pointer font-medium">View matching details</summary>
    <dl className="mt-2 space-y-2">{items.filter(([, value]) => value).map(([label, value]) => <div key={label}><dt className="text-[10px] text-muted-foreground">{label}</dt><dd className="break-words">{value}</dd></div>)}</dl>
    {!!observed?.team?.length && <div className="mt-2"><p className="text-[10px] text-muted-foreground">Arive loan team</p>{observed.team.map((member, index) => <p key={index} className="break-words">{member.email || 'Email not provided'} · {member.role || 'Role not provided'}{member.primary === true ? ' · Primary' : ''}</p>)}</div>}
    {!!observed?.otherApplicants?.length && <div className="mt-2"><p className="text-[10px] text-muted-foreground">Other applicants in Arive</p>{observed.otherApplicants.map((applicant, index) => <p key={index} className="break-words">{applicant.name || 'Name not provided'} · {applicant.applicantType || 'Type not provided'}</p>)}</div>}
    {evidence.numericProbe && <p className="mt-2">Direct loan-number check: {evidence.numericProbe.httpStatus ? `HTTP ${evidence.numericProbe.httpStatus}` : 'No response recorded'}</p>}
    {evidence.borrowerSearch && <div className="mt-2"><p>Borrower search: {evidence.borrowerSearch.count ?? 'Unknown'} result(s){evidence.borrowerSearch.httpStatus && ` · HTTP ${evidence.borrowerSearch.httpStatus}`}</p>
      {evidence.borrowerSearch.candidates.map((candidate, index) => <p key={index} className="mt-1 break-words">Arive #{candidate.loanNumber || 'Not provided'} · {candidate.borrowers.join('; ') || 'Borrower not provided'} · {candidate.originatorEmail || 'Originator not provided'}</p>)}
      {(!evidence.borrowerSearch.complete || evidence.borrowerSearch.candidatesTruncated) && <p className="mt-1 text-muted-foreground">This is a limited set of search results.</p>}
      <p className="mt-1 text-muted-foreground">Search candidates are evidence for review. They have not been linked or accepted as matches.</p></div>}
  </details>;
}

/** Only explicit Start/Resume calls this loop. Status reads never start API work. */
export async function continueActiveDiagnosticSequence(
  initial: ActivePipelineDiagnosticRun,
  next: (input: { runId: string }) => Promise<ActivePipelineDiagnosticResponse>,
  canContinue: () => boolean,
  accept: (run: ActivePipelineDiagnosticRun) => void,
) {
  let run = initial;
  while (canContinue() && run.automaticSyncPaused && run.status === 'READY' && !run.retryAt) {
    const result = await next({ runId: run.id });
    if (!canContinue()) return;
    if (!result.success) throw new Error(result.error);
    if (!result.run) throw new Error('The saved diagnostic could not be found. Refresh its status before continuing.');
    if (result.run.id !== run.id) throw new Error('The saved diagnostic changed. Refresh its status before continuing.');
    const previousChecked = run.checked;
    run = result.run;
    accept(run);
    if (run.status === 'READY' && run.checked <= previousChecked) throw new Error('The diagnostic made no progress. Refresh its saved status before trying again.');
  }
}

export function ActivePipelineDiagnosticResults({ run }: { run: ActivePipelineDiagnosticRun }) {
  const [filter, setFilter] = useState('all');
  const [page, setPage] = useState(0);
  const filtered = run.rows.filter(row => filter === 'all' || filter === 'matched' && activeDiagnosticRowMatched(row)
    || filter === 'review' && row.checkedAt !== null && !activeDiagnosticRowMatched(row)
    || filter === 'pending' && row.checkedAt === null);
  const pages = Math.max(1, Math.ceil(filtered.length / 25));
  const currentPage = Math.min(page, pages - 1);
  const rows = filtered.slice(currentPage * 25, (currentPage + 1) * 25);
  return <div className="space-y-3">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <h3 className="text-sm font-semibold">Loan-by-loan results</h3>
      <label className="flex items-center gap-2 text-xs text-muted-foreground">Show
        <select aria-label="Filter diagnostic results" value={filter} onChange={event => { setFilter(event.target.value); setPage(0); }} className="rounded-lg border border-border bg-background px-2 py-1.5 text-foreground">
          <option value="all">All files ({run.total})</option>
          <option value="matched">Matched ({run.matched})</option>
          <option value="review">Needs review ({run.needsReview})</option>
          <option value="pending">Not checked ({Math.max(0, run.total - run.checked)})</option>
        </select>
      </label>
    </div>
    <div className="max-h-[30rem] overflow-auto rounded-xl border border-border">
      <table className="w-full min-w-[680px] text-left text-xs">
        <caption className="sr-only">Read-only Arive access and identity checks for the active pipeline captured on {when(run.startedAt)}</caption>
        <thead className="sticky top-0 z-10 bg-muted text-muted-foreground"><tr>
          <th scope="col" className="px-3 py-3 font-medium">Loan / Borrower</th>
          <th scope="col" className="px-3 py-3 font-medium">Loan officer</th>
          <th scope="col" className="px-3 py-3 font-medium">Result</th>
          <th scope="col" className="px-3 py-3 font-medium">Details</th>
        </tr></thead>
        <tbody className="divide-y divide-border bg-background">{rows.map(row => {
          const matched = activeDiagnosticRowMatched(row);
          const pending = row.checkedAt === null;
          return <tr key={row.pipelineId}>
            <td className="max-w-56 px-3 py-3 align-top"><div className="font-semibold tabular-nums">{row.loanNumber || 'No loan number'}</div><div className="mt-1 break-words text-muted-foreground">{row.borrowerName || 'Not supplied'}</div>{row.synthetic && <span className="mt-1.5 inline-flex items-center gap-1 rounded-full bg-violet-100 px-2 py-0.5 text-[10px] font-medium text-violet-800 dark:bg-violet-950 dark:text-violet-200"><FlaskConical size={11} aria-hidden="true" />Synthetic test</span>}</td>
            <td className="max-w-40 break-words px-3 py-3 align-top">{row.loanOfficer || 'Not supplied'}</td>
            <td className="px-3 py-3 align-top"><span className={`inline-flex items-center gap-1.5 rounded-full px-2 py-1 font-medium ${matched ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200' : pending ? 'bg-muted text-muted-foreground' : 'bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200'}`}>{matched && <CheckCircle2 size={12} aria-hidden="true" />}{words(row.outcome)}</span></td>
            <td className="max-w-sm px-3 py-3 align-top"><p className="break-words leading-relaxed">{row.message || (pending ? 'Waiting for this file’s check.' : 'Check finished.')}</p>{(row.searchHttpStatus !== null || row.detailHttpStatus !== null) && <p className="mt-1.5 text-[10px] text-muted-foreground">{row.searchHttpStatus !== null ? `Search: HTTP ${row.searchHttpStatus}` : ''}{row.searchHttpStatus !== null && row.detailHttpStatus !== null ? ' · ' : ''}{row.detailHttpStatus !== null ? `Details: HTTP ${row.detailHttpStatus}` : ''}</p>}{row.evidence && <ActiveDiagnosticEvidenceDetails evidence={row.evidence} />}</td>
          </tr>;
        })}{rows.length === 0 && <tr><td colSpan={4} className="px-3 py-6 text-center text-muted-foreground">No files in this group.</td></tr>}</tbody>
      </table>
    </div>
    <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground"><span>{filtered.length ? `${currentPage * 25 + 1}–${Math.min((currentPage + 1) * 25, filtered.length)} of ${filtered.length} files` : '0 files'}</span><div className="flex gap-2"><button type="button" className={secondary} disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}>Previous</button><button type="button" className={secondary} disabled={currentPage + 1 >= pages} onClick={() => setPage(currentPage + 1)}>Next</button></div></div>
  </div>;
}

export function AriveActivePipelineDiagnostic() {
  const { data: session, status: sessionStatus } = useSession();
  const role = session?.user?.activeRole || session?.user?.role;
  const identity = sessionStatus === 'authenticated' && session?.user?.id && (role === 'ADMIN_III' || role === 'ADMIN') ? `${session.user.id}:${role}` : '';
  const [saved, setSaved] = useState<{ identity: string; run: ActivePipelineDiagnosticRun | null } | null>(null);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [checking, setChecking] = useState(false);
  const [pausing, setPausing] = useState(false);
  const [feedback, setFeedback] = useState<{ error: boolean; text: string } | null>(null);
  const generation = useRef(0);
  const alive = useRef(false);
  const locked = useRef(false);
  const continuing = useRef(false);
  const run = saved?.identity === identity && identity ? saved.run : null;

  useEffect(() => {
    const epoch = ++generation.current;
    alive.current = true; locked.current = false; continuing.current = false;
    setSaved(null); setFeedback(null); setWorking(false); setChecking(false); setPausing(false); setLoading(Boolean(identity));
    if (identity) void getActivePipelineDiagnostic().then(result => {
      if (!alive.current || generation.current !== epoch) return;
      if (!result.success) { setSaved(null); setFeedback({ error: true, text: result.error }); return; }
      setSaved({ identity, run: result.run });
    }).catch(() => {
      if (alive.current && generation.current === epoch) setFeedback({ error: true, text: 'Unable to load the saved diagnostic. Try refreshing its status.' });
    }).finally(() => { if (alive.current && generation.current === epoch) setLoading(false); });
    return () => { alive.current = false; continuing.current = false; generation.current = epoch + 1; };
  }, [identity]);

  const perform = async (action: 'start' | 'followup' | 'resume' | 'refresh' | 'cancel') => {
    if (locked.current || !identity) return;
    locked.current = true; continuing.current = action === 'start' || action === 'followup' || action === 'resume';
    const epoch = generation.current;
    const valid = () => alive.current && generation.current === epoch;
    setWorking(true); setChecking(action === 'start' || action === 'followup' || action === 'resume'); setPausing(false); setFeedback(null);
    try {
      const result = action === 'start' ? await startActivePipelineDiagnostic()
        : action === 'followup' && run ? await startActivePipelineDiagnosticFollowUp({ runId: run.id })
        : action === 'cancel' && run ? await cancelActivePipelineDiagnostic({ runId: run.id })
          : await getActivePipelineDiagnostic();
      if (!valid()) return;
      if (!result.success) throw new Error(result.error);
      setSaved({ identity, run: result.run });
      if (continuing.current && result.run) {
        const next = result.run;
        // Resume deliberately acknowledges a prior budget deferral. The server
        // rechecks the actual deadline and controls before sending any request.
        const resumable = action === 'resume' && next.status === 'DEFERRED' ? { ...next, status: 'READY' as const, retryAt: null } : next;
        await continueActiveDiagnosticSequence(resumable, continueActivePipelineDiagnostic, () => valid() && continuing.current,
          value => setSaved({ identity, run: value }));
      }
      if (!valid()) return;
      if (action === 'refresh') setFeedback({ error: false, text: 'Saved results refreshed. No Arive requests were made.' });
      if (action === 'cancel') setFeedback({ error: false, text: 'This diagnostic has ended. Its saved results remain available.' });
      if (!continuing.current && (action === 'start' || action === 'followup' || action === 'resume')) {
        // A paused in-flight chunk may have saved progress. Read that saved
        // status once; never discard it or start another provider request.
        const latest = await getActivePipelineDiagnostic();
        if (!valid()) return;
        if (!latest.success) throw new Error(latest.error);
        setSaved({ identity, run: latest.run });
        setFeedback({ error: false, text: 'Diagnostic paused. Saved progress is ready to resume.' });
      }
    } catch (error) {
      if (valid()) {
        // An authorization failure must not leave previously authorized data.
        setSaved(null); setFeedback({ error: true, text: error instanceof Error ? error.message : 'The diagnostic stopped. Refresh its saved status before continuing.' });
      }
    } finally {
      if (valid()) { locked.current = false; continuing.current = false; setWorking(false); setChecking(false); setPausing(false); }
    }
  };

  const download = () => {
    if (!run || !identity) return;
    const url = URL.createObjectURL(new Blob(['\uFEFF', activeDiagnosticCsv(run)], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a'); link.href = url; link.download = `arive-active-pipeline-check-${run.startedAt.slice(0, 10)}.csv`;
    document.body.appendChild(link); link.click(); link.remove(); window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const mayResume = run && !terminal.has(run.status) && run.automaticSyncPaused;
  const percent = run?.total ? Math.min(100, Math.round(run.checked / run.total * 100)) : run?.status === 'COMPLETE' ? 100 : 0;

  if (!identity) return null;
  return <section aria-labelledby="active-pipeline-diagnostic-title" className="app-surface-card space-y-5">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="flex items-start gap-3"><span className="rounded-xl bg-blue-50 p-2.5 text-blue-600 dark:bg-blue-950 dark:text-blue-200"><ShieldCheck size={22} aria-hidden="true" /></span><div><h2 id="active-pipeline-diagnostic-title" className="text-base font-semibold">Active pipeline access check</h2><p className="mt-1 text-xs leading-relaxed text-muted-foreground">Verify each active BISU loan’s Arive access and identity using the saved branch connection.</p></div></div>
      <span className="rounded-full bg-muted px-3 py-1.5 text-[11px] font-medium text-muted-foreground">Read-only · Automatic sync must remain paused</span>
    </div>
    <p className="text-xs leading-relaxed text-muted-foreground">Captures the active pipeline when the check starts. It saves diagnostic results only; loan statuses, assignments, tasks, and staff notifications are unchanged.</p>
    <div className="flex flex-wrap items-center gap-2">
      {(!run || terminal.has(run.status)) && <button type="button" disabled={loading || working} onClick={() => void perform('start')} className="app-btn-primary !h-9 !px-3 !text-xs disabled:opacity-50"><Play size={14} aria-hidden="true" />{run ? 'Start a new active pipeline check' : 'Start active pipeline check'}</button>}
      {run && terminal.has(run.status) && <button type="button" disabled={loading || working || !run.automaticSyncPaused} onClick={() => void perform('followup')} className={secondary}><RefreshCw size={14} aria-hidden="true" />Investigate review items + new loans</button>}
      {mayResume && !working && <button type="button" className="app-btn-primary !h-9 !px-3 !text-xs disabled:opacity-50" disabled={loading || Boolean(run.retryAt && Date.parse(run.retryAt) > Date.now())} onClick={() => void perform('resume')}><Play size={14} aria-hidden="true" />Resume check</button>}
      {working && checking && <button type="button" className={secondary} disabled={pausing} onClick={() => { continuing.current = false; setPausing(true); }}><Pause size={14} aria-hidden="true" />{pausing ? 'Pausing after current check…' : 'Pause check'}</button>}
      <button type="button" className={secondary} disabled={loading || working} onClick={() => void perform('refresh')}><RefreshCw size={14} aria-hidden="true" />Refresh saved results</button>
      {run && <button type="button" className={secondary} disabled={working} onClick={download}><Download size={14} aria-hidden="true" />Export results</button>}
      {mayResume && <button type="button" className={secondary} disabled={loading || working} onClick={() => void perform('cancel')}><X size={14} aria-hidden="true" />End check</button>}
      {(loading || working) && <span className="inline-flex items-center gap-2 text-xs text-muted-foreground"><Loader2 size={14} className="animate-spin" aria-hidden="true" />{loading ? 'Loading saved results…' : pausing ? 'Finishing the current request…' : 'Checking safely within the shared API limit…'}</span>}
    </div>
    {feedback && <p role={feedback.error ? 'alert' : 'status'} className={`rounded-xl border px-3 py-2.5 text-xs ${feedback.error ? 'border-rose-200 bg-rose-50 text-rose-800 dark:border-rose-900 dark:bg-rose-950 dark:text-rose-200' : 'border-border bg-muted text-muted-foreground'}`}>{feedback.text}</p>}
    {run && <>
      {run.scope === 'FOLLOW_UP' && <p className="rounded-xl border border-blue-200 bg-blue-50 px-3 py-2.5 text-xs leading-relaxed text-blue-900 dark:border-blue-900 dark:bg-blue-950 dark:text-blue-200">Targeted follow-up: checking review items, changed files, and new active loans. Earlier stable matches are retained in the original report and are not read again. Search candidates are never linked automatically.</p>}
      <div className="space-y-3 rounded-xl border border-border bg-muted/30 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs"><span className="font-medium">{working ? 'Checking' : words(run.status)} · {run.checked} of {run.total} files checked</span><span className="text-muted-foreground">Cohort captured {when(run.startedAt)}</span></div>
        <div role="progressbar" aria-label="Active pipeline diagnostic progress" aria-valuemin={0} aria-valuemax={run.total || 1} aria-valuenow={run.checked} className="h-2 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-blue-600 transition-[width] duration-300" style={{ width: `${percent}%` }} /></div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4" aria-live="polite"><div><p className="text-xl font-semibold tabular-nums">{run.total}</p><p className="text-[11px] text-muted-foreground">Files in this check</p></div><div><p className="text-xl font-semibold tabular-nums text-emerald-700 dark:text-emerald-300">{run.matched}</p><p className="text-[11px] text-muted-foreground">Access + identity matched</p></div><div><p className="text-xl font-semibold tabular-nums text-amber-700 dark:text-amber-300">{run.needsReview}</p><p className="text-[11px] text-muted-foreground">Need review</p></div><div><p className="text-xl font-semibold tabular-nums">{Math.max(0, run.total - run.checked)}</p><p className="text-[11px] text-muted-foreground">Not checked yet</p></div></div>
        <div className="flex flex-wrap gap-x-4 gap-y-1 border-t border-border pt-3 text-[11px] text-muted-foreground"><span>Real loans: {run.realMatched} matched / {run.realTotal}</span><span>Synthetic tests: {run.syntheticMatched} matched / {run.syntheticTotal}</span><span>{run.getRequests} loan reads · {run.authenticationRequests} authentication requests</span></div>
      </div>
      {!run.automaticSyncPaused && <p role="alert" className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2.5 text-xs text-rose-800 dark:border-rose-900 dark:bg-rose-950 dark:text-rose-200">Automatic sync is no longer fully paused. This diagnostic cannot continue.</p>}
      {run.message && <p role="status" className="rounded-xl border border-border bg-muted/30 px-3 py-2.5 text-xs leading-relaxed">{run.message}{run.retryAt && <> Earliest retry: {when(run.retryAt)}. Refresh saved results before resuming.</>}</p>}
      {(run.addedSinceStart > 0 || run.changedSinceStart > 0 || run.currentActiveCount !== (run.baselineTotal ?? run.total)) && <p className="text-xs leading-relaxed text-muted-foreground">The pipeline changed during this check. There are now {run.currentActiveCount} active files, with {run.addedSinceStart} added and {run.changedSinceStart} changed since capture. Results describe this saved cohort; start a follow-up to include later changes.</p>}
      <ActivePipelineDiagnosticResults key={run.id} run={run} />
    </>}
  </section>;
}
