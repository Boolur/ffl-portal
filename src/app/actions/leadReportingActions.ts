'use server';

import { getServerSession } from 'next-auth/next';
import { UserRole } from '@prisma/client';
import { authOptions } from '@/lib/auth';
import { isAdmin as isAdminRole } from '@/lib/adminTiers';
import { prisma } from '@/lib/prisma';

export type LeadBillingFocus = 'all' | 'company_paid' | 'direct_billed';

export type LeadSpendReportFilters = {
  startDate: string;
  endDate: string;
  vendorIds?: string[];
  campaignIds?: string[];
  assignedUserIds?: string[];
  billingFocus?: LeadBillingFocus;
  includeUnassigned?: boolean;
  includeMissingPrice?: boolean;
};

export type LeadReportingFilterOptions = {
  vendors: Array<{ id: string; name: string; slug: string }>;
  campaigns: Array<{
    id: string;
    name: string;
    routingTag: string;
    vendorId: string;
    vendorName: string;
  }>;
  loanOfficers: Array<{ id: string; name: string; email: string }>;
};

export type LeadSpendReport = {
  generatedAt: string;
  filters: Required<
    Pick<
      LeadSpendReportFilters,
      | 'startDate'
      | 'endDate'
      | 'billingFocus'
      | 'includeUnassigned'
      | 'includeMissingPrice'
    >
  > & {
    vendorIds: string[];
    campaignIds: string[];
    assignedUserIds: string[];
  };
  summary: {
    totalSpend: number;
    companyPaidSpend: number;
    directBilledSpend: number;
    pricedLeadCount: number;
    missingPriceCount: number;
    totalLeadCount: number;
    averagePrice: number;
    assignedLeadCount: number;
    unassignedLeadCount: number;
  };
  loanOfficerRows: LeadOfficerSpendRow[];
  campaignRows: CampaignSpendRow[];
  detailRows: LeadSpendDetailRow[];
};

export type LeadOfficerSpendRow = {
  assignedUserId: string | null;
  loanOfficerName: string;
  loanOfficerEmail: string | null;
  totalSpend: number;
  leadCount: number;
  pricedLeadCount: number;
  missingPriceCount: number;
  averagePrice: number;
  companyPaidSpend: number;
  directBilledSpend: number;
  breakdown: Array<{
    vendorId: string;
    vendorName: string;
    campaignId: string | null;
    campaignName: string;
    leadCount: number;
    totalSpend: number;
  }>;
};

export type CampaignSpendRow = {
  vendorId: string;
  vendorName: string;
  vendorSlug: string;
  campaignId: string | null;
  campaignName: string;
  routingTag: string | null;
  assignedUserId: string | null;
  loanOfficerName: string;
  leadCount: number;
  pricedLeadCount: number;
  missingPriceCount: number;
  totalSpend: number;
  averagePrice: number;
};

export type LeadSpendDetailRow = {
  id: string;
  vendorLeadId: string | null;
  borrowerName: string;
  receivedAt: string;
  vendorName: string;
  vendorSlug: string;
  campaignName: string;
  routingTag: string | null;
  loanOfficerName: string;
  price: number | null;
  priceRaw: string | null;
  status: string;
};

export type LeadSpendExportRow = {
  loanOfficerName: string;
  vendorName: string;
  campaignName: string;
  price: number | null;
  priceRaw: string | null;
  createdDate: string;
};

type SpendAccumulator = {
  totalSpend: number;
  leadCount: number;
  pricedLeadCount: number;
  missingPriceCount: number;
  companyPaidSpend: number;
  directBilledSpend: number;
};

const COMPANY_PAID_VENDOR_SLUGS = new Set(['leadpoint', 'lendingtree']);
const DIRECT_BILLED_VENDOR_SLUGS = new Set(['freerateupdate']);

async function assertDistributionAdmin() {
  const session = await getServerSession(authOptions);
  const role = session?.user?.role as UserRole | undefined;
  const allowed = isAdminRole(role) || role === UserRole.MANAGER;
  if (!allowed) throw new Error('Unauthorized');
  return session;
}

function cleanIds(ids: string[] | undefined): string[] {
  return Array.from(new Set((ids ?? []).map((id) => id.trim()).filter(Boolean)));
}

function parseDate(value: string, fallback: Date): Date {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? fallback : parsed;
}

function parseLeadPrice(value: string | null): number | null {
  if (!value) return null;
  const cleaned = value.replace(/[$,\s]/g, '');
  if (!cleaned) return null;
  const parsed = Number.parseFloat(cleaned);
  if (!Number.isFinite(parsed) || parsed < 0) return null;
  return Math.round(parsed * 100) / 100;
}

