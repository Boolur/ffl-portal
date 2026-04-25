'use client';

import React, { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import {
  X, Upload, FileSpreadsheet, ChevronRight, ChevronLeft, Check, Loader2, AlertCircle, UserCheck, Users, Zap,
} from 'lucide-react';
import Papa from 'papaparse';
import {
  bulkCreateLeadsBatch,
  saveCsvMappings,
  revalidateLeadPaths,
} from '@/app/actions/leadActions';
import { useRouter } from 'next/navigation';
import {
  normalizeUserName,
  buildNameIndex,
  matchUser,
  type NameIndexUser,
} from '@/lib/leadNameMatch';

type SavedMapping = { csvHeader: string; ourField: string; usageCount: number };
type EligibleUser = NameIndexUser & { role?: string };

const NORMALIZED_FIELDS = [
  'firstName','lastName','email','phone','homePhone','workPhone','dob','ssn',
  'coFirstName','coLastName','coEmail','coPhone','coHomePhone','coWorkPhone','coDob',
  'propertyAddress','propertyCity','propertyState','propertyZip','propertyCounty',
  'purchasePrice','propertyValue','propertyType','propertyUse','propertyAcquired','propertyLtv',
  'employer','jobTitle','employmentLength','selfEmployed','income','bankruptcy','foreclosure','homeowner',
  'coEmployer','coJobTitle','coEmploymentLength','coSelfEmployed','coIncome',
  'loanPurpose','loanAmount','loanTerm','loanType','loanRate',
  'downPayment','cashOut','creditRating',
  'currentLender','currentBalance','currentRate','currentPayment','currentTerm','currentType',
  'otherBalance','otherPayment','targetRate',
  'vaStatus','vaLoan','isMilitary','fhaLoan','sourceUrl','leadCreated','price',
  'assignedUserName',
];

const REQUIRED_FIELDS = new Set(['phone', 'propertyState']);
const ASSIGNMENT_FIELD = 'assignedUserName';
const NAME_DECISIONS_KEY = 'leads.csvImport.nameDecisions.v1';

const FIELD_LABELS: Record<string, string> = {
  firstName: 'First Name', lastName: 'Last Name', email: 'Email', phone: 'Phone',
  homePhone: 'Home Phone', workPhone: 'Work Phone', dob: 'DOB', ssn: 'SSN',
  coFirstName: 'Co First Name', coLastName: 'Co Last Name', coEmail: 'Co Email',
  coPhone: 'Co Phone', coHomePhone: 'Co Home Phone', coWorkPhone: 'Co Work Phone', coDob: 'Co DOB',
  propertyAddress: 'Address', propertyCity: 'City', propertyState: 'State',
  propertyZip: 'Zip', propertyCounty: 'County',
  purchasePrice: 'Purchase Price', propertyValue: 'Property Value', propertyType: 'Property Type',
  propertyUse: 'Property Use', propertyAcquired: 'Property Acquired', propertyLtv: 'Property LTV',
  employer: 'Employer', jobTitle: 'Job Title', employmentLength: 'Employment Length',
  selfEmployed: 'Self Employed', income: 'Income', bankruptcy: 'Bankruptcy', foreclosure: 'Foreclosure', homeowner: 'Homeowner',
  coEmployer: 'Co Employer', coJobTitle: 'Co Job Title', coEmploymentLength: 'Co Employment Length',
  coSelfEmployed: 'Co Self Employed', coIncome: 'Co Income',
  loanPurpose: 'Loan Purpose', loanAmount: 'Loan Amount', loanTerm: 'Loan Term',
  loanType: 'Loan Type', loanRate: 'Loan Rate', downPayment: 'Down Payment',
  cashOut: 'Cash Out', creditRating: 'Credit Rating',
  currentLender: 'Current Lender', currentBalance: 'Current Balance', currentRate: 'Current Rate',
  currentPayment: 'Current Payment', currentTerm: 'Current Term', currentType: 'Current Type',
  otherBalance: 'Other Balance', otherPayment: 'Other Payment', targetRate: 'Target Rate',
  vaStatus: 'VA Status', vaLoan: 'VA Loan', isMilitary: 'Is Military',
  fhaLoan: 'FHA Loan', sourceUrl: 'Source URL', leadCreated: 'Created Date', price: 'Price',
  assignedUserName: 'Assigned LO Name',
};

const UNASSIGNED_VALUE = '__unassigned__';

type DistinctName = {
  normalized: string;
  raw: string;
  count: number;
  matchKind: 'exact_name' | 'exact_email' | 'none' | 'ambiguous';
  candidateIds: string[];
};

export function CsvUploadModal({
  open,
  onClose,
  savedMappings,
  eligibleUsers = [],
}: {
  open: boolean;
  onClose: () => void;
  savedMappings: SavedMapping[];
  eligibleUsers?: EligibleUser[];
}) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [step, setStep] = useState<1 | 2 | 3 | 4>(1);
  const [fileName, setFileName] = useState('');
  const [headers, setHeaders] = useState<string[]>([]);
  const [rows, setRows] = useState<Record<string, string>[]>([]);
  const [columnMap, setColumnMap] = useState<Record<string, string>>({});
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [result, setResult] = useState<{ created: number } | null>(null);
  const [error, setError] = useState('');
  const [dragOver, setDragOver] = useState(false);

  // Assignment (Step 3) state. `nameDecisions` maps normalized CSV name ->
  // portal user id (or null = leave unassigned). The keys mirror whatever
  // buildNameIndex normalizes to, so repeat imports can skip step 3 if every
  // name is already resolved.
  const [nameDecisions, setNameDecisions] = useState<Record<string, string | null>>({});
  const [fireBonzo, setFireBonzo] = useState(false);

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

  const assignmentEnabled = usedFields.has(ASSIGNMENT_FIELD);

  const nameIndex = useMemo(() => buildNameIndex(eligibleUsers), [eligibleUsers]);

  // Load any previously-saved name -> userId decisions from localStorage so
  // a second import of the same roster auto-fills the dropdowns.
  const savedDecisions = useMemo((): Record<string, string | null> => {
    if (typeof window === 'undefined') return {};
    try {
      const raw = window.localStorage.getItem(NAME_DECISIONS_KEY);
      return raw ? (JSON.parse(raw) as Record<string, string | null>) : {};
    } catch {
      return {};
    }
  }, []);

  // Collect distinct non-blank "User Name" values from the CSV, count rows
  // per name, and attempt an auto-match. Rows with blank names bypass this
  // list and always land unassigned.
  const distinctNames = useMemo<DistinctName[]>(() => {
    if (!assignmentEnabled) return [];
    const assignedHeader = Object.entries(columnMap).find(
      ([, v]) => v === ASSIGNMENT_FIELD
    )?.[0];
    const emailHeader = Object.entries(columnMap).find(
      ([, v]) => v === 'email'
    )?.[0];
    if (!assignedHeader) return [];
    const buckets = new Map<string, { raw: string; count: number; sampleEmail?: string }>();
    for (const row of rows) {
      const rawName = row[assignedHeader];
      const key = normalizeUserName(rawName);
      if (!key) continue;
      const existing = buckets.get(key);
      if (existing) {
        existing.count += 1;
      } else {
        buckets.set(key, {
          raw: String(rawName ?? '').trim(),
          count: 1,
          sampleEmail: emailHeader ? row[emailHeader] : undefined,
        });
      }
    }
    const out: DistinctName[] = [];
    for (const [normalized, info] of buckets.entries()) {
      const match = matchUser(nameIndex, info.raw, info.sampleEmail);
      out.push({
        normalized,
        raw: info.raw,
        count: info.count,
        matchKind: match.kind,
        candidateIds:
          match.kind === 'ambiguous'
            ? match.candidateIds ?? []
            : match.userId
              ? [match.userId]
              : [],
      });
    }
    out.sort((a, b) => b.count - a.count);
    return out;
  }, [assignmentEnabled, columnMap, rows, nameIndex]);

  const blankNameCount = useMemo(() => {
    if (!assignmentEnabled) return 0;
    const assignedHeader = Object.entries(columnMap).find(
      ([, v]) => v === ASSIGNMENT_FIELD
    )?.[0];
    if (!assignedHeader) return 0;
    let count = 0;
    for (const row of rows) {
      const rawName = row[assignedHeader];
      if (!normalizeUserName(rawName)) count += 1;
    }
    return count;
  }, [assignmentEnabled, columnMap, rows]);

  // Seed nameDecisions when entering step 3 — prefer previously-saved
  // decisions; fall back to auto-match results for anything not yet decided.
  useEffect(() => {
    if (!assignmentEnabled || distinctNames.length === 0) return;
    setNameDecisions((prev) => {
      const next = { ...prev };
      let changed = false;
      for (const dn of distinctNames) {
        if (next[dn.normalized] !== undefined) continue;
        if (Object.prototype.hasOwnProperty.call(savedDecisions, dn.normalized)) {
          next[dn.normalized] = savedDecisions[dn.normalized];
          changed = true;
          continue;
        }
        if (dn.matchKind === 'exact_name' || dn.matchKind === 'exact_email') {
          next[dn.normalized] = dn.candidateIds[0] ?? null;
          changed = true;
        } else {
          next[dn.normalized] = null;
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [assignmentEnabled, distinctNames, savedDecisions]);

  const setNameDecision = (normalized: string, userId: string | null) => {
    setNameDecisions((p) => ({ ...p, [normalized]: userId }));
  };

  const assignedCount = useMemo(() => {
    if (!assignmentEnabled) return 0;
    let n = 0;
    for (const dn of distinctNames) {
      if (nameDecisions[dn.normalized]) n += dn.count;
    }
    return n;
  }, [assignmentEnabled, distinctNames, nameDecisions]);

  const unassignedCount = rows.length - assignedCount;

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

      // Persist the user's name -> userId decisions so the next import of
      // the same roster skips most of step 3.
      if (assignmentEnabled && typeof window !== 'undefined') {
        try {
          const merged = { ...savedDecisions, ...nameDecisions };
          window.localStorage.setItem(
            NAME_DECISIONS_KEY,
            JSON.stringify(merged)
          );
        } catch {
          /* localStorage disabled — safe to ignore */
        }
      }

      const assignment = assignmentEnabled
        ? { nameToUserId: nameDecisions, fireBonzo }
        : undefined;

      const batchSize = 50;
      const totalBatches = Math.ceil(mappedRows.length / batchSize);
      let totalCreated = 0;

      for (let i = 0; i < mappedRows.length; i += batchSize) {
        const batch = mappedRows.slice(i, i + batchSize);
        const res = await bulkCreateLeadsBatch(
          batch,
          assignment ? { assignment } : undefined
        );
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
      setStep(4);
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
    setNameDecisions({});
    setFireBonzo(false);
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
            {step > 1 && step < 4 && (
              <span className="text-xs text-slate-400">
                Step {step} of {assignmentEnabled ? 3 : 2}
              </span>
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

          {/* Step 3: Assignment Review (only when "Assigned LO Name" is mapped) */}
          {step === 3 && assignmentEnabled && (
            <div className="space-y-4">
              <div className="flex items-center gap-2">
                <UserCheck className="h-5 w-5 text-blue-600" />
                <div>
                  <p className="text-sm font-semibold text-slate-900">
                    Map CSV names to portal users
                  </p>
                  <p className="text-xs text-slate-500">
                    Each distinct &ldquo;{FIELD_LABELS[ASSIGNMENT_FIELD]}&rdquo; value below
                    will assign its leads to the chosen portal user. Pick
                    &ldquo;Leave unassigned&rdquo; for anyone you can&apos;t place yet
                    &mdash; those leads land in the Unassigned Pool.
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-3 gap-3 text-sm">
                <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2">
                  <div className="text-[11px] font-bold uppercase tracking-wider text-emerald-700">
                    Will be assigned
                  </div>
                  <div className="text-xl font-bold text-emerald-900 tabular-nums">
                    {assignedCount}
                  </div>
                </div>
                <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2">
                  <div className="text-[11px] font-bold uppercase tracking-wider text-amber-700">
                    Unassigned
                  </div>
                  <div className="text-xl font-bold text-amber-900 tabular-nums">
                    {unassignedCount}
                  </div>
                  {blankNameCount > 0 && (
                    <div className="text-[11px] text-amber-700 mt-0.5">
                      ({blankNameCount} row{blankNameCount === 1 ? '' : 's'} with no name)
                    </div>
                  )}
                </div>
                <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                  <div className="text-[11px] font-bold uppercase tracking-wider text-slate-600">
                    Total rows
                  </div>
                  <div className="text-xl font-bold text-slate-900 tabular-nums">
                    {rows.length}
                  </div>
                </div>
              </div>

              {distinctNames.length === 0 ? (
                <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-8 text-center text-sm text-slate-500">
                  No non-empty names found in the selected column. All rows
                  will land in the Unassigned Pool.
                </div>
              ) : (
                <div className="rounded-xl border border-slate-200 overflow-hidden">
                  <div className="bg-slate-50 px-4 py-2 text-[11px] font-bold uppercase tracking-wider text-slate-500 flex items-center gap-2">
                    <Users className="h-3.5 w-3.5" />
                    {distinctNames.length} distinct name
                    {distinctNames.length === 1 ? '' : 's'}
                  </div>
                  <div className="divide-y divide-slate-100 max-h-[380px] overflow-y-auto">
                    {distinctNames.map((dn) => {
                      const decision = nameDecisions[dn.normalized];
                      const resolved = decision
                        ? eligibleUsers.find((u) => u.id === decision)
                        : null;
                      const selectValue = decision ?? UNASSIGNED_VALUE;

                      let statusEl: React.ReactNode = null;
                      if (resolved) {
                        statusEl = (
                          <span className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-700">
                            <Check className="h-3 w-3" />
                            {dn.matchKind === 'exact_name' && !decision
                              ? 'Auto-matched'
                              : 'Assigned'}
                          </span>
                        );
                      } else if (dn.matchKind === 'ambiguous') {
                        statusEl = (
                          <span className="inline-flex items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-800">
                            <AlertCircle className="h-3 w-3" />
                            Pick one ({dn.candidateIds.length} candidates)
                          </span>
                        );
                      } else {
                        statusEl = (
                          <span className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[11px] font-semibold text-slate-600">
                            Unassigned
                          </span>
                        );
                      }

                      return (
                        <div
                          key={dn.normalized}
                          className="px-4 py-2.5 flex items-center gap-3"
                        >
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="text-sm font-semibold text-slate-900 truncate">
                                {dn.raw}
                              </span>
                              {statusEl}
                            </div>
                            <p className="text-[11px] text-slate-500 mt-0.5">
                              {dn.count} lead{dn.count === 1 ? '' : 's'}
                            </p>
                          </div>
                          <div className="w-72 shrink-0">
                            <select
                              className="w-full rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                              value={selectValue}
                              onChange={(e) => {
                                const v = e.target.value;
                                setNameDecision(
                                  dn.normalized,
                                  v === UNASSIGNED_VALUE ? null : v
                                );
                              }}
                            >
                              <option value={UNASSIGNED_VALUE}>
                                Leave unassigned
                              </option>
                              {eligibleUsers.map((u) => (
                                <option key={u.id} value={u.id}>
                                  {u.name} &lt;{u.email}&gt;
                                </option>
                              ))}
                            </select>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              <label className="flex items-start gap-2 rounded-xl border border-slate-200 bg-slate-50/60 px-3 py-2.5 text-sm text-slate-700 cursor-pointer">
                <input
                  type="checkbox"
                  className="mt-0.5 accent-indigo-600"
                  checked={fireBonzo}
                  onChange={(e) => setFireBonzo(e.target.checked)}
                />
                <span className="flex-1">
                  <span className="inline-flex items-center gap-1 font-semibold">
                    <Zap className="h-3.5 w-3.5 text-indigo-600" />
                    Also forward imported leads to Bonzo
                  </span>
                  <span className="block text-xs text-slate-500 mt-0.5">
                    Off by default. Turn on only if these leads have never
                    been sent to Bonzo before &mdash; historical imports are
                    usually already in each LO&apos;s Bonzo account.
                  </span>
                </span>
              </label>
            </div>
          )}

          {/* Step 4: Success */}
          {step === 4 && result && (
            <div className="py-10 text-center space-y-4">
              <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-green-100">
                <Check className="h-8 w-8 text-green-600" />
              </div>
              <div>
                <p className="text-lg font-bold text-slate-900">{result.created} leads uploaded</p>
                <p className="text-sm text-slate-500 mt-1">
                  {assignmentEnabled
                    ? `${assignedCount} assigned to loan officers, ${result.created - assignedCount} in the Unassigned Pool.`
                    : 'They are now in the Unassigned Lead Pool ready for assignment.'}
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

        {/* Footer - Step 2 (Column Mapping) */}
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
            {assignmentEnabled ? (
              <button
                type="button"
                className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-blue-700 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
                onClick={() => setStep(3)}
                disabled={mappedCount === 0 || missingRequired.length > 0}
              >
                Review Assignments
                <ChevronRight className="h-4 w-4" />
              </button>
            ) : (
              <button
                type="button"
                className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-blue-700 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
                onClick={() => void handleUpload()}
                disabled={uploading || mappedCount === 0 || missingRequired.length > 0}
              >
                Upload {rows.length} Leads
                <ChevronRight className="h-4 w-4" />
              </button>
            )}
          </div>
        )}

        {/* Footer - Step 3 (Assignment Review) */}
        {step === 3 && assignmentEnabled && (
          <div className="border-t border-slate-200 px-6 py-4 bg-slate-50/50 flex items-center justify-between">
            <button
              type="button"
              className="app-btn-secondary text-sm flex items-center gap-1"
              onClick={() => setStep(2)}
            >
              <ChevronLeft className="h-4 w-4" />
              Back to Mapping
            </button>
            <button
              type="button"
              className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-blue-700 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
              onClick={() => void handleUpload()}
              disabled={uploading}
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
