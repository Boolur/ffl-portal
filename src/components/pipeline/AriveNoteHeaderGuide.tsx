import { BookOpen } from 'lucide-react';
import type { AriveStructuredNoteKey } from '@/lib/ariveStructuredNotes';

export const ariveNoteHeaderGuide = [
  { key: 'pendingItems', header: 'Pending Items:', target: 'Pending Items', group: 'pipeline', date: false },
  { key: 'scheduledSigning', header: 'Scheduled Signing:', target: 'Estimated Signing', group: 'pipeline', date: true },
  { key: 'payoffExpiry', header: 'Payoff Expiry:', target: 'Payoff Expiration', group: 'pipeline', date: true },
  { key: 'conditionNeeded', header: 'Condition needed:', target: 'Condition needed', group: 'workspace', date: false },
  { key: 'hoiExpiration', header: 'HOI expiration:', target: 'HOI expiration', group: 'workspace', date: true },
  { key: 'completion1004D', header: '1004D:', target: '1004D', group: 'workspace', date: false },
  { key: 'waterInspection', header: 'Water inspection:', target: 'Water inspection', group: 'workspace', date: false },
  { key: 'pestInspection', header: 'Pest inspection:', target: 'Pest inspection', group: 'workspace', date: false },
] as const satisfies ReadonlyArray<{ key: AriveStructuredNoteKey; header: string; target: string; group: 'pipeline' | 'workspace'; date: boolean }>;

export function AriveNoteHeaderGuide() {
  return <details className="mt-3 rounded-lg border border-slate-200 bg-white/80 px-3 py-2.5 text-slate-700">
    <summary className="cursor-pointer text-xs font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500"><BookOpen size={14} className="mr-1.5 inline-block align-text-bottom text-blue-600" aria-hidden="true" />How to write Arive updates</summary>
    <div className="mt-3 space-y-3 text-xs leading-relaxed">
      <p>Edit notes in Arive. Start each section on a new line with one header below, followed by its value. One note can contain several sections; capitalization does not matter. Portal task conversations do not update these fields.</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <div><h4 className="mb-1.5 font-semibold text-slate-900">Updates pipeline fields</h4><dl className="space-y-1.5">{ariveNoteHeaderGuide.filter(item => item.group === 'pipeline').map(item => <div key={item.key} className="flex flex-wrap items-baseline gap-x-2"><dt className="font-mono font-medium text-blue-800">{item.header}</dt><dd className="text-slate-500">→ {item.target}</dd></div>)}</dl></div>
        <div><h4 className="mb-1.5 font-semibold text-slate-900">Shown in workspace processor updates</h4><ul className="flex flex-wrap gap-x-3 gap-y-1.5">{ariveNoteHeaderGuide.filter(item => item.group === 'workspace').map(item => <li key={item.key} className="font-mono font-medium text-blue-800">{item.header}</li>)}</ul></div>
      </div>
      <p><strong>Dates:</strong> Scheduled Signing, Payoff Expiry, and HOI expiration use <code>MM/DD/YYYY</code> or <code>YYYY-MM-DD</code>, without a time.</p>
      <p>A newer valid section replaces the previous value for that header. Use <code>Clear</code> or <code>None</code> after the header to erase it. Blank or invalid entries keep the previous value and show a warning.</p>
    </div>
  </details>;
}
