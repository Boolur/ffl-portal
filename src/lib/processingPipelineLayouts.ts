import { UserRole } from '@prisma/client';

export const PROCESSING_LAYOUT_BUCKETS = [
  'PIPELINE',
  'RESTRUCTURE',
  'RATE_LOCK_REQUESTS',
  'FUNDING',
] as const;

export type ProcessingLayoutBucket = (typeof PROCESSING_LAYOUT_BUCKETS)[number];

export const PROCESSING_PIPELINE_COLUMN_IDS = [
  'dateAssigned',
  'loanNumber',
  'loanOfficer',
  'borrowerName',
  'propertyState',
  'lender',
  'leadSource',
  'loanAmount',
  'loanType',
  'juniorProcessor',
  'seniorProcessor',
  'pipelineStatus',
  'missingItemsCurrentStatus',
  'restructureNotes',
  'titleStatus',
  'payoffStatus',
  'hoiStatus',
  'appraisalNeeded',
  'daysInStatus',
  'appraisalNotes',
  'appraisalOrderedAt',
  'appraisalBackAt',
  'cdSent',
  'estimatedSigningAt',
  'extraNotes',
  'rateLock',
  'projectedRevenue',
  'fundedAt',
  'finalRevenue',
  'firstPaymentAt',
  'sixthPaymentAt',
  'actions',
] as const;

export type ProcessingPipelineColumnId =
  (typeof PROCESSING_PIPELINE_COLUMN_IDS)[number];

export type ProcessingPipelineColumnDefinition = {
  id: ProcessingPipelineColumnId;
  label: string;
  width: number;
  optional?: boolean;
};

export const PROCESSING_PIPELINE_COLUMNS: ProcessingPipelineColumnDefinition[] = [
  { id: 'dateAssigned', label: 'Assignment Date', width: 94 },
  { id: 'loanNumber', label: 'Arive #', width: 96 },
  { id: 'loanOfficer', label: 'Loan Officer', width: 128 },
  { id: 'borrowerName', label: 'Borrower', width: 154 },
  { id: 'propertyState', label: 'State', width: 76 },
  { id: 'lender', label: 'Lender', width: 140 },
  { id: 'leadSource', label: 'Lead Source', width: 140, optional: true },
  { id: 'loanAmount', label: 'Loan Amount', width: 126 },
  { id: 'loanType', label: 'Loan Type', width: 108 },
  { id: 'juniorProcessor', label: 'Jr Processor', width: 118 },
  { id: 'seniorProcessor', label: 'Processor', width: 118 },
  { id: 'pipelineStatus', label: 'Pipeline Status', width: 164 },
  { id: 'missingItemsCurrentStatus', label: 'Pending Items', width: 220 },
  { id: 'restructureNotes', label: 'Restructure Notes', width: 280 },
  { id: 'titleStatus', label: 'Title', width: 124 },
  { id: 'payoffStatus', label: 'Payoff', width: 124 },
  { id: 'hoiStatus', label: 'HOI', width: 124 },
  { id: 'appraisalNeeded', label: 'Appraisal?', width: 118 },
  { id: 'daysInStatus', label: 'Days', width: 68 },
  { id: 'appraisalNotes', label: 'Appraisal Notes', width: 220, optional: true },
  { id: 'appraisalOrderedAt', label: 'Appraisal Ordered', width: 146, optional: true },
  { id: 'appraisalBackAt', label: 'Appraisal Back', width: 140, optional: true },
  { id: 'cdSent', label: 'CD Sent?', width: 112, optional: true },
  { id: 'estimatedSigningAt', label: 'Est. Signing', width: 132, optional: true },
  { id: 'extraNotes', label: 'Extra Notes', width: 210, optional: true },
  { id: 'rateLock', label: 'Rate Lock', width: 112, optional: true },
  { id: 'projectedRevenue', label: 'Revenue', width: 130, optional: true },
  { id: 'actions', label: 'Actions', width: 142 },
];

