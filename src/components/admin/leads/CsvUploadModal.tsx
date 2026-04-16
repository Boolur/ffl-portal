'use client';

import React, { useState, useMemo, useCallback, useRef } from 'react';
import {
  X, Upload, FileSpreadsheet, ChevronRight, ChevronLeft, Check, Loader2, AlertCircle,
} from 'lucide-react';
import Papa from 'papaparse';
import {
  bulkCreateLeadsBatch,
  saveCsvMappings,
  revalidateLeadPaths,
} from '@/app/actions/leadActions';
import { useRouter } from 'next/navigation';

type SavedMapping = { csvHeader: string; ourField: string; usageCount: number };

const NORMALIZED_FIELDS = [
  'firstName','lastName','email','phone','homePhone','workPhone','dob',
  'coFirstName','coLastName','coEmail','coPhone','coHomePhone','coWorkPhone','coDob',
  'propertyAddress','propertyCity','propertyState','propertyZip','propertyCounty',
  'purchasePrice','propertyValue','propertyType','propertyUse','propertyAcquired','propertyLtv',
  'employer','jobTitle','employmentLength','selfEmployed','income','bankruptcy','homeowner',
  'coEmployer','coJobTitle','coEmploymentLength','coSelfEmployed','coIncome',
  'loanPurpose','loanAmount','loanTerm','loanType','loanRate',
  'downPayment','cashOut','creditRating',
  'currentLender','currentBalance','currentRate','currentPayment','currentTerm','currentType',
  'otherBalance','otherPayment','targetRate',
  'vaStatus','vaLoan','isMilitary','fhaLoan','sourceUrl','price',
];

const REQUIRED_FIELDS = new Set(['phone', 'propertyState']);

const FIELD_LABELS: Record<string, string> = {
  firstName: 'First Name', lastName: 'Last Name', email: 'Email', phone: 'Phone',
  homePhone: 'Home Phone', workPhone: 'Work Phone', dob: 'DOB',
  coFirstName: 'Co First Name', coLastName: 'Co Last Name', coEmail: 'Co Email',
  coPhone: 'Co Phone', coHomePhone: 'Co Home Phone', coWorkPhone: 'Co Work Phone', coDob: 'Co DOB',
  propertyAddress: 'Address', propertyCity: 'City', propertyState: 'State',
  propertyZip: 'Zip', propertyCounty: 'County',
  purchasePrice: 'Purchase Price', propertyValue: 'Property Value', propertyType: 'Property Type',
  propertyUse: 'Property Use', propertyAcquired: 'Property Acquired', propertyLtv: 'Property LTV',
  employer: 'Employer', jobTitle: 'Job Title', employmentLength: 'Employment Length',
  selfEmployed: 'Self Employed', income: 'Income', bankruptcy: 'Bankruptcy', homeowner: 'Homeowner',
  coEmployer: 'Co Employer', coJobTitle: 'Co Job Title', coEmploymentLength: 'Co Employment Length',
  coSelfEmployed: 'Co Self Employed', coIncome: 'Co Income',
  loanPurpose: 'Loan Purpose', loanAmount: 'Loan Amount', loanTerm: 'Loan Term',
  loanType: 'Loan Type', loanRate: 'Loan Rate', downPayment: 'Down Payment',
  cashOut: 'Cash Out', creditRating: 'Credit Rating',
  currentLender: 'Current Lender', currentBalance: 'Current Balance', currentRate: 'Current Rate',
  currentPayment: 'Current Payment', currentTerm: 'Current Term', currentType: 'Current Type',
  otherBalance: 'Other Balance', otherPayment: 'Other Payment', targetRate: 'Target Rate',
  vaStatus: 'VA Status', vaLoan: 'VA Loan', isMilitary: 'Is Military',
  fhaLoan: 'FHA Loan', sourceUrl: 'Source URL', price: 'Price',
};

