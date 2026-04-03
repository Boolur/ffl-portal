import { TaskKind, TaskStatus, TaskWorkflowState, UserRole } from '@prisma/client';
import {
  buildTaskLifecycleBreakdown,
  type TaskLifecycleBreakdown,
} from '@/lib/taskLifecycleTimeline';

type LoanRef = {
  loanNumber: string;
  borrowerName: string;
};

export type LoVaProgressTaskInput = {
  id: string;
  kind: TaskKind | null;
  status: TaskStatus;
  workflowState: TaskWorkflowState;
  assignedRole?: UserRole | null;
  assignedUser?: { id?: string | null; name?: string | null; role?: UserRole | null } | null;
  createdAt?: Date | string | null;
  updatedAt?: Date | string | null;
  completedAt?: Date | string | null;
  submissionData?: unknown;
  loan: LoanRef;
  parentTask?: {
    kind: TaskKind | null;
    assignedRole: UserRole | null;
  } | null;
  attachments?: Array<{
    id: string;
    filename: string;
    purpose: string;
  }>;
};

type VaKindKey = 'title' | 'payoff' | 'appraisal';
type JrKindKey = 'hoi';
type StageKey = VaKindKey | JrKindKey;
export type VaChipState = 'not_started' | 'new' | 'working' | 'waiting' | 'review' | 'completed';
type JrChecklistStatus = 'ORDERED' | 'MISSING_ITEMS' | 'COMPLETED';
type JrChecklistRow = {
  id: string;
  label: string;
  status: JrChecklistStatus;
  proofAttachmentId: string | null;
  proofFilename: string | null;
  note: string | null;
  noteUpdatedAt: string | null;
  noteAuthor: string | null;
  noteRole: UserRole | null;
};

export type LoVaBorrowerProgressItem = {
  loanNumber: string;
  borrowerName: string;
  vaCompletedCount: number;
  vaTotalCount: 3;
  jrCompletedCount: number;
  jrTotalCount: number;
  hasIncompleteVa: boolean;
  hasIncompleteJr: boolean;
  isFullyComplete: boolean;
  vaChips: Record<VaKindKey, VaChipState>;
  jrChips: Record<JrKindKey, VaChipState>;
  needsLoResponse: boolean;
  actionTaskId: string | null;
  detailTaskId: string | null;
  earliestCreatedAt: Date | null;
  latestUpdatedAt: Date | null;
  vaStageDetails: Record<
    VaKindKey,
    {
      taskId: string | null;
      completed: boolean;
      createdAt: Date | null;
      updatedAt: Date | null;
      proofAttachments: Array<{ id: string; filename: string }>;
      latestNote: {
        message: string;
        date: string;
        author: string;
        role: UserRole | null;
      } | null;
      lifecycleBreakdown: TaskLifecycleBreakdown | null;
    }
  >;
  jrStageDetails: Record<
    JrKindKey,
    {
      taskId: string | null;
      completed: boolean;
      createdAt: Date | null;
      updatedAt: Date | null;
      checklist: JrChecklistRow[];
      proofAttachments: Array<{ id: string; filename: string }>;
      latestNote: {
        message: string;
        date: string;
        author: string;
        role: UserRole | null;
      } | null;
      lifecycleBreakdown: TaskLifecycleBreakdown | null;
    }
  >;
  notesTimeline: Array<{
    id: string;
    stage: StageKey;
    message: string;
    date: string;
    author: string;
    role: UserRole | null;
  }>;
  workedByContributors: Array<{ name: string; role: UserRole | null }>;
  submissionSnapshot: Array<{ key: string; label: string; value: string }>;
};

const VA_KIND_MAP: Array<{ kind: TaskKind; key: VaKindKey }> = [
  { kind: TaskKind.VA_TITLE, key: 'title' },
  { kind: TaskKind.VA_PAYOFF, key: 'payoff' },
  { kind: TaskKind.VA_APPRAISAL, key: 'appraisal' },
];

const JR_KIND_MAP: Array<{ kind: TaskKind; key: JrKindKey }> = [
  { kind: TaskKind.VA_HOI, key: 'hoi' },
];