function borrowerName(firstName: string | null, lastName: string | null): string {
  return [firstName, lastName].filter(Boolean).join(' ') || 'Unknown borrower';
}

function emptyAccumulator(): SpendAccumulator {
  return {
    totalSpend: 0,
    leadCount: 0,
    pricedLeadCount: 0,
    missingPriceCount: 0,
    companyPaidSpend: 0,
    directBilledSpend: 0,
  };
}

function addLeadToAccumulator(
  acc: SpendAccumulator,
  price: number | null,
  vendorSlug: string
) {
  acc.leadCount += 1;
  if (price === null) {
    acc.missingPriceCount += 1;
    return;
  }
  acc.totalSpend += price;
  acc.pricedLeadCount += 1;
  if (COMPANY_PAID_VENDOR_SLUGS.has(vendorSlug)) acc.companyPaidSpend += price;
  if (DIRECT_BILLED_VENDOR_SLUGS.has(vendorSlug)) acc.directBilledSpend += price;
}

function average(totalSpend: number, pricedLeadCount: number): number {
  return pricedLeadCount > 0
    ? Math.round((totalSpend / pricedLeadCount) * 100) / 100
    : 0;
}

type ParsedLeadSpendFilters = {
  startDate: Date;
  endDate: Date;
  billingFocus: LeadBillingFocus;
  vendorIds: string[];
  campaignIds: string[];
  assignedUserIds: string[];
  includeUnassigned: boolean;
  includeMissingPrice: boolean;
};

function parseLeadSpendFilters(
  filters: LeadSpendReportFilters
): ParsedLeadSpendFilters {
  const now = new Date();
  const defaultStart = new Date(now);
  defaultStart.setDate(defaultStart.getDate() - 7);

  return {
    startDate: parseDate(filters.startDate, defaultStart),
    endDate: parseDate(filters.endDate, now),
    billingFocus: filters.billingFocus ?? 'company_paid',
    vendorIds: cleanIds(filters.vendorIds),
    campaignIds: cleanIds(filters.campaignIds),
    assignedUserIds: cleanIds(filters.assignedUserIds),
    includeUnassigned: filters.includeUnassigned ?? true,
    includeMissingPrice: filters.includeMissingPrice ?? true,
  };
}

function buildLeadSpendWhere(parsed: ParsedLeadSpendFilters) {
  const {
    startDate,
    endDate,
    billingFocus,
    vendorIds,
    campaignIds,
    assignedUserIds,
    includeUnassigned,
  } = parsed;

  return {
    receivedAt: { gte: startDate, lte: endDate },
    ...(vendorIds.length > 0 ? { vendorId: { in: vendorIds } } : {}),
    ...(campaignIds.length > 0 ? { campaignId: { in: campaignIds } } : {}),
    ...(assignedUserIds.length > 0
      ? { assignedUserId: { in: assignedUserIds } }
      : includeUnassigned
        ? {}
        : { assignedUserId: { not: null } }),
    ...(billingFocus === 'company_paid'
      ? { vendor: { slug: { in: Array.from(COMPANY_PAID_VENDOR_SLUGS) } } }
      : billingFocus === 'direct_billed'
        ? { vendor: { slug: { in: Array.from(DIRECT_BILLED_VENDOR_SLUGS) } } }
        : {}),
  };
}

export async function getLeadReportingFilterOptions(): Promise<LeadReportingFilterOptions> {
  await assertDistributionAdmin();

  const [vendors, campaigns, loanOfficers] = await Promise.all([
    prisma.leadVendor.findMany({
      where: { active: true },
      orderBy: { name: 'asc' },
      select: { id: true, name: true, slug: true },
    }),
    prisma.leadCampaign.findMany({
      where: { active: true },
      orderBy: [{ vendor: { name: 'asc' } }, { name: 'asc' }],
      select: {
        id: true,
        name: true,
        routingTag: true,
        vendorId: true,
        vendor: { select: { name: true } },
      },
    }),
    prisma.user.findMany({
      where: {
        active: true,
        OR: [
          { role: UserRole.LOAN_OFFICER },
          { roles: { has: UserRole.LOAN_OFFICER } },
        ],
      },
      orderBy: { name: 'asc' },
      select: { id: true, name: true, email: true },
    }),
  ]);

  return {
    vendors,
    campaigns: campaigns.map((campaign) => ({
      id: campaign.id,
      name: campaign.name,
      routingTag: campaign.routingTag,
      vendorId: campaign.vendorId,
      vendorName: campaign.vendor.name,
    })),
    loanOfficers,
  };
}

