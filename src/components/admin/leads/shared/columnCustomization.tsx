'use client';

/**
 * Shared column-customization primitives for admin tables.
 *
 * Extracted verbatim (behavior-wise) from LeadsCRM.tsx so the Users
 * table - and any future admin table - can ship the same resize / reorder /
 * localStorage-persisted layout UX without duplicating ~300 lines of
 * DnD glue.
 *
 * Three pieces:
 *   1. useColumnWidths  - per-column pixel widths, lazy-init + persist
 *   2. useColumnOrder   - draggable column order, lazy-init + persist
 *   3. ResizeHandle     - the 1px-grows-to-3px spreadsheet-style handle
 *
 * The hooks are fully typed on the column-id string literal union so
 * callers keep strong typing end-to-end.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';

// ---------------------------------------------------------------------------
// ResizeHandle
// ---------------------------------------------------------------------------

/**
 * Visible, discoverable column resize handle. Renders a persistent thin
 * divider at the column boundary (spreadsheet-style) plus a wider invisible
 * grab zone so the handle is easy to target with the mouse.
 */
export function ResizeHandle({
  label,
  onStartResize,
  isResizing,
}: {
  label: string;
  onStartResize: (e: React.MouseEvent) => void;
  isResizing: boolean;
}) {
  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={`Resize ${label} column`}
      onMouseDown={onStartResize}
      onClick={(e) => e.stopPropagation()}
      className="group/resize absolute top-0 right-0 bottom-0 w-3 flex items-center justify-end cursor-col-resize select-none z-10"
    >
      <div
        className={`h-full transition-all ${
          isResizing
            ? 'w-[3px] bg-blue-500'
            : 'w-px bg-slate-200 group-hover/resize:w-[3px] group-hover/resize:bg-blue-400'
        }`}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// useColumnWidths
// ---------------------------------------------------------------------------

export type ColumnWidthSpec<Id extends string> = {
  id: Id;
  defaultWidth: number;
  minWidth: number;
};

export type UseColumnWidthsResult<Id extends string> = {
  widths: Record<Id, number>;
  setWidths: React.Dispatch<React.SetStateAction<Record<Id, number>>>;
  resizingCol: Id | null;
  startResize: (colId: Id, minWidth: number) => (e: React.MouseEvent) => void;
  reset: () => void;
};

/**
 * Column widths keyed by id, lazy-hydrated from `localStorage`. Unknown
 * ids are ignored so the storage schema stays forward-compatible when new
 * columns are added; missing ids fall back to the provided defaults.
 */
export function useColumnWidths<Id extends string>(
  columns: ReadonlyArray<ColumnWidthSpec<Id>>,
  storageKey: string
): UseColumnWidthsResult<Id> {
  const buildDefaults = useCallback((): Record<Id, number> => {
    return columns.reduce((acc, c) => {
      acc[c.id] = c.defaultWidth;
      return acc;
    }, {} as Record<Id, number>);
  }, [columns]);

  const [widths, setWidths] = useState<Record<Id, number>>(() => {
    const defaults = buildDefaults();
    if (typeof window === 'undefined') return defaults;
    try {
      const raw = window.localStorage.getItem(storageKey);
      if (!raw) return defaults;
      const parsed = JSON.parse(raw) as Partial<Record<Id, number>>;
      const merged = { ...defaults };
      for (const col of columns) {
        const v = parsed[col.id];
        if (typeof v === 'number' && Number.isFinite(v) && v > 0) {
          merged[col.id] = Math.max(col.minWidth, Math.round(v));
        }
      }
      return merged;
    } catch {
      return defaults;
    }
  });

  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      window.localStorage.setItem(storageKey, JSON.stringify(widths));
    } catch {
      // Ignore quota / private-mode errors
    }
  }, [widths, storageKey]);

  const [resizingCol, setResizingCol] = useState<Id | null>(null);
  const resizeStateRef = useRef<{
    col: Id;
    startX: number;
    startWidth: number;
    minWidth: number;
  } | null>(null);

  const startResize = useCallback(
    (colId: Id, minWidth: number) =>
      (e: React.MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();
        resizeStateRef.current = {
          col: colId,
          startX: e.clientX,
          startWidth: widths[colId],
          minWidth,
        };
        setResizingCol(colId);

        const onMove = (ev: MouseEvent) => {
          const st = resizeStateRef.current;
          if (!st) return;
          const delta = ev.clientX - st.startX;
          const next = Math.max(st.minWidth, Math.round(st.startWidth + delta));
          setWidths((prev) =>
            prev[st.col] === next ? prev : { ...prev, [st.col]: next }
          );
        };
        const onUp = () => {
          resizeStateRef.current = null;
          setResizingCol(null);
          document.removeEventListener('mousemove', onMove);
          document.removeEventListener('mouseup', onUp);
          document.body.style.removeProperty('cursor');
          document.body.style.removeProperty('user-select');
        };
        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onUp);
        document.body.style.cursor = 'col-resize';
        document.body.style.userSelect = 'none';
      },
    [widths]
  );

  const reset = useCallback(() => {
    setWidths(buildDefaults());
  }, [buildDefaults]);

  return { widths, setWidths, resizingCol, startResize, reset };
}

// ---------------------------------------------------------------------------
// useColumnOrder
// ---------------------------------------------------------------------------