export function CsvUploadModal({
  open,
  onClose,
  savedMappings,
}: {
  open: boolean;
  onClose: () => void;
  savedMappings: SavedMapping[];
}) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [fileName, setFileName] = useState('');
  const [headers, setHeaders] = useState<string[]>([]);
  const [rows, setRows] = useState<Record<string, string>[]>([]);
  const [columnMap, setColumnMap] = useState<Record<string, string>>({});
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [result, setResult] = useState<{ created: number } | null>(null);
  const [error, setError] = useState('');
  const [dragOver, setDragOver] = useState(false);

  const mappingLookup = useMemo(() => {
    const map: Record<string, string> = {};
    for (const m of savedMappings) {
      const key = m.csvHeader.toLowerCase().trim();
      if (!map[key]) map[key] = m.ourField;
    }
    return map;
  }, [savedMappings]);

  const autoMapHeaders = useCallback((hdrs: string[]) => {
    const mapped: Record<string, string> = {};
    const usedFields = new Set<string>();

    for (const h of hdrs) {
      const key = h.toLowerCase().trim();
      if (mappingLookup[key] && !usedFields.has(mappingLookup[key])) {
        mapped[h] = mappingLookup[key];
        usedFields.add(mappingLookup[key]);
        continue;
      }
      const normalized = key.replace(/[\s_-]+/g, '').toLowerCase();
      for (const f of NORMALIZED_FIELDS) {
        if (usedFields.has(f)) continue;
        if (f.toLowerCase() === normalized) {
          mapped[h] = f;
          usedFields.add(f);
          break;
        }
      }
    }
    return mapped;
  }, [mappingLookup]);

  const handleFile = useCallback((file: File) => {
    setError('');
    if (!file.name.endsWith('.csv')) {
      setError('Please select a .csv file');
      return;
    }
    Papa.parse<Record<string, string>>(file, {
      header: true,
      skipEmptyLines: true,
      complete: (results) => {
        if (!results.meta.fields || results.meta.fields.length === 0) {
          setError('Could not detect columns in this CSV');
          return;
        }
        const hdrs = results.meta.fields;
        const data = results.data.filter((row) =>
          Object.values(row).some((v) => v && v.trim())
        );
        if (data.length === 0) {
          setError('CSV file has no data rows');
          return;
        }
        setFileName(file.name);
        setHeaders(hdrs);
        setRows(data);
        setColumnMap(autoMapHeaders(hdrs));
        setStep(2);
      },
      error: () => {
        setError('Failed to parse CSV file');
      },
    });
  }, [autoMapHeaders]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  }, [handleFile]);

  const handleInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleFile(file);
  }, [handleFile]);

  const mappedCount = useMemo(
    () => Object.values(columnMap).filter((v) => v && v !== '__skip__').length,
    [columnMap]
  );

  const missingRequired = useMemo(() => {
    const mapped = new Set(Object.values(columnMap).filter((v) => v && v !== '__skip__'));
    return [...REQUIRED_FIELDS].filter((f) => !mapped.has(f));
  }, [columnMap]);

  const setMapping = (header: string, field: string) => {
    setColumnMap((prev) => ({ ...prev, [header]: field }));
  };

  const usedFields = useMemo(() => {
    const s = new Set<string>();
    for (const v of Object.values(columnMap)) {
      if (v && v !== '__skip__') s.add(v);
    }
    return s;
  }, [columnMap]);

  const handleUpload = async () => {
    setUploading(true);
    setUploadProgress(0);
    setError('');
    try {
      const mappedRows = rows.map((row) => {
        const mapped: Record<string, string | null> = {};
        for (const [csvHeader, ourField] of Object.entries(columnMap)) {
          if (!ourField || ourField === '__skip__') continue;
          const val = row[csvHeader];
          if (val != null && val.trim() !== '') {
            mapped[ourField] = val.trim();
          }
        }
        return mapped;
      });

      const batchSize = 50;
      const totalBatches = Math.ceil(mappedRows.length / batchSize);
      let totalCreated = 0;

      for (let i = 0; i < mappedRows.length; i += batchSize) {
        const batch = mappedRows.slice(i, i + batchSize);
        const res = await bulkCreateLeadsBatch(batch);
        totalCreated += res.created;
        const completedBatches = Math.min(
          Math.floor(i / batchSize) + 1,
          totalBatches
        );
        setUploadProgress(Math.round((completedBatches / totalBatches) * 100));
      }

      const activeMappings = Object.entries(columnMap)
        .filter(([, v]) => v && v !== '__skip__')
        .map(([csvHeader, ourField]) => ({ csvHeader, ourField }));
      await saveCsvMappings(activeMappings);
      await revalidateLeadPaths();

      setResult({ created: totalCreated });
      setStep(3);
      router.refresh();
    } catch {
      setError('Upload failed. Please try again.');
    } finally {
      setUploading(false);
      setUploadProgress(0);
    }
  };

  const reset = () => {
    setStep(1);
    setFileName('');
    setHeaders([]);
    setRows([]);
    setColumnMap({});
    setResult(null);
    setError('');
    if (fileRef.current) fileRef.current.value = '';
  };

  const handleClose = () => {
    if (uploading) return;
    reset();
    onClose();
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center" onClick={handleClose}>
      <div className="absolute inset-0 bg-slate-900/30 backdrop-blur-sm" />
      <div
        role="dialog"
        aria-modal="true"
        className="relative w-full max-w-3xl bg-white rounded-2xl shadow-xl border border-slate-200 max-h-[90vh] overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {uploading && (
          <div className="absolute inset-0 z-20 flex items-center justify-center bg-white/95 backdrop-blur-sm rounded-2xl">
            <div className="flex flex-col items-center gap-4 w-64">
              <Loader2 className="h-10 w-10 animate-spin text-blue-600" />
              <div className="w-full">
                <div className="flex items-center justify-between mb-1.5">
                  <p className="text-sm font-semibold text-slate-700">
                    Uploading leads...
                  </p>
                  <span className="text-sm font-bold text-blue-600">
                    {uploadProgress}%
                  </span>
                </div>
                <div className="w-full h-2.5 bg-slate-200 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-blue-600 rounded-full transition-all duration-300 ease-out"
                    style={{ width: `${uploadProgress}%` }}
                  />
                </div>
                <p className="text-xs text-slate-500 mt-1.5 text-center">
                  {rows.length.toLocaleString()} leads &middot; Please wait...
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Header */}
        <div className="border-b border-slate-200 px-6 py-4 bg-slate-50/50 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <FileSpreadsheet className="h-5 w-5 text-blue-600" />
            <h2 className="text-lg font-bold text-slate-900">Upload CSV</h2>
            {step > 1 && (
              <span className="text-xs text-slate-400">Step {step} of 3</span>
            )}
          </div>
          <button
            className="text-slate-400 hover:text-slate-600 p-1 hover:bg-slate-200 rounded disabled:opacity-40 disabled:cursor-not-allowed"
            onClick={handleClose}
            disabled={uploading}
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-6 py-5">
          {/* Step 1: File Selection */}
          {step === 1 && (
            <div className="space-y-4">
              <div
                className={`rounded-xl border-2 border-dashed p-10 text-center transition-colors ${
                  dragOver
                    ? 'border-blue-400 bg-blue-50/50'
                    : 'border-slate-300 bg-slate-50/30 hover:border-blue-300 hover:bg-blue-50/20'
                }`}
                onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
                onDragLeave={() => setDragOver(false)}
                onDrop={handleDrop}
              >
                <Upload className="mx-auto h-10 w-10 text-slate-400 mb-3" />
                <p className="text-sm font-semibold text-slate-700">
                  Drag and drop a CSV file here
                </p>
                <p className="text-xs text-slate-500 mt-1 mb-4">or</p>
                <button
                  type="button"
                  className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-blue-700 transition-colors"
                  onClick={() => fileRef.current?.click()}
                >
                  <FileSpreadsheet className="h-4 w-4" />
                  Browse Files
                </button>
                <input
                  ref={fileRef}
                  type="file"
                  accept=".csv"
                  className="hidden"
                  onChange={handleInputChange}
                />
              </div>
              {error && (
                <div className="flex items-center gap-2 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
                  <AlertCircle className="h-4 w-4 shrink-0" />
                  {error}
                </div>
              )}
            </div>
          )}

          {/* Step 2: Column Mapping */}
          {step === 2 && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-semibold text-slate-900">{fileName}</p>
                  <p className="text-xs text-slate-500">{rows.length} rows &middot; {headers.length} columns &middot; {mappedCount} mapped</p>
                </div>
              </div>

              <div className="rounded-xl border border-slate-200 overflow-hidden divide-y divide-slate-100">
                {headers.map((h) => {
                  const mapped = columnMap[h];
                  const isMapped = mapped && mapped !== '__skip__';
                  const sampleVals = rows.slice(0, 3).map((r) => r[h]).filter(Boolean);

                  return (
                    <div key={h} className={`px-4 py-3 flex items-center gap-4 ${isMapped ? 'bg-green-50/30' : ''}`}>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          {isMapped ? (
                            <Check className="h-4 w-4 text-green-600 shrink-0" />
                          ) : (
                            <span className="h-4 w-4 rounded-full border-2 border-slate-300 shrink-0" />
                          )}
                          <span className="text-sm font-semibold text-slate-900 truncate">{h}</span>
                        </div>
                        {sampleVals.length > 0 && (
                          <p className="text-[11px] text-slate-400 mt-0.5 ml-6 truncate">
                            {sampleVals.join(' · ')}
                          </p>
                        )}
                      </div>
                      <div className="w-48 shrink-0">
                        <select
                          className={`w-full rounded-lg border px-3 py-1.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 ${
                            isMapped ? 'border-green-300 bg-green-50' : 'border-slate-200 bg-white'
                          }`}
                          value={mapped || '__skip__'}
                          onChange={(e) => setMapping(h, e.target.value)}
                        >
                          <option value="__skip__">Skip</option>
                          {NORMALIZED_FIELDS.map((f) => (
                            <option
                              key={f}
                              value={f}
                              disabled={usedFields.has(f) && columnMap[h] !== f}
                            >
                              {FIELD_LABELS[f] || f}{REQUIRED_FIELDS.has(f) ? ' *' : ''}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>
                  );
                })}
              </div>

              {missingRequired.length > 0 && (
                <div className="flex items-center gap-2 text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                  <AlertCircle className="h-4 w-4 shrink-0 text-amber-500" />
                  <span>
                    <strong>Required:</strong> You must map{' '}
                    {missingRequired.map((f) => FIELD_LABELS[f] || f).join(' and ')}{' '}
                    before uploading.
                  </span>
                </div>
              )}

              {error && (
                <div className="flex items-center gap-2 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
                  <AlertCircle className="h-4 w-4 shrink-0" />
                  {error}
                </div>
              )}
            </div>
          )}

          {/* Step 3: Success */}
          {step === 3 && result && (
            <div className="py-10 text-center space-y-4">
              <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-green-100">
                <Check className="h-8 w-8 text-green-600" />
              </div>
              <div>
                <p className="text-lg font-bold text-slate-900">{result.created} leads uploaded</p>
                <p className="text-sm text-slate-500 mt-1">
                  They are now in the Unassigned Lead Pool ready for assignment.
                </p>
              </div>
              <div className="flex justify-center gap-3 pt-2">
                <button
                  type="button"
                  className="app-btn-secondary text-sm"
                  onClick={() => { reset(); }}
                >
                  Upload Another
                </button>
                <button
                  type="button"
                  className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-blue-700 transition-colors"
                  onClick={handleClose}
                >
                  Done
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        {step === 2 && (
          <div className="border-t border-slate-200 px-6 py-4 bg-slate-50/50 flex items-center justify-between">
            <button
              type="button"
              className="app-btn-secondary text-sm flex items-center gap-1"
              onClick={() => { reset(); }}
            >
              <ChevronLeft className="h-4 w-4" />
              Back
            </button>
            <button
              type="button"
              className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-blue-700 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
              onClick={() => void handleUpload()}
              disabled={uploading || mappedCount === 0 || missingRequired.length > 0}
            >
              Upload {rows.length} Leads
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
