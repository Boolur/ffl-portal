'use client';

import { useRef, useState } from 'react';
import { BadgeCheck, CheckCircle, FileSignature, FileText, FolderPlus, House, IdCard, Loader2, ReceiptText, ShieldCheck, Upload, X } from 'lucide-react';
import { prepareProcessingSubmissionUpload } from '@/app/actions/submissionPilotActions';
import { pilotSubmissionError, validatePilotFile, type PilotPackage } from '@/lib/submissionPilot';

const documentIcons = { mortgage: House, insurance: ShieldCheck, income: ReceiptText, identity: IdCard, veteran: BadgeCheck, disclosures: FileSignature };
const NOT_APPLICABLE = 'Not applicable — selected by Loan Officer';
const batchItem: PilotPackage['items'][number] = { id: 'additional-batch', label: 'Additional documents', required: false, files: [], waiver: '', review: 'PENDING', feedback: '' };

function DocumentDropzone({ item, disabled, uploading, onFiles }: {
  item: PilotPackage['items'][number]; disabled: boolean; uploading: boolean; onFiles: (files: File[]) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const Icon = documentIcons[item.id as keyof typeof documentIcons] || FolderPlus;
  const notApplicable = !!item.waiver.trim() && !item.files.length;
  const tone = notApplicable ? 'border-slate-200 bg-slate-100' : item.files.length ? 'border-emerald-300 bg-emerald-50/60 hover:border-emerald-500' : item.required ? 'border-red-300 bg-red-50/60 hover:border-red-500' : 'border-slate-200 bg-slate-50/60 hover:border-violet-400 hover:bg-violet-50/60';
  const iconTone = notApplicable ? 'bg-slate-200 text-slate-400' : item.files.length ? 'bg-emerald-100 text-emerald-600' : item.required ? 'bg-red-100 text-red-500' : 'bg-violet-100 text-violet-600';
  return <>
    <input ref={input} className="sr-only" tabIndex={-1} aria-label={`Upload ${item.label}`} type="file" multiple accept=".pdf,.jpg,.jpeg,.png" disabled={disabled} onChange={e => { const files = Array.from(e.target.files || []); e.target.value = ''; onFiles(files); }} />
    <button type="button" disabled={disabled} aria-label={`Upload ${item.label}: drag and drop or browse files`} aria-busy={uploading}
      onClick={() => input.current?.click()}
      onDragEnter={e => { e.preventDefault(); if (!disabled) setDragging(true); }}
      onDragOver={e => { e.preventDefault(); e.dataTransfer.dropEffect = disabled ? 'none' : 'copy'; }}
      onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragging(false); }}
      onDrop={e => { e.preventDefault(); e.stopPropagation(); setDragging(false); if (!disabled) onFiles(Array.from(e.dataTransfer.files)); }}
      className={`group flex min-h-52 w-full flex-col items-center justify-center rounded-xl border-2 border-dashed px-4 py-5 text-center transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed ${dragging && !disabled ? 'border-violet-500 bg-violet-100' : tone}`}>
      <span className={`mb-3 flex h-14 w-14 items-center justify-center rounded-2xl transition-colors ${dragging && !disabled ? 'bg-violet-600 text-white' : iconTone}`}>{uploading ? <Loader2 className="h-7 w-7 animate-spin" aria-hidden="true" /> : <Icon className="h-7 w-7" strokeWidth={1.6} aria-hidden="true" />}</span>
      <span className="text-sm font-semibold text-slate-900">{item.label}</span>
      <span className={`mt-2 text-xs font-medium ${notApplicable ? 'text-slate-500' : 'text-slate-700'}`}>{notApplicable ? 'Not Applicable' : uploading ? 'Uploading documents…' : item.files.length >= 10 ? '10-file limit reached' : dragging ? 'Drop files here' : item.files.length ? 'Drop more files or browse' : item.id === batchItem.id ? 'Drop a batch of files here' : 'Drag & drop files here'}</span>
      {!uploading && !notApplicable && item.files.length < 10 && <span className="mt-1 text-xs text-slate-500">{item.files.length ? 'PDF, JPG, PNG · up to 20 MB each' : 'or click to browse · PDF, JPG, PNG'}</span>}
    </button>
  </>;
}

