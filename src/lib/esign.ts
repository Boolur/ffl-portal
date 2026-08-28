import 'server-only';

export type ESignEnvelopeRequest = {
  idempotencyKey: string;
  documentId: string;
  documentName: string;
  documentDownloadUrl: string;
  recipientName: string;
  recipientEmail: string;
  callbackUrl: string;
};

export type ESignEnvelopeResult = {
  envelopeId: string;
  status: string;
};

export interface ESignAdapter {
  provider: string;
  createEnvelope(input: ESignEnvelopeRequest): Promise<ESignEnvelopeResult>;
  downloadSignedDocument(envelopeId: string): Promise<{
    bytes: ArrayBuffer;
    contentType: string;
  }>;
}

class HttpESignAdapter implements ESignAdapter {
  provider = 'http';
  private readonly baseUrl: string;
  private readonly token: string;

  constructor() {
    this.baseUrl = process.env.ESIGN_API_BASE_URL?.trim().replace(/\/$/, '') || '';
    this.token = process.env.ESIGN_API_TOKEN?.trim() || '';
    if (!this.baseUrl || !this.token) {
      throw new Error('ESIGN_API_BASE_URL and ESIGN_API_TOKEN are required.');
    }
  }

  private headers(contentType = 'application/json') {
    return {
      Authorization: `Bearer ${this.token}`,
      'Content-Type': contentType,
    };
  }

  async createEnvelope(input: ESignEnvelopeRequest): Promise<ESignEnvelopeResult> {
    const response = await fetch(`${this.baseUrl}/envelopes`, {
      method: 'POST',
      headers: {
        ...this.headers(),
        'Idempotency-Key': input.idempotencyKey,
      },
      body: JSON.stringify(input),
      signal: AbortSignal.timeout(20_000),
    });
    if (!response.ok) {
      throw new Error(`E-sign provider rejected the envelope (${response.status}).`);
    }
    const payload = (await response.json()) as { envelopeId?: string; id?: string; status?: string };
    const envelopeId = String(payload.envelopeId || payload.id || '').trim();
    if (!envelopeId) throw new Error('E-sign provider did not return an envelope ID.');
    return { envelopeId, status: String(payload.status || 'sent') };
  }

  async downloadSignedDocument(envelopeId: string) {
    const response = await fetch(
      `${this.baseUrl}/envelopes/${encodeURIComponent(envelopeId)}/document`,
      {
        headers: { Authorization: `Bearer ${this.token}` },
        signal: AbortSignal.timeout(30_000),
      },
    );
    if (!response.ok) {
      throw new Error(`Unable to retrieve signed document (${response.status}).`);
    }
    return {
      bytes: await response.arrayBuffer(),
      contentType: response.headers.get('content-type') || 'application/pdf',
    };
  }
}

export function getESignAdapter(): ESignAdapter | null {
  const provider = process.env.ESIGN_PROVIDER?.trim().toLowerCase() || 'manual';
  if (provider === 'manual') return null;
  if (provider === 'http') return new HttpESignAdapter();
  throw new Error(`Unsupported ESIGN_PROVIDER "${provider}".`);
}
