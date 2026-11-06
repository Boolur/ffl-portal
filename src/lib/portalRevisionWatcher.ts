export type RevisionStatus = 'connected' | 'retrying' | 'unauthorized';

/** One bounded request at a time; hidden/unmounted screens stop completely. */
export function createPortalRevisionWatcher(options: {
  read: (signal: AbortSignal) => Promise<string>;
  initialRevision?: string;
  onRevision: (revision: string, changed: boolean) => void;
  onStatus: (status: RevisionStatus) => void;
  intervalMs?: number;
  timeoutMs?: number;
}) {
  let revision = options.initialRevision;
  let visible = false;
  let disposed = false;
  let active: AbortController | null = null;
  let schedule: ReturnType<typeof setTimeout> | undefined;
  let failures = 0;
  let lastStarted = -Infinity;
  const clearSchedule = () => { clearTimeout(schedule); schedule = undefined; };

  async function check() {
    if (disposed || !visible || active) return;
    clearSchedule();
    lastStarted = Date.now();
    const controller = new AbortController();
    active = controller;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      const next = await Promise.race([
        options.read(controller.signal),
        new Promise<never>((_, reject) => {
          timeout = setTimeout(() => { controller.abort(); reject(new Error('Update check timed out.')); }, options.timeoutMs ?? 6_000);
        }),
      ]);
      if (disposed || !visible || active !== controller) return;
      const changed = revision !== undefined && revision !== next;
      revision = next;
      failures = 0;
      options.onRevision(next, changed);
      options.onStatus('connected');
    } catch (error) {
      if (disposed || !visible || active !== controller) return;
      failures += 1;
      if (error instanceof Error && error.message === 'unauthorized') {
        visible = false;
        options.onStatus('unauthorized');
      } else options.onStatus('retrying');
    } finally {
      clearTimeout(timeout);
      if (active === controller) {
        active = null;
        if (visible && !disposed) {
          const interval = options.intervalMs ?? 8_000;
          const delay = failures ? Math.min(30_000, interval * 2 ** Math.min(failures, 2)) : Math.max(0, interval - (Date.now() - lastStarted));
          schedule = setTimeout(() => void check(), delay);
        }
      }
    }
  }

  return {
    setVisible(next: boolean) {
      if (disposed) return;
      const changed = visible !== next;
      visible = next;
      if (!next) {
        clearSchedule();
        active?.abort();
        active = null;
      } else if (changed || Date.now() - lastStarted >= 1_000) void check();
    },
    dispose() {
      disposed = true;
      visible = false;
      clearSchedule();
      active?.abort();
      active = null;
    },
  };
}
