'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { loadRecentDashboardRequests } from '@/app/actions/dashboardActions';
import { FormatDate } from '@/components/ui/FormatDate';
import type { DashboardRequestPage } from '@/lib/dashboardSummary';

export function RecentDashboardRequests({ initialPage, total }: { initialPage: DashboardRequestPage; total: number }) {
  const [page, setPage] = useState(initialPage);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [pendingPage, setPendingPage] = useState<DashboardRequestPage | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const busyRef = useRef(false);
  const mountedRef = useRef(true);
  const generation = useRef(0);
  const initialSignature = JSON.stringify(initialPage);
  const previousSignature = useRef(initialSignature);
  const applyPage = useCallback((next: DashboardRequestPage) => {
    generation.current += 1;
    busyRef.current = false;
    setLoading(false);
    setError('');
    setPage(next);
    setPendingPage(null);
  }, []);
  useEffect(() => {
    if (previousSignature.current === initialSignature) return;
    previousSignature.current = initialSignature;
    if ((listRef.current?.scrollTop || 0) > 8) setPendingPage(initialPage);
    else applyPage(initialPage);
  }, [initialPage, initialSignature, applyPage]);
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  const loadMore = useCallback(async () => {
    if (!page.nextCursor || busyRef.current) return;
    busyRef.current = true;
    const requestGeneration = generation.current;
    setLoading(true);
    setError('');
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const result = await Promise.race([
        loadRecentDashboardRequests(page.nextCursor),
        new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('timeout')), 20_000); }),
      ]);
      if (!mountedRef.current || requestGeneration !== generation.current) return;
      if (!result.success) { setError(result.error); return; }
      setPage(previous => {
        const ids = new Set(previous.items.map(item => item.id));
        return { items: [...previous.items, ...result.page.items.filter(item => !ids.has(item.id))], nextCursor: result.page.nextCursor };
      });
    } catch {
      if (mountedRef.current && requestGeneration === generation.current) setError('Unable to load more requests. Please try again.');
    } finally {
      clearTimeout(timer);
      if (requestGeneration === generation.current) {
        busyRef.current = false;
        if (mountedRef.current) setLoading(false);
      }
    }
  }, [page.nextCursor]);

  useEffect(() => {
    if (!page.nextCursor || loading || error || !sentinelRef.current || !listRef.current) return;
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) void loadMore();
    }, { root: listRef.current, rootMargin: '160px' });
    observer.observe(sentinelRef.current);
    return () => observer.disconnect();
  }, [page.nextCursor, loading, error, loadMore]);

  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
      <div className="px-4 sm:px-6 py-4 border-b border-slate-100 flex flex-col gap-1.5 sm:flex-row sm:items-center sm:justify-between">
        <h2 className="text-lg font-semibold text-slate-900">Recent Task Requests</h2>
        <span className="text-xs text-slate-500">{total} total</span>
        {pendingPage && <button type="button" className="app-btn-secondary text-xs" onClick={() => {
          if (listRef.current) listRef.current.scrollTop = 0;
          applyPage(pendingPage);
        }}>Update list</button>}
      </div>
      <div ref={listRef} onScroll={() => {
        if (pendingPage && (listRef.current?.scrollTop || 0) <= 8) applyPage(pendingPage);
      }} className="max-h-[420px] overflow-y-auto divide-y divide-slate-100">
        {page.items.map(task => (
          <div key={task.id} className="p-4 sm:p-6 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <p className="text-sm font-medium text-slate-900 truncate">{task.title}</p>
              <p className="text-xs text-slate-500">{task.loan.borrowerName} • {task.loan.loanNumber}</p>
            </div>
            <span className="shrink-0 text-[11px] sm:text-xs text-slate-500"><FormatDate date={task.createdAt} mode="datetime" /></span>
          </div>
        ))}
        {page.items.length === 0 && <div className="p-6 text-sm text-slate-500">No task requests yet.</div>}
        {page.nextCursor && (
          <div ref={sentinelRef} className="p-4 text-center">
            {error && <p role="alert" className="mb-2 text-sm text-red-600">{error}</p>}
            <button type="button" className="app-btn-secondary" disabled={loading} onClick={() => void loadMore()}>
              {loading ? 'Loading requests…' : error ? 'Retry' : 'Load more requests'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
