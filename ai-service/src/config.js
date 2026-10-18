const fs = require('node:fs');
const path = require('node:path');

function positive(value, fallback, max) {
  const n = value === undefined ? fallback : Number(value);
  if (!Number.isSafeInteger(n) || n < 1 || n > max) throw new Error('Invalid numeric configuration');
  return n;
}
function loadConfig(env = process.env, rulesPath = path.join(__dirname, '../config/classification.json')) {
  // Deliberately no production/public switch before real authentication exists.
  if (!['development', 'test', undefined].includes(env.NODE_ENV)) throw new Error('Local development only');
  if (env.HOST && env.HOST !== '127.0.0.1') throw new Error('Loopback binding required');
  if (env.AI_KEY_MODE && env.AI_KEY_MODE !== 'development') throw new Error('User API keys are not enabled');
  const provider = env.AI_PROVIDER || 'mock';
  if (!['mock', 'deepseek'].includes(provider)) throw new Error('Invalid provider');
  const rules = JSON.parse(fs.readFileSync(rulesPath, 'utf8'));
  if (typeof rules.instructions !== 'string' || !Array.isArray(rules.categories) ||
      !rules.categories.length || rules.categories.some(c => !c || !/^[a-z][a-z0-9_]{0,39}$/.test(c.id) ||
        typeof c.description !== 'string' || !Array.isArray(c.error_types) || c.error_types.some(t => typeof t !== 'string')) ||
      new Set(rules.categories.map(c => c.id)).size !== rules.categories.length ||
      !rules.categories.some(c => c.id === 'unclassified')) throw new Error('Invalid classification configuration');
  const types = rules.categories.flatMap(c => c.error_types);
  if (new Set(types).size !== types.length) throw new Error('Ambiguous error types');
  const model = env.DEEPSEEK_MODEL || 'deepseek-flash';
  if (!['deepseek-flash', 'deepseek-v4-pro'].includes(model)) throw new Error('Unsupported DeepSeek model');
  if (provider === 'deepseek' && !env.DEEPSEEK_API_KEY?.trim()) throw new Error('DeepSeek key required');
  return { provider, rules, model, apiKey: env.DEEPSEEK_API_KEY,
    port: positive(env.PORT, 3001, 65535), host: '127.0.0.1',
    timeoutMs: positive(env.AI_TIMEOUT_MS, 15000, 120000),
    rateMax: positive(env.RATE_LIMIT_MAX, 30, 10000),
    rateWindowMs: positive(env.RATE_LIMIT_WINDOW_MS, 60000, 3600000) };
}
module.exports = { loadConfig };
