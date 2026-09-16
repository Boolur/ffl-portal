export function buildDefaultWebsiteProfileBio(name: string, title: string) {
  const displayName = name.trim() || 'This mortgage professional';
  const displayTitle = title.trim() || 'mortgage professional';

  return `${displayName} is a ${displayTitle} with BISU Home Loans, helping clients compare purchase, refinance, and home equity options with clear guidance, fast communication, and a people-first lending experience.`;
}