export async function getLeadSpendExportRows(
  filters: LeadSpendReportFilters
): Promise<LeadSpendExportRow[]> {
  await assertDistributionAdmin();

  const parsed = parseLeadSpendFilters(filters);
  const where = buildLeadSpendWhere(parsed);

  const leads = await prisma.lead.findMany({
    where,
    orderBy: { receivedAt: 'desc' },
    select: {
      price: true,
      receivedAt: true,
      vendor: { select: { name: true } },
      campaign: { select: { name: true } },
      assignedUser: { select: { name: true } },
    },
  });

  const rows: LeadSpendExportRow[] = [];

  for (const lead of leads) {
    const price = parseLeadPrice(lead.price);
    if (price === null && !parsed.includeMissingPrice) continue;

    rows.push({
      loanOfficerName: lead.assignedUser?.name ?? 'Unassigned',
      vendorName: lead.vendor.name,
      campaignName: lead.campaign?.name ?? 'No campaign',
      price,
      priceRaw: lead.price,
      createdDate: lead.receivedAt.toISOString(),
    });
  }

  return rows;
}

export async function getLeadSpendReport(
  filters: LeadSpendReportFilters
): Promise<LeadSpendReport> {
  await assertDistributionAdmin();

  const parsed = parseLeadSpendFilters(filters);
  const {
    startDate,
    endDate,
    billingFocus,
    vendorIds,
    campaignIds,
    assignedUserIds,
    includeUnassigned,
    includeMissingPrice,
  } = parsed;

  const where = buildLeadSpendWhere(parsed);

  const leads = await prisma.lead.findMany({
    where,
    orderBy: { receivedAt: 'desc' },
    select: {
      id: true,
      vendorLeadId: true,
      firstName: true,
      lastName: true,
      status: true,
      price: true,
      receivedAt: true,
      vendor: { select: { id: true, name: true, slug: true } },
      campaign: { select: { id: true, name: true, routingTag: true } },
      assignedUserId: true,
      assignedUser: { select: { id: true, name: true, email: true } },
    },
  });

  const summary = emptyAccumulator();
  let assignedLeadCount = 0;
  let unassignedLeadCount = 0;

  const officerMap = new Map<string, LeadOfficerSpendRow & SpendAccumulator>();
  const campaignMap = new Map<string, CampaignSpendRow & SpendAccumulator>();
  const officerBreakdownMap = new Map<string, Map<string, {
    vendorId: string;
    vendorName: string;
    campaignId: string | null;
    campaignName: string;
    leadCount: number;
    totalSpend: number;
  }>>();

  const detailRows: LeadSpendDetailRow[] = [];

  for (const lead of leads) {
    const price = parseLeadPrice(lead.price);
    if (price === null && !includeMissingPrice) continue;

    const vendorSlug = lead.vendor.slug;
    const assignedKey = lead.assignedUserId ?? '__unassigned__';
    const campaignKey = [
      lead.vendor.id,
      lead.campaign?.id ?? '__no_campaign__',
      assignedKey,
    ].join(':');

    if (lead.assignedUserId) assignedLeadCount += 1;
    else unassignedLeadCount += 1;

    addLeadToAccumulator(summary, price, vendorSlug);

    if (!officerMap.has(assignedKey)) {
      officerMap.set(assignedKey, {
        ...emptyAccumulator(),
        assignedUserId: lead.assignedUserId,
        loanOfficerName: lead.assignedUser?.name ?? 'Unassigned',
        loanOfficerEmail: lead.assignedUser?.email ?? null,
        totalSpend: 0,
        leadCount: 0,
        pricedLeadCount: 0,
        missingPriceCount: 0,
        averagePrice: 0,
        companyPaidSpend: 0,
        directBilledSpend: 0,
        breakdown: [],
      });
      officerBreakdownMap.set(assignedKey, new Map());
    }

    const officer = officerMap.get(assignedKey)!;
    addLeadToAccumulator(officer, price, vendorSlug);

    const breakdownKey = `${lead.vendor.id}:${lead.campaign?.id ?? '__no_campaign__'}`;
    const breakdown = officerBreakdownMap.get(assignedKey)!;
    const existingBreakdown = breakdown.get(breakdownKey) ?? {
      vendorId: lead.vendor.id,
      vendorName: lead.vendor.name,
      campaignId: lead.campaign?.id ?? null,
      campaignName: lead.campaign?.name ?? 'No campaign',
      leadCount: 0,
      totalSpend: 0,
    };
    existingBreakdown.leadCount += 1;
    existingBreakdown.totalSpend += price ?? 0;
    breakdown.set(breakdownKey, existingBreakdown);

    if (!campaignMap.has(campaignKey)) {
      campaignMap.set(campaignKey, {
        ...emptyAccumulator(),
        vendorId: lead.vendor.id,
        vendorName: lead.vendor.name,
        vendorSlug,
        campaignId: lead.campaign?.id ?? null,
        campaignName: lead.campaign?.name ?? 'No campaign',
        routingTag: lead.campaign?.routingTag ?? null,
        assignedUserId: lead.assignedUserId,
        loanOfficerName: lead.assignedUser?.name ?? 'Unassigned',
        leadCount: 0,
        pricedLeadCount: 0,
        missingPriceCount: 0,
        totalSpend: 0,
        averagePrice: 0,
      });
    }

    const campaign = campaignMap.get(campaignKey)!;
    addLeadToAccumulator(campaign, price, vendorSlug);

    if (detailRows.length < 300) {
      detailRows.push({
        id: lead.id,
        vendorLeadId: lead.vendorLeadId,
        borrowerName: borrowerName(lead.firstName, lead.lastName),
        receivedAt: lead.receivedAt.toISOString(),
        vendorName: lead.vendor.name,
        vendorSlug,
        campaignName: lead.campaign?.name ?? 'No campaign',
        routingTag: lead.campaign?.routingTag ?? null,
        loanOfficerName: lead.assignedUser?.name ?? 'Unassigned',
        price,
        priceRaw: lead.price,
        status: lead.status,
      });
    }
  }

  const loanOfficerRows = Array.from(officerMap.entries()).map(([key, row]) => ({
    assignedUserId: row.assignedUserId,
    loanOfficerName: row.loanOfficerName,
    loanOfficerEmail: row.loanOfficerEmail,
    totalSpend: Math.round(row.totalSpend * 100) / 100,
    leadCount: row.leadCount,
    pricedLeadCount: row.pricedLeadCount,
    missingPriceCount: row.missingPriceCount,
    averagePrice: average(row.totalSpend, row.pricedLeadCount),
    companyPaidSpend: Math.round(row.companyPaidSpend * 100) / 100,
    directBilledSpend: Math.round(row.directBilledSpend * 100) / 100,
    breakdown: Array.from(officerBreakdownMap.get(key)?.values() ?? [])
      .map((item) => ({
        ...item,
        totalSpend: Math.round(item.totalSpend * 100) / 100,
      }))
      .sort((a, b) => b.totalSpend - a.totalSpend),
  })).sort((a, b) => b.totalSpend - a.totalSpend);

  const campaignRows = Array.from(campaignMap.values()).map((row) => ({
    vendorId: row.vendorId,
    vendorName: row.vendorName,
    vendorSlug: row.vendorSlug,
    campaignId: row.campaignId,
    campaignName: row.campaignName,
    routingTag: row.routingTag,
    assignedUserId: row.assignedUserId,
    loanOfficerName: row.loanOfficerName,
    leadCount: row.leadCount,
    pricedLeadCount: row.pricedLeadCount,
    missingPriceCount: row.missingPriceCount,
    totalSpend: Math.round(row.totalSpend * 100) / 100,
    averagePrice: average(row.totalSpend, row.pricedLeadCount),
  })).sort((a, b) => b.totalSpend - a.totalSpend);

  return {
    generatedAt: new Date().toISOString(),
    filters: {
      startDate: startDate.toISOString(),
      endDate: endDate.toISOString(),
      vendorIds,
      campaignIds,
      assignedUserIds,
      billingFocus,
      includeUnassigned,
      includeMissingPrice,
    },
    summary: {
      totalSpend: Math.round(summary.totalSpend * 100) / 100,
      companyPaidSpend: Math.round(summary.companyPaidSpend * 100) / 100,
      directBilledSpend: Math.round(summary.directBilledSpend * 100) / 100,
      pricedLeadCount: summary.pricedLeadCount,
      missingPriceCount: summary.missingPriceCount,
      totalLeadCount: summary.leadCount,
      averagePrice: average(summary.totalSpend, summary.pricedLeadCount),
      assignedLeadCount,
      unassignedLeadCount,
    },
    loanOfficerRows,
    campaignRows,
    detailRows,
  };
}
