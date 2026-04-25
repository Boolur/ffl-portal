'use client';

import React, { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import {
  Loader2,
  Plus,
  Pencil,
  X,
  Check,
  Search,
  Users2,
  AlertTriangle,
  Trash2,
} from 'lucide-react';
import { useRouter } from 'next/navigation';
import {
  createLeadUserTeam,
  updateLeadUserTeam,
  setLeadUserTeamMembers,
  deleteLeadUserTeam,
} from '@/app/actions/leadActions';

export type LeadUserTeamSummary = {
  id: string;
  name: string;
  description: string | null;
  color: string;
  active: boolean;
  createdAt: Date | string;
  updatedAt: Date | string;
  memberCount: number;
  memberIds: string[];
};

type EligibleUser = { id: string; name: string; email: string; role: string };

type Props = {
  teams: LeadUserTeamSummary[];
  users: EligibleUser[];
  // When provided, chips act as a single-select filter over the parent's
  // list (toggle semantics: clicking the active chip clears the filter).
  // When omitted, chips fall back to "click to edit" — used anywhere the
  // manager is purely for CRUD with no filterable list above it.
  selectedTeamId?: string | null;
  onSelectTeam?: (teamId: string | null) => void;
};

// Palette shared with CampaignGroupManager so teams and campaign groups
// look like they come from the same system.
const TEAM_COLOR_CLASSES: Record<
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

const TEAM_COLOR_KEYS = Object.keys(TEAM_COLOR_CLASSES);

export function teamColorClasses(key: string) {
  return TEAM_COLOR_CLASSES[key] ?? TEAM_COLOR_CLASSES.blue;
}

export function LeadUserTeamManager({
  teams,
  users,
  selectedTeamId = null,
  onSelectTeam,
}: Props) {
  const router = useRouter();
  const [editingTeam, setEditingTeam] = useState<LeadUserTeamSummary | null>(
    null
  );
  const [isCreating, setIsCreating] = useState(false);

  // Filter mode is enabled when the parent passes a select handler.
  // In filter mode the whole chip toggles the filter and a small pencil
  // button on the chip opens the edit modal — mirrors the "All/chip/edit"
  // pattern CampaignGroupManager uses.
  const filterMode = typeof onSelectTeam === 'function';

  const openCreate = useCallback(() => {
    setIsCreating(true);
    setEditingTeam(null);
  }, []);

  const openEdit = useCallback((team: LeadUserTeamSummary) => {
    setEditingTeam(team);
    setIsCreating(false);
  }, []);

  const closeModal = useCallback(() => {
    setEditingTeam(null);
    setIsCreating(false);
  }, []);

  const handleChipClick = useCallback(
    (team: LeadUserTeamSummary) => {
      if (filterMode && onSelectTeam) {
        onSelectTeam(selectedTeamId === team.id ? null : team.id);
      } else {
        openEdit(team);
      }
    },
    [filterMode, onSelectTeam, selectedTeamId, openEdit]
  );

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 flex-wrap">
        <div className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-slate-500 mr-1">
          <Users2 className="h-3.5 w-3.5" />
          Teams
        </div>

        {filterMode && teams.length > 0 && (
          <button
            type="button"
            onClick={() => onSelectTeam?.(null)}
            className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${
              selectedTeamId === null
                ? 'border-slate-300 bg-slate-100 text-slate-800 ring-1 ring-slate-300'
                : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
            }`}
          >
            All
          </button>
        )}

        {teams.length === 0 && (
          <span className="text-[11px] text-slate-400 italic">
            No teams yet — create one to batch-assign LOs to campaigns in one click.
          </span>
        )}

        {teams.map((t) => {
          const cls = teamColorClasses(t.color);
          const isActive = filterMode && selectedTeamId === t.id;
          const chipTitle = filterMode
            ? isActive
              ? `Showing ${t.memberCount} ${t.name} member${t.memberCount === 1 ? '' : 's'} — click to clear filter`
              : `Filter to ${t.memberCount} ${t.name} member${t.memberCount === 1 ? '' : 's'}`
            : t.description || `${t.memberCount} members • click to edit`;
          return (
            <div key={t.id} className="relative group/chip">
              <button
                type="button"
                onClick={() => handleChipClick(t)}
                className={`inline-flex items-center gap-1.5 rounded-full border pl-2.5 pr-8 py-1.5 text-xs font-medium transition-colors ${
                  isActive ? cls.chipActive : cls.chipInactive
                } ${isActive ? `ring-1 ${cls.ring}` : ''}`}
                title={chipTitle}
              >
                <span className={`inline-block h-2 w-2 rounded-full ${cls.dot}`} />
                <span className="truncate max-w-[160px]">{t.name}</span>
                <span className="text-[10px] font-semibold opacity-70 tabular-nums">
                  {t.memberCount}
                </span>
              </button>
              {filterMode ? (
                <button
                  type="button"
                  onClick={() => openEdit(t)}
                  className="absolute right-1 top-1/2 -translate-y-1/2 h-6 w-6 rounded-full flex items-center justify-center text-slate-400 hover:text-slate-700 hover:bg-white/60"
                  aria-label={`Edit ${t.name}`}
                  title="Edit team"
                >
                  <Pencil className="h-3 w-3" />
                </button>
              ) : (
                <span
                  className="absolute right-1 top-1/2 -translate-y-1/2 h-6 w-6 rounded-full flex items-center justify-center text-slate-400 pointer-events-none"
                  aria-hidden
                >
                  <Pencil className="h-3 w-3" />
                </span>
              )}
            </div>
          );
        })}

        <button
          type="button"
          onClick={openCreate}
          className="inline-flex items-center gap-1.5 rounded-full border border-dashed border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 hover:border-blue-400 hover:text-blue-700 transition-colors"
        >
          <Plus className="h-3.5 w-3.5" />
          New team
        </button>
      </div>

      {(editingTeam || isCreating) && (
        <TeamEditModal
          key={editingTeam?.id || 'new'}
          team={editingTeam}
          isCreating={isCreating}
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

function TeamEditModal({
  team,
  isCreating,
  users,
  onClose,
  onSaved,
}: {
  team: LeadUserTeamSummary | null;
  isCreating: boolean;
  users: EligibleUser[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(team?.name || '');
  const [description, setDescription] = useState(team?.description || '');
  const [color, setColor] = useState(team?.color || 'blue');

  // Preselect the team's existing members so the modal opens with an
  // accurate checklist. New teams start empty.
  const [selectedUserIds, setSelectedUserIds] = useState<Set<string>>(
    () => new Set(team?.memberIds ?? [])
  );
  const [userSearch, setUserSearch] = useState('');

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  const [deleteConfirmName, setDeleteConfirmName] = useState('');
  const nameInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    nameInputRef.current?.focus();
  }, []);

  const filteredUsers = useMemo(() => {
    const q = userSearch.trim().toLowerCase();
    if (!q) return users;
    return users.filter(
      (u) =>
        u.name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q)
    );
  }, [users, userSearch]);

  const toggleUser = useCallback((id: string) => {
    setSelectedUserIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const selectAllFiltered = useCallback(() => {
    setSelectedUserIds((prev) => {
      const next = new Set(prev);
      for (const u of filteredUsers) next.add(u.id);
      return next;
    });
  }, [filteredUsers]);

  const clearAll = useCallback(() => {
    setSelectedUserIds(new Set());
  }, []);

  const handleSave = async () => {
    setError(null);
    const trimmed = name.trim();
    if (!trimmed) {
      setError('Team name is required');
      return;
    }
    setSaving(true);
    try {
      const memberIds = Array.from(selectedUserIds);
      if (isCreating) {
        await createLeadUserTeam({
          name: trimmed,
          description: description || null,
          color,
          memberUserIds: memberIds,
        });
      } else if (team) {
        await updateLeadUserTeam(team.id, {
          name: trimmed,
          description: description || null,
          color,
        });
        await setLeadUserTeamMembers(team.id, memberIds);
      } else {
        return;
      }
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save team');
    } finally {
      setSaving(false);
    }
  };

  const handleHardDelete = async () => {
    if (!team) return;
    if (deleteConfirmName.trim() !== team.name) {
      setError('Type the exact team name to confirm permanent deletion');
      return;
    }
    setSaving(true);
    try {
      await deleteLeadUserTeam(team.id);
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not delete team');
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
        className="relative w-full max-w-2xl rounded-xl border border-slate-200 bg-white p-6 shadow-lg max-h-[88vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-5">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">
              {isCreating ? 'Create team' : `Edit team \u2022 ${team?.name}`}
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Teams show up as one-click chips above the user list in the
              Campaign editor. They don&apos;t affect distribution or quotas on
              their own.
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
                  ref={nameInputRef}
                  className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Retail West"
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
                {TEAM_COLOR_KEYS.map((key) => {
                  const cls = teamColorClasses(key);
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

          {/* Members */}
          <section>
            <div className="flex items-center justify-between mb-2">
              <p className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
                Members ({selectedUserIds.size})
              </p>
              <div className="flex items-center gap-3 text-[11px] font-medium">
                <button
                  type="button"
                  onClick={selectAllFiltered}
                  className="text-slate-500 hover:text-slate-800"
                >
                  Select all{userSearch ? ' (filtered)' : ''}
                </button>
                {selectedUserIds.size > 0 && (
                  <button
                    type="button"
                    onClick={clearAll}
                    className="text-slate-500 hover:text-slate-800"
                  >
                    Clear all
                  </button>
                )}
              </div>
            </div>
            <div className="relative mb-2">
              <Search className="absolute left-3 top-2.5 h-3.5 w-3.5 text-slate-400" />
              <input
                className="w-full rounded-lg border border-slate-200 bg-white pl-8 pr-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                placeholder="Search users by name or email..."
                value={userSearch}
                onChange={(e) => setUserSearch(e.target.value)}
              />
            </div>
            <div className="max-h-72 overflow-y-auto rounded-lg border border-slate-200 bg-white divide-y divide-slate-100">
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
          </section>

          {/* Danger zone (edit-only) */}
          {!isCreating && team && (
            <section className="rounded-xl border border-slate-200 bg-slate-50/60 p-4">
              <p className="text-[11px] font-bold uppercase tracking-wider text-slate-500 mb-2">
                Danger zone
              </p>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => setConfirmDeleteOpen((p) => !p)}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-rose-300 bg-white px-3 py-1.5 text-xs font-medium text-rose-700 hover:bg-rose-50 transition-colors"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  Delete team
                </button>
              </div>
              <p className="mt-2 text-[11px] text-slate-500">
                Deleting a team is permanent and only removes the team itself.
                Users stay assigned to whatever campaigns they&apos;re already
                on — teams are just a selection shortcut.
              </p>
              {confirmDeleteOpen && (
                <div className="mt-3 rounded-lg border border-rose-200 bg-rose-50 p-3 space-y-2">
                  <p className="text-xs text-rose-800">
                    Type <span className="font-bold">{team.name}</span> to
                    confirm.
                  </p>
                  <div className="flex items-center gap-2">
                    <input
                      className="flex-1 rounded-lg border border-rose-200 bg-white px-3 py-1.5 text-sm focus:border-rose-500 focus:outline-none focus:ring-2 focus:ring-rose-500/20"
                      value={deleteConfirmName}
                      onChange={(e) => setDeleteConfirmName(e.target.value)}
                      placeholder={team.name}
                    />
                    <button
                      type="button"
                      onClick={() => void handleHardDelete()}
                      disabled={deleteConfirmName.trim() !== team.name || saving}
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

        <div className="mt-6 flex items-center justify-end gap-3 border-t border-slate-200 pt-4">
          <button
            type="button"
            onClick={onClose}
            className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 transition-colors"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void handleSave()}
            disabled={saving || !name.trim()}
            className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {saving ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Check className="h-4 w-4" />
            )}
            {isCreating ? 'Create team' : 'Save changes'}
          </button>
        </div>
      </div>
    </div>
  );
}
