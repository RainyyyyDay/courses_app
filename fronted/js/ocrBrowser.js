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

// file:// 打开时浏览器端 OCR 一定用不了，直接在页面顶部说明，别等用户点识别才踩坑。
document.addEventListener('DOMContentLoaded', () => {
  if (ocrWebAvailable() || document.getElementById('ocrProtocolBanner')) return;
  const bar = document.createElement('div');
  bar.id = 'ocrProtocolBanner';
  bar.style.cssText = [
    'position:sticky', 'top:0', 'z-index:9999', 'padding:10px 16px',
    'background:#fff4e5', 'color:#8a4b00', 'border-bottom:1px solid #f0c48a',
    'font:13px/1.6 "Microsoft YaHei",system-ui,sans-serif', 'text-align:center',
  ].join(';');
  bar.textContent = '当前是 file:// 打开，浏览器端识别不可用。请改用 http://127.0.0.1:3000/ 打开本页。';
  document.body.prepend(bar);
});

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
      reject(new Error('浏览器端 OCR 资源未安装（fronted/vendor/ocr 缺失），运行 node tools/prepare-ocr-web.cjs'));
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
    return createEngine('auto', onProgress);
  })();
  OCR_WEB.engine = pending;
  pending.catch(() => { OCR_WEB.engine = null; });
  return pending;
}

function createEngine(backend, onProgress) {
  // 页面没有跨源隔离时不能开多线程 wasm，否则 ORT 会直接报错。
  const isolated = globalThis.crossOriginIsolated === true;
  const ortOptions = { backend, wasmPaths: ocrWebAsset('vendor/ocr/ort/') };
  if (!isolated) ortOptions.numThreads = 1;
  return globalThis.PaddleOCRWeb.PaddleOCR.create({
    lang: 'ch',
    ocrVersion: 'PP-OCRv5',
    textDetectionModelName: 'PP-OCRv5_mobile_det',
    textRecognitionModelName: 'PP-OCRv5_mobile_rec',
    textDetectionModelAsset: { url: ocrWebAsset('vendor/ocr/models/PP-OCRv5_mobile_det_onnx_infer.tar') },
    textRecognitionModelAsset: { url: ocrWebAsset('vendor/ocr/models/PP-OCRv5_mobile_rec_onnx_infer.tar') },
    ortOptions,
  }).catch(async (err) => {
    // auto 会优先挑 WebGPU；显卡/驱动不给力时换纯 WASM 再来一次。
    if (backend !== 'auto') throw err;
    console.warn('WebGPU 初始化失败，改用 WASM：', err?.message || err);
    onProgress?.('WebGPU 不可用，改用 WASM 初始化…');
    return createEngine('wasm', onProgress);
  });
}

// ===== PDF：先用 pdf.js 每页渲染成图，再交给同一个识别引擎 =====
const OCR_WEB_PDF = { script: null, maxPages: 10 };

function ocrWebIsPdf(file) {
  return /pdf/i.test(file?.type || '') || /\.pdf$/i.test(file?.name || '');
}

function loadPdfJs() {
  if (globalThis.pdfjsLib) return Promise.resolve(globalThis.pdfjsLib);
  if (OCR_WEB_PDF.script) return OCR_WEB_PDF.script;
  OCR_WEB_PDF.script = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = ocrWebAsset('vendor/ocr/pdfjs/pdf.min.js');
    script.onload = () => {
      const lib = globalThis.pdfjsLib;
      if (!lib) { OCR_WEB_PDF.script = null; reject(new Error('pdf.js 加载异常')); return; }
      lib.GlobalWorkerOptions.workerSrc = ocrWebAsset('vendor/ocr/pdfjs/pdf.worker.min.js');
      resolve(lib);
    };
    script.onerror = () => {
      OCR_WEB_PDF.script = null;
      reject(Object.assign(new Error('pdf.js 资源缺失，PDF 改由服务端处理'), { code: 'OCR_WEB_PDF' }));
    };
    document.head.appendChild(script);
  });
  return OCR_WEB_PDF.script;
}

