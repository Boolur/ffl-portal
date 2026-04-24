'use server';

import { prisma } from '@/lib/prisma';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/auth';
import { LeadStatus, UserRole, type Prisma } from '@prisma/client';
import { revalidatePath } from 'next/cache';
import { forwardLeadToBonzo } from '@/lib/bonzoForward';

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
    }
    return;
  }

  const leadState = (lead.propertyState || '').trim().toUpperCase();

  const currentDayOfWeek = new Date().getDay(); // 0=Sun, 1=Mon...6=Sat

  for (const member of members) {
    const globalQuota = await prisma.userLeadQuota.findUnique({
      where: { userId: member.userId },
    });

    if (globalQuota && !globalQuota.leadsEnabled) continue;

    if (globalQuota && globalQuota.licensedStates.length > 0 && leadState) {
      const globalStates = globalQuota.licensedStates.map((s) => s.trim().toUpperCase());
      if (!globalStates.includes(leadState)) continue;
    }

    if (member.licensedStates.length > 0 && leadState) {
      const upperStates = member.licensedStates.map((s) => s.trim().toUpperCase());
      if (!upperStates.includes(leadState)) continue;
    }

    if (member.receiveDays.length > 0 && !member.receiveDays.includes(currentDayOfWeek)) continue;

    if (campaign.enableUserQuotas) {
      if (member.dailyQuota > 0 && member.leadsReceivedToday >= member.dailyQuota) continue;
      if (member.weeklyQuota > 0 && member.leadsReceivedThisWeek >= member.weeklyQuota) continue;
      if (member.monthlyQuota > 0 && member.leadsReceivedThisMonth >= member.monthlyQuota) continue;
    }

    if (globalQuota) {
      if (globalQuota.globalDailyQuota > 0 && globalQuota.leadsReceivedToday >= globalQuota.globalDailyQuota) continue;
      if (globalQuota.globalWeeklyQuota > 0 && globalQuota.leadsReceivedThisWeek >= globalQuota.globalWeeklyQuota) continue;
      if (globalQuota.globalMonthlyQuota > 0 && globalQuota.leadsReceivedThisMonth >= globalQuota.globalMonthlyQuota) continue;
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

export async function setCampaignMembers(
  campaignId: string,
  userIds: string[]
) {
  const existing = await prisma.campaignMember.findMany({
    where: { campaignId },
    select: { id: true, userId: true, roundRobinPosition: true },
  });
  const existingUserIds = new Set(existing.map((m) => m.userId));
  const targetUserIds = new Set(userIds);

  const toRemove = existing.filter((m) => !targetUserIds.has(m.userId));
  const toAdd = userIds.filter((uid) => !existingUserIds.has(uid));

  let maxPos = existing.reduce((max, m) => Math.max(max, m.roundRobinPosition), -1);

  await prisma.$transaction([
    ...(toRemove.length > 0
      ? [prisma.campaignMember.deleteMany({ where: { id: { in: toRemove.map((m) => m.id) } } })]
      : []),
    ...toAdd.map((userId) => {
      maxPos += 1;
      return prisma.campaignMember.create({
        data: { campaignId, userId, roundRobinPosition: maxPos },
      });
    }),
  ]);

  revalidatePath('/admin/leads/campaigns');
  revalidatePath('/admin/leads/users');
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
  }
) {
  const where = buildLeadWhere(filters);
  const orderBy = buildLeadOrderBy(filters?.sortBy, filters?.sortDir);

  const [leads, total] = await prisma.$transaction([
    prisma.lead.findMany({
      where,
      include: {
        vendor: { select: { id: true, name: true } },
        campaign: { select: { id: true, name: true } },
        assignedUser: { select: { id: true, name: true } },
        _count: { select: { notes: true } },
      },
      orderBy: orderBy as never,
      take: filters?.take ?? 100,
      skip: filters?.skip ?? 0,
    }),
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
  const where = buildLeadWhere(filters);
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
  return prisma.lead.findMany({
    where: { id: { in: leadIds } },
    include: {
      vendor: { select: { name: true } },
      campaign: { select: { name: true } },
      assignedUser: { select: { name: true } },
    },
    orderBy: { receivedAt: 'desc' },
  });
}

export async function getLead(id: string) {
  return prisma.lead.findUnique({
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
}

export async function updateLeadStatus(leadId: string, status: LeadStatus) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) throw new Error('Unauthorized');

  await prisma.lead.update({ where: { id: leadId }, data: { status } });
  revalidatePath('/leads');
  revalidatePath('/admin/leads');
  revalidatePath('/admin/leads/all');
}

export async function updateLeadFields(
  leadId: string,
  fields: Record<string, string | null>
) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) throw new Error('Unauthorized');

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
  }
  revalidatePath('/leads');
  revalidatePath('/admin/leads');
  revalidatePath('/admin/leads/all');
}

