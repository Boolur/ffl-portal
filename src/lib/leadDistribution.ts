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

/**
 * Per-member skip record. Returned alongside every NextUpResult so the
 * admin Up Next panel can show exactly WHY each member was passed over
 * (e.g. "Not licensed in WA", "Daily quota hit 24/24"). This turns
 * launch-day round-robin debugging from a black box into a glance.
 */
export type SkippedMember = {
  memberId: string;
  userId: string;
  name: string;
  reason: SkipReason;
  // Extra human-readable context tied to the reason (e.g. the cap that
  // was hit, the state the lead was in). Optional — the UI can render
  // a generic label from `reason` alone.
  detail?: string;
};

/**
 * Per-member roster snapshot. Unlike `SkippedMember` which only captures
 * users the gauntlet passed over, this covers every member so the admin
 * Up Next panel can always show the full roster state at a glance:
 *
 *   - UP_NEXT: the member the gauntlet picked (first eligible in
 *     rotation order)
 *   - QUEUED:  active, eligible members positioned behind UP_NEXT — the
 *     "bench" that'll rotate in on subsequent leads
 *   - SKIPPED: active members gated out by a SkipReason (quota cap,
 *     licensing mismatch, leads disabled, etc.)
 *   - INACTIVE: members flagged inactive on the campaign (don't rotate)
 *
 * Each entry carries the live daily/weekly/monthly cap snapshot so the
 * UI can render "Ready · 1/2 today" / "Daily cap hit (2/2)" without
 * another round-trip.
 */
export type RosterStatus = 'UP_NEXT' | 'QUEUED' | 'SKIPPED' | 'INACTIVE';

export type RosterMember = {
  memberId: string;
  userId: string;
  name: string;
  roundRobinPosition: number;
  status: RosterStatus;
  skipReason: SkipReason | null;
  skipDetail: string | null;
  dailyCount: number;
  dailyQuota: number;
  weeklyCount: number;
  weeklyQuota: number;
  monthlyCount: number;
  monthlyQuota: number;
};

