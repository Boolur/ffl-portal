/**
 * Shared in-process concurrency limiter for fire-and-forget side effects
 * that touch Prisma.
 *
 * Why this exists
 * ===============
 *
 * Several lead-distribution paths kick off `void someAsyncFn(leadId, ...)`
 * inside a tight `for (const id of ids)` loop — Bonzo forwarding,
 * IntegrationService triggers, broker-launch emails, etc. Each of those
 * functions performs multiple Prisma queries, and on Vercel's serverless
 * Prisma pool (observed production pool: 5 connections) a 50-lead bulk operation
 * can burst into ~150 simultaneous DB connection requests across all
 * three side-effect chains, exhausting the pool.
 *
 * The exhaustion symptom we already saw in production:
 *   - In-flight calls fail with "Timed out fetching a new connection
 *     from the connection pool".
 *   - The audit-write that records the exception ALSO fails (same
 *     drained pool), so leads silently misclassify as "never_attempted"
 *     on the Bonzo Forwarding health panel.
 *
 * `withConcurrencyLimit` queues callers per-key: only `limit` calls run
 * concurrently for a given key, the rest wait on a FIFO queue. The
 * fire-and-forget contract is preserved because the caller awaits the
 * gate, not the underlying work — so `void withConcurrencyLimit(...)`
 * still returns immediately to the caller.
 *
 * Why per-key
 * ===========
 *
 * Different side effects have different external-system bottlenecks
 * (Bonzo HTTP API vs Microsoft Graph email vs internal service
 * dispatches), so they should each have their own budget. A Bonzo
 * outage stalling 5 forwards shouldn't also stall the email-send
 * pipeline. The per-key limit also makes it easy to tune one channel
 * without rebalancing the others.
 *
 * Why in-process and not Redis / a queue
 * =======================================
 *
 * On Vercel each warm function instance has its own JS heap, so the
 * limiter is per-instance — two concurrent serverless invocations could
 * each have 2 in-flight Bonzo forwards simultaneously. That's still a
 * massive improvement over today (uncapped per loop) and matches our
 * actual pool ceiling reasonably well: in steady state, only one or
 * two warm instances are active at once. If multi-instance contention
 * ever becomes the bottleneck the architectural answer is a proper
 * job queue, not a cross-instance limiter; this helper is the small,
 * reliable middle ground.
 *
 * The limit per key is fixed by the FIRST caller. Subsequent callers
 * passing a different limit reuse the existing one (with a console
 * warning), so a misconfigured caller can't accidentally widen the
 * gate for everyone else.
 */

type Slot = {
  active: number;
  limit: number;
  waiters: Array<() => void>;
};

const slots = new Map<string, Slot>();

function getOrCreateSlot(key: string, limit: number): Slot {
  const existing = slots.get(key);
  if (existing) {
    if (existing.limit !== limit) {
      console.warn(
        `[concurrencyLimit] Key "${key}" was registered with limit=${existing.limit} but a caller passed limit=${limit}. Using the registered limit.`
      );
    }
    return existing;
  }
  const slot: Slot = { active: 0, limit, waiters: [] };
  slots.set(key, slot);
  return slot;
}

/**
 * Run `fn` under the named concurrency budget. If `limit` callers are
 * already in flight for `key`, this awaits in FIFO order until a slot
 * opens. Always releases the slot, even on throw.
 *
 * Callers should still pass `void` if they want fire-and-forget
 * semantics — the function returns the awaited value of `fn` so it
 * works equally well for code that needs the result.
 */
export async function withConcurrencyLimit<T>(
  key: string,
  limit: number,
  fn: () => Promise<T>
): Promise<T> {
  const slot = getOrCreateSlot(key, limit);
  if (slot.active >= slot.limit) {
    await new Promise<void>((resolve) => slot.waiters.push(resolve));
  }
  slot.active++;
  try {
    return await fn();
  } finally {
    slot.active--;
    const next = slot.waiters.shift();
    if (next) next();
  }
}

/**
 * Inspect a slot for diagnostics. Returns `null` if the key has no
 * registered limit yet (i.e. the first caller hasn't run). Used by the
 * Lead Distribution Health page to surface live queue depth so admins
 * can tell at a glance whether a side-effect channel is backlogged.
 */
export function getConcurrencySlotStats(key: string): {
  active: number;
  limit: number;
  waiting: number;
} | null {
  const slot = slots.get(key);
  if (!slot) return null;
  return {
    active: slot.active,
    limit: slot.limit,
    waiting: slot.waiters.length,
  };
}

/**
 * Canonical keys for the limiter. Centralized so we don't typo a key
 * at one call site and silently get an independent budget.
 */
export const ConcurrencyKeys = {
  /** `forwardLeadToBonzo` — bounded by Bonzo's HTTP API throughput. */
  bonzoForward: 'bonzo-forward',
  /** `runServiceTriggers` — guards Prisma during bulk ON_ASSIGN fan-out. */
  serviceTriggers: 'service-triggers',
} as const;
