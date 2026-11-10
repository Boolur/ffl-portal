'use client';

import type { ReactNode } from 'react';
import { ArrowRight, Building2, CalendarDays, CircleDollarSign, Home, Landmark, Mail, MapPin, Phone, ShieldCheck, UserRound, Users } from 'lucide-react';
import type { getProcessingBorrowerDetails } from '@/app/actions/processingPipelineActions';
import type { AriveSyncServiceTracker } from '@/lib/ariveSyncTypes';
import { formatAriveCalendarDate, ariveFieldMissing } from '@/lib/ariveSyncPresentation';
import { DetailCard, DetailField, DetailGrid } from './BorrowerWorkspaceLayout';
import { AriveServiceStatusCards } from './AriveServiceStatusCards';
import { AriveLoanTermsCard } from './FinancialInfoPanel';

export type ProcessingWorkspaceDetails = Extract<Awaited<ReturnType<typeof getProcessingBorrowerDetails>>, { success: true }>['details'];

const money = (value: string | number | null | undefined) => value === null || value === undefined || value === '' ? 'Not provided' : Number.isFinite(Number(value)) ? new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(Number(value)) : String(value);
const words = (value: string | null | undefined) => value ? value.replace(/([a-z])([A-Z])/g, '$1 $2').replaceAll('_', ' ').toLowerCase().replace(/\b\w/g, character => character.toUpperCase()) : 'Not provided';

export function WorkspaceMetric({ label, value, detail, icon: Icon, tone = 'blue' }: { label: string; value: ReactNode; detail?: string; icon: typeof Home; tone?: 'blue' | 'violet' | 'teal' | 'slate' }) {
  const accents = { blue: 'bg-blue-50 text-blue-700', violet: 'bg-violet-50 text-violet-700', teal: 'bg-teal-50 text-teal-700', slate: 'bg-slate-100 text-slate-600' };
  return <article className="min-w-0 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"><div className="flex items-center gap-2"><span className={`inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${accents[tone]}`}><Icon size={17} aria-hidden="true" /></span><h3 className="text-xs font-semibold text-slate-500">{label}</h3></div><div className="mt-3 break-words text-xl font-bold tracking-tight text-slate-900">{value}</div>{detail && <p className="mt-1 text-xs text-slate-500">{detail}</p>}</article>;
}

