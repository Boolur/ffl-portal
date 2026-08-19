import { randomUUID } from 'crypto';

const tenantId = process.env.MS_TENANT_ID;
const clientId = process.env.MS_CLIENT_ID;
const clientSecret = process.env.MS_CLIENT_SECRET;

export const EMAIL_SENDER_ENV_BY_CATEGORY = {
  noreply: 'MS_SENDER_NOREPLY_EMAIL',
  leads: 'MS_SENDER_LEADS_EMAIL',
  disclosures: 'MS_SENDER_DISCLOSURES_EMAIL',
  originations: 'MS_SENDER_ORIGINATIONS_EMAIL',
  processing: 'MS_SENDER_PROCESSING_EMAIL',
} as const;

export type EmailSenderCategory = keyof typeof EMAIL_SENDER_ENV_BY_CATEGORY;

const hasConfiguredSender =
  Boolean(process.env.MS_SENDER_EMAIL?.trim()) ||
  Object.values(EMAIL_SENDER_ENV_BY_CATEGORY).some((name) =>
    Boolean(process.env[name]?.trim())
  );

if (!tenantId || !clientId || !clientSecret || !hasConfiguredSender) {
  console.warn('[email] Missing Microsoft Graph email configuration.');
}

let cachedToken: { value: string; expiresAt: number } | null = null;

const TOKEN_TIMEOUT_MS = 10_000;
const SEND_TIMEOUT_MS = 15_000;
const MAX_SEND_ATTEMPTS = 3;

export type EmailSendReceipt = {
  provider: 'microsoft-graph';
  sender: string;
  senderCategory: EmailSenderCategory;
  status: number;
  statusText: string;
  requestId: string | null;
  clientRequestId: string;
  date: string | null;
  acceptedAt: string;
};

export function assertEmailDeliveriesSucceeded(
  results: PromiseSettledResult<EmailSendReceipt>[],
  label: string,
) {
  const failures = results.flatMap((result) =>
    result.status === 'rejected' ? [result.reason] : [],
  );
  if (failures.length === 0) return;
  const messages = failures.map((failure) =>
    failure instanceof Error ? failure.message : String(failure),
  );
  throw new Error(
    `${label}: ${failures.length} of ${results.length} email deliveries failed. ${messages.join(' | ')}`,
  );
}

type InlineEmailAttachment = {
  name: string;
  contentType: string;
  contentBytes: string;
  contentId: string;
};

function isEnabled(value: string | undefined) {
  return ['1', 'true', 'yes', 'on'].includes(value?.trim().toLowerCase() ?? '');
}

export function isEmailSenderCategoryDisabled(
  category: EmailSenderCategory,
  env: Readonly<Record<string, string | undefined>> = process.env
): boolean {
  return category === 'processing' && isEnabled(env.MS_DISABLE_PROCESSING_EMAILS);
}

export function resolveSenderEmail(
  category: EmailSenderCategory,
  env: Readonly<Record<string, string | undefined>> = process.env
): string {
  const categoryEnvName = EMAIL_SENDER_ENV_BY_CATEGORY[category];
  const categorySender = env[categoryEnvName]?.trim();
  if (categorySender) return categorySender;

  if (isEnabled(env.MS_REQUIRE_CATEGORY_SENDERS)) {
    throw new Error(
      `Microsoft Graph sender for "${category}" is missing (${categoryEnvName}).`
    );
  }

  const legacySender = env.MS_SENDER_EMAIL?.trim();
  if (legacySender) return legacySender;

  throw new Error(
    `Microsoft Graph sender for "${category}" is missing (${categoryEnvName} or MS_SENDER_EMAIL).`
  );
}

function isRetryableStatus(status: number) {
  return status === 408 || status === 429 || status >= 500;
}

