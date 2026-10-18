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
const { testMistakeMigrations, testMistakeApi } = require('./mistake-backend.cjs');
const { mistakeBrowserPrelude, mistakeBrowserScenario } = require('./mistake-frontend.cjs');
const { mistakeEditBrowserScenario } = require('./mistake-edit.cjs');
const { mistakeListBrowserScenario } = require('./mistake-list.cjs');
const { testMaterialReviewMigration, testMaterialReviewApi, materialBrowserPrelude, materialBrowserScenario } = require('./material-review.cjs');
const { seedCourseSearchFixtures, testCourseSearchData, testCourseSearchApi } = require('./course-search.cjs');
const { courseSearchBrowserScenario } = require('./course-search-frontend.cjs');
const {testReviewPlanMigrations,testReviewPlanApi} = require('./review-plans.cjs');
const {reviewPlanBrowserPrelude,reviewPlanBrowserScenario} = require('./review-plans-frontend.cjs');
const {testReviewCenterMigration,testReviewCenterApi}=require('./review-center.cjs');
const {reviewCenterBrowserPrelude,reviewCenterBrowserScenario}=require('./review-center-frontend.cjs');
const {runBrowser}=require('./browser-driver.cjs');
const {reviewCenterLayoutScenario}=require('./review-center-layout.cjs');
const {reviewPlanPickerScenario}=require('./review-plan-picker.cjs');
const {testReviewSchedulingUnit,testReviewSchedulingApi}=require('./review-scheduling.cjs');

// 也允许直接通过测试参数指定屏幕尺寸，避免依赖各平台的环境变量语法。
const viewportArgument = process.argv.find(arg => /^--viewport=\d+,\d+$/.test(arg));
if (viewportArgument) process.env.COURSES_TEST_VIEWPORT = viewportArgument.slice('--viewport='.length);

