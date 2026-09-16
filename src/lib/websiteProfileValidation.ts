export function isValidExternalHttpUrl(value: string | null) {
  if (!value) return true;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:';
  } catch {
    return false;
  }
}

export function isValidWebsitePhotoUrl(value: string | null) {
  if (!value) return true;
  if (value.startsWith('/') && !value.startsWith('//')) return true;
  return isValidExternalHttpUrl(value);
}
