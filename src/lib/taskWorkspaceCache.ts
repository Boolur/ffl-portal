import { appendTaskBucketPage, type TaskBucketPageState } from './taskBucketClientState';
import { onPortalIdentityReset } from './portalLiveUpdates';

export type TaskWorkspaceSnapshot<T> = {
  savedAt: number;
  validatedAt: number;
  seedSignature: string;
  globalSearch: string;
  globalSort: string;
  controlsByBucket: Record<string, { collapsed: boolean; search: string; sort: string }>;
  pages: Record<string, TaskBucketPageState<T> & { queryKey: string }>;
  scrollTopByBucket: Record<string, number>;
};

const snapshots = new Map<string, { snapshot: TaskWorkspaceSnapshot<unknown>; records: number; bytes: number; pageBytes: number }>();
const MAX_WORKSPACES = 8;
const MAX_RECORDS = 2000;
const MAX_BYTES = 8 * 1024 * 1024;
const MAX_AGE_MS = 10 * 60_000;
let cacheEpoch = 0;

export function taskWorkspaceCacheEpoch() { return cacheEpoch; }

/** Task records stay in this tab's memory; never write borrower data to storage. */
export function clearTaskWorkspaceCache() {
  snapshots.clear();
  cacheEpoch++;
}

onPortalIdentityReset(clearTaskWorkspaceCache);

export function readTaskWorkspaceCache<T>(key: string, now = Date.now()): TaskWorkspaceSnapshot<T> | null {
  if (typeof window === 'undefined') return null;
  const entry = snapshots.get(key);
  if (!entry) return null;
  if (now - entry.snapshot.savedAt > MAX_AGE_MS) {
    snapshots.delete(key);
    return null;
  }
  snapshots.delete(key);
  snapshots.set(key, entry);
  return entry.snapshot as TaskWorkspaceSnapshot<T>;
}

export function writeTaskWorkspaceCache<T>(key: string, snapshot: TaskWorkspaceSnapshot<T>, epoch = cacheEpoch) {
  if (typeof window === 'undefined' || epoch !== cacheEpoch) return;
  const records = Object.values(snapshot.pages).reduce((sum, page) => sum + page.tasks.length, 0);
  // Do not cache a truncated window: its cursor would skip cards on a revisit.
  if (records > MAX_RECORDS) {
    snapshots.delete(key);
    return;
  }
  const existing = snapshots.get(key);
  let pageBytes: number;
  let bytes: number;
  try {
    const encoder = new TextEncoder();
    // Control/scroll changes reuse the unchanged page estimate instead of
    // serializing all task notes on every keystroke or navigation cleanup.
    pageBytes = existing?.snapshot.pages === snapshot.pages
      ? existing.pageBytes
      : encoder.encode(JSON.stringify(snapshot.pages)).byteLength;
    bytes = pageBytes + encoder.encode(JSON.stringify({ ...snapshot, pages: undefined })).byteLength;
  } catch {
    snapshots.delete(key);
    return;
  }
  snapshots.delete(key);
  if (bytes > MAX_BYTES) return;
  snapshots.set(key, { snapshot, records, bytes, pageBytes });
  let total = Array.from(snapshots.values()).reduce((sum, entry) => sum + entry.records, 0);
  let totalBytes = Array.from(snapshots.values()).reduce((sum, entry) => sum + entry.bytes, 0);
  while (snapshots.size > MAX_WORKSPACES || total > MAX_RECORDS || totalBytes > MAX_BYTES) {
    const oldest = snapshots.keys().next().value;
    if (!oldest) break;
    total -= snapshots.get(oldest)!.records;
    totalBytes -= snapshots.get(oldest)!.bytes;
    snapshots.delete(oldest);
  }
}

export function taskWorkspaceKey(identity: string, buckets: Array<{ id: string; sectionId?: string }>) {
  return JSON.stringify([identity, buckets.map(bucket => [bucket.sectionId || '', bucket.id]).sort()]);
}

export function taskSeedSignature(value: unknown) {
  const json = JSON.stringify(value);
  let hash = 2166136261;
  for (let index = 0; index < json.length; index++) hash = Math.imul(hash ^ json.charCodeAt(index), 16777619);
  return `${json.length}:${hash >>> 0}`;
}

/** Refresh the displayed window without replacing a deep scroll with six cards. */
export async function loadTaskBucketWindow<T extends { id: string }>(
  displayedCount: number,
  load: (cursor: { id: string } | null, pageSize: number) => Promise<TaskBucketPageState<T>>,
  isCurrent: () => boolean = () => true,
): Promise<TaskBucketPageState<T>> {
  const target = Math.max(6, displayedCount);
  let window: TaskBucketPageState<T> | null = null;
  let cursor: { id: string } | null = null;
  do {
    if (!isCurrent()) throw new Error('This task view changed while refreshing.');
    const page = await load(cursor, Math.min(50, target - (window?.tasks.length || 0)));
    if (!isCurrent()) throw new Error('This task view changed while refreshing.');
    const previousLength = window?.tasks.length || 0;
    window = window ? appendTaskBucketPage(window, page) : page;
    if (!window.nextCursor || window.tasks.length >= target) return window;
    if (window.nextCursor.id === cursor?.id || window.tasks.length <= previousLength) {
      throw new Error('The task list changed while loading. Please retry.');
    }
    cursor = window.nextCursor;
  } while (true);
}