export type NextUpResult = (
  | { kind: 'MEMBER'; memberId: string; userId: string; name: string }
  | {
      kind: 'DEFAULT';
      userId: string;
      name: string;
      // NO_MEMBERS remains the only valid DEFAULT reason now that
      // ALL_SKIPPED routes to UNASSIGNED (so round-robin can't be
      // silently swallowed by the fallback user). See leadActions.ts
      // distributeLead for the matching live behavior.
      reason: 'NO_MEMBERS';
    }
  | {
      kind: 'UNASSIGNED';
      reason:
        | 'NO_MEMBERS_NO_DEFAULT'
        | 'ALL_SKIPPED'
        | 'MANUAL';
    }
) & {
  skipped: SkippedMember[];
  // Full roster snapshot for the expandable breakdown. See
  // `RosterMember` for the semantics of each status.
  roster: RosterMember[];
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
 * Builds a short, human-readable detail string to accompany a SkipReason.
 * The panel uses this to render "Not licensed in WA", "Daily cap 24/24",
 * etc., without the UI having to re-derive from raw member numbers.
 */
export function describeSkip(
  reason: SkipReason,
  member: GauntletMember,
  globalQuota: GauntletGlobalQuota | null,
  ctx: GauntletContext
): string | undefined {
  const leadState = ctx.leadState?.trim().toUpperCase() || '';
  switch (reason) {
    case 'LEADS_DISABLED':
      return 'Leads toggled off for this user';
    case 'GLOBAL_STATE':
      return leadState
        ? `Not globally licensed in ${leadState}`
        : 'Not globally licensed in lead state';
    case 'CAMPAIGN_STATE':
      return leadState
        ? `Not licensed in ${leadState} on this campaign`
        : 'Not licensed in lead state on this campaign';
    case 'RECEIVE_DAY': {
      const names = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
      const today = names[ctx.dayOfWeek] ?? `day ${ctx.dayOfWeek}`;
      return `Does not receive on ${today}`;
    }
    case 'CAMPAIGN_DAILY':
      return `Daily cap hit (${member.leadsReceivedToday}/${member.dailyQuota})`;
    case 'CAMPAIGN_WEEKLY':
      return `Weekly cap hit (${member.leadsReceivedThisWeek}/${member.weeklyQuota})`;
    case 'CAMPAIGN_MONTHLY':
      return `Monthly cap hit (${member.leadsReceivedThisMonth}/${member.monthlyQuota})`;
    case 'GLOBAL_DAILY':
      return globalQuota
        ? `Global daily cap hit (${globalQuota.leadsReceivedToday}/${globalQuota.globalDailyQuota})`
        : 'Global daily cap hit';
    case 'GLOBAL_WEEKLY':
      return globalQuota
        ? `Global weekly cap hit (${globalQuota.leadsReceivedThisWeek}/${globalQuota.globalWeeklyQuota})`
        : 'Global weekly cap hit';
    case 'GLOBAL_MONTHLY':
      return globalQuota
        ? `Global monthly cap hit (${globalQuota.leadsReceivedThisMonth}/${globalQuota.globalMonthlyQuota})`
        : 'Global monthly cap hit';
  }
}

/**
 * Walks `members` in the order supplied (callers pass them pre-sorted by
 * roundRobinPosition asc) and returns the first member who passes the
 * gauntlet. If no one passes, returns UNASSIGNED/ALL_SKIPPED (the caller
 * is expected to park the lead in the Unassigned Pool) — we intentionally
 * do NOT fall through to `defaultUserId` here, because that swallows the
 * rotation the moment any gate (licensing, receive days, quotas) trips
 * for every member. The empty-members branch still honors the default
 * user for the genuinely-different "no roster" case.
 */
export function findNextEligibleMember(
  campaign: GauntletCampaign,
  members: GauntletMember[],
  globalQuotasByUserId: Map<string, GauntletGlobalQuota>,
  ctx: GauntletContext
): NextUpResult {
  if (campaign.distributionMethod === 'MANUAL') {
    return {
      kind: 'UNASSIGNED',
      reason: 'MANUAL',
      skipped: [],
      roster: buildRosterSnapshot(members, null, null, globalQuotasByUserId, campaign, ctx),
    };
  }

  if (members.length === 0) {
    if (campaign.defaultUserId) {
      return {
        kind: 'DEFAULT',
        userId: campaign.defaultUserId,
        name: campaign.defaultUserName ?? 'Default user',
        reason: 'NO_MEMBERS',
        skipped: [],
        roster: [],
      };
    }
    return {
      kind: 'UNASSIGNED',
      reason: 'NO_MEMBERS_NO_DEFAULT',
      skipped: [],
      roster: [],
    };
  }

  const skipped: SkippedMember[] = [];
  // We record which member got picked (if any) and the reason per member
  // in a side map so buildRosterSnapshot below can flag UP_NEXT / QUEUED
  // / SKIPPED without re-running the gauntlet.
  const skipByUserId = new Map<string, SkipReason>();
  let upNextUserId: string | null = null;

  for (const member of members) {
    if (!member.active) continue;
    const globalQuota = globalQuotasByUserId.get(member.userId) ?? null;
    const skip = evaluateMember(campaign, member, globalQuota, ctx);
    if (skip === null) {
      upNextUserId = member.userId;
      const roster = buildRosterSnapshot(
        members,
        member.userId,
        skipByUserId,
        globalQuotasByUserId,
        campaign,
        ctx
      );
      return {
        kind: 'MEMBER',
        memberId: member.id,
        userId: member.userId,
        name: member.userName,
        skipped,
        roster,
      };
    }
    skipByUserId.set(member.userId, skip);
    skipped.push({
      memberId: member.id,
      userId: member.userId,
      name: member.userName,
      reason: skip,
      detail: describeSkip(skip, member, globalQuota, ctx),
    });
  }

  // All members failed the gauntlet. Route to the Unassigned Pool
  // unconditionally — never to defaultUserId — to preserve rotation.
  return {
    kind: 'UNASSIGNED',
    reason: 'ALL_SKIPPED',
    skipped,
    roster: buildRosterSnapshot(
      members,
      upNextUserId,
      skipByUserId,
      globalQuotasByUserId,
      campaign,
      ctx
    ),
  };
}

/**
 * Snapshot every member of the roster with their current status + live
 * quota counts. Runs after the gauntlet loop so `upNextUserId` and
 * `skipByUserId` are already settled; a null `skipByUserId` means we
 * haven't evaluated anyone (e.g. MANUAL campaigns) and every active
 * member gets QUEUED.
 */
function buildRosterSnapshot(
  members: GauntletMember[],
  upNextUserId: string | null,
  skipByUserId: Map<string, SkipReason> | null,
  globalQuotasByUserId: Map<string, GauntletGlobalQuota>,
  campaign: GauntletCampaign,
  ctx: GauntletContext
): RosterMember[] {
  return members.map((m) => {
    const globalQuota = globalQuotasByUserId.get(m.userId) ?? null;
    let status: RosterStatus;
    let reason: SkipReason | null = null;
    if (!m.active) {
      status = 'INACTIVE';
    } else if (m.userId === upNextUserId) {
      status = 'UP_NEXT';
    } else if (skipByUserId && skipByUserId.has(m.userId)) {
      status = 'SKIPPED';
      reason = skipByUserId.get(m.userId) ?? null;
    } else {
      status = 'QUEUED';
    }
    return {
      memberId: m.id,
      userId: m.userId,
      name: m.userName,
      roundRobinPosition: m.roundRobinPosition,
      status,
      skipReason: reason,
      skipDetail: reason ? describeSkip(reason, m, globalQuota, ctx) ?? null : null,
      dailyCount: m.leadsReceivedToday,
      dailyQuota: m.dailyQuota,
      weeklyCount: m.leadsReceivedThisWeek,
      weeklyQuota: m.weeklyQuota,
      monthlyCount: m.leadsReceivedThisMonth,
      monthlyQuota: m.monthlyQuota,
    };
  });
}
