export type StructuredAddress = {
  addressLine1: string | null | undefined;
  city: string | null | undefined;
  state: string | null | undefined;
  postalCode: string | null | undefined;
};

export const ONBOARDING_US_STATES = [
  'AL', 'AK', 'AZ', 'AR', 'CA', 'CO', 'CT', 'DE', 'FL', 'GA', 'HI', 'ID', 'IL', 'IN',
  'IA', 'KS', 'KY', 'LA', 'ME', 'MD', 'MA', 'MI', 'MN', 'MS', 'MO', 'MT', 'NE', 'NV',
  'NH', 'NJ', 'NM', 'NY', 'NC', 'ND', 'OH', 'OK', 'OR', 'PA', 'RI', 'SC', 'SD', 'TN',
  'TX', 'UT', 'VT', 'VA', 'WA', 'WV', 'WI', 'WY', 'DC',
] as const;

const US_STATE_CODES = new Set<string>(ONBOARDING_US_STATES);
const US_POSTAL_CODE = /^\d{5}(?:-\d{4})?$/;

export function isCompleteOnboardingAddress(address: StructuredAddress) {
  return Boolean(
    address.addressLine1?.trim() &&
      address.city?.trim() &&
      US_STATE_CODES.has(address.state?.trim().toUpperCase() || '') &&
      US_POSTAL_CODE.test(address.postalCode?.trim() || ''),
  );
}
