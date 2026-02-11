'use client';

import React, { useEffect, useMemo, useState } from 'react';
import {
  addPipelineNote,
  createPipelineStage,
  deletePipelineStage,
  getLoanDetails,
  getLoanOfficers,
  getPipelineData,
  importPipelineCsv,
  moveLoanToPipelineStage,
  updatePipelineStage,
} from '@/app/actions/pipelineActions';
import { useImpersonation } from '@/lib/impersonation';
import { UserRole } from '@prisma/client';
import { Plus, Search, Upload, X, StickyNote, Loader2 } from 'lucide-react';

type LoanOfficer = {
  id: string;
  name: string;
  email: string;
};

type PipelineStage = {
  id: string;
  name: string;
  order: number;
  color?: string | null;
};

type PipelineLoan = {
  id: string;
  loanNumber: string;
  borrowerName: string;
  amount: number;
  pipelineStageId?: string | null;
  updatedAt: Date;
};

type LoanDetails = {
  id: string;
  loanNumber: string;
  borrowerName: string;
  amount: number;
  program?: string | null;
  propertyAddress?: string | null;
  pipelineStageId?: string | null;
  tasks: Array<{
    id: string;
    title: string;
    status: string;
    dueDate?: Date | null;
  }>;
  pipelineNotes: Array<{
    id: string;
    body: string;
    createdAt: Date;
    user: { name: string };
  }>;
};

type CsvRow = {
  loanNumber: string;
  borrowerName?: string;
  borrowerFirstName?: string;
  borrowerLastName?: string;
  amount?: string | number;
  stage?: string;
};

const normalizeHeader = (value: string) =>
  value.toLowerCase().replace(/[^a-z0-9]/g, '');

const headerMap: Record<string, keyof CsvRow> = {
  loannumber: 'loanNumber',
  loanid: 'loanNumber',
  id: 'loanNumber',
  borrower: 'borrowerName',
  borrowername: 'borrowerName',
  borrowerfirstname: 'borrowerFirstName',
  borrowerlastname: 'borrowerLastName',
  firstname: 'borrowerFirstName',
  lastname: 'borrowerLastName',
  amount: 'amount',
  loanamount: 'amount',
  stage: 'stage',
  pipelinestage: 'stage',
  status: 'stage',
};

function parseCsv(raw: string): CsvRow[] {
  const lines = raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length < 2) return [];

  const headers = lines[0].split(',').map((h) => normalizeHeader(h));
  const mappedHeaders = headers.map((header) => headerMap[header] || null);

  return lines.slice(1).map((line) => {
    const values = line.split(',').map((v) => v.trim());
    return values.reduce<CsvRow>((acc, value, index) => {
      const key = mappedHeaders[index];
      if (key) acc[key] = value;
      return acc;
    }, { loanNumber: '' });
  });
}

