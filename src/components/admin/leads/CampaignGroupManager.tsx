'use client';

import React, { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import {
  Loader2,
  Plus,
  Pencil,
  X,
  Check,
  Search,
  Layers,
  Archive,
  ArchiveRestore,
  AlertTriangle,
  UserPlus,
  Sparkles,
} from 'lucide-react';
import { useRouter } from 'next/navigation';
import {
  createLeadCampaignGroup,
  updateLeadCampaignGroup,
  archiveLeadCampaignGroup,
  restoreLeadCampaignGroup,
  hardDeleteLeadCampaignGroup,
  setGroupCampaigns,
  addUsersToGroupCampaigns,
} from '@/app/actions/leadActions';

export type CampaignGroupSummary = {
  id: string;
  name: string;
  description: string | null;
  color: string;
  active: boolean;
  createdAt: Date | string;
  updatedAt: Date | string;
  campaignCount: number;
  memberAssignments: number;
};

type EligibleUser = { id: string; name: string; email: string; role: string };

// Lightweight shape of a campaign for the picker inside the modal. The
// parent (CampaignManager) already has the full list; we only need what
// the user needs to see in the checkbox list.
export type GroupPickerCampaign = {
  id: string;
  name: string;
  active: boolean;
  vendorName: string;
  groupId: string | null;
};

type Props = {
  groups: CampaignGroupSummary[];
  campaigns: GroupPickerCampaign[];
  users: EligibleUser[];
  selectedGroupId: string | null;
  onSelectGroup: (groupId: string | null) => void;
};

// Palette keys must match ALLOWED_GROUP_COLORS on the server. Each key
// maps to a (solid, soft) pair so the chip can render a solid dot plus a
// matching pale background when it is active.
const GROUP_COLOR_CLASSES: Record<
  string,
  { dot: string; chipActive: string; chipInactive: string; ring: string }
> = {
  blue: {
    dot: 'bg-blue-500',
    chipActive: 'border-blue-300 bg-blue-50 text-blue-800',
    chipInactive: 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50',
    ring: 'ring-blue-300',
  },
  violet: {
    dot: 'bg-violet-500',
    chipActive: 'border-violet-300 bg-violet-50 text-violet-800',
    chipInactive: 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50',
    ring: 'ring-violet-300',
  },
  emerald: {
    dot: 'bg-emerald-500',
    chipActive: 'border-emerald-300 bg-emerald-50 text-emerald-800',
    chipInactive: 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50',
    ring: 'ring-emerald-300',
  },
  amber: {
    dot: 'bg-amber-500',
    chipActive: 'border-amber-300 bg-amber-50 text-amber-800',
    chipInactive: 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50',
    ring: 'ring-amber-300',
  },
  rose: {
    dot: 'bg-rose-500',
    chipActive: 'border-rose-300 bg-rose-50 text-rose-800',
    chipInactive: 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50',
    ring: 'ring-rose-300',
  },
  cyan: {
    dot: 'bg-cyan-500',
    chipActive: 'border-cyan-300 bg-cyan-50 text-cyan-800',
    chipInactive: 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50',
    ring: 'ring-cyan-300',
  },
  fuchsia: {
    dot: 'bg-fuchsia-500',
    chipActive: 'border-fuchsia-300 bg-fuchsia-50 text-fuchsia-800',
    chipInactive: 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50',
    ring: 'ring-fuchsia-300',
  },
  slate: {
    dot: 'bg-slate-500',
    chipActive: 'border-slate-300 bg-slate-100 text-slate-800',
    chipInactive: 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50',
    ring: 'ring-slate-300',
  },
};

const GROUP_COLOR_KEYS = Object.keys(GROUP_COLOR_CLASSES);

function groupColorClasses(key: string) {
  return GROUP_COLOR_CLASSES[key] ?? GROUP_COLOR_CLASSES.blue;
}

export function CampaignGroupManager({
  groups,
  campaigns,
  users,
  selectedGroupId,
  onSelectGroup,
}: Props) {
  const router = useRouter();
  const [showArchived, setShowArchived] = useState(false);
  const [editingGroup, setEditingGroup] = useState<CampaignGroupSummary | null>(
    null
  );
  const [isCreating, setIsCreating] = useState(false);

  const archivedCount = useMemo(
    () => groups.filter((g) => !g.active).length,
    [groups]
  );

  const visibleGroups = useMemo(() => {
    if (showArchived) return groups;
    return groups.filter((g) => g.active);
  }, [groups, showArchived]);

  const openCreate = useCallback(() => {
    setIsCreating(true);
    setEditingGroup(null);
  }, []);

  const openEdit = useCallback((group: CampaignGroupSummary) => {
    setEditingGroup(group);
    setIsCreating(false);
  }, []);

  const closeModal = useCallback(() => {
    setEditingGroup(null);
    setIsCreating(false);
  }, []);

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 flex-wrap">
        <div className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-slate-500 mr-1">
          <Layers className="h-3.5 w-3.5" />
          Groups
        </div>

        <button
          type="button"
          onClick={() => onSelectGroup(null)}
          className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${
            selectedGroupId === null
              ? 'border-slate-300 bg-slate-100 text-slate-800 ring-1 ring-slate-300'
              : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
          }`}
        >
          All ({groups.reduce((sum, g) => sum + (g.active ? g.campaignCount : 0), 0) + campaigns.filter((c) => !c.groupId).length})
        </button>

        {visibleGroups.map((g) => {
          const cls = groupColorClasses(g.color);
          const isActive = selectedGroupId === g.id;
          const isArchivedLook = !g.active;
          return (
            <div key={g.id} className="relative group/chip">
              <button
                type="button"
                onClick={() => onSelectGroup(isActive ? null : g.id)}
                className={`inline-flex items-center gap-1.5 rounded-full border pl-2.5 pr-8 py-1.5 text-xs font-medium transition-colors ${
                  isActive ? cls.chipActive : cls.chipInactive
                } ${isActive ? `ring-1 ${cls.ring}` : ''} ${isArchivedLook ? 'opacity-60' : ''}`}
                title={g.description || g.name}
              >
                <span className={`inline-block h-2 w-2 rounded-full ${cls.dot}`} />
                <span className="truncate max-w-[160px]">{g.name}</span>
                <span className="text-[10px] font-semibold opacity-70">
                  {g.campaignCount}
                </span>
                {isArchivedLook && (
                  <Archive className="h-3 w-3 text-amber-600" />
                )}
              </button>
              <button
                type="button"
                onClick={() => openEdit(g)}
                className="absolute right-1 top-1/2 -translate-y-1/2 h-6 w-6 rounded-full flex items-center justify-center text-slate-400 hover:text-slate-700 hover:bg-white/60"
                aria-label={`Edit ${g.name}`}
                title="Edit group"
              >
                <Pencil className="h-3 w-3" />
              </button>
            </div>
          );
        })}

        <button
          type="button"
          onClick={openCreate}
          className="inline-flex items-center gap-1.5 rounded-full border border-dashed border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 hover:border-blue-400 hover:text-blue-700 transition-colors"
        >
          <Plus className="h-3.5 w-3.5" />
          New Group
        </button>

        {archivedCount > 0 && (
          <button
            type="button"
            onClick={() => setShowArchived((p) => !p)}
            className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors ml-auto ${
              showArchived
                ? 'border-amber-300 bg-amber-50 text-amber-700'
                : 'border-slate-200 bg-white text-slate-500 hover:bg-slate-50'
            }`}
          >
            <Archive className="h-3 w-3" />
            {showArchived ? 'Hide archived' : `Show archived (${archivedCount})`}
          </button>
        )}
      </div>

      {(editingGroup || isCreating) && (
        <GroupEditModal
          key={editingGroup?.id || 'new'}
          group={editingGroup}
          isCreating={isCreating}
          campaigns={campaigns}
          users={users}
          onClose={closeModal}
          onSaved={() => {
            closeModal();
            router.refresh();
          }}
        />
      )}
    </div>
  );
}

