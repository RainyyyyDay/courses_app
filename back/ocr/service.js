/*
 * OCR 门面：本地后端接收上传文件，真正识别由 provider 决定。
 *
 * mock：返回固定样例，用于先把“识别 → 校对 → 填入字段”流程跑通。
 * http：把文件转发到 PaddleOCR HTTP 服务（OCR_API_BASE/ocr）。
 *
 * 识别结果只回给本地前端做校对，不直接写数据库；用户点击填入后才进入
 * content/options/answer 字段，避免 OCR 错字直接污染复习数据。
 */
const fs = require('node:fs/promises');
const path = require('node:path');

function normalizeText(value) {
  return typeof value === 'string' ? value.replace(/\r\n/g, '\n').trim() : '';
}

function normalizeResult(payload, provider, file) {
  const source = payload && typeof payload === 'object' ? payload : {};
  const lines = Array.isArray(source.lines)
    ? source.lines.map(line => ({
        text: normalizeText(line?.text ?? line),
        confidence: Number.isFinite(Number(line?.confidence)) ? Number(line.confidence) : null,
      })).filter(line => line.text)
    : [];
  const text = normalizeText(source.text) || lines.map(line => line.text).join('\n');
  return {
    text,
    lines,
    pages: Number.isInteger(source.pages) ? source.pages : undefined,
    confidence: Number.isFinite(Number(source.confidence)) ? Number(source.confidence) : null,
    warnings: Array.isArray(source.warnings) ? source.warnings.map(String) : [],
    provider,
    file: file ? { name: file.originalname, type: file.mimetype, size: file.size } : null,
  };
}

async function mockRecognize(file) {
  const name = String(file?.originalname || '').toLowerCase();
  let text = '';
  if (name.endsWith('.txt') || name.endsWith('.md')) {
    text = await fs.readFile(file.path, 'utf8');
  }
  if (!text.trim()) {
    text = '1+1=?\nA. 1\nB. 2\nC. 3\n答案：B';
  }
  return normalizeResult({
    text,
    lines: text.split('\n').map(line => ({ text: line, confidence: 0.99 })),
    pages: 1,
    confidence: 0.99,
    warnings: ['这是 mock OCR 结果，用于验证校对和填入流程。'],
  }, 'mock', file);
}

async function httpRecognize(file) {
  const base = String(process.env.OCR_API_BASE || 'http://127.0.0.1:8001').replace(/\/+$/, '');
  const buffer = await fs.readFile(file.path);
  const form = new FormData();
  form.append('file', new Blob([buffer], { type: file.mimetype || 'application/octet-stream' }), file.originalname || path.basename(file.path));
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 60000);
  try {
    const response = await fetch(`${base}/ocr`, { method: 'POST', body: form, signal: controller.signal });
    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      throw Object.assign(new Error(payload?.message || `OCR HTTP ${response.status}`), {
        status: 502, code: 'OCR_UNAVAILABLE',
      });
    }
    if (!payload || typeof payload !== 'object') {
      throw Object.assign(new Error('OCR 返回格式不正确'), { status: 502, code: 'OCR_INVALID_RESULT' });
    }
    return normalizeResult(payload, 'paddle', file);
  } catch (err) {
    if (err.name === 'AbortError') throw Object.assign(new Error('OCR 服务超时'), { status: 504, code: 'OCR_TIMEOUT' });
    if (err.status) throw err;
    throw Object.assign(new Error(err.message || '无法连接 OCR 服务'), { status: 502, code: 'OCR_UNAVAILABLE' });
  } finally {
    clearTimeout(timer);
  }
}

async function recognize(file) {
  if (!file) throw Object.assign(new Error('请上传要识别的文件'), { status: 400, code: 'INVALID_ARGUMENT' });
  const provider = process.env.OCR_PROVIDER || 'mock';
  return provider === 'http' ? httpRecognize(file) : mockRecognize(file);
}

module.exports = { recognize };
