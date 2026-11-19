export function pilotModeTransition(from: boolean, to: boolean, hasStandardDraft: boolean) {
  if (from === to) return 'unchanged';
  return !from && hasStandardDraft ? 'preserve-draft' : 'reload';
}

/** Keep draft values in their existing React form. No browser storage receives loan data. */
export function hasOpenStandardDraft(doc: Document) {
  return Boolean(
    doc.querySelector(
      [
        '[data-pilot-mode-draft="true"]',
        '[aria-modal="true"] form',
        '[data-live-refresh-pause="true"] textarea:not(:disabled):not([readonly])',
        '[aria-modal="true"] select:not(:disabled)',
        '[aria-modal="true"] input:not(:disabled):not([readonly]):not([type="search"]):not([type="hidden"])',
      ].join(','),
    ),
  );
}
