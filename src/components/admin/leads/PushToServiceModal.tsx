'use client';

import React, { useState, useCallback } from 'react';
import {
  X,
  Zap,
  Loader2,
  CheckCircle2,
  AlertTriangle,
  Info,
} from 'lucide-react';
import { pushLeadsToService } from '@/app/actions/leadActions';

export type ServiceSummary = {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  type: string;
};

type Props = {
  leadIds: string[];
  services: ServiceSummary[];
  onClose: () => void;
};

type PushState =
  | { status: 'idle' }
  | { status: 'confirming'; service: ServiceSummary }
  | { status: 'pushing'; service: ServiceSummary }
  | {
      status: 'done';
      service: ServiceSummary;
      result: {
        total: number;
        succeeded: number;
        skipped: Array<{ leadId: string; reason: string; info?: string }>;
        failed: Array<{
          leadId: string;
          reason: string;
          status?: number;
          statusText?: string;
          info?: string;
        }>;
      };
    }
  | { status: 'error'; service: ServiceSummary; message: string };

const REASON_LABELS: Record<string, string> = {
  no_assignee: 'No assigned LO',
  no_webhook_url: 'Assigned LO has no Bonzo webhook URL configured',
  lead_not_found: 'Lead not found',
  http_error: 'Integration returned an error',
  exception: 'Network or server error',
};