const JR_CHECKLIST_TEMPLATE: Array<{ id: string; label: string }> = [
  { id: 'ordered-hoi', label: 'Ordered HOI' },
  { id: 'ordered-voe', label: 'Ordered VOE' },
  { id: 'submitted-underwriting', label: 'Submitted to Underwriting' },
];

function toDate(value?: Date | string | null) {
  if (!value) return null;
  const dateValue = value instanceof Date ? value : new Date(value);
  return Number.isFinite(dateValue.getTime()) ? dateValue : null;
}

function getChipState(task: LoVaProgressTaskInput): VaChipState {
  if (task.status === TaskStatus.COMPLETED) return 'completed';
  if (task.workflowState === TaskWorkflowState.WAITING_ON_LO) return 'waiting';
  if (task.workflowState === TaskWorkflowState.WAITING_ON_LO_APPROVAL) return 'waiting';
  if (task.workflowState === TaskWorkflowState.READY_TO_COMPLETE) return 'review';
  if (task.status === TaskStatus.IN_PROGRESS) return 'working';
  return 'new';
}

function isProofAttachment(purpose?: string) {
  return (purpose || '').toUpperCase() === 'PROOF';
}

function normalizeTimelineCategory(message: string) {
  const normalized = message.trim().toLowerCase().replace(/\s+/g, ' ');
  if (!normalized) return '';
  if (normalized === 'done' || normalized.includes('status changed to completed')) {
    return 'status_completed';
  }
  if (normalized.includes('status changed to in progress')) {
    return 'status_in_progress';
  }
  if (normalized.includes('status changed to pending')) {
    return 'status_pending';
  }
  if (normalized.includes('status changed to blocked')) {
    return 'status_blocked';
  }
  return `note:${normalized}`;
}

function toMinuteBucket(date: Date) {
  const minute = new Date(date);
  minute.setSeconds(0, 0);
  return minute.toISOString();
}

const snapshotPreferredOrder = [
  'arriveLoanNumber',
  'borrowerFirstName',
  'borrowerLastName',
  'borrowerPhone',
  'borrowerEmail',
  'loanAmount',
  'homeValue',
  'loanType',
  'loanProgram',
  'loanPurpose',
  'subjectPropertyAddress',
  'yearBuiltProperty',
  'originalCost',
  'yearAquired',
  'mannerInWhichTitleWillBeHeld',
  'employerName',
  'employerAddress',
  'employerDurationLineOfWork',
  'channel',
  'investor',
  'runId',
  'pricingOption',
  'creditReportType',
  'aus',
] as const;

