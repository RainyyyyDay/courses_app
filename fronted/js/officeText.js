// OOXML text extraction in browser; legacy doc/ppt first use local LibreOffice conversion. No AI.
const OFFICE_TEXT = { busy: false };
function officeFileKind(file) {
  const extension = String(file?.name || '').split('.').pop().toLowerCase();
  if (['doc', 'ppt', 'docx', 'pptx'].includes(extension)) return extension;
  const type = String(file?.type || '').toLowerCase();
  if (type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') return 'docx';
  if (type === 'application/vnd.openxmlformats-officedocument.presentationml.presentation') return 'pptx';
  if (type === 'application/msword') return 'doc';
  if (type === 'application/vnd.ms-powerpoint') return 'ppt';
  return '';
}
function readOfficeArchive(buffer, kind, signal) {
  ocrCheckCancelled(signal);
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('js/officeTextWorker.js?v=20261024-office-text-26', document.baseURI));
    const finish = (error, value) => {
      clearTimeout(timer); signal?.removeEventListener('abort', cancel); worker.terminate();
      if (error) reject(error); else resolve(value);
    };
    const cancel = () => finish(new DOMException('已取消提取，原正文和已有结果未改动', 'AbortError'));
    const timer = setTimeout(() => finish(new Error('文档读取超时，请尝试拆分文档后重试')), 30000);
    signal?.addEventListener('abort', cancel, { once: true });
    worker.onmessage = event => event.data.error ? finish(new Error(event.data.error)) : finish(null, event.data.files);
    worker.onerror = event => { event.preventDefault(); finish(new Error('文档读取组件不可用，请重新运行一键启动后刷新页面')); };
    worker.postMessage({ buffer, kind }, [buffer]);
  });
}
function parseOfficeXml(files, name) {
  if (!Object.hasOwn(files, name)) throw new Error('文档内容不完整或格式不匹配，请重新另存为 .docx / .pptx 后重试');
  const xml = files[name];
  if (/<!DOCTYPE|<!ENTITY/i.test(xml)) throw new Error('文档 XML 格式不受支持，请重新另存后重试');
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  if (doc.getElementsByTagName('parsererror').length) throw new Error('文档内容损坏，无法提取文字');
  return doc;
}
function officeNamespace(node, type) {
  const ns = node.namespaceURI || '';
  return type === 'word' ? /(?:wordprocessingml\/2006\/main|wordprocessingml\/main)$/.test(ns)
    : /(?:drawingml\/2006\/main|drawingml\/main)$/.test(ns);
}
function officeNodeText(node, type) {
  if (node.nodeType !== 1) return '';
  const name = node.localName, matches = officeNamespace(node, type);
  // Deleted revisions and field instructions are not visible document text.
  if (type === 'word' && matches && ['del', 'moveFrom', 'instrText'].includes(name)) return '';
  if (matches && name === 't') return node.textContent;
  if (matches && ['br', 'cr'].includes(name)) return '\n';
  if (matches && name === 'tab') return '\t';
  let text = Array.from(node.children).map(child => officeNodeText(child, type)).join('');
  if (matches && name === 'tc') return text.trim().replace(/\n+/g, ' / ') + '\t';
  if (matches && name === 'tr') return text.trimEnd() + '\n';
  if (matches && name === 'p') text += '\n';
  return text;
}
function officeSlidePaths(files) {
  const presentation = parseOfficeXml(files, 'ppt/presentation.xml');
  const relationships = parseOfficeXml(files, 'ppt/_rels/presentation.xml.rels');
  const rels = new Map(Array.from(relationships.getElementsByTagNameNS('*', 'Relationship')).map(node => [node.getAttribute('Id'), node]));
  const paths = Array.from(presentation.getElementsByTagNameNS('*', 'sldId')).map(node => {
    const attribute = Array.from(node.attributes).find(attr => attr.localName === 'id' && /relationships$/.test(attr.namespaceURI || ''));
    const rel = rels.get(attribute?.value);
    if (!rel || !/\/slide$/.test(rel.getAttribute('Type') || '') || (rel.getAttribute('TargetMode') || '').toLowerCase() === 'external') throw new Error('PPT 页码关系不完整，请重新另存后重试');
    const target = rel.getAttribute('Target') || '';
    const resolved = new URL(target, 'https://office.invalid/ppt/presentation.xml');
    if (resolved.origin !== 'https://office.invalid' || resolved.search || resolved.hash || !/^\/ppt\/slides\/[^/]+\.xml$/.test(resolved.pathname)) throw new Error('PPT 页面路径不受支持，请重新另存后重试');
    const name = decodeURIComponent(resolved.pathname.slice(1));
    if (!Object.hasOwn(files, name)) throw new Error('PPT 页面缺失，请重新另存后重试');
    return name;
  });
  if (!paths.length) throw new Error('PPT 中没有幻灯片');
  return paths;
}
async function recognizeOfficeText(file, onProgress, options = {}) {
  let kind = officeFileKind(file);
  const legacy = kind === 'doc' || kind === 'ppt';
  if (!['doc', 'ppt', 'docx', 'pptx'].includes(kind)) throw new Error('请选择 Word 或 PPT 文档');
  if (file.size > 50 * 1024 * 1024) throw new Error('文档超过 50 MB，请拆分后再提取文字');
  if (OFFICE_TEXT.busy) throw new Error('另一个文档正在处理，请完成或取消后再试');
  OFFICE_TEXT.busy = true;
  const controller = new AbortController(), label = kind.startsWith('doc') ? 'Word' : 'PPT';
  const abort = () => controller.abort();
  options.signal?.addEventListener('abort', abort, { once: true });
  if (options.signal?.aborted) controller.abort();
  const started = performance.now();
  let ui;
  try {
    ocrCheckCancelled(controller.signal);
    if (options.interactive) ui = createPdfOcrDialog(controller, { label, range: kind.startsWith('ppt'),
      hint: (legacy ? '旧版文档会发送至本站后台自动转换，原附件保持不变。' : '') + '提取正文、标题和表格文字；不含图片里的文字、图表、公式或备注。完成后请校对，再填入正文。' });
    onProgress?.('正在读取文档…');
    let buffer;
    if (legacy) {
      const message = '正在转换旧版文档，请稍候；原附件和正文保持不变…';
      onProgress?.(message); ui?.progress(message, 0, 1);
      const form = new FormData(); form.append('file', file, file.name);
      const base = typeof API === 'string' ? API : '/api';
      let response;
      try { response = await fetch(base + '/office/convert-legacy', { method: 'POST', body: form, signal: controller.signal }); }
      catch (error) {
        if (controller.signal.aborted) throw error;
        throw new Error('无法连接旧版文档转换服务，请确认网站后端已启动；原附件和正文未改动');
      }
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        const messages = { CONVERTER_UNAVAILABLE: '旧版文档转换组件不可用，请检查 LibreOffice；原附件和正文未改动',
          CONVERSION_TIMEOUT: '旧版文档转换超时，请重试或拆分文档', QUEUE_FULL: '文档处理任务较多，请稍后重试',
          FILE_TOO_LARGE: '文档超过 50 MB，请拆分后再提取', OUTPUT_TOO_LARGE: '转换后的文档文字内容过大，请拆分后再提取' };
        throw new Error(messages[data.code] || '旧版文档转换失败，文件可能损坏、加密或服务尚未更新；原附件和正文未改动');
      }
      buffer = await response.arrayBuffer();
      if (buffer.byteLength > 32 * 1024 * 1024) throw new Error('转换后的文档过大，请拆分后再提取');
      kind += 'x';
    } else buffer = await file.arrayBuffer();
    ocrCheckCancelled(controller.signal);
    const files = await readOfficeArchive(buffer, kind, controller.signal);
    ocrCheckCancelled(controller.signal);
    const paths = kind === 'pptx' ? officeSlidePaths(files) : ['word/document.xml'];
    const selected = ui ? await ui.select(paths.length) : kind === 'pptx' && options.pages
      ? parsePdfPageRange(options.pages, paths.length) : Array.from({ length: paths.length }, (_, i) => i + 1);
    const texts = [], lines = [], empty = [];
    for (let index = 0; index < selected.length; index++) {
      // Yield between pages so cancel and progress updates remain responsive.
      await new Promise(resolve => setTimeout(resolve, 0));
      ocrCheckCancelled(controller.signal);
      const number = selected[index];
      const message = kind === 'pptx' ? `正在提取第 ${number} 页（${index + 1}/${selected.length}）…` : '正在提取 Word 正文…';
      onProgress?.(message); ui?.progress(message, index, selected.length);
      const xml = parseOfficeXml(files, paths[number - 1]);
      const text = officeNodeText(xml.documentElement, kind === 'docx' ? 'word' : 'drawing').replace(/\n{3,}/g, '\n\n').trim();
      if (text) {
        texts.push(kind === 'pptx' ? `【第 ${number} 页】\n${text}` : text);
        lines.push({ text, confidence: null, ...(kind === 'pptx' ? { page: number } : {}) });
      } else empty.push(number);
      ui?.progress(`已完成 ${index + 1}/${selected.length}`, index + 1, selected.length);
    }
    ocrCheckCancelled(controller.signal);
    if (!texts.length) throw new Error('未找到可提取的文字。若内容是图片或扫描件，请先转成 PDF 或图片，再使用识别文字');
    const warnings = [kind === 'pptx' ? `PPT 共 ${paths.length} 页，已提取所选 ${selected.length} 页` : '已提取 Word 正文、标题和表格文字',
      '图片文字、图表、公式、页眉页脚及备注未提取；复杂排版请人工校对'];
    if (legacy) warnings.unshift('已自动转换旧版文档后提取文字，原附件保持不变');
    if (empty.length) warnings.push(`第 ${empty.join('、')} 页没有可提取的文字`);
    return { text: texts.join('\n\n'), lines, provider: 'office-browser', confidence: null, pages: selected.length,
      totalPages: kind === 'pptx' ? paths.length : null, selectedPages: kind === 'pptx' ? selected : [], warnings,
      elapsedMs: Math.round(performance.now() - started) };
  } finally {
    ui?.close(); options.signal?.removeEventListener('abort', abort); OFFICE_TEXT.busy = false;
  }
}
