'use client';

import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { UserRole } from '@prisma/client';
import {
  ArrowDown,
  ArrowUp,
  Check,
  Copy,
  GripVertical,
  LayoutTemplate,
  Loader2,
  LockKeyhole,
  Plus,
  RotateCcw,
  Save,
  Trash2,
  X,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  activateProcessingPipelineLayout,
  createProcessingPipelineLayout,
  deleteProcessingPipelineLayout,
  duplicateProcessingPipelineLayout,
  reorderProcessingPipelineLayouts,
  updateProcessingPipelineLayout,
  type ProcessingPipelineSavedLayout,
} from '@/app/actions/processingPipelineLayoutActions';
import {
  buildDefaultProcessingLayoutConfig,
  mandatoryColumnsForBucket,
  processingLayoutBucketColumns,
  PROCESSING_BORROWER_NAME_COLUMN_IDS,
  PROCESSING_LAYOUT_BUCKETS,
  type ProcessingLayoutBucket,
  type ProcessingLayoutColumn,
  type ProcessingPipelineLayoutConfig,
} from '@/lib/processingPipelineLayouts';

const BUCKET_LABELS: Record<ProcessingLayoutBucket, string> = {
  PIPELINE: 'Pipeline',
  RESTRUCTURE: 'Restructures',
  RATE_LOCK_REQUESTS: 'Rate Lock Requests',
  FUNDING: 'Fundings',
};

type Props = {
  open: boolean;
  role: UserRole;
  layouts: ProcessingPipelineSavedLayout[];
  onClose: () => void;
  onLayoutsChange: (layouts: ProcessingPipelineSavedLayout[]) => void;
};

type DraftLayout = {
  id: string | null;
  name: string;
  config: ProcessingPipelineLayoutConfig;
};

const PAYOFF_PAIR_IDS = ['payoffStatus', 'payoffExpiresAt'] as const;

function keepPayoffPairTogether(
  columns: ProcessingLayoutColumn[],
  bucket: ProcessingLayoutBucket,
) {
  if (bucket === 'FUNDING') return columns;
  const payoff = columns.find((column) => column.id === 'payoffStatus');
  const expiration = columns.find(
    (column) => column.id === 'payoffExpiresAt',
  );
  if (!payoff || !expiration) return columns;
  const visible = payoff.visible || expiration.visible;
  const withoutExpiration = columns.filter(
    (column) => column.id !== 'payoffExpiresAt',
  );
  const payoffIndex = withoutExpiration.findIndex(
    (column) => column.id === 'payoffStatus',
  );
  return [
    ...withoutExpiration.slice(0, payoffIndex),
    { ...payoff, visible },
    { ...expiration, visible },
    ...withoutExpiration.slice(payoffIndex + 1),
  ];
}

function cloneConfig(config: ProcessingPipelineLayoutConfig) {
  return JSON.parse(JSON.stringify(config)) as ProcessingPipelineLayoutConfig;
}

function initialDraft(
  layouts: ProcessingPipelineSavedLayout[],
  role: UserRole,
): DraftLayout {
  const active = layouts.find((layout) => layout.isActive) || layouts[0];
  return active
    ? { id: active.id, name: active.name, config: cloneConfig(active.config) }
    : {
        id: null,
        name: 'My Layout',
        config: buildDefaultProcessingLayoutConfig(role),
      };
}

