'use client';

import React, { useDeferredValue, useMemo, useState } from 'react';
import { ChevronDown, ChevronUp, Search } from 'lucide-react';
import { TaskList, type Task } from '@/components/tasks/TaskList';

type SortOption = 'updated_desc' | 'updated_asc' | 'borrower_asc' | 'borrower_desc';
type LocalSortOption = 'global' | SortOption;

type BucketConfig = {
  id: string;
  label: string;
  chipLabel: string;
  chipClassName: string;
  isCompleted?: boolean;
  tasks: Task[];
};

type BucketControls = {
  collapsed: boolean;
  search: string;
  sort: LocalSortOption;
};

const defaultControls: BucketControls = {
  collapsed: false,
  search: '',
  sort: 'global',
};

const sortOptions: Array<{ value: SortOption; label: string }> = [
  { value: 'updated_desc', label: 'Updated (Newest)' },
  { value: 'updated_asc', label: 'Updated (Oldest)' },
  { value: 'borrower_asc', label: 'Borrower (A to Z)' },
  { value: 'borrower_desc', label: 'Borrower (Z to A)' },
];
const sortLabelByValue: Record<SortOption, string> = {
  updated_desc: 'Updated (Newest)',
  updated_asc: 'Updated (Oldest)',
  borrower_asc: 'Borrower (A to Z)',
  borrower_desc: 'Borrower (Z to A)',
};

function normalizeDate(value?: Date) {
  if (!value) return 0;
  const time = value instanceof Date ? value.getTime() : new Date(value).getTime();
  return Number.isFinite(time) ? time : 0;
}

function normalizeBorrower(task: Task) {
  return task.loan.borrowerName.trim().toLowerCase();
}

function normalizeSearch(task: Task) {
  return `${task.loan.borrowerName} ${task.loan.loanNumber} ${task.title}`.toLowerCase();
}

function sortTasks(tasks: Task[], sortBy: SortOption) {
  return tasks
    .map((task, index) => ({ task, index }))
    .sort((a, b) => {
      if (sortBy === 'updated_desc') {
        return normalizeDate(b.task.updatedAt) - normalizeDate(a.task.updatedAt) || a.index - b.index;
      }
      if (sortBy === 'updated_asc') {
        return normalizeDate(a.task.updatedAt) - normalizeDate(b.task.updatedAt) || a.index - b.index;
      }
      if (sortBy === 'borrower_asc') {
        return normalizeBorrower(a.task).localeCompare(normalizeBorrower(b.task)) || a.index - b.index;
      }
      return normalizeBorrower(b.task).localeCompare(normalizeBorrower(a.task)) || a.index - b.index;
    })
    .map((entry) => entry.task);
}

