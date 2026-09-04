'use client';

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
} from 'react';
import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useVirtualizer } from '@tanstack/react-virtual';
import {
  Check,
  Archive,
  ChevronDown,
  Clock3,
  Filter,
  History,
  LayoutTemplate,
  ListFilter,
  Loader2,
  Lock,
  Maximize2,
  Minimize2,
  MoreHorizontal,
  Pencil,
  RefreshCw,
  Search,
  SlidersHorizontal,
  Users2,
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
  declineProcessingPipelineLoan,
  dismissProcessingRateLockRequest,
  moveProcessingPipelineLoan,
  requestProcessingRateLock,
  reassignProcessingPipelineJuniorProcessor,
  updateProcessingPipelineCell,
  updateProcessingPipelineRateLock,
  updateProcessingRestructureWorkflow,
  type ProcessingPipelineRow,
  type ProcessingPipelineFilters,
  type ProcessingRestructureAction,
} from '@/app/actions/processingPipelineActions';
import {
  activateProcessingPipelineLayout,
  updateProcessingPipelineLayout,
  type ProcessingPipelineSavedLayout,
} from '@/app/actions/processingPipelineLayoutActions';
import {
  PROCESSING_ITEM_STATUS_OPTIONS,
  PROCESSING_PIPELINE_SHEETS,
  PROCESSING_PIPELINE_STATUS_OPTIONS,
  getProcessingPipelineLockedDefaults,
  getPayoffExpirationWarning,
  isAppraisalBackOverdue,
  isCdSentOverdue,
  isConditionItemOverdue,
  isOrderedItemOverdue,
  isRateLockExpiring,
  isRateLockOverdueAfterAppraisal,
  type LockedProcessingPipelineField,
} from '@/lib/processingPipeline';
import {
  PROCESSING_METHOD_SELF_PROCESSED,
  PROCESSING_METHOD_THIRD_PARTY,
} from '@/lib/processingRouting';
import { isAdmin } from '@/lib/adminTiers';
import { teamColorClasses } from '@/components/admin/leads/LeadUserTeamManager';
import { ProcessingBorrowerWorkspace } from './ProcessingBorrowerWorkspace';
import { ProcessingPipelineLayoutManager } from './ProcessingPipelineLayoutManager';
import {
  buildDefaultProcessingLayoutConfig,
  processingLayoutBucketColumns,
  PROCESSING_FUNDING_COLUMNS,
  PROCESSING_PIPELINE_COLUMNS,
  type ProcessingLayoutBucket,
  type ProcessingPipelineColumnId,
} from '@/lib/processingPipelineLayouts';

type PipelineResult = Extract<Awaited<ReturnType<typeof getProcessingPipeline>>, { success: true }>;
type PipelineFilterOptions = Extract<
  Awaited<ReturnType<typeof getProcessingPipelineFilterOptions>>,
  { success: true }
>['options'];

type Props = {
  initialData: PipelineResult;
  initialLayouts: ProcessingPipelineSavedLayout[];
  role: UserRole;
};

const RATE_LOCK_REQUESTS_VIEW = 'RATE_LOCK_REQUESTS' as const;
type PipelineView = ProcessingPipelineSheet | typeof RATE_LOCK_REQUESTS_VIEW;

type RestructureDialogAction =
  | ProcessingRestructureAction
  | 'MOVE_TO_RESTRUCTURE';

const EMPTY_FILTER_OPTIONS: PipelineFilterOptions = {
  loanOfficers: [],
  loanNumbers: [],
  borrowerNames: [],
  loanTypes: [],
  states: [],
  lenders: [],
  leadSources: [],
  juniorProcessors: [],
  seniorProcessors: [],
};

type EditableField =
  | 'pipelineStatus'
  | 'titleStatus'
  | 'payoffStatus'
  | 'payoffExpiresAt'
  | 'hoiStatus'
  | 'appraisalNeeded'
  | 'appraisalNotes'
  | 'appraisalOrderedAt'
  | 'appraisalBackAt'
  | 'estimatedSigningAt'
  | 'cdSent'
  | 'missingItemsCurrentStatus'
  | 'extraNotes'
  | 'lender'
  | 'propertyState'
  | 'finalRevenue';

type ColumnId = ProcessingPipelineColumnId;
const PIPELINE_COLUMNS = PROCESSING_PIPELINE_COLUMNS;
const FUNDING_COLUMNS = PROCESSING_FUNDING_COLUMNS;
const STICKY_IDENTITY_COLUMNS = [
  'dateAssigned',
  'loanNumber',
  'loanOfficer',
  'borrowerFirstName',
  'borrowerLastName',
] as const satisfies readonly ColumnId[];
const WIDTH_STORAGE_KEY = 'ffl:processing-pipeline-widths-v2';
const YES_NO_FILTER_OPTIONS: FilterOption[] = [
  { value: 'YES', label: 'Yes' },
  { value: 'NO', label: 'No' },
  { value: 'BLANK', label: 'Blank / Not set' },
];
const RESTRUCTURE_STATUS_VALUES = new Set<ProcessingPipelineStatus>([
  ProcessingPipelineStatus.SUSPENDED_RESTRUCTURE,
  ProcessingPipelineStatus.ADVERSE_PENDING,
  ProcessingPipelineStatus.PENDING_APPROVAL,
]);
const RESTRUCTURE_STATUS_OPTIONS = PROCESSING_PIPELINE_STATUS_OPTIONS.filter((option) =>
  RESTRUCTURE_STATUS_VALUES.has(option.value),
);
const STANDARD_STATUS_OPTIONS = PROCESSING_PIPELINE_STATUS_OPTIONS.filter((option) =>
  !RESTRUCTURE_STATUS_VALUES.has(option.value),
);

const statusTone: Record<ProcessingPipelineStatus, string> = {
  SUBBED_TO_UW: 'border-sky-200 bg-sky-100 text-sky-900',
  APPROVED_WITH_CONDITIONS: 'border-lime-200 bg-lime-100 text-lime-900',
  RE_SUB: 'border-green-300 bg-green-200 text-green-900',
  CTC: 'border-green-400 bg-green-300 text-green-950',
  DOCS_OUT: 'border-green-700 bg-green-700 text-white',
  SUSPENDED: 'border-orange-400 bg-orange-300 text-orange-950',
  FUNDED: 'border-amber-300 bg-amber-300 text-amber-950',
  SUSPENDED_RESTRUCTURE: 'border-red-500 bg-red-500 text-white',
  ADVERSE_PENDING: 'border-red-900 bg-red-800 text-white',
  PENDING_APPROVAL: 'border-orange-300 bg-orange-200 text-orange-950',
};

const rowSurfaceTone: Record<ProcessingPipelineStatus, string> = {
  SUBBED_TO_UW: 'bg-sky-50/80 hover:bg-sky-100/80',
  APPROVED_WITH_CONDITIONS: 'bg-lime-50/80 hover:bg-lime-100/80',
  RE_SUB: 'bg-green-50/80 hover:bg-green-100/80',
  CTC: 'bg-emerald-50/80 hover:bg-emerald-100/80',
  DOCS_OUT: 'bg-green-100/80 hover:bg-green-200/80',
  SUSPENDED: 'bg-orange-50/90 hover:bg-orange-100/90',
  FUNDED: 'bg-amber-50/80 hover:bg-amber-100/80',
  SUSPENDED_RESTRUCTURE: 'bg-red-50/80 hover:bg-red-100/80',
  ADVERSE_PENDING: 'bg-red-200/90 hover:bg-red-300/90',
  PENDING_APPROVAL: 'bg-orange-50/90 hover:bg-orange-100/90',
};

const stickyRowSurfaceTone: Record<ProcessingPipelineStatus, string> = {
  SUBBED_TO_UW: 'bg-sky-50 group-hover:bg-sky-100',
  APPROVED_WITH_CONDITIONS: 'bg-lime-50 group-hover:bg-lime-100',
  RE_SUB: 'bg-green-50 group-hover:bg-green-100',
  CTC: 'bg-emerald-50 group-hover:bg-emerald-100',
  DOCS_OUT: 'bg-green-100 group-hover:bg-green-200',
  SUSPENDED: 'bg-orange-50 group-hover:bg-orange-100',
  FUNDED: 'bg-amber-50 group-hover:bg-amber-100',
  SUSPENDED_RESTRUCTURE: 'bg-red-50 group-hover:bg-red-100',
  ADVERSE_PENDING: 'bg-red-200 group-hover:bg-red-300',
  PENDING_APPROVAL: 'bg-orange-50 group-hover:bg-orange-100',
};

const itemStatusTone: Record<ProcessingItemStatus, string> = {
  NOT_STARTED: 'border-slate-300 bg-slate-100 text-slate-700',
  ORDERED: 'border-amber-200 bg-amber-100 text-amber-900',
  RECEIVED: 'border-emerald-200 bg-emerald-100 text-emerald-900',
  NOT_APPLICABLE: 'border-slate-200 bg-slate-100 text-slate-600',
};

const booleanTone = (value: boolean | null) => {
  if (value === true) return '!border-emerald-200 !bg-emerald-100 !text-emerald-900';
  if (value === false) return '!border-red-300 !bg-red-200 !text-red-900';
  return '!border-slate-200 !bg-slate-100 !text-slate-600';
};

const deadlineTone =
  '!border-red-400 !bg-red-200 !text-red-950 ring-1 ring-inset ring-red-300';
const neutralNoTone = '!border-slate-200 !bg-white !text-slate-700';

function processorLabel(row: ProcessingPipelineRow) {
  if (row.seniorProcessor?.name) return row.seniorProcessor.name;
  if (row.processingMethod === PROCESSING_METHOD_THIRD_PARTY) return '3rd Party';
  if (row.processingMethod === PROCESSING_METHOD_SELF_PROCESSED) return 'Self Processed';
  return 'Unassigned';
}

type ColumnSort = {
  id: ColumnId;
  direction: 'asc' | 'desc';
};

type ColumnFilterRule = {
  query?: string;
  selected?: string[];
  from?: string;
  to?: string;
  min?: string;
  max?: string;
};

const DATE_COLUMN_IDS = new Set<ColumnId>([
  'dateAssigned',
  'estimatedSigningAt',
  'appraisalOrderedAt',
  'appraisalBackAt',
  'payoffExpiresAt',
  'fundedAt',
  'firstPaymentAt',
  'sixthPaymentAt',
]);

const NUMBER_COLUMN_IDS = new Set<ColumnId>([
  'loanAmount',
  'daysInStatus',
  'projectedRevenue',
  'finalRevenue',
]);

function columnRawValue(row: ProcessingPipelineRow, id: ColumnId): string | number | null {
  if (id === 'loanOfficer') return row.loan.loanOfficer.name;
  if (id === 'dateAssigned') return row.dateAssigned;
  if (id === 'loanNumber') return row.loan.loanNumber;
  if (id === 'borrowerFirstName') return row.loan.borrowerFirstName;
  if (id === 'borrowerLastName') return row.loan.borrowerLastName;
  if (id === 'borrowerName') return row.loan.borrowerName;
  if (id === 'propertyState') return row.propertyState;
  if (id === 'loanAmount') return row.loan.amount;
  if (id === 'loanType') return row.loanType;
  if (id === 'lender') return row.lender;
  if (id === 'leadSource') return row.leadSource;
  if (id === 'juniorProcessor') return row.juniorProcessor?.name || 'Unassigned';
  if (id === 'seniorProcessor') return processorLabel(row);
  if (id === 'pipelineStatus') {
    return PROCESSING_PIPELINE_STATUS_OPTIONS.find(
      (option) => option.value === row.pipelineStatus,
    )?.label || row.pipelineStatus;
  }
  if (id === 'estimatedSigningAt') return row.estimatedSigningAt;
  if (id === 'daysInStatus') return row.daysInStatus;
  if (id === 'titleStatus') {
    return PROCESSING_ITEM_STATUS_OPTIONS.find((option) => option.value === row.titleStatus)?.label || row.titleStatus;
  }
  if (id === 'payoffStatus') {
    return PROCESSING_ITEM_STATUS_OPTIONS.find((option) => option.value === row.payoffStatus)?.label || row.payoffStatus;
  }
  if (id === 'payoffExpiresAt') return row.payoffExpiresAt;
  if (id === 'hoiStatus') {
    return PROCESSING_ITEM_STATUS_OPTIONS.find((option) => option.value === row.hoiStatus)?.label || row.hoiStatus;
  }
  if (id === 'appraisalNeeded') return row.appraisalNeeded === null ? 'Not set' : row.appraisalNeeded ? 'Yes' : 'No';
  if (id === 'appraisalNotes') return row.appraisalNotes;
  if (id === 'appraisalOrderedAt') return row.appraisalOrderedAt;
  if (id === 'appraisalBackAt') return row.appraisalBackAt;
  if (id === 'cdSent') return row.cdSent ? 'Yes' : 'No';
  if (id === 'missingItemsCurrentStatus') return row.missingItemsCurrentStatus;
  if (id === 'restructureNotes') return row.restructureNotes;
  if (id === 'extraNotes') return row.extraNotes;
  if (id === 'rateLock') return row.rateLock ? 'Yes' : 'No';
  if (id === 'fundedAt') return row.fundedAt;
  if (id === 'projectedRevenue') return row.projectedRevenue;
  if (id === 'finalRevenue') return row.finalRevenue;
  if (id === 'firstPaymentAt') return row.firstPaymentAt;
  if (id === 'sixthPaymentAt') return row.sixthPaymentAt;
  return null;
}

function columnDisplayValue(row: ProcessingPipelineRow, id: ColumnId) {
  const value = columnRawValue(row, id);
  if (value === null || value === '') return 'Blank';
  if (DATE_COLUMN_IDS.has(id)) return formatDate(String(value));
  if (
    id === 'loanAmount' ||
    id === 'projectedRevenue' ||
    id === 'finalRevenue'
  ) {
    return formatMoney(Number(value));
  }
  return String(value);
}

