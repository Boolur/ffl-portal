import type { PaginatedBucketConfig } from '@/components/tasks/TaskBucketsBoard';
import type { Task } from '@/components/tasks/TaskList';
import {
  getTaskBucketCounts,
  seedBucketFirstPages,
} from '@/lib/tasks/fetchTaskRows';
import type { BucketDefinitionWithDesk } from '@/lib/tasks/bucketDefinitions';
import { UserRole } from '@prisma/client';

export async function buildPaginatedBucketsForView(
  buckets: BucketDefinitionWithDesk[],
  role: UserRole,
  userId?: string
): Promise<PaginatedBucketConfig[]> {
  if (buckets.length === 0) return [];

  const bucketKeys = buckets.map((b) => ({
    id: b.id,
    deskKey: b.deskKey,
    isCompleted: b.isCompleted,
  }));

  const [counts, pages] = await Promise.all([
    getTaskBucketCounts(
      bucketKeys.map((b) => ({ id: b.id, deskKey: b.deskKey })),
      role,
      userId
    ),
    seedBucketFirstPages(bucketKeys, role, userId),
  ]);

  return buckets.map((bucket) => {
    const page = pages[bucket.id];
    return {
      id: bucket.id,
      label: bucket.label,
      chipLabel: bucket.chipLabel,
      chipClassName: bucket.chipClassName,
      isCompleted: bucket.isCompleted,
      deskKey: bucket.deskKey,
      totalCount: counts[bucket.id] ?? 0,
      initialPage: page
        ? {
            tasks: page.tasks as Task[],
            nextCursor: page.nextCursor,
            totalMatching: page.totalMatching,
            hasMore: page.hasMore,
          }
        : undefined,
    };
  });
}
