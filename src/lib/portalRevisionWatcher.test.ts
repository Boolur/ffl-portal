import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPortalRevisionWatcher } from './portalRevisionWatcher';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}
const flush = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };
function setup(initialRevision?: string) {
  const read = vi.fn<(signal: AbortSignal) => Promise<string>>(async () => 'version-a');
  const onRevision = vi.fn();
  const onStatus = vi.fn();
  const watcher = createPortalRevisionWatcher({ read, initialRevision, onRevision, onStatus });
  return { watcher, read, onRevision, onStatus };
}
beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('visible workspace change checks', () => {
  it('checks every eight seconds and signals only changed revisions', async () => {
    const s = setup('version-a');
    s.watcher.setVisible(true);
    await flush();
    expect(s.onRevision).toHaveBeenLastCalledWith('version-a', false);
    s.read.mockResolvedValue('version-b');
    await vi.advanceTimersByTimeAsync(8_000);
    expect(s.onRevision).toHaveBeenLastCalledWith('version-b', true);
    await vi.advanceTimersByTimeAsync(8_000);
    expect(s.onRevision).toHaveBeenLastCalledWith('version-b', false);
    s.watcher.dispose();
  });

  it('aborts hidden checks, ignores late results, and resumes immediately', async () => {
    const s = setup('version-a');
    const stale = deferred<string>();
    s.read.mockReturnValueOnce(stale.promise);
    s.watcher.setVisible(true);
    const signal = s.read.mock.calls[0][0];
    s.watcher.setVisible(false);
    expect(signal.aborted).toBe(true);
    stale.resolve('hidden-result');
    await flush();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(s.read).toHaveBeenCalledOnce();
    expect(s.onRevision).not.toHaveBeenCalled();
    s.watcher.setVisible(true);
    await flush();
    expect(s.read).toHaveBeenCalledTimes(2);
    expect(s.onRevision).toHaveBeenLastCalledWith('version-a', false);
    s.watcher.dispose();
  });

  it('does not overlap requests from repeated focus events', async () => {
    const s = setup();
    const pending = deferred<string>();
    s.read.mockReturnValueOnce(pending.promise);
    s.watcher.setVisible(true);
    await vi.advanceTimersByTimeAsync(2_000);
    s.watcher.setVisible(true);
    s.watcher.setVisible(true);
    expect(s.read).toHaveBeenCalledOnce();
    pending.resolve('version-a');
    await flush();
    s.watcher.dispose();
  });

  it('bounds a hung read, backs off, and ignores its eventual result', async () => {
    const s = setup('version-a');
    const pending = deferred<string>();
    s.read.mockReturnValueOnce(pending.promise);
    s.watcher.setVisible(true);
    await vi.advanceTimersByTimeAsync(6_000);
    expect(s.onStatus).toHaveBeenLastCalledWith('retrying');
    expect(s.read.mock.calls[0][0].aborted).toBe(true);
    pending.resolve('late');
    await flush();
    expect(s.onRevision).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(16_000);
    expect(s.read).toHaveBeenCalledTimes(2);
    expect(s.onStatus).toHaveBeenLastCalledWith('connected');
    s.watcher.dispose();
  });

  it('stops automatic checks when the session is rejected', async () => {
    const s = setup();
    s.read.mockRejectedValue(new Error('unauthorized'));
    s.watcher.setVisible(true);
    await flush();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(s.onStatus).toHaveBeenCalledWith('unauthorized');
    expect(s.read).toHaveBeenCalledOnce();
    s.watcher.dispose();
  });

  it('does not commit after unmount or identity reset', async () => {
    const s = setup();
    const pending = deferred<string>();
    s.read.mockReturnValueOnce(pending.promise);
    s.watcher.setVisible(true);
    s.watcher.dispose();
    pending.resolve('old-user');
    await flush();
    expect(s.onRevision).not.toHaveBeenCalled();
    expect(s.onStatus).not.toHaveBeenCalled();
  });
});
