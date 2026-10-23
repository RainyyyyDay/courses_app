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

// ===== PDF：文字层优先，扫描页逐页识别 =====
const OCR_WEB_PDF = { script: null, busy: false };

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
      reject(Object.assign(new Error('PDF 组件缺失，请重新运行一键启动后刷新页面'), { code: 'OCR_WEB_PDF' }));
    };
    document.head.appendChild(script);
  });
  return OCR_WEB_PDF.script;
}

function ocrCheckCancelled(signal) {
  if (signal?.aborted) throw new DOMException('已取消识别，原正文和已有结果未改动', 'AbortError');
}

function parsePdfPageRange(value, total) {
  if (!String(value || '').trim()) throw new Error('请输入页码，例如 1-5, 8, 12-15');
  const selected = new Set();
  for (const part of String(value).replace(/，/g, ',').split(',')) {
    const match = part.trim().match(/^(\d+)\s*(?:-\s*(\d+))?$/);
    if (!match) throw new Error('页码格式不正确，请使用 1-5, 8 这样的格式');
    const first = Number(match[1]), last = Number(match[2] || match[1]);
    if (first < 1 || last < first || last > total) throw new Error(`页码须在 1–${total} 之间，起始页不能大于结束页`);
    for (let page = first; page <= last; page += 1) selected.add(page);
  }
  return [...selected].sort((a, b) => a - b);
}

// 所有附件入口共用此弹窗；识别结果仅返回校对面板，不直接填入正文。
function createPdfOcrDialog(controller, options = {}) {
  const label = options.label || 'PDF';
  const dialog = document.createElement('dialog');
  dialog.className = 'pdf-ocr-dialog';
  dialog.setAttribute('aria-label', `${label} 文字提取`);
  dialog.innerHTML = `<h2>PDF 文字识别</h2>
    <p data-pdf-info role="status">正在读取 PDF 页数…</p>
    <fieldset disabled><legend>识别范围</legend>
      <label><input type="radio" name="pdfOcrScope" value="all" checked> 全部页面</label>
      <label><input type="radio" name="pdfOcrScope" value="range"> 指定页码</label>
      <input data-pdf-range aria-label="指定页码" placeholder="例如 1-5, 8, 12-15" disabled>
    </fieldset>
    <p class="pdf-ocr-hint">优先提取已有文字，扫描页逐页识别。完成后请核对，再填入正文。</p>
    <p data-pdf-error role="alert"></p>
    <progress value="0" max="1" aria-label="识别进度" hidden></progress>
    <p data-pdf-progress role="status" aria-live="polite"></p>
    <div class="pdf-ocr-actions"><button type="button" data-pdf-start disabled>开始识别</button><button type="button" data-pdf-cancel>取消</button></div>`;
  if (options.label) {
    dialog.querySelector('h2').textContent = `${label} 文字提取`;
    dialog.querySelector('[data-pdf-info]').textContent = '正在读取文档…';
    dialog.querySelector('[data-pdf-start]').textContent = '开始提取';
  }
  if (options.hint) dialog.querySelector('.pdf-ocr-hint').textContent = options.hint;
  if (options.range === false) dialog.querySelector('fieldset').hidden = true;
  document.body.append(dialog);
  const range = dialog.querySelector('[data-pdf-range]');
  dialog.addEventListener('change', () => {
    range.disabled = dialog.querySelector('input[value="all"]').checked;
    if (!range.disabled) range.focus();
  });
  let rejectSelection;
  const cancel = () => {
    controller.abort();
    dialog.querySelector('[data-pdf-progress]').textContent = '正在停止；当前页处理结束后退出，原正文不会改动。';
    dialog.querySelector('[data-pdf-cancel]').disabled = true;
    rejectSelection?.(new DOMException('已取消识别，原正文和已有结果未改动', 'AbortError'));
  };
  const abortSelection = () => rejectSelection?.(new DOMException('已取消识别，原正文和已有结果未改动', 'AbortError'));
  controller.signal.addEventListener('abort', abortSelection);
  dialog.querySelector('[data-pdf-cancel]').onclick = cancel;
  dialog.addEventListener('cancel', event => { event.preventDefault(); cancel(); });
  dialog.showModal();
  return {
    async select(total) {
      ocrCheckCancelled(controller.signal);
      dialog.querySelector('[data-pdf-info]').textContent = options.range === false ? `${label} 文档已就绪` : `${label} 共 ${total} 页`;
      dialog.querySelector('fieldset').disabled = false;
      const button = dialog.querySelector('[data-pdf-start]');
      button.disabled = false;
      return new Promise((resolve, reject) => {
        rejectSelection = reject;
        button.onclick = () => {
          try {
            const pages = dialog.querySelector('input[value="all"]').checked
              ? Array.from({ length: total }, (_, i) => i + 1) : parsePdfPageRange(range.value, total);
            dialog.querySelector('fieldset').disabled = true;
            button.disabled = true;
            button.textContent = options.label ? '提取中…' : '识别中…';
            dialog.querySelector('[data-pdf-error]').textContent = '';
            rejectSelection = null;
            resolve(pages);
          } catch (err) { dialog.querySelector('[data-pdf-error]').textContent = err.message; }
        };
      });
    },
    progress(message, done, total) {
      if (controller.signal.aborted) return;
      dialog.querySelector('[data-pdf-progress]').textContent = message;
      const bar = dialog.querySelector('progress');
      bar.hidden = false; bar.max = total; bar.value = done;
    },
    close() { controller.signal.removeEventListener('abort', abortSelection); dialog.close(); dialog.remove(); },
  };
}

