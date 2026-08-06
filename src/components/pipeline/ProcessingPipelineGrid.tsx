'use client';

import { useEffect, useState, useTransition } from 'react';
import type { ReactNode } from 'react';
import {
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Filter,
  History,
  Loader2,
  Maximize2,
  Minimize2,
  RefreshCw,
  Search,
  SlidersHorizontal,
  X,
} from 'lucide-react';
import {
  ProcessingItemStatus,
  ProcessingPipelineSheet,
  ProcessingPipelineStatus,
  UserRole,
} from '@prisma/client';
import {
  getProcessingPipeline,
  getProcessingPipelineFilterOptions,
  getProcessingPipelineHistory,
  moveProcessingPipelineLoan,
  updateProcessingPipelineCell,
  type ProcessingPipelineRow,
  type ProcessingPipelineFilters,
} from '@/app/actions/processingPipelineActions';
import {
  PROCESSING_ITEM_STATUS_OPTIONS,
  PROCESSING_PIPELINE_SHEETS,
  PROCESSING_PIPELINE_STATUS_OPTIONS,
} from '@/lib/processingPipeline';

type PipelineResult = Extract<Awaited<ReturnType<typeof getProcessingPipeline>>, { success: true }>;
type PipelineFilterOptions = Extract<
  Awaited<ReturnType<typeof getProcessingPipelineFilterOptions>>,
  { success: true }
>['options'];

type Props = {
  initialData: PipelineResult;
  role: UserRole;
};

