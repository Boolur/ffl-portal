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
 *
 * Performance note: both helpers execute exactly ONE raw SQL query each
 * using Postgres `FILTER` conditional aggregation, instead of the 3-4
 * parallel `groupBy` calls this module used to fire. That matters on a
 * Supabase pgbouncer-pooled setup with a tight connection limit — the
 * earlier pattern starved the pool under launch-day traffic and took
 * the whole portal down. One query per helper keeps us well inside the
 * pool budget even when getCampaignNextUpRoster polls every 30 s.
 */
import { prisma } from '@/lib/prisma';
import { Prisma } from '@prisma/client';
import {
  startOfBusinessDay,
  startOfBusinessMonth,
  startOfBusinessWeek,
  startOfBusinessYear,
} from '@/lib/dateBounds';

// Builds a safe comma-separated IN-list of string params. We need this
// because `IN` clauses in raw SQL can't take a JS array as a single
// parameter — Prisma's tagged template expands scalars only. Using
// Prisma.join keeps the values fully parameterized (no SQL injection
// risk) while producing the `$1, $2, $3, ...` shape Postgres expects.
function inListString(ids: string[]) {
  return Prisma.join(ids.map((id) => Prisma.sql`${id}`));
}

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
 * day/week/month in the business timezone. One SQL query total.
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

  // $queryRaw with a single FILTER aggregate is ~3x cheaper than firing
  // three separate groupBy queries in Promise.all — both in Postgres
  // CPU and, crucially, in connection-pool checkouts. The latter is the
  // constraint on Vercel + Supabase pgbouncer; every parallel query
  // grabs a separate slot from the ~5-per-lambda budget.
  const userList = inListString(userIds);
  const campaignList = inListString(campaignIds);
  const rows = await prisma.$queryRaw<
    Array<{
      user_id: string;
      campaign_id: string;
      today_count: bigint;
      week_count: bigint;
      month_count: bigint;
    }>
  >(Prisma.sql`
    SELECT
      "assignedUserId" AS user_id,
      "campaignId" AS campaign_id,
      COUNT(*) FILTER (WHERE "assignedAt" >= ${dayStart}) AS today_count,
      COUNT(*) FILTER (WHERE "assignedAt" >= ${weekStart}) AS week_count,
      COUNT(*) FILTER (WHERE "assignedAt" >= ${monthStart}) AS month_count
    FROM "Lead"
    WHERE
      "assignedUserId" IN (${userList})
      AND "campaignId" IN (${campaignList})
      AND "assignedAt" >= ${monthStart}
    GROUP BY "assignedUserId", "campaignId"
  `);

  const result = new Map<string, LiveCampaignMemberCounts>();
  for (const p of pairs) {
    result.set(keyOf(p.userId, p.campaignId), { today: 0, week: 0, month: 0 });
  }
  for (const row of rows) {
    const key = keyOf(row.user_id, row.campaign_id);
    if (!result.has(key)) continue;
    result.set(key, {
      today: Number(row.today_count),
      week: Number(row.week_count),
      month: Number(row.month_count),
    });
  }
  return result;
}

/**
 * Global per-user counts across every campaign. Drives the
 * UserLeadQuota gate (globalDaily/Weekly/Monthly) and the
 * "Leads Day/Week/Month/YTD" columns on the Lead Users screen.
 * Single SQL query regardless of userIds size.
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

  const userList = inListString(userIds);
  const rows = await prisma.$queryRaw<
    Array<{
      user_id: string;
      today_count: bigint;
      week_count: bigint;
      month_count: bigint;
      year_count: bigint;
    }>
  >(Prisma.sql`
    SELECT
      "assignedUserId" AS user_id,
      COUNT(*) FILTER (WHERE "assignedAt" >= ${dayStart}) AS today_count,
      COUNT(*) FILTER (WHERE "assignedAt" >= ${weekStart}) AS week_count,
      COUNT(*) FILTER (WHERE "assignedAt" >= ${monthStart}) AS month_count,
      COUNT(*) FILTER (WHERE "assignedAt" >= ${yearStart}) AS year_count
    FROM "Lead"
    WHERE
      "assignedUserId" IN (${userList})
      AND "assignedAt" >= ${yearStart}
    GROUP BY "assignedUserId"
  `);

  const result = new Map<string, LiveUserCounts>();
  for (const id of userIds) {
    result.set(id, { today: 0, week: 0, month: 0, year: 0 });
  }
  for (const row of rows) {
    if (!result.has(row.user_id)) continue;
    result.set(row.user_id, {
      today: Number(row.today_count),
      week: Number(row.week_count),
      month: Number(row.month_count),
      year: Number(row.year_count),
    });
  }
  return result;
}
