'use server';

import { prisma } from '@/lib/prisma';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/auth';
import {
  LeadStatus,
  UserRole,
  IntegrationServiceTrigger,
  Prisma,
} from '@prisma/client';
import { revalidatePath } from 'next/cache';
import {
  forwardLeadToBonzo,
  buildBonzoPayload,
  postBonzoPayload,
  type BonzoLeadLike,
} from '@/lib/bonzoForward';
import {
  runDispatchBatch,
  summarizeBatch,
  runServiceTriggers,
  type BatchSummary,
} from '@/lib/services';
import {
  evaluateMember,
  findNextEligibleMember,
  type GauntletCampaign,
  type GauntletGlobalQuota,
  type GauntletMember,
  type NextUpResult,
} from '@/lib/leadDistribution';
import { normalizeUserName } from '@/lib/leadNameMatch';
import {
  INTEGRATION_SERVICE_TYPES,
  type IntegrationServiceInput,
  type IntegrationServiceSummary,
  type IntegrationServiceCredentialFieldDTO,
  type IntegrationServiceCaptureField,
  type IntegrationServiceOAuthConfig,
  type IntegrationServiceType,
} from '@/lib/integrationServices/types';
export type {
  IntegrationServiceType,
  IntegrationServiceSummary,
  IntegrationServiceInput,
  IntegrationServiceCredentialFieldDTO,
  IntegrationServiceCaptureField,
  IntegrationServiceOAuthConfig,
} from '@/lib/integrationServices/types';

const CSV_VENDOR_SLUG = 'csv-upload';

// ---------------------------------------------------------------------------
// Distribution Engine
// ---------------------------------------------------------------------------

export async function distributeLead(leadId: string) {
  const lead = await prisma.lead.findUnique({
    where: { id: leadId },
    include: { campaign: true },
  });

  if (!lead) return;
  if (!lead.campaign) return;
  if (lead.campaign.distributionMethod === 'MANUAL') return;
  if (lead.assignedUserId) return;

  const campaign = lead.campaign;

  const members = await prisma.campaignMember.findMany({
    where: { campaignId: campaign.id, active: true },
    orderBy: { roundRobinPosition: 'asc' },
  });

  if (members.length === 0) {
    if (campaign.defaultUserId) {
      await prisma.lead.update({
        where: { id: leadId },
        data: {
          assignedUserId: campaign.defaultUserId,
          assignedAt: new Date(),
          status: LeadStatus.NEW,
        },
      });
      await createLeadNotification(campaign.defaultUserId, lead, campaign.name);
      void forwardLeadToBonzo(leadId, campaign.defaultUserId);
      void runServiceTriggers(leadId, IntegrationServiceTrigger.ON_ASSIGN);
      void runServiceTriggers(
        leadId,
        IntegrationServiceTrigger.DELAY_AFTER_ASSIGN
      );
    }
    return;
  }

  const leadState = (lead.propertyState || '').trim().toUpperCase();
  const currentDayOfWeek = new Date().getDay(); // 0=Sun, 1=Mon...6=Sat

  // Batch-load the global quotas for every candidate so the gauntlet
  // helper can run without per-iteration DB hits.
  const userIds = members.map((m) => m.userId);
  const globalQuotaRows = await prisma.userLeadQuota.findMany({
    where: { userId: { in: userIds } },
  });
  const globalQuotaByUserId = new Map(globalQuotaRows.map((q) => [q.userId, q]));

  const gauntletCampaign: GauntletCampaign = {
    distributionMethod: campaign.distributionMethod,
    enableUserQuotas: campaign.enableUserQuotas,
    defaultUserId: campaign.defaultUserId,
    defaultUserName: null,
  };
  const ctx = { leadState, dayOfWeek: currentDayOfWeek };

  for (const member of members) {
    const globalQuota = globalQuotaByUserId.get(member.userId) ?? null;
    const gauntletMember: GauntletMember = {
      id: member.id,
      userId: member.userId,
      userName: '',
      roundRobinPosition: member.roundRobinPosition,
      active: member.active,
      licensedStates: member.licensedStates,
      receiveDays: member.receiveDays,
      dailyQuota: member.dailyQuota,
      weeklyQuota: member.weeklyQuota,
      monthlyQuota: member.monthlyQuota,
      leadsReceivedToday: member.leadsReceivedToday,
      leadsReceivedThisWeek: member.leadsReceivedThisWeek,
      leadsReceivedThisMonth: member.leadsReceivedThisMonth,
    };
    const gauntletQuota: GauntletGlobalQuota | null = globalQuota
      ? {
          leadsEnabled: globalQuota.leadsEnabled,
          licensedStates: globalQuota.licensedStates,
          globalDailyQuota: globalQuota.globalDailyQuota,
          globalWeeklyQuota: globalQuota.globalWeeklyQuota,
          globalMonthlyQuota: globalQuota.globalMonthlyQuota,
          leadsReceivedToday: globalQuota.leadsReceivedToday,
          leadsReceivedThisWeek: globalQuota.leadsReceivedThisWeek,
          leadsReceivedThisMonth: globalQuota.leadsReceivedThisMonth,
        }
      : null;
    if (evaluateMember(gauntletCampaign, gauntletMember, gauntletQuota, ctx) !== null) {
      continue;
    }

    const maxPos = members.reduce((max, m) => Math.max(max, m.roundRobinPosition), 0);

    await prisma.$transaction([
      prisma.lead.update({
        where: { id: leadId },
        data: {
          assignedUserId: member.userId,
          assignedAt: new Date(),
          status: LeadStatus.NEW,
        },
      }),
      prisma.campaignMember.update({
        where: { id: member.id },
        data: {
          leadsReceivedToday: { increment: 1 },
          leadsReceivedThisWeek: { increment: 1 },
          leadsReceivedThisMonth: { increment: 1 },
          lastAssignedAt: new Date(),
          roundRobinPosition: maxPos + 1,
        },
      }),
      ...(globalQuota
        ? [
            prisma.userLeadQuota.update({
              where: { userId: member.userId },
              data: {
                leadsReceivedToday: { increment: 1 },
                leadsReceivedThisWeek: { increment: 1 },
                leadsReceivedThisMonth: { increment: 1 },
              },
            }),
          ]
        : []),
    ]);

    await createLeadNotification(member.userId, lead, campaign.name);
    void forwardLeadToBonzo(leadId, member.userId);
    void runServiceTriggers(leadId, IntegrationServiceTrigger.ON_ASSIGN);
    void runServiceTriggers(
      leadId,
      IntegrationServiceTrigger.DELAY_AFTER_ASSIGN
    );
    return;
  }

  if (campaign.defaultUserId) {
    await prisma.lead.update({
      where: { id: leadId },
      data: {
        assignedUserId: campaign.defaultUserId,
        assignedAt: new Date(),
        status: LeadStatus.NEW,
      },
    });
    await createLeadNotification(campaign.defaultUserId, lead, campaign.name);
    void forwardLeadToBonzo(leadId, campaign.defaultUserId);
    void runServiceTriggers(leadId, IntegrationServiceTrigger.ON_ASSIGN);
    void runServiceTriggers(
      leadId,
      IntegrationServiceTrigger.DELAY_AFTER_ASSIGN
    );
  }
}

async function createLeadNotification(
  userId: string,
  lead: { id: string; firstName?: string | null; lastName?: string | null },
  campaignName: string
) {
  const name = [lead.firstName, lead.lastName].filter(Boolean).join(' ') || 'Unknown';
  try {
    await prisma.notification.create({
      data: {
        userId,
        eventLabel: 'LEAD_ASSIGNED',
        title: 'New Lead Assigned',
        message: `New lead: ${name} — ${campaignName}`,
        href: '/leads',
      },
    });
  } catch (err) {
    console.error('[lead-notification] failed', err);
  }
}

// ---------------------------------------------------------------------------
// Quota Resets
// ---------------------------------------------------------------------------

export async function resetDailyQuotas() {
  await prisma.$transaction([
    prisma.campaignMember.updateMany({ data: { leadsReceivedToday: 0 } }),
    prisma.userLeadQuota.updateMany({ data: { leadsReceivedToday: 0 } }),
  ]);
}

export async function resetWeeklyQuotas() {
  await prisma.$transaction([
    prisma.campaignMember.updateMany({ data: { leadsReceivedThisWeek: 0 } }),
    prisma.userLeadQuota.updateMany({ data: { leadsReceivedThisWeek: 0 } }),
  ]);
}

export async function resetMonthlyQuotas() {
  await prisma.$transaction([
    prisma.campaignMember.updateMany({ data: { leadsReceivedThisMonth: 0 } }),
    prisma.userLeadQuota.updateMany({ data: { leadsReceivedThisMonth: 0 } }),
  ]);
}

// ---------------------------------------------------------------------------
// Vendor CRUD
// ---------------------------------------------------------------------------

export async function getLeadVendors(includeSystem = false) {
  return prisma.leadVendor.findMany({
    where: includeSystem ? undefined : { slug: { not: CSV_VENDOR_SLUG } },
    orderBy: { name: 'asc' },
    include: { _count: { select: { leads: true, campaigns: true } } },
  });
}

export async function createLeadVendor(data: {
  name: string;
  slug: string;
  webhookSecret?: string;
  routingTagField?: string;
  fieldMapping?: Record<string, string>;
}) {
  const vendor = await prisma.leadVendor.create({
    data: {
      name: data.name,
      slug: data.slug.toLowerCase().replace(/[^a-z0-9-]/g, '-'),
      webhookSecret: data.webhookSecret || null,
      routingTagField: data.routingTagField || 'routing_tag',
      fieldMapping: data.fieldMapping || {},
    },
  });
  revalidatePath('/admin/leads/vendors');
  revalidatePath('/admin/leads/campaigns');
  revalidatePath('/admin/leads');
  return vendor;
}

export async function updateLeadVendor(
  id: string,
  data: {
    name?: string;
    slug?: string;
    webhookSecret?: string | null;
    routingTagField?: string;
    fieldMapping?: Record<string, string>;
    active?: boolean;
  }
) {
  const vendor = await prisma.leadVendor.update({
    where: { id },
    data: {
      ...(data.name !== undefined && { name: data.name }),
      ...(data.slug !== undefined && { slug: data.slug.toLowerCase().replace(/[^a-z0-9-]/g, '-') }),
      ...(data.webhookSecret !== undefined && { webhookSecret: data.webhookSecret }),
      ...(data.routingTagField !== undefined && { routingTagField: data.routingTagField }),
      ...(data.fieldMapping !== undefined && { fieldMapping: data.fieldMapping }),
      ...(data.active !== undefined && { active: data.active }),
    },
  });
  revalidatePath('/admin/leads/vendors');
  revalidatePath('/admin/leads/campaigns');
  revalidatePath('/admin/leads');
  return vendor;
}

/**
 * Returns the current campaign + lead counts for a vendor. Used by the
 * permanent-delete dialog to refresh live counts after each destructive
 * action without waiting for a full page revalidation.
 */
export async function getVendorDependencyCounts(id: string) {
  const vendor = await prisma.leadVendor.findUnique({
    where: { id },
    select: {
      id: true,
      active: true,
      _count: { select: { campaigns: true, leads: true } },
    },
  });
  if (!vendor) throw new Error('Vendor not found');
  return {
    active: vendor.active,
    campaigns: vendor._count.campaigns,
    leads: vendor._count.leads,
  };
}

/**
 * Returns the current lead count for a campaign. Mirror of
 * {@link getVendorDependencyCounts} for the campaign permanent-delete UI.
 */
export async function getCampaignDependencyCounts(id: string) {
  const campaign = await prisma.leadCampaign.findUnique({
    where: { id },
    select: {
      id: true,
      active: true,
      _count: { select: { leads: true } },
    },
  });
  if (!campaign) throw new Error('Campaign not found');
  return {
    active: campaign.active,
    leads: campaign._count.leads,
  };
}

/**
 * Soft-archives a vendor (sets active=false). Archiving is the default,
 * reversible deletion path — nothing is lost. New webhook deliveries are
 * rejected (the bridge / direct routes already 404 inactive vendors),
 * the vendor hides from the default UI list, and all historical leads
 * and campaigns are preserved. Use {@link restoreLeadVendor} to undo, or
 * {@link hardDeleteLeadVendor} to permanently remove once dependencies
 * are cleared.
 */
export async function archiveLeadVendor(id: string) {
  const vendor = await prisma.leadVendor.update({
    where: { id },
    data: { active: false },
  });
  revalidatePath('/admin/leads/vendors');
  revalidatePath('/admin/leads/campaigns');
  revalidatePath('/admin/leads');
  return vendor;
}

/**
 * Reverses an archive. Vendor becomes active again and resumes accepting
 * webhook deliveries.
 */
export async function restoreLeadVendor(id: string) {
  const vendor = await prisma.leadVendor.update({
    where: { id },
    data: { active: true },
  });
  revalidatePath('/admin/leads/vendors');
  revalidatePath('/admin/leads/campaigns');
  revalidatePath('/admin/leads');
  return vendor;
}

/**
 * Permanently deletes a vendor. This is the only path that actually
 * removes the row and cascades the FK deletes to its remaining campaigns
 * and leads.
 *
 * Three guards prevent accidents:
 *   1. The vendor must already be archived (active === false) — no
 *      one-click destruction of a live vendor.
 *   2. The vendor must have zero campaigns AND zero leads — the caller
 *      must explicitly reassign or delete dependencies first via
 *      {@link reassignVendorCampaigns}, {@link deleteAllVendorCampaigns},
 *      and {@link deleteAllVendorLeads}.
 *   3. The caller must pass the vendor name as `confirmName`, proving
 *      they read what they're deleting.
 */