export type DropIndicator = 'left' | 'right' | null;

export type ColumnDragHandlers = {
  draggable: boolean;
  onDragStart: (e: React.DragEvent<HTMLButtonElement>) => void;
  onDragOver: (e: React.DragEvent<HTMLTableCellElement>) => void;
  onDragLeave: (e: React.DragEvent<HTMLTableCellElement>) => void;
  onDrop: (e: React.DragEvent<HTMLTableCellElement>) => void;
  onDragEnd: (e: React.DragEvent<HTMLButtonElement>) => void;
};

export type UseColumnOrderResult<Id extends string> = {
  order: Id[];
  setOrder: React.Dispatch<React.SetStateAction<Id[]>>;
  draggingColId: Id | null;
  dropTarget: { colId: Id; side: 'left' | 'right' } | null;
  getHandlers: (colId: Id) => ColumnDragHandlers;
  getDropIndicator: (colId: Id) => DropIndicator;
  reset: () => void;
};

/**
 * Draggable column order keyed by id, lazy-hydrated from `localStorage`.
 * Validated on load so unknown ids are dropped and missing ids are
 * appended in the default order. `lockedFirstId`, if provided, is pinned
 * to position 0 regardless of what was persisted.
 */
export function useColumnOrder<Id extends string>({
  defaultOrder,
  storageKey,
  lockedFirstId,
}: {
  defaultOrder: ReadonlyArray<Id>;
  storageKey: string;
  lockedFirstId?: Id;
}): UseColumnOrderResult<Id> {
  const [order, setOrder] = useState<Id[]>(() => {
    const defaults = [...defaultOrder];
    if (typeof window === 'undefined') return defaults;
    try {
      const raw = window.localStorage.getItem(storageKey);
      if (!raw) return defaults;
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return defaults;
      const knownIds = new Set<Id>(defaults);
      const seen = new Set<Id>();
      const filtered: Id[] = [];
      for (const raw_id of parsed) {
        if (typeof raw_id !== 'string') continue;
        const id = raw_id as Id;
        if (!knownIds.has(id) || seen.has(id)) continue;
        seen.add(id);
        filtered.push(id);
      }
      for (const id of defaults) if (!seen.has(id)) filtered.push(id);
      if (lockedFirstId !== undefined) {
        const withoutLocked = filtered.filter((id) => id !== lockedFirstId);
        return [lockedFirstId, ...withoutLocked];
      }
      return filtered;
    } catch {
      return defaults;
    }
  });

  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      window.localStorage.setItem(storageKey, JSON.stringify(order));
    } catch {
      // Ignore quota errors
    }
  }, [order, storageKey]);

  const [draggingColId, setDraggingColId] = useState<Id | null>(null);
  const [dropTarget, setDropTarget] = useState<{
    colId: Id;
    side: 'left' | 'right';
  } | null>(null);

  const getHandlers = useCallback(
    (colId: Id): ColumnDragHandlers => {
      const isLocked = lockedFirstId !== undefined && colId === lockedFirstId;
      return {
        draggable: !isLocked,
        onDragStart: (e) => {
          if (isLocked) {
            e.preventDefault();
            return;
          }
          setDraggingColId(colId);
          e.dataTransfer.effectAllowed = 'move';
          try {
            e.dataTransfer.setData('text/plain', colId);
          } catch {
            // Some browsers throw in certain sandboxed contexts; ignore.
          }
        },
        onDragOver: (e) => {
          if (!draggingColId || draggingColId === colId) return;
          if (isLocked) return;
          e.preventDefault();
          e.dataTransfer.dropEffect = 'move';
          const rect = e.currentTarget.getBoundingClientRect();
          const isLeftHalf = e.clientX < rect.left + rect.width / 2;
          const side: 'left' | 'right' = isLeftHalf ? 'left' : 'right';
          setDropTarget((prev) =>
            prev && prev.colId === colId && prev.side === side
              ? prev
              : { colId, side }
          );
        },
        onDragLeave: () => {
          setDropTarget((prev) => (prev?.colId === colId ? null : prev));
        },
        onDrop: (e) => {
          e.preventDefault();
          const src = draggingColId;
          const tgt = dropTarget;
          setDraggingColId(null);
          setDropTarget(null);
          if (!src || src === colId || isLocked) return;
          setOrder((prev) => {
            const next = prev.filter((id) => id !== src);
            const tgtIdx = next.indexOf(colId);
            if (tgtIdx < 0) return prev;
            const insertIdx =
              tgt && tgt.colId === colId && tgt.side === 'right'
                ? tgtIdx + 1
                : tgtIdx;
            next.splice(insertIdx, 0, src);
            return next;
          });
        },
        onDragEnd: () => {
          setDraggingColId(null);
          setDropTarget(null);
        },
      };
    },
    [draggingColId, dropTarget, lockedFirstId]
  );

  const getDropIndicator = useCallback(
    (colId: Id): DropIndicator => {
      if (!dropTarget || dropTarget.colId !== colId) return null;
      return dropTarget.side;
    },
    [dropTarget]
  );

  const reset = useCallback(() => {
    setOrder([...defaultOrder]);
  }, [defaultOrder]);

  return {
    order,
    setOrder,
    draggingColId,
    dropTarget,
    getHandlers,
    getDropIndicator,
    reset,
  };
}
