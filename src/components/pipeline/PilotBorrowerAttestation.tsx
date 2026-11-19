'use client';

import { useRef, useState } from 'react';
import { confirmPilotReportedBorrower } from '@/app/actions/processingPipelineActions';

export function PilotBorrowerAttestation({ pipelineId, number, onChanged }: {
  pipelineId: string; number: string; onChanged: () => Promise<void>;
}) {
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [message, setMessage] = useState('');
  const fileInput = useRef<HTMLInputElement>(null);
  const pending = useRef(false);
  async function confirm() {
    const file = fileInput.current?.files?.[0];
    if (pending.current || saved || !confirmed) return;
    if (!file) { setMessage('Choose the official Arive branch report first.'); return; }
    pending.current = true;
    setBusy(true);
    try {
      if (file.size > 20 * 1024 * 1024) throw new Error('Select a branch CSV under 20 MB.');
      const { default: Papa } = await import('papaparse');
      const parsed = Papa.parse<Record<string, string>>(await file.text(), { header: true, skipEmptyLines: 'greedy' });
      if (parsed.errors.length || !['ARIVE Loan Id','Primary Borrower','Primary Loan Officer Email','Brokerage Branch Name']
        .every(field => parsed.meta.fields?.includes(field))) throw new Error('Select the official Arive branch pipeline report with borrower, loan number, primary officer email and branch.');
      const matches = parsed.data.filter(row => row['ARIVE Loan Id']?.trim() === number);
      if (matches.length !== 1) throw new Error('The report must contain exactly one row for this Arive loan number.');
      const [row] = matches;
      const result = await confirmPilotReportedBorrower(pipelineId, { number, name: row['Primary Borrower'],
        officerEmail: row['Primary Loan Officer Email'], branch: row['Brokerage Branch Name'] }, confirmed);
      if (!result.success) throw new Error('The report and current file could not be verified. The file remains in review.');
      setSaved(true);
      setMessage('Verification saved. A fresh Pilot read is queued.');
      await onChanged();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to verify this file.');
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }
  return <details className="mt-3 rounded-lg border bg-white p-3 text-xs text-slate-800">
    <summary className="cursor-pointer font-semibold">Verify borrower against Arive branch report</summary>
    <p className="my-2">Check the separate first, middle and last names on this file in Arive. Choose the official branch pipeline CSV. Only the matching row is sent to BISU.</p>
    <label className="block font-semibold">Arive branch report (CSV)
      <input ref={fileInput} type="file" accept=".csv,text/csv" disabled={busy || saved} className="my-2 block w-full"/>
    </label>
    <label className="flex items-start gap-2"><input type="checkbox" disabled={busy || saved} checked={confirmed}
      onChange={event => setConfirmed(event.target.checked)}/>I confirmed this report is for the same branch and the BISU surname is this borrower’s middle name on the Arive borrower screen.</label>
    <button type="button" className="app-btn-secondary mt-3" disabled={busy || saved || !confirmed}
      onClick={() => void confirm()}>{busy ? 'Verifying…' : saved ? 'Verification saved' : 'Verify this file'}</button>
    <p role="status" className="mt-2">{message}</p>
  </details>;
}
