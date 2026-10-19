const { loadConfig } = require('./config');
const { createApp } = require('./app');
try {
  const config = loadConfig();
  const server = createApp(config).listen(config.port, config.host, () => {
    console.log(`AI service: http://${config.host}:${config.port} (${config.provider}, local only)`);
  });
  server.requestTimeout = 20000;
  server.headersTimeout = 10000;
  server.on('error', () => { console.error('AI service failed to start'); process.exitCode = 1; });
} catch {
  console.error('Invalid AI service configuration; check .env and classification.json');
  process.exitCode = 1;
}
