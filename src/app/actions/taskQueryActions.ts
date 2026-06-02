'use server';

import { getServerSession } from 'next-auth';
import { UserRole } from '@prisma/client';
import { authOptions } from '@/lib/auth';
import {
  fetchTaskBucketPage,
  fetchTaskById,
  getScopedTaskCount,
  getTaskBucketCounts,
  type FetchTaskBucketPageInput,
  type FetchTaskBucketPageResult,
} from '@/lib/tasks/fetchTaskRows';
import type {
  TaskBucketCursor,
  TaskBucketId,
  TaskBucketSort,
  TaskDeskKey,
  TaskRow,
} from '@/lib/tasks/types';
import { isTaskBucketId } from '@/lib/tasks/types';

async function getSessionContext() {
  const session = await getServerSession(authOptions);
  const role = (session?.user?.activeRole || session?.user?.role || UserRole.LOAN_OFFICER) as UserRole;
  const userId = session?.user?.id || undefined;
  return { role, userId };
}

export async function getScopedTaskCountAction(): Promise<number> {
  const { role, userId } = await getSessionContext();
  return getScopedTaskCount(role, userId);
}

export async function getTaskBucketCountsAction(
  buckets: Array<{ id: string; deskKey?: TaskDeskKey }>
): Promise<Record<string, number>> {
  const { role, userId } = await getSessionContext();
  const valid = buckets.filter((b) => isTaskBucketId(b.id)) as Array<{
    id: TaskBucketId;
    deskKey?: TaskDeskKey;
  }>;
  return getTaskBucketCounts(valid, role, userId);
}

export async function fetchTaskBucketPageAction(input: {
  bucketId: string;
  deskKey?: TaskDeskKey;
  sort: TaskBucketSort;
  search?: string;
  cursor?: TaskBucketCursor | null;
  limit?: number;
}): Promise<FetchTaskBucketPageResult & { success: boolean; error?: string }> {
  try {
    if (!isTaskBucketId(input.bucketId)) {
      return {
        success: false,
        error: 'Invalid bucket',
        tasks: [],
        nextCursor: null,
        totalMatching: 0,
        hasMore: false,
      };
    }
    const { role, userId } = await getSessionContext();
    const page = await fetchTaskBucketPage({
      bucketId: input.bucketId,
      deskKey: input.deskKey,
      role,
      userId,
      sort: input.sort,
      search: input.search,
      cursor: input.cursor,
      limit: input.limit,
    } satisfies FetchTaskBucketPageInput);
    return { success: true, ...page };
  } catch (error) {
    console.error('fetchTaskBucketPageAction failed', error);
    return {
      success: false,
      error: 'Failed to load tasks',
      tasks: [],
      nextCursor: null,
      totalMatching: 0,
      hasMore: false,
    };
  }
}

export async function fetchTaskByIdAction(
  taskId: string
): Promise<{ success: boolean; task: TaskRow | null; error?: string }> {
  try {
    const { role, userId } = await getSessionContext();
    const task = await fetchTaskById(taskId, role, userId);
    return { success: true, task };
  } catch (error) {
    console.error('fetchTaskByIdAction failed', error);
    return { success: false, task: null, error: 'Failed to load task' };
  }
}