export async function hardDeleteLeadVendor(id: string, confirmName: string) {
  const vendor = await prisma.leadVendor.findUnique({
    where: { id },
    include: { _count: { select: { campaigns: true, leads: true } } },
  });
  if (!vendor) throw new Error('Vendor not found');
  if (vendor.active) {
    throw new Error('Vendor must be archived before it can be permanently deleted');
  }
  if (vendor._count.campaigns > 0 || vendor._count.leads > 0) {
    throw new Error(
      `Vendor still has ${vendor._count.campaigns} campaign(s) and ${vendor._count.leads} lead(s). Reassign or delete them first.`
    );
  }
  if (confirmName.trim() !== vendor.name) {
    throw new Error('Confirmation name does not match vendor name');
  }
  await prisma.leadVendor.delete({ where: { id } });
  revalidatePath('/admin/leads/vendors');
  revalidatePath('/admin/leads/campaigns');
  revalidatePath('/admin/leads');
}

/**
 * Moves all campaigns (and their leads) from `sourceVendorId` to
 * `targetVendorId` in a single transaction. Supports `routingTagRenames`
 * to resolve the case where the target vendor already owns a campaign
 * with a colliding `(vendorId, routingTag)` unique key — callers pass
 * `{ [campaignId]: newRoutingTag }` for each campaign that needs to be
 * renamed during the move.
 *
 * Returns a `collisions` list when a caller dry-runs without renames so
 * the UI can prompt for resolution; throws if renames are supplied but
 * still leave unresolved collisions.
 */
export async function reassignVendorCampaigns(
  sourceVendorId: string,
  targetVendorId: string,
  routingTagRenames: Record<string, string> = {}
): Promise<{
  moved: number;
  collisions: Array<{ campaignId: string; campaignName: string; routingTag: string }>;
}> {
  if (sourceVendorId === targetVendorId) {
    throw new Error('Source and target vendor must be different');
  }

  const [sourceCampaigns, targetCampaigns] = await Promise.all([
    prisma.leadCampaign.findMany({
      where: { vendorId: sourceVendorId },
      select: { id: true, name: true, routingTag: true },
    }),
    prisma.leadCampaign.findMany({
      where: { vendorId: targetVendorId },
      select: { routingTag: true },
    }),
  ]);

  const targetTags = new Set(targetCampaigns.map((c) => c.routingTag));

  const collisions: Array<{
    campaignId: string;
    campaignName: string;
    routingTag: string;
  }> = [];
  const moves: Array<{ id: string; newRoutingTag: string }> = [];

  for (const c of sourceCampaigns) {
    const requestedTag = routingTagRenames[c.id]?.trim() || c.routingTag;
    if (targetTags.has(requestedTag)) {
      collisions.push({
        campaignId: c.id,
        campaignName: c.name,
        routingTag: requestedTag,
      });
      continue;
    }
    if (moves.some((m) => m.newRoutingTag === requestedTag)) {
      collisions.push({
        campaignId: c.id,
        campaignName: c.name,
        routingTag: requestedTag,
      });
      continue;
    }
    moves.push({ id: c.id, newRoutingTag: requestedTag });
  }

  if (collisions.length > 0) {
    return { moved: 0, collisions };
  }

  await prisma.$transaction(async (tx) => {
    for (const m of moves) {
      await tx.leadCampaign.update({
        where: { id: m.id },
        data: { vendorId: targetVendorId, routingTag: m.newRoutingTag },
      });
      await tx.lead.updateMany({
        where: { campaignId: m.id },
        data: { vendorId: targetVendorId },
      });
    }
    await tx.lead.updateMany({
      where: { vendorId: sourceVendorId, campaignId: null },
      data: { vendorId: targetVendorId },
    });
  });

  revalidatePath('/admin/leads/vendors');
  revalidatePath('/admin/leads/campaigns');
  revalidatePath('/admin/leads');
  return { moved: moves.length, collisions: [] };
}

/**
 * Deletes all campaigns belonging to an archived vendor (and, by FK
 * cascade, their leads). Requires the vendor to be archived as a safety
 * measure — a live vendor can't have its history blasted by one call.
 */
export async function deleteAllVendorCampaigns(vendorId: string) {
  const vendor = await prisma.leadVendor.findUnique({ where: { id: vendorId } });
  if (!vendor) throw new Error('Vendor not found');
  if (vendor.active) {
    throw new Error('Vendor must be archived before bulk-deleting its campaigns');
  }
  const result = await prisma.leadCampaign.deleteMany({ where: { vendorId } });
  revalidatePath('/admin/leads/vendors');
  revalidatePath('/admin/leads/campaigns');
  revalidatePath('/admin/leads');
  return { deleted: result.count };
}

/**
 * Deletes all leads belonging to an archived vendor without touching the
 * vendor's campaigns. Useful when you want to wipe the data but keep the
 * routing config so the vendor could later be restored.
 */
export async function deleteAllVendorLeads(vendorId: string) {
  const vendor = await prisma.leadVendor.findUnique({ where: { id: vendorId } });
  if (!vendor) throw new Error('Vendor not found');
  if (vendor.active) {
    throw new Error('Vendor must be archived before bulk-deleting its leads');
  }
  const result = await prisma.lead.deleteMany({ where: { vendorId } });
  revalidatePath('/admin/leads/vendors');
  revalidatePath('/admin/leads/campaigns');
  revalidatePath('/admin/leads');
  return { deleted: result.count };
}

// ---------------------------------------------------------------------------
// Campaign CRUD
// ---------------------------------------------------------------------------

function getLastNBusinessDaysStart(n: number): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  let count = 0;
  while (count < n) {
    d.setDate(d.getDate() - 1);
    const day = d.getDay();
    if (day !== 0 && day !== 6) count++;
  }
  return d;
}

export async function getLeadCampaigns() {
  const fiveBdAgo = getLastNBusinessDaysStart(5);

  const [campaigns, quotaSums, recentLeadCounts] = await Promise.all([
    prisma.leadCampaign.findMany({
      orderBy: { createdAt: 'desc' },
      include: {
        vendor: { select: { id: true, name: true, slug: true } },
        defaultUser: { select: { id: true, name: true } },
        group: { select: { id: true, name: true, color: true } },
        _count: { select: { members: true, leads: true } },
      },
    }),
    prisma.campaignMember.groupBy({
      by: ['campaignId'],
      where: { active: true },
      _sum: { dailyQuota: true },
    }),
    prisma.lead.groupBy({
      by: ['campaignId'],
      where: { createdAt: { gte: fiveBdAgo } },
      _count: { _all: true },
      orderBy: { campaignId: 'asc' },
    }),
  ]);

  const quotaMap = new Map(quotaSums.map((q) => [q.campaignId, q._sum.dailyQuota ?? 0]));
  const recentMap = new Map(
    recentLeadCounts.map((r) => [r.campaignId, r._count._all]),
  );

  return campaigns.map((c) => ({
    ...c,
    totalDailyQuota: quotaMap.get(c.id) ?? 0,
    avgLeads5bd: Math.round(((recentMap.get(c.id) ?? 0) / 5) * 10) / 10,
  }));
}

export type CampaignNextUpRow = {
  campaignId: string;
  campaignName: string;
  vendorId: string;
  vendorSlug: string;
  vendorName: string;
  groupId: string | null;
  distributionMethod: string;
  active: boolean;
  memberCount: number;
  upNext: NextUpResult;
};

/**
 * Builds the "Up Next" roster shown on /admin/leads/campaigns. For every
 * active campaign, runs the same eligibility gauntlet distributeLead uses,
 * except with leadState=null (we're forecasting without a specific lead).
 *
 * Two Prisma queries total regardless of campaign count, so this is safe
 * to poll every 30s from the client.
 */
export async function getCampaignNextUpRoster(): Promise<CampaignNextUpRow[]> {
  const campaigns = await prisma.leadCampaign.findMany({
    where: { active: true },
    orderBy: [{ vendor: { name: 'asc' } }, { name: 'asc' }],
    include: {
      vendor: { select: { id: true, name: true, slug: true } },
      defaultUser: { select: { id: true, name: true } },
      members: {
        where: { active: true },
        orderBy: { roundRobinPosition: 'asc' },
        include: { user: { select: { id: true, name: true } } },
      },
    },
  });

  const userIds = Array.from(
    new Set(campaigns.flatMap((c) => c.members.map((m) => m.userId)))
  );

  const quotaRows = userIds.length
    ? await prisma.userLeadQuota.findMany({
        where: { userId: { in: userIds } },
      })
    : [];
  const quotaByUserId = new Map(
    quotaRows.map(
      (q) =>
        [
          q.userId,
          {
            leadsEnabled: q.leadsEnabled,
            licensedStates: q.licensedStates,
            globalDailyQuota: q.globalDailyQuota,
            globalWeeklyQuota: q.globalWeeklyQuota,
            globalMonthlyQuota: q.globalMonthlyQuota,
            leadsReceivedToday: q.leadsReceivedToday,
            leadsReceivedThisWeek: q.leadsReceivedThisWeek,
            leadsReceivedThisMonth: q.leadsReceivedThisMonth,
          } satisfies GauntletGlobalQuota,
        ] as const
    )
  );

  const dayOfWeek = new Date().getDay();

  return campaigns.map((c) => {
    const gMembers: GauntletMember[] = c.members.map((m) => ({
      id: m.id,
      userId: m.userId,
      userName: m.user?.name ?? 'Unknown user',
      roundRobinPosition: m.roundRobinPosition,
      active: m.active,
      licensedStates: m.licensedStates,
      receiveDays: m.receiveDays,
      dailyQuota: m.dailyQuota,
      weeklyQuota: m.weeklyQuota,
      monthlyQuota: m.monthlyQuota,
      leadsReceivedToday: m.leadsReceivedToday,
      leadsReceivedThisWeek: m.leadsReceivedThisWeek,
      leadsReceivedThisMonth: m.leadsReceivedThisMonth,
    }));
    const gCampaign: GauntletCampaign = {
      distributionMethod: c.distributionMethod,
      enableUserQuotas: c.enableUserQuotas,
      defaultUserId: c.defaultUserId,
      defaultUserName: c.defaultUser?.name ?? null,
    };
    const upNext = findNextEligibleMember(gCampaign, gMembers, quotaByUserId, {
      leadState: null,
      dayOfWeek,
    });

    return {
      campaignId: c.id,
      campaignName: c.name,
      vendorId: c.vendor.id,
      vendorSlug: c.vendor.slug,
      vendorName: c.vendor.name,
      groupId: c.groupId ?? null,
      distributionMethod: c.distributionMethod,
      active: c.active,
      memberCount: c.members.length,
      upNext,
    };
  });
}

export async function getLeadCampaign(id: string) {
  return prisma.leadCampaign.findUnique({
    where: { id },
    include: {
      vendor: { select: { id: true, name: true, slug: true } },
      defaultUser: { select: { id: true, name: true } },
      members: {
        include: { user: { select: { id: true, name: true, email: true, role: true } } },
        orderBy: { roundRobinPosition: 'asc' },
      },
    },
  });
}

export async function createLeadCampaign(data: {
  name: string;
  description?: string;
  vendorId: string;
  routingTag: string;
  distributionMethod?: 'ROUND_ROBIN' | 'MANUAL';
  independentRotation?: boolean;
  duplicateHandling?: 'NONE' | 'REJECT' | 'ALLOW';
  defaultLeadStatus?: string;
  enableUserQuotas?: boolean;
  defaultUserId?: string;
  stateFilter?: string[];
  loanTypeFilter?: string[];
  groupId?: string | null;
}) {
  const campaign = await prisma.leadCampaign.create({
    data: {
      name: data.name,
      description: data.description || null,
      vendorId: data.vendorId,
      routingTag: data.routingTag,
      distributionMethod: data.distributionMethod || 'ROUND_ROBIN',
      independentRotation: data.independentRotation ?? true,
      duplicateHandling: data.duplicateHandling || 'NONE',
      defaultLeadStatus: data.defaultLeadStatus || 'NEW',
      enableUserQuotas: data.enableUserQuotas ?? true,
      defaultUserId: data.defaultUserId || null,
      stateFilter: data.stateFilter || [],
      loanTypeFilter: data.loanTypeFilter || [],
      groupId: data.groupId ?? null,
    },
  });
  revalidatePath('/admin/leads/campaigns');
  return campaign;
}

export async function updateLeadCampaign(
  id: string,
  data: {
    name?: string;
    description?: string | null;
    vendorId?: string;
    routingTag?: string;
    active?: boolean;
    distributionMethod?: 'ROUND_ROBIN' | 'MANUAL';
    independentRotation?: boolean;
    duplicateHandling?: 'NONE' | 'REJECT' | 'ALLOW';
    defaultLeadStatus?: string;
    enableUserQuotas?: boolean;
    defaultUserId?: string | null;
    stateFilter?: string[];
    loanTypeFilter?: string[];
    groupId?: string | null;
  }
) {
  const campaign = await prisma.leadCampaign.update({ where: { id }, data });
  revalidatePath('/admin/leads/campaigns');
  return campaign;
}

/**
 * Soft-archives a campaign (sets active=false). Archived campaigns keep
 * their members, routing tag, and lead history, but no longer match
 * incoming `routing_tag` lookups in the webhook routes — so new leads
 * that used to route through this campaign will now fall to the
 * Unassigned Pool instead. Reversible via {@link restoreLeadCampaign}.
 */
export async function archiveLeadCampaign(id: string) {
  const campaign = await prisma.leadCampaign.update({
    where: { id },
    data: { active: false },
  });
  revalidatePath('/admin/leads/campaigns');
  revalidatePath('/admin/leads/vendors');
  revalidatePath('/admin/leads');
  return campaign;
}

/**
 * Un-archives a campaign. It becomes routable again and visible in the
 * default campaign list.
 */
export async function restoreLeadCampaign(id: string) {
  const campaign = await prisma.leadCampaign.update({
    where: { id },
    data: { active: true },
  });
  revalidatePath('/admin/leads/campaigns');
  revalidatePath('/admin/leads/vendors');
  revalidatePath('/admin/leads');
  return campaign;
}

/**
 * Permanently deletes a campaign. Guarded by:
 *   1. Campaign must be archived (active === false).
 *   2. Campaign must have zero leads (reassign or delete them first).
 *   3. Caller must pass the campaign name as `confirmName`.
 */
