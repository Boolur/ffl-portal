import { TaskStatus, TaskWorkflowState, UserRole } from '@prisma/client';

export type TaskLifecycleEventType =
  | 'CREATED'
  | 'STARTED'
  | 'STATUS_CHANGED'
  | 'ROUTED_TO_LO'
  | 'LO_RESPONDED'
  | 'LO_REVIEWED'
  | 'ASSIGNMENT_CHANGED'
  | 'COMPLETED'
  | 'REOPENED'
  | 'SYSTEM';

export type TaskLifecycleEvent = {
  id: string;
  at: string;
  actorName: string;
  actorRole: UserRole | null;
  eventType: TaskLifecycleEventType;
  fromStatus?: TaskStatus | null;
  toStatus?: TaskStatus | null;
  fromWorkflow?: TaskWorkflowState | null;
  toWorkflow?: TaskWorkflowState | null;
  fromAssignedUserId?: string | null;
  toAssignedUserId?: string | null;
  fromAssignedUserName?: string | null;
  toAssignedUserName?: string | null;
  fromAssignedRole?: UserRole | null;
  toAssignedRole?: UserRole | null;
  note?: string | null;
  estimated?: boolean;
};

export type LifecycleCoreSnapshot = {
  status: TaskStatus;
  workflowState: TaskWorkflowState;
  assignedUserId?: string | null;
  assignedUserName?: string | null;
  assignedRole?: UserRole | null;
};

export type BuildTaskLifecycleInput = {
  createdAt?: Date | string | null;
  updatedAt?: Date | string | null;
  completedAt?: Date | string | null;
  status: TaskStatus;
  workflowState: TaskWorkflowState;
  assignedUserId?: string | null;
  assignedUserName?: string | null;
  assignedRole?: UserRole | null;
  submissionData?: unknown;
  now?: Date;
};

export type LifecycleDurationRow = {
  key: string;
  label: string;
  durationMs: number;
  percent: number;
};

export type LifecycleSegment = {
  startAt: string;
  endAt: string;
  durationMs: number;
  status: TaskStatus | null;
  workflowState: TaskWorkflowState | null;
  assignedUserId: string | null;
  assignedUserName: string | null;
  assignedRole: UserRole | null;
  estimated?: boolean;
};

export type TaskLifecycleBreakdown = {
  totalDurationMs: number;
  statusDurations: LifecycleDurationRow[];
  workflowDurations: LifecycleDurationRow[];
  assigneeDurations: LifecycleDurationRow[];
  segments: LifecycleSegment[];
  events: TaskLifecycleEvent[];
  hasEstimatedData: boolean;
};

type NotesLikeEntry = {
  message: string;
  date: string;
  author: string;
  role: UserRole | null;
};

type MutableLifecycleState = {
  status: TaskStatus | null;
  workflowState: TaskWorkflowState | null;
  assignedUserId: string | null;
  assignedUserName: string | null;
  assignedRole: UserRole | null;
};

function toDate(value?: Date | string | null) {
  if (!value) return null;
  const parsed = value instanceof Date ? value : new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed : null;
}

function toIso(value: Date) {
  return new Date(value.getTime()).toISOString();
}

function normalizeUserRole(value: unknown): UserRole | null {
  if (typeof value !== 'string') return null;
  return (Object.values(UserRole) as string[]).includes(value) ? (value as UserRole) : null;
}

function normalizeTaskStatus(value: unknown): TaskStatus | null {
  if (typeof value !== 'string') return null;
  return (Object.values(TaskStatus) as string[]).includes(value) ? (value as TaskStatus) : null;
}

function normalizeWorkflowState(value: unknown): TaskWorkflowState | null {
  if (typeof value !== 'string') return null;
  return (Object.values(TaskWorkflowState) as string[]).includes(value)
    ? (value as TaskWorkflowState)
    : null;
}