async function recognizePdfInBrowser(file, onProgress, options = {}) {
  // OCR 引擎推理不可强制中断；取消时等当前页结束，不再启动下一页。
  if (OCR_WEB_PDF.busy) throw new Error('另一个 PDF 正在处理，请等待完成或取消后再试');
  OCR_WEB_PDF.busy = true;
  const controller = new AbortController();
  const externalAbort = () => controller.abort();
  options.signal?.addEventListener('abort', externalAbort, { once: true });
  if (options.signal?.aborted) controller.abort();
  let ui, loading, pdf;
  const started = performance.now();
  try {
    if (options.interactive) ui = createPdfOcrDialog(controller);
    const lib = await loadPdfJs();
    ocrCheckCancelled(controller.signal);
    loading = lib.getDocument({ data: new Uint8Array(await file.arrayBuffer()), isEvalSupported: false });
    pdf = await loading.promise;
    ocrCheckCancelled(controller.signal);
    const pages = ui ? await ui.select(pdf.numPages) : options.pages
      ? parsePdfPageRange(options.pages, pdf.numPages) : Array.from({ length: pdf.numPages }, (_, i) => i + 1);
    const lines = [], texts = [], empty = [];
    let scoreSum = 0, scoreCount = 0, textPages = 0, scannedPages = 0;
    for (let index = 0; index < pages.length; index += 1) {
      ocrCheckCancelled(controller.signal);
      const number = pages[index];
      const report = message => { onProgress?.(message); ui?.progress(message, index, pages.length); };
      report(`正在处理第 ${number} 页（${index + 1}/${pages.length}）…`);
      const page = await pdf.getPage(number);
      let canvas;
      try {
        const layer = await page.getTextContent();
        ocrCheckCancelled(controller.signal);
        let text = '';
        for (const item of layer.items || []) {
          if (typeof item.str === 'string') text += item.str + (item.hasEOL ? '\n' : ' ');
        }
        text = text.trim();
        if (text) {
          textPages += 1;
          lines.push({ text, confidence: null, page: number });
        } else {
          scannedPages += 1;
          report(`扫描页识别中：第 ${number} 页（${index + 1}/${pages.length}）…`);
          const base = page.getViewport({ scale: 1 });
          const scale = Math.min(2, Math.sqrt(6000000 / (base.width * base.height)));
          const viewport = page.getViewport({ scale });
          canvas = document.createElement('canvas');
          canvas.width = Math.ceil(viewport.width); canvas.height = Math.ceil(viewport.height);
          await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
          ocrCheckCancelled(controller.signal);
          const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
          if (!blob) throw new Error(`第 ${number} 页无法转为图片，请重试`);
          const result = await predictWithRetry(new File([blob], `page-${number}.png`, { type: 'image/png' }), report, controller.signal);
          ocrCheckCancelled(controller.signal);
          const items = (result?.items || []).filter(item => (item.score ?? 1) >= 0.5 && String(item.text || '').trim());
          text = items.map(item => item.text).join('\n');
          for (const item of items) {
            lines.push({ text: item.text, confidence: item.score, box: item.poly, page: number });
            if (Number.isFinite(item.score)) { scoreSum += item.score; scoreCount += 1; }
          }
        }
        if (text) texts.push(`【第 ${number} 页】\n${text}`); else empty.push(number);
        ui?.progress(`已完成 ${index + 1}/${pages.length} 页`, index + 1, pages.length);
      } finally { if (canvas) { canvas.width = 0; canvas.height = 0; } page.cleanup(); }
    }
    ocrCheckCancelled(controller.signal);
    if (!texts.length) throw new Error('所选页面没有识别到文字，请检查是否为空白页或换用清晰的文件');
    const warnings = [`PDF 共 ${pdf.numPages} 页，已处理 ${pages.length} 页；直接提取 ${textPages} 页，扫描识别 ${scannedPages} 页`];
    if (empty.length) warnings.push(`第 ${empty.join('、')} 页未识别到文字，请人工核对`);
    warnings.push(`用时 ${((performance.now() - started) / 1000).toFixed(1)}s`);
    return { text: texts.join('\n\n'), lines, provider: 'browser', confidence: scoreCount ? scoreSum / scoreCount : null,
      pages: pages.length, totalPages: pdf.numPages, selectedPages: pages, textPages, scannedPages, warnings, elapsedMs: Math.round(performance.now() - started) };
  } catch (err) {
    ocrCheckCancelled(controller.signal);
    throw err;
  } finally {
    try { await (pdf || loading)?.destroy(); } catch { /* cleanup only */ }
    ui?.close(); options.signal?.removeEventListener('abort', externalAbort); OCR_WEB_PDF.busy = false;
  }
}