export const PROCESSING_FUNDING_COLUMNS: ProcessingPipelineColumnDefinition[] = [
  { id: 'dateAssigned', label: 'Assignment Date', width: 96 },
  { id: 'loanNumber', label: 'Arive #', width: 100 },
  { id: 'loanOfficer', label: 'Loan Officer', width: 140 },
  { id: 'borrowerName', label: 'Borrower', width: 170 },
  { id: 'leadSource', label: 'Lead Source', width: 140 },
  { id: 'propertyState', label: 'State', width: 76 },
  { id: 'loanType', label: 'Loan Type', width: 112 },
  { id: 'lender', label: 'Lender', width: 140 },
  { id: 'juniorProcessor', label: 'Junior', width: 130 },
  { id: 'seniorProcessor', label: 'Senior', width: 130 },
  { id: 'fundedAt', label: 'Funded Date', width: 120 },
  { id: 'finalRevenue', label: 'Final Revenue', width: 140 },
  { id: 'firstPaymentAt', label: 'First Payment', width: 120 },
  { id: 'sixthPaymentAt', label: '6th Payment', width: 120 },
];

export const PROCESSING_MANDATORY_COLUMN_IDS = [
  'dateAssigned',
  'loanNumber',
  'loanOfficer',
  'borrowerName',
  'pipelineStatus',
] as const satisfies readonly ProcessingPipelineColumnId[];

export type ProcessingLayoutColumn = {
  id: ProcessingPipelineColumnId;
  visible: boolean;
  width: number;
};

export type ProcessingLayoutBucketConfig = {
  columns: ProcessingLayoutColumn[];
};

export type ProcessingPipelineLayoutConfig = {
  version: 1;
  buckets: Record<ProcessingLayoutBucket, ProcessingLayoutBucketConfig>;
};

const PIPELINE_DEFAULT_FOCUS = new Set<ProcessingPipelineColumnId>([
  'dateAssigned',
  'loanNumber',
  'loanOfficer',
  'borrowerName',
  'propertyState',
  'lender',
  'loanAmount',
  'loanType',
  'juniorProcessor',
  'seniorProcessor',
  'pipelineStatus',
  'missingItemsCurrentStatus',
  'restructureNotes',
  'titleStatus',
  'payoffStatus',
  'hoiStatus',
  'appraisalNeeded',
  'daysInStatus',
  'actions',
]);

const LEADERSHIP_ROLES = new Set<UserRole>([
  UserRole.LOAN_OFFICER,
  UserRole.LOA,
  UserRole.MANAGER,
  UserRole.ADMIN_I,
  UserRole.ADMIN_II,
  UserRole.ADMIN_III,
]);

const PROCESSOR_RESTRICTED_COLUMNS = new Set<ProcessingPipelineColumnId>([
  'loanAmount',
  'projectedRevenue',
  'leadSource',
]);

export function processingLayoutBucketColumns(
  bucket: ProcessingLayoutBucket,
  role: UserRole,
): ProcessingPipelineColumnDefinition[] {
  const source =
    bucket === 'FUNDING'
      ? PROCESSING_FUNDING_COLUMNS
      : PROCESSING_PIPELINE_COLUMNS;
  return source.filter((column) => {
    if (
      (role === UserRole.PROCESSOR_JR || role === UserRole.PROCESSOR_SR) &&
      PROCESSOR_RESTRICTED_COLUMNS.has(column.id)
    ) {
      return false;
    }
    if (
      column.id === 'restructureNotes' &&
      bucket !== 'RESTRUCTURE' &&
      bucket !== 'RATE_LOCK_REQUESTS'
    ) {
      return false;
    }
    return true;
  });
}

export function mandatoryColumnsForBucket(
  bucket: ProcessingLayoutBucket,
  role: UserRole,
): ProcessingPipelineColumnId[] {
  const available = new Set(
    processingLayoutBucketColumns(bucket, role).map((column) => column.id),
  );
  return PROCESSING_MANDATORY_COLUMN_IDS.filter((id) => available.has(id));
}

