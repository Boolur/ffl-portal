/**
 * Shared types + allow-list for the Integration Service registry.
 *
 * Lives outside `src/app/actions/leadActions.ts` because that file is marked
 * `"use server"`, which forbids non-async value exports. Importing this
 * module from either server actions or client components is safe.
 *
 * Each entry here must have a matching handler in
 * `src/lib/services/index.ts#serviceHandlers`.
 */
export const INTEGRATION_SERVICE_TYPES = ['bonzo'] as const;
export type IntegrationServiceType = (typeof INTEGRATION_SERVICE_TYPES)[number];

export type IntegrationServiceSummary = {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  type: string;
  active: boolean;
  config: unknown;
  createdAt: Date;
  updatedAt: Date;
};