export async function hardDeleteLeadCampaign(id: string, confirmName: string) {
  const campaign = await prisma.leadCampaign.findUnique({
    where: { id },
    include: { _count: { select: { leads: true } } },
  });
  if (!campaign) throw new Error('Campaign not found');
  if (campaign.active) {
    throw new Error('Campaign must be archived before it can be permanently deleted');
  }
  if (campaign._count.leads > 0) {
    throw new Error(
      `Campaign still has ${campaign._count.leads} lead(s). Reassign or delete them first.`
    );
  }
  if (confirmName.trim() !== campaign.name) {
    throw new Error('Confirmation name does not match campaign name');
  }
  await prisma.leadCampaign.delete({ where: { id } });
  revalidatePath('/admin/leads/campaigns');
  revalidatePath('/admin/leads/vendors');
  revalidatePath('/admin/leads');
}

/**
 * Moves every lead from `sourceCampaignId` to `targetCampaignId`. Both
 * campaigns must belong to the same vendor — otherwise the lead's
 * vendorId and campaign.vendorId would disagree and downstream reports
 * would show impossible pairs.
 */
export async function reassignCampaignLeads(
  sourceCampaignId: string,
  targetCampaignId: string
) {
  if (sourceCampaignId === targetCampaignId) {
    throw new Error('Source and target campaign must be different');
  }
  const [source, target] = await Promise.all([
    prisma.leadCampaign.findUnique({
      where: { id: sourceCampaignId },
      select: { id: true, vendorId: true },
    }),
    prisma.leadCampaign.findUnique({
      where: { id: targetCampaignId },
      select: { id: true, vendorId: true },
    }),
  ]);
  if (!source || !target) throw new Error('Campaign not found');
  if (source.vendorId !== target.vendorId) {
    throw new Error('Target campaign must belong to the same vendor as the source');
  }
  const result = await prisma.lead.updateMany({
    where: { campaignId: sourceCampaignId },
    data: { campaignId: targetCampaignId },
  });
  revalidatePath('/admin/leads/campaigns');
  revalidatePath('/admin/leads');
  return { moved: result.count };
}

/**
 * Deletes all leads belonging to an archived campaign. Requires the
 * campaign to be archived first.
 */
export async function deleteAllCampaignLeads(campaignId: string) {
  const campaign = await prisma.leadCampaign.findUnique({ where: { id: campaignId } });
  if (!campaign) throw new Error('Campaign not found');
  if (campaign.active) {
    throw new Error('Campaign must be archived before bulk-deleting its leads');
  }
  const result = await prisma.lead.deleteMany({ where: { campaignId } });
  revalidatePath('/admin/leads/campaigns');
  revalidatePath('/admin/leads');
  return { deleted: result.count };
}

// ---------------------------------------------------------------------------
// Campaign Member CRUD
// ---------------------------------------------------------------------------

export async function addCampaignMember(
  campaignId: string,
  userId: string,
  opts?: {
    dailyQuota?: number;
    weeklyQuota?: number;
    monthlyQuota?: number;
    licensedStates?: string[];
  }
) {
  const maxMember = await prisma.campaignMember.findFirst({
    where: { campaignId },
    orderBy: { roundRobinPosition: 'desc' },
  });
  const member = await prisma.campaignMember.create({
    data: {
      campaignId,
      userId,
      dailyQuota: opts?.dailyQuota ?? 0,
      weeklyQuota: opts?.weeklyQuota ?? 0,
      monthlyQuota: opts?.monthlyQuota ?? 0,
      licensedStates: opts?.licensedStates ?? [],
      roundRobinPosition: (maxMember?.roundRobinPosition ?? -1) + 1,
    },
  });
  revalidatePath('/admin/leads/campaigns');
  return member;
}

export async function updateCampaignMember(
  memberId: string,
  data: {
    dailyQuota?: number;
    weeklyQuota?: number;
    monthlyQuota?: number;
    licensedStates?: string[];
    active?: boolean;
    roundRobinPosition?: number;
  }
) {
  const member = await prisma.campaignMember.update({ where: { id: memberId }, data });
  revalidatePath('/admin/leads/campaigns');
  return member;
}

export async function removeCampaignMember(memberId: string) {
  await prisma.campaignMember.delete({ where: { id: memberId } });
  revalidatePath('/admin/leads/campaigns');
}

/**
 * Input shape for setCampaignMembers. Callers can pass either a bare
 * array of userIds (legacy) or an array of richer objects when they
 * want to set per-member fields like `dailyQuota` at the same time
 * as syncing membership.
 */
export type CampaignMemberInput = {
  userId: string;
  dailyQuota?: number;
};

export async function setCampaignMembers(
  campaignId: string,
  members: string[] | CampaignMemberInput[]
) {
  // Normalize both input shapes to CampaignMemberInput[] once so the
  // diff logic below never has to branch on the shape.
  const normalized: CampaignMemberInput[] = members.map((m) =>
    typeof m === 'string' ? { userId: m } : m
  );

  const existing = await prisma.campaignMember.findMany({
    where: { campaignId },
    select: {
      id: true,
      userId: true,
      roundRobinPosition: true,
      dailyQuota: true,
    },
  });
  const existingByUserId = new Map(existing.map((m) => [m.userId, m]));
  const targetUserIds = new Set(normalized.map((m) => m.userId));

  const toRemove = existing.filter((m) => !targetUserIds.has(m.userId));
  const toAdd = normalized.filter((m) => !existingByUserId.has(m.userId));
  // Rows we keep — update dailyQuota only when the caller supplied a
  // value that actually differs. Skipping no-op writes keeps the
  // transaction lean.
  const toUpdate = normalized.flatMap((m) => {
    const prev = existingByUserId.get(m.userId);
    if (!prev) return [];
    if (m.dailyQuota === undefined) return [];
    const next = Math.max(0, Math.trunc(m.dailyQuota));
    if (prev.dailyQuota === next) return [];
    return [{ memberId: prev.id, dailyQuota: next }];
  });

  let maxPos = existing.reduce(
    (max, m) => Math.max(max, m.roundRobinPosition),
    -1
  );

  await prisma.$transaction([
    ...(toRemove.length > 0
      ? [
          prisma.campaignMember.deleteMany({
            where: { id: { in: toRemove.map((m) => m.id) } },
          }),
        ]
      : []),
    ...toAdd.map((m) => {
      maxPos += 1;
      return prisma.campaignMember.create({
        data: {
          campaignId,
          userId: m.userId,
          roundRobinPosition: maxPos,
          dailyQuota:
            m.dailyQuota === undefined
              ? 0
              : Math.max(0, Math.trunc(m.dailyQuota)),
        },
      });
    }),
    ...toUpdate.map((u) =>
      prisma.campaignMember.update({
        where: { id: u.memberId },
        data: { dailyQuota: u.dailyQuota },
      })
    ),
  ]);

  revalidatePath('/admin/leads/campaigns');
  revalidatePath('/admin/leads/users');
}

// ---------------------------------------------------------------------------
// Lead Campaign Groups
// ---------------------------------------------------------------------------

// Palette keys accepted for a group's accent color. Keep in sync with the
// chip palette rendered by CampaignGroupManager. Unknown values fall back
// to 'blue' at render time.
const ALLOWED_GROUP_COLORS = [
  'blue',
  'violet',
  'emerald',
  'amber',
  'rose',
  'cyan',
  'fuchsia',
  'slate',
] as const;
type LeadCampaignGroupColor = (typeof ALLOWED_GROUP_COLORS)[number];

function normalizeGroupColor(color: string | undefined | null): LeadCampaignGroupColor {
  if (color && (ALLOWED_GROUP_COLORS as readonly string[]).includes(color)) {
    return color as LeadCampaignGroupColor;
  }
  return 'blue';
}

export async function getLeadCampaignGroups() {
  const groups = await prisma.leadCampaignGroup.findMany({
    orderBy: [{ active: 'desc' }, { name: 'asc' }],
    include: {
      _count: { select: { campaigns: true } },
      campaigns: {
        where: { active: true },
        select: { id: true, _count: { select: { members: true } } },
      },
    },
  });
  // memberAssignments = total CampaignMember rows across the group's active
  // campaigns. Not deduped on userId because Prisma can't easily count
  // distinct joined users without a raw query; the chip label makes the
  // semantics clear ("N assignments") so dupes are acceptable.
  return groups.map((g) => ({
    id: g.id,
    name: g.name,
    description: g.description,
    color: g.color,
    active: g.active,
    createdAt: g.createdAt,
    updatedAt: g.updatedAt,
    campaignCount: g._count.campaigns,
    memberAssignments: g.campaigns.reduce(
      (sum, c) => sum + c._count.members,
      0
    ),
  }));
}

export async function getLeadCampaignGroup(id: string) {
  return prisma.leadCampaignGroup.findUnique({
    where: { id },
    include: {
      campaigns: {
        orderBy: [{ active: 'desc' }, { name: 'asc' }],
        select: {
          id: true,
          name: true,
          active: true,
          routingTag: true,
          vendor: { select: { id: true, name: true } },
          _count: { select: { members: true, leads: true } },
        },
      },
    },
  });
}

export async function createLeadCampaignGroup(data: {
  name: string;
  description?: string | null;
  color?: string;
}) {
  const name = data.name.trim();
  if (!name) throw new Error('Group name is required');
  const group = await prisma.leadCampaignGroup.create({
    data: {
      name,
      description: data.description?.trim() || null,
      color: normalizeGroupColor(data.color),
    },
  });
  revalidatePath('/admin/leads/campaigns');
  return group;
}

export async function updateLeadCampaignGroup(
  id: string,
  data: { name?: string; description?: string | null; color?: string }
) {
  const patch: Record<string, unknown> = {};
  if (typeof data.name === 'string') {
    const trimmed = data.name.trim();
    if (!trimmed) throw new Error('Group name cannot be empty');
    patch.name = trimmed;
  }
  if (data.description !== undefined) {
    patch.description = data.description?.trim() || null;
  }
  if (typeof data.color === 'string') {
    patch.color = normalizeGroupColor(data.color);
  }
  const group = await prisma.leadCampaignGroup.update({ where: { id }, data: patch });
  revalidatePath('/admin/leads/campaigns');
  return group;
}

export async function archiveLeadCampaignGroup(id: string) {
  const group = await prisma.leadCampaignGroup.update({
    where: { id },
    data: { active: false },
  });
  revalidatePath('/admin/leads/campaigns');
  return group;
}

export async function restoreLeadCampaignGroup(id: string) {
  const group = await prisma.leadCampaignGroup.update({
    where: { id },
    data: { active: true },
  });
  revalidatePath('/admin/leads/campaigns');
  return group;
}

/**
 * Hard-deletes a group. Campaigns that were in this group are preserved
 * (FK is ON DELETE SET NULL). Requires the caller to pass the exact name
 * as a typo guard, mirroring hardDeleteLeadCampaign.
 */
export async function hardDeleteLeadCampaignGroup(id: string, confirmName: string) {
  const group = await prisma.leadCampaignGroup.findUnique({ where: { id } });
  if (!group) throw new Error('Group not found');
  if (confirmName.trim() !== group.name) {
    throw new Error('Confirmation name does not match group name');
  }
  await prisma.leadCampaignGroup.delete({ where: { id } });
  revalidatePath('/admin/leads/campaigns');
}

/**
 * Sets the exact set of campaigns that belong to a group. Any campaign
 * previously in the group that isn't in `campaignIds` has its groupId
 * cleared; any campaign in `campaignIds` has its groupId set to this
 * group. Runs as a single transaction so the group membership is never
 * half-applied.
 */
export async function setGroupCampaigns(
  groupId: string,
  campaignIds: string[]
) {
  const group = await prisma.leadCampaignGroup.findUnique({
    where: { id: groupId },
    select: { id: true },
  });
  if (!group) throw new Error('Group not found');

  const targetIds = Array.from(new Set(campaignIds));

  await prisma.$transaction([
    // Clear any campaigns currently in this group that aren't in the new set.
    prisma.leadCampaign.updateMany({
      where: {
        groupId,
        ...(targetIds.length > 0 ? { id: { notIn: targetIds } } : {}),
      },
      data: { groupId: null },
    }),
    // Assign the new set to this group. Safe to set groupId unconditionally;
    // even campaigns already in this group are a no-op.
    ...(targetIds.length > 0
      ? [
          prisma.leadCampaign.updateMany({
            where: { id: { in: targetIds } },
            data: { groupId },
          }),
        ]
      : []),
  ]);

  revalidatePath('/admin/leads/campaigns');
}

/**
 * Merge-only bulk user add. For every campaign in the group, adds each
 * `userId` as a CampaignMember if they aren't already a member. Existing
 * members, quotas, and roundRobinPosition are left untouched. Duplicate
 * inserts are prevented by the unique (campaignId, userId) constraint
 * plus a pre-check per campaign.
 *
 * Returns a summary so the UI can tell the admin how many new assignments
 * were created.
 */
export async function addUsersToGroupCampaigns(
  groupId: string,
  userIds: string[]
): Promise<{
  campaignCount: number;
  userCount: number;
  totalAdded: number;
  skippedAlreadyMember: number;
}> {
  if (userIds.length === 0) {
    return { campaignCount: 0, userCount: 0, totalAdded: 0, skippedAlreadyMember: 0 };
  }
  const group = await prisma.leadCampaignGroup.findUnique({
    where: { id: groupId },
    include: {
      campaigns: {
        select: {
          id: true,
          members: { select: { userId: true, roundRobinPosition: true } },
        },
      },
    },
  });
  if (!group) throw new Error('Group not found');

  const uniqueUserIds = Array.from(new Set(userIds));
  const operations: Array<ReturnType<typeof prisma.campaignMember.create>> = [];
  let totalAdded = 0;
  let skipped = 0;

  for (const campaign of group.campaigns) {
    const existingUserIds = new Set(campaign.members.map((m) => m.userId));
    let maxPos = campaign.members.reduce(
      (max, m) => Math.max(max, m.roundRobinPosition),
      -1
    );
    for (const userId of uniqueUserIds) {
      if (existingUserIds.has(userId)) {
        skipped += 1;
        continue;
      }
      maxPos += 1;
      operations.push(
        prisma.campaignMember.create({
          data: { campaignId: campaign.id, userId, roundRobinPosition: maxPos },
        })
      );
      totalAdded += 1;
    }
  }

  if (operations.length > 0) {
    await prisma.$transaction(operations);
  }

  revalidatePath('/admin/leads/campaigns');
  revalidatePath('/admin/leads/users');

  return {
    campaignCount: group.campaigns.length,
    userCount: uniqueUserIds.length,
    totalAdded,
    skippedAlreadyMember: skipped,
  };
}