export function buildDefaultProcessingLayoutConfig(
  role: UserRole,
): ProcessingPipelineLayoutConfig {
  const leadershipFocus = new Set(PIPELINE_DEFAULT_FOCUS);
  if (LEADERSHIP_ROLES.has(role)) {
    leadershipFocus.delete('titleStatus');
    leadershipFocus.delete('payoffStatus');
    leadershipFocus.delete('hoiStatus');
    leadershipFocus.add('appraisalNotes');
    leadershipFocus.add('projectedRevenue');
  }

  return {
    version: 1,
    buckets: Object.fromEntries(
      PROCESSING_LAYOUT_BUCKETS.map((bucket) => {
        const columns = processingLayoutBucketColumns(bucket, role);
        return [
          bucket,
          {
            columns: columns.map((column) => ({
              id: column.id,
              visible:
                bucket === 'FUNDING' ||
                leadershipFocus.has(column.id) ||
                (bucket === 'RATE_LOCK_REQUESTS' && column.id === 'rateLock'),
              width: column.width,
            })),
          },
        ];
      }),
    ) as Record<ProcessingLayoutBucket, ProcessingLayoutBucketConfig>,
  };
}

export function normalizeProcessingLayoutConfig(
  value: unknown,
  role: UserRole,
): { success: true; config: ProcessingPipelineLayoutConfig } | { success: false; error: string } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { success: false, error: 'Layout configuration is invalid.' };
  }
  const raw = value as {
    version?: unknown;
    buckets?: Record<string, { columns?: unknown }>;
  };
  if (raw.version !== 1 || !raw.buckets || typeof raw.buckets !== 'object') {
    return { success: false, error: 'Layout configuration version is invalid.' };
  }

  const buckets = {} as Record<
    ProcessingLayoutBucket,
    ProcessingLayoutBucketConfig
  >;
  for (const bucket of PROCESSING_LAYOUT_BUCKETS) {
    const rawColumns = raw.buckets[bucket]?.columns;
    if (!Array.isArray(rawColumns)) {
      return { success: false, error: `${bucket} columns are missing.` };
    }
    const definitions = processingLayoutBucketColumns(bucket, role);
    const definitionById = new Map(definitions.map((column) => [column.id, column]));
    const seen = new Set<ProcessingPipelineColumnId>();
    const encountered = new Set<string>();
    const knownIds = new Set<string>(PROCESSING_PIPELINE_COLUMN_IDS);
    const columns: ProcessingLayoutColumn[] = [];
    for (const rawColumn of rawColumns) {
      if (!rawColumn || typeof rawColumn !== 'object' || Array.isArray(rawColumn)) {
        return { success: false, error: `${bucket} contains an invalid column.` };
      }
      const candidate = rawColumn as {
        id?: unknown;
        visible?: unknown;
        width?: unknown;
      };
      if (typeof candidate.id !== 'string') {
        return { success: false, error: `${bucket} contains an invalid column ID.` };
      }
      const id = candidate.id as ProcessingPipelineColumnId;
      if (!knownIds.has(id) || encountered.has(id)) {
        return {
          success: false,
          error: `${bucket} contains an unavailable or duplicate column.`,
        };
      }
      encountered.add(id);
      const definition = definitionById.get(id);
      if (!definition) continue;
      const width = Number(candidate.width);
      if (!Number.isFinite(width) || width < 64 || width > 420) {
        return { success: false, error: `${definition.label} has an invalid width.` };
      }
      seen.add(id);
      columns.push({
        id,
        visible: candidate.visible === true,
        width: Math.round(width),
      });
    }
    for (const definition of definitions) {
      if (!seen.has(definition.id)) {
        columns.push({
          id: definition.id,
          visible: false,
          width: definition.width,
        });
      }
    }
    const mandatory = new Set(mandatoryColumnsForBucket(bucket, role));
    for (const column of columns) {
      if (mandatory.has(column.id)) column.visible = true;
    }
    buckets[bucket] = { columns };
  }

  return { success: true, config: { version: 1, buckets } };
}

export function normalizeProcessingLayoutName(value: unknown) {
  const name = String(value ?? '').trim().replace(/\s+/g, ' ');
  if (name.length < 1 || name.length > 32) {
    return { success: false as const, error: 'Layout names must be 1–32 characters.' };
  }
  return {
    success: true as const,
    name,
    nameKey: name.toLocaleLowerCase(),
  };
}