export function LoanPropertyView({ details }: { details: ProcessingWorkspaceDetails }) {
  const application = details.ariveApplication;
  const sourceAmount = application?.loan.totalLoanAmount ?? application?.loan.baseLoanAmount;
  const property = application?.property;
  const postalCode = property?.postalCode?.replace(/^(\d{5})(\d{4})$/, '$1-$2');
  const locality = property ? [property.city, [property.state, postalCode].filter(Boolean).join(' ')].filter(Boolean).join(', ') : '';
  const address = property ? property.addressTbd ? 'Address to be determined' : [property.street, property.unit, locality].filter(Boolean).join(', ') : details.property.address;
  const occupancy = property ? property.usageType : details.property.occupancy;
  const portalFields = <DetailGrid columns={2}>
    <DetailField label="Loan type" value={details.loan.loanType} /><DetailField label="Purpose" value={words(details.loan.purpose)} />
    <DetailField label="Program" value={details.loan.program} /><DetailField label="Channel" value={details.loan.channel} />
    <DetailField label="Lead source" value={details.loan.leadSource} /><DetailField label="Arive loan number" value={details.loan.loanNumber} copyable />
    <DetailField label="Year built" value={details.property.yearBuilt} /><DetailField label="Year acquired" value={details.property.yearAcquired} />
    <DetailField label="Title held as" value={words(details.property.titleHeldAs)} />
  </DetailGrid>;
  return <div className="space-y-4">
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <WorkspaceMetric label="Loan amount" value={money(sourceAmount ?? details.loan.amount)} icon={CircleDollarSign} detail={sourceAmount != null ? 'Arive application' : 'BISU submission'} />
      <WorkspaceMetric label={property ? 'Purchase price / estimated value' : 'Estimated property value'} value={money(property ? property.purchasePriceOrEstimatedValue : details.property.estimatedValue)} icon={Home} tone="teal" detail={`${property ? 'Arive' : 'BISU'} · ${words(occupancy)}`} />
      <WorkspaceMetric label="Loan program" value={application?.loan.lenderProductName || details.loan.program || 'Not provided'} icon={Landmark} tone="violet" detail={application?.loan.lenderProductName ? 'Arive application' : 'BISU submission'} />
      <WorkspaceMetric label="Lender" value={application?.loan.lenderName || details.loan.lender || 'Not assigned'} icon={Building2} tone="slate" detail={application?.loan.lenderName ? 'Arive application' : 'BISU submission'} />
    </div>
    <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1.5fr)_minmax(290px,1fr)]">
      <div className="space-y-4">
        <DetailCard title="Subject property" description={property ? 'Property details from the latest Arive application sync.' : 'Address and occupancy from the BISU submission.'} icon={MapPin}>
          <div className="mb-4 rounded-xl border border-blue-100 bg-blue-50/60 px-4 py-3"><p className="text-[10px] font-bold uppercase tracking-wider text-blue-600">Property securing the loan</p><p className="mt-1 text-base font-bold text-slate-900">{address || 'Address not supplied'}</p></div>
          <DetailGrid columns={2}>
            <DetailField label="Occupancy" value={words(occupancy)} /><DetailField label="Unit / apartment" value={(property ? property.unit : details.property.unit) || '—'} />
            <DetailField label="State" value={property ? property.state : details.property.state} />
            {property ? <><DetailField label="Property type" value={words(property.housingType)} /><DetailField label="Attachment type" value={words(property.attachmentType)} /><DetailField label="Units financed" value={property.financedUnitCount} /></> : <><DetailField label="Year built" value={details.property.yearBuilt} /><DetailField label="Year acquired" value={details.property.yearAcquired} /><DetailField label="Title held as" value={words(details.property.titleHeldAs)} /></>}
          </DetailGrid>
        </DetailCard>
        <AriveLoanTermsCard application={application} />
        {application ? <details className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"><summary className="cursor-pointer text-sm font-semibold text-slate-700">Portal submission details</summary><p className="my-3 text-xs text-slate-500">Original BISU figures and fields outside the current Arive application summary.</p>{portalFields}</details> : <DetailCard title="Loan structure" description="Loan and origination details recorded in BISU." icon={Landmark}>{portalFields}</DetailCard>}
      </div>
      <div className="space-y-4"><OwnershipCard details={details} /><DetailCard title="Proceeds & revenue" description="Portal values used by your team." icon={CircleDollarSign}><div className="space-y-2"><DetailField label="Cash back" value={money(details.loan.cashBack)} /><DetailField label="Projected revenue" value={money(details.loan.projectedRevenue)} /></div></DetailCard></div>
    </div>
  </div>;
}

export function OwnershipCard({ details }: { details: ProcessingWorkspaceDetails }) {
  return <DetailCard title="Loan team" description="Ownership and accountability in BISU." icon={Users}><div className="space-y-2"><DetailField label="Primary Loan Officer" value={details.ownership.primaryLoanOfficer?.name || 'Not assigned'} /><DetailField label="Secondary Loan Officer" value={details.ownership.secondaryLoanOfficer?.name || 'Not assigned'} /><DetailField label="Senior Processor" value={details.ownership.seniorProcessor?.name || 'Not assigned'} /><DetailField label="Junior Processor" value={details.ownership.juniorProcessor?.name || 'Not assigned'} /><DetailField label="Processing method" value={words(details.ownership.processingMethod)} /></div></DetailCard>;
}

function PersonCard({ label, name, phone, email, secondary = false }: { label: string; name: string; phone: string | null; email: string | null; secondary?: boolean }) {
  return <section className="min-w-0 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm"><div className={`border-b p-5 ${secondary ? 'border-violet-100 bg-violet-50/50' : 'border-blue-100 bg-blue-50/60'}`}><div className="flex items-center gap-3"><span className={`inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl ${secondary ? 'bg-violet-100 text-violet-700' : 'bg-blue-100 text-blue-700'}`}><UserRound size={24} aria-hidden="true" /></span><div className="min-w-0"><p className={`text-[10px] font-bold uppercase tracking-wider ${secondary ? 'text-violet-600' : 'text-blue-600'}`}>{label}</p><h3 className="mt-1 break-words text-lg font-bold text-slate-900">{name || 'Not included'}</h3></div></div></div><div className="space-y-3 p-5">{!name && !phone && !email ? <p className="text-sm leading-6 text-slate-500">No co-borrower is included in the portal’s submission details.</p> : <><div className="flex items-center gap-3 rounded-xl border border-slate-100 p-3"><Phone size={18} className="shrink-0 text-slate-400" /><div className="min-w-0"><p className="text-xs text-slate-500">Phone</p>{phone ? <a className="mt-1 block text-sm font-semibold text-blue-700 hover:underline" href={`tel:${phone}`}>{phone}</a> : <p className="mt-1 text-sm text-slate-400">Not provided</p>}</div></div><div className="flex items-center gap-3 rounded-xl border border-slate-100 p-3"><Mail size={18} className="shrink-0 text-slate-400" /><div className="min-w-0"><p className="text-xs text-slate-500">Email</p>{email ? <a className="mt-1 block break-all text-sm font-semibold text-blue-700 hover:underline" href={`mailto:${email}`}>{email}</a> : <p className="mt-1 text-sm text-slate-400">Not provided</p>}</div></div></>}</div></section>;
}

