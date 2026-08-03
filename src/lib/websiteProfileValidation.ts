const LOAN_OFFICER_ASSISTANT_TITLE = /\bloan officer assistant\b/i;

export function requiresNmlsForWebsiteTitle(title: string) {
  return !LOAN_OFFICER_ASSISTANT_TITLE.test(title.trim());
}

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