export function PushToServiceModal({ leadIds, services, onClose }: Props) {
  const [state, setState] = useState<PushState>({ status: 'idle' });

  const startPush = useCallback(
    async (svc: ServiceSummary) => {
      setState({ status: 'pushing', service: svc });
      try {
        const result = await pushLeadsToService({
          serviceSlug: svc.slug,
          leadIds,
        });
        setState({ status: 'done', service: svc, result });
      } catch (err) {
        setState({
          status: 'error',
          service: svc,
          message: err instanceof Error ? err.message : 'Push failed',
        });
      }
    },
    [leadIds]
  );

  const active = services.filter(() => true);
  const pushing = state.status === 'pushing';

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      onClick={pushing ? undefined : onClose}
    >
      <div className="absolute inset-0 bg-slate-900/30 backdrop-blur-sm" />
      <div
        role="dialog"
        aria-modal="true"
        className="relative w-full max-w-2xl rounded-xl border border-slate-200 bg-white p-6 shadow-lg max-h-[85vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-5">
          <div className="flex items-center gap-2">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-indigo-100 text-indigo-700">
              <Zap className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-slate-900">
                Push to Service
              </h2>
              <p className="text-xs text-slate-500">
                {leadIds.length} lead{leadIds.length === 1 ? '' : 's'} selected
              </p>
            </div>
          </div>
          <button
            className="app-icon-btn"
            onClick={onClose}
            aria-label="Close"
            disabled={pushing}
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {state.status === 'idle' && (
          <>
            <div className="rounded-lg border border-slate-200 bg-slate-50/60 px-4 py-3 mb-4 flex items-start gap-2 text-sm text-slate-600">
              <Info className="h-4 w-4 mt-0.5 text-slate-500 flex-shrink-0" />
              <div>
                Each lead is pushed to its{' '}
                <span className="font-semibold">currently assigned LO</span>
                &apos;s integration account. Leads without an assignee or
                without the service configured for that LO are skipped.
              </div>
            </div>

            {active.length === 0 ? (
              <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                No active services. Go to{' '}
                <a
                  href="/admin/leads/services"
                  className="underline font-semibold"
                >
                  Integration Services
                </a>{' '}
                to add one.
              </div>
            ) : (
              <div className="space-y-2">
                {active.map((s) => (
                  <div
                    key={s.id}
                    className="flex items-center justify-between rounded-xl border border-slate-200 bg-white px-4 py-3 hover:border-indigo-300 transition-colors"
                  >
                    <div className="flex items-center gap-3">
                      <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-indigo-100 text-indigo-700">
                        <Zap className="h-4 w-4" />
                      </div>
                      <div>
                        <div className="font-semibold text-slate-900">
                          {s.name}
                        </div>
                        <div className="text-xs text-slate-500 max-w-md">
                          {s.description || `type: ${s.type}`}
                        </div>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() =>
                        setState({ status: 'confirming', service: s })
                      }
                      className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3 py-1.5 text-sm font-semibold text-white shadow-sm hover:bg-indigo-700"
                    >
                      <Zap className="h-3.5 w-3.5" />
                      Push {leadIds.length} lead
                      {leadIds.length === 1 ? '' : 's'}
                    </button>
                  </div>
                ))}
              </div>
            )}
          </>
        )}

        {state.status === 'confirming' && (
          <div>
            <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 flex items-start gap-2">
              <AlertTriangle className="h-4 w-4 mt-0.5 flex-shrink-0" />
              <div>
                About to push{' '}
                <span className="font-semibold">{leadIds.length}</span> lead
                {leadIds.length === 1 ? '' : 's'} to{' '}
                <span className="font-semibold">{state.service.name}</span>.
                This cannot be undone. Large batches may take a minute.
              </div>
            </div>
            <div className="mt-4 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setState({ status: 'idle' })}
                className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void startPush(state.service)}
                className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-indigo-700"
              >
                <Zap className="h-4 w-4" />
                Confirm push
              </button>
            </div>
          </div>
        )}

        {state.status === 'pushing' && (
          <div className="py-10 text-center">
            <Loader2 className="mx-auto h-8 w-8 animate-spin text-indigo-600" />
            <p className="mt-3 text-sm font-semibold text-slate-700">
              Pushing {leadIds.length} lead
              {leadIds.length === 1 ? '' : 's'} to {state.service.name}…
            </p>
            <p className="text-xs text-slate-500 mt-1">
              Processing up to 5 at a time. Don&apos;t close this window.
            </p>
          </div>
        )}

        {state.status === 'done' && (
          <PushResultView
            service={state.service}
            result={state.result}
            onClose={onClose}
            onPushAnother={() => setState({ status: 'idle' })}
          />
        )}

        {state.status === 'error' && (
          <div>
            <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700 flex items-start gap-2">
              <AlertTriangle className="h-4 w-4 mt-0.5 flex-shrink-0" />
              <div>
                <div className="font-semibold">Push failed</div>
                <div className="text-xs mt-1">{state.message}</div>
              </div>
            </div>
            <div className="mt-4 flex items-center justify-end">
              <button
                type="button"
                onClick={() => setState({ status: 'idle' })}
                className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
              >
                Back
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function PushResultView({
  service,
  result,
  onClose,
  onPushAnother,
}: {
  service: ServiceSummary;
  result: {
    total: number;
    succeeded: number;
    skipped: Array<{ leadId: string; reason: string; info?: string }>;
    failed: Array<{
      leadId: string;
      reason: string;
      status?: number;
      statusText?: string;
      info?: string;
    }>;
  };
  onClose: () => void;
  onPushAnother: () => void;
}) {
  const skippedByReason = groupByReason(result.skipped);
  const failedByReason = groupByReason(result.failed);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-3">
        <StatCard
          label="Succeeded"
          value={result.succeeded}
          tone="emerald"
          Icon={CheckCircle2}
        />
        <StatCard
          label="Skipped"
          value={result.skipped.length}
          tone="amber"
          Icon={Info}
        />
        <StatCard
          label="Failed"
          value={result.failed.length}
          tone="rose"
          Icon={AlertTriangle}
        />
      </div>

      <div className="text-xs text-slate-500">
        {result.total} total &middot; pushed to{' '}
        <span className="font-semibold">{service.name}</span>
      </div>

      {result.skipped.length > 0 && (
        <details className="rounded-xl border border-amber-200 bg-amber-50" open>
          <summary className="cursor-pointer px-4 py-3 text-sm font-semibold text-amber-800">
            Skipped ({result.skipped.length})
          </summary>
          <div className="px-4 pb-3 space-y-2">
            {Object.entries(skippedByReason).map(([reason, items]) => (
              <div key={reason} className="text-sm">
                <div className="font-semibold text-amber-900">
                  {REASON_LABELS[reason] ?? reason} ({items.length})
                </div>
                <ul className="ml-4 mt-1 text-xs text-amber-800 list-disc">
                  {items.slice(0, 10).map((i) => (
                    <li key={i.leadId}>
                      {shortId(i.leadId)}
                      {i.info && <span className="text-amber-700">— {i.info}</span>}
                    </li>
                  ))}
                  {items.length > 10 && (
                    <li className="list-none text-amber-700">
                      …and {items.length - 10} more
                    </li>
                  )}
                </ul>
              </div>
            ))}
          </div>
        </details>
      )}

      {result.failed.length > 0 && (
        <details
          className="rounded-xl border border-rose-200 bg-rose-50"
          open
        >
          <summary className="cursor-pointer px-4 py-3 text-sm font-semibold text-rose-800">
            Failed ({result.failed.length})
          </summary>
          <div className="px-4 pb-3 space-y-2">
            {Object.entries(failedByReason).map(([reason, items]) => (
              <div key={reason} className="text-sm">
                <div className="font-semibold text-rose-900">
                  {REASON_LABELS[reason] ?? reason} ({items.length})
                </div>
                <ul className="ml-4 mt-1 text-xs text-rose-800 list-disc">
                  {items.slice(0, 10).map((i) => (
                    <li key={i.leadId}>
                      {shortId(i.leadId)}
                      {i.status
                        ? ` — HTTP ${i.status} ${i.statusText ?? ''}`
                        : ''}
                      {i.info && <span className="text-rose-700"> {i.info}</span>}
                    </li>
                  ))}
                  {items.length > 10 && (
                    <li className="list-none text-rose-700">
                      …and {items.length - 10} more
                    </li>
                  )}
                </ul>
              </div>
            ))}
          </div>
        </details>
      )}

      <div className="flex items-center justify-end gap-2 pt-2">
        <button
          type="button"
          onClick={onPushAnother}
          className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
        >
          Push to another service
        </button>
        <button
          type="button"
          onClick={onClose}
          className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-blue-700"
        >
          Done
        </button>
      </div>
    </div>
  );
}

function StatCard({
  label,
  value,
  tone,
  Icon,
}: {
  label: string;
  value: number;
  tone: 'emerald' | 'amber' | 'rose';
  Icon: React.ComponentType<{ className?: string }>;
}) {
  const colorMap = {
    emerald: 'border-emerald-200 bg-emerald-50 text-emerald-700',
    amber: 'border-amber-200 bg-amber-50 text-amber-700',
    rose: 'border-rose-200 bg-rose-50 text-rose-700',
  };
  return (
    <div className={`rounded-xl border px-4 py-3 ${colorMap[tone]}`}>
      <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider">
        <Icon className="h-3.5 w-3.5" />
        {label}
      </div>
      <div className="mt-1 text-2xl font-bold tabular-nums">{value}</div>
    </div>
  );
}

function groupByReason<T extends { reason: string }>(items: T[]) {
  const out: Record<string, T[]> = {};
  for (const i of items) {
    if (!out[i.reason]) out[i.reason] = [];
    out[i.reason].push(i);
  }
  return out;
}

function shortId(id: string) {
  return id.length > 8 ? `${id.slice(0, 8)}…` : id;
}
