import React, { isValidElement, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const preparation = vi.hoisted(() => ({ ready: null as { url: string; expires: number } | null }));
// Exercise the actual tile handlers with a controlled preparation state.
vi.mock('react', async () => {
  const original = await vi.importActual<typeof import('react')>('react');
  return {
    ...original,
    useState: (initial: unknown) => [initial === null ? preparation.ready : initial, vi.fn()],
    useRef: (initial: unknown) => ({ current: initial }),
    useCallback: (callback: unknown) => callback,
    useEffect: () => {},
  };
});
import { PilotDocumentFile } from './PilotDocumentFile';

type ElementProps = {
  children?: ReactNode;
  'data-file-tile'?: string;
  href?: string;
  download?: string;
  onClick?: () => void;
  onDragStart?: (event: React.DragEvent<HTMLButtonElement>) => void;
};
function findElement(node: ReactNode, match: (props: ElementProps) => boolean): ElementProps | undefined {
  if (!isValidElement<ElementProps>(node)) return undefined;
  if (match(node.props)) return node.props;
  for (const child of React.Children.toArray(node.props.children)) {
    const found = findElement(child, match);
    if (found) return found;
  }
}
const file = { id: 'file /#', name: 'Mortgage Statement.pdf', type: 'application/pdf', size: 100, path: 'private/object', uploadedAt: '' };
const downloadPath = '/api/processing-submission/task%2Fid%3F/files/file%20%2F%23?download=1';
const renderTile = () => PilotDocumentFile({ taskId: 'task/id?', file });
function dragEvent() {
  return {
    stopPropagation: vi.fn(), preventDefault: vi.fn(),
    dataTransfer: { clearData: vi.fn(), setData: vi.fn(), effectAllowed: '', items: { add: vi.fn() } },
  };
}
beforeEach(() => {
  preparation.ready = { url: 'https://storage.example.test/signed?token=private', expires: Date.now() + 60000 };
  vi.stubGlobal('window', { location: { origin: 'https://bisuportal.com' }, open: vi.fn() });
  vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(() => {})));
});
afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); });

describe('pilot document folder dragging', () => {
  it('drags the same authenticated BISU URL as the download icon, never the prepared storage URL', () => {
    const tree = renderTile();
    const tile = findElement(tree, props => props['data-file-tile'] === 'true')!;
    const download = findElement(tree, props => !!props.href)!;
    const event = dragEvent();
    tile.onDragStart!(event as unknown as React.DragEvent<HTMLButtonElement>);
    expect(download.href).toBe(downloadPath);
    expect(download.download).toBe(file.name);
    expect(event.dataTransfer.setData).toHaveBeenCalledExactlyOnceWith('DownloadURL', `application/pdf:Mortgage Statement.pdf:https://bisuportal.com${download.href}`);
    expect(event.dataTransfer.items.add).not.toHaveBeenCalled();
    expect(event.dataTransfer.clearData).toHaveBeenCalledOnce();
    expect(event.dataTransfer.effectAllowed).toBe('copy');
    expect(event.preventDefault).not.toHaveBeenCalled();
  });

  it.each(['not prepared', 'expired'] as const)('still blocks a drag when preparation is %s', state => {
    preparation.ready = state === 'not prepared' ? null : { url: 'https://storage.example.test/expired', expires: Date.now() - 1 };
    const tile = findElement(renderTile(), props => props['data-file-tile'] === 'true')!;
    const event = dragEvent();
    tile.onDragStart!(event as unknown as React.DragEvent<HTMLButtonElement>);
    expect(event.preventDefault).toHaveBeenCalledOnce();
    expect(event.dataTransfer.setData).not.toHaveBeenCalled();
    expect(fetch).toHaveBeenCalledWith('/api/processing-submission/task%2Fid%3F/files/file%20%2F%23?prepare=1', expect.any(Object));
  });

  it('continues to open the existing inline preview when clicked', () => {
    findElement(renderTile(), props => props['data-file-tile'] === 'true')!.onClick!();
    expect(window.open).toHaveBeenCalledWith('/api/processing-submission/task%2Fid%3F/files/file%20%2F%23', '_blank', 'noopener,noreferrer');
  });
});
