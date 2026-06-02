'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { TaskList, type Task } from '@/components/tasks/TaskList';
import { fetchTaskBucketPageAction } from '@/app/actions/taskQueryActions';
import { defaultSortForRole } from '@/lib/tasks/taskBucketSort';
import type { TaskBucketCursor } from '@/lib/tasks/types';

type Props = {
  canDelete: boolean;
  currentRole: string;
  currentUserId?: string;
  jrAssigneeOptions?: Array<{ id: string; name: string }>;
  initialFocusedTaskId?: string | null;
  initialPage?: {
    tasks: Task[];
    nextCursor: TaskBucketCursor | null;
    totalMatching: number;
    hasMore: boolean;
  };
  totalCount: number;
};

export function PaginatedTaskList({
  canDelete,
  currentRole,
  currentUserId,
  jrAssigneeOptions = [],
  initialFocusedTaskId,
  initialPage,
  totalCount,
}: Props) {
  const [tasks, setTasks] = useState<Task[]>(initialPage?.tasks ?? []);
  const [nextCursor, setNextCursor] = useState<TaskBucketCursor | null>(
    initialPage?.nextCursor ?? null
  );
  const [hasMore, setHasMore] = useState(initialPage?.hasMore ?? false);
  const [totalMatching, setTotalMatching] = useState(
    initialPage?.totalMatching ?? totalCount
  );
  const [isLoading, setIsLoading] = useState(!initialPage);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const sort = defaultSortForRole(currentRole);

  const loadPage = useCallback(
    async (append: boolean, cursor: TaskBucketCursor | null) => {
      if (append) setIsLoadingMore(true);
      else setIsLoading(true);

      const result = await fetchTaskBucketPageAction({
        bucketId: '__all__',
        sort,
        cursor: append ? cursor : null,
      });

      if (append) setIsLoadingMore(false);
      else setIsLoading(false);

      if (!result.success) return;

      setTasks((prev) => {
        if (!append) return result.tasks as Task[];
        const seen = new Set(prev.map((t) => t.id));
        const merged = [...prev];
        for (const task of result.tasks as Task[]) {
          if (!seen.has(task.id)) merged.push(task);
        }
        return merged;
      });
      setNextCursor(result.nextCursor);
      setHasMore(result.hasMore);
      setTotalMatching(result.totalMatching);
    },
    [sort]
  );

  useEffect(() => {
    if (!initialPage) {
      void loadPage(false, null);
    }
  }, [initialPage, loadPage]);

  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel || !hasMore) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting) && !isLoadingMore && nextCursor) {
          void loadPage(true, nextCursor);
        }
      },
      { rootMargin: '200px' }
    );

    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [hasMore, isLoadingMore, loadPage, nextCursor]);

  return (
    <div>
      <p className="mb-2 text-xs font-medium text-slate-500">
        Showing {tasks.length} of {totalMatching} tasks
      </p>
      {isLoading && tasks.length === 0 ? (
        <div className="flex justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
        </div>
      ) : (
        <TaskList
          tasks={tasks}
          canDelete={canDelete}
          currentRole={currentRole}
          currentUserId={currentUserId}
          jrAssigneeOptions={jrAssigneeOptions}
          initialFocusedTaskId={initialFocusedTaskId}
        />
      )}
      {hasMore ? (
        <div ref={sentinelRef} className="flex justify-center py-4">
          {isLoadingMore ? (
            <Loader2 className="h-5 w-5 animate-spin text-slate-400" />
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
