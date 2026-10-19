const { randomUUID } = require('node:crypto');
const sources = ['input_fallback', 'provider', 'validation_fallback', 'error'];
const codes = ['AI_AUTH_NOT_CONFIGURED', 'LOCAL_ONLY', 'RATE_LIMITED', 'JSON_REQUIRED', 'INVALID_INPUT', 'INVALID_JSON',
  'BODY_TOO_LARGE', 'UNSUPPORTED_ENCODING', 'NOT_FOUND', 'INTERNAL_ERROR', 'AI_BUSY',
  'AI_AUTH_FAILED', 'AI_BALANCE_UNAVAILABLE', 'AI_UPSTREAM_RATE_LIMITED', 'AI_TIMEOUT', 'AI_UNAVAILABLE'];

function diagnostics(config, write = line => console.log(line)) {
  return (req, res, next) => {
    const requestId = randomUUID(); // Never echo an incoming trace header.
    res.set('X-Request-ID', requestId);
    const started = performance.now();
    const operation = req.method === 'GET' && req.path === '/health' ? 'health' :
      req.method === 'POST' && req.path === '/api/ai/classify' ? 'classify' : 'unknown';
    let recorded = false;
    function record(event) {
      if (recorded || !config.logRequests) return;
      recorded = true;
      // Construct an allowlist record, never serialize req/res/config/Error objects.
      const source = res.get('X-AI-Result-Source');
      const code = res.locals.aiErrorCode;
      const entry = { event, request_id: requestId, operation,
        status: event === 'finished' ? res.statusCode : null,
        duration_ms: Math.max(0, Math.round(performance.now() - started)),
        provider: ['mock', 'deepseek'].includes(config.provider) ? config.provider : 'unknown',
        result_source: sources.includes(source) ? source : null,
        error: codes.includes(code) ? code : null };
      try { write(JSON.stringify(entry)); } catch { /* Diagnostics must not break requests. */ }
    }
    res.once('finish', () => record('finished'));
    res.once('close', () => record('disconnected'));
    next();
  };
}
module.exports = { diagnostics };
