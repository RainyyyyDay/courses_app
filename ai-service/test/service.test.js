const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { loadConfig } = require('../src/config');
const { createApp } = require('../src/app');
const { DeepSeekProvider, DeepSeekError } = require('../src/providers/deepseek');
const full = { question: '1+1=?', student_answer: '3', error_type: 'careless' };
async function service(t, overrides = {}, dependencies = {}) {
  const config = { ...loadConfig({}), ...overrides };
  const server = createApp(config, dependencies).listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  const url = `http://127.0.0.1:${server.address().port}`;
  return async (body = full, options = {}, route = '/api/ai/classify') => {
    if (options.headers?.Host) {
      return new Promise((resolve, reject) => {
        const req = http.request(url + route, { method: 'POST', headers: options.headers }, res => {
          let text = '';
          res.on('data', chunk => { text += chunk; });
          res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(text) }));
        });
        req.on('error', reject);
        req.end(JSON.stringify(body));
      });
    }
    const response = await fetch(url + route, { method: 'POST', headers: { 'Content-Type': 'application/json', ...options.headers }, body: JSON.stringify(body), ...options });
    return { status: response.status, body: await response.json(), headers: response.headers };
  };
}
test('health and mock end-to-end classification', async t => {
  const request = await service(t);
  const health = await request(undefined, { method: 'GET', body: undefined }, '/health');
  assert.equal(health.status, 200);
  assert.equal(health.body.provider, 'mock');
  for (const [error_type, method] of [['knowledge_gap', 'recall'], ['reasoning_gap', 'guided'], ['careless', 'retry'], ['unknown', 'unclassified']]) {
    const result = await request({ ...full, error_type });
    assert.equal(result.status, 200);
    assert.equal(result.headers.get('x-ai-provider'), 'mock');
    assert.equal(result.headers.get('x-ai-result-source'), 'provider');
    assert.equal(result.body.review_method, method);
    assert.equal(result.body.needs_review, true);
  }
});
test('optional or insufficient data never calls AI', async t => {
  const request = await service(t, {}, { provider: { classify() { throw Error('must not call'); } } });
  for (const input of [{}, { question: '题目' }, { error_type: 'careless' }, { ...full, question: ' ' }]) {
    const result = await request(input);
    assert.equal(result.body.review_method, 'unclassified');
    assert.equal(result.headers.get('x-ai-result-source'), 'input_fallback');
  }
});
test('input validation, JSON limits, no images or request keys', async t => {
  const request = await service(t);
  for (const input of [[], { question: 42 }, { question: null }, { image: 'x' }, { api_key: 'never-accepted' }, { question: 'x'.repeat(4001) }]) {
    assert.equal((await request(input)).status, 400);
  }
  assert.equal((await request({}, { body: '{' })).status, 400);
  assert.equal((await request({ question: 'x'.repeat(18000) })).status, 413);
  assert.equal((await request({}, { headers: { 'Content-Type': 'text/plain' } })).status, 415);
});
test('local protections, rate limit, and authentication seam', async t => {
  const request = await service(t, { rateMax: 1 });
  assert.equal((await request(full, { headers: { Origin: 'https://example.com' } })).status, 403);
  assert.equal((await request(full, { headers: { Host: 'evil.example' } })).status, 403);
  assert.equal((await request(full, { headers: { 'X-Forwarded-For': '127.0.0.1' } })).status, 403);
  assert.equal((await request()).status, 200);
  assert.equal((await request()).status, 429);
  const denied = await service(t, {}, { authenticate: (req, res) => res.status(401).json({ error: 'AUTH_REQUIRED' }) });
  assert.equal((await denied()).status, 401);
});
test('AI response whitelist, schema validation, and review gate', async t => {
  for (const output of [null, {}, { review_method: 'invented', reason: 'test', needs_review: true },
    { review_method: 'retry', reason: '', needs_review: true },
    { review_method: 'retry', reason: 'test', needs_review: 'false' }]) {
    const request = await service(t, {}, { provider: { classify: async () => output } });
    const result = await request();
    assert.equal(result.body.review_method, 'unclassified');
    assert.equal(result.headers.get('x-ai-result-source'), 'validation_fallback');
  }
  const request = await service(t, {}, { provider: { classify: async () => ({ review_method: 'retry', reason: 'test', needs_review: false, secret: 'discard' }) } });
  assert.deepEqual((await request()).body, { review_method: 'retry', reason: 'test', needs_review: true });
});
test('upstream errors are sanitized; timeout aborts provider', async t => {
  const request = await service(t, {}, { provider: { classify: async () => { throw Error('sensitive-key-and-body'); } } });
  assert.deepEqual((await request()).body, { error: 'AI_UNAVAILABLE' });
  let signal;
  const slow = await service(t, { timeoutMs: 10 }, { provider: { classify: (input, rules, options) => { signal = options.signal; return new Promise(() => {}); } } });
  const result = await slow();
  assert.equal(result.status, 504);
  assert.equal(signal.aborted, true);
});
test('config denies public/production/user keys and invalid settings', () => {
  for (const env of [{ HOST: '0.0.0.0' }, { NODE_ENV: 'production' }, { AI_KEY_MODE: 'user' }, { PORT: 'NaN' },
    { AI_PROVIDER: 'other' }, { AI_PROVIDER: 'deepseek' }, { DEEPSEEK_MODEL: 'old-model' }]) {
    assert.throws(() => loadConfig(env));
  }
});
test('editable category configuration is validated and drives classification', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-rules-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'rules.json');
  const rules = { instructions: 'test', categories: [
    { id: 'custom', description: 'custom', error_types: ['careless'] },
    { id: 'unclassified', description: 'fallback', error_types: [] }
  ] };
  fs.writeFileSync(file, JSON.stringify(rules));
  const config = loadConfig({}, file);
  const request = await service(t, config);
  assert.equal((await request()).body.review_method, 'custom');
  rules.categories.pop();
  fs.writeFileSync(file, JSON.stringify(rules));
  assert.throws(() => loadConfig({}, file));
});
test('DeepSeek official request and JSON response contract without real key', async () => {
  let captured;
  const provider = new DeepSeekProvider({ apiKey: 'fake-test-key', model: 'deepseek-flash' }, async (url, init) => {
    captured = { url, ...init };
    return new Response(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ review_method: 'retry', reason: 'test', needs_review: true }) } }] }));
  });
  const controller = new AbortController();
  assert.equal((await provider.classify(full, loadConfig({}).rules, { signal: controller.signal })).review_method, 'retry');
  assert.equal(captured.url, 'https://api.deepseek.com/chat/completions');
  assert.equal(captured.signal, controller.signal);
  assert.equal(captured.redirect, 'error');
  const body = JSON.parse(captured.body);
  assert.equal(body.model, 'deepseek-flash');
  assert.equal(body.response_format.type, 'json_object');
  assert.deepEqual(JSON.parse(body.messages[1].content), full);
  for (const response of [() => new Response('private', { status: 401 }), () => new Response('{'),
    () => new Response(JSON.stringify({ choices: [{ finish_reason: 'length' }] })),
    () => new Response('x'.repeat(65537))]) {
    const bad = new DeepSeekProvider({ apiKey: 'fake', model: 'deepseek-flash' }, async () => response());
    await assert.rejects(() => bad.classify(full, {}, { signal: controller.signal }));
  }
});
test('upstream status diagnostics never expose upstream body or key', async t => {
  for (const [upstream, status, code] of [[401, 502, 'AI_AUTH_FAILED'], [402, 503, 'AI_BALANCE_UNAVAILABLE'],
    [429, 503, 'AI_UPSTREAM_RATE_LIMITED'], [500, 502, 'AI_UNAVAILABLE']]) {
    let cancelled = false;
    const realProvider = new DeepSeekProvider({ apiKey: 'fake-test-key', model: 'deepseek-flash' }, async () =>
      new Response(new ReadableStream({ cancel() { cancelled = true; } }), { status: upstream }));
    const request = await service(t, { provider: 'deepseek' }, { provider: realProvider });
    const result = await request();
    assert.equal(result.status, status);
    assert.deepEqual(result.body, { error: code });
    assert.equal(result.headers.get('x-ai-provider'), 'deepseek');
    assert.equal(result.headers.get('x-ai-result-source'), 'error');
    assert.equal(cancelled, true);
  }
});
test('DeepSeek timeout covers response body reading, not just headers', async t => {
  let aborted = false;
  const realProvider = new DeepSeekProvider({ apiKey: 'fake-test-key', model: 'deepseek-flash' }, async (url, { signal }) => {
    const body = new ReadableStream({ start(controller) {
      signal.addEventListener('abort', () => { aborted = true; controller.error(new Error('private')); }, { once: true });
    } });
    return new Response(body);
  });
  const request = await service(t, { timeoutMs: 20 }, { provider: realProvider });
  const result = await request();
  assert.equal(result.status, 504);
  assert.deepEqual(result.body, { error: 'AI_TIMEOUT' });
  assert.equal(aborted, true);
});
