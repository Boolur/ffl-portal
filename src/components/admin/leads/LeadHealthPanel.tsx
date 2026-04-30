'use client';

/**
 * Lead Distribution Health page client. Surfaces three diagnostics in one
 * place so admins can answer "what's broken right now?" without shelling
 * out to scripts:
 *
 *   1. Webhook Inbox — exact same panel shown on the Lead Distribution
 *      overview, included here so this page is the single audit surface.
 *
 *   2. Lead Mapping Audit — pick a vendor (default FreeRateUpdate, which
 *      is the one with the loudest issue) and a lookback window. The
 *      action quantifies how many recent leads would benefit from the
 *      phone fallback / mailing-mirror fixes shipped in
 *      src/lib/bonzoForward.ts and src/lib/webhookIngest.ts.
 *
 *   3. Address Backfill — pulls every lead with a null `propertyAddress`,
 *      tries to recover an address from the stored `rawPayload` using
 *      every alias the bridge accepts, and shows a dry run. Apply writes
 *      the recoverable rows. Mirrors `src/scripts/backfillLeadAddresses.mjs`.
 */

import React, { useEffect, useRef, useState, useTransition } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  HelpCircle,
  Loader2,
  Mail,
  Play,
  RefreshCcw,
  Save,
  Send,
  X,
} from 'lucide-react';
import { WebhookInboxPanel } from './WebhookInboxPanel';
import {
  getAuditVendors,
  getBonzoForwardRetryIds,
  getBonzoForwardStatus,
  getBonzoHealSweepActivity,
  getBrokerLaunchEmailStatus,
  getFailedBrokerLaunchDispatchIds,
  getLeadAddressBackfillPreview,
  getLeadMappingAudit,
  retryBonzoForwardForLead,
  retryBrokerLaunchDispatch,
  runBonzoHealSweepManual,
  runLeadAddressBackfill,
  type AddressBackfillApplyResult,
  type AddressBackfillSummary,
  type AuditVendorOption,
  type BonzoForwardSampleRow,
  type BonzoForwardStatus,
  type BonzoHealActivity,
  type BonzoHealSweepResult,
  type BrokerLaunchDispatchRow,
  type BrokerLaunchEmailStatus,
  type LeadMappingAuditResult,
} from '@/app/actions/leadHealthActions';
import { FormatDate } from '@/components/ui/FormatDate';

const DEFAULT_VENDOR = 'freerateupdate';
const DAY_OPTIONS = [3, 7, 14, 30] as const;
const LIMIT_OPTIONS = [100, 200, 500, 1000] as const;
const BACKFILL_LIMIT_OPTIONS = [100, 250, 500, 1000, 2000] as const;
const EMAIL_DAY_OPTIONS = [1, 3, 7, 14, 30] as const;

type BulkRetryProgress = {
  total: number;
  completed: number;
  succeeded: number;
  stillFailed: number;
  skipped: number;
  lastError: string | null;
  cancelled: boolean;
  done: boolean;
  startedAt: number;
};

