const express = require('express');
const { MockProvider } = require('./providers/mock');
const { DeepSeekProvider, DeepSeekError } = require('./providers/deepseek');
const fields = ['question', 'student_answer', 'error_type', 'correct_answer', 'context'];
const fallback = () => ({ review_method: 'unclassified', reason: '信息不足或分类结果不可靠，需要人工复核。', needs_review: true });

function createApp(config, { provider, authenticate } = {}) {
  const app = express();
  provider ||= config.provider === 'mock' ? new MockProvider() : new DeepSeekProvider(config);
  app.disable('x-powered-by');
  app.set('trust proxy', false);
  app.use((req, res, next) => {
    res.set({ 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
    const remote = req.socket.remoteAddress;
    if (!['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(remote) ||
        req.headers.origin || req.headers['x-forwarded-for'] ||
        !/^(127\.0\.0\.1|localhost)(:\d+)?$/.test(req.headers.host || '')) {
      return res.status(403).json({ error: 'LOCAL_ONLY' });
    }
    next();
  });
  app.get('/health', (req, res) => res.json({ status: 'ok', provider: config.provider, local_only: true }));
  // Authentication seam: replace with verified user identity before any public deployment.
  app.use('/api', authenticate || ((req, res, next) => next()));
  let count = 0;
  let reset = 0;
  app.use('/api', (req, res, next) => {
    const now = Date.now();
    if (now >= reset) { reset = now + config.rateWindowMs; count = 0; }
    if (++count > config.rateMax) {
      res.set('Retry-After', String(Math.ceil((reset - now) / 1000)));
      return res.status(429).json({ error: 'RATE_LIMITED' });
    }
    next();
  });
  app.use(express.json({ limit: '16kb', strict: true, inflate: false }));
  app.post('/api/ai/classify', async (req, res) => {
    res.set('X-AI-Provider', config.provider);
    if (!req.is('application/json')) return res.status(415).json({ error: 'JSON_REQUIRED' });
    const body = req.body;
    if (!body || Array.isArray(body) || typeof body !== 'object' ||
        Object.keys(body).some(k => !fields.includes(k)) ||
        Object.values(body).some(v => typeof v !== 'string' || v.length > 4000)) {
      return res.status(400).json({ error: 'INVALID_INPUT' });
    }
    const input = Object.fromEntries(Object.entries(body).map(([k, v]) => [k, v.trim()]));
    // Conservative evidence gate, shared by every provider. Error labels alone are insufficient.
    if (!input.question || !input.student_answer || !input.error_type) {
      res.set('X-AI-Result-Source', 'input_fallback');
      return res.json(fallback());
    }
    const controller = new AbortController();
    let timer;
    const disconnect = () => controller.abort();
    res.once('close', disconnect);
    try {
      const result = await Promise.race([
        provider.classify(input, config.rules, { signal: controller.signal }),
        new Promise((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(new Error('timeout')); }, config.timeoutMs); })
      ]);
      const valid = result && typeof result === 'object' && !Array.isArray(result) && config.rules.categories.some(c => c.id === result.review_method) &&
        typeof result.reason === 'string' && result.reason.trim().length > 0 && result.reason.length <= 500 &&
        typeof result.needs_review === 'boolean';
      res.set('X-AI-Result-Source', valid ? 'provider' : 'validation_fallback');
      return res.json(valid ? { review_method: result.review_method, reason: result.reason.trim(), needs_review: true } : fallback());
    } catch (err) {
      res.set('X-AI-Result-Source', 'error');
      if (controller.signal.aborted) return res.status(504).json({ error: 'AI_TIMEOUT' });
      if (err instanceof DeepSeekError) return res.status(err.httpStatus).json({ error: err.code });
      return res.status(502).json({ error: 'AI_UNAVAILABLE' });
    } finally { clearTimeout(timer); res.off('close', disconnect); }
  });
  app.use((req, res) => res.status(404).json({ error: 'NOT_FOUND' }));
  app.use((err, req, res, next) => {
    const status = [400, 413, 415].includes(err.status) ? err.status : 500;
    res.status(status).json({ error: { 400: 'INVALID_JSON', 413: 'BODY_TOO_LARGE', 415: 'UNSUPPORTED_ENCODING' }[status] || 'INTERNAL_ERROR' });
  });
  return app;
}
module.exports = { createApp };
