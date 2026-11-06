import { describe, expect, it } from 'vitest';
import { createPipelineWorkspaceCache, pipelineScopeMatches, type PipelineWorkspaceSnapshot } from './pipelineWorkspaceCache';

function snapshot(count = 1, text = '') {
  return { workspace: { success: true, data: { rows: Array.from({ length: count }, (_, id) => ({ id, text })) }, layouts: [] }, view: { search: 'borrower' }, tab: 'processing' } as unknown as PipelineWorkspaceSnapshot<{ search: string }>;
}

describe('private pipeline screen cache', () => {
  it('separates user/role scopes and clears all data at the identity boundary', () => {
    const cache = createPipelineWorkspaceCache(() => 100);
    cache.write('user:manager', snapshot(), 100);
    expect(cache.read('user:processor')).toBeNull();
    expect(cache.read('another:manager')).toBeNull();
    cache.clear();
    expect(cache.read('user:manager')).toBeNull();
  });
  it('rejects a late old-session persist after an identity reset', () => {
    const cache = createPipelineWorkspaceCache(() => 100);
    const oldEpoch = cache.epoch();
    cache.clear();
    expect(cache.write('old-user', snapshot(), 100, oldEpoch)).toBe(false);
    expect(cache.read('old-user')).toBeNull();
    expect(cache.write('new-user', snapshot(), 100, cache.epoch())).toBe(true);
  });
  it('does not show an old server scope after the active session changes', () => {
    const scope = JSON.stringify(['user', 'MANAGER', ['LOAN_OFFICER', 'MANAGER']]);
    expect(pipelineScopeMatches(scope, { id: 'user', activeRole: 'MANAGER', roles: ['MANAGER', 'LOAN_OFFICER'] })).toBe(true);
    expect(pipelineScopeMatches(scope, { id: 'user', activeRole: 'LOAN_OFFICER', roles: ['MANAGER', 'LOAN_OFFICER'] })).toBe(false);
    expect(pipelineScopeMatches(scope, { id: 'other', activeRole: 'MANAGER', roles: ['MANAGER', 'LOAN_OFFICER'] })).toBe(false);
    expect(pipelineScopeMatches(scope)).toBe(false);
  });
  it('reuses recent screens, marks older ones stale, and evicts at five minutes', () => {
    let now = 100;
    const cache = createPipelineWorkspaceCache(() => now);
    cache.write('user', snapshot(), now);
    expect(cache.read('user')?.stale).toBe(false);
    now += 60_000;
    expect(cache.read('user')?.stale).toBe(true);
    now += 240_000;
    expect(cache.read('user')).toBeNull();
  });
  it('retains invalidation when UI preferences change without a fresh data read', () => {
    let now = 100;
    const cache = createPipelineWorkspaceCache(() => now);
    cache.write('user', snapshot(), 100);
    now = 200;
    cache.invalidate('user');
    cache.write('user', snapshot(), 100);
    expect(cache.read('user')?.stale).toBe(true);
    now = 300;
    cache.write('user', snapshot(), 300);
    expect(cache.read('user')?.stale).toBe(false);
  });
  it('bounds both rows and bytes and evicts the least recent of at most two entries', () => {
    const cache = createPipelineWorkspaceCache(() => 100);
    cache.write('a', snapshot(), 100);
    cache.write('b', snapshot(), 100);
    cache.read('a');
    cache.write('c', snapshot(), 100);
    expect(cache.read('b')).toBeNull();
    expect(cache.write('large', snapshot(1501), 100)).toBe(false);
    expect(cache.write('large', snapshot(1, 'x'.repeat(1_000_000)), 100)).toBe(false);
    cache.write('rows', snapshot(1500), 100);
    expect(cache.read('a')).toBeNull();
    expect(cache.read('c')).toBeNull();
    expect(cache.read('rows')).not.toBeNull();
  });
});
