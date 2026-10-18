const { MockProvider } = require('./mock');
const { DeepSeekProvider } = require('./deepseek');
function createProvider(config) {
  switch (config.provider) {
    case 'mock': return new MockProvider();
    case 'deepseek': return new DeepSeekProvider(config);
    default: throw new Error('Unsupported provider');
  }
}
module.exports = { createProvider };
