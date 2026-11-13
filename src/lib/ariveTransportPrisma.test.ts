import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const mock = vi.hoisted(() => ({
  config: vi.fn(), runtime: vi.fn(), upsert: vi.fn(), lock: vi.fn(), transaction: vi.fn(), session: vi.fn(),
  aggregate: vi.fn(), count: vi.fn(), expired: vi.fn(), remove: vi.fn(), create: vi.fn(),
}));
vi.mock('server-only', () => ({}));
vi.mock('@/lib/prisma', () => ({ prisma: {
  ariveIntegrationConfig: { findUnique: mock.config }, ariveConnectionRuntime: { findUnique: mock.runtime, upsert: mock.upsert },
  $transaction: mock.transaction,
} }));
vi.mock('@/lib/ariveCrypto', async () => import('./ariveCrypto'));
vi.mock('./ariveTransport', async () => ({ ...await vi.importActual<typeof import('./ariveTransport')>('./ariveTransport'), createAriveTransportSession: mock.session }));
import { encryptAriveCredentials } from './ariveCrypto';
import { ariveTransportFingerprint } from './ariveTransport';
import { configureAriveOperatorBudget, configureAriveTransportQuota, createPrismaAriveTransportStore, getAriveTransportMetrics, isAriveBudgetReady, sharedAriveSessionIfEnabled } from './ariveTransportPrisma';

const secret = 'synthetic-server-encryption-secret-for-tests-only';
const credentials = { clientId: 'synthetic-client', secret: 'synthetic-secret', apiKey: 'synthetic-api-key' };
beforeEach(() => {
  vi.resetAllMocks(); vi.stubEnv('NEXTAUTH_SECRET', secret); vi.stubEnv('ARIVE_SHARED_TRANSPORT_ENABLED', 'true');
  mock.config.mockResolvedValue({ encryptedCredentials: encryptAriveCredentials(JSON.stringify(credentials), secret) });
  mock.runtime.mockResolvedValue({ id: 'company', enabled: true, quotaConfirmedAt: new Date('2026-01-01'), quotaKeyFingerprint: ariveTransportFingerprint(credentials, secret, 'key'), providerRequestLimit: 100, providerWindowSeconds: 60, cooldownUntil: null });
  mock.session.mockResolvedValue(async () => ({ ok: true }));
  mock.aggregate.mockResolvedValue({ _count: { _all: 10 }, _min: { startedAt: new Date('2026-11-12T19:00:00Z') } });
  mock.count.mockResolvedValue(1); mock.expired.mockResolvedValue([]);
  mock.transaction.mockImplementation(async work => work({ $executeRaw: mock.lock, ariveConnectionRuntime: { findUnique: mock.runtime, upsert: mock.upsert },
    ariveTransportRequest: { aggregate: mock.aggregate, count: mock.count, findMany: mock.expired, deleteMany: mock.remove, create: mock.create } }));
});
afterEach(() => vi.unstubAllEnvs());