// ---------------------------------------------------------------------------
// Lead User Teams
// ---------------------------------------------------------------------------
//
// Teams are a pure UX shortcut for Campaign assignment. Selecting a team
// in the Campaign edit modal batch-toggles its users into the selection
// list — it does NOT affect distribution, quotas, or routing. Membership
// is many-to-many, and a user can sit on any number of teams.

const ALLOWED_TEAM_COLORS = ALLOWED_GROUP_COLORS; // same palette as CampaignGroupManager
type LeadUserTeamColor = (typeof ALLOWED_TEAM_COLORS)[number];

function normalizeTeamColor(color: string | undefined | null): LeadUserTeamColor {
  if (color && (ALLOWED_TEAM_COLORS as readonly string[]).includes(color)) {
    return color as LeadUserTeamColor;
  }
  return 'blue';
}

function revalidateTeamPaths() {
  revalidatePath('/admin/leads/users');
  revalidatePath('/admin/leads/campaigns');
}

export type LeadUserTeamSummary = {
  id: string;
  name: string;
  description: string | null;
  color: string;
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
  memberCount: number;
  memberIds: string[];
};

export async function getLeadUserTeams(): Promise<LeadUserTeamSummary[]> {
  const teams = await prisma.leadUserTeam.findMany({
    orderBy: [{ active: 'desc' }, { name: 'asc' }],
    include: {
      members: { select: { userId: true } },
    },
  });
  return teams.map((t) => ({
    id: t.id,
    name: t.name,
    description: t.description,
    color: t.color,
    active: t.active,
    createdAt: t.createdAt,
    updatedAt: t.updatedAt,
    memberCount: t.members.length,
    memberIds: t.members.map((m) => m.userId),
  }));
}

export async function createLeadUserTeam(data: {
  name: string;
  description?: string | null;
  color?: string;
  memberUserIds?: string[];
}) {
  const name = data.name.trim();
  if (!name) throw new Error('Team name is required');

  const uniqueMemberIds = Array.from(new Set(data.memberUserIds ?? []));

  const team = await prisma.leadUserTeam.create({
    data: {
      name,
      description: data.description?.trim() || null,
      color: normalizeTeamColor(data.color),
      members:
        uniqueMemberIds.length > 0
          ? {
              create: uniqueMemberIds.map((userId) => ({ userId })),
            }
          : undefined,
    },
  });
  revalidateTeamPaths();
  return team;
}

export async function updateLeadUserTeam(
  id: string,
  data: { name?: string; description?: string | null; color?: string }
) {
  const patch: Record<string, unknown> = {};
  if (typeof data.name === 'string') {
    const trimmed = data.name.trim();
    if (!trimmed) throw new Error('Team name cannot be empty');
    patch.name = trimmed;
  }
  if (data.description !== undefined) {
    patch.description = data.description?.trim() || null;
  }
  if (typeof data.color === 'string') {
    patch.color = normalizeTeamColor(data.color);
  }
  const team = await prisma.leadUserTeam.update({ where: { id }, data: patch });
  revalidateTeamPaths();
  return team;
}

/**
 * Diff-based replacement of a team's members. Mirrors setCampaignMembers:
 * compute add/remove sets and issue both operations in a single
 * transaction so the team roster is never half-applied.
 */
export async function setLeadUserTeamMembers(teamId: string, userIds: string[]) {
  const team = await prisma.leadUserTeam.findUnique({
    where: { id: teamId },
    select: { id: true },
  });
  if (!team) throw new Error('Team not found');

  const targetUserIds = Array.from(new Set(userIds));
  const existing = await prisma.leadUserTeamMember.findMany({
    where: { teamId },
    select: { id: true, userId: true },
  });
  const existingUserIds = new Set(existing.map((m) => m.userId));
  const targetSet = new Set(targetUserIds);

  const toRemove = existing.filter((m) => !targetSet.has(m.userId));
  const toAdd = targetUserIds.filter((uid) => !existingUserIds.has(uid));

  await prisma.$transaction([
    ...(toRemove.length > 0
      ? [
          prisma.leadUserTeamMember.deleteMany({
            where: { id: { in: toRemove.map((m) => m.id) } },
          }),
        ]
      : []),
    ...toAdd.map((userId) =>
      prisma.leadUserTeamMember.create({ data: { teamId, userId } })
    ),
  ]);

  revalidateTeamPaths();
}

/**
 * Hard delete — teams are purely cosmetic, they don't own any
 * distribution-affecting rows, so permanent deletion is safe. No typo
 * guard (unlike hardDeleteLeadCampaignGroup) since there is no
 * downstream data to lose.
 */
export async function deleteLeadUserTeam(id: string) {
  const team = await prisma.leadUserTeam.findUnique({ where: { id } });
  if (!team) throw new Error('Team not found');
  await prisma.leadUserTeam.delete({ where: { id } });
  revalidateTeamPaths();
}

// ---------------------------------------------------------------------------
// Lead CRUD
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Shared lead list filter + sort helpers
// ---------------------------------------------------------------------------

export type LeadListFilters = {
  status?: LeadStatus;
  assignedUserId?: string;
  unassigned?: boolean;
  campaignId?: string;
  vendorId?: string;
  propertyState?: string;
  source?: string;
  dateFrom?: string;
  dateTo?: string;
  search?: string;
  // Extended filters (free-text contains on string columns)
  loanPurpose?: string;
  loanType?: string;
  propertyType?: string;
  propertyUse?: string;
  propertyCity?: string;
  propertyZip?: string;
  employer?: string;
};

// Fields included in global free-text search. Because every lead field is
// stored as a nullable String in the schema, substring matching works
// uniformly across contact, property, loan, and employment data.
const LEAD_SEARCH_FIELDS = [
  'firstName',
  'lastName',
  'email',
  'phone',
  'homePhone',
  'workPhone',
  'coFirstName',
  'coLastName',
  'coEmail',
  'coPhone',
  'propertyAddress',
  'propertyCity',
  'propertyZip',
  'propertyCounty',
  'propertyType',
  'propertyUse',
  'propertyValue',
  'purchasePrice',
  'loanPurpose',
  'loanAmount',
  'loanType',
  'loanRate',
  'creditRating',
  'downPayment',
  'cashOut',
  'currentLender',
  'currentBalance',
  'employer',
  'jobTitle',
  'source',
  'vendorLeadId',
  'vendorUserId',
] as const;

function buildLeadWhere(filters?: LeadListFilters): Record<string, unknown> {
  const where: Record<string, unknown> = {};
  if (!filters) return where;
  if (filters.status) where.status = filters.status;
  if (filters.unassigned) where.assignedUserId = null;
  else if (filters.assignedUserId) where.assignedUserId = filters.assignedUserId;
  if (filters.campaignId) where.campaignId = filters.campaignId;
  if (filters.vendorId) where.vendorId = filters.vendorId;
  if (filters.propertyState) {
    where.propertyState = { contains: filters.propertyState, mode: 'insensitive' };
  }
  if (filters.source) {
    where.source = { contains: filters.source, mode: 'insensitive' };
  }
  if (filters.loanPurpose) {
    where.loanPurpose = { contains: filters.loanPurpose, mode: 'insensitive' };
  }
  if (filters.loanType) {
    where.loanType = { contains: filters.loanType, mode: 'insensitive' };
  }
  if (filters.propertyType) {
    where.propertyType = { contains: filters.propertyType, mode: 'insensitive' };
  }
  if (filters.propertyUse) {
    where.propertyUse = { contains: filters.propertyUse, mode: 'insensitive' };
  }
  if (filters.propertyCity) {
    where.propertyCity = { contains: filters.propertyCity, mode: 'insensitive' };
  }
  if (filters.propertyZip) {
    where.propertyZip = { contains: filters.propertyZip, mode: 'insensitive' };
  }
  if (filters.employer) {
    where.employer = { contains: filters.employer, mode: 'insensitive' };
  }
  if (filters.dateFrom || filters.dateTo) {
    const receivedAt: Record<string, Date> = {};
    if (filters.dateFrom) receivedAt.gte = new Date(filters.dateFrom);
    if (filters.dateTo) {
      const end = new Date(filters.dateTo);
      end.setHours(23, 59, 59, 999);
      receivedAt.lte = end;
    }
    where.receivedAt = receivedAt;
  }
  const q = filters.search?.trim();
  if (q) {
    where.OR = LEAD_SEARCH_FIELDS.map((field) => ({
      [field]: { contains: q, mode: 'insensitive' },
    }));
  }
  return where;
}

// Whitelisted sort keys exposed to the UI. Each maps to a Prisma orderBy
// expression. Nested relation sorts translate into SQL joins.
export type LeadSortKey =
  | 'receivedAt'
  | 'status'
  | 'firstName'
  | 'lastName'
  | 'email'
  | 'phone'
  | 'propertyState'
  | 'vendor'
  | 'campaign'
  | 'assignedUser'
  | 'source'
  | 'loanAmount'
  | 'loanPurpose'
  | 'loanType'
  | 'propertyValue'
  | 'propertyCity';

export type LeadSortDirection = 'asc' | 'desc';

function buildLeadOrderBy(
  sortBy?: LeadSortKey,
  sortDir?: LeadSortDirection
): Record<string, unknown> | Array<Record<string, unknown>> {
  const dir: LeadSortDirection = sortDir === 'asc' ? 'asc' : 'desc';
  switch (sortBy) {
    case 'firstName':
      return [{ firstName: dir }, { lastName: dir }];
    case 'lastName':
      return [{ lastName: dir }, { firstName: dir }];
    case 'email':
      return { email: dir };
    case 'phone':
      return { phone: dir };
    case 'status':
      return { status: dir };
    case 'propertyState':
      return { propertyState: dir };
    case 'vendor':
      return { vendor: { name: dir } };
    case 'campaign':
      return { campaign: { name: dir } };
    case 'assignedUser':
      return { assignedUser: { name: dir } };
    case 'source':
      return { source: dir };
    case 'loanAmount':
      return { loanAmount: dir };
    case 'loanPurpose':
      return { loanPurpose: dir };
    case 'loanType':
      return { loanType: dir };
    case 'propertyValue':
      return { propertyValue: dir };
    case 'propertyCity':
      return { propertyCity: dir };
    case 'receivedAt':
    default:
      return { receivedAt: dir };
  }
}

export async function getLeads(
  filters?: LeadListFilters & {
    take?: number;
    skip?: number;
    sortBy?: LeadSortKey;
    sortDir?: LeadSortDirection;
    // When true, skip the (potentially expensive) COUNT(*) and return
    // total: -1. Callers that are just paging through an already-counted
    // filter set (Next Page / Prev Page) should pass this to avoid a
    // full-table count on each click now that the table is ~100k+ rows.
    skipCount?: boolean;
  }
) {
  const where = buildLeadWhere(filters);
  const orderBy = buildLeadOrderBy(filters?.sortBy, filters?.sortDir);

  // The notes _count include was forcing a LATERAL subquery per row even
  // though the CRM never rendered it. At PAGE_SIZE=200 that's 200 extra
  // round-trips per list load. Drop it from the default list payload.
  const listArgs = {
    where,
    include: {
      vendor: { select: { id: true, name: true } },
      campaign: { select: { id: true, name: true } },
      assignedUser: { select: { id: true, name: true } },
    },
    orderBy: orderBy as never,
    take: filters?.take ?? 100,
    skip: filters?.skip ?? 0,
  };

  if (filters?.skipCount) {
    const leads = await prisma.lead.findMany(listArgs);
    return { leads, total: -1 };
  }

  const [leads, total] = await prisma.$transaction([
    prisma.lead.findMany(listArgs),
    prisma.lead.count({ where }),
  ]);

  return { leads, total };
}

export async function getAllLeadIds(
  filters?: LeadListFilters & {
    sortBy?: LeadSortKey;
    sortDir?: LeadSortDirection;
  }
) {
  const session = await getServerSession(authOptions);
  const role = session?.user?.role;
  const userId = session?.user?.id;
  if (!userId) throw new Error('Unauthorized');

  const isAdmin = role === UserRole.ADMIN || role === UserRole.MANAGER;
  const where = buildLeadWhere(
    isAdmin ? filters : { ...filters, assignedUserId: userId }
  );
  const orderBy = buildLeadOrderBy(filters?.sortBy, filters?.sortDir);
  const rows = await prisma.lead.findMany({
    where,
    select: { id: true },
    orderBy: orderBy as never,
  });
  return rows.map((r) => r.id);
}

export async function getLeadsForExport(leadIds: string[]) {
  if (leadIds.length === 0) return [];
  const session = await getServerSession(authOptions);
  const role = session?.user?.role;
  const userId = session?.user?.id;
  if (!userId) throw new Error('Unauthorized');

  const isAdmin = role === UserRole.ADMIN || role === UserRole.MANAGER;
  // LOs can only export their own leads — silently drop foreign ids so
  // the CSV reflects exactly what they're allowed to see.
  const ids = isAdmin ? leadIds : await filterLeadsOwnedByUser(leadIds, userId);
  if (ids.length === 0) return [];

  return prisma.lead.findMany({
    where: { id: { in: ids } },
    include: {
      vendor: { select: { name: true } },
      campaign: { select: { name: true } },
      assignedUser: { select: { name: true } },
    },
    orderBy: { receivedAt: 'desc' },
  });
}

