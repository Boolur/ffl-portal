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

export function getRequestClientMeta(headers?: RequestHeaders): {
  ipAddress: string | null;
  userAgent: string | null;
} {
  const ipAddress =
    firstForwardedAddress(readHeader(headers, 'x-vercel-forwarded-for')) ??
    firstForwardedAddress(readHeader(headers, 'x-real-ip')) ??
    firstForwardedAddress(readHeader(headers, 'x-forwarded-for'));
  const rawUserAgent = readHeader(headers, 'user-agent')?.trim() || null;

  return {
    ipAddress,
    userAgent: rawUserAgent?.slice(0, 512) ?? null,
  };
}