async function predictWithRetry(input, onProgress, signal) {
  ocrCheckCancelled(signal);
  const engine = await getOcrWebEngine(onProgress);
  ocrCheckCancelled(signal);
  try {
    const [result] = await engine.predict(input);
    return result;
  } catch (err) {
    ocrCheckCancelled(signal);
    // 建图成功但首帧推理失败（多见于 WebGPU），退回 WASM 再试一次。
    console.warn('识别失败，重试 WASM：', err?.message || err);
    OCR_WEB.engine = null;
    const fallback = await createEngine('wasm', onProgress);
    OCR_WEB.engine = Promise.resolve(fallback);
    ocrCheckCancelled(signal);
    const [result] = await fallback.predict(input);
    return result;
  }
}

// 返回结构和后端 /api/ocr 对齐，方便两条路共用渲染代码。
async function recognizeTextInBrowser(file, onProgress, options = {}) {
  if (!ocrWebAvailable()) {
    throw Object.assign(new Error('页面不是通过 http 打开'), { code: 'OCR_WEB_PROTOCOL' });
  }

  ocrCheckCancelled(options.signal);
  const started = performance.now();
  const inputs = [file];
  const pages = 1;
  const warnings = [];

  if (ocrWebIsPdf(file)) return recognizePdfInBrowser(file, onProgress, options);

  const lines = [];
  const texts = [];
  let scoreSum = 0;
  let scoreCount = 0;
  for (let index = 0; index < inputs.length; index += 1) {
    if (inputs.length > 1) onProgress?.(`识别第 ${index + 1}/${inputs.length} 页…`);
    else onProgress?.('浏览器端识别中…');
    const result = await predictWithRetry(inputs[index], onProgress, options.signal);
    ocrCheckCancelled(options.signal);
    const items = (result?.items || []).filter((item) => (item.score ?? 1) >= 0.5 && String(item.text || '').trim());
    for (const item of items) {
      lines.push({ text: item.text, confidence: item.score, box: item.poly });
      texts.push(item.text);
      scoreSum += item.score || 0;
      scoreCount += 1;
    }
  }

  // 图片无结果时，由调用方决定是否回退服务端。
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
