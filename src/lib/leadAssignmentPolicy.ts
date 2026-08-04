export function isEmailOnlyWebLead(source: string | null | undefined) {
  return source?.trim().toLowerCase() === 'weblead';
}