describe('shared transport deployment and quota gates', () => {
  it('does not touch new tables or credentials when the deployment gate is disabled', async () => {
    vi.stubEnv('ARIVE_SHARED_TRANSPORT_ENABLED', 'false');
    await expect(sharedAriveSessionIfEnabled(async response => response.json())).resolves.toBeNull();
    await expect(isAriveBudgetReady()).resolves.toMatchObject({ ready: false });
    await expect(sharedAriveSessionIfEnabled(async response => response.json(), { required: true })).rejects.toMatchObject({ code: 'DISABLED' });
    expect(mock.runtime).not.toHaveBeenCalled(); expect(mock.config).not.toHaveBeenCalled(); expect(mock.session).not.toHaveBeenCalled();
  });
  it('does not bypass an operator pause with an unbudgeted legacy request', async () => {
    mock.runtime.mockResolvedValue({ enabled: false });
    await expect(sharedAriveSessionIfEnabled(async response => response.json())).rejects.toMatchObject({ code: 'DISABLED' });
    await expect(sharedAriveSessionIfEnabled(async response => response.json(), { required: true })).rejects.toMatchObject({ code: 'DISABLED' });
    await expect(sharedAriveSessionIfEnabled(async response => response.json(), { provided: credentials })).rejects.toMatchObject({ code: 'DISABLED' });
    expect(mock.session).not.toHaveBeenCalled();
  });
  it('does not consider a provider quota confirmed for a different API key', async () => {
    mock.runtime.mockResolvedValue({ enabled: true, quotaConfirmedAt: new Date('2026-01-01'), quotaKeyFingerprint: 'another-key', providerRequestLimit: 100, providerWindowSeconds: 60 });
    await expect(isAriveBudgetReady()).resolves.toMatchObject({ ready: false, reason: expect.stringContaining('current API key') });
  });
  it('reports ready without making an authentication request and returns no secret metadata', async () => {
    expect(await isAriveBudgetReady()).toEqual({ ready: true, reason: null }); expect(mock.session).not.toHaveBeenCalled();
  });
  it('accepts queue readiness during a provider cooldown while ordinary readiness remains blocked', async () => {
    const now = new Date('2026-11-12T19:00:30Z'); const cooldownUntil = new Date('2026-11-12T19:02:00Z');
    const runtime = await mock.runtime(); mock.runtime.mockResolvedValue({ ...runtime, cooldownUntil });
    expect(await isAriveBudgetReady({ now: () => now })).toEqual({ ready: false, reason: 'Arive requests are paused until the provider cooldown ends.', cooldownUntil });
    expect(await isAriveBudgetReady({ now: () => now, allowCooldown: true })).toEqual({ ready: true, reason: null, cooldownUntil });
    expect(mock.session).not.toHaveBeenCalled(); expect(mock.upsert).not.toHaveBeenCalled(); expect(mock.transaction).not.toHaveBeenCalled();
  });
  it.each(['deployment disabled', 'runtime paused', 'missing credentials', 'wrong key', 'unconfirmed quota'])('queue readiness still rejects %s', async scenario => {
    const runtime = await mock.runtime();
    mock.runtime.mockResolvedValue({ ...runtime, cooldownUntil: new Date('2099-01-01') });
    if (scenario === 'deployment disabled') vi.stubEnv('ARIVE_SHARED_TRANSPORT_ENABLED', 'false');
    if (scenario === 'runtime paused') mock.runtime.mockResolvedValue({ ...runtime, enabled: false });
    if (scenario === 'missing credentials') mock.config.mockResolvedValue(null);
    if (scenario === 'wrong key') mock.runtime.mockResolvedValue({ ...runtime, quotaKeyFingerprint: 'another-key' });
    if (scenario === 'unconfirmed quota') mock.runtime.mockResolvedValue({ ...runtime, quotaConfirmedAt: null });
    expect(await isAriveBudgetReady({ allowCooldown: true })).toMatchObject({ ready: false });
    expect(mock.session).not.toHaveBeenCalled(); expect(mock.upsert).not.toHaveBeenCalled();
  });
  it('returns only a generic readiness failure when persistence fails', async () => {
    mock.config.mockRejectedValueOnce(new Error('synthetic-secret or database connection detail'));
    expect(await isAriveBudgetReady()).toEqual({ ready: false, reason: 'Arive request controls are unavailable.' });
  });
  it('uses uncached authentication for explicit credentials and requires limits for the read-only worker', async () => {
    await sharedAriveSessionIfEnabled(async response => response.json(), { provided: credentials });
    const diagnostic = mock.session.mock.calls[0][0];
    expect(diagnostic.freshAuthentication).toBe(true); await expect(diagnostic.credentials()).resolves.toEqual(credentials);
    await sharedAriveSessionIfEnabled(async response => response.json(), { required: true, readOnly: true });
    const worker = mock.session.mock.calls[1][0];
    expect(worker.readOnly).toBe(true); expect(worker.freshAuthentication).toBe(false);
    await expect(worker.credentials()).resolves.toEqual(credentials);
  });
  it('configures an explicitly confirmed quota without resetting usage or cooldown', async () => {
    const result = await configureAriveTransportQuota({ providerRequestLimit: 125, providerWindowSeconds: 60, enabled: true });
    expect(result).toEqual({ enabled: true, allowance: 100, windowSeconds: 60, deploymentActive: true });
    const update = mock.upsert.mock.calls[0][0].update;
    expect(update).toMatchObject({ allowanceSource: 'PROVIDER_CONFIRMED', providerRequestLimit: 125, providerWindowSeconds: 60, enabled: true, quotaKeyFingerprint: ariveTransportFingerprint(credentials, secret, 'key') });
    expect(update).not.toHaveProperty('cooldownUntil'); expect(update).not.toHaveProperty('encryptedAccessToken');
    expect(mock.lock.mock.calls[0][1]).toBe('arive-transport:company'); expect(mock.session).not.toHaveBeenCalled();
  });
  it('clears cached token and lease metadata when explicitly disabling shared transport', async () => {
    await configureAriveTransportQuota({ providerRequestLimit: 100, providerWindowSeconds: 60, enabled: false });
    expect(mock.upsert.mock.calls[0][0].update).toMatchObject({ enabled: false, encryptedAccessToken: null, credentialFingerprint: null, accessTokenExpiresAt: null, refreshLeaseToken: null, refreshLeaseUntil: null });
  });
  it('rejects guessed or invalid quota settings before touching credentials or persistence', async () => {
    await expect(configureAriveTransportQuota({ providerRequestLimit: 0, providerWindowSeconds: 60, enabled: true })).rejects.toThrow('provider-confirmed');
    await expect(configureAriveTransportQuota({ providerRequestLimit: 100, providerWindowSeconds: 60, enabled: 'false' as unknown as boolean })).rejects.toMatchObject({ code: 'INVALID_SETTINGS' });
    expect(mock.config).not.toHaveBeenCalled(); expect(mock.transaction).not.toHaveBeenCalled();
  });
  it('reports bounded operational counts without credentials, fingerprints, or encrypted tokens', async () => {
    const now = new Date('2026-11-12T19:00:30Z');
    const result = await getAriveTransportMetrics({ now: () => now });
    expect(result).toEqual({ checkedAt: now.toISOString(), deploymentActive: true, enabled: true, ready: true, reason: null,
      allowanceSource: 'PROVIDER_CONFIRMED', operatorRequestLimit: null,
      providerRequestLimit: 100, windowSeconds: 60, allowance: 80, used: 10, remaining: 70, activeRequests: 1, cooldownUntil: null, nextAvailableAt: null });
    expect(mock.aggregate.mock.calls[0][0].where).toEqual({ connectionId: 'company', keyFingerprint: ariveTransportFingerprint(credentials, secret, 'key'), startedAt: { gt: new Date('2026-11-12T18:59:30Z') } });
    for (const value of [credentials.apiKey, credentials.secret, secret, ariveTransportFingerprint(credentials, secret, 'key')]) expect(JSON.stringify(result)).not.toContain(value);
    expect(mock.session).not.toHaveBeenCalled();
  });
  it('shows the latest safe retry deadline and never negative remaining capacity', async () => {
    const now = new Date('2026-11-12T19:00:30Z'); const runtime = await mock.runtime();
    mock.runtime.mockResolvedValue({ ...runtime, cooldownUntil: new Date('2026-11-12T19:02:00Z') });
    mock.aggregate.mockResolvedValue({ _count: { _all: 90 }, _min: { startedAt: new Date('2026-11-12T19:00:00Z') } });
    const result = await getAriveTransportMetrics({ now: () => now });
    expect(result).toMatchObject({ ready: false, used: 90, remaining: 0, cooldownUntil: '2026-11-12T19:02:00.000Z', nextAvailableAt: '2026-11-12T19:02:00.000Z' });
  });
  it('shows saved controls before activation without touching credentials, usage or network', async () => {
    vi.stubEnv('ARIVE_SHARED_TRANSPORT_ENABLED', 'false');
    expect(await getAriveTransportMetrics()).toMatchObject({ ready: false, deploymentActive: false, used: null, allowanceSource: 'PROVIDER_CONFIRMED', providerRequestLimit: 100, allowance: 80 });
    expect(mock.runtime).toHaveBeenCalledTimes(1); expect(mock.config).not.toHaveBeenCalled();
    expect(mock.session).not.toHaveBeenCalled(); expect(mock.aggregate).not.toHaveBeenCalled();
    expect(mock.runtime.mock.calls[0][0].select).not.toHaveProperty('encryptedAccessToken');
  });
  it('cleans only a bounded expired batch outside every supported quota window', async () => {
    const now = new Date('2026-11-12T19:00:30Z'); const cutoff = new Date(now.getTime() - 31_536_000_000);
    mock.expired.mockResolvedValue([{ id: 'old-1' }, { id: 'old-2' }]);
    const request = { id: 'new', connectionId: 'company', keyFingerprint: 'synthetic-hash', kind: 'GET', startedAt: now, leaseUntil: new Date(now.getTime() + 45000), finishedAt: null, statusCode: null };
    await createPrismaAriveTransportStore().transaction(tx => tx.createRequest(request));
    expect(mock.expired).toHaveBeenCalledWith({ where: { connectionId: 'company', startedAt: { lt: cutoff }, leaseUntil: { lt: now } }, select: { id: true }, orderBy: { startedAt: 'asc' }, take: 1000 });
    expect(mock.remove).toHaveBeenCalledWith({ where: { connectionId: 'company', id: { in: ['old-1', 'old-2'] }, startedAt: { lt: cutoff }, leaseUntil: { lt: now } } });
    expect(mock.create).toHaveBeenCalledWith({ data: request });
  });
});