function isColumnFilterActive(rule?: ColumnFilterRule) {
  return Boolean(
    rule?.query?.trim() ||
    rule?.selected?.length ||
    rule?.from ||
    rule?.to ||
    rule?.min ||
    rule?.max,
  );
}

type ColumnMenuContextValue = {
  activeColumnId: ColumnId | null;
  activeSort: ColumnSort | null;
  activeFilters: Partial<Record<ColumnId, ColumnFilterRule>>;
  open: (id: ColumnId, button: HTMLButtonElement) => void;
};

const ColumnMenuContext = createContext<ColumnMenuContextValue | null>(null);

function renderTeamDots(colors: string[]) {
  const safeColors = (colors.length > 0 ? colors : ['blue']).slice(0, 3);
  return (
    <span className="inline-flex shrink-0 items-center -space-x-0.5" aria-hidden="true">
      {safeColors.map((color, index) => (
        <span
          key={`${color}-${index}`}
          className={`inline-block h-2 w-2 rounded-full ring-1 ring-white ${teamColorClasses(color).dot}`}
        />
      ))}
    </span>
  );
}

function ResizableHeader({
  id,
  width,
  onResize,
  children,
  className = '',
  stickyLeft,
}: {
  id: ColumnId;
  width: number;
  onResize: (id: ColumnId, width: number) => void;
  children: ReactNode;
  className?: string;
  stickyLeft?: number;
}) {
  const columnMenu = useContext(ColumnMenuContext);
  const menuActive =
    columnMenu?.activeColumnId === id ||
    columnMenu?.activeSort?.id === id ||
    isColumnFilterActive(columnMenu?.activeFilters[id]);
  return (
    <th
      scope="col"
      style={{ width, minWidth: width, maxWidth: width, left: stickyLeft }}
      className={`group/header border-b border-r border-slate-200 bg-slate-50 px-3 py-3 text-left text-[11px] font-bold uppercase tracking-[0.08em] text-slate-500 ${
        stickyLeft === undefined ? 'relative' : 'relative lg:sticky lg:z-30'
      } ${className}`}
    >
      <div className="flex min-w-0 items-center gap-1.5">
        <div className="min-w-0 flex-1 truncate">{children}</div>
        {id !== 'actions' && columnMenu && (
          <button
            type="button"
            data-column-menu-trigger
            aria-label={`Sort and filter ${id} column`}
            aria-expanded={columnMenu.activeColumnId === id}
            title="Sort and filter"
            onClick={(event) => {
              event.stopPropagation();
              columnMenu.open(id, event.currentTarget);
            }}
            className={`mr-1 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-300 ${
              menuActive
                ? 'bg-blue-100 text-blue-700'
                : 'text-slate-400 hover:bg-slate-200 hover:text-slate-700'
            }`}
          >
            <ListFilter className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
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

function todayInputValue(date = new Date()) {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 10);
}

function formatDateOnly(value: string | null) {
  if (!value) return '—';
  const date = new Date(`${value.slice(0, 10)}T00:00:00.000Z`);
  return new Intl.DateTimeFormat('en-US', {
    month: '2-digit',
    day: '2-digit',
    year: '2-digit',
    timeZone: 'UTC',
  }).format(date);
}

function formatMoney(value: number | null) {
  if (value === null) return '—';
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(value);
}

type FundingRangePreset =
  | 'currentMonth'
  | 'lastMonth'
  | 'allFundings'
  | 'dateRange';

function fundingMonthFilters(monthOffset: 0 | -1): ProcessingPipelineFilters {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Los_Angeles',
    year: 'numeric',
    month: 'numeric',
  }).formatToParts(new Date());
  const year = Number(parts.find((part) => part.type === 'year')?.value);
  const month = Number(parts.find((part) => part.type === 'month')?.value) - 1;
  const start = new Date(Date.UTC(year, month + monthOffset, 1));
  const end = new Date(Date.UTC(year, month + monthOffset + 1, 0));
  return {
    fundedFrom: start.toISOString().slice(0, 10),
    fundedTo: end.toISOString().slice(0, 10),
  };
}

function parseAuditDetails(details: string | null) {
  if (!details) return null;
  try {
    return JSON.parse(details) as Record<string, unknown>;
  } catch {
    return { message: details };
  }
}

export function ProcessingPipelineGrid({
  initialData,
  initialLayouts,
  role,
}: Props) {
  const hasSearchEffectMounted = useRef(false);
  const layoutWidthSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const filterOptionsBySheet = useRef(
    new Map<PipelineView, PipelineFilterOptions>()
  );
  const [sheet, setSheet] = useState<PipelineView>(ProcessingPipelineSheet.PIPELINE);
  const [rows, setRows] = useState(initialData.rows);
  const [total, setTotal] = useState(initialData.total);
  const [search, setSearch] = useState('');
  const [filtersExpanded, setFiltersExpanded] = useState(false);
  const [fundingRangePreset, setFundingRangePreset] =
    useState<FundingRangePreset>('currentMonth');
  const [appliedFilters, setAppliedFilters] = useState<ProcessingPipelineFilters>({});
  const [draftFilters, setDraftFilters] = useState<ProcessingPipelineFilters>({});
  const [selectedTeamIds, setSelectedTeamIds] = useState<string[]>([]);
  const [filterOptions, setFilterOptions] = useState<PipelineFilterOptions>(EMPTY_FILTER_OPTIONS);
  const [detailsExpanded, setDetailsExpanded] = useState(false);
  const [layouts, setLayouts] =
    useState<ProcessingPipelineSavedLayout[]>(initialLayouts);
  const [layoutManagerOpen, setLayoutManagerOpen] = useState(false);
  const [activatingLayoutId, setActivatingLayoutId] = useState<string | null>(
    null,
  );
  const [columnWidths, setColumnWidths] = useState<Record<ColumnId, number>>(
    () => Object.fromEntries(
      [...PIPELINE_COLUMNS, ...FUNDING_COLUMNS].map((column) => [column.id, column.width])
    ) as Record<ColumnId, number>
  );
  const [sortBy, setSortBy] = useState<'pipelineStatus' | 'dateAssigned' | 'statusChangedAt' | 'borrowerName' | 'loanNumber'>('pipelineStatus');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');
  const [columnSort, setColumnSort] = useState<ColumnSort | null>(null);
  const [columnFilters, setColumnFilters] = useState<
    Partial<Record<ColumnId, ColumnFilterRule>>
  >({});
  const [columnMenu, setColumnMenu] = useState<{
    id: ColumnId;
    left: number;
    top: number;
  } | null>(null);
  const [columnOptionSearch, setColumnOptionSearch] = useState('');
  const [savingRows, setSavingRows] = useState<Set<string>>(new Set());
  const [message, setMessage] = useState('');
  const [historyRow, setHistoryRow] = useState<ProcessingPipelineRow | null>(null);
  const [borrowerWorkspaceRowId, setBorrowerWorkspaceRowId] =
    useState<string | null>(null);
  const [actionsMenuRow, setActionsMenuRow] = useState<ProcessingPipelineRow | null>(null);
  const [juniorProcessorEditorRowId, setJuniorProcessorEditorRowId] =
    useState<string | null>(null);
  const [restructureDialog, setRestructureDialog] = useState<{
    row: ProcessingPipelineRow;
    action: RestructureDialogAction;
  } | null>(null);
  const [restructureNotesDraft, setRestructureNotesDraft] = useState('');
  const [rateLockDialogRow, setRateLockDialogRow] = useState<ProcessingPipelineRow | null>(null);
  const [rateLockExpiryDraft, setRateLockExpiryDraft] = useState('');
  const [payoffExpirationDialogRow, setPayoffExpirationDialogRow] =
    useState<ProcessingPipelineRow | null>(null);
  const [payoffExpirationDraft, setPayoffExpirationDraft] = useState('');
  const [portalReady, setPortalReady] = useState(false);
  const [clockNow, setClockNow] = useState(() => new Date());
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
  const canEditRow = (row: ProcessingPipelineRow) => canEdit && row.canEdit;
  const isLockedField = (
    row: ProcessingPipelineRow,
    field: EditableField | 'rateLock',
  ) => {
    const resolvedField =
      field === 'payoffExpiresAt' ? 'payoffStatus' : field;
    const lockableFields: readonly LockedProcessingPipelineField[] = [
      'titleStatus',
      'payoffStatus',
      'hoiStatus',
      'appraisalNeeded',
      'cdSent',
      'rateLock',
    ];
    if (
      !lockableFields.includes(resolvedField as LockedProcessingPipelineField)
    ) return false;
    return Boolean(
      getProcessingPipelineLockedDefaults(row.lender, row.processingMethod)
        ?.lockedFields.includes(
          resolvedField as LockedProcessingPipelineField,
        ),
    );
  };
  const isProcessor =
    role === UserRole.PROCESSOR_SR || role === UserRole.PROCESSOR_JR;
  const isManagerOrAdmin = role === UserRole.MANAGER || isAdmin(role);
  const isRateLockRequestsView = sheet === RATE_LOCK_REQUESTS_VIEW;
  const pipelineViews: Array<{ value: PipelineView; label: string }> = [
    { value: ProcessingPipelineSheet.PIPELINE, label: 'Pipeline' },
    { value: ProcessingPipelineSheet.RESTRUCTURE, label: 'Restructures' },
    ...(isManagerOrAdmin
      ? [{ value: RATE_LOCK_REQUESTS_VIEW, label: 'Rate Lock Requests' } as const]
      : []),
    { value: ProcessingPipelineSheet.FUNDING, label: 'Fundings' },
  ];
  const activeViewLabel =
    pipelineViews.find((option) => option.value === sheet)?.label || 'Pipeline';
  const canFilterByTeam =
    isProcessor || role === UserRole.MANAGER || isAdmin(role);
  const statusOptions =
    sheet === ProcessingPipelineSheet.RESTRUCTURE
      ? RESTRUCTURE_STATUS_OPTIONS
      : isRateLockRequestsView
        ? PROCESSING_PIPELINE_STATUS_OPTIONS
        : STANDARD_STATUS_OPTIONS;

  useEffect(() => {
    setPortalReady(true);
  }, []);

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

  useEffect(() => {
    const interval = window.setInterval(() => setClockNow(new Date()), 60_000);
    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    if (!payoffExpirationDialogRow) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (
        event.key === 'Escape' &&
        !savingRows.has(payoffExpirationDialogRow.id)
      ) {
        setPayoffExpirationDialogRow(null);
        setPayoffExpirationDraft('');
      }
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [payoffExpirationDialogRow, savingRows]);

  useEffect(
    () => () => {
      if (layoutWidthSaveTimer.current) {
        clearTimeout(layoutWidthSaveTimer.current);
      }
    },
    [],
  );

  const loadRows = (
    nextSheet = sheet,
    nextSearch = search,
    nextSortBy = sortBy,
    nextSortDirection = sortDirection,
    nextFilters = appliedFilters,
  ) => {
    startTransition(async () => {
      const isGlobalSearch = Boolean(nextSearch.trim());
      const result = await getProcessingPipeline({
        sheet:
          nextSheet === RATE_LOCK_REQUESTS_VIEW
            ? undefined
            : nextSheet,
        rateLockRequestsOnly:
          !isGlobalSearch && nextSheet === RATE_LOCK_REQUESTS_VIEW,
        allSheets: isGlobalSearch,
        search: nextSearch,
        sortBy: nextSortBy,
        sortDirection: nextSortDirection,
        filters: isGlobalSearch ? {} : nextFilters,
      });
      if (!result.success) {
        setMessage(result.error);
        return;
      }
      setRows(result.rows);
      setTotal(result.total);
      setMessage('');
    });
  };

  useEffect(() => {
    if (!hasSearchEffectMounted.current) {
      hasSearchEffectMounted.current = true;
      return;
    }
    const timeout = window.setTimeout(() => loadRows(sheet, search), 300);
    return () => window.clearTimeout(timeout);
    // loadRows deliberately reads the current sort state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  useEffect(() => {
    if (!filtersExpanded) return;
    const cachedOptions = filterOptionsBySheet.current.get(sheet);
    if (cachedOptions) {
      setFilterOptions(cachedOptions);
      return;
    }
    let cancelled = false;
    getProcessingPipelineFilterOptions(
      isRateLockRequestsView ? ProcessingPipelineSheet.PIPELINE : sheet,
      isRateLockRequestsView,
    ).then((result) => {
      if (cancelled || !result.success) return;
      filterOptionsBySheet.current.set(sheet, result.options);
      setFilterOptions(result.options);
    });
    return () => {
      cancelled = true;
    };
  }, [filtersExpanded, isRateLockRequestsView, sheet]);

  useEffect(() => {
    if (!columnMenu) return;
    const closeOnPointerDown = (event: PointerEvent) => {
      const target = event.target as HTMLElement | null;
      if (
        target?.closest('[data-column-menu-panel]') ||
        target?.closest('[data-column-menu-trigger]')
      ) return;
      setColumnMenu(null);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setColumnMenu(null);
    };
    window.addEventListener('pointerdown', closeOnPointerDown);
    window.addEventListener('keydown', closeOnEscape);
    return () => {
      window.removeEventListener('pointerdown', closeOnPointerDown);
      window.removeEventListener('keydown', closeOnEscape);
    };
  }, [columnMenu]);

  const openColumnMenu = (id: ColumnId, button: HTMLButtonElement) => {
    if (columnMenu?.id === id) {
      setColumnMenu(null);
      return;
    }
    const rect = button.getBoundingClientRect();
    setColumnOptionSearch(columnFilters[id]?.query || '');
    setColumnMenu({
      id,
      left: Math.max(12, Math.min(window.innerWidth - 332, rect.right - 320)),
      top: Math.max(12, Math.min(window.innerHeight - 420, rect.bottom + 6)),
    });
  };

  const columnMenuContextValue: ColumnMenuContextValue = {
    activeColumnId: columnMenu?.id || null,
    activeSort: columnSort,
    activeFilters: columnFilters,
    open: openColumnMenu,
  };

  const visibleRows = useMemo(() => {
    const filtered = rows.filter((row) =>
      Object.entries(columnFilters).every(([rawId, rule]) => {
        const id = rawId as ColumnId;
        if (!rule || !isColumnFilterActive(rule)) return true;
        const rawValue = columnRawValue(row, id);
        const displayValue = columnDisplayValue(row, id);
        if (
          rule.query?.trim() &&
          !displayValue.toLowerCase().includes(rule.query.trim().toLowerCase())
        ) return false;
        if (rule.selected?.length && !rule.selected.includes(displayValue)) {
          return false;
        }
        if (DATE_COLUMN_IDS.has(id)) {
          if (!rawValue) return false;
          const dateValue = String(rawValue).slice(0, 10);
          if (rule.from && dateValue < rule.from) return false;
          if (rule.to && dateValue > rule.to) return false;
        }
        if (NUMBER_COLUMN_IDS.has(id)) {
          const numberValue =
            typeof rawValue === 'number' ? rawValue : Number(rawValue);
          if (!Number.isFinite(numberValue)) return false;
          if (rule.min && numberValue < Number(rule.min)) return false;
          if (rule.max && numberValue > Number(rule.max)) return false;
        }
        return true;
      }),
    );
    if (!columnSort) return filtered;
    return [...filtered].sort((leftRow, rightRow) => {
      const left = columnRawValue(leftRow, columnSort.id);
      const right = columnRawValue(rightRow, columnSort.id);
      if (left === right) return 0;
      if (left === null || left === '') return 1;
      if (right === null || right === '') return -1;
      let comparison: number;
      if (DATE_COLUMN_IDS.has(columnSort.id)) {
        comparison = new Date(String(left)).getTime() - new Date(String(right)).getTime();
      } else if (
        NUMBER_COLUMN_IDS.has(columnSort.id) ||
        typeof left === 'number' ||
        typeof right === 'number'
      ) {
        comparison = Number(left) - Number(right);
      } else {
        comparison = String(left).localeCompare(String(right), undefined, {
          numeric: true,
          sensitivity: 'base',
        });
      }
      return columnSort.direction === 'asc' ? comparison : -comparison;
    });
  }, [columnFilters, columnSort, rows]);

  const activeColumnRule = columnMenu ? columnFilters[columnMenu.id] || {} : {};
  const activeColumnLabel = columnMenu
    ? [...PIPELINE_COLUMNS, ...FUNDING_COLUMNS].find(
        (column) => column.id === columnMenu.id,
      )?.label || columnMenu.id
    : '';
  const columnValueOptions = useMemo(() => {
    if (!columnMenu || DATE_COLUMN_IDS.has(columnMenu.id) || NUMBER_COLUMN_IDS.has(columnMenu.id)) {
      return [];
    }
    return Array.from(
      new Set(rows.map((row) => columnDisplayValue(row, columnMenu.id))),
    ).sort((left, right) => left.localeCompare(right, undefined, {
      numeric: true,
      sensitivity: 'base',
    }));
  }, [columnMenu, rows]);

  const updateColumnFilter = (
    id: ColumnId,
    patch: Partial<ColumnFilterRule>,
  ) => {
    setColumnFilters((current) => ({
      ...current,
      [id]: { ...current[id], ...patch },
    }));
  };

  const clearColumnFilter = (id: ColumnId) => {
    setColumnFilters((current) => {
      const next = { ...current };
      delete next[id];
      return next;
    });
  };

  const selectSavedLayout = async (id: string) => {
    if (id === activeLayout?.id || activatingLayoutId) return;
    const previous = layouts;
    setActivatingLayoutId(id);
    setLayouts((current) =>
      current.map((layout) => ({ ...layout, isActive: layout.id === id })),
    );
    const result = await activateProcessingPipelineLayout(id);
    setActivatingLayoutId(null);
    if (!result.success) {
      setLayouts(previous);
      setMessage(result.error);
      return;
    }
    setLayouts(result.layouts);
    setMessage('');
  };

  const layoutBucket: ProcessingLayoutBucket =
    sheet === ProcessingPipelineSheet.FUNDING
      ? 'FUNDING'
      : sheet === ProcessingPipelineSheet.RESTRUCTURE
        ? 'RESTRUCTURE'
        : isRateLockRequestsView
          ? 'RATE_LOCK_REQUESTS'
          : 'PIPELINE';
  const activeLayout = layouts.find((layout) => layout.isActive) || null;
  const activeLayoutConfig =
    activeLayout?.config || buildDefaultProcessingLayoutConfig(role);
  const canonicalColumns = processingLayoutBucketColumns(layoutBucket, role);
  const canonicalById = new Map(
    canonicalColumns.map((column) => [column.id, column]),
  );
  const condensedColumns = activeLayoutConfig.buckets[layoutBucket].columns
    .filter((column) => column.visible)
    .flatMap((column) => {
      const definition = canonicalById.get(column.id);
      return definition ? [{ ...definition, width: column.width }] : [];
    });
  const currentColumns = detailsExpanded ? canonicalColumns : condensedColumns;
  const actionsPinnedRight =
    currentColumns[currentColumns.length - 1]?.id === 'actions';
  const visibleColumnCount = currentColumns.length;
  const tableWidth = currentColumns.reduce(
    (sum, column) =>
      sum +
      (detailsExpanded
        ? columnWidths[column.id] || column.width
        : column.width),
    0,
  );
  const stickyLeftByColumn = new Map<ColumnId, number>();
  let stickyLeft = 0;
  for (const column of currentColumns) {
    if (!STICKY_IDENTITY_COLUMNS.includes(
      column.id as (typeof STICKY_IDENTITY_COLUMNS)[number],
    )) continue;
    stickyLeftByColumn.set(column.id, stickyLeft);
    stickyLeft += detailsExpanded
      ? columnWidths[column.id] || column.width
      : column.width;
  }
  const rowVirtualizer = useVirtualizer({
    count: visibleRows.length,
    getScrollElement: () => scrollContainerRef.current,
    estimateSize: () => 52,
    getItemKey: (index) => visibleRows[index]?.id ?? index,
    overscan: 8,
  });
  const virtualRows = rowVirtualizer.getVirtualItems();
  const virtualPaddingTop = virtualRows.length > 0 ? virtualRows[0].start : 0;
  const virtualPaddingBottom =
    virtualRows.length > 0
      ? rowVirtualizer.getTotalSize() - virtualRows[virtualRows.length - 1].end
      : 0;
  const layoutMeasureKey = currentColumns
    .map((column) => `${column.id}:${column.width}`)
    .join('|');

  useEffect(() => {
    rowVirtualizer.measure();
  }, [columnWidths, detailsExpanded, layoutMeasureKey, rowVirtualizer]);

  const activeServerFilterCount = Object.values(appliedFilters).filter((value) => {
    if (Array.isArray(value)) return value.length > 0;
    if (typeof value === 'string') return value.trim().length > 0;
    return value !== undefined && value !== null;
  }).length;
  const activeColumnFilterCount = Object.values(columnFilters)
    .filter((rule) => isColumnFilterActive(rule)).length;
  const activeFilterCount = activeServerFilterCount + activeColumnFilterCount;

  const setDraftFilter = <K extends keyof ProcessingPipelineFilters>(
    key: K,
    value: ProcessingPipelineFilters[K],
  ) => {
    setDraftFilters((current) => ({ ...current, [key]: value }));
  };

  const applyFilters = () => {
    if (
      sheet === ProcessingPipelineSheet.FUNDING &&
      (draftFilters.fundedFrom || draftFilters.fundedTo)
    ) {
      setFundingRangePreset('dateRange');
    }
    setAppliedFilters(draftFilters);
    loadRows(sheet, search, sortBy, sortDirection, draftFilters);
    setFiltersExpanded(false);
  };

  const clearFilters = () => {
    if (sheet === ProcessingPipelineSheet.FUNDING) {
      setFundingRangePreset('allFundings');
    }
    setSelectedTeamIds([]);
    setColumnFilters({});
    setColumnSort(null);
    setColumnMenu(null);
    setDraftFilters({});
    setAppliedFilters({});
    loadRows(sheet, search, sortBy, sortDirection, {});
  };

  const selectFundingRange = (
    preset: Exclude<FundingRangePreset, 'dateRange'>,
  ) => {
    const rangeFilters =
      preset === 'allFundings'
        ? { fundedFrom: undefined, fundedTo: undefined }
        : fundingMonthFilters(preset === 'currentMonth' ? 0 : -1);
    const nextFilters: ProcessingPipelineFilters = {
      ...appliedFilters,
      ...rangeFilters,
    };
    setFundingRangePreset(preset);
    setDraftFilters(nextFilters);
    setAppliedFilters(nextFilters);
    setFiltersExpanded(false);
    loadRows(
      ProcessingPipelineSheet.FUNDING,
      search,
      sortBy,
      sortDirection,
      nextFilters,
    );
  };

  const selectTeam = (teamId: string | null) => {
    const nextTeamIds = !teamId
      ? []
      : selectedTeamIds.includes(teamId)
        ? selectedTeamIds.filter((id) => id !== teamId)
        : [...selectedTeamIds, teamId];
    const memberIds = Array.from(new Set(
      initialData.teams
        .filter((team) => nextTeamIds.includes(team.id))
        .flatMap((team) => team.memberIds),
    ));
    const teamLoanOfficerIds =
      nextTeamIds.length > 0
        ? memberIds.length > 0
          ? memberIds
          : ['__NO_TEAM_MEMBERS__']
        : undefined;
    const nextFilters: ProcessingPipelineFilters = {
      ...appliedFilters,
      teamLoanOfficerIds,
    };
    setSelectedTeamIds(nextTeamIds);
    setAppliedFilters(nextFilters);
    setDraftFilters((current) => ({
      ...current,
      teamLoanOfficerIds,
    }));
    loadRows(sheet, search, sortBy, sortDirection, nextFilters);
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
    loadRows(sheet, search, sortBy, sortDirection, nextFilters);
  };

  const resizeColumn = (id: ColumnId, width: number) => {
    const roundedWidth = Math.round(width);
    setColumnWidths((current) => ({ ...current, [id]: roundedWidth }));
    if (detailsExpanded || !activeLayout) return;
    const nextConfig = {
      ...activeLayout.config,
      buckets: {
        ...activeLayout.config.buckets,
        [layoutBucket]: {
          columns: activeLayout.config.buckets[layoutBucket].columns.map(
            (column) =>
              column.id === id
                ? { ...column, width: roundedWidth }
                : column,
          ),
        },
      },
    };
    setLayouts((current) =>
      current.map((layout) =>
        layout.id === activeLayout.id
          ? { ...layout, config: nextConfig }
          : layout,
      ),
    );
    if (layoutWidthSaveTimer.current) {
      clearTimeout(layoutWidthSaveTimer.current);
    }
    layoutWidthSaveTimer.current = setTimeout(async () => {
      const result = await updateProcessingPipelineLayout({
        id: activeLayout.id,
        name: activeLayout.name,
        config: nextConfig,
      });
      if (result.success) setLayouts(result.layouts);
    }, 600);
  };

  const patchRow = (id: string, patch: Partial<ProcessingPipelineRow>) => {
    setRows((current) => current.map((row) => row.id === id ? { ...row, ...patch } : row));
  };

  const saveCell = async (
    row: ProcessingPipelineRow,
    field: EditableField,
    value: unknown,
    options?: {
      estimatedSigningAt?: string | null;
      payoffExpiresAt?: string | null;
    },
  ) => {
    if (!canEditRow(row) || isLockedField(row, field)) return;
    const clientValue =
      field === 'appraisalNeeded' || field === 'cdSent'
        ? value === true || value === 'true'
        : value === ''
          ? null
          : value;
    const optimisticPatch: Partial<ProcessingPipelineRow> = {
      [field]: clientValue,
      ...(field === 'pipelineStatus'
        ? { statusChangedAt: new Date().toISOString(), daysInStatus: 0 }
        : {}),
      ...(options?.estimatedSigningAt
        ? { estimatedSigningAt: new Date(options.estimatedSigningAt).toISOString() }
        : {}),
      ...(field === 'payoffStatus'
        ? value === ProcessingItemStatus.RECEIVED && options?.payoffExpiresAt
          ? {
              payoffExpiresAt: new Date(
                `${options.payoffExpiresAt}T00:00:00.000Z`,
              ).toISOString(),
            }
          : { payoffExpiresAt: null }
        : {}),
    };

    patchRow(row.id, optimisticPatch);
    setSavingRows((current) => new Set(current).add(row.id));
    setMessage('');
    const result = await updateProcessingPipelineCell({
      id: row.id,
      field,
      value,
      estimatedSigningAt: options?.estimatedSigningAt,
      payoffExpiresAt: options?.payoffExpiresAt,
      version: row.version,
    });
    setSavingRows((current) => {
      const next = new Set(current);
      next.delete(row.id);
      return next;
    });
    if (!result.success) {
      patchRow(row.id, row);
      setMessage(result.error);
      return;
    }
    patchRow(row.id, {
      ...optimisticPatch,
      version: result.version,
      ...result.patch,
    });
  };

  const reassignJuniorProcessor = async (
    row: ProcessingPipelineRow,
    juniorProcessorId: string | null,
  ) => {
    if (!isManagerOrAdmin || row.sheet === ProcessingPipelineSheet.FUNDING) {
      return;
    }
    setSavingRows((current) => new Set(current).add(row.id));
    setMessage('');
    const result = await reassignProcessingPipelineJuniorProcessor({
      id: row.id,
      version: row.version,
      juniorProcessorId,
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
    setJuniorProcessorEditorRowId(null);
    patchRow(row.id, {
      ...result.patch,
      version: result.version,
    });
    setMessage(
      `${row.loan.borrowerName} reassigned to ${
        result.patch.juniorProcessor?.name || 'Unassigned'
      }.`,
    );
  };

  const saveRateLock = async (
    row: ProcessingPipelineRow,
    rateLock: boolean,
    expiresAt: string | null,
  ) => {
    if (!canEditRow(row) || isLockedField(row, 'rateLock')) return;
    setSavingRows((current) => new Set(current).add(row.id));
    setMessage('');
    const result = await updateProcessingPipelineRateLock({
      id: row.id,
      rateLock,
      expiresAt,
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
    if (isRateLockRequestsView && rateLock) {
      setRows((current) => current.filter((candidate) => candidate.id !== row.id));
      setTotal((current) => Math.max(0, current - 1));
    } else {
      patchRow(row.id, { ...result.patch, version: result.version });
    }
    setRateLockDialogRow(null);
    setRateLockExpiryDraft('');
  };

  const openRateLockCalendar = (row: ProcessingPipelineRow) => {
    setRateLockDialogRow(row);
    setRateLockExpiryDraft(dateInputValue(row.rateLockExpiresAt));
  };

  const requestRateLock = async (row: ProcessingPipelineRow) => {
    setActionsMenuRow(null);
    setSavingRows((current) => new Set(current).add(row.id));
    const result = await requestProcessingRateLock({
      id: row.id,
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
    patchRow(row.id, { ...result.patch, version: result.version });
    setMessage(`Rate Lock requested for ${row.loan.borrowerName}.`);
  };

  const dismissRateLockRequest = async (row: ProcessingPipelineRow) => {
    setActionsMenuRow(null);
    setSavingRows((current) => new Set(current).add(row.id));
    const result = await dismissProcessingRateLockRequest({
      id: row.id,
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
    setMessage(`Rate Lock request dismissed for ${row.loan.borrowerName}.`);
  };

  const declineLoan = async (row: ProcessingPipelineRow) => {
    const confirmed = window.confirm(
      `Decline and archive ${row.loan.borrowerName}? This removes the loan from all pipeline views.`,
    );
    if (!confirmed) return;
    setActionsMenuRow(null);
    setSavingRows((current) => new Set(current).add(row.id));
    const result = await declineProcessingPipelineLoan({
      id: row.id,
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
    setMessage(`${row.loan.borrowerName} was declined and archived.`);
  };

  const moveRow = async (
    row: ProcessingPipelineRow,
    destination: ProcessingPipelineSheet,
    notes?: string,
  ) => {
    if (destination === row.sheet || !canEditRow(row)) return false;
    let fundedAt: string | null = null;
    if (destination === ProcessingPipelineSheet.FUNDING) {
      fundedAt = window.prompt('Funded / signing date (YYYY-MM-DD):', new Date().toISOString().slice(0, 10));
      if (!fundedAt) return false;
    }
    setSavingRows((current) => new Set(current).add(row.id));
    const result = await moveProcessingPipelineLoan({
      id: row.id,
      sheet: destination,
      fundedAt,
      notes,
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
      return false;
    }
    setRows((current) => current.filter((candidate) => candidate.id !== row.id));
    setTotal((current) => Math.max(0, current - 1));
    setMessage(`Moved ${row.loan.borrowerName} to ${
      PROCESSING_PIPELINE_SHEETS.find((option) => option.value === destination)?.label
    }.`);
    return true;
  };

  const openRestructureDialog = (
    row: ProcessingPipelineRow,
    action: RestructureDialogAction,
  ) => {
    setActionsMenuRow(null);
    setRestructureDialog({ row, action });
    setRestructureNotesDraft('');
    setMessage('');
  };

  const submitRestructureDialog = async () => {
    if (!restructureDialog || !restructureNotesDraft.trim()) return;
    const { row, action } = restructureDialog;
    if (action === 'MOVE_TO_RESTRUCTURE') {
      const moved = await moveRow(
        row,
        ProcessingPipelineSheet.RESTRUCTURE,
        restructureNotesDraft.trim(),
      );
      if (!moved) return;
      setRestructureDialog(null);
      setRestructureNotesDraft('');
      return;
    }

    setSavingRows((current) => new Set(current).add(row.id));
    const result = await updateProcessingRestructureWorkflow({
      id: row.id,
      action,
      notes: restructureNotesDraft.trim(),
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
    patchRow(row.id, { ...result.patch, version: result.version });
    setRestructureDialog(null);
    setRestructureNotesDraft('');
    setMessage(
      action === 'REQUEST_ADVERSE'
        ? `${row.loan.borrowerName} is now Adverse Pending.`
        : `${row.loan.borrowerName} is now Pending Approval.`,
    );
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
    const columnId: ColumnId =
      nextSort === 'statusChangedAt' ? 'daysInStatus' : nextSort;
    setSortBy(nextSort);
    setSortDirection(direction);
    setColumnSort({ id: columnId, direction });
  };

  const editableSelect = (
    row: ProcessingPipelineRow,
    field: EditableField,
    value: string | boolean | null,
    options: ReadonlyArray<{ value: string; label: string }>,
    className = '',
  ) => canEditRow(row) && !isLockedField(row, field) ? (
    <select
      aria-label={field}
      value={value === null ? '' : String(value)}
      onChange={(event) => {
        if (
          field === 'payoffStatus' &&
          event.target.value === ProcessingItemStatus.RECEIVED
        ) {
          setPayoffExpirationDialogRow(row);
          setPayoffExpirationDraft(
            dateInputValue(row.payoffExpiresAt),
          );
          return;
        }
        if (
          field === 'pipelineStatus' &&
          event.target.value === ProcessingPipelineStatus.DOCS_OUT
        ) {
          const estimatedSigningAt = window.prompt(
            'Estimated signing date (YYYY-MM-DD):',
            dateInputValue(row.estimatedSigningAt) || todayInputValue(),
          );
          if (!estimatedSigningAt) return;
          const parsedSigningDate = new Date(
            `${estimatedSigningAt}T00:00:00.000Z`,
          );
          if (
            !/^\d{4}-\d{2}-\d{2}$/.test(estimatedSigningAt) ||
            Number.isNaN(parsedSigningDate.getTime()) ||
            parsedSigningDate.toISOString().slice(0, 10) !== estimatedSigningAt
          ) {
            window.alert('Enter a valid estimated signing date in YYYY-MM-DD format.');
            return;
          }
          void saveCell(
            row,
            field,
            event.target.value,
            { estimatedSigningAt },
          );
          return;
        }
        if (
          field === 'pipelineStatus' &&
          event.target.value === ProcessingPipelineStatus.FUNDED
        ) {
          void moveRow(row, ProcessingPipelineSheet.FUNDING);
          return;
        }
        void saveCell(row, field, event.target.value);
      }}
      className={`w-full rounded-full border px-2.5 py-1.5 text-[13px] font-semibold shadow-sm outline-none transition focus:border-blue-300 focus:ring-4 focus:ring-blue-100 ${className || 'border-slate-200 bg-white text-slate-700'}`}
    >
      {options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
    </select>
  ) : (
    <span
      className={`inline-flex max-w-full items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-bold ${className || 'border-slate-200 bg-slate-100 text-slate-600'}`}
      title={isLockedField(row, field) ? 'Automatically controlled by lender or processing method' : undefined}
    >
      {isLockedField(row, field) && <Lock className="h-3 w-3 shrink-0" aria-hidden="true" />}
      {options.find((option) => option.value === String(value))?.label || '—'}
    </span>
  );

  const textCell = (
    row: ProcessingPipelineRow,
    field: EditableField,
    value: string | null,
    placeholder = '—',
  ) => canEditRow(row) ? (
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

  const dateCell = (
    row: ProcessingPipelineRow,
    field: EditableField,
    value: string | null,
    className = '',
  ) =>
    canEditRow(row) ? (
      <input
        type="date"
        aria-label={field}
        defaultValue={dateInputValue(value)}
        onBlur={(event) => {
          if (event.target.value !== dateInputValue(value)) saveCell(row, field, event.target.value);
        }}
        className={`w-full rounded-lg border px-2 py-1.5 text-[13px] focus:outline-none focus:ring-4 focus:ring-blue-100 ${
          className || 'border-transparent bg-transparent hover:border-slate-200 hover:bg-white focus:border-blue-300 focus:bg-white'
        }`}
      />
    ) : <span className={className ? `inline-flex rounded-lg border px-2.5 py-1 font-bold ${className}` : ''}>{formatDate(value)}</span>;

  const yesNoCell = (row: ProcessingPipelineRow, field: EditableField, value: boolean | null) =>
    editableSelect(row, field, value, [
      { value: '', label: 'Select' },
      { value: 'true', label: 'Yes' },
      { value: 'false', label: 'No' },
    ], value === false ? neutralNoTone : booleanTone(value));

  const cdSentCell = (row: ProcessingPipelineRow) => {
    const overdue = isCdSentOverdue(row.cdSent, row.cdWarningStartsAt, clockNow);
    return editableSelect(
      row,
      'cdSent',
      row.cdSent,
      [
        { value: 'true', label: 'Yes' },
        { value: 'false', label: 'No' },
      ],
      overdue
        ? `${deadlineTone} motion-safe:animate-pulse`
        : row.cdSent
          ? booleanTone(true)
          : neutralNoTone,
    );
  };

  const rateLockCell = (row: ProcessingPipelineRow) => {
    const expiring = isRateLockExpiring(row.rateLock, row.rateLockExpiresAt, clockNow);
    const overdueAfterAppraisal = isRateLockOverdueAfterAppraisal(
      row.rateLock,
      row.appraisalBackAt,
      clockNow,
    );
    const warning = expiring || overdueAfterAppraisal;
    const tone = warning
      ? `${deadlineTone} motion-safe:animate-pulse`
      : row.rateLock
        ? booleanTone(true)
        : neutralNoTone;
    const locked = isLockedField(row, 'rateLock');
    if (!canEditRow(row) || locked) {
      return (
        <div className="space-y-1">
          <span
            className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-bold ${tone}`}
            title={locked ? 'Automatically controlled by lender' : undefined}
          >
            {locked && <Lock className="h-3 w-3 shrink-0" aria-hidden="true" />}
            {row.rateLock ? 'Yes' : 'No'}
          </span>
          {row.rateLockExpiresAt && (
            <p className={`text-[10px] font-bold ${warning ? 'text-red-800' : 'text-slate-500'}`}>
              Expires {formatDateOnly(row.rateLockExpiresAt)}
            </p>
          )}
          {row.rateLockRequestedAt && (
            <p className="text-[10px] font-bold text-blue-700">
              Requested {formatDate(row.rateLockRequestedAt)}
            </p>
          )}
        </div>
      );
    }
    return (
      <div className="space-y-1 rounded-lg">
        <select
          aria-label="Rate Lock"
          value={
            rateLockDialogRow?.id === row.id
              ? 'true'
              : String(row.rateLock)
          }
          onChange={(event) => {
            if (event.target.value === 'true') {
              event.currentTarget.blur();
              openRateLockCalendar(row);
            }
            else void saveRateLock(row, false, null);
          }}
          className={`w-full rounded-full border px-2.5 py-1.5 text-[13px] font-semibold shadow-sm outline-none focus:ring-4 focus:ring-blue-100 ${tone}`}
        >
          <option value="false">No</option>
          <option value="true">Yes</option>
        </select>
        {row.rateLock && (
          <button
            type="button"
            onClick={() => openRateLockCalendar(row)}
            className={`block w-full rounded-md px-1 py-0.5 text-left text-[10px] font-bold underline-offset-2 hover:underline ${
              warning ? 'text-red-900' : 'text-slate-600'
            }`}
          >
            Expires {formatDateOnly(row.rateLockExpiresAt)}
          </button>
        )}
        {row.rateLockRequestedAt && (
          <p className="px-1 text-[10px] font-bold text-blue-700">
            Requested {formatDate(row.rateLockRequestedAt)}
          </p>
        )}
      </div>
    );
  };

  const cellPadding = 'px-3 py-3';
  const renderHeader = (column: (typeof currentColumns)[number]) => {
    const id = column.id;
    const sortableBy =
      id === 'dateAssigned'
        ? 'dateAssigned'
        : id === 'loanNumber'
          ? 'loanNumber'
          : id === 'borrowerName'
            ? 'borrowerName'
            : id === 'daysInStatus'
              ? 'statusChangedAt'
              : null;
    const width = detailsExpanded
      ? columnWidths[id] || column.width
      : column.width;
    return (
      <ResizableHeader
        key={id}
        id={id}
        width={width}
        onResize={resizeColumn}
        stickyLeft={stickyLeftByColumn.get(id)}
        className={
          id === 'actions' && actionsPinnedRight
            ? 'lg:sticky lg:right-0 lg:z-30 lg:shadow-[-1px_0_0_#e2e8f0]'
            : id === 'borrowerLastName'
              ? 'shadow-[1px_0_0_#cbd5e1]'
              : ''
        }
      >
        {sortableBy ? (
          <button
            type="button"
            onClick={() => changeSort(sortableBy)}
            className="w-full text-left hover:text-blue-700"
          >
            {column.label}
          </button>
        ) : (
          column.label
        )}
      </ResizableHeader>
    );
  };

  const renderCell = (
    row: ProcessingPipelineRow,
    id: ColumnId,
    overdue: {
      title: boolean;
      payoff: boolean;
      hoi: boolean;
      appraisalBack: boolean;
    },
  ) => {
    const resultBucketLabel = row.rateLockRequestedAt
      ? 'Rate Lock'
      : row.sheet === ProcessingPipelineSheet.RESTRUCTURE
        ? 'Restructure'
        : row.sheet === ProcessingPipelineSheet.FUNDING
          ? 'Funding'
          : 'Pipeline';
    switch (id) {
      case 'dateAssigned':
        return (
          <td
            key={id}
            style={{ left: stickyLeftByColumn.get(id) }}
            className={`truncate border-b border-r border-slate-200 font-medium text-slate-600 lg:sticky lg:z-10 ${cellPadding} ${stickyRowSurfaceTone[row.pipelineStatus]}`}
          >
            {formatDate(row.dateAssigned)}
          </td>
        );
      case 'loanNumber':
        return (
          <td
            key={id}
            style={{ left: stickyLeftByColumn.get(id) }}
            className={`border-b border-r border-slate-200 font-mono text-[12px] font-semibold text-slate-700 lg:sticky lg:z-10 ${cellPadding} ${stickyRowSurfaceTone[row.pipelineStatus]}`}
          >
            <span className="block truncate">{row.loan.loanNumber}</span>
            {search.trim() && (
              <span className="mt-1 inline-flex max-w-full truncate rounded-full border border-blue-200 bg-blue-50 px-1.5 py-0.5 font-sans text-[9px] font-bold uppercase tracking-wide text-blue-700">
                {resultBucketLabel}
              </span>
            )}
          </td>
        );
      case 'loanOfficer':
        return (
          <td
            key={id}
            style={{ left: stickyLeftByColumn.get(id) }}
            className={`truncate border-b border-r border-slate-200 font-semibold text-slate-900 lg:sticky lg:z-10 ${cellPadding} ${stickyRowSurfaceTone[row.pipelineStatus]}`}
            title={row.loan.loanOfficer.name}
          >
            {row.loan.loanOfficer.name}
          </td>
        );
      case 'borrowerFirstName':
        return (
          <td
            key={id}
            style={{ left: stickyLeftByColumn.get(id) }}
            className={`truncate border-b border-r border-slate-200 font-bold text-slate-950 lg:sticky lg:z-10 ${cellPadding} ${stickyRowSurfaceTone[row.pipelineStatus]}`}
            title={row.loan.borrowerFirstName}
          >
            <button
              type="button"
              onClick={() => setBorrowerWorkspaceRowId(row.id)}
              className="max-w-full truncate text-left font-bold text-blue-800 underline decoration-blue-300 decoration-1 underline-offset-2 transition hover:text-blue-950 hover:decoration-blue-600 focus-visible:rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-300"
              aria-label={`Open borrower workspace for ${row.loan.borrowerName}`}
            >
              {row.loan.borrowerFirstName || '—'}
            </button>
          </td>
        );
      case 'borrowerLastName':
        return (
          <td
            key={id}
            style={{ left: stickyLeftByColumn.get(id) }}
            className={`truncate border-b border-r border-slate-200 font-bold text-slate-950 lg:sticky lg:z-10 lg:shadow-[1px_0_0_#cbd5e1] ${cellPadding} ${stickyRowSurfaceTone[row.pipelineStatus]}`}
            title={row.loan.borrowerLastName || undefined}
          >
            <button
              type="button"
              onClick={() => setBorrowerWorkspaceRowId(row.id)}
              className="max-w-full truncate text-left font-bold text-blue-800 underline decoration-blue-300 decoration-1 underline-offset-2 transition hover:text-blue-950 hover:decoration-blue-600 focus-visible:rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-300"
              aria-label={`Open borrower workspace for ${row.loan.borrowerName}`}
            >
              {row.loan.borrowerLastName || '—'}
            </button>
          </td>
        );
      case 'borrowerName':
        return (
          <td
            key={id}
            style={{ left: stickyLeftByColumn.get(id) }}
            className={`truncate border-b border-r border-slate-200 font-bold text-slate-950 lg:sticky lg:z-10 lg:shadow-[1px_0_0_#cbd5e1] ${cellPadding} ${stickyRowSurfaceTone[row.pipelineStatus]}`}
            title={row.loan.borrowerName}
          >
            <button
              type="button"
              onClick={() => setBorrowerWorkspaceRowId(row.id)}
              className="max-w-full truncate text-left font-bold text-blue-800 underline decoration-blue-300 decoration-1 underline-offset-2 transition hover:text-blue-950 hover:decoration-blue-600 focus-visible:rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-300"
              aria-label={`Open borrower workspace for ${row.loan.borrowerName}`}
            >
              {row.loan.borrowerName}
            </button>
          </td>
        );
      case 'leadSource':
        return (
          <td
            key={id}
            className={`truncate border-b border-r border-slate-200 ${cellPadding}`}
            title={row.leadSource || undefined}
          >
            {row.leadSource || '—'}
          </td>
        );
      case 'propertyState':
        return (
          <td key={id} className="border-b border-r border-slate-200 px-1.5 py-1">
            {sheet === ProcessingPipelineSheet.FUNDING ? (
              <span className="block px-2 py-1.5">{row.propertyState || '—'}</span>
            ) : (
              textCell(row, 'propertyState', row.propertyState)
            )}
          </td>
        );
      case 'lender':
        return sheet === ProcessingPipelineSheet.FUNDING ? (
          <td
            key={id}
            className={`truncate border-b border-r border-slate-200 ${cellPadding}`}
            title={row.lender || undefined}
          >
            {row.lender || '—'}
          </td>
        ) : (
          <td key={id} className="border-b border-r border-slate-200 px-1.5 py-1">
            {textCell(row, 'lender', row.lender)}
          </td>
        );
      case 'loanAmount':
        return (
          <td
            key={id}
            className={`truncate border-b border-r border-slate-200 font-semibold tabular-nums text-slate-700 ${cellPadding}`}
          >
            {formatMoney(row.loan.amount)}
          </td>
        );
      case 'loanType':
        return (
          <td
            key={id}
            className={`truncate border-b border-r border-slate-200 ${cellPadding}`}
            title={row.loanType || undefined}
          >
            {row.loanType || '—'}
          </td>
        );
      case 'juniorProcessor':
        return (
          <td
            key={id}
            className={`border-b border-r border-slate-200 ${cellPadding}`}
          >
            {juniorProcessorEditorRowId === row.id &&
            isManagerOrAdmin &&
            row.sheet !== ProcessingPipelineSheet.FUNDING ? (
              <select
                autoFocus
                value={row.juniorProcessor?.id || ''}
                onBlur={() => setJuniorProcessorEditorRowId(null)}
                onChange={(event) =>
                  void reassignJuniorProcessor(row, event.target.value || null)
                }
                disabled={savingRows.has(row.id)}
                aria-label={`Reassign Jr Processor for ${row.loan.borrowerName}`}
                className="app-input h-8 w-full min-w-0 rounded-lg px-2 py-1 text-xs font-semibold"
              >
                <option value="">Unassigned</option>
                {initialData.juniorProcessorOptions.map((processor) => (
                  <option key={processor.id} value={processor.id}>
                    {processor.name}
                  </option>
                ))}
              </select>
            ) : (
              <div className="flex min-w-0 items-center gap-1.5">
                <span
                  className="min-w-0 flex-1 truncate"
                  title={row.juniorProcessor?.name || 'Unassigned'}
                >
                  {row.juniorProcessor?.name || '—'}
                </span>
                {isManagerOrAdmin &&
                  row.sheet !== ProcessingPipelineSheet.FUNDING && (
                    <button
                      type="button"
                      onClick={() => setJuniorProcessorEditorRowId(row.id)}
                      disabled={savingRows.has(row.id)}
                      aria-label={`Edit Jr Processor for ${row.loan.borrowerName}`}
                      title="Reassign Jr Processor"
                      className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-500 transition hover:border-blue-300 hover:bg-blue-50 hover:text-blue-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-300 disabled:cursor-wait disabled:opacity-60"
                    >
                      {savingRows.has(row.id) ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Pencil className="h-3.5 w-3.5" />
                      )}
                    </button>
                  )}
              </div>
            )}
          </td>
        );
      case 'seniorProcessor':
        return (
          <td
            key={id}
            className={`truncate border-b border-r border-slate-200 font-semibold text-slate-800 ${cellPadding}`}
            title={processorLabel(row)}
          >
            {processorLabel(row)}
          </td>
        );
      case 'pipelineStatus':
        return (
          <td key={id} className="border-b border-r border-slate-200 px-1.5 py-1">
            {canEditRow(row) && row.sheet !== ProcessingPipelineSheet.RESTRUCTURE ? (
              editableSelect(
                row,
                'pipelineStatus',
                row.pipelineStatus,
                statusOptions,
                statusTone[row.pipelineStatus],
              )
            ) : (
              <span
                className={`inline-flex max-w-full truncate rounded-full border px-2.5 py-1 text-xs font-bold ${statusTone[row.pipelineStatus]}`}
              >
                {
                  PROCESSING_PIPELINE_STATUS_OPTIONS.find(
                    (option) => option.value === row.pipelineStatus,
                  )?.label
                }
              </span>
            )}
          </td>
        );
      case 'missingItemsCurrentStatus':
        return (
          <td key={id} className="border-b border-r border-slate-200 px-1.5 py-1">
            {textCell(
              row,
              'missingItemsCurrentStatus',
              row.missingItemsCurrentStatus,
            )}
          </td>
        );
      case 'restructureNotes':
        return (
          <td key={id} className="border-b border-r border-slate-200 px-3 py-2 align-top">
            <div
              className="max-h-24 overflow-y-auto whitespace-pre-wrap text-xs font-medium leading-5 text-slate-700"
              title={row.restructureNotes || 'No restructure notes'}
            >
              {row.restructureNotes || '—'}
            </div>
          </td>
        );
      case 'titleStatus':
        return (
          <td
            key={id}
            className={`border-b border-r border-slate-200 px-1.5 py-1 ${overdue.title ? 'bg-red-100' : ''}`}
          >
            {editableSelect(
              row,
              'titleStatus',
              row.titleStatus,
              PROCESSING_ITEM_STATUS_OPTIONS,
              overdue.title ? deadlineTone : itemStatusTone[row.titleStatus],
            )}
          </td>
        );
      case 'payoffStatus':
        return (
          <td
            key={id}
            className={`border-b border-r border-slate-200 px-1.5 py-1 ${overdue.payoff ? 'bg-red-100' : ''}`}
          >
            {editableSelect(
              row,
              'payoffStatus',
              row.payoffStatus,
              PROCESSING_ITEM_STATUS_OPTIONS,
              overdue.payoff
                ? `${deadlineTone} motion-safe:animate-pulse`
                : itemStatusTone[row.payoffStatus],
            )}
          </td>
        );
      case 'payoffExpiresAt': {
        const warning = getPayoffExpirationWarning(
          row.payoffStatus,
          row.payoffExpiresAt,
          clockNow,
        );
        const warningTone =
          warning === 'danger'
            ? 'border-red-300 bg-red-100 text-red-800 motion-safe:animate-pulse'
            : warning === 'warning'
              ? 'border-amber-300 bg-amber-100 text-amber-900 motion-safe:animate-pulse'
              : '';
        return (
          <td
            key={id}
            className={`border-b border-r border-slate-200 ${cellPadding}`}
          >
            {row.payoffStatus !== ProcessingItemStatus.RECEIVED ||
            isLockedField(row, 'payoffExpiresAt') ? (
              <span
                className="text-slate-400"
                title={
                  isLockedField(row, 'payoffExpiresAt')
                    ? 'Not required for this locked payoff status'
                    : undefined
                }
              >
                —
              </span>
            ) : (
              dateCell(
                row,
                'payoffExpiresAt',
                row.payoffExpiresAt,
                warningTone,
              )
            )}
          </td>
        );
      }
      case 'hoiStatus':
        return (
          <td
            key={id}
            className={`border-b border-r border-slate-200 px-1.5 py-1 ${overdue.hoi ? 'bg-red-100' : ''}`}
          >
            {editableSelect(
              row,
              'hoiStatus',
              row.hoiStatus,
              PROCESSING_ITEM_STATUS_OPTIONS,
              overdue.hoi
                ? `${deadlineTone} motion-safe:animate-pulse`
                : itemStatusTone[row.hoiStatus],
            )}
          </td>
        );
      case 'appraisalNeeded':
        return (
          <td key={id} className="border-b border-r border-slate-200 px-1.5 py-1">
            {yesNoCell(row, 'appraisalNeeded', row.appraisalNeeded)}
          </td>
        );
      case 'appraisalNotes':
        return (
          <td key={id} className="border-b border-r border-slate-200 px-1.5 py-1">
            {textCell(row, 'appraisalNotes', row.appraisalNotes)}
          </td>
        );
      case 'appraisalOrderedAt':
        return (
          <td key={id} className="border-b border-r border-slate-200 px-1.5 py-1">
            {dateCell(row, 'appraisalOrderedAt', row.appraisalOrderedAt)}
          </td>
        );
      case 'appraisalBackAt':
        return (
          <td
            key={id}
            className={`border-b border-r border-slate-200 px-1.5 py-1 ${overdue.appraisalBack ? 'bg-red-100' : ''}`}
          >
            {dateCell(
              row,
              'appraisalBackAt',
              row.appraisalBackAt,
              overdue.appraisalBack ? deadlineTone : '',
            )}
          </td>
        );
      case 'cdSent':
        return (
          <td
            key={id}
            className={`border-b border-r border-slate-200 px-1.5 py-1 ${
              isCdSentOverdue(row.cdSent, row.cdWarningStartsAt, clockNow)
                ? 'bg-red-100'
                : ''
            }`}
          >
            {cdSentCell(row)}
          </td>
        );
      case 'estimatedSigningAt':
        return (
          <td key={id} className="border-b border-r border-slate-200 px-1.5 py-1">
            {dateCell(row, 'estimatedSigningAt', row.estimatedSigningAt)}
          </td>
        );
      case 'extraNotes':
        return (
          <td key={id} className="border-b border-r border-slate-200 px-1.5 py-1">
            {textCell(row, 'extraNotes', row.extraNotes)}
          </td>
        );
      case 'rateLock':
        return (
          <td
            key={id}
            className={`border-b border-r border-slate-200 px-1.5 py-1 ${
              isRateLockExpiring(row.rateLock, row.rateLockExpiresAt, clockNow) ||
              isRateLockOverdueAfterAppraisal(
                row.rateLock,
                row.appraisalBackAt,
                clockNow,
              )
                ? 'bg-red-100'
                : ''
            }`}
          >
            {rateLockCell(row)}
          </td>
        );
      case 'daysInStatus':
        return (
          <td
            key={id}
            className={`border-b border-r border-slate-200 text-center ${cellPadding}`}
          >
            <span
              className={`inline-flex min-w-8 justify-center rounded-full px-2 py-1 text-xs font-bold ${
                row.daysInStatus > 7
                  ? 'bg-amber-100 text-amber-800'
                  : 'bg-slate-100 text-slate-700'
              }`}
            >
              {row.daysInStatus}
            </span>
          </td>
        );
      case 'projectedRevenue':
        return (
          <td
            key={id}
            className={`border-b border-r border-slate-200 font-semibold tabular-nums text-slate-700 ${cellPadding}`}
          >
            {formatMoney(row.projectedRevenue)}
          </td>
        );
      case 'fundedAt':
        return (
          <td key={id} className={`border-b border-r border-slate-200 ${cellPadding}`}>
            {formatDate(row.fundedAt)}
          </td>
        );
      case 'finalRevenue':
        return (
          <td
            key={id}
            className={`border-b border-r border-slate-200 font-semibold ${cellPadding}`}
          >
            <div className="flex items-center justify-between gap-2">
              {canEditRow(row) ? (
                <label className="flex min-w-0 flex-1 items-center rounded-lg border border-transparent bg-transparent px-2 py-1 hover:border-slate-200 hover:bg-white focus-within:border-blue-300 focus-within:bg-white focus-within:ring-4 focus-within:ring-blue-100">
                  <span className="shrink-0 text-xs text-slate-500">$</span>
                  <input
                    key={`${row.id}-${row.version}-finalRevenue`}
                    type="number"
                    min="0"
                    step="0.01"
                    aria-label={`Final Revenue for ${row.loan.borrowerName}`}
                    defaultValue={
                      row.finalRevenue === null ? '' : String(row.finalRevenue)
                    }
                    onBlur={(event) => {
                      const currentValue =
                        row.finalRevenue === null ? '' : String(row.finalRevenue);
                      if (event.target.value !== currentValue) {
                        void saveCell(
                          row,
                          'finalRevenue',
                          event.target.value,
                        );
                      }
                    }}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') event.currentTarget.blur();
                    }}
                    className="min-w-0 flex-1 bg-transparent pl-1 text-[13px] font-semibold tabular-nums outline-none"
                    placeholder="0.00"
                  />
                </label>
              ) : (
                <span className="tabular-nums">
                  {formatMoney(row.finalRevenue)}
                </span>
              )}
              <span
                className={`inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full border ${
                  row.payrollSubmitted
                    ? 'border-emerald-300 bg-emerald-100 text-emerald-700'
                    : 'border-red-300 bg-red-100 text-red-700'
                }`}
                aria-label={
                  row.payrollSubmitted
                    ? `Payroll request submitted: ${row.payrollStatus?.replaceAll('_', ' ') || 'Submitted'}`
                    : 'Payroll request not submitted'
                }
                title={
                  row.payrollSubmitted
                    ? `Payroll request: ${row.payrollStatus?.replaceAll('_', ' ') || 'Submitted'}`
                    : 'Payroll request has not been submitted'
                }
              >
                {row.payrollSubmitted ? (
                  <Check className="h-3.5 w-3.5" aria-hidden="true" />
                ) : (
                  <X className="h-3.5 w-3.5" aria-hidden="true" />
                )}
              </span>
            </div>
          </td>
        );
      case 'firstPaymentAt':
        return (
          <td key={id} className={`border-b border-r border-slate-200 ${cellPadding}`}>
            {formatDate(row.firstPaymentAt)}
          </td>
        );
      case 'sixthPaymentAt':
        return (
          <td key={id} className={`border-b border-r border-slate-200 ${cellPadding}`}>
            {formatDate(row.sixthPaymentAt)}
          </td>
        );
      case 'actions':
        return (
          <td
            key={id}
            className={`border-b border-slate-200 px-2 py-2 ${
              actionsPinnedRight
                ? 'lg:sticky lg:right-0 lg:z-20 lg:shadow-[-1px_0_0_#e2e8f0]'
                : ''
            } ${stickyRowSurfaceTone[row.pipelineStatus]}`}
          >
            <div className="flex items-center justify-end gap-1.5">
              {savingRows.has(row.id) && (
                <Loader2
                  className="h-4 w-4 animate-spin text-blue-600"
                  aria-label="Saving"
                />
              )}
              <button
                type="button"
                onClick={() => setActionsMenuRow(row)}
                className="inline-flex w-full items-center justify-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-700 shadow-sm transition hover:border-blue-200 hover:bg-blue-50 hover:text-blue-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-300"
                aria-label={`Open actions for ${row.loan.borrowerName}`}
              >
                <MoreHorizontal className="h-4 w-4" />
                Actions
              </button>
            </div>
          </td>
        );
    }
  };

  return (
    <section className="space-y-5">
      <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm shadow-slate-200/60">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
          <div
            className="inline-flex w-fit rounded-xl border border-slate-200 bg-slate-50 p-1"
            role="tablist"
            aria-label="Processing pipeline sheets"
          >
            {pipelineViews.map((option) => (
              <button
                key={option.value}
                type="button"
                role="tab"
                aria-selected={sheet === option.value}
                onClick={() => {
                  const nextFilters =
                    option.value === ProcessingPipelineSheet.FUNDING
                      ? fundingMonthFilters(0)
                      : {};
                  setSheet(option.value);
                  if (option.value === ProcessingPipelineSheet.FUNDING) {
                    setFundingRangePreset('currentMonth');
                  }
                  setDetailsExpanded(false);
                  setSelectedTeamIds([]);
                  setColumnFilters({});
                  setColumnSort(null);
                  setColumnMenu(null);
                  setDraftFilters(nextFilters);
                  setAppliedFilters(nextFilters);
                  loadRows(
                    option.value,
                    search,
                    sortBy,
                    sortDirection,
                    nextFilters,
                  );
                }}
                className={`rounded-lg px-4 py-2 text-sm font-bold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-300 ${
                  sheet === option.value
                    ? 'bg-white text-slate-950 shadow-sm ring-1 ring-slate-200'
                    : 'text-slate-500 hover:bg-white/70 hover:text-slate-800'
                }`}
              >
                <span className="inline-flex items-center gap-2">
                  {isPending && sheet === option.value && (
                    <Loader2 className="h-3.5 w-3.5 animate-spin text-blue-600" aria-hidden="true" />
                  )}
                  {option.label}
                </span>
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
                placeholder="Search all buckets by borrower, Arive #, processor or lender"
                aria-describedby="processing-search-scope"
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
        <p
          id="processing-search-scope"
          className={`mt-2 text-xs font-semibold ${
            search.trim() ? 'text-blue-700' : 'sr-only'
          }`}
          role={search.trim() ? 'status' : undefined}
        >
          Search results include Pipeline, Restructures, Rate Lock Requests, and
          Fundings. Each result is labeled with its bucket.
        </p>
      </div>

      <div className="relative z-20 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-end">
          {sheet === ProcessingPipelineSheet.FUNDING && (
            <div
              className="inline-flex w-fit flex-wrap rounded-xl border border-slate-200 bg-slate-50 p-1"
              aria-label="Funding month range"
            >
              {[
                { value: 'currentMonth' as const, label: 'Current Month' },
                { value: 'lastMonth' as const, label: 'Previous Month' },
                { value: 'allFundings' as const, label: 'All Fundings' },
                { value: 'dateRange' as const, label: 'Date Range' },
              ].map((option) => (
                <button
                  key={option.value}
                  type="button"
                  aria-pressed={fundingRangePreset === option.value}
                  onClick={() => {
                    if (option.value === 'dateRange') {
                      setFundingRangePreset('dateRange');
                      setFiltersExpanded(true);
                      return;
                    }
                    selectFundingRange(option.value);
                  }}
                  className={`rounded-lg px-3 py-1.5 text-xs font-bold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-300 ${
                    fundingRangePreset === option.value
                      ? 'bg-white text-blue-700 shadow-sm ring-1 ring-slate-200'
                      : 'text-slate-500 hover:bg-white/70 hover:text-slate-800'
                  }`}
                >
                  {option.label}
                </button>
              ))}
            </div>
          )}
          <button
            type="button"
            aria-expanded={filtersExpanded}
            aria-pressed={
              sheet === ProcessingPipelineSheet.FUNDING
                ? filtersExpanded
                : undefined
            }
            onClick={() => setFiltersExpanded((expanded) => !expanded)}
            className={`flex h-10 items-center gap-2 rounded-xl border px-3 text-sm font-bold shadow-sm transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-300 ${
              filtersExpanded ||
              (sheet === ProcessingPipelineSheet.FUNDING
                ? false
                : activeFilterCount > 0)
                ? 'border-blue-300 bg-blue-50 text-blue-700'
                : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
            }`}
          >
            <Filter className="h-4 w-4" />
            Filters
            {activeFilterCount > 0 &&
              (sheet !== ProcessingPipelineSheet.FUNDING ||
                fundingRangePreset === 'dateRange') && (
              <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-blue-600 px-1 text-[10px] font-black text-white">
                {activeFilterCount}
              </span>
            )}
          </button>
          {canFilterByTeam && initialData.teams.length > 0 && (
            <div className="flex min-w-0 flex-1 items-center gap-2 overflow-x-auto whitespace-nowrap [scrollbar-width:thin]">
              <div className="mr-1 flex shrink-0 items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-slate-500">
                <Users2 className="h-3.5 w-3.5" />
                Teams
              </div>
              <button
                type="button"
                aria-pressed={selectedTeamIds.length === 0}
                onClick={() => selectTeam(null)}
                className={`inline-flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-300 ${
                  selectedTeamIds.length === 0
                    ? 'border-slate-300 bg-slate-100 text-slate-800 ring-1 ring-slate-300'
                    : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
                }`}
              >
                All
              </button>
              {initialData.teams.map((team) => {
                const accent = team.colors?.[0] ?? team.color;
                const classes = teamColorClasses(accent);
                const isActive = selectedTeamIds.includes(team.id);
                return (
                  <button
                    key={team.id}
                    type="button"
                    aria-pressed={isActive}
                    onClick={() => selectTeam(team.id)}
                    className={`inline-flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-300 ${
                      isActive ? classes.chipActive : classes.chipInactive
                    } ${isActive ? `ring-1 ${classes.ring}` : ''}`}
                    title={isActive ? `Remove ${team.name}` : `Add ${team.name}`}
                  >
                    {renderTeamDots(team.colors ?? [accent])}
                    <span className="max-w-[150px] truncate">{team.name}</span>
                    <span className="text-[10px] font-semibold tabular-nums opacity-70">
                      {team.memberCount}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
          {activeFilterCount > 0 &&
            (sheet !== ProcessingPipelineSheet.FUNDING ||
              fundingRangePreset === 'dateRange') && (
            <button
              type="button"
              onClick={clearFilters}
              className="flex h-10 items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 text-sm font-bold text-slate-600 shadow-sm transition hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-300"
            >
              <X className="h-4 w-4" />
              Clear
            </button>
          )}
          <div className="flex max-w-full items-center gap-2 overflow-x-auto lg:ml-auto">
            {layouts.map((layout) => (
              <button
                key={layout.id}
                type="button"
                aria-pressed={layout.isActive}
                disabled={activatingLayoutId !== null}
                onClick={() => selectSavedLayout(layout.id)}
                className={`inline-flex h-10 shrink-0 items-center gap-2 rounded-xl border px-3 text-xs font-bold shadow-sm transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-300 ${
                  layout.isActive
                    ? 'border-blue-300 bg-blue-50 text-blue-700'
                    : 'border-slate-200 bg-white text-slate-600 hover:border-blue-200 hover:bg-blue-50/50 hover:text-blue-700'
                }`}
              >
                {activatingLayoutId === layout.id ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : layout.isActive ? (
                  <Check className="h-3.5 w-3.5" />
                ) : null}
                {layout.name}
              </button>
            ))}
            <button
              type="button"
              onClick={() => setLayoutManagerOpen(true)}
              className="inline-flex h-10 shrink-0 items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 text-sm font-bold text-slate-700 shadow-sm transition hover:border-blue-200 hover:bg-blue-50 hover:text-blue-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-300"
            >
              <LayoutTemplate className="h-4 w-4 text-blue-600" />
              Views &amp; Layouts
            </button>
          </div>
          <button
            type="button"
            aria-pressed={detailsExpanded}
            onClick={() => setDetailsExpanded((expanded) => !expanded)}
            className={`flex h-10 shrink-0 items-center gap-2 rounded-xl border px-3 text-sm font-bold shadow-sm transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-300 ${
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
            {canEdit ? (isLoanOfficer ? 'Eligible loans editable' : 'Autosave on') : 'Read-only'}
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
                  <MultiSelectFilter label="Arive Numbers" values={draftFilters.loanNumbers || []} options={filterOptions.loanNumbers} onChange={(values) => setDraftFilter('loanNumbers', values)} />
                  <MultiSelectFilter label="Borrowers" values={draftFilters.borrowerNames || []} options={filterOptions.borrowerNames} onChange={(values) => setDraftFilter('borrowerNames', values)} />
                  <FilterInput label="Loan Amount Min" type="number" value={draftFilters.loanAmountMin} onChange={(value) => setDraftFilter('loanAmountMin', value === '' ? undefined : Number(value))} placeholder="0" />
                  <FilterInput label="Loan Amount Max" type="number" value={draftFilters.loanAmountMax} onChange={(value) => setDraftFilter('loanAmountMax', value === '' ? undefined : Number(value))} placeholder="1000000" />
                  <MultiSelectFilter label="Loan Types" values={draftFilters.loanTypes || []} options={filterOptions.loanTypes} onChange={(values) => setDraftFilter('loanTypes', values)} />
                  <MultiSelectFilter label="Lenders" values={draftFilters.lenders || []} options={filterOptions.lenders} onChange={(values) => setDraftFilter('lenders', values)} />
                  {!isProcessor && (
                    <MultiSelectFilter label="Lead Sources" values={draftFilters.leadSources || []} options={filterOptions.leadSources} onChange={(values) => setDraftFilter('leadSources', values)} />
                  )}
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
                      options={statusOptions.map((option) => ({ value: option.value, label: option.label }))}
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
                    <MultiSelectFilter
                      label="CD Sent"
                      values={draftFilters.cdSent || []}
                      options={YES_NO_FILTER_OPTIONS.filter((option) => option.value !== 'BLANK')}
                      onChange={(values) => setDraftFilter('cdSent', values as Array<'YES' | 'NO'>)}
                    />
                    <FilterInput label="Est. Signing From" type="date" value={draftFilters.estimatedSigningFrom} onChange={(value) => setDraftFilter('estimatedSigningFrom', value || undefined)} />
                    <FilterInput label="Est. Signing To" type="date" value={draftFilters.estimatedSigningTo} onChange={(value) => setDraftFilter('estimatedSigningTo', value || undefined)} />
                    <FilterInput label="Pending Items" value={draftFilters.missingItemsCurrentStatus} onChange={(value) => setDraftFilter('missingItemsCurrentStatus', value || undefined)} placeholder="Contains text…" />
                    <FilterInput label="Extra Notes" value={draftFilters.extraNotes} onChange={(value) => setDraftFilter('extraNotes', value || undefined)} placeholder="Contains text…" />
                    {(sheet === ProcessingPipelineSheet.RESTRUCTURE ||
                      isRateLockRequestsView) && (
                      <FilterInput label="Restructure Notes" value={draftFilters.restructureNotes} onChange={(value) => setDraftFilter('restructureNotes', value || undefined)} placeholder="Contains text…" />
                    )}
                    <FilterInput label="Revenue Min" type="number" value={draftFilters.projectedRevenueMin} onChange={(value) => setDraftFilter('projectedRevenueMin', value === '' ? undefined : Number(value))} placeholder="0" />
                    <FilterInput label="Revenue Max" type="number" value={draftFilters.projectedRevenueMax} onChange={(value) => setDraftFilter('projectedRevenueMax', value === '' ? undefined : Number(value))} placeholder="10000" />
                    <MultiSelectFilter
                      label="Rate Lock"
                      values={draftFilters.rateLock || []}
                      options={YES_NO_FILTER_OPTIONS}
                      onChange={(values) => setDraftFilter('rateLock', values as Array<'YES' | 'NO' | 'BLANK'>)}
                    />
                    <FilterInput label="Rate Lock Expires From" type="date" value={draftFilters.rateLockExpiresFrom} onChange={(value) => setDraftFilter('rateLockExpiresFrom', value || undefined)} />
                    <FilterInput label="Rate Lock Expires To" type="date" value={draftFilters.rateLockExpiresTo} onChange={(value) => setDraftFilter('rateLockExpiresTo', value || undefined)} />
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
              {activeViewLabel}
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
              {statusOptions.map((option) => {
                const selected = appliedFilters.pipelineStatuses?.includes(option.value) || false;
                return (
                  <button
                    key={option.value}
                    type="button"
                    aria-pressed={selected}
                    onClick={() => toggleQuickStatus(option.value)}
                    className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1.5 text-[11px] font-bold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-300 ${statusTone[option.value]} ${
                      selected
                        ? 'ring-2 ring-blue-400 ring-offset-1 shadow-sm'
                        : 'opacity-75 hover:opacity-100'
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
        <div className="relative min-h-72">
          {isPending && (
            <div
              className="absolute inset-0 z-[60] flex min-h-72 cursor-wait items-center justify-center bg-white/75 px-6 backdrop-blur-[2px]"
              role="status"
              aria-live="polite"
              aria-label={`Loading ${activeViewLabel}`}
            >
              <div className="flex max-w-sm flex-col items-center rounded-2xl border border-blue-100 bg-white px-8 py-6 text-center shadow-xl shadow-slate-300/40">
                <div className="flex h-12 w-12 items-center justify-center rounded-full bg-blue-50 ring-1 ring-blue-100">
                  <Loader2 className="h-7 w-7 animate-spin text-blue-600" aria-hidden="true" />
                </div>
                <p className="mt-4 text-sm font-black text-slate-950">
                  Loading {activeViewLabel}…
                </p>
                <p className="mt-1 text-xs font-medium text-slate-500">
                  Please wait while the pipeline list refreshes.
                </p>
              </div>
            </div>
          )}
          <div
            ref={scrollContainerRef}
            className="relative max-h-[66vh] min-h-72 overflow-auto"
            aria-busy={isPending}
          >
            <ColumnMenuContext.Provider value={columnMenuContextValue}>
            <table
              className="border-separate border-spacing-0 text-left text-[13px] leading-5 text-slate-700"
              style={{ width: Math.max(tableWidth, 720), tableLayout: 'fixed' }}
              aria-rowcount={visibleRows.length + 1}
            >
            <thead className="sticky top-0 z-30">
              <tr>
                {currentColumns.map(renderHeader)}
              </tr>
            </thead>
            <tbody>
              {virtualPaddingTop > 0 && (
                <tr aria-hidden="true">
                  <td
                    colSpan={visibleColumnCount}
                    className="border-0 p-0"
                    style={{ height: virtualPaddingTop }}
                  />
                </tr>
              )}
              {virtualRows.map((virtualRow) => {
                const row = visibleRows[virtualRow.index];
                const titleOverdue = isConditionItemOverdue(
                  row.approvedWithConditionsAt,
                  row.titleStatus,
                  clockNow,
                );
                const payoffOverdue = isConditionItemOverdue(
                  row.approvedWithConditionsAt,
                  row.payoffStatus,
                  clockNow,
                ) || isOrderedItemOverdue(row.payoffOrderedAt, row.payoffStatus, clockNow);
                const hoiOverdue = isOrderedItemOverdue(
                  row.hoiOrderedAt,
                  row.hoiStatus,
                  clockNow,
                );
                const appraisalBackOverdue = isAppraisalBackOverdue(
                  row.appraisalOrderedAt,
                  row.appraisalBackAt,
                  clockNow,
                );
                return (
                <tr
                  key={row.id}
                  ref={rowVirtualizer.measureElement}
                  data-index={virtualRow.index}
                  aria-rowindex={virtualRow.index + 2}
                  className={`group transition-colors ${rowSurfaceTone[row.pipelineStatus]}`}
                >
                  {currentColumns.map((column) =>
                    renderCell(row, column.id, {
                      title: titleOverdue,
                      payoff: payoffOverdue,
                      hoi: hoiOverdue,
                      appraisalBack: appraisalBackOverdue,
                    }),
                  )}
                </tr>
                );
              })}
              {virtualPaddingBottom > 0 && (
                <tr aria-hidden="true">
                  <td
                    colSpan={visibleColumnCount}
                    className="border-0 p-0"
                    style={{ height: virtualPaddingBottom }}
                  />
                </tr>
              )}
              {visibleRows.length === 0 && (
                <tr>
                  <td colSpan={visibleColumnCount} className="px-6 py-16 text-center text-sm font-medium text-slate-500">
                    {isPending ? 'Loading pipeline…' : 'No loans match this view.'}
                  </td>
                </tr>
              )}
            </tbody>
            </table>
            </ColumnMenuContext.Provider>
          </div>
        </div>
        {columnMenu && (
          <div
            data-column-menu-panel
            role="dialog"
            aria-label={`Sort and filter ${activeColumnLabel}`}
            className="fixed z-[90] w-80 rounded-2xl border border-slate-200 bg-white p-4 shadow-2xl shadow-slate-400/30"
            style={{ left: columnMenu.left, top: columnMenu.top }}
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-[10px] font-black uppercase tracking-[0.12em] text-blue-600">
                  Column options
                </p>
                <h3 className="mt-1 text-sm font-black text-slate-950">
                  {activeColumnLabel}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setColumnMenu(null)}
                className="inline-flex h-8 w-8 items-center justify-center rounded-full text-slate-400 transition hover:bg-slate-100 hover:text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-300"
                aria-label="Close column options"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="mt-3 grid grid-cols-2 gap-2">
              {(['asc', 'desc'] as const).map((direction) => (
                <button
                  key={direction}
                  type="button"
                  onClick={() => setColumnSort({ id: columnMenu.id, direction })}
                  className={`rounded-lg border px-3 py-2 text-xs font-bold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-300 ${
                    columnSort?.id === columnMenu.id &&
                    columnSort.direction === direction
                      ? 'border-blue-300 bg-blue-50 text-blue-800'
                      : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
                  }`}
                >
                  {direction === 'asc' ? 'Sort A → Z / Oldest' : 'Sort Z → A / Newest'}
                </button>
              ))}
            </div>

            <div className="mt-4 border-t border-slate-100 pt-4">
              {DATE_COLUMN_IDS.has(columnMenu.id) ? (
                <div className="grid grid-cols-2 gap-2">
                  <FilterInput
                    label="From"
                    type="date"
                    value={activeColumnRule.from}
                    onChange={(value) => updateColumnFilter(columnMenu.id, { from: value })}
                  />
                  <FilterInput
                    label="To"
                    type="date"
                    value={activeColumnRule.to}
                    onChange={(value) => updateColumnFilter(columnMenu.id, { to: value })}
                  />
                </div>
              ) : NUMBER_COLUMN_IDS.has(columnMenu.id) ? (
                <div className="grid grid-cols-2 gap-2">
                  <FilterInput
                    label="Minimum"
                    type="number"
                    value={activeColumnRule.min}
                    onChange={(value) => updateColumnFilter(columnMenu.id, { min: value })}
                  />
                  <FilterInput
                    label="Maximum"
                    type="number"
                    value={activeColumnRule.max}
                    onChange={(value) => updateColumnFilter(columnMenu.id, { max: value })}
                  />
                </div>
              ) : (
                <>
                  <label className="relative block">
                    <Search className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-slate-400" />
                    <span className="sr-only">Search {activeColumnLabel}</span>
                    <input
                      autoFocus
                      value={activeColumnRule.query || ''}
                      onChange={(event) => {
                        setColumnOptionSearch(event.target.value);
                        updateColumnFilter(columnMenu.id, { query: event.target.value });
                      }}
                      placeholder={`Search ${activeColumnLabel.toLowerCase()}…`}
                      className="h-10 w-full rounded-xl border border-slate-200 bg-slate-50 pl-9 pr-3 text-sm font-semibold text-slate-700 outline-none focus:border-blue-300 focus:bg-white focus:ring-4 focus:ring-blue-100"
                    />
                  </label>
                  <div className="mt-3 max-h-52 space-y-1 overflow-y-auto pr-1">
                    {columnValueOptions
                      .filter((value) =>
                        value.toLowerCase().includes(
                          columnOptionSearch.trim().toLowerCase(),
                        ),
                      )
                      .map((value) => {
                        const selected = activeColumnRule.selected?.includes(value) || false;
                        return (
                          <button
                            key={value}
                            type="button"
                            aria-pressed={selected}
                            onClick={() => updateColumnFilter(columnMenu.id, {
                              selected: selected
                                ? activeColumnRule.selected?.filter((item) => item !== value)
                                : [...(activeColumnRule.selected || []), value],
                            })}
                            className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-xs font-semibold text-slate-700 transition hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-200"
                          >
                            <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-md border ${
                              selected
                                ? 'border-blue-500 bg-blue-600 text-white'
                                : 'border-slate-300 bg-white'
                            }`}>
                              {selected && <Check className="h-3.5 w-3.5" />}
                            </span>
                            <span className="truncate">{value}</span>
                          </button>
                        );
                      })}
                  </div>
                </>
              )}
            </div>

            <div className="mt-4 flex items-center justify-between border-t border-slate-100 pt-3">
              <button
                type="button"
                onClick={() => {
                  clearColumnFilter(columnMenu.id);
                  if (columnSort?.id === columnMenu.id) setColumnSort(null);
                  setColumnOptionSearch('');
                }}
                className="text-xs font-bold text-slate-500 hover:text-slate-800"
              >
                Clear column
              </button>
              <button
                type="button"
                onClick={() => setColumnMenu(null)}
                className="app-btn-primary !h-8 !rounded-lg !px-3 !text-xs"
              >
                Done
              </button>
            </div>
          </div>
        )}
        <div className="border-t border-slate-200 px-4 py-3 text-xs font-semibold text-slate-600">
          {visibleRows.length} loan{visibleRows.length === 1 ? '' : 's'} · {
            visibleRows.length === total ? 'All loans displayed' : `${total} loaded`
          }
        </div>
      </div>

      {portalReady && payoffExpirationDialogRow && createPortal(
        <div
          className="fixed inset-0 z-[200] flex items-center justify-center bg-slate-950/40 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="payoff-expiration-title"
          onClick={() => {
            if (!savingRows.has(payoffExpirationDialogRow.id)) {
              setPayoffExpirationDialogRow(null);
              setPayoffExpirationDraft('');
            }
          }}
        >
          <div
            className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-2xl"
            onClick={(event) => event.stopPropagation()}
          >
            <p className="text-xs font-bold uppercase tracking-wider text-blue-600">
              Payoff Received
            </p>
            <h2
              id="payoff-expiration-title"
              className="mt-1 text-xl font-black text-slate-950"
            >
              Select the payoff expiration
            </h2>
            <p className="mt-1 text-sm font-medium text-slate-500">
              {payoffExpirationDialogRow.loan.borrowerName} · Arive #
              {payoffExpirationDialogRow.loan.loanNumber}
            </p>
            <label className="mt-5 block">
              <span className="mb-1.5 block text-xs font-bold uppercase tracking-wider text-slate-600">
                Payoff expiration date
              </span>
              <input
                type="date"
                autoFocus
                min={todayInputValue()}
                value={payoffExpirationDraft}
                onChange={(event) =>
                  setPayoffExpirationDraft(event.target.value)
                }
                className="h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-800 outline-none focus:border-blue-400 focus:ring-4 focus:ring-blue-100"
              />
            </label>
            <p className="mt-2 text-xs font-medium text-slate-500">
              The date will pulse orange seven days before expiration and red
              three days before expiration.
            </p>
            <div className="mt-6 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  setPayoffExpirationDialogRow(null);
                  setPayoffExpirationDraft('');
                }}
                className="app-btn-secondary"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={
                  !payoffExpirationDraft ||
                  savingRows.has(payoffExpirationDialogRow.id)
                }
                onClick={() => {
                  const row = payoffExpirationDialogRow;
                  const expiresAt = payoffExpirationDraft;
                  setPayoffExpirationDialogRow(null);
                  setPayoffExpirationDraft('');
                  void saveCell(
                    row,
                    'payoffStatus',
                    ProcessingItemStatus.RECEIVED,
                    { payoffExpiresAt: expiresAt },
                  );
                }}
                className="app-btn-primary disabled:cursor-not-allowed disabled:opacity-50"
              >
                Save Payoff
              </button>
            </div>
          </div>
        </div>,
        document.body,
      )}

      {portalReady && rateLockDialogRow && createPortal(
        <div
          className="fixed inset-0 z-[200] flex items-center justify-center bg-slate-950/40 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="rate-lock-title"
          onClick={() => {
            if (!savingRows.has(rateLockDialogRow.id)) {
              setRateLockDialogRow(null);
              setRateLockExpiryDraft('');
            }
          }}
        >
          <div
            className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-2xl"
            onClick={(event) => event.stopPropagation()}
          >
            <p className="text-xs font-bold uppercase tracking-wider text-blue-600">Rate Lock</p>
            <h2 id="rate-lock-title" className="mt-1 text-xl font-black text-slate-950">
              Select the expiration date
            </h2>
            <p className="mt-1 text-sm font-medium text-slate-500">
              {rateLockDialogRow.loan.borrowerName} · Arive #{rateLockDialogRow.loan.loanNumber}
            </p>
            <label className="mt-5 block">
              <span className="mb-1.5 block text-xs font-bold uppercase tracking-wider text-slate-600">
                Lock expiration date
              </span>
              <input
                type="date"
                autoFocus
                min={todayInputValue()}
                value={rateLockExpiryDraft}
                onChange={(event) => setRateLockExpiryDraft(event.target.value)}
                className="h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-800 outline-none focus:border-blue-400 focus:ring-4 focus:ring-blue-100"
              />
            </label>
            <p className="mt-2 text-xs font-medium text-slate-500">
              The Rate Lock cell will pulse red beginning three days before this date.
            </p>
            <div className="mt-6 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  setRateLockDialogRow(null);
                  setRateLockExpiryDraft('');
                }}
                className="app-btn-secondary"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={!rateLockExpiryDraft || savingRows.has(rateLockDialogRow.id)}
                onClick={() => void saveRateLock(rateLockDialogRow, true, rateLockExpiryDraft)}
                className="app-btn-primary disabled:cursor-not-allowed disabled:opacity-50"
              >
                {savingRows.has(rateLockDialogRow.id) && <Loader2 className="h-4 w-4 animate-spin" />}
                Save Rate Lock
              </button>
            </div>
          </div>
        </div>,
        document.body,
      )}

      {borrowerWorkspaceRowId && (
        <ProcessingBorrowerWorkspace
          pipelineLoanId={borrowerWorkspaceRowId}
          onClose={() => setBorrowerWorkspaceRowId(null)}
          onSaved={() => loadRows()}
        />
      )}

      {restructureDialog && (
        <div
          className="fixed inset-0 z-[90] flex items-center justify-center bg-slate-950/45 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="restructure-dialog-title"
          onClick={() => {
            if (!savingRows.has(restructureDialog.row.id)) {
              setRestructureDialog(null);
              setRestructureNotesDraft('');
            }
          }}
        >
          <div
            className="w-full max-w-lg rounded-2xl border border-slate-200 bg-white p-6 shadow-2xl"
            onClick={(event) => event.stopPropagation()}
          >
            <p className="text-xs font-bold uppercase tracking-wider text-red-600">
              Restructure workflow
            </p>
            <h2 id="restructure-dialog-title" className="mt-1 text-xl font-black text-slate-950">
              {restructureDialog.action === 'MOVE_TO_RESTRUCTURE'
                ? 'Move to Restructures'
                : restructureDialog.action === 'REQUEST_ADVERSE'
                  ? 'Request to Adverse'
                  : 'Send to Underwriting'}
            </h2>
            <p className="mt-1 text-sm font-medium text-slate-500">
              {restructureDialog.row.loan.borrowerName} · Arive #{restructureDialog.row.loan.loanNumber}
            </p>
            <label className="mt-5 block">
              <span className="mb-1.5 block text-xs font-bold uppercase tracking-wider text-slate-600">
                Required notes
              </span>
              <textarea
                autoFocus
                rows={5}
                value={restructureNotesDraft}
                onChange={(event) => setRestructureNotesDraft(event.target.value)}
                placeholder={
                  restructureDialog.action === 'MOVE_TO_RESTRUCTURE'
                    ? 'Explain why this loan is being moved to Restructures…'
                    : 'Document the reason and relevant details…'
                }
                className="w-full resize-y rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm font-medium text-slate-800 outline-none placeholder:text-slate-400 focus:border-blue-400 focus:ring-4 focus:ring-blue-100"
              />
            </label>
            <p className="mt-2 text-xs font-medium text-slate-500">
              This entry will be added to the Restructure Notes column and audit history.
            </p>
            <div className="mt-6 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  setRestructureDialog(null);
                  setRestructureNotesDraft('');
                }}
                disabled={savingRows.has(restructureDialog.row.id)}
                className="app-btn-secondary disabled:cursor-not-allowed disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void submitRestructureDialog()}
                disabled={
                  !restructureNotesDraft.trim() ||
                  savingRows.has(restructureDialog.row.id)
                }
                className={
                  restructureDialog.action === 'REQUEST_ADVERSE'
                    ? 'inline-flex h-10 items-center justify-center gap-2 rounded-xl bg-red-700 px-4 text-sm font-bold text-white shadow-sm transition hover:bg-red-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-300 disabled:cursor-not-allowed disabled:opacity-50'
                    : 'app-btn-primary disabled:cursor-not-allowed disabled:opacity-50'
                }
              >
                {savingRows.has(restructureDialog.row.id) && (
                  <Loader2 className="h-4 w-4 animate-spin" />
                )}
                Confirm
              </button>
            </div>
          </div>
        </div>
      )}

      {actionsMenuRow && (
        <div
          className="fixed inset-0 z-[80] flex items-center justify-center bg-slate-950/40 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="pipeline-actions-title"
          onClick={() => setActionsMenuRow(null)}
        >
          <div
            className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-2xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-xs font-bold uppercase tracking-wider text-blue-600">Loan actions</p>
                <h2 id="pipeline-actions-title" className="mt-1 text-xl font-black text-slate-950">
                  {actionsMenuRow.loan.borrowerName}
                </h2>
                <p className="text-sm font-medium text-slate-500">
                  Arive #{actionsMenuRow.loan.loanNumber}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setActionsMenuRow(null)}
                className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-500 transition hover:bg-slate-50 hover:text-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-300"
                aria-label="Close loan actions"
                autoFocus
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="mt-5 space-y-2">
              <button
                type="button"
                onClick={() => {
                  const row = actionsMenuRow;
                  setActionsMenuRow(null);
                  void openHistory(row);
                }}
                className="flex w-full items-center gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3 text-left text-sm font-bold text-slate-700 transition hover:border-blue-200 hover:bg-blue-50 hover:text-blue-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-300"
              >
                <History className="h-4 w-4 text-blue-600" />
                View change history
              </button>

              {(isLoanOfficer || isProcessor) &&
                canEditRow(actionsMenuRow) &&
                actionsMenuRow.sheet !== ProcessingPipelineSheet.FUNDING &&
                !isLockedField(actionsMenuRow, 'rateLock') &&
                !actionsMenuRow.rateLock && (
                  actionsMenuRow.rateLockRequestedAt ? (
                    <div className="flex w-full items-center gap-3 rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm font-bold text-blue-800">
                      <Lock className="h-4 w-4" />
                      Rate Lock Requested
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => void requestRateLock(actionsMenuRow)}
                      className="flex w-full items-center justify-between rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-left text-sm font-bold text-blue-800 transition hover:bg-blue-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-300"
                    >
                      <span className="inline-flex items-center gap-3">
                        <Lock className="h-4 w-4" />
                        Request Rate Lock
                      </span>
                      <span aria-hidden="true">→</span>
                    </button>
                  )
                )}

              {isRateLockRequestsView &&
                isManagerOrAdmin &&
                actionsMenuRow.rateLockRequestedAt && (
                  <button
                    type="button"
                    onClick={() => void dismissRateLockRequest(actionsMenuRow)}
                    className="flex w-full items-center justify-between rounded-xl border border-slate-300 bg-slate-50 px-4 py-3 text-left text-sm font-bold text-slate-700 transition hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-300"
                  >
                    Dismiss Rate Lock Request
                    <span aria-hidden="true">×</span>
                  </button>
                )}

              {canEditRow(actionsMenuRow) &&
                actionsMenuRow.sheet === ProcessingPipelineSheet.RESTRUCTURE && (
                  <>
                    {actionsMenuRow.pipelineStatus === ProcessingPipelineStatus.ADVERSE_PENDING &&
                      !isLoanOfficer &&
                      role !== UserRole.LOA && (
                        <button
                          type="button"
                          onClick={() => void declineLoan(actionsMenuRow)}
                          className="flex w-full items-center justify-between rounded-xl border border-red-400 bg-red-100 px-4 py-3 text-left text-sm font-black text-red-900 transition hover:bg-red-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400"
                        >
                          <span className="inline-flex items-center gap-3">
                            <Archive className="h-4 w-4" />
                            Decline Loan
                          </span>
                          <span aria-hidden="true">→</span>
                        </button>
                      )}
                    {actionsMenuRow.pipelineStatus !== ProcessingPipelineStatus.ADVERSE_PENDING && (
                      <button
                        type="button"
                        onClick={() => openRestructureDialog(actionsMenuRow, 'REQUEST_ADVERSE')}
                        className="flex w-full items-center justify-between rounded-xl border border-red-300 bg-red-50 px-4 py-3 text-left text-sm font-bold text-red-800 transition hover:bg-red-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-300"
                      >
                        Request to Adverse
                        <span aria-hidden="true">→</span>
                      </button>
                    )}
                    {actionsMenuRow.pipelineStatus !== ProcessingPipelineStatus.PENDING_APPROVAL && (
                      <button
                        type="button"
                        onClick={() => openRestructureDialog(actionsMenuRow, 'SEND_TO_UNDERWRITING')}
                        className="flex w-full items-center justify-between rounded-xl border border-orange-300 bg-orange-50 px-4 py-3 text-left text-sm font-bold text-orange-900 transition hover:bg-orange-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-300"
                      >
                        Send to Underwriting
                        <span aria-hidden="true">→</span>
                      </button>
                    )}
                    {role !== UserRole.LOAN_OFFICER && (
                      <button
                        type="button"
                        onClick={() => {
                          const row = actionsMenuRow;
                          setActionsMenuRow(null);
                          void moveRow(row, ProcessingPipelineSheet.PIPELINE);
                        }}
                        className="flex w-full items-center justify-between rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-left text-sm font-bold text-blue-800 transition hover:bg-blue-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-300"
                      >
                        Return to Pipeline
                        <span aria-hidden="true">→</span>
                      </button>
                    )}
                  </>
                )}

              {canEditRow(actionsMenuRow) &&
                actionsMenuRow.sheet !== ProcessingPipelineSheet.RESTRUCTURE && (
                <details className="group rounded-xl border border-slate-200 bg-white">
                  <summary className="flex cursor-pointer list-none items-center justify-between gap-3 rounded-xl px-4 py-3 text-sm font-bold text-slate-700 transition hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-300">
                    <span>Move to…</span>
                    <ChevronDown className="h-4 w-4 text-slate-400 transition group-open:rotate-180" />
                  </summary>
                  <div className="space-y-2 border-t border-slate-100 p-3">
                    {PROCESSING_PIPELINE_SHEETS.filter(
                      (option) => option.value !== actionsMenuRow.sheet,
                    ).map((option) => (
                      <button
                        key={option.value}
                        type="button"
                        onClick={() => {
                          const row = actionsMenuRow;
                          if (option.value === ProcessingPipelineSheet.RESTRUCTURE) {
                            openRestructureDialog(row, 'MOVE_TO_RESTRUCTURE');
                          } else {
                            setActionsMenuRow(null);
                            void moveRow(row, option.value);
                          }
                        }}
                        className="flex w-full items-center justify-between rounded-lg bg-slate-50 px-3 py-2.5 text-left text-sm font-semibold text-slate-700 transition hover:bg-blue-50 hover:text-blue-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-300"
                      >
                        {option.label}
                        <span aria-hidden="true">→</span>
                      </button>
                    ))}
                  </div>
                </details>
              )}
            </div>
          </div>
        </div>
      )}

      {historyRow && (
        <div className="fixed inset-0 z-50 flex justify-end bg-slate-950/30" role="dialog" aria-modal="true" aria-label="Change history">
          <button type="button" className="flex-1 cursor-default" aria-label="Close history" onClick={() => setHistoryRow(null)} />
          <aside className="h-full w-full max-w-md overflow-y-auto bg-white p-6 shadow-2xl">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-blue-600">Change history</p>
                <h2 className="mt-1 text-xl font-bold text-slate-950">{historyRow.loan.borrowerName}</h2>
                <p className="text-sm text-slate-500">Arive #{historyRow.loan.loanNumber}</p>
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
      {layoutManagerOpen && (
        <ProcessingPipelineLayoutManager
          open
          role={role}
          layouts={layouts}
          onClose={() => setLayoutManagerOpen(false)}
          onLayoutsChange={setLayouts}
        />
      )}
    </section>
  );
}
