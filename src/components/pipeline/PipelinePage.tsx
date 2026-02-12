'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
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
import {
  Plus,
  Search,
  Upload,
  X,
  Loader2,
  MoreVertical,
  ChevronRight,
} from 'lucide-react';

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
  stage: string; // System stage (INTAKE, DISCLOSURES_PENDING, etc.)
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

type PipelineDensity = 'comfortable' | 'compact';

const formatStageLabel = (stageName: string) => {
  const normalized = stageName.trim().toLowerCase();
  if (normalized === 'conditional approval') return 'Cond. Approval';
  if (normalized === 'new lead') return 'New Lead';
  return stageName;
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
  const [density, setDensity] = useState<PipelineDensity>('comfortable');
  const importCloseButtonRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    const saved = window.localStorage.getItem('pipeline-density');
    if (saved === 'compact' || saved === 'comfortable') {
      setDensity(saved);
      return;
    }

    // Default to compact on typical laptop widths to avoid UI crowding.
    if (window.innerWidth < 1700) {
      setDensity('compact');
    } else {
      setDensity('comfortable');
    }
  }, []);

  useEffect(() => {
    window.localStorage.setItem('pipeline-density', density);
  }, [density]);

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
      
      const isLead = loan.stage === 'INTAKE';
      
      return matchesSearch && isLead; // Only show leads in Pipeline page
    });
  }, [loans, search]);

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
      setLoans(data.loans as PipelineLoan[]);
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

  useEffect(() => {
    if (!showImport) return;

    importCloseButtonRef.current?.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setShowImport(false);
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [showImport]);

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
  const columnClass =
    density === 'compact' ? 'min-w-[158px] w-[158px]' : 'min-w-[176px] w-[176px]';
  const cardClass = density === 'compact' ? 'p-2' : 'p-2.5';
  const showDetailsPanel = Boolean(selectedLoanId);

  return (
    <div className="space-y-6 mx-auto w-full max-w-[1600px]">
      <div className="app-page-header flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <h1 className="app-page-title">My Pipeline</h1>
          <p className="app-page-subtitle">
            Manage leads in intake. Active processing work lives under Tasks.
          </p>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          <div className="hidden md:inline-flex items-center rounded-lg border border-slate-200 bg-white p-1 shadow-sm">
            <button
              onClick={() => setDensity('comfortable')}
              className={`px-2.5 py-1.5 rounded text-xs font-semibold transition-colors ${
                density === 'comfortable'
                  ? 'bg-slate-900 text-white'
                  : 'text-slate-600 hover:bg-slate-100'
              }`}
            >
              Comfortable
            </button>
            <button
              onClick={() => setDensity('compact')}
              className={`px-2.5 py-1.5 rounded text-xs font-semibold transition-colors ${
                density === 'compact'
                  ? 'bg-slate-900 text-white'
                  : 'text-slate-600 hover:bg-slate-100'
              }`}
            >
              Compact
            </button>
          </div>
          <button
            onClick={() => setShowImport(true)}
            className="app-btn-secondary"
          >
            <Upload className="w-4 h-4" />
            Import CSV
          </button>
        </div>
      </div>

      {showLoanOfficerSelector && (
        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm max-w-md">
          <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide">
            Viewing Pipeline For:
          </label>
          <select
            value={selectedLoanOfficerId || ''}
            onChange={(e) => setSelectedLoanOfficerId(e.target.value)}
            className="mt-2 w-full px-3 py-2 border border-slate-200 rounded-lg text-sm bg-slate-50 font-medium"
          >
            {loanOfficers.map((officer) => (
              <option key={officer.id} value={officer.id}>
                {officer.name}
              </option>
            ))}
          </select>
        </div>
      )}

      <div
        className={`grid gap-6 items-start ${
          showDetailsPanel
            ? 'grid-cols-1 2xl:grid-cols-[minmax(0,1fr)_360px]'
            : 'grid-cols-1'
        }`}
      >
        <div className="space-y-4 min-w-0">
          <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
            <div className="flex flex-col xl:flex-row xl:items-center gap-3">
              <div className="relative w-full xl:max-w-md">
                <Search className="w-4 h-4 text-slate-400 absolute left-3 top-3" />
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search borrower or loan number..."
                  className="w-full pl-9 pr-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
                />
              </div>
              <div className="flex items-center gap-2 w-full xl:max-w-xl">
                <input
                  value={newStageName}
                  onChange={(e) => setNewStageName(e.target.value)}
                  placeholder="Add new lead stage..."
                  className="flex-1 min-w-0 px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
                />
                <button
                  onClick={handleAddStage}
                  disabled={isSubmitting}
                  className="inline-flex items-center gap-2 px-4 py-2 bg-slate-900 text-white text-sm font-medium rounded-lg hover:bg-slate-800 disabled:opacity-70 disabled:cursor-not-allowed whitespace-nowrap"
                >
                  {isSubmitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
                  Add Stage
                </button>
              </div>
            </div>
          </div>

          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg p-3">
              {error}
            </div>
          )}

          {loading ? (
            <div className="flex flex-col items-center justify-center py-12 text-slate-500">
              <Loader2 className="w-8 h-8 animate-spin mb-2 text-blue-600" />
              <p>Loading pipeline data...</p>
            </div>
          ) : (
            <div className="w-full overflow-x-auto pb-4 min-h-[500px] rounded-xl">
              <div className="flex gap-3 min-w-max pr-2">
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
                  className={`${columnClass} flex flex-col h-full rounded-xl transition-all ${
                    dragOverStageId === stage.id
                      ? 'bg-blue-50 ring-2 ring-blue-200'
                      : 'bg-slate-50/50'
                  }`}
                >
                  <div className="px-2.5 py-2 h-12 flex items-center justify-between border-b border-slate-200/50">
                    {editingStageId === stage.id && stage.id !== 'unassigned' ? (
                      <div className="flex-1 flex items-center gap-2">
                        <input
                          value={editingStageName}
                          onChange={(e) => setEditingStageName(e.target.value)}
                          className="flex-1 px-2 py-1 border border-slate-200 rounded text-sm"
                          autoFocus
                        />
                        <button
                          onClick={() => handleRenameStage(stage.id)}
                          className="p-1 text-green-600 hover:bg-green-50 rounded"
                        >
                          <ChevronRight className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => {
                            setEditingStageId(null);
                            setEditingStageName('');
                          }}
                          className="p-1 text-slate-400 hover:bg-slate-100 rounded"
                        >
                          <X className="w-4 h-4" />
                        </button>
                      </div>
                    ) : (
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="font-semibold text-slate-700 text-xs leading-tight truncate">
                          {formatStageLabel(stage.name)}
                        </span>
                        <span className="px-1.5 py-0.5 bg-slate-200 text-slate-600 text-[10px] rounded-full font-bold">
                          {loansByStage[stage.id]?.length || 0}
                        </span>
                      </div>
                    )}
                    
                    {editingStageId !== stage.id && stage.id !== 'unassigned' && (
                      <div className="flex items-center">
                        <button
                          onClick={() => {
                            setEditingStageId(stage.id);
                            setEditingStageName(stage.name);
                          }}
                          className="p-1 text-slate-400 hover:text-slate-600 rounded"
                        >
                          <MoreVertical className="w-3 h-3" />
                        </button>
                        <button
                          onClick={() => handleDeleteStage(stage.id)}
                          className="p-1 text-slate-400 hover:text-red-500 rounded"
                        >
                          <X className="w-3 h-3" />
                        </button>
                      </div>
                    )}
                  </div>

                  <div className="p-2 space-y-2 overflow-y-auto flex-1">
                    {(loansByStage[stage.id] || []).map((loan) => (
                      <div
                        key={loan.id}
                        draggable
                        onDragStart={() => setDraggedLoanId(loan.id)}
                        onDragEnd={() => {
                          setDraggedLoanId(null);
                          setDragOverStageId(null);
                        }}
                        className={`bg-white ${cardClass} rounded-lg border shadow-sm hover:shadow-md transition-all cursor-pointer group ${
                          draggedLoanId === loan.id ? 'opacity-50' : 'border-slate-200'
                        } ${selectedLoanId === loan.id ? 'ring-2 ring-blue-500 border-transparent' : ''}`}
                        onClick={() => setSelectedLoanId(loan.id)}
                      >
                        <div className="flex items-center justify-between mb-1.5">
                          <span className="text-[10px] font-mono text-slate-400 bg-slate-50 px-1.5 py-0.5 rounded truncate">
                            #{loan.loanNumber}
                          </span>
                        </div>
                        <h4 className="font-semibold text-slate-900 text-xs leading-tight mb-1 group-hover:text-blue-600 transition-colors">
                          {loan.borrowerName}
                        </h4>
                        <p className="text-[10px] text-slate-400 truncate">Click to view details</p>
                      </div>
                    ))}
                    {(loansByStage[stage.id] || []).length === 0 && (
                      <div className="h-20 flex items-center justify-center border-2 border-dashed border-slate-200 rounded-lg m-1">
                        <span className="text-xs text-slate-400">Empty</span>
                      </div>
                    )}
                  </div>
                </div>
              ))}
              </div>
            </div>
          )}
        </div>

        {showDetailsPanel && (
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-0 flex flex-col 2xl:h-[calc(100vh-140px)] 2xl:sticky 2xl:top-24 max-h-[70vh]">
            {!loanDetails ? (
              <div className="flex-1 flex flex-col items-center justify-center text-slate-400 p-6 text-center">
                <Loader2 className="w-6 h-6 animate-spin mb-2 text-blue-600" />
                <p className="text-sm">Loading lead details...</p>
              </div>
            ) : (
            <>
              <div className="p-4 border-b border-slate-100 flex items-start justify-between bg-slate-50/50">
                <div>
                  <h3 className="text-lg font-bold text-slate-900 leading-tight">
                    {loanDetails.borrowerName}
                  </h3>
                  <p className="text-xs text-slate-500 font-mono mt-1">#{loanDetails.loanNumber}</p>
                </div>
                <button
                  onClick={() => setSelectedLoanId(null)}
                  className="text-slate-400 hover:text-slate-600 p-1 hover:bg-slate-200 rounded"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="flex-1 overflow-y-auto p-4 space-y-6">
                <div className="grid grid-cols-2 gap-4">
                  <div className="p-3 bg-slate-50 rounded-lg border border-slate-100">
                    <p className="text-[10px] text-slate-500 uppercase font-bold mb-1">Amount</p>
                    <p className="text-sm font-semibold text-slate-900">${loanDetails.amount.toLocaleString()}</p>
                  </div>
                  <div className="p-3 bg-slate-50 rounded-lg border border-slate-100">
                    <p className="text-[10px] text-slate-500 uppercase font-bold mb-1">Program</p>
                    <p className="text-sm font-semibold text-slate-900 truncate" title={loanDetails.program || '-'}>
                      {loanDetails.program || '-'}
                    </p>
                  </div>
                </div>

                {loanDetails.propertyAddress && (
                  <div>
                    <p className="text-xs font-semibold text-slate-500 uppercase mb-1">Property</p>
                    <p className="text-sm text-slate-700">{loanDetails.propertyAddress}</p>
                  </div>
                )}

                <div>
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-xs font-semibold text-slate-500 uppercase">Notes</p>
                    <span className="text-[10px] bg-slate-100 px-1.5 py-0.5 rounded text-slate-500">
                      {loanDetails.pipelineNotes.length}
                    </span>
                  </div>
                  <div className="space-y-2 mb-3 max-h-40 overflow-y-auto pr-1">
                    {loanDetails.pipelineNotes.map((note) => (
                      <div key={note.id} className="p-2.5 bg-yellow-50/50 border border-yellow-100 rounded-lg text-xs">
                        <p className="text-slate-700 leading-relaxed">{note.body}</p>
                        <div className="flex items-center justify-between mt-2 pt-2 border-t border-yellow-100/50">
                          <span className="font-semibold text-yellow-700">{note.user.name}</span>
                          <span className="text-yellow-600/70 text-[10px]">
                            {new Date(note.createdAt).toLocaleDateString()}
                          </span>
                        </div>
                      </div>
                    ))}
                    {loanDetails.pipelineNotes.length === 0 && (
                      <p className="text-xs text-slate-400 italic">No notes added.</p>
                    )}
                  </div>
                  <div className="flex gap-2">
                    <input
                      value={noteText}
                      onChange={(e) => setNoteText(e.target.value)}
                      placeholder="Add a quick note..."
                      className="flex-1 px-3 py-2 border border-slate-200 rounded-lg text-xs focus:outline-none focus:border-blue-500"
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && !e.shiftKey) {
                          e.preventDefault();
                          handleAddNote();
                        }
                      }}
                    />
                    <button
                      onClick={handleAddNote}
                      disabled={!noteText.trim() || isSubmitting}
                      className="px-3 py-2 bg-slate-900 text-white rounded-lg hover:bg-slate-800 disabled:opacity-50 transition-colors"
                    >
                      <ChevronRight className="w-4 h-4" />
                    </button>
                  </div>
                </div>

                <div>
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-xs font-semibold text-slate-500 uppercase">Pending Tasks</p>
                  </div>
                  <div className="space-y-2">
                    {loanDetails.tasks.map((task) => (
                      <div key={task.id} className="p-3 border border-slate-200 rounded-lg flex items-start gap-3 bg-white">
                        <div className={`mt-0.5 w-2 h-2 rounded-full ${
                          task.status === 'COMPLETED' ? 'bg-green-500' : 
                          task.status === 'IN_PROGRESS' ? 'bg-blue-500' : 'bg-slate-300'
                        }`} />
                        <div>
                          <p className="text-sm font-medium text-slate-900">{task.title}</p>
                          <p className="text-xs text-slate-500 mt-0.5">
                            Due: {task.dueDate ? new Date(task.dueDate).toLocaleDateString() : 'None'}
                          </p>
                        </div>
                      </div>
                    ))}
                    {loanDetails.tasks.length === 0 && (
                      <p className="text-xs text-slate-400 italic">No pending tasks.</p>
                    )}
                  </div>
                </div>
              </div>
            </>
            )}
          </div>
        )}
      </div>

      {showImport && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 backdrop-blur-sm">
          <div
            role="dialog"
            aria-modal="true"
            className="bg-white rounded-xl border border-slate-200 shadow-2xl w-full max-w-lg p-6 space-y-4"
          >
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-bold text-slate-900">Import Leads (CSV)</h3>
              <button
                ref={importCloseButtonRef}
                onClick={() => setShowImport(false)}
                className="app-icon-btn"
                aria-label="Close import modal"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            
            <div className="bg-blue-50 p-4 rounded-lg text-sm text-blue-800">
              <p className="font-semibold mb-1">Instructions:</p>
              <ul className="list-disc list-inside space-y-1 opacity-90">
                <li>Upload a CSV file with headers.</li>
                <li>Required: <code>loanNumber</code></li>
                <li>Optional: <code>borrowerName</code>, <code>amount</code>, <code>stage</code></li>
              </ul>
            </div>

            <div className="border-2 border-dashed border-slate-300 rounded-xl p-8 text-center hover:bg-slate-50 transition-colors">
              <input
                type="file"
                accept=".csv"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) handleCsvFile(file);
                }}
                className="hidden"
                id="csv-upload"
              />
              <label htmlFor="csv-upload" className="cursor-pointer flex flex-col items-center">
                <Upload className="w-8 h-8 text-slate-400 mb-2" />
                <span className="text-sm font-medium text-slate-700">Click to upload CSV</span>
                <span className="text-xs text-slate-400 mt-1">or drag and drop</span>
              </label>
            </div>

            {importParsingError && (
              <div className="text-xs text-red-600 bg-red-50 p-3 rounded-lg flex items-center gap-2">
                <X className="w-4 h-4" />
                {importParsingError}
              </div>
            )}
            
            {importRows.length > 0 && (
              <div className="text-xs text-slate-600 bg-slate-50 p-3 rounded-lg">
                Parsed <strong>{importRows.length}</strong> rows.{' '}
                <strong>{importRows.filter((row) => row.loanNumber?.trim()).length}</strong> valid loans found.
              </div>
            )}
            
            {importResult && (
              <div className="text-xs text-green-700 bg-green-50 p-3 rounded-lg border border-green-100">
                Success! Imported <strong>{importResult.created}</strong> loans. Skipped {importResult.skipped} duplicates.
              </div>
            )}

            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                onClick={() => setShowImport(false)}
                className="app-btn-secondary"
              >
                Cancel
              </button>
              <button
                onClick={handleImport}
                disabled={isSubmitting || importRows.length === 0}
                className="app-btn-primary disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isSubmitting && <Loader2 className="w-4 h-4 animate-spin" />}
                Import Leads
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
