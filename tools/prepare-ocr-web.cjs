// 把浏览器端 OCR 的运行时产物准备到 fronted/vendor/ocr/。
// 产物 71MB 不入库，拉下代码后跑一次：node tools/prepare-ocr-web.cjs
// 依赖缺失或模型没下载过时，会自己补齐（模型首次约 20MB）。
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const trial = path.join(root, 'ocr-trial');
const out = path.join(root, 'fronted', 'vendor', 'ocr');
const ort = path.join(trial, 'node_modules', 'onnxruntime-web', 'dist');
const models = path.join(trial, 'models');

const MODEL_BASE = 'https://paddle-model-ecology.bj.bcebos.com/paddlex/official_inference_model/paddle3.0.0';
const MODEL_FILES = [
  'PP-OCRv5_mobile_det_onnx_infer.tar',
  'PP-OCRv5_mobile_rec_onnx_infer.tar',
];

async function ensureModels() {
  fs.mkdirSync(models, { recursive: true });
  for (const name of MODEL_FILES) {
    const target = path.join(models, name);
    if (fs.existsSync(target) && fs.statSync(target).size > 1024 * 1024) continue;
    console.log(`下载模型 ${name} …`);
    const response = await fetch(`${MODEL_BASE}/${name}`);
    if (!response.ok) throw new Error(`模型下载失败 ${name}: HTTP ${response.status}`);
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.length < 1024 * 1024) throw new Error(`模型文件异常（${buffer.length} 字节）：${name}`);
    fs.writeFileSync(target, buffer);
  }
}

function sizeOf(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).reduce((sum, entry) => sum + (entry.isDirectory()
    ? sizeOf(path.join(dir, entry.name))
    : fs.statSync(path.join(dir, entry.name)).size), 0);
}

async function main() {
  if (!fs.existsSync(path.join(trial, 'node_modules', 'esbuild'))) {
    throw new Error('缺少依赖：先在 ocr-trial 目录跑一次 npm install，再执行本脚本。');
  }

  await ensureModels();

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
  // 只带两条路径用得上的：WebGPU（jsep）和纯 WASM。
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

  console.log('复制 pdf.js …');
  const pdfjsSrc = path.join(trial, 'node_modules', 'pdfjs-dist', 'build');
  const pdfjsOut = path.join(out, 'pdfjs');
  fs.mkdirSync(pdfjsOut, { recursive: true });
  for (const name of ['pdf.min.js', 'pdf.worker.min.js']) {
    const from = path.join(pdfjsSrc, name);
    if (!fs.existsSync(from)) throw new Error('缺少 pdf.js 文件: ' + name);
    fs.copyFileSync(from, path.join(pdfjsOut, name));
  }

  console.log('复制模型 …');
  for (const name of MODEL_FILES) {
    fs.copyFileSync(path.join(models, name), path.join(out, 'models', name));
  }

  console.log(`完成：${out}（约 ${(sizeOf(out) / 1024 / 1024).toFixed(1)} MB）`);
}

main().catch((err) => {
  console.error('准备失败：' + err.message);
  process.exit(1);
});
