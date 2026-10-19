import { describe, expect, it } from 'vitest';
import { calculateSigningFundingDates, getRescissionDeadline, isFederalLegalHoliday, isFundingBusinessDay, isPurchasePurpose, isRescissionBusinessDay } from './mortgageCalendar';

describe('federal holiday rescission calendar', () => {
  it.each([
    '2026-01-01', '2026-01-19', '2026-02-16', '2026-05-25',
    '2026-06-19', '2026-07-04', '2026-09-07', '2026-10-12',
    '2026-11-11', '2026-11-26', '2026-12-25',
  ])('excludes federal holiday %s', (day) => {
    expect(isFederalLegalHoliday(new Date(day))).toBe(true);
    expect(isRescissionBusinessDay(new Date(day))).toBe(false);
  });

  it.each([
    ['2026-10-08', '2026-10-13'],
    ['2026-10-09', '2026-10-14'],
    ['2026-10-05', '2026-10-08'],
    ['2026-07-02', '2026-07-07'],
    ['2026-12-30', '2027-01-04'],
    ['2026-11-25', '2026-11-30'],
    ['2026-03-06', '2026-03-10'],
  ])('counts three eligible days after %s, ending %s', (start, end) => {
    const input = new Date(`${start}T12:00:00Z`);
    expect(getRescissionDeadline(input).toISOString().slice(0, 10)).toBe(end);
    expect(input.toISOString()).toBe(`${start}T12:00:00.000Z`);
  });

  it('counts ordinary Saturdays and observed weekdays, but excludes Sundays', () => {
    expect(isRescissionBusinessDay(new Date('2026-10-10'))).toBe(true);
    expect(isRescissionBusinessDay(new Date('2026-10-11'))).toBe(false);
    expect(isRescissionBusinessDay(new Date('2026-07-03'))).toBe(true);
  });

  it('calculates moving holidays in future years without annual maintenance', () => {
    expect(isFederalLegalHoliday(new Date('2027-10-11'))).toBe(true);
    expect(isFederalLegalHoliday(new Date('2027-10-12'))).toBe(false);
    expect(isFederalLegalHoliday(new Date('2028-05-29'))).toBe(true);
    expect(isFederalLegalHoliday(new Date('2028-11-23'))).toBe(true);
  });

  it('rejects invalid input instead of looping indefinitely', () => {
    expect(() => getRescissionDeadline(new Date('invalid'))).toThrow('valid');
  });
});

describe('signing to funding', () => {
  it.each([
    ['2026-10-08', '2026-10-14'],
    ['2026-10-09', '2026-10-15'],
    ['2026-10-06', '2026-10-13'],
    ['2026-07-01', '2026-07-07'],
    ['2026-12-30', '2027-01-05'],
    ['2026-10-26', '2026-10-30'],
  ])('funds signing %s after cancellation ends, on %s', (signingAt, fundedAt) => {
    expect(calculateSigningFundingDates({ signingAt, isPurchase: false, rescissionApplies: true }).fundedAt.toISOString().slice(0, 10)).toBe(fundedAt);
  });

  it('never adds rescission for purchases even when requested by a client', () => {
    const dates = calculateSigningFundingDates({ signingAt: '2026-10-09', isPurchase: true, rescissionApplies: true });
    expect(dates.fundedAt.toISOString().slice(0, 10)).toBe('2026-10-09');
    expect(dates.rescissionDeadline).toBeNull();
  });

  it('allows other explicitly exempt loans and rolls holidays to an open funding day', () => {
    expect(calculateSigningFundingDates({ signingAt: '2026-10-12', isPurchase: false, rescissionApplies: false }).fundedAt.toISOString().slice(0, 10)).toBe('2026-10-13');
  });

  it.each(['2026-07-03', '2027-12-31', '2028-01-01', '2027-07-05'])('excludes observed holiday or weekend %s from funding', (date) => {
    expect(isFundingBusinessDay(new Date(date))).toBe(false);
  });

  it('uses the latest disclosure delivery date when later than signing', () => {
    const dates = calculateSigningFundingDates({ signingAt: '2026-10-08', rescissionStartAt: '2026-10-13', isPurchase: false, rescissionApplies: true });
    expect(dates.rescissionDeadline?.toISOString().slice(0, 10)).toBe('2026-10-16');
    expect(dates.fundedAt.toISOString().slice(0, 10)).toBe('2026-10-19');
  });

  it('requires an explicit decision for non-purchases', () => {
    expect(() => calculateSigningFundingDates({ signingAt: '2026-10-09', isPurchase: false })).toThrow('Select whether');
  });

  it.each(['2026-02-30', 'invalid', '', '2026-10-09T12:00:00Z'])('rejects invalid signing date %s', (signingAt) => {
    expect(() => calculateSigningFundingDates({ signingAt, isPurchase: true })).toThrow('valid signing');
  });

  it('rejects a rescission start before signing', () => {
    expect(() => calculateSigningFundingDates({ signingAt: '2026-10-09', rescissionStartAt: '2026-10-08', isPurchase: false, rescissionApplies: true })).toThrow('before signing');
  });

  it('recognizes purchase purpose without guessing from missing or ambiguous values', () => {
    expect(isPurchasePurpose(' Purchase ')).toBe(true);
    expect(isPurchasePurpose(null)).toBe(false);
    expect(isPurchasePurpose('Cash Out')).toBe(false);
  });
});