export function BorrowerInfoView({ details }: { details: ProcessingWorkspaceDetails }) {
  const co = details.borrower.coBorrower;
  return <div className="space-y-4"><p className="text-sm text-slate-500">Contact details from the portal submission. Each applicant stays separate.</p><div className="grid items-start gap-4 md:grid-cols-2"><PersonCard label="Primary borrower" name={[details.borrower.firstName, details.borrower.lastName].filter(Boolean).join(' ') || details.borrower.name} phone={details.borrower.phone} email={details.borrower.email} /><PersonCard label="Co-borrower" name={[co.firstName, co.lastName].filter(Boolean).join(' ')} phone={co.phone} email={co.email} secondary /></div>{Boolean(details.ariveApplication?.applicants.length) && <section className="space-y-3"><div><h3 className="text-base font-bold text-slate-900">Applicant details from Arive</h3><p className="mt-1 text-xs text-slate-500">Application information from the last successful sync; separate from the portal contact details above.</p></div><div className="grid items-start gap-4 md:grid-cols-2">{details.ariveApplication!.applicants.map((person, index) => <DetailCard key={`${person.applicationSequence}-${person.role}-${index}`} title={[person.firstName, person.lastName].filter(Boolean).join(' ') || (person.role === 'Borrower' ? 'Borrower' : 'Co-borrower')} description={`${person.role === 'Borrower' ? 'Borrower' : 'Co-borrower'}${person.applicationSequence !== null ? ` · Application ${person.applicationSequence}` : ''}`} icon={person.role === 'Borrower' ? UserRound : Users}><DetailGrid columns={2}><DetailField label="Marital status" value={words(person.maritalStatus)} /><DetailField label="First-time homebuyer" value={person.firstTimeHomeBuyer === null ? 'Not supplied' : person.firstTimeHomeBuyer ? 'Yes' : 'No'} /><div className="sm:col-span-2"><DetailField label="Current residence" value={[person.currentResidence.street, person.currentResidence.unit, person.currentResidence.city, person.currentResidence.state, person.currentResidence.postalCode].filter(Boolean).join(', ')} /></div><DetailField label="Residence basis" value={words(person.currentResidence.tenure)} /><DetailField label="Months at residence" value={person.currentResidence.residenceMonths} /></DetailGrid></DetailCard>)}</div></section>}</div>;
}

function portalServices(details: ProcessingWorkspaceDetails): AriveSyncServiceTracker[] {
  const status = (name: AriveSyncServiceTracker['name'], label: string, value: string): AriveSyncServiceTracker => ({ name, label, status: value === 'NOT_STARTED' ? 'NOT_ORDERED' : value === 'NOT_APPLICABLE' ? 'NOT_NEEDED' : value, statusLabel: value === 'NOT_APPLICABLE' ? 'Not applicable' : words(value), date: null, availability: 'current' });
  // Portal appraisal intent is not a service status. Do not infer an order from "needed".
  const appraisal: AriveSyncServiceTracker = { name: 'APPRAISAL', label: 'Appraisal', status: 'UNAVAILABLE', statusLabel: 'See appraisal details', date: null, availability: 'missing' };
  return [status('TITLE', 'Title', details.processing.titleStatus), status('HOI', 'Homeowners insurance', details.processing.hoiStatus), appraisal, status('PAYOFFS', 'Payoffs', details.processing.payoffStatus)];
}

