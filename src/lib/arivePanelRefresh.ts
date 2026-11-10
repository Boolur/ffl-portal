/** Coalesces panel reads while retaining one refresh requested after a new sync. */
export function createArivePanelRefresh<T>(options: {
  load: () => Promise<T>;
  apply: (value: T) => void;
  error: (error: unknown) => void;
  busy?: (busy: boolean) => void;
}) {
  let active = true;
  let queued = false;
  let pending: Promise<void> | null = null;
  return {
    refresh(requireFresh = false): Promise<void> {
      if (!active) return Promise.resolve();
      if (pending) {
        if (requireFresh) queued = true;
        return pending;
      }
      options.busy?.(true);
      pending = (async () => {
        do {
          queued = false;
          try {
            const value = await options.load();
            // A sync completed during this read. Wait for the queued fresh read
            // instead of briefly rendering the older response.
            if (active && !queued) options.apply(value);
          } catch (error) {
            if (active && !queued) { options.error(error); throw error; }
          }
        } while (active && queued);
      })().finally(() => {
        pending = null;
        if (active) options.busy?.(false);
      });
      return pending;
    },
    dispose() { active = false; queued = false; },
  };
}

export type ArivePanelRefresh = ReturnType<typeof createArivePanelRefresh>;
