// All database and API writes run against a temporary copy, never the user's database.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const vm = require('node:vm');
const crypto = require('node:crypto');
const net = require('node:net');
const http = require('node:http');
const { spawn, spawnSync } = require('node:child_process');
const { DatabaseSync } = require('node:sqlite');

const root = path.resolve(__dirname, '..');
const source = path.join(root, 'back');
const original = path.join(source, 'data/app.db');
const digest = () => crypto.createHash('sha256').update(fs.readFileSync(original)).digest('hex');
const originalHash = fs.existsSync(original) ? digest() : null;
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'courses-regression-'));
let server;
let db;

async function testBackend() {
  fs.cpSync(path.join(source, 'db'), path.join(temp, 'db'), { recursive: true });
  fs.copyFileSync(path.join(source, 'db.js'), path.join(temp, 'db.js'));
  fs.mkdirSync(path.join(temp, 'data'));
  if (originalHash !== null) {
    fs.copyFileSync(original, path.join(temp, 'data/app.db'));
  } else {
    // A fresh checkout has no personal database. Seed an isolated v4 fixture
    // to exercise the same migration checks without creating project data.
    const seeded = spawnSync(process.execPath, ['-e', "require('./db.js')"],
      { cwd: temp, windowsHide: true, encoding: 'utf8' });
    assert.equal(seeded.status, 0, seeded.stderr);
  }
  const before = new DatabaseSync(path.join(temp, 'data/app.db'), { readOnly: true });
  const existing = before.prepare('SELECT id, name FROM courses ORDER BY id').all();
  const snapshots = before.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all().map(({ name }) => {
    const columns = before.prepare(`PRAGMA table_info("${name}")`).all().map(c => `"${c.name}"`).join(',');
    const sql = `SELECT ${columns} FROM "${name}" ORDER BY rowid`;
    return { sql, rows: before.prepare(sql).all() };
  });
  before.close();
  const store = require(path.join(temp, 'db/index.js'));
  db = store.db;
  assert.equal(db.prepare('PRAGMA user_version').get().user_version, 6);
  assert.deepEqual(db.prepare('SELECT id, name FROM courses ORDER BY id').all(), existing);
  for (const snapshot of snapshots) assert.deepEqual(db.prepare(snapshot.sql).all(), snapshot.rows);
  const course = store.createCourse('regression course');
  const parent = store.createKnowledgeNode(course.id, null, 'parent', 'folder');
  const child = store.createKnowledgeNode(course.id, parent.id, 'child', 'knowledge');
  const other = store.createKnowledgeNode(store.createCourse('other course').id, null, 'other', 'knowledge');
  const system = store.listKnowledgeTree(course.id).find(n => n.is_system);
  assert.ok(system);
  const cases = [
    ['material', store.createMaterial(course.id, 'material', '', '', [child.id], 'material body'), store.replaceMaterialNodes, store.findMaterial, store.listMaterialNodes, store.listMaterialsByNode],
    ['note', store.createNote(course.id, 'note', '', '', 'manual', [child.id], 'note body'), store.replaceNoteNodes, store.findNote, store.listNoteNodes, store.listNotesByNode],
    ['mistake', store.createMistake(course.id, 'mistake', '', 'mistake body', '', [child.id]), store.replaceMistakeNodes, store.getMistakeDetail, store.listMistakeNodes, store.listMistakesByNode]
  ];
  for (const [kind, row, replace, find, nodes, byNode] of cases) {
    assert.equal(row.content, kind + ' body');
    assert.ok(byNode(parent.id).some(r => r.id === row.id), kind + ': child resources aggregate');
    assert.throws(() => replace(row.id, [999999999], 'should rollback'));
    assert.equal(find(row.id).title, row.title, kind + ': name rolled back');
    assert.deepEqual(nodes(row.id).map(n => n.id), [child.id], kind + ': tags rolled back');
    replace(row.id, [], 'updated ' + kind);
    assert.equal(find(row.id).title, 'updated ' + kind);
    assert.ok(byNode(system.id).some(r => r.id === row.id), kind + ': unclassified resources');
  }
  const count = db.prepare('SELECT count(*) AS n FROM mistakes').get().n;
  assert.throws(() => store.createMistake(course.id, 'must rollback', '', '', '', [999999999]));
  assert.equal(db.prepare('SELECT count(*) AS n FROM mistakes').get().n, count);
  db.close();
  db = null;

  const port = await new Promise(resolve => {
    const probe = net.createServer();
    probe.listen(0, '127.0.0.1', () => {
      const selected = probe.address().port;
      probe.close(() => resolve(selected));
    });
  });
  const code = fs.readFileSync(path.join(source, 'server.js'), 'utf8').replace('app.listen(3000,', `app.listen(${port},`);
  fs.writeFileSync(path.join(temp, 'server.js'), code);
  server = spawn(process.execPath, ['server.js'], { cwd: temp, windowsHide: true,
    env: { ...process.env, NODE_PATH: path.join(source, 'node_modules') }, stdio: ['ignore', 'pipe', 'pipe'] });
  let logs = '';
  server.stdout.on('data', chunk => { logs += chunk; });
  server.stderr.on('data', chunk => { logs += chunk; });
  const base = `http://127.0.0.1:${port}/api`;
  let ready = false;
  for (let i = 0; i < 100; i++) {
    try { ready = (await fetch(base + '/courses')).ok; } catch {}
    if (ready) break;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  assert.ok(ready, logs);
  for (const [kind, row] of cases) {
    const endpoint = kind === 'mistake' ? `/mistakes/${row.id}/knowledge` : `/${kind === 'note' ? 'notes' : 'materials'}/${row.id}/nodes`;
    const field = kind === 'mistake' ? 'knowledgeIds' : 'nodeIds';
    const response = await fetch(base + endpoint, { method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ [field]: [child.id], title: 'api ' + kind }) });
    assert.equal(response.status, 200, kind + ': API tag save');
    const invalid = await fetch(base + endpoint, { method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ [field]: [other.id], title: 'must not change' }) });
    assert.equal(invalid.status, 400);
    const detail = await (await fetch(base + `/${kind === 'mistake' ? 'mistakes' : kind === 'note' ? 'notes' : 'materials'}/${row.id}`)).json();
    assert.equal(detail.title, 'api ' + kind);
  }
  for (const kind of ['materials', 'notes', 'mistakes']) {
    const form = new FormData();
    form.set('title', 'manual test');
    form.set('content', '正文保存测试');
    form.set(kind === 'mistakes' ? 'knowledgeIds' : 'nodeIds', JSON.stringify([child.id]));
    const response = await fetch(`${base}/courses/${course.id}/${kind}`, { method: 'POST', body: form });
    assert.equal(response.status, 201);
    assert.equal((await response.json()).content, '正文保存测试');
  }
  for (const kind of ['mistakes', 'assessments']) {
    const form = new FormData();
    form.set('title', 'PDF test.pdf');
    form.set('file', new Blob(['%PDF-test'], { type: 'application/pdf' }), 'test.pdf');
    const response = await fetch(`${base}/courses/${course.id}/${kind}`, { method: 'POST', body: form });
    assert.equal(response.status, 201);
    const row = await response.json();
    assert.equal(row.file_type, 'application/pdf');
    assert.ok(row.image_url || row.file_url);
    const rows = await (await fetch(`${base}/courses/${course.id}/${kind}`)).json();
    assert.equal(rows.find(r => r.id === row.id).file_type, 'application/pdf');
  }
  console.log('PASS backend: migration preserves courses, all tag APIs, rollback, body, attachments, parent aggregation, unclassified');
  return { base, course, child, other, cases };
}

