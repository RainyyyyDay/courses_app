// 试验页的本地静态服务器。
// 浏览器端 OCR 需要跨源隔离（多线程 WASM / WebGPU），所以要发 COOP/COEP 头。
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = __dirname;
const ORT_DIR = path.join(ROOT, 'node_modules', 'onnxruntime-web', 'dist');
const PORT = Number(process.env.OCR_TRIAL_PORT || 8010);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.wasm': 'application/wasm',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.tar': 'application/x-tar',
  '.txt': 'text/plain; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
};

function send(res, code, body, type = 'text/plain; charset=utf-8') {
  res.writeHead(code, { 'Content-Type': type });
  res.end(body);
}

http.createServer((req, res) => {
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  // credentialless 才能在跨源隔离的同时，让模型 tar 这类无 CORS 头的资源加载。
  res.setHeader('Cross-Origin-Embedder-Policy', 'credentialless');
  res.setHeader('Cache-Control', 'no-store');

  let urlPath;
  try {
    urlPath = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  } catch {
    return send(res, 400, 'bad request');
  }
  if (urlPath === '/') urlPath = '/trial.html';

  // Reuse the production paragraph formatter and proofreading controls.
  if (['/shared/ocrBrowser.js', '/shared/utils.js'].includes(urlPath)) {
    const shared = path.join(ROOT, '..', 'fronted', 'js', path.basename(urlPath));
    return fs.readFile(shared, (err, data) => err ? send(res, 404, 'not found') : send(res, 200, data, MIME['.js']));
  }

  let base = ROOT;
  if (urlPath.startsWith('/vendor/ort/')) {
    base = ORT_DIR;
    urlPath = urlPath.slice('/vendor/ort'.length);
  }

  const filePath = path.normalize(path.join(base, urlPath));
  if (!filePath.startsWith(base)) return send(res, 403, 'forbidden');

  fs.readFile(filePath, (err, data) => {
    if (err) return send(res, 404, `not found: ${urlPath}`);
    send(res, 200, data, MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream');
  });
}).listen(PORT, '127.0.0.1', () => {
  console.log(`OCR trial: http://127.0.0.1:${PORT}/trial.html`);
});