export function TaskBucketsBoard({
  buckets,
  activeBucketId,
  canDelete,
  currentRole,
  currentUserId,
  initialFocusedTaskId,
  bucketScrollMode = 'auto',
  fixedScrollClassName = 'max-h-[520px] overflow-y-auto pr-1',
}: {
  buckets: BucketConfig[];
  activeBucketId: string | null;
  canDelete: boolean;
  currentRole: string;
  currentUserId?: string;
  initialFocusedTaskId?: string | null;
  bucketScrollMode?: 'auto' | 'fixed';
  fixedScrollClassName?: string;
}) {
  const defaultGlobalSort: SortOption =
    currentRole === 'DISCLOSURE_SPECIALIST' ||
    currentRole === 'QC' ||
    currentRole === 'MANAGER'
      ? 'updated_asc'
      : 'updated_desc';
  const [globalSearch, setGlobalSearch] = useState('');
  const [globalSort, setGlobalSort] = useState<SortOption>(defaultGlobalSort);
  const [controlsByBucket, setControlsByBucket] = useState<Record<string, BucketControls>>({});
  const deferredGlobalSearch = useDeferredValue(globalSearch.trim().toLowerCase());

  const updateBucketControls = (bucketId: string, next: Partial<BucketControls>) => {
    setControlsByBucket((prev) => ({
      ...prev,
      [bucketId]: {
        ...(prev[bucketId] || defaultControls),
        ...next,
      },
    }));
  };

  const processedBuckets = useMemo(() => {
    return buckets.map((bucket) => {
      const bucketControls = controlsByBucket[bucket.id] || defaultControls;
      const deferredLocalSearch = bucketControls.search.trim().toLowerCase();
      const selectedSort =
        bucketControls.sort === 'global'
          ? bucket.isCompleted
            ? 'updated_desc'
            : globalSort
          : bucketControls.sort;
      const filtered = bucket.tasks.filter((task) => {
        const searchable = normalizeSearch(task);
        if (deferredGlobalSearch && !searchable.includes(deferredGlobalSearch)) return false;
        if (deferredLocalSearch && !searchable.includes(deferredLocalSearch)) return false;
        return true;
      });
      const sorted = sortTasks(filtered, selectedSort);
      return {
        ...bucket,
        visibleTasks: sorted,
        controls: bucketControls,
      };
    });
  }, [buckets, controlsByBucket, deferredGlobalSearch, globalSort]);
  const compactBoardMaxWidth =
    processedBuckets.length <= 1
      ? '520px'
      : processedBuckets.length === 2
      ? '1040px'
      : null;

  return (
    <div className="space-y-3.5">
      <div className="w-full md:w-fit rounded-2xl border border-slate-200/80 bg-white p-3 shadow-sm">
        <div className="flex flex-wrap items-center gap-2">
          <label className="relative w-full md:w-[420px]">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
            <input
              value={globalSearch}
              onChange={(event) => setGlobalSearch(event.target.value)}
              placeholder="Search all buckets..."
              className="w-full rounded-lg border border-slate-200 bg-white py-2 pl-8 pr-3 text-xs font-medium text-slate-700 focus:border-blue-400 focus:outline-none focus:ring-1 focus:ring-blue-300"
            />
          </label>
          <select
            value={globalSort}
            onChange={(event) => setGlobalSort(event.target.value as SortOption)}
            className="min-w-[170px] rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700 focus:border-blue-400 focus:outline-none focus:ring-1 focus:ring-blue-300"
          >
            {sortOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={() => {
              setGlobalSearch('');
              setGlobalSort(defaultGlobalSort);
              setControlsByBucket({});
            }}
            className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-100"
          >
            Reset
          </button>
        </div>
      </div>

      <div
        className="grid gap-3.5"
        style={{
          gridTemplateColumns: `repeat(${processedBuckets.length}, minmax(0, 1fr))`,
          ...(compactBoardMaxWidth ? { maxWidth: compactBoardMaxWidth } : {}),
        }}
      >
        {processedBuckets.map((bucket) => {
          const isCollapsed = bucket.controls.collapsed;
          const isLoReturnedBucket =
            currentRole === 'LOAN_OFFICER' && bucket.id === 'returned-to-disclosure';
          return (
            <div
              key={bucket.id}
              className={`flex flex-col rounded-2xl border bg-white p-4 shadow-sm transition-all hover:shadow-md ${
                activeBucketId === bucket.id
                  ? 'border-blue-300 ring-1 ring-blue-200'
                  : 'border-slate-200/80'
              } ${isCollapsed ? 'self-start' : ''}`}
            >
              <div
                className={`flex flex-col gap-1.5 ${
                  isCollapsed
                    ? 'mb-0 border-b-0 pb-0'
                    : 'mb-1.5 min-h-[124px] border-b border-border/50 pb-1.5'
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <h2
                      className="min-h-[2.5rem] text-base font-bold leading-snug text-slate-900 line-clamp-2"
                      title={bucket.label}
                    >
                      {bucket.label}
                    </h2>
                    {isLoReturnedBucket ? (
                      <div className="mt-2 flex items-center gap-1.5 overflow-x-auto whitespace-nowrap pb-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                        <span
                          title="Blue = Approved sent back"
                          className="shrink-0 inline-flex items-center rounded-full border border-blue-200 bg-blue-50 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider text-blue-700 shadow-sm"
                        >
                          Blue: Approved Back
                        </span>
                        <span
                          title="Orange = Revision sent back"
                          className="shrink-0 inline-flex items-center rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider text-amber-700 shadow-sm"
                        >
                          Orange: Revision Back
                        </span>
                      </div>
                    ) : (
                      <span
                        className={`mt-2 inline-flex items-center rounded-full border px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider shadow-sm ${bucket.chipClassName}`}
                      >
                        {bucket.chipLabel}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-1">
                    <span className="inline-flex h-7 min-w-7 shrink-0 items-center justify-center rounded-full bg-slate-100 px-2 text-xs font-bold text-slate-700 shadow-sm ring-1 ring-slate-200/60">
                      {bucket.visibleTasks.length}
                    </span>
                    <button
                      type="button"
                      onClick={() =>
                        updateBucketControls(bucket.id, { collapsed: !bucket.controls.collapsed })
                      }
                      className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-slate-200 bg-white text-slate-500 hover:bg-slate-50"
                      aria-label={isCollapsed ? 'Expand bucket' : 'Collapse bucket'}
                    >
                      {isCollapsed ? (
                        <ChevronDown className="h-4 w-4" />
                      ) : (
                        <ChevronUp className="h-4 w-4" />
                      )}
                    </button>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-1.5">
                  <label className="relative min-w-[120px] flex-1">
                    <Search className="pointer-events-none absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2 text-slate-400" />
                    <input
                      value={bucket.controls.search}
                      onChange={(event) =>
                        updateBucketControls(bucket.id, { search: event.target.value })
                      }
                      placeholder="Search bucket"
                      className="w-full rounded-md border border-slate-200 bg-white py-1.5 pl-7 pr-2 text-[11px] font-medium text-slate-700 focus:border-blue-400 focus:outline-none focus:ring-1 focus:ring-blue-300"
                    />
                  </label>
                  <select
                    value={bucket.controls.sort}
                    onChange={(event) =>
                      updateBucketControls(bucket.id, {
                        sort: event.target.value as LocalSortOption,
                      })
                    }
                    className="min-w-[125px] rounded-md border border-slate-200 bg-white px-2 py-1.5 text-[11px] font-medium text-slate-700 focus:border-blue-400 focus:outline-none focus:ring-1 focus:ring-blue-300"
                  >
                    <option value="global">Use Global ({sortLabelByValue[globalSort]})</option>
                    {sortOptions.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {isCollapsed ? null : (
                <div
                  className={
                    bucketScrollMode === 'fixed'
                      ? fixedScrollClassName
                      : undefined
                  }
                >
                  <TaskList
                    tasks={bucket.visibleTasks}
                    canDelete={canDelete}
                    currentRole={currentRole}
                    currentUserId={currentUserId}
                    initialFocusedTaskId={initialFocusedTaskId}
                    emptyState={
                      bucket.visibleTasks.length === 0 &&
                      Boolean(deferredGlobalSearch || bucket.controls.search.trim())
                        ? 'no_results'
                        : 'all_caught_up'
                    }
                  />
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
