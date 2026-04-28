/**
 * Live lead-count lookups.
 *
 * The distribution engine used to gate on stored counters on
 * CampaignMember (leadsReceivedToday / ThisWeek / ThisMonth), reset by
 * a nightly cron. Two bugs fell out of that design:
 *
 *   1. Timezone drift. The cron ran at midnight UTC, which is 5 PM PT
 *      the day before. A CA team would start a new workday with
 *      yesterday-evening's tallies still counting.
 *
 *   2. Silent divergence. Any reassign / delete / manual override moved
 *      the Lead rows but didn't touch the counter, so the gauntlet
 *      progressively saw numbers that had nothing to do with reality.
 *
 * These helpers compute the same counts directly from Lead.assignedAt,
 * bounded by the business-day helpers in dateBounds.ts. That makes the
 * engine self-correcting (no cron dependency), timezone-correct
 * (business day = midnight Pacific), and immune to the drift above.
 */
import { prisma } from '@/lib/prisma';
import {
  startOfBusinessDay,
  startOfBusinessMonth,
  startOfBusinessWeek,
  startOfBusinessYear,
} from '@/lib/dateBounds';

export type LiveCampaignMemberCounts = {
  today: number;
  week: number;
  month: number;
};

export type LiveUserCounts = LiveCampaignMemberCounts & { year: number };

const keyOf = (userId: string, campaignId: string) => `${userId}::${campaignId}`;

/**
 * For each (userId, campaignId) pair, counts Lead rows where that user
 * is the assignee on that campaign and assignedAt falls in the current
 * day/week/month in the business timezone.
 *
 * One groupBy per window (3 queries total), regardless of roster size.
 */
export async function getLiveCampaignMemberCounts(
  pairs: Array<{ userId: string; campaignId: string }>
): Promise<Map<string, LiveCampaignMemberCounts>> {
  if (pairs.length === 0) return new Map();

  const userIds = Array.from(new Set(pairs.map((p) => p.userId)));
  const campaignIds = Array.from(new Set(pairs.map((p) => p.campaignId)));
  const now = new Date();
  const dayStart = startOfBusinessDay(now);
  const weekStart = startOfBusinessWeek(now);
  const monthStart = startOfBusinessMonth(now);

  const sharedWhere = {
    assignedUserId: { in: userIds },
    campaignId: { in: campaignIds },
  } as const;

  // groupBy returns one row per (assignedUserId, campaignId) pair with
  // activity in the window. Missing pairs default to 0 in the map.
  const [dayRows, weekRows, monthRows] = await Promise.all([
    prisma.lead.groupBy({
      by: ['assignedUserId', 'campaignId'],
      where: { ...sharedWhere, assignedAt: { gte: dayStart } },
      _count: { _all: true },
    }),
    prisma.lead.groupBy({
      by: ['assignedUserId', 'campaignId'],
      where: { ...sharedWhere, assignedAt: { gte: weekStart } },
      _count: { _all: true },
    }),
    prisma.lead.groupBy({
      by: ['assignedUserId', 'campaignId'],
      where: { ...sharedWhere, assignedAt: { gte: monthStart } },
      _count: { _all: true },
    }),
  ]);

  const result = new Map<string, LiveCampaignMemberCounts>();
  for (const p of pairs) {
    result.set(keyOf(p.userId, p.campaignId), { today: 0, week: 0, month: 0 });
  }
  for (const row of dayRows) {
    if (!row.assignedUserId || !row.campaignId) continue;
    const bucket = result.get(keyOf(row.assignedUserId, row.campaignId));
    if (bucket) bucket.today = row._count._all;
  }
  for (const row of weekRows) {
    if (!row.assignedUserId || !row.campaignId) continue;
    const bucket = result.get(keyOf(row.assignedUserId, row.campaignId));
    if (bucket) bucket.week = row._count._all;
  }
  for (const row of monthRows) {
    if (!row.assignedUserId || !row.campaignId) continue;
    const bucket = result.get(keyOf(row.assignedUserId, row.campaignId));
    if (bucket) bucket.month = row._count._all;
  }
  return result;
}

/**
 * Global per-user counts across every campaign. Drives the
 * UserLeadQuota gate (globalDaily/Weekly/Monthly) and the
 * "Leads Day/Week/Month/YTD" columns on the Lead Users screen.
 */
export async function getLiveUserCounts(
  userIds: string[]
): Promise<Map<string, LiveUserCounts>> {
  if (userIds.length === 0) return new Map();

  const now = new Date();
  const dayStart = startOfBusinessDay(now);
  const weekStart = startOfBusinessWeek(now);
  const monthStart = startOfBusinessMonth(now);
  const yearStart = startOfBusinessYear(now);

  const sharedWhere = { assignedUserId: { in: userIds } } as const;

  const [dayRows, weekRows, monthRows, yearRows] = await Promise.all([
    prisma.lead.groupBy({
      by: ['assignedUserId'],
      where: { ...sharedWhere, assignedAt: { gte: dayStart } },
      _count: { _all: true },
    }),
    prisma.lead.groupBy({
      by: ['assignedUserId'],
      where: { ...sharedWhere, assignedAt: { gte: weekStart } },
      _count: { _all: true },
    }),
    prisma.lead.groupBy({
      by: ['assignedUserId'],
      where: { ...sharedWhere, assignedAt: { gte: monthStart } },
      _count: { _all: true },
    }),
    prisma.lead.groupBy({
      by: ['assignedUserId'],
      where: { ...sharedWhere, assignedAt: { gte: yearStart } },
      _count: { _all: true },
    }),
  ]);

  const result = new Map<string, LiveUserCounts>();
  for (const id of userIds) {
    result.set(id, { today: 0, week: 0, month: 0, year: 0 });
  }
  for (const row of dayRows) {
    if (!row.assignedUserId) continue;
    const b = result.get(row.assignedUserId);
    if (b) b.today = row._count._all;
  }
  for (const row of weekRows) {
    if (!row.assignedUserId) continue;
    const b = result.get(row.assignedUserId);
    if (b) b.week = row._count._all;
  }
  for (const row of monthRows) {
    if (!row.assignedUserId) continue;
    const b = result.get(row.assignedUserId);
    if (b) b.month = row._count._all;
  }
  for (const row of yearRows) {
    if (!row.assignedUserId) continue;
    const b = result.get(row.assignedUserId);
    if (b) b.year = row._count._all;
  }
  return result;
}
