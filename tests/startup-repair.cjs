const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const { spawn } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const dependencyPath = path.join(root, 'back/node_modules');

async function fixture(run) {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'courses-startup-repair-'));
  const project = path.join(parent, '中文 project (2)');
  const probe = net.createServer();
  await new Promise(resolve => probe.listen(0, '127.0.0.1', resolve));
  const port = probe.address().port;
  await new Promise(resolve => probe.close(resolve));
  let pid;
  try {
    for (const folder of ['back/officePreview', 'fronted/vendor/ocr/pdfjs', 'fronted/vendor/office'])
      fs.mkdirSync(path.join(project, folder), { recursive: true });
    fs.writeFileSync(path.join(project, 'fronted/index.html'), '<!doctype html><title>课程网站测试</title>');
    fs.writeFileSync(path.join(project, 'back/package.json'), '{}');
    fs.writeFileSync(path.join(project, 'back/officePreview/index.js'), 'exports.converterPath = () => "";');
    for (const file of ['fronted/vendor/ocr/paddleocr-js.iife.js', 'fronted/vendor/ocr/pdfjs/pdf.min.js',
      'fronted/vendor/ocr/pdfjs/pdf.worker.min.js', 'fronted/vendor/office/fflate.min.js'])
      fs.writeFileSync(path.join(project, file), 'fixture');
    const script = fs.readFileSync(path.join(root, 'start-local.ps1'), 'utf8')
      .replaceAll('127.0.0.1:3000/', `127.0.0.1:${port}/`)
      .replaceAll('Test-LoopbackPort 3000', `Test-LoopbackPort ${port}`)
      .replace('try { Start-LocalAi }', 'try { }');
    fs.writeFileSync(path.join(project, 'start-local.ps1'), script);
    fs.writeFileSync(path.join(project, 'service-control.ps1'),fs.readFileSync(path.join(root,'service-control.ps1'),'utf8').replaceAll('3000',String(port)));
    fs.copyFileSync(path.join(root,'ai-python.ps1'),path.join(project,'ai-python.ps1'));
    const launch = (args = [], dependencies = true) => new Promise((resolve, reject) => {
      const env = { ...process.env };
      delete env.NODE_OPTIONS;
      delete env.NODE_PATH;
      if (dependencies) env.NODE_PATH = dependencyPath;
      const child = spawn('powershell.exe', ['-NoLogo', '-NoProfile', '-ExecutionPolicy', 'Bypass',
        '-File', path.join(project, 'start-local.ps1'), '-NoOpen', ...args], {
        cwd: parent, env, windowsHide: true
      });
      let stdout = '', stderr = '';
      child.stdout.on('data', data => { stdout += data; });
      child.stderr.on('data', data => { stderr += data; });
      child.on('error', reject);
      const timeout = setTimeout(() => { child.kill(); reject(Error('launcher timed out')); }, 15000);
      child.on('exit', code => {
        clearTimeout(timeout);
        const match = stdout.match(/PID：(\d+)/);
        if (match) pid = Number(match[1]);
        resolve({ code, stdout, stderr });
      });
    });
    await run({ project, port, launch });
  } finally {
    if (pid) { try { process.kill(pid); } catch {} }
    await new Promise(resolve => setTimeout(resolve, 200));
    fs.rmSync(parent, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
}

test('missing backend dependencies fail preflight with an installation command', () => fixture(async ({ project, launch }) => {
  fs.writeFileSync(path.join(project, 'back/server.js'), 'throw Error("must not start");');
  const result = await launch(['-CheckOnly'], false);
  assert.equal(result.code, 1, result.stdout + result.stderr);
  assert.match(result.stdout, /Cannot find module 'express'/);
  assert.match(result.stdout, /npm.cmd ci --prefix/);
  assert.doesNotMatch(result.stdout, /检查通过/);
  assert.equal(fs.existsSync(path.join(project, 'local-backend.stdout.log')), false);
}));

test('preflight accepts installed dependencies without starting a backend', () => fixture(async ({ project, launch }) => {
  fs.writeFileSync(path.join(project, 'back/server.js'), 'throw Error("must not start");');
  const result = await launch(['-CheckOnly']);
  assert.equal(result.code, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /SQLite \/ express \/ cors \/ multer OK/);
  assert.equal(fs.existsSync(path.join(project, 'local-backend.stdout.log')), false);
}));

test('startup handles Chinese/space/parenthesis paths and reuses a verified website', () => fixture(async ({ project, port, launch }) => {
  fs.writeFileSync(path.join(project, 'back/server.js'), `
    const express = require('express');
    const path = require('path');
    const app = express();
    app.use(express.static(path.join(__dirname, '../fronted')));
    app.get('/api/courses', (req, res) => res.json([]));
    app.get('/api/local-service', (req,res)=>res.json({service:'courses-local-website',project_id:require('node:crypto').createHash('sha256').update(path.resolve(__dirname,'..').toLowerCase()).digest('hex'),pid:process.pid}));
    app.listen(${port}, '127.0.0.1', () => console.log('READY:' + process.pid));
  `);
  const result = await launch();
  assert.equal(result.code, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /已启动/);
  assert.equal((await fetch(`http://127.0.0.1:${port}/api/courses`)).status, 200);
  const before = fs.readFileSync(path.join(project, 'local-backend.stdout.log'), 'utf8');
  const again = await launch();
  assert.equal(again.code, 0, again.stdout + again.stderr);
  assert.match(again.stdout, /已经在运行/);
  assert.equal(fs.readFileSync(path.join(project, 'local-backend.stdout.log'), 'utf8'), before);
}));

test('backend exit is reported promptly and its error is retained in a log', () => fixture(async ({ project, launch }) => {
  fs.writeFileSync(path.join(project, 'back/server.js'), 'throw Error("STARTUP_FAILURE_TEST");');
  const begin = Date.now();
  const result = await launch();
  assert.equal(result.code, 1, result.stdout + result.stderr);
  assert.match(result.stdout, /后端已退出/);
  assert.match(result.stdout, /local-backend.stderr.log/);
  assert.match(fs.readFileSync(path.join(project, 'local-backend.stderr.log'), 'utf8'), /STARTUP_FAILURE_TEST/);
  assert.ok(Date.now() - begin < 10000, 'must not wait the old 60 second timeout');
}));

test('a different service on the website port is rejected', () => fixture(async ({ project, port, launch }) => {
  fs.writeFileSync(path.join(project, 'back/server.js'), 'throw Error("must not start");');
  const server = require('node:http').createServer((req, res) => res.end('unrelated server'));
  await new Promise(resolve => server.listen(port, '127.0.0.1', resolve));
  try {
    const result = await launch();
    assert.equal(result.code, 1, result.stdout + result.stderr);
    assert.match(result.stdout, /其他服务占用/);
    assert.equal(fs.existsSync(path.join(project, 'local-backend.stdout.log')), false);
  } finally { await new Promise(resolve => server.close(resolve)); }
}));