const root = path.resolve(__dirname, '..');
const source = path.join(root, 'back');
const original = path.join(source, 'data/app.db');
const digest = () => crypto.createHash('sha256').update(fs.readFileSync(original)).digest('hex');
const originalHash = fs.existsSync(original) ? digest() : null;
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'courses-regression-'));
let server;
let db;
let snapshotDb;

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
  const before = snapshotDb = new DatabaseSync(path.join(temp, 'data/app.db'), { readOnly: true });
  const existing = before.prepare('SELECT id, name FROM courses ORDER BY id').all();
  const snapshots = before.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all().map(({ name }) => {
    const columns = before.prepare(`PRAGMA table_info("${name}")`).all().map(c => `"${c.name}"`).join(',');
    const sql = `SELECT ${columns} FROM "${name}" ORDER BY rowid`;
    return { sql, rows: before.prepare(sql).all() };
  });
  before.close();
  snapshotDb = null;
  // Keep the connection reachable even if schema initialization throws.
  db = require(path.join(temp, 'db/connection.js')).db;
  const store = require(path.join(temp, 'db/index.js'));
  assert.equal(db.prepare('PRAGMA user_version').get().user_version, 16);
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
    ['mistake', store.createMistake(course.id, 'mistake', '', 'mistake body', '', [child.id], { mistakeType: 'knowledge' }), store.replaceMistakeNodes, store.getMistakeDetail, store.listMistakeNodes, store.listMistakesByNode]
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
  assert.throws(() => store.createMistake(course.id, 'must rollback', '', '', '', [999999999], { mistakeType: 'knowledge' }));
  assert.equal(db.prepare('SELECT count(*) AS n FROM mistakes').get().n, count);
  const searchFixture = seedCourseSearchFixtures(store);
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
  server.on('error', err => { logs += err.stack; });
  server.on('exit', (code, signal) => { logs += `\nserver exited: ${code}, ${signal}`; });
  const base = `http://127.0.0.1:${port}/api`;
  let ready = false;
  for (let i = 0; i < 300; i++) {
    try { ready = (await fetch(base + '/courses')).ok; } catch {}
    if (ready) break;
    if (server.exitCode !== null) break;
    await new Promise(resolve => setTimeout(resolve, 100));
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
    if (kind === 'mistakes') form.set('mistakeType', 'knowledge');
    form.set(kind === 'mistakes' ? 'knowledgeIds' : 'nodeIds', JSON.stringify([child.id]));
    const response = await fetch(`${base}/courses/${course.id}/${kind}`, { method: 'POST', body: form });
    assert.equal(response.status, 201);
    assert.equal((await response.json()).content, '正文保存测试');
  }
  for (const kind of ['mistakes', 'assessments']) {
    const form = new FormData();
    form.set('title', 'PDF test.pdf');
    if (kind === 'mistakes') form.set('mistakeType', 'execution');
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
  const restart = async () => {
    await new Promise(resolve => { server.once('exit', resolve); server.kill(); });
    server = spawn(process.execPath, ['server.js'], { cwd: temp, windowsHide: true,
      env: { ...process.env, NODE_PATH: path.join(source, 'node_modules') }, stdio: ['ignore', 'pipe', 'pipe'] });
    server.stdout.on('data', chunk => { logs += chunk; });
    server.stderr.on('data', chunk => { logs += chunk; });
    server.on('error', err => { logs += err.stack; });
    for (let i = 0; i < 300; i++) {
      try { if ((await fetch(base + '/courses')).ok) return; } catch {}
      if (server.exitCode !== null) break;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    assert.fail(logs);
  };
  return { base, course, child, other, cases, restart, searchFixture };
}

async function testBrowser(data) {
  // 优先用 Chrome；没装 Chrome 的机器退到同内核的 Edge，测试逻辑不变。
  const chrome = ['C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(candidate => fs.existsSync(candidate));
  assert.ok(chrome, 'Chrome or Edge is required for browser regression');
  const front = path.join(temp, 'fronted');
  fs.cpSync(path.join(root, 'fronted'), front, { recursive: true });
  const config = path.join(front, 'js/config.js');
  fs.writeFileSync(config, fs.readFileSync(config, 'utf8').replace('http://localhost:3000/api', data.base));
  const scenarios = JSON.stringify(data.cases.map(([kind, row]) => ({ kind, id: row.id })));
  const viewport=(process.env.COURSES_TEST_VIEWPORT || '1280,960').split(',').map(Number);
  const script = `
    window.addEventListener('load', async () => {
      const result = document.createElement('pre');
      result.id = 'regressionResult';
      function check(ok, text) { if (!ok) throw new Error(text); }
      try {
        check(innerWidth===${viewport[0]} && innerHeight===${viewport[1]},'actual viewport matches requested dimensions: '+innerWidth+'x'+innerHeight);
        if (await reviewCenterBrowserRestore(check,waitUntil)) return;
        if (await reviewPlanBrowserRestore(check,waitUntil)) return;
        const readingRestored = await materialBrowserRestore(check, waitUntil);
        if (readingRestored) {
          if (readingRestored === 'materials') { ${materialBrowserScenario(data, 'notes')} return; }
          ${mistakeBrowserScenario(data)} return;
        }
        ${mistakeBrowserPrelude()}
        if(!sessionStorage.getItem('review-plan-picker-done')) {
          ${reviewPlanPickerScenario({pickerOnly:process.argv.includes('--review-plan-picker-only')})}
          sessionStorage.setItem('review-plan-picker-done','true');
        }
        if(!sessionStorage.getItem('review-center-layout-done')) {
          ${reviewCenterLayoutScenario({layoutOnly:process.argv.includes('--review-center-layout-only')})}
          sessionStorage.setItem('review-center-layout-done','true');
        }
        ${reviewCenterBrowserScenario({modalOnly:process.argv.includes('--total-review-modal-only')})}
        ${reviewPlanBrowserScenario()}
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
        ${courseSearchBrowserScenario(data)}
        ${mistakeListBrowserScenario(data)}
        ${mistakeEditBrowserScenario(data)}
        ${materialBrowserScenario(data)}
        ${mistakeBrowserScenario(data)}
        result.dataset.result = 'passed';
        result.textContent = 'browser interactions passed';
      } catch (err) {
        result.dataset.result = 'failed';
        result.textContent = err.stack + (typeof courseSearchState !== 'undefined' && courseSearchState ? ' Search diagnostics: ' + JSON.stringify({q:courseSearchState.q,error:courseSearchState.error,loaded:courseSearchState.loaded,loading:courseSearchState.loading,request:courseSearchState.request}) : '');
      }
      document.body.appendChild(result);
    });`;
  const materialPrelude = materialBrowserPrelude() + reviewPlanBrowserPrelude() + reviewCenterBrowserPrelude();
  new vm.Script(materialPrelude + script, { filename: 'browser-regression.js' });
  const index = path.join(front, 'index.html');
  fs.writeFileSync(index, fs.readFileSync(index, 'utf8').replace('</body>', `<script>${materialPrelude}${script}</script></body>`));
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
    const html=await runBrowser({chrome,profile:path.join(temp,'chrome-profile'),url,viewport,
      screenshot:process.env.COURSES_TEST_SCREENSHOT,noSandbox:!!process.env.COURSES_TEST_NO_SANDBOX});
    const failure=html.match(/<pre id="regressionResult"[^>]*>[\s\S]*?<\/pre>/)?.[0] || 'browser did not complete';
    const location=failure.match(/http:\/\/127\.0\.0\.1:\d+\/:(\d+):\d+/);
    const context=location ? '\nScenario source: '+fs.readFileSync(index,'utf8').split(/\r?\n/).slice(Number(location[1])-2,Number(location[1])+1).join('\n') : '';
    assert.match(html, /<pre id="regressionResult" data-result="passed">/, failure+context);
    console.log('PASS Chrome plan picker: 960px/90vh layout, date/name validation, equal tabs/independent filters/tags, mixed typed selection/all/unselect, long filename alignment/scroll/footer, shared text/image/PDF preview and state restoration, failed create/retry/double-click, existing total picker, actual viewport '+viewport.join('x'));
    if(process.argv.includes('--review-plan-picker-only'))return;
    console.log('PASS Chrome review page layout: independent panels/empty states, compact creation entry, inline carousel, recent rows/separators, long titles/no overlap/no overflow, original create/view/today/history/resume/repeat actions, actual viewport '+viewport.join('x'));
    if(process.argv.includes('--review-center-layout-only'))return;
    if(process.argv.includes('--total-review-modal-only')) {
      console.log('PASS Chrome total review modal: specified six-part layout, equal tabs/independent filters, mixed selection/counts, actual text/image/PDF previews, failure/retry/stale responses, scroll restoration/fixed controls/no overflow, viewport ' + (process.env.COURSES_TEST_VIEWPORT || '1280,960'));
      return;
    }
    console.log('PASS Chrome total review modal: layout/equal tabs, independent filters, mixed cumulative selection, actual text/image/PDF preview/retry/return, independent scrolling and responsive controls');
    console.log('PASS Chrome mistake edit: original CSS reproduction, visible/wrapped labels, inline list edit, search/expand/select, cancel, failure/retry, PATCH/reset rules, filters/scroll, detail reuse, stale requests, shared selectors, viewport ' + (process.env.COURSES_TEST_VIEWPORT || '1280,960'));
    console.log('PASS Chrome mistake list: shared reading styles, star/view/edit/delete only, live combined checkbox filters, favorite failure/retry/dedup, view/edit/delete/cancel, unified picker entry and completed queue');
    console.log('PASS Chrome course search: scoped real API/all types, debounce/stale cancellation, type combinations, empty/no results/errors/retry, all details/return/scroll, 105-row pagination, safe text/wrapping, course switching');
    console.log('PASS Chrome review plans: create/filter/fixed mixed selection/preview, original review controllers, skip/retry, two actual refreshes, isolated ordinary queues, negative judgment completion, archive/deletion, overdue and empty/completed states');
    console.log('PASS Chrome review center: zero/one/multiple plan carousel, single/all modules and tags/selection, idempotent creation, mixed previous/next/skip/pause, two actual refreshes, immutable history/repeat/deleted sources, all module/plan history, filters/recent five, responsive width');
    console.log('PASS Chrome reading review: ordinary/picker favorites sync/failure/reload, combined filters/AND/OR/direct tags/status/search/filtered all/dedup, preview, auto-next, skip preserves status/favorite, success counts, retry, independent queues, repeat/pause/actual reload');
    console.log('PASS Chrome: existing pages/tags/CRUD, mistake filters, filtered selection/dedup/partial state, three review queues/repeat, failed request never skips, pause/resume and actual reload recovery');
  } finally { await new Promise(resolve => staticServer.close(resolve)); }
}

async function testFrontend() {
  const elements = new Map();
  function element() {
    const classes = new Set();
    return { innerHTML: '', value: '', textContent: '', disabled: false, style: {},
      classList: { add: n => classes.add(n), remove: n => classes.delete(n), contains: n => classes.has(n) },
      replaceChildren(child) { this.innerHTML = child.textContent; }, querySelector() { return element(); }, focus() {} };
  }
  const get = id => {
    if (!elements.has(id)) elements.set(id, element());
    return elements.get(id);
  };
  const messages = [];
  const context = vm.createContext({ console: { error() {}, warn() {} }, FormData, Blob, File, URLSearchParams,
    document: { getElementById: get, createElement: element, querySelector: get },
    event: { stopPropagation() {} }, prompt: () => 'new name', setTimeout, requestAnimationFrame() {} });
  for (const name of ['config', 'state', 'utils', 'tags', 'courses', 'readingBrowse', 'materials', 'notes', 'mistakes', 'assessments', 'manualEntry', 'tagPicker']) {
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
      if (kind === 'mistake') get('mistakeCreateType').value = 'knowledge';
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

async function cleanupRegression() {
  const errors = [];
  async function attempt(label, operation) {
    try { await operation(); } catch (err) { errors.push(new Error(label, { cause: err })); }
  }
  if (snapshotDb) await attempt('Closing snapshot database failed', () => { snapshotDb.close(); snapshotDb = null; });
  if (db) await attempt('Closing test database failed', () => { db.close(); db = null; });
  if (server && server.exitCode === null && server.signalCode === null) {
    await attempt('Stopping test server failed', () => new Promise((resolve, reject) => {
      const exited = () => { server.off('error', failed); resolve(); };
      const failed = err => { server.off('exit', exited); reject(err); };
      server.once('exit', exited);
      server.once('error', failed);
      if (!server.kill()) {
        server.off('exit', exited);
        server.off('error', failed);
        reject(new Error('Test server could not be stopped'));
      }
    }));
  }
  await attempt('Unsafe temporary directory cleanup target', () => {
    assert.ok(path.resolve(temp).startsWith(path.resolve(os.tmpdir()) + path.sep + 'courses-regression-'));
  });
  // Never try to delete files while a resource may still be open.
  if (errors.length === 0) {
    await attempt('Removing test temporary directory failed', () => {
      fs.rmSync(temp, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
    });
  }
  if (errors.length === 0) console.log('PASS regression cleanup: resources released and temporary directory removed');
  return errors;
}

(async () => {
  let primaryFailure = false;
  try {
    testMistakeMigrations(source, temp);
    testMaterialReviewMigration(source, temp);
    testCourseSearchData(source, temp);
    testReviewPlanMigrations(source,temp);
    testReviewCenterMigration(source,temp);
    testReviewSchedulingUnit();
    const backend = await testBackend();
    await testMistakeApi(backend);
    await testMaterialReviewApi(backend);
    await testCourseSearchApi(backend);
    await testReviewPlanApi({...backend,temp});
    await testReviewCenterApi({...backend,temp});
    await testReviewSchedulingApi(backend);
    if (!process.argv.includes('--backend-only')) {
      await testFrontend();
      await testBrowser(backend);
    }
    if (originalHash !== null) {
      assert.equal(digest(), originalHash, 'original database remains unchanged');
      console.log('PASS original database hash unchanged');
    } else {
      assert.equal(fs.existsSync(original), false, 'fresh checkout database remains absent');
      console.log('PASS fresh checkout: all database writes isolated');
    }
  } catch (err) {
    primaryFailure = true;
    throw err;
  } finally {
    const cleanupErrors = await cleanupRegression();
    if (cleanupErrors.length) {
      const cleanupFailure = new AggregateError(cleanupErrors, 'Regression cleanup failed');
      if (primaryFailure) {
        console.error('Additional cleanup failure; original test error follows:', cleanupFailure);
      } else {
        throw cleanupFailure;
      }
    }
  }
})().catch(err => { console.error(err); process.exitCode = 1; });
