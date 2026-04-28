/**
 * Business-day helpers.
 *
 * Every "today / this week / this month / this year" boundary in the
 * portal flows through this file so the whole app agrees on one
 * timezone: America/Los_Angeles. That matters for two reasons:
 *
 *   1. Quotas. evaluateMember in leadDistribution.ts asks "how many
 *      leads has this LO received today?" — where "today" MUST be the
 *      business-day window the admin configured caps against. Vercel
 *      runs servers in UTC, so without this a 2/day cap would roll over
 *      at 5 PM PT, burning an entire afternoon's capacity.
 *
 *   2. Analytics / dashboards. "Leads today", "This week", "YTD" must
 *      line up with the business day, not UTC, or the numbers shift
 *      under the admin's feet every time they cross an hour boundary.
 *
 * All functions are DST-aware. We compute the TZ's current UTC offset
 * at call time via Intl.DateTimeFormat and subtract it rather than
 * assuming a fixed -8 / -7. The resulting Date objects are still normal
 * UTC-based JS Dates — just pointing at the right instant for "midnight
 * PT" / "Monday PT" / etc. Prisma / Postgres / comparisons all work
 * normally.
 */

export const BUSINESS_TZ = 'America/Los_Angeles';

/**
 * Returns the UTC offset of a named timezone at a given instant, in
 * minutes. Positive for zones ahead of UTC, negative for zones behind.
 * America/Los_Angeles returns -420 (PDT) or -480 (PST) depending on DST.
 */
export function getTimeZoneOffsetMinutes(
  tz: string = BUSINESS_TZ,
  at: Date = new Date()
): number {
  // Ask Intl to format the instant twice, once as if it were in the
  // target zone and once as if it were in UTC. The delta is the zone's
  // offset for that exact instant (handles DST).
  const tzWall = new Date(at.toLocaleString('en-US', { timeZone: tz }));
  const utcWall = new Date(at.toLocaleString('en-US', { timeZone: 'UTC' }));
  return Math.round((tzWall.getTime() - utcWall.getTime()) / 60000);
}

/**
 * Returns the wall-clock components of `at` as seen in `tz`. Used by
 * the start-of-day/week/month/year helpers so they can compute based on
 * what the admin sees, not on UTC.
 */
function getWallParts(
  at: Date = new Date(),
  tz: string = BUSINESS_TZ
): { year: number; month: number; day: number; dayOfWeek: number } {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    weekday: 'short',
  });
  const parts = fmt.formatToParts(at);
  const get = (type: string) =>
    parts.find((p) => p.type === type)?.value ?? '';
  const weekdayMap: Record<string, number> = {
    Sun: 0,
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
  };
  return {
    year: Number(get('year')),
    month: Number(get('month')), // 1-12
    day: Number(get('day')),
    dayOfWeek: weekdayMap[get('weekday')] ?? 0,
  };
}

/**
 * Returns the Date (as a UTC instant) corresponding to 00:00 of `at`'s
 * wall-clock day in the business timezone. Default is "today at midnight
 * PT".
 */
export function startOfBusinessDay(
  at: Date = new Date(),
  tz: string = BUSINESS_TZ
): Date {
  const { year, month, day } = getWallParts(at, tz);
  // Build midnight in the target zone by starting from midnight UTC on
  // the same wall-clock date and then shifting by the zone's offset.
  const midnightUtc = new Date(Date.UTC(year, month - 1, day, 0, 0, 0, 0));
  const offsetMinutes = getTimeZoneOffsetMinutes(tz, midnightUtc);
  return new Date(midnightUtc.getTime() - offsetMinutes * 60000);
}

/**
 * Monday 00:00 of the current business week (ISO-style week start).
 * Admin expectation: "this week" starts Monday, not Sunday.
 */
export function startOfBusinessWeek(
  at: Date = new Date(),
  tz: string = BUSINESS_TZ
): Date {
  const today = startOfBusinessDay(at, tz);
  const { dayOfWeek } = getWallParts(at, tz);
  // 0 = Sun, 1 = Mon, ... 6 = Sat. If Monday, diff = 0. If Sunday,
  // diff = 6 (go back to previous Monday).
  const diff = (dayOfWeek + 6) % 7;
  return new Date(today.getTime() - diff * 24 * 60 * 60 * 1000);
}

/**
 * 1st of the current month, 00:00 in the business timezone.
 */
export function startOfBusinessMonth(
  at: Date = new Date(),
  tz: string = BUSINESS_TZ
): Date {
  const { year, month } = getWallParts(at, tz);
  const midnightUtc = new Date(Date.UTC(year, month - 1, 1, 0, 0, 0, 0));
  const offsetMinutes = getTimeZoneOffsetMinutes(tz, midnightUtc);
  return new Date(midnightUtc.getTime() - offsetMinutes * 60000);
}

/**
 * Jan 1, 00:00 in the business timezone.
 */
export function startOfBusinessYear(
  at: Date = new Date(),
  tz: string = BUSINESS_TZ
): Date {
  const { year } = getWallParts(at, tz);
  const midnightUtc = new Date(Date.UTC(year, 0, 1, 0, 0, 0, 0));
  const offsetMinutes = getTimeZoneOffsetMinutes(tz, midnightUtc);
  return new Date(midnightUtc.getTime() - offsetMinutes * 60000);
}

/**
 * Day-of-week (0=Sun..6=Sat) as seen in the business timezone. Replaces
 * `new Date().getDay()` anywhere we gate on weekday, since the server
 * clock is UTC and would roll Friday -> Saturday at 5 PM Pacific.
 */
export function businessDayOfWeek(
  at: Date = new Date(),
  tz: string = BUSINESS_TZ
): number {
  return getWallParts(at, tz).dayOfWeek;
}

/**
 * Returns `startOfBusinessDay(today) - n business days` where weekends
 * are skipped. Used by rotation previews that want "last 5 business
 * days of activity" as a fair baseline.
 */
export function startOfLastNBusinessDays(
  n: number,
  at: Date = new Date(),
  tz: string = BUSINESS_TZ
): Date {
  let d = startOfBusinessDay(at, tz);
  let count = 0;
  while (count < n) {
    d = new Date(d.getTime() - 24 * 60 * 60 * 1000);
    const dow = businessDayOfWeek(d, tz);
    if (dow !== 0 && dow !== 6) count++;
  }
  return d;
}
