'use client';

import React from 'react';
import { Briefcase, FileText, Home, Landmark, ShieldCheck, UserRound, Users } from 'lucide-react';
import { DetailCard, DetailField } from '../pipeline/BorrowerWorkspaceLayout';

export type SubmissionRow = { key: string; label: string; value: string };
type Field = [keys: string, label: string, format?: 'money' | 'note' | 'phone' | 'email'];
type Section = { title: string; description: string; icon: typeof Home; fields: Field[]; empty?: string };
const person = (prefix: string): Field[] => [
  [`${prefix}FirstName`, 'First name'], [`${prefix}LastName`, 'Last name'],
  [`${prefix}Phone`, 'Phone', 'phone'], [`${prefix}Email`, 'Email', 'email'],
];
export const submissionSections: Record<'borrower' | 'property' | 'loan', Section[]> = {
  borrower: [
    { title: 'Primary borrower', description: 'Identity and contact information.', icon: UserRound, fields: person('borrower') },
    { title: 'Co-borrower', description: 'Separate identity and contact information.', icon: Users, fields: person('coBorrower'), empty: 'No co-borrower information was provided with this submission.' },
    { title: 'Employment and income', description: 'Employment information supplied with the request.', icon: Briefcase, fields: [['employerName', 'Employer'], ['employerAddress', 'Employer address'], ['employerDurationLineOfWork', 'Time in line of work'], ['incomeProfile', 'Income profile']] },
  ],
  property: [
    { title: 'Subject property', description: 'Location of the property securing this loan.', icon: Home, fields: [['propertyAddress|subjectPropertyAddress', 'Complete address'], ['propertyStreet', 'Street'], ['propertyUnit', 'Unit / apartment'], ['propertyCity', 'City'], ['propertyState', 'State'], ['propertyZip', 'ZIP code']] },
    { title: 'Property characteristics', description: 'Occupancy, value, and property history.', icon: Home, fields: [['propertyOccupancy|occupancy', 'Occupancy'], ['homeValue', 'Estimated value', 'money'], ['yearBuiltProperty|yearBuilt', 'Year built'], ['yearAquired|yearAcquired', 'Year acquired']] },
    { title: 'Title and ownership', description: 'Vesting and title service information.', icon: Landmark, fields: [['mannerInWhichTitleWillBeHeld', 'Title held as'], ['titleCompany', 'Title company'], ['communityPropertyState', 'Community property state']] },
    { title: 'Appraisal instructions', description: 'Appraisal requirements captured at submission.', icon: ShieldCheck, fields: [['appraisalNeeded', 'Appraisal needed'], ['appraisalWaiver', 'Appraisal waiver'], ['appraisalNotes', 'Appraisal notes', 'note']] },
  ],
  loan: [
    { title: 'Loan terms', description: 'File identity, requested financing, and qualification.', icon: Landmark, fields: [['arriveLoanNumber|ariveLoanNumber', 'Arive loan number'], ['loanAmount', 'Loan amount', 'money'], ['loanType', 'Loan type'], ['loanProgram', 'Program'], ['loanPurpose', 'Purpose'], ['preApproved', 'Pre-approved in Arive'], ['qualificationStatus', 'Qualification status']] },
    { title: 'Lender and origination', description: 'Lending channel and source of the application.', icon: Briefcase, fields: [['lender', 'Lender'], ['investor', 'Investor'], ['channel', 'Channel'], ['leadSource', 'Lead source'], ['leadVendor', 'Lead vendor']] },
    { title: 'Underwriting and credit', description: 'AUS selection, report type, and bureau-specific notes.', icon: ShieldCheck, fields: [['aus', 'Automated underwriting (AUS)'], ['creditReportType', 'Credit report type'], ['uwmFreeCreditUsed', 'UWM free credit used'], ['creditReportNotesExp', 'Experian notes', 'note'], ['creditReportNotesEqf', 'Equifax notes', 'note'], ['creditReportNotesTui', 'TransUnion notes', 'note']] },
    { title: 'Pricing and proceeds', description: 'Submitted pricing and estimated financial amounts.', icon: Landmark, fields: [['cashBack', 'Cash back', 'money'], ['projectedRevenue', 'Projected revenue', 'money'], ['pricingOption', 'Pricing option'], ['runId', 'Pricing run reference']] },
    { title: 'Loan team', description: 'Named contacts and processing instructions.', icon: Users, fields: [['loanOfficer', 'Primary Loan Officer'], ['secondaryLoanOfficer', 'Secondary Loan Officer'], ['processingMethodLabel', 'Processing method'], ['processingAssignmentLabel|processorAssigned', 'Selected processor'], ['processorAssignedNote', 'Assignment instructions', 'note']] },
    { title: 'Loan goals and instructions', description: 'Context supplied by the Loan Officer.', icon: FileText, fields: [['notesGoals', 'Goals', 'note'], ['notes', 'Submission notes', 'note']] },
  ],
};

export function submissionFieldValue(rows: SubmissionRow[], keys: string) {
  return keys.split('|').map(key => rows.find(row => row.key === key)?.value.trim()).find(Boolean) || '';
}
export function formatSubmissionValue(value: string, format?: Field[2]) {
  if (!value) return '';
  if (value === '__NA__' || value === 'N/A') return 'Not applicable';
  if (value === 'true') return 'Yes';
  if (value === 'false') return 'No';
  if (format === 'money' && /^-?[$]?[\d,]+(?:\.\d+)?$/.test(value)) {
    const amount = Number(value.replace(/[$,]/g, ''));
    if (Number.isFinite(amount)) return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 }).format(amount);
  }
  return value;
}
export function SubmissionDetailSections({ tab, rows }: { tab: keyof typeof submissionSections; rows: SubmissionRow[] }) {
  return <div className="space-y-5">
    <div><h2 className="text-lg font-bold text-slate-950">{tab === 'borrower' ? 'Borrowers and employment' : tab === 'property' ? 'Property and services' : 'Loan and underwriting'}</h2><p className="mt-1 text-sm text-slate-500">Information captured with this submission. Missing information is shown as not provided.</p></div>
    <div className="grid items-start gap-4 xl:grid-cols-2">
      {[0, 1].map(column => <div key={column} className="min-w-0 space-y-4">
      {submissionSections[tab].filter((_, index) => index % 2 === column).map(section => <DetailCard key={section.title} title={section.title} description={section.description} icon={section.icon}>
        {section.empty && !section.fields.some(([keys]) => submissionFieldValue(rows, keys)) ? <p className="rounded-xl border border-dashed border-slate-200 p-5 text-sm leading-relaxed text-slate-500">{section.empty}</p> : <div className="grid gap-3 sm:grid-cols-2">{section.fields.map(([keys, label, format]) => {
          const raw = submissionFieldValue(rows, keys);
          const value = formatSubmissionValue(raw, format);
          return <div key={keys} className={format === 'note' ? 'sm:col-span-2 whitespace-pre-wrap' : 'min-w-0'}><DetailField label={label} value={value && (format === 'phone' || format === 'email') ? <a className="text-blue-700 hover:underline focus-visible:outline-2 focus-visible:outline-blue-500" href={`${format === 'phone' ? 'tel' : 'mailto'}:${value}`}>{value}</a> : value} /></div>;
        })}</div>}
      </DetailCard>)}
      </div>)}
    </div>
  </div>;
}
