export const PROCESSING_METHOD_IN_HOUSE = 'IN_HOUSE';
export const PROCESSING_METHOD_THIRD_PARTY = 'THIRD_PARTY';
export const PROCESSING_METHOD_SELF_PROCESSED = 'SELF_PROCESSED';

export const PROCESSING_METHOD_OPTIONS = [
  {
    value: PROCESSING_METHOD_IN_HOUSE,
    label: 'In-House',
    description: 'Route this file to an in-house processor team.',
  },
  {
    value: PROCESSING_METHOD_THIRD_PARTY,
    label: 'Contract/3rd Party',
    description: 'Route this file to the JR processors assigned to third-party processing.',
  },
  {
    value: PROCESSING_METHOD_SELF_PROCESSED,
    label: 'Self Processed',
    description: 'No JR processing queue work is needed for this file.',
  },
] as const;

export type ProcessingMethod = (typeof PROCESSING_METHOD_OPTIONS)[number]['value'];

export const PROCESSING_ASSIGNMENT_KATHY_BUI = 'KATHY_BUI';
export const PROCESSING_ASSIGNMENT_JACK_NGO = 'JACK_NGO';
export const PROCESSING_ASSIGNMENT_THIRD_PARTY = 'THIRD_PARTY';

export const PROCESSING_ASSIGNMENT_OPTIONS = [
  {
    value: PROCESSING_ASSIGNMENT_KATHY_BUI,
    label: 'Kathy Bui',
    method: PROCESSING_METHOD_IN_HOUSE,
  },
  {
    value: PROCESSING_ASSIGNMENT_JACK_NGO,
    label: 'Jack Ngo',
    method: PROCESSING_METHOD_IN_HOUSE,
  },
  {
    value: PROCESSING_ASSIGNMENT_THIRD_PARTY,
    label: 'Contract/3rd Party',
    method: PROCESSING_METHOD_THIRD_PARTY,
  },
] as const;

export type ProcessingAssignmentGroup = (typeof PROCESSING_ASSIGNMENT_OPTIONS)[number]['value'];

export function isProcessingMethod(value: unknown): value is ProcessingMethod {
  return PROCESSING_METHOD_OPTIONS.some((option) => option.value === value);
}

export function isProcessingAssignmentGroup(value: unknown): value is ProcessingAssignmentGroup {
  return PROCESSING_ASSIGNMENT_OPTIONS.some((option) => option.value === value);
}

export function getProcessingMethodLabel(value: unknown) {
  return PROCESSING_METHOD_OPTIONS.find((option) => option.value === value)?.label || '';
}

export function getProcessingAssignmentLabel(value: unknown) {
  return PROCESSING_ASSIGNMENT_OPTIONS.find((option) => option.value === value)?.label || '';
}

export function normalizeProcessingAssignmentGroups(values: unknown): ProcessingAssignmentGroup[] {
  if (!Array.isArray(values)) return [];
  return Array.from(new Set(values.filter(isProcessingAssignmentGroup)));
}
