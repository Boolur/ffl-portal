'use client';

import React, {
  useCallback,
  useDeferredValue,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useRouter } from 'next/navigation';
import { ChevronDown, ChevronUp, Loader2, Search } from 'lucide-react';
import { TaskList, type Task } from '@/components/tasks/TaskList';
import { deleteTask } from '@/app/actions/taskActions';
import {
  fetchTaskBucketPageAction,
  fetchTaskByIdAction,
} from '@/app/actions/taskQueryActions';
import { defaultSortForRole } from '@/lib/tasks/taskBucketSort';
import type { TaskBucketCursor, TaskBucketSort, TaskDeskKey } from '@/lib/tasks/types';

type SortOption = TaskBucketSort;
type LocalSortOption = 'global' | SortOption;

export type BucketPageSeed = {
  tasks: Task[];
  nextCursor: TaskBucketCursor | null;
  totalMatching: number;
  hasMore: boolean;
};

export type PaginatedBucketConfig = {
  id: string;
  label: string;
  chipLabel: string;
  chipClassName: string;
  isCompleted?: boolean;
  deskKey?: TaskDeskKey;
  totalCount: number;
  initialPage?: BucketPageSeed;
};

type BucketControls = {
  collapsed: boolean;
  search: string;
  sort: LocalSortOption;
};

type BucketLoadState = {
  tasks: Task[];
  nextCursor: TaskBucketCursor | null;
  hasMore: boolean;
  totalMatching: number;
  isLoading: boolean;
  isLoadingMore: boolean;
  error: string | null;
};

const defaultControls: BucketControls = {
  collapsed: false,
  search: '',
  sort: 'global',
};

const sortOptions: Array<{ value: SortOption; label: string }> = [
  { value: 'created_asc', label: 'Queue Time (Oldest First)' },
  { value: 'created_desc', label: 'Queue Time (Newest First)' },
  { value: 'updated_desc', label: 'Updated (Newest)' },
  { value: 'updated_asc', label: 'Updated (Oldest)' },
  { value: 'borrower_asc', label: 'Borrower (A to Z)' },
  { value: 'borrower_desc', label: 'Borrower (Z to A)' },
];

const sortLabelByValue: Record<SortOption, string> = {
  created_asc: 'Queue Time (Oldest First)',
  created_desc: 'Queue Time (Newest First)',
  updated_desc: 'Updated (Newest)',
  updated_asc: 'Updated (Oldest)',
  borrower_asc: 'Borrower (A to Z)',
  borrower_desc: 'Borrower (Z to A)',
};

function buildInitialLoadState(bucket: PaginatedBucketConfig): BucketLoadState {
  const seed = bucket.initialPage;
  return {
    tasks: seed?.tasks ?? [],
    nextCursor: seed?.nextCursor ?? null,
    hasMore: seed?.hasMore ?? false,
    totalMatching: seed?.totalMatching ?? bucket.totalCount,
    isLoading: !seed,
    isLoadingMore: false,
    error: null,
  };
}

function mergeUniqueTasks(existing: Task[], incoming: Task[]): Task[] {
  const seen = new Set(existing.map((t) => t.id));
  const merged = [...existing];
  for (const task of incoming) {
    if (seen.has(task.id)) continue;
    seen.add(task.id);
    merged.push(task);
  }
  return merged;
}

function BucketScrollArea({
  bucketScrollMode,
  fixedScrollClassName,
  hasMore,
  isLoadingMore,
  onLoadMore,
  children,
}: {
  bucketScrollMode: 'auto' | 'fixed';
  fixedScrollClassName: string;
  hasMore: boolean;
  isLoadingMore: boolean;
  onLoadMore: () => void;
  children: React.ReactNode;
}) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const sentinelRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const root = scrollRef.current;
    const sentinel = sentinelRef.current;
    if (!sentinel || !hasMore) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting) && !isLoadingMore) {
          onLoadMore();
        }
      },
      {
        root: bucketScrollMode === 'fixed' ? root : null,
        rootMargin: '120px',
        threshold: 0,
      }
    );

    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [bucketScrollMode, hasMore, isLoadingMore, onLoadMore]);

  return (
    <div
      ref={scrollRef}
      className={bucketScrollMode === 'fixed' ? fixedScrollClassName : undefined}
    >
      {children}
      {hasMore ? (
        <div ref={sentinelRef} className="flex justify-center py-3">
          {isLoadingMore ? (
            <Loader2 className="h-5 w-5 animate-spin text-slate-400" aria-hidden />
          ) : (
            <span className="text-[10px] font-medium text-slate-400">Scroll for more</span>
          )}
        </div>
      ) : null}
    </div>
  );
}