function normalizeEventType(value: unknown): TaskLifecycleEventType {
  if (typeof value !== 'string') return 'SYSTEM';
  const normalized = value.toUpperCase();
  const valid: TaskLifecycleEventType[] = [
    'CREATED',
    'STARTED',
    'STATUS_CHANGED',
    'ROUTED_TO_LO',
    'LO_RESPONDED',
    'LO_REVIEWED',
    'ASSIGNMENT_CHANGED',
    'COMPLETED',
    'REOPENED',
    'SYSTEM',
  ];
  return valid.includes(normalized as TaskLifecycleEventType)
    ? (normalized as TaskLifecycleEventType)
    : 'SYSTEM';
}

function cloneSubmissionData(submissionData: unknown) {
  if (!submissionData || typeof submissionData !== 'object' || Array.isArray(submissionData)) {
    return {} as Record<string, unknown>;
  }
  return { ...(submissionData as Record<string, unknown>) };
}

function parseNotesHistoryEntries(submissionData: unknown): NotesLikeEntry[] {
  if (!submissionData || typeof submissionData !== 'object' || Array.isArray(submissionData)) return [];
  const notesHistory = (submissionData as { notesHistory?: unknown }).notesHistory;
  if (!Array.isArray(notesHistory)) return [];

  const parsed: NotesLikeEntry[] = [];
  for (const raw of notesHistory) {
    if (!raw || typeof raw !== 'object') continue;
    const message = String((raw as { message?: unknown }).message ?? '').trim();
    const author = String((raw as { author?: unknown }).author ?? '').trim() || 'Team Member';
    const dateRaw = String((raw as { date?: unknown }).date ?? '').trim();
    if (!message || !dateRaw) continue;
    const date = toDate(dateRaw);
    if (!date) continue;
    parsed.push({
      message,
      author,
      date: toIso(date),
      role: normalizeUserRole((raw as { role?: unknown }).role),
    });
  }
  return parsed.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
}

function parseLifecycleHistory(submissionData: unknown): TaskLifecycleEvent[] {
  if (!submissionData || typeof submissionData !== 'object' || Array.isArray(submissionData)) return [];
  const lifecycleRaw = (submissionData as { lifecycleHistory?: unknown }).lifecycleHistory;
  if (!Array.isArray(lifecycleRaw)) return [];

  const parsed: TaskLifecycleEvent[] = [];
  for (let index = 0; index < lifecycleRaw.length; index += 1) {
    const raw = lifecycleRaw[index];
    if (!raw || typeof raw !== 'object') continue;
    const atRaw = String((raw as { at?: unknown }).at ?? '').trim();
    const atDate = toDate(atRaw);
    if (!atDate) continue;
    const actorName = String((raw as { actorName?: unknown }).actorName ?? '').trim() || 'Team Member';
    parsed.push({
      id: String((raw as { id?: unknown }).id ?? `lifecycle-${index}`).trim() || `lifecycle-${index}`,
      at: toIso(atDate),
      actorName,
      actorRole: normalizeUserRole((raw as { actorRole?: unknown }).actorRole),
      eventType: normalizeEventType((raw as { eventType?: unknown }).eventType),
      fromStatus: normalizeTaskStatus((raw as { fromStatus?: unknown }).fromStatus),
      toStatus: normalizeTaskStatus((raw as { toStatus?: unknown }).toStatus),
      fromWorkflow: normalizeWorkflowState((raw as { fromWorkflow?: unknown }).fromWorkflow),
      toWorkflow: normalizeWorkflowState((raw as { toWorkflow?: unknown }).toWorkflow),
      fromAssignedUserId:
        String((raw as { fromAssignedUserId?: unknown }).fromAssignedUserId ?? '').trim() || null,
      toAssignedUserId:
        String((raw as { toAssignedUserId?: unknown }).toAssignedUserId ?? '').trim() || null,
      fromAssignedUserName:
        String((raw as { fromAssignedUserName?: unknown }).fromAssignedUserName ?? '').trim() || null,
      toAssignedUserName:
        String((raw as { toAssignedUserName?: unknown }).toAssignedUserName ?? '').trim() || null,
      fromAssignedRole: normalizeUserRole((raw as { fromAssignedRole?: unknown }).fromAssignedRole),
      toAssignedRole: normalizeUserRole((raw as { toAssignedRole?: unknown }).toAssignedRole),
      note: String((raw as { note?: unknown }).note ?? '').trim() || null,
      estimated: Boolean((raw as { estimated?: unknown }).estimated),
    });
  }
  return parsed.sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());
}