async function testBrowser(data) {
  const chrome = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
  assert.ok(fs.existsSync(chrome), 'Chrome is required for browser regression');
  const front = path.join(temp, 'fronted');
  fs.cpSync(path.join(root, 'fronted'), front, { recursive: true });
  const config = path.join(front, 'js/config.js');
  fs.writeFileSync(config, fs.readFileSync(config, 'utf8').replace('http://localhost:3000/api', data.base));
  const scenarios = JSON.stringify(data.cases.map(([kind, row]) => ({ kind, id: row.id })));
  const script = `
    window.addEventListener('load', async () => {
      const result = document.createElement('pre');
      result.id = 'regressionResult';
      function check(ok, text) { if (!ok) throw new Error(text); }
      try {
        await loadCourses();
        check(document.querySelectorAll('#courseList .course-item').length > 0, 'course render');
        openCourse(${data.course.id}, 'browser course');
        for (const item of ${scenarios}) {
          if (item.kind === 'material') await loadMaterials();
          else if (item.kind === 'note') await loadNotes();
          else await loadMistakes();
          await openTagPicker('edit', item.kind, item.id);
          check(tagPickerState.selected.has(${data.child.id}), 'existing tag checked');
          document.getElementById('tagchk-${data.child.id}').click();
          document.getElementById('tagPickerName').value = 'browser ' + item.kind;
          await confirmTagPicker();
          check(!tagPickerState, 'successful save closes picker');
          const row = currentResourceRow(item.kind, item.id);
          check(row.title === 'browser ' + item.kind && currentResourceNodes(item.kind, item.id).length === 0, 'name and tags saved');
          await openTagPicker('edit', item.kind, item.id);
          tagPickerState.selected.add(${data.other.id});
          await confirmTagPicker();
          check(tagPickerState && tagPickerState.selected.has(${data.other.id}), 'failed save preserves selections');
          check(document.getElementById('tagPickerModal').classList.contains('show'), 'failed save stays open');
          check(!document.getElementById('tagPickerConfirm').disabled, 'retry available');
          closeTagPicker();
        }
        const originalFetch = window.fetch;
        window.fetch = async () => ({ok:false,status:503,json:async () => ({})});
        await Promise.all([loadMaterials(), loadNotes(), loadMistakes(), loadAssessments()]);
        for (const id of ['materialList','noteList','mistakeList','assessmentList']) check(document.getElementById(id).textContent.includes('HTTP 503'), 'error state '+id);
        window.fetch = async () => ({ok:true,json:async () => []});
        await Promise.all([loadMaterials(), loadNotes(), loadMistakes(), loadAssessments()]);
        for (const id of ['materialList','noteList','mistakeList','assessmentList']) check(document.getElementById(id).textContent.includes('暂无'), 'empty state '+id);
        window.fetch = originalFetch;
        check(!document.getElementById('bootErrorBox'), 'unexpected JS or boot error');
        result.dataset.result = 'passed';
        result.textContent = 'browser interactions passed';
      } catch (err) {
        result.dataset.result = 'failed';
        result.textContent = err.stack;
      }
      document.body.appendChild(result);
    });`;
  const index = path.join(front, 'index.html');
  fs.writeFileSync(index, fs.readFileSync(index, 'utf8').replace('</body>', `<script>${script}</script></body>`));
  const staticServer = http.createServer((req, res) => {
    const filename = path.join(front, req.url === '/' ? 'index.html' : req.url.slice(1));
    if (!filename.startsWith(front + path.sep) || !fs.existsSync(filename)) { res.writeHead(404).end(); return; }
    const type = filename.endsWith('.js') ? 'text/javascript' : filename.endsWith('.css') ? 'text/css' : 'text/html';
    res.setHeader('Content-Type', type + '; charset=utf-8');
    res.end(fs.readFileSync(filename));
  });
  await new Promise(resolve => staticServer.listen(0, '127.0.0.1', resolve));
  try {
    const url = `http://127.0.0.1:${staticServer.address().port}/`;
    const html = await new Promise((resolve, reject) => {
      const browser = spawn(chrome, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
        '--user-data-dir=' + path.join(temp, 'chrome-profile'), '--virtual-time-budget=10000', '--dump-dom', url], { windowsHide: true });
      let output = '';
      browser.stdout.on('data', chunk => { output += chunk; });
      browser.on('error', reject);
      browser.on('exit', () => resolve(output));
    });
    assert.match(html, /<pre id="regressionResult" data-result="passed">/, html.match(/<pre id="regressionResult"[^>]*>[\s\S]*?<\/pre>/)?.[0] || 'browser did not complete');
    console.log('PASS Chrome: real page startup, three tag editors, checked labels, save success/failure, empty/error states, no boot errors');
  } finally { await new Promise(resolve => staticServer.close(resolve)); }
}

