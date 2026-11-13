'use client';

import React from 'react';
import { Banknote, Briefcase, Building2, Clock3, Home, Percent, Wallet } from 'lucide-react';
import type { AriveApplicationView } from '@/lib/ariveApplicationSnapshot';
import { formatAriveCalendarDate, formatAriveSyncDate } from '@/lib/ariveSyncPresentation';

const missing = 'Not provided';
const money = (value: number | null | undefined) => value == null ? missing : new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 }).format(value);
const percent = (value: number | null | undefined) => value == null ? missing : `${new Intl.NumberFormat('en-US', { maximumFractionDigits: 3 }).format(value)}%`;
const label = (value: string | null) => value ? value.replace(/([a-z])([A-Z])/g, '$1 $2').replaceAll('_', ' ') : missing;

function Field({ title, value }: { title: string; value: React.ReactNode }) {
  return <div className="min-w-0 rounded-xl border border-slate-100 bg-slate-50/80 p-3"><dt className="text-[10px] font-bold uppercase tracking-wide text-slate-500">{title}</dt><dd className={`mt-1 break-words text-sm font-semibold ${value === missing ? 'text-slate-400' : 'text-slate-900'}`}>{value}</dd></div>;
}

export function AriveLoanTermsCard({ application }: { application?: AriveApplicationView | null }) {
  if (!application) return null;
  const { loan } = application;
  const hasPaymentTerms = [loan.interestOnly, loan.interestOnlyTermMonths, loan.initialFixedPeriodMonths, loan.rateAdjustmentPeriod, loan.impoundWaiver].some(value => value != null);
  return <section className="rounded-2xl border border-blue-100 bg-white p-5"><div className="mb-4 flex flex-wrap items-center justify-between gap-2"><h3 className="flex items-center gap-2 text-sm font-bold text-slate-900"><Building2 size={17} className="text-blue-600" />Loan terms from Arive</h3><span className="rounded-full bg-blue-50 px-2.5 py-1 text-[10px] font-semibold text-blue-700">Read only</span></div><dl className="grid grid-cols-2 gap-2.5 xl:grid-cols-3">
    <Field title="Base loan amount" value={money(loan.baseLoanAmount)} /><Field title="Total loan amount" value={money(loan.totalLoanAmount)} />
    <Field title="Note rate" value={percent(loan.noteRate)} /><Field title="Amortization term" value={loan.amortizationTerm ?? missing} />
    <Field title="Amortization" value={label(loan.amortizationType)} /><Field title="Loan term" value={loan.loanTerm ?? missing} />
    <Field title="Mortgage type" value={label(loan.mortgageType)} /><Field title="Lien position" value={label(loan.lienPosition)} />
    <Field title="Lender" value={loan.lenderName ?? missing} /><Field title="Product" value={loan.lenderProductName ?? missing} />
    <Field title="Purpose" value={label(loan.loanPurpose)} /><Field title="Refinance type" value={label(loan.refinanceType)} />
    <Field title="Documentation" value={label(loan.documentationType)} /><Field title="Cash-out purpose" value={label(loan.cashoutPurpose)} />
    <Field title="Origination channel" value={label(loan.industryChannel)} />
  </dl>
    <div className="mt-4 border-t border-slate-100 pt-4"><h4 className="mb-2 text-xs font-bold text-slate-600">Lender references</h4><dl className="grid grid-cols-2 gap-2.5 xl:grid-cols-3"><Field title="Lender loan number" value={loan.lenderLoanIdentifier ?? missing} /><Field title="Product code" value={loan.lenderProductCode ?? missing} /><Field title="Lender NMLS" value={loan.lenderNMLS ?? missing} /></dl></div>
    {hasPaymentTerms && <div className="mt-4 border-t border-slate-100 pt-4"><h4 className="mb-2 text-xs font-bold text-slate-600">Payment structure</h4><dl className="grid grid-cols-2 gap-2.5 xl:grid-cols-3">
      <Field title="Interest only" value={loan.interestOnly == null ? missing : loan.interestOnly ? 'Yes' : 'No'} />
      <Field title="Interest-only term (months)" value={loan.interestOnlyTermMonths ?? missing} />
      <Field title="Initial fixed period (months)" value={loan.initialFixedPeriodMonths ?? missing} />
      <Field title="Rate adjustment period (reported)" value={loan.rateAdjustmentPeriod ?? missing} />
      <Field title="Escrow waiver" value={loan.impoundWaiver == null ? missing : loan.impoundWaiver ? 'Yes' : 'No'} />
    </dl></div>}
    <p className="mt-3 text-xs text-slate-500">{application.syncedAt ? `Last successful sync: ${formatAriveSyncDate(application.syncedAt)}` : 'Sync time not supplied'}</p></section>;
}

