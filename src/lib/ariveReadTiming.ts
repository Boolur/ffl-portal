import 'server-only';
import { AriveError } from './ariveClient';
import { AriveTransportError } from './ariveTransport';

const MAX_READS = 12;
const START_INTERVAL_MS = 250;
const SAMPLE_BUDGET_MS = 90_000;
// The supplied production Arive client has a 25-second request timeout. Reserve
// that entire timeout instead of abandoning an in-flight promise at the deadline.
const REQUEST_TIMEOUT_RESERVE_MS = 25_000;

export type AriveReadTiming = {
  success: boolean;
  attemptedRequests: number;
  completedRequests: number;
  completedCycles: number;
  requestMs: number[];
  medianRequestMs: number | null;
  p95RequestMs: number | null;
  meanCycleApiMs: number | null;
  elapsedMs: number;
  deadlineReached: boolean;
  error: string | null;
  limitations: string;
};

const limitations = 'This measures test-file response time, not a confirmed request allowance or a freshness guarantee. Only the first notes page is sampled; actual synchronization may require more pages. Authentication and database processing are excluded.';

/** Caller authorizes Admin III, chooses the saved synthetic-file GUID, and rate
 * limits the whole diagnostic. Supply a client with a 25-second timeout and no
 * automatic retries so each invocation is exactly one GET. This helper neither
 * obtains credentials nor writes loan data. It discards every response body. */
export async function sampleAriveTestReadTiming(
  api: (path: string) => Promise<unknown>,
  syntheticGuid: string,
  deps: { now?: () => number; sleep?: (milliseconds: number) => Promise<void> } = {},
): Promise<AriveReadTiming> {
  const now = deps.now ?? (() => performance.now());
  const sleep = deps.sleep ?? (milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds)));
  const started = now();
  const requestMs: number[] = [];
  let attemptedRequests = 0;
  let previousStart: number | null = null;
  let deadlineReached = false;
  let error: string | null = null;

  if (!/^[a-zA-Z0-9-]{1,100}$/.test(syntheticGuid)) {
    error = 'Choose the linked synthetic test file before measuring response times.';
  } else {
    const loan = `/loans/${encodeURIComponent(syntheticGuid)}`;
    const paths = [loan, `${loan}/trackers`, `${loan}/notes?limit=100&offset=0`, loan];
    for (let index = 0; index < MAX_READS; index++) {
      if (previousStart !== null) {
        const delay = START_INTERVAL_MS - (now() - previousStart);
        if (delay > 0) await sleep(delay);
      }
      if (now() - started > SAMPLE_BUDGET_MS - REQUEST_TIMEOUT_RESERVE_MS) {
        deadlineReached = true;
        error = 'The timing sample reached its time limit. No further requests were started.';
        break;
      }
      previousStart = now();
      attemptedRequests++;
      try {
        await api(paths[index % paths.length]);
        requestMs.push(Math.max(0, Math.round(now() - previousStart)));
      } catch (cause) {
        error = cause instanceof AriveError || cause instanceof AriveTransportError
          ? cause.message.replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0, 500)
          : 'The test read could not be completed. No further requests were started.';
        break;
      }
    }
  }

  const sorted = [...requestMs].sort((a, b) => a - b);
  const count = sorted.length;
  const completedCycles = Math.floor(count / 4);
  return {
    success: count === MAX_READS && !error,
    attemptedRequests,
    completedRequests: count,
    completedCycles,
    requestMs,
    medianRequestMs: count ? (count % 2 ? sorted[Math.floor(count / 2)] : (sorted[count / 2 - 1] + sorted[count / 2]) / 2) : null,
    p95RequestMs: count ? sorted[Math.ceil(count * 0.95) - 1] : null,
    meanCycleApiMs: completedCycles ? Math.round(requestMs.slice(0, completedCycles * 4).reduce((sum, value) => sum + value, 0) / completedCycles) : null,
    elapsedMs: Math.max(0, Math.round(now() - started)),
    deadlineReached,
    error,
    limitations,
  };
}
