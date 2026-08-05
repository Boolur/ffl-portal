'use client';

import { useEffect, useMemo, useState, useTransition } from 'react';
import {
  ChevronLeft,
  ChevronRight,
  Clock3,
  History,
  Loader2,
  MoveRight,
  RefreshCw,
  Search,
} from 'lucide-react';
import {
  ProcessingPipelineSheet,
  ProcessingPipelineStatus,
  UserRole,
} from '@prisma/client';
import {
  getProcessingPipeline,
  getProcessingPipelineHistory,
  moveProcessingPipelineLoan,
  updateProcessingPipelineCell,
  type ProcessingPipelineRow,
} from '@/app/actions/processingPipelineActions';
import {
  PROCESSING_ITEM_STATUS_OPTIONS,
  PROCESSING_PIPELINE_SHEETS,
  PROCESSING_PIPELINE_STATUS_OPTIONS,
} from '@/lib/processingPipeline';

type PipelineResult = Extract<Awaited<ReturnType<typeof getProcessingPipeline>>, { success: true }>;

type Props = {
  initialData: PipelineResult;
  role: UserRole;
};

type EditableField =
  | 'pipelineStatus'
  | 'titleStatus'
  | 'payoffStatus'
  | 'hoiStatus'
  | 'appraisalNeeded'
  | 'appraisalNotes'
  | 'appraisalOrderedAt'
  | 'appraisalBackAt'
  | 'missingItemsCurrentStatus'
  | 'extraNotes'
  | 'rateLock'
  | 'lender'
  | 'finalRevenue';

const statusTone: Record<ProcessingPipelineStatus, string> = {
  SUBBED_TO_UW: 'bg-cyan-100 text-cyan-900',
  APPROVED_WITH_CONDITIONS: 'bg-emerald-100 text-emerald-900',
  RE_SUB: 'bg-green-100 text-green-900',
  CTC: 'bg-green-200 text-green-950',
  DOCS_OUT: 'bg-emerald-200 text-emerald-950',
  FUNDED: 'bg-lime-100 text-lime-900',
  SUSPENDED_RESTRUCTURE: 'bg-red-100 text-red-900',
};

function formatDate(value: string | null) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat('en-US', {
    month: '2-digit',
    day: '2-digit',
    year: '2-digit',
  }).format(date);
}

function dateInputValue(value: string | null) {
  return value ? value.slice(0, 10) : '';
}

function formatMoney(value: number | null) {
  if (value === null) return '—';
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(value);
}

function parseAuditDetails(details: string | null) {
  if (!details) return null;
  try {
    return JSON.parse(details) as Record<string, unknown>;
  } catch {
    return { message: details };
  }
}

