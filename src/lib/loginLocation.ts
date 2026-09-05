export const HQ_IP_ADDRESS = '99.37.209.25';

export function isHqIp(ipAddress?: string | null): boolean {
  return ipAddress === HQ_IP_ADDRESS;
}

export function formatLoginLocation(input: {
  ipAddress?: string | null;
  city?: string | null;
  region?: string | null;
  country?: string | null;
}): string {
  if (isHqIp(input.ipAddress)) return 'HQ office';

  const parts = [input.city, input.region, input.country].filter(
    (value): value is string => Boolean(value),
  );
  return parts.length > 0 ? parts.join(', ') : 'Location unavailable';
}