export function PipelinePage() {
  const { activeRole } = useImpersonation();
  const [loanOfficers, setLoanOfficers] = useState<LoanOfficer[]>([]);
  const [selectedLoanOfficerId, setSelectedLoanOfficerId] = useState<string | null>(null);
  const [stages, setStages] = useState<PipelineStage[]>([]);
  const [loans, setLoans] = useState<PipelineLoan[]>([]);
  const [loading, setLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [search, setSearch] = useState('');
  const [stageFilter, setStageFilter] = useState<string>('all');
  const [newStageName, setNewStageName] = useState('');
  const [editingStageId, setEditingStageId] = useState<string | null>(null);
  const [editingStageName, setEditingStageName] = useState('');

  const [selectedLoanId, setSelectedLoanId] = useState<string | null>(null);
  const [loanDetails, setLoanDetails] = useState<LoanDetails | null>(null);
  const [noteText, setNoteText] = useState('');
  const [draggedLoanId, setDraggedLoanId] = useState<string | null>(null);
  const [dragOverStageId, setDragOverStageId] = useState<string | null>(null);

  const [showImport, setShowImport] = useState(false);
  const [importRows, setImportRows] = useState<CsvRow[]>([]);
  const [importResult, setImportResult] = useState<{ created: number; skipped: number } | null>(null);
  const [importParsingError, setImportParsingError] = useState<string | null>(null);

  const displayStages = useMemo(() => {
    return [
      { id: 'unassigned', name: 'Unassigned', order: -1, color: null },
      ...stages,
    ];
  }, [stages]);

  const filteredLoans = useMemo(() => {
    return loans.filter((loan) => {
      const matchesSearch =
        loan.borrowerName.toLowerCase().includes(search.toLowerCase()) ||
        loan.loanNumber.toLowerCase().includes(search.toLowerCase());
      const matchesStage =
        stageFilter === 'all' ||
        (stageFilter === 'unassigned'
          ? !loan.pipelineStageId
          : loan.pipelineStageId === stageFilter);
      return matchesSearch && matchesStage;
    });
  }, [loans, search, stageFilter]);

  const loansByStage = useMemo(() => {
    const grouped: Record<string, PipelineLoan[]> = {};
    displayStages.forEach((stage) => {
      grouped[stage.id] = [];
    });
    filteredLoans.forEach((loan) => {
      const key = loan.pipelineStageId || 'unassigned';
      if (!grouped[key]) grouped[key] = [];
      grouped[key].push(loan);
    });
    return grouped;
  }, [filteredLoans, displayStages]);

  const reloadPipeline = async (loanOfficerId: string | null) => {
    if (!loanOfficerId) return;
    setLoading(true);
    setError(null);
    try {
      const data = await getPipelineData(loanOfficerId);
      setStages(data.stages);
      setLoans(data.loans);
    } catch (err) {
      console.error(err);
      setError('Failed to load pipeline.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      try {
        const officers = await getLoanOfficers();
        setLoanOfficers(officers);
        if (officers.length > 0 && !selectedLoanOfficerId) {
          setSelectedLoanOfficerId(officers[0].id);
        }
      } catch (err) {
        console.error(err);
        setError('Failed to load loan officers.');
      } finally {
        setLoading(false);
      }
    };
    load();
  }, []);

  useEffect(() => {
    if (selectedLoanOfficerId) {
      reloadPipeline(selectedLoanOfficerId);
    }
  }, [selectedLoanOfficerId]);

  useEffect(() => {
    if (!selectedLoanId) {
      setLoanDetails(null);
      return;
    }
    const loadDetails = async () => {
      const details = await getLoanDetails(selectedLoanId);
      setLoanDetails(details);
    };
    loadDetails();
  }, [selectedLoanId]);

  const handleAddStage = async () => {
    if (isSubmitting) return;
    if (!newStageName.trim() || !selectedLoanOfficerId) return;
    setIsSubmitting(true);
    try {
      await createPipelineStage(selectedLoanOfficerId, newStageName.trim());
      setNewStageName('');
      await reloadPipeline(selectedLoanOfficerId);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleRenameStage = async (stageId: string) => {
    if (isSubmitting) return;
    if (!editingStageName.trim()) return;
    setIsSubmitting(true);
    try {
      await updatePipelineStage(stageId, editingStageName.trim());
      setEditingStageId(null);
      setEditingStageName('');
      await reloadPipeline(selectedLoanOfficerId);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDeleteStage = async (stageId: string) => {
    if (isSubmitting) return;
    if (!selectedLoanOfficerId) return;
    const fallbackStageId = stages.find((stage) => stage.id !== stageId)?.id || null;
    const confirmed = window.confirm(
      'Delete this stage? Loans will be moved to the next available stage.'
    );
    if (!confirmed) return;
    setIsSubmitting(true);
    try {
      await deletePipelineStage(stageId, fallbackStageId);
      await reloadPipeline(selectedLoanOfficerId);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleMoveLoan = async (loanId: string, pipelineStageId: string | null) => {
    await moveLoanToPipelineStage(loanId, pipelineStageId);
    await reloadPipeline(selectedLoanOfficerId);
  };

  const handleAddNote = async () => {
    if (isSubmitting) return;
    if (!loanDetails || !noteText.trim() || !selectedLoanOfficerId) return;
    setIsSubmitting(true);
    try {
      await addPipelineNote(loanDetails.id, selectedLoanOfficerId, noteText.trim());
      setNoteText('');
      const details = await getLoanDetails(loanDetails.id);
      setLoanDetails(details);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCsvFile = async (file: File) => {
    setImportParsingError(null);
    setImportResult(null);
    try {
      const text = await file.text();
      const rows = parseCsv(text);
      if (rows.length === 0) {
        setImportParsingError('No rows detected. Check the CSV format.');
        return;
      }
      setImportRows(rows);
    } catch (err) {
      console.error(err);
      setImportParsingError('Failed to parse CSV file.');
    }
  };

  const handleImport = async () => {
    if (isSubmitting) return;
    if (!selectedLoanOfficerId || importRows.length === 0) return;
    setIsSubmitting(true);
    try {
      const result = await importPipelineCsv(selectedLoanOfficerId, importRows);
      setImportResult(result);
      await reloadPipeline(selectedLoanOfficerId);
    } finally {
      setIsSubmitting(false);
    }
  };

  const showLoanOfficerSelector =
    activeRole === UserRole.ADMIN || activeRole === UserRole.MANAGER;

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Pipeline</h1>
          <p className="text-sm text-slate-500">
            Track and manage your pipeline with customizable stages.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => setShowImport(true)}
            className="inline-flex items-center gap-2 px-3 py-2 text-sm font-medium bg-white border border-slate-200 rounded-lg hover:bg-slate-50"
          >
            <Upload className="w-4 h-4" />
            Import CSV
          </button>
        </div>
      </div>

      {showLoanOfficerSelector && (
        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
          <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide">
            Loan Officer
          </label>
          <select
            value={selectedLoanOfficerId || ''}
            onChange={(e) => setSelectedLoanOfficerId(e.target.value)}
            className="mt-2 w-full md:w-72 px-3 py-2 border border-slate-200 rounded-lg text-sm"
          >
            {loanOfficers.map((officer) => (
              <option key={officer.id} value={officer.id}>
                {officer.name} ({officer.email})
              </option>
            ))}
          </select>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-6">
        <div className="space-y-4">
          <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm flex flex-col md:flex-row md:items-center gap-3">
            <div className="relative flex-1">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-3" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search borrower or loan number"
                className="w-full pl-9 pr-3 py-2 border border-slate-200 rounded-lg text-sm"
              />
            </div>
            <select
              value={stageFilter}
              onChange={(e) => setStageFilter(e.target.value)}
              className="px-3 py-2 border border-slate-200 rounded-lg text-sm"
            >
              <option value="all">All stages</option>
              <option value="unassigned">Unassigned</option>
              {stages.map((stage) => (
                <option key={stage.id} value={stage.id}>
                  {stage.name}
                </option>
              ))}
            </select>
          </div>

          <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
            <div className="flex items-center gap-2">
              <input
                value={newStageName}
                onChange={(e) => setNewStageName(e.target.value)}
                placeholder="Add new stage"
                className="flex-1 px-3 py-2 border border-slate-200 rounded-lg text-sm"
              />
              <button
                onClick={handleAddStage}
                disabled={isSubmitting}
                className="inline-flex items-center gap-2 px-3 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-70 disabled:cursor-not-allowed"
              >
                {isSubmitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
                Add Stage
              </button>
            </div>
          </div>

          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg p-3">
              {error}
            </div>
          )}

          {loading ? (
            <div className="flex items-center gap-2 text-slate-500">
              <Loader2 className="w-4 h-4 animate-spin" />
              Loading pipeline...
            </div>
          ) : (
            <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
              {displayStages.map((stage) => (
                <div
                  key={stage.id}
                  onDragOver={(event) => {
                    event.preventDefault();
                    setDragOverStageId(stage.id);
                  }}
                  onDragLeave={() => setDragOverStageId(null)}
                  onDrop={async (event) => {
                    event.preventDefault();
                    if (draggedLoanId) {
                      await handleMoveLoan(
                        draggedLoanId,
                        stage.id === 'unassigned' ? null : stage.id
                      );
                    }
                    setDragOverStageId(null);
                    setDraggedLoanId(null);
                  }}
                  className={`bg-slate-50 border rounded-xl p-3 flex flex-col gap-3 transition ${
                    dragOverStageId === stage.id
                      ? 'border-blue-400 ring-2 ring-blue-100'
                      : 'border-slate-200'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    {editingStageId === stage.id && stage.id !== 'unassigned' ? (
                      <div className="flex-1 flex items-center gap-2">
                        <input
                          value={editingStageName}
                          onChange={(e) => setEditingStageName(e.target.value)}
                          className="flex-1 px-2 py-1 border border-slate-200 rounded-md text-sm"
                        />
                        <button
                          onClick={() => handleRenameStage(stage.id)}
                          disabled={isSubmitting}
                          className="text-xs font-semibold text-blue-600 disabled:opacity-50"
                        >
                          Save
                        </button>
                        <button
                          onClick={() => {
                            setEditingStageId(null);
                            setEditingStageName('');
                          }}
                          className="text-xs font-semibold text-slate-500"
                        >
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <div>
                        <h3 className="text-sm font-semibold text-slate-700">
                          {stage.name}
                        </h3>
                        <p className="text-xs text-slate-400">
                          {loansByStage[stage.id]?.length || 0} loans
                        </p>
                      </div>
                    )}
                    {editingStageId !== stage.id && stage.id !== 'unassigned' && (
                      <div className="flex items-center gap-2 text-xs">
                        <button
                          onClick={() => {
                            setEditingStageId(stage.id);
                            setEditingStageName(stage.name);
                          }}
                          className="text-slate-500 hover:text-slate-700"
                        >
                          Rename
                        </button>
                        <button
                          onClick={() => handleDeleteStage(stage.id)}
                          disabled={isSubmitting}
                          className="text-red-500 hover:text-red-600 disabled:opacity-50"
                        >
                          Delete
                        </button>
                      </div>
                    )}
                  </div>

                  <div className="space-y-2">
                    {(loansByStage[stage.id] || []).map((loan) => (
                      <div
                        key={loan.id}
                        draggable
                        onDragStart={() => setDraggedLoanId(loan.id)}
                        onDragEnd={() => {
                          setDraggedLoanId(null);
                          setDragOverStageId(null);
                        }}
                        className={`bg-white border rounded-lg p-3 hover:shadow-sm transition cursor-pointer ${
                          draggedLoanId === loan.id ? 'border-blue-300 ring-2 ring-blue-100' : 'border-slate-200'
                        }`}
                        onClick={() => setSelectedLoanId(loan.id)}
                      >
                        <div className="flex items-center justify-between">
                          <div>
                            <p className="text-sm font-medium text-slate-900">
                              {loan.borrowerName}
                            </p>
                            <p className="text-xs text-slate-500">
                              {loan.loanNumber}
                            </p>
                          </div>
                          <p className="text-xs font-semibold text-slate-700">
                            ${loan.amount.toLocaleString()}
                          </p>
                        </div>
                        <div className="mt-3">
                          <select
                            value={loan.pipelineStageId || ''}
                            onChange={(e) =>
                              handleMoveLoan(
                                loan.id,
                                e.target.value ? e.target.value : null
                              )
                            }
                            className="w-full px-2 py-1 border border-slate-200 rounded-md text-xs"
                          >
                            <option value="">Unassigned</option>
                            {stages.map((stageOption) => (
                              <option key={stageOption.id} value={stageOption.id}>
                                {stageOption.name}
                              </option>
                            ))}
                          </select>
                        </div>
                      </div>
                    ))}
                    {(loansByStage[stage.id] || []).length === 0 && (
                      <div className="text-xs text-slate-400 text-center py-6">
                        No loans yet
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4">
          {!loanDetails ? (
            <div className="text-sm text-slate-500">
              Select a loan to view details, notes, and tasks.
            </div>
          ) : (
            <div className="space-y-4">
              <div className="flex items-start justify-between">
                <div>
                  <h3 className="text-lg font-semibold text-slate-900">
                    {loanDetails.borrowerName}
                  </h3>
                  <p className="text-xs text-slate-500">{loanDetails.loanNumber}</p>
                </div>
                <button
                  onClick={() => setSelectedLoanId(null)}
                  className="text-slate-400 hover:text-slate-600"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="space-y-1 text-sm text-slate-600">
                <p>
                  <span className="font-semibold text-slate-700">Amount:</span>{' '}
                  ${loanDetails.amount.toLocaleString()}
                </p>
                {loanDetails.program && (
                  <p>
                    <span className="font-semibold text-slate-700">Program:</span>{' '}
                    {loanDetails.program}
                  </p>
                )}
                {loanDetails.propertyAddress && (
                  <p>
                    <span className="font-semibold text-slate-700">Address:</span>{' '}
                    {loanDetails.propertyAddress}
                  </p>
                )}
              </div>

              <div>
                <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide">
                  Notes
                </label>
                <div className="mt-2 space-y-2 max-h-40 overflow-y-auto">
                  {loanDetails.pipelineNotes.length === 0 && (
                    <p className="text-xs text-slate-400">No notes yet.</p>
                  )}
                  {loanDetails.pipelineNotes.map((note) => (
                    <div key={note.id} className="p-2 bg-slate-50 rounded-lg">
                      <p className="text-xs text-slate-600">{note.body}</p>
                      <p className="text-[10px] text-slate-400 mt-1">
                        {note.user.name} • {new Date(note.createdAt).toLocaleString()}
                      </p>
                    </div>
                  ))}
                </div>
                <div className="mt-3 flex items-start gap-2">
                  <StickyNote className="w-4 h-4 text-slate-400 mt-2" />
                  <textarea
                    value={noteText}
                    onChange={(e) => setNoteText(e.target.value)}
                    rows={3}
                    placeholder="Add a note..."
                    className="flex-1 px-3 py-2 border border-slate-200 rounded-lg text-sm"
                  />
                </div>
                <button
                  onClick={handleAddNote}
                  disabled={isSubmitting}
                  className="mt-2 px-3 py-2 bg-blue-600 text-white text-xs font-semibold rounded-lg disabled:opacity-70 disabled:cursor-not-allowed flex items-center gap-2"
                >
                  {isSubmitting && <Loader2 className="w-3 h-3 animate-spin" />}
                  Add Note
                </button>
              </div>

              <div>
                <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide">
                  Tasks
                </label>
                <div className="mt-2 space-y-2">
                  {loanDetails.tasks.length === 0 && (
                    <p className="text-xs text-slate-400">No tasks yet.</p>
                  )}
                  {loanDetails.tasks.map((task) => (
                    <div key={task.id} className="p-2 border border-slate-200 rounded-lg">
                      <p className="text-sm text-slate-700">{task.title}</p>
                      <p className="text-xs text-slate-400">
                        {task.status} •{' '}
                        {task.dueDate ? new Date(task.dueDate).toLocaleDateString() : 'No due date'}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {showImport && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl border border-slate-200 shadow-lg w-full max-w-lg p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-semibold text-slate-900">Import CSV</h3>
              <button onClick={() => setShowImport(false)} className="text-slate-400">
                <X className="w-5 h-5" />
              </button>
            </div>
            <p className="text-xs text-slate-500">
              Supported headers: loanNumber, borrowerName, amount, stage. You can also use
              borrowerFirstName/borrowerLastName.
            </p>
            <input
              type="file"
              accept=".csv"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) handleCsvFile(file);
              }}
              className="w-full text-sm"
            />
            {importParsingError && (
              <div className="text-xs text-red-600">{importParsingError}</div>
            )}
            {importRows.length > 0 && (
              <div className="text-xs text-slate-600">
                Parsed {importRows.length} rows.{' '}
                {importRows.filter((row) => row.loanNumber?.trim()).length} valid loans.
              </div>
            )}
            {importResult && (
              <div className="text-xs text-green-600">
                Imported {importResult.created} loans. Skipped {importResult.skipped}.
              </div>
            )}
            <div className="flex items-center justify-end gap-2">
              <button
                onClick={() => setShowImport(false)}
                className="px-3 py-2 text-xs font-semibold text-slate-600"
              >
                Close
              </button>
              <button
                onClick={handleImport}
                disabled={isSubmitting}
                className="px-3 py-2 bg-blue-600 text-white text-xs font-semibold rounded-lg disabled:opacity-70 disabled:cursor-not-allowed flex items-center gap-2"
              >
                {isSubmitting && <Loader2 className="w-3 h-3 animate-spin" />}
                Import
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
