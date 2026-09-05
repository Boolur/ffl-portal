type RequestHeaders =
  | Headers
  | Record<string, string | string[] | undefined>;

function readHeader(
  headers: RequestHeaders | undefined,
  name: string,
): string | null {
  if (!headers) return null;
  if (headers instanceof Headers) return headers.get(name);

  const value = headers[name] ?? headers[name.toLowerCase()];
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

function firstForwardedAddress(value: string | null): string | null {
  const address = value?.split(',')[0]?.trim();
  if (!address || address.length > 64) return null;
  return address;
}

function readLocationHeader(
  headers: RequestHeaders | undefined,
  name: string,
  maxLength: number,
): string | null {
  const rawValue = readHeader(headers, name)?.trim();
  if (!rawValue) return null;

  let value = rawValue;
  try {
    value = decodeURIComponent(rawValue);
  } catch {
    // Preserve a malformed but otherwise usable provider value.
  }
  return value.trim().slice(0, maxLength) || null;
}

export function getRequestClientMeta(headers?: RequestHeaders): {
  ipAddress: string | null;
  userAgent: string | null;
  city: string | null;
  region: string | null;
  country: string | null;
} {
  const ipAddress =
    firstForwardedAddress(readHeader(headers, 'x-vercel-forwarded-for')) ??
    firstForwardedAddress(readHeader(headers, 'x-real-ip')) ??
    firstForwardedAddress(readHeader(headers, 'x-forwarded-for'));
  const rawUserAgent = readHeader(headers, 'user-agent')?.trim() || null;

  return {
    ipAddress,
    userAgent: rawUserAgent?.slice(0, 512) ?? null,
    city: readLocationHeader(headers, 'x-vercel-ip-city', 120),
    region: readLocationHeader(headers, 'x-vercel-ip-country-region', 120),
    country: readLocationHeader(headers, 'x-vercel-ip-country', 2)?.toUpperCase() ?? null,
  };
}
