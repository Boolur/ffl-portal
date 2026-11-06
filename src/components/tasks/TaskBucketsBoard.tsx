'use client';

import React, {
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { ChevronDown, ChevronUp, Search } from 'lucide-react';
import { TaskList, type Task } from '@/components/tasks/TaskList';
import { deleteTask, loadTaskBucketCount, loadTaskBucketPage } from '@/app/actions/taskActions';
import { appendTaskBucketPage, defaultTaskBucketSort, TaskBucketRequestGate, withTaskBucketTimeout } from '@/lib/taskBucketClientState';
import { loadTaskBucketWindow, readTaskWorkspaceCache, taskSeedSignature, taskWorkspaceCacheEpoch, taskWorkspaceKey, writeTaskWorkspaceCache, type TaskWorkspaceSnapshot } from '@/lib/taskWorkspaceCache';
import { publishPortalUpdates, subscribePortalUpdates } from '@/lib/portalLiveUpdates';

type SortOption =
  | 'updated_desc'
  | 'updated_asc'
  | 'created_asc'
  | 'created_desc'
  | 'borrower_asc'
  | 'borrower_desc';
type LocalSortOption = 'global' | SortOption;
type TaskBucketCursor = { id: string } | null;

type BucketConfig = {
  id: string;
  sectionId?: string;
  label: string;
  chipLabel: string;
  chipClassName: string;
  isCompleted?: boolean;
  tasks: Task[];
  totalCount?: number;
  totalCountIsExact?: boolean;
  nextCursor?: TaskBucketCursor;
  serverPagination?: true;
  serverSort?: SortOption;
};

type BucketControls = {
  collapsed: boolean;
  search: string;
  sort: LocalSortOption;
};

type ServerBucketState = {
  queryKey: string;
  tasks: Task[];
  totalCount: number;
  totalCountIsExact: boolean;
  nextCursor: TaskBucketCursor;
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

function normalizeDate(value?: Date | string) {
  if (!value) return 0;
  const time = value instanceof Date ? value.getTime() : new Date(value).getTime();
  return Number.isFinite(time) ? time : 0;
}

function normalizeBorrower(task: Task) {
  return task.loan.borrowerName.trim().toLowerCase();
}

function normalizeSearch(task: Task) {
  const tokens = new Set<string>();
  const addCommonSearchAliases = (normalized: string) => {
    if (normalized.includes('united wholesale mortgage')) tokens.add('uwm');
    if (normalized === 'uwm') tokens.add('united wholesale mortgage');
  };
  const pushToken = (value: unknown) => {
    if (value === null || value === undefined) return;
    const normalized = String(value).trim().toLowerCase();
    if (!normalized) return;
    tokens.add(normalized);
    addCommonSearchAliases(normalized);
  };
  const collectFromValue = (value: unknown, depth = 0) => {
    if (depth > 4 || value === null || value === undefined) return;
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      pushToken(value);
      return;
    }
    if (Array.isArray(value)) {
      for (const entry of value.slice(0, 80)) {
        collectFromValue(entry, depth + 1);
      }
      return;
    }
    if (typeof value === 'object') {
      for (const entry of Object.values(value as Record<string, unknown>)) {
        collectFromValue(entry, depth + 1);
      }
    }
  };

  pushToken(task.loan.borrowerName);
  pushToken(task.loan.loanNumber);
  pushToken(task.title);
  pushToken(task.description);
  pushToken(task.loan.loanOfficer?.name || '');
  pushToken(task.loan.secondaryLoanOfficer?.name || '');
  pushToken(task.assignedUser?.name || '');
  collectFromValue(task.submissionData);
  collectFromValue(task.parentTask?.submissionData);

  return Array.from(tokens).join(' ');
}

function sortTasks(tasks: Task[], sortBy: SortOption) {
  return tasks
    .map((task, index) => ({ task, index }))
    .sort((a, b) => {
      if (sortBy === 'created_asc') {
        return normalizeDate(a.task.createdAt) - normalizeDate(b.task.createdAt) || a.index - b.index;
      }
      if (sortBy === 'created_desc') {
        return normalizeDate(b.task.createdAt) - normalizeDate(a.task.createdAt) || a.index - b.index;
      }
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

type TaskBucketsBoardProps = {
  buckets: BucketConfig[];
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

const TaskBucketsBoardContent = React.forwardRef<TaskBucketsBoardHandle, TaskBucketsBoardProps & { identity: string; workspaceKey: string }>(
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
      identity,
      workspaceKey,
    },
    ref
  ) {
  const router = useRouter();
  const defaultGlobalSort = defaultTaskBucketSort(currentRole);
  const [restored] = useState(() => readTaskWorkspaceCache<Task>(workspaceKey));
  const [cacheEpoch] = useState(taskWorkspaceCacheEpoch);
  const [globalSearch, setGlobalSearch] = useState(restored?.globalSearch || '');
  const [globalSort, setGlobalSort] = useState<SortOption>((restored?.globalSort as SortOption) || defaultGlobalSort);
  const [controlsByBucket, setControlsByBucket] = useState<Record<string, BucketControls>>(
    (restored?.controlsByBucket as Record<string, BucketControls>) || {}
  );
  const [selectedTaskIdsByBucket, setSelectedTaskIdsByBucket] = useState<Record<string, string[]>>(
    {}
  );
  const [batchDeletingBucketId, setBatchDeletingBucketId] = useState<string | null>(null);
  const [isMobileViewport, setIsMobileViewport] = useState(false);
  const [serverBucketState, setServerBucketState] = useState<Record<string, ServerBucketState>>(() => restored?.pages || Object.fromEntries(
    buckets.filter(bucket => bucket.serverPagination).map(bucket => [bucket.id, {
      queryKey: JSON.stringify({ identity, globalSearch: '', bucketSearch: '', sort: bucket.serverSort || (bucket.isCompleted ? 'updated_desc' : defaultGlobalSort), sectionId: bucket.sectionId || '' }),
      tasks: bucket.tasks,
      totalCount: bucket.totalCount ?? bucket.tasks.length,
      totalCountIsExact: bucket.totalCountIsExact ?? !bucket.nextCursor,
      nextCursor: bucket.nextCursor || null,
    }])
  ));
  const [loadingBucketIds, setLoadingBucketIds] = useState<Set<string>>(() => new Set());
  const [loadingCountBucketIds, setLoadingCountBucketIds] = useState<Set<string>>(() => new Set());
  const pageRequests = useRef(new TaskBucketRequestGate());
  const countRequests = useRef(new TaskBucketRequestGate());
  const lastPageRequest = useRef<Record<string, { cursor: TaskBucketCursor; mode: 'replace' | 'append' | 'refresh' }>>({});
  const seedSignature = useMemo(() => taskSeedSignature(buckets), [buckets]);
  const lastSeed = useRef(seedSignature);
  const [refreshGeneration, setRefreshGeneration] = useState(restored ? 1 : 0);
  const attemptedRefresh = useRef(0);
  const generationRef = useRef(refreshGeneration);
  const validatedAt = useRef(restored?.validatedAt || Date.now());
  const [interactionByBucket, setInteractionByBucket] = useState<Record<string, boolean>>({});
  const interacting = useRef(false);
  useLayoutEffect(() => { interacting.current = Object.values(interactionByBucket).some(Boolean); }, [interactionByBucket]);
  const scrollTopByBucket = useRef<Record<string, number>>({ ...restored?.scrollTopByBucket });
  const scrollElements = useRef<Record<string, HTMLDivElement | null>>({});
  const snapshotRef = useRef<TaskWorkspaceSnapshot<Task> | null>(null);
  const mounted = useRef(true);
  useEffect(() => {
    generationRef.current = refreshGeneration;
  }, [refreshGeneration]);
  useEffect(() => {
    if (lastSeed.current === seedSignature) return;
    lastSeed.current = seedSignature;
    setRefreshGeneration(value => value + 1);
  }, [seedSignature]);
  useEffect(() => subscribePortalUpdates('tasks', () => setRefreshGeneration(value => value + 1)), []);
  useEffect(() => {
    const resumePending = () => {
      if (document.visibilityState === 'visible' && generationRef.current > attemptedRefresh.current) {
        setRefreshGeneration(value => value + 1);
      }
    };
    document.addEventListener('visibilitychange', resumePending);
    return () => document.removeEventListener('visibilitychange', resumePending);
  }, []);
  useEffect(() => {
    const snapshot: TaskWorkspaceSnapshot<Task> = {
      savedAt: Date.now(), validatedAt: validatedAt.current, seedSignature,
      globalSearch, globalSort, controlsByBucket, pages: serverBucketState,
      scrollTopByBucket: { ...scrollTopByBucket.current },
    };
    snapshotRef.current = snapshot;
    writeTaskWorkspaceCache(workspaceKey, snapshot, cacheEpoch);
  }, [workspaceKey, cacheEpoch, seedSignature, globalSearch, globalSort, controlsByBucket, serverBucketState]);
  useEffect(() => {
    mounted.current = true;
    const pages = pageRequests.current;
    const counts = countRequests.current;
    const scrollPositions = scrollTopByBucket.current;
    return () => {
      mounted.current = false;
      for (const bucket of buckets) {
        pages.setQuery(bucket.id, 'unmounted');
        counts.setQuery(bucket.id, 'unmounted');
      }
      if (snapshotRef.current) writeTaskWorkspaceCache(workspaceKey, {
        ...snapshotRef.current, savedAt: Date.now(), scrollTopByBucket: { ...scrollPositions },
      }, cacheEpoch);
    };
  // This instance is keyed by workspace/identity; incoming server props must not unmount it.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceKey, cacheEpoch]);
  useLayoutEffect(() => {
    for (const [id, top] of Object.entries(scrollTopByBucket.current)) {
      const element = scrollElements.current[id];
      if (element) element.scrollTop = top;
    }
  }, []);
  const searchInput = JSON.stringify({
    global: globalSearch.trim().toLowerCase(),
    buckets: Object.fromEntries(Object.entries(controlsByBucket).map(([id, controls]) => [id, controls.search.trim().toLowerCase()])),
  });
  const [debouncedSearchInput, setDebouncedSearchInput] = useState(searchInput);
  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedSearchInput(searchInput), 300);
    return () => window.clearTimeout(timer);
  }, [searchInput]);
  const debouncedSearch = useMemo(() => JSON.parse(debouncedSearchInput) as {
    global: string;
    buckets: Record<string, string>;
  }, [debouncedSearchInput]);
  const deferredGlobalSearch = debouncedSearch.global;
  const searchableTextByTaskId = useMemo(() => {
    const next = new Map<string, string>();
    for (const bucket of buckets) {
      for (const task of bucket.tasks) {
        if (next.has(task.id)) continue;
        next.set(task.id, normalizeSearch(task));
      }
    }
    return next;
  }, [buckets]);
  const updateBucketControls = (bucketId: string, next: Partial<BucketControls>) => {
    setControlsByBucket((prev) => ({
      ...prev,
      [bucketId]: {
        ...(prev[bucketId] || defaultControls),
        ...next,
      },
    }));
  };

  const getSelectedSort = useCallback(
    (bucket: BucketConfig, bucketControls: BucketControls): SortOption =>
      bucketControls.sort === 'global'
        ? bucket.isCompleted
          ? 'updated_desc'
          : globalSort
        : bucketControls.sort,
    [globalSort]
  );

  const getServerQueryKey = useCallback(
    (bucket: BucketConfig, selectedSort: SortOption) =>
      JSON.stringify({
        identity,
        globalSearch: deferredGlobalSearch,
        bucketSearch: debouncedSearch.buckets[bucket.id] || '',
        sort: selectedSort,
        sectionId: bucket.sectionId || '',
      }),
    [identity, deferredGlobalSearch, debouncedSearch.buckets]
  );

  const isInitialServerQuery = useCallback(
    (bucket: BucketConfig, bucketControls: BucketControls, selectedSort: SortOption) =>
      !deferredGlobalSearch &&
      !debouncedSearch.buckets[bucket.id] &&
      bucketControls.sort === 'global' &&
      selectedSort === (bucket.serverSort || (bucket.isCompleted ? 'updated_desc' : defaultGlobalSort)),
    [defaultGlobalSort, deferredGlobalSearch, debouncedSearch.buckets]
  );

  const processedBuckets = useMemo(() => {
    return buckets.map((bucket) => {
      const bucketControls = controlsByBucket[bucket.id] || defaultControls;
      const deferredLocalSearch = debouncedSearch.buckets[bucket.id] || '';
      const selectedSort = getSelectedSort(bucket, bucketControls);
      const serverQueryKey = getServerQueryKey(bucket, selectedSort);
      const state = serverBucketState[bucket.id];
      const hasMatchingServerState = state?.queryKey === serverQueryKey;
      const useInitialServerPage =
        bucket.serverPagination &&
        !hasMatchingServerState &&
        isInitialServerQuery(bucket, bucketControls, selectedSort);
      const isServerPending =
        Boolean(bucket.serverPagination) && !hasMatchingServerState && !useInitialServerPage;
      if (bucket.serverPagination) {
        const serverTasks = hasMatchingServerState
          ? state.tasks
          : useInitialServerPage
          ? bucket.tasks
          : [];
        return {
          ...bucket,
          visibleTasks: serverTasks,
          totalCount: hasMatchingServerState
            ? state.totalCount
            : bucket.totalCount ?? serverTasks.length,
          totalCountIsExact: hasMatchingServerState
            ? state.totalCountIsExact
            : bucket.totalCountIsExact ?? !bucket.nextCursor,
          nextCursor: hasMatchingServerState
            ? state.nextCursor
            : useInitialServerPage
            ? bucket.nextCursor ?? null
            : null,
          controls: bucketControls,
          serverSearch: deferredLocalSearch,
          selectedSort,
          serverQueryKey,
          requestQueryKey: `${serverQueryKey}:${refreshGeneration}`,
          isServerLoading: loadingBucketIds.has(bucket.id) || isServerPending,
          isServerPending,
        };
      }
      const filtered = bucket.tasks.filter((task) => {
        const searchable = searchableTextByTaskId.get(task.id) || '';
        if (deferredGlobalSearch && !searchable.includes(deferredGlobalSearch)) return false;
        if (deferredLocalSearch && !searchable.includes(deferredLocalSearch)) return false;
        return true;
      });
      const sorted = sortTasks(filtered, selectedSort);
      return {
        ...bucket,
        visibleTasks: sorted,
        controls: bucketControls,
        serverSearch: deferredLocalSearch,
        selectedSort,
        serverQueryKey,
        requestQueryKey: `${serverQueryKey}:${refreshGeneration}`,
        isServerLoading: false,
        isServerPending: false,
      };
    });
  }, [
    buckets,
    controlsByBucket,
    deferredGlobalSearch,
    debouncedSearch.buckets,
    getSelectedSort,
    getServerQueryKey,
    isInitialServerQuery,
    loadingBucketIds,
    searchableTextByTaskId,
    serverBucketState,
    refreshGeneration,
  ]);
  const latestBuckets = useRef(processedBuckets);
  useLayoutEffect(() => { latestBuckets.current = processedBuckets; }, [processedBuckets]);

  useEffect(() => {
    for (const bucket of processedBuckets) {
      pageRequests.current.setQuery(bucket.id, bucket.requestQueryKey);
      countRequests.current.setQuery(bucket.id, bucket.requestQueryKey);
    }
  }, [processedBuckets]);

  const loadServerBucket = useCallback(
    async (
      bucket: (typeof processedBuckets)[number],
      cursor: TaskBucketCursor,
      mode: 'replace' | 'append' | 'refresh',
      retry = false
    ) => {
      const latest = latestBuckets.current.find(current => current.id === bucket.id && current.serverQueryKey === bucket.serverQueryKey);
      if (latest) bucket = latest;
      if (!bucket.serverPagination) return false;
      if (mode === 'refresh' && retry) pageRequests.current.supersede(bucket.id);
      const token = pageRequests.current.begin(bucket.id, bucket.requestQueryKey, retry);
      if (!token) return false;
      lastPageRequest.current[bucket.id] = { cursor, mode };
      setLoadingBucketIds((prev) => {
        const next = new Set(prev);
        next.add(bucket.id);
        return next;
      });
      let failure: string | undefined;
      try {
        const fetchPage = async (pageCursor: TaskBucketCursor, pageSize?: number) => {
          const result = await loadTaskBucketPage({
            bucketId: bucket.id,
            sectionId: bucket.sectionId,
            cursor: pageCursor,
            pageSize,
            globalSearch: deferredGlobalSearch,
            bucketSearch: bucket.serverSearch,
            sort: bucket.selectedSort,
          });
          if (!result.success) throw new Error(result.error);
          return {
            tasks: result.tasks || [],
            totalCount: result.totalCount || 0,
            totalCountIsExact: result.totalCountIsExact ?? true,
            nextCursor: result.nextCursor || null,
          };
        };
        const page = await withTaskBucketTimeout(mode === 'refresh'
          ? loadTaskBucketWindow(bucket.visibleTasks.length, fetchPage, () => mounted.current && pageRequests.current.isCurrent(token))
          : fetchPage(cursor));
        if (!pageRequests.current.isCurrent(token)) return false;
        if (mode === 'refresh' && !retry && interacting.current) {
          attemptedRefresh.current = Math.min(attemptedRefresh.current, generationRef.current - 1);
          return false;
        }
        setServerBucketState((prev) => {
          const previous = prev[bucket.id];
          const initialPage = {
            tasks: bucket.visibleTasks,
            totalCount: bucket.totalCount ?? bucket.visibleTasks.length,
            totalCountIsExact: bucket.totalCountIsExact ?? !bucket.nextCursor,
            nextCursor: bucket.nextCursor || null,
          };
          return {
            ...prev,
            [bucket.id]: {
              queryKey: bucket.serverQueryKey,
              ...(mode === 'append'
                ? appendTaskBucketPage(previous?.queryKey === bucket.serverQueryKey ? previous : initialPage, page)
                : page),
            },
          };
        });
        return true;
      } catch (error) {
        failure = error instanceof Error ? error.message : 'Unable to load tasks. Please retry.';
        return false;
      } finally {
        pageRequests.current.finish(token, failure);
        if (!pageRequests.current.isActive(bucket.id)) setLoadingBucketIds((prev) => {
          const next = new Set(prev);
          next.delete(bucket.id);
          return next;
        });
      }
    },
    [deferredGlobalSearch]
  );

  useEffect(() => {
    for (const bucket of processedBuckets) {
      if (!bucket.serverPagination) continue;
      if (loadingBucketIds.has(bucket.id)) continue;
      if (serverBucketState[bucket.id]?.queryKey === bucket.serverQueryKey) continue;
      if (isInitialServerQuery(bucket, bucket.controls, bucket.selectedSort)) continue;
      void loadServerBucket(bucket, null, 'replace');
    }
  }, [
    isInitialServerQuery,
    loadServerBucket,
    loadingBucketIds,
    processedBuckets,
    serverBucketState,
  ]);

  const loadServerCount = useCallback(async (bucket: (typeof processedBuckets)[number], retry = false) => {
      const token = countRequests.current.begin(bucket.id, bucket.requestQueryKey, retry);
    if (!token) return;
    setLoadingCountBucketIds((prev) => {
      const next = new Set(prev);
      next.add(bucket.id);
      return next;
    });
    let failure: string | undefined;
    try {
      const result = await withTaskBucketTimeout(loadTaskBucketCount({
        bucketId: bucket.id,
        sectionId: bucket.sectionId,
        globalSearch: deferredGlobalSearch,
        bucketSearch: bucket.serverSearch,
      }));
      if (!countRequests.current.isCurrent(token)) return;
      if (!result.success) throw new Error(result.error);
      setServerBucketState((prev) => {
        const previous = prev[bucket.id];
        const matching = previous?.queryKey === bucket.serverQueryKey ? previous : undefined;
        // A completed page/refresh may have supplied a newer count while this was in flight.
        if (matching?.totalCountIsExact) return prev;
        return {
          ...prev,
          [bucket.id]: {
            queryKey: bucket.serverQueryKey,
            tasks: matching?.tasks || bucket.visibleTasks,
            totalCount: result.totalCount || 0,
            totalCountIsExact: true,
            nextCursor: matching ? matching.nextCursor : bucket.nextCursor ?? null,
          },
        };
      });
    } catch (error) {
      failure = error instanceof Error ? error.message : 'Unable to update the task count.';
    } finally {
      countRequests.current.finish(token, failure);
      setLoadingCountBucketIds((prev) => {
        const next = new Set(prev);
        next.delete(bucket.id);
        return next;
      });
    }
  }, [deferredGlobalSearch]);

  useEffect(() => {
    for (const bucket of processedBuckets) {
      if (!bucket.serverPagination || bucket.totalCountIsExact || bucket.isServerPending) continue;
      if (loadingCountBucketIds.has(bucket.id)) continue;
      void loadServerCount(bucket);
    }
  }, [loadServerCount, loadingCountBucketIds, processedBuckets]);

  useEffect(() => {
    if (refreshGeneration <= attemptedRefresh.current || loadingBucketIds.size > 0 || batchDeletingBucketId) return;
    if (Object.values(interactionByBucket).some(Boolean) || document.visibilityState !== 'visible') return;
    attemptedRefresh.current = refreshGeneration;
    void (async () => {
      let allRefreshed = true;
      for (const bucket of processedBuckets) {
        if (!mounted.current || generationRef.current !== refreshGeneration) return;
        if (interacting.current) {
          attemptedRefresh.current = Math.min(attemptedRefresh.current, refreshGeneration - 1);
          return;
        }
        if (bucket.serverPagination) allRefreshed = await loadServerBucket(bucket, null, 'refresh') && allRefreshed;
      }
      if (allRefreshed && mounted.current && generationRef.current === refreshGeneration) validatedAt.current = Date.now();
    })();
  }, [refreshGeneration, loadingBucketIds, batchDeletingBucketId, interactionByBucket, processedBuckets, loadServerBucket]);

  const handleTaskDataChanged = useCallback(async (bucket: (typeof processedBuckets)[number]) => {
    // Reconcile the user's own action even while its form is still open. The live
    // invalidation also refreshes destination queues once editors are closed.
    await loadServerBucket(bucket, null, 'refresh', true);
    publishPortalUpdates(['tasks', 'overview', 'pipeline']);
  }, [loadServerBucket]);

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
          const pageError = pageRequests.current.errorForView(bucket.id, bucket.serverQueryKey);
          const countError = countRequests.current.errorForView(bucket.id, bucket.serverQueryKey);
          const selectedIds = selectedTaskIdsByBucket[bucket.id] || [];
          const selectedCount = selectedIds.length;
          const displayedCount = bucket.totalCount ?? bucket.visibleTasks.length;
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
                      {bucket.serverPagination && !bucket.totalCountIsExact
                        ? `${displayedCount}+`
                        : displayedCount}
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
                    onChange={(event) =>
                      updateBucketControls(bucket.id, {
                        sort: event.target.value as LocalSortOption,
                      })
                    }
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
                          publishPortalUpdates(['tasks', 'overview', 'pipeline']);
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
                <div
                  ref={element => {
                    if (element && scrollElements.current[bucket.id] !== element) element.scrollTop = scrollTopByBucket.current[bucket.id] || 0;
                    scrollElements.current[bucket.id] = element;
                  }}
                  className={
                    bucketScrollMode === 'fixed'
                      ? fixedScrollClassName
                      : undefined
                  }
                  onScroll={(event) => {
                    scrollTopByBucket.current[bucket.id] = event.currentTarget.scrollTop;
                    if (!bucket.serverPagination || !bucket.nextCursor || bucket.isServerLoading) {
                      return;
                    }
                    const target = event.currentTarget;
                    const remaining =
                      target.scrollHeight - target.scrollTop - target.clientHeight;
                    if (remaining > 120) return;
                    void loadServerBucket(bucket, bucket.nextCursor, 'append');
                  }}
                >
                  {bucket.isServerPending && bucket.visibleTasks.length === 0 && !pageError ? (
                    <div className="flex flex-col items-center justify-center py-12 text-center">
                      <div className="mb-3 h-8 w-8 animate-spin rounded-full border-2 border-slate-200 border-t-blue-500" />
                      <h3 className="text-sm font-bold text-slate-900">Loading...</h3>
                      <p className="mt-1 text-xs font-medium text-slate-500">
                        Searching this bucket.
                      </p>
                    </div>
                  ) : pageError && bucket.visibleTasks.length === 0 ? null : (
                    <TaskList
                      tasks={bucket.visibleTasks}
                      canDelete={canDelete}
                      currentRole={currentRole}
                      currentUserId={currentUserId}
                      jrAssigneeOptions={jrAssigneeOptions}
                      initialFocusedTaskId={initialFocusedTaskId}
                      enableTaskSelection={enableBatchDelete}
                      selectedTaskIds={new Set(selectedIds)}
                      onDataChanged={
                        bucket.serverPagination
                          ? () => handleTaskDataChanged(bucket)
                          : undefined
                      }
                      onInteractionStateChange={(busy) => setInteractionByBucket(previous => previous[bucket.id] === busy ? previous : { ...previous, [bucket.id]: busy })}
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
                  {pageError && (
                    <div role="alert" className="mt-3 space-y-2 rounded-lg border border-border bg-muted/30 p-3 text-center text-xs text-muted-foreground">
                      <p>{pageError}</p>
                      <button type="button" className="app-btn-secondary" onClick={() => {
                        const request = lastPageRequest.current[bucket.id];
                        void loadServerBucket(bucket, request?.cursor || null, request?.mode || 'replace', true);
                      }}>Retry</button>
                    </div>
                  )}
                  {countError && !bucket.totalCountIsExact && (
                    <div role="alert" className="mt-3 text-center text-xs text-muted-foreground">
                      <p>Task count could not be updated.</p>
                      <button type="button" className="app-btn-secondary mt-2" onClick={() => void loadServerCount(bucket, true)}>Retry count</button>
                    </div>
                  )}
                  {bucket.serverPagination && !pageError &&
                    !(bucket.isServerPending && bucket.visibleTasks.length === 0) && (
                    <div className="mt-3 flex flex-col items-center gap-2 border-t border-slate-100 pt-3">
                      {bucket.nextCursor ? (
                        <button
                          type="button"
                          disabled={bucket.isServerLoading}
                          onClick={() => {
                            if (!bucket.nextCursor) return;
                            void loadServerBucket(bucket, bucket.nextCursor, 'append');
                          }}
                          className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-[11px] font-semibold text-slate-700 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          {bucket.isServerLoading
                            ? 'Loading...'
                            : !bucket.totalCountIsExact ? 'Load more'
                            : `Load more (${Math.max(
                                0,
                                (bucket.totalCount || 0) - bucket.visibleTasks.length
                              )} remaining)`}
                        </button>
                      ) : bucket.isServerLoading ? (
                        <span className="text-[11px] font-semibold text-slate-500">
                          Loading...
                        </span>
                      ) : bucket.visibleTasks.length > 0 ? (
                        <span className="text-[11px] font-semibold text-slate-400">
                          All matching tasks loaded
                        </span>
                      ) : null}
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
  }
);

TaskBucketsBoardContent.displayName = 'TaskBucketsBoardContent';

export const TaskBucketsBoard = React.forwardRef<TaskBucketsBoardHandle, TaskBucketsBoardProps>(function TaskBucketsBoard(props, ref) {
  const { data: session, status } = useSession();
  const sessionRole = session?.user?.activeRole || session?.user?.role;
  const identity = JSON.stringify([props.currentUserId || '', props.currentRole, [...(session?.user?.roles || [props.currentRole])].sort()]);
  const workspaceKey = taskWorkspaceKey(identity, props.buckets);
  if (status === 'unauthenticated' ||
      (session?.user?.id && session.user.id !== props.currentUserId) ||
      (sessionRole && sessionRole !== props.currentRole)) {
    return <div role="status" className="py-8 text-center text-sm text-muted-foreground">Loading your task queues...</div>;
  }
  return <TaskBucketsBoardContent key={workspaceKey} {...props} identity={identity} workspaceKey={workspaceKey} ref={ref} />;
});
