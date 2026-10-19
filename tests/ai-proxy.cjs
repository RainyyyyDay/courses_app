const { test } = require('node:test');
const assert = require('node:assert/strict');
const express = require('../back/node_modules/express');
const { createAiProxy, validateUpstreamBaseUrl } = require('../back/aiProxy');

async function service(t, options) {
  const app = express();
  app.use(express.json({ limit: '16kb', strict: true }));
  app.use('/api/ai', createAiProxy(options));
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  return (body = {}) => fetch(`http://127.0.0.1:${server.address().port}/api/ai/classify`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
  });
}

test('default route fails closed before any upstream request', async (t) => {
  let calls = 0;
  const request = await service(t, { fetchImpl: async () => { calls++; } });
  const response = await request();
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { error: 'AI_AUTH_NOT_CONFIGURED' });
  assert.equal(calls, 0);
});

test('authenticated mock forwarding keeps the fixed contract', async (t) => {
  let captured;
  const request = await service(t, {
    authenticate(req, res, next) { req.user = { id: 'test-user' }; next(); },
    upstreamBaseUrl: 'https://example.invalid/cloudbase',
    fetchImpl: async (url, init) => {
      captured = { url, init };
      return new Response(JSON.stringify({
        review_method: 'retry', reason: 'mock only', needs_review: true, ignored: 'not forwarded back'
      }));
    }
  });
  const input = { question: '1+1=?', student_answer: '3', error_type: 'careless' };
  const response = await request(input);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { review_method: 'retry', reason: 'mock only', needs_review: true });
  assert.equal(captured.url, 'https://example.invalid/cloudbase/api/ai/classify');
  assert.deepEqual(JSON.parse(captured.init.body), input);
});

test('an authentication hook must attach a verified user identity', async (t) => {
  let calls = 0;
  const request = await service(t, {
    authenticate(req, res, next) { next(); },
    upstreamBaseUrl: 'https://example.invalid',
    fetchImpl: async () => { calls++; }
  });
  const response = await request();
  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), { error: 'AUTH_REQUIRED' });
  assert.equal(calls, 0);
});

test('proxy rejects client-selected targets and unsafe upstream URLs', async (t) => {
  assert.throws(() => validateUpstreamBaseUrl('http://example.com'));
  assert.throws(() => validateUpstreamBaseUrl('https://user:pass@example.com'));
  let calls = 0;
  const request = await service(t, {
    authenticate(req, res, next) { req.user = { id: 'test-user' }; next(); },
    upstreamBaseUrl: 'https://example.invalid',
    fetchImpl: async () => { calls++; }
  });
  const response = await request({ question: 'x', upstream: 'https://evil.example' });
  assert.equal(response.status, 400);
  assert.equal(calls, 0);
});
