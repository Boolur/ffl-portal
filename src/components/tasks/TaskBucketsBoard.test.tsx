import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Task } from './TaskList';
import type { TaskWorkspaceSnapshot } from '../../lib/taskWorkspaceCache';

const state = vi.hoisted(() => ({ restored: null as TaskWorkspaceSnapshot<Task> | null }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock('next-auth/react', () => ({ useSession: () => ({
  status: 'authenticated', data: { user: { id: 'admin', role: 'ADMIN', roles: ['ADMIN'] } },
}) }));
vi.mock('@/components/tasks/TaskList', () => ({
  TaskList: ({ tasks }: { tasks: Task[] }) => <div data-card-count={tasks.length}>{tasks.map(task => task.id).join(',')}</div>,
}));
vi.mock('@/components/layout/PortalLoadingState', async () => import('../layout/PortalLoadingState'));
vi.mock('@/app/actions/taskActions', () => ({ deleteTask: vi.fn(), loadTaskBucketCount: vi.fn(), loadTaskBucketPage: vi.fn() }));
vi.mock('@/lib/taskBucketClientState', async () => import('../../lib/taskBucketClientState'));
vi.mock('@/lib/taskWorkspaceCache', async () => ({
  ...await import('../../lib/taskWorkspaceCache'), readTaskWorkspaceCache: () => state.restored,
}));
vi.mock('@/lib/portalLiveUpdates', () => ({ publishPortalUpdates: vi.fn(), subscribePortalUpdates: () => () => {} }));
import { TaskBucketsBoard } from './TaskBucketsBoard';

const identity = JSON.stringify(['admin', 'ADMIN', ['ADMIN']]);
const queryKey = (search = '') => JSON.stringify({ identity, globalSearch: search, bucketSearch: '', sort: 'updated_desc', sectionId: 'processing' });
const tasks = Array.from({ length: 6 }, (_, index) => ({
  id: `card-${index}`, title: 'Processing', status: 'COMPLETED',
  loan: { borrowerName: `Borrower ${index}`, loanNumber: `loan-${index}` },
})) as Task[];

function render(totalCount = 1583, totalCountIsExact = true) {
  return renderToStaticMarkup(<TaskBucketsBoard
    currentUserId="admin" currentRole="ADMIN" canDelete={false} activeBucketId={null}
    buckets={[{
      id: 'completed', sectionId: 'processing', label: 'Processing Sent/Completed',
      chipLabel: 'Completed', chipClassName: '', isCompleted: true, tasks,
      totalCount, totalCountIsExact, nextCursor: { id: 'card-5' }, serverPagination: true,
    }]}
  />);
}

function restore(search = '', cachedQuery = search) {
  state.restored = {
    savedAt: Date.now(), validatedAt: Date.now(), seedSignature: 'older-server-seed',
    globalSearch: search, globalSort: 'updated_desc', controlsByBucket: {}, scrollTopByBucket: {},
    pages: { completed: { tasks, queryKey: queryKey(cachedQuery), totalCount: 57, totalCountIsExact: true, nextCursor: null } },
  };
}

beforeEach(() => { state.restored = null; });

describe('task queue count labels', () => {
  it('shows the full queue total while keeping the first six cards paginated', () => {
    const html = render();
    expect(html).toContain('>1583</span>');
    expect(html).toContain('data-card-count="6"');
    expect(html).toContain('Load more (1577 remaining)');
    expect(html).not.toContain('role="status"');
  });

  it('shows a pending count instead of presenting a loaded lower bound as the total', () => {
    const html = render(7, false);
    expect(html).toContain('Counting…');
    expect(html).not.toContain('>7+</span>');
    expect(html).not.toContain('All matching tasks loaded');
  });

  it('reconciles a stale cached total and offers refresh when its cursor is exhausted', () => {
    restore();
    const html = render();
    expect(html).toContain('>1583</span>');
    expect(html).not.toContain('>57</span>');
    expect(html).toContain('data-card-count="6"');
    expect(html).toContain('Refresh tasks');
    expect(html).not.toContain('All matching tasks loaded');
  });

  it('retains a filtered cached count instead of merging the unfiltered server total', () => {
    restore('smith');
    const html = render();
    expect(html).toContain('>57</span>');
    expect(html).not.toContain('>1583</span>');
  });

  it('does not display an unfiltered total while a different search is pending', () => {
    restore('smith', '');
    const html = render();
    expect(html).toContain('Counting…');
    expect(html).toContain('Searching this bucket.');
    expect(html).toContain('Finding tasks');
    expect(html).toContain('role="status"');
    expect(html).not.toContain('data-portal-loading="compact"');
    expect(html).not.toContain('min-h-[60vh]');
    expect(html).toContain('placeholder="Search all buckets..."');
    expect(html).not.toContain('>1583</span>');
    expect(html).not.toContain('>57</span>');
  });
});