function normalizeStatusFromMessage(message: string): TaskStatus | null {
  const normalized = message.toLowerCase();
  if (normalized.includes('status changed to in progress') || normalized.includes('request started')) {
    return TaskStatus.IN_PROGRESS;
  }
  if (normalized.includes('status changed to completed') || normalized === 'done') {
    return TaskStatus.COMPLETED;
  }
  if (normalized.includes('status changed to blocked')) {
    return TaskStatus.BLOCKED;
  }
  if (normalized.includes('status changed to pending')) {
    return TaskStatus.PENDING;
  }
  return null;
}

function inferBackfillEvents(input: BuildTaskLifecycleInput): TaskLifecycleEvent[] {
  const createdAt = toDate(input.createdAt);
  if (!createdAt) return [];

  const events: TaskLifecycleEvent[] = [
    {
      id: 'estimated-created',
      at: toIso(createdAt),
      actorName: 'System',
      actorRole: null,
      eventType: 'CREATED',
      toStatus: TaskStatus.PENDING,
      toWorkflow: TaskWorkflowState.NONE,
      toAssignedUserId: input.assignedUserId || null,
      toAssignedUserName: input.assignedUserName || null,
      toAssignedRole: input.assignedRole || null,
      estimated: true,
      note: 'Estimated creation event from task timestamps.',
    },
  ];

  const notes = parseNotesHistoryEntries(input.submissionData);
  let index = 0;
  let hasExplicitStarted = false;
  let hasExplicitRouted = false;
  let hasExplicitLoResponse = false;
  let firstDeskActivityAt: string | null = null;
  for (const note of notes) {
    const normalizedMessage = note.message.trim().toLowerCase();
    const isLoanOfficer = note.role === UserRole.LOAN_OFFICER;
    if (!isLoanOfficer && !firstDeskActivityAt) {
      firstDeskActivityAt = note.date;
    }
    const inferredStatus = normalizeStatusFromMessage(note.message);
    if (!inferredStatus) continue;
    if (inferredStatus === TaskStatus.IN_PROGRESS) hasExplicitStarted = true;
    if (inferredStatus === TaskStatus.BLOCKED) hasExplicitRouted = true;
    events.push({
      id: `estimated-note-${index}`,
      at: note.date,
      actorName: note.author || 'Team Member',
      actorRole: note.role || null,
      eventType:
        inferredStatus === TaskStatus.IN_PROGRESS
          ? 'STARTED'
          : inferredStatus === TaskStatus.COMPLETED
          ? 'COMPLETED'
          : 'STATUS_CHANGED',
      toStatus: inferredStatus,
      estimated: true,
      note: `Estimated from notesHistory: ${note.message}`,
    });
    index += 1;

    if (
      !hasExplicitRouted &&
      !isLoanOfficer &&
      (normalizedMessage.includes('missing') ||
        normalizedMessage.includes('send back') ||
        normalizedMessage.includes('needs info'))
    ) {
      events.push({
        id: `estimated-route-${index}`,
        at: note.date,
        actorName: note.author || 'Team Member',
        actorRole: note.role || null,
        eventType: 'ROUTED_TO_LO',
        toStatus: TaskStatus.BLOCKED,
        toWorkflow: TaskWorkflowState.WAITING_ON_LO,
        estimated: true,
        note: `Estimated LO-route from notesHistory: ${note.message}`,
      });
      hasExplicitRouted = true;
      index += 1;
    }

    if (
      !hasExplicitLoResponse &&
      isLoanOfficer &&
      (normalizedMessage.includes('response') ||
        normalizedMessage.includes('review') ||
        normalizedMessage.includes('approved') ||
        normalizedMessage.includes('revision'))
    ) {
      events.push({
        id: `estimated-lo-${index}`,
        at: note.date,
        actorName: note.author || 'Loan Officer',
        actorRole: note.role || UserRole.LOAN_OFFICER,
        eventType: 'LO_RESPONDED',
        toStatus: TaskStatus.PENDING,
        toWorkflow: TaskWorkflowState.READY_TO_COMPLETE,
        estimated: true,
        note: `Estimated LO response from notesHistory: ${note.message}`,
      });
      hasExplicitLoResponse = true;
      index += 1;
    }
  }

  if (!hasExplicitStarted && firstDeskActivityAt) {
    events.push({
      id: 'estimated-started-from-first-note',
      at: firstDeskActivityAt,
      actorName: 'Team Member',
      actorRole: null,
      eventType: 'STARTED',
      toStatus: TaskStatus.IN_PROGRESS,
      estimated: true,
      note: 'Estimated start time from first desk activity in notesHistory.',
    });
  }

  const completedAt = toDate(input.completedAt);
  if (completedAt) {
    events.push({
      id: 'estimated-completed',
      at: toIso(completedAt),
      actorName: 'System',
      actorRole: null,
      eventType: 'COMPLETED',
      toStatus: TaskStatus.COMPLETED,
      toWorkflow: TaskWorkflowState.NONE,
      estimated: true,
      note: 'Estimated completion event from completedAt timestamp.',
    });
  }

  return events.sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());
}