function toReadableLabel(key: string) {
  return key
    .replace(/_/g, ' ')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function buildSubmissionSnapshot(
  data: unknown
): Array<{ key: string; label: string; value: string }> {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return [];
  const entries = Object.entries(data as Record<string, unknown>).filter(([key, value]) => {
    if (
      key === 'notes' ||
      key === 'notesHistory' ||
      key.toLowerCase().includes('attachment')
    ) {
      return false;
    }
    return (
      value !== null &&
      (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean')
    );
  });
  if (entries.length === 0) return [];

  const valueByKey = new Map(entries);
  const ordered: Array<{ key: string; label: string; value: string }> = [];
  for (const key of snapshotPreferredOrder) {
    if (!valueByKey.has(key)) continue;
    ordered.push({
      key,
      label: toReadableLabel(key),
      value: String(valueByKey.get(key)),
    });
    valueByKey.delete(key);
  }

  for (const [key, value] of valueByKey.entries()) {
    ordered.push({
      key,
      label: toReadableLabel(key),
      value: String(value),
    });
  }

  return ordered;
}

function compareByMostRecentUpdate(
  a: Pick<LoVaBorrowerProgressItem, 'latestUpdatedAt'>,
  b: Pick<LoVaBorrowerProgressItem, 'latestUpdatedAt'>
) {
  const left = a.latestUpdatedAt?.getTime() || 0;
  const right = b.latestUpdatedAt?.getTime() || 0;
  return right - left;
}

function parseNotesHistoryForStage(
  data: unknown,
  stage: StageKey,
  taskId: string,
  allowedRoles?: ReadonlySet<UserRole>
): Array<{
  id: string;
  stage: StageKey;
  message: string;
  date: string;
  author: string;
  role: UserRole | null;
}> {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return [];
  const notesHistory = (data as { notesHistory?: unknown }).notesHistory;
  if (!Array.isArray(notesHistory)) return [];
  const parsed: Array<{
    id: string;
    stage: StageKey;
    message: string;
    date: string;
    author: string;
    role: UserRole | null;
  }> = [];
  for (let index = 0; index < notesHistory.length; index += 1) {
    const item = notesHistory[index];
    if (!item || typeof item !== 'object') continue;
    const message = String((item as { message?: unknown }).message ?? '').trim();
    const dateRaw = String((item as { date?: unknown }).date ?? '').trim();
    if (!message || !dateRaw) continue;
    const dateValue = new Date(dateRaw);
    if (Number.isNaN(dateValue.getTime())) continue;
    const author = String((item as { author?: unknown }).author ?? '').trim() || 'Team Member';
    const roleRaw = (item as { role?: unknown }).role;
    const normalizedRole =
      typeof roleRaw === 'string' && (Object.values(UserRole) as string[]).includes(roleRaw)
        ? (roleRaw as UserRole)
        : null;
    if (!normalizedRole) continue;
    if (allowedRoles && !allowedRoles.has(normalizedRole)) continue;
    parsed.push({
      id: `${taskId}-${stage}-${dateRaw}-${index}`,
      stage,
      message,
      date: dateValue.toISOString(),
      author,
      role: normalizedRole,
    });
  }
  return parsed;
}

function collectWorkedByFromNotesHistory(
  data: unknown,
  allowedRoles?: ReadonlySet<UserRole>
): Array<{ author: string; role: UserRole; dateMs: number }> {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return [];
  const notesHistory = (data as { notesHistory?: unknown }).notesHistory;
  if (!Array.isArray(notesHistory)) return [];

  const contributors: Array<{ author: string; role: UserRole; dateMs: number }> = [];
  for (const item of notesHistory) {
    if (!item || typeof item !== 'object') continue;
    const author = String((item as { author?: unknown }).author ?? '').trim();
    const dateRaw = String((item as { date?: unknown }).date ?? '').trim();
    if (!author || !dateRaw) continue;
    const dateValue = new Date(dateRaw);
    if (Number.isNaN(dateValue.getTime())) continue;

    const roleRaw = (item as { role?: unknown }).role;
    const normalizedRole =
      typeof roleRaw === 'string' && (Object.values(UserRole) as string[]).includes(roleRaw)
        ? (roleRaw as UserRole)
        : null;
    if (!normalizedRole) continue;
    if (allowedRoles && !allowedRoles.has(normalizedRole)) continue;

    contributors.push({ author, role: normalizedRole, dateMs: dateValue.getTime() });
  }
  return contributors;
}

function dedupeTimelineEntries(
  notes: Array<{
    id: string;
    stage: StageKey;
    message: string;
    date: string;
    author: string;
    role: UserRole | null;
  }>
) {
  const deduped = new Map<
    string,
    {
      id: string;
      stage: StageKey;
      message: string;
      date: string;
      author: string;
      role: UserRole | null;
    }
  >();

  for (const note of notes) {
    const noteDate = new Date(note.date);
    if (Number.isNaN(noteDate.getTime())) continue;
    const category = normalizeTimelineCategory(note.message);
    if (!category) continue;
    const key = [
      note.stage,
      (note.author || '').trim().toLowerCase(),
      note.role || 'NONE',
      toMinuteBucket(noteDate),
      category,
    ].join('::');
    const existing = deduped.get(key);
    if (!existing) {
      deduped.set(key, note);
      continue;
    }
    if (new Date(note.date).getTime() >= new Date(existing.date).getTime()) {
      deduped.set(key, note);
    }
  }

  return Array.from(deduped.values()).sort(
    (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()
  );
}

function getJrChecklistFromSubmissionData(data: unknown) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return [] as JrChecklistRow[];
  }
  const checklistRaw = (data as { jrChecklist?: unknown }).jrChecklist;
  if (!checklistRaw || typeof checklistRaw !== 'object' || Array.isArray(checklistRaw)) {
    return [] as JrChecklistRow[];
  }
  const itemsRaw = (checklistRaw as { items?: unknown }).items;
  if (!Array.isArray(itemsRaw)) {
    return [] as JrChecklistRow[];
  }
  return itemsRaw
    .map((item) => {
      if (!item || typeof item !== 'object') return null;
      const id = String((item as { id?: unknown }).id ?? '').trim();
      const label = String((item as { label?: unknown }).label ?? '').trim();
      const statusRaw = String((item as { status?: unknown }).status ?? '').trim();
      if (!id || !label) return null;
      if (
        statusRaw !== 'ORDERED' &&
        statusRaw !== 'MISSING_ITEMS' &&
        statusRaw !== 'COMPLETED'
      ) {
        return null;
      }
      return {
        id,
        label,
        status: statusRaw as JrChecklistStatus,
        proofAttachmentId:
          typeof (item as { proofAttachmentId?: unknown }).proofAttachmentId === 'string' &&
          String((item as { proofAttachmentId?: unknown }).proofAttachmentId).trim().length > 0
            ? String((item as { proofAttachmentId?: unknown }).proofAttachmentId).trim()
            : null,
        proofFilename:
          typeof (item as { proofFilename?: unknown }).proofFilename === 'string' &&
          String((item as { proofFilename?: unknown }).proofFilename).trim().length > 0
            ? String((item as { proofFilename?: unknown }).proofFilename).trim()
            : null,
        note:
          typeof (item as { note?: unknown }).note === 'string' &&
          String((item as { note?: unknown }).note).trim().length > 0
            ? String((item as { note?: unknown }).note).trim()
            : null,
        noteUpdatedAt:
          typeof (item as { noteUpdatedAt?: unknown }).noteUpdatedAt === 'string' &&
          String((item as { noteUpdatedAt?: unknown }).noteUpdatedAt).trim().length > 0
            ? String((item as { noteUpdatedAt?: unknown }).noteUpdatedAt).trim()
            : null,
        noteAuthor:
          typeof (item as { noteAuthor?: unknown }).noteAuthor === 'string' &&
          String((item as { noteAuthor?: unknown }).noteAuthor).trim().length > 0
            ? String((item as { noteAuthor?: unknown }).noteAuthor).trim()
            : null,
        noteRole:
          typeof (item as { noteRole?: unknown }).noteRole === 'string' &&
          (Object.values(UserRole) as string[]).includes(
            String((item as { noteRole?: unknown }).noteRole)
          )
            ? (String((item as { noteRole?: unknown }).noteRole) as UserRole)
            : null,
      };
    })
    .filter((row): row is JrChecklistRow => Boolean(row));
}

function getDefaultJrChecklistRows(task: LoVaProgressTaskInput) {
  const defaultStatus: JrChecklistStatus =
    task.status === TaskStatus.COMPLETED ? 'COMPLETED' : 'MISSING_ITEMS';
  return JR_CHECKLIST_TEMPLATE.map((row) => ({
    id: row.id,
    label: row.label,
    status: defaultStatus,
    proofAttachmentId: null,
    proofFilename: null,
    note: null,
    noteUpdatedAt: null,
    noteAuthor: null,
    noteRole: null,
  }));
}

export function buildLoVaBorrowerProgress(tasks: LoVaProgressTaskInput[]): LoVaBorrowerProgressItem[] {
  const vaNoteRoles = new Set<UserRole>([
    UserRole.VA,
    UserRole.VA_TITLE,
    UserRole.VA_PAYOFF,
    UserRole.VA_APPRAISAL,
  ]);
  const jrNoteRoles = new Set<UserRole>([UserRole.PROCESSOR_JR]);
  const workedByRoles = new Set<UserRole>([
    UserRole.QC,
    UserRole.MANAGER,
    UserRole.VA,
    UserRole.VA_TITLE,
    UserRole.VA_PAYOFF,
    UserRole.VA_APPRAISAL,
    UserRole.PROCESSOR_JR,
  ]);

  const grouped = new Map<
    string,
    {
      loanNumber: string;
      borrowerName: string;
      vaByKind: Partial<Record<VaKindKey, LoVaProgressTaskInput>>;
      jrByKind: Partial<Record<JrKindKey, LoVaProgressTaskInput>>;
      appraisalNeedsLoResponse: boolean;
      appraisalActionTaskId: string | null;
      detailTaskId: string | null;
      earliestCreatedAt: Date | null;
      latestUpdatedAt: Date | null;
      submissionData: unknown;
    }
  >();

  for (const task of tasks) {
    const key = `${task.loan.loanNumber}::${task.loan.borrowerName}`.toLowerCase();
    const existing = grouped.get(key) || {
      loanNumber: task.loan.loanNumber,
      borrowerName: task.loan.borrowerName,
      vaByKind: {},
      jrByKind: {},
      appraisalNeedsLoResponse: false,
      appraisalActionTaskId: null,
      detailTaskId: null,
      earliestCreatedAt: null,
      latestUpdatedAt: null,
      submissionData: null,
    };

    if (!existing.detailTaskId) {
      existing.detailTaskId = task.id;
    }
    const createdAt = toDate(task.createdAt);
    if (
      createdAt &&
      (!existing.earliestCreatedAt ||
        createdAt.getTime() < existing.earliestCreatedAt.getTime())
    ) {
      existing.earliestCreatedAt = createdAt;
    }

    const updatedAt = toDate(task.updatedAt);
    if (
      updatedAt &&
      (!existing.latestUpdatedAt || updatedAt.getTime() > existing.latestUpdatedAt.getTime())
    ) {
      existing.latestUpdatedAt = updatedAt;
    }

    const mappedVaKind = VA_KIND_MAP.find((entry) => entry.kind === task.kind);
    if (mappedVaKind) {
      existing.vaByKind[mappedVaKind.key] = task;
      if (!existing.submissionData && task.submissionData) {
        existing.submissionData = task.submissionData;
      }
    }
    const mappedJrKind = JR_KIND_MAP.find((entry) => entry.kind === task.kind);
    if (mappedJrKind) {
      existing.jrByKind[mappedJrKind.key] = task;
      if (!existing.submissionData && task.submissionData) {
        existing.submissionData = task.submissionData;
      }
    }

    const isOpenAppraisalParent =
      (task.kind === TaskKind.VA_APPRAISAL ||
        task.kind === TaskKind.VA_PAYOFF ||
        task.kind === TaskKind.VA_HOI) &&
      task.status !== TaskStatus.COMPLETED &&
      task.workflowState === TaskWorkflowState.WAITING_ON_LO;
    const isOpenAppraisalChildResponse =
      task.kind === TaskKind.LO_NEEDS_INFO &&
      task.status !== TaskStatus.COMPLETED &&
      (task.parentTask?.kind === TaskKind.VA_APPRAISAL ||
        task.parentTask?.kind === TaskKind.VA_PAYOFF ||
        task.parentTask?.kind === TaskKind.VA_HOI);

    if (isOpenAppraisalParent || isOpenAppraisalChildResponse) {
      existing.appraisalNeedsLoResponse = true;
      if (isOpenAppraisalChildResponse) {
        existing.appraisalActionTaskId = task.id;
      }
    }

    grouped.set(key, existing);
  }

  const rows: LoVaBorrowerProgressItem[] = [];
  for (const value of grouped.values()) {
    const hasAnyVaTask = VA_KIND_MAP.some((definition) => Boolean(value.vaByKind[definition.key]));
    const hasAnyJrTask = JR_KIND_MAP.some((definition) => Boolean(value.jrByKind[definition.key]));
    if (!hasAnyVaTask && !hasAnyJrTask) continue;

    const vaChips: Record<VaKindKey, VaChipState> = {
      title: 'not_started',
      payoff: 'not_started',
      appraisal: 'not_started',
    };
    const jrChips: Record<JrKindKey, VaChipState> = {
      hoi: 'not_started',
    };

    for (const definition of VA_KIND_MAP) {
      const task = value.vaByKind[definition.key];
      if (!task) continue;
      vaChips[definition.key] = getChipState(task);
    }
    for (const definition of JR_KIND_MAP) {
      const task = value.jrByKind[definition.key];
      if (!task) continue;
      jrChips[definition.key] = getChipState(task);
    }

    const vaCompletedCount = Object.values(vaChips).filter((chip) => chip === 'completed').length;
    const hasIncompleteVa =
      hasAnyVaTask && Object.values(vaChips).some((chip) => chip !== 'completed');
    const vaStageDetails: LoVaBorrowerProgressItem['vaStageDetails'] = {
      title: {
        taskId: null,
        completed: false,
        createdAt: null,
        updatedAt: null,
        proofAttachments: [],
        latestNote: null,
        lifecycleBreakdown: null,
      },
      payoff: {
        taskId: null,
        completed: false,
        createdAt: null,
        updatedAt: null,
        proofAttachments: [],
        latestNote: null,
        lifecycleBreakdown: null,
      },
      appraisal: {
        taskId: null,
        completed: false,
        createdAt: null,
        updatedAt: null,
        proofAttachments: [],
        latestNote: null,
        lifecycleBreakdown: null,
      },
    };
    const jrStageDetails: LoVaBorrowerProgressItem['jrStageDetails'] = {
      hoi: {
        taskId: null,
        completed: false,
        createdAt: null,
        updatedAt: null,
        checklist: [],
        proofAttachments: [],
        latestNote: null,
        lifecycleBreakdown: null,
      },
    };
    const timelineById = new Map<
      string,
      {
        id: string;
        stage: StageKey;
        message: string;
        date: string;
        author: string;
        role: UserRole | null;
      }
    >();
    const workedByLatestByName = new Map<string, { name: string; role: UserRole | null; dateMs: number }>();
    for (const definition of VA_KIND_MAP) {
      const task = value.vaByKind[definition.key];
      if (!task) continue;
      const stageNotes = parseNotesHistoryForStage(
        task.submissionData,
        definition.key,
        task.id,
        vaNoteRoles
      );
      const latestNote =
        stageNotes.length > 0
          ? stageNotes.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())[0]
          : null;
      vaStageDetails[definition.key] = {
        taskId: task.id,
        completed: task.status === TaskStatus.COMPLETED,
        createdAt: toDate(task.createdAt),
        updatedAt: toDate(task.updatedAt),
        proofAttachments: (task.attachments || [])
          .filter((att) => isProofAttachment(att.purpose))
          .map((att) => ({ id: att.id, filename: att.filename })),
        latestNote: latestNote
          ? {
              message: latestNote.message,
              date: latestNote.date,
              author: latestNote.author,
              role: latestNote.role,
            }
          : null,
        lifecycleBreakdown: buildTaskLifecycleBreakdown({
          createdAt: task.createdAt || null,
          updatedAt: task.updatedAt || null,
          completedAt: task.completedAt || null,
          status: task.status,
          workflowState: task.workflowState,
          assignedUserId: task.assignedUser?.id || null,
          assignedUserName: task.assignedUser?.name || null,
          assignedRole: task.assignedRole || null,
          submissionData: task.submissionData,
        }),
      };
      for (const note of stageNotes) {
        timelineById.set(note.id, note);
      }
      const contributors = collectWorkedByFromNotesHistory(task.submissionData, workedByRoles);
      for (const contributor of contributors) {
        const contributorKey = contributor.author.toLowerCase();
        const previous = workedByLatestByName.get(contributorKey);
        if (!previous || contributor.dateMs >= previous.dateMs) {
          workedByLatestByName.set(contributorKey, {
            name: contributor.author,
            role: contributor.role,
            dateMs: contributor.dateMs,
          });
        }
      }
    }
    for (const definition of JR_KIND_MAP) {
      const task = value.jrByKind[definition.key];
      if (!task) continue;
      const stageNotes = parseNotesHistoryForStage(
        task.submissionData,
        definition.key,
        task.id,
        jrNoteRoles
      );
      const savedJrChecklist = getJrChecklistFromSubmissionData(task.submissionData);
      const jrChecklist =
        savedJrChecklist.length > 0 ? savedJrChecklist : getDefaultJrChecklistRows(task);
      const latestNote =
        stageNotes.length > 0
          ? stageNotes.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())[0]
          : null;
      jrStageDetails[definition.key] = {
        taskId: task.id,
        completed: task.status === TaskStatus.COMPLETED,
        createdAt: toDate(task.createdAt),
        updatedAt: toDate(task.updatedAt),
        checklist: jrChecklist,
        proofAttachments: (task.attachments || [])
          .filter((att) => isProofAttachment(att.purpose))
          .map((att) => ({ id: att.id, filename: att.filename })),
        latestNote: latestNote
          ? {
              message: latestNote.message,
              date: latestNote.date,
              author: latestNote.author,
              role: latestNote.role,
            }
          : null,
        lifecycleBreakdown: buildTaskLifecycleBreakdown({
          createdAt: task.createdAt || null,
          updatedAt: task.updatedAt || null,
          completedAt: task.completedAt || null,
          status: task.status,
          workflowState: task.workflowState,
          assignedUserId: task.assignedUser?.id || null,
          assignedUserName: task.assignedUser?.name || null,
          assignedRole: task.assignedRole || null,
          submissionData: task.submissionData,
        }),
      };
      for (const note of stageNotes) {
        timelineById.set(note.id, note);
      }
      const contributors = collectWorkedByFromNotesHistory(task.submissionData, workedByRoles);
      for (const contributor of contributors) {
        const contributorKey = contributor.author.toLowerCase();
        const previous = workedByLatestByName.get(contributorKey);
        if (!previous || contributor.dateMs >= previous.dateMs) {
          workedByLatestByName.set(contributorKey, {
            name: contributor.author,
            role: contributor.role,
            dateMs: contributor.dateMs,
          });
        }
      }
    }

    const jrChecklistRows = jrStageDetails.hoi.checklist;
    const jrTotalCount = jrChecklistRows.length > 0 ? jrChecklistRows.length : 1;
    const jrCompletedCount =
      jrChecklistRows.length > 0
        ? jrChecklistRows.filter((row) => row.status === 'COMPLETED').length
        : Object.values(jrChips).filter((chip) => chip === 'completed').length;
    const hasIncompleteJr =
      hasAnyJrTask &&
      (jrChecklistRows.length > 0
        ? jrChecklistRows.some((row) => row.status !== 'COMPLETED')
        : Object.values(jrChips).some((chip) => chip !== 'completed'));

    const notesTimeline = dedupeTimelineEntries(Array.from(timelineById.values()));
    const workedByContributors = Array.from(workedByLatestByName.values())
      .sort((a, b) => b.dateMs - a.dateMs)
      .map((entry) => ({ name: entry.name, role: entry.role }));
    rows.push({
      loanNumber: value.loanNumber,
      borrowerName: value.borrowerName,
      vaCompletedCount,
      vaTotalCount: 3,
      jrCompletedCount,
      jrTotalCount,
      hasIncompleteVa,
      hasIncompleteJr,
      isFullyComplete: !hasIncompleteVa && !hasIncompleteJr,
      vaChips,
      jrChips,
      needsLoResponse: value.appraisalNeedsLoResponse,
      actionTaskId: value.appraisalActionTaskId,
      detailTaskId: value.appraisalActionTaskId || value.detailTaskId,
      earliestCreatedAt: value.earliestCreatedAt,
      latestUpdatedAt: value.latestUpdatedAt,
      vaStageDetails,
      jrStageDetails,
      notesTimeline,
      workedByContributors,
      submissionSnapshot: buildSubmissionSnapshot(value.submissionData),
    });
  }

  return rows.sort(compareByMostRecentUpdate);
}

export function isLoVaPilotUser(user: {
  role?: string | null;
  email?: string | null;
  name?: string | null;
}) {
  if ((user.role || '').toUpperCase() !== 'LOAN_OFFICER') return false;
  const email = (user.email || '').trim().toLowerCase();
  const name = (user.name || '').trim().toLowerCase();
  return (
    email === 'mmahjoub@federalfirstlending.com' ||
    (name === 'matt mahjoub' && email.length > 0)
  );
}
