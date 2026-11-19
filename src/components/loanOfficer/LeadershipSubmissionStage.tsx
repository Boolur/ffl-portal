'use client';

import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { BadgeCheck, CircleAlert, Loader2, RefreshCw } from 'lucide-react';
import { checkLeadershipSubmissionStage } from '@/app/actions/taskActions';

type StageInput = Parameters<typeof checkLeadershipSubmissionStage>[0];
type StageResult = Awaited<ReturnType<typeof checkLeadershipSubmissionStage>>;
type StageState = { input: StageInput; result?: StageResult };

export function useLeadershipSubmissionStage(input: StageInput | null) {
  const [state, setState] = useState<StageState | null>(null);
  const pending = useRef<Promise<StageResult | null> | null>(null);
  const debounce = useRef<number | undefined>(undefined);
  const currentInput = useRef<StageInput | null>(null);

  // Navigating back, changing the loan, or closing the form abandons this read.
  useLayoutEffect(() => {
    currentInput.current = input;
    return () => {
      currentInput.current = null;
      window.clearTimeout(debounce.current);
      pending.current = null;
    };
  }, [input]);

  const check = useCallback((): Promise<StageResult | null> => {
    if (!input || currentInput.current !== input) return Promise.resolve(null);
    window.clearTimeout(debounce.current);
    if (pending.current) return pending.current;
    setState({ input });
    const request: Promise<StageResult | null> = checkLeadershipSubmissionStage(input)
      .catch(() => ({ success: false as const, error: 'BISU could not reach Arive. Check again before continuing.' }))
      .then(result => {
        if (pending.current !== request) return null;
        pending.current = null;
        setState({ input, result });
        return result;
      });
    pending.current = request;
    return request;
  }, [input]);

  useEffect(() => {
    if (!input) return;
    // Let edits to the borrower or property settle before reading the file again.
    debounce.current = window.setTimeout(() => { void check(); }, 600);
    return () => window.clearTimeout(debounce.current);
  }, [input, check]);

  const current = input && state?.input === input ? state : null;
  return { check, result: current?.result, checking: !!current && !current.result };
}

export function LeadershipSubmissionStage({ ready, checking, result, onCheck, panelRef }: {
  ready: boolean;
  checking: boolean;
  result?: StageResult;
  onCheck: () => void;
  panelRef: React.RefObject<HTMLElement | null>;
}) {
  const eligible = result?.success && result.eligible;
  const awaitingCorrection = !!result && !eligible;
  const Icon = checking ? Loader2 : eligible ? BadgeCheck : CircleAlert;
  return (
    <section ref={panelRef} tabIndex={-1} aria-label="Arive loan status"
      className={`rounded-xl border p-4 focus:outline-none ${eligible ? 'border-emerald-200 bg-emerald-50' : awaitingCorrection ? 'border-amber-300 bg-amber-50' : 'border-slate-200 bg-slate-50'}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-2" role="status">
          <Icon aria-hidden="true" className={`mt-0.5 h-5 w-5 shrink-0 ${checking ? 'animate-spin text-violet-700' : eligible ? 'text-emerald-700' : awaitingCorrection ? 'text-amber-700' : 'text-slate-500'}`} />
          <div>
            <h3 className="text-sm font-bold text-slate-900">Arive loan status</h3>
            <p className="mt-1 text-sm font-semibold text-slate-900">
              {checking ? 'Checking Arive…' : result?.success ? result.stageLabel : result ? 'Unable to verify' : ready ? 'Waiting for verification' : 'Loan details needed'}
            </p>
          </div>
        </div>
        {ready && <button type="button" className="app-btn-secondary inline-flex items-center gap-1.5" disabled={checking}
          onClick={onCheck}><RefreshCw aria-hidden="true" size={14} />{result ? 'Recheck Arive' : 'Check Arive'}</button>}
      </div>
      <p className="mt-2 text-sm text-slate-700" aria-live="polite">
        {!ready ? 'Select the primary loan officer and complete the Arive loan number, borrower name and subject property below.'
          : result?.success === false ? result.error
          : eligible ? 'This stage allows you to continue to Documents.'
          : awaitingCorrection ? 'Update the loan to Preapproved or Submitted to Underwriting in Arive, then select Recheck Arive.'
          : 'Documents unlock when Arive confirms Preapproved or Submitted to Underwriting.'}
      </p>
      {result?.success && <p className="mt-1 text-xs text-slate-500">Checked at <time dateTime={result.checkedAt}>{new Date(result.checkedAt).toLocaleTimeString()}</time></p>}
    </section>
  );
}