type TaskBucketsBoardProps = {
  buckets: PaginatedBucketConfig[];
  activeBucketId: string | null;
  canDelete: boolean;
  currentRole: string;
  currentUserId?: string;
  jrAssigneeOptions?: Array<{ id: string; name: string }>;
  initialFocusedTaskId?: string | null;
  bucketScrollMode?: 'auto' | 'fixed';
  fixedScrollClassName?: string;
  onCollapseSummaryChange?: (summary: { total: number; collapsed: number }) => void;
  enableBatchDelete?: boolean;
};

export type TaskBucketsBoardHandle = {
  setAllBucketsCollapsed: (collapsed: boolean) => void;
};

export const TaskBucketsBoard = React.forwardRef<TaskBucketsBoardHandle, TaskBucketsBoardProps>(
  function TaskBucketsBoard(
    {
      buckets,
      activeBucketId,
      canDelete,
      currentRole,
      currentUserId,
      jrAssigneeOptions = [],
      initialFocusedTaskId,
      bucketScrollMode = 'auto',
      fixedScrollClassName = 'max-h-[520px] overflow-y-auto pr-1',
      onCollapseSummaryChange,
      enableBatchDelete = false,
    },
    ref
  ) {
    const router = useRouter();
    const defaultGlobalSort = defaultSortForRole(currentRole);
    const [globalSearch, setGlobalSearch] = useState('');
    const [globalSort, setGlobalSort] = useState<SortOption>(defaultGlobalSort);
    const [controlsByBucket, setControlsByBucket] = useState<Record<string, BucketControls>>({});
    const [loadStateByBucket, setLoadStateByBucket] = useState<Record<string, BucketLoadState>>(
      () => {
        const initial: Record<string, BucketLoadState> = {};
        for (const bucket of buckets) {
          initial[bucket.id] = buildInitialLoadState(bucket);
        }
        return initial;
      }
    );
    const [selectedTaskIdsByBucket, setSelectedTaskIdsByBucket] = useState<
      Record<string, string[]>
    >({});
    const [batchDeletingBucketId, setBatchDeletingBucketId] = useState<string | null>(null);
    const [isMobileViewport, setIsMobileViewport] = useState(false);
    const deferredGlobalSearch = useDeferredValue(globalSearch.trim());
    const deferredBucketSearch = useDeferredValue(controlsByBucket);
    const fetchGenerationRef = useRef(0);
    const skipGlobalSearchEffectRef = useRef(true);

    useEffect(() => {
      const initial: Record<string, BucketLoadState> = {};
      for (const bucket of buckets) {
        initial[bucket.id] = buildInitialLoadState(bucket);
      }
      setLoadStateByBucket(initial);
    }, [buckets]);

    const resolveSort = useCallback(
      (bucket: PaginatedBucketConfig, controls: BucketControls): SortOption => {
        if (controls.sort === 'global') {
          return bucket.isCompleted ? 'updated_desc' : globalSort;
        }
        return controls.sort;
      },
      [globalSort]
    );

    const loadBucket = useCallback(
      async (
        bucket: PaginatedBucketConfig,
        options: {
          append?: boolean;
          cursor?: TaskBucketCursor | null;
          search?: string;
          sort?: SortOption;
          localSearch?: string;
        } = {}
      ) => {
        const controls = controlsByBucket[bucket.id] || defaultControls;
        const sort = options.sort ?? resolveSort(bucket, controls);
        const combinedSearch = [deferredGlobalSearch, options.search ?? controls.search.trim()]
          .filter(Boolean)
          .join(' ')
          .trim();

        const generation = ++fetchGenerationRef.current;
        setLoadStateByBucket((prev) => ({
          ...prev,
          [bucket.id]: {
            ...(prev[bucket.id] || buildInitialLoadState(bucket)),
            isLoading: !options.append,
            isLoadingMore: Boolean(options.append),
            error: null,
          },
        }));

        const result = await fetchTaskBucketPageAction({
          bucketId: bucket.id,
          deskKey: bucket.deskKey,
          sort,
          search: combinedSearch || undefined,
          cursor: options.append ? options.cursor ?? null : null,
        });

        if (generation !== fetchGenerationRef.current) return;

        if (!result.success) {
          setLoadStateByBucket((prev) => ({
            ...prev,
            [bucket.id]: {
              ...(prev[bucket.id] || buildInitialLoadState(bucket)),
              isLoading: false,
              isLoadingMore: false,
              error: result.error || 'Failed to load',
            },
          }));
          return;
        }

        setLoadStateByBucket((prev) => {
          const prior = prev[bucket.id] || buildInitialLoadState(bucket);
          const tasks = options.append
            ? mergeUniqueTasks(prior.tasks, result.tasks as Task[])
            : (result.tasks as Task[]);
          return {
            ...prev,
            [bucket.id]: {
              tasks,
              nextCursor: result.nextCursor,
              hasMore: result.hasMore,
              totalMatching: result.totalMatching,
              isLoading: false,
              isLoadingMore: false,
              error: null,
            },
          };
        });
      },
      [controlsByBucket, deferredGlobalSearch, resolveSort]
    );

    const reloadAllBuckets = useCallback(() => {
      for (const bucket of buckets) {
        void loadBucket(bucket, { append: false });
      }
    }, [buckets, loadBucket]);

    useEffect(() => {
      for (const bucket of buckets) {
        if (!bucket.initialPage) {
          void loadBucket(bucket);
        }
      }
    }, [buckets, loadBucket]);

    useEffect(() => {
      if (skipGlobalSearchEffectRef.current) {
        skipGlobalSearchEffectRef.current = false;
        return;
      }
      const timeout = window.setTimeout(() => {
        for (const bucket of buckets) {
          void loadBucket(bucket, { append: false });
        }
      }, 300);
      return () => window.clearTimeout(timeout);
    }, [deferredGlobalSearch, globalSort, buckets, loadBucket]);

    const skipBucketSearchEffectRef = useRef(true);
    useEffect(() => {
      if (skipBucketSearchEffectRef.current) {
        skipBucketSearchEffectRef.current = false;
        return;
      }
      const timeout = window.setTimeout(() => {
        for (const bucket of buckets) {
          const localSearch = (deferredBucketSearch[bucket.id] || defaultControls).search.trim();
          void loadBucket(bucket, { append: false, search: localSearch });
        }
      }, 300);
      return () => window.clearTimeout(timeout);
    }, [deferredBucketSearch, buckets, deferredGlobalSearch, loadBucket]);

    useEffect(() => {
      if (!initialFocusedTaskId) return;
      let cancelled = false;
      (async () => {
        const result = await fetchTaskByIdAction(initialFocusedTaskId);
        if (cancelled || !result.success || !result.task) return;
        const task = result.task as Task;
        setLoadStateByBucket((prev) => {
          const next = { ...prev };
          for (const bucket of buckets) {
            const state = next[bucket.id];
            if (!state) continue;
            if (state.tasks.some((t) => t.id === task.id)) continue;
            next[bucket.id] = {
              ...state,
              tasks: [task, ...state.tasks],
            };
          }
          return next;
        });
      })();
      return () => {
        cancelled = true;
      };
    }, [initialFocusedTaskId, buckets]);

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
        const loadState = loadStateByBucket[bucket.id] || buildInitialLoadState(bucket);
        return {
          ...bucket,
          visibleTasks: loadState.tasks,
          loadState,
          controls: bucketControls,
          selectedSort: resolveSort(bucket, bucketControls),
        };
      });
    }, [buckets, controlsByBucket, loadStateByBucket, resolveSort]);

    const setAllBucketsCollapsed = useCallback(
      (collapsed: boolean) => {
        setControlsByBucket((prev) => {
          let hasChanges = false;
          const next: Record<string, BucketControls> = { ...prev };
          for (const bucket of buckets) {
            const existing = prev[bucket.id] || defaultControls;
            if (existing.collapsed === collapsed) continue;
            hasChanges = true;
            next[bucket.id] = {
              ...existing,
              collapsed,
            };
          }
          return hasChanges ? next : prev;
        });
      },
      [buckets]
    );

    useImperativeHandle(
      ref,
      () => ({
        setAllBucketsCollapsed,
      }),
      [setAllBucketsCollapsed]
    );

    useEffect(() => {
      if (!onCollapseSummaryChange) return;
      const collapsed = processedBuckets.reduce(
        (count, bucket) => count + (bucket.controls.collapsed ? 1 : 0),
        0
      );
      onCollapseSummaryChange({
        total: processedBuckets.length,
        collapsed,
      });
    }, [onCollapseSummaryChange, processedBuckets]);

    useEffect(() => {
      const mediaQuery = window.matchMedia('(max-width: 767px)');
      const applyMatch = () => setIsMobileViewport(mediaQuery.matches);
      applyMatch();
      mediaQuery.addEventListener('change', applyMatch);
      return () => mediaQuery.removeEventListener('change', applyMatch);
    }, []);

    const compactBoardMaxWidth = isMobileViewport
      ? null
      : processedBuckets.length <= 1
        ? '520px'
        : processedBuckets.length === 2
          ? currentRole === 'MANAGER'
            ? 'calc(50% - 0.4375rem)'
            : '1040px'
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
              className="w-full sm:w-auto sm:min-w-[170px] rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700 focus:border-blue-400 focus:outline-none focus:ring-1 focus:ring-blue-300"
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
                reloadAllBuckets();
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
            gridTemplateColumns: isMobileViewport
              ? 'repeat(1, minmax(0, 1fr))'
              : `repeat(${processedBuckets.length}, minmax(0, 1fr))`,
            ...(compactBoardMaxWidth ? { maxWidth: compactBoardMaxWidth } : {}),
          }}
        >
          {processedBuckets.map((bucket) => {
            const isCollapsed = bucket.controls.collapsed;
            const selectedIds = selectedTaskIdsByBucket[bucket.id] || [];
            const selectedCount = selectedIds.length;
            const isLoReturnedBucket =
              currentRole === 'LOAN_OFFICER' && bucket.id === 'returned-to-disclosure';
            const { loadState } = bucket;
            const displayTotal = loadState.totalMatching;
            const loadedCount = loadState.tasks.length;
            const countLabel =
              loadedCount < displayTotal ? `${loadedCount}/${displayTotal}` : `${displayTotal}`;

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
                      <span
                        className="inline-flex h-7 min-w-7 shrink-0 items-center justify-center rounded-full bg-slate-100 px-2 text-xs font-bold text-slate-700 shadow-sm ring-1 ring-slate-200/60"
                        title={`${loadedCount} loaded of ${displayTotal} matching`}
                      >
                        {countLabel}
                      </span>
                      <button
                        type="button"
                        onClick={() =>
                          updateBucketControls(bucket.id, {
                            collapsed: !bucket.controls.collapsed,
                          })
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

                  <div className="flex flex-col gap-1.5 sm:flex-row sm:flex-wrap sm:items-center">
                    <label className="relative w-full sm:min-w-[120px] sm:flex-1">
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
                      onChange={(event) => {
                        const sort = event.target.value as LocalSortOption;
                        updateBucketControls(bucket.id, { sort });
                        void loadBucket(bucket, {
                          append: false,
                          sort: sort === 'global' ? undefined : sort,
                        });
                      }}
                      className="w-full sm:w-auto sm:min-w-[125px] rounded-md border border-slate-200 bg-white px-2 py-1.5 text-[11px] font-medium text-slate-700 focus:border-blue-400 focus:outline-none focus:ring-1 focus:ring-blue-300"
                    >
                      <option value="global">Use Global ({sortLabelByValue[globalSort]})</option>
                      {sortOptions.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                    {enableBatchDelete && (
                      <>
                        <button
                          type="button"
                          onClick={() =>
                            setSelectedTaskIdsByBucket((prev) => ({
                              ...prev,
                              [bucket.id]: bucket.visibleTasks.map((task) => task.id),
                            }))
                          }
                          className="rounded-md border border-slate-200 bg-slate-50 px-2 py-1.5 text-[11px] font-semibold text-slate-700 hover:bg-slate-100"
                        >
                          Select Visible
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            setSelectedTaskIdsByBucket((prev) => ({
                              ...prev,
                              [bucket.id]: [],
                            }))
                          }
                          className="rounded-md border border-slate-200 bg-white px-2 py-1.5 text-[11px] font-semibold text-slate-600 hover:bg-slate-50"
                        >
                          Clear
                        </button>
                        <button
                          type="button"
                          disabled={selectedCount === 0 || batchDeletingBucketId === bucket.id}
                          onClick={async () => {
                            if (selectedCount === 0) return;
                            const confirmed = window.confirm(
                              `Delete ${selectedCount} selected task(s) from this bucket?`
                            );
                            if (!confirmed) return;
                            setBatchDeletingBucketId(bucket.id);
                            let failed = 0;
                            for (const taskId of selectedIds) {
                              const result = await deleteTask(taskId);
                              if (!result.success) failed += 1;
                            }
                            setBatchDeletingBucketId(null);
                            setSelectedTaskIdsByBucket((prev) => ({
                              ...prev,
                              [bucket.id]: [],
                            }));
                            if (failed > 0) {
                              alert(
                                `${failed} task(s) failed to delete. The rest were deleted successfully.`
                              );
                            }
                            router.refresh();
                          }}
                          className="rounded-md border border-rose-200 bg-rose-50 px-2 py-1.5 text-[11px] font-semibold text-rose-700 hover:bg-rose-100 disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          {batchDeletingBucketId === bucket.id
                            ? `Deleting...`
                            : selectedCount > 0
                              ? `Delete Selected (${selectedCount})`
                              : 'Delete Selected'}
                        </button>
                      </>
                    )}
                  </div>
                </div>

                {isCollapsed ? null : (
                  <BucketScrollArea
                    bucketScrollMode={bucketScrollMode}
                    fixedScrollClassName={fixedScrollClassName}
                    hasMore={loadState.hasMore}
                    isLoadingMore={loadState.isLoadingMore}
                    onLoadMore={() => {
                      if (!loadState.hasMore || loadState.isLoadingMore) return;
                      void loadBucket(bucket, {
                        append: true,
                        cursor: loadState.nextCursor,
                      });
                    }}
                  >
                    {loadState.isLoading && bucket.visibleTasks.length === 0 ? (
                      <div className="flex justify-center py-8">
                        <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
                      </div>
                    ) : loadState.error ? (
                      <p className="py-4 text-center text-xs font-medium text-rose-600">
                        {loadState.error}
                      </p>
                    ) : (
                      <TaskList
                        tasks={bucket.visibleTasks}
                        canDelete={canDelete}
                        currentRole={currentRole}
                        currentUserId={currentUserId}
                        jrAssigneeOptions={jrAssigneeOptions}
                        initialFocusedTaskId={initialFocusedTaskId}
                        enableTaskSelection={enableBatchDelete}
                        selectedTaskIds={new Set(selectedIds)}
                        onToggleTaskSelection={(taskId, selected) => {
                          setSelectedTaskIdsByBucket((prev) => {
                            const existing = prev[bucket.id] || [];
                            const has = existing.includes(taskId);
                            if (selected && !has) {
                              return { ...prev, [bucket.id]: [...existing, taskId] };
                            }
                            if (!selected && has) {
                              return {
                                ...prev,
                                [bucket.id]: existing.filter((id) => id !== taskId),
                              };
                            }
                            return prev;
                          });
                        }}
                        emptyState={
                          bucket.visibleTasks.length === 0 &&
                          Boolean(deferredGlobalSearch || bucket.controls.search.trim())
                            ? 'no_results'
                            : 'all_caught_up'
                        }
                      />
                    )}
                  </BucketScrollArea>
                )}
              </div>
            );
          })}
        </div>
      </div>
    );
  }
);

TaskBucketsBoard.displayName = 'TaskBucketsBoard';