export function ProcessingDocumentsStep({ pkg, onChange, busy, onBusyChange, onBack, error }: {
  pkg: PilotPackage; onChange: (p: PilotPackage) => void; busy: boolean;
  onBusyChange: (busy: boolean) => void; onBack: () => void; error: string;
}) {
  const [uploading, setUploading] = useState('');
  const [uploadError, setUploadError] = useState('');
  const uploadLock = useRef(false);
  const required = pkg.items.filter(i => i.required);
  const ready = required.filter(i => i.files.length || i.waiver.trim()).length;
  const updateItem = (id: string, change: Partial<PilotPackage['items'][number]>) => onChange({ ...pkg, items: pkg.items.map(i => i.id === id ? { ...i, ...change } : i) });
  async function upload(id: string, files: File[]) {
    if (!files.length || busy || uploadLock.current) return;
    uploadLock.current = true;
    setUploadError(''); setUploading(id); onBusyChange(true);
    let next = pkg;
    try {
      const isBatch = id === batchItem.id;
      const item = pkg.items.find(i => i.id === id);
      if (isBatch && pkg.items.length + files.length > 30) throw new Error(`You can add ${30 - pkg.items.length} more additional documents to this package.`);
      if (!isBatch && (!item || item.waiver.trim())) return;
      if (!isBatch && item!.files.length + files.length > 10) throw new Error('Use up to 10 files per category.');
      for (const file of Array.from(files)) validatePilotFile(file.name, file.size, file.type);
      for (const file of Array.from(files)) {
        const result = await prepareProcessingSubmissionUpload({ name: file.name, size: file.size, type: file.type });
        if (!result.success) throw new Error(result.error);
        const response = await fetch(result.data.signedUrl, { method: 'PUT', headers: { 'Content-Type': file.type }, body: file });
        if (!response.ok) throw new Error(`Upload failed for ${file.name}. Please retry.`);
        next = isBatch
          ? { ...next, items: [...next.items, { id: crypto.randomUUID(), label: file.name.replace(/\.[^.]+$/, '').slice(0, 150), required: false, files: [result.data.file], waiver: '', review: 'PENDING', feedback: '' }] }
          : { ...next, items: next.items.map(i => i.id === id ? { ...i, waiver: '', files: [...i.files, result.data.file] } : i) };
        onChange(next);
      }
    } catch (e) { setUploadError(e instanceof Error ? e.message : 'Upload failed. Please retry.'); }
    finally { uploadLock.current = false; setUploading(''); onBusyChange(false); }
  }
  return <div className="space-y-4" onDragOver={e => e.preventDefault()} onDrop={e => e.preventDefault()}>
    <div className="rounded-xl border border-violet-200 bg-violet-50/40 p-4">
      <h3 className="flex items-center gap-2 font-semibold text-slate-900"><Upload size={18} className="text-violet-600" /> Upload submission documents</h3>
      <p className="mt-1 text-sm text-slate-600">Your loan details are ready. Add the documents below so your Jr Processor can review the complete file.</p>
      <div className="mt-3 flex justify-between text-xs font-semibold text-violet-700"><span>Required categories prepared</span><span>{ready} of {required.length}</span></div>
      <progress className="mt-1 h-2 w-full accent-violet-600" aria-label="Required document categories prepared" max={required.length} value={ready} />
    </div>
    <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs" aria-label="Document status legend"><span className="text-red-700">● Red: Required</span><span className="text-emerald-700">● Green: Uploaded</span><span className="text-slate-500">● Grey: Not Applicable</span></div>
    {[true, false].map(requiredSection => <section key={String(requiredSection)} className="space-y-3">
      <h3 className="text-sm font-bold text-slate-900">{requiredSection ? 'Required documents' : 'Additional documents'}</h3>
      {requiredSection ? <p className="text-xs text-slate-500">Drop files onto each icon, or select Not Applicable. Your Jr Processor reviews both documents and Not Applicable selections.</p> : <><p className="text-xs text-slate-500">Upload multiple files at once, then edit the label for each document below.</p><DocumentDropzone item={batchItem} disabled={busy || pkg.items.length >= 30} uploading={uploading === batchItem.id} onFiles={files => void upload(batchItem.id, files)} /></>}
      <div className="grid items-start gap-3 sm:grid-cols-2">{pkg.items.filter(i => i.required === requiredSection).map(item => <div key={item.id} className="rounded-2xl border border-slate-200 bg-white p-3 space-y-3">
        <div className="flex items-center justify-between gap-2 px-1"><span className="text-xs font-medium text-slate-500">{item.required ? 'Required category' : 'Additional'}</span>{item.files.length ? <span className="flex items-center gap-1 text-xs font-medium text-emerald-700"><CheckCircle size={14} aria-hidden="true" />{item.files.length} uploaded</span> : <span className={`text-xs ${item.waiver.trim() ? 'text-slate-500' : 'text-red-600'}`}>{item.waiver.trim() ? 'Not Applicable' : 'Required · Missing'}</span>}</div>
        {item.required ? <DocumentDropzone item={item} disabled={busy || item.files.length >= 10 || !!item.waiver.trim()} uploading={uploading === item.id} onFiles={files => void upload(item.id, files)} /> : <label className="block text-xs font-medium text-slate-700">Document label<input className="app-input mt-1" aria-label={`Label for ${item.files[0]?.name || 'additional document'}`} maxLength={150} value={item.label} disabled={busy} onChange={e => updateItem(item.id, { label: e.target.value })} placeholder="Name this document" required /></label>}
        {item.files.map(file => <div key={file.id} className="flex items-center justify-between gap-2 rounded-lg bg-emerald-50 p-2 text-sm"><span className="flex min-w-0 items-center gap-2"><FileText size={16} className="shrink-0 text-emerald-600" aria-hidden="true" /><span className="min-w-0"><span className="block truncate" title={file.name}>{file.name}</span><span className="block text-xs text-slate-500">{(file.size / 1024 / 1024).toFixed(1)} MB</span></span></span><button type="button" className="app-icon-btn shrink-0 text-red-700" disabled={busy} onClick={() => item.required ? updateItem(item.id, { files: item.files.filter(f => f.id !== file.id) }) : onChange({ ...pkg, items: pkg.items.filter(i => i.id !== item.id) })} aria-label={`Remove ${file.name}`}><X size={15} aria-hidden="true" /></button></div>)}
        {item.required && <div className="px-1"><label className="flex items-center gap-2 text-xs font-medium text-slate-600"><input type="checkbox" className="h-4 w-4 accent-slate-600" checked={!!item.waiver.trim()} disabled={busy || !!item.files.length} onChange={e => updateItem(item.id, { waiver: e.target.checked ? NOT_APPLICABLE : '' })} />Not Applicable</label>{!!item.files.length && <p className="mt-1 text-xs text-slate-500">Remove uploaded files to mark Not Applicable.</p>}{!!item.waiver.trim() && <label className="mt-2 block text-xs text-slate-500">Reason (optional)<textarea className="app-input mt-1" maxLength={2000} value={item.waiver === NOT_APPLICABLE ? '' : item.waiver} disabled={busy} onChange={e => updateItem(item.id, { waiver: e.target.value.trim() ? e.target.value : NOT_APPLICABLE })} placeholder="Add context for your Jr Processor" /></label>}</div>}
      </div>)}</div>
    </section>)}
    <p className="text-xs text-slate-500">PDF, JPG, PNG · Up to 20 MB per file · At least one document required. Keep this popup open until you submit.</p>
    <p role="status" aria-live="polite" className="text-sm text-red-700">{uploadError || error}</p>
    <p className="text-sm text-slate-600">{pilotSubmissionError(pkg) || 'Your documents are ready for Jr Processor review.'}</p>
    <div className="flex justify-between gap-3 pt-2"><button type="button" className="app-btn-secondary" disabled={busy} onClick={onBack}>Back to processing details</button><button type="submit" className="inline-flex items-center gap-2 rounded-lg bg-violet-600 px-4 py-2 text-sm font-semibold text-white hover:bg-violet-700 disabled:opacity-50" disabled={busy || !!pilotSubmissionError(pkg)}>{busy && <Loader2 size={16} className="animate-spin" />}Submit for Processing</button></div>
  </div>;
}