async function renderPdfToImages(file, onProgress) {
  const lib = await loadPdfJs();
  const data = new Uint8Array(await file.arrayBuffer());
  const pdf = await lib.getDocument({ data }).promise;
  const total = Math.min(pdf.numPages, OCR_WEB_PDF.maxPages);
  const images = [];
  try {
    for (let index = 1; index <= total; index += 1) {
      onProgress?.(`渲染 PDF 第 ${index}/${total} 页…`);
      const page = await pdf.getPage(index);
      const viewport = page.getViewport({ scale: 2 });
      const canvas = document.createElement('canvas');
      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);
      await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
      const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
      canvas.width = 0;
      canvas.height = 0;
      page.cleanup();
      if (blob) images.push(new File([blob], `page-${index}.png`, { type: 'image/png' }));
    }
  } finally {
    try { pdf.destroy(); } catch { /* ignore */ }
  }
  return { images, totalPages: pdf.numPages, truncated: pdf.numPages > total };
}

async function predictWithRetry(input, onProgress) {
  const engine = await getOcrWebEngine(onProgress);
  try {
    const [result] = await engine.predict(input);
    return result;
  } catch (err) {
    // 建图成功但首帧推理失败（多见于 WebGPU），退回 WASM 再试一次。
    console.warn('识别失败，重试 WASM：', err?.message || err);
    OCR_WEB.engine = null;
    const fallback = await createEngine('wasm', onProgress);
    OCR_WEB.engine = Promise.resolve(fallback);
    const [result] = await fallback.predict(input);
    return result;
  }
}

// 返回结构和后端 /api/ocr 对齐，方便两条路共用渲染代码。
async function recognizeTextInBrowser(file, onProgress) {
  if (!ocrWebAvailable()) {
    throw Object.assign(new Error('页面不是通过 http 打开'), { code: 'OCR_WEB_PROTOCOL' });
  }

  const started = performance.now();
  let inputs = [file];
  let pages = 1;
  const warnings = [];

  if (ocrWebIsPdf(file)) {
    const rendered = await renderPdfToImages(file, onProgress);
    if (!rendered.images.length) throw new Error('PDF 渲染失败');
    inputs = rendered.images;
    pages = rendered.images.length;
    if (rendered.truncated) warnings.push(`PDF 共 ${rendered.totalPages} 页，只识别了前 ${rendered.images.length} 页`);
  }

  const lines = [];
  const texts = [];
  let scoreSum = 0;
  let scoreCount = 0;
  for (let index = 0; index < inputs.length; index += 1) {
    if (inputs.length > 1) onProgress?.(`识别第 ${index + 1}/${inputs.length} 页…`);
    else onProgress?.('浏览器端识别中…');
    const result = await predictWithRetry(inputs[index], onProgress);
    const items = (result?.items || []).filter((item) => (item.score ?? 1) >= 0.5 && String(item.text || '').trim());
    for (const item of items) {
      lines.push({ text: item.text, confidence: item.score, box: item.poly });
      texts.push(item.text);
      scoreSum += item.score || 0;
      scoreCount += 1;
    }
  }

  // 整页一个字都没认出来：多半是空白页，或 PDF 字体没嵌入导致渲染成空白。
  // 交给服务端再试一次（服务端能读 PDF 文本层），比直接把空结果给用户好。
  if (!lines.length) {
    throw Object.assign(new Error('没有识别到文字（可能是空白页，或 PDF 字体未嵌入）'), { code: 'OCR_WEB_EMPTY' });
  }

  warnings.push(`浏览器端识别，用时 ${((performance.now() - started) / 1000).toFixed(1)}s`);
  return {
    text: texts.join('\n'),
    lines,
    provider: 'browser',
    confidence: scoreCount ? scoreSum / scoreCount : null,
    pages,
    warnings,
    elapsedMs: Math.round(performance.now() - started),
  };
}
