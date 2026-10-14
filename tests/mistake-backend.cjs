// 被 regression.cjs 调用；所有数据库、上传和 HTTP 写入均位于隔离目录。
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

function testMistakeMigrations(source, temp) {
  for (const version of [0, 4, 5, 6]) {
    const fixture = path.join(temp, 'migration-' + version);
    fs.mkdirSync(fixture);
    fs.cpSync(path.join(source, 'db'), path.join(fixture, 'db'), { recursive: true });
    fs.copyFileSync(path.join(source, 'db.js'), path.join(fixture, 'db.js'));
    const script = `
      const assert = require('node:assert/strict');
      const { DatabaseSync } = require('node:sqlite');
      if (${version} !== 0) {
        const legacy = require('./db.js');
        const row = legacy.createMistake(1, '旧错题', '/uploads/legacy.jpg');
        legacy.replaceMistakeNodes(row.id, [legacy.createKnowledgeNode(1, null, '旧标签', 'knowledge').id]);
        const fixtureDb = new DatabaseSync('data/app.db');
        fixtureDb.prepare('UPDATE mistakes SET ocr_text = ? WHERE id = ?').run('原有 OCR 和混合答案内容', row.id);
        if (${version} >= 5) {
          fixtureDb.exec("ALTER TABLE materials ADD COLUMN content TEXT NOT NULL DEFAULT ''; ALTER TABLE notes ADD COLUMN content TEXT NOT NULL DEFAULT ''; ALTER TABLE mistakes ADD COLUMN content TEXT NOT NULL DEFAULT ''; ALTER TABLE assessments ADD COLUMN file_url TEXT NOT NULL DEFAULT ''; ALTER TABLE assessments ADD COLUMN file_type TEXT NOT NULL DEFAULT ''; ALTER TABLE knowledge_nodes ADD COLUMN is_system INTEGER NOT NULL DEFAULT 0;");
          fixtureDb.prepare('UPDATE mistakes SET content = ? WHERE id = ?').run('题目和答案混合的原文', row.id);
        }
        if (${version} >= 6) fixtureDb.exec("ALTER TABLE mistakes ADD COLUMN file_type TEXT NOT NULL DEFAULT ''");
        fixtureDb.exec('PRAGMA user_version = ${version}');
        fixtureDb.close();
      }
      if (${version} === 6) {
        const connection = require('./db/connection');
        connection.db.exec('CREATE TABLE idx_mistakes_filters (id INTEGER)');
        assert.throws(() => require('./db/schema.js'));
        assert.equal(connection.db.prepare('PRAGMA user_version').get().user_version, 6);
        assert.ok(!connection.db.prepare('PRAGMA table_info(mistakes)').all().some(c => c.name === 'mistake_type'));
        connection.db.exec('DROP TABLE idx_mistakes_filters');
      }
      const store = require('./db/index.js');
      assert.equal(store.db.prepare('PRAGMA user_version').get().user_version, 11);
      if (${version} !== 0) {
        const row = store.getMistakeDetail(1);
        assert.equal(row.title, '旧错题');
        assert.equal(row.image_url, '/uploads/legacy.jpg');
        assert.equal(row.ocr_text, '原有 OCR 和混合答案内容');
        assert.equal(row.content, ${version} >= 5 ? '题目和答案混合的原文' : '');
        assert.equal(row.answer_content, ''); assert.equal(row.explanation, '');
        assert.equal(row.mistake_type, 'unclassified'); assert.equal(row.review_status, 'unreviewed');
        assert.equal(row.favorite, 0); assert.equal(row.knowledge.length, 1);
      }
      const snapshot = JSON.stringify(store.db.prepare('SELECT * FROM mistakes').all());
      // 模拟可重复迁移（已有列/表），必须安全且不改数据。
      store.db.exec('PRAGMA user_version = 6');
      delete require.cache[require.resolve('./db/schema.js')]; require('./db/schema.js');
      assert.equal(store.db.prepare('PRAGMA user_version').get().user_version, 11);
      assert.equal(JSON.stringify(store.db.prepare('SELECT * FROM mistakes').all()), snapshot);
      assert.deepEqual(store.db.prepare('PRAGMA foreign_key_check').all(), []);
      const probe = store.createMistake(1, '事务测试', '', '题目', '', [], {mistakeType:'knowledge', answerContent:'答案'});
      const started = store.applyMistakeReview(probe.id, {action:'start',requestId:'start',expectedVersion:0}, true);
      store.db.exec("CREATE TRIGGER reject_review_event BEFORE INSERT ON mistake_review_events WHEN NEW.request_id = 'fail' BEGIN SELECT RAISE(ABORT, 'test rollback'); END");
      assert.throws(() => store.applyMistakeReview(probe.id, {action:'recall',recall:'forgotten',requestId:'fail',expectedVersion:started.version}));
      assert.deepEqual(store.getMistakeReview(probe.id), started);
      assert.equal(store.db.prepare('SELECT COUNT(*) AS n FROM mistake_review_events WHERE mistake_id = ?').get(probe.id).n, 1);
      store.db.exec('DROP TRIGGER reject_review_event');
      assert.equal(store.applyMistakeReview(probe.id, {action:'recall',recall:'forgotten',requestId:'fail',expectedVersion:started.version}).stage, 'completed');
      store.deleteMistake(probe.id);
      assert.equal(store.db.prepare('SELECT COUNT(*) AS n FROM mistake_review_progress WHERE mistake_id = ?').get(probe.id).n, 0);
      assert.equal(store.db.prepare('SELECT COUNT(*) AS n FROM mistake_review_events WHERE mistake_id = ?').get(probe.id).n, 0);
      store.db.close();
    `;
    const result = spawnSync(process.execPath, ['-e', script], { cwd: fixture, windowsHide: true, encoding: 'utf8' });
    assert.equal(result.status, 0, `migration ${version}: ${result.stderr}`);
  }
  console.log('PASS shared migrations: fresh/v4/v5/v6 to v10, preserved mistake data, repeat safe, migration/review rollback, deletion cascades');
}

