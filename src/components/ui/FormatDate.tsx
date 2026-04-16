'use client';

/**
 * Renders a date with suppressHydrationWarning to avoid server/client
 * mismatch from timezone and locale differences between Vercel and the browser.
 */
export function FormatDate({
  date,
  mode = 'date',
}: {
  date: string | Date;
  mode?: 'date' | 'datetime';
}) {
  const d = new Date(date);
  return (
    <time dateTime={d.toISOString()} suppressHydrationWarning>
      {mode === 'datetime' ? d.toLocaleString() : d.toLocaleDateString()}
    </time>
  );
}
