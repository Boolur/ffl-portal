import { LeadStatus, Prisma, TaskKind } from '@prisma/client';

type TransactionClient = Prisma.TransactionClient;

export type PipelineLeadStatus =
  Extract<
    LeadStatus,
    'SUBMITTED_PLUS_ONE' | 'SUBMITTED_DISCLOSURES' | 'SUBMITTED_PROCESSING'
  >;

type LeadMatchRecord = {
  id: string;
  status: LeadStatus;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  phone: string | null;
  homePhone: string | null;
  workPhone: string | null;
  coFirstName: string | null;
  coLastName: string | null;
  coEmail: string | null;
  coPhone: string | null;
  coHomePhone: string | null;
  coWorkPhone: string | null;
  propertyAddress: string | null;
  propertyCity: string | null;
  propertyState: string | null;
  propertyZip: string | null;
  mailingAddress: string | null;
  mailingCity: string | null;
  mailingState: string | null;
  mailingZip: string | null;
};

type LoanMatchRecord = {
  id: string;
  loanNumber: string;
  borrowerName: string;
  borrowerFirstName: string | null;
  borrowerLastName: string | null;
  borrowerEmail: string | null;
  borrowerPhone: string | null;
  propertyAddress: string | null;
};

type TaskMatchRecord = {
  id: string;
  kind: TaskKind | null;
  loanId: string;
  submissionData: Prisma.JsonValue | null;
} | null;

export type LeadMatchCandidates = {
  names: string[];
  emails: string[];
  phones: string[];
  addresses: string[];
};

export type LeadPipelineMatchResult =
  | {
      kind: 'matched';
      lead: LeadMatchRecord;
      matchType: string;
      matchedLeadIds: string[];
    }
  | {
      kind: 'ambiguous';
      lead: null;
      matchType: string;
      matchedLeadIds: string[];
    }
  | {
      kind: 'none';
      lead: null;
      matchType: 'none';
      matchedLeadIds: [];
    };

export type LeadPipelineSyncResult =
  | {
      kind: 'updated';
      leadId: string;
      previousStatus: LeadStatus;
      nextStatus: PipelineLeadStatus;
      matchType: string;
    }
  | {
      kind: 'skipped-no-upgrade';
      leadId: string;
      currentStatus: LeadStatus;
      nextStatus: PipelineLeadStatus;
      matchType: string;
    }
  | {
      kind: 'skipped-ambiguous';
      nextStatus: PipelineLeadStatus;
      matchType: string;
      matchedLeadIds: string[];
    }
  | {
      kind: 'skipped-no-match';
      nextStatus: PipelineLeadStatus;
    }
  | {
      kind: 'skipped-missing-loan';
      nextStatus: PipelineLeadStatus;
    };

const STREET_SUFFIXES = new Map([
  ['avenue', 'ave'],
  ['boulevard', 'blvd'],
  ['circle', 'cir'],
  ['court', 'ct'],
  ['drive', 'dr'],
  ['highway', 'hwy'],
  ['lane', 'ln'],
  ['parkway', 'pkwy'],
  ['place', 'pl'],
  ['road', 'rd'],
  ['street', 'st'],
  ['terrace', 'ter'],
  ['trail', 'trl'],
  ['way', 'wy'],
]);

export const LEAD_PIPELINE_STATUS_RANK: Record<LeadStatus, number> = {
  [LeadStatus.UNASSIGNED]: 0,
  [LeadStatus.NEW]: 0,
  [LeadStatus.HOT]: 1,
  [LeadStatus.COLD]: 1,
  [LeadStatus.DNQ]: 1,
  [LeadStatus.SUBMITTED_PLUS_ONE]: 2,
  [LeadStatus.SUBMITTED_DISCLOSURES]: 3,
  [LeadStatus.SUBMITTED_PROCESSING]: 4,
};

export const TASK_KIND_TO_LEAD_STATUS: Partial<Record<TaskKind, PipelineLeadStatus>> = {
  [TaskKind.SUBMIT_PLUS_ONE]: LeadStatus.SUBMITTED_PLUS_ONE,
  [TaskKind.SUBMIT_DISCLOSURES]: LeadStatus.SUBMITTED_DISCLOSURES,
  [TaskKind.SUBMIT_PROCESSING]: LeadStatus.SUBMITTED_PROCESSING,
  [TaskKind.SUBMIT_QC]: LeadStatus.SUBMITTED_PROCESSING,
};

