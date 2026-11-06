import { getMySupportSummary } from '@/app/actions/supportChatActions';

type Result = Awaited<ReturnType<typeof getMySupportSummary>>;
type Entry = { key: string; pending?: Promise<Result>; result?: Result; expires: number };
let cached: Entry | undefined;

// Only small badge/access summaries survive navigation. Never share a result
// across account/role changes, cache errors, or keep conversation contents here.
export function loadSupportSummary(key: string, force = false): Promise<Result> {
  if (cached?.key === key) {
    if (cached.pending) return cached.pending;
    if (!force && cached.result && cached.expires > Date.now()) return Promise.resolve(cached.result);
  }
  const entry: Entry = { key, expires: 0 };
  cached = entry;
  const pending = getMySupportSummary().then((result) => {
    if (result.success) {
      entry.result = result;
      entry.expires = Date.now() + 30_000;
    }
    return result;
  }).finally(() => { entry.pending = undefined; });
  entry.pending = pending;
  return pending;
}

export function invalidateSupportSummary() {
  cached = undefined;
}
