'use client';

import React, { useState, useMemo } from 'react';
import {
  CampaignGroupManager,
  type CampaignGroupSummary,
  type GroupPickerCampaign,
} from './CampaignGroupManager';
import { CampaignManager } from './CampaignManager';
import { CampaignNextUpPanel } from './CampaignNextUpPanel';
import type { CampaignNextUpRow } from '@/app/actions/leadActions';

type Vendor = { id: string; name: string; slug: string };
type EligibleUser = { id: string; name: string; email: string; role: string };

// Mirrors the Campaign shape that CampaignManager already consumes. Kept
// loose with `unknown`/record types on the catch-all fields so we don't
// have to duplicate every nested Prisma shape here.
type Campaign = {
  id: string;
  name: string;
  description: string | null;
  vendorId: string;
  routingTag: string;
  active: boolean;
  distributionMethod: string;
  independentRotation: boolean;
  duplicateHandling: string;
  defaultLeadStatus: string;
  enableUserQuotas: boolean;
  defaultUserId: string | null;
  stateFilter: string[];
  loanTypeFilter: string[];
  vendor: { id: string; name: string; slug: string };
  defaultUser: { id: string; name: string } | null;
  group?: { id: string; name: string; color: string } | null;
  groupId?: string | null;
  _count: { members: number; leads: number };
  createdAt: Date | string;
  updatedAt: Date | string;
  totalDailyQuota: number;
  avgLeads5bd: number;
};

type Props = {
  campaigns: Campaign[];
  vendors: Vendor[];
  users: EligibleUser[];
  groups: CampaignGroupSummary[];
  nextUpRoster: CampaignNextUpRow[];
};

export function CampaignsPageClient({ campaigns, vendors, users, groups, nextUpRoster }: Props) {
  // `null` means "no group filter"; '__none__' is a sentinel meaning
  // "only show campaigns that don't belong to any group".
  const [filterGroupId, setFilterGroupId] = useState<string | null>(null);

  // Map campaigns into the minimal shape CampaignGroupManager needs for
  // its campaign picker inside the edit modal.
  const pickerCampaigns: GroupPickerCampaign[] = useMemo(
    () =>
      campaigns.map((c) => ({
        id: c.id,
        name: c.name,
        active: c.active,
        vendorName: c.vendor.name,
        groupId: c.groupId ?? null,
      })),
    [campaigns]
  );

  const groupOptions = useMemo(
    () =>
      groups.map((g) => ({
        id: g.id,
        name: g.name,
        color: g.color,
        active: g.active,
      })),
    [groups]
  );

  return (
    <div className="space-y-5">
      <CampaignGroupManager
        groups={groups}
        campaigns={pickerCampaigns}
        users={users}
        selectedGroupId={filterGroupId}
        onSelectGroup={setFilterGroupId}
      />
      <CampaignNextUpPanel
        initialRoster={nextUpRoster}
        filterGroupId={filterGroupId}
      />
      <CampaignManager
        campaigns={campaigns}
        vendors={vendors}
        users={users}
        groups={groupOptions}
        filterGroupId={filterGroupId}
        onChangeFilterGroupId={setFilterGroupId}
      />
    </div>
  );
}