function GroupEditModal({
  group,
  isCreating,
  campaigns,
  users,
  onClose,
  onSaved,
}: {
  group: CampaignGroupSummary | null;
  isCreating: boolean;
  campaigns: GroupPickerCampaign[];
  users: EligibleUser[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const router = useRouter();
  const [name, setName] = useState(group?.name || '');
  const [description, setDescription] = useState(group?.description || '');
  const [color, setColor] = useState(group?.color || 'blue');

  // Preselect campaigns currently in this group so the checkbox list
  // reflects the existing membership.
  const [memberCampaignIds, setMemberCampaignIds] = useState<Set<string>>(
    () =>
      new Set(
        group ? campaigns.filter((c) => c.groupId === group.id).map((c) => c.id) : []
      )
  );
  const [campaignSearch, setCampaignSearch] = useState('');

  const [selectedUserIds, setSelectedUserIds] = useState<Set<string>>(new Set());
  const [userSearch, setUserSearch] = useState('');

  const [saving, setSaving] = useState(false);
  const [addingUsers, setAddingUsers] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [inlineSummary, setInlineSummary] = useState<string | null>(null);
  const summaryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  const [deleteConfirmName, setDeleteConfirmName] = useState('');

  useEffect(() => {
    return () => {
      if (summaryTimer.current) clearTimeout(summaryTimer.current);
    };
  }, []);

  const filteredCampaigns = useMemo(() => {
    const q = campaignSearch.trim().toLowerCase();
    let list = campaigns.filter((c) => c.active);
    if (q) {
      list = list.filter(
        (c) =>
          c.name.toLowerCase().includes(q) ||
          c.vendorName.toLowerCase().includes(q)
      );
    }
    return list;
  }, [campaigns, campaignSearch]);

  const filteredUsers = useMemo(() => {
    const q = userSearch.trim().toLowerCase();
    if (!q) return users;
    return users.filter(
      (u) => u.name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q)
    );
  }, [users, userSearch]);

  const toggleCampaign = useCallback((id: string) => {
    setMemberCampaignIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const toggleUser = useCallback((id: string) => {
    setSelectedUserIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const handleSave = async () => {
    setError(null);
    setSaving(true);
    try {
      let targetId: string;
      if (isCreating) {
        const created = await createLeadCampaignGroup({
          name,
          description: description || null,
          color,
        });
        targetId = created.id;
      } else if (group) {
        await updateLeadCampaignGroup(group.id, {
          name,
          description: description || null,
          color,
        });
        targetId = group.id;
      } else {
        return;
      }
      await setGroupCampaigns(targetId, Array.from(memberCampaignIds));
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save group');
    } finally {
      setSaving(false);
    }
  };

  const handleAddUsers = async () => {
    if (!group || selectedUserIds.size === 0) return;
    setError(null);
    setAddingUsers(true);
    try {
      const result = await addUsersToGroupCampaigns(
        group.id,
        Array.from(selectedUserIds)
      );
      const parts: string[] = [];
      parts.push(
        `Added ${result.userCount} user${result.userCount === 1 ? '' : 's'} across ${result.campaignCount} campaign${result.campaignCount === 1 ? '' : 's'}`
      );
      parts.push(
        `${result.totalAdded} new assignment${result.totalAdded === 1 ? '' : 's'}`
      );
      if (result.skippedAlreadyMember > 0) {
        parts.push(
          `${result.skippedAlreadyMember} skipped (already a member)`
        );
      }
      setInlineSummary(parts.join(' \u2022 '));
      if (summaryTimer.current) clearTimeout(summaryTimer.current);
      summaryTimer.current = setTimeout(() => setInlineSummary(null), 6000);
      setSelectedUserIds(new Set());
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not add users');
    } finally {
      setAddingUsers(false);
    }
  };

  const handleArchive = async () => {
    if (!group) return;
    setSaving(true);
    try {
      await archiveLeadCampaignGroup(group.id);
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not archive group');
      setSaving(false);
    }
  };

  const handleRestore = async () => {
    if (!group) return;
    setSaving(true);
    try {
      await restoreLeadCampaignGroup(group.id);
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not restore group');
      setSaving(false);
    }
  };

  const handleHardDelete = async () => {
    if (!group) return;
    if (deleteConfirmName.trim() !== group.name) {
      setError('Type the exact group name to confirm permanent deletion');
      return;
    }
    setSaving(true);
    try {
      await hardDeleteLeadCampaignGroup(group.id, deleteConfirmName);
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not delete group');
      setSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      onClick={onClose}
    >
      <div className="absolute inset-0 bg-slate-900/30 backdrop-blur-sm" />
      <div
        role="dialog"
        aria-modal="true"
        className="relative w-full max-w-3xl rounded-xl border border-slate-200 bg-white p-6 shadow-lg max-h-[88vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-5">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">
              {isCreating ? 'Create Campaign Group' : `Edit Group \u2022 ${group?.name}`}
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Bundle related campaigns and bulk-assign users to all of them at
              once.
            </p>
          </div>
          <button className="app-icon-btn" onClick={onClose} aria-label="Close">
            <X className="h-5 w-5" />
          </button>
        </div>

        {error && (
          <div className="mb-4 flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
            <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
        )}

        <div className="space-y-6">
          {/* Details */}
          <section>
            <p className="text-[11px] font-bold uppercase tracking-wider text-slate-500 mb-3">
              Details
            </p>
            <div className="grid grid-cols-2 gap-4">
              <label className="space-y-1 text-sm">
                <span className="font-medium text-slate-700">Name *</span>
                <input
                  className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="HELOC / HELOAN"
                />
              </label>
              <label className="space-y-1 text-sm">
                <span className="font-medium text-slate-700">Description</span>
                <input
                  className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Short note for admins"
                />
              </label>
            </div>
            <div className="mt-4">
              <span className="text-sm font-medium text-slate-700 block mb-2">
                Color
              </span>
              <div className="flex flex-wrap gap-2">
                {GROUP_COLOR_KEYS.map((key) => {
                  const cls = groupColorClasses(key);
                  const picked = color === key;
                  return (
                    <button
                      type="button"
                      key={key}
                      onClick={() => setColor(key)}
                      className={`relative h-8 w-8 rounded-full border transition-all ${
                        picked
                          ? 'border-slate-900 scale-110'
                          : 'border-slate-200 hover:border-slate-400'
                      }`}
                      aria-label={`Color ${key}`}
                      title={key}
                    >
                      <span
                        className={`absolute inset-1 rounded-full ${cls.dot}`}
                      />
                      {picked && (
                        <Check className="absolute inset-0 m-auto h-4 w-4 text-white drop-shadow" />
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          </section>

          {/* Campaigns in group */}
          <section>
            <div className="flex items-center justify-between mb-2">
              <p className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
                Campaigns in this group ({memberCampaignIds.size})
              </p>
              {memberCampaignIds.size > 0 && (
                <button
                  type="button"
                  className="text-[11px] font-medium text-slate-500 hover:text-slate-700"
                  onClick={() => setMemberCampaignIds(new Set())}
                >
                  Clear all
                </button>
              )}
            </div>
            <div className="relative mb-2">
              <Search className="absolute left-3 top-2.5 h-3.5 w-3.5 text-slate-400" />
              <input
                className="w-full rounded-lg border border-slate-200 bg-white pl-8 pr-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                placeholder="Search campaigns by name or vendor..."
                value={campaignSearch}
                onChange={(e) => setCampaignSearch(e.target.value)}
              />
            </div>
            <div className="max-h-64 overflow-y-auto rounded-lg border border-slate-200 bg-white divide-y divide-slate-100">
              {filteredCampaigns.length === 0 ? (
                <p className="px-4 py-6 text-center text-sm text-slate-500">
                  No campaigns match your search.
                </p>
              ) : (
                filteredCampaigns.map((c) => {
                  const checked = memberCampaignIds.has(c.id);
                  const takenByOtherGroup =
                    c.groupId && c.groupId !== (group?.id ?? '') && !checked;
                  return (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => toggleCampaign(c.id)}
                      className={`w-full flex items-center gap-3 px-3 py-2 text-left transition-colors ${
                        checked ? 'bg-blue-50' : 'hover:bg-slate-50'
                      }`}
                    >
                      <span
                        className={`h-4 w-4 rounded border flex items-center justify-center text-xs ${
                          checked
                            ? 'border-blue-500 bg-blue-500 text-white'
                            : 'border-slate-300 bg-white'
                        }`}
                      >
                        {checked && <Check className="h-3 w-3" />}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-slate-900 truncate">
                          {c.name}
                        </p>
                        <p className="text-[11px] text-slate-500">
                          {c.vendorName}
                        </p>
                      </div>
                      {takenByOtherGroup && (
                        <span className="text-[10px] font-semibold uppercase tracking-wider text-amber-600">
                          In another group
                        </span>
                      )}
                    </button>
                  );
                })
              )}
            </div>
            <p className="mt-1.5 text-[11px] text-slate-500">
              A campaign can only belong to one group. Selecting a campaign that
              is already in another group will move it here on save.
            </p>
          </section>

          {/* Bulk add users (edit-only) */}
          {!isCreating && group && (
            <section>
              <div className="flex items-center gap-2 mb-2">
                <UserPlus className="h-4 w-4 text-slate-500" />
                <p className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
                  Bulk add users to all campaigns in this group
                </p>
              </div>
              <p className="text-xs text-slate-500 mb-2">
                Adds the selected users to every campaign currently in this
                group. Existing members and quotas are untouched. Users already
                assigned to a campaign are skipped.
              </p>
              <div className="relative mb-2">
                <Search className="absolute left-3 top-2.5 h-3.5 w-3.5 text-slate-400" />
                <input
                  className="w-full rounded-lg border border-slate-200 bg-white pl-8 pr-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                  placeholder="Search users..."
                  value={userSearch}
                  onChange={(e) => setUserSearch(e.target.value)}
                />
              </div>
              <div className="max-h-56 overflow-y-auto rounded-lg border border-slate-200 bg-white divide-y divide-slate-100">
                {filteredUsers.length === 0 ? (
                  <p className="px-4 py-6 text-center text-sm text-slate-500">
                    No users match your search.
                  </p>
                ) : (
                  filteredUsers.map((u) => {
                    const checked = selectedUserIds.has(u.id);
                    return (
                      <button
                        key={u.id}
                        type="button"
                        onClick={() => toggleUser(u.id)}
                        className={`w-full flex items-center gap-3 px-3 py-2 text-left transition-colors ${
                          checked ? 'bg-blue-50' : 'hover:bg-slate-50'
                        }`}
                      >
                        <span
                          className={`h-4 w-4 rounded border flex items-center justify-center text-xs ${
                            checked
                              ? 'border-blue-500 bg-blue-500 text-white'
                              : 'border-slate-300 bg-white'
                          }`}
                        >
                          {checked && <Check className="h-3 w-3" />}
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium text-slate-900 truncate">
                            {u.name}
                          </p>
                          <p className="text-[11px] text-slate-500 truncate">
                            {u.email}
                          </p>
                        </div>
                        <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                          {u.role}
                        </span>
                      </button>
                    );
                  })
                )}
              </div>
              <div className="mt-3 flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => void handleAddUsers()}
                  disabled={
                    addingUsers ||
                    selectedUserIds.size === 0 ||
                    group.campaignCount === 0
                  }
                  className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {addingUsers ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Sparkles className="h-4 w-4" />
                  )}
                  Add {selectedUserIds.size} user
                  {selectedUserIds.size === 1 ? '' : 's'} to{' '}
                  {group.campaignCount} campaign
                  {group.campaignCount === 1 ? '' : 's'}
                </button>
                {inlineSummary && (
                  <span className="text-xs text-emerald-700 font-medium">
                    {inlineSummary}
                  </span>
                )}
              </div>
              {group.campaignCount === 0 && (
                <p className="mt-2 text-[11px] text-amber-600">
                  This group has no campaigns yet. Add campaigns above first,
                  then bulk-assign users.
                </p>
              )}
            </section>
          )}

          {/* Danger zone (edit-only) */}
          {!isCreating && group && (
            <section className="rounded-xl border border-slate-200 bg-slate-50/60 p-4">
              <p className="text-[11px] font-bold uppercase tracking-wider text-slate-500 mb-2">
                Danger zone
              </p>
              <div className="flex flex-wrap items-center gap-2">
                {group.active ? (
                  <button
                    type="button"
                    onClick={() => void handleArchive()}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-amber-300 bg-amber-50 px-3 py-1.5 text-xs font-medium text-amber-700 hover:bg-amber-100 transition-colors"
                  >
                    <Archive className="h-3.5 w-3.5" />
                    Archive group
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => void handleRestore()}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-1.5 text-xs font-medium text-emerald-700 hover:bg-emerald-100 transition-colors"
                  >
                    <ArchiveRestore className="h-3.5 w-3.5" />
                    Restore group
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setConfirmDeleteOpen((p) => !p)}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-rose-300 bg-white px-3 py-1.5 text-xs font-medium text-rose-700 hover:bg-rose-50 transition-colors"
                >
                  <AlertTriangle className="h-3.5 w-3.5" />
                  Permanently delete
                </button>
              </div>
              <p className="mt-2 text-[11px] text-slate-500">
                Archiving hides the group from the default view; campaigns stay
                assigned. Permanent deletion removes the group only; the
                campaigns inside it keep all their data and simply become
                un-grouped.
              </p>
              {confirmDeleteOpen && (
                <div className="mt-3 rounded-lg border border-rose-200 bg-rose-50 p-3 space-y-2">
                  <p className="text-xs text-rose-800">
                    Type <span className="font-bold">{group.name}</span> to
                    confirm permanent deletion.
                  </p>
                  <div className="flex items-center gap-2">
                    <input
                      className="flex-1 rounded-lg border border-rose-200 bg-white px-3 py-1.5 text-sm focus:border-rose-500 focus:outline-none focus:ring-2 focus:ring-rose-500/20"
                      value={deleteConfirmName}
                      onChange={(e) => setDeleteConfirmName(e.target.value)}
                      placeholder={group.name}
                    />
                    <button
                      type="button"
                      onClick={() => void handleHardDelete()}
                      disabled={deleteConfirmName.trim() !== group.name}
                      className="inline-flex items-center gap-1.5 rounded-lg bg-rose-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-rose-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      Delete forever
                    </button>
                  </div>
                </div>
              )}
            </section>
          )}
        </div>

        <div className="mt-6 flex justify-end gap-3 border-t border-slate-200 pt-4">
          <button className="app-btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button
            className="app-btn-primary disabled:opacity-70 disabled:cursor-not-allowed"
            onClick={() => void handleSave()}
            disabled={saving || !name.trim()}
          >
            {saving && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
            {saving ? 'Saving...' : isCreating ? 'Create Group' : 'Save Changes'}
          </button>
        </div>
      </div>
    </div>
  );
}

export { groupColorClasses };