const LEAD_MATCH_SELECT = {
  id: true,
  status: true,
  firstName: true,
  lastName: true,
  email: true,
  phone: true,
  homePhone: true,
  workPhone: true,
  coFirstName: true,
  coLastName: true,
  coEmail: true,
  coPhone: true,
  coHomePhone: true,
  coWorkPhone: true,
  propertyAddress: true,
  propertyCity: true,
  propertyState: true,
  propertyZip: true,
  mailingAddress: true,
  mailingCity: true,
  mailingState: true,
  mailingZip: true,
} satisfies Prisma.LeadSelect;

function submissionObject(value: Prisma.JsonValue | null | undefined): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function valueText(value: unknown) {
  return String(value ?? '').trim();
}

export function normalizeLeadPipelineText(value: unknown) {
  return valueText(value)
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function normalizeLeadPipelineName(value: unknown) {
  return normalizeLeadPipelineText(value)
    .replace(/\b(jr|sr|ii|iii|iv)\b/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function normalizeLeadPipelineEmail(value: unknown) {
  const normalized = valueText(value).toLowerCase();
  return normalized.includes('@') ? normalized : '';
}

export function normalizeLeadPipelinePhone(value: unknown) {
  const digits = valueText(value).replace(/\D/g, '');
  return digits.length >= 10 ? digits.slice(-10) : '';
}

export function normalizeLeadPipelineAddress(value: unknown) {
  const normalized = normalizeLeadPipelineText(value)
    .replace(/\b(apartment|apt|unit|suite|ste|space|spc|lot|#)\s+[a-z0-9-]+\b/g, '')
    .split(' ')
    .map((part) => STREET_SUFFIXES.get(part) || part)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
  return /\d/.test(normalized) && normalized.length >= 6 ? normalized : '';
}

export function normalizeLeadPipelineStreetAddress(value: unknown) {
  return normalizeLeadPipelineAddress(valueText(value).split(',')[0]);
}

function compactName(firstName: unknown, lastName: unknown) {
  return [firstName, lastName].map(valueText).filter(Boolean).join(' ');
}

function unique(values: string[]) {
  return Array.from(new Set(values.filter(Boolean)));
}

function addIndexValue(index: Map<string, LeadMatchRecord[]>, key: string, lead: LeadMatchRecord) {
  if (!key) return;
  const rows = index.get(key) || [];
  rows.push(lead);
  index.set(key, rows);
}

function leadNames(lead: LeadMatchRecord) {
  return unique([
    normalizeLeadPipelineName(compactName(lead.firstName, lead.lastName)),
    normalizeLeadPipelineName(compactName(lead.coFirstName, lead.coLastName)),
  ]);
}

function leadEmails(lead: LeadMatchRecord) {
  return unique([lead.email, lead.coEmail].map(normalizeLeadPipelineEmail));
}

function leadPhones(lead: LeadMatchRecord) {
  return unique([
    lead.phone,
    lead.homePhone,
    lead.workPhone,
    lead.coPhone,
    lead.coHomePhone,
    lead.coWorkPhone,
  ].map(normalizeLeadPipelinePhone));
}

function leadAddresses(lead: LeadMatchRecord) {
  return unique([
    [lead.propertyAddress, lead.propertyCity, lead.propertyState, lead.propertyZip]
      .filter(Boolean)
      .join(', '),
    lead.propertyAddress || '',
    [lead.mailingAddress, lead.mailingCity, lead.mailingState, lead.mailingZip]
      .filter(Boolean)
      .join(', '),
    lead.mailingAddress || '',
  ]);
}

function buildLeadIndexes(leads: LeadMatchRecord[]) {
  const indexes = {
    fullAddress: new Map<string, LeadMatchRecord[]>(),
    streetAddress: new Map<string, LeadMatchRecord[]>(),
    email: new Map<string, LeadMatchRecord[]>(),
    phone: new Map<string, LeadMatchRecord[]>(),
  };

  for (const lead of leads) {
    for (const name of leadNames(lead)) {
      for (const email of leadEmails(lead)) {
        addIndexValue(indexes.email, `${name}|${email}`, lead);
      }
      for (const phone of leadPhones(lead)) {
        addIndexValue(indexes.phone, `${name}|${phone}`, lead);
      }
      for (const address of leadAddresses(lead)) {
        const fullAddress = normalizeLeadPipelineAddress(address);
        const streetAddress = normalizeLeadPipelineStreetAddress(address);
        if (fullAddress) addIndexValue(indexes.fullAddress, `${name}|${fullAddress}`, lead);
        if (streetAddress) addIndexValue(indexes.streetAddress, `${name}|${streetAddress}`, lead);
      }
    }
  }

  return indexes;
}

function buildLeadCandidateWhere(
  candidates: LeadMatchCandidates,
): Prisma.LeadWhereInput | null {
  const nameParts = candidates.names
    .map((name) => name.split(' ').filter(Boolean))
    .filter((parts) => parts.length >= 2)
    .map((parts) => ({
      firstName: parts[0],
      lastName: parts[parts.length - 1],
    }));
  const uniqueNameParts = Array.from(
    new Map(
      nameParts.map((parts) => [
        `${parts.firstName}|${parts.lastName}`,
        parts,
      ]),
    ).values(),
  );

  if (uniqueNameParts.length === 0) return null;

  return {
    OR: uniqueNameParts.flatMap(({ firstName, lastName }) => [
      {
        AND: [
          { firstName: { contains: firstName, mode: 'insensitive' as const } },
          { lastName: { contains: lastName, mode: 'insensitive' as const } },
        ],
      },
      {
        AND: [
          { coFirstName: { contains: firstName, mode: 'insensitive' as const } },
          { coLastName: { contains: lastName, mode: 'insensitive' as const } },
        ],
      },
    ]),
  };
}

export function buildLeadMatchCandidates(
  loan: LoanMatchRecord,
  task?: TaskMatchRecord,
): LeadMatchCandidates {
  const data = submissionObject(task?.submissionData);
  const propertyParts = [
    data.propertyStreet,
    data.propertyCity,
    data.propertyState,
    data.propertyZip,
  ].map(valueText).filter(Boolean);

  return {
    names: unique([
      normalizeLeadPipelineName(compactName(data.borrowerFirstName, data.borrowerLastName)),
      normalizeLeadPipelineName(data.borrowerName),
      normalizeLeadPipelineName(compactName(loan.borrowerFirstName, loan.borrowerLastName)),
      normalizeLeadPipelineName(loan.borrowerName),
    ]),
    emails: unique([
      data.borrowerEmail,
      data.email,
      loan.borrowerEmail,
    ].map(normalizeLeadPipelineEmail)),
    phones: unique([
      data.borrowerPhone,
      data.phone,
      loan.borrowerPhone,
    ].map(normalizeLeadPipelinePhone)),
    addresses: unique([
      loan.propertyAddress || '',
      valueText(data.subjectPropertyAddress),
      valueText(data.propertyAddress),
      propertyParts.join(', '),
      valueText(data.address),
      valueText(data.borrowerAddress),
    ]),
  };
}

export function findUniqueLeadPipelineMatch(
  candidates: LeadMatchCandidates,
  leads: LeadMatchRecord[],
): LeadPipelineMatchResult {
  const indexes = buildLeadIndexes(leads);
  const matchesByLeadId = new Map<string, { lead: LeadMatchRecord; matchTypes: Set<string> }>();

  function collect(matches: LeadMatchRecord[], matchType: string) {
    for (const lead of matches) {
      const existing = matchesByLeadId.get(lead.id);
      if (existing) {
        existing.matchTypes.add(matchType);
      } else {
        matchesByLeadId.set(lead.id, { lead, matchTypes: new Set([matchType]) });
      }
    }
  }

  for (const name of candidates.names) {
    for (const address of candidates.addresses) {
      collect(
        indexes.fullAddress.get(`${name}|${normalizeLeadPipelineAddress(address)}`) || [],
        'name+full-address',
      );
      collect(
        indexes.streetAddress.get(`${name}|${normalizeLeadPipelineStreetAddress(address)}`) || [],
        'name+street-address',
      );
    }

    for (const email of candidates.emails) {
      collect(indexes.email.get(`${name}|${email}`) || [], 'name+email');
    }

    for (const phone of candidates.phones) {
      collect(indexes.phone.get(`${name}|${phone}`) || [], 'name+phone');
    }
  }

  const matchedLeadIds = [...matchesByLeadId.keys()];
  if (matchedLeadIds.length === 0) {
    return { kind: 'none', lead: null, matchType: 'none', matchedLeadIds: [] };
  }
  if (matchedLeadIds.length > 1) {
    return {
      kind: 'ambiguous',
      lead: null,
      matchType: 'ambiguous',
      matchedLeadIds,
    };
  }

  const match = matchesByLeadId.get(matchedLeadIds[0]);
  if (!match) return { kind: 'none', lead: null, matchType: 'none', matchedLeadIds: [] };

  return {
    kind: 'matched',
    lead: match.lead,
    matchType: [...match.matchTypes].sort().join(','),
    matchedLeadIds,
  };
}

export function shouldReplaceLeadPipelineStatus(
  currentStatus: LeadStatus,
  nextStatus: PipelineLeadStatus,
) {
  return LEAD_PIPELINE_STATUS_RANK[nextStatus] > LEAD_PIPELINE_STATUS_RANK[currentStatus];
}

export function leadStatusForTaskKind(kind: TaskKind | null | undefined) {
  return kind ? TASK_KIND_TO_LEAD_STATUS[kind] : undefined;
}

export async function syncLeadStatusForLoan(
  tx: TransactionClient,
  input: {
    loanId: string;
    nextStatus: PipelineLeadStatus;
    actorId: string;
    taskId?: string | null;
    source: string;
  },
): Promise<LeadPipelineSyncResult> {
  const loan = await tx.loan.findUnique({
    where: { id: input.loanId },
    select: {
      id: true,
      loanNumber: true,
      borrowerName: true,
      borrowerFirstName: true,
      borrowerLastName: true,
      borrowerEmail: true,
      borrowerPhone: true,
      propertyAddress: true,
    },
  });

  if (!loan) {
    return { kind: 'skipped-missing-loan', nextStatus: input.nextStatus };
  }

  const task = input.taskId
    ? await tx.task.findUnique({
        where: { id: input.taskId },
        select: {
          id: true,
          kind: true,
          loanId: true,
          submissionData: true,
        },
      })
    : null;
  const taskForMatch = task?.loanId === loan.id ? task : null;

  const candidates = buildLeadMatchCandidates(loan, taskForMatch);
  const candidateWhere = buildLeadCandidateWhere(candidates);
  if (!candidateWhere) {
    return { kind: 'skipped-no-match', nextStatus: input.nextStatus };
  }
  const leads = await tx.lead.findMany({
    where: candidateWhere,
    select: LEAD_MATCH_SELECT,
  });
  const match = findUniqueLeadPipelineMatch(candidates, leads);

  if (match.kind === 'none') {
    return { kind: 'skipped-no-match', nextStatus: input.nextStatus };
  }

  if (match.kind === 'ambiguous') {
    await tx.auditLog.create({
      data: {
        loanId: loan.id,
        userId: input.actorId,
        action: 'LEAD_PIPELINE_STATUS_SYNC_AMBIGUOUS',
        details: JSON.stringify({
          loanNumber: loan.loanNumber,
          nextStatus: input.nextStatus,
          taskId: taskForMatch?.id || null,
          taskKind: taskForMatch?.kind || null,
          source: input.source,
          matchedLeadIds: match.matchedLeadIds.slice(0, 25),
        }),
      },
    });
    return {
      kind: 'skipped-ambiguous',
      nextStatus: input.nextStatus,
      matchType: match.matchType,
      matchedLeadIds: match.matchedLeadIds,
    };
  }

  if (!shouldReplaceLeadPipelineStatus(match.lead.status, input.nextStatus)) {
    return {
      kind: 'skipped-no-upgrade',
      leadId: match.lead.id,
      currentStatus: match.lead.status,
      nextStatus: input.nextStatus,
      matchType: match.matchType,
    };
  }

  await tx.lead.update({
    where: { id: match.lead.id },
    data: { status: input.nextStatus },
  });
  await tx.auditLog.create({
    data: {
      loanId: loan.id,
      userId: input.actorId,
      action: 'LEAD_PIPELINE_STATUS_SYNCED',
      details: JSON.stringify({
        leadId: match.lead.id,
        loanNumber: loan.loanNumber,
        previousStatus: match.lead.status,
        nextStatus: input.nextStatus,
        matchType: match.matchType,
        taskId: taskForMatch?.id || null,
        taskKind: taskForMatch?.kind || null,
        source: input.source,
      }),
    },
  });

  return {
    kind: 'updated',
    leadId: match.lead.id,
    previousStatus: match.lead.status,
    nextStatus: input.nextStatus,
    matchType: match.matchType,
  };
}
