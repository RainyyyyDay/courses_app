const { loadConfig } = require('./config');

function loadScfConfig(env = process.env) {
  if (env.AI_PROVIDER !== undefined && env.AI_PROVIDER !== 'mock') throw new Error('SCF mock only');
  if (env.HOST !== undefined && env.HOST !== '0.0.0.0') throw new Error('Invalid SCF host');
  if (env.PORT !== undefined && env.PORT !== '9000') throw new Error('Invalid SCF port');
  if (env.NODE_ENV !== undefined && env.NODE_ENV !== 'production') throw new Error('Invalid SCF environment');
  if (env.AI_KEY_MODE !== undefined && env.AI_KEY_MODE !== 'development') throw new Error('User keys disabled');
  // Pass only non-secret tuning fields to the existing validator. Never read model keys.
  const local = { AI_PROVIDER: 'mock', NODE_ENV: 'test' };
  for (const name of ['AI_TIMEOUT_MS', 'AI_MAX_CONCURRENT', 'AI_LOG_REQUESTS', 'RATE_LIMIT_MAX', 'RATE_LIMIT_WINDOW_MS']) {
    if (env[name] !== undefined) local[name] = env[name];
  }
  const { apiKey, model, ...config } = loadConfig(local);
  return Object.freeze({ ...config, profile: 'scf-preparation', host: '0.0.0.0', port: 9000 });
}

module.exports = { loadScfConfig };
