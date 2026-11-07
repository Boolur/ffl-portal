/** Shared by the initial server page and the bucket controls. */
export function defaultTaskBucketSort(role: string): 'created_asc' | 'updated_desc' {
  return ['DISCLOSURE_SPECIALIST', 'QC', 'MANAGER', 'VA', 'VA_TITLE', 'VA_PAYOFF', 'VA_APPRAISAL', 'PROCESSOR_JR'].includes(role)
    ? 'created_asc'
    : 'updated_desc';
}

export function initialTaskBucketSort(role: string, completed?: boolean) {
  return completed ? 'updated_desc' : defaultTaskBucketSort(role);
}

export function hasVisibleTaskEditor(tasks: Array<{ id: string }>, editorIds: Iterable<string | null>) {
  const open = new Set(editorIds);
  return tasks.some(task => open.has(task.id));
}

type RequestToken = { bucketId: string; queryKey: string };

/** Server actions cannot be aborted here; stop waiting and ignore their late result. */
export async function withTaskBucketTimeout<T>(request: Promise<T>, timeoutMs = 20_000): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      request,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error('This request took too long. Please retry.')), timeoutMs);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

/** One request per bucket; a failure waits for Retry or a different query. */
export class TaskBucketRequestGate {
  private queries = new Map<string, string>();
  private active = new Map<string, RequestToken>();
  private failures = new Map<string, { queryKey: string; message: string }>();

  setQuery(bucketId: string, queryKey: string) {
    this.queries.set(bucketId, queryKey);
  }

  error(bucketId: string, queryKey: string) {
    const failure = this.failures.get(bucketId);
    return failure?.queryKey === queryKey ? failure.message : null;
  }

  errorForView(bucketId: string, queryKey: string) {
    const failure = this.failures.get(bucketId);
    return failure?.queryKey.startsWith(`${queryKey}:`) ? failure.message : null;
  }

  supersede(bucketId: string) {
    this.active.delete(bucketId);
    this.failures.delete(bucketId);
  }

  isActive(bucketId: string) { return this.active.has(bucketId); }

  begin(bucketId: string, queryKey: string, retry = false): RequestToken | null {
    if (this.queries.get(bucketId) !== queryKey || this.active.has(bucketId) || (!retry && this.error(bucketId, queryKey))) return null;
    const token = { bucketId, queryKey };
    this.active.set(bucketId, token);
    this.failures.delete(bucketId);
    return token;
  }

  isCurrent(token: RequestToken) {
    return this.active.get(token.bucketId) === token && this.queries.get(token.bucketId) === token.queryKey;
  }

  finish(token: RequestToken, error?: string) {
    if (this.isCurrent(token) && error) {
      this.failures.set(token.bucketId, { queryKey: token.queryKey, message: error });
    }
    if (this.active.get(token.bucketId) === token) this.active.delete(token.bucketId);
  }
}

export type TaskBucketPageState<T> = {
  tasks: T[];
  totalCount: number;
  totalCountIsExact: boolean;
  nextCursor: { id: string } | null;
};

type BucketCountState = { totalCount: number; totalCountIsExact: boolean };

/** A card page (including its final page) never replaces a confirmed queue total. */
export function reconcileTaskBucketTotal<T extends BucketCountState>(
  page: T,
  previous?: BucketCountState,
  authoritativeTotal?: number,
): T {
  if (authoritativeTotal !== undefined) {
    return { ...page, totalCount: authoritativeTotal, totalCountIsExact: true };
  }
  if (previous?.totalCountIsExact) {
    return { ...page, totalCount: previous.totalCount, totalCountIsExact: true };
  }
  return { ...page, totalCountIsExact: false };
}

/** New server totals can update a cached view without disturbing cards or edits. */
export function mergeTaskBucketSeedCounts<T extends BucketCountState & { queryKey: string }>(
  current: Record<string, T>,
  seeds: Record<string, BucketCountState & { queryKey: string }>,
): Record<string, T> {
  let next = current;
  for (const [id, seed] of Object.entries(seeds)) {
    const previous = current[id];
    if (!previous || previous.queryKey !== seed.queryKey || !seed.totalCountIsExact) continue;
    if (previous.totalCountIsExact && previous.totalCount === seed.totalCount) continue;
    if (next === current) next = { ...current };
    next[id] = { ...previous, totalCount: seed.totalCount, totalCountIsExact: true };
  }
  return next;
}

/** Scroll pages do not recount the queue; retain the count from its first read. */
export function appendTaskBucketPage<T extends { id: string }>(
  previous: TaskBucketPageState<T>,
  page: TaskBucketPageState<T>
): TaskBucketPageState<T> {
  const tasks = Array.from(new Map([...previous.tasks, ...page.tasks].map(task => [task.id, task])).values());
  if (!page.nextCursor) {
    return { tasks, nextCursor: null, totalCount: tasks.length, totalCountIsExact: true };
  }
  const minimumCount = tasks.length + 1;
  return {
    tasks,
    nextCursor: page.nextCursor,
    totalCount: Math.max(previous.totalCount, minimumCount),
    totalCountIsExact: previous.totalCountIsExact && previous.totalCount >= minimumCount,
  };
}