export async function getLead(id: string) {
  const session = await getServerSession(authOptions);
  const role = session?.user?.role;
  const userId = session?.user?.id;
  if (!userId) throw new Error('Unauthorized');

  const lead = await prisma.lead.findUnique({
    where: { id },
    include: {
      vendor: { select: { id: true, name: true } },
      campaign: { select: { id: true, name: true } },
      assignedUser: { select: { id: true, name: true } },
      notes: {
        include: { author: { select: { id: true, name: true } } },
        orderBy: { createdAt: 'desc' },
      },
    },
  });
  if (!lead) return null;

  const isAdmin = role === UserRole.ADMIN || role === UserRole.MANAGER;
  if (!isAdmin && lead.assignedUserId !== userId) {
    // Don't leak existence of the lead via a distinct error message.
    return null;
  }
  return lead;
}

export async function updateLeadStatus(leadId: string, status: LeadStatus) {
  const session = await getServerSession(authOptions);
  const userId = session?.user?.id;
  const role = session?.user?.role;
  if (!userId) throw new Error('Unauthorized');

  const isAdmin = role === UserRole.ADMIN || role === UserRole.MANAGER;
  if (!isAdmin) await assertLeadBelongsTo(userId, leadId);

  const prev = await prisma.lead.findUnique({
    where: { id: leadId },
    select: { status: true },
  });
  await prisma.lead.update({ where: { id: leadId }, data: { status } });
  if (prev && prev.status !== status) {
    void runServiceTriggers(leadId, IntegrationServiceTrigger.ON_STATUS_CHANGE, {
      previousStatus: prev.status,
      newStatus: status,
    });
  }
  revalidatePath('/leads');
  revalidatePath('/admin/leads');
  revalidatePath('/admin/leads/all');
}

export async function updateLeadFields(
  leadId: string,
  fields: Record<string, string | null>
) {
  const session = await getServerSession(authOptions);
  const userId = session?.user?.id;
  const role = session?.user?.role;
  if (!userId) throw new Error('Unauthorized');

  const isAdmin = role === UserRole.ADMIN || role === UserRole.MANAGER;
  if (!isAdmin) await assertLeadBelongsTo(userId, leadId);

  const allowedFields = new Set([
    'firstName', 'lastName', 'email', 'phone', 'homePhone', 'workPhone', 'dob', 'ssn',
    'coFirstName', 'coLastName', 'coEmail', 'coPhone', 'coHomePhone', 'coWorkPhone', 'coDob',
    'mailingAddress', 'mailingCity', 'mailingState', 'mailingZip', 'mailingCounty',
    'propertyAddress', 'propertyCity', 'propertyState', 'propertyZip', 'propertyCounty',
    'purchasePrice', 'propertyValue', 'propertyType', 'propertyUse', 'propertyLtv',
    'employer', 'jobTitle', 'income', 'selfEmployed', 'bankruptcy', 'foreclosure', 'homeowner',
    'coEmployer', 'coJobTitle', 'coIncome',
    'loanPurpose', 'loanAmount', 'loanTerm', 'loanType', 'loanRate',
    'downPayment', 'cashOut', 'creditRating',
    'currentLender', 'currentBalance', 'currentRate', 'currentPayment', 'currentTerm', 'currentType',
    'otherBalance', 'otherPayment', 'targetRate',
    'vaStatus', 'vaLoan', 'isMilitary', 'fhaLoan', 'sourceUrl', 'source', 'leadCreated', 'price',
  ]);

  const data: Record<string, string | null> = {};
  for (const [key, value] of Object.entries(fields)) {
    if (allowedFields.has(key)) {
      data[key] = value && value.trim() !== '' ? value.trim() : null;
    }
  }

  if (Object.keys(data).length === 0) return;

  await prisma.lead.update({ where: { id: leadId }, data });
  revalidatePath('/leads');
  revalidatePath('/admin/leads');
  revalidatePath('/admin/leads/all');
}

export async function assignLead(leadId: string, userId: string) {
  await prisma.lead.update({
    where: { id: leadId },
    data: {
      assignedUserId: userId,
      assignedAt: new Date(),
      status: LeadStatus.NEW,
    },
  });
  await createLeadNotification(userId, { id: leadId }, 'Manual Assignment');
  void forwardLeadToBonzo(leadId, userId);
  void runServiceTriggers(leadId, IntegrationServiceTrigger.ON_ASSIGN);
  void runServiceTriggers(
    leadId,
    IntegrationServiceTrigger.DELAY_AFTER_ASSIGN
  );
  revalidatePath('/leads');
  revalidatePath('/admin/leads');
  revalidatePath('/admin/leads/all');
}

export async function bulkAssignLeads(leadIds: string[], userId: string) {
  await prisma.lead.updateMany({
    where: { id: { in: leadIds } },
    data: {
      assignedUserId: userId,
      assignedAt: new Date(),
      status: LeadStatus.NEW,
    },
  });
  for (const leadId of leadIds) {
    void forwardLeadToBonzo(leadId, userId);
    void runServiceTriggers(leadId, IntegrationServiceTrigger.ON_ASSIGN);
    void runServiceTriggers(
      leadId,
      IntegrationServiceTrigger.DELAY_AFTER_ASSIGN
    );
  }
  revalidatePath('/leads');
  revalidatePath('/admin/leads');
  revalidatePath('/admin/leads/all');
}

/**
 * Move a batch of unassigned leads onto a different vendor/campaign.
 *
 * Used from the Unassigned Lead Pool when an admin realizes a lead was
 * ingested under the wrong routing (e.g. wrong webhook URL) and wants
 * to redirect it before distribution happens.
 *
 * Picking a campaign is enough to set both fields - the chosen campaign's
 * vendor is what we write to `lead.vendorId`, keeping the pair
 * internally consistent (same rule `reassignCampaignLeads` already
 * relies on).
 *
 * Scope is intentionally limited to `UNASSIGNED` leads:
 *   - prevents accidentally rewriting routing on leads that already went
 *     out to a loan officer / Bonzo,
 *   - avoids having to re-forward to Bonzo or re-run quota counters.
 */
export async function bulkReassignLeadsToCampaign(
  leadIds: string[],
  campaignId: string
): Promise<{ count: number; vendorName: string; campaignName: string }> {
  if (leadIds.length === 0) {
    throw new Error('No leads selected');
  }
  if (!campaignId) {
    throw new Error('No campaign selected');
  }

  const campaign = await prisma.leadCampaign.findUnique({
    where: { id: campaignId },
    select: {
      id: true,
      name: true,
      active: true,
      vendor: { select: { id: true, name: true } },
    },
  });

  if (!campaign) {
    throw new Error('Selected campaign not found');
  }
  if (!campaign.active) {
    // Let the admin reroute to archived campaigns in case they're
    // rebuilding history, but surface the intent explicitly so the
    // frontend can confirm.
    // (Soft-block omitted: the pool UI never shows archived campaigns
    // in its picker, so reaching this branch implies a direct API call.)
  }

  const result = await prisma.lead.updateMany({
    where: {
      id: { in: leadIds },
      status: LeadStatus.UNASSIGNED,
    },
    data: {
      vendorId: campaign.vendor.id,
      campaignId: campaign.id,
    },
  });

  revalidatePath('/admin/leads/pool');
  revalidatePath('/admin/leads');
  revalidatePath('/admin/leads/all');

  return {
    count: result.count,
    vendorName: campaign.vendor.name,
    campaignName: campaign.name,
  };
}

export async function bulkUpdateLeadStatus(
  leadIds: string[],
  status: LeadStatus
): Promise<{ updated: number; requested: number }> {
  const session = await getServerSession(authOptions);
  const role = session?.user?.role;
  const userId = session?.user?.id;
  if (!userId) throw new Error('Unauthorized');

  const isAdmin = role === UserRole.ADMIN || role === UserRole.MANAGER;
  const ids = isAdmin ? leadIds : await filterLeadsOwnedByUser(leadIds, userId);
  if (ids.length === 0) {
    return { updated: 0, requested: leadIds.length };
  }

  const result = await prisma.lead.updateMany({
    where: { id: { in: ids } },
    data: { status },
  });
  revalidatePath('/leads');
  revalidatePath('/admin/leads');
  revalidatePath('/admin/leads/all');
  return { updated: result.count, requested: leadIds.length };
}

export async function bulkDeleteLeads(leadIds: string[]) {
  await prisma.$transaction([
    prisma.leadNote.deleteMany({ where: { leadId: { in: leadIds } } }),
    prisma.lead.deleteMany({ where: { id: { in: leadIds } } }),
  ]);
  revalidatePath('/leads');
  revalidatePath('/admin/leads');
  revalidatePath('/admin/leads/all');
  revalidatePath('/admin/leads/pool');
}

export async function bulkDeleteLeadsBatch(leadIds: string[]) {
  await prisma.$transaction([
    prisma.leadNote.deleteMany({ where: { leadId: { in: leadIds } } }),
    prisma.lead.deleteMany({ where: { id: { in: leadIds } } }),
  ]);
  return { deleted: leadIds.length };
}

export async function getDistinctLeadSources(opts: { assignedUserId?: string } = {}) {
  const where: Prisma.LeadWhereInput = { source: { not: null } };
  if (opts.assignedUserId) where.assignedUserId = opts.assignedUserId;
  const results = await prisma.lead.findMany({
    where,
    select: { source: true },
    distinct: ['source'],
    orderBy: { source: 'asc' },
  });
  return results.map((r) => r.source).filter(Boolean) as string[];
}

export async function addLeadNote(leadId: string, content: string) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) throw new Error('Unauthorized');

  const note = await prisma.leadNote.create({
    data: { leadId, authorId: session.user.id, content },
  });
  revalidatePath('/leads');
  return note;
}

// ---------------------------------------------------------------------------
// Dashboard stats
// ---------------------------------------------------------------------------

export async function getLeadDashboardStats() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const [totalToday, unassigned, byVendor, byCampaign, recentLeads] = await prisma.$transaction([
    prisma.lead.count({ where: { receivedAt: { gte: today } } }),
    prisma.lead.count({ where: { status: LeadStatus.UNASSIGNED } }),
    prisma.lead.groupBy({
      by: ['vendorId'],
      orderBy: { vendorId: 'asc' },
      _count: { id: true },
      where: { receivedAt: { gte: today } },
    }),
    prisma.lead.groupBy({
      by: ['campaignId'],
      orderBy: { campaignId: 'asc' },
      _count: { id: true },
      where: { receivedAt: { gte: today } },
    }),
    prisma.lead.findMany({
      take: 20,
      orderBy: { receivedAt: 'desc' },
      include: {
        vendor: { select: { name: true } },
        campaign: { select: { name: true } },
        assignedUser: { select: { name: true } },
      },
    }),
  ]);

  return { totalToday, unassigned, byVendor, byCampaign, recentLeads };
}

export async function getLeadCrmStats(opts: { assignedUserId?: string } = {}) {
  const now = new Date();

  const todayStart = new Date(now);
  todayStart.setHours(0, 0, 0, 0);

  const weekStart = new Date(now);
  weekStart.setDate(weekStart.getDate() - weekStart.getDay() + 1);
  weekStart.setHours(0, 0, 0, 0);
  if (weekStart > now) weekStart.setDate(weekStart.getDate() - 7);

  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

  // LO scoping: every count and groupBy is narrowed to this user's leads
  // so the stat cards and vendor/campaign breakdowns reflect only what
  // they own. Admins pass no filter and get the company-wide numbers.
  const scope: Prisma.LeadWhereInput = opts.assignedUserId
    ? { assignedUserId: opts.assignedUserId }
    : {};

  const [
    totalLeads,
    newToday,
    newThisWeek,
    newThisMonth,
    unassigned,
    vendorGroupsAll,
    campaignGroupsAll,
  ] = await prisma.$transaction([
    prisma.lead.count({ where: scope }),
    prisma.lead.count({ where: { ...scope, receivedAt: { gte: todayStart } } }),
    prisma.lead.count({ where: { ...scope, receivedAt: { gte: weekStart } } }),
    prisma.lead.count({ where: { ...scope, receivedAt: { gte: monthStart } } }),
    prisma.lead.count({
      where: opts.assignedUserId
        ? { assignedUserId: opts.assignedUserId, status: LeadStatus.UNASSIGNED }
        : { status: LeadStatus.UNASSIGNED },
    }),
    prisma.lead.groupBy({
      by: ['vendorId'],
      _count: { id: true },
      where: scope,
      orderBy: { _count: { id: 'desc' } },
    }),
    // All-time campaign volume (mirrors byVendor window) so every active
    // campaign surfaces regardless of whether it received a lead today.
    prisma.lead.groupBy({
      by: ['campaignId'],
      _count: { id: true },
      where: { ...scope, campaignId: { not: null } },
      orderBy: { _count: { id: 'desc' } },
    }),
  ]);

  const vendorIds = vendorGroupsAll.map((v) => v.vendorId);
  const vendors = await prisma.leadVendor.findMany({
    where: { id: { in: vendorIds } },
    select: { id: true, name: true },
  });
  const vendorMap = new Map(vendors.map((v) => [v.id, v.name]));

  const campaignIds = campaignGroupsAll
    .map((c) => c.campaignId)
    .filter(Boolean) as string[];
  const campaigns = await prisma.leadCampaign.findMany({
    where: { id: { in: campaignIds } },
    select: { id: true, name: true, vendor: { select: { name: true } } },
  });
  const campaignMap = new Map(
    campaigns.map((c) => [c.id, { name: c.name, vendorName: c.vendor.name }])
  );

  return {
    totalLeads,
    newToday,
    newThisWeek,
    newThisMonth,
    unassigned,
    byVendor: vendorGroupsAll.map((v) => {
      const cnt = v._count;
      return {
        vendorId: v.vendorId,
        vendorName: vendorMap.get(v.vendorId) || 'Unknown',
        count: typeof cnt === 'object' && cnt !== null ? (cnt.id ?? 0) : 0,
      };
    }),
    byCampaign: campaignGroupsAll
      .filter((c) => c.campaignId)
      .map((c) => {
        const cnt = c._count;
        return {
          campaignId: c.campaignId!,
          campaignName: campaignMap.get(c.campaignId!)?.name || 'Unknown',
          vendorName: campaignMap.get(c.campaignId!)?.vendorName || 'Unknown',
          count: typeof cnt === 'object' && cnt !== null ? (cnt.id ?? 0) : 0,
        };
      }),
  };
}

