'use client';

import { PortalLoadingState } from '../layout/PortalLoadingState';

export function AppRouteLoading({ label = 'Opening your workspace', preview = 'cards' }: { label?: string; preview?: 'cards' | 'table' }) {
  return <PortalLoadingState label={label} preview={preview} />;
}