function SortableColumnRow({
  column,
  label,
  mandatory,
  linked,
  requirementLabel,
  onVisibilityChange,
  onWidthChange,
  onMove,
  index,
  count,
}: {
  column: ProcessingLayoutColumn;
  label: string;
  mandatory: boolean;
  linked?: boolean;
  requirementLabel?: string;
  onVisibilityChange: (visible: boolean) => void;
  onWidthChange: (width: number) => void;
  onMove: (direction: -1 | 1) => void;
  index: number;
  count: number;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: column.id });

  return (
    <div
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
      }}
      className={`grid grid-cols-[auto_auto_minmax(0,1fr)_108px_auto] items-center gap-3 rounded-xl border bg-white px-3 py-3 transition ${
        isDragging
          ? 'z-10 border-blue-300 shadow-xl shadow-blue-100'
          : 'border-slate-200 hover:border-slate-300 hover:shadow-sm'
      }`}
    >
      <button
        type="button"
        className="cursor-grab rounded-lg p-1.5 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-300 active:cursor-grabbing"
        aria-label={`Reorder ${label}`}
        {...attributes}
        {...listeners}
      >
        <GripVertical className="h-4 w-4" />
      </button>
      <label className="inline-flex items-center">
        <input
          type="checkbox"
          checked={column.visible}
          disabled={mandatory || linked}
          onChange={(event) => onVisibilityChange(event.target.checked)}
          className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-300 disabled:cursor-not-allowed"
          aria-label={`Show ${label}`}
        />
      </label>
      <div className="min-w-0">
        <p className="truncate text-sm font-bold text-slate-900">{label}</p>
        <p className="mt-0.5 flex items-center gap-1 text-[11px] font-medium text-slate-500">
          {mandatory || linked ? (
            <>
              <LockKeyhole className="h-3 w-3 text-blue-500" />
              {linked ? 'Linked to Payoff' : requirementLabel || 'Always visible'}
            </>
          ) : column.visible ? (
            'Visible in condensed view'
          ) : (
            'Hidden in condensed view'
          )}
        </p>
      </div>
      <label className="relative">
        <span className="sr-only">{label} width</span>
        <input
          type="number"
          min={64}
          max={420}
          value={column.width}
          onChange={(event) => onWidthChange(Number(event.target.value))}
          className="h-9 w-full rounded-lg border border-slate-200 bg-slate-50 px-3 pr-7 text-sm font-bold tabular-nums text-slate-700 outline-none transition focus:border-blue-300 focus:bg-white focus:ring-2 focus:ring-blue-100"
        />
        <span className="pointer-events-none absolute right-2 top-2.5 text-[10px] font-bold text-slate-400">
          px
        </span>
      </label>
      <div className="flex items-center gap-1">
        <button
          type="button"
          disabled={index === 0}
          onClick={() => onMove(-1)}
          className="rounded-md p-1 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700 disabled:opacity-25"
          aria-label={`Move ${label} up`}
        >
          <ArrowUp className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          disabled={index === count - 1}
          onClick={() => onMove(1)}
          className="rounded-md p-1 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700 disabled:opacity-25"
          aria-label={`Move ${label} down`}
        >
          <ArrowDown className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}

