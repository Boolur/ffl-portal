// Federal legal holidays under 5 USC 6103(a). Use UTC calendar dates so
// calculations do not shift with the browser/server timezone or daylight saving.
function nthWeekday(year: number, month: number, weekday: number, occurrence: number) {
  const first = new Date(Date.UTC(year, month, 1)).getUTCDay();
  return 1 + (weekday - first + 7) % 7 + (occurrence - 1) * 7;
}

export function isFederalLegalHoliday(date: Date): boolean {
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth();
  const day = date.getUTCDate();
  const lastMayDay = new Date(Date.UTC(year, 4, 31)).getUTCDay();
  return (
    (month === 0 && day === 1) ||
    (month === 0 && day === nthWeekday(year, 0, 1, 3)) ||
    (month === 1 && day === nthWeekday(year, 1, 1, 3)) ||
    (month === 4 && day === 31 - (lastMayDay - 1 + 7) % 7) ||
    (year >= 2021 && month === 5 && day === 19) ||
    (month === 6 && day === 4) ||
    (month === 8 && day === nthWeekday(year, 8, 1, 1)) ||
    (month === 9 && day === nthWeekday(year, 9, 1, 2)) ||
    (month === 10 && day === 11) ||
    (month === 10 && day === nthWeekday(year, 10, 4, 4)) ||
    (month === 11 && day === 25)
  );
}

function nextDay(date: Date, days = 1) {
  const result = new Date(date);
  result.setUTCDate(result.getUTCDate() + days);
  return result;
}

// Regulation Z 1026.2(a)(6): Saturdays count; substitute observed weekdays
// are not legal holidays for the rescission count.
export function isRescissionBusinessDay(date: Date): boolean {
  return date.getUTCDay() !== 0 && !isFederalLegalHoliday(date);
}

export function getRescissionDeadline(startDate: Date): Date {
  if (Number.isNaN(startDate.getTime())) throw new Error('A valid rescission start date is required.');
  let date = new Date(Date.UTC(
    startDate.getUTCFullYear(), startDate.getUTCMonth(), startDate.getUTCDate(),
  ));
  let counted = 0;
  while (counted < 3) {
    date = nextDay(date);
    if (isRescissionBusinessDay(date)) counted += 1;
  }
  // Returned date is the final cancellation day, through midnight that night.
  return date;
}

// Funding uses weekdays and the federal observed-holiday calendar. This is
// separate from Regulation Z's actual-holiday-only rescission calendar.
export function isFundingBusinessDay(date: Date): boolean {
  const weekday = date.getUTCDay();
  if (weekday === 0 || weekday === 6 || isFederalLegalHoliday(date)) return false;
  if (weekday === 5 && isFederalLegalHoliday(nextDay(date))) return false;
  if (weekday === 1 && isFederalLegalHoliday(nextDay(date, -1))) return false;
  return true;
}

export function isPurchasePurpose(purpose: string | null | undefined): boolean {
  return /^purchase$/i.test((purpose || '').trim());
}

function parseCalendarDate(value: string, label: string): Date {
  const date = new Date(`${value}T00:00:00.000Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(date.getTime()) ||
      date.toISOString().slice(0, 10) !== value) {
    throw new Error(`A valid ${label} is required.`);
  }
  return date;
}

export function calculateSigningFundingDates(input: {
  signingAt: string;
  isPurchase: boolean;
  rescissionApplies?: boolean;
  rescissionStartAt?: string;
}) {
  const signingAt = parseCalendarDate(input.signingAt, 'signing date');
  if (!input.isPurchase && typeof input.rescissionApplies !== 'boolean') {
    throw new Error('Select whether a right-to-cancel period applies.');
  }
  const rescissionApplies = !input.isPurchase && input.rescissionApplies === true;
  const rescissionStartAt = rescissionApplies
    ? parseCalendarDate(input.rescissionStartAt || input.signingAt, 'rescission start date')
    : null;
  if (rescissionStartAt && rescissionStartAt < signingAt) {
    throw new Error('The rescission start date cannot be before signing.');
  }
  const rescissionDeadline = rescissionStartAt ? getRescissionDeadline(rescissionStartAt) : null;
  let fundedAt = rescissionDeadline ? nextDay(rescissionDeadline) : new Date(signingAt);
  while (!isFundingBusinessDay(fundedAt)) fundedAt = nextDay(fundedAt);
  return { signingAt, rescissionApplies, rescissionStartAt, rescissionDeadline, fundedAt };
}
