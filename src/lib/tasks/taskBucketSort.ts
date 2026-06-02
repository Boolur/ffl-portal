import { Prisma } from '@prisma/client';
import type { TaskBucketSort } from '@/lib/tasks/types';

export function buildBucketOrderBy(sort: TaskBucketSort): Prisma.TaskOrderByWithRelationInput[] {
  switch (sort) {
    case 'created_asc':
      return [{ createdAt: 'asc' }, { id: 'asc' }];
    case 'created_desc':
      return [{ createdAt: 'desc' }, { id: 'desc' }];
    case 'updated_asc':
      return [{ updatedAt: 'asc' }, { id: 'asc' }];
    case 'updated_desc':
      return [{ updatedAt: 'desc' }, { id: 'desc' }];
    case 'borrower_asc':
      return [{ loan: { borrowerName: 'asc' } }, { id: 'asc' }];
    case 'borrower_desc':
      return [{ loan: { borrowerName: 'desc' } }, { id: 'desc' }];
    default:
      return [{ updatedAt: 'desc' }, { id: 'desc' }];
  }
}

export function defaultSortForRole(role: string, bucketIsCompleted?: boolean): TaskBucketSort {
  if (bucketIsCompleted) return 'updated_desc';
  if (
    role === 'DISCLOSURE_SPECIALIST' ||
    role === 'QC' ||
    role === 'MANAGER' ||
    role === 'VA' ||
    role === 'VA_TITLE' ||
    role === 'VA_PAYOFF' ||
    role === 'VA_APPRAISAL' ||
    role === 'PROCESSOR_JR' ||
    role === 'ADMIN' ||
    role === 'ADMIN_I' ||
    role === 'ADMIN_II' ||
    role === 'ADMIN_III'
  ) {
    return 'created_asc';
  }
  return 'updated_desc';
}
