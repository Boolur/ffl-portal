import { describe, expect, it, vi } from 'vitest';
import { createArivePanelRefresh } from './arivePanelRefresh';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function setup() {
  const reads: ReturnType<typeof deferred<string>>[] = [];
  const load = vi.fn(() => { const read = deferred<string>(); reads.push(read); return read.promise; });
  const apply = vi.fn(); const error = vi.fn(); const busy = vi.fn();
  return { reads, load, apply, error, busy, reader: createArivePanelRefresh({ load, apply, error, busy }) };
}

describe('Arive panel refresh coordination', () => {
  it('shares an in-flight initial/poll read without duplicate requests', async () => {
    const h = setup(); const first = h.reader.refresh(); const poll = h.reader.refresh();
    expect(first).toBe(poll); expect(h.load).toHaveBeenCalledTimes(1);
    h.reads[0].resolve('initial notes'); await Promise.all([first, poll]);
    expect(h.apply).toHaveBeenCalledExactlyOnceWith('initial notes');
    expect(h.busy.mock.calls).toEqual([[true], [false]]);
  });

  it('immediately loads the updated data after a successful sync without discarding the visible panel', async () => {
    const h = setup(); const first = h.reader.refresh(); h.reads[0].resolve('old notes'); await first;
    const afterSync = h.reader.refresh(true);
    expect(h.load).toHaveBeenCalledTimes(2);
    expect(h.apply.mock.calls).toEqual([['old notes']]);
    h.reads[1].resolve('new notes and replies'); await afterSync;
    expect(h.apply.mock.calls).toEqual([['old notes'], ['new notes and replies']]);
  });

  it('queues only one fresh read when sync completes during a read and never applies the stale response', async () => {
    const h = setup(); const initial = h.reader.refresh();
    const syncOne = h.reader.refresh(true); const syncTwo = h.reader.refresh(true);
    h.reader.refresh();
    expect(h.load).toHaveBeenCalledTimes(1);
    h.reads[0].resolve('pre-sync tracker status'); await Promise.resolve();
    expect(h.load).toHaveBeenCalledTimes(2); expect(h.apply).not.toHaveBeenCalled();
    h.reads[1].resolve('fresh tracker status'); await Promise.all([initial, syncOne, syncTwo]);
    expect(h.load).toHaveBeenCalledTimes(2);
    expect(h.apply).toHaveBeenCalledExactlyOnceWith('fresh tracker status');
    expect(h.busy.mock.calls).toEqual([[true], [false]]);
  });

  it('ignores an obsolete read error when a newer sync has already queued a replacement', async () => {
    const h = setup(); const read = h.reader.refresh(); h.reader.refresh(true);
    h.reads[0].reject(new Error('older request failed')); await Promise.resolve();
    expect(h.error).not.toHaveBeenCalled(); expect(h.load).toHaveBeenCalledTimes(2);
    h.reads[1].resolve('fresh notes'); await read;
    expect(h.apply).toHaveBeenCalledExactlyOnceWith('fresh notes');
  });

  it('retains the last displayed data on error and allows a successful retry', async () => {
    const h = setup(); const initial = h.reader.refresh(); h.reads[0].resolve('retained trackers'); await initial;
    const failed = h.reader.refresh(true); const error = new Error('Arive temporarily unavailable');
    const rejection = expect(failed).rejects.toBe(error); h.reads[1].reject(error); await rejection;
    expect(h.apply.mock.calls).toEqual([['retained trackers']]); expect(h.error).toHaveBeenCalledExactlyOnceWith(error);
    const retry = h.reader.refresh(true); h.reads[2].resolve('current trackers'); await retry;
    expect(h.apply.mock.calls).toEqual([['retained trackers'], ['current trackers']]);
  });

  it('does not update unmounted panels or issue queued reads after switching files', async () => {
    const h = setup(); const read = h.reader.refresh(); h.reader.refresh(true); h.reader.dispose();
    h.reads[0].resolve('previous borrower'); await read; await h.reader.refresh(true);
    expect(h.apply).not.toHaveBeenCalled(); expect(h.error).not.toHaveBeenCalled();
    expect(h.load).toHaveBeenCalledTimes(1); expect(h.busy.mock.calls).toEqual([[true]]);
  });

  it('does not leak an unmounted request failure into the next borrower', async () => {
    const old = setup(); const next = setup(); const oldRead = old.reader.refresh(); old.reader.dispose();
    const nextRead = next.reader.refresh(); old.reads[0].reject(new Error('previous borrower failure'));
    next.reads[0].resolve('new borrower notes'); await Promise.all([oldRead, nextRead]);
    expect(old.error).not.toHaveBeenCalled(); expect(old.apply).not.toHaveBeenCalled();
    expect(next.apply).toHaveBeenCalledExactlyOnceWith('new borrower notes');
  });
});
