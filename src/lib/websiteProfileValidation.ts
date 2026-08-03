const LOAN_OFFICER_ASSISTANT_TITLE = /\bloan officer assistant\b/i;

export function requiresNmlsForWebsiteTitle(title: string) {
  return !LOAN_OFFICER_ASSISTANT_TITLE.test(title.trim());
}
