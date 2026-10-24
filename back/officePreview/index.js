// Local, non-AI Office conversion adapter. No database access or remote file downloads.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const { pathToFileURL } = require('node:url');

const officeName = name => /^[A-Za-z0-9._-]+\.(docx?|pptx?)$/i.test(name || '');
function converterPath() {
  const candidates = [process.env.OFFICE_PREVIEW_CONVERTER,
    ...['ProgramFiles', 'ProgramFiles(x86)'].map(key => process.env[key] && path.join(process.env[key], 'LibreOffice/program/soffice.com')),
    '/usr/bin/libreoffice', '/usr/bin/soffice'].filter(Boolean);
  return candidates.find(file => fs.existsSync(file)) || '';
}
function convert(file, out, profile, executable, target = 'pdf') {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, ['-env:UserInstallation=' + pathToFileURL(profile).href,
      '--headless', '--convert-to', target, '--outdir', out, file], { windowsHide: true, stdio: 'ignore' });
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      if (process.platform === 'win32' && child.pid) {
        const killer = spawn('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
        killer.once('error', () => child.kill());
      } else child.kill('SIGKILL');
    }, 60000);
    child.once('error', () => { clearTimeout(timer); reject(new Error('CONVERTER_UNAVAILABLE')); });
    child.once('close', code => { clearTimeout(timer); !timedOut && code === 0 ? resolve() : reject(new Error(timedOut ? 'CONVERSION_TIMEOUT' : 'CONVERSION_FAILED')); });
  });
}
function createOfficePreview({ uploadDir, cacheDir, findConverter = converterPath, convertFile = convert }) {
  const jobs = new Map(), queue = [];
  let active = false, pendingBytes = 0;
  function source(name) {
    if (!officeName(name)) return null;
    try {
      const file = path.join(uploadDir, name), stat = fs.statSync(file);
      if (!stat.isFile()) return null;
      const revision = crypto.createHash('sha256').update(`${stat.size}:${stat.mtimeMs}`).digest('hex').slice(0, 24);
      return { file, size: stat.size, revision, dir: path.join(cacheDir, name, revision), name };
    } catch { return null; }
  }
  async function work() {
    if (active || !queue.length) return;
    active = true;
    const job = queue.shift();
    let temp;
    try {
      if (job.signal?.aborted) throw new Error('CANCELLED');
      temp = fs.mkdtempSync(path.join(os.tmpdir(), 'courses-office-'));
      const input = path.join(temp, job.name), out = path.join(temp, 'out');
      fs.mkdirSync(out);
      const profile = path.join(temp, 'profile');
      fs.mkdirSync(path.join(profile, 'user'), { recursive: true });
      fs.writeFileSync(path.join(profile, 'user/registrymodifications.xcu'),
        '<?xml version="1.0"?><oor:items xmlns:oor="http://openoffice.org/2001/registry"><item oor:path="/org.openoffice.Office.Common/Security/Scripting"><prop oor:name="MacroSecurityLevel" oor:op="fuse"><value>3</value></prop></item></oor:items>');
      if (job.buffer) fs.writeFileSync(input, job.buffer);
      else fs.copyFileSync(job.file, input);
      await convertFile(input, out, profile, job.executable, job.target || 'pdf');
      if (job.signal?.aborted) throw new Error('CANCELLED');
      if (job.target) {
        const converted = path.join(out, path.parse(job.name).name + '.' + job.target);
        if (fs.statSync(converted).size > 32 * 1024 * 1024) throw new Error('OUTPUT_TOO_LARGE');
        const buffer = fs.readFileSync(converted);
        if (buffer[0] !== 0x50 || buffer[1] !== 0x4b) throw new Error('CONVERSION_FAILED');
        job.resolve(buffer);
        return;
      }
      const pdf = path.join(out, path.parse(job.name).name + '.pdf');
      if (fs.statSync(pdf).size > 100 * 1024 * 1024) throw new Error('CONVERSION_FAILED');
      const fd = fs.openSync(pdf, 'r');
      const header = Buffer.alloc(5);
      try { fs.readSync(fd, header, 0, 5, 0); } finally { fs.closeSync(fd); }
      if (header.toString() !== '%PDF-') throw new Error('CONVERSION_FAILED');
      if (source(job.name)?.revision !== job.revision) throw new Error('SOURCE_CHANGED');
      fs.mkdirSync(job.dir, { recursive: true });
      fs.copyFileSync(pdf, path.join(job.dir, 'preview.pdf'));
      // Publish only after the complete copy; an interrupted copy is never treated as ready.
      fs.writeFileSync(path.join(job.dir, 'ready'), '1');
      job.status = 'ready';
    } catch (error) {
      if (job.reject) job.reject(error);
      job.status = 'failed';
      job.code = error.message === 'CONVERSION_TIMEOUT' ? 'CONVERSION_TIMEOUT' : 'CONVERSION_FAILED';
    } finally {
      if (job.buffer) { pendingBytes -= job.buffer.length; job.buffer = null; }
      if (temp) try { fs.rmSync(temp, { recursive: true, force: true, maxRetries: 3 }); } catch { /* A locked converter file must not block the queue. */ }
      active = false;
      void work();
    }
  }
  function convertLegacy(buffer, kind, signal) {
    if (!['doc', 'ppt'].includes(kind)) return Promise.reject(new Error('FORMAT_UNSUPPORTED'));
    if (!Buffer.isBuffer(buffer) || !buffer.length || buffer.length > 50 * 1024 * 1024) return Promise.reject(new Error('FILE_TOO_LARGE'));
    const executable = findConverter();
    if (!executable) return Promise.reject(new Error('CONVERTER_UNAVAILABLE'));
    if (queue.length >= 20 || pendingBytes + buffer.length > 100 * 1024 * 1024) return Promise.reject(new Error('QUEUE_FULL'));
    pendingBytes += buffer.length;
    return new Promise((resolve, reject) => {
      queue.push({ name: 'source.' + kind, target: kind + 'x', buffer, executable, signal, resolve, reject });
      void work();
    });
  }
  function prepare(name, retry = false) {
    const src = source(name);
    if (!src) return { status: 'missing' };
    if (fs.existsSync(path.join(src.dir, 'ready')) && fs.existsSync(path.join(src.dir, 'preview.pdf'))) return { status: 'ready' };
    if (src.size > 50 * 1024 * 1024) return { status: 'failed', code: 'FILE_TOO_LARGE' };
    const executable = findConverter();
    if (!executable) return { status: 'unavailable', code: 'CONVERTER_UNAVAILABLE' };
    const key = name + ':' + src.revision, previous = jobs.get(key);
    if (previous && previous.status !== 'ready' && !(retry && previous.status === 'failed')) return { status: previous.status, code: previous.code };
    if (queue.length >= 20) return { status: 'busy', code: 'QUEUE_FULL' };
    for (const [key, job] of jobs) if (jobs.size >= 200 && ['failed', 'ready'].includes(job.status)) jobs.delete(key);
    const job = { ...src, executable, status: 'preparing' };
    jobs.set(key, job); queue.push(job); void work();
    return { status: 'preparing' };
  }
  function register(app) {
    const multer = require('multer');
    const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024, files: 1, fields: 0 } }).single('file');
    app.post('/api/office/convert-legacy', (req, res) => {
      res.set('Cache-Control', 'no-store');
      upload(req, res, async error => {
        if (error) return res.status(400).json({ code: error.code === 'LIMIT_FILE_SIZE' ? 'FILE_TOO_LARGE' : 'UPLOAD_INVALID' });
        if (!req.file) return res.status(400).json({ code: 'FILE_REQUIRED' });
        const kind = path.extname(req.file.originalname).slice(1).toLowerCase();
        const controller = new AbortController();
        res.once('close', () => controller.abort());
        try {
          const buffer = await convertLegacy(req.file.buffer, kind, controller.signal);
          if (res.destroyed) return;
          res.type(kind === 'doc' ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' : 'application/vnd.openxmlformats-officedocument.presentationml.presentation').send(buffer);
        } catch (error) {
          if (res.destroyed) return;
          const code = ['CONVERTER_UNAVAILABLE', 'FILE_TOO_LARGE', 'OUTPUT_TOO_LARGE', 'QUEUE_FULL', 'FORMAT_UNSUPPORTED', 'CONVERSION_TIMEOUT'].includes(error.message) ? error.message : 'CONVERSION_FAILED';
          res.status(code === 'CONVERTER_UNAVAILABLE' ? 503 : code === 'QUEUE_FULL' ? 429 : 422).json({ code });
        }
      });
    });
    app.get('/api/attachments/:name/preview', (req, res) => {
      res.set('Cache-Control', 'no-store');
      const state = prepare(req.params.name, req.query.retry === '1');
      res.status(state.status === 'missing' ? 404 : 200).json(state);
    });
    app.get('/api/attachments/:name/preview.pdf', (req, res) => {
      const src = source(req.params.name);
      if (!src) return res.sendStatus(404);
      const pdf = path.join(src.dir, 'preview.pdf');
      if (!fs.existsSync(pdf) || !fs.existsSync(path.join(src.dir, 'ready'))) return res.sendStatus(404);
      res.set('Cache-Control', 'no-cache');
      res.type('pdf').sendFile(pdf);
    });
  }
  return { prepare, register, convertLegacy };
}
module.exports = { createOfficePreview, converterPath, officeName };
