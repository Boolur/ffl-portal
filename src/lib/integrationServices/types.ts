/**
 * Shared types + allow-list for the Integration Service builder.
 *
 * Lives outside `src/app/actions/leadActions.ts` because that file is marked
 * `"use server"`, which forbids non-async value exports. Importing this
 * module from either server actions or client components is safe.
 *
 * The service builder replaces the earlier hard-coded handler registry —
 * every HTTP integration is now configured through the admin UI (URL,
 * method, headers, body template, etc.). Legacy `type` strings are kept
 * only so UI presets can pre-fill sensible defaults (e.g. "Bonzo").
 */

import type {
  IntegrationServiceKind,
  IntegrationServiceMethod,
  IntegrationServiceScope,
  IntegrationServiceTrigger,
} from '@prisma/client';

/**
 * Preset identifiers the admin UI exposes in the "Service" dropdown. Each
 * preset pre-fills the builder form with sensible defaults — picking a
 * preset never locks the admin in; after choosing, they can edit any
 * field. `custom` is the blank-slate option.
 */
export const INTEGRATION_SERVICE_PRESETS = [
  'custom',
  'bonzo',
  'webhook',
  'zapier',
  'soap',
] as const;
export type IntegrationServicePreset =
  (typeof INTEGRATION_SERVICE_PRESETS)[number];

/**
 * Kept for backwards compatibility with the Phase-0 code paths that stored
 * a `type` slug on the service. New services default to `"custom"` but
 * existing Bonzo rows keep their `"bonzo"` type until fully migrated.
 */
export const INTEGRATION_SERVICE_TYPES = [
  'bonzo',
  'custom',
  'webhook',
] as const;
export type IntegrationServiceType = (typeof INTEGRATION_SERVICE_TYPES)[number];

// ---------------------------------------------------------------------------
// Canonical "summary" shape returned to the admin UI.
// ---------------------------------------------------------------------------

export type IntegrationServiceCredentialFieldDTO = {
  id: string;
  serviceId: string;
  key: string;
  label: string;
  required: boolean;
  secret: boolean;
  placeholder: string | null;
  helpText: string | null;
  sortOrder: number;
};

export type IntegrationServiceCaptureField = {
  path: string;
  target: string;
};

export type IntegrationServiceOAuthConfig = {
  tokenUrl: string;
  clientId: string;
  clientSecret: string;
  scope?: string;
  grantType?: string;
  accessToken?: string;
  expiresAt?: string;
};

export type IntegrationServiceSummary = {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  type: string;
  active: boolean;
  config: unknown;

  kind: IntegrationServiceKind;
  statusTrigger: IntegrationServiceTrigger;
  triggerStatus: string | null;
  triggerDay: number | null;
  triggerDelayMinutes: number | null;

  method: IntegrationServiceMethod;
  urlTemplate: string;
  bodyTemplate: string;
  headersTemplate: string;

  userScope: IntegrationServiceScope;
  userIds: string[];
  campaignScope: IntegrationServiceScope;
  campaignIds: string[];
  excludeSelected: boolean;

  successString: string | null;
  failNotifyEmail: string | null;
  dateOverride: string | null;
  captureFields: IntegrationServiceCaptureField[];

  requiresBrandNew: boolean;
  requiresNotBrandNew: boolean;
  requiresAssignedUser: boolean;
  requiresOAuth: boolean;
  allowManualSend: boolean;

  oauthConfig: IntegrationServiceOAuthConfig | null;
  credentialFields: IntegrationServiceCredentialFieldDTO[];

  createdAt: Date;
  updatedAt: Date;
};

// ---------------------------------------------------------------------------
// Input shape for create / update
// ---------------------------------------------------------------------------

export type IntegrationServiceInput = {
  name: string;
  slug?: string;
  description?: string | null;
  type?: string;
  active?: boolean;

  kind?: IntegrationServiceKind;
  statusTrigger?: IntegrationServiceTrigger;
  triggerStatus?: string | null;
  triggerDay?: number | null;
  triggerDelayMinutes?: number | null;

  method?: IntegrationServiceMethod;
  urlTemplate?: string;
  bodyTemplate?: string;
  headersTemplate?: string;

  userScope?: IntegrationServiceScope;
  userIds?: string[];
  campaignScope?: IntegrationServiceScope;
  campaignIds?: string[];
  excludeSelected?: boolean;

  successString?: string | null;
  failNotifyEmail?: string | null;
  dateOverride?: string | null;
  captureFields?: IntegrationServiceCaptureField[];

  requiresBrandNew?: boolean;
  requiresNotBrandNew?: boolean;
  requiresAssignedUser?: boolean;
  requiresOAuth?: boolean;
  allowManualSend?: boolean;

  oauthConfig?: IntegrationServiceOAuthConfig | null;

  credentialFields?: Array<
    Omit<IntegrationServiceCredentialFieldDTO, 'id' | 'serviceId'>
  >;
};