export async function bulkUpdateLeadStatus(
  leadIds: string[],
  status: LeadStatus
) {
  await prisma.lead.updateMany({
    where: { id: { in: leadIds } },
    data: { status },
  });
  revalidatePath('/leads');
  revalidatePath('/admin/leads');
  revalidatePath('/admin/leads/all');
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

export async function getDistinctLeadSources() {
  const results = await prisma.lead.findMany({
    where: { source: { not: null } },
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

export async function getLeadCrmStats() {
  const now = new Date();

  const todayStart = new Date(now);
  todayStart.setHours(0, 0, 0, 0);

  const weekStart = new Date(now);
  weekStart.setDate(weekStart.getDate() - weekStart.getDay() + 1);
  weekStart.setHours(0, 0, 0, 0);
  if (weekStart > now) weekStart.setDate(weekStart.getDate() - 7);

  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

  const [
    totalLeads,
    newToday,
    newThisWeek,
    newThisMonth,
    unassigned,
    vendorGroupsAll,
    campaignGroupsToday,
  ] = await prisma.$transaction([
    prisma.lead.count(),
    prisma.lead.count({ where: { receivedAt: { gte: todayStart } } }),
    prisma.lead.count({ where: { receivedAt: { gte: weekStart } } }),
    prisma.lead.count({ where: { receivedAt: { gte: monthStart } } }),
    prisma.lead.count({ where: { status: LeadStatus.UNASSIGNED } }),
    prisma.lead.groupBy({
      by: ['vendorId'],
      _count: { id: true },
      orderBy: { _count: { id: 'desc' } },
    }),
    prisma.lead.groupBy({
      by: ['campaignId'],
      _count: { id: true },
      where: { receivedAt: { gte: todayStart }, campaignId: { not: null } },
      orderBy: { _count: { id: 'desc' } },
    }),
  ]);

  const vendorIds = vendorGroupsAll.map((v) => v.vendorId);
  const vendors = await prisma.leadVendor.findMany({
    where: { id: { in: vendorIds } },
    select: { id: true, name: true },
  });
  const vendorMap = new Map(vendors.map((v) => [v.id, v.name]));

  const campaignIds = campaignGroupsToday
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
    byCampaignToday: campaignGroupsToday
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
  const today = new Date();
  today.setHours(0, 0, 0, 0);

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
          leads: { where: { receivedAt: { gte: today } } },
        },
      },
    },
    orderBy: { name: 'asc' },
  });

  return users;
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

export async function bulkCreateLeadsBatch(
  rows: Array<Record<string, string | null>>
) {
  const vendor = await getOrCreateCsvVendor();
  const now = new Date();
  const creates: Prisma.LeadCreateManyInput[] = rows.map((row) => {
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
  return { created: result.count };
}

export async function revalidateLeadPaths() {
  revalidatePath('/admin/leads');
  revalidatePath('/admin/leads/pool');
  revalidatePath('/admin/leads/all');
}
