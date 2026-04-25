'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  Archive,
  ArchiveRestore,
  CheckCircle2,
  ChevronDown,
  GripVertical,
  Info,
  Loader2,
  Pencil,
  Plus,
  Save,
  Trash2,
  X,
  Zap,
} from 'lucide-react';
import { useRouter } from 'next/navigation';
import {
  archiveIntegrationService,
  createIntegrationService,
  deleteIntegrationService,
  restoreIntegrationService,
  updateIntegrationService,
} from '@/app/actions/leadActions';
import {
  INTEGRATION_SERVICE_PRESETS,
  type IntegrationServiceCaptureField,
  type IntegrationServiceCredentialFieldDTO,
  type IntegrationServiceInput,
  type IntegrationServiceOAuthConfig,
  type IntegrationServicePreset,
  type IntegrationServiceSummary,
} from '@/lib/integrationServices/types';
import { listAvailableTokens, type TokenSpec } from '@/lib/services/template';
import type {
  IntegrationServiceKind,
  IntegrationServiceMethod,
  IntegrationServiceScope,
  IntegrationServiceTrigger,
} from '@prisma/client';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type UserOption = { id: string; name: string };
type CampaignOption = { id: string; name: string };

type Props = {
  services: IntegrationServiceSummary[];
  users: UserOption[];
  campaigns: CampaignOption[];
};

type EditTarget =
  | { mode: 'create' }
  | { mode: 'edit'; service: IntegrationServiceSummary };

const LEAD_STATUS_VALUES = [
  'NEW',
  'CONTACTED',
  'WORKING',
  'CONVERTED',
  'DEAD',
  'RETURNED',
  'UNASSIGNED',
] as const;

const METHOD_OPTIONS: Array<{ value: IntegrationServiceMethod; label: string }> = [
  { value: 'GET', label: 'GET' },
  { value: 'POST_TEXT', label: 'POST — Text' },
  { value: 'POST_FORM', label: 'POST — Form (url-encoded)' },
  { value: 'POST_JSON', label: 'POST — JSON' },
  { value: 'POST_XML', label: 'POST — XML (application/xml)' },
  { value: 'POST_XML_TEXT', label: 'POST — XML (text/xml)' },
  { value: 'POST_XML_SOAP', label: 'POST — SOAP envelope' },
  { value: 'PUT_JSON', label: 'PUT — JSON' },
];

const TRIGGER_OPTIONS: Array<{ value: IntegrationServiceTrigger; label: string; help?: string }> = [
  { value: 'MANUAL', label: 'Manual only', help: 'Admins fire this service from the Push to Service button.' },
  { value: 'ON_RECEIVE', label: 'On lead received', help: 'Runs immediately when a lead is ingested.' },
  { value: 'ON_ASSIGN', label: 'On lead assigned', help: 'Runs as soon as a lead is assigned to an LO.' },
  { value: 'ON_STATUS_CHANGE', label: 'On status change', help: 'Runs when a lead transitions into the chosen status.' },
  { value: 'DELAY_AFTER_RECEIVE', label: 'Delay after received' },
  { value: 'DELAY_AFTER_ASSIGN', label: 'Delay after assigned' },
];

const KIND_OPTIONS: Array<{ value: IntegrationServiceKind; label: string; help: string }> = [
  { value: 'CLIENT', label: 'Client', help: 'Admins + LOs can see this service fire on their leads.' },
  { value: 'SERVER', label: 'Server', help: 'Internal-only service. Hidden from LO views.' },
];

const DATE_OVERRIDE_OPTIONS = [
  { value: '', label: 'Default (use live receivedAt)' },
  { value: 'receivedAt', label: 'receivedAt' },
  { value: 'createdAt', label: 'createdAt' },
  { value: 'assignedAt', label: 'assignedAt' },
];

const CAPTURE_FIELD_TARGETS: Array<{ value: string; label: string }> = [
  { value: '', label: 'Choose a target…' },
  { value: 'vendorLeadId', label: 'Lead vendorLeadId' },
  { value: 'firstName', label: 'Lead firstName' },
  { value: 'lastName', label: 'Lead lastName' },
  { value: 'email', label: 'Lead email' },
  { value: 'phone', label: 'Lead phone' },
  { value: 'homePhone', label: 'Lead homePhone' },
  { value: 'workPhone', label: 'Lead workPhone' },
  { value: 'loanAmount', label: 'Lead loanAmount' },
  { value: 'loanPurpose', label: 'Lead loanPurpose' },
  { value: 'loanType', label: 'Lead loanType' },
  { value: 'loanTerm', label: 'Lead loanTerm' },
  { value: 'loanRate', label: 'Lead loanRate' },
  { value: 'creditRating', label: 'Lead creditRating' },
  { value: 'propertyValue', label: 'Lead propertyValue' },
  { value: 'propertyAddress', label: 'Lead propertyAddress' },
  { value: 'propertyCity', label: 'Lead propertyCity' },
  { value: 'propertyState', label: 'Lead propertyState' },
  { value: 'propertyZip', label: 'Lead propertyZip' },
  { value: 'income', label: 'Lead income' },
  { value: 'employer', label: 'Lead employer' },
  { value: 'jobTitle', label: 'Lead jobTitle' },
  { value: 'source', label: 'Lead source' },
  { value: 'customData.*', label: 'Lead customData (free-form)' },
];

// ---------------------------------------------------------------------------
// Root component
// ---------------------------------------------------------------------------

