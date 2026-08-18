const SENSITIVE_PAYMENT_KEY =
  /(?:^|_)(?:cardnumber|creditcardnumber|debitcardnumber|cardcvc|cardcvv|cvc|cvv|pan)(?:$|_)/i;

export type SafeSubmissionValue =
  | string
  | number
  | boolean
  | null
  | SafeSubmissionValue[]
  | { [key: string]: SafeSubmissionValue };

function normalizeKey(key: string) {
  return key.replace(/[^a-z0-9]/gi, '').toLowerCase();
}

export function isSensitivePaymentKey(key: string) {
  return SENSITIVE_PAYMENT_KEY.test(key) ||
    [
      'cardnumber',
      'creditcardnumber',
      'debitcardnumber',
      'cardcvc',
      'cardcvv',
      'cvc',
      'cvv',
      'pan',
    ].includes(normalizeKey(key));
}

export function safeSubmissionObject(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export function sanitizeProcessingSubmissionData(
  value: unknown,
): SafeSubmissionValue {
  if (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  ) {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((entry) => sanitizeProcessingSubmissionData(entry));
  }
  if (!value || typeof value !== 'object') return null;

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([key]) => !isSensitivePaymentKey(key))
      .map(([key, entry]) => [key, sanitizeProcessingSubmissionData(entry)]),
  );
}

export function readSubmissionString(
  data: Record<string, unknown>,
  ...keys: string[]
) {
  for (const key of keys) {
    const value = data[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
    if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  }
  return null;
}

export function splitBorrowerName(value: unknown) {
  const fullName = String(value ?? '').trim().replace(/\s+/g, ' ');
  if (!fullName) return { firstName: '', lastName: '' };
  const parts = fullName.split(' ');
  if (parts.length === 1) return { firstName: fullName, lastName: '' };
  return {
    firstName: parts.slice(0, -1).join(' '),
    lastName: parts[parts.length - 1],
  };
}

export function readSubmissionNotes(data: Record<string, unknown>) {
  const history = Array.isArray(data.notesHistory) ? data.notesHistory : [];
  return history.flatMap((entry, index) => {
    const note = safeSubmissionObject(entry);
    const message = readSubmissionString(note, 'message');
    if (!message) return [];
    return [{
      id: readSubmissionString(note, 'id') || `submission-note-${index}`,
      message,
      author: readSubmissionString(note, 'author') || 'Portal user',
      role: readSubmissionString(note, 'role'),
      date: readSubmissionString(note, 'date'),
      entryType: readSubmissionString(note, 'entryType') || 'note',
    }];
  });
}

export function normalizeProcessingZip(value: unknown) {
  const rawZip = String(value ?? '').trim();
  const zipWithLeadingZero = /^\d{8}$/.test(rawZip)
    ? `0${rawZip}`
    : rawZip;
  return /^\d{9}$/.test(zipWithLeadingZero)
    ? `${zipWithLeadingZero.slice(0, 5)}-${zipWithLeadingZero.slice(5)}`
    : zipWithLeadingZero;
}

export function normalizeProcessingProperty(input: {
  street: unknown;
  unit?: unknown;
  city: unknown;
  state: unknown;
  zip: unknown;
}) {
  const street = String(input.street ?? '').trim();
  const unit = String(input.unit ?? '').trim();
  const city = String(input.city ?? '').trim();
  const state = String(input.state ?? '').trim().toUpperCase();
  const zip = normalizeProcessingZip(input.zip);
  if (!street || !city || !state || !zip) {
    return {
      success: false as const,
      error:
        'A complete Subject Property street, city, state, and ZIP is required before submitting Processing.',
    };
  }
  if (!/^[A-Z]{2}$/.test(state)) {
    return {
      success: false as const,
      error: 'Subject Property State must be a valid 2-letter abbreviation.',
    };
  }
  if (!/^\d{5}(?:-\d{4})?$/.test(zip)) {
    return {
      success: false as const,
      error: 'Subject Property ZIP must be 5 digits or a 9-digit ZIP+4.',
    };
  }
  return {
    success: true as const,
    street,
    unit,
    city,
    state,
    zip,
    address: [
      [street, unit].filter(Boolean).join(' '),
      city,
      `${state} ${zip}`,
    ].join(', '),
  };
}

export function validateProcessingBorrowerContact(input: {
  phone: unknown;
  email: unknown;
}) {
  const phone = String(input.phone ?? '').trim();
  const email = String(input.email ?? '').trim().toLowerCase();
  if (!phone || !email) {
    return {
      success: false as const,
      error:
        'Borrower Phone and Borrower Email are required before submitting Processing.',
    };
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return {
      success: false as const,
      error: 'Enter a valid Borrower Email before submitting Processing.',
    };
  }
  return { success: true as const, phone, email };
}
