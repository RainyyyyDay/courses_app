import { PaddleOCR } from '@paddleocr/paddleocr-js';

const $ = (id) => document.getElementById(id);
const state = { ocr: null, backend: null, file: null };

function setStatus(text) {
  $('status').textContent = text;
}

function lev(a, b) {
  if (a === b) return 0;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i += 1) {
    const cur = [i];
    for (let j = 1; j <= b.length; j += 1) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[b.length];
}

function cer(actual, expected) {
  const clean = (s) => String(s || '').replace(/\s+/g, '');
  const a = clean(actual);
  const b = clean(expected);
  if (!b) return null;
  return (lev(a, b) / b.length * 100).toFixed(1) + '%';
}

function updateCer() {
  const gt = $('groundTruth').value;
  $('browserCer').textContent = gt ? `错误率 ${cer($('browserText').value, gt)}` : '';
  $('serverCer').textContent = gt ? `错误率 ${cer($('serverText').value, gt)}` : '';
}

async function ensureEngine(backend) {
  if (state.ocr && state.backend === backend) return state.ocr;
  if (state.ocr && typeof state.ocr.dispose === 'function') {
    try { await state.ocr.dispose(); } catch { /* 释放失败不影响重建 */ }
  }
  state.ocr = null;
  const started = performance.now();
  setStatus(`初始化中（${backend}）。首次会下载模型，约 15MB…`);
  state.ocr = await PaddleOCR.create({
    lang: 'ch',
    ocrVersion: 'PP-OCRv5',
    textDetectionModelName: 'PP-OCRv5_mobile_det',
    textRecognitionModelName: 'PP-OCRv5_mobile_rec',
    textDetectionModelAsset: { url: '/models/PP-OCRv5_mobile_det_onnx_infer.tar' },
    textRecognitionModelAsset: { url: '/models/PP-OCRv5_mobile_rec_onnx_infer.tar' },
    ortOptions: { backend, wasmPaths: '/vendor/ort/' },
  });
  state.backend = backend;
  setStatus(`模型就绪（${backend}），初始化 ${((performance.now() - started) / 1000).toFixed(1)}s`);
  return state.ocr;
}

async function runBrowser() {
  if (!state.file) return setStatus('先选一张图片或 PDF 截图');
  const backend = $('backend').value;
  $('browserMeta').textContent = '';
  try {
    const ocr = await ensureEngine(backend);
    setStatus('浏览器端识别中…');
    const started = performance.now();
    const [result] = await ocr.predict(state.file);
    const total = ((performance.now() - started) / 1000).toFixed(2);
    const formatted = formatOcrParagraphs({ text: result.items.map(item => item.text).join('\n'),
      lines: result.items.map(item => ({ text: item.text, box: item.poly })), provider: 'browser' });
    setOcrTextResult($('browserText'), formatted);
    const providers = result.runtime?.providers?.join(', ') || backend;
    $('browserMeta').textContent = `总耗时 ${total}s · 检测 ${result.metrics.detMs.toFixed(0)}ms · 识别 ${result.metrics.recMs.toFixed(0)}ms · ${result.items.length} 行 · ${providers}`;
    setStatus('完成');
    updateCer();
  } catch (err) {
    setStatus('浏览器端失败：' + err.message);
    console.error(err);
  }
}

async function runServer() {
  if (!state.file) return setStatus('先选一张图片');
  $('serverMeta').textContent = '';
  setStatus('服务端识别中…');
  try {
    const form = new FormData();
    form.append('file', state.file);
    const started = performance.now();
    const response = await fetch('http://127.0.0.1:3000/api/ocr', { method: 'POST', body: form });
    const data = await response.json();
    const total = ((performance.now() - started) / 1000).toFixed(2);
    if (!response.ok) {
      $('serverText').value = data.message || `HTTP ${response.status}`;
      $('serverMeta').textContent = `失败 · ${total}s`;
      return;
    }
    setOcrTextResult($('serverText'), formatOcrParagraphs(data));
    $('serverMeta').textContent = `总耗时 ${total}s · 置信度 ${Math.round((data.confidence || 0) * 100)}% · ${(data.lines || []).length} 行`;
    setStatus('完成');
    updateCer();
  } catch (err) {
    $('serverText').value = '连不上 http://127.0.0.1:3000，后端没启动？';
    setStatus('服务端请求失败：' + err.message);
  }
}

$('file').addEventListener('change', (event) => {
  state.file = event.target.files?.[0] || null;
  $('fileName').textContent = state.file ? `${state.file.name} · ${(state.file.size / 1024).toFixed(0)} KB` : '未选择';
});
$('runBrowser').addEventListener('click', runBrowser);
$('runServer').addEventListener('click', runServer);
$('groundTruth').addEventListener('input', updateCer);

$('env').textContent = `WebGPU: ${'gpu' in navigator ? '支持' : '不支持'} · 跨源隔离: ${self.crossOriginIsolated ? '是' : '否'}`;

// 自动化验证用的钩子：让无头浏览器能直接喂图和取结果。
window.__trial = {
  async setFileFromUrl(url) {
    const response = await fetch(url);
    const blob = await response.blob();
    state.file = new File([blob], url.split('/').pop(), { type: blob.type || 'image/png' });
    $('fileName').textContent = `${state.file.name} · ${(state.file.size / 1024).toFixed(0)} KB`;
    return state.file.size;
  },
  async run(backend) {
    $('backend').value = backend;
    await runBrowser();
    return {
      status: $('status').textContent,
      meta: $('browserMeta').textContent,
      text: $('browserText').value,
    };
  },
};