const EMPTY_FILTER_OPTIONS: PipelineFilterOptions = {
  loanOfficers: [],
  loanNumbers: [],
  borrowerNames: [],
  loanTypes: [],
  states: [],
  lenders: [],
  juniorProcessors: [],
  seniorProcessors: [],
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

type ColumnId =
  | 'loanOfficer'
  | 'dateAssigned'
  | 'loanNumber'
  | 'borrowerName'
  | 'loanAmount'
  | 'loanType'
  | 'lender'
  | 'juniorProcessor'
  | 'seniorProcessor'
  | 'pipelineStatus'
  | 'daysInStatus'
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
  | 'fundedAt'
  | 'projectedRevenue'
  | 'finalRevenue'
  | 'firstPaymentAt'
  | 'sixthPaymentAt'
  | 'actions';

const PIPELINE_COLUMNS: Array<{ id: ColumnId; label: string; width: number; optional?: boolean }> = [
  { id: 'loanOfficer', label: 'Loan Officer', width: 128 },
  { id: 'dateAssigned', label: 'Assigned', width: 94 },
  { id: 'loanNumber', label: 'Arrive #', width: 96 },
  { id: 'borrowerName', label: 'Borrower', width: 154 },
  { id: 'lender', label: 'Lender', width: 140 },
  { id: 'loanAmount', label: 'Loan Amount', width: 126 },
  { id: 'loanType', label: 'Loan Type', width: 108 },
  { id: 'juniorProcessor', label: 'Jr Processor', width: 118 },
  { id: 'seniorProcessor', label: 'Processor', width: 118 },
  { id: 'pipelineStatus', label: 'Pipeline Status', width: 164 },
  { id: 'missingItemsCurrentStatus', label: 'Pending Items', width: 220 },
  { id: 'titleStatus', label: 'Title', width: 124 },
  { id: 'payoffStatus', label: 'Payoff', width: 124 },
  { id: 'hoiStatus', label: 'HOI', width: 124 },
  { id: 'appraisalNeeded', label: 'Appraisal?', width: 118 },
  { id: 'daysInStatus', label: 'Days', width: 68 },
  { id: 'appraisalNotes', label: 'Appraisal Notes', width: 220, optional: true },
  { id: 'appraisalOrderedAt', label: 'Appraisal Ordered', width: 146, optional: true },
  { id: 'appraisalBackAt', label: 'Appraisal Back', width: 140, optional: true },
  { id: 'extraNotes', label: 'Extra Notes', width: 210, optional: true },
  { id: 'rateLock', label: 'Rate Lock', width: 112, optional: true },
  { id: 'projectedRevenue', label: 'Revenue', width: 130, optional: true },
  { id: 'actions', label: 'Actions', width: 142 },
];

const FUNDING_COLUMNS: Array<{ id: ColumnId; label: string; width: number; optional?: boolean }> = [
  { id: 'loanOfficer', label: 'Loan Officer', width: 140 },
  { id: 'dateAssigned', label: 'Assigned', width: 96 },
  { id: 'loanNumber', label: 'Arrive #', width: 100 },
  { id: 'borrowerName', label: 'Borrower', width: 170 },
  { id: 'loanType', label: 'Loan Type', width: 112 },
  { id: 'juniorProcessor', label: 'Junior', width: 130 },
  { id: 'seniorProcessor', label: 'Senior', width: 130 },
  { id: 'fundedAt', label: 'Funded Date', width: 120 },
  { id: 'projectedRevenue', label: 'Projected Revenue', width: 140 },
  { id: 'finalRevenue', label: 'Final Revenue', width: 140 },
  { id: 'firstPaymentAt', label: 'First Payment', width: 120 },
  { id: 'sixthPaymentAt', label: '6th Payment', width: 120 },
  { id: 'actions', label: 'Actions', width: 142 },
];

const PIPELINE_FOCUS_COLUMNS = new Set<ColumnId>([
  'dateAssigned',
  'loanNumber',
  'borrowerName',
  'lender',
  'loanAmount',
  'loanType',
  'juniorProcessor',
  'seniorProcessor',
  'pipelineStatus',
  'missingItemsCurrentStatus',
  'titleStatus',
  'payoffStatus',
  'hoiStatus',
  'appraisalNeeded',
  'daysInStatus',
  'actions',
]);
const FUNDING_FOCUS_COLUMNS = new Set<ColumnId>([
  'dateAssigned',
  'loanNumber',
  'borrowerName',
  'loanType',
  'juniorProcessor',
  'seniorProcessor',
  'fundedAt',
  'finalRevenue',
  'actions',
]);
const WIDTH_STORAGE_KEY = 'ffl:processing-pipeline-widths-v2';
const YES_NO_FILTER_OPTIONS: FilterOption[] = [
  { value: 'YES', label: 'Yes' },
  { value: 'NO', label: 'No' },
  { value: 'BLANK', label: 'Blank / Not set' },
];

const statusTone: Record<ProcessingPipelineStatus, string> = {
  SUBBED_TO_UW: 'border-sky-200 bg-sky-100 text-sky-900',
  APPROVED_WITH_CONDITIONS: 'border-lime-200 bg-lime-100 text-lime-900',
  RE_SUB: 'border-green-300 bg-green-200 text-green-900',
  CTC: 'border-green-400 bg-green-300 text-green-950',
  DOCS_OUT: 'border-green-700 bg-green-700 text-white',
  FUNDED: 'border-amber-300 bg-amber-300 text-amber-950',
  SUSPENDED_RESTRUCTURE: 'border-red-500 bg-red-500 text-white',
};

const itemStatusTone: Record<ProcessingItemStatus, string> = {
  NOT_STARTED: 'border-sky-200 bg-sky-100 text-sky-900',
  ORDERED: 'border-amber-200 bg-amber-100 text-amber-900',
  RECEIVED: 'border-emerald-200 bg-emerald-100 text-emerald-900',
  NOT_APPLICABLE: 'border-slate-200 bg-slate-100 text-slate-600',
};

const booleanTone = (value: boolean | null) => {
  if (value === true) return 'border-emerald-200 bg-emerald-100 text-emerald-900';
  if (value === false) return 'border-red-200 bg-red-100 text-red-900';
  return 'border-slate-200 bg-slate-100 text-slate-600';
};

function ResizableHeader({
  id,
  width,
  onResize,
  children,
  className = '',
}: {
  id: ColumnId;
  width: number;
  onResize: (id: ColumnId, width: number) => void;
  children: ReactNode;
  className?: string;
}) {
  return (
    <th
      scope="col"
      style={{ width, minWidth: width, maxWidth: width }}
      className={`group/header relative border-b border-r border-slate-200 bg-slate-50 px-3 py-3 text-left text-[11px] font-bold uppercase tracking-[0.08em] text-slate-500 ${className}`}
    >
      <div className="truncate">{children}</div>
      <button
        type="button"
        aria-label={`Resize ${typeof children === 'string' ? children : id} column`}
        title="Drag to resize"
        onPointerDown={(event) => {
          event.preventDefault();
          const startX = event.clientX;
          const startWidth = width;
          const onPointerMove = (moveEvent: PointerEvent) => {
            onResize(id, Math.max(64, Math.min(420, startWidth + moveEvent.clientX - startX)));
          };
          const onPointerUp = () => {
            window.removeEventListener('pointermove', onPointerMove);
            window.removeEventListener('pointerup', onPointerUp);
          };
          window.addEventListener('pointermove', onPointerMove);
          window.addEventListener('pointerup', onPointerUp);
        }}
        className="absolute inset-y-0 right-0 w-2 cursor-col-resize touch-none border-0 bg-transparent p-0 opacity-0 transition hover:bg-blue-400/30 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-300 group-hover/header:opacity-100"
      />
    </th>
  );
}

type FilterOption = { value: string; label: string };

function MultiSelectFilter({
  label,
  values,
  options,
  onChange,
}: {
  label: string;
  values: string[];
  options: FilterOption[];
  onChange: (values: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const [optionSearch, setOptionSearch] = useState('');
  const visibleOptions = options.filter((option) =>
    option.label.toLowerCase().includes(optionSearch.trim().toLowerCase())
  );

  return (
    <div className="relative">
      <label className="mb-1 block text-[11px] font-bold uppercase tracking-wider text-slate-500">
        {label}
      </label>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
        className="flex h-10 w-full items-center justify-between gap-2 rounded-xl border border-slate-200 bg-white px-3 text-left text-sm font-semibold text-slate-700 outline-none transition hover:bg-slate-50 focus-visible:border-blue-300 focus-visible:ring-4 focus-visible:ring-blue-100"
      >
        <span className="truncate">
          {values.length === 0 ? `All ${label}` : `${values.length} selected`}
        </span>
        <ChevronDown className={`h-4 w-4 shrink-0 text-slate-400 transition ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="absolute left-0 top-[66px] z-[70] w-full min-w-64 rounded-2xl border border-slate-200 bg-white p-3 shadow-2xl shadow-slate-300/50">
          {options.length > 7 && (
            <div className="relative mb-2">
              <Search className="pointer-events-none absolute left-2.5 top-2.5 h-3.5 w-3.5 text-slate-400" />
              <input
                value={optionSearch}
                onChange={(event) => setOptionSearch(event.target.value)}
                placeholder={`Search ${label.toLowerCase()}…`}
                className="h-9 w-full rounded-lg border border-slate-200 bg-slate-50 pl-8 pr-2 text-xs font-medium outline-none focus:border-blue-300 focus:bg-white focus:ring-2 focus:ring-blue-100"
              />
            </div>
          )}
          <div className="mb-2 flex items-center justify-between px-1">
            <button type="button" onClick={() => onChange(options.map((option) => option.value))} className="text-xs font-bold text-blue-600 hover:text-blue-800">
              Select all
            </button>
            <button type="button" onClick={() => onChange([])} className="text-xs font-bold text-slate-500 hover:text-slate-800">
              Clear
            </button>
          </div>
          <div className="max-h-56 space-y-0.5 overflow-y-auto">
            {visibleOptions.map((option) => {
              const selected = values.includes(option.value);
              return (
                <button
                  key={option.value}
                  type="button"
                  aria-pressed={selected}
                  onClick={() => onChange(
                    selected
                      ? values.filter((value) => value !== option.value)
                      : [...values, option.value]
                  )}
                  className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-sm font-medium text-slate-700 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-200"
                >
                  <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-md border ${selected ? 'border-blue-500 bg-blue-600 text-white' : 'border-slate-300 bg-white'}`}>
                    {selected && <Check className="h-3.5 w-3.5" />}
                  </span>
                  <span className="truncate">{option.label}</span>
                </button>
              );
            })}
            {visibleOptions.length === 0 && (
              <p className="px-2 py-4 text-center text-xs font-medium text-slate-400">No options found.</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function FilterInput({
  label,
  value,
  onChange,
  type = 'text',
  placeholder,
}: {
  label: string;
  value: string | number | undefined;
  onChange: (value: string) => void;
  type?: 'text' | 'date' | 'number';
  placeholder?: string;
}) {
  return (
    <label>
      <span className="mb-1 block text-[11px] font-bold uppercase tracking-wider text-slate-500">
        {label}
      </span>
      <input
        type={type}
        value={value ?? ''}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-700 outline-none transition placeholder:text-slate-400 focus:border-blue-300 focus:ring-4 focus:ring-blue-100"
      />
    </label>
  );
}

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
  const [filtersExpanded, setFiltersExpanded] = useState(false);
  const [appliedFilters, setAppliedFilters] = useState<ProcessingPipelineFilters>({});
  const [draftFilters, setDraftFilters] = useState<ProcessingPipelineFilters>({});
  const [filterOptions, setFilterOptions] = useState<PipelineFilterOptions>(EMPTY_FILTER_OPTIONS);
  const [detailsExpanded, setDetailsExpanded] = useState(false);
  const [columnWidths, setColumnWidths] = useState<Record<ColumnId, number>>(
    () => Object.fromEntries(
      [...PIPELINE_COLUMNS, ...FUNDING_COLUMNS].map((column) => [column.id, column.width])
    ) as Record<ColumnId, number>
  );
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
  const isProcessor =
    role === UserRole.PROCESSOR_SR || role === UserRole.PROCESSOR_JR;

  useEffect(() => {
    try {
      const storedWidths = window.localStorage.getItem(WIDTH_STORAGE_KEY);
      if (storedWidths) {
        setColumnWidths((current) => ({ ...current, ...JSON.parse(storedWidths) }));
      }
    } catch {
      // Invalid local preferences should never block the pipeline.
    }
  }, []);

  useEffect(() => {
    window.localStorage.setItem(WIDTH_STORAGE_KEY, JSON.stringify(columnWidths));
  }, [columnWidths]);

  const loadRows = (
    nextSheet = sheet,
    nextPage = page,
    nextSearch = search,
    nextSortBy = sortBy,
    nextSortDirection = sortDirection,
    nextFilters = appliedFilters,
  ) => {
    startTransition(async () => {
      const result = await getProcessingPipeline({
        sheet: nextSheet,
        page: nextPage,
        pageSize: initialData.pageSize,
        search: nextSearch,
        sortBy: nextSortBy,
        sortDirection: nextSortDirection,
        filters: nextFilters,
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

  useEffect(() => {
    let cancelled = false;
    getProcessingPipelineFilterOptions(sheet).then((result) => {
      if (cancelled || !result.success) return;
      setFilterOptions(result.options);
    });
    return () => {
      cancelled = true;
    };
  }, [sheet]);

  const visibleRows = rows;

  const currentColumns = sheet === ProcessingPipelineSheet.FUNDING
    ? FUNDING_COLUMNS
    : PIPELINE_COLUMNS;
  const focusColumns = sheet === ProcessingPipelineSheet.FUNDING
    ? FUNDING_FOCUS_COLUMNS
    : PIPELINE_FOCUS_COLUMNS;
  const isColumnVisible = (id: ColumnId) =>
    (id !== 'loanOfficer' || !isLoanOfficer) &&
    (!isProcessor || (id !== 'loanAmount' && id !== 'projectedRevenue')) &&
    (detailsExpanded || focusColumns.has(id));
  const visibleColumnCount = currentColumns.filter((column) => isColumnVisible(column.id)).length;
  const tableWidth = currentColumns
    .filter((column) => isColumnVisible(column.id))
    .reduce((sum, column) => sum + (columnWidths[column.id] || column.width), 0);
  const loadedUnassigned = visibleRows.filter((row) => !row.seniorProcessor).length;
  const loadedAtClosing = visibleRows.filter((row) =>
    row.pipelineStatus === ProcessingPipelineStatus.CTC ||
    row.pipelineStatus === ProcessingPipelineStatus.DOCS_OUT
  ).length;
  const loadedNeedsAttention = visibleRows.filter((row) =>
    row.pipelineStatus === ProcessingPipelineStatus.SUSPENDED_RESTRUCTURE ||
    row.pipelineStatus === ProcessingPipelineStatus.RE_SUB
  ).length;
  const activeFilterCount = Object.values(appliedFilters).filter((value) => {
    if (Array.isArray(value)) return value.length > 0;
    if (typeof value === 'string') return value.trim().length > 0;
    return value !== undefined && value !== null;
  }).length;

  const setDraftFilter = <K extends keyof ProcessingPipelineFilters>(
    key: K,
    value: ProcessingPipelineFilters[K],
  ) => {
    setDraftFilters((current) => ({ ...current, [key]: value }));
  };

  const applyFilters = () => {
    setAppliedFilters(draftFilters);
    setPage(1);
    loadRows(sheet, 1, search, sortBy, sortDirection, draftFilters);
    setFiltersExpanded(false);
  };

  const clearFilters = () => {
    setDraftFilters({});
    setAppliedFilters({});
    setPage(1);
    loadRows(sheet, 1, search, sortBy, sortDirection, {});
  };

  const toggleQuickStatus = (status?: ProcessingPipelineStatus) => {
    const currentStatuses = appliedFilters.pipelineStatuses || [];
    const nextStatuses = status === undefined
      ? []
      : currentStatuses.includes(status)
        ? currentStatuses.filter((value) => value !== status)
        : [...currentStatuses, status];
    const nextFilters: ProcessingPipelineFilters = {
      ...appliedFilters,
      pipelineStatuses: nextStatuses.length > 0 ? nextStatuses : undefined,
    };
    setAppliedFilters(nextFilters);
    setDraftFilters((current) => ({
      ...current,
      pipelineStatuses: nextStatuses.length > 0 ? nextStatuses : undefined,
    }));
    setPage(1);
    loadRows(sheet, 1, search, sortBy, sortDirection, nextFilters);
  };

  const resizeColumn = (id: ColumnId, width: number) => {
    setColumnWidths((current) => ({ ...current, [id]: Math.round(width) }));
  };

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
      className={`w-full rounded-full border px-2.5 py-1.5 text-[13px] font-semibold shadow-sm outline-none transition focus:border-blue-300 focus:ring-4 focus:ring-blue-100 ${className || 'border-slate-200 bg-white text-slate-700'}`}
    >
      {options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
    </select>
  ) : (
    <span className={`inline-flex max-w-full rounded-full border px-2.5 py-1 text-xs font-bold ${className || 'border-slate-200 bg-slate-100 text-slate-600'}`}>
      {options.find((option) => option.value === String(value))?.label || '—'}
    </span>
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
      className="w-full rounded-lg border border-transparent bg-transparent px-2 py-1.5 text-[13px] hover:border-slate-200 hover:bg-white focus:border-blue-300 focus:bg-white focus:outline-none focus:ring-4 focus:ring-blue-100"
    />
  ) : <span className="block whitespace-pre-wrap">{value || '—'}</span>;

  const dateCell = (row: ProcessingPipelineRow, field: EditableField, value: string | null) =>
    canEdit ? (
      <input
        type="date"
        aria-label={field}
        defaultValue={dateInputValue(value)}
        onBlur={(event) => {
          if (event.target.value !== dateInputValue(value)) saveCell(row, field, event.target.value);
        }}
        className="w-full rounded-lg border border-transparent bg-transparent px-2 py-1.5 text-[13px] hover:border-slate-200 hover:bg-white focus:border-blue-300 focus:bg-white focus:outline-none focus:ring-4 focus:ring-blue-100"
      />
    ) : <span>{formatDate(value)}</span>;

  const yesNoCell = (row: ProcessingPipelineRow, field: EditableField, value: boolean | null) =>
    editableSelect(row, field, value, [
      { value: '', label: 'N/A' },
      { value: 'true', label: 'Yes' },
      { value: 'false', label: 'No' },
    ], booleanTone(value));

  const totalPages = Math.max(1, Math.ceil(total / initialData.pageSize));
  const cellPadding = 'px-3 py-3';

  return (
    <section className="space-y-5">
      <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm shadow-slate-200/60">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
          <div
            className="inline-flex w-fit rounded-xl border border-slate-200 bg-slate-50 p-1"
            role="tablist"
            aria-label="Processing pipeline sheets"
          >
            {PROCESSING_PIPELINE_SHEETS.map((option) => (
              <button
                key={option.value}
                type="button"
                role="tab"
                aria-selected={sheet === option.value}
                onClick={() => {
                  setSheet(option.value);
                  setPage(1);
                  setDetailsExpanded(false);
                  setDraftFilters({});
                  setAppliedFilters({});
                  loadRows(option.value, 1, search, sortBy, sortDirection, {});
                }}
                className={`rounded-lg px-4 py-2 text-sm font-bold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-300 ${
                  sheet === option.value
                    ? 'bg-white text-slate-950 shadow-sm ring-1 ring-slate-200'
                    : 'text-slate-500 hover:bg-white/70 hover:text-slate-800'
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>
          <div className="flex flex-1 flex-col gap-2 sm:flex-row xl:max-w-xl xl:justify-end">
            <label className="relative min-w-0 flex-1">
              <Search className="pointer-events-none absolute left-3.5 top-3 h-4 w-4 text-slate-400" />
              <span className="sr-only">Search pipeline</span>
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search borrower, Arrive #, processor or lender"
                className="h-10 w-full rounded-xl border border-slate-200 bg-slate-50 pl-10 pr-3 text-sm font-medium text-slate-800 outline-none transition placeholder:text-slate-400 focus:border-blue-300 focus:bg-white focus:ring-4 focus:ring-blue-100"
              />
            </label>
            <button
              type="button"
              className="app-btn-secondary !h-10 !rounded-xl"
              onClick={() => loadRows()}
              disabled={isPending}
            >
              <RefreshCw className={`h-4 w-4 ${isPending ? 'animate-spin' : ''}`} />
              Refresh
            </button>
          </div>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {[
          { label: 'Loans in view', value: total, helper: PROCESSING_PIPELINE_SHEETS.find((option) => option.value === sheet)?.label || 'Pipeline', tone: 'border-blue-100 from-blue-50/90', valueTone: 'text-blue-950' },
          { label: 'Loaded closing soon', value: loadedAtClosing, helper: 'CTC or docs out', tone: 'border-emerald-100 from-emerald-50/90', valueTone: 'text-emerald-950' },
          { label: 'Loaded attention', value: loadedNeedsAttention, helper: 'Re-sub or restructure', tone: 'border-amber-100 from-amber-50/90', valueTone: 'text-amber-950' },
          { label: 'Loaded unassigned', value: loadedUnassigned, helper: 'No Sr Processor', tone: 'border-violet-100 from-violet-50/90', valueTone: 'text-violet-950' },
        ].map((metric) => (
          <div
            key={metric.label}
            className={`rounded-2xl border bg-gradient-to-br ${metric.tone} via-white to-white p-4 shadow-sm shadow-slate-200/40`}
          >
            <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-slate-500">{metric.label}</p>
            <div className="mt-2 flex items-end justify-between gap-3">
              <p className={`text-3xl font-black tracking-tight ${metric.valueTone}`}>{metric.value}</p>
              <p className="text-right text-xs font-medium text-slate-400">{metric.helper}</p>
            </div>
          </div>
        ))}
      </div>

      <div className="relative z-40 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-end">
          <button
            type="button"
            aria-expanded={filtersExpanded}
            onClick={() => setFiltersExpanded((expanded) => !expanded)}
            className={`flex h-10 items-center gap-2 rounded-xl border px-3 text-sm font-bold shadow-sm transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-300 ${
              filtersExpanded || activeFilterCount > 0
                ? 'border-blue-300 bg-blue-50 text-blue-700'
                : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
            }`}
          >
            <Filter className="h-4 w-4" />
            Filters
            {activeFilterCount > 0 && (
              <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-blue-600 px-1 text-[10px] font-black text-white">
                {activeFilterCount}
              </span>
            )}
          </button>
          {activeFilterCount > 0 && (
            <button
              type="button"
              onClick={clearFilters}
              className="flex h-10 items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 text-sm font-bold text-slate-600 shadow-sm transition hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-300"
            >
              <X className="h-4 w-4" />
              Clear
            </button>
          )}
          <button
            type="button"
            aria-pressed={detailsExpanded}
            onClick={() => setDetailsExpanded((expanded) => !expanded)}
            className={`flex h-10 items-center gap-2 rounded-xl border px-3 text-sm font-bold shadow-sm transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-300 lg:ml-auto ${
              detailsExpanded
                ? 'border-blue-300 bg-blue-50 text-blue-700'
                : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
            }`}
          >
            {detailsExpanded
              ? <Minimize2 className="h-4 w-4" />
              : <Maximize2 className="h-4 w-4 text-blue-600" />}
            {detailsExpanded ? 'Condense' : 'Expand'}
          </button>
          <div className="flex h-10 items-center gap-2 rounded-xl bg-slate-50 px-3 text-xs font-semibold text-slate-500">
            <SlidersHorizontal className="h-4 w-4" />
            {canEdit ? 'Autosave on' : 'Read-only'}
          </div>
        </div>
        {filtersExpanded && (
          <div className="mt-4 border-t border-slate-100 pt-4">
            <div className="max-h-[58vh] space-y-6 overflow-y-auto px-1 pb-2 pr-3">
              <section>
                <div className="mb-3">
                  <h3 className="text-sm font-black text-slate-900">Loan and assignment</h3>
                  <p className="text-xs font-medium text-slate-500">Select multiple values in any field.</p>
                </div>
                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                  {!isLoanOfficer && (
                    <MultiSelectFilter
                      label="Loan Officers"
                      values={draftFilters.loanOfficerIds || []}
                      options={filterOptions.loanOfficers}
                      onChange={(values) => setDraftFilter('loanOfficerIds', values)}
                    />
                  )}
                  <FilterInput label="Assigned From" type="date" value={draftFilters.assignedFrom} onChange={(value) => setDraftFilter('assignedFrom', value || undefined)} />
                  <FilterInput label="Assigned To" type="date" value={draftFilters.assignedTo} onChange={(value) => setDraftFilter('assignedTo', value || undefined)} />
                  <MultiSelectFilter label="Arrive Numbers" values={draftFilters.loanNumbers || []} options={filterOptions.loanNumbers} onChange={(values) => setDraftFilter('loanNumbers', values)} />
                  <MultiSelectFilter label="Borrowers" values={draftFilters.borrowerNames || []} options={filterOptions.borrowerNames} onChange={(values) => setDraftFilter('borrowerNames', values)} />
                  <FilterInput label="Loan Amount Min" type="number" value={draftFilters.loanAmountMin} onChange={(value) => setDraftFilter('loanAmountMin', value === '' ? undefined : Number(value))} placeholder="0" />
                  <FilterInput label="Loan Amount Max" type="number" value={draftFilters.loanAmountMax} onChange={(value) => setDraftFilter('loanAmountMax', value === '' ? undefined : Number(value))} placeholder="1000000" />
                  <MultiSelectFilter label="Loan Types" values={draftFilters.loanTypes || []} options={filterOptions.loanTypes} onChange={(values) => setDraftFilter('loanTypes', values)} />
                  <MultiSelectFilter label="Lenders" values={draftFilters.lenders || []} options={filterOptions.lenders} onChange={(values) => setDraftFilter('lenders', values)} />
                  <MultiSelectFilter label="Jr Processors" values={draftFilters.juniorProcessorIds || []} options={filterOptions.juniorProcessors} onChange={(values) => setDraftFilter('juniorProcessorIds', values)} />
                  <MultiSelectFilter label="Sr Processors" values={draftFilters.seniorProcessorIds || []} options={filterOptions.seniorProcessors} onChange={(values) => setDraftFilter('seniorProcessorIds', values)} />
                </div>
              </section>

              {sheet !== ProcessingPipelineSheet.FUNDING ? (
                <section className="border-t border-slate-100 pt-5">
                  <div className="mb-3">
                    <h3 className="text-sm font-black text-slate-900">Milestones and details</h3>
                    <p className="text-xs font-medium text-slate-500">Combine status, date, checklist, and note filters.</p>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                    <MultiSelectFilter
                      label="Pipeline Statuses"
                      values={draftFilters.pipelineStatuses || []}
                      options={PROCESSING_PIPELINE_STATUS_OPTIONS.map((option) => ({ value: option.value, label: option.label }))}
                      onChange={(values) => setDraftFilter('pipelineStatuses', values as ProcessingPipelineStatus[])}
                    />
                    <FilterInput label="Days in Status Min" type="number" value={draftFilters.daysInStatusMin} onChange={(value) => setDraftFilter('daysInStatusMin', value === '' ? undefined : Number(value))} placeholder="0" />
                    <FilterInput label="Days in Status Max" type="number" value={draftFilters.daysInStatusMax} onChange={(value) => setDraftFilter('daysInStatusMax', value === '' ? undefined : Number(value))} placeholder="30" />
                    <MultiSelectFilter
                      label="Title Statuses"
                      values={draftFilters.titleStatuses || []}
                      options={PROCESSING_ITEM_STATUS_OPTIONS.map((option) => ({ value: option.value, label: option.label }))}
                      onChange={(values) => setDraftFilter('titleStatuses', values as ProcessingItemStatus[])}
                    />
                    <MultiSelectFilter
                      label="Payoff Statuses"
                      values={draftFilters.payoffStatuses || []}
                      options={PROCESSING_ITEM_STATUS_OPTIONS.map((option) => ({ value: option.value, label: option.label }))}
                      onChange={(values) => setDraftFilter('payoffStatuses', values as ProcessingItemStatus[])}
                    />
                    <MultiSelectFilter
                      label="HOI Statuses"
                      values={draftFilters.hoiStatuses || []}
                      options={PROCESSING_ITEM_STATUS_OPTIONS.map((option) => ({ value: option.value, label: option.label }))}
                      onChange={(values) => setDraftFilter('hoiStatuses', values as ProcessingItemStatus[])}
                    />
                    <MultiSelectFilter
                      label="Appraisal Needed"
                      values={draftFilters.appraisalNeeded || []}
                      options={YES_NO_FILTER_OPTIONS}
                      onChange={(values) => setDraftFilter('appraisalNeeded', values as Array<'YES' | 'NO' | 'BLANK'>)}
                    />
                    <FilterInput label="Appraisal Notes" value={draftFilters.appraisalNotes} onChange={(value) => setDraftFilter('appraisalNotes', value || undefined)} placeholder="Contains text…" />
                    <FilterInput label="Appraisal Ordered From" type="date" value={draftFilters.appraisalOrderedFrom} onChange={(value) => setDraftFilter('appraisalOrderedFrom', value || undefined)} />
                    <FilterInput label="Appraisal Ordered To" type="date" value={draftFilters.appraisalOrderedTo} onChange={(value) => setDraftFilter('appraisalOrderedTo', value || undefined)} />
                    <FilterInput label="Appraisal Back From" type="date" value={draftFilters.appraisalBackFrom} onChange={(value) => setDraftFilter('appraisalBackFrom', value || undefined)} />
                    <FilterInput label="Appraisal Back To" type="date" value={draftFilters.appraisalBackTo} onChange={(value) => setDraftFilter('appraisalBackTo', value || undefined)} />
                    <FilterInput label="Pending Items" value={draftFilters.missingItemsCurrentStatus} onChange={(value) => setDraftFilter('missingItemsCurrentStatus', value || undefined)} placeholder="Contains text…" />
                    <FilterInput label="Extra Notes" value={draftFilters.extraNotes} onChange={(value) => setDraftFilter('extraNotes', value || undefined)} placeholder="Contains text…" />
                    <FilterInput label="Revenue Min" type="number" value={draftFilters.projectedRevenueMin} onChange={(value) => setDraftFilter('projectedRevenueMin', value === '' ? undefined : Number(value))} placeholder="0" />
                    <FilterInput label="Revenue Max" type="number" value={draftFilters.projectedRevenueMax} onChange={(value) => setDraftFilter('projectedRevenueMax', value === '' ? undefined : Number(value))} placeholder="10000" />
                    <MultiSelectFilter
                      label="Rate Lock"
                      values={draftFilters.rateLock || []}
                      options={YES_NO_FILTER_OPTIONS}
                      onChange={(values) => setDraftFilter('rateLock', values as Array<'YES' | 'NO' | 'BLANK'>)}
                    />
                  </div>
                </section>
              ) : (
                <section className="border-t border-slate-100 pt-5">
                  <div className="mb-3">
                    <h3 className="text-sm font-black text-slate-900">Funding details</h3>
                    <p className="text-xs font-medium text-slate-500">Filter funding dates and revenue ranges.</p>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                    <FilterInput label="Funded From" type="date" value={draftFilters.fundedFrom} onChange={(value) => setDraftFilter('fundedFrom', value || undefined)} />
                    <FilterInput label="Funded To" type="date" value={draftFilters.fundedTo} onChange={(value) => setDraftFilter('fundedTo', value || undefined)} />
                    <FilterInput label="First Payment From" type="date" value={draftFilters.firstPaymentFrom} onChange={(value) => setDraftFilter('firstPaymentFrom', value || undefined)} />
                    <FilterInput label="First Payment To" type="date" value={draftFilters.firstPaymentTo} onChange={(value) => setDraftFilter('firstPaymentTo', value || undefined)} />
                    <FilterInput label="Sixth Payment From" type="date" value={draftFilters.sixthPaymentFrom} onChange={(value) => setDraftFilter('sixthPaymentFrom', value || undefined)} />
                    <FilterInput label="Sixth Payment To" type="date" value={draftFilters.sixthPaymentTo} onChange={(value) => setDraftFilter('sixthPaymentTo', value || undefined)} />
                    <FilterInput label="Projected Revenue Min" type="number" value={draftFilters.projectedRevenueMin} onChange={(value) => setDraftFilter('projectedRevenueMin', value === '' ? undefined : Number(value))} placeholder="0" />
                    <FilterInput label="Projected Revenue Max" type="number" value={draftFilters.projectedRevenueMax} onChange={(value) => setDraftFilter('projectedRevenueMax', value === '' ? undefined : Number(value))} placeholder="10000" />
                    <FilterInput label="Final Revenue Min" type="number" value={draftFilters.finalRevenueMin} onChange={(value) => setDraftFilter('finalRevenueMin', value === '' ? undefined : Number(value))} placeholder="0" />
                    <FilterInput label="Final Revenue Max" type="number" value={draftFilters.finalRevenueMax} onChange={(value) => setDraftFilter('finalRevenueMax', value === '' ? undefined : Number(value))} placeholder="10000" />
                  </div>
                </section>
              )}
            </div>
            <div className="mt-4 flex flex-col-reverse gap-2 border-t border-slate-100 pt-4 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-xs font-medium text-slate-500">
                Filters combine together; multiple selections within one field match any selected value.
              </p>
              <div className="flex gap-2">
                <button type="button" onClick={clearFilters} className="app-btn-secondary !h-10 !rounded-xl">
                  Clear all
                </button>
                <button type="button" onClick={applyFilters} className="app-btn-primary !h-10 !rounded-xl">
                  Apply filters
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      {message && (
        <div role="status" className="rounded-2xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm font-semibold text-blue-800">
          {message}
        </div>
      )}

      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm shadow-slate-200/60">
        <div className="flex flex-col gap-3 border-b border-slate-100 bg-slate-50/70 px-4 py-3 xl:flex-row xl:items-center xl:justify-between">
          <div className="shrink-0">
            <p className="text-sm font-bold text-slate-900">
              {PROCESSING_PIPELINE_SHEETS.find((option) => option.value === sheet)?.label}
            </p>
            <p className="mt-0.5 text-xs text-slate-500">
              Resize headers or click Expand to show every available detail.
            </p>
          </div>
          {sheet !== ProcessingPipelineSheet.FUNDING && (
            <div className="flex flex-wrap items-center gap-1.5 xl:justify-end" aria-label="Quick pipeline status filters">
              <button
                type="button"
                aria-pressed={!appliedFilters.pipelineStatuses?.length}
                onClick={() => toggleQuickStatus()}
                className={`rounded-full border px-3 py-1.5 text-[11px] font-bold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-300 ${
                  !appliedFilters.pipelineStatuses?.length
                    ? 'border-blue-500 bg-blue-600 text-white'
                    : 'border-slate-200 bg-white text-slate-600 hover:border-blue-200 hover:text-blue-700'
                }`}
              >
                All
              </button>
              {PROCESSING_PIPELINE_STATUS_OPTIONS.map((option) => {
                const selected = appliedFilters.pipelineStatuses?.includes(option.value) || false;
                return (
                  <button
                    key={option.value}
                    type="button"
                    aria-pressed={selected}
                    onClick={() => toggleQuickStatus(option.value)}
                    className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1.5 text-[11px] font-bold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-300 ${
                      selected
                        ? statusTone[option.value]
                        : 'border-slate-200 bg-white text-slate-600 hover:border-blue-200 hover:text-blue-700'
                    }`}
                  >
                    {selected && <Check className="h-3 w-3" />}
                    {option.label}
                  </button>
                );
              })}
            </div>
          )}
        </div>
        <div
          className="relative max-h-[66vh] min-h-72 overflow-auto"
          aria-busy={isPending}
        >
          {isPending && (
            <div
              className="absolute inset-0 z-50 flex min-h-72 items-center justify-center bg-white/85 px-6 backdrop-blur-[2px]"
              role="status"
              aria-live="polite"
            >
              <div className="flex items-center gap-4 rounded-2xl border border-blue-100 bg-white px-6 py-5 shadow-xl shadow-slate-200/70">
                <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-blue-50 text-blue-600 ring-1 ring-blue-100">
                  <Loader2 className="h-6 w-6 animate-spin" />
                </span>
                <div>
                  <p className="text-sm font-bold text-slate-900">
                    Loading {PROCESSING_PIPELINE_SHEETS.find((option) => option.value === sheet)?.label}
                  </p>
                  <p className="mt-0.5 text-xs font-medium text-slate-500">
                    Refreshing the latest processing data…
                  </p>
                </div>
              </div>
            </div>
          )}
          <table
            className="border-separate border-spacing-0 text-left text-[13px] leading-5 text-slate-700"
            style={{ width: Math.max(tableWidth, 720), tableLayout: 'fixed' }}
          >
            <thead className="sticky top-0 z-30">
              <tr>
                {isColumnVisible('loanOfficer') && (
                  <ResizableHeader id="loanOfficer" width={columnWidths.loanOfficer} onResize={resizeColumn} className="sticky left-0 z-40 shadow-[1px_0_0_#e2e8f0]">
                    Loan Officer
                  </ResizableHeader>
                )}
                {isColumnVisible('dateAssigned') && (
                  <ResizableHeader id="dateAssigned" width={columnWidths.dateAssigned} onResize={resizeColumn}>
                    <button type="button" onClick={() => changeSort('dateAssigned')} className="w-full text-left hover:text-blue-700">
                      Assigned
                    </button>
                  </ResizableHeader>
                )}
                {isColumnVisible('loanNumber') && (
                  <ResizableHeader id="loanNumber" width={columnWidths.loanNumber} onResize={resizeColumn}>
                    <button type="button" onClick={() => changeSort('loanNumber')} className="w-full text-left hover:text-blue-700">
                      Arrive #
                    </button>
                  </ResizableHeader>
                )}
                {isColumnVisible('borrowerName') && (
                  <ResizableHeader id="borrowerName" width={columnWidths.borrowerName} onResize={resizeColumn}>
                    <button type="button" onClick={() => changeSort('borrowerName')} className="w-full text-left hover:text-blue-700">
                      Borrower
                    </button>
                  </ResizableHeader>
                )}
                {sheet === ProcessingPipelineSheet.FUNDING ? (
                  <>
                    {isColumnVisible('loanType') && <ResizableHeader id="loanType" width={columnWidths.loanType} onResize={resizeColumn}>Loan Type</ResizableHeader>}
                    {isColumnVisible('juniorProcessor') && <ResizableHeader id="juniorProcessor" width={columnWidths.juniorProcessor} onResize={resizeColumn}>Junior</ResizableHeader>}
                    {isColumnVisible('seniorProcessor') && <ResizableHeader id="seniorProcessor" width={columnWidths.seniorProcessor} onResize={resizeColumn}>Senior</ResizableHeader>}
                    {isColumnVisible('fundedAt') && <ResizableHeader id="fundedAt" width={columnWidths.fundedAt} onResize={resizeColumn}>Funded Date</ResizableHeader>}
                    {isColumnVisible('projectedRevenue') && <ResizableHeader id="projectedRevenue" width={columnWidths.projectedRevenue} onResize={resizeColumn}>Projected Revenue</ResizableHeader>}
                    {isColumnVisible('finalRevenue') && <ResizableHeader id="finalRevenue" width={columnWidths.finalRevenue} onResize={resizeColumn}>Final Revenue</ResizableHeader>}
                    {isColumnVisible('firstPaymentAt') && <ResizableHeader id="firstPaymentAt" width={columnWidths.firstPaymentAt} onResize={resizeColumn}>First Payment</ResizableHeader>}
                    {isColumnVisible('sixthPaymentAt') && <ResizableHeader id="sixthPaymentAt" width={columnWidths.sixthPaymentAt} onResize={resizeColumn}>6th Payment</ResizableHeader>}
                  </>
                ) : (
                  <>
                    {isColumnVisible('lender') && <ResizableHeader id="lender" width={columnWidths.lender} onResize={resizeColumn}>Lender</ResizableHeader>}
                    {isColumnVisible('loanAmount') && <ResizableHeader id="loanAmount" width={columnWidths.loanAmount} onResize={resizeColumn}>Loan Amount</ResizableHeader>}
                    {isColumnVisible('loanType') && <ResizableHeader id="loanType" width={columnWidths.loanType} onResize={resizeColumn}>Loan Type</ResizableHeader>}
                    {isColumnVisible('juniorProcessor') && <ResizableHeader id="juniorProcessor" width={columnWidths.juniorProcessor} onResize={resizeColumn}>Jr Processor</ResizableHeader>}
                    {isColumnVisible('seniorProcessor') && <ResizableHeader id="seniorProcessor" width={columnWidths.seniorProcessor} onResize={resizeColumn}>Processor</ResizableHeader>}
                    {isColumnVisible('pipelineStatus') && <ResizableHeader id="pipelineStatus" width={columnWidths.pipelineStatus} onResize={resizeColumn}>Pipeline Status</ResizableHeader>}
                    {isColumnVisible('missingItemsCurrentStatus') && <ResizableHeader id="missingItemsCurrentStatus" width={columnWidths.missingItemsCurrentStatus} onResize={resizeColumn}>Pending Items</ResizableHeader>}
                    {isColumnVisible('titleStatus') && <ResizableHeader id="titleStatus" width={columnWidths.titleStatus} onResize={resizeColumn}>Title</ResizableHeader>}
                    {isColumnVisible('payoffStatus') && <ResizableHeader id="payoffStatus" width={columnWidths.payoffStatus} onResize={resizeColumn}>Payoff</ResizableHeader>}
                    {isColumnVisible('hoiStatus') && <ResizableHeader id="hoiStatus" width={columnWidths.hoiStatus} onResize={resizeColumn}>HOI</ResizableHeader>}
                    {isColumnVisible('appraisalNeeded') && <ResizableHeader id="appraisalNeeded" width={columnWidths.appraisalNeeded} onResize={resizeColumn}>Appraisal?</ResizableHeader>}
                    {isColumnVisible('appraisalNotes') && <ResizableHeader id="appraisalNotes" width={columnWidths.appraisalNotes} onResize={resizeColumn}>Appraisal Notes</ResizableHeader>}
                    {isColumnVisible('appraisalOrderedAt') && <ResizableHeader id="appraisalOrderedAt" width={columnWidths.appraisalOrderedAt} onResize={resizeColumn}>Appraisal Ordered</ResizableHeader>}
                    {isColumnVisible('appraisalBackAt') && <ResizableHeader id="appraisalBackAt" width={columnWidths.appraisalBackAt} onResize={resizeColumn}>Appraisal Back</ResizableHeader>}
                    {isColumnVisible('extraNotes') && <ResizableHeader id="extraNotes" width={columnWidths.extraNotes} onResize={resizeColumn}>Extra Notes</ResizableHeader>}
                    {isColumnVisible('rateLock') && <ResizableHeader id="rateLock" width={columnWidths.rateLock} onResize={resizeColumn}>Rate Lock</ResizableHeader>}
                    {isColumnVisible('daysInStatus') && (
                      <ResizableHeader id="daysInStatus" width={columnWidths.daysInStatus} onResize={resizeColumn}>
                        <button type="button" onClick={() => changeSort('statusChangedAt')} className="w-full text-left hover:text-blue-700">Days</button>
                      </ResizableHeader>
                    )}
                    {isColumnVisible('projectedRevenue') && <ResizableHeader id="projectedRevenue" width={columnWidths.projectedRevenue} onResize={resizeColumn}>Revenue</ResizableHeader>}
                  </>
                )}
                <ResizableHeader id="actions" width={columnWidths.actions} onResize={resizeColumn} className="sticky right-0 z-40 shadow-[-1px_0_0_#e2e8f0]">
                  Actions
                </ResizableHeader>
              </tr>
            </thead>
            <tbody>
              {visibleRows.map((row) => (
                <tr key={row.id} className="group bg-white transition-colors even:bg-slate-50/55 hover:bg-blue-50/50">
                  {isColumnVisible('loanOfficer') && (
                    <td className={`sticky left-0 z-10 truncate border-b border-r border-slate-200 bg-white font-semibold text-slate-900 shadow-[1px_0_0_#e2e8f0] group-even:bg-slate-50 group-hover:bg-blue-50 ${cellPadding}`} title={row.loan.loanOfficer.name}>
                      {row.loan.loanOfficer.name}
                    </td>
                  )}
                  {isColumnVisible('dateAssigned') && (
                    <td className={`truncate border-b border-r border-slate-200 font-medium text-slate-600 ${cellPadding}`}>{formatDate(row.dateAssigned)}</td>
                  )}
                  {isColumnVisible('loanNumber') && (
                    <td className={`truncate border-b border-r border-slate-200 font-mono text-[12px] font-semibold text-slate-700 ${cellPadding}`}>{row.loan.loanNumber}</td>
                  )}
                  {isColumnVisible('borrowerName') && (
                    <td className={`truncate border-b border-r border-slate-200 font-bold text-slate-950 ${cellPadding}`} title={row.loan.borrowerName}>{row.loan.borrowerName}</td>
                  )}
                  {sheet === ProcessingPipelineSheet.FUNDING ? (
                    <>
                      {isColumnVisible('loanType') && <td className={`truncate border-b border-r border-slate-200 ${cellPadding}`} title={row.loanType || undefined}>{row.loanType || '—'}</td>}
                      {isColumnVisible('juniorProcessor') && <td className={`truncate border-b border-r border-slate-200 ${cellPadding}`}>{row.juniorProcessor?.name || '—'}</td>}
                      {isColumnVisible('seniorProcessor') && <td className={`truncate border-b border-r border-slate-200 font-semibold text-slate-800 ${cellPadding}`}>{row.seniorProcessor?.name || 'Unassigned'}</td>}
                      {isColumnVisible('fundedAt') && <td className={`border-b border-r border-slate-200 ${cellPadding}`}>{formatDate(row.fundedAt)}</td>}
                      {isColumnVisible('projectedRevenue') && <td className={`border-b border-r border-slate-200 font-semibold ${cellPadding}`}>{formatMoney(row.projectedRevenue)}</td>}
                      {isColumnVisible('finalRevenue') && <td className={`border-b border-r border-slate-200 ${cellPadding}`}>
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
                            className="w-full rounded-lg border border-transparent bg-transparent px-2 py-1.5 font-semibold hover:border-slate-200 hover:bg-white focus:border-blue-300 focus:bg-white focus:outline-none focus:ring-4 focus:ring-blue-100"
                          />
                        ) : formatMoney(row.finalRevenue)}
                      </td>}
                      {isColumnVisible('firstPaymentAt') && <td className={`border-b border-r border-slate-200 ${cellPadding}`}>{formatDate(row.firstPaymentAt)}</td>}
                      {isColumnVisible('sixthPaymentAt') && <td className={`border-b border-r border-slate-200 ${cellPadding}`}>{formatDate(row.sixthPaymentAt)}</td>}
                    </>
                  ) : (
                    <>
                      {isColumnVisible('lender') && <td className="border-b border-r border-slate-200 px-1.5 py-1">{textCell(row, 'lender', row.lender)}</td>}
                      {isColumnVisible('loanAmount') && <td className={`truncate border-b border-r border-slate-200 font-semibold tabular-nums text-slate-700 ${cellPadding}`}>{formatMoney(row.loan.amount)}</td>}
                      {isColumnVisible('loanType') && <td className={`truncate border-b border-r border-slate-200 ${cellPadding}`} title={row.loanType || undefined}>{row.loanType || '—'}</td>}
                      {isColumnVisible('juniorProcessor') && <td className={`truncate border-b border-r border-slate-200 ${cellPadding}`} title={row.juniorProcessor?.name}>{row.juniorProcessor?.name || '—'}</td>}
                      {isColumnVisible('seniorProcessor') && <td className={`truncate border-b border-r border-slate-200 font-semibold text-slate-800 ${cellPadding}`} title={row.seniorProcessor?.name || 'Unassigned'}>{row.seniorProcessor?.name || 'Unassigned'}</td>}
                      {isColumnVisible('pipelineStatus') && (
                        <td className="border-b border-r border-slate-200 px-1.5 py-1">
                          {canEdit
                            ? editableSelect(row, 'pipelineStatus', row.pipelineStatus, PROCESSING_PIPELINE_STATUS_OPTIONS, statusTone[row.pipelineStatus])
                            : (
                              <span className={`inline-flex max-w-full truncate rounded-full border px-2.5 py-1 text-xs font-bold ${statusTone[row.pipelineStatus]}`}>
                                {PROCESSING_PIPELINE_STATUS_OPTIONS.find((option) => option.value === row.pipelineStatus)?.label}
                              </span>
                            )}
                        </td>
                      )}
                      {isColumnVisible('missingItemsCurrentStatus') && <td className="border-b border-r border-slate-200 px-1.5 py-1">{textCell(row, 'missingItemsCurrentStatus', row.missingItemsCurrentStatus)}</td>}
                      {isColumnVisible('titleStatus') && <td className="border-b border-r border-slate-200 px-1.5 py-1">{editableSelect(row, 'titleStatus', row.titleStatus, PROCESSING_ITEM_STATUS_OPTIONS, itemStatusTone[row.titleStatus])}</td>}
                      {isColumnVisible('payoffStatus') && <td className="border-b border-r border-slate-200 px-1.5 py-1">{editableSelect(row, 'payoffStatus', row.payoffStatus, PROCESSING_ITEM_STATUS_OPTIONS, itemStatusTone[row.payoffStatus])}</td>}
                      {isColumnVisible('hoiStatus') && <td className="border-b border-r border-slate-200 px-1.5 py-1">{editableSelect(row, 'hoiStatus', row.hoiStatus, PROCESSING_ITEM_STATUS_OPTIONS, itemStatusTone[row.hoiStatus])}</td>}
                      {isColumnVisible('appraisalNeeded') && <td className="border-b border-r border-slate-200 px-1.5 py-1">{yesNoCell(row, 'appraisalNeeded', row.appraisalNeeded)}</td>}
                      {isColumnVisible('appraisalNotes') && <td className="border-b border-r border-slate-200 px-1.5 py-1">{textCell(row, 'appraisalNotes', row.appraisalNotes)}</td>}
                      {isColumnVisible('appraisalOrderedAt') && <td className="border-b border-r border-slate-200 px-1.5 py-1">{dateCell(row, 'appraisalOrderedAt', row.appraisalOrderedAt)}</td>}
                      {isColumnVisible('appraisalBackAt') && <td className="border-b border-r border-slate-200 px-1.5 py-1">{dateCell(row, 'appraisalBackAt', row.appraisalBackAt)}</td>}
                      {isColumnVisible('extraNotes') && <td className="border-b border-r border-slate-200 px-1.5 py-1">{textCell(row, 'extraNotes', row.extraNotes)}</td>}
                      {isColumnVisible('rateLock') && <td className="border-b border-r border-slate-200 px-1.5 py-1">{yesNoCell(row, 'rateLock', row.rateLock)}</td>}
                      {isColumnVisible('daysInStatus') && (
                        <td className={`border-b border-r border-slate-200 text-center ${cellPadding}`}>
                          <span className={`inline-flex min-w-8 justify-center rounded-full px-2 py-1 text-xs font-bold ${row.daysInStatus > 7 ? 'bg-amber-100 text-amber-800' : 'bg-slate-100 text-slate-700'}`}>
                            {row.daysInStatus}
                          </span>
                        </td>
                      )}
                      {isColumnVisible('projectedRevenue') && <td className={`border-b border-r border-slate-200 font-semibold tabular-nums text-slate-700 ${cellPadding}`}>{formatMoney(row.projectedRevenue)}</td>}
                    </>
                  )}
                  <td className="sticky right-0 z-10 border-b border-slate-200 bg-white px-2 py-2 shadow-[-1px_0_0_#e2e8f0] group-even:bg-slate-50 group-hover:bg-blue-50">
                    <div className="flex items-center justify-end gap-1.5">
                      {savingRows.has(row.id) && <Loader2 className="h-4 w-4 animate-spin text-blue-600" aria-label="Saving" />}
                      <button type="button" onClick={() => openHistory(row)} className="rounded-lg border border-slate-200 bg-white p-2 text-slate-500 shadow-sm transition hover:border-blue-200 hover:text-blue-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-300" title="View change history">
                        <History className="h-4 w-4" />
                      </button>
                      {canEdit && (
                        <label className="flex min-w-0 items-center gap-1">
                          <span className="sr-only">Move loan</span>
                          <select
                            aria-label={`Move ${row.loan.borrowerName}`}
                            value=""
                            onChange={(event) => moveRow(row, event.target.value as ProcessingPipelineSheet)}
                            className="min-w-0 flex-1 rounded-lg border border-slate-200 bg-white px-2 py-2 text-xs font-semibold text-slate-600 shadow-sm outline-none transition hover:border-blue-200 focus:border-blue-300 focus:ring-2 focus:ring-blue-100"
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
                  <td colSpan={visibleColumnCount} className="px-6 py-16 text-center text-sm font-medium text-slate-500">
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
