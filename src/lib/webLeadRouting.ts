import { UserRole } from '@prisma/client';

export type WebLeadTargetCandidate = {
  id: string;
  active: boolean;
  role: UserRole;
  roles: UserRole[];
  websiteLoanOfficerProfile: {
    slug: string;
    publishedAt: Date | null;
  } | null;
};

export function resolveWebLeadTarget(
  candidate: WebLeadTargetCandidate | null,
  requestedOfficerSlug: string | null,
) {
  if (!candidate?.active) return null;
  if (
    candidate.role !== UserRole.LOAN_OFFICER &&
    !candidate.roles.includes(UserRole.LOAN_OFFICER)
  ) {
    return null;
  }
  const profile = candidate.websiteLoanOfficerProfile;
  if (!profile?.publishedAt) return null;
  if (requestedOfficerSlug && profile.slug !== requestedOfficerSlug) return null;
  return candidate.id;
}

export function buildWebLeadMetadata(payload: Record<string, unknown>) {
  const customData =
    payload.customData &&
    typeof payload.customData === 'object' &&
    !Array.isArray(payload.customData)
      ? (payload.customData as Record<string, unknown>)
      : {};

  const metadataEntries: Array<[string, unknown]> = [
    ['formSource', payload.source],
    ['officerSlug', payload.officerSlug],
    ['partnerSlug', payload.partnerSlug],
    ['consent', payload.consent],
    ['consentTextVersion', payload.consent_text_version],
    ['routingTag', payload.routing_tag],
  ];

  return {
    ...customData,
    ...Object.fromEntries(
      metadataEntries.filter(([, value]) => value !== undefined && value !== null),
    ),
  };
}
