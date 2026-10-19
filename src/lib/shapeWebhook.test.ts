import { describe, expect, it, vi } from 'vitest';
import { receiveShapeWebhook, SHAPE_WEBHOOK_MAX_BYTES } from './shapeWebhook';

const secret = 'test-secret-123456789012345678901234567890';
const request = (body = '{"mktentryid":"portal-id","status":"Contacted","extra":{"future":true}}', headers = {}) =>
  new Request('https://portal.example/api/webhooks/shape', {
    method: 'POST', body,
    headers: { 'content-type': 'application/json', 'x-webhook-secret': secret, ...headers },
  });

describe('Shape webhook capture', () => {
  it('persists the entire JSON before acknowledging and excludes credentials', async () => {
    const persist = vi.fn().mockResolvedValue('event-1');
    const response = await receiveShapeWebhook(request(undefined, { authorization: 'private', cookie: 'private' }), persist, secret);
    expect(response.status).toBe(202);
    expect(await response.json()).toEqual({ accepted: true, inboxEventId: 'event-1', processing: 'awaiting_mapping' });
    expect(persist).toHaveBeenCalledWith({
      body: { mktentryid: 'portal-id', status: 'Contacted', extra: { future: true } },
      headers: { 'content-type': 'application/json' },
    });
  });
  it.each(['', 'short'])('fails closed with missing or weak configuration', async config => {
    const persist = vi.fn();
    expect((await receiveShapeWebhook(request(), persist, config)).status).toBe(503);
    expect(persist).not.toHaveBeenCalled();
  });
  it('rejects wrong credentials without storing anything', async () => {
    const persist = vi.fn();
    expect((await receiveShapeWebhook(request(undefined, { 'x-webhook-secret': 'wrong' }), persist, secret)).status).toBe(401);
    expect(persist).not.toHaveBeenCalled();
  });
  it.each(['{', 'null', '123', '"text"'])('rejects invalid payload %s', async body => {
    const persist = vi.fn();
    expect((await receiveShapeWebhook(request(body), persist, secret)).status).toBe(400);
    expect(persist).not.toHaveBeenCalled();
  });
  it('accepts batch JSON without assuming a schema', async () => {
    const persist = vi.fn().mockResolvedValue('event-2');
    expect((await receiveShapeWebhook(request('[{"newField":123}]'), persist, secret)).status).toBe(202);
    expect(persist.mock.calls[0][0].body).toEqual([{ newField: 123 }]);
  });
  it('asks the sender to retry on storage failure', async () => {
    const persist = vi.fn().mockRejectedValue(new Error('private database details'));
    const response = await receiveShapeWebhook(request(), persist, secret);
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain('private database details');
  });
  it('rejects non-JSON content types', async () => {
    const persist = vi.fn();
    expect((await receiveShapeWebhook(request('{}', { 'content-type': 'text/plain' }), persist, secret)).status).toBe(415);
    expect(persist).not.toHaveBeenCalled();
  });
  it('limits actual streamed bytes even without a content-length header', async () => {
    const persist = vi.fn();
    expect((await receiveShapeWebhook(request(JSON.stringify({ text: 'x'.repeat(SHAPE_WEBHOOK_MAX_BYTES) })), persist, secret)).status).toBe(413);
    expect(persist).not.toHaveBeenCalled();
  });
});
