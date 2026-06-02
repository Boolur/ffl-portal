import { Prisma, UserRole } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { withPerfMetric } from '@/lib/perf';
import { hydrateTaskRows } from '@/lib/tasks/hydrateTaskRows';
import { buildTaskSearchWhere } from '@/lib/tasks/taskBucketSearch';
import { buildBucketOrderBy, defaultSortForRole } from '@/lib/tasks/taskBucketSort';
import { buildScopedBucketWhere } from '@/lib/tasks/taskBucketWhere';
import type { TaskDeskKey } from '@/lib/tasks/types';
import { taskListInclude } from '@/lib/tasks/taskInclude';
import { buildRoleScopedTaskWhere } from '@/lib/tasks/taskScope';
import {
  BUCKET_TASK_PAGE_SIZE,
  type TaskBucketCursor,
  type TaskBucketId,
  type TaskBucketSort,
  type TaskRow,
} from '@/lib/tasks/types';

export type FetchTaskBucketPageInput = {
  bucketId: TaskBucketId;
  role: UserRole;
  userId?: string;
  deskKey?: TaskDeskKey;
  sort: TaskBucketSort;
  search?: string;
  cursor?: TaskBucketCursor | null;
  limit?: number;
};

export type FetchTaskBucketPageResult = {
  tasks: TaskRow[];
  nextCursor: TaskBucketCursor | null;
  totalMatching: number;
  hasMore: boolean;
};

function buildPageWhere(input: FetchTaskBucketPageInput): Prisma.TaskWhereInput | null {
  const bucketScoped = buildScopedBucketWhere(
    input.bucketId,
    input.role,
    input.userId,
    input.deskKey
  );
  if (bucketScoped === null) return null;

  const searchWhere = buildTaskSearchWhere(input.search);
  const clauses: Prisma.TaskWhereInput[] = [bucketScoped];
  if (searchWhere) clauses.push(searchWhere);

  return clauses.length === 1 ? clauses[0] : { AND: clauses };
}

export async function fetchTaskBucketPage(
  input: FetchTaskBucketPageInput
): Promise<FetchTaskBucketPageResult> {
  const limit = input.limit ?? BUCKET_TASK_PAGE_SIZE;
  const offset = input.cursor?.offset ?? 0;
  const where = buildPageWhere(input);

  if (!where) {
    return { tasks: [], nextCursor: null, totalMatching: 0, hasMore: false };
  }

  const [totalMatching, rawTasks] = await Promise.all([
    withPerfMetric('query.tasks.count.bucket', () => prisma.task.count({ where }), {
      bucketId: input.bucketId,
      role: input.role,
    }),
    withPerfMetric(
      'query.tasks.findMany.bucketPage',
      () =>
        prisma.task.findMany({
          where,
          include: taskListInclude,
          orderBy: buildBucketOrderBy(input.sort),
          skip: offset,
          take: limit + 1,
        }),
      { bucketId: input.bucketId, role: input.role, limit, offset }
    ),
  ]);

  const hasMore = rawTasks.length > limit;
  const pageTasks = hasMore ? rawTasks.slice(0, limit) : rawTasks;
  const tasks = await hydrateTaskRows(pageTasks, input.role);

  return {
    tasks,
    nextCursor: hasMore ? { offset: offset + limit } : null,
    totalMatching,
    hasMore,
  };
}

export async function getScopedTaskCount(role: UserRole, userId?: string): Promise<number> {
  const where = buildRoleScopedTaskWhere(role, userId);
  return prisma.task.count({
    where: Object.keys(where).length === 0 ? undefined : where,
  });
}

export async function getTaskBucketCounts(
  buckets: Array<{ id: TaskBucketId; deskKey?: TaskDeskKey }>,
  role: UserRole,
  userId?: string
): Promise<Record<string, number>> {
  const entries = await Promise.all(
    buckets.map(async (bucket) => {
      const where = buildScopedBucketWhere(bucket.id, role, userId, bucket.deskKey);
      if (!where) return [bucket.id, 0] as const;
      const count = await prisma.task.count({ where });
      return [bucket.id, count] as const;
    })
  );
  return Object.fromEntries(entries);
}

export async function fetchTaskById(
  taskId: string,
  role: UserRole,
  userId?: string
): Promise<TaskRow | null> {
  const scope = buildRoleScopedTaskWhere(role, userId);
  const where: Prisma.TaskWhereInput = {
    id: taskId,
    ...(Object.keys(scope).length > 0 ? scope : {}),
  };

  const raw = await prisma.task.findFirst({
    where,
    include: taskListInclude,
  });
  if (!raw) return null;
  const [hydrated] = await hydrateTaskRows([raw], role);
  return hydrated || null;
}

export async function seedBucketFirstPages(
  buckets: Array<{
    id: TaskBucketId;
    deskKey?: TaskDeskKey;
    isCompleted?: boolean;
  }>,
  role: UserRole,
  userId?: string
): Promise<
  Record<
    string,
    {
      tasks: TaskRow[];
      nextCursor: TaskBucketCursor | null;
      totalMatching: number;
      hasMore: boolean;
    }
  >
> {
  const entries = await Promise.all(
    buckets.map(async (bucket) => {
      const sort = defaultSortForRole(role, bucket.isCompleted);
      const page = await fetchTaskBucketPage({
        bucketId: bucket.id,
        role,
        userId,
        deskKey: bucket.deskKey,
        sort,
      });
      return [bucket.id, page] as const;
    })
  );

  return Object.fromEntries(entries);
}