function applyEventToState(state: MutableLifecycleState, event: TaskLifecycleEvent) {
  if (event.toStatus) state.status = event.toStatus;
  if (event.toWorkflow) state.workflowState = event.toWorkflow;
  if (event.toAssignedUserId !== undefined) state.assignedUserId = event.toAssignedUserId;
  if (event.toAssignedUserName !== undefined) state.assignedUserName = event.toAssignedUserName;
  if (event.toAssignedRole !== undefined) state.assignedRole = event.toAssignedRole;
}

function getInitialState(
  events: TaskLifecycleEvent[],
  input: BuildTaskLifecycleInput
): MutableLifecycleState {
  const firstEvent = events[0];
  return {
    status: firstEvent?.fromStatus || TaskStatus.PENDING,
    workflowState: firstEvent?.fromWorkflow || TaskWorkflowState.NONE,
    assignedUserId:
      firstEvent?.fromAssignedUserId !== undefined
        ? firstEvent.fromAssignedUserId
        : input.assignedUserId || null,
    assignedUserName:
      firstEvent?.fromAssignedUserName !== undefined
        ? firstEvent.fromAssignedUserName
        : input.assignedUserName || null,
    assignedRole:
      firstEvent?.fromAssignedRole !== undefined
        ? firstEvent.fromAssignedRole
        : input.assignedRole || null,
  };
}

function statusLabel(status: TaskStatus | null) {
  if (!status) return 'Unknown';
  if (status === TaskStatus.IN_PROGRESS) return 'In Progress';
  if (status === TaskStatus.COMPLETED) return 'Completed';
  if (status === TaskStatus.BLOCKED) return 'Blocked';
  return 'Pending';
}

function workflowLabel(workflow: TaskWorkflowState | null) {
  if (!workflow) return 'None';
  if (workflow === TaskWorkflowState.WAITING_ON_LO) return 'Waiting on LO';
  if (workflow === TaskWorkflowState.WAITING_ON_LO_APPROVAL) return 'Waiting on LO Approval';
  if (workflow === TaskWorkflowState.READY_TO_COMPLETE) return 'Ready to Complete';
  return 'None';
}

function roleLabel(role: UserRole | null) {
  if (!role) return 'Unassigned';
  return role.replace(/_/g, ' ');
}

function formatPercent(value: number, total: number) {
  if (total <= 0) return 0;
  return Math.round((value / total) * 100);
}

