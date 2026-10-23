// Local website bridge. Fixed upstream; never forwards credentials from remote callers.
const express = require('express');
const PATHS = new Set(['/test', '/classify', '/answer-draft', '/review-suggestion', '/material-draft', '/review-feedback']);
const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);
function createLocalAiGateway({ fetchImpl = fetch, timeoutMs = 95000 } = {}) {
  const router = express.Router();
  router.use(async (req, res, next) => {
    if (req.method !== 'POST' || !PATHS.has(req.path)) return next();
    const fail = (status, error) => res.status(status).json({ error });
    res.set('Cache-Control', 'no-store');
    const host = req.headers.host || '';
    if (!LOOPBACK.has(req.socket.remoteAddress) || !/^(localhost|127\.0\.0\.1|\[::1\])(?::[0-9]+)?$/.test(host)
      || req.headers['x-forwarded-for'] || req.headers.forwarded
      || req.headers.origin && req.headers.origin !== `http://${host}`
      || req.headers['sec-fetch-site'] === 'cross-site') return fail(403, 'AI_LOCAL_ONLY');
    let body = JSON.stringify(req.body);
    if (!body || !req.is('application/json')) return fail(400, 'INVALID_INPUT');
    if (Buffer.byteLength(body) > 16384) return fail(413, 'BODY_TOO_LARGE');
    const controller = new AbortController();
    const cancel = () => { if (!res.writableEnded) controller.abort(); };
    res.on('close', cancel);
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl(`http://127.0.0.1:3002/api/ai${req.path}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'http://127.0.0.1:3002' },
        body, redirect: 'error', signal: controller.signal
      });
      let text = '', size = 0;
      const decoder = new TextDecoder();
      if (!response.body) return fail(502, 'INVALID_RESPONSE');
      for await (const chunk of response.body) {
        size += chunk.length;
        if (size > 65536) { controller.abort(); return fail(502, 'INVALID_RESPONSE'); }
        text += decoder.decode(chunk, { stream: true });
      }
      text += decoder.decode();
      let payload;
      try { payload = JSON.parse(text); } catch { return fail(502, 'INVALID_RESPONSE'); }
      if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return fail(502, 'INVALID_RESPONSE');
      if (!response.ok) {
        const code = typeof payload.error === 'string' && /^[A-Z_]{1,64}$/.test(payload.error) ? payload.error : 'AI_UNAVAILABLE';
        const details={};
        if(Number.isInteger(payload.upstream_status)&&payload.upstream_status>=100&&payload.upstream_status<=599)details.upstream_status=payload.upstream_status;
        if(typeof payload.upstream_code==='string'&&/^[0-9]{1,8}$/.test(payload.upstream_code))details.upstream_code=payload.upstream_code;
        return res.status(response.status >= 400 && response.status <= 599 ? response.status : 502).json({error:code,...details});
      }
      for (const name of ['x-ai-provider', 'x-ai-result-source', 'retry-after']) {
        const value = response.headers.get(name);
        if (value) res.set(name, value);
      }
      return res.status(response.status).json(payload);
    } catch {
      if (res.destroyed) return;
      return fail(controller.signal.aborted ? 504 : 503, controller.signal.aborted ? 'AI_TIMEOUT' : 'LOCAL_AI_UNAVAILABLE');
    } finally {
      body = null; clearTimeout(timer); res.off('close', cancel);
      if (req.body && typeof req.body === 'object') delete req.body.api_key;
    }
  });
  return router;
}
module.exports = { createLocalAiGateway };