export function LeadHealthPanel() {
  const [vendors, setVendors] = useState<AuditVendorOption[]>([]);
  const [vendorLoading, setVendorLoading] = useState(true);

  // ---- Audit state ----
  const [auditVendor, setAuditVendor] = useState<string>(DEFAULT_VENDOR);
  const [auditDays, setAuditDays] = useState<number>(7);
  const [auditLimit, setAuditLimit] = useState<number>(200);
  const [auditResult, setAuditResult] = useState<LeadMappingAuditResult | null>(
    null
  );
  const [auditError, setAuditError] = useState<string | null>(null);
  const [auditPending, startAudit] = useTransition();

  // ---- Backfill state ----
  const [backfillVendor, setBackfillVendor] = useState<string>(''); // '' = all
  const [backfillLimit, setBackfillLimit] = useState<number>(500);
  const [backfillPreview, setBackfillPreview] =
    useState<AddressBackfillSummary | null>(null);
  const [backfillApply, setBackfillApply] =
    useState<AddressBackfillApplyResult | null>(null);
  const [backfillError, setBackfillError] = useState<string | null>(null);
  const [backfillPending, startBackfill] = useTransition();

  // ---- Broker Launch email status state ----
  const [emailDays, setEmailDays] = useState<number>(7);
  const [emailStatus, setEmailStatus] = useState<BrokerLaunchEmailStatus | null>(
    null
  );
  const [emailLoadedAt, setEmailLoadedAt] = useState<Date | null>(null);
  const [emailError, setEmailError] = useState<string | null>(null);
  const [emailPending, startEmail] = useTransition();
  // Tracks which dispatchId is currently being retried so we can disable
  // just that row's button instead of locking the whole panel.
  const [retryingId, setRetryingId] = useState<string | null>(null);
  const [retryToast, setRetryToast] = useState<{
    ok: boolean;
    message: string;
  } | null>(null);
  // Client-driven bulk retry: we fetch the unresolved FAILED dispatch
  // IDs once (a later SENT row for the same lead clears an old failure),
  // then loop calling retryBrokerLaunchDispatch one row at a time so the
  // user gets per-row feedback and we sidestep Vercel's serverless
  // function timeout (each retry is its own short request).
  const [bulkRetry, setBulkRetry] = useState<BulkRetryProgress | null>(null);
  // Ref so the Cancel button can flip a flag the loop checks between
  // iterations without forcing every retry to be aware of state setters.
  const cancelBulkRef = useRef(false);

  // ---- Bonzo forward status state ----
  const [bonzoDays, setBonzoDays] = useState<number>(7);
  const [bonzoStatus, setBonzoStatus] = useState<BonzoForwardStatus | null>(
    null
  );
  const [bonzoLoadedAt, setBonzoLoadedAt] = useState<Date | null>(null);
  const [bonzoError, setBonzoError] = useState<string | null>(null);
  const [bonzoPending, startBonzo] = useTransition();
  const [bonzoRetryingId, setBonzoRetryingId] = useState<string | null>(null);
  const [bonzoToast, setBonzoToast] = useState<{
    ok: boolean;
    message: string;
  } | null>(null);
  // Same shape as the broker-launch bulk retry — separate state because
  // the two retries can in principle run side-by-side (Bonzo and Graph
  // are independent transports).
  const [bonzoBulk, setBonzoBulk] = useState<BulkRetryProgress | null>(null);
  const cancelBonzoBulkRef = useRef(false);

  // ---- Auto-heal sweep state ----
  // The sweep runs every 5 min via Vercel cron and is also triggerable
  // from this panel. We surface its recent activity (last sweep time,
  // outcome breakdown) so admins can confirm the safety net is working.
  const [healActivity, setHealActivity] = useState<BonzoHealActivity | null>(
    null
  );
  const [lastManualSweep, setLastManualSweep] =
    useState<BonzoHealSweepResult | null>(null);
  const [healPending, startHeal] = useTransition();
  const [healError, setHealError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const list = await getAuditVendors();
        if (cancelled) return;
        setVendors(list);
        // If the default FRU vendor isn't in this org's vendor list, fall
        // back to the first non-system vendor so the page lands in a
        // useful state instead of "Unknown vendor".
        if (!list.some((v) => v.slug === DEFAULT_VENDOR) && list.length > 0) {
          setAuditVendor(list[0].slug);
        }
      } finally {
        if (!cancelled) setVendorLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Auto-load the email + bonzo status once on mount so admins land on
  // the page already seeing whether either is healthy. Subsequent loads
  // are explicit (Refresh button) so we don't hammer the DB on tab focus.
  useEffect(() => {
    void refreshEmailStatus(emailDays);
    void refreshBonzoStatus(bonzoDays);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const refreshEmailStatus = (days: number) => {
    setEmailError(null);
    startEmail(async () => {
      try {
        const status = await getBrokerLaunchEmailStatus({ days });
        setEmailStatus(status);
        setEmailLoadedAt(new Date());
      } catch (err) {
        setEmailError(
          err instanceof Error ? err.message : 'Email status fetch failed.'
        );
      }
    });
  };

  const onRetryDispatch = async (row: BrokerLaunchDispatchRow) => {
    setRetryingId(row.dispatchId);
    setRetryToast(null);
    try {
      const result = await retryBrokerLaunchDispatch(row.dispatchId);
      setRetryToast(result);
      // Refresh in the background so the row's status flips and the
      // counters reflect the retry without the admin manually clicking.
      void refreshEmailStatus(emailDays);
    } catch (err) {
      setRetryToast({
        ok: false,
        message: err instanceof Error ? err.message : 'Retry failed.',
      });
    } finally {
      setRetryingId(null);
    }
  };

  const onBulkRetry = async () => {
    if (!emailStatus || emailStatus.counts.failed === 0) return;
    if (
      !confirm(
        `Retry all ${emailStatus.counts.failed} unresolved failed Broker Launch dispatches in the last ${emailStatus.lookbackDays} days?\n\n` +
          `Each retry creates a fresh dispatch row (originals stay in history). ` +
          `Capped at 500 per click; re-run if there are more.`
      )
    ) {
      return;
    }
    setRetryToast(null);
    cancelBulkRef.current = false;
    setBulkRetry({
      total: emailStatus.counts.failed,
      completed: 0,
      succeeded: 0,
      stillFailed: 0,
      skipped: 0,
      lastError: 'Loading unresolved failed dispatches…',
      cancelled: false,
      done: false,
      startedAt: Date.now(),
    });

    // Phase 1: load the ID list. Cheap query, gives us a known total
    // before we start so the progress bar has a denominator.
    let ids: string[];
    try {
      ids = await getFailedBrokerLaunchDispatchIds({ days: emailDays });
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Could not load failed dispatch IDs.';
      setRetryToast({ ok: false, message });
      setBulkRetry((prev) =>
        prev
          ? {
              ...prev,
              stillFailed: emailStatus.counts.failed,
              lastError: message,
              done: true,
            }
          : prev
      );
      return;
    }
    if (ids.length === 0) {
      setRetryToast({ ok: true, message: 'No failed dispatches to retry.' });
      setBulkRetry((prev) =>
        prev
          ? {
              ...prev,
              total: 0,
              lastError: null,
              done: true,
            }
          : prev
      );
      void refreshEmailStatus(emailDays);
      return;
    }

    setBulkRetry({
      total: ids.length,
      completed: 0,
      succeeded: 0,
      stillFailed: 0,
      skipped: 0,
      lastError: null,
      cancelled: false,
      done: false,
      startedAt: Date.now(),
    });

    // Phase 2: serial loop. Sequential (not Promise.all) for two
    // reasons: (1) Microsoft Graph rate-limits sendMail at 30/sec per
    // mailbox, and (2) progress feedback only makes sense if rows
    // finish one at a time. Each call is its own server-action HTTP
    // round-trip, so any single timeout/blip only kills that row.
    let succeeded = 0;
    let stillFailed = 0;
    let skipped = 0;
    let lastError: string | null = null;
    let cancelled = false;

    for (let i = 0; i < ids.length; i += 1) {
      if (cancelBulkRef.current) {
        cancelled = true;
        break;
      }
      const id = ids[i];
      try {
        const result = await retryBrokerLaunchDispatch(id);
        if (result.ok) {
          succeeded += 1;
        } else if (result.message.startsWith('Skipped:')) {
          skipped += 1;
          lastError = result.message;
        } else {
          stillFailed += 1;
          lastError = result.message;
        }
      } catch (err) {
        stillFailed += 1;
        lastError = err instanceof Error ? err.message : String(err);
      }

      setBulkRetry({
        total: ids.length,
        completed: i + 1,
        succeeded,
        stillFailed,
        skipped,
        lastError,
        cancelled: false,
        done: false,
        startedAt: 0, // unused once running, kept for type stability
      });
    }

    setBulkRetry((prev) =>
      prev
        ? {
            ...prev,
            cancelled,
            done: true,
          }
        : prev
    );
    // Refresh in the background so SENT/unresolved-FAILED counters and the
    // recent-failures table reflect the post-retry state.
    void refreshEmailStatus(emailDays);
  };

  const onCancelBulkRetry = () => {
    cancelBulkRef.current = true;
  };

  const onDismissBulkRetry = () => {
    setBulkRetry(null);
  };

  // ---- Bonzo handlers ----

  const refreshBonzoStatus = (days: number) => {
    setBonzoError(null);
    startBonzo(async () => {
      try {
        // Fan out the two reads in parallel — they hit independent
        // queries and the panel renders both in the same band, so a
        // serial fetch would just add latency without simplifying
        // anything.
        const [status, activity] = await Promise.all([
          getBonzoForwardStatus({ days }),
          getBonzoHealSweepActivity().catch(() => null),
        ]);
        setBonzoStatus(status);
        setBonzoLoadedAt(new Date());
        if (activity) setHealActivity(activity);
      } catch (err) {
        setBonzoError(
          err instanceof Error ? err.message : 'Bonzo status fetch failed.'
        );
      }
    });
  };

  const onRunHealSweep = () => {
    setHealError(null);
    startHeal(async () => {
      try {
        const result = await runBonzoHealSweepManual({});
        setLastManualSweep(result);
        // Refresh the status counters and sweep activity so the panel
        // immediately reflects whatever the sweep just healed (or
        // didn't). The sweep already wrote audit rows, so the next
        // status read will show them in the appropriate buckets.
        void refreshBonzoStatus(bonzoDays);
      } catch (err) {
        setHealError(
          err instanceof Error ? err.message : 'Heal sweep failed.'
        );
      }
    });
  };

  const onRetryBonzo = async (row: BonzoForwardSampleRow) => {
    setBonzoRetryingId(row.leadId);
    setBonzoToast(null);
    try {
      const result = await retryBonzoForwardForLead(row.leadId);
      setBonzoToast(result);
      void refreshBonzoStatus(bonzoDays);
    } catch (err) {
      setBonzoToast({
        ok: false,
        message: err instanceof Error ? err.message : 'Bonzo retry failed.',
      });
    } finally {
      setBonzoRetryingId(null);
    }
  };

  const onBonzoBulkRetry = async (
    bucket: 'failed' | 'never' | 'no-webhook'
  ) => {
    if (!bonzoStatus) return;
    const total =
      bucket === 'failed'
        ? bonzoStatus.totals.httpError + bonzoStatus.totals.exception
        : bucket === 'never'
          ? bonzoStatus.totals.neverAttempted
          : bonzoStatus.totals.noWebhookUrl;
    if (total === 0) return;

    const label =
      bucket === 'failed'
        ? `${total} failed Bonzo forward${total === 1 ? '' : 's'}`
        : bucket === 'never'
          ? `${total} lead${total === 1 ? '' : 's'} that never had Bonzo attempted`
          : `${total} lead${total === 1 ? '' : 's'} whose assigned LO has no Bonzo webhook URL`;
    if (
      !confirm(
        `Retry ${label} from the last ${bonzoStatus.lookbackDays} days?\n\n` +
          `Each lead's audit row gets a fresh outcome. Capped at 500 per click; re-run if there are more.`
      )
    ) {
      return;
    }
    setBonzoToast(null);
    cancelBonzoBulkRef.current = false;

    let ids: string[];
    try {
      ids = await getBonzoForwardRetryIds({ days: bonzoDays, bucket });
    } catch (err) {
      setBonzoToast({
        ok: false,
        message: err instanceof Error ? err.message : 'Could not load lead IDs.',
      });
      return;
    }
    if (ids.length === 0) {
      setBonzoToast({ ok: true, message: 'No leads to retry.' });
      return;
    }

    setBonzoBulk({
      total: ids.length,
      completed: 0,
      succeeded: 0,
      stillFailed: 0,
      skipped: 0,
      lastError: null,
      cancelled: false,
      done: false,
      startedAt: Date.now(),
    });

    let succeeded = 0;
    let stillFailed = 0;
    let skipped = 0;
    let lastError: string | null = null;
    let cancelled = false;

    for (let i = 0; i < ids.length; i += 1) {
      if (cancelBonzoBulkRef.current) {
        cancelled = true;
        break;
      }
      try {
        const result = await retryBonzoForwardForLead(ids[i]);
        if (result.ok) {
          succeeded += 1;
        } else {
          stillFailed += 1;
          lastError = result.message;
        }
      } catch (err) {
        stillFailed += 1;
        lastError = err instanceof Error ? err.message : String(err);
      }
      setBonzoBulk({
        total: ids.length,
        completed: i + 1,
        succeeded,
        stillFailed,
        skipped,
        lastError,
        cancelled: false,
        done: false,
        startedAt: 0,
      });
    }

    setBonzoBulk((prev) =>
      prev ? { ...prev, cancelled, done: true } : prev
    );
    void refreshBonzoStatus(bonzoDays);
  };

  const onCancelBonzoBulk = () => {
    cancelBonzoBulkRef.current = true;
  };

  const onDismissBonzoBulk = () => {
    setBonzoBulk(null);
  };

  const runAudit = () => {
    setAuditError(null);
    startAudit(async () => {
      try {
        const result = await getLeadMappingAudit({
          vendorSlug: auditVendor,
          days: auditDays,
          limit: auditLimit,
        });
        setAuditResult(result);
      } catch (err) {
        setAuditError(err instanceof Error ? err.message : 'Audit failed.');
      }
    });
  };

  const runBackfillPreview = () => {
    setBackfillError(null);
    setBackfillApply(null);
    startBackfill(async () => {
      try {
        const result = await getLeadAddressBackfillPreview({
          vendorSlug: backfillVendor || null,
          limit: backfillLimit,
        });
        setBackfillPreview(result);
      } catch (err) {
        setBackfillError(
          err instanceof Error ? err.message : 'Backfill preview failed.'
        );
      }
    });
  };

  const runBackfillApply = () => {
    if (!backfillPreview || backfillPreview.recoverable === 0) return;
    if (
      !confirm(
        `Apply backfill to ${backfillPreview.recoverable} recoverable lead(s)? ` +
          `This writes propertyAddress / city / state / zip / county where they are currently null.`
      )
    ) {
      return;
    }
    setBackfillError(null);
    startBackfill(async () => {
      try {
        const result = await runLeadAddressBackfill({
          vendorSlug: backfillVendor || null,
          limit: backfillLimit,
        });
        setBackfillApply(result);
        setBackfillPreview(result);
      } catch (err) {
        setBackfillError(
          err instanceof Error ? err.message : 'Backfill apply failed.'
        );
      }
    });
  };

  return (
    <div className="space-y-8">
      {/* 1. Webhook Inbox health */}
      <Section
        title="Webhook Inbox"
        description="Every inbound vendor webhook lands here first. Replay FAILED events after fixing the underlying issue (e.g. routing tag, signature, or payload shape). Healthy when nothing is in the Failed or Pending buckets."
      >
        <WebhookInboxPanel />
      </Section>

      {/* 2. Bonzo Forward status */}
      <Section
        title="Bonzo Forwarding"
        description="Auto-pushes every newly-assigned lead to the assigned LO's Bonzo webhook URL. Each forward writes an audit row to the Lead — sent / http_error / no_webhook_url / exception — so you can see in real time whether Bonzo accepted the payload, rejected it, or never got it."
      >
        <BonzoForwardSection
          status={bonzoStatus}
          loadedAt={bonzoLoadedAt}
          days={bonzoDays}
          onDaysChange={(d) => {
            setBonzoDays(d);
            refreshBonzoStatus(d);
          }}
          onRefresh={() => refreshBonzoStatus(bonzoDays)}
          pending={bonzoPending}
          error={bonzoError}
          retryingId={bonzoRetryingId}
          onRetry={onRetryBonzo}
          toast={bonzoToast}
          onClearToast={() => setBonzoToast(null)}
          onBulkRetry={onBonzoBulkRetry}
          bulk={bonzoBulk}
          onCancelBulk={onCancelBonzoBulk}
          onDismissBulk={onDismissBonzoBulk}
          healActivity={healActivity}
          lastManualSweep={lastManualSweep}
          healPending={healPending}
          healError={healError}
          onRunHealSweep={onRunHealSweep}
          onDismissLastSweep={() => setLastManualSweep(null)}
        />
      </Section>

      {/* 3. Broker Launch email status */}
      <Section
        title="Broker Launch Email"
        description="Automated email sent to the assigned LO every time a lead is assigned (manual, round-robin, default-user fallback, or CSV import). Use this to confirm emails are actually leaving the portal — Bonzo and email run on independent paths so a successful Bonzo push does not prove the email went out."
      >
        <BrokerLaunchEmailSection
          status={emailStatus}
          loadedAt={emailLoadedAt}
          days={emailDays}
          onDaysChange={(d) => {
            setEmailDays(d);
            refreshEmailStatus(d);
          }}
          onRefresh={() => refreshEmailStatus(emailDays)}
          pending={emailPending}
          error={emailError}
          retryingId={retryingId}
          onRetry={onRetryDispatch}
          toast={retryToast}
          onClearToast={() => setRetryToast(null)}
          onBulkRetry={onBulkRetry}
          bulkRetry={bulkRetry}
          onCancelBulkRetry={onCancelBulkRetry}
          onDismissBulkRetry={onDismissBulkRetry}
        />
      </Section>

      {/* 4. Lead mapping audit */}
      <Section
        title="Lead Mapping Audit"
        description="Quantifies how many recent leads from a vendor would benefit from the phone fallback / mailing-mirror fixes. Run this after re-pasting LMB service templates or whenever LOs report fields landing wrong in Bonzo."
      >
        <div className="rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="flex flex-wrap items-end gap-3 px-6 py-4 border-b border-slate-100">
            <Field label="Vendor">
              <select
                className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 min-w-[220px]"
                value={auditVendor}
                onChange={(e) => setAuditVendor(e.target.value)}
                disabled={vendorLoading}
              >
                {vendors.map((v) => (
                  <option key={v.slug} value={v.slug}>
                    {v.name} ({v.leadCount.toLocaleString()})
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Lookback">
              <select
                className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                value={auditDays}
                onChange={(e) => setAuditDays(Number(e.target.value))}
              >
                {DAY_OPTIONS.map((d) => (
                  <option key={d} value={d}>
                    {d} days
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Sample size">
              <select
                className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                value={auditLimit}
                onChange={(e) => setAuditLimit(Number(e.target.value))}
              >
                {LIMIT_OPTIONS.map((d) => (
                  <option key={d} value={d}>
                    {d.toLocaleString()} leads
                  </option>
                ))}
              </select>
            </Field>
            <button
              type="button"
              onClick={runAudit}
              disabled={auditPending || vendorLoading}
              className="ml-auto inline-flex items-center gap-2 rounded-xl bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-blue-700 disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {auditPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Play className="h-4 w-4" />
              )}
              Run audit
            </button>
          </div>

          {auditError && (
            <div className="px-6 py-3 text-xs text-rose-700 bg-rose-50 border-b border-rose-100">
              {auditError}
            </div>
          )}

          {auditResult ? (
            <AuditResults result={auditResult} />
          ) : (
            <div className="px-6 py-10 text-center text-sm text-slate-500">
              Choose a vendor and click <strong>Run audit</strong> to see the
              breakdown.
            </div>
          )}
        </div>
      </Section>

      {/* 5. Address backfill */}
      <Section
        title="Address Backfill"
        description="Recovers address fields on historical leads that came in before the field-map updates. Scans every lead with a null propertyAddress, tries every payload alias the bridge accepts, and lets you apply only the rows that have a recoverable address. Safe to re-run; rows that still have null addresses just stay queued for the next pass."
      >
        <div className="rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="flex flex-wrap items-end gap-3 px-6 py-4 border-b border-slate-100">
            <Field label="Vendor">
              <select
                className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 min-w-[220px]"
                value={backfillVendor}
                onChange={(e) => setBackfillVendor(e.target.value)}
                disabled={vendorLoading}
              >
                <option value="">All vendors</option>
                {vendors.map((v) => (
                  <option key={v.slug} value={v.slug}>
                    {v.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Batch size">
              <select
                className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                value={backfillLimit}
                onChange={(e) => setBackfillLimit(Number(e.target.value))}
              >
                {BACKFILL_LIMIT_OPTIONS.map((d) => (
                  <option key={d} value={d}>
                    Up to {d.toLocaleString()} leads
                  </option>
                ))}
              </select>
            </Field>
            <button
              type="button"
              onClick={runBackfillPreview}
              disabled={backfillPending || vendorLoading}
              className="ml-auto inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {backfillPending && !backfillApply ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <RefreshCcw className="h-4 w-4" />
              )}
              Dry run
            </button>
            <button
              type="button"
              onClick={runBackfillApply}
              disabled={
                backfillPending ||
                !backfillPreview ||
                backfillPreview.recoverable === 0
              }
              className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-emerald-700 disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {backfillPending && backfillApply ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Save className="h-4 w-4" />
              )}
              Apply
              {backfillPreview && backfillPreview.recoverable > 0
                ? ` (${backfillPreview.recoverable})`
                : ''}
            </button>
          </div>

          {backfillError && (
            <div className="px-6 py-3 text-xs text-rose-700 bg-rose-50 border-b border-rose-100">
              {backfillError}
            </div>
          )}

          {backfillPreview ? (
            <BackfillResults
              preview={backfillPreview}
              applied={backfillApply}
            />
          ) : (
            <div className="px-6 py-10 text-center text-sm text-slate-500">
              Click <strong>Dry run</strong> to scan for recoverable addresses.
              Nothing is written until you click <strong>Apply</strong>.
            </div>
          )}
        </div>
      </Section>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Audit subcomponents
// ---------------------------------------------------------------------------

function AuditResults({ result }: { result: LeadMappingAuditResult }) {
  const phonePct = pct(
    result.phoneNullButRecoverable,
    Math.max(1, result.phoneNull)
  );
  const allClear =
    result.phoneNullButRecoverable === 0 &&
    result.coPhoneNullButRecoverable === 0 &&
    result.propertyAddressBlankWithMailingColumn === 0 &&
    result.propertyAddressBlankWithMailingPayload === 0 &&
    result.propertyAddressBlankUnrecoverable === 0;

  return (
    <div className="px-6 py-5 space-y-5">
      <div className="flex flex-wrap items-center gap-2 text-sm text-slate-600">
        <span className="text-slate-400">Audited</span>
        <strong className="text-slate-900">{result.scanned.toLocaleString()}</strong>
        <span className="text-slate-400">{result.vendorName} leads from the last</span>
        <strong className="text-slate-900">{result.windowDays} days</strong>
      </div>

      {allClear ? (
        <div className="flex items-start gap-3 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3">
          <CheckCircle2 className="h-5 w-5 text-emerald-600 mt-0.5" />
          <div className="text-sm text-emerald-900">
            No recoverable issues in the sampled window. Either the recent
            ingest is clean, or the fixes have already taken effect for these
            leads. Bump the window or sample size if you want to scan further
            back.
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <StatCard
            label="Phone fixable"
            count={result.phoneNullButRecoverable}
            denominator={result.scanned}
            tone={result.phoneNullButRecoverable > 0 ? 'amber' : 'slate'}
            help={`Leads where Lead.phone is null but homePhone or workPhone is populated. New Bonzo payload now falls back phone -> homePhone -> workPhone, so re-pushing these leads (or any new lead from this vendor) will reach Bonzo with a real number. ${phonePct} of the phone-null bucket is recoverable.`}
          />
          <StatCard
            label="Co-borrower phone fixable"
            count={result.coPhoneNullButRecoverable}
            denominator={Math.max(1, result.coPhoneNullWithCoBorrower)}
            tone={result.coPhoneNullButRecoverable > 0 ? 'amber' : 'slate'}
            help="Leads with a co-borrower (coHomePhone or coWorkPhone present) but coPhone null. Same fallback now applies to co_phone in the Bonzo payload."
          />
          <StatCard
            label="Address recoverable from mailing column"
            count={result.propertyAddressBlankWithMailingColumn}
            denominator={result.scanned}
            tone={
              result.propertyAddressBlankWithMailingColumn > 0
                ? 'rose'
                : 'slate'
            }
            help="propertyAddress is null but mailingAddress is populated. The new ingest mirror fills propertyAddress on next ingest; for old leads, run the Address Backfill below."
          />
          <StatCard
            label="Address recoverable from rawPayload"
            count={result.propertyAddressBlankWithMailingPayload}
            denominator={result.scanned}
            tone={
              result.propertyAddressBlankWithMailingPayload > 0
                ? 'rose'
                : 'slate'
            }
            help="propertyAddress is null but the original webhook payload contains a mailing_* / Mail_* / phys_* / etc. value. Address Backfill below will recover these."
          />
          <StatCard
            label="Address truly unrecoverable"
            count={result.propertyAddressBlankUnrecoverable}
            denominator={result.scanned}
            tone="slate"
            help="propertyAddress is null and rawPayload had no usable address alias either. The vendor never sent us a usable address for these leads — backfill cannot help."
          />
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <DistributionTable
          title="Top loan types (Bonzo loan_type)"
          rows={result.topLoanType}
        />
        <DistributionTable
          title="Top loan terms (Bonzo loan_program + loan_term)"
          rows={result.topLoanTerm}
        />
      </div>

      <details className="rounded-xl border border-slate-200 bg-slate-50">
        <summary className="cursor-pointer px-4 py-2.5 text-xs font-semibold text-slate-700">
          Sample leads (first {result.sample.length})
        </summary>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-slate-100 text-[10px] uppercase tracking-wider text-slate-500">
              <tr>
                <th className="px-3 py-2 text-left">Received</th>
                <th className="px-3 py-2 text-left">Name</th>
                <th className="px-3 py-2 text-left">phone / home / work</th>
                <th className="px-3 py-2 text-left">propertyAddress</th>
                <th className="px-3 py-2 text-left">mailingAddress</th>
                <th className="px-3 py-2 text-left">loan</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 bg-white">
              {result.sample.map((row) => (
                <tr key={row.id}>
                  <td className="px-3 py-2 text-slate-500 whitespace-nowrap">
                    <FormatDate date={row.receivedAt} mode="datetime" />
                  </td>
                  <td className="px-3 py-2 font-semibold text-slate-800 whitespace-nowrap">
                    {row.name}
                  </td>
                  <td className="px-3 py-2 text-slate-700">
                    <span className={row.phoneFixable ? 'text-amber-700' : ''}>
                      {row.phone || '∅'}
                    </span>
                    <span className="text-slate-400"> / </span>
                    {row.homePhone || '∅'}
                    <span className="text-slate-400"> / </span>
                    {row.workPhone || '∅'}
                  </td>
                  <td className="px-3 py-2 text-slate-700">
                    {row.propertyAddress ? (
                      <span>
                        {row.propertyAddress}
                        {row.propertyCity ? `, ${row.propertyCity}` : ''}{' '}
                        {row.propertyState || ''} {row.propertyZip || ''}
                      </span>
                    ) : (
                      <span
                        className={
                          row.addressFixableViaMailing
                            ? 'text-rose-700 font-semibold'
                            : 'text-slate-400'
                        }
                      >
                        ∅{row.addressFixableViaMailing ? ' (fixable)' : ''}
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-slate-600">
                    {row.mailingAddress || '∅'}
                  </td>
                  <td className="px-3 py-2 text-slate-600 whitespace-nowrap">
                    {row.loanType || '∅'} / {row.loanTerm || '∅'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}

function BackfillResults({
  preview,
  applied,
}: {
  preview: AddressBackfillSummary;
  applied: AddressBackfillApplyResult | null;
}) {
  const remaining = preview.totalCandidates - preview.scanned;
  return (
    <div className="px-6 py-5 space-y-5">
      <div className="flex flex-wrap items-center gap-2 text-sm text-slate-600">
        <span className="text-slate-400">Found</span>
        <strong className="text-slate-900">
          {preview.totalCandidates.toLocaleString()}
        </strong>
        <span className="text-slate-400">leads with a null propertyAddress</span>
        {remaining > 0 && (
          <span className="text-slate-400">
            (showing first {preview.scanned.toLocaleString()}; raise the batch
            size or re-run after Apply to catch the remaining {remaining.toLocaleString()})
          </span>
        )}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <StatCard
          label="Recoverable"
          count={preview.recoverable}
          denominator={preview.scanned}
          tone={preview.recoverable > 0 ? 'emerald' : 'slate'}
          help="rawPayload contained a usable address alias (mailing_*, Mail_*, phys_*, subject_property_*, address, etc.). Apply will write propertyAddress on these rows."
        />
        <StatCard
          label="Unrecoverable"
          count={preview.unrecoverable}
          denominator={preview.scanned}
          tone="slate"
          help="No usable address found in rawPayload. The vendor never sent us an address for these leads — backfill cannot help."
        />
        {applied ? (
          <StatCard
            label="Applied"
            count={applied.applied}
            denominator={preview.recoverable}
            tone={applied.failed > 0 ? 'amber' : 'emerald'}
            help={
              applied.failed > 0
                ? `${applied.failed} update(s) failed — see the server logs for details. The remaining rows still have null addresses; re-run to retry.`
                : 'All recoverable rows were updated successfully.'
            }
          />
        ) : (
          <StatCard
            label="Applied"
            count={0}
            denominator={preview.recoverable}
            tone="slate"
            help="Click Apply to write the recoverable rows."
          />
        )}
      </div>

      {preview.byVendor.length > 1 && (
        <div className="rounded-xl border border-slate-200 bg-slate-50">
          <div className="px-4 py-2 text-[11px] font-bold uppercase tracking-wider text-slate-500 border-b border-slate-200">
            Per-vendor breakdown
          </div>
          <table className="w-full text-xs">
            <thead className="bg-slate-100 text-[10px] uppercase tracking-wider text-slate-500">
              <tr>
                <th className="px-3 py-1.5 text-left">Vendor</th>
                <th className="px-3 py-1.5 text-right">Scanned</th>
                <th className="px-3 py-1.5 text-right">Recoverable</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 bg-white">
              {preview.byVendor.map((b) => (
                <tr key={b.vendorSlug}>
                  <td className="px-3 py-1.5 font-mono text-[11px] text-slate-700">
                    {b.vendorSlug}
                  </td>
                  <td className="px-3 py-1.5 text-right text-slate-600 tabular-nums">
                    {b.total}
                  </td>
                  <td className="px-3 py-1.5 text-right text-slate-900 font-semibold tabular-nums">
                    {b.recoverable}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {preview.sampleRecoverable.length > 0 && (
        <details className="rounded-xl border border-slate-200 bg-slate-50" open>
          <summary className="cursor-pointer px-4 py-2.5 text-xs font-semibold text-slate-700">
            Sample of recoverable leads ({preview.sampleRecoverable.length} of {preview.recoverable})
          </summary>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-slate-100 text-[10px] uppercase tracking-wider text-slate-500">
                <tr>
                  <th className="px-3 py-2 text-left">Vendor</th>
                  <th className="px-3 py-2 text-left">Name</th>
                  <th className="px-3 py-2 text-left">Will set propertyAddress to</th>
                  <th className="px-3 py-2 text-left">City / State / Zip</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 bg-white">
                {preview.sampleRecoverable.map((r) => (
                  <tr key={r.leadId}>
                    <td className="px-3 py-2 font-mono text-[11px] text-slate-600">
                      {r.vendorSlug}
                    </td>
                    <td className="px-3 py-2 font-semibold text-slate-800">
                      {r.name}
                    </td>
                    <td className="px-3 py-2 text-emerald-700">
                      {r.newAddress}
                    </td>
                    <td className="px-3 py-2 text-slate-600">
                      {[r.newCity, r.newState, r.newZip]
                        .filter(Boolean)
                        .join(', ') || '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      )}

      {preview.sampleUnrecoverable.length > 0 && (
        <details className="rounded-xl border border-slate-200 bg-slate-50">
          <summary className="cursor-pointer px-4 py-2.5 text-xs font-semibold text-slate-700">
            Sample of unrecoverable leads ({preview.sampleUnrecoverable.length} of {preview.unrecoverable})
          </summary>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-slate-100 text-[10px] uppercase tracking-wider text-slate-500">
                <tr>
                  <th className="px-3 py-2 text-left">Vendor</th>
                  <th className="px-3 py-2 text-left">Name</th>
                  <th className="px-3 py-2 text-left">Existing locale</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 bg-white">
                {preview.sampleUnrecoverable.map((r) => (
                  <tr key={r.leadId}>
                    <td className="px-3 py-2 font-mono text-[11px] text-slate-600">
                      {r.vendorSlug}
                    </td>
                    <td className="px-3 py-2 font-semibold text-slate-800">
                      {r.name}
                    </td>
                    <td className="px-3 py-2 text-slate-500">
                      {[r.city, r.state, r.zip].filter(Boolean).join(', ') ||
                        '(no locale)'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Broker Launch email subcomponents
// ---------------------------------------------------------------------------

function BrokerLaunchEmailSection({
  status,
  loadedAt,
  days,
  onDaysChange,
  onRefresh,
  pending,
  error,
  retryingId,
  onRetry,
  toast,
  onClearToast,
  onBulkRetry,
  bulkRetry,
  onCancelBulkRetry,
  onDismissBulkRetry,
}: {
  status: BrokerLaunchEmailStatus | null;
  loadedAt: Date | null;
  days: number;
  onDaysChange: (d: number) => void;
  onRefresh: () => void;
  pending: boolean;
  error: string | null;
  retryingId: string | null;
  onRetry: (row: BrokerLaunchDispatchRow) => void;
  toast: { ok: boolean; message: string } | null;
  onClearToast: () => void;
  onBulkRetry: () => void;
  bulkRetry: BulkRetryProgress | null;
  onCancelBulkRetry: () => void;
  onDismissBulkRetry: () => void;
}) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="flex flex-wrap items-end gap-3 px-6 py-4 border-b border-slate-100">
        <Field label="Lookback">
          <select
            className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
            value={days}
            onChange={(e) => onDaysChange(Number(e.target.value))}
            disabled={pending}
          >
            {EMAIL_DAY_OPTIONS.map((d) => (
              <option key={d} value={d}>
                {d === 1 ? 'Last 24 hours' : `Last ${d} days`}
              </option>
            ))}
          </select>
        </Field>
        <div className="ml-auto flex items-center gap-3">
          {loadedAt && (
            <span className="text-[11px] text-slate-500">
              Loaded {loadedAt.toLocaleTimeString()}
            </span>
          )}
          <button
            type="button"
            onClick={onRefresh}
            disabled={pending}
            className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {pending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <RefreshCcw className="h-4 w-4" />
            )}
            Refresh
          </button>
        </div>
      </div>

      {error && (
        <div className="px-6 py-3 text-xs text-rose-700 bg-rose-50 border-b border-rose-100">
          {error}
        </div>
      )}

      {toast && (
        <div
          className={`px-6 py-3 text-xs flex items-center justify-between border-b ${
            toast.ok
              ? 'text-emerald-800 bg-emerald-50 border-emerald-100'
              : 'text-rose-700 bg-rose-50 border-rose-100'
          }`}
        >
          <span>{toast.message}</span>
          <button
            type="button"
            onClick={onClearToast}
            className="text-[10px] uppercase tracking-wider opacity-70 hover:opacity-100"
          >
            Dismiss
          </button>
        </div>
      )}

      {bulkRetry && (
        <BulkRetryProgressBar
          progress={bulkRetry}
          onCancel={onCancelBulkRetry}
          onDismiss={onDismissBulkRetry}
        />
      )}

      {!status ? (
        <div className="px-6 py-10 text-center text-sm text-slate-500">
          Loading email status…
        </div>
      ) : (
        <BrokerLaunchEmailBody
          status={status}
          retryingId={retryingId}
          onRetry={onRetry}
          onBulkRetry={onBulkRetry}
          bulkRetryActive={Boolean(bulkRetry && !bulkRetry.done)}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Bonzo forward section
// ---------------------------------------------------------------------------

function BonzoForwardSection({
  status,
  loadedAt,
  days,
  onDaysChange,
  onRefresh,
  pending,
  error,
  retryingId,
  onRetry,
  toast,
  onClearToast,
  onBulkRetry,
  bulk,
  onCancelBulk,
  onDismissBulk,
  healActivity,
  lastManualSweep,
  healPending,
  healError,
  onRunHealSweep,
  onDismissLastSweep,
}: {
  status: BonzoForwardStatus | null;
  loadedAt: Date | null;
  days: number;
  onDaysChange: (d: number) => void;
  onRefresh: () => void;
  pending: boolean;
  error: string | null;
  retryingId: string | null;
  onRetry: (row: BonzoForwardSampleRow) => void;
  toast: { ok: boolean; message: string } | null;
  onClearToast: () => void;
  onBulkRetry: (bucket: 'failed' | 'never' | 'no-webhook') => void;
  bulk: BulkRetryProgress | null;
  onCancelBulk: () => void;
  onDismissBulk: () => void;
  healActivity: BonzoHealActivity | null;
  lastManualSweep: BonzoHealSweepResult | null;
  healPending: boolean;
  healError: string | null;
  onRunHealSweep: () => void;
  onDismissLastSweep: () => void;
}) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="flex flex-wrap items-end gap-3 px-6 py-4 border-b border-slate-100">
        <Field label="Lookback">
          <select
            className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
            value={days}
            onChange={(e) => onDaysChange(Number(e.target.value))}
            disabled={pending}
          >
            {EMAIL_DAY_OPTIONS.map((d) => (
              <option key={d} value={d}>
                {d === 1 ? 'Last 24 hours' : `Last ${d} days`}
              </option>
            ))}
          </select>
        </Field>
        <div className="ml-auto flex items-center gap-3">
          {loadedAt && (
            <span className="text-[11px] text-slate-500">
              Loaded {loadedAt.toLocaleTimeString()}
            </span>
          )}
          <button
            type="button"
            onClick={onRefresh}
            disabled={pending}
            className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {pending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <RefreshCcw className="h-4 w-4" />
            )}
            Refresh
          </button>
        </div>
      </div>

      <BonzoHealStrip
        activity={healActivity}
        lastManualSweep={lastManualSweep}
        pending={healPending}
        error={healError}
        onRun={onRunHealSweep}
        onDismissLastSweep={onDismissLastSweep}
      />

      {error && (
        <div className="px-6 py-3 text-xs text-rose-700 bg-rose-50 border-b border-rose-100">
          {error}
        </div>
      )}

      {toast && (
        <div
          className={`px-6 py-3 text-xs flex items-center justify-between border-b ${
            toast.ok
              ? 'text-emerald-800 bg-emerald-50 border-emerald-100'
              : 'text-rose-700 bg-rose-50 border-rose-100'
          }`}
        >
          <span>{toast.message}</span>
          <button
            type="button"
            onClick={onClearToast}
            className="text-[10px] uppercase tracking-wider opacity-70 hover:opacity-100"
          >
            Dismiss
          </button>
        </div>
      )}

      {bulk && (
        <BulkRetryProgressBar
          progress={bulk}
          onCancel={onCancelBulk}
          onDismiss={onDismissBulk}
        />
      )}

      {!status ? (
        <div className="px-6 py-10 text-center text-sm text-slate-500">
          Loading Bonzo status…
        </div>
      ) : (
        <BonzoForwardBody
          status={status}
          retryingId={retryingId}
          onRetry={onRetry}
          onBulkRetry={onBulkRetry}
          bulkActive={Boolean(bulk && !bulk.done)}
        />
      )}
    </div>
  );
}

/**
 * Auto-heal sweep status band. Surfaces three things:
 *   1. When the last sweep activity happened (most recent
 *      `trigger='sweep'` audit). Lets admins confirm the cron is alive.
 *   2. Last 24h sweep outcome breakdown — if "sent" dominates, the
 *      safety net is doing its job. If "exception" / "http_error"
 *      dominate, there's a structural issue (bad webhook URL, Bonzo
 *      outage) the auto-loop alone can't fix.
 *   3. A manual "Run sweep now" button that bypasses the 5-min cron
 *      cadence — useful right after a deploy or to confirm a fix.
 */
function BonzoHealStrip({
  activity,
  lastManualSweep,
  pending,
  error,
  onRun,
  onDismissLastSweep,
}: {
  activity: BonzoHealActivity | null;
  lastManualSweep: BonzoHealSweepResult | null;
  pending: boolean;
  error: string | null;
  onRun: () => void;
  onDismissLastSweep: () => void;
}) {
  const lastAt = activity?.lastSweepActivityAt
    ? new Date(activity.lastSweepActivityAt)
    : null;
  const last24 = activity?.last24h ?? {
    sent: 0,
    httpError: 0,
    noWebhookUrl: 0,
    exception: 0,
    total: 0,
  };

  return (
    <div className="border-b border-slate-100 bg-slate-50/60">
      <div className="px-6 py-3 flex flex-wrap items-center gap-x-6 gap-y-2 text-xs">
        <div className="flex items-center gap-2">
          <span className="inline-flex h-1.5 w-1.5 rounded-full bg-emerald-500" />
          <span className="font-semibold text-slate-700">Auto-heal sweep</span>
          <span className="text-slate-500">runs every 5 min</span>
        </div>
        <div className="text-slate-600">
          Last activity:{' '}
          {lastAt ? (
            <span className="font-medium text-slate-800">
              {lastAt.toLocaleString()}
            </span>
          ) : (
            <span className="italic text-slate-500">no recoveries yet</span>
          )}
        </div>
        {last24.total > 0 && (
          <div className="text-slate-600">
            Last 24h:{' '}
            <span className="font-medium text-emerald-700">
              {last24.sent} healed
            </span>
            {(last24.httpError > 0 ||
              last24.exception > 0 ||
              last24.noWebhookUrl > 0) && (
              <>
                {', '}
                {last24.httpError > 0 && (
                  <span className="text-rose-700">
                    {last24.httpError} http_error
                  </span>
                )}
                {last24.exception > 0 && (
                  <>
                    {last24.httpError > 0 ? ', ' : ''}
                    <span className="text-rose-700">
                      {last24.exception} exception
                    </span>
                  </>
                )}
                {last24.noWebhookUrl > 0 && (
                  <>
                    {last24.httpError > 0 || last24.exception > 0 ? ', ' : ''}
                    <span className="text-amber-700">
                      {last24.noWebhookUrl} no_webhook
                    </span>
                  </>
                )}
              </>
            )}
          </div>
        )}
        <div className="ml-auto">
          <button
            type="button"
            onClick={onRun}
            disabled={pending}
            className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {pending ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Play className="h-3.5 w-3.5" />
            )}
            Run sweep now
          </button>
        </div>
      </div>

      {error && (
        <div className="px-6 py-2 text-[11px] text-rose-700 bg-rose-50 border-t border-rose-100">
          Heal sweep failed: {error}
        </div>
      )}

      {lastManualSweep && (
        <div className="px-6 py-2 text-[11px] text-slate-700 bg-emerald-50/60 border-t border-emerald-100 flex items-center justify-between gap-3">
          <span>
            Manual sweep finished in {lastManualSweep.durationMs}ms — found{' '}
            <strong>{lastManualSweep.found}</strong> stale
            {lastManualSweep.found === 1 ? ' lead' : ' leads'}
            {lastManualSweep.found > 0 && (
              <>
                : {lastManualSweep.sent} sent
                {lastManualSweep.httpError > 0 &&
                  `, ${lastManualSweep.httpError} http_error`}
                {lastManualSweep.exception > 0 &&
                  `, ${lastManualSweep.exception} exception`}
                {lastManualSweep.noWebhookUrl > 0 &&
                  `, ${lastManualSweep.noWebhookUrl} no_webhook_url`}
              </>
            )}
            .
            {lastManualSweep.firstError && (
              <>
                {' '}
                First error:{' '}
                <code className="font-mono text-[10px]">
                  {lastManualSweep.firstError}
                </code>
              </>
            )}
          </span>
          <button
            type="button"
            onClick={onDismissLastSweep}
            className="text-[10px] uppercase tracking-wider opacity-70 hover:opacity-100"
          >
            Dismiss
          </button>
        </div>
      )}
    </div>
  );
}

function BonzoForwardBody({
  status,
  retryingId,
  onRetry,
  onBulkRetry,
  bulkActive,
}: {
  status: BonzoForwardStatus;
  retryingId: string | null;
  onRetry: (row: BonzoForwardSampleRow) => void;
  onBulkRetry: (bucket: 'failed' | 'never' | 'no-webhook') => void;
  bulkActive: boolean;
}) {
  const { totals } = status;
  const allHealthy =
    totals.assigned > 0 &&
    totals.httpError === 0 &&
    totals.exception === 0 &&
    totals.neverAttempted === 0 &&
    totals.noWebhookUrl === 0;

  return (
    <div className="px-6 py-5 space-y-5">
      {/* Counters */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        <DispatchCounter label="Assigned" count={totals.assigned} tone="slate" />
        <DispatchCounter
          label="Sent to Bonzo"
          count={totals.sent}
          tone={totals.sent > 0 ? 'emerald' : 'slate'}
        />
        <DispatchCounter
          label="HTTP Error"
          count={totals.httpError}
          tone={totals.httpError > 0 ? 'rose' : 'slate'}
        />
        <DispatchCounter
          label="Exception"
          count={totals.exception}
          tone={totals.exception > 0 ? 'rose' : 'slate'}
        />
        <DispatchCounter
          label="No webhook URL"
          count={totals.noWebhookUrl}
          tone={totals.noWebhookUrl > 0 ? 'amber' : 'slate'}
        />
        <DispatchCounter
          label="Never attempted"
          count={totals.neverAttempted}
          tone={totals.neverAttempted > 0 ? 'amber' : 'slate'}
        />
      </div>

      {/* Auto vs manual breakdown */}
      {totals.sent > 0 && (
        <div className="text-[11px] text-slate-500">
          Of {totals.sent.toLocaleString()} successful pushes:{' '}
          <strong className="text-slate-700">
            {totals.sentAuto.toLocaleString()} auto-forward
          </strong>
          {totals.sentManual > 0 && (
            <>
              ,{' '}
              <strong className="text-slate-700">
                {totals.sentManual.toLocaleString()} manual Push to Service
              </strong>
              {status.manualBonzoServices.length > 0 && (
                <>
                  {' '}via{' '}
                  {status.manualBonzoServices
                    .map((s) => s.name)
                    .join(', ')}
                </>
              )}
            </>
          )}
          .
        </div>
      )}

      {status.manualBonzoServices.length === 0 && (
        <div className="text-[11px] text-slate-500 italic">
          No IntegrationService whose URL template contains &ldquo;bonzo&rdquo;
          was found, so manual Push to Service runs aren&rsquo;t cross-credited
          here. If you push to Bonzo manually through a service with a
          different URL pattern, rename or tag it so the slug or URL
          contains &ldquo;bonzo&rdquo; and we&rsquo;ll catch it.
        </div>
      )}

      {status.excludedCsvLeads > 0 && (
        <div className="text-[11px] text-slate-500 italic">
          Excluded <strong>{status.excludedCsvLeads.toLocaleString()}</strong>{' '}
          CSV-uploaded lead{status.excludedCsvLeads === 1 ? '' : 's'} from this
          window — those are bulk imports where the Bonzo push is opt-in at
          upload time, so they don&rsquo;t belong in the auto-forward health
          check.
        </div>
      )}

      {allHealthy && (
        <div className="flex items-start gap-3 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
          <CheckCircle2 className="h-5 w-5 text-emerald-600 mt-0.5 flex-shrink-0" />
          <div>
            All <strong>{totals.assigned.toLocaleString()}</strong> leads
            assigned in the last {status.lookbackDays} days were successfully
            forwarded to Bonzo. No errors, no missing webhook URLs.
          </div>
        </div>
      )}

      {totals.neverAttempted > 0 && (
        <div className="flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <AlertTriangle className="h-5 w-5 text-amber-600 mt-0.5 flex-shrink-0" />
          <div className="space-y-1 flex-1">
            <div>
              <strong>{totals.neverAttempted.toLocaleString()}</strong> leads
              were assigned but neither the auto-forward nor a manual Push
              to Service to a Bonzo integration recorded a successful send.
              These were assigned before the audit was instrumented, OR
              their auto-forward errored before writing an outcome AND
              they weren&rsquo;t manually pushed.
            </div>
            <div className="text-xs">
              Manual pushes are detected automatically by joining
              ServiceDispatch SENT rows for any IntegrationService whose
              URL contains &ldquo;bonzo&rdquo; — those leads are
              <strong> excluded</strong> from this bucket and from
              &ldquo;Retry never-attempted&rdquo; so you don&rsquo;t
              accidentally double-push.
            </div>
          </div>
        </div>
      )}

      {totals.noWebhookUrl > 0 && (
        <div className="flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <AlertTriangle className="h-5 w-5 text-amber-600 mt-0.5 flex-shrink-0" />
          <div className="space-y-1">
            <div>
              <strong>{totals.noWebhookUrl.toLocaleString()}</strong> leads
              were assigned to LOs whose <code>UserLeadQuota.bonzoWebhookUrl</code>{' '}
              is blank. Have those LOs paste their Bonzo webhook URL on their
              profile, then retry these leads.
            </div>
          </div>
        </div>
      )}

      {/* Top errors */}
      {status.topErrors.length > 0 && (
        <div className="rounded-xl border border-rose-200 bg-rose-50">
          <div className="px-4 py-2 text-[11px] font-bold uppercase tracking-wider text-rose-800 border-b border-rose-200">
            Top error messages
          </div>
          <table className="w-full text-xs">
            <tbody className="divide-y divide-rose-100">
              {status.topErrors.map((e) => (
                <tr key={e.key}>
                  <td className="px-4 py-1.5 font-mono text-[11px] text-rose-900">
                    {e.key}
                  </td>
                  <td className="px-4 py-1.5 text-right text-rose-900 font-bold tabular-nums">
                    {e.count}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* HTTP error rows */}
      {status.recentHttpErrors.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-3">
            <h3 className="text-xs font-bold uppercase tracking-wider text-rose-800">
              Recent HTTP errors ({totals.httpError.toLocaleString()})
            </h3>
            <button
              type="button"
              onClick={() => onBulkRetry('failed')}
              disabled={
                bulkActive || totals.httpError + totals.exception === 0
              }
              className="inline-flex items-center gap-2 rounded-lg border border-rose-300 bg-white px-3 py-1.5 text-[11px] font-semibold text-rose-700 hover:bg-rose-50 disabled:opacity-60 disabled:cursor-not-allowed"
              title="Retry every Bonzo forward in this window with outcome http_error or exception."
            >
              {bulkActive ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <Send className="h-3 w-3" />
              )}
              Retry all failed ({(totals.httpError + totals.exception).toLocaleString()})
            </button>
          </div>
          <BonzoSampleTable
            rows={status.recentHttpErrors}
            retryingId={retryingId}
            onRetry={onRetry}
          />
        </div>
      )}

      {/* Exception rows */}
      {status.recentExceptions.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-xs font-bold uppercase tracking-wider text-rose-800">
            Recent exceptions ({totals.exception.toLocaleString()})
          </h3>
          <BonzoSampleTable
            rows={status.recentExceptions}
            retryingId={retryingId}
            onRetry={onRetry}
          />
        </div>
      )}

      {/* Never attempted rows */}
      {status.recentNeverAttempted.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-3">
            <h3 className="text-xs font-bold uppercase tracking-wider text-amber-800">
              Never attempted ({totals.neverAttempted.toLocaleString()})
            </h3>
            <button
              type="button"
              onClick={() => onBulkRetry('never')}
              disabled={bulkActive || totals.neverAttempted === 0}
              className="inline-flex items-center gap-2 rounded-lg border border-amber-300 bg-white px-3 py-1.5 text-[11px] font-semibold text-amber-700 hover:bg-amber-50 disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {bulkActive ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <Send className="h-3 w-3" />
              )}
              Retry never-attempted ({totals.neverAttempted.toLocaleString()})
            </button>
          </div>
          <BonzoSampleTable
            rows={status.recentNeverAttempted}
            retryingId={retryingId}
            onRetry={onRetry}
          />
        </div>
      )}

      {/* No-webhook rows */}
      {status.recentNoWebhook.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-3">
            <h3 className="text-xs font-bold uppercase tracking-wider text-amber-800">
              No webhook URL on assigned LO ({totals.noWebhookUrl.toLocaleString()})
            </h3>
            <button
              type="button"
              onClick={() => onBulkRetry('no-webhook')}
              disabled={bulkActive || totals.noWebhookUrl === 0}
              className="inline-flex items-center gap-2 rounded-lg border border-amber-300 bg-white px-3 py-1.5 text-[11px] font-semibold text-amber-700 hover:bg-amber-50 disabled:opacity-60 disabled:cursor-not-allowed"
              title="Retries the forward — useful after the LO pastes their Bonzo webhook URL."
            >
              {bulkActive ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <Send className="h-3 w-3" />
              )}
              Retry no-webhook
            </button>
          </div>
          <BonzoSampleTable
            rows={status.recentNoWebhook}
            retryingId={retryingId}
            onRetry={onRetry}
          />
        </div>
      )}

      {/* Recent sent (proof of life) */}
      {status.recentSent.length > 0 && (
        <details className="rounded-xl border border-slate-200 bg-slate-50">
          <summary className="cursor-pointer px-4 py-2.5 text-xs font-semibold text-slate-700 flex items-center gap-2">
            <Send className="h-3.5 w-3.5" />
            Latest successful Bonzo pushes ({status.recentSent.length})
          </summary>
          <BonzoSampleTable
            rows={status.recentSent}
            retryingId={retryingId}
            onRetry={onRetry}
            embedded
          />
        </details>
      )}
    </div>
  );
}

function BonzoSampleTable({
  rows,
  retryingId,
  onRetry,
  embedded,
}: {
  rows: BonzoForwardSampleRow[];
  retryingId: string | null;
  onRetry: (row: BonzoForwardSampleRow) => void;
  embedded?: boolean;
}) {
  return (
    <div
      className={
        embedded
          ? 'overflow-x-auto'
          : 'overflow-x-auto rounded-xl border border-slate-200 bg-white'
      }
    >
      <table className="w-full text-xs">
        <thead className="bg-slate-50 text-[10px] uppercase tracking-wider text-slate-500">
          <tr>
            <th className="px-3 py-2 text-left">Assigned</th>
            <th className="px-3 py-2 text-left">Lead</th>
            <th className="px-3 py-2 text-left">Assigned LO</th>
            <th className="px-3 py-2 text-left">Outcome</th>
            <th className="px-3 py-2 text-left">Detail</th>
            <th className="px-3 py-2 text-right">Action</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100 bg-white">
          {rows.map((row) => (
            <tr key={row.leadId}>
              <td className="px-3 py-2 text-slate-500 whitespace-nowrap">
                {row.assignedAt ? (
                  <FormatDate date={row.assignedAt} mode="datetime" />
                ) : (
                  '—'
                )}
              </td>
              <td className="px-3 py-2 font-semibold text-slate-800 whitespace-nowrap">
                {row.leadName}
                {row.vendorSlug && (
                  <span className="ml-1 font-mono text-[10px] text-slate-400">
                    {row.vendorSlug}
                  </span>
                )}
              </td>
              <td className="px-3 py-2 text-slate-600">
                {row.assignedUserName || row.assignedUserEmail || '—'}
              </td>
              <td className="px-3 py-2 font-mono text-[10px]">
                <span
                  className={`rounded px-1.5 py-0.5 ${
                    row.outcome === 'sent'
                      ? 'bg-emerald-100 text-emerald-800'
                      : row.outcome === 'http_error' || row.outcome === 'exception'
                        ? 'bg-rose-100 text-rose-800'
                        : row.outcome === 'no_webhook_url' || row.outcome === 'never_attempted'
                          ? 'bg-amber-100 text-amber-800'
                          : 'bg-slate-100 text-slate-700'
                  }`}
                >
                  {row.outcome}
                  {row.status ? ` (${row.status})` : ''}
                </span>
                {row.source === 'manual' && (
                  <span
                    className="ml-1 rounded bg-blue-100 px-1.5 py-0.5 text-blue-800"
                    title={
                      row.manualServiceSlug
                        ? `Manually pushed via ${row.manualServiceSlug}`
                        : 'Manually pushed via Push to Service'
                    }
                  >
                    manual
                  </span>
                )}
              </td>
              <td
                className="px-3 py-2 text-slate-600 max-w-md truncate font-mono text-[11px]"
                title={row.errorPreview ?? ''}
              >
                {row.errorPreview ?? '—'}
              </td>
              <td className="px-3 py-2 text-right">
                <button
                  type="button"
                  onClick={() => onRetry(row)}
                  disabled={retryingId === row.leadId}
                  className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60 disabled:cursor-not-allowed"
                >
                  {retryingId === row.leadId ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    <Send className="h-3 w-3" />
                  )}
                  Retry
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function BulkRetryProgressBar({
  progress,
  onCancel,
  onDismiss,
}: {
  progress: BulkRetryProgress;
  onCancel: () => void;
  onDismiss: () => void;
}) {
  const pct =
    progress.total === 0
      ? 0
      : Math.min(100, Math.round((progress.completed / progress.total) * 100));
  const isRunning = !progress.done;
  const cleanFinish = progress.done && progress.stillFailed === 0;

  // Color the bar by terminal state — running uses blue, finished
  // clean uses emerald, finished with errors uses amber. Cancelled
  // mid-run uses slate so it looks "interrupted" not "broken".
  const toneClass = progress.cancelled
    ? 'bg-slate-50 border-slate-200 text-slate-700'
    : isRunning
      ? 'bg-blue-50 border-blue-200 text-blue-900'
      : cleanFinish
        ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
        : 'bg-amber-50 border-amber-200 text-amber-900';
  const fillClass = progress.cancelled
    ? 'bg-slate-400'
    : isRunning
      ? 'bg-blue-500'
      : cleanFinish
        ? 'bg-emerald-500'
        : 'bg-amber-500';

  return (
    <div className={`px-6 py-3 border-b ${toneClass}`}>
      <div className="flex items-center justify-between gap-3 mb-2">
        <div className="text-xs font-semibold flex items-center gap-2">
          {isRunning ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : cleanFinish ? (
            <CheckCircle2 className="h-3.5 w-3.5" />
          ) : (
            <AlertTriangle className="h-3.5 w-3.5" />
          )}
          <span>
            {isRunning
              ? `Retrying ${progress.completed.toLocaleString()} of ${progress.total.toLocaleString()}…`
              : progress.cancelled
                ? `Cancelled — ${progress.completed.toLocaleString()} of ${progress.total.toLocaleString()} processed`
                : `Done — retried ${progress.total.toLocaleString()}`}
          </span>
        </div>
        <div className="flex items-center gap-3">
          <div className="text-[11px] tabular-nums opacity-80">
            <span className="text-emerald-700">✓ {progress.succeeded}</span>
            {progress.stillFailed > 0 && (
              <>
                {' '}
                <span className="text-rose-700">✗ {progress.stillFailed}</span>
              </>
            )}
            {progress.skipped > 0 && (
              <>
                {' '}
                <span className="text-amber-700">↷ {progress.skipped}</span>
              </>
            )}
          </div>
          {isRunning ? (
            <button
              type="button"
              onClick={onCancel}
              className="inline-flex items-center gap-1 rounded-lg border border-current bg-white/60 px-2 py-0.5 text-[11px] font-semibold hover:bg-white"
            >
              <X className="h-3 w-3" />
              Cancel
            </button>
          ) : (
            <button
              type="button"
              onClick={onDismiss}
              className="text-[10px] uppercase tracking-wider opacity-70 hover:opacity-100"
            >
              Dismiss
            </button>
          )}
        </div>
      </div>
      <div className="h-2 w-full rounded-full bg-white/60 overflow-hidden">
        <div
          className={`h-full ${fillClass} transition-all duration-300`}
          style={{ width: `${pct}%` }}
        />
      </div>
      {progress.lastError && (
        <div className="mt-2 font-mono text-[10px] opacity-75 truncate" title={progress.lastError}>
          {progress.stillFailed > 0 ? 'Latest error' : 'Status'}: {progress.lastError}
        </div>
      )}
    </div>
  );
}

function BrokerLaunchEmailBody({
  status,
  retryingId,
  onRetry,
  onBulkRetry,
  bulkRetryActive,
}: {
  status: BrokerLaunchEmailStatus;
  retryingId: string | null;
  onRetry: (row: BrokerLaunchDispatchRow) => void;
  onBulkRetry: () => void;
  bulkRetryActive: boolean;
}) {
  const allHealthy =
    status.env.ok &&
    status.service?.active === true &&
    status.counts.failed === 0 &&
    status.coverage.gap === 0;

  return (
    <div className="px-6 py-5 space-y-5">
      {/* Service + env health banner */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <ServiceFlag
          label="Integration Service"
          ok={status.service?.active === true}
          okText={`Active (${status.service?.slug ?? '—'})`}
          badText={
            status.service
              ? `Disabled — flip "${status.service.name}" back to Active in Lead Distribution → Services to resume sending.`
              : 'Service row missing — re-run the broker-launch-email seed migration or contact engineering.'
          }
        />
        <ServiceFlag
          label="Microsoft Graph"
          ok={status.env.ok}
          okText="All MS_* env vars present on this deployment."
          badText={`Missing env vars: ${status.env.missing.join(', ')}. Set them in Vercel and redeploy — every email send will fail until then.`}
        />
      </div>

      {/* Counters */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <DispatchCounter label="Sent" count={status.counts.sent} tone="emerald" />
        <DispatchCounter label="Unresolved Failed" count={status.counts.failed} tone={status.counts.failed > 0 ? 'rose' : 'slate'} />
        <DispatchCounter label="Skipped" count={status.counts.skipped} tone={status.counts.skipped > 0 ? 'amber' : 'slate'} />
        <DispatchCounter label="Pending" count={status.counts.pending} tone={status.counts.pending > 0 ? 'amber' : 'slate'} />
      </div>

      {/* Coverage banner */}
      <div
        className={`rounded-xl border px-4 py-3 text-sm ${
          status.coverage.gap > 0
            ? 'border-rose-200 bg-rose-50 text-rose-900'
            : 'border-slate-200 bg-slate-50 text-slate-700'
        }`}
      >
        <div className="flex items-start gap-3">
          {status.coverage.gap > 0 ? (
            <AlertTriangle className="h-5 w-5 text-rose-600 mt-0.5 flex-shrink-0" />
          ) : (
            <CheckCircle2 className="h-5 w-5 text-emerald-600 mt-0.5 flex-shrink-0" />
          )}
          <div className="space-y-1">
            <div>
              <strong>{status.coverage.leadsAssignedInWindow.toLocaleString()}</strong>{' '}
              leads were assigned (Lead.assignedAt) and{' '}
              <strong>{status.coverage.dispatchesInWindow.toLocaleString()}</strong>{' '}
              broker-launch dispatches were created
              {status.coverageClampedToService ? (
                <>
                  {' '}since the service was promoted on{' '}
                  <FormatDate date={status.coverageWindowStart} mode="datetime" />
                </>
              ) : (
                <> in the last {status.lookbackDays} days</>
              )}
              .
            </div>
            {status.coverage.gap > 0 ? (
              <div className="text-xs">
                Gap of <strong>{status.coverage.gap.toLocaleString()}</strong>{' '}
                — that many assignments did not produce a dispatch row.
                Likely causes: an assignment path that bypasses{' '}
                <code className="rounded bg-rose-100 px-1">runServiceTriggers(ON_ASSIGN)</code>,
                or services were briefly disabled. Spot-check a few in the
                Leads table and use the manual <em>Push to Service</em>
                {' '}button if needed.
              </div>
            ) : (
              <div className="text-xs">
                Every assignment produced a dispatch row — the trigger
                wiring is healthy.
              </div>
            )}
            {status.coverageClampedToService && (
              <div className="text-[11px] opacity-70">
                Window clamped to the service's creation time so we don't
                count assignments from before broker-launch existed.
              </div>
            )}
          </div>
        </div>
      </div>

      {/* All-healthy callout when nothing's wrong */}
      {allHealthy && status.counts.sent > 0 && (
        <div className="flex items-start gap-3 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
          <CheckCircle2 className="h-5 w-5 text-emerald-600 mt-0.5 flex-shrink-0" />
          <div>
            <strong>{status.counts.sent.toLocaleString()}</strong> Broker
            Launch emails went out cleanly in this window with no failures
            or skipped rows. Service and Graph config look healthy.
          </div>
        </div>
      )}

      {allHealthy && status.counts.sent === 0 && (
        <div className="flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <Mail className="h-5 w-5 text-amber-600 mt-0.5 flex-shrink-0" />
          <div>
            No emails were sent in the last {status.lookbackDays} days, but
            no failures or skips were recorded either. Either no leads were
            assigned in this window, or assignment paths are silently
            bypassing the trigger. Bump the lookback or check the coverage
            gap above.
          </div>
        </div>
      )}

      {/* Failed table */}
      {status.recentFailed.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-3">
            <h3 className="text-xs font-bold uppercase tracking-wider text-rose-800">
              Recent unresolved failures ({status.counts.failed.toLocaleString()})
            </h3>
            <button
              type="button"
              onClick={onBulkRetry}
              disabled={bulkRetryActive || status.counts.failed === 0}
              className="inline-flex items-center gap-2 rounded-lg border border-rose-300 bg-white px-3 py-1.5 text-[11px] font-semibold text-rose-700 hover:bg-rose-50 disabled:opacity-60 disabled:cursor-not-allowed"
              title="Reissue every unresolved FAILED dispatch in the lookback window. A later SENT dispatch for the same lead clears it from this Health bucket; originals stay in history. Capped at 500 per click and runs one row at a time so you see live progress."
            >
              {bulkRetryActive ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <Send className="h-3 w-3" />
              )}
              Retry all failed
            </button>
          </div>
          <DispatchTable
            title=""
            rows={status.recentFailed}
            tone="rose"
            showError
            showRetry
            retryingId={retryingId}
            onRetry={onRetry}
          />
        </div>
      )}

      {/* Skipped table */}
      {status.recentSkipped.length > 0 && (
        <DispatchTable
          title={`Recent skips (${status.counts.skipped.toLocaleString()})`}
          rows={status.recentSkipped}
          tone="amber"
          showSkipReason
          showRetry
          retryingId={retryingId}
          onRetry={onRetry}
        />
      )}

      {/* Sent proof of life */}
      {status.recentSent.length > 0 && (
        <details className="rounded-xl border border-slate-200 bg-slate-50">
          <summary className="cursor-pointer px-4 py-2.5 text-xs font-semibold text-slate-700 flex items-center gap-2">
            <Send className="h-3.5 w-3.5" />
            Latest successful sends ({status.recentSent.length})
          </summary>
          <DispatchTable
            title=""
            rows={status.recentSent}
            tone="emerald"
            embedded
          />
        </details>
      )}
    </div>
  );
}

function ServiceFlag({
  label,
  ok,
  okText,
  badText,
}: {
  label: string;
  ok: boolean;
  okText: string;
  badText: string;
}) {
  return (
    <div
      className={`rounded-xl border px-4 py-3 ${
        ok
          ? 'border-emerald-200 bg-emerald-50'
          : 'border-rose-200 bg-rose-50'
      }`}
    >
      <div className="flex items-start gap-3">
        {ok ? (
          <CheckCircle2 className="h-5 w-5 text-emerald-600 mt-0.5 flex-shrink-0" />
        ) : (
          <AlertTriangle className="h-5 w-5 text-rose-600 mt-0.5 flex-shrink-0" />
        )}
        <div>
          <div className="text-[11px] font-bold uppercase tracking-wider opacity-80">
            {label}
          </div>
          <div className={`text-xs mt-0.5 ${ok ? 'text-emerald-900' : 'text-rose-900'}`}>
            {ok ? okText : badText}
          </div>
        </div>
      </div>
    </div>
  );
}

function DispatchCounter({
  label,
  count,
  tone,
}: {
  label: string;
  count: number;
  tone: StatTone;
}) {
  return (
    <div className={`rounded-xl border px-4 py-3 ${STAT_TONE_CLASSES[tone]}`}>
      <div className="text-[11px] font-bold uppercase tracking-wider opacity-80">
        {label}
      </div>
      <div className="text-2xl font-bold tabular-nums mt-1">
        {count.toLocaleString()}
      </div>
    </div>
  );
}

function DispatchTable({
  title,
  rows,
  tone,
  showError,
  showSkipReason,
  showRetry,
  retryingId,
  onRetry,
  embedded,
}: {
  title: string;
  rows: BrokerLaunchDispatchRow[];
  tone: StatTone;
  showError?: boolean;
  showSkipReason?: boolean;
  showRetry?: boolean;
  retryingId?: string | null;
  onRetry?: (row: BrokerLaunchDispatchRow) => void;
  embedded?: boolean;
}) {
  const headerToneClass: Record<StatTone, string> = {
    rose: 'bg-rose-50 text-rose-900 border-rose-200',
    amber: 'bg-amber-50 text-amber-900 border-amber-200',
    emerald: 'bg-emerald-50 text-emerald-900 border-emerald-200',
    slate: 'bg-slate-50 text-slate-700 border-slate-200',
  };
  return (
    <div
      className={
        embedded
          ? 'overflow-x-auto'
          : `rounded-xl border ${headerToneClass[tone].split(' ').slice(-1)[0]} bg-white`
      }
    >
      {!embedded && title && (
        <div
          className={`px-4 py-2 text-[11px] font-bold uppercase tracking-wider border-b ${headerToneClass[tone]}`}
        >
          {title}
        </div>
      )}
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead className="bg-slate-50 text-[10px] uppercase tracking-wider text-slate-500">
            <tr>
              <th className="px-3 py-2 text-left">When</th>
              <th className="px-3 py-2 text-left">Lead</th>
              <th className="px-3 py-2 text-left">Assigned LO</th>
              <th className="px-3 py-2 text-left">Recipient</th>
              {!showError && !showSkipReason && (
                <th className="px-3 py-2 text-left">Graph proof</th>
              )}
              {showError && <th className="px-3 py-2 text-left">Error</th>}
              {showSkipReason && (
                <th className="px-3 py-2 text-left">Reason</th>
              )}
              <th className="px-3 py-2 text-left">Trigger</th>
              {showRetry && <th className="px-3 py-2 text-right">Action</th>}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 bg-white">
            {rows.map((row) => (
              <tr key={row.dispatchId}>
                <td className="px-3 py-2 text-slate-500 whitespace-nowrap">
                  <FormatDate date={row.createdAt} mode="datetime" />
                </td>
                <td className="px-3 py-2 font-semibold text-slate-800 whitespace-nowrap">
                  {row.leadName}
                  {row.leadVendorSlug && (
                    <span className="ml-1 font-mono text-[10px] text-slate-400">
                      {row.leadVendorSlug}
                    </span>
                  )}
                </td>
                <td className="px-3 py-2 text-slate-600">
                  {row.assignedUserName || row.assignedUserEmail || '—'}
                </td>
                <td className="px-3 py-2 font-mono text-[11px] text-slate-600">
                  {row.recipient || row.assignedUserEmail || '—'}
                </td>
                {!showError && !showSkipReason && (
                  <td
                    className="px-3 py-2 font-mono text-[10px] text-slate-500 max-w-xs truncate"
                    title={
                      row.graphRequestId || row.graphClientRequestId
                        ? `acceptedAt=${row.graphAcceptedAt ?? 'n/a'} request-id=${row.graphRequestId ?? 'n/a'} client-request-id=${row.graphClientRequestId ?? 'n/a'}`
                        : ''
                    }
                  >
                    {row.graphRequestId || row.graphClientRequestId ? (
                      <>
                        Graph accepted{' '}
                        {row.graphAcceptedAt ? (
                          <FormatDate date={row.graphAcceptedAt} mode="datetime" />
                        ) : (
                          '—'
                        )}
                      </>
                    ) : (
                      <span className="italic text-slate-400">
                        legacy row; no Graph receipt
                      </span>
                    )}
                  </td>
                )}
                {showError && (
                  <td
                    className="px-3 py-2 text-rose-700 max-w-md truncate"
                    title={row.lastError ?? ''}
                  >
                    {row.lastError || '—'}
                  </td>
                )}
                {showSkipReason && (
                  <td className="px-3 py-2 text-amber-800">
                    {row.skippedReason || '—'}
                  </td>
                )}
                <td className="px-3 py-2 font-mono text-[10px] text-slate-500">
                  {row.trigger}
                </td>
                {showRetry && onRetry && (
                  <td className="px-3 py-2 text-right">
                    <button
                      type="button"
                      onClick={() => onRetry(row)}
                      disabled={retryingId === row.dispatchId}
                      className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60 disabled:cursor-not-allowed"
                    >
                      {retryingId === row.dispatchId ? (
                        <Loader2 className="h-3 w-3 animate-spin" />
                      ) : (
                        <Send className="h-3 w-3" />
                      )}
                      Retry
                    </button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tiny presentational helpers
// ---------------------------------------------------------------------------

function Section({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-3">
      <div className="space-y-1">
        <h2 className="text-base font-bold text-slate-900">{title}</h2>
        <p className="text-xs text-slate-500 max-w-3xl">{description}</p>
      </div>
      {children}
    </section>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="space-y-1 text-xs font-semibold text-slate-600">
      <span className="block">{label}</span>
      {children}
    </label>
  );
}

type StatTone = 'rose' | 'amber' | 'emerald' | 'slate';
const STAT_TONE_CLASSES: Record<StatTone, string> = {
  rose: 'border-rose-200 bg-rose-50 text-rose-900',
  amber: 'border-amber-200 bg-amber-50 text-amber-900',
  emerald: 'border-emerald-200 bg-emerald-50 text-emerald-900',
  slate: 'border-slate-200 bg-slate-50 text-slate-900',
};

function StatCard({
  label,
  count,
  denominator,
  tone,
  help,
}: {
  label: string;
  count: number;
  denominator: number;
  tone: StatTone;
  help: string;
}) {
  const Icon = tone === 'emerald' ? CheckCircle2 : AlertTriangle;
  return (
    <div
      className={`rounded-xl border p-4 ${STAT_TONE_CLASSES[tone]}`}
      title={help}
    >
      <div className="flex items-start justify-between gap-2">
        <span className="text-xs font-semibold uppercase tracking-wider opacity-80">
          {label}
        </span>
        <Icon className="h-4 w-4 opacity-70" />
      </div>
      <div className="mt-1 flex items-baseline gap-1.5">
        <span className="text-2xl font-bold tabular-nums">
          {count.toLocaleString()}
        </span>
        <span className="text-xs opacity-70">/ {denominator.toLocaleString()}</span>
        <span className="ml-auto text-[11px] opacity-70">{pct(count, denominator)}</span>
      </div>
      <div className="mt-2 flex items-start gap-1.5 text-[11px] opacity-80">
        <HelpCircle className="h-3 w-3 mt-0.5 flex-shrink-0" />
        <p>{help}</p>
      </div>
    </div>
  );
}

function DistributionTable({
  title,
  rows,
}: {
  title: string;
  rows: Array<{ value: string; count: number }>;
}) {
  if (rows.length === 0) return null;
  return (
    <div className="rounded-xl border border-slate-200 bg-white">
      <div className="px-4 py-2 text-[11px] font-bold uppercase tracking-wider text-slate-500 border-b border-slate-100">
        {title}
      </div>
      <table className="w-full text-xs">
        <tbody className="divide-y divide-slate-100">
          {rows.map((r) => (
            <tr key={r.value}>
              <td className="px-4 py-1.5 text-slate-700">{r.value}</td>
              <td className="px-4 py-1.5 text-right tabular-nums text-slate-900 font-semibold">
                {r.count}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function pct(part: number, whole: number): string {
  if (!whole) return '0%';
  return `${((part / whole) * 100).toFixed(1)}%`;
}