async function testFrontend() {
  const elements = new Map();
  function element() {
    const classes = new Set();
    return { innerHTML: '', value: '', textContent: '', disabled: false, style: {},
      classList: { add: n => classes.add(n), remove: n => classes.delete(n), contains: n => classes.has(n) },
      replaceChildren(child) { this.innerHTML = child.textContent; }, focus() {} };
  }
  const get = id => {
    if (!elements.has(id)) elements.set(id, element());
    return elements.get(id);
  };
  const messages = [];
  const context = vm.createContext({ console: { error() {}, warn() {} }, FormData, Blob, File,
    document: { getElementById: get, createElement: element, querySelector: get },
    event: { stopPropagation() {} }, prompt: () => 'new name', setTimeout, requestAnimationFrame() {} });
  for (const name of ['config', 'state', 'utils', 'tags', 'courses', 'materials', 'notes', 'mistakes', 'assessments', 'manualEntry', 'tagPicker']) {
    vm.runInContext(fs.readFileSync(path.join(root, 'fronted/js', name + '.js'), 'utf8'), context, { filename: name + '.js' });
  }
  context.showToast = text => messages.push(text);
  context.showConfirm = async () => true;
  vm.runInContext('currentCourseId = 2', context);
  const failure = async () => ({ ok: false, status: 503, json: async () => ({}) });
  for (const [load, box, empty] of [
    ['loadMaterials', 'materialList', '暂无资料'], ['loadNotes', 'noteList', '暂无笔记'],
    ['loadMistakes', 'mistakeList', '暂无错题'], ['loadAssessments', 'assessmentList', '暂无考核']
  ]) {
    context.fetch = async () => ({ ok: true, json: async () => [] });
    await context[load]();
    assert.ok(get(box).innerHTML.includes(empty));
    context.fetch = failure;
    await context[load]();
    assert.ok(get(box).innerHTML.includes('HTTP 503'));
    context.fetch = async () => { throw new TypeError('Failed to fetch'); };
    await context[load]();
    assert.ok(get(box).innerHTML.includes('无法连接服务器'));
    context.fetch = async () => ({ ok: true, json: async () => ({ wrong: true }) });
    await context[load]();
    assert.ok(get(box).innerHTML.includes('格式不正确'));
  }
  context.fetch = failure;
  get('courseNameInput').value = 'test';
  for (const run of [() => context.addCourse(), () => context.editCourseName(1, { textContent: 'old' }),
    () => context.deleteCourse(1), () => context.togglePin(1, 0), () => context.delItem('notes', 1, async () => {})]) {
    messages.length = 0;
    await run();
    assert.deepEqual(messages, ['服务器返回 HTTP 503']);
  }
  get('tagPickerName').value = 'existing';
  get('tagPickerNameExt').textContent = '';
  get('tagPickerModal').classList.add('show');
  vm.runInContext("tagPickerState = {mode:'edit',resourceType:'mistake',resourceId:1,selected:new Set([2])}", context);
  await context.confirmTagPicker();
  assert.ok(vm.runInContext('tagPickerState.selected.has(2)', context));
  assert.ok(get('tagPickerModal').classList.contains('show'));
  assert.equal(get('tagPickerConfirm').disabled, false);
  let requests = 0;
  context.fetch = async () => { requests++; return { ok: true, json: async () => [] }; };
  await Promise.all([context.confirmTagPicker(), context.confirmTagPicker()]);
  assert.equal(requests, 2, 'one save request and one reload, despite double confirm');
  assert.equal(vm.runInContext('tagPickerState', context), null);
  for (const kind of ['material', 'note', 'mistake']) {
    for (const mode of ['upload', 'manual']) {
      vm.runInContext(`tagPickerState = {mode:'${mode}',resourceType:'${kind}',selected:new Set([2])}; pendingUploadFile = new File(['test'], 'test.pdf'); pendingManual = {type:'${kind}',title:'manual',content:'body'}`, context);
      context.fetch = failure;
      await context.confirmTagPicker();
      assert.ok(vm.runInContext('tagPickerState.selected.has(2)', context));
      assert.ok(vm.runInContext(mode === 'upload' ? 'pendingUploadFile' : 'pendingManual', context));
      context.fetch = async () => ({ ok: true, json: async () => [] });
      await context.confirmTagPicker();
      assert.equal(vm.runInContext('tagPickerState', context), null);
    }
  }
  assert.equal(context.isImageFile('', '/uploads/old.pdf'), false);
  assert.equal(context.isImageFile('', '/uploads/old.jpg'), true);
  assert.equal(context.isImageFile('application/pdf', '/uploads/old.jpg'), false);
  console.log('PASS frontend: empty/error lists, failed mutations, preserved selections/files/body, retries, double-click guard, legacy PDF');
}

(async () => {
  try {
    const backend = await testBackend();
    await testFrontend();
    await testBrowser(backend);
    if (originalHash !== null) {
      assert.equal(digest(), originalHash, 'original database remains unchanged');
      console.log('PASS original database hash unchanged');
    } else {
      assert.equal(fs.existsSync(original), false, 'fresh checkout database remains absent');
      console.log('PASS fresh checkout: all database writes isolated');
    }
  } finally {
    if (db) db.close();
    if (server && server.exitCode === null) {
      await new Promise(resolve => { server.once('exit', resolve); server.kill(); });
    }
    assert.ok(path.resolve(temp).startsWith(path.resolve(os.tmpdir()) + path.sep + 'courses-regression-'));
    fs.rmSync(temp, { recursive: true, force: true });
  }
})().catch(err => { console.error(err); process.exitCode = 1; });