function getBackoffMs(attempt: number) {
  const clamped = Math.max(1, Math.min(5, attempt));
  const jitter = Math.floor(Math.random() * 200);
  return 400 * 2 ** (clamped - 1) + jitter;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchWithTimeout(input: string, init: RequestInit, timeoutMs: number) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(input, {
      ...init,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }
}

async function getAccessToken() {
  if (cachedToken && cachedToken.expiresAt > Date.now()) {
    return cachedToken.value;
  }

  if (!tenantId || !clientId || !clientSecret) {
    throw new Error('Microsoft Graph configuration missing.');
  }

  const body = new URLSearchParams({
    client_id: clientId,
    scope: 'https://graph.microsoft.com/.default',
    client_secret: clientSecret,
    grant_type: 'client_credentials',
  });

  const response = await fetchWithTimeout(
    `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    },
    TOKEN_TIMEOUT_MS
  );

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Failed to fetch Graph token: ${errorText}`);
  }

  const data = (await response.json()) as { access_token: string; expires_in: number };
  cachedToken = {
    value: data.access_token,
    expiresAt: Date.now() + (data.expires_in - 60) * 1000,
  };
  return cachedToken.value;
}

export async function sendEmail({
  to,
  subject,
  html,
  text,
  inlineAttachments,
  senderCategory = 'noreply',
  maxAttempts = MAX_SEND_ATTEMPTS,
  timeoutMs = SEND_TIMEOUT_MS,
  label = 'email',
}: {
  to: string | string[];
  subject: string;
  html?: string;
  text?: string;
  inlineAttachments?: InlineEmailAttachment[];
  senderCategory?: EmailSenderCategory;
  maxAttempts?: number;
  timeoutMs?: number;
  label?: string;
}): Promise<EmailSendReceipt> {
  if (isEmailSenderCategoryDisabled(senderCategory)) {
    throw new Error(
      `Email sending for "${senderCategory}" is paused by MS_DISABLE_PROCESSING_EMAILS.`
    );
  }

  const senderEmail = resolveSenderEmail(senderCategory);

  const contentType = html ? 'HTML' : 'Text';
  const content = html || text || '';
  const recipients = (Array.isArray(to) ? to : [to])
    .map((address) => address.trim())
    .filter(Boolean);
  if (recipients.length === 0) {
    throw new Error('At least one email recipient is required.');
  }
  let lastError: string | null = null;
  const attempts = Math.max(1, Math.floor(maxAttempts));
  const sendTimeoutMs = Math.max(1_000, Math.floor(timeoutMs));

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const clientRequestId = randomUUID();
    try {
      const accessToken = await getAccessToken();
      const response = await fetchWithTimeout(
        `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(senderEmail)}/sendMail`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
            'client-request-id': clientRequestId,
            'return-client-request-id': 'true',
          },
          body: JSON.stringify({
            message: {
              subject,
              body: { contentType, content },
              toRecipients: recipients.map((address) => ({
                emailAddress: { address },
              })),
              ...(inlineAttachments?.length
                ? {
                    attachments: inlineAttachments.map((attachment) => ({
                      '@odata.type': '#microsoft.graph.fileAttachment',
                      name: attachment.name,
                      contentType: attachment.contentType,
                      contentBytes: attachment.contentBytes,
                      contentId: attachment.contentId,
                      isInline: true,
                    })),
                  }
                : {}),
            },
            saveToSentItems: true,
          }),
        },
        sendTimeoutMs
      );

      if (response.ok) {
        return {
          provider: 'microsoft-graph',
          sender: senderEmail,
          senderCategory,
          status: response.status,
          statusText: response.statusText,
          requestId: response.headers.get('request-id'),
          clientRequestId:
            response.headers.get('client-request-id') ?? clientRequestId,
          date: response.headers.get('date'),
          acceptedAt: new Date().toISOString(),
        };
      }

      const errorText = await response.text();
      lastError = `Graph send failed (${response.status}; request-id=${response.headers.get('request-id') ?? 'n/a'}; client-request-id=${clientRequestId}): ${errorText}`;

      if (response.status === 401 || response.status === 403) {
        // Token may be stale/revoked; clear cache and retry once.
        cachedToken = null;
      }

      if (!isRetryableStatus(response.status) || attempt === attempts) {
        throw new Error(lastError);
      }
    } catch (error) {
      const isAbort =
        error instanceof DOMException && error.name === 'AbortError';
      lastError =
        error instanceof Error
          ? error.message
          : `Unknown email transport error${isAbort ? ' (timeout)' : ''}`;
      if (attempt === attempts) {
        throw new Error(`Failed to send ${label} via Graph: ${lastError}`);
      }
    }

    await sleep(getBackoffMs(attempt));
  }

  throw new Error(`Failed to send email via Graph: ${lastError || 'Unknown error'}`);
}