export function ProcessingPipelineGrid({ initialData, role }: Props) {
  const [sheet, setSheet] = useState<ProcessingPipelineSheet>(ProcessingPipelineSheet.PIPELINE);
  const [rows, setRows] = useState(initialData.rows);
  const [total, setTotal] = useState(initialData.total);
  const [page, setPage] = useState(initialData.page);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<ProcessingPipelineStatus | 'ALL'>('ALL');
  const [processorFilter, setProcessorFilter] = useState('');
  const [sortBy, setSortBy] = useState<'dateAssigned' | 'statusChangedAt' | 'borrowerName' | 'loanNumber'>('dateAssigned');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('desc');
  const [savingRows, setSavingRows] = useState<Set<string>>(new Set());
  const [message, setMessage] = useState('');
  const [historyRow, setHistoryRow] = useState<ProcessingPipelineRow | null>(null);
  const [historyEntries, setHistoryEntries] = useState<Array<{
    id: string;
    action: string;
    details: string | null;
    createdAt: string;
    actor: string;
    actorRole: UserRole;
  }>>([]);
  const [isPending, startTransition] = useTransition();
  const canEdit = initialData.canEdit;
  const isLoanOfficer = role === UserRole.LOAN_OFFICER;

  const loadRows = (
    nextSheet = sheet,
    nextPage = page,
    nextSearch = search,
    nextSortBy = sortBy,
    nextSortDirection = sortDirection,
  ) => {
    startTransition(async () => {
      const result = await getProcessingPipeline({
        sheet: nextSheet,
        page: nextPage,
        pageSize: initialData.pageSize,
        search: nextSearch,
        sortBy: nextSortBy,
        sortDirection: nextSortDirection,
      });
      if (!result.success) {
        setMessage(result.error);
        return;
      }
      setRows(result.rows);
      setTotal(result.total);
      setPage(result.page);
      setMessage('');
    });
  };

  useEffect(() => {
    const timeout = window.setTimeout(() => loadRows(sheet, 1, search), 300);
    return () => window.clearTimeout(timeout);
    // loadRows deliberately reads the current sort state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  const visibleRows = useMemo(
    () => rows.filter((row) => {
      if (statusFilter !== 'ALL' && row.pipelineStatus !== statusFilter) return false;
      if (
        processorFilter &&
        !`${row.seniorProcessor?.name || ''} ${row.juniorProcessor?.name || ''}`
          .toLowerCase()
          .includes(processorFilter.toLowerCase())
      ) return false;
      return true;
    }),
    [rows, statusFilter, processorFilter],
  );

  const patchRow = (id: string, patch: Partial<ProcessingPipelineRow>) => {
    setRows((current) => current.map((row) => row.id === id ? { ...row, ...patch } : row));
  };

  const saveCell = async (
    row: ProcessingPipelineRow,
    field: EditableField,
    value: unknown,
  ) => {
    if (!canEdit) return;
    setSavingRows((current) => new Set(current).add(row.id));
    setMessage('');
    const result = await updateProcessingPipelineCell({
      id: row.id,
      field,
      value,
      version: row.version,
    });
    setSavingRows((current) => {
      const next = new Set(current);
      next.delete(row.id);
      return next;
    });
    if (!result.success) {
      setMessage(result.error);
      loadRows();
      return;
    }
    patchRow(row.id, {
      [field]: value === '' ? null : value,
      version: result.version,
      ...(field === 'pipelineStatus'
        ? { statusChangedAt: new Date().toISOString(), daysInStatus: 0 }
        : {}),
    });
  };

  const moveRow = async (row: ProcessingPipelineRow, destination: ProcessingPipelineSheet) => {
    if (destination === row.sheet || !canEdit) return;
    let fundedAt: string | null = null;
    if (destination === ProcessingPipelineSheet.FUNDING) {
      fundedAt = window.prompt('Funded / signing date (YYYY-MM-DD):', new Date().toISOString().slice(0, 10));
      if (!fundedAt) return;
    }
    setSavingRows((current) => new Set(current).add(row.id));
    const result = await moveProcessingPipelineLoan({
      id: row.id,
      sheet: destination,
      fundedAt,
      version: row.version,
    });
    setSavingRows((current) => {
      const next = new Set(current);
      next.delete(row.id);
      return next;
    });
    if (!result.success) {
      setMessage(result.error);
      if ('conflict' in result) loadRows();
      return;
    }
    setRows((current) => current.filter((candidate) => candidate.id !== row.id));
    setTotal((current) => Math.max(0, current - 1));
    setMessage(`Moved ${row.loan.borrowerName} to ${
      PROCESSING_PIPELINE_SHEETS.find((option) => option.value === destination)?.label
    }.`);
  };

  const openHistory = async (row: ProcessingPipelineRow) => {
    setHistoryRow(row);
    setHistoryEntries([]);
    const result = await getProcessingPipelineHistory(row.id);
    if (result.success) setHistoryEntries(result.entries);
    else setMessage(result.error);
  };

  const changeSort = (nextSort: typeof sortBy) => {
    const direction = sortBy === nextSort && sortDirection === 'desc' ? 'asc' : 'desc';
    setSortBy(nextSort);
    setSortDirection(direction);
    loadRows(sheet, 1, search, nextSort, direction);
  };

  const editableSelect = (
    row: ProcessingPipelineRow,
    field: EditableField,
    value: string | boolean | null,
    options: ReadonlyArray<{ value: string; label: string }>,
    className = '',
  ) => canEdit ? (
    <select
      aria-label={field}
      value={value === null ? '' : String(value)}
      onChange={(event) => saveCell(row, field, event.target.value)}
      className={`w-full min-w-28 rounded-md border border-slate-200 px-2 py-1.5 text-xs focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100 ${className}`}
    >
      {options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
    </select>
  ) : (
    <span>{options.find((option) => option.value === String(value))?.label || '—'}</span>
  );

  const textCell = (
    row: ProcessingPipelineRow,
    field: EditableField,
    value: string | null,
    placeholder = '—',
  ) => canEdit ? (
    <input
      aria-label={field}
      defaultValue={value || ''}
      placeholder={placeholder}
      onBlur={(event) => {
        if (event.target.value !== (value || '')) saveCell(row, field, event.target.value);
      }}
      onKeyDown={(event) => {
        if (event.key === 'Enter') event.currentTarget.blur();
      }}
      className="w-full min-w-32 rounded-md border border-transparent bg-transparent px-2 py-1.5 text-xs hover:border-slate-200 focus:border-blue-500 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-100"
    />
  ) : <span className="block min-w-24 whitespace-pre-wrap">{value || '—'}</span>;

  const dateCell = (row: ProcessingPipelineRow, field: EditableField, value: string | null) =>
    canEdit ? (
      <input
        type="date"
        aria-label={field}
        defaultValue={dateInputValue(value)}
        onBlur={(event) => {
          if (event.target.value !== dateInputValue(value)) saveCell(row, field, event.target.value);
        }}
        className="min-w-32 rounded-md border border-transparent bg-transparent px-2 py-1.5 text-xs hover:border-slate-200 focus:border-blue-500 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-100"
      />
    ) : <span>{formatDate(value)}</span>;

  const yesNoCell = (row: ProcessingPipelineRow, field: EditableField, value: boolean | null) =>
    editableSelect(row, field, value, [
      { value: '', label: '—' },
      { value: 'true', label: 'Yes' },
      { value: 'false', label: 'No' },
    ]);

  const totalPages = Math.max(1, Math.ceil(total / initialData.pageSize));

  return (
    <section className="space-y-4">
      <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
        <div className="flex flex-wrap gap-2" role="tablist" aria-label="Processing pipeline sheets">
          {PROCESSING_PIPELINE_SHEETS.map((option) => (
            <button
              key={option.value}
              type="button"
              role="tab"
              aria-selected={sheet === option.value}
              onClick={() => {
                setSheet(option.value);
                setPage(1);
                setStatusFilter('ALL');
                loadRows(option.value, 1);
              }}
              className={sheet === option.value ? 'app-btn-primary' : 'app-btn-secondary'}
            >
              {option.label}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <label className="relative">
            <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
            <span className="sr-only">Search pipeline</span>
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search loans, people, lender…"
              className="h-9 w-72 rounded-lg border border-slate-200 bg-white pl-9 pr-3 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
            />
          </label>
          <button type="button" className="app-btn-secondary" onClick={() => loadRows()} disabled={isPending}>
            <RefreshCw className={`h-4 w-4 ${isPending ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        </div>
      </div>

      <div className="flex flex-wrap gap-2 rounded-xl border border-slate-200 bg-slate-50 p-3">
        {sheet !== ProcessingPipelineSheet.FUNDING && (
          <label className="text-xs font-medium text-slate-600">
            Status
            <select
              value={statusFilter}
              onChange={(event) => setStatusFilter(event.target.value as ProcessingPipelineStatus | 'ALL')}
              className="ml-2 rounded-md border border-slate-200 bg-white px-2 py-1.5"
            >
              <option value="ALL">All statuses</option>
              {PROCESSING_PIPELINE_STATUS_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </label>
        )}
        <label className="text-xs font-medium text-slate-600">
          Processor
          <input
            value={processorFilter}
            onChange={(event) => setProcessorFilter(event.target.value)}
            placeholder="Filter name"
            className="ml-2 rounded-md border border-slate-200 bg-white px-2 py-1.5"
          />
        </label>
        <span className="ml-auto self-center text-xs text-slate-500">
          {canEdit ? 'Changes save automatically' : 'Read-only view'}
        </span>
      </div>

      {message && (
        <div role="status" className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-sm text-blue-800">
          {message}
        </div>
      )}

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="max-h-[68vh] overflow-auto">
          <table className="min-w-max border-separate border-spacing-0 text-left text-xs text-slate-700">
            <thead className="sticky top-0 z-30 bg-[#029AD1] text-white">
              <tr>
                {!isLoanOfficer && <th className="sticky left-0 z-40 min-w-40 border-b border-r border-cyan-700 bg-[#029AD1] px-3 py-3">Loan Officer</th>}
                <th className={`${isLoanOfficer ? 'sticky left-0 z-40 bg-[#029AD1]' : ''} min-w-28 border-b border-r border-cyan-700 px-3 py-3`}>
                  <button type="button" onClick={() => changeSort('dateAssigned')}>Date Assigned</button>
                </th>
                <th className="min-w-28 border-b border-r border-cyan-700 px-3 py-3">
                  <button type="button" onClick={() => changeSort('loanNumber')}>Arrive #</button>
                </th>
                <th className="min-w-44 border-b border-r border-cyan-700 px-3 py-3">
                  <button type="button" onClick={() => changeSort('borrowerName')}>Last Name / Borrower</button>
                </th>
                <th className="min-w-32 border-b border-r border-cyan-700 px-3 py-3">Loan Type</th>
                {sheet === ProcessingPipelineSheet.FUNDING ? (
                  <>
                    <th className="min-w-40 border-b border-r border-cyan-700 px-3 py-3">Junior</th>
                    <th className="min-w-40 border-b border-r border-cyan-700 px-3 py-3">Senior</th>
                    <th className="min-w-32 border-b border-r border-cyan-700 px-3 py-3">Funded Date</th>
                    <th className="min-w-36 border-b border-r border-cyan-700 px-3 py-3">Projected Revenue</th>
                    <th className="min-w-36 border-b border-r border-cyan-700 px-3 py-3">Final Revenue</th>
                    <th className="min-w-32 border-b border-r border-cyan-700 px-3 py-3">First Payment</th>
                    <th className="min-w-32 border-b border-r border-cyan-700 px-3 py-3">6th Payment</th>
                  </>
                ) : (
                  <>
                    <th className="min-w-24 border-b border-r border-cyan-700 px-3 py-3">State</th>
                    <th className="min-w-40 border-b border-r border-cyan-700 px-3 py-3">Lender</th>
                    <th className="min-w-40 border-b border-r border-cyan-700 px-3 py-3">Jr Processor</th>
                    <th className="min-w-40 border-b border-r border-cyan-700 px-3 py-3">Processor</th>
                    <th className="min-w-52 border-b border-r border-cyan-700 px-3 py-3">Pipeline Status</th>
                    <th className="min-w-28 border-b border-r border-cyan-700 px-3 py-3">
                      <button type="button" onClick={() => changeSort('statusChangedAt')}>Days in Status</button>
                    </th>
                    <th className="min-w-32 border-b border-r border-cyan-700 px-3 py-3">Title</th>
                    <th className="min-w-32 border-b border-r border-cyan-700 px-3 py-3">Payoff</th>
                    <th className="min-w-32 border-b border-r border-cyan-700 px-3 py-3">HOI</th>
                    <th className="min-w-32 border-b border-r border-cyan-700 px-3 py-3">Appraisal Needed</th>
                    <th className="min-w-56 border-b border-r border-cyan-700 px-3 py-3">Appraisal Notes</th>
                    <th className="min-w-40 border-b border-r border-cyan-700 px-3 py-3">Appraisal Ordered</th>
                    <th className="min-w-40 border-b border-r border-cyan-700 px-3 py-3">Appraisal Back</th>
                    <th className="min-w-64 border-b border-r border-cyan-700 px-3 py-3">Missing Items / Current Status</th>
                    <th className="min-w-56 border-b border-r border-cyan-700 px-3 py-3">Extra Notes</th>
                    <th className="min-w-28 border-b border-r border-cyan-700 px-3 py-3">Rate Lock</th>
                  </>
                )}
                <th className="sticky right-0 z-40 min-w-52 border-b border-cyan-800 bg-[#0070C0] px-3 py-3">Actions</th>
              </tr>
            </thead>
            <tbody>
              {visibleRows.map((row) => (
                <tr key={row.id} className="group even:bg-slate-50/70 hover:bg-blue-50/60">
                  {!isLoanOfficer && <td className="sticky left-0 z-10 border-b border-r border-slate-200 bg-inherit px-3 py-2 font-medium text-slate-900">{row.loan.loanOfficer.name}</td>}
                  <td className={`${isLoanOfficer ? 'sticky left-0 z-10 bg-inherit' : ''} border-b border-r border-slate-200 px-3 py-2`}>{formatDate(row.dateAssigned)}</td>
                  <td className="border-b border-r border-slate-200 px-3 py-2 font-mono">{row.loan.loanNumber}</td>
                  <td className="border-b border-r border-slate-200 px-3 py-2 font-semibold text-slate-900">{row.loan.borrowerName}</td>
                  <td className="border-b border-r border-slate-200 px-3 py-2">{row.loanType || '—'}</td>
                  {sheet === ProcessingPipelineSheet.FUNDING ? (
                    <>
                      <td className="border-b border-r border-slate-200 px-3 py-2">{row.juniorProcessor?.name || '—'}</td>
                      <td className="border-b border-r border-slate-200 px-3 py-2">{row.seniorProcessor?.name || 'Unassigned'}</td>
                      <td className="border-b border-r border-slate-200 px-3 py-2">{formatDate(row.fundedAt)}</td>
                      <td className="border-b border-r border-slate-200 px-3 py-2">{formatMoney(row.projectedRevenue)}</td>
                      <td className="border-b border-r border-slate-200 px-3 py-2">
                        {canEdit ? (
                          <input
                            inputMode="decimal"
                            aria-label="Final revenue"
                            defaultValue={row.finalRevenue ?? ''}
                            onBlur={(event) => {
                              if (event.target.value !== String(row.finalRevenue ?? '')) {
                                saveCell(row, 'finalRevenue', event.target.value);
                              }
                            }}
                            className="w-28 rounded-md border border-transparent bg-transparent px-2 py-1.5 hover:border-slate-200 focus:border-blue-500 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-100"
                          />
                        ) : formatMoney(row.finalRevenue)}
                      </td>
                      <td className="border-b border-r border-slate-200 px-3 py-2">{formatDate(row.firstPaymentAt)}</td>
                      <td className="border-b border-r border-slate-200 px-3 py-2">{formatDate(row.sixthPaymentAt)}</td>
                    </>
                  ) : (
                    <>
                      <td className="border-b border-r border-slate-200 px-3 py-2">{row.propertyState || '—'}</td>
                      <td className="border-b border-r border-slate-200 px-1 py-1">{textCell(row, 'lender', row.lender)}</td>
                      <td className="border-b border-r border-slate-200 px-3 py-2">{row.juniorProcessor?.name || '—'}</td>
                      <td className="border-b border-r border-slate-200 px-3 py-2">{row.seniorProcessor?.name || 'Unassigned'}</td>
                      <td className={`border-b border-r border-slate-200 px-1 py-1 ${statusTone[row.pipelineStatus]}`}>
                        {editableSelect(row, 'pipelineStatus', row.pipelineStatus, PROCESSING_PIPELINE_STATUS_OPTIONS, statusTone[row.pipelineStatus])}
                      </td>
                      <td className="border-b border-r border-slate-200 px-3 py-2 text-center font-semibold">{row.daysInStatus}</td>
                      <td className="border-b border-r border-slate-200 px-1 py-1">{editableSelect(row, 'titleStatus', row.titleStatus, PROCESSING_ITEM_STATUS_OPTIONS)}</td>
                      <td className="border-b border-r border-slate-200 px-1 py-1">{editableSelect(row, 'payoffStatus', row.payoffStatus, PROCESSING_ITEM_STATUS_OPTIONS)}</td>
                      <td className="border-b border-r border-slate-200 px-1 py-1">{editableSelect(row, 'hoiStatus', row.hoiStatus, PROCESSING_ITEM_STATUS_OPTIONS)}</td>
                      <td className="border-b border-r border-slate-200 px-1 py-1">{yesNoCell(row, 'appraisalNeeded', row.appraisalNeeded)}</td>
                      <td className="border-b border-r border-slate-200 px-1 py-1">{textCell(row, 'appraisalNotes', row.appraisalNotes)}</td>
                      <td className="border-b border-r border-slate-200 px-1 py-1">{dateCell(row, 'appraisalOrderedAt', row.appraisalOrderedAt)}</td>
                      <td className="border-b border-r border-slate-200 px-1 py-1">{dateCell(row, 'appraisalBackAt', row.appraisalBackAt)}</td>
                      <td className="border-b border-r border-slate-200 px-1 py-1">{textCell(row, 'missingItemsCurrentStatus', row.missingItemsCurrentStatus)}</td>
                      <td className="border-b border-r border-slate-200 px-1 py-1">{textCell(row, 'extraNotes', row.extraNotes)}</td>
                      <td className="border-b border-r border-slate-200 px-1 py-1">{yesNoCell(row, 'rateLock', row.rateLock)}</td>
                    </>
                  )}
                  <td className="sticky right-0 z-10 border-b border-slate-200 bg-white px-2 py-2 group-even:bg-slate-50 group-hover:bg-blue-50">
                    <div className="flex items-center gap-1.5">
                      {savingRows.has(row.id) && <Loader2 className="h-4 w-4 animate-spin text-blue-600" aria-label="Saving" />}
                      <button type="button" onClick={() => openHistory(row)} className="rounded-md border border-slate-200 p-1.5 text-slate-600 hover:bg-white" title="View change history">
                        <History className="h-4 w-4" />
                      </button>
                      {canEdit && (
                        <label className="flex items-center gap-1">
                          <MoveRight className="h-4 w-4 text-slate-500" />
                          <span className="sr-only">Move loan</span>
                          <select
                            aria-label={`Move ${row.loan.borrowerName}`}
                            value=""
                            onChange={(event) => moveRow(row, event.target.value as ProcessingPipelineSheet)}
                            className="rounded-md border border-slate-200 bg-white px-2 py-1.5 text-xs"
                          >
                            <option value="">Move…</option>
                            {PROCESSING_PIPELINE_SHEETS.filter((option) => option.value !== sheet).map((option) => (
                              <option key={option.value} value={option.value}>{option.label}</option>
                            ))}
                          </select>
                        </label>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
              {visibleRows.length === 0 && (
                <tr>
                  <td colSpan={24} className="px-6 py-16 text-center text-sm text-slate-500">
                    {isPending ? 'Loading pipeline…' : 'No loans match this view.'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="flex items-center justify-between border-t border-slate-200 px-4 py-3 text-xs text-slate-600">
          <span>{total} loan{total === 1 ? '' : 's'} · Page {page} of {totalPages}</span>
          <div className="flex gap-2">
            <button type="button" className="app-btn-secondary" disabled={page <= 1 || isPending} onClick={() => loadRows(sheet, page - 1)}>
              <ChevronLeft className="h-4 w-4" /> Previous
            </button>
            <button type="button" className="app-btn-secondary" disabled={page >= totalPages || isPending} onClick={() => loadRows(sheet, page + 1)}>
              Next <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        </div>
      </div>

      {historyRow && (
        <div className="fixed inset-0 z-50 flex justify-end bg-slate-950/30" role="dialog" aria-modal="true" aria-label="Change history">
          <button type="button" className="flex-1 cursor-default" aria-label="Close history" onClick={() => setHistoryRow(null)} />
          <aside className="h-full w-full max-w-md overflow-y-auto bg-white p-6 shadow-2xl">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-blue-600">Change history</p>
                <h2 className="mt-1 text-xl font-bold text-slate-950">{historyRow.loan.borrowerName}</h2>
                <p className="text-sm text-slate-500">Arrive #{historyRow.loan.loanNumber}</p>
              </div>
              <button type="button" className="app-btn-secondary" onClick={() => setHistoryRow(null)}>Close</button>
            </div>
            <ol className="mt-6 space-y-3">
              {historyEntries.map((entry) => {
                const details = parseAuditDetails(entry.details);
                return (
                  <li key={entry.id} className="rounded-xl border border-slate-200 p-4">
                    <div className="flex items-center gap-2 text-xs text-slate-500">
                      <Clock3 className="h-4 w-4" />
                      {new Date(entry.createdAt).toLocaleString()}
                    </div>
                    <p className="mt-2 text-sm font-semibold text-slate-900">{entry.actor}</p>
                    <p className="text-xs text-slate-500">{entry.action.replaceAll('_', ' ')}</p>
                    {details !== null && Boolean(details.field) && (
                      <p className="mt-2 text-sm text-slate-700">
                        <span className="font-medium">{String(details.field)}</span>: {String(details.previousValue ?? '—')} → {String(details.newValue ?? '—')}
                      </p>
                    )}
                    {details !== null && Boolean(details.fromSheet) && (
                      <p className="mt-2 text-sm text-slate-700">{String(details.fromSheet)} → {String(details.toSheet)}</p>
                    )}
                  </li>
                );
              })}
              {historyEntries.length === 0 && <li className="text-sm text-slate-500">No tracked changes yet.</li>}
            </ol>
          </aside>
        </div>
      )}
    </section>
  );
}
