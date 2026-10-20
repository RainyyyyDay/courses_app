/*
 * 浏览器端 OCR：paddleocr-js（官方包，ONNX Runtime Web）+ PP-OCRv5 mobile 模型，
 * 全部在用户浏览器里跑，图片不出本机、也不需要服务器算力。
 *
 * 前提：页面必须通过 http(s) 加载。file:// 下浏览器会拦掉 10MB 的 OCR 脚本、
 * 27MB 的 wasm 运行时和模型 tar，所以调用方要准备好回退服务端。
 *
 * 资源由 tools/prepare-ocr-web.cjs 生成到 fronted/vendor/ocr/（不入库）。
 */
const OCR_WEB = { script: null, engine: null, backend: null };

function ocrWebAvailable() {
  return typeof window !== 'undefined' && (location.protocol === 'http:' || location.protocol === 'https:');
}

function ocrWebAsset(path) {
  return new URL(path, document.baseURI).href;
}

function loadOcrWebScript() {
  if (globalThis.PaddleOCRWeb) return Promise.resolve();
  if (OCR_WEB.script) return OCR_WEB.script;
  OCR_WEB.script = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = ocrWebAsset('vendor/ocr/paddleocr-js.iife.js');
    script.onload = () => resolve();
    script.onerror = () => {
      OCR_WEB.script = null;
      reject(new Error('浏览器端 OCR 脚本加载失败'));
    };
    document.head.appendChild(script);
  });
  return OCR_WEB.script;
}

function getOcrWebEngine(onProgress) {
  if (OCR_WEB.engine) return Promise.resolve(OCR_WEB.engine);
  const pending = (async () => {
    onProgress?.('加载 OCR 引擎…');
    await loadOcrWebScript();
    onProgress?.('初始化模型（首次约 20MB）…');
    return globalThis.PaddleOCRWeb.PaddleOCR.create({
      lang: 'ch',
      ocrVersion: 'PP-OCRv5',
      textDetectionModelName: 'PP-OCRv5_mobile_det',
      textRecognitionModelName: 'PP-OCRv5_mobile_rec',
      textDetectionModelAsset: { url: ocrWebAsset('vendor/ocr/models/PP-OCRv5_mobile_det_onnx_infer.tar') },
      textRecognitionModelAsset: { url: ocrWebAsset('vendor/ocr/models/PP-OCRv5_mobile_rec_onnx_infer.tar') },
      ortOptions: { backend: 'auto', wasmPaths: ocrWebAsset('vendor/ocr/ort/') },
    });
  })();
  OCR_WEB.engine = pending;
  pending.catch(() => { OCR_WEB.engine = null; });
  return pending;
}

// 返回结构和后端 /api/ocr 对齐，方便两条路共用渲染代码。
async function recognizeTextInBrowser(file, onProgress) {
  if (!ocrWebAvailable()) throw new Error('页面不是通过 http 打开，浏览器端 OCR 不可用');
  if (file && /pdf/i.test(file.type || '')) throw new Error('PDF 交给服务端处理');

  const engine = await getOcrWebEngine(onProgress);
  onProgress?.('浏览器端识别中…');
  const started = performance.now();
  const [result] = await engine.predict(file);
  const items = (result?.items || []).filter((item) => (item.score ?? 1) >= 0.5 && String(item.text || '').trim());
  const text = items.map((item) => item.text).join('\n');
  const confidence = items.length
    ? items.reduce((sum, item) => sum + (item.score || 0), 0) / items.length
    : null;
  return {
    text,
    lines: items.map((item) => ({ text: item.text, confidence: item.score, box: item.poly })),
    provider: 'browser',
    confidence,
    pages: 1,
    warnings: [`浏览器端识别，用时 ${((performance.now() - started) / 1000).toFixed(1)}s`],
    elapsedMs: Math.round(performance.now() - started),
  };
}
