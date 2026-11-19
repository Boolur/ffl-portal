import { describe, expect, it } from 'vitest';
import { readLeadershipMismoExport } from './leadershipMismoExport';
import { selectMismoAriveLoanNumber } from './mismoAriveLoanNumber';

const guid = '5ab50988-1d8a-4861-886f-24122eb65c99';
const number = '83045551';
const filename = `Vale-Aster-${number}.xml`;
type XmlElement = { localName: string; namespaceURI: string; textContent: string; children: XmlElement[] };
function tag(localName: string, content: string | XmlElement[]): XmlElement {
  return { localName, namespaceURI: 'urn:synthetic', textContent: typeof content === 'string' ? content : '',
    children: Array.isArray(content) ? content : [] };
}
function system(name: string, id: string) {
  return tag('ORIGINATION_SYSTEM', [tag('LoanOriginationSystemName', name), tag('LoanOriginationSystemLoanIdentifier', id)]);
}
function identifier(type: string, value: string) {
  return tag('LOAN_IDENTIFIER', [tag('LoanIdentifierType', type), tag('LoanIdentifier', value)]);
}
function suggest(options: { systems?: XmlElement[]; identifiers?: XmlElement[]; name?: string; loans?: number } = {}) {
  const loan = tag('LOAN', [tag('ORIGINATION_SYSTEMS', options.systems ?? [system('ARIVE', guid)]),
    tag('LOAN_IDENTIFIERS', options.identifiers ?? [identifier('LenderLoan', number)])]);
  const doc = { getElementsByTagNameNS: (_ns: string, type: string) => type === 'LOAN' ? Array(options.loans ?? 1).fill(loan) : [] };
  return readLeadershipMismoExport(doc as unknown as Document, options.name ?? filename, 'Aster', 'Vale');
}

describe('leadership recognition of an ARIVE MISMO export', () => {
  it('suggests the number and binds its source UUID only with all of the evidence', () => {
    expect(suggest()).toEqual({ loanNumber: number, guid });
    expect(suggest({ name: filename.toLowerCase() })).toEqual({ loanNumber: number, guid });
    expect(selectMismoAriveLoanNumber({ identifiers: [{ type: 'LenderLoan', value: number }],
      losIdentifiers: [guid], sourceFilename: filename })).toBe('');
  });
  it('requires one loan, one ARIVE name and UUID under the same system, and one lender number', () => {
    for (const systems of [
      [system('Other', guid)], [system('ARIVE', '6543')], [system('ARIVE', guid.replaceAll('-', ''))],
      [system('ARIVE', ''), system('Other', guid)], [system('ARIVE', guid), system('ARIVE', guid)],
      [tag('ORIGINATION_SYSTEM', [tag('LoanOriginationSystemName', 'ARIVE'), tag('EXTENSION', [tag('LoanOriginationSystemLoanIdentifier', guid)])])],
    ]) expect(suggest({ systems })).toBeNull();
    for (const identifiers of [[], [identifier('UniversalLoan', number)], [identifier('LenderLoan', number), identifier('LenderLoan', number)]])
      expect(suggest({ identifiers })).toBeNull();
    expect(suggest({ loans: 2 })).toBeNull();
  });
  it('rejects renamed, ambiguous, dated and mismatched exports', () => {
    for (const name of [`Aster-Vale-${number}.xml`, `Vale-Other-${number}.xml`, 'Vale-Aster-83045552.xml',
      `Vale-Aster-${number} (2).xml`, `${number}.xml`, `Vale-Aster-${number}.pdf`]) expect(suggest({ name })).toBeNull();
    for (const value of ['20261118', '12345', 'ABC123', ''])
      expect(suggest({ identifiers: [identifier('LenderLoan', value)], name: `Vale-Aster-${value}.xml` })).toBeNull();
  });
});