export function IntegrationServiceManager({
  services,
  users,
  campaigns,
}: Props) {
  const [editTarget, setEditTarget] = useState<EditTarget | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<IntegrationServiceSummary | null>(null);
  const router = useRouter();
  const [pending, setPending] = useState<string | null>(null);

  const runAction = useCallback(
    async (id: string, fn: () => Promise<unknown>) => {
      setPending(id);
      try {
        await fn();
        router.refresh();
      } catch (err) {
        alert(err instanceof Error ? err.message : 'Action failed');
      } finally {
        setPending(null);
      }
    },
    [router]
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="text-sm text-slate-500">
          {services.length} service{services.length === 1 ? '' : 's'}
          {services.some((s) => !s.active) && (
            <span className="ml-2 text-xs text-slate-400">
              (archived services are hidden from the Push to Service picker)
            </span>
          )}
        </div>
        <button
          type="button"
          onClick={() => setEditTarget({ mode: 'create' })}
          className="app-btn-primary"
        >
          <Plus className="h-4 w-4" />
          New service
        </button>
      </div>

      <div className="overflow-x-auto rounded-xl border border-slate-200">
        <table className="w-full text-sm">
          <thead className="bg-slate-50">
            <tr className="border-b border-slate-200">
              <th className="px-4 py-3 text-left text-[11px] font-bold uppercase tracking-wider text-slate-500">
                Status
              </th>
              <th className="px-4 py-3 text-left text-[11px] font-bold uppercase tracking-wider text-slate-500">
                Service
              </th>
              <th className="px-4 py-3 text-left text-[11px] font-bold uppercase tracking-wider text-slate-500">
                Trigger
              </th>
              <th className="px-4 py-3 text-left text-[11px] font-bold uppercase tracking-wider text-slate-500">
                Method
              </th>
              <th className="px-4 py-3 text-left text-[11px] font-bold uppercase tracking-wider text-slate-500">
                Scope
              </th>
              <th
                className="px-4 py-3 text-right text-[11px] font-bold uppercase tracking-wider text-slate-500 whitespace-nowrap"
                style={{ width: 180, minWidth: 180 }}
              >
                Actions
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200">
            {services.length === 0 ? (
              <tr>
                <td
                  colSpan={6}
                  className="px-4 py-10 text-center text-sm text-slate-500"
                >
                  No services yet. Click{' '}
                  <span className="font-semibold">New service</span> to add one.
                </td>
              </tr>
            ) : (
              services.map((s) => (
                <tr
                  key={s.id}
                  className={`align-middle ${s.active ? '' : 'bg-amber-50/30'}`}
                >
                  <td className="px-4 py-3">
                    <span
                      className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                        s.active
                          ? 'border border-emerald-200 bg-emerald-50 text-emerald-700'
                          : 'border border-amber-200 bg-amber-50 text-amber-700'
                      }`}
                    >
                      {s.active ? 'Active' : 'Archived'}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-100 text-indigo-700">
                        <Zap className="h-4 w-4" />
                      </div>
                      <div className="min-w-0">
                        <div className="font-semibold text-slate-900 truncate">
                          {s.name}
                        </div>
                        <div className="text-xs font-mono text-slate-500 truncate">
                          {s.slug}
                        </div>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-xs">
                    <span className="inline-flex rounded-md border border-slate-200 bg-slate-50 px-2 py-0.5 font-mono text-slate-700">
                      {prettyTrigger(s.statusTrigger)}
                    </span>
                    {s.statusTrigger === 'ON_STATUS_CHANGE' && s.triggerStatus && (
                      <span className="ml-1 text-slate-500">
                        → {s.triggerStatus}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-xs">
                    <span className="inline-flex rounded-md border border-slate-200 bg-slate-50 px-2 py-0.5 font-mono text-slate-700">
                      {prettyMethod(s.method)}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-xs text-slate-600">
                    {renderScopeSummary(s, users, campaigns)}
                  </td>
                  <td className="px-4 py-3 text-right whitespace-nowrap">
                    <div className="flex items-center justify-end gap-1">
                      <button
                        className="app-icon-btn"
                        onClick={() =>
                          setEditTarget({ mode: 'edit', service: s })
                        }
                        title="Edit"
                      >
                        <Pencil className="h-4 w-4" />
                      </button>
                      {s.active ? (
                        <button
                          className="app-icon-btn text-amber-600 hover:bg-amber-50"
                          onClick={() =>
                            void runAction(s.id, () =>
                              archiveIntegrationService(s.id)
                            )
                          }
                          title="Archive"
                          disabled={pending === s.id}
                        >
                          {pending === s.id ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <Archive className="h-4 w-4" />
                          )}
                        </button>
                      ) : (
                        <>
                          <button
                            className="app-icon-btn text-emerald-600 hover:bg-emerald-50"
                            onClick={() =>
                              void runAction(s.id, () =>
                                restoreIntegrationService(s.id)
                              )
                            }
                            title="Restore"
                            disabled={pending === s.id}
                          >
                            {pending === s.id ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                              <ArchiveRestore className="h-4 w-4" />
                            )}
                          </button>
                          <button
                            className="app-icon-btn app-icon-btn-danger"
                            onClick={() => setDeleteTarget(s)}
                            title="Permanently delete…"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {editTarget && (
        <ServiceBuilderModal
          target={editTarget}
          users={users}
          campaigns={campaigns}
          onClose={() => setEditTarget(null)}
          onSaved={() => {
            setEditTarget(null);
            router.refresh();
          }}
        />
      )}

      {deleteTarget && (
        <ServiceDeleteDialog
          service={deleteTarget}
          onClose={() => setDeleteTarget(null)}
          onDeleted={() => {
            setDeleteTarget(null);
            router.refresh();
          }}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Builder Modal (full-screen sectioned editor)
// ---------------------------------------------------------------------------

type BuilderState = {
  name: string;
  slug: string;
  slugTouched: boolean;
  description: string;
  active: boolean;
  preset: IntegrationServicePreset;
  kind: IntegrationServiceKind;
  statusTrigger: IntegrationServiceTrigger;
  triggerStatus: string;
  triggerDay: string;
  triggerDelayMinutes: string;
  method: IntegrationServiceMethod;
  urlTemplate: string;
  bodyTemplate: string;
  headersTemplate: string;
  userScope: IntegrationServiceScope;
  userIds: string[];
  campaignScope: IntegrationServiceScope;
  campaignIds: string[];
  excludeSelected: boolean;
  successString: string;
  failNotifyEmail: string;
  dateOverride: string;
  captureFields: IntegrationServiceCaptureField[];
  requiresBrandNew: boolean;
  requiresNotBrandNew: boolean;
  requiresAssignedUser: boolean;
  requiresOAuth: boolean;
  allowManualSend: boolean;
  oauthConfig: IntegrationServiceOAuthConfig;
  credentialFields: Array<
    Omit<IntegrationServiceCredentialFieldDTO, 'id' | 'serviceId'>
  >;
};

function toBuilderState(svc: IntegrationServiceSummary | null): BuilderState {
  const preset =
    svc?.slug === 'bonzo'
      ? 'bonzo'
      : ((svc?.type as IntegrationServicePreset) ?? 'custom');
  return {
    name: svc?.name ?? '',
    slug: svc?.slug ?? '',
    slugTouched: !!svc,
    description: svc?.description ?? '',
    active: svc?.active ?? true,
    preset: (INTEGRATION_SERVICE_PRESETS as readonly string[]).includes(preset)
      ? (preset as IntegrationServicePreset)
      : 'custom',
    kind: svc?.kind ?? 'CLIENT',
    statusTrigger: svc?.statusTrigger ?? 'MANUAL',
    triggerStatus: svc?.triggerStatus ?? '',
    triggerDay:
      svc?.triggerDay !== null && svc?.triggerDay !== undefined
        ? String(svc.triggerDay)
        : '',
    triggerDelayMinutes:
      svc?.triggerDelayMinutes !== null && svc?.triggerDelayMinutes !== undefined
        ? String(svc.triggerDelayMinutes)
        : '',
    method: svc?.method ?? 'POST_JSON',
    urlTemplate: svc?.urlTemplate ?? '',
    bodyTemplate: svc?.bodyTemplate ?? '',
    headersTemplate: svc?.headersTemplate ?? '',
    userScope: svc?.userScope ?? 'ANY',
    userIds: svc?.userIds ?? [],
    campaignScope: svc?.campaignScope ?? 'ANY',
    campaignIds: svc?.campaignIds ?? [],
    excludeSelected: svc?.excludeSelected ?? false,
    successString: svc?.successString ?? '',
    failNotifyEmail: svc?.failNotifyEmail ?? '',
    dateOverride: svc?.dateOverride ?? '',
    captureFields: svc?.captureFields ?? [],
    requiresBrandNew: svc?.requiresBrandNew ?? false,
    requiresNotBrandNew: svc?.requiresNotBrandNew ?? false,
    requiresAssignedUser: svc?.requiresAssignedUser ?? false,
    requiresOAuth: svc?.requiresOAuth ?? false,
    allowManualSend: svc?.allowManualSend ?? true,
    oauthConfig: {
      tokenUrl: svc?.oauthConfig?.tokenUrl ?? '',
      clientId: svc?.oauthConfig?.clientId ?? '',
      clientSecret: svc?.oauthConfig?.clientSecret ?? '',
      scope: svc?.oauthConfig?.scope ?? '',
      grantType: svc?.oauthConfig?.grantType ?? 'client_credentials',
    },
    credentialFields: (svc?.credentialFields ?? []).map((f) => ({
      key: f.key,
      label: f.label,
      required: f.required,
      secret: f.secret,
      placeholder: f.placeholder,
      helpText: f.helpText,
      sortOrder: f.sortOrder,
    })),
  };
}

function toSubmitPayload(state: BuilderState): IntegrationServiceInput {
  const triggerDay = state.triggerDay.trim()
    ? Number(state.triggerDay)
    : null;
  const triggerDelayMinutes = state.triggerDelayMinutes.trim()
    ? Number(state.triggerDelayMinutes)
    : null;

  const oauthConfig = state.requiresOAuth
    ? {
        tokenUrl: state.oauthConfig.tokenUrl.trim(),
        clientId: state.oauthConfig.clientId.trim(),
        clientSecret: state.oauthConfig.clientSecret.trim(),
        scope: state.oauthConfig.scope?.trim() || undefined,
        grantType: state.oauthConfig.grantType?.trim() || 'client_credentials',
      }
    : null;

  return {
    name: state.name.trim(),
    slug: state.slug.trim() || undefined,
    description: state.description.trim() || null,
    active: state.active,
    type: state.preset,
    kind: state.kind,
    statusTrigger: state.statusTrigger,
    triggerStatus: state.statusTrigger === 'ON_STATUS_CHANGE' ? state.triggerStatus.trim() || null : null,
    triggerDay: Number.isFinite(triggerDay ?? NaN) ? triggerDay : null,
    triggerDelayMinutes: Number.isFinite(triggerDelayMinutes ?? NaN) ? triggerDelayMinutes : null,
    method: state.method,
    urlTemplate: state.urlTemplate,
    bodyTemplate: state.bodyTemplate,
    headersTemplate: state.headersTemplate,
    userScope: state.userScope,
    userIds: state.userScope === 'SPECIFIC' ? state.userIds : [],
    campaignScope: state.campaignScope,
    campaignIds: state.campaignScope === 'SPECIFIC' ? state.campaignIds : [],
    excludeSelected: state.excludeSelected,
    successString: state.successString.trim() || null,
    failNotifyEmail: state.failNotifyEmail.trim() || null,
    dateOverride: state.dateOverride.trim() || null,
    captureFields: state.captureFields.filter((c) => c.path && c.target),
    requiresBrandNew: state.requiresBrandNew,
    requiresNotBrandNew: state.requiresNotBrandNew,
    requiresAssignedUser: state.requiresAssignedUser,
    requiresOAuth: state.requiresOAuth,
    allowManualSend: state.allowManualSend,
    oauthConfig,
    credentialFields: state.credentialFields
      .filter((f) => f.key.trim())
      .map((f, idx) => ({
        key: f.key.trim(),
        label: f.label.trim() || f.key.trim(),
        required: !!f.required,
        secret: !!f.secret,
        placeholder: f.placeholder?.trim() || null,
        helpText: f.helpText?.trim() || null,
        sortOrder: idx,
      })),
  };
}

function ServiceBuilderModal({
  target,
  users,
  campaigns,
  onClose,
  onSaved,
}: {
  target: EditTarget;
  users: UserOption[];
  campaigns: CampaignOption[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const existing = target.mode === 'edit' ? target.service : null;
  const [state, setState] = useState<BuilderState>(() => toBuilderState(existing));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const firstInput = useRef<HTMLInputElement>(null);

  // Auto-slugify from name until the admin touches the slug field.
  useEffect(() => {
    if (state.slugTouched) return;
    const auto = state.name
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
    setState((s) => (s.slug === auto ? s : { ...s, slug: auto }));
  }, [state.name, state.slugTouched]);

  useEffect(() => {
    firstInput.current?.focus();
  }, []);

  const update = useCallback(<K extends keyof BuilderState>(key: K, value: BuilderState[K]) => {
    setState((prev) => ({ ...prev, [key]: value }));
  }, []);

  const applyPreset = useCallback((preset: IntegrationServicePreset) => {
    setState((prev) => {
      const next: BuilderState = { ...prev, preset };
      if (preset === 'bonzo') {
        next.method = 'POST_JSON';
        next.statusTrigger = prev.statusTrigger === 'MANUAL' ? 'ON_ASSIGN' : prev.statusTrigger;
        next.requiresAssignedUser = true;
        next.allowManualSend = true;
        if (!prev.urlTemplate) {
          next.urlTemplate = '{{user.credentials.bonzoWebhookUrl}}';
        }
        if (!prev.headersTemplate) {
          next.headersTemplate = 'User-Agent: FFL-Portal/1.0 (+lead-distribution)';
        }
        if (!prev.bodyTemplate) {
          // Mirror of src/lib/bonzoForward.ts > buildBonzoPayload so manual
          // pushes and the auto-on-assign forwarder send the same body.
          // Keep these keys in sync with Bonzo's "Create Prospect" schema.
          next.bodyTemplate = [
            '{',
            '  "lead_id": "{{lead.id}}",',
            '  "lead_source": "{{campaign.name}}",',
            '  "application_date": "{{now.date}}",',
            '  "1_Status": "{{lead.status}}",',
            '  "first_name": "{{lead.firstName}}",',
            '  "last_name": "{{lead.lastName}}",',
            '  "email": "{{lead.email}}",',
            '  "phone": "{{lead.phone}}",',
            '  "work_phone": "{{lead.workPhone}}",',
            '  "birthday": "{{lead.dob}}",',
            '  "ssn": "{{lead.ssn}}",',
            '  "address": "{{lead.mailingAddress}}",',
            '  "city": "{{lead.mailingCity}}",',
            '  "state": "{{lead.mailingState}}",',
            '  "zip": "{{lead.mailingZip}}",',
            '  "property_address": "{{lead.propertyAddress}}",',
            '  "property_city": "{{lead.propertyCity}}",',
            '  "property_state": "{{lead.propertyState}}",',
            '  "property_zip": "{{lead.propertyZip}}",',
            '  "property_county": "{{lead.propertyCounty}}",',
            '  "property_type": "{{lead.propertyType}}",',
            '  "property_use": "{{lead.propertyUse}}",',
            '  "property_value": "{{lead.propertyValue}}",',
            '  "purchase_price": "{{lead.purchasePrice}}",',
            '  "loan_purpose": "{{lead.loanPurpose}}",',
            '  "loan_amount": "{{lead.loanAmount}}",',
            '  "loan_type": "{{lead.loanType}}",',
            '  "loan_program": "{{lead.loanTerm}}",',
            '  "loan_balance": "{{lead.currentBalance}}",',
            '  "interest_rate": "{{lead.currentRate}}",',
            '  "down_payment": "{{lead.downPayment}}",',
            '  "cash_out_amount": "{{lead.cashOut}}",',
            '  "credit_score": "{{lead.creditRating}}",',
            '  "bankruptcy_details": "{{lead.bankruptcy}}",',
            '  "foreclosure_details": "{{lead.foreclosure}}",',
            '  "custom_ismilitary": "{{lead.isMilitary}}",',
            '  "custom_veteran": "{{lead.vaStatus}}",',
            '  "prospect_company": "{{lead.employer}}",',
            '  "company_name": "{{lead.employer}}",',
            '  "occupation": "{{lead.jobTitle}}",',
            '  "income": "{{lead.income}}",',
            '  "household_income": "{{lead.income}}",',
            '  "co_first_name": "{{lead.coFirstName}}",',
            '  "co_last_name": "{{lead.coLastName}}",',
            '  "co_email": "{{lead.coEmail}}",',
            '  "co_phone": "{{lead.coPhone}}",',
            '  "co_birthday": "{{lead.coDob}}"',
            '}',
          ].join('\n');
        }
        if (prev.credentialFields.length === 0) {
          next.credentialFields = [
            {
              key: 'bonzoWebhookUrl',
              label: 'Bonzo Webhook URL',
              required: true,
              secret: false,
              placeholder: 'https://app.getbonzo.com/webhook/...',
              helpText: 'Per-user Bonzo inbound webhook URL.',
              sortOrder: 0,
            },
          ];
        }
      } else if (preset === 'webhook') {
        // Generic JSON webhook that works against any inbound endpoint.
        next.method = 'POST_JSON';
        next.allowManualSend = true;
        next.requiresAssignedUser = false;
        if (!prev.urlTemplate) {
          next.urlTemplate = '{{user.credentials.webhookUrl}}';
        }
        if (!prev.bodyTemplate) {
          next.bodyTemplate = [
            '{',
            '  "leadId": "{{lead.id}}",',
            '  "firstName": "{{lead.firstName}}",',
            '  "lastName": "{{lead.lastName}}",',
            '  "email": "{{lead.email}}",',
            '  "phone": "{{lead.phone}}",',
            '  "state": "{{lead.propertyState}}",',
            '  "campaign": "{{campaign.name}}",',
            '  "assignedUser": "{{user.name}}",',
            '  "receivedAt": "{{now.iso}}"',
            '}',
          ].join('\n');
        }
        if (prev.credentialFields.length === 0) {
          next.credentialFields = [
            {
              key: 'webhookUrl',
              label: 'Webhook URL',
              required: true,
              secret: false,
              placeholder: 'https://example.com/hooks/leads',
              helpText: 'Per-user destination URL for this webhook.',
              sortOrder: 0,
            },
          ];
        }
      } else if (preset === 'zapier') {
        // Zapier "Catch Hook" triggers — POST JSON, per-user URL.
        next.method = 'POST_JSON';
        next.allowManualSend = true;
        next.requiresAssignedUser = true;
        if (!prev.urlTemplate) {
          next.urlTemplate = '{{user.credentials.zapierHookUrl}}';
        }
        if (!prev.bodyTemplate) {
          next.bodyTemplate = [
            '{',
            '  "lead_id": "{{lead.id}}",',
            '  "first_name": "{{lead.firstName}}",',
            '  "last_name": "{{lead.lastName}}",',
            '  "email": "{{lead.email}}",',
            '  "phone": "{{lead.phone}}",',
            '  "loan_amount": "{{lead.loanAmount}}",',
            '  "loan_purpose": "{{lead.loanPurpose}}",',
            '  "property_state": "{{lead.propertyState}}",',
            '  "campaign": "{{campaign.name}}",',
            '  "vendor": "{{vendor.name}}",',
            '  "assigned_user": "{{user.name}}",',
            '  "assigned_email": "{{user.email}}"',
            '}',
          ].join('\n');
        }
        if (prev.credentialFields.length === 0) {
          next.credentialFields = [
            {
              key: 'zapierHookUrl',
              label: 'Zapier Catch Hook URL',
              required: true,
              secret: false,
              placeholder: 'https://hooks.zapier.com/hooks/catch/...',
              helpText: 'Per-user Zapier Catch Hook URL.',
              sortOrder: 0,
            },
          ];
        }
      } else if (preset === 'soap') {
        // SOAP envelope skeleton — admins override the action + body.
        next.method = 'POST_XML_SOAP';
        next.allowManualSend = true;
        if (!prev.headersTemplate) {
          next.headersTemplate = [
            'SOAPAction: "{{user.credentials.soapAction}}"',
            'Accept: text/xml',
          ].join('\n');
        }
        if (!prev.bodyTemplate) {
          next.bodyTemplate = [
            '<?xml version="1.0" encoding="utf-8"?>',
            '<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">',
            '  <soap:Body>',
            '    <SubmitLead xmlns="{{user.credentials.soapNamespace}}">',
            '      <FirstName>{{lead.firstName}}</FirstName>',
            '      <LastName>{{lead.lastName}}</LastName>',
            '      <Email>{{lead.email}}</Email>',
            '      <Phone>{{lead.phone}}</Phone>',
            '    </SubmitLead>',
            '  </soap:Body>',
            '</soap:Envelope>',
          ].join('\n');
        }
        if (prev.credentialFields.length === 0) {
          next.credentialFields = [
            {
              key: 'soapEndpointUrl',
              label: 'SOAP Endpoint URL',
              required: true,
              secret: false,
              placeholder: 'https://example.com/soap/leads',
              helpText: 'Per-user SOAP endpoint URL.',
              sortOrder: 0,
            },
            {
              key: 'soapAction',
              label: 'SOAPAction',
              required: true,
              secret: false,
              placeholder: 'http://example.com/SubmitLead',
              helpText: 'Value sent in the SOAPAction request header.',
              sortOrder: 1,
            },
            {
              key: 'soapNamespace',
              label: 'SOAP Namespace',
              required: false,
              secret: false,
              placeholder: 'http://example.com/leads',
              helpText: 'Target namespace for the request envelope.',
              sortOrder: 2,
            },
          ];
        }
        if (!prev.urlTemplate) {
          next.urlTemplate = '{{user.credentials.soapEndpointUrl}}';
        }
      }
      return next;
    });
  }, []);

  const credentialKeys = useMemo(
    () => state.credentialFields.map((f) => f.key.trim()).filter(Boolean),
    [state.credentialFields]
  );

  const tokens = useMemo(() => listAvailableTokens({ credentialKeys }), [credentialKeys]);

  const handleSave = useCallback(async () => {
    setError(null);
    const payload = toSubmitPayload(state);
    if (!payload.name) {
      setError('Service name is required.');
      return;
    }
    if (!payload.urlTemplate?.trim()) {
      setError('URL template is required.');
      return;
    }
    // Basic JSON sanity check for JSON bodies — renders may still have
    // tokens that make JSON.parse fail, so we only warn on obviously
    // malformed templates (no tokens but unparseable).
    if (payload.method === 'POST_JSON' || payload.method === 'PUT_JSON') {
      const body = payload.bodyTemplate ?? '';
      const hasTokens = /\{\{|\{[a-zA-Z_]/.test(body);
      if (body.trim() && !hasTokens) {
        try {
          JSON.parse(body);
        } catch {
          setError('Body template is JSON but not valid JSON.');
          return;
        }
      }
    }
    if (
      payload.requiresOAuth &&
      (!payload.oauthConfig?.tokenUrl || !payload.oauthConfig?.clientId || !payload.oauthConfig?.clientSecret)
    ) {
      setError('Requires OAuth is on but tokenUrl/clientId/clientSecret are not all set.');
      return;
    }
    // Capture fields: require both columns or drop the row; the server also
    // filters incomplete rows but we warn early.
    for (const cf of state.captureFields) {
      if ((cf.path && !cf.target) || (!cf.path && cf.target)) {
        setError('Capture field rows need both a response path and a target.');
        return;
      }
    }

    // Credential field key uniqueness
    const keys = new Set<string>();
    for (const cf of state.credentialFields) {
      const k = cf.key.trim();
      if (!k) continue;
      if (keys.has(k)) {
        setError(`Duplicate credential key "${k}".`);
        return;
      }
      keys.add(k);
    }

    setSaving(true);
    try {
      if (target.mode === 'create') {
        await createIntegrationService(payload);
      } else {
        await updateIntegrationService(target.service.id, payload);
      }
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  }, [onSaved, state, target]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-stretch justify-center overflow-y-auto"
      onClick={onClose}
    >
      <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm" />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={target.mode === 'create' ? 'Create service' : 'Edit service'}
        className="relative my-4 flex w-full max-w-5xl flex-col rounded-xl border border-slate-200 bg-white shadow-2xl max-h-[calc(100vh-2rem)]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-4 border-b border-slate-200 px-6 py-4">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-indigo-100 text-indigo-700">
                <Zap className="h-4 w-4" />
              </div>
              <h2 className="text-lg font-semibold text-slate-900">
                {target.mode === 'create' ? 'New Integration Service' : `Edit: ${existing?.name}`}
              </h2>
            </div>
            <p className="mt-1 text-sm text-slate-500">
              Configure how this service pushes leads out. Every field below
              supports merge fields like{' '}
              <code className="rounded bg-slate-100 px-1 py-0.5 text-xs font-mono text-slate-700">
                {'{{lead.firstName}}'}
              </code>
              .
            </p>
          </div>
          <button className="app-icon-btn" onClick={onClose} aria-label="Close">
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 min-h-0 overflow-y-auto px-6 py-5 space-y-6">
          <HeaderSection
            state={state}
            update={update}
            applyPreset={applyPreset}
            nameRef={firstInput}
            lockedSlug={target.mode === 'edit'}
          />
          <UrlPayloadSection state={state} update={update} tokens={tokens} />
          <HeadersSection state={state} update={update} tokens={tokens} />
          <OptionsSection
            state={state}
            update={update}
            users={users}
            campaigns={campaigns}
          />
          <AdvancedSection state={state} update={update} tokens={tokens} />
          <CredentialsSection state={state} update={update} />
        </div>

        {/* Footer */}
        <div className="border-t border-slate-200 bg-slate-50 px-6 py-3">
          {error && (
            <div className="mb-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700 flex items-start gap-2">
              <AlertTriangle className="h-4 w-4 mt-0.5 flex-shrink-0" />
              <span>{error}</span>
            </div>
          )}
          <div className="flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="app-btn-secondary"
              disabled={saving}
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => void handleSave()}
              disabled={saving || !state.name.trim()}
              className="app-btn-primary disabled:opacity-60"
            >
              {saving ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Save className="h-4 w-4" />
              )}
              {target.mode === 'create' ? 'Create service' : 'Save changes'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Section: Header (preset, name, slug, description, status, type, trigger)
// ---------------------------------------------------------------------------

function HeaderSection({
  state,
  update,
  applyPreset,
  nameRef,
  lockedSlug,
}: {
  state: BuilderState;
  update: <K extends keyof BuilderState>(key: K, value: BuilderState[K]) => void;
  applyPreset: (preset: IntegrationServicePreset) => void;
  nameRef: React.RefObject<HTMLInputElement | null>;
  lockedSlug: boolean;
}) {
  return (
    <Section title="Basics" subtitle="Identity, status, and when this service fires.">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <LabeledSelect
          label="Preset"
          help="Pick a preset to prefill typical defaults. Custom keeps everything blank."
          value={state.preset}
          onChange={(v) => applyPreset(v as IntegrationServicePreset)}
          options={INTEGRATION_SERVICE_PRESETS.map((p) => ({
            value: p,
            label:
              p === 'custom'
                ? 'Custom'
                : p === 'soap'
                  ? 'SOAP / XML'
                  : p === 'zapier'
                    ? 'Zapier'
                    : p === 'webhook'
                      ? 'Generic Webhook'
                      : p[0].toUpperCase() + p.slice(1),
          }))}
        />
        <Toggle
          label="Enabled"
          help="Disabled services are hidden everywhere; historical dispatches remain visible."
          value={state.active}
          onChange={(v) => update('active', v)}
        />
        <LabeledSelect
          label="Type"
          help="Client services can fire from LO-visible actions; Server-only services are hidden from non-admin views."
          value={state.kind}
          onChange={(v) => update('kind', v as IntegrationServiceKind)}
          options={KIND_OPTIONS.map((o) => ({ value: o.value, label: o.label }))}
        />
        <LabeledInput
          label="Name *"
          help="Shown in the Push to Service picker and the Lead Users editor."
          value={state.name}
          onChange={(v) => update('name', v)}
          inputRef={nameRef}
          placeholder="Bonzo"
        />
        <LabeledInput
          label="Slug *"
          help="Stable machine name. Auto-generated from the name; slug is locked after create."
          value={state.slug}
          disabled={lockedSlug}
          mono
          onChange={(v) => {
            update('slugTouched', true);
            update('slug', v);
          }}
          placeholder="bonzo"
        />
        <LabeledInput
          label="Description"
          value={state.description}
          onChange={(v) => update('description', v)}
          placeholder="Forward leads to the assigned LO's Bonzo account."
        />
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <LabeledSelect
          label="Status trigger"
          help="Controls which event fires this service for a lead."
          value={state.statusTrigger}
          onChange={(v) => update('statusTrigger', v as IntegrationServiceTrigger)}
          options={TRIGGER_OPTIONS.map((t) => ({ value: t.value, label: t.label }))}
        />
        {state.statusTrigger === 'ON_STATUS_CHANGE' && (
          <LabeledSelect
            label="On status"
            help="Only run when a lead transitions into this status."
            value={state.triggerStatus}
            onChange={(v) => update('triggerStatus', v)}
            options={[
              { value: '', label: 'Any status change' },
              ...LEAD_STATUS_VALUES.map((s) => ({ value: s, label: s })),
            ]}
          />
        )}
        {(state.statusTrigger === 'DELAY_AFTER_RECEIVE' ||
          state.statusTrigger === 'DELAY_AFTER_ASSIGN') && (
          <div className="flex gap-2">
            <LabeledInput
              label="Delay (days)"
              value={state.triggerDay}
              onChange={(v) => update('triggerDay', v)}
              type="number"
              placeholder="0"
            />
            <LabeledInput
              label="+ minutes"
              value={state.triggerDelayMinutes}
              onChange={(v) => update('triggerDelayMinutes', v)}
              type="number"
              placeholder="15"
            />
          </div>
        )}
      </div>
    </Section>
  );
}

// ---------------------------------------------------------------------------
// Section: URL + Payload
// ---------------------------------------------------------------------------

function UrlPayloadSection({
  state,
  update,
  tokens,
}: {
  state: BuilderState;
  update: <K extends keyof BuilderState>(key: K, value: BuilderState[K]) => void;
  tokens: TokenSpec[];
}) {
  const urlRef = useRef<HTMLTextAreaElement>(null);
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const showBody = state.method !== 'GET';

  return (
    <Section
      title="URL & Payload"
      subtitle="The HTTP method, destination URL, and request body. Use merge fields to template per-lead values."
    >
      <div className="space-y-4">
        <LabeledSelect
          label="Content type / method"
          value={state.method}
          onChange={(v) => update('method', v as IntegrationServiceMethod)}
          options={METHOD_OPTIONS}
        />

        <div className="space-y-1.5">
          <div className="flex items-center justify-between gap-2">
            <label className="text-sm font-medium text-slate-700">URL *</label>
            <TokenPicker
              tokens={tokens}
              onInsert={(t) => insertAtCursor(urlRef.current, t, (next) => update('urlTemplate', next))}
            />
          </div>
          <textarea
            ref={urlRef}
            className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-mono focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
            rows={2}
            value={state.urlTemplate}
            onChange={(e) => update('urlTemplate', e.target.value)}
            placeholder="https://api.example.com/leads/{{lead.vendorLeadId}}"
          />
          <HelpText>
            Single-brace tokens like <code>{'{firstname}'}</code> from Lead
            Mailbox templates also work.
          </HelpText>
        </div>

        {showBody && (
          <div className="space-y-1.5">
            <div className="flex items-center justify-between gap-2">
              <label className="text-sm font-medium text-slate-700">
                Body / content
              </label>
              <TokenPicker
                tokens={tokens}
                onInsert={(t) => insertAtCursor(bodyRef.current, t, (next) => update('bodyTemplate', next))}
              />
            </div>
            <textarea
              ref={bodyRef}
              className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-mono focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
              rows={10}
              value={state.bodyTemplate}
              onChange={(e) => update('bodyTemplate', e.target.value)}
              placeholder={bodyPlaceholderFor(state.method)}
            />
            <HelpText>{bodyHelpFor(state.method)}</HelpText>
          </div>
        )}
      </div>
    </Section>
  );
}

function bodyPlaceholderFor(method: IntegrationServiceMethod): string {
  if (method === 'POST_JSON' || method === 'PUT_JSON')
    return '{\n  "first_name": "{{lead.firstName}}",\n  "email": "{{lead.email}}"\n}';
  if (method === 'POST_FORM')
    return 'first_name={{lead.firstName}}&email={{lead.email}}';
  if (method === 'POST_XML' || method === 'POST_XML_TEXT')
    return '<Lead>\n  <FirstName>{{lead.firstName}}</FirstName>\n</Lead>';
  if (method === 'POST_XML_SOAP')
    return '<?xml version="1.0"?>\n<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">\n  <soap:Body>\n    <!-- request here -->\n  </soap:Body>\n</soap:Envelope>';
  return '';
}

function bodyHelpFor(method: IntegrationServiceMethod): string {
  if (method === 'POST_JSON' || method === 'PUT_JSON')
    return 'Must parse as JSON after tokens are substituted.';
  if (method === 'POST_FORM')
    return 'Accepts either a JSON object (we encode it) or a raw k=v&a=b body.';
  if (method === 'POST_XML_SOAP')
    return 'Add a SOAPAction header if the remote service requires one (empty string sent by default).';
  return 'Free-form content sent verbatim after tokens are substituted.';
}

// ---------------------------------------------------------------------------
// Section: Headers
// ---------------------------------------------------------------------------

function HeadersSection({
  state,
  update,
  tokens,
}: {
  state: BuilderState;
  update: <K extends keyof BuilderState>(key: K, value: BuilderState[K]) => void;
  tokens: TokenSpec[];
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  return (
    <Section
      title="Headers"
      subtitle="One header per line, like an HTTP message. Tokens are expanded at send time."
    >
      <div className="space-y-1.5">
        <div className="flex items-center justify-between gap-2">
          <label className="text-sm font-medium text-slate-700">
            Request headers
          </label>
          <TokenPicker
            tokens={tokens}
            onInsert={(t) =>
              insertAtCursor(ref.current, t, (next) => update('headersTemplate', next))
            }
          />
        </div>
        <textarea
          ref={ref}
          className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-mono focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
          rows={5}
          value={state.headersTemplate}
          onChange={(e) => update('headersTemplate', e.target.value)}
          placeholder={'Authorization: Bearer {{user.credentials.apiKey}}\nX-Client: FFL Portal'}
        />
        <HelpText>
          Content-Type is set automatically based on the method above. Override
          it here if the remote service wants something specific.
        </HelpText>
      </div>
    </Section>
  );
}

// ---------------------------------------------------------------------------
// Section: Options (user + campaign targeting)
// ---------------------------------------------------------------------------

function OptionsSection({
  state,
  update,
  users,
  campaigns,
}: {
  state: BuilderState;
  update: <K extends keyof BuilderState>(key: K, value: BuilderState[K]) => void;
  users: UserOption[];
  campaigns: CampaignOption[];
}) {
  return (
    <Section
      title="Targeting"
      subtitle="Narrow which leads this service applies to. Leave set to Any to run for everyone."
    >
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="rounded-xl border border-slate-200 bg-slate-50/50 p-4">
          <LabeledSelect
            label="Users"
            value={state.userScope}
            onChange={(v) => update('userScope', v as IntegrationServiceScope)}
            options={[
              { value: 'ANY', label: 'Any assigned LO' },
              { value: 'SPECIFIC', label: 'Only selected users' },
            ]}
          />
          {state.userScope === 'SPECIFIC' && (
            <MultiCheckboxList
              className="mt-3"
              options={users.map((u) => ({ value: u.id, label: u.name }))}
              selected={state.userIds}
              onChange={(next) => update('userIds', next)}
              emptyLabel="No eligible LOs found."
            />
          )}
        </div>

        <div className="rounded-xl border border-slate-200 bg-slate-50/50 p-4">
          <LabeledSelect
            label="Campaigns"
            value={state.campaignScope}
            onChange={(v) => update('campaignScope', v as IntegrationServiceScope)}
            options={[
              { value: 'ANY', label: 'Any campaign' },
              { value: 'SPECIFIC', label: 'Only selected campaigns' },
            ]}
          />
          {state.campaignScope === 'SPECIFIC' && (
            <MultiCheckboxList
              className="mt-3"
              options={campaigns.map((c) => ({ value: c.id, label: c.name }))}
              selected={state.campaignIds}
              onChange={(next) => update('campaignIds', next)}
              emptyLabel="No campaigns found."
            />
          )}
        </div>
      </div>

      <div className="mt-3">
        <Toggle
          label="Exclude selected"
          help="When on, the user/campaign pickers above act as a blocklist rather than an allowlist."
          value={state.excludeSelected}
          onChange={(v) => update('excludeSelected', v)}
        />
      </div>
    </Section>
  );
}

// ---------------------------------------------------------------------------
// Section: Advanced (success string, fail email, capture, flags)
// ---------------------------------------------------------------------------

function AdvancedSection({
  state,
  update,
  tokens,
}: {
  state: BuilderState;
  update: <K extends keyof BuilderState>(key: K, value: BuilderState[K]) => void;
  tokens: TokenSpec[];
}) {
  return (
    <Section
      title="Advanced"
      subtitle="Success validation, fail notifications, capture-back, and gating flags."
    >
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <LabeledInput
          label="Success string"
          help="If set, the response body must contain this substring or the push is marked failed."
          value={state.successString}
          onChange={(v) => update('successString', v)}
          placeholder="success"
        />
        <LabeledInput
          label="Fail Notify email"
          help="We email this address when the service errors (HTTP or success-string mismatch)."
          value={state.failNotifyEmail}
          onChange={(v) => update('failNotifyEmail', v)}
          type="email"
          placeholder="ops@example.com"
        />
        <LabeledSelect
          label="Date override"
          help="Choose which Lead date column the {{createddash}} Lead Mailbox token binds to."
          value={state.dateOverride}
          onChange={(v) => update('dateOverride', v)}
          options={DATE_OVERRIDE_OPTIONS}
        />
      </div>

      <CaptureFieldsEditor
        value={state.captureFields}
        onChange={(next) => update('captureFields', next)}
      />

      <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
        <Toggle
          label="Requires brand-new lead"
          help="Only dispatch the very first time this lead is seen (NEW status, no prior dispatches)."
          value={state.requiresBrandNew}
          onChange={(v) => update('requiresBrandNew', v)}
        />
        <Toggle
          label="Requires NOT brand-new"
          help="Skip leads still in NEW status."
          value={state.requiresNotBrandNew}
          onChange={(v) => update('requiresNotBrandNew', v)}
        />
        <Toggle
          label="Requires assigned LO"
          help="Skip unassigned leads. Required for services that reference {{user.*}}."
          value={state.requiresAssignedUser}
          onChange={(v) => update('requiresAssignedUser', v)}
        />
        <Toggle
          label="Requires OAuth"
          help="Fetch a bearer token from the token endpoint before calling the service."
          value={state.requiresOAuth}
          onChange={(v) => update('requiresOAuth', v)}
        />
        <Toggle
          label="Allow manual send"
          help="Show this service in the Push to Service button on the Leads screen."
          value={state.allowManualSend}
          onChange={(v) => update('allowManualSend', v)}
        />
      </div>

      {state.requiresOAuth && (
        <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50/50 p-4 space-y-3">
          <h4 className="flex items-center gap-1.5 text-sm font-semibold text-slate-800">
            OAuth configuration
            <InfoDot help="Client-credentials grant is supported out of the box. The acquired bearer token is cached on the service row and refreshed automatically." />
          </h4>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <LabeledInput
              label="Token URL *"
              value={state.oauthConfig.tokenUrl}
              onChange={(v) => update('oauthConfig', { ...state.oauthConfig, tokenUrl: v })}
              placeholder="https://auth.example.com/oauth2/token"
            />
            <LabeledInput
              label="Grant type"
              value={state.oauthConfig.grantType ?? 'client_credentials'}
              onChange={(v) => update('oauthConfig', { ...state.oauthConfig, grantType: v })}
              placeholder="client_credentials"
            />
            <LabeledInput
              label="Client ID *"
              value={state.oauthConfig.clientId}
              onChange={(v) => update('oauthConfig', { ...state.oauthConfig, clientId: v })}
            />
            <LabeledInput
              label="Client secret *"
              value={state.oauthConfig.clientSecret}
              onChange={(v) => update('oauthConfig', { ...state.oauthConfig, clientSecret: v })}
              type="password"
            />
            <LabeledInput
              label="Scope"
              value={state.oauthConfig.scope ?? ''}
              onChange={(v) => update('oauthConfig', { ...state.oauthConfig, scope: v })}
              placeholder="leads:write"
            />
          </div>
        </div>
      )}

      <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50/50 p-3 text-xs text-slate-600">
        <div className="flex items-center gap-1.5 font-semibold text-slate-700">
          <Info className="h-3.5 w-3.5 text-slate-500" /> Available merge
          fields
        </div>
        <div className="mt-2 flex flex-wrap gap-1">
          {tokens.slice(0, 40).map((t) => (
            <code
              key={t.token}
              className="rounded bg-white border border-slate-200 px-1.5 py-0.5 font-mono text-[11px] text-slate-700"
              title={t.description}
            >
              {t.token}
            </code>
          ))}
          {tokens.length > 40 && (
            <span className="text-slate-500 text-xs">
              …and {tokens.length - 40} more (use the Insert merge field menu
              above each input).
            </span>
          )}
        </div>
      </div>
    </Section>
  );
}

function CaptureFieldsEditor({
  value,
  onChange,
}: {
  value: IntegrationServiceCaptureField[];
  onChange: (next: IntegrationServiceCaptureField[]) => void;
}) {
  const add = () => onChange([...value, { path: '', target: '' }]);
  const remove = (idx: number) => onChange(value.filter((_, i) => i !== idx));
  const patch = (idx: number, next: Partial<IntegrationServiceCaptureField>) =>
    onChange(value.map((row, i) => (i === idx ? { ...row, ...next } : row)));

  return (
    <div className="mt-5">
      <div className="flex items-center justify-between">
        <label className="text-sm font-medium text-slate-700 flex items-center gap-1.5">
          Capture fields
          <InfoDot help="Pull values out of the service response and write them back to the Lead. JSONPath-ish paths like result.user.id are supported." />
        </label>
        <button
          type="button"
          onClick={add}
          className="app-btn-secondary text-xs"
        >
          <Plus className="h-3.5 w-3.5" />
          Add capture
        </button>
      </div>
      {value.length === 0 ? (
        <p className="mt-1 text-xs text-slate-400">
          No capture fields configured. Leave empty if the service doesn&apos;t
          return anything you need to save.
        </p>
      ) : (
        <div className="mt-2 space-y-2">
          {value.map((row, idx) => (
            <div
              key={idx}
              className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white p-2"
            >
              <input
                className="flex-1 rounded-md border border-slate-200 bg-white px-2 py-1.5 text-xs font-mono focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                value={row.path}
                onChange={(e) => patch(idx, { path: e.target.value })}
                placeholder="response.path.to.field"
              />
              <span className="text-slate-400 text-xs">→</span>
              <select
                className="flex-1 rounded-md border border-slate-200 bg-white px-2 py-1.5 text-xs focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                value={CAPTURE_FIELD_TARGETS.some((t) => t.value === row.target) ? row.target : 'customData.*'}
                onChange={(e) => {
                  const v = e.target.value;
                  if (v === 'customData.*') {
                    patch(idx, { target: 'customData.' });
                  } else {
                    patch(idx, { target: v });
                  }
                }}
              >
                {CAPTURE_FIELD_TARGETS.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                  </option>
                ))}
              </select>
              {row.target.startsWith('customData.') && (
                <input
                  className="w-40 rounded-md border border-slate-200 bg-white px-2 py-1.5 text-xs font-mono focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                  value={row.target.slice('customData.'.length)}
                  onChange={(e) =>
                    patch(idx, { target: `customData.${e.target.value}` })
                  }
                  placeholder="myCustomKey"
                />
              )}
              <button
                type="button"
                className="app-icon-btn app-icon-btn-danger"
                onClick={() => remove(idx)}
                aria-label="Remove"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Section: Credentials
// ---------------------------------------------------------------------------

function CredentialsSection({
  state,
  update,
}: {
  state: BuilderState;
  update: <K extends keyof BuilderState>(key: K, value: BuilderState[K]) => void;
}) {
  const add = () =>
    update('credentialFields', [
      ...state.credentialFields,
      {
        key: '',
        label: '',
        required: false,
        secret: false,
        placeholder: '',
        helpText: '',
        sortOrder: state.credentialFields.length,
      },
    ]);
  const remove = (idx: number) =>
    update(
      'credentialFields',
      state.credentialFields.filter((_, i) => i !== idx)
    );
  const patch = (idx: number, next: Partial<BuilderState['credentialFields'][number]>) =>
    update(
      'credentialFields',
      state.credentialFields.map((row, i) => (i === idx ? { ...row, ...next } : row))
    );

  return (
    <Section
      title="Per-user credentials"
      subtitle="Fields each LO fills in on their Lead Users row. Reference them in templates as {{user.credentials.KEY}}."
    >
      <div className="space-y-2">
        {state.credentialFields.length === 0 ? (
          <p className="text-sm text-slate-400">
            No credential fields. Add one for each piece of per-LO info this
            service needs (API key, webhook URL, etc.).
          </p>
        ) : (
          state.credentialFields.map((row, idx) => (
            <div
              key={idx}
              className="grid grid-cols-1 gap-2 rounded-lg border border-slate-200 bg-white p-3 sm:grid-cols-[auto,1fr,1fr,auto,auto,auto]"
            >
              <div className="flex items-center text-slate-400">
                <GripVertical className="h-4 w-4" />
              </div>
              <LabeledInput
                label="Key *"
                mono
                value={row.key}
                onChange={(v) => patch(idx, { key: v })}
                placeholder="apiKey"
              />
              <LabeledInput
                label="Label"
                value={row.label}
                onChange={(v) => patch(idx, { label: v })}
                placeholder="API Key"
              />
              <Toggle
                label="Required"
                value={row.required}
                onChange={(v) => patch(idx, { required: v })}
              />
              <Toggle
                label="Secret"
                value={row.secret}
                onChange={(v) => patch(idx, { secret: v })}
              />
              <button
                type="button"
                className="app-icon-btn app-icon-btn-danger self-center"
                onClick={() => remove(idx)}
                aria-label="Remove credential"
              >
                <Trash2 className="h-4 w-4" />
              </button>
              <div className="sm:col-span-6 grid grid-cols-1 gap-2 sm:grid-cols-2">
                <LabeledInput
                  label="Placeholder"
                  value={row.placeholder ?? ''}
                  onChange={(v) => patch(idx, { placeholder: v })}
                  placeholder="Shown as the input placeholder on the Lead Users row"
                />
                <LabeledInput
                  label="Help text"
                  value={row.helpText ?? ''}
                  onChange={(v) => patch(idx, { helpText: v })}
                  placeholder="Shown beneath the field in the Lead Users row editor"
                />
              </div>
            </div>
          ))
        )}
        <button type="button" className="app-btn-secondary" onClick={add}>
          <Plus className="h-4 w-4" />
          Add credential field
        </button>
      </div>
    </Section>
  );
}

// ---------------------------------------------------------------------------
// Shared UI primitives
// ---------------------------------------------------------------------------

function Section({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-xl border border-slate-200 bg-white shadow-sm">
      <div className="border-b border-slate-200 px-5 py-3">
        <h3 className="text-sm font-semibold text-slate-900">{title}</h3>
        {subtitle && <p className="mt-0.5 text-xs text-slate-500">{subtitle}</p>}
      </div>
      <div className="px-5 py-4">{children}</div>
    </section>
  );
}

function LabeledInput({
  label,
  value,
  onChange,
  placeholder,
  type = 'text',
  disabled,
  mono,
  help,
  inputRef,
}: {
  label: string;
  value: string;
  onChange: (next: string) => void;
  placeholder?: string;
  type?: 'text' | 'email' | 'password' | 'number';
  disabled?: boolean;
  mono?: boolean;
  help?: string;
  inputRef?: React.RefObject<HTMLInputElement | null>;
}) {
  return (
    <label className="space-y-1 block text-sm">
      <span className="flex items-center gap-1 font-medium text-slate-700">
        {label}
        {help && <InfoDot help={help} />}
      </span>
      <input
        ref={inputRef}
        type={type}
        className={`w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 disabled:bg-slate-50 ${
          mono ? 'font-mono' : ''
        }`}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        disabled={disabled}
      />
    </label>
  );
}

function LabeledSelect({
  label,
  value,
  onChange,
  options,
  help,
}: {
  label: string;
  value: string;
  onChange: (next: string) => void;
  options: Array<{ value: string; label: string }>;
  help?: string;
}) {
  return (
    <label className="space-y-1 block text-sm">
      <span className="flex items-center gap-1 font-medium text-slate-700">
        {label}
        {help && <InfoDot help={help} />}
      </span>
      <select
        className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        {options.map((o) => (
          <option key={o.value || 'blank'} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function Toggle({
  label,
  value,
  onChange,
  help,
}: {
  label: string;
  value: boolean;
  onChange: (next: boolean) => void;
  help?: string;
}) {
  return (
    <label className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm cursor-pointer">
      <input
        type="checkbox"
        className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-2 focus:ring-blue-500/30"
        checked={value}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span className="flex items-center gap-1 font-medium text-slate-700">
        {label}
        {help && <InfoDot help={help} />}
      </span>
    </label>
  );
}

function InfoDot({ help }: { help: string }) {
  return (
    <span title={help} className="inline-flex items-center text-slate-400">
      <Info className="h-3.5 w-3.5" />
    </span>
  );
}

function HelpText({ children }: { children: React.ReactNode }) {
  return <p className="text-xs text-slate-400">{children}</p>;
}

function MultiCheckboxList({
  options,
  selected,
  onChange,
  emptyLabel,
  className,
}: {
  options: Array<{ value: string; label: string }>;
  selected: string[];
  onChange: (next: string[]) => void;
  emptyLabel: string;
  className?: string;
}) {
  const toggle = (v: string) => {
    if (selected.includes(v)) {
      onChange(selected.filter((x) => x !== v));
    } else {
      onChange([...selected, v]);
    }
  };
  if (options.length === 0) {
    return <p className={`text-sm text-slate-400 ${className ?? ''}`}>{emptyLabel}</p>;
  }
  return (
    <div
      className={`max-h-48 overflow-y-auto rounded-lg border border-slate-200 bg-white p-2 space-y-1 ${
        className ?? ''
      }`}
    >
      {options.map((o) => {
        const isOn = selected.includes(o.value);
        return (
          <label
            key={o.value}
            className="flex items-center gap-2 rounded px-2 py-1 text-sm hover:bg-slate-50 cursor-pointer"
          >
            <input
              type="checkbox"
              className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-2 focus:ring-blue-500/30"
              checked={isOn}
              onChange={() => toggle(o.value)}
            />
            <span className="truncate text-slate-700">{o.label}</span>
          </label>
        );
      })}
    </div>
  );
}

function TokenPicker({
  tokens,
  onInsert,
}: {
  tokens: TokenSpec[];
  onInsert: (token: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState('');
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener('mousedown', onClick);
    return () => window.removeEventListener('mousedown', onClick);
  }, [open]);

  const grouped = useMemo(() => {
    const f = filter.trim().toLowerCase();
    const out: Record<string, TokenSpec[]> = {};
    for (const t of tokens) {
      if (f && !t.token.toLowerCase().includes(f) && !t.description.toLowerCase().includes(f)) {
        continue;
      }
      out[t.group] = out[t.group] ?? [];
      out[t.group].push(t);
    }
    return out;
  }, [tokens, filter]);

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2 py-1 text-xs font-semibold text-slate-600 hover:bg-slate-50"
        onClick={() => setOpen((v) => !v)}
      >
        Insert merge field
        <ChevronDown className="h-3 w-3" />
      </button>
      {open && (
        <div className="absolute right-0 z-30 mt-1 w-80 max-h-80 overflow-y-auto rounded-lg border border-slate-200 bg-white p-2 shadow-lg">
          <input
            autoFocus
            className="mb-2 w-full rounded-md border border-slate-200 bg-white px-2 py-1 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filter…"
          />
          {Object.keys(grouped).length === 0 && (
            <p className="p-2 text-xs text-slate-400">No tokens match.</p>
          )}
          {Object.entries(grouped).map(([group, items]) => (
            <div key={group} className="mb-2">
              <div className="px-1 text-[10px] font-bold uppercase tracking-wide text-slate-400">
                {group}
              </div>
              <div className="space-y-0.5">
                {items.map((t) => (
                  <button
                    key={t.token}
                    type="button"
                    className="flex w-full flex-col items-start rounded px-2 py-1 text-left hover:bg-slate-50"
                    onClick={() => {
                      onInsert(t.token);
                      setOpen(false);
                    }}
                  >
                    <code className="text-xs font-mono text-slate-800">
                      {t.token}
                    </code>
                    <span className="text-[11px] text-slate-500">
                      {t.description}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function insertAtCursor(
  ta: HTMLTextAreaElement | null,
  insert: string,
  onChange: (next: string) => void
) {
  if (!ta) {
    onChange(insert);
    return;
  }
  const start = ta.selectionStart ?? ta.value.length;
  const end = ta.selectionEnd ?? ta.value.length;
  const next = ta.value.slice(0, start) + insert + ta.value.slice(end);
  onChange(next);
  requestAnimationFrame(() => {
    ta.focus();
    const pos = start + insert.length;
    ta.setSelectionRange(pos, pos);
  });
}

// ---------------------------------------------------------------------------
// Delete dialog (unchanged from the old UI)
// ---------------------------------------------------------------------------

function ServiceDeleteDialog({
  service,
  onClose,
  onDeleted,
}: {
  service: IntegrationServiceSummary;
  onClose: () => void;
  onDeleted: () => void;
}) {
  const [confirmName, setConfirmName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      onClick={onClose}
    >
      <div className="absolute inset-0 bg-slate-900/30 backdrop-blur-sm" />
      <div
        role="dialog"
        aria-modal="true"
        className="relative w-full max-w-md rounded-xl border border-slate-200 bg-white p-6 shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-base font-semibold text-slate-900">
          Permanently delete &ldquo;{service.name}&rdquo;?
        </h3>
        <p className="mt-2 text-sm text-slate-600">
          This cannot be undone. The service, its credential definitions, and
          every user&apos;s per-user values for it will be deleted. Type the
          service name to confirm.
        </p>
        <input
          className="mt-3 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:border-rose-500 focus:outline-none focus:ring-2 focus:ring-rose-500/20"
          value={confirmName}
          onChange={(e) => setConfirmName(e.target.value)}
          placeholder={service.name}
        />
        {error && (
          <div className="mt-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
            {error}
          </div>
        )}
        <div className="mt-5 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="app-btn-secondary"
            disabled={busy}
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={confirmName.trim() !== service.name || busy}
            onClick={async () => {
              setBusy(true);
              setError(null);
              try {
                await deleteIntegrationService(service.id, confirmName.trim());
                onDeleted();
              } catch (err) {
                setError(err instanceof Error ? err.message : 'Delete failed');
              } finally {
                setBusy(false);
              }
            }}
            className="app-btn-danger disabled:opacity-60"
          >
            {busy ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <>
                <Trash2 className="h-4 w-4" />
                Delete permanently
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function prettyTrigger(t: IntegrationServiceTrigger): string {
  switch (t) {
    case 'MANUAL':
      return 'Manual';
    case 'ON_RECEIVE':
      return 'On receive';
    case 'ON_ASSIGN':
      return 'On assign';
    case 'ON_STATUS_CHANGE':
      return 'On status change';
    case 'DELAY_AFTER_RECEIVE':
      return 'Delayed (after receive)';
    case 'DELAY_AFTER_ASSIGN':
      return 'Delayed (after assign)';
  }
}

function prettyMethod(m: IntegrationServiceMethod): string {
  switch (m) {
    case 'GET':
      return 'GET';
    case 'POST_TEXT':
      return 'POST · text';
    case 'POST_FORM':
      return 'POST · form';
    case 'POST_JSON':
      return 'POST · JSON';
    case 'POST_XML':
      return 'POST · XML';
    case 'POST_XML_TEXT':
      return 'POST · XML (text)';
    case 'POST_XML_SOAP':
      return 'POST · SOAP';
    case 'PUT_JSON':
      return 'PUT · JSON';
  }
}

function renderScopeSummary(
  s: IntegrationServiceSummary,
  _users: UserOption[],
  _campaigns: CampaignOption[]
): React.ReactNode {
  const parts: string[] = [];
  if (s.userScope === 'SPECIFIC') {
    parts.push(`${s.excludeSelected ? 'Excl.' : 'Only'} ${s.userIds.length} LO${s.userIds.length === 1 ? '' : 's'}`);
  }
  if (s.campaignScope === 'SPECIFIC') {
    parts.push(`${s.excludeSelected ? 'Excl.' : 'Only'} ${s.campaignIds.length} campaign${s.campaignIds.length === 1 ? '' : 's'}`);
  }
  if (parts.length === 0) return <span className="text-slate-400">Any</span>;
  return parts.join(', ');
}
