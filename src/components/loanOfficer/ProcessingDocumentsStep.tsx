'use client';

import { useState } from 'react';
import { CheckCircle, FileText, Loader2, Upload } from 'lucide-react';
import { prepareProcessingSubmissionUpload } from '@/app/actions/submissionPilotActions';
import { pilotSubmissionError, validatePilotFile, type PilotPackage } from '@/lib/submissionPilot';

export function ProcessingDocumentsStep({ pkg, onChange, busy, onBusyChange, onBack, error }: {
  pkg: PilotPackage; onChange: (p: PilotPackage) => void; busy: boolean;
  onBusyChange: (busy: boolean) => void; onBack: () => void; error: string;
}) {
  const [uploading, setUploading] = useState('');
  const [uploadError, setUploadError] = useState('');
  const [extra, setExtra] = useState('');
  const required = pkg.items.filter(i => i.required);
  const ready = required.filter(i => i.files.length || i.waiver.trim()).length;
  const updateItem = (id: string, change: Partial<PilotPackage['items'][number]>) => onChange({ ...pkg, items: pkg.items.map(i => i.id === id ? { ...i, ...change } : i) });
  async function upload(id: string, files: FileList | null) {
    if (!files?.length || busy) return;
    setUploadError(''); setUploading(id); onBusyChange(true);
    let next = pkg;
    try {
      const item = pkg.items.find(i => i.id === id)!;
      if (item.files.length + files.length > 10) throw new Error('Use up to 10 files per category.');
      for (const file of Array.from(files)) validatePilotFile(file.name, file.size, file.type);
      for (const file of Array.from(files)) {
        const result = await prepareProcessingSubmissionUpload({ name: file.name, size: file.size, type: file.type });
        if (!result.success) throw new Error(result.error);
        const response = await fetch(result.data.signedUrl, { method: 'PUT', headers: { 'Content-Type': file.type }, body: file });
        if (!response.ok) throw new Error(`Upload failed for ${file.name}. Please retry.`);
        next = { ...next, items: next.items.map(i => i.id === id ? { ...i, waiver: '', files: [...i.files, result.data.file] } : i) };
        onChange(next);
      }
    } catch (e) { setUploadError(e instanceof Error ? e.message : 'Upload failed. Please retry.'); }
    finally { setUploading(''); onBusyChange(false); }
  }
  return <div className="space-y-4">
    <div className="rounded-xl border border-violet-200 bg-violet-50/40 p-4">
      <h3 className="flex items-center gap-2 font-semibold text-slate-900"><Upload size={18} className="text-violet-600" /> Upload submission documents</h3>
      <p className="mt-1 text-sm text-slate-600">Your loan details are ready. Add the documents below so your Jr Processor can review the complete file.</p>
      <div className="mt-3 flex justify-between text-xs font-semibold text-violet-700"><span>Required categories prepared</span><span>{ready} of {required.length}</span></div>
      <progress className="mt-1 h-2 w-full accent-violet-600" aria-label="Required document categories prepared" max={required.length} value={ready} />
    </div>
    {[true, false].map(requiredSection => <section key={String(requiredSection)} className="space-y-3">
      <h3 className="text-sm font-bold text-slate-900">{requiredSection ? 'Required documents' : 'Additional documents'}</h3>
      {requiredSection && <p className="text-xs text-slate-500">Upload each applicable item, or explain why it does not apply. Every explanation is reviewed by your Jr Processor.</p>}
      {pkg.items.filter(i => i.required === requiredSection).map(item => <div key={item.id} className="rounded-xl border border-slate-200 p-4 space-y-3">
        <div className="flex items-center justify-between gap-2"><h4 className="text-sm font-semibold text-slate-900">{item.label}</h4>{item.files.length || item.waiver.trim() ? <span className="flex items-center gap-1 text-xs text-emerald-700"><CheckCircle size={14} /> Prepared</span> : <span className="text-xs text-slate-500">{item.required ? 'Required' : 'Optional'}</span>}</div>
        {item.files.map(file => <div key={file.id} className="flex items-center justify-between gap-2 rounded-lg bg-slate-50 p-2 text-sm"><span className="flex min-w-0 items-center gap-2"><FileText size={15} className="shrink-0" /><span className="truncate">{file.name}</span></span><button type="button" className="text-xs font-semibold text-red-700" disabled={busy} onClick={() => updateItem(item.id, { files: item.files.filter(f => f.id !== file.id) })} aria-label={`Remove ${file.name}`}>Remove</button></div>)}
        <label className="block text-sm"><span className="mb-1 flex items-center gap-2 text-slate-600">{uploading === item.id && <Loader2 size={14} className="animate-spin" />} {uploading === item.id ? 'Uploading…' : 'Choose documents'}</span><input aria-label={`Upload ${item.label}`} className="app-input" type="file" multiple accept=".pdf,.jpg,.jpeg,.png" disabled={busy || item.files.length >= 10} onChange={e => { void upload(item.id, e.target.files); e.target.value = ''; }} /></label>
        {item.required && !item.files.length && <label className="block text-xs text-slate-600">If not applicable, explain why<textarea className="app-input mt-1" maxLength={2000} value={item.waiver} disabled={busy} onChange={e => updateItem(item.id, { waiver: e.target.value })} placeholder="Example: Purchase — no existing mortgage statement." /></label>}
      </div>)}
      {!requiredSection && <div className="flex flex-wrap items-end gap-2"><label className="flex-1 text-sm text-slate-700">Additional document category<input className="app-input mt-1" value={extra} disabled={busy} maxLength={150} onChange={e => setExtra(e.target.value)} placeholder="Example: Letter of explanation" /></label><button type="button" className="app-btn-secondary" disabled={busy || !extra.trim() || pkg.items.length >= 30} onClick={() => { onChange({ ...pkg, items: [...pkg.items, { id: crypto.randomUUID(), label: extra.trim(), required: false, files: [], waiver: '', review: 'PENDING', feedback: '' }] }); setExtra(''); }}>Add category</button></div>}
    </section>)}
    <p className="text-xs text-slate-500">PDF, JPG, PNG · Up to 20 MB per file · At least one document required. Keep this popup open until you submit.</p>
    <p role="status" aria-live="polite" className="text-sm text-red-700">{uploadError || error}</p>
    <p className="text-sm text-slate-600">{pilotSubmissionError(pkg) || 'Your documents are ready for Jr Processor review.'}</p>
    <div className="flex justify-between gap-3 pt-2"><button type="button" className="app-btn-secondary" disabled={busy} onClick={onBack}>Back to processing details</button><button type="submit" className="inline-flex items-center gap-2 rounded-lg bg-violet-600 px-4 py-2 text-sm font-semibold text-white hover:bg-violet-700 disabled:opacity-50" disabled={busy || !!pilotSubmissionError(pkg)}>{busy && <Loader2 size={16} className="animate-spin" />}Submit for Processing</button></div>
  </div>;
}