// ---------------------------------------------------------------------------
// User helpers for admin pages
// ---------------------------------------------------------------------------

export async function getLeadEligibleUsers() {
  return prisma.user.findMany({
    where: {
      active: true,
      role: { in: [UserRole.LOAN_OFFICER, UserRole.LOA, UserRole.MANAGER] },
    },
    select: { id: true, name: true, email: true, role: true },
    orderBy: { name: 'asc' },
  });
}

// ---------------------------------------------------------------------------
// User management for leads
// ---------------------------------------------------------------------------

export async function getLeadUsers() {
  const now = new Date();
  const todayStart = new Date(now);
  todayStart.setHours(0, 0, 0, 0);

  // Week = Sunday 00:00 of the current week (local time)
  const weekStart = new Date(todayStart);
  weekStart.setDate(weekStart.getDate() - weekStart.getDay());

  // Month = 1st of current month, 00:00 (local time)
  const monthStart = new Date(todayStart.getFullYear(), todayStart.getMonth(), 1);

  // Year = Jan 1 of current year, 00:00 (local time)
  const yearStart = new Date(todayStart.getFullYear(), 0, 1);

  const users = await prisma.user.findMany({
    where: {
      active: true,
      role: { in: [UserRole.LOAN_OFFICER, UserRole.LOA, UserRole.MANAGER] },
    },
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      leadQuota: true,
      campaignMemberships: {
        include: {
          campaign: {
            select: { id: true, name: true, vendor: { select: { name: true } } },
          },
        },
      },
      _count: {
        select: {
          leads: { where: { receivedAt: { gte: todayStart } } },
        },
      },
    },
    orderBy: { name: 'asc' },
  });

  const userIds = users.map((u) => u.id);

  const [weekGroups, monthGroups, ytdGroups] = await Promise.all([
    userIds.length
      ? prisma.lead.groupBy({
          by: ['assignedUserId'],
          _count: { _all: true },
          where: {
            assignedUserId: { in: userIds },
            receivedAt: { gte: weekStart },
          },
        })
      : Promise.resolve([] as Array<{ assignedUserId: string | null; _count: { _all: number } }>),
    userIds.length
      ? prisma.lead.groupBy({
          by: ['assignedUserId'],
          _count: { _all: true },
          where: {
            assignedUserId: { in: userIds },
            receivedAt: { gte: monthStart },
          },
        })
      : Promise.resolve([] as Array<{ assignedUserId: string | null; _count: { _all: number } }>),
    userIds.length
      ? prisma.lead.groupBy({
          by: ['assignedUserId'],
          _count: { _all: true },
          where: {
            assignedUserId: { in: userIds },
            receivedAt: { gte: yearStart },
          },
        })
      : Promise.resolve([] as Array<{ assignedUserId: string | null; _count: { _all: number } }>),
  ]);

  const toMap = (
    rows: Array<{ assignedUserId: string | null; _count: { _all: number } }>
  ) => {
    const m = new Map<string, number>();
    for (const row of rows) {
      if (row.assignedUserId) m.set(row.assignedUserId, row._count._all);
    }
    return m;
  };

  const weekMap = toMap(weekGroups);
  const monthMap = toMap(monthGroups);
  const ytdMap = toMap(ytdGroups);

  return users.map((u) => ({
    ...u,
    leadsWeek: weekMap.get(u.id) ?? 0,
    leadsMonth: monthMap.get(u.id) ?? 0,
    leadsYtd: ytdMap.get(u.id) ?? 0,
  }));
}

export async function getLeadUser(userId: string) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      leadQuota: true,
      campaignMemberships: {
        include: {
          campaign: {
            select: {
              id: true,
              name: true,
              description: true,
              active: true,
              vendor: { select: { id: true, name: true } },
            },
          },
        },
        orderBy: { createdAt: 'asc' },
      },
      _count: {
        select: {
          leads: { where: { receivedAt: { gte: today } } },
        },
      },
    },
  });

  return user;
}

export async function updateUserLeadSettings(
  userId: string,
  data: {
    leadsEnabled?: boolean;
    licensedStates?: string[];
    bonzoWebhookUrl?: string | null;
    globalDailyQuota?: number;
    globalWeeklyQuota?: number;
    globalMonthlyQuota?: number;
  }
) {
  const normalizedBonzoUrl =
    data.bonzoWebhookUrl === undefined
      ? undefined
      : data.bonzoWebhookUrl && data.bonzoWebhookUrl.trim()
      ? data.bonzoWebhookUrl.trim()
      : null;

  await prisma.userLeadQuota.upsert({
    where: { userId },
    create: {
      userId,
      leadsEnabled: data.leadsEnabled ?? true,
      licensedStates: data.licensedStates ?? [],
      bonzoWebhookUrl: normalizedBonzoUrl ?? null,
      globalDailyQuota: data.globalDailyQuota ?? 0,
      globalWeeklyQuota: data.globalWeeklyQuota ?? 0,
      globalMonthlyQuota: data.globalMonthlyQuota ?? 0,
    },
    update: {
      ...(data.leadsEnabled !== undefined && { leadsEnabled: data.leadsEnabled }),
      ...(data.licensedStates !== undefined && { licensedStates: data.licensedStates }),
      ...(normalizedBonzoUrl !== undefined && { bonzoWebhookUrl: normalizedBonzoUrl }),
      ...(data.globalDailyQuota !== undefined && { globalDailyQuota: data.globalDailyQuota }),
      ...(data.globalWeeklyQuota !== undefined && { globalWeeklyQuota: data.globalWeeklyQuota }),
      ...(data.globalMonthlyQuota !== undefined && { globalMonthlyQuota: data.globalMonthlyQuota }),
    },
  });
  revalidatePath('/admin/leads/users');
}

/**
 * Sends a synthetic "test prospect" to the given user's Bonzo webhook URL
 * so admins can verify the URL is correct right after pasting it, without
 * waiting for a real lead to land. Uses {@link buildBonzoPayload} against
 * a hardcoded demo lead so the test body matches exactly what a real lead
 * would POST (same field names, same shape) - if this succeeds, real
 * leads will too.
 *
 * Returns the HTTP status and a body excerpt instead of fire-and-forget,
 * so the UI can show a clear success/error message.
 */
export async function sendBonzoTestForUser(
  userId: string
): Promise<{
  ok: boolean;
  status: number;
  statusText: string;
  bodyExcerpt: string;
}> {
  const [settings, user] = await Promise.all([
    prisma.userLeadQuota.findUnique({
      where: { userId },
      select: { bonzoWebhookUrl: true },
    }),
    prisma.user.findUnique({
      where: { id: userId },
      select: { name: true, email: true },
    }),
  ]);
  const url = settings?.bonzoWebhookUrl?.trim();
  if (!url) {
    throw new Error(
      'This user has no Bonzo webhook URL saved. Paste it and click Save first.'
    );
  }
  if (!user) throw new Error('User not found');

  const now = new Date();
  const demo: BonzoLeadLike = {
    id: `test-${now.getTime()}`,
    firstName: 'Test',
    lastName: 'Bonzo',
    email: 'test.bonzo@ffl-portal.test',
    phone: '5551234567',
    homePhone: null,
    workPhone: '5557654321',
    dob: '1985-06-15',
    ssn: null,
    coFirstName: null,
    coLastName: null,
    coEmail: null,
    coPhone: null,
    coHomePhone: null,
    coWorkPhone: null,
    coDob: null,
    mailingAddress: '123 Borrower Lane',
    mailingCity: 'Seattle',
    mailingState: 'WA',
    mailingZip: '98101',
    mailingCounty: 'King',
    propertyAddress: '456 Subject Property Way',
    propertyCity: 'Bellevue',
    propertyState: 'WA',
    propertyZip: '98004',
    propertyCounty: 'King',
    purchasePrice: '550000',
    propertyValue: '575000',
    propertyType: 'Single Family',
    propertyUse: 'Primary Residence',
    propertyAcquired: null,
    propertyLtv: '80',
    employer: 'FFL Portal QA',
    jobTitle: 'Test Borrower',
    employmentLength: null,
    selfEmployed: 'No',
    income: '120000',
    bankruptcy: 'None',
    foreclosure: 'None',
    homeowner: 'Yes',
    coEmployer: null,
    coJobTitle: null,
    coEmploymentLength: null,
    coSelfEmployed: null,
    coIncome: null,
    loanPurpose: 'Refinance',
    loanAmount: '440000',
    loanTerm: '30',
    loanType: 'Conventional',
    loanRate: null,
    downPayment: '110000',
    cashOut: '0',
    creditRating: '740',
    currentLender: null,
    currentBalance: '320000',
    currentRate: '6.875',
    currentPayment: null,
    currentTerm: null,
    currentType: null,
    otherBalance: null,
    otherPayment: null,
    targetRate: null,
    vaStatus: 'No',
    vaLoan: 'No',
    isMilitary: 'No',
    fhaLoan: 'No',
    sourceUrl: null,
    leadCreated: now.toISOString(),
    price: null,
    status: 'NEW',
    assignedAt: now,
    receivedAt: now,
    vendor: { name: 'FFL Portal Test', slug: 'ffl-test' },
    campaign: { name: 'Bonzo Webhook Test', routingTag: 'test' },
    assignedUser: { name: user.name ?? 'Test LO', email: user.email ?? '' },
    notes: [
      {
        content:
          'This is a synthetic test prospect posted from the FFL Portal admin UI. You can safely delete it in Bonzo.',
        createdAt: now,
      },
    ],
  };

  const payload = buildBonzoPayload(demo);
  try {
    return await postBonzoPayload(url, payload);
  } catch (err) {
    // Network-level failure: normalize to the same result shape the UI
    // already handles so the badge can display "Network error - ...".
    return {
      ok: false,
      status: 0,
      statusText:
        err instanceof Error ? err.message : 'Network error sending to Bonzo',
      bodyExcerpt: '',
    };
  }
}

export async function updateMemberSettings(
  memberId: string,
  data: {
    dailyQuota?: number;
    weeklyQuota?: number;
    monthlyQuota?: number;
    receiveDays?: number[];
    active?: boolean;
  }
) {
  await prisma.campaignMember.update({
    where: { id: memberId },
    data: {
      ...(data.dailyQuota !== undefined && { dailyQuota: data.dailyQuota }),
      ...(data.weeklyQuota !== undefined && { weeklyQuota: data.weeklyQuota }),
      ...(data.monthlyQuota !== undefined && { monthlyQuota: data.monthlyQuota }),
      ...(data.receiveDays !== undefined && { receiveDays: data.receiveDays }),
      ...(data.active !== undefined && { active: data.active }),
    },
  });
  revalidatePath('/admin/leads/users');
  revalidatePath('/admin/leads/campaigns');
}

export async function addUserToCampaign(userId: string, campaignId: string) {
  const maxMember = await prisma.campaignMember.findFirst({
    where: { campaignId },
    orderBy: { roundRobinPosition: 'desc' },
  });
  await prisma.campaignMember.create({
    data: {
      campaignId,
      userId,
      roundRobinPosition: (maxMember?.roundRobinPosition ?? -1) + 1,
    },
  });
  revalidatePath('/admin/leads/users');
  revalidatePath('/admin/leads/campaigns');
}

export async function removeUserFromCampaign(memberId: string) {
  await prisma.campaignMember.delete({ where: { id: memberId } });
  revalidatePath('/admin/leads/users');
  revalidatePath('/admin/leads/campaigns');
}

export async function getAllCampaignsForUserAdd() {
  return prisma.leadCampaign.findMany({
    where: { active: true },
    select: {
      id: true,
      name: true,
      vendor: { select: { name: true } },
    },
    orderBy: { name: 'asc' },
  });
}

// ---------------------------------------------------------------------------
// CSV Upload
// ---------------------------------------------------------------------------

async function getOrCreateCsvVendor() {
  return prisma.leadVendor.upsert({
    where: { slug: CSV_VENDOR_SLUG },
    create: {
      name: 'CSV Upload',
      slug: CSV_VENDOR_SLUG,
      routingTagField: '',
      active: true,
    },
    update: {},
  });
}

export async function getSavedCsvMappings() {
  return prisma.csvColumnMapping.findMany({
    orderBy: { usageCount: 'desc' },
  });
}

export async function saveCsvMappings(
  mappings: Array<{ csvHeader: string; ourField: string }>
) {
  for (const m of mappings) {
    const key = m.csvHeader.toLowerCase().trim();
    if (!key || !m.ourField) continue;
    await prisma.csvColumnMapping.upsert({
      where: { csvHeader_ourField: { csvHeader: key, ourField: m.ourField } },
      create: { csvHeader: key, ourField: m.ourField, usageCount: 1 },
      update: { usageCount: { increment: 1 } },
    });
  }
}

