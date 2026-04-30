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

import React, { useEffect, useState, useTransition } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  HelpCircle,
  Loader2,
  Play,
  RefreshCcw,
  Save,
} from 'lucide-react';
import { WebhookInboxPanel } from './WebhookInboxPanel';
import {
  getAuditVendors,
  getLeadAddressBackfillPreview,
  getLeadMappingAudit,
  runLeadAddressBackfill,
  type AddressBackfillApplyResult,
  type AddressBackfillSummary,
  type AuditVendorOption,
  type LeadMappingAuditResult,
} from '@/app/actions/leadHealthActions';
import { FormatDate } from '@/components/ui/FormatDate';

const DEFAULT_VENDOR = 'freerateupdate';
const DAY_OPTIONS = [3, 7, 14, 30] as const;
const LIMIT_OPTIONS = [100, 200, 500, 1000] as const;
const BACKFILL_LIMIT_OPTIONS = [100, 250, 500, 1000, 2000] as const;

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

      {/* 2. Lead mapping audit */}
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

      {/* 3. Address backfill */}
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
