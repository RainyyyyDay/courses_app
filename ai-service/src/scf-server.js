function validateRuntime(version) {
  if (!/^24\.(\d+)\.\d+$/.test(version) || Number(version.split('.')[1]) < 11) {
    throw new Error('SCF requires verified Node 24.11 or newer Node 24');
  }
}

async function startScfServer({ env = process.env, version = process.versions.node,
  log = console.log, error = console.error } = {}) {
  try {
    validateRuntime(version);
    const { loadScfConfig } = require('./scf-config');
    const { createScfPreparationApp } = require('./app');
    const config = loadScfConfig(env);
    const server = createScfPreparationApp(config).listen(config.port, config.host);
    server.requestTimeout = 20000;
    server.headersTimeout = 10000;
    await new Promise((resolve, reject) => {
      server.once('listening', resolve);
      server.once('error', reject);
    });
    log('SCF preparation listening on 0.0.0.0:9000; mock only; business disabled');
    return server;
  } catch {
    error('SCF preparation failed to start');
    return null;
  }
}

if (require.main === module) {
  startScfServer().then(server => { if (!server) process.exitCode = 1; });
}
module.exports = { startScfServer, validateRuntime };