const LEAD_STRING_FIELDS = new Set([
  'firstName', 'lastName', 'email', 'phone', 'homePhone', 'workPhone', 'dob',
  'coFirstName', 'coLastName', 'coEmail', 'coPhone', 'coHomePhone', 'coWorkPhone', 'coDob',
  'mailingAddress', 'mailingCity', 'mailingState', 'mailingZip', 'mailingCounty',
  'propertyAddress', 'propertyCity', 'propertyState', 'propertyZip', 'propertyCounty',
  'purchasePrice', 'propertyValue', 'propertyType', 'propertyUse', 'propertyAcquired', 'propertyLtv',
  'employer', 'jobTitle', 'employmentLength', 'selfEmployed', 'income', 'bankruptcy', 'foreclosure', 'homeowner',
  'coEmployer', 'coJobTitle', 'coEmploymentLength', 'coSelfEmployed', 'coIncome',
  'loanPurpose', 'loanAmount', 'loanTerm', 'loanType', 'loanRate',
  'downPayment', 'cashOut', 'creditRating',
  'currentLender', 'currentBalance', 'currentRate', 'currentPayment', 'currentTerm', 'currentType',
  'otherBalance', 'otherPayment', 'targetRate',
  'vaStatus', 'vaLoan', 'isMilitary', 'fhaLoan', 'sourceUrl', 'price',
]);

export async function bulkCreateLeadsFromCsv(
  rows: Array<Record<string, string | null>>
) {
  const vendor = await getOrCreateCsvVendor();
  const now = new Date();

  let created = 0;
  const batchSize = 50;

  for (let i = 0; i < rows.length; i += batchSize) {
    const batch = rows.slice(i, i + batchSize);
    const creates: Prisma.LeadCreateManyInput[] = batch.map((row) => {
      const data: Record<string, unknown> = {
        vendorId: vendor.id,
        status: LeadStatus.UNASSIGNED,
        source: 'CSV Upload',
        rawPayload: row as unknown as Prisma.InputJsonValue,
        receivedAt: now,
      };
      for (const [field, value] of Object.entries(row)) {
        if (LEAD_STRING_FIELDS.has(field) && value != null && value !== '') {
          data[field] = value;
        }
      }
      return data as Prisma.LeadCreateManyInput;
    });

    const result = await prisma.lead.createMany({ data: creates });
    created += result.count;
  }

  revalidatePath('/admin/leads');
  revalidatePath('/admin/leads/pool');
  return { created };
}

/**
 * Bulk import a batch of CSV rows as leads.
 *
 * Historical-import options (optional):
 *  - `assignment.nameToUserId` — lookup map built client-side from the CSV's
 *    "User Name" column. Any row with `assignedUserName` whose normalized
 *    value hits this map gets `assignedUserId` + `assignedAt` set and its
 *    status bumped from `UNASSIGNED` to `NEW` (matches what `distributeLead`
 *    sets when it assigns to a live round-robin member). Rows that map to
 *    `null` (or have no name) stay unassigned and land in the pool.
 *  - `assignment.fireBonzo` — when true, each assigned lead is forwarded
 *    to its LO's Bonzo webhook (fire-and-forget). Default false for
 *    historical imports since those leads are typically already in Bonzo.
 */
export async function bulkCreateLeadsBatch(
  rows: Array<Record<string, string | null>>,
  options?: {
    assignment?: {
      nameToUserId: Record<string, string | null>;
      fireBonzo?: boolean;
    };
  }
) {
  const vendor = await getOrCreateCsvVendor();
  const now = new Date();
  const assignmentMap = options?.assignment?.nameToUserId;
  const fireBonzo = options?.assignment?.fireBonzo === true;

  type Resolved = {
    data: Prisma.LeadCreateManyInput;
    assignedUserId: string | null;
  };
  const resolved: Resolved[] = rows.map((row) => {
    const data: Record<string, unknown> = {
      vendorId: vendor.id,
      status: LeadStatus.UNASSIGNED,
      source: 'CSV Upload',
      rawPayload: row as unknown as Prisma.InputJsonValue,
      receivedAt: now,
    };
    for (const [field, value] of Object.entries(row)) {
      if (LEAD_STRING_FIELDS.has(field) && value != null && value !== '') {
        data[field] = value;
      }
    }

    let assignedUserId: string | null = null;
    if (assignmentMap) {
      const raw = row.assignedUserName;
      const key = normalizeUserName(raw);
      if (key && Object.prototype.hasOwnProperty.call(assignmentMap, key)) {
        const resolvedId = assignmentMap[key];
        if (resolvedId) {
          assignedUserId = resolvedId;
          data.assignedUserId = resolvedId;
          data.assignedAt = now;
          data.status = LeadStatus.NEW;
        }
      }
    }

    return { data: data as Prisma.LeadCreateManyInput, assignedUserId };
  });

  const createResult = await prisma.lead.createMany({
    data: resolved.map((r) => r.data),
  });

  if (fireBonzo) {
    // Can't get the newly-created ids back from createMany, so look them up
    // by rawPayload match via the assigned users + receivedAt window. For
    // simplicity and correctness we just fetch all leads created in this
    // batch by (vendorId, receivedAt >= now) that have assignedUserId set
    // and fire webhook forwards.
    const fresh = await prisma.lead.findMany({
      where: {
        vendorId: vendor.id,
        receivedAt: { gte: now },
        assignedUserId: { not: null },
      },
      select: { id: true, assignedUserId: true },
      take: resolved.length,
    });
    for (const l of fresh) {
      if (l.assignedUserId) {
        void forwardLeadToBonzo(l.id, l.assignedUserId);
        void runServiceTriggers(l.id, IntegrationServiceTrigger.ON_ASSIGN);
        void runServiceTriggers(
          l.id,
          IntegrationServiceTrigger.DELAY_AFTER_ASSIGN
        );
      }
    }
  }

  return { created: createResult.count };
}

export async function revalidateLeadPaths() {
  revalidatePath('/admin/leads');
  revalidatePath('/admin/leads/pool');
  revalidatePath('/admin/leads/all');
}

// ---------------------------------------------------------------------------
// Integration Services (admin service builder + push-to-service)
// ---------------------------------------------------------------------------

function revalidateServicePaths() {
  revalidatePath('/admin/leads');
  revalidatePath('/admin/leads/services');
  revalidatePath('/admin/leads/all');
  revalidatePath('/admin/leads/users');
}

function normalizeSlug(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

// Row shape returned by Prisma when we include credentialFields. Kept
// private to this module so downstream callers stick to IntegrationServiceSummary.
type ServiceRowWithFields = Prisma.IntegrationServiceGetPayload<{
  include: { credentialFields: true };
}>;

function serializeService(row: ServiceRowWithFields): IntegrationServiceSummary {
  const captureFields = parseCaptureFieldsJson(row.captureFields);
  const oauthConfig = parseOAuthConfig(row.oauthConfig);
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    description: row.description,
    type: row.type,
    active: row.active,
    config: row.config,

    kind: row.kind,
    statusTrigger: row.statusTrigger,
    triggerStatus: row.triggerStatus,
    triggerDay: row.triggerDay,
    triggerDelayMinutes: row.triggerDelayMinutes,

    method: row.method,
    urlTemplate: row.urlTemplate,
    bodyTemplate: row.bodyTemplate,
    headersTemplate: row.headersTemplate,

    userScope: row.userScope,
    userIds: row.userIds,
    campaignScope: row.campaignScope,
    campaignIds: row.campaignIds,
    excludeSelected: row.excludeSelected,

    successString: row.successString,
    failNotifyEmail: row.failNotifyEmail,
    dateOverride: row.dateOverride,
    captureFields,

    requiresBrandNew: row.requiresBrandNew,
    requiresNotBrandNew: row.requiresNotBrandNew,
    requiresAssignedUser: row.requiresAssignedUser,
    requiresOAuth: row.requiresOAuth,
    allowManualSend: row.allowManualSend,

    oauthConfig,
    credentialFields: row.credentialFields
      .slice()
      .sort((a, b) => a.sortOrder - b.sortOrder || a.key.localeCompare(b.key))
      .map(
        (f): IntegrationServiceCredentialFieldDTO => ({
          id: f.id,
          serviceId: f.serviceId,
          key: f.key,
          label: f.label,
          required: f.required,
          secret: f.secret,
          placeholder: f.placeholder,
          helpText: f.helpText,
          sortOrder: f.sortOrder,
        })
      ),

    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function parseCaptureFieldsJson(raw: unknown): IntegrationServiceCaptureField[] {
  if (!Array.isArray(raw)) return [];
  const out: IntegrationServiceCaptureField[] = [];
  for (const row of raw) {
    if (row && typeof row === 'object') {
      const { path, target } = row as Record<string, unknown>;
      if (typeof path === 'string' && typeof target === 'string' && path && target) {
        out.push({ path, target });
      }
    }
  }
  return out;
}

function parseOAuthConfig(raw: unknown): IntegrationServiceOAuthConfig | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  const tokenUrl = typeof r.tokenUrl === 'string' ? r.tokenUrl : '';
  const clientId = typeof r.clientId === 'string' ? r.clientId : '';
  const clientSecret = typeof r.clientSecret === 'string' ? r.clientSecret : '';
  if (!tokenUrl && !clientId && !clientSecret) return null;
  return {
    tokenUrl,
    clientId,
    clientSecret,
    scope: typeof r.scope === 'string' ? r.scope : undefined,
    grantType: typeof r.grantType === 'string' ? r.grantType : undefined,
    accessToken: typeof r.accessToken === 'string' ? r.accessToken : undefined,
    expiresAt: typeof r.expiresAt === 'string' ? r.expiresAt : undefined,
  };
}

/**
 * Returns every service (newest first), each with its credential-field
 * definitions. Pass `activeOnly: true` when populating the Push-to-Service
 * picker so archived services don't show up. Pass `manualOnly: true` to
 * additionally filter by `allowManualSend` for the Leads screen picker.
 */
export async function getIntegrationServices(
  opts: { activeOnly?: boolean; manualOnly?: boolean } = {}
): Promise<IntegrationServiceSummary[]> {
  const where: Prisma.IntegrationServiceWhereInput = {};
  if (opts.activeOnly) where.active = true;
  if (opts.manualOnly) where.allowManualSend = true;

  const rows = await prisma.integrationService.findMany({
    where,
    include: { credentialFields: true },
    orderBy: [{ active: 'desc' }, { createdAt: 'asc' }],
  });
  return rows.map(serializeService);
}

export async function getIntegrationService(
  id: string
): Promise<IntegrationServiceSummary | null> {
  const row = await prisma.integrationService.findUnique({
    where: { id },
    include: { credentialFields: true },
  });
  return row ? serializeService(row) : null;
}

async function assertServiceAdmin() {
  const session = await getServerSession(authOptions);
  const role = session?.user?.role;
  if (role !== UserRole.ADMIN && role !== UserRole.MANAGER) {
    throw new Error('Not authorized');
  }
}

function buildServiceUpdateData(
  data: IntegrationServiceInput,
  { forCreate }: { forCreate: boolean }
): Prisma.IntegrationServiceUncheckedUpdateInput &
  Prisma.IntegrationServiceUncheckedCreateInput {
  // `Partial`-ish patch; Prisma will ignore undefined fields.
  const patch: Record<string, unknown> = {};

  if (forCreate || data.name !== undefined) {
    const name = data.name?.trim() ?? '';
    if (!name) throw new Error('Service name is required');
    patch.name = name;
  }
  if (data.description !== undefined) {
    patch.description = data.description?.trim() || null;
  }
  if (data.type !== undefined) {
    if (!INTEGRATION_SERVICE_TYPES.includes(data.type as IntegrationServiceType)) {
      // Accept unknown types as free-form strings — the dispatcher no
      // longer routes by `type`. We just normalize to lowercase so the
      // UI can still display them consistently.
      patch.type = data.type.trim().toLowerCase() || 'custom';
    } else {
      patch.type = data.type;
    }
  } else if (forCreate) {
    patch.type = 'custom';
  }
  if (data.active !== undefined) patch.active = data.active;

  if (data.kind !== undefined) patch.kind = data.kind;
  if (data.statusTrigger !== undefined) patch.statusTrigger = data.statusTrigger;
  if (data.triggerStatus !== undefined) {
    patch.triggerStatus = data.triggerStatus?.trim() || null;
  }
  if (data.triggerDay !== undefined) patch.triggerDay = data.triggerDay;
  if (data.triggerDelayMinutes !== undefined) {
    patch.triggerDelayMinutes = data.triggerDelayMinutes;
  }

  if (data.method !== undefined) patch.method = data.method;
  if (data.urlTemplate !== undefined) patch.urlTemplate = data.urlTemplate;
  if (data.bodyTemplate !== undefined) patch.bodyTemplate = data.bodyTemplate;
  if (data.headersTemplate !== undefined) patch.headersTemplate = data.headersTemplate;

  if (data.userScope !== undefined) patch.userScope = data.userScope;
  if (data.userIds !== undefined) patch.userIds = data.userIds;
  if (data.campaignScope !== undefined) patch.campaignScope = data.campaignScope;
  if (data.campaignIds !== undefined) patch.campaignIds = data.campaignIds;
  if (data.excludeSelected !== undefined) patch.excludeSelected = data.excludeSelected;

  if (data.successString !== undefined) {
    patch.successString = data.successString?.trim() || null;
  }
  if (data.failNotifyEmail !== undefined) {
    patch.failNotifyEmail = data.failNotifyEmail?.trim() || null;
  }
  if (data.dateOverride !== undefined) {
    patch.dateOverride = data.dateOverride?.trim() || null;
  }
  if (data.captureFields !== undefined) {
    patch.captureFields = data.captureFields as unknown as Prisma.InputJsonValue;
  }

  if (data.requiresBrandNew !== undefined) patch.requiresBrandNew = data.requiresBrandNew;
  if (data.requiresNotBrandNew !== undefined) {
    patch.requiresNotBrandNew = data.requiresNotBrandNew;
  }
  if (data.requiresAssignedUser !== undefined) {
    patch.requiresAssignedUser = data.requiresAssignedUser;
  }
  if (data.requiresOAuth !== undefined) patch.requiresOAuth = data.requiresOAuth;
  if (data.allowManualSend !== undefined) {
    patch.allowManualSend = data.allowManualSend;
  }

  if (data.oauthConfig !== undefined) {
    patch.oauthConfig =
      data.oauthConfig === null
        ? Prisma.DbNull
        : (data.oauthConfig as unknown as Prisma.InputJsonValue);
  }

  return patch as Prisma.IntegrationServiceUncheckedUpdateInput &
    Prisma.IntegrationServiceUncheckedCreateInput;
}

export async function createIntegrationService(
  data: IntegrationServiceInput
): Promise<IntegrationServiceSummary> {
  await assertServiceAdmin();

  const slug = normalizeSlug(data.slug || data.name);
  if (!slug) throw new Error('Service slug is required');

  const base = buildServiceUpdateData(data, { forCreate: true });
  const created = await prisma.integrationService.create({
    data: {
      ...(base as Prisma.IntegrationServiceUncheckedCreateInput),
      slug,
      name: (base.name as string) ?? data.name.trim(),
      description: (base.description as string | null | undefined) ?? null,
      type: (base.type as string) ?? 'custom',
      credentialFields:
        data.credentialFields && data.credentialFields.length > 0
          ? {
              create: data.credentialFields.map((f, idx) => ({
                key: f.key.trim(),
                label: f.label.trim() || f.key.trim(),
                required: !!f.required,
                secret: !!f.secret,
                placeholder: f.placeholder?.trim() || null,
                helpText: f.helpText?.trim() || null,
                sortOrder: f.sortOrder ?? idx,
              })),
            }
          : undefined,
    },
    include: { credentialFields: true },
  });
  revalidateServicePaths();
  return serializeService(created);
}

export async function updateIntegrationService(
  id: string,
  data: IntegrationServiceInput
): Promise<IntegrationServiceSummary> {
  await assertServiceAdmin();

  const patch = buildServiceUpdateData(data, { forCreate: false });

  // Re-sync credential field rows if the caller provided an explicit list.
  // We replace-in-place so the admin UI can add / remove / reorder fields
  // without juggling their ids.
  if (data.credentialFields !== undefined) {
    await prisma.$transaction([
      prisma.integrationServiceCredentialField.deleteMany({
        where: { serviceId: id },
      }),
      ...(data.credentialFields.length > 0
        ? [
            prisma.integrationServiceCredentialField.createMany({
              data: data.credentialFields.map((f, idx) => ({
                serviceId: id,
                key: f.key.trim(),
                label: f.label.trim() || f.key.trim(),
                required: !!f.required,
                secret: !!f.secret,
                placeholder: f.placeholder?.trim() || null,
                helpText: f.helpText?.trim() || null,
                sortOrder: f.sortOrder ?? idx,
              })),
            }),
          ]
        : []),
    ]);
  }

  const updated = await prisma.integrationService.update({
    where: { id },
    data: patch,
    include: { credentialFields: true },
  });
  revalidateServicePaths();
  return serializeService(updated);
}

export async function archiveIntegrationService(id: string) {
  await assertServiceAdmin();
  const updated = await prisma.integrationService.update({
    where: { id },
    data: { active: false },
    include: { credentialFields: true },
  });
  revalidateServicePaths();
  return serializeService(updated);
}

export async function restoreIntegrationService(id: string) {
  await assertServiceAdmin();
  const updated = await prisma.integrationService.update({
    where: { id },
    data: { active: true },
    include: { credentialFields: true },
  });
  revalidateServicePaths();
  return serializeService(updated);
}

export async function deleteIntegrationService(
  id: string,
  confirmName: string
) {
  await assertServiceAdmin();
  const svc = await prisma.integrationService.findUnique({ where: { id } });
  if (!svc) throw new Error('Service not found');
  if (svc.active) {
    throw new Error('Archive the service before permanently deleting it');
  }
  if (confirmName.trim() !== svc.name) {
    throw new Error('Confirmation name does not match service name');
  }
  await prisma.integrationService.delete({ where: { id } });
  revalidateServicePaths();
}

// ---------------------------------------------------------------------------
// Per-user credentials (Lead Users row editor)
// ---------------------------------------------------------------------------

export type UserIntegrationCredentialDTO = {
  serviceId: string;
  userId: string;
  values: Record<string, string>;
};

function normalizeCredentialValues(raw: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
      if (v === null || v === undefined) continue;
      out[k] = typeof v === 'string' ? v : String(v);
    }
  }
  return out;
}