export function ProcessingPipelineLayoutManager({
  open,
  role,
  layouts,
  onClose,
  onLayoutsChange,
}: Props) {
  const [selectedBucket, setSelectedBucket] =
    useState<ProcessingLayoutBucket>('PIPELINE');
  const [draft, setDraft] = useState<DraftLayout>(() =>
    initialDraft(layouts, role),
  );
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const nameInputRef = useRef<HTMLInputElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  useEffect(() => {
    if (!open) return;
    restoreFocusRef.current = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== 'Tab' || !panelRef.current) return;
      const focusable = Array.from(
        panelRef.current.querySelectorAll<HTMLElement>(
          'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      );
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    window.setTimeout(() => nameInputRef.current?.focus(), 0);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', handleKeyDown);
      restoreFocusRef.current?.focus();
    };
  }, [onClose, open]);

  const definitions = useMemo(
    () => processingLayoutBucketColumns(selectedBucket, role),
    [role, selectedBucket],
  );
  const labels = useMemo(
    () => new Map(definitions.map((column) => [column.id, column.label])),
    [definitions],
  );
  const mandatory = useMemo(
    () => new Set(mandatoryColumnsForBucket(selectedBucket, role)),
    [role, selectedBucket],
  );
  const columns = draft?.config.buckets[selectedBucket].columns || [];
  const visibleBorrowerNameCount = columns.filter(
    (column) =>
      column.visible &&
      PROCESSING_BORROWER_NAME_COLUMN_IDS.includes(
        column.id as (typeof PROCESSING_BORROWER_NAME_COLUMN_IDS)[number],
      ),
  ).length;

  const selectLayout = (layout: ProcessingPipelineSavedLayout) => {
    setDraft({
      id: layout.id,
      name: layout.name,
      config: cloneConfig(layout.config),
    });
    setMessage('');
  };

  const updateColumns = (next: ProcessingLayoutColumn[]) => {
    setDraft((current) =>
      current
        ? {
            ...current,
            config: {
              ...current.config,
              buckets: {
                ...current.config.buckets,
                [selectedBucket]: {
                  columns: keepPayoffPairTogether(next, selectedBucket),
                },
              },
            },
          }
        : current,
    );
  };

  const patchColumn = (
    id: ProcessingLayoutColumn['id'],
    patch: Partial<ProcessingLayoutColumn>,
  ) => {
    if (
      selectedBucket !== 'FUNDING' &&
      PAYOFF_PAIR_IDS.includes(id as (typeof PAYOFF_PAIR_IDS)[number]) &&
      typeof patch.visible === 'boolean'
    ) {
      updateColumns(
        columns.map((column) =>
          PAYOFF_PAIR_IDS.includes(
            column.id as (typeof PAYOFF_PAIR_IDS)[number],
          )
            ? { ...column, visible: patch.visible as boolean }
            : column,
        ),
      );
      return;
    }
    updateColumns(
      columns.map((column) =>
        column.id === id ? { ...column, ...patch } : column,
      ),
    );
  };

  const moveColumn = (index: number, direction: -1 | 1) => {
    const movingId = columns[index]?.id;
    if (
      selectedBucket !== 'FUNDING' &&
      PAYOFF_PAIR_IDS.includes(
        movingId as (typeof PAYOFF_PAIR_IDS)[number],
      )
    ) {
      const payoffIndex = columns.findIndex(
        (column) => column.id === 'payoffStatus',
      );
      const pair = PAYOFF_PAIR_IDS.map((id) =>
        columns.find((column) => column.id === id),
      ).filter((column): column is ProcessingLayoutColumn => Boolean(column));
      const remaining = columns.filter(
        (column) =>
          !PAYOFF_PAIR_IDS.includes(
            column.id as (typeof PAYOFF_PAIR_IDS)[number],
          ),
      );
      const target = Math.max(
        0,
        Math.min(remaining.length, payoffIndex + direction),
      );
      updateColumns([
        ...remaining.slice(0, target),
        ...pair,
        ...remaining.slice(target),
      ]);
      return;
    }
    const target = index + direction;
    if (target < 0 || target >= columns.length) return;
    updateColumns(arrayMove(columns, index, target));
  };

  const handleDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return;
    const oldIndex = columns.findIndex((column) => column.id === active.id);
    const newIndex = columns.findIndex((column) => column.id === over.id);
    if (oldIndex < 0 || newIndex < 0) return;
    if (
      selectedBucket !== 'FUNDING' &&
      PAYOFF_PAIR_IDS.includes(
        active.id as (typeof PAYOFF_PAIR_IDS)[number],
      )
    ) {
      if (
        PAYOFF_PAIR_IDS.includes(
          over.id as (typeof PAYOFF_PAIR_IDS)[number],
        )
      ) return;
      const pair = PAYOFF_PAIR_IDS.map((id) =>
        columns.find((column) => column.id === id),
      ).filter((column): column is ProcessingLayoutColumn => Boolean(column));
      const remaining = columns.filter(
        (column) =>
          !PAYOFF_PAIR_IDS.includes(
            column.id as (typeof PAYOFF_PAIR_IDS)[number],
          ),
      );
      const overIndex = remaining.findIndex(
        (column) => column.id === over.id,
      );
      const target = oldIndex < newIndex ? overIndex + 1 : overIndex;
      updateColumns([
        ...remaining.slice(0, target),
        ...pair,
        ...remaining.slice(target),
      ]);
      return;
    }
    updateColumns(arrayMove(columns, oldIndex, newIndex));
  };

  const resetBucket = () => {
    const defaults = buildDefaultProcessingLayoutConfig(role);
    updateColumns(cloneConfig(defaults).buckets[selectedBucket].columns);
    setMessage(`${BUCKET_LABELS[selectedBucket]} reset to its role default.`);
  };

  const saveDraft = async () => {
    if (!draft || !draft.name.trim()) return;
    setSaving(true);
    setMessage('');
    const result = draft.id
      ? await updateProcessingPipelineLayout({
          id: draft.id,
          name: draft.name,
          config: draft.config,
        })
      : await createProcessingPipelineLayout({
          name: draft.name,
          config: draft.config,
        });
    setSaving(false);
    if (!result.success) {
      setMessage(result.error);
      return;
    }
    onLayoutsChange(result.layouts);
    const saved =
      result.layouts.find((layout) => layout.id === draft.id) ||
      result.layouts.find(
        (layout) => layout.name.toLocaleLowerCase() === draft.name.trim().toLocaleLowerCase(),
      );
    if (saved) selectLayout(saved);
    setMessage('Layout saved.');
  };

  const createDraft = () => {
    setDraft({
      id: null,
      name: 'New Layout',
      config: buildDefaultProcessingLayoutConfig(role),
    });
    setSelectedBucket('PIPELINE');
    setMessage('');
    window.setTimeout(() => nameInputRef.current?.select(), 0);
  };

  const duplicateDraft = async () => {
    if (!draft?.id) return;
    const name = window.prompt('Name for the duplicated layout:', `${draft.name} Copy`);
    if (!name) return;
    setSaving(true);
    const result = await duplicateProcessingPipelineLayout({ id: draft.id, name });
    setSaving(false);
    if (!result.success) {
      setMessage(result.error);
      return;
    }
    onLayoutsChange(result.layouts);
    const duplicated = result.layouts.find(
      (layout) => layout.name.toLocaleLowerCase() === name.trim().toLocaleLowerCase(),
    );
    if (duplicated) selectLayout(duplicated);
  };

  const deleteDraft = async () => {
    if (!draft?.id || !window.confirm(`Delete "${draft.name}"?`)) return;
    setSaving(true);
    const result = await deleteProcessingPipelineLayout(draft.id);
    setSaving(false);
    if (!result.success) {
      setMessage(result.error);
      return;
    }
    onLayoutsChange(result.layouts);
    const next = result.layouts.find((layout) => layout.isActive) || result.layouts[0];
    setDraft(
      next
        ? { id: next.id, name: next.name, config: cloneConfig(next.config) }
        : {
            id: null,
            name: 'My Layout',
            config: buildDefaultProcessingLayoutConfig(role),
          },
    );
  };

  const useDraft = async () => {
    if (!draft?.id) {
      setMessage('Save this layout before using it.');
      return;
    }
    setSaving(true);
    const result = await activateProcessingPipelineLayout(draft.id);
    setSaving(false);
    if (!result.success) {
      setMessage(result.error);
      return;
    }
    onLayoutsChange(result.layouts);
    setMessage('This is now your active condensed layout.');
  };

  const moveSavedLayout = async (direction: -1 | 1) => {
    if (!draft?.id) return;
    const index = layouts.findIndex((layout) => layout.id === draft.id);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= layouts.length) return;
    const ordered = arrayMove(layouts, index, target);
    onLayoutsChange(
      ordered.map((layout, sortOrder) => ({ ...layout, sortOrder })),
    );
    const result = await reorderProcessingPipelineLayouts(
      ordered.map((layout) => layout.id),
    );
    if (!result.success) {
      onLayoutsChange(layouts);
      setMessage(result.error);
      return;
    }
    onLayoutsChange(result.layouts);
  };

  if (!open || typeof document === 'undefined') return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[240] flex items-center justify-center bg-slate-950/55 p-2 backdrop-blur-sm sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="processing-layout-manager-title"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={panelRef}
        className="flex h-[min(900px,94vh)] w-full max-w-6xl flex-col overflow-hidden rounded-[28px] border border-white/60 bg-white shadow-2xl shadow-slate-950/30"
      >
        <header className="flex items-start justify-between gap-4 border-b border-slate-200 bg-gradient-to-r from-slate-50 to-blue-50/60 px-5 py-4 sm:px-7">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full border border-blue-100 bg-white px-3 py-1 text-[10px] font-black uppercase tracking-[0.14em] text-blue-700 shadow-sm">
              <LayoutTemplate className="h-3.5 w-3.5" />
              Personal workspace
            </div>
            <h2
              id="processing-layout-manager-title"
              className="mt-2 text-2xl font-black tracking-tight text-slate-950"
            >
              Views &amp; Layouts
            </h2>
            <p className="mt-1 text-sm font-medium text-slate-500">
              Build named condensed views that follow you across devices.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full border border-slate-200 bg-white p-2 text-slate-500 shadow-sm transition hover:bg-slate-100 hover:text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-300"
            aria-label="Close Views and Layouts"
          >
            <X className="h-5 w-5" />
          </button>
        </header>

        <div className="grid min-h-0 flex-1 lg:grid-cols-[260px_minmax(0,1fr)]">
          <aside className="flex min-h-0 flex-col border-b border-slate-200 bg-slate-50/80 p-4 lg:border-b-0 lg:border-r">
            <button
              type="button"
              onClick={createDraft}
              className="app-btn-primary !h-10 !w-full !rounded-xl"
            >
              <Plus className="h-4 w-4" />
              New layout
            </button>
            <div className="mt-4 min-h-0 flex-1 space-y-2 overflow-y-auto pr-1">
              {layouts.length === 0 && (
                <div className="rounded-xl border border-dashed border-slate-300 bg-white p-4 text-center">
                  <p className="text-sm font-bold text-slate-700">No saved layouts yet</p>
                  <p className="mt-1 text-xs font-medium text-slate-500">
                    Configure the draft and save your first view.
                  </p>
                </div>
              )}
              {layouts.map((layout) => (
                <button
                  key={layout.id}
                  type="button"
                  onClick={() => selectLayout(layout)}
                  className={`flex w-full items-center justify-between gap-3 rounded-xl border px-3 py-3 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-300 ${
                    draft.id === layout.id
                      ? 'border-blue-200 bg-white text-blue-800 shadow-sm'
                      : 'border-transparent text-slate-600 hover:border-slate-200 hover:bg-white'
                  }`}
                >
                  <span className="min-w-0 truncate text-sm font-bold">{layout.name}</span>
                  {layout.isActive && (
                    <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-emerald-50 px-2 py-1 text-[9px] font-black uppercase tracking-wide text-emerald-700">
                      <Check className="h-3 w-3" />
                      Active
                    </span>
                  )}
                </button>
              ))}
            </div>
            {draft.id && layouts.length > 1 && (
              <div className="mt-3 grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => moveSavedLayout(-1)}
                  disabled={layouts[0]?.id === draft.id || saving}
                  className="app-btn-secondary !h-9 !rounded-lg !px-2 !text-xs"
                >
                  <ArrowUp className="h-3.5 w-3.5" />
                  Earlier
                </button>
                <button
                  type="button"
                  onClick={() => moveSavedLayout(1)}
                  disabled={layouts[layouts.length - 1]?.id === draft.id || saving}
                  className="app-btn-secondary !h-9 !rounded-lg !px-2 !text-xs"
                >
                  <ArrowDown className="h-3.5 w-3.5" />
                  Later
                </button>
              </div>
            )}
          </aside>

          <main className="flex min-h-0 flex-col">
            <div className="border-b border-slate-200 px-5 py-4 sm:px-6">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
                <label className="min-w-0 flex-1">
                  <span className="mb-1.5 block text-[10px] font-black uppercase tracking-[0.12em] text-slate-500">
                    Layout name
                  </span>
                  <input
                    ref={nameInputRef}
                    value={draft.name}
                    maxLength={32}
                    onChange={(event) =>
                      setDraft((current) =>
                        current ? { ...current, name: event.target.value } : current,
                      )
                    }
                    className="h-11 w-full rounded-xl border border-slate-200 bg-slate-50 px-4 text-sm font-bold text-slate-900 outline-none transition focus:border-blue-300 focus:bg-white focus:ring-4 focus:ring-blue-100"
                  />
                </label>
                <div className="flex flex-wrap gap-2">
                  {draft.id && (
                    <>
                      <button
                        type="button"
                        onClick={useDraft}
                        disabled={saving || layouts.find((item) => item.id === draft.id)?.isActive}
                        className="app-btn-secondary !h-11 !rounded-xl"
                      >
                        <Check className="h-4 w-4" />
                        Use layout
                      </button>
                      <button
                        type="button"
                        onClick={duplicateDraft}
                        disabled={saving}
                        className="app-btn-secondary !h-11 !rounded-xl"
                        aria-label="Duplicate layout"
                      >
                        <Copy className="h-4 w-4" />
                      </button>
                      <button
                        type="button"
                        onClick={deleteDraft}
                        disabled={saving}
                        className="inline-flex h-11 items-center justify-center rounded-xl border border-red-200 bg-white px-3 text-red-600 transition hover:bg-red-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-300"
                        aria-label="Delete layout"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </>
                  )}
                </div>
              </div>
              <div
                className="mt-4 flex gap-1 overflow-x-auto rounded-xl border border-slate-200 bg-slate-50 p-1"
                role="tablist"
                aria-label="Layout bucket"
              >
                {PROCESSING_LAYOUT_BUCKETS.map((bucket) => (
                  <button
                    key={bucket}
                    type="button"
                    role="tab"
                    aria-selected={selectedBucket === bucket}
                    onClick={() => setSelectedBucket(bucket)}
                    className={`whitespace-nowrap rounded-lg px-3 py-2 text-xs font-bold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-300 ${
                      selectedBucket === bucket
                        ? 'bg-white text-slate-950 shadow-sm ring-1 ring-slate-200'
                        : 'text-slate-500 hover:bg-white/70 hover:text-slate-800'
                    }`}
                  >
                    {BUCKET_LABELS[bucket]}
                  </button>
                ))}
              </div>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto bg-slate-50/40 px-5 py-5 sm:px-6">
              <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <h3 className="text-sm font-black text-slate-950">
                    {BUCKET_LABELS[selectedBucket]} columns
                  </h3>
                  <p className="mt-1 text-xs font-medium text-slate-500">
                    Drag to reorder. Locked columns can move but cannot be hidden.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={resetBucket}
                  className="app-btn-secondary !h-9 !rounded-lg !px-3 !text-xs"
                >
                  <RotateCcw className="h-3.5 w-3.5" />
                  Reset this bucket
                </button>
              </div>
              <DndContext
                sensors={sensors}
                collisionDetection={closestCenter}
                onDragEnd={handleDragEnd}
              >
                <SortableContext
                  items={columns.map((column) => column.id)}
                  strategy={verticalListSortingStrategy}
                >
                  <div className="space-y-2">
                    {columns.map((column, index) => (
                      (() => {
                        const isBorrowerNameColumn =
                          PROCESSING_BORROWER_NAME_COLUMN_IDS.includes(
                            column.id as (typeof PROCESSING_BORROWER_NAME_COLUMN_IDS)[number],
                          );
                        const isOnlyVisibleBorrowerName =
                          isBorrowerNameColumn &&
                          column.visible &&
                          visibleBorrowerNameCount === 1;
                        return (
                          <SortableColumnRow
                            key={column.id}
                            column={column}
                            label={labels.get(column.id) || column.id}
                            mandatory={
                              mandatory.has(column.id) ||
                              isOnlyVisibleBorrowerName
                            }
                            linked={column.id === 'payoffExpiresAt'}
                            requirementLabel={
                              isOnlyVisibleBorrowerName
                                ? 'At least one borrower name is required'
                                : undefined
                            }
                            onVisibilityChange={(visible) =>
                              patchColumn(column.id, { visible })
                            }
                            onWidthChange={(width) =>
                              patchColumn(column.id, {
                                width: Math.max(
                                  64,
                                  Math.min(420, width || 64),
                                ),
                              })
                            }
                            onMove={(direction) => moveColumn(index, direction)}
                            index={index}
                            count={columns.length}
                          />
                        );
                      })()
                    ))}
                  </div>
                </SortableContext>
              </DndContext>
            </div>

            <footer className="flex flex-col gap-3 border-t border-slate-200 bg-white px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6">
              <p
                className={`text-xs font-bold ${
                  message.includes('Unable') ||
                  message.includes('invalid') ||
                  message.includes('already') ||
                  message.includes('before')
                    ? 'text-red-600'
                    : 'text-slate-500'
                }`}
                role="status"
                aria-live="polite"
              >
                {message || 'Changes are saved to your account, not just this device.'}
              </p>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={onClose}
                  className="app-btn-secondary !h-11 !rounded-xl"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={saveDraft}
                  disabled={saving || !draft.name.trim()}
                  className="app-btn-primary !h-11 !rounded-xl"
                >
                  {saving ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Save className="h-4 w-4" />
                  )}
                  Save layout
                </button>
              </div>
            </footer>
          </main>
        </div>
      </div>
    </div>,
    document.body,
  );
}
