import { getSubmissionPilot } from '@/app/actions/submissionPilotActions';

type Result = Awaited<ReturnType<typeof getSubmissionPilot>>;
const pending = new Map<string, { taskId: string; expires: number; promise: Promise<Result>; result?: Result }>();

export async function fetchPilotReview(taskId: string): Promise<Result> {
  try {
    const response = await fetch(`/api/processing-submission/${encodeURIComponent(taskId)}`, { cache: 'no-store', signal: AbortSignal.timeout(20000) });
    if (response.redirected || !response.headers.get('content-type')?.includes('application/json')) throw new Error('Unexpected document response.');
    if (!response.ok && response.status !== 403) throw new Error('Unable to load submission documents. Please retry.');
    return await response.json();
  } catch {
    // Preserve the original authorized read when the preload transport fails.
    return getSubmissionPilot(taskId);
  }
}

export function invalidatePilotReview(taskId: string) {
  for (const [key, entry] of pending) if (entry.taskId === taskId) pending.delete(key);
}

export function peekPilotReview(key: string): Result | null {
  const entry = pending.get(key);
  return entry && entry.expires > Date.now() ? entry.result || null : null;
}

export function preloadPilotReview(taskId: string, key: string): Promise<Result> {
  const existing = pending.get(key);
  if (existing && existing.expires > Date.now()) return existing.promise;
  for (const [id, entry] of pending) if (entry.expires <= Date.now()) pending.delete(id);
  const entry: { taskId: string; expires: number; promise: Promise<Result>; result?: Result } = {
    taskId, expires: Date.now() + 20000, promise: fetchPilotReview(taskId),
  };
  pending.set(key, entry);
  entry.promise = entry.promise.then(result => {
    if (result.success) entry.result = result;
    else if (pending.get(key) === entry) pending.delete(key);
    return result;
  }).catch(error => { if (pending.get(key) === entry) pending.delete(key); throw error; });
  return entry.promise;
}
