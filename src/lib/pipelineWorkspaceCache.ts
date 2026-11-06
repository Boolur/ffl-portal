import type { ProcessingPipelineWorkspaceData } from '../app/actions/pipelineWorkspaceActions';
import { onPortalIdentityReset, subscribePortalUpdates } from './portalLiveUpdates';

export const PIPELINE_CACHE_FRESH_MS = 60_000;
export const PIPELINE_CACHE_EXPIRE_MS = 5 * 60_000;
export type PipelineTab = 'pre-processing' | 'processing';
export type PipelineWorkspaceSnapshot<View> = {
  workspace: ProcessingPipelineWorkspaceData;
  view: View;
  tab: PipelineTab;
};

/** Private browser memory only; a hard budget prevents retaining whole portal history. */
export function createPipelineWorkspaceCache(now: () => number = Date.now) {
  type Entry = { snapshot: PipelineWorkspaceSnapshot<unknown>; observedAt: number; invalidatedAt: number; bytes: number; rowCount: number };
  const entries = new Map<string, Entry>();
  let revision = 0;
  let epoch = 0;
  const prune = () => {
    for (const [key, entry] of entries) if (now() - entry.observedAt >= PIPELINE_CACHE_EXPIRE_MS) entries.delete(key);
  };
  return {
    read<View>(scope: string) {
      prune();
      const entry = entries.get(scope);
      if (!entry) return null;
      entries.delete(scope); entries.set(scope, entry);
      return { snapshot: entry.snapshot as PipelineWorkspaceSnapshot<View>, observedAt: entry.observedAt, stale: entry.invalidatedAt >= entry.observedAt || now() - entry.observedAt >= PIPELINE_CACHE_FRESH_MS };
    },
    write<View>(scope: string, snapshot: PipelineWorkspaceSnapshot<View>, observedAt: number, expectedEpoch = epoch) {
      if (expectedEpoch !== epoch) return false;
      prune();
      const rowCount = snapshot.workspace.data.rows.length;
      const bytes = JSON.stringify(snapshot).length * 2;
      if (rowCount > 1500 || bytes > 2_000_000 || now() - observedAt >= PIPELINE_CACHE_EXPIRE_MS) {
        entries.delete(scope);
        return false;
      }
      const invalidatedAt = entries.get(scope)?.invalidatedAt ?? -1;
      entries.delete(scope);
      entries.set(scope, { snapshot, observedAt, invalidatedAt, bytes, rowCount });
      const overBudget = () => entries.size > 2 || [...entries.values()].reduce((sum, value) => sum + value.rowCount, 0) > 1500 || [...entries.values()].reduce((sum, value) => sum + value.bytes, 0) > 2_000_000;
      while (overBudget()) entries.delete(entries.keys().next().value!);
      return true;
    },
    setTab(scope: string, tab: PipelineTab) {
      const entry = entries.get(scope);
      if (entry) entry.snapshot = { ...entry.snapshot, tab };
    },
    setScroll(scope: string, scrollTop: number, scrollLeft: number) {
      const entry = entries.get(scope);
      if (entry) entry.snapshot = { ...entry.snapshot, view: { ...(entry.snapshot.view as object), scrollTop, scrollLeft } };
    },
    invalidate(scope?: string) {
      revision += 1;
      for (const [key, entry] of entries) if (!scope || key === scope) entry.invalidatedAt = now();
    },
    clear() { entries.clear(); revision += 1; epoch += 1; },
    revision: () => revision,
    epoch: () => epoch,
  };
}

const cache = createPipelineWorkspaceCache();
export function readPipelineWorkspaceCache<View>(scope: string) {
  return typeof window === 'undefined' ? null : cache.read<View>(scope);
}
export function writePipelineWorkspaceCache<View>(scope: string, snapshot: PipelineWorkspaceSnapshot<View>, observedAt: number, epoch: number) {
  return typeof window === 'undefined' ? false : cache.write(scope, snapshot, observedAt, epoch);
}
export function setPipelineWorkspaceCachedTab(scope: string, tab: PipelineTab) { cache.setTab(scope, tab); }
export function setPipelineWorkspaceCachedScroll(scope: string, top: number, left: number) { cache.setScroll(scope, top, left); }
export function invalidatePipelineWorkspaceCache(scope?: string) { cache.invalidate(scope); }
export function clearPipelineWorkspaceCache() { cache.clear(); }
export function pipelineWorkspaceCacheRevision() { return cache.revision(); }
export function pipelineWorkspaceCacheEpoch() { return cache.epoch(); }
export function pipelineScopeMatches(scope: string, user?: { id?: string; activeRole?: string; role?: string; roles?: string[] }) {
  if (!user?.id) return false;
  const role = user.activeRole || user.role;
  return Boolean(role) && scope === JSON.stringify([user.id, role, [...(user.roles || [role!])].sort()]);
}
onPortalIdentityReset(clearPipelineWorkspaceCache);
// Keep invalidation active after the Pipeline route unmounts as well.
subscribePortalUpdates('pipeline', () => invalidatePipelineWorkspaceCache());
