'use client';

import { useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, CheckCircle2, FileCheck2, FileText, Loader2, ShieldCheck, UploadCloud } from 'lucide-react';
import { CandidateOnboardingCase } from './OnboardingWizardTypes';

export function OnboardingDocumentsStep({
  documents,
  editable,
  uploading,
  onUpload,
  onDownload,
  onBack,
  onContinue,
}: {
  documents: CandidateOnboardingCase['documents'];
  editable: boolean;
  uploading: boolean;
  onUpload: (file: File) => void;
  onDownload: (documentId: string) => void;
  onBack: () => void;
  onContinue: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  const chooseFile = (file?: File) => {
    if (file) onUpload(file);
    if (inputRef.current) inputRef.current.value = '';
  };

  return (
    <section className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-[0_20px_60px_-32px_rgba(15,23,42,0.35)]">
      <div className="border-b border-slate-100 bg-gradient-to-r from-[#3e8dc8]/10 via-white to-emerald-50 px-5 py-6 sm:px-8">
        <div className="flex items-start gap-4">
          <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-[#3e8dc8] text-white shadow-lg shadow-[#3e8dc8]/20">
            <FileCheck2 className="h-6 w-6" aria-hidden="true" />
          </span>
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-[#347eb5]">Step two</p>
            <h2 className="mt-1 text-2xl font-bold tracking-tight text-slate-950">Secure documents</h2>
            <p className="mt-1 max-w-2xl text-sm leading-6 text-slate-600">
              Add any documents requested by your onboarding team. You can continue if none are required yet.
            </p>
          </div>
        </div>
      </div>

      <div className="space-y-6 px-5 py-6 sm:px-8 sm:py-8">
        {editable && (
          <>
            <input
              ref={inputRef}
              type="file"
              className="sr-only"
              accept=".pdf,.doc,.docx,.jpg,.jpeg,.png"
              onChange={(event) => chooseFile(event.target.files?.[0])}
            />
            <button
              type="button"
              disabled={uploading}
              onClick={() => inputRef.current?.click()}
              onDragEnter={(event) => { event.preventDefault(); setDragging(true); }}
              onDragOver={(event) => event.preventDefault()}
              onDragLeave={() => setDragging(false)}
              onDrop={(event) => {
                event.preventDefault();
                setDragging(false);
                chooseFile(event.dataTransfer.files?.[0]);
              }}
              className={`flex min-h-52 w-full flex-col items-center justify-center rounded-2xl border-2 border-dashed px-6 py-8 text-center transition-all duration-200 motion-reduce:transition-none ${
                dragging
                  ? 'border-[#3e8dc8] bg-[#3e8dc8]/10 shadow-inner'
                  : 'border-slate-300 bg-slate-50/70 hover:border-[#3e8dc8] hover:bg-[#3e8dc8]/5'
              } disabled:cursor-wait disabled:opacity-70`}
            >
              <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-white text-[#347eb5] shadow-sm ring-1 ring-slate-200">
                {uploading ? <Loader2 className="h-6 w-6 animate-spin motion-reduce:animate-none" aria-hidden="true" /> : <UploadCloud className="h-6 w-6" aria-hidden="true" />}
              </span>
              <span className="mt-4 text-base font-bold text-slate-900">
                {uploading ? 'Encrypting and uploading…' : 'Drop a file here or browse'}
              </span>
              <span className="mt-1 text-sm text-slate-500">PDF, Word, JPG, or PNG · Maximum 15 MB</span>
            </button>
          </>
        )}

        <div>
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-sm font-bold text-slate-900">Uploaded documents</h3>
            <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-600">
              {documents.length} {documents.length === 1 ? 'file' : 'files'}
            </span>
          </div>
          {documents.length === 0 ? (
            <div className="rounded-2xl border border-slate-200 bg-white px-6 py-10 text-center">
              <FileText className="mx-auto h-8 w-8 text-slate-300" aria-hidden="true" />
              <p className="mt-3 text-sm font-semibold text-slate-700">No documents uploaded</p>
              <p className="mt-1 text-xs text-slate-500">That is okay—you can add documents later if requested.</p>
            </div>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              {documents.map((document) => (
                <button
                  key={document.id}
                  type="button"
                  onClick={() => onDownload(document.id)}
                  className="group flex items-center gap-3 rounded-2xl border border-slate-200 bg-white p-4 text-left transition-all hover:-translate-y-0.5 hover:border-emerald-200 hover:shadow-md motion-reduce:transform-none"
                >
                  <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-emerald-50 text-emerald-600">
                    <FileCheck2 className="h-5 w-5" aria-hidden="true" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-bold text-slate-800">{document.name}</span>
                    <span className="mt-1 block text-xs text-slate-500">{formatFileSize(document.sizeBytes)} · Secure</span>
                  </span>
                  <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-500" aria-hidden="true" />
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="flex items-start gap-3 rounded-2xl border border-[#3e8dc8]/20 bg-[#3e8dc8]/5 p-4 text-sm text-slate-600">
          <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-[#347eb5]" aria-hidden="true" />
          <p><strong className="text-slate-800">Private by design.</strong> Files are encrypted and available only to you and authorized onboarding staff.</p>
        </div>
      </div>

      <div className="flex items-center justify-between border-t border-slate-100 bg-slate-50/70 px-5 py-4 sm:px-8">
        <button type="button" onClick={onBack} disabled={uploading} className="app-btn-secondary h-11 disabled:opacity-50">
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          Back
        </button>
        <button type="button" onClick={onContinue} disabled={uploading} className="app-btn-primary h-11 px-5 disabled:opacity-50">
          Review
          <ArrowRight className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>
    </section>
  );
}

function formatFileSize(bytes: number) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
