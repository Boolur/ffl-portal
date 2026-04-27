'use client';

import React, { useCallback, useEffect, useState, useTransition } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Eye,
  Loader2,
  RefreshCcw,
  Trash2,
  X,
} from 'lucide-react';
import {
  deleteInboxEvent,
  getWebhookInboxCounts,
  getWebhookInboxEventDetail,
  listWebhookInboxEvents,
  replayAllFailedInboxEvents,
  replayInboxEvent,
  type InboxStatusFilter,
  type WebhookInboxCounts,
  type WebhookInboxListItem,
} from '@/app/actions/webhookInboxActions';
import { FormatDate } from '@/components/ui/FormatDate';

const STATUS_STYLE: Record<
  WebhookInboxListItem['status'],
  { label: string; className: string }
> = {
  PENDING: {
    label: 'Pending',
    className: 'border-slate-200 bg-slate-50 text-slate-600',
  },
  PROCESSED: {
    label: 'Processed',
    className: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  },
  FAILED: {
    label: 'Failed',
    className: 'border-rose-200 bg-rose-50 text-rose-700',
  },
  SKIPPED: {
    label: 'Skipped',
    className: 'border-amber-200 bg-amber-50 text-amber-700',
  },
};

export function WebhookInboxPanel() {
  const [counts, setCounts] = useState<WebhookInboxCounts | null>(null);
  const [events, setEvents] = useState<WebhookInboxListItem[]>([]);
  const [statusFilter, setStatusFilter] = useState<InboxStatusFilter>('FAILED');
  const [expanded, setExpanded] = useState(false);
  const [loadingList, setLoadingList] = useState(false);
  const [bulkMessage, setBulkMessage] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [detail, setDetail] = useState<
    Awaited<ReturnType<typeof getWebhookInboxEventDetail>> | null
  >(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const refreshCounts = useCallback(async () => {
    try {
      const next = await getWebhookInboxCounts();
      setCounts(next);
    } catch {
      // Graceful degradation: if the inbox table isn't reachable (e.g.
      // migration hasn't run yet on a given env) we just hide the panel
      // rather than crash the parent page.
      setCounts({ pending: 0, failed: 0, processed: 0, skipped: 0 });
    }
  }, []);

  const refreshList = useCallback(
    async (status: InboxStatusFilter) => {
      setLoadingList(true);
      try {
        const next = await listWebhookInboxEvents({ status, take: 50 });
        setEvents(next);
      } catch {
        setEvents([]);
      } finally {
        setLoadingList(false);
      }
    },
    []
  );

  useEffect(() => {
    void refreshCounts();
  }, [refreshCounts]);

  useEffect(() => {
    if (!expanded) return;
    void refreshList(statusFilter);
  }, [expanded, statusFilter, refreshList]);

  const hasAttention =
    (counts?.failed ?? 0) > 0 || (counts?.pending ?? 0) > 0;

  // Only render at all when there is *something* to surface, or the user
  // has expanded the panel on purpose. Keeps the Lead Distribution
  // overview visually clean in the common healthy state.
  if (!counts) return null;
  if (!hasAttention && !expanded) {
    return (
      <div className="flex items-center gap-2 text-xs text-slate-500">
        <CheckCircle2 className="h-4 w-4 text-emerald-500" />
        Webhook inbox healthy —{' '}
        <button
          type="button"
          className="font-semibold text-blue-600 hover:text-blue-700"
          onClick={() => setExpanded(true)}
        >
          view history
        </button>
      </div>
    );
  }

  const handleReplayOne = (id: string) => {
    setBulkMessage(null);
    startTransition(async () => {
      const res = await replayInboxEvent(id);
      if (!res.ok && res.error) {
        setBulkMessage(`Replay failed: ${res.error}`);
      }
      await refreshCounts();
      await refreshList(statusFilter);
    });
  };

  const handleReplayAll = () => {
    if (!confirm('Replay all failed webhook events?')) return;
    setBulkMessage(null);
    startTransition(async () => {
      const summary = await replayAllFailedInboxEvents();
      setBulkMessage(
        `Replayed ${summary.attempted}: ${summary.processed} succeeded, ${summary.skipped} skipped, ${summary.failed} still failed.`
      );
      await refreshCounts();
      await refreshList(statusFilter);
    });
  };

  const handleDismiss = (id: string) => {
    if (!confirm('Dismiss this event? The raw payload will be deleted.')) return;
    startTransition(async () => {
      await deleteInboxEvent(id);
      await refreshCounts();
      await refreshList(statusFilter);
    });
  };

  const openDetail = async (id: string) => {
    setDetailLoading(true);
    try {
      const d = await getWebhookInboxEventDetail(id);
      setDetail(d);
    } finally {
      setDetailLoading(false);
    }
  };

  return (
    <>
      <div
        className={`rounded-2xl border shadow-sm overflow-hidden ${
          hasAttention
            ? 'border-rose-200 bg-rose-50/40'
            : 'border-slate-200 bg-white'
        }`}
      >
        <div className="flex flex-wrap items-center gap-4 px-6 py-4">
          <div
            className={`flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl ${
              hasAttention
                ? 'bg-rose-600 text-white'
                : 'bg-slate-100 text-slate-600'
            }`}
          >
            {hasAttention ? (
              <AlertTriangle className="h-5 w-5" />
            ) : (
              <CheckCircle2 className="h-5 w-5" />
            )}
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="text-sm font-bold text-slate-900">Webhook Inbox</h3>
            <p className="text-xs text-slate-600 mt-0.5">
              Every inbound vendor webhook is captured here first. Replay
              FAILED events after fixing the underlying issue.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3 text-xs font-semibold">
            <CountPill label="Failed" value={counts.failed} tone="rose" />
            <CountPill label="Pending" value={counts.pending} tone="slate" />
            <CountPill
              label="Processed"
              value={counts.processed}
              tone="emerald"
            />
            <CountPill label="Skipped" value={counts.skipped} tone="amber" />
          </div>

          <div className="flex items-center gap-2">
            {counts.failed > 0 && (
              <button
                type="button"
                onClick={handleReplayAll}
                disabled={isPending}
                className="inline-flex items-center gap-1.5 rounded-lg bg-rose-600 px-3 py-1.5 text-xs font-semibold text-white shadow-sm hover:bg-rose-700 disabled:opacity-60"
              >
                {isPending ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <RefreshCcw className="h-3.5 w-3.5" />
                )}
                Replay all failed
              </button>
            )}
            <button
              type="button"
              onClick={() => setExpanded((v) => !v)}
              className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
            >
              {expanded ? (
                <>
                  <ChevronUp className="h-3.5 w-3.5" /> Hide
                </>
              ) : (
                <>
                  <ChevronDown className="h-3.5 w-3.5" /> View events
                </>
              )}
            </button>
          </div>
        </div>

        {bulkMessage && (
          <div className="px-6 pb-3 text-xs text-slate-700">{bulkMessage}</div>
        )}

        {expanded && (
          <div className="border-t border-slate-200 bg-white">
            <div className="flex flex-wrap items-center gap-2 px-6 py-3 border-b border-slate-100">
              {(['FAILED', 'PENDING', 'SKIPPED', 'PROCESSED', 'ALL'] as const).map(
                (s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => setStatusFilter(s)}
                    className={`px-3 py-1 rounded-full text-[11px] font-semibold transition-colors ${
                      statusFilter === s
                        ? 'bg-slate-900 text-white'
                        : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                    }`}
                  >
                    {s === 'ALL' ? 'All' : STATUS_STYLE[s].label}
                  </button>
                )
              )}
              <button
                type="button"
                onClick={() => {
                  void refreshCounts();
                  void refreshList(statusFilter);
                }}
                className="ml-auto inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-1 text-[11px] font-semibold text-slate-700 hover:bg-slate-50"
              >
                <RefreshCcw className="h-3 w-3" /> Refresh
              </button>
            </div>

            {loadingList ? (
              <div className="flex items-center justify-center py-10 text-sm text-slate-500">
                <Loader2 className="h-5 w-5 animate-spin" />
              </div>
            ) : events.length === 0 ? (
              <div className="py-10 text-center text-sm text-slate-500">
                No events in this bucket.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-100 bg-slate-50/60 text-[11px] font-bold uppercase tracking-wider text-slate-500">
                      <th className="px-6 py-2 text-left">Status</th>
                      <th className="px-6 py-2 text-left">Source</th>
                      <th className="px-6 py-2 text-left">Preview</th>
                      <th className="px-6 py-2 text-left">Error</th>
                      <th className="px-6 py-2 text-right">Received</th>
                      <th className="px-6 py-2 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {events.map((e) => {
                      const style = STATUS_STYLE[e.status];
                      return (
                        <tr key={e.id} className="hover:bg-slate-50/70">
                          <td className="px-6 py-2">
                            <span
                              className={`inline-flex rounded-full border px-2.5 py-0.5 text-[11px] font-semibold ${style.className}`}
                            >
                              {style.label}
                              {e.attempts > 0 && ` · ${e.attempts}`}
                            </span>
                          </td>
                          <td className="px-6 py-2 text-xs text-slate-600 whitespace-nowrap">
                            {e.source}
                            {e.vendorSlug ? (
                              <span className="text-slate-400"> / {e.vendorSlug}</span>
                            ) : null}
                          </td>
                          <td className="px-6 py-2 text-slate-700">
                            {e.preview}
                          </td>
                          <td className="px-6 py-2 text-xs text-rose-700 max-w-[360px] truncate">
                            {e.errorMessage || '—'}
                          </td>
                          <td className="px-6 py-2 text-right text-xs text-slate-500 whitespace-nowrap">
                            <FormatDate date={e.receivedAt} mode="datetime" />
                          </td>
                          <td className="px-6 py-2 text-right whitespace-nowrap">
                            <div className="inline-flex items-center gap-1">
                              <button
                                type="button"
                                onClick={() => void openDetail(e.id)}
                                className="inline-flex items-center gap-1 rounded-md border border-slate-200 px-2 py-1 text-[11px] font-semibold text-slate-700 hover:bg-slate-50"
                                title="View payload"
                              >
                                <Eye className="h-3 w-3" />
                              </button>
                              {e.status !== 'PROCESSED' && (
                                <button
                                  type="button"
                                  onClick={() => handleReplayOne(e.id)}
                                  disabled={isPending}
                                  className="inline-flex items-center gap-1 rounded-md bg-blue-600 px-2 py-1 text-[11px] font-semibold text-white hover:bg-blue-700 disabled:opacity-60"
                                  title="Replay"
                                >
                                  <RefreshCcw className="h-3 w-3" />
                                </button>
                              )}
                              <button
                                type="button"
                                onClick={() => handleDismiss(e.id)}
                                disabled={isPending}
                                className="inline-flex items-center gap-1 rounded-md border border-slate-200 px-2 py-1 text-[11px] font-semibold text-slate-700 hover:bg-rose-50 hover:text-rose-700 hover:border-rose-200 disabled:opacity-60"
                                title="Dismiss (delete)"
                              >
                                <Trash2 className="h-3 w-3" />
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </div>

      {(detailLoading || detail) && (
        <div
          className="fixed inset-0 z-[70] bg-slate-900/50 flex items-center justify-center p-4"
          onClick={() => {
            if (!detailLoading) setDetail(null);
          }}
        >
          <div
            className="bg-white rounded-2xl shadow-xl max-w-3xl w-full max-h-[85vh] overflow-hidden flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-5 py-3 border-b border-slate-100">
              <div>
                <h4 className="text-sm font-bold text-slate-900">
                  Webhook Event
                </h4>
                {detail ? (
                  <p className="text-xs text-slate-500 mt-0.5">
                    {detail.source}
                    {detail.vendorSlug ? ` / ${detail.vendorSlug}` : ''} ·{' '}
                    {detail.status}
                  </p>
                ) : null}
              </div>
              <button
                type="button"
                onClick={() => setDetail(null)}
                className="p-1 rounded-lg hover:bg-slate-100 text-slate-500"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="flex-1 overflow-auto p-5 text-xs font-mono text-slate-800 bg-slate-50">
              {detailLoading ? (
                <div className="flex items-center justify-center py-10">
                  <Loader2 className="h-5 w-5 animate-spin text-slate-400" />
                </div>
              ) : detail ? (
                <>
                  {detail.errorMessage && (
                    <div className="mb-4 rounded-lg border border-rose-200 bg-rose-50 p-3 text-rose-800 whitespace-pre-wrap">
                      <strong className="block mb-1">Error</strong>
                      {detail.errorMessage}
                    </div>
                  )}
                  <div className="mb-2 text-[11px] font-bold uppercase tracking-wider text-slate-500">
                    Headers
                  </div>
                  <pre className="whitespace-pre-wrap break-words mb-4">
                    {JSON.stringify(detail.headers, null, 2)}
                  </pre>
                  <div className="mb-2 text-[11px] font-bold uppercase tracking-wider text-slate-500">
                    Body
                  </div>
                  <pre className="whitespace-pre-wrap break-words">
                    {JSON.stringify(detail.body, null, 2)}
                  </pre>
                </>
              ) : null}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function CountPill({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: 'rose' | 'slate' | 'emerald' | 'amber';
}) {
  const toneClasses: Record<typeof tone, string> = {
    rose: 'bg-rose-100 text-rose-700',
    slate: 'bg-slate-100 text-slate-600',
    emerald: 'bg-emerald-100 text-emerald-700',
    amber: 'bg-amber-100 text-amber-700',
  };
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 ${toneClasses[tone]}`}
    >
      <span>{label}</span>
      <span className="tabular-nums">{value}</span>
    </span>
  );
}