export async function getUserIntegrationCredentials(
  userId: string
): Promise<UserIntegrationCredentialDTO[]> {
  await assertServiceAdmin();
  const rows = await prisma.userIntegrationCredential.findMany({
    where: { userId },
  });
  return rows.map((r) => ({
    serviceId: r.serviceId,
    userId: r.userId,
    values: normalizeCredentialValues(r.values),
  }));
}

/**
 * Batched variant of getUserIntegrationCredentials. The /admin/leads/users
 * page needs credentials for every user at once; calling the single-user
 * action inside `Promise.all(users.map(...))` was firing one query and
 * one session lookup per user, which at 30+ LOs + 100k+ leads in the
 * same page render routinely blew past Prisma's connection pool and
 * produced 500s. This collapses the whole thing into one query.
 */
export async function getUserIntegrationCredentialsBulk(
  userIds: string[]
): Promise<Map<string, UserIntegrationCredentialDTO[]>> {
  await assertServiceAdmin();
  const result = new Map<string, UserIntegrationCredentialDTO[]>();
  for (const id of userIds) result.set(id, []);
  if (userIds.length === 0) return result;
  const rows = await prisma.userIntegrationCredential.findMany({
    where: { userId: { in: userIds } },
  });
  for (const r of rows) {
    const bucket = result.get(r.userId) ?? [];
    bucket.push({
      serviceId: r.serviceId,
      userId: r.userId,
      values: normalizeCredentialValues(r.values),
    });
    result.set(r.userId, bucket);
  }
  return result;
}

/**
 * Batched variant of getUserAllowedServiceIds. Same rationale as
 * getUserIntegrationCredentialsBulk — collapses an N+1 at page render.
 * Also wraps the query in a safe fallback so a stale deployment whose
 * database migration hasn't landed yet still renders the page (every
 * user just shows an empty allow list) instead of hard-500ing.
 */
export async function getUserAllowedServiceIdsBulk(
  userIds: string[]
): Promise<Map<string, string[]>> {
  const result = new Map<string, string[]>();
  for (const id of userIds) result.set(id, []);
  if (userIds.length === 0) return result;
  try {
    const rows = await prisma.userIntegrationServicePermission.findMany({
      where: { userId: { in: userIds }, canPush: true },
      select: { userId: true, serviceId: true },
    });
    for (const r of rows) {
      const bucket = result.get(r.userId) ?? [];
      bucket.push(r.serviceId);
      result.set(r.userId, bucket);
    }
  } catch (err) {
    // Likely cause: the UserIntegrationServicePermission migration hasn't
    // been applied on this environment yet. Log and fall back to empty
    // allow lists so the rest of /admin/leads/users can still render.
    console.error(
      '[getUserAllowedServiceIdsBulk] failed to load permissions; returning empty allow list',
      err
    );
  }
  return result;
}

export async function upsertUserIntegrationCredential(input: {
  userId: string;
  serviceId: string;
  values: Record<string, string>;
}): Promise<UserIntegrationCredentialDTO> {
  await assertServiceAdmin();
  const { userId, serviceId } = input;
  const cleaned: Record<string, string> = {};
  for (const [k, v] of Object.entries(input.values ?? {})) {
    if (typeof v !== 'string') continue;
    const trimmed = v.trim();
    if (!trimmed) continue;
    cleaned[k] = trimmed;
  }

  const row = await prisma.userIntegrationCredential.upsert({
    where: { userId_serviceId: { userId, serviceId } },
    create: {
      userId,
      serviceId,
      values: cleaned as unknown as Prisma.InputJsonValue,
    },
    update: {
      values: cleaned as unknown as Prisma.InputJsonValue,
    },
  });
  revalidateServicePaths();
  return { serviceId: row.serviceId, userId: row.userId, values: cleaned };
}

/**
 * Runs the batch push for the given service against a set of lead ids and
 * returns a structured summary. The UI pairs summary.skipped / summary.failed
 * with the selected leads so the admin can see exactly which ones need
 * attention (no assignee, missing credential, HTTP error, etc.).
 *
 * Auth: restricted to admins / managers. Services without
 * `allowManualSend = true` are rejected before any HTTP work happens.
 */
export async function pushLeadsToService(input: {
  serviceSlug: string;
  leadIds: string[];
}): Promise<BatchSummary> {
  const session = await getServerSession(authOptions);
  const role = session?.user?.role;
  const userId = session?.user?.id;
  if (!userId) throw new Error('Unauthorized');

  const isAdmin = role === UserRole.ADMIN || role === UserRole.MANAGER;

  let leadIds = Array.from(new Set(input.leadIds)).filter(Boolean);
  if (leadIds.length === 0) {
    return { total: 0, succeeded: 0, skipped: [], failed: [] };
  }

  const svc = await prisma.integrationService.findUnique({
    where: { slug: input.serviceSlug },
    include: { credentialFields: true },
  });
  if (!svc) throw new Error(`Service "${input.serviceSlug}" not found`);
  if (!svc.active) throw new Error(`Service "${svc.name}" is archived`);
  if (!svc.allowManualSend) {
    throw new Error(
      `Service "${svc.name}" does not allow manual sends. Enable it in the service editor.`
    );
  }

  if (!isAdmin) {
    // Non-admins can only push their own leads, and only to services on
    // their per-user allow list. Both rules silently drop unauthorized
    // ids / throw for unauthorized services so the dispatcher never sees
    // cross-user bleed.
    leadIds = await filterLeadsOwnedByUser(leadIds, userId);
    if (leadIds.length === 0) {
      return { total: 0, succeeded: 0, skipped: [], failed: [] };
    }
    const allowed = await getUserAllowedServiceIds(userId);
    if (!allowed.has(svc.id)) {
      throw new Error('You are not authorized to push to this service');
    }
  }

  const rows = await runDispatchBatch(svc, leadIds, { trigger: 'MANUAL' });
  return summarizeBatch(rows);
}

// ---------------------------------------------------------------------------
// LO ownership + per-user service permissions
// ---------------------------------------------------------------------------

/**
 * Returns the set of serviceIds an LO is permitted to manually push to.
 * Empty set = no services. Admins typically don't call this (they bypass
 * the allow list entirely in `pushLeadsToService`).
 */
export async function getUserAllowedServiceIds(
  userId: string
): Promise<Set<string>> {
  try {
    const rows = await prisma.userIntegrationServicePermission.findMany({
      where: { userId, canPush: true },
      select: { serviceId: true },
    });
    return new Set(rows.map((r) => r.serviceId));
  } catch (err) {
    // Defensive: if the permission table is missing (migration lag) or
    // unreachable, treat the user as having no allow list entries rather
    // than 500ing the entire page. pushLeadsToService will still block
    // the push because the empty set won't include the service id.
    console.error(
      '[getUserAllowedServiceIds] falling back to empty set',
      err
    );
    return new Set();
  }
}

/**
 * LO-facing replacement for `getIntegrationServices({ activeOnly: true,
 * manualOnly: true })`. Inner-joins the permission table so only services
 * the user has been explicitly granted show up in their "Push to Service"
 * picker.
 */
export async function getAllowedIntegrationServicesForUser(
  userId: string
): Promise<IntegrationServiceSummary[]> {
  try {
    const rows = await prisma.integrationService.findMany({
      where: {
        active: true,
        allowManualSend: true,
        userPermissions: { some: { userId, canPush: true } },
      },
      include: { credentialFields: true },
      orderBy: [{ active: 'desc' }, { createdAt: 'asc' }],
    });
    return rows.map(serializeService);
  } catch (err) {
    // Mirrors the defensive fallback in getUserAllowedServiceIds — keeps
    // the LO /leads page rendering (with an empty Push-to-Service menu)
    // even if the permission table isn't on this DB yet.
    console.error(
      '[getAllowedIntegrationServicesForUser] returning empty list',
      err
    );
    return [];
  }
}

/**
 * Admin-only: replace-in-place the allow list for a user. An empty array
 * clears every row, so the user ends up with zero services in their
 * picker. We wrap delete+createMany in a transaction so the UI can never
 * observe a half-updated state.
 */
export async function setUserIntegrationServicePermissions(
  userId: string,
  serviceIds: string[]
): Promise<{ userId: string; serviceIds: string[] }> {
  await assertServiceAdmin();
  const unique = Array.from(new Set(serviceIds)).filter(Boolean);

  await prisma.$transaction([
    prisma.userIntegrationServicePermission.deleteMany({ where: { userId } }),
    ...(unique.length > 0
      ? [
          prisma.userIntegrationServicePermission.createMany({
            data: unique.map((serviceId) => ({
              userId,
              serviceId,
              canPush: true,
            })),
            skipDuplicates: true,
          }),
        ]
      : []),
  ]);
  revalidateServicePaths();
  revalidatePath('/admin/leads/users');
  revalidatePath('/leads');
  return { userId, serviceIds: unique };
}

/**
 * Throws when `userId` does not own `leadId`. Admins/managers bypass.
 * Used to plug the IDOR that would otherwise let any logged-in user open
 * `/leads/:id` (or drive any of the mutation actions) for leads belonging
 * to another LO.
 */
export async function assertLeadBelongsTo(
  userId: string,
  leadId: string
): Promise<void> {
  const row = await prisma.lead.findUnique({
    where: { id: leadId },
    select: { assignedUserId: true },
  });
  if (!row) throw new Error('Lead not found');
  if (row.assignedUserId !== userId) {
    throw new Error('You do not have access to this lead');
  }
}

/**
 * Narrows an arbitrary list of lead ids down to the subset actually
 * assigned to `userId`. Keeps bulk actions safe for LOs: the UI can still
 * report "N of M updated" because we return the filtered list rather
 * than throwing on the first foreign id.
 */
async function filterLeadsOwnedByUser(
  leadIds: string[],
  userId: string
): Promise<string[]> {
  if (leadIds.length === 0) return [];
  const rows = await prisma.lead.findMany({
    where: { id: { in: leadIds }, assignedUserId: userId },
    select: { id: true },
  });
  return rows.map((r) => r.id);
}
