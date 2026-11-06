import { afterEach, describe, expect, it, vi } from 'vitest';
import { createPipelineRefresh } from './pipelineRefresh';

function deferred() {
  let resolve!: (value: string) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<string>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

function setup() {
  const requests: ReturnType<typeof deferred>[] = [];
  const load = vi.fn<(view: string) => Promise<string>>(() => {
    const request = deferred();
    requests.push(request);
    return request.promise;
  });
  const callbacks = {
    onStart: vi.fn(), onSuccess: vi.fn(), onError: vi.fn(), onIdle: vi.fn(),
  };
  return { requests, load, ...callbacks, refresh: createPipelineRefresh({ load, ...callbacks }) };
}

afterEach(() => vi.useRealTimers());

describe('pipeline refresh recovery', () => {
  it('serializes requests, skips superseded views, and ignores stale results', async () => {
    const s = setup();
    s.refresh.request('pipeline');
    s.refresh.request('funding');
    s.refresh.request('restructure');
    expect(s.load).toHaveBeenCalledTimes(1);
    s.requests[0].resolve('old rows');
    await Promise.resolve();
    expect(s.onSuccess).not.toHaveBeenCalled();
    expect(s.load.mock.calls.map(([view]) => view)).toEqual(['pipeline', 'restructure']);
    expect(s.onIdle).not.toHaveBeenCalled();
    s.requests[1].resolve('current rows');
    await Promise.resolve();
    expect(s.onSuccess).toHaveBeenCalledWith('current rows');
    expect(s.onIdle).toHaveBeenCalledOnce();
    expect(s.refresh.isBusy()).toBe(false);
  });

  it('ends the spinner after 20 seconds without queuing retries behind a hung action', async () => {
    vi.useFakeTimers();
    const s = setup();
    s.refresh.request('pipeline');
    s.refresh.request('funding');
    await vi.advanceTimersByTimeAsync(20_000);
    expect(s.onError).toHaveBeenCalledWith(true);
    expect(s.onIdle).toHaveBeenCalledOnce();
    s.refresh.request('retry');
    s.requests[0].resolve('late rows');
    await Promise.resolve();
    expect(s.load).toHaveBeenCalledTimes(1);
    expect(s.onSuccess).not.toHaveBeenCalled();
    expect(s.onIdle).toHaveBeenCalledOnce();
    expect(s.refresh.isBusy()).toBe(true);
  });

  it('handles rejected requests and permits a fresh retry', async () => {
    const s = setup();
    s.refresh.request('pipeline');
    s.requests[0].reject(new Error('connection lost'));
    await Promise.resolve();
    expect(s.onError).toHaveBeenCalledWith(false);
    expect(s.onIdle).toHaveBeenCalledOnce();
    s.refresh.request('pipeline');
    s.requests[1].resolve('retried rows');
    await Promise.resolve();
    expect(s.onSuccess).toHaveBeenCalledWith('retried rows');
  });

  it('continues to the latest view when a superseded request fails', async () => {
    const s = setup();
    s.refresh.request('pipeline');
    s.refresh.request('funding');
    s.requests[0].reject(new Error('old request failed'));
    await Promise.resolve();
    expect(s.onError).not.toHaveBeenCalled();
    s.requests[1].resolve('funding rows');
    await Promise.resolve();
    expect(s.onSuccess).toHaveBeenCalledWith('funding rows');
  });

  it('ignores results and clears timers after unmount', async () => {
    vi.useFakeTimers();
    const s = setup();
    s.refresh.request('pipeline');
    s.refresh.dispose();
    s.requests[0].reject(new Error('late failure'));
    await vi.advanceTimersByTimeAsync(20_000);
    expect(s.onError).not.toHaveBeenCalled();
    expect(s.onIdle).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
});
