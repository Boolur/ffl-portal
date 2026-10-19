'use client';

import { useEffect, useRef, useState } from 'react';
import { ProcessingPipelineSheet } from '@prisma/client';
import { getProcessingFundingContext, moveProcessingPipelineLoan } from '@/app/actions/processingPipelineActions';
import { calculateSigningFundingDates } from '@/lib/mortgageCalendar';

export function ProcessingFundingDialog({ id, version, borrowerName, defaultSigningDate, onClose, onSaved }: {
  id: string;
  version: number;
  borrowerName: string;
  defaultSigningDate: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [context, setContext] = useState<{ isPurchase: boolean; purpose: string | null } | null>(null);
  const [signingAt, setSigningAt] = useState(defaultSigningDate);
  const [rescissionChoice, setRescissionChoice] = useState('');
  const [laterStart, setLaterStart] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    dialog.current?.showModal();
    let active = true;
    getProcessingFundingContext(id).then((result) => {
      if (!active) return;
      if (result.success) setContext(result);
      else setError(result.error);
    }).catch(() => { if (active) setError('Could not load funding details. Close and try again.'); });
    return () => { active = false; };
  }, [id]);

  let dates: ReturnType<typeof calculateSigningFundingDates> | null = null;
  let validation = '';
  if (context && (context.isPurchase || rescissionChoice)) {
    try {
      dates = calculateSigningFundingDates({
        signingAt, isPurchase: context.isPurchase,
        rescissionApplies: rescissionChoice === 'yes', rescissionStartAt: laterStart || undefined,
      });
    } catch (cause) {
      validation = cause instanceof Error ? cause.message : 'Check the dates.';
    }
  }
  const displayDate = (date: Date) => date.toLocaleDateString('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric', year: 'numeric' });

  return (
    <dialog ref={dialog} aria-labelledby="funding-dialog-title"
      onCancel={(event) => { event.preventDefault(); if (!saving) onClose(); }}
      className="m-auto w-full max-w-lg rounded-2xl border border-slate-200 bg-white p-6 text-slate-900 shadow-2xl backdrop:bg-slate-950/40">
      <form onSubmit={async (event) => {
        event.preventDefault();
        if (!dates || saving) return;
        setSaving(true);
        setError('');
        try {
          const result = await moveProcessingPipelineLoan({
            id, version, sheet: ProcessingPipelineSheet.FUNDING,
            signingAt, rescissionApplies: dates.rescissionApplies,
            rescissionStartAt: laterStart || undefined,
          });
          if (result.success) onSaved();
          else setError(result.error);
        } catch {
          setError('Could not save funding details. Refresh the pipeline before trying again.');
        } finally { setSaving(false); }
      }}>
        <h2 id="funding-dialog-title" className="text-xl font-black">Move to Fundings</h2>
        <p className="mt-1 text-sm text-slate-500">{borrowerName}</p>
        {!context && !error && <p className="mt-4" role="status">Loading loan details…</p>}
        <fieldset disabled={saving || !context} className="mt-5 space-y-4">
          <label className="block text-sm font-semibold">
            Signing date
            <input autoFocus required type="date" value={signingAt} onChange={(event) => setSigningAt(event.target.value)} className="app-input mt-1" />
          </label>
          {context?.isPurchase ? (
            <p className="text-sm">Purchase — no right-to-cancel waiting period.</p>
          ) : (
            <label className="block text-sm font-semibold">
              Does a right-to-cancel period apply to this loan?
              <select required value={rescissionChoice} onChange={(event) => setRescissionChoice(event.target.value)} className="app-input mt-1">
                <option value="">Select an option</option>
                <option value="yes">Yes — three-day right to cancel</option>
                <option value="no">No — purchase or other exempt loan</option>
              </select>
            </label>
          )}
          {!context?.isPurchase && rescissionChoice === 'yes' && (
            <label className="block text-sm font-semibold">
              Later notice/disclosure delivery date, if applicable
              <input type="date" min={signingAt} value={laterStart} onChange={(event) => setLaterStart(event.target.value)} className="app-input mt-1" />
              <span className="mt-1 block text-xs font-normal text-slate-500">Leave blank if the cancellation notice and all required disclosures were delivered by signing.</span>
            </label>
          )}
        </fieldset>
        {dates && (
          <div className="mt-5 rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm" aria-live="polite">
            {dates.rescissionDeadline && <p>Right to cancel ends at midnight on {displayDate(dates.rescissionDeadline)}.</p>}
            <p className="mt-1 font-bold">Calculated funding date: {displayDate(dates.fundedAt)}</p>
            <p className="mt-2 text-xs text-slate-600">The cancellation period skips Sundays and federal holidays; Saturdays count. Funding skips weekends and observed federal holidays.</p>
            <p className="mt-2 text-xs text-slate-600">Saving marks this loan Funded using this calculated date. First Payment and 6th Payment will use this date.</p>
          </div>
        )}
        {(error || validation) && <p role="alert" className="mt-4 text-sm text-red-700">{error || validation}</p>}
        <div className="mt-6 flex justify-end gap-2">
          <button type="button" disabled={saving} onClick={onClose} className="app-btn-secondary disabled:opacity-50">Cancel</button>
          <button type="submit" disabled={saving || !dates} className="app-btn-primary disabled:opacity-50">{saving ? 'Saving…' : 'Confirm and move'}</button>
        </div>
      </form>
    </dialog>
  );
}
