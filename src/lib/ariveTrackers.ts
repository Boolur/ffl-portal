export type AriveTrackerSummary = { name: string; label: string; status: string; statusLabel: string; date: string | null };

export function formatAriveTrackerDate(date: string): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(date)) return new Date(`${date}T12:00:00`).toLocaleDateString('en-US');
  return new Date(date).toLocaleString('en-US');
}

export function normalizeAriveTrackers(value: unknown): AriveTrackerSummary[] {
  const data = value as { loanTrackers?: unknown } | null;
  if (!data || !Array.isArray(data.loanTrackers)) throw new Error('Arive returned an unexpected tracker list.');
  return data.loanTrackers.map((raw: unknown) => {
    const t = raw as Record<string, unknown> | null;
    if (!t || typeof t.name !== 'string') throw new Error('Arive returned an unexpected tracker.');
    const current = t.currentTrackerStatus as Record<string, unknown> | null | undefined;
    if (current != null && (typeof current !== 'object' || Array.isArray(current))) throw new Error('Arive returned an unexpected tracker status.');
    return {
      name: t.name,
      label: typeof t.displayName === 'string' ? t.displayName : t.name,
      status: typeof current?.name === 'string' ? current.name : '',
      statusLabel: typeof current?.displayName === 'string' ? current.displayName : typeof current?.name === 'string' ? current.name : 'Not supplied',
      date: typeof current?.date === 'string' && Number.isFinite(Date.parse(current.date)) ? current.date : null,
    };
  });
}
