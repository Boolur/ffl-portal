import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { IntegrationService, IntegrationServiceCredentialField } from '@prisma/client';
import { SHAPE_ENDPOINT, SHAPE_CREDENTIAL_FIELDS } from '../integrationServices/shape';

const mocks = vi.hoisted(() => ({
  lead: vi.fn(), credential: vi.fn(), audit: vi.fn(), quota: vi.fn(),
}));
vi.mock('@/lib/prisma', () => ({ prisma: {
  lead: { findUnique: mocks.lead }, userIntegrationCredential: { findUnique: mocks.credential },
  serviceDispatch: { create: mocks.audit }, userLeadQuota: { findUnique: mocks.quota },
} }));
vi.mock('@/lib/email', () => ({ sendEmail: vi.fn() }));
vi.mock('@/lib/emailPreferences', () => ({ filterEmailRecipientsByPreference: vi.fn() }));
vi.mock('@/lib/bonzoForward', () => ({ buildBonzoPayload: vi.fn() }));
vi.mock('@/lib/brokerLaunchEmail', () => ({ sendBrokerLaunchEmail: vi.fn() }));
vi.mock('@/lib/concurrencyLimit', () => ({ withConcurrencyLimit: vi.fn(), ConcurrencyKeys: {} }));
vi.mock('@/lib/integrationServices/shape', () => import('../integrationServices/shape'));
import { dispatchServiceToLead } from './dispatch';

const service = {
  id: 'shape-service', slug: 'shape', type: 'shape', active: true,
  method: 'POST_JSON', urlTemplate: SHAPE_ENDPOINT, headersTemplate: '', bodyTemplate: '',
  allowManualSend: true, requiresAssignedUser: true, captureFields: [],
  credentialFields: SHAPE_CREDENTIAL_FIELDS as IntegrationServiceCredentialField[],
} as unknown as IntegrationService & { credentialFields: IntegrationServiceCredentialField[] };

describe('Shape dispatch', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('SHAPE_API_KEY', 'test-company-key');
    mocks.lead.mockResolvedValue({
      id: 'lead-1', firstName: 'Jane "JJ"', lastName: 'Borrower', email: 'jane@example.com',
      assignedUserId: 'lo-1', assignedUser: { id: 'lo-1', name: 'Officer', email: 'lo@example.com' },
      vendor: { name: 'Vendor' }, campaign: null,
    });
    mocks.credential.mockResolvedValue({ values: { shapeUserId: '3' } });
    mocks.quota.mockResolvedValue(null);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{"recordId":123,"message":"Record successfully received."}', { status: 200 })));
  });
  afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

  it('posts raw Authorization, correct assignment and escaped JSON; redacts audit credentials', async () => {
    expect(await dispatchServiceToLead(service, 'lead-1')).toMatchObject({ ok: true });
    const [url, request] = vi.mocked(fetch).mock.calls[0];
    expect(url).toBe(SHAPE_ENDPOINT);
    expect(request).toMatchObject({ headers: { Authorization: 'test-company-key' }, redirect: 'error' });
    expect(JSON.parse(request!.body as string)).toMatchObject({ firstname: 'Jane "JJ"', depursLi: '3', mktentryid: 'lead-1' });
    expect(JSON.stringify(mocks.audit.mock.calls)).not.toContain('test-company-key');
  });
  it('does not send when the API key is missing', async () => {
    vi.stubEnv('SHAPE_API_KEY', '');
    expect(await dispatchServiceToLead(service, 'lead-1')).toMatchObject({ ok: false, reason: 'invalid_payload' });
    expect(fetch).not.toHaveBeenCalled();
  });
  it('does not send an unconfigured loan officer to Shape', async () => {
    mocks.credential.mockResolvedValue(null);
    expect(await dispatchServiceToLead(service, 'lead-1')).toMatchObject({ ok: false, reason: 'missing_credential' });
    expect(fetch).not.toHaveBeenCalled();
  });
  it('escapes custom merge fields and preserves assigned officer and entry ID', async () => {
    await dispatchServiceToLead({ ...service, bodyTemplate: '{"notes":"{{lead.firstName}}","depursLi":"999","mktentryid":"wrong"}' }, 'lead-1');
    expect(JSON.parse(vi.mocked(fetch).mock.calls[0][1]!.body as string)).toMatchObject({ notes: 'Jane "JJ"', depursLi: '3', mktentryid: 'lead-1' });
  });
  it('records rejected requests as failed', async () => {
    vi.mocked(fetch).mockResolvedValue(new Response('Unauthorized', { status: 401 }));
    expect(await dispatchServiceToLead(service, 'lead-1')).toMatchObject({ ok: false, reason: 'http_error', status: 401 });
  });
  it('uses the assigned user department and rejects template assignment overrides', async () => {
    mocks.credential.mockResolvedValue({values:{shapeUserId:'40',shapeAssignmentField:'depursLo'}});
    await dispatchServiceToLead({...service,bodyTemplate:'{"depursLi":"999","depursAa":"142"}'},'lead-1');
    const body=JSON.parse(vi.mocked(fetch).mock.calls[0][1]!.body as string);
    expect(body.depursLo).toBe('40');
    expect(body).not.toHaveProperty('depursLi');
    expect(body).not.toHaveProperty('depursAa');
  });
  it('does not treat an HTTP 200 error body as a successful lead creation', async () => {
    vi.mocked(fetch).mockResolvedValue(new Response('{"error":"Missing field"}', { status: 200 }));
    expect(await dispatchServiceToLead(service, 'lead-1')).toMatchObject({ ok: false, reason: 'success_string_not_found' });
  });
  it('prevents sending the company key to another endpoint', async () => {
    expect(await dispatchServiceToLead({ ...service, urlTemplate: 'https://example.com' }, 'lead-1')).toMatchObject({ ok: false });
    expect(fetch).not.toHaveBeenCalled();
  });
});
