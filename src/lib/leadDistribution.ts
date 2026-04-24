/**
 * Shared round-robin eligibility logic used by both the live distributor
 * (distributeLead in src/app/actions/leadActions.ts) and the admin
 * "Up Next" tracker on /admin/leads/campaigns.
 *
 * Extracting this keeps the two code paths from drifting: whoever the
 * panel says is "Up Next" is exactly who distributeLead would pick for
 * the same campaign state, modulo the lead-state license check (which
 * the panel skips since there's no specific lead to score).
 */

export type GauntletMember = {
  id: string;
  userId: string;
  userName: string;
  roundRobinPosition: number;
  active: boolean;
  licensedStates: string[];
  receiveDays: number[];
  dailyQuota: number;
  weeklyQuota: number;
  monthlyQuota: number;
  leadsReceivedToday: number;
  leadsReceivedThisWeek: number;
  leadsReceivedThisMonth: number;
};

export type GauntletGlobalQuota = {
  leadsEnabled: boolean;
  licensedStates: string[];
  globalDailyQuota: number;
  globalWeeklyQuota: number;
  globalMonthlyQuota: number;
  leadsReceivedToday: number;
  leadsReceivedThisWeek: number;
  leadsReceivedThisMonth: number;
};

export type GauntletCampaign = {
  distributionMethod: 'ROUND_ROBIN' | 'MANUAL' | string;
  enableUserQuotas: boolean;
  defaultUserId: string | null;
  defaultUserName: string | null;
};

export type GauntletContext = {
  // Two-letter state (e.g. "WA"). null/undefined => skip the state-license
  // check entirely. Real distribution passes lead.propertyState; the Up
  // Next panel passes null since no specific lead exists.
  leadState?: string | null;
  // 0 (Sun) - 6 (Sat). Pass new Date().getDay() at the call site.
  dayOfWeek: number;
};

export type SkipReason =
  | 'LEADS_DISABLED'
  | 'GLOBAL_STATE'
  | 'CAMPAIGN_STATE'
  | 'RECEIVE_DAY'
  | 'CAMPAIGN_DAILY'
  | 'CAMPAIGN_WEEKLY'
  | 'CAMPAIGN_MONTHLY'
  | 'GLOBAL_DAILY'
  | 'GLOBAL_WEEKLY'
  | 'GLOBAL_MONTHLY';

export type NextUpResult =
  | { kind: 'MEMBER'; memberId: string; userId: string; name: string }
  | {
      kind: 'DEFAULT';
      userId: string;
      name: string;
      reason: 'NO_MEMBERS' | 'ALL_SKIPPED';
    }
  | {
      kind: 'UNASSIGNED';
      reason:
        | 'NO_MEMBERS_NO_DEFAULT'
        | 'ALL_SKIPPED_NO_DEFAULT'
        | 'MANUAL';
    };

/**
 * Pure gauntlet check for a single member against a campaign + context.
 * Returns `null` on pass, or a SkipReason on the first failed gate.
 * Matches the inline checks in distributeLead 1:1.
 */
export function evaluateMember(
  campaign: GauntletCampaign,
  member: GauntletMember,
  globalQuota: GauntletGlobalQuota | null,
  ctx: GauntletContext
): SkipReason | null {
  const leadState = ctx.leadState?.trim().toUpperCase() || '';

  if (globalQuota && !globalQuota.leadsEnabled) return 'LEADS_DISABLED';

  if (globalQuota && globalQuota.licensedStates.length > 0 && leadState) {
    const globalStates = globalQuota.licensedStates.map((s) => s.trim().toUpperCase());
    if (!globalStates.includes(leadState)) return 'GLOBAL_STATE';
  }

  if (member.licensedStates.length > 0 && leadState) {
    const upperStates = member.licensedStates.map((s) => s.trim().toUpperCase());
    if (!upperStates.includes(leadState)) return 'CAMPAIGN_STATE';
  }

  if (member.receiveDays.length > 0 && !member.receiveDays.includes(ctx.dayOfWeek)) {
    return 'RECEIVE_DAY';
  }

  if (campaign.enableUserQuotas) {
    if (member.dailyQuota > 0 && member.leadsReceivedToday >= member.dailyQuota) {
      return 'CAMPAIGN_DAILY';
    }
    if (member.weeklyQuota > 0 && member.leadsReceivedThisWeek >= member.weeklyQuota) {
      return 'CAMPAIGN_WEEKLY';
    }
    if (member.monthlyQuota > 0 && member.leadsReceivedThisMonth >= member.monthlyQuota) {
      return 'CAMPAIGN_MONTHLY';
    }
  }

  if (globalQuota) {
    if (
      globalQuota.globalDailyQuota > 0 &&
      globalQuota.leadsReceivedToday >= globalQuota.globalDailyQuota
    ) {
      return 'GLOBAL_DAILY';
    }
    if (
      globalQuota.globalWeeklyQuota > 0 &&
      globalQuota.leadsReceivedThisWeek >= globalQuota.globalWeeklyQuota
    ) {
      return 'GLOBAL_WEEKLY';
    }
    if (
      globalQuota.globalMonthlyQuota > 0 &&
      globalQuota.leadsReceivedThisMonth >= globalQuota.globalMonthlyQuota
    ) {
      return 'GLOBAL_MONTHLY';
    }
  }

  return null;
}

/**
 * Walks `members` in the order supplied (callers pass them pre-sorted by
 * roundRobinPosition asc) and returns the first member who passes the
 * gauntlet, falling through to the campaign's defaultUser when none do.
 */
export function findNextEligibleMember(
  campaign: GauntletCampaign,
  members: GauntletMember[],
  globalQuotasByUserId: Map<string, GauntletGlobalQuota>,
  ctx: GauntletContext
): NextUpResult {
  if (campaign.distributionMethod === 'MANUAL') {
    return { kind: 'UNASSIGNED', reason: 'MANUAL' };
  }

  if (members.length === 0) {
    if (campaign.defaultUserId) {
      return {
        kind: 'DEFAULT',
        userId: campaign.defaultUserId,
        name: campaign.defaultUserName ?? 'Default user',
        reason: 'NO_MEMBERS',
      };
    }
    return { kind: 'UNASSIGNED', reason: 'NO_MEMBERS_NO_DEFAULT' };
  }

  for (const member of members) {
    if (!member.active) continue;
    const globalQuota = globalQuotasByUserId.get(member.userId) ?? null;
    const skip = evaluateMember(campaign, member, globalQuota, ctx);
    if (skip === null) {
      return {
        kind: 'MEMBER',
        memberId: member.id,
        userId: member.userId,
        name: member.userName,
      };
    }
  }

  if (campaign.defaultUserId) {
    return {
      kind: 'DEFAULT',
      userId: campaign.defaultUserId,
      name: campaign.defaultUserName ?? 'Default user',
      reason: 'ALL_SKIPPED',
    };
  }
  return { kind: 'UNASSIGNED', reason: 'ALL_SKIPPED_NO_DEFAULT' };
}
