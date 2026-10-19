// 无头浏览器验证：真的在浏览器里跑一遍 OCR，打印耗时/文本/错误。
// 用法：node verify.cjs [wasm|auto|webgpu]
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawn } = require('node:child_process');

const BACKEND = process.argv[2] || 'wasm';
const SAMPLE = process.argv[3] || 'small';
const URL_BASE = process.env.OCR_TRIAL_URL || 'http://127.0.0.1:8010';

async function cdp(url, viewport = [1280, 960]) {
  const chrome = [
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  ].find((candidate) => fs.existsSync(candidate));
  if (!chrome) throw new Error('没有找到 Chrome/Edge');

  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'ocr-trial-'));
  const browser = spawn(chrome, [
    '--headless=new', '--disable-gpu', '--no-sandbox', '--disable-software-rasterizer',
    '--no-first-run', '--no-default-browser-check', '--remote-debugging-port=0',
    '--user-data-dir=' + profile, `--window-size=${viewport.join(',')}`, 'about:blank',
  ], { windowsHide: true });

  const pending = new Map();
  let sequence = 0;
  let socket;

  const endpoint = await new Promise((resolve, reject) => {
    let output = '';
    const timer = setTimeout(() => reject(new Error('调试端口超时')), 20000);
    browser.stderr.on('data', (chunk) => {
      output += chunk;
      const match = output.match(/DevTools listening on (ws:\/\/\S+)/);
      if (match) { clearTimeout(timer); resolve(match[1]); }
    });
    browser.once('exit', (code) => { clearTimeout(timer); reject(new Error('浏览器提前退出 ' + code)); });
  });

  socket = new WebSocket(endpoint);
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true });
    socket.addEventListener('error', reject, { once: true });
  });

  const errors = [];
  socket.addEventListener('message', (event) => {
    const message = JSON.parse(String(event.data));
    if (message.method === 'Runtime.consoleAPICalled' && message.params.type === 'error') {
      errors.push(message.params.args.map((arg) => arg.value ?? arg.description).join(' '));
    }
    if (message.method === 'Runtime.exceptionThrown') {
      errors.push(message.params.exceptionDetails.exception?.description || 'exception');
    }
    const request = pending.get(message.id);
    if (!request) return;
    pending.delete(message.id);
    clearTimeout(request.timer);
    if (message.error) request.reject(new Error(message.error.message));
    else request.resolve(message.result);
  });

  const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
    const id = ++sequence;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error('协议超时: ' + method)); }, 240000);
    pending.set(id, { resolve, reject, timer });
    socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
  });

  const { targetInfos } = await send('Target.getTargets');
  const target = targetInfos.find((item) => item.type === 'page');
  const { sessionId } = await send('Target.attachToTarget', { targetId: target.targetId, flatten: true });
  const page = (method, params) => send(method, params, sessionId);

  await page('Runtime.enable');
  await page('Page.enable');
  await page('Emulation.setDeviceMetricsOverride', {
    width: viewport[0], height: viewport[1], deviceScaleFactor: 1, mobile: false,
  });
  await page('Page.navigate', { url });

  const evaluate = async (expression) => {
    const { result, exceptionDetails } = await page('Runtime.evaluate', {
      expression, awaitPromise: true, returnByValue: true,
    });
    if (exceptionDetails) throw new Error(exceptionDetails.exception?.description || exceptionDetails.text);
    return result.value;
  };

  return {
    evaluate,
    errors,
    async close() {
      for (const request of pending.values()) { clearTimeout(request.timer); request.reject(new Error('关闭')); }
      pending.clear();
      try { socket.close(); } catch { /* ignore */ }
      if (browser.exitCode === null) {
        await new Promise((resolve) => { browser.once('exit', resolve); browser.kill(); });
      }
      fs.rmSync(profile, { recursive: true, force: true });
    },
  };
}

(async () => {
  const session = await cdp(URL_BASE + '/trial.html');
  try {
    for (let i = 0; i < 100; i += 1) {
      if (await session.evaluate('!!window.__trial')) break;
      await new Promise((resolve) => setTimeout(resolve, 300));
    }
    console.log('env:', await session.evaluate("document.getElementById('env').textContent"));
    await session.evaluate(`window.__trial.setFileFromUrl('/samples/${SAMPLE}.png')`);
    const started = Date.now();
    const result = await session.evaluate(`window.__trial.run('${BACKEND}')`);
    console.log('elapsed(s):', ((Date.now() - started) / 1000).toFixed(1));
    console.log('status:', result.status);
    console.log('meta:', result.meta);
    console.log('text:\n' + result.text);
    if (session.errors.length) console.log('console errors:\n' + session.errors.join('\n'));
  } finally {
    await session.close();
  }
})().catch((err) => {
  console.error('FAILED:', err.message);
  process.exitCode = 1;
});