export function formatLifecycleDuration(durationMs: number) {
  const safeMs = Math.max(0, durationMs);
  const totalMinutes = Math.floor(safeMs / 60000);
  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor((totalMinutes % 1440) / 60);
  const minutes = totalMinutes % 60;
  if (days > 0) return `${days}d ${hours}h ${minutes}m`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

export function appendLifecycleHistoryEvent(
  submissionData: unknown,
  event: Omit<TaskLifecycleEvent, 'id' | 'at'> & { id?: string; at?: string | Date }
) {
  const dataObj = cloneSubmissionData(submissionData);
  const history = parseLifecycleHistory(submissionData);
  const atDate = toDate(event.at || new Date()) || new Date();
  history.push({
    id: event.id || `lifecycle-${atDate.getTime()}-${Math.random().toString(36).slice(2, 8)}`,
    at: toIso(atDate),
    actorName: event.actorName,
    actorRole: event.actorRole || null,
    eventType: event.eventType,
    fromStatus: event.fromStatus ?? null,
    toStatus: event.toStatus ?? null,
    fromWorkflow: event.fromWorkflow ?? null,
    toWorkflow: event.toWorkflow ?? null,
    fromAssignedUserId: event.fromAssignedUserId ?? null,
    toAssignedUserId: event.toAssignedUserId ?? null,
    fromAssignedUserName: event.fromAssignedUserName ?? null,
    toAssignedUserName: event.toAssignedUserName ?? null,
    fromAssignedRole: event.fromAssignedRole ?? null,
    toAssignedRole: event.toAssignedRole ?? null,
    note: event.note ?? null,
    estimated: Boolean(event.estimated),
  });
  dataObj.lifecycleHistory = history.sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());
  return dataObj;
}

