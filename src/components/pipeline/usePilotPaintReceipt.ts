'use client';

import { useEffect, useRef, type RefObject } from 'react';
import { acknowledgePilotRender } from '@/app/actions/processingPipelineActions';
import type { PilotRenderEntry, PilotRenderSurface } from '@/lib/pilotNoteRenderEvidence';

function visibleInContainer(node: HTMLElement, container: DOMRect) {
  const bounds = node.getBoundingClientRect();
  const left = Math.max(0, container.left, bounds.left);
  const right = Math.min(window.innerWidth, container.right, bounds.right);
  const top = Math.max(0, container.top, bounds.top);
  const bottom = Math.min(window.innerHeight, container.bottom, bounds.bottom);
  if (right <= left || bottom <= top) return false;
  return node.contains(document.elementFromPoint((left + right) / 2, (top + bottom) / 2));
}

/** A filtered, overscanned, background or covered row is not evidence of delivery. */
export function usePilotPaintReceipt(
  container: RefObject<HTMLElement | null>,
  surface: PilotRenderSurface,
  enabled: boolean,
  renderKey: string,
) {
  const sent = useRef(new Map<string, number>());
  useEffect(() => {
    const root = container.current;
    if (!enabled || !root || !renderKey) return;
    let frame = 0;
    let cancelled = false;
    const selector = surface === 'NOTES' ? '[data-pilot-note-id]' : '[data-pilot-render-id]:not([data-pilot-note-id])';

    const measure = () => {
      if (cancelled || document.visibilityState !== 'visible') return;
      const bounds = root.getBoundingClientRect();
      const batch: Array<{ key: string; entry: PilotRenderEntry }> = [];
      for (const node of root.querySelectorAll<HTMLElement>(selector)) {
        const id = node.dataset.pilotRenderId;
        const version = Number(node.dataset.pilotRenderVersion);
        if (!id || !Number.isSafeInteger(version) || version <= 0) continue;
        const noteId = node.dataset.pilotNoteId;
        const parentNoteId = node.dataset.pilotParentId ?? null;
        const key = JSON.stringify([id, noteId, parentNoteId]);
        if (sent.current.get(key) === version || !visibleInContainer(node, bounds)) continue;
        batch.push({ key, entry: { id, version, ...(noteId && { noteId, parentNoteId }) } });
        if (batch.length === 100) break;
      }
      if (!batch.length) return;
      for (const { key, entry } of batch) sent.current.set(key, entry.version);
      const retry = () => {
        for (const { key, entry } of batch) {
          if (sent.current.get(key) === entry.version) sent.current.delete(key);
        }
      };
      void acknowledgePilotRender(
        surface,
        batch.map(({ entry }) => entry),
      )
        .then((success) => {
          if (!success) retry();
        })
        .catch(retry);
    };

    const check = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        frame = requestAnimationFrame(measure);
      });
    };
    check();
    document.addEventListener('scroll', check, true);
    document.addEventListener('visibilitychange', check);
    window.addEventListener('resize', check);
    // Changing the note search or paging can reveal entries without scrolling.
    const observer = surface === 'NOTES' ? new MutationObserver(check) : null;
    observer?.observe(root, { childList: true, subtree: true });
    return () => {
      cancelled = true;
      cancelAnimationFrame(frame);
      document.removeEventListener('scroll', check, true);
      document.removeEventListener('visibilitychange', check);
      window.removeEventListener('resize', check);
      observer?.disconnect();
    };
  }, [container, surface, enabled, renderKey]);
}
