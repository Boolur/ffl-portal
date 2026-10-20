import type { Lead } from '@prisma/client';

// Alexander Hammond's October 13, 2026 tenant-specific posting instructions.
export const SHAPE_ENDPOINT = 'https://secure-api.setshape.com/api/add/new/lead/25977';

export const SHAPE_CREDENTIAL_FIELDS = [{
  key: 'shapeUserId', label: 'Shape user ID', required: true, secret: false,
  placeholder: '3', helpText: 'Assigned loan officer’s numeric Shape user ID (depursLi).', sortOrder: 0,
}, {
  key: 'shapeAssignmentField', label: 'Shape department field', required: false, secret: false,
  placeholder: 'depursLi', helpText: 'From Shape user departments: depursLi (Loan Officer), depursLo (CLR), or depursAa (Administration). Defaults to depursLi.', sortOrder: 1,
}];

type ShapeLead = Pick<Lead,
  'id' | 'firstName' | 'lastName' | 'email' | 'phone' | 'homePhone' | 'workPhone' |
  'mailingAddress' | 'mailingCity' | 'mailingState' | 'mailingZip' |
  'propertyAddress' | 'propertyCity' | 'propertyState' | 'propertyZip' | 'propertyCounty' |
  'loanAmount' | 'loanPurpose' | 'loanType' | 'loanTerm' | 'creditRating' | 'sourceUrl'
> & { vendor: { name: string }; campaign: { name: string } | null };

export function buildShapePayload(lead: ShapeLead, userId: string, assignmentField = 'depursLi') {
  for (const key of ['firstName', 'lastName', 'email'] as const) {
    if (!lead[key]?.trim()) throw new Error(`Shape requires borrower ${key}.`);
  }
  if (!/^[1-9]\d*$/.test(userId.trim())) throw new Error('Shape requires a positive numeric Shape user ID.');
  if (!['depursLi', 'depursLo', 'depursAa'].includes(assignmentField)) throw new Error('Unsupported Shape department field.');
  const optional = {
    phone: lead.phone?.trim() || lead.homePhone?.trim() || lead.workPhone?.trim(),
    mobilePhone: lead.homePhone, workPhone: lead.workPhone,
    address2: lead.mailingAddress || lead.propertyAddress,
    city: lead.mailingCity || lead.propertyCity,
    state: lead.mailingState || lead.propertyState,
    zip: lead.mailingZip || lead.propertyZip,
    prStreetAddress: lead.propertyAddress, prCity: lead.propertyCity,
    prState: lead.propertyState, prZipCode: lead.propertyZip, prCounty: lead.propertyCounty,
    creditscore: lead.creditRating, mktsourceurl: lead.sourceUrl,
    LoanAmount: lead.loanAmount, qkapppurpose: lead.loanPurpose,
  };
  return {
    firstname: lead.firstName!.trim(), lastname: lead.lastName!.trim(), email: lead.email!.trim(),
    recordtype: 3, mstrstatus1: 'New Lead', [assignmentField]: userId.trim(), mktentryid: lead.id,
    // The Open API accepts source names (unlike Marketing Source post URLs).
    source: lead.campaign?.name || lead.vendor.name,
    notes: [
      'From FFL Portal', `Vendor: ${lead.vendor.name}`,
      lead.campaign && `Campaign: ${lead.campaign.name}`,
      lead.loanType && `Loan type: ${lead.loanType}`,
      lead.loanTerm && `Loan term: ${lead.loanTerm}`,
    ].filter(Boolean).join('\n'),
    ...Object.fromEntries(Object.entries(optional).filter(([, value]) => value?.trim())),
  };
}

export function validateShapeDestination(url: string, method: string) {
  if (url !== SHAPE_ENDPOINT || method !== 'POST_JSON') {
    throw new Error('Shape must use POST JSON and the configured company Shape endpoint.');
  }
}