async function testMistakeApi({ base, course, child, other, restart }) {
  let sequence = 0;
  async function request(method, endpoint, body, status = 200) {
    const response = await fetch(base + endpoint, { method,
      ...(body === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }) });
    const json = await response.json();
    assert.equal(response.status, status, `${method} ${endpoint}: ${JSON.stringify(json)}`);
    return json;
  }
  const listPath = `/courses/${course.id}/mistakes`;
  const targetPath = id => `${listPath}/${id}`;
  const reviewPath = id => `${targetPath(id)}/review`;
  const rows = {};
  for (const type of ['knowledge', 'thinking', 'execution', 'unclassified']) {
    rows[type] = await request('POST', listPath, {
      title: `复习-${type}`, content: '公共题目搜索词 100%_ 字面匹配',
      answerContent: '独立答案', explanation: '原错误原因', mistakeType: type,
      knowledgeIds: [child.id],
    }, 201);
    assert.equal(rows[type].mistake_type, type);
    assert.equal(rows[type].review_status, 'unreviewed');
    assert.equal(rows[type].answer_content, '独立答案');
  }
  for (const mistakeType of [undefined, '', 'bad', null]) {
    const error = await request('POST', listPath, { title: '不能创建', mistakeType }, 400);
    assert.equal(error.code, 'INVALID_ARGUMENT');
  }
  await request('POST', '/courses/999999999/mistakes', { title: 'bad', mistakeType: 'knowledge' }, 404);
  await request('POST', listPath, { title: 'bad', mistakeType: 'knowledge', knowledgeIds: [other.id] }, 400);
  const noAnswer = await request('POST', listPath, { title: '无答案', content: '题目', mistakeType: 'knowledge' }, 201);
  assert.equal(noAnswer.answer_content, '');
  assert.equal((await request('GET', `/mistakes/${noAnswer.id}`)).answer_content, '');
  assert.equal((await request('POST', reviewPath(noAnswer.id), { action: 'start', requestId: 'missing-answer', expectedVersion: 0 }, 422)).code, 'REVIEW_CONFIG_INCOMPLETE');

  const knowledge = rows.knowledge.id;
  const tag2 = await request('POST', `/courses/${course.id}/knowledge-nodes`, { name: '第二标签', type: 'knowledge', parentId: null }, 201);
  await request('PUT', `/mistakes/${knowledge}/knowledge`, { knowledgeIds: [child.id, tag2.id], title: '复习-knowledge' });
  const updated = await request('PATCH', targetPath(knowledge), { favorite: true, answerContent: '修改后的答案', explanation: '修改后的原因', expectedRevision: 1 });
  assert.equal(updated.favorite, 1);
  assert.equal(updated.review_revision, 2);
  assert.deepEqual(updated.knowledge.map(n => n.id), [child.id, tag2.id].sort((a,b) => a-b));
  assert.equal((await request('PATCH', targetPath(knowledge), { answerContent: '覆盖失败', expectedRevision: 1 }, 409)).code, 'VERSION_CONFLICT');
  assert.equal((await request('GET', `/mistakes/${knowledge}`)).answer_content, '修改后的答案');
  await request('PATCH', targetPath(knowledge), { favorite: 'false' }, 400);
  await request('PATCH', targetPath(knowledge), { review_status: 'reviewed' }, 400);

  for (const type of ['knowledge', 'thinking', 'execution', 'unclassified']) {
    const filtered = await request('GET', `${listPath}?mistakeType=${type}`);
    assert.ok(filtered.some(r => r.id === rows[type].id));
    assert.ok(filtered.every(r => r.mistake_type === type && r.course_id === course.id));
  }
  assert.equal((await request('GET', `${listPath}?favorite=true`)).length, 1);
  assert.ok((await request('GET', `${listPath}?favorite=false`)).every(r => r.favorite === 0));
  const tags = await request('GET', `${listPath}?nodeIds=${child.id},${tag2.id},${child.id}`);
  assert.equal(tags.filter(r => r.id === knowledge).length, 1);
  assert.equal((await request('GET', `${listPath}?nodeIds=${tag2.id}`)).length, 1);
  const parent = await request('POST', `/courses/${course.id}/knowledge-nodes`, { name: '过滤母节点', type: 'folder', parentId: null }, 201);
  await request('PUT', `/knowledge-nodes/${tag2.id}/move`, { parentId: parent.id });
  assert.deepEqual(await request('GET', `${listPath}?nodeIds=${parent.id}`), [], 'no recursive filtering');
  assert.equal((await request('GET', `${listPath}?q=${encodeURIComponent('100%_')}`)).length, 4);
  assert.equal((await request('GET', `${listPath}?q=${encodeURIComponent('复习-knowledge')}`)).length, 1);
  const combined = await request('GET', `${listPath}?mistakeType=knowledge&favorite=1&reviewStatus=unreviewed&nodeIds=${tag2.id}&q=${encodeURIComponent('公共题目')}`);
  assert.deepEqual(combined.map(r => r.id), [knowledge]);
  assert.deepEqual(await request('GET', `${listPath}?q=nonexistent-search`), []);
  for (const query of ['mistakeType=bad', 'reviewStatus=pending', 'favorite=maybe', 'nodeIds=1,bad', `nodeIds=${other.id}`, 'q[a]=b', 'q=a&q=b']) {
    await request('GET', `${listPath}?${query}`,  undefined, 400);
  }

  async function operation(id, action, extra = {}, expected = 200) {
    const current = await request('GET', reviewPath(id));
    const body = { action, requestId: 'operation-' + (++sequence), expectedVersion: current.version, ...extra };
    const result = await request('POST', reviewPath(id) + (action === 'start' ? '' : '/events'), body, expected);
    return { result, body };
  }
  let idle = await request('GET', reviewPath(knowledge));
  assert.equal(idle.stage, 'idle'); assert.equal(idle.answer, null);
  await operation(knowledge, 'judge', { correct: true }, 409);
  for (const recall of ['clear', 'vague']) {
    for (const correct of [true, false]) {
      let { result: started } = await operation(knowledge, 'start');
      assert.equal(started.stage, 'question'); assert.equal(started.answer, null);
      assert.equal(started.answerVisible, false);
      await operation(knowledge, 'start', {}, 409);
      await operation(knowledge, 'reveal_answer', {}, 409);
      const { result: recalled, body } = await operation(knowledge, 'recall', { recall });
      assert.equal(recalled.stage, 'answer'); assert.equal(recalled.answer.content, '修改后的答案');
      assert.equal(recalled.answer.explanation, '修改后的原因');
      assert.equal(recalled.reviewStatus, started.reviewStatus, 'recall does not finalize');
      const eventCount = (await request('GET', reviewPath(knowledge) + '/events?limit=100')).events.length;
      assert.deepEqual(await request('POST', reviewPath(knowledge) + '/events', body), recalled, 'idempotent response');
      assert.equal((await request('GET', reviewPath(knowledge) + '/events?limit=100')).events.length, eventCount, 'retry has no duplicate history');
      await request('POST', reviewPath(knowledge) + '/events', { ...body, recall: recall === 'clear' ? 'vague' : 'clear' }, 409);
      await request('POST', reviewPath(knowledge) + '/events', { ...body, requestId: 'stale-' + (++sequence) }, 409);
      if (recall === 'clear' && correct) {
        await restart();
        assert.deepEqual(await request('GET', reviewPath(knowledge)), recalled, 'restart restores answer step');
      }
      const { result: judged, body: judgment } = await operation(knowledge, 'judge', { correct });
      assert.equal(judged.stage, 'completed');
      assert.equal(judged.reviewStatus, correct ? 'reviewed' : 'unreviewed');
      assert.deepEqual(await request('POST', reviewPath(knowledge) + '/events', judgment), judged);
      await operation(knowledge, 'judge', { correct }, 409);
    }
  }
  await operation(knowledge, 'start');
  const { result: forgotten } = await operation(knowledge, 'recall', { recall: 'forgotten' });
  assert.equal(forgotten.stage, 'completed'); assert.equal(forgotten.reviewStatus, 'unreviewed');
  assert.equal(forgotten.answerVisible, true);
  await operation(knowledge, 'judge', { correct: true }, 409);
  await operation(knowledge, 'start');
  const question = await request('GET', reviewPath(knowledge));
  await restart();
  assert.deepEqual(await request('GET', reviewPath(knowledge)), question, 'restart restores question step');
  await operation(knowledge, 'recall', { recall: 'clear' });
  await operation(knowledge, 'judge', { correct: true });
  assert.ok((await request('GET', `${listPath}?reviewStatus=reviewed`)).some(r => r.id === knowledge));
  assert.ok((await request('GET', `${listPath}?reviewStatus=unreviewed`)).every(r => r.review_status === 'unreviewed'));

  for (const type of ['thinking', 'execution', 'unclassified']) {
    const id = rows[type].id;
    const usesMastered = type !== 'execution';
    for (const positive of [true, false]) {
      const { result: started, body: startBody } = await operation(id, 'start');
      assert.equal(started.stage, 'question'); assert.equal(started.answer, null);
      assert.deepEqual(started.allowedActions, ['reveal_answer']);
      assert.deepEqual(await request('POST', reviewPath(id), startBody), started);
      if (type === 'unclassified' && positive) {
        await restart();
        assert.deepEqual(await request('GET', reviewPath(id)), started, 'unclassified question survives restart');
      }
      await operation(id, 'recall', { recall: 'clear' }, 409);
      await operation(id, 'judge', usesMastered ? { mastered: true } : { correct: true }, 409);
      const { result: revealed, body: revealBody } = await operation(id, 'reveal_answer');
      assert.equal(revealed.stage, 'answer'); assert.deepEqual(revealed.allowedActions, ['judge']);
      if (type === 'unclassified') {
        assert.deepEqual(await request('POST', reviewPath(id) + '/events', revealBody), revealed);
        assert.equal((await request('POST', reviewPath(id) + '/events', {...revealBody, requestId: 'stale-unclassified-' + positive}, 409)).code, 'VERSION_CONFLICT');
        assert.equal((await request('POST', reviewPath(id) + '/events', {...revealBody, action: 'judge', mastered: true}, 409)).code, 'IDEMPOTENCY_CONFLICT');
        if (positive) { await restart(); assert.deepEqual(await request('GET', reviewPath(id)), revealed, 'unclassified answer survives restart'); }
      }
      await operation(id, 'judge', usesMastered ? { correct: true } : { mastered: true }, 400);
      const { result, body: judgment } = await operation(id, 'judge', usesMastered ? { mastered: positive } : { correct: positive });
      assert.equal(result.stage, 'completed'); assert.deepEqual(result.allowedActions, ['start']);
      assert.equal(result.reviewStatus, positive ? 'reviewed' : 'unreviewed');
      assert.equal((await request('GET', `/mistakes/${id}`)).review_status, result.reviewStatus);
      assert.deepEqual(await request('POST', reviewPath(id) + '/events', judgment), result);
      if (type === 'unclassified') {
        const events = (await request('GET', reviewPath(id) + '/events?limit=100')).events;
        assert.equal(events.length, positive ? 3 : 6, 'unclassified retries do not duplicate history');
        assert.equal(events[0].mistake_type, 'unclassified');
        assert.equal(events[0].result, positive ? 'mastered' : 'needs_review');
      }
    }
  }
  // 待分类的编辑、直接标签 OR 去重、组合筛选及四类间切换。
  const generic = rows.unclassified.id;
  await request('PATCH', targetPath(generic), {title: '待分类筛选题', content: '待分类正文搜索', answerContent: '通用答案', explanation: '通用解析', favorite: true});
  await request('PUT', `/mistakes/${generic}/knowledge`, {knowledgeIds: [child.id, tag2.id]});
  const genericQuery = `${listPath}?mistakeType=unclassified&favorite=true&nodeIds=${child.id},${tag2.id}&q=${encodeURIComponent('待分类正文')}`;
  assert.deepEqual((await request('GET', genericQuery + '&reviewStatus=unreviewed')).map(r => r.id), [generic]);
  await operation(generic, 'start'); await operation(generic, 'reveal_answer'); await operation(generic, 'judge', {mastered: true});
  assert.deepEqual((await request('GET', genericQuery + '&reviewStatus=reviewed')).map(r => r.id), [generic]);
  assert.deepEqual(await request('GET', genericQuery + '&reviewStatus=unreviewed'), []);
  await request('PATCH', targetPath(generic), {favorite: false});
  assert.equal((await request('GET', reviewPath(generic))).reviewStatus, 'reviewed', 'favorite does not reset generic review');
  for (const field of ['content', 'answerContent', 'explanation']) {
    const before = await request('GET', reviewPath(generic));
    const count = (await request('GET', reviewPath(generic) + '/events?limit=100')).events.length;
    await request('PATCH', targetPath(generic), {[field]: '修改-' + field, expectedRevision: before.reviewRevision});
    const reset = await request('GET', reviewPath(generic));
    assert.equal(reset.stage, 'idle'); assert.equal(reset.reviewStatus, 'unreviewed');
    assert.equal(reset.version, before.version + 1); assert.equal(reset.reviewRevision, before.reviewRevision + 1);
    assert.equal((await request('GET', reviewPath(generic) + '/events?limit=100')).events.length, count, 'generic edit preserves history');
    await request('POST', reviewPath(generic), {action: 'start', requestId: 'edited-stale-' + field, expectedVersion: before.version}, 409);
    await operation(generic, 'start'); await operation(generic, 'reveal_answer'); await operation(generic, 'judge', {mastered: true});
  }
  for (const from of Object.keys(rows)) {
    await request('PATCH', targetPath(generic), {mistakeType: from});
    for (const to of Object.keys(rows)) {
      await request('PATCH', targetPath(generic), {mistakeType: from});
      const before = await request('GET', reviewPath(generic));
      const edited = await request('PATCH', targetPath(generic), {mistakeType: to, expectedRevision: before.reviewRevision});
      assert.equal(edited.mistake_type, to);
      assert.equal(edited.review_revision, before.reviewRevision + (from === to ? 0 : 1));
      assert.deepEqual(edited.knowledge.map(n => n.id), [child.id, tag2.id].sort((a,b) => a-b));
      const p = await request('GET', reviewPath(generic));
      assert.equal(p.reviewable, true); assert.equal(p.mistakeType, to);
      if (from !== to) { assert.equal(p.stage, 'idle'); assert.equal(p.reviewStatus, 'unreviewed'); }
    }
  }
  // 无答案/无题目只提示补齐，待分类本身不再是阻塞原因。
  const incomplete = await request('POST', listPath, {title: '待分类缺内容', mistakeType: 'unclassified'}, 201);
  let blocked = await request('GET', reviewPath(incomplete.id));
  assert.deepEqual(blocked.blockedReasons, ['missing_answer', 'missing_question']);
  assert.deepEqual(blocked.allowedActions, []); assert.equal(blocked.answer, null);
  assert.equal((await request('POST', reviewPath(incomplete.id), {action: 'start', requestId: 'generic-incomplete', expectedVersion: 0}, 422)).code, 'REVIEW_CONFIG_INCOMPLETE');
  assert.deepEqual(await request('GET', reviewPath(incomplete.id)), blocked, 'rejected start does not alter progress');
  await request('PATCH', targetPath(incomplete.id), {answerContent: '补充答案'});
  blocked = await request('GET', reviewPath(incomplete.id));
  assert.deepEqual(blocked.blockedReasons, ['missing_question']);
  await request('PATCH', targetPath(incomplete.id), {content: '补充题目'});
  await operation(incomplete.id, 'start'); await operation(incomplete.id, 'reveal_answer');
  const {result: incompleteDone, body: incompleteJudgment} = await operation(incomplete.id, 'judge', {mastered: true});
  await request('PATCH', targetPath(incomplete.id), {answerContent: ''});
  blocked = await request('GET', reviewPath(incomplete.id));
  assert.equal(blocked.reviewStatus, 'unreviewed'); assert.deepEqual(blocked.blockedReasons, ['missing_answer']);
  assert.equal((await request('GET', `/mistakes/${incomplete.id}`)).answer_content, '');
  for (const [method, suffix, body] of [
    ['GET', '', undefined], ['POST', '', {action: 'start', requestId: 'foreign-generic', expectedVersion: 0}],
    ['POST', '/events', incompleteJudgment], ['GET', '/events', undefined],
  ]) await request(method, `/courses/${other.course_id}/mistakes/${incomplete.id}/review${suffix}`, body, 404);
  assert.deepEqual(await request('GET', reviewPath(incomplete.id)), blocked, 'foreign operations do not change state');
  await request('PATCH', `/courses/${other.course_id}/mistakes/${generic}`, {mistakeType: 'knowledge'}, 404);
  const foreignGeneric = await request('POST', `/courses/${other.course_id}/mistakes`, {title: '另课待分类', content: '题目', answerContent: '答案', mistakeType: 'unclassified', knowledgeIds: [other.id]}, 201);
  assert.ok(!(await request('GET', listPath + '?mistakeType=unclassified')).some(r => r.id === foreignGeneric.id));
  // 两种已有 multipart 录入方式也接受待分类。
  const form = new FormData();
  form.set('title', '待分类手动录入'); form.set('mistakeType', 'unclassified'); form.set('content', '题目'); form.set('answerContent', '答案');
  form.set('knowledgeIds', JSON.stringify([child.id]));
  for (const upload of [false, true]) {
    if (upload) form.set('file', new Blob(['%PDF-test'], {type:'application/pdf'}), 'generic.pdf');
    const response = await fetch(base + listPath, {method: 'POST', body: form});
    assert.equal(response.status, 201);
    const row = await response.json();
    assert.equal(row.mistake_type, 'unclassified'); assert.equal(row.review_status, 'unreviewed');
    assert.equal((await request('GET', `/mistakes/${row.id}`)).knowledge[0].id, child.id);
    if (upload) { assert.ok(row.image_url); assert.equal(row.file_type, 'application/pdf'); }
    await request('DELETE', `/mistakes/${row.id}`);
  }
  await request('DELETE', `/mistakes/${incomplete.id}`);
  await request('GET', reviewPath(incomplete.id), undefined, 404);
  await request('GET', reviewPath(incomplete.id) + '/events', undefined, 404);
  await request('DELETE', `/mistakes/${generic}`);
  await request('GET', `/mistakes/${generic}`, undefined, 404);
  const history = await request('GET', reviewPath(knowledge) + '/events?limit=2');
  assert.equal(history.events.length, 2); assert.ok(history.nextBeforeId);
  assert.equal(history.events[0].result, 'correct');
  const next = await request('GET', reviewPath(knowledge) + `/events?limit=2&beforeId=${history.nextBeforeId}`);
  assert.ok(next.events.every(e => e.id < history.nextBeforeId));
  assert.ok((await request('GET', reviewPath(knowledge) + '/events?limit=100')).events.some(e => e.recall === 'forgotten' && e.result === 'forgotten'));
  await request('GET', reviewPath(knowledge) + '/events?limit=101', undefined, 400);
  for (const method of ['GET', 'POST']) {
    await request(method, `/courses/${other.course_id}/mistakes/${knowledge}/review`, method === 'POST' ? { action: 'start', requestId: 'wrong-course', expectedVersion: 0 } : undefined, 404);
  }
  await request('PATCH', `/courses/${other.course_id}/mistakes/${knowledge}`, { favorite: false }, 404);
  await request('GET', `/courses/${other.course_id}/mistakes/${knowledge}/review/events`, undefined, 404);
  const foreign = await request('POST', `/courses/${other.course_id}/mistakes`, { title: '另课', content: '公共题目', mistakeType: 'knowledge', answerContent: '答案', knowledgeIds: [other.id] }, 201);
  assert.ok(!(await request('GET', listPath)).some(r => r.id === foreign.id));

  // 内容修改使旧复习步骤失效，但历史不会丢；收藏与标题不重置复习状态。
  const completed = await request('GET', reviewPath(knowledge));
  await request('PATCH', targetPath(knowledge), { title: '改名', favorite: false });
  assert.equal((await request('GET', reviewPath(knowledge))).reviewStatus, 'reviewed');
  await request('PATCH', targetPath(knowledge), { mistakeType: 'unclassified' });
  const unclassified = await request('GET', reviewPath(knowledge));
  assert.equal(unclassified.stage, 'idle'); assert.equal(unclassified.reviewStatus, 'unreviewed');
  assert.ok(unclassified.version > completed.version);
  assert.equal((await request('GET', `${listPath}?mistakeType=unclassified`)).filter(r => r.id === knowledge).length, 1);
  assert.equal(unclassified.reviewable, true); assert.deepEqual(unclassified.blockedReasons, []);
  await operation(knowledge, 'start');
  await operation(knowledge, 'reveal_answer');
  await operation(knowledge, 'judge', {mastered: true});
  await request('PATCH', targetPath(knowledge), { mistakeType: 'execution', answerContent: '新答案', explanation: '新原因' });
  await operation(knowledge, 'start');
  await operation(knowledge, 'reveal_answer');
  const beforeEdit = await request('GET', reviewPath(knowledge));
  await request('PATCH', targetPath(knowledge), { answerContent: '再改答案' });
  await request('POST', reviewPath(knowledge) + '/events', { requestId: 'outdated-after-edit', expectedVersion: beforeEdit.version, action: 'judge', correct: true }, 409);
  assert.ok((await request('GET', reviewPath(knowledge) + '/events?limit=100')).events.length > 10);
  await request('POST', reviewPath(knowledge), { action: 'start', requestId: '', expectedVersion: 0 }, 400);
  await request('POST', reviewPath(knowledge), { action: 'start', requestId: 'string-version', expectedVersion: '0' }, 400);
  await operation(knowledge, 'start');
  const current = await request('GET', reviewPath(knowledge));
  await request('POST', reviewPath(knowledge) + '/events', { action: 'judge', requestId: 'bad-bool', expectedVersion: current.version, correct: 'false' }, 400);
  await request('DELETE', `/mistakes/${noAnswer.id}`);
  await request('GET', `/mistakes/${noAnswer.id}`, undefined, 404);
  await request('GET', reviewPath(noAnswer.id), undefined, 404);
  await request('DELETE', `/mistakes/${rows.execution.id}`);
  await request('GET', reviewPath(rows.execution.id) + '/events', undefined, 404);
  console.log('PASS mistake API: four types/create/multipart/edit/type transitions/filter/tags, generic mastered review/repeat/restart/idempotency/version/history/reset/missing content, original flows, course isolation, legacy CRUD');
}

module.exports = { testMistakeMigrations, testMistakeApi };