export function buildTaskLifecycleBreakdown(input: BuildTaskLifecycleInput): TaskLifecycleBreakdown {
  const now = input.now || new Date();
  const createdAt = toDate(input.createdAt);
  const updatedAt = toDate(input.updatedAt);
  const completedAt = toDate(input.completedAt);
  const isCompletedTask = input.status === TaskStatus.COMPLETED;
  const endAt = isCompletedTask ? completedAt || updatedAt || now : now;

  if (!createdAt || !endAt || endAt.getTime() <= createdAt.getTime()) {
    return {
      totalDurationMs: 0,
      statusDurations: [],
      workflowDurations: [],
      assigneeDurations: [],
      segments: [],
      events: [],
      hasEstimatedData: false,
    };
  }

  const explicitEvents = parseLifecycleHistory(input.submissionData);
  const events = explicitEvents.length > 0 ? explicitEvents : inferBackfillEvents(input);
  const hasEstimatedData =
    explicitEvents.length === 0 || events.some((event) => Boolean(event.estimated));

  const state = getInitialState(events, input);
  const segments: LifecycleSegment[] = [];
  let cursor = createdAt.getTime();

  for (const event of events) {
    const eventAt = toDate(event.at);
    if (!eventAt) continue;
    const eventMs = Math.max(cursor, eventAt.getTime());
    if (eventMs > cursor) {
      segments.push({
        startAt: new Date(cursor).toISOString(),
        endAt: new Date(eventMs).toISOString(),
        durationMs: eventMs - cursor,
        status: state.status,
        workflowState: state.workflowState,
        assignedUserId: state.assignedUserId,
        assignedUserName: state.assignedUserName,
        assignedRole: state.assignedRole,
        estimated: event.estimated || explicitEvents.length === 0,
      });
      cursor = eventMs;
    }
    applyEventToState(state, event);
  }

  const normalizedInputAssignedRole = input.assignedRole || null;
  const needsReconcileForOpenTask =
    !isCompletedTask &&
    (state.status !== input.status ||
      state.workflowState !== input.workflowState ||
      (state.assignedUserId || null) !== (input.assignedUserId || null) ||
      (state.assignedUserName || null) !== (input.assignedUserName || null) ||
      (state.assignedRole || null) !== normalizedInputAssignedRole);

  if (needsReconcileForOpenTask) {
    const reconcileAtMs = Math.max(
      cursor,
      Math.min(endAt.getTime(), updatedAt ? updatedAt.getTime() : endAt.getTime())
    );

    if (reconcileAtMs > cursor) {
      segments.push({
        startAt: new Date(cursor).toISOString(),
        endAt: new Date(reconcileAtMs).toISOString(),
        durationMs: reconcileAtMs - cursor,
        status: state.status,
        workflowState: state.workflowState,
        assignedUserId: state.assignedUserId,
        assignedUserName: state.assignedUserName,
        assignedRole: state.assignedRole,
        estimated: explicitEvents.length === 0,
      });
      cursor = reconcileAtMs;
    }

    state.status = input.status;
    state.workflowState = input.workflowState;
    state.assignedUserId = input.assignedUserId || null;
    state.assignedUserName = input.assignedUserName || null;
    state.assignedRole = normalizedInputAssignedRole;
  }

  const endMs = endAt.getTime();
  if (endMs > cursor) {
    segments.push({
      startAt: new Date(cursor).toISOString(),
      endAt: new Date(endMs).toISOString(),
      durationMs: endMs - cursor,
      status: isCompletedTask ? state.status || input.status : input.status,
      workflowState: isCompletedTask
        ? state.workflowState || input.workflowState
        : input.workflowState,
      assignedUserId: isCompletedTask ? state.assignedUserId : input.assignedUserId || null,
      assignedUserName: isCompletedTask ? state.assignedUserName : input.assignedUserName || null,
      assignedRole: isCompletedTask ? state.assignedRole || normalizedInputAssignedRole : normalizedInputAssignedRole,
      estimated: explicitEvents.length === 0,
    });
  }

  const totalDurationMs = Math.max(0, endMs - createdAt.getTime());
  const statusMap = new Map<string, number>();
  const workflowMap = new Map<string, number>();
  const assigneeMap = new Map<string, { label: string; durationMs: number }>();

  for (const segment of segments) {
    if (segment.durationMs <= 0) continue;
    const statusKey = segment.status || 'UNKNOWN';
    statusMap.set(statusKey, (statusMap.get(statusKey) || 0) + segment.durationMs);

    const workflowKey = segment.workflowState || 'NONE';
    workflowMap.set(workflowKey, (workflowMap.get(workflowKey) || 0) + segment.durationMs);

    const assigneeKey =
      segment.assignedUserId ||
      (segment.assignedRole ? `role:${segment.assignedRole}` : 'role:UNASSIGNED');
    const assigneeLabel =
      segment.assignedUserName ||
      (segment.assignedRole ? roleLabel(segment.assignedRole) : 'Unassigned');
    const existing = assigneeMap.get(assigneeKey);
    assigneeMap.set(assigneeKey, {
      label: assigneeLabel,
      durationMs: (existing?.durationMs || 0) + segment.durationMs,
    });
  }

  const statusDurations: LifecycleDurationRow[] = Array.from(statusMap.entries())
    .map(([key, durationMs]) => ({
      key,
      label: statusLabel(normalizeTaskStatus(key)),
      durationMs,
      percent: formatPercent(durationMs, totalDurationMs),
    }))
    .sort((a, b) => b.durationMs - a.durationMs);

  const workflowDurations: LifecycleDurationRow[] = Array.from(workflowMap.entries())
    .map(([key, durationMs]) => ({
      key,
      label: workflowLabel(normalizeWorkflowState(key)),
      durationMs,
      percent: formatPercent(durationMs, totalDurationMs),
    }))
    .sort((a, b) => b.durationMs - a.durationMs);

  const assigneeDurations: LifecycleDurationRow[] = Array.from(assigneeMap.entries())
    .map(([key, value]) => ({
      key,
      label: value.label,
      durationMs: value.durationMs,
      percent: formatPercent(value.durationMs, totalDurationMs),
    }))
    .sort((a, b) => b.durationMs - a.durationMs);

  return {
    totalDurationMs,
    statusDurations,
    workflowDurations,
    assigneeDurations,
    segments,
    events,
    hasEstimatedData,
  };
}
