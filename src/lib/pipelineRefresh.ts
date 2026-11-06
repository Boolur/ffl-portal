/** Serialize refreshes and retain only the latest requested view. */
export function createPipelineRefresh<Input, Result>(options: {
  load: (input: Input) => Promise<Result>;
  onStart: () => void;
  onSuccess: (result: Result) => void;
  onError: (timedOut: boolean) => void;
  onIdle: () => void;
  timeoutMs?: number;
}) {
  let active = false;
  let stopped = false;
  let revision = 0;
  let queued: { input: Input; revision: number } | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const drain = async () => {
    if (active || stopped || !queued) return;
    const request = queued;
    queued = null;
    active = true;
    timer = setTimeout(() => {
      // Server actions cannot be cancelled. Stop issuing more until the page
      // reloads, and ignore any eventual response from this stalled request.
      stopped = true;
      queued = null;
      options.onError(true);
      options.onIdle();
    }, options.timeoutMs ?? 20_000);
    try {
      const result = await options.load(request.input);
      if (!stopped && request.revision === revision) options.onSuccess(result);
    } catch {
      if (!stopped && request.revision === revision) options.onError(false);
    } finally {
      clearTimeout(timer);
      active = false;
      if (!stopped) {
        if (queued) void drain();
        else options.onIdle();
      }
    }
  };

  return {
    request(input: Input) {
      if (stopped) return;
      queued = { input, revision: ++revision };
      options.onStart();
      void drain();
    },
    isBusy: () => active || stopped,
    dispose() {
      stopped = true;
      queued = null;
      clearTimeout(timer);
    },
  };
}
