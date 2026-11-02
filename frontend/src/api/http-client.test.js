// @ts-check
import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { installFakeFetch } from './fake-fetch.test-support.js';
import { ApiError, deleteJson, getJson, patchJson, postJson } from './http-client.js';

/** @type {import('./fake-fetch.test-support.js').FakeFetch | undefined} */
let fake;
afterEach(() => fake?.restore());

test('getJson sends GET without body and returns parsed JSON', async () => {
  fake = installFakeFetch({ body: { ok: 1 } });
  assert.deepEqual(await getJson('/api/x'), { ok: 1 });
  assert.equal(fake.calls[0].url, '/api/x');
  assert.equal(fake.calls[0].init?.method, 'GET');
  assert.equal(fake.calls[0].init?.body, undefined);
});

test('postJson and patchJson serialize the body with a JSON content type', async () => {
  fake = installFakeFetch({ body: {} });
  await postJson('/api/x', { a: 1 });
  await patchJson('/api/x', { quantity: 2 });
  assert.equal(fake.calls[0].init?.method, 'POST');
  assert.equal(fake.calls[0].init?.body, '{"a":1}');
  assert.deepEqual(fake.calls[0].init?.headers, { 'Content-Type': 'application/json' });
  assert.equal(fake.calls[1].init?.method, 'PATCH');
  assert.equal(fake.calls[1].init?.body, '{"quantity":2}');
});

test('postJson without body sends no body', async () => {
  fake = installFakeFetch({ body: {} });
  await postJson('/api/x');
  assert.equal(fake.calls[0].init?.body, undefined);
});

test('deleteJson sends DELETE', async () => {
  fake = installFakeFetch({ body: {} });
  await deleteJson('/api/x');
  assert.equal(fake.calls[0].init?.method, 'DELETE');
});

test('error envelope becomes ApiError with code, message and details', async () => {
  const details = { items: [{ productId: 1, requested: 2, available: 1 }] };
  fake = installFakeFetch({
    status: 409,
    body: { error: { code: 'INSUFFICIENT_STOCK', message: 'sem estoque', details } },
  });
  await assert.rejects(getJson('/api/x'), (err) => {
    assert.ok(err instanceof ApiError);
    assert.equal(err.status, 409);
    assert.equal(err.code, 'INSUFFICIENT_STOCK');
    assert.equal(err.message, 'sem estoque');
    assert.deepEqual(err.details, details);
    return true;
  });
});

test('error response without JSON becomes UNKNOWN_ERROR', async () => {
  fake = installFakeFetch({ status: 502, text: '<html>Bad Gateway</html>' });
  await assert.rejects(getJson('/api/x'), (err) => {
    assert.ok(err instanceof ApiError);
    assert.equal(err.status, 502);
    assert.equal(err.code, 'UNKNOWN_ERROR');
    return true;
  });
});

test('JSON without error envelope becomes UNKNOWN_ERROR', async () => {
  fake = installFakeFetch({ status: 500, body: { foo: 'bar' } });
  await assert.rejects(
    getJson('/api/x'),
    (err) => err instanceof ApiError && err.code === 'UNKNOWN_ERROR',
  );
});

test('fetch failure becomes NETWORK_ERROR', async () => {
  fake = installFakeFetch(new TypeError('fetch failed'));
  await assert.rejects(getJson('/api/x'), (err) => {
    assert.ok(err instanceof ApiError);
    assert.equal(err.status, 0);
    assert.equal(err.code, 'NETWORK_ERROR');
    return true;
  });
});

test('successful response with invalid JSON becomes UNKNOWN_ERROR', async () => {
  fake = installFakeFetch({ status: 200, text: 'not json' });
  await assert.rejects(
    getJson('/api/x'),
    (err) => err instanceof ApiError && err.code === 'UNKNOWN_ERROR',
  );
});
