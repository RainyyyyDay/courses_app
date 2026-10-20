// 把浏览器端 OCR 的运行时产物准备到 fronted/vendor/ocr/。
// 产物不入库（体积大），拉下代码后跑一次：node tools/prepare-ocr-web.cjs
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const trial = path.join(root, 'ocr-trial');
const out = path.join(root, 'fronted', 'vendor', 'ocr');
const ort = path.join(trial, 'node_modules', 'onnxruntime-web', 'dist');
const models = path.join(trial, 'models');

fs.mkdirSync(out, { recursive: true });
fs.mkdirSync(path.join(out, 'ort'), { recursive: true });
fs.mkdirSync(path.join(out, 'models'), { recursive: true });

console.log('打包 paddleocr-js …');
execFileSync(process.execPath, [
  path.join(trial, 'node_modules', 'esbuild', 'bin', 'esbuild'),
  path.join(trial, 'src', 'web-entry.js'),
  '--bundle', '--format=iife', '--minify',
  '--platform=browser', '--external:fs', '--external:path', '--external:crypto',
  '--outfile=' + path.join(out, 'paddleocr-js.iife.js'),
], { stdio: 'inherit' });

console.log('复制 ONNX Runtime wasm …');
// 只带两条路径用得上的：WebGPU（jsep）和纯 WASM。其余变体是给 Node/WebGL 的。
const ortFiles = [
  'ort-wasm-simd-threaded.jsep.wasm',
  'ort-wasm-simd-threaded.jsep.mjs',
  'ort-wasm-simd-threaded.wasm',
  'ort-wasm-simd-threaded.mjs',
];
for (const name of ortFiles) {
  const from = path.join(ort, name);
  if (!fs.existsSync(from)) throw new Error('缺少 ORT 文件: ' + name);
  fs.copyFileSync(from, path.join(out, 'ort', name));
}

console.log('复制模型 …');
for (const name of fs.readdirSync(models)) {
  if (name.endsWith('.tar')) {
    fs.copyFileSync(path.join(models, name), path.join(out, 'models', name));
  }
}

const size = (dir) => fs.readdirSync(dir, { withFileTypes: true })
  .reduce((sum, entry) => sum + (entry.isDirectory()
    ? size(path.join(dir, entry.name))
    : fs.statSync(path.join(dir, entry.name)).size), 0);

console.log(`完成：${out}（约 ${(size(out) / 1024 / 1024).toFixed(1)} MB）`);