describe('operator-authorized capacity persistence', () => {
  it('records the actor and current key without asserting provider confirmation or resetting existing limits', async () => {
    const now = new Date('2026-11-12T20:00:00Z');
    const result = await configureAriveOperatorBudget({ requestsPerMinute: 120, enabled: true, authorizedById: 'admin-test' }, { now: () => now });
    expect(result).toEqual({ enabled: true, allowance: 120, windowSeconds: 60, deploymentActive: true, allowanceSource: 'OPERATOR_AUTHORIZED' });
    const update = mock.upsert.mock.calls[0][0].update;
    expect(update).toEqual({ enabled: true, allowanceSource: 'OPERATOR_AUTHORIZED', operatorRequestLimit: 120,
      operatorAuthorizedAt: now, operatorAuthorizedById: 'admin-test', quotaKeyFingerprint: ariveTransportFingerprint(credentials, secret, 'key'), quotaConfirmedAt: null });
    for (const untouched of ['providerRequestLimit', 'providerWindowSeconds', 'cooldownUntil', 'encryptedAccessToken']) expect(update).not.toHaveProperty(untouched);
    expect(mock.lock.mock.calls[0][1]).toBe('arive-transport:company');
    expect(mock.remove).not.toHaveBeenCalled(); expect(mock.session).not.toHaveBeenCalled(); expect(mock.create).not.toHaveBeenCalled();
  });
  it.each(['disabled', 'key rotation'])('invalidates cached authentication on %s while preserving cooldown and request history', async scenario => {
    if (scenario === 'key rotation') {
      const prior = await mock.runtime(); mock.runtime.mockResolvedValue({ ...prior, quotaKeyFingerprint: 'old-key' });
    }
    await configureAriveOperatorBudget({ requestsPerMinute: 120, enabled: scenario !== 'disabled', authorizedById: 'admin-test' });
    const update = mock.upsert.mock.calls[0][0].update;
    expect(update).toMatchObject({ encryptedAccessToken: null, accessTokenExpiresAt: null, credentialFingerprint: null, refreshLeaseToken: null, refreshLeaseUntil: null });
    expect(update).not.toHaveProperty('cooldownUntil'); expect(mock.remove).not.toHaveBeenCalled();
  });
  it.each([
    { requestsPerMinute: 9, enabled: true, authorizedById: 'admin-test' },
    { requestsPerMinute: 601, enabled: true, authorizedById: 'admin-test' },
    { requestsPerMinute: 120, enabled: true, authorizedById: '' },
    { requestsPerMinute: 120, enabled: true, authorizedById: 'invalid actor' },
    { requestsPerMinute: 120, enabled: 'true' as unknown as boolean, authorizedById: 'admin-test' },
  ])('rejects invalid capacity or actor before database access: %j', async input => {
    await expect(configureAriveOperatorBudget(input)).rejects.toThrow();
    expect(mock.config).not.toHaveBeenCalled(); expect(mock.transaction).not.toHaveBeenCalled(); expect(mock.upsert).not.toHaveBeenCalled();
  });
  it('allows an authorized operator budget without a provider confirmation and rejects key rotation', async () => {
    const prior = await mock.runtime();
    const runtime = { ...prior, allowanceSource: 'OPERATOR_AUTHORIZED', operatorRequestLimit: 120,
      operatorAuthorizedAt: new Date('2026-01-01'), operatorAuthorizedById: 'admin-test', quotaConfirmedAt: null };
    mock.runtime.mockResolvedValue(runtime);
    expect(await isAriveBudgetReady()).toEqual({ ready: true, reason: null });
    mock.runtime.mockResolvedValue({ ...runtime, quotaKeyFingerprint: 'another-key' });
    expect(await isAriveBudgetReady()).toMatchObject({ ready: false, reason: expect.stringContaining('current API key') });
    expect(mock.session).not.toHaveBeenCalled();
  });
  it.each([true, false])('reports operator capacity truthfully with deployment enabled: %s', async active => {
    vi.stubEnv('ARIVE_SHARED_TRANSPORT_ENABLED', String(active));
    const prior = await mock.runtime();
    mock.runtime.mockResolvedValue({ ...prior, allowanceSource: 'OPERATOR_AUTHORIZED', operatorRequestLimit: 120,
      operatorAuthorizedAt: new Date('2026-01-01'), operatorAuthorizedById: 'admin-test', quotaConfirmedAt: null });
    const result = await getAriveTransportMetrics();
    expect(result).toMatchObject({ deploymentActive: active, ready: active, allowanceSource: 'OPERATOR_AUTHORIZED',
      providerRequestLimit: null, operatorRequestLimit: 120, allowance: 120, windowSeconds: 60, used: active ? 10 : null, remaining: active ? 110 : null });
    for (const hidden of ['quotaConfirmedAt', 'quotaKeyFingerprint', 'operatorAuthorizedById', 'encryptedAccessToken', 'credentialFingerprint']) expect(result).not.toHaveProperty(hidden);
    expect(JSON.stringify(result)).not.toContain('synthetic'); expect(mock.session).not.toHaveBeenCalled();
    if (!active) { expect(mock.config).not.toHaveBeenCalled(); expect(mock.aggregate).not.toHaveBeenCalled(); }
  });
  it('fails safely when pre-activation migration or saved controls are unavailable', async () => {
    vi.stubEnv('ARIVE_SHARED_TRANSPORT_ENABLED', 'false'); mock.runtime.mockRejectedValue(new Error('sensitive database detail'));
    expect(await getAriveTransportMetrics()).toMatchObject({ ready: false, allowanceSource: null, operatorRequestLimit: null, reason: 'Saved Arive request controls are unavailable.' });
    expect(mock.config).not.toHaveBeenCalled(); expect(mock.session).not.toHaveBeenCalled();
  });
});