export function LoanCenterView({ details, stageLabel, onNotes, appraisal }: { details: ProcessingWorkspaceDetails; stageLabel: string; onNotes: () => void; appraisal: ReactNode }) {
  const isArive = Boolean(details.ariveSync?.enabled);
  const services = isArive ? details.ariveSync?.serviceTrackers || [] : portalServices(details);
  const date = (key: string, value: string | null) => ariveFieldMissing(details.ariveSync, key) ? <span className="text-red-700">Missing in Arive</span> : value ? formatAriveCalendarDate(value) : 'Not supplied';
  return <div className="space-y-4"><div className="flex flex-wrap items-center justify-between gap-3"><div><h3 className="text-lg font-bold tracking-tight text-slate-950">Service progress</h3><p className="mt-1 text-xs text-slate-500">{isArive ? 'Actual Arive tracker statuses from the last successful sync.' : 'Service statuses recorded in the BISU pipeline.'}</p></div><span className="inline-flex items-center gap-2 rounded-full border border-blue-200 bg-blue-50 px-3 py-1.5 text-xs font-bold text-blue-700"><Building2 size={14} />{stageLabel}</span></div><AriveServiceStatusCards trackers={services} sourceLabel={isArive ? 'Arive' : 'BISU'} />
    <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1.6fr)_minmax(290px,1fr)]"><div className="space-y-4"><section className="rounded-2xl border border-amber-200 bg-amber-50/40 p-5"><div className="flex items-start justify-between gap-3"><div><p className="text-[10px] font-bold uppercase tracking-wider text-amber-700">Next actions</p><h3 className="mt-1 text-base font-bold text-slate-900">Pending items</h3></div><button type="button" onClick={onNotes} className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-amber-200 bg-white px-3 py-2 text-xs font-semibold text-amber-800 hover:bg-amber-50">All notes<ArrowRight size={13} /></button></div><p className="mt-3 whitespace-pre-wrap break-words text-sm leading-6 text-slate-700">{details.processing.missingItemsCurrentStatus || 'No pending-items summary has been supplied.'}</p><p className="mt-3 text-[11px] text-amber-800">{details.ariveSync?.managedFields.includes('missingItemsCurrentStatus') ? 'Latest “Pending Items:” section from Arive. Earlier notes remain in Notes.' : 'Current summary maintained by your processing team.'}</p></section>
      <DetailCard title="Key dates" description="Signing, payoff, and funding milestones." icon={CalendarDays}><DetailGrid><DetailField label="Scheduled signing" value={date('estimatedSigningAt', details.processing.estimatedSigningAt)} /><DetailField label="Payoff expiry" value={date('payoffExpiresAt', details.processing.payoffExpiresAt)} /><DetailField label="Funded" value={date('fundedAt', details.processing.fundedAt)} /></DetailGrid></DetailCard>
      {(details.processing.extraNotes || details.processing.restructureNotes) && <details className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"><summary className="cursor-pointer text-sm font-semibold text-slate-700">Additional processing notes</summary><p className="my-3 text-xs text-slate-500">Context maintained in BISU.</p><div className="space-y-2">{details.processing.extraNotes && <DetailField label="Additional notes" value={<span className="whitespace-pre-wrap">{details.processing.extraNotes}</span>} />}{details.processing.restructureNotes && <DetailField label="Restructure notes" value={<span className="whitespace-pre-wrap">{details.processing.restructureNotes}</span>} />}</div></details>}
      <details className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"><summary className="cursor-pointer text-sm font-bold text-slate-800">Appraisal details & milestones</summary><div className="mt-4">{appraisal}</div></details>
    </div><div className="space-y-4"><DetailCard title="Closing readiness" description="Rate lock and disclosure checkpoints." icon={ShieldCheck}><div className="space-y-2"><DetailField label="Rate lock" value={ariveFieldMissing(details.ariveSync, 'rateLock') ? 'Missing in Arive' : details.processing.rateLock ? 'Locked' : 'Not locked'} /><DetailField label="Lock expiration" value={date('rateLockExpiresAt', details.processing.rateLockExpiresAt)} /><DetailField label="Closing disclosure" value={ariveFieldMissing(details.ariveSync, 'cdSent') ? 'Missing in Arive' : details.processing.cdSent ? 'Sent' : 'Not sent'} /></div></DetailCard><DetailCard title="File routing" icon={Building2}><div className="space-y-2"><DetailField label="Pipeline" value={words(details.processing.sheet)} /><DetailField label="Assigned" value={details.processing.dateAssigned ? formatAriveCalendarDate(details.processing.dateAssigned) : 'Not supplied'} /><DetailField label="Days in current stage" value={isArive && !details.ariveSync?.stageDate ? 'Stage date missing' : details.processing.daysInStatus} /></div></DetailCard><OwnershipCard details={details} /></div></div></div>;
}
