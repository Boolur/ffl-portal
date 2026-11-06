'use client';

import { useEffect, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';
import { createPortalRevisionWatcher, type RevisionStatus } from '@/lib/portalRevisionWatcher';
import { dispatchPortalUpdates, portalTopicForPath, type PortalTopic } from '@/lib/portalLiveUpdates';

export function PortalLiveProvider({ children, initialRevisions }: { children: React.ReactNode; initialRevisions?: Partial<Record<PortalTopic, string>> }) {
  const pathname = usePathname();
  const topic = portalTopicForPath(pathname);
  const revisions = useRef<Partial<Record<PortalTopic, string>>>(initialRevisions || {});
  const [status, setStatus] = useState<RevisionStatus>('connected');

  useEffect(() => {
    if (!topic) return;
    const watcher = createPortalRevisionWatcher({
      initialRevision: revisions.current[topic],
      read: async signal => {
        const response = await fetch(`/api/portal/revisions?topic=${topic}`, { signal, cache: 'no-store', credentials: 'same-origin' });
        if (response.status === 401 || response.status === 403) throw new Error('unauthorized');
        if (!response.ok) throw new Error('Updates unavailable.');
        const result: unknown = await response.json();
        if (!result || typeof result !== 'object' || !('revision' in result) || typeof result.revision !== 'string') throw new Error('Invalid update response.');
        return result.revision;
      },
      onRevision: (revision, changed) => {
        revisions.current[topic] = revision;
        if (changed) dispatchPortalUpdates({ topics: [topic], source: 'remote' });
      },
      onStatus: setStatus,
    });
    const syncVisibility = () => watcher.setVisible(document.visibilityState === 'visible' && navigator.onLine);
    syncVisibility();
    document.addEventListener('visibilitychange', syncVisibility);
    window.addEventListener('focus', syncVisibility);
    window.addEventListener('online', syncVisibility);
    window.addEventListener('offline', syncVisibility);
    return () => {
      watcher.dispose();
      document.removeEventListener('visibilitychange', syncVisibility);
      window.removeEventListener('focus', syncVisibility);
      window.removeEventListener('online', syncVisibility);
      window.removeEventListener('offline', syncVisibility);
    };
  }, [topic]);

  return <>
    {children}
    {topic && status !== 'connected' && (
      <div role="status" className="fixed bottom-3 left-1/2 z-40 -translate-x-1/2 rounded-md border border-border bg-card px-3 py-2 text-xs text-muted-foreground shadow-sm">
        {status === 'unauthorized' ? 'Live updates paused. Reload to reconnect.' : 'Live updates reconnecting. You can continue working.'}
      </div>
    )}
  </>;
}
