import { describe, expect, it } from 'vitest';
import { selectMismoAriveLoanNumber } from './mismoAriveLoanNumber';

const typed = (value: string, otherDescription = 'ARIVE Loan ID') => ({ type: 'Other', otherDescription, value });

describe('MISMO Arive loan-number import', () => {
  it('prefers a typed Arive ID over both a different filename number and its export timestamp', () => {
    expect(selectMismoAriveLoanNumber({ identifiers: [typed('17434306')], sourceFilename: 'Arive17629632_export1786557455700.xml' })).toBe('17434306');
  });
  it.each(['ARIVE Loan ID', 'Arrive', 'LWLoanId', 'LOS', 'Loan Origination System'])('recognizes explicit %s identity', description => {
    expect(selectMismoAriveLoanNumber({ identifiers: [typed('17434306', description)] })).toBe('17434306');
  });
  it('accepts a direct LOS XML value, and deduplicates agreeing typed identities', () => {
    expect(selectMismoAriveLoanNumber({ identifiers: [typed('17434306')], losIdentifiers: ['17434306', ' 17434306 '] })).toBe('17434306');
    expect(selectMismoAriveLoanNumber({ identifiers: [], losIdentifiers: ['17629632'] })).toBe('17629632');
  });
  it('retains the documented numeric range and leading zeros for explicit XML IDs', () => {
    expect(selectMismoAriveLoanNumber({ identifiers: [typed('00001234')] })).toBe('00001234');
    expect(selectMismoAriveLoanNumber({ identifiers: [typed('123456789012345')] })).toBe('123456789012345');
    expect(selectMismoAriveLoanNumber({ identifiers: [typed('42')] })).toBe('42');
  });
  it.each(['1786557455700', '1789060069397', '1791471277063'])('never imports the observed timestamp %s, even when labelled as an LOS ID', value => {
    expect(selectMismoAriveLoanNumber({ identifiers: [typed(value)], sourceFilename: 'Arive17434306.xml' })).toBe('');
    expect(selectMismoAriveLoanNumber({ identifiers: [], sourceFilename: `Arive${value}.xml` })).toBe('');
    expect(selectMismoAriveLoanNumber({ identifiers: [], sourceFilename: `${value}.xml` })).toBe('');
  });
  it('requires manual entry for conflicting typed XML rather than accepting a filename', () => {
    expect(selectMismoAriveLoanNumber({ identifiers: [typed('17434306'), typed('17629632')], sourceFilename: 'Arive17434306.xml' })).toBe('');
    expect(selectMismoAriveLoanNumber({ identifiers: [typed('17434306')], losIdentifiers: ['17629632'], sourceFilename: '17434306.xml' })).toBe('');
  });
  it.each(['not-a-number', 'bad-guid-123', '1234567890123456'])('does not hide an invalid typed ID %s behind a filename or other typed ID', value => {
    expect(selectMismoAriveLoanNumber({ identifiers: [typed(value), typed('17434306')], sourceFilename: 'Arive17434306.xml' })).toBe('');
  });
  it('does not treat UniversalLoan, lender, disclosure or untyped numbers as LOS identity', () => {
    for (const identifier of [
      { type: 'UniversalLoan', value: '254900IB7WYS767GWP511262521324706' },
      { type: 'UniversalLoan', value: '17434306' },
      { type: 'LenderLoan', value: '1226750110' },
      typed('17434306', 'Disclosure tracking'),
      { type: 'Other', value: '17434306' },
    ]) expect(selectMismoAriveLoanNumber({ identifiers: [identifier] })).toBe('');
  });
  it('does not re-import a known lender or UniversalLoan ID through a filename', () => {
    for (const type of ['LenderLoan', 'UniversalLoan']) {
      expect(selectMismoAriveLoanNumber({ identifiers: [{ type, value: '17434306' }], sourceFilename: 'Arive17434306.xml' })).toBe('');
    }
  });
  it.each(['Arive17434306.xml', 'Arive Loan ID - 17434306.xml', 'Arrive_17434306_export1786557455700.xml', 'C:\\Downloads\\Arive17434306.xml'])('uses an explicit Arive filename label: %s', sourceFilename => {
    expect(selectMismoAriveLoanNumber({ identifiers: [], sourceFilename })).toBe('17434306');
  });
  it.each(['17434306.xml', 'MISMO 17434306.xml', 'loan_17434306_export.xml', '602604.xml'])('permits an unambiguous simple filename: %s', sourceFilename => {
    expect(selectMismoAriveLoanNumber({ identifiers: [], sourceFilename })).toBe(sourceFilename.includes('602604') ? '602604' : '17434306');
  });
  it.each(['17434306_17629632.xml', 'Arive17434306_Arive17629632.xml', '17434306_1786557455700.xml', '20261117.xml', 'Lender17434306.xml', 'Jane17434306.xml', '1226750110.xml', '254900IB7WYS767GWP511262521324706.xml', 'export.xml'])('requires manual entry for ambiguous or unsupported filename: %s', sourceFilename => {
    expect(selectMismoAriveLoanNumber({ identifiers: [], sourceFilename })).toBe('');
  });
  it.each(['20261117', '11172026', '17112026', '02292024', '29022024'])('rejects a valid YYYYMMDD/MMDDYYYY/DDMMYYYY filename date %s without rejecting explicit XML identity', value => {
    for (const sourceFilename of [`${value}.xml`, `Arive${value}.xml`]) {
      expect(selectMismoAriveLoanNumber({ identifiers: [], sourceFilename })).toBe('');
    }
    expect(selectMismoAriveLoanNumber({ identifiers: [typed(value)] })).toBe(value);
  });
  it('does not reject plausible numeric filenames merely because an invalid date can be parsed from them', () => {
    for (const value of ['02302026', '31022026']) expect(selectMismoAriveLoanNumber({ identifiers: [], sourceFilename: `${value}.xml` })).toBe(value);
  });
});