export function AriveFinancialInfo({ application }: { application?: AriveApplicationView | null }) {
  if (!application) return <section className="rounded-2xl border border-slate-200 bg-white p-6">
    <div className="flex items-start gap-3"><span className="rounded-xl bg-blue-50 p-3 text-blue-600"><Wallet size={22} /></span><div><h3 className="text-base font-bold text-slate-900">Financial information</h3><p className="mt-1 max-w-2xl text-sm leading-6 text-slate-500">No verified Arive financial snapshot is available for this file yet. Existing submission figures remain in Loan &amp; Property.</p></div></div>
  </section>;

  const { financial, monthlyHousing, employment } = application;
  const metrics = [
    { title: 'Estimated cash to close', value: money(financial.estimatedCashToClose), icon: Wallet },
    { title: 'Down payment', value: money(financial.downPayment), icon: Banknote },
    { title: 'Loan to value', value: percent(financial.ltv), icon: Home },
    { title: 'Back-end DTI', value: percent(financial.backEndDti), icon: Percent },
  ];
  const housing = [
    ['Principal & interest', monthlyHousing.principalAndInterest], ['Property taxes', monthlyHousing.propertyTaxes],
    ['Homeowners insurance', monthlyHousing.homeownersInsurance], ['Mortgage insurance', monthlyHousing.mortgageInsurance],
    ['HOA / condominium dues', monthlyHousing.associationDues], ['Flood insurance', monthlyHousing.floodInsurance],
  ] as const;
  return <div className="space-y-4">
    <div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="text-lg font-bold text-slate-900">Financial information</h2><p className="mt-1 text-sm text-slate-500">Application figures from Arive. Payroll and revenue approvals remain in BISU.</p></div><div className="rounded-full border border-blue-100 bg-blue-50 px-3 py-1.5 text-xs font-semibold text-blue-700">Arive · read only</div></div>
    <p className="flex items-center gap-1.5 text-xs text-slate-500"><Clock3 size={13} />{application.syncedAt ? `Last successful sync: ${formatAriveSyncDate(application.syncedAt)}` : 'Sync time not supplied'}</p>
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{metrics.map(({ title, value, icon: Icon }) => <article key={title} className="min-w-0 rounded-2xl border border-blue-100 bg-gradient-to-br from-white to-blue-50/70 p-4"><div className="flex items-center gap-2 text-xs font-semibold text-slate-500"><Icon size={16} className="shrink-0 text-blue-600" />{title}</div><p className={`mt-3 break-words text-xl font-bold tracking-tight ${value === missing ? 'text-slate-400' : 'text-slate-900'}`}>{value}</p></article>)}</div>
    <div className="grid items-start gap-4 xl:grid-cols-2">
      <section className="rounded-2xl border border-slate-200 bg-white p-5"><h3 className="mb-2 flex items-center gap-2 text-sm font-bold text-slate-900"><Home size={17} className="text-blue-600" />Monthly housing expense</h3><dl className="divide-y divide-slate-100">{housing.map(([title, amount]) => <div key={title} className="flex items-center justify-between gap-4 py-3"><dt className="text-sm text-slate-600">{title}</dt><dd className={`text-right text-sm font-semibold tabular-nums ${amount === null ? 'text-slate-400' : 'text-slate-900'}`}>{money(amount)}</dd></div>)}</dl><div className="mt-2 flex items-center justify-between gap-3 rounded-xl bg-blue-50 p-3"><span className="text-sm font-semibold text-blue-900">Total reported by Arive</span><strong className="text-right text-base text-blue-900">{money(monthlyHousing.total)}</strong></div></section>
      <div className="space-y-4">
        <section className="rounded-2xl border border-slate-200 bg-white p-5"><h3 className="mb-3 flex items-center gap-2 text-sm font-bold text-slate-900"><Percent size={17} className="text-blue-600" />Qualification figures</h3><dl className="grid grid-cols-2 gap-2.5"><Field title="Front-end DTI" value={percent(financial.frontEndDti)} /><Field title="FICO reported by Arive" value={financial.fico ?? missing} /><Field title="Combined LTV" value={percent(financial.cltv)} /><Field title="High combined LTV" value={percent(financial.hcltv)} /></dl></section>
        <section className="rounded-2xl border border-slate-200 bg-white p-5"><h3 className="mb-3 flex items-center gap-2 text-sm font-bold text-slate-900"><Banknote size={17} className="text-blue-600" />Deposits, credits &amp; financing</h3><dl className="grid grid-cols-2 gap-2.5"><Field title="Earnest money deposit" value={money(financial.earnestMoneyDeposit)} /><Field title="Seller credit" value={money(financial.sellerCredit)} /><Field title="Financed fees" value={money(financial.financedFees)} /><Field title="Discount points (reported)" value={financial.discountPoints ?? missing} /></dl></section>
      </div>
    </div>
    <section className="rounded-2xl border border-slate-200 bg-white p-5"><div className="mb-4"><h3 className="flex items-center gap-2 text-sm font-bold text-slate-900"><Briefcase size={17} className="text-blue-600" />Employment &amp; income</h3><p className="mt-1 text-xs text-slate-500">Employer records returned by Arive. Monthly income is shown per record, without assuming a qualifying-income total.</p></div>
      {employment.length ? <div className="grid items-start gap-3 lg:grid-cols-2">{employment.map((job, index) => <article key={index} className="rounded-xl border border-slate-200 bg-slate-50/50 p-4"><div className="mb-3 flex flex-wrap items-start justify-between gap-2"><div><h4 className="text-sm font-bold text-slate-900">{job.employerName ?? 'Employer not supplied'}</h4><p className="mt-1 text-xs text-slate-500">{job.position ?? 'Position not supplied'}</p></div><span className="rounded-full bg-white px-2 py-1 text-[10px] font-semibold text-slate-600">{job.isPrimaryBorrower === null ? 'Borrower role not supplied' : job.isPrimaryBorrower ? 'Primary borrower' : 'Co-borrower'}</span></div><dl className="grid grid-cols-2 gap-2"><Field title="Monthly income" value={money(job.monthlyIncome)} /><Field title="Self-employed" value={job.selfEmployed === null ? missing : job.selfEmployed ? 'Yes' : 'No'} /><Field title="Employment classification" value={label(job.classification)} /><Field title="Employer phone" value={job.employerPhone ?? missing} /><Field title="Start date" value={job.startDate ? formatAriveCalendarDate(job.startDate) : missing} /><Field title="End date" value={job.endDate ? formatAriveCalendarDate(job.endDate) : missing} /></dl></article>)}</div> : <p className="rounded-xl border border-dashed border-slate-200 bg-slate-50 p-4 text-sm text-slate-500">Arive did not provide employment records in this snapshot.</p>}
    </section>
    <p className="px-1 text-xs leading-5 text-slate-500">This is a read-only application summary, not the complete 1003. Itemized assets, debts, other income, and underwriting declarations are not available in this summary. Missing values stay marked “Not provided”; they are not treated as zero.</p>
  </div>;
}
