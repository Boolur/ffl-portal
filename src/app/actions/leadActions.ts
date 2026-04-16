'use server';

import { prisma } from '@/lib/prisma';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/auth';
import { LeadStatus, UserRole, type Prisma } from '@prisma/client';
import { revalidatePath } from 'next/cache';

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

export async function getLeadVendors() {
  return prisma.leadVendor.findMany({
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

export async function deleteLeadVendor(id: string) {
  await prisma.leadVendor.delete({ where: { id } });
  revalidatePath('/admin/leads/vendors');
  revalidatePath('/admin/leads/campaigns');
  revalidatePath('/admin/leads');
}

// ---------------------------------------------------------------------------
// Campaign CRUD
// ---------------------------------------------------------------------------

export async function getLeadCampaigns() {
  return prisma.leadCampaign.findMany({
    orderBy: { createdAt: 'desc' },
    include: {
      vendor: { select: { id: true, name: true, slug: true } },
      defaultUser: { select: { id: true, name: true } },
      _count: { select: { members: true, leads: true } },
    },
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

export async function deleteLeadCampaign(id: string) {
  await prisma.leadCampaign.delete({ where: { id } });
  revalidatePath('/admin/leads/campaigns');
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

export async function getLeads(filters?: {
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
  take?: number;
  skip?: number;
}) {
  const where: Record<string, unknown> = {};
  if (filters?.status) where.status = filters.status;
  if (filters?.unassigned) where.assignedUserId = null;
  else if (filters?.assignedUserId) where.assignedUserId = filters.assignedUserId;
  if (filters?.campaignId) where.campaignId = filters.campaignId;
  if (filters?.vendorId) where.vendorId = filters.vendorId;
  if (filters?.propertyState) {
    where.propertyState = { contains: filters.propertyState, mode: 'insensitive' };
  }
  if (filters?.source) {
    where.source = { contains: filters.source, mode: 'insensitive' };
  }
  if (filters?.dateFrom || filters?.dateTo) {
    const receivedAt: Record<string, Date> = {};
    if (filters.dateFrom) receivedAt.gte = new Date(filters.dateFrom);
    if (filters.dateTo) {
      const end = new Date(filters.dateTo);
      end.setHours(23, 59, 59, 999);
      receivedAt.lte = end;
    }
    where.receivedAt = receivedAt;
  }
  if (filters?.search) {
    where.OR = [
      { firstName: { contains: filters.search, mode: 'insensitive' } },
      { lastName: { contains: filters.search, mode: 'insensitive' } },
      { email: { contains: filters.search, mode: 'insensitive' } },
      { phone: { contains: filters.search, mode: 'insensitive' } },
    ];
  }

  const [leads, total] = await prisma.$transaction([
    prisma.lead.findMany({
      where,
      include: {
        vendor: { select: { id: true, name: true } },
        campaign: { select: { id: true, name: true } },
        assignedUser: { select: { id: true, name: true } },
        _count: { select: { notes: true } },
      },
      orderBy: { receivedAt: 'desc' },
      take: filters?.take ?? 100,
      skip: filters?.skip ?? 0,
    }),
    prisma.lead.count({ where }),
  ]);

  return { leads, total };
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
    globalDailyQuota?: number;
    globalWeeklyQuota?: number;
    globalMonthlyQuota?: number;
  }
) {
  await prisma.userLeadQuota.upsert({
    where: { userId },
    create: {
      userId,
      leadsEnabled: data.leadsEnabled ?? true,
      licensedStates: data.licensedStates ?? [],
      globalDailyQuota: data.globalDailyQuota ?? 0,
      globalWeeklyQuota: data.globalWeeklyQuota ?? 0,
      globalMonthlyQuota: data.globalMonthlyQuota ?? 0,
    },
    update: {
      ...(data.leadsEnabled !== undefined && { leadsEnabled: data.leadsEnabled }),
      ...(data.licensedStates !== undefined && { licensedStates: data.licensedStates }),
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

const CSV_VENDOR_SLUG = 'csv-upload';

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
  'employer', 'jobTitle', 'employmentLength', 'selfEmployed', 'income', 'bankruptcy', 'homeowner',
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
