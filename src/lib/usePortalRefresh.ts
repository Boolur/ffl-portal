'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { subscribePortalUpdates, type PortalTopic } from './portalLiveUpdates';

export function portalEditorIsOpen() {
  const focused = document.activeElement;
  return Boolean(document.querySelector('[aria-modal="true"]') ||
    (focused instanceof HTMLElement && focused.matches('input, textarea, select, [contenteditable="true"]')));
}

/** Coalesce change signals and never apply background data over an editor. */
export function usePortalRefresh<T>(topic: PortalTopic, load: () => Promise<T>, apply: (result: T) => void, enabled = true, seedKey = '') {
  const latest = useRef({ load, apply });
  latest.current = { load, apply };
  const requestRef = useRef<() => void>(() => {});
  const [error, setError] = useState('');
  const refresh = useCallback(() => requestRef.current(), []);
  useEffect(() => {
    if (!enabled) return;
    let disposed = false;
    let busy = false;
    let queued = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    async function run() {
      if (disposed || busy || !queued) return;
      if (document.visibilityState !== 'visible' || portalEditorIsOpen()) {
        timer = setTimeout(() => void run(), 1_000);
        return;
      }
      queued = false;
      busy = true;
      let timeout: ReturnType<typeof setTimeout> | undefined;
      try {
        const result = await Promise.race([
          latest.current.load(),
          new Promise<never>((_, reject) => { timeout = setTimeout(() => reject(new Error('timeout')), 20_000); }),
        ]);
        if (disposed) return;
        if (portalEditorIsOpen()) queued = true;
        else { latest.current.apply(result); setError(''); }
      } catch {
        if (!disposed) setError('This view could not be updated.');
        queued = false;
      } finally {
        clearTimeout(timeout);
        busy = false;
        if (!disposed && queued) timer = setTimeout(() => void run(), 500);
      }
    }
    const request = () => {
      queued = true;
      clearTimeout(timer);
      if (!busy) timer = setTimeout(() => void run(), 200);
    };
    requestRef.current = request;
    const unsubscribe = subscribePortalUpdates(topic, request);
    return () => { disposed = true; clearTimeout(timer); unsubscribe(); requestRef.current = () => {}; };
  }, [topic, enabled, seedKey]);
  return { error, refresh };
}
