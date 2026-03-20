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
}: {
  to: string;
  subject: string;
  html?: string;
  text?: string;
}) {
  if (!senderEmail) {
    throw new Error('Microsoft Graph sender email missing.');
  }

  const contentType = html ? 'HTML' : 'Text';
  const content = html || text || '';
  let lastError: string | null = null;

  for (let attempt = 1; attempt <= MAX_SEND_ATTEMPTS; attempt += 1) {
    try {
      const accessToken = await getAccessToken();
      const response = await fetchWithTimeout(
        `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(senderEmail)}/sendMail`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            message: {
              subject,
              body: { contentType, content },
              toRecipients: [{ emailAddress: { address: to } }],
            },
            saveToSentItems: true,
          }),
        },
        SEND_TIMEOUT_MS
      );

      if (response.ok) {
        return;
      }

      const errorText = await response.text();
      lastError = `Graph send failed (${response.status}): ${errorText}`;

      if (response.status === 401 || response.status === 403) {
        // Token may be stale/revoked; clear cache and retry once.
        cachedToken = null;
      }

      if (!isRetryableStatus(response.status) || attempt === MAX_SEND_ATTEMPTS) {
        throw new Error(lastError);
      }
    } catch (error) {
      const isAbort =
        error instanceof DOMException && error.name === 'AbortError';
      lastError =
        error instanceof Error
          ? error.message
          : `Unknown email transport error${isAbort ? ' (timeout)' : ''}`;
      if (attempt === MAX_SEND_ATTEMPTS) {
        throw new Error(`Failed to send email via Graph: ${lastError}`);
      }
    }

    await sleep(getBackoffMs(attempt));
  }

  throw new Error(`Failed to send email via Graph: ${lastError || 'Unknown error'}`);
}
