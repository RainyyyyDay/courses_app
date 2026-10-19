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
  const request = async (body = full, options = {}, route = '/api/ai/classify') => {
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
  request.url = url;
  return request;
}
test('health and mock end-to-end classification', async t => {
  const request = await service(t);
  const health = await request(undefined, { method: 'GET', body: undefined }, '/health');
  assert.equal(health.status, 200);
  assert.equal(health.body.provider, 'mock');
  for (const [error_type, method] of [['knowledge_gap', 'cloze'], ['reasoning_gap', 'self_explain'], ['careless', 'retry'], ['unknown', 'unclassified']]) {
    const result = await request({ ...full, error_type });
    assert.equal(result.status, 200);
    assert.equal(result.headers.get('x-ai-provider'), 'mock');
    assert.equal(result.headers.get('x-ai-result-source'), 'provider');
    assert.equal(result.body.review_method, method);
    assert.equal(result.body.needs_review, true);
  }
});
test('concurrency cap rejects work before calling provider; health and fallback remain available', async t => {
  const started = Promise.withResolvers();
  const gate = Promise.withResolvers();
  let calls = 0;
  const output = { review_method: 'retry', reason: 'test', needs_review: true };
  const request = await service(t, { maxConcurrent: 1 }, { provider: { classify: async () => {
    if (++calls === 1) { started.resolve(); await gate.promise; }
    return output;
  } } });
  const pending = request();
  t.after(() => gate.resolve());
  await started.promise;
  const busy = await request();
  assert.equal(busy.status, 503);
  assert.deepEqual(busy.body, { error: 'AI_BUSY' });
  assert.equal(calls, 1);
  assert.equal((await request({})).body.review_method, 'unclassified');
  assert.equal((await request(undefined, { method: 'GET', body: undefined }, '/health')).status, 200);
  gate.resolve();
  assert.equal((await pending).status, 200);
  assert.equal((await request()).status, 200);
});
test('timed out work retains capacity until it settles even if provider ignores abort', async t => {
  const gate = Promise.withResolvers();
  let calls = 0;
  const request = await service(t, { maxConcurrent: 1, timeoutMs: 20 }, { provider: { classify: async () => {
    if (++calls === 1) await gate.promise;
    return { review_method: 'retry', reason: 'test', needs_review: true };
  } } });
  t.after(() => gate.resolve());
  assert.equal((await request()).status, 504);
  assert.equal((await request()).body.error, 'AI_BUSY');
  assert.equal(calls, 1);
  gate.resolve();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal((await request()).status, 200);
});
test('synchronous provider failure releases capacity without logging its exception', async t => {
  const request = await service(t, { maxConcurrent: 1 }, { provider: { classify() { throw Error('private'); } } });
  assert.equal((await request()).body.error, 'AI_UNAVAILABLE');
  assert.equal((await request()).body.error, 'AI_UNAVAILABLE');
});
test('client disconnect aborts pending provider work and releases capacity', async t => {
  const started = Promise.withResolvers();
  const aborted = Promise.withResolvers();
  let calls = 0;
  const request = await service(t, { maxConcurrent: 1 }, { provider: { classify(input, rules, { signal }) {
    if (++calls > 1) return Promise.resolve({ review_method: 'retry', reason: 'test', needs_review: true });
    return new Promise((resolve, reject) => {
      signal.addEventListener('abort', () => { aborted.resolve(); reject(Error('cancelled')); }, { once: true });
      started.resolve();
    });
  } } });
  const client = http.request(request.url + '/api/ai/classify', { method: 'POST', headers: { 'Content-Type': 'application/json' } });
  client.on('error', () => {});
  t.after(() => client.destroy());
  client.end(JSON.stringify(full));
  await started.promise;
  client.destroy();
  await aborted.promise;
  assert.equal((await request()).status, 200);
});
test('diagnostics contain only allowlisted metadata and server-generated request IDs', async t => {
  const lines = [];
  const marker = 'synthetic-private-marker';
  const request = await service(t, { logRequests: true, apiKey: marker }, {
    logger: line => lines.push(line),
    provider: { classify: async () => { throw Error(marker); } }
  });
  const result = await request({ ...full, context: marker }, { headers: {
    'Content-Type': 'application/json', Authorization: marker, 'X-Request-ID': marker
  } }, `/api/ai/classify?secret=${marker}`);
  assert.equal(result.status, 502);
  const id = result.headers.get('x-request-id');
  assert.match(id, /^[0-9a-f-]{36}$/);
  assert.equal(lines.length, 1);
  assert.equal(lines[0].includes(marker), false);
  const entry = JSON.parse(lines[0]);
  assert.deepEqual(Object.keys(entry).sort(), ['duration_ms', 'error', 'event', 'operation', 'provider', 'request_id', 'result_source', 'status']);
  assert.equal(entry.request_id, id);
  assert.equal(entry.error, 'AI_UNAVAILABLE');
  assert.equal(entry.operation, 'classify');
  assert.equal(entry.status, 502);
  assert.equal(entry.event, 'finished');
  assert.ok(Number.isInteger(entry.duration_ms));
  await request({}, {}, '/arbitrary-private-path');
  assert.equal(JSON.parse(lines[1]).operation, 'unknown');
  const silent = [];
  const offline = await service(t, {}, { logger: line => silent.push(line) });
  await offline();
  assert.deepEqual(silent, []);
  const brokenSink = await service(t, { logRequests: true }, { logger() { throw Error(marker); } });
  assert.equal((await brokenSink()).status, 200);
});
test('concurrency/logging config and provider factory fail closed', () => {
  const { createProvider } = require('../src/providers');
  const { MockProvider } = require('../src/providers/mock');
  assert.ok(createProvider(loadConfig({})) instanceof MockProvider);
  assert.ok(createProvider(loadConfig({ AI_PROVIDER: 'deepseek', DEEPSEEK_API_KEY: 'fake-only' })) instanceof DeepSeekProvider);
  assert.throws(() => createProvider({ provider: 'unsupported' }));
  for (const env of [{ AI_MAX_CONCURRENT: '0' }, { AI_MAX_CONCURRENT: '101' }, { AI_LOG_REQUESTS: 'yes' }]) assert.throws(() => loadConfig(env));
  assert.equal(loadConfig({ AI_LOG_REQUESTS: 'true' }).logRequests, true);
  assert.equal(loadConfig({}).maxConcurrent, 2);
});
test('task contract rejects future business fields without conflating input error type and output method', async t => {
  const request = await service(t);
  for (const field of ['review_method', 'mistake_type', 'mistakeType', 'cloze_text', 'judgment', 'resource_type', 'note_text', 'material_text']) {
    assert.equal((await request({ ...full, [field]: 'future' })).status, 400);
  }
  assert.equal((await request()).body.review_method, 'retry');
  assert.equal((await request({ ...full, error_type: 'knowledge' })).body.review_method, 'unclassified');
  const { normalizeResult, parseInput } = require('../src/contracts/classification');
  assert.equal(parseInput({ question: { text: 'nested' } }), null);
  assert.equal(normalizeResult({ review_method: 'retry', reason: 'x'.repeat(501), needs_review: true }, loadConfig({}).rules), null);
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
