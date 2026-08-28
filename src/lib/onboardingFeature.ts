export function isOnboardingEnabled() {
  const value = process.env.NEXT_PUBLIC_ONBOARDING_ENABLED;
  return value === undefined || value.trim().toLowerCase() === 'true';
}
