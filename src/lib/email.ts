import { randomUUID } from 'crypto';

const tenantId = process.env.MS_TENANT_ID;
const clientId = process.env.MS_CLIENT_ID;
const clientSecret = process.env.MS_CLIENT_SECRET;
const senderEmail = process.env.MS_SENDER_EMAIL;

if (!tenantId || !clientId || !clientSecret || !senderEmail) {
  console.warn('[email] Missing Microsoft Graph email configuration.');
}

let cachedToken: { value: string; expiresAt: number } | null = null;

const TOKEN_TIMEOUT_MS = 10_000;
const SEND_TIMEOUT_MS = 15_000;
const MAX_SEND_ATTEMPTS = 3;

export type EmailSendReceipt = {
  provider: 'microsoft-graph';
  status: number;
  statusText: string;
  requestId: string | null;
  clientRequestId: string;
  date: string | null;
  acceptedAt: string;
};

type InlineEmailAttachment = {
  name: string;
  contentType: string;
  contentBytes: string;
  contentId: string;
};

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
  maxAttempts = MAX_SEND_ATTEMPTS,
  timeoutMs = SEND_TIMEOUT_MS,
  label = 'email',
}: {
  to: string | string[];
  subject: string;
  html?: string;
  text?: string;
  inlineAttachments?: InlineEmailAttachment[];
  maxAttempts?: number;
  timeoutMs?: number;
  label?: string;
}): Promise<EmailSendReceipt> {
  if (!senderEmail) {
    throw new Error('Microsoft Graph sender email missing.');
  }

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
