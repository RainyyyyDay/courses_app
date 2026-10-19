const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const path = require('node:path');
const { loadScfConfig } = require('../src/scf-config');
const { loadConfig } = require('../src/config');
const { createScfPreparationApp, createApp } = require('../src/app');
const { startScfServer, validateRuntime } = require('../src/scf-server');

test('SCF configuration is fixed mock and never reads model credentials', () => {
  const env = { NODE_ENV: 'production', HOST: '0.0.0.0', PORT: '9000', AI_PROVIDER: 'mock' };
  Object.defineProperty(env, 'DEEPSEEK_API_KEY', { get() { throw Error('must not read'); } });
  Object.defineProperty(env, 'DEEPSEEK_MODEL', { get() { throw Error('must not read'); } });
  const config = loadScfConfig(env);
  assert.equal(config.provider, 'mock');
  assert.equal(config.host, '0.0.0.0');
  assert.equal(config.port, 9000);
  assert.equal('apiKey' in config, false);
  assert.equal('model' in config, false);
  assert.equal(Object.isFrozen(config), true);
  assert.equal(loadScfConfig({}).provider, 'mock');
});

test('unsafe SCF configuration and unverified runtime fail closed', () => {
  for (const env of [{ AI_PROVIDER: 'deepseek' }, { AI_PROVIDER: '' }, { PORT: '3001' },
    { HOST: '127.0.0.1' }, { NODE_ENV: 'development' }, { AI_KEY_MODE: 'user' },
    { AI_MAX_CONCURRENT: '0' }, { AI_LOG_REQUESTS: 'yes' }]) assert.throws(() => loadScfConfig(env));
  for (const version of ['22.21.0', '24.10.0', '25.0.0', 'invalid']) assert.throws(() => validateRuntime(version));
  validateRuntime('24.11.0');
  validateRuntime('24.13.0');
  assert.throws(() => createScfPreparationApp({ ...loadScfConfig({}), provider: 'deepseek' }));
});

test('cloud headers and forged identities never enable API; health is passive', async t => {
  const originalFetch = global.fetch;
  let outbound = 0;
  global.fetch = () => { outbound++; throw Error('outbound prohibited'); };
  t.after(() => { global.fetch = originalFetch; });
  const server = createScfPreparationApp(loadScfConfig({})).listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  const base = `http://127.0.0.1:${server.address().port}`;
  const headers = { Host: 'example.invalid', Origin: 'https://untrusted.invalid',
    'X-Forwarded-For': '1.2.3.4', 'X-User-ID': 'admin', Authorization: 'Bearer forged' };
  const health = await originalFetch(base + '/health', { headers });
  assert.equal(health.status, 200);
  assert.deepEqual(await health.json(), { status: 'ok', provider: 'mock', local_only: false,
    mode: 'scf-preparation', business_enabled: false });
  for (const [route, body] of [['/api/ai/classify', '{}'], ['/api/ai/classify', '{'],
    ['/api/ai/classify', JSON.stringify({ question: 'x', student_answer: 'y', error_type: 'careless', user_id: 'admin' })],
    ['/api/ai/classify?user_id=admin', '{}'], ['/api/future', '{}']]) {
    const response = await originalFetch(base + route, { method: 'POST', headers: {
      ...headers, 'Content-Type': 'application/json' }, body });
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), { error: 'AI_AUTH_NOT_CONFIGURED' });
    assert.equal(response.headers.get('cache-control'), 'no-store');
  }
  assert.equal((await originalFetch(base + '/health', { method: 'POST' })).status, 404);
  assert.equal(outbound, 0);
});

test('local guards and local health contract are unchanged', async t => {
  assert.throws(() => loadConfig({ HOST: '0.0.0.0' }));
  assert.throws(() => loadConfig({ NODE_ENV: 'production' }));
  const server = createApp(loadConfig({})).listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  const base = `http://127.0.0.1:${server.address().port}`;
  assert.deepEqual(await (await fetch(base + '/health')).json(), { status: 'ok', provider: 'mock', local_only: true });
  assert.equal((await fetch(base + '/health', { headers: { Origin: 'https://example.invalid' } })).status, 403);
});

test('configuration and port failures emit only fixed diagnostics', async t => {
  const errors = [];
  assert.equal(await startScfServer({ env: { AI_PROVIDER: 'synthetic-secret-marker' },
    error: line => errors.push(line) }), null);
  const server = await startScfServer({ env: {}, log() {}, error: line => errors.push(line) });
  assert.ok(server, 'port 9000 must be free for SCF entry tests');
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  assert.equal(server.address().address, '0.0.0.0');
  assert.equal(server.address().port, 9000);
  assert.equal(await startScfServer({ env: {}, log() {}, error: line => errors.push(line) }), null);
  assert.deepEqual(errors, ['SCF preparation failed to start', 'SCF preparation failed to start']);
});

test('actual entry process exits nonzero without exposing configuration', async () => {
  const child = spawn(process.execPath, [path.join(__dirname, '../src/scf-server.js')], {
    env: { SystemRoot: process.env.SystemRoot, PATH: process.env.PATH,
      AI_PROVIDER: 'synthetic-private-marker', DEEPSEEK_API_KEY: 'synthetic-key-marker' },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let output = '';
  child.stdout.on('data', chunk => { output += chunk; });
  child.stderr.on('data', chunk => { output += chunk; });
  const [code] = await once(child, 'close');
  assert.equal(code, 1);
  assert.equal(output.trim(), 'SCF preparation failed to start');
});
