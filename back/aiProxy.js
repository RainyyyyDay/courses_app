const express = require('express');

const INPUT_FIELDS = ['question', 'student_answer', 'error_type', 'correct_answer', 'context'];

function error(res, status, code) {
  return res.status(status).json({ error: code });
}

function validateUpstreamBaseUrl(value) {
  if (!value) return null;
  let url;
  try { url = new URL(value); } catch { throw new Error('Invalid CloudBase AI base URL'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) {
    throw new Error('CloudBase AI base URL must be a plain HTTPS origin/path');
  }
  return url.toString().replace(/\/$/, '');
}

function parseInput(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
  if (Object.keys(body).some((key) => !INPUT_FIELDS.includes(key))) return null;
  const input = {};
  for (const field of INPUT_FIELDS) {
    if (body[field] === undefined) continue;
    if (typeof body[field] !== 'string' || body[field].length > 4000) return null;
    input[field] = body[field];
  }
  return input;
}

function createAiProxy({ authenticate, upstreamBaseUrl, fetchImpl = fetch, timeoutMs = 15000 } = {}) {
  const router = express.Router();
  const upstream = validateUpstreamBaseUrl(upstreamBaseUrl);

  router.post('/classify', (req, res, next) => {
    if (typeof authenticate !== 'function') return error(res, 503, 'AI_AUTH_NOT_CONFIGURED');
    authenticate(req, res, next);
  }, (req, res, next) => {
    // The authentication adapter must provide server-verified identity data.
    // Merely calling next() or accepting a client-supplied header is not authentication.
    if (!req.user || typeof req.user.id !== 'string' || !req.user.id) {
      return error(res, 401, 'AUTH_REQUIRED');
    }
    next();
  }, async (req, res) => {
    if (!upstream) return error(res, 503, 'AI_UPSTREAM_NOT_CONFIGURED');
    const input = parseInput(req.body);
    if (!input) return error(res, 400, 'INVALID_INPUT');

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl(`${upstream}/api/ai/classify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
        redirect: 'error',
        signal: controller.signal
      });
      const text = await response.text();
      if (text.length > 65536) return error(res, 502, 'AI_INVALID_RESPONSE');
      let payload;
      try { payload = JSON.parse(text); } catch { return error(res, 502, 'AI_INVALID_RESPONSE'); }
      if (!response.ok) return error(res, 502, 'AI_UPSTREAM_ERROR');
      if (!payload || typeof payload !== 'object' || Array.isArray(payload) ||
          typeof payload.review_method !== 'string' || typeof payload.reason !== 'string' ||
          payload.needs_review !== true) return error(res, 502, 'AI_INVALID_RESPONSE');
      res.set('Cache-Control', 'no-store');
      return res.json({
        review_method: payload.review_method,
        reason: payload.reason,
        needs_review: true
      });
    } catch (err) {
      return error(res, err && err.name === 'AbortError' ? 504 : 502,
        err && err.name === 'AbortError' ? 'AI_TIMEOUT' : 'AI_UNAVAILABLE');
    } finally {
      clearTimeout(timer);
    }
  });

  return router;
}

module.exports = { createAiProxy, parseInput, validateUpstreamBaseUrl };
