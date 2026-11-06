'use client';

import { createContext, useContext } from 'react';

// Existing page wrappers remain compatible while the root layout owns chrome.
// "bare" also suppresses them during sign-out and on non-portal routes.
export const DashboardShellContext = createContext<'standalone' | 'shared' | 'bare'>('standalone');

export function useDashboardShellMode() {
  return useContext(DashboardShellContext);
}
