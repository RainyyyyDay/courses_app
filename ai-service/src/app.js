const express = require('express');
const { createProvider } = require('./providers');
const { DeepSeekError } = require('./providers/deepseek');
const { parseInput, hasEvidence, normalizeResult, fallback } = require('./contracts/classification');
const { diagnostics } = require('./diagnostics');
function fail(res, status, code) {
  res.locals.aiErrorCode = code;
  return res.status(status).json({ error: code });
}

function createApp(config, { provider, authenticate, logger } = {}) {
  return createApplication(config, { provider, authenticate, logger }, true);
}

// Deliberately no authentication/provider injection seam in this preparation entry.
// All API requests stay closed until a separately reviewed service authorization exists.
function createScfPreparationApp(config) {
  if (config.profile !== 'scf-preparation' || config.provider !== 'mock' ||
      config.host !== '0.0.0.0' || config.port !== 9000) throw new Error('Invalid SCF preparation profile');
  const { MockProvider } = require('./providers/mock');
  return createApplication(config, {
    provider: new MockProvider(),
    authenticate: (req, res) => fail(res, 503, 'AI_AUTH_NOT_CONFIGURED')
  }, false);
}

function createApplication(config, { provider, authenticate, logger }, localOnly) {
  const app = express();
  provider ||= createProvider(config);
  app.disable('x-powered-by');
  app.set('trust proxy', false);
  app.use(diagnostics(config, logger));
  app.use((req, res, next) => {
    res.set({ 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
    const remote = req.socket.remoteAddress;
    if (localOnly && (!['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(remote) ||
        req.headers.origin || req.headers['x-forwarded-for'] ||
        !/^(127\.0\.0\.1|localhost)(:\d+)?$/.test(req.headers.host || ''))) {
      return fail(res, 403, 'LOCAL_ONLY');
    }
    next();
  });
  app.get('/health', (req, res) => res.json(localOnly ?
    { status: 'ok', provider: config.provider, local_only: true } :
    { status: 'ok', provider: 'mock', local_only: false, mode: 'scf-preparation', business_enabled: false }));
  // Authentication seam: replace with verified user identity before any public deployment.
  app.use('/api', authenticate || ((req, res, next) => next()));
  let count = 0;
  let reset = 0;
  app.use('/api', (req, res, next) => {
    const now = Date.now();
    if (now >= reset) { reset = now + config.rateWindowMs; count = 0; }
    if (++count > config.rateMax) {
      res.set('Retry-After', String(Math.ceil((reset - now) / 1000)));
      return fail(res, 429, 'RATE_LIMITED');
    }
    next();
  });
  app.use(express.json({ limit: '16kb', strict: true, inflate: false }));
  let active = 0;
  app.post('/api/ai/classify', async (req, res) => {
    res.set('X-AI-Provider', config.provider);
    if (!req.is('application/json')) return fail(res, 415, 'JSON_REQUIRED');
    const input = parseInput(req.body);
    if (!input) return fail(res, 400, 'INVALID_INPUT');
    // Conservative evidence gate, shared by every provider. Error labels alone are insufficient.
    if (!hasEvidence(input)) {
      res.set('X-AI-Result-Source', 'input_fallback');
      return res.json(fallback());
    }
    if (active >= config.maxConcurrent) {
      res.set('X-AI-Result-Source', 'error');
      return fail(res, 503, 'AI_BUSY');
    }
    active++;
    const controller = new AbortController();
    let timer;
    const disconnect = () => controller.abort();
    res.once('close', disconnect);
    try {
      const work = Promise.resolve().then(() => provider.classify(input, config.rules, { signal: controller.signal }));
      // Release only when work actually settles, not merely when HTTP times out.
      // An uncooperative provider must not allow unlimited abandoned calls.
      const release = () => { active--; };
      work.then(release, release);
      const result = await Promise.race([
        work,
        new Promise((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(new Error('timeout')); }, config.timeoutMs); })
      ]);
      const normalized = normalizeResult(result, config.rules);
      res.set('X-AI-Result-Source', normalized ? 'provider' : 'validation_fallback');
      return res.json(normalized || fallback());
    } catch (err) {
      res.set('X-AI-Result-Source', 'error');
      if (controller.signal.aborted) return fail(res, 504, 'AI_TIMEOUT');
      if (err instanceof DeepSeekError) return fail(res, err.httpStatus, err.code);
      return fail(res, 502, 'AI_UNAVAILABLE');
    } finally { clearTimeout(timer); res.off('close', disconnect); }
  });
  app.use((req, res) => fail(res, 404, 'NOT_FOUND'));
  app.use((err, req, res, next) => {
    const status = [400, 413, 415].includes(err.status) ? err.status : 500;
    fail(res, status, { 400: 'INVALID_JSON', 413: 'BODY_TOO_LARGE', 415: 'UNSUPPORTED_ENCODING' }[status] || 'INTERNAL_ERROR');
  });
  return app;
}
module.exports = { createApp, createScfPreparationApp };
