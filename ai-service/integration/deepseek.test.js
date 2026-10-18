const { test } = require('node:test');
const { loadConfig } = require('../src/config');
const { createApp } = require('../src/app');
const safeCodes = ['AI_AUTH_FAILED', 'AI_BALANCE_UNAVAILABLE', 'AI_UPSTREAM_RATE_LIMITED', 'AI_TIMEOUT', 'AI_UNAVAILABLE', 'AI_BUSY'];

// Separate opt-in command; npm test neither loads .env nor discovers this file.
const skip = !process.env.DEEPSEEK_API_KEY?.trim() ? 'DEEPSEEK_API_KEY is not configured' :
  process.env.AI_PROVIDER !== 'deepseek' ? 'AI_PROVIDER must be deepseek' : false;

test('real DeepSeek through local HTTP and result validation', { skip, timeout: 130000 }, async () => {
  let server;
  try {
    // Keep every normal configuration guard, including production/user-key denial.
    const config = loadConfig();
    // No provider injection, fetch stub, mock fallback, or automatic retry.
    server = createApp(config).listen(0, config.host);
    await new Promise((resolve, reject) => { server.once('listening', resolve); server.once('error', reject); });
    const base = `http://127.0.0.1:${server.address().port}`;
    const health = await fetch(base + '/health', { signal: AbortSignal.timeout(5000) });
    if (!health.ok || (await health.json()).provider !== 'deepseek') throw new Error();
    const response = await fetch(base + '/api/ai/classify', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(config.timeoutMs + 5000),
      body: JSON.stringify({ question: '1 + 1 = ?', student_answer: '3', correct_answer: '2',
        error_type: 'careless', context: 'Synthetic local integration fixture. The error type is explicitly supplied.' })
    });
    if (!response.ok) {
      // Only allow predefined local diagnostics, never a raw response or exception.
      const body = await response.json();
      const code = safeCodes.includes(body?.error) ? body.error : 'LOCAL_CHECK_FAILED';
      throw new Error(code);
    }
    if (response.headers.get('x-ai-provider') !== 'deepseek' ||
        response.headers.get('x-ai-result-source') !== 'provider') throw new Error();
    const result = await response.json();
    if (!result || Array.isArray(result) || Object.keys(result).sort().join(',') !== 'needs_review,reason,review_method' ||
        !config.rules.categories.some(c => c.id === result.review_method) ||
        typeof result.reason !== 'string' || !result.reason.trim() || result.reason.length > 500 ||
        result.needs_review !== true) throw new Error();
  } catch (err) {
    const code = safeCodes.includes(err?.message) ? err.message : 'LOCAL_CHECK_FAILED';
    throw new Error(`DeepSeek integration failed: ${code}. Check local configuration/network and retry manually.`);
  } finally {
    if (server) await new Promise(resolve => { server.close(resolve); server.closeAllConnections(); });
  }
});
