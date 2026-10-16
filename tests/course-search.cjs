const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

// 调用方只传临时数据库的 store；不打开工作区真实数据库。
function seedCourseSearchFixtures(store) {
  const course = store.createCourse('隔离课程搜索'), otherCourse = store.createCourse('其他搜索课程');
  const folder = store.createKnowledgeNode(course.id,null,'知识框架独有词','folder');
  const child = store.createKnowledgeNode(course.id,folder.id,'子标签独有词','knowledge');
  const material = (title,content,fileUrl = '',nodes = []) => store.createMaterial(course.id,title,fileUrl,fileUrl ? 'application/pdf' : '',nodes,content);
  const note = (title,content,source = 'manual') => store.createNote(course.id,title,'','',source,[child.id],content);
  const mistake = (title,content,answerContent = '',explanation = '') => store.createMistake(course.id,title,'',content,'',[child.id],{mistakeType:'knowledge',answerContent,explanation});
  const m = material('矩阵运算讲义','矩阵的基本运算','',[folder.id,child.id]);
  const n = note('逆矩阵','逆矩阵的计算方法');
  const w = mistake('矩阵秩的计算','使用矩阵的初等行变换','矩阵参考答案','矩阵错误原因');
  // 模拟已经保存的 OCR，而不是调用或重新执行 OCR。
  store.db.prepare('UPDATE mistakes SET ocr_text = ? WHERE id = ?').run('扫描唯一词：矩阵的已有 OCR 文字',w.id);
  const body = material('正文资料','这里讨论矩阵的性质');
  note('MiXeD Case 标题','英文内容','来源独有词');
  mistake('其他错题','普通题面','答案唯一词','解析唯一词');
  material('字面符号','优惠100%_ 路径 C:\\folder\\item_1 引号 \' OR 1=1 --');
  material('通配干扰项','优惠100ABC 路径 C:ZfolderZitem11');
  material('长摘要','前'.repeat(400) + '目标针' + '后'.repeat(400));
  material('Unicode 摘要','😀'.repeat(120) + 'Unicode针' + '🧠'.repeat(100));
  const attachment = material('附件名称.pdf','','/uploads/附件内独有词.pdf');
  store.createAssessment(course.id,'考核独有词','','','','');
  store.createMaterial(otherCourse.id,'矩阵异课资料','','',[],'矩阵');
  store.createNote(otherCourse.id,'矩阵异课笔记','','','manual',[],'矩阵');
  store.createMistake(otherCourse.id,'矩阵异课错题','','矩阵','',[],{mistakeType:'thinking',answerContent:'矩阵'});
  store.setMaterialFavorite(m.id,course.id,true); store.setMaterialReviewStatus(m.id,course.id,'reviewed');
  store.setNoteFavorite(n.id,course.id,true); store.setNoteReviewStatus(n.id,course.id,'reviewed');
  store.updateMistake(w.id,{favorite:1},w.review_revision);
  const p = store.applyMistakeReview(w.id,{action:'start',requestId:'search-fixture-start',expectedVersion:0},true);
  store.applyMistakeReview(w.id,{action:'recall',recall:'clear',requestId:'search-fixture-recall',expectedVersion:p.version});
  for (let i = 0; i < 105; i++) material('数量测试-' + i,'');
  return {courseId:course.id,otherCourseId:otherCourse.id,m:m.id,n:n.id,w:w.id,body:body.id,attachment:attachment.id};
}

function checkSearchCases(search,fixture) {
  const key = row => row.type + ':' + row.id;
  const expected = ['material:'+fixture.m,'note:'+fixture.n,'mistake:'+fixture.w,'material:'+fixture.body];
  const all = search('矩阵');
  assert.equal(all.query,'矩阵'); assert.equal(all.total,4); assert.deepEqual(all.results.map(key),expected);
  assert.equal(new Set(all.results.map(key)).size,4, 'one row once despite title/body/OCR/answer/tag matches');
  assert.ok(all.results.every(row => row.courseId === fixture.courseId));
  for (const row of all.results) assert.deepEqual(Object.keys(row).sort(),['courseId','id','snippet','title','type']);
  for (const [type,count] of [['materials',2],['notes',1],['mistakes',1]]) {
    const result = search('矩阵',{types:[type]}); assert.equal(result.total,count);
    assert.ok(result.results.every(row => row.type === {materials:'material',notes:'note',mistakes:'mistake'}[type]));
  }
  assert.deepEqual(search('矩阵',{types:['mistakes','notes','notes']}).results.map(key),expected.slice(1,3), 'type parameter does not change stable order');
  for (const [q,type] of [['扫描唯一词','mistake'],['答案唯一词','mistake'],['解析唯一词','mistake'],['mixed case','note'],['100%_','material'],['%','material'],['_','material'],['\\','material'],["' OR 1=1 --",'material']]) {
    const result = search(q); assert.equal(result.total,1,q); assert.equal(result.results[0].type,type,q);
    assert.ok(result.results[0].snippet.toLowerCase().includes(q.toLowerCase()) || result.results[0].title.toLowerCase().includes(q.toLowerCase()),q);
  }
  for (const q of ['不存在的关键词','知识框架独有词','子标签独有词','来源独有词','考核独有词','附件内独有词']) {
    assert.deepEqual(search(q),{query:q,total:0,results:[]},q);
  }
  for (const q of ['', ' \t\n ']) assert.deepEqual(search(q),{query:'',total:0,results:[]});
  assert.equal(search(' \t矩阵\n ').query,'矩阵');
  const page = search('矩阵',{limit:2,offset:1});
  assert.equal(page.total,4); assert.deepEqual(page.results.map(key),expected.slice(1,3));
  const beyond = search('矩阵',{offset:100}); assert.equal(beyond.total,4); assert.deepEqual(beyond.results,[]);
  assert.deepEqual([0,1,2,3].flatMap(offset => search('矩阵',{limit:1,offset}).results.map(key)),expected);
  const long = search('目标针').results[0].snippet;
  assert.ok(long.includes('目标针') && long.startsWith('…') && long.endsWith('…') && Array.from(long).length <= 160);
  const unicode = search('Unicode针').results[0].snippet;
  assert.ok(unicode.includes('Unicode针') && Array.from(unicode).length <= 160 && !unicode.includes('\uFFFD'));
  assert.equal(search('附件名称').results[0].snippet,'');
}

function testCourseSearchData(source,temp) {
  const fixtureDir = path.join(temp,'course-search-data');
  fs.mkdirSync(fixtureDir); fs.cpSync(path.join(source,'db'),path.join(fixtureDir,'db'),{recursive:true});
  const script = `
    const assert = require('node:assert/strict');
    const {seedCourseSearchFixtures,checkSearchCases} = require(${JSON.stringify(__filename)});
    const store = require('./db/index.js'); const fixture = seedCourseSearchFixtures(store);
    assert.equal(fixture.m,fixture.n); assert.equal(fixture.n,fixture.w);
    const snapshot = () => JSON.stringify(store.db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all()
      .map(({name}) => [name,store.db.prepare('SELECT * FROM "' + name + '" ORDER BY rowid').all()]));
    const before = snapshot(), schema = JSON.stringify(store.db.prepare('SELECT * FROM sqlite_master ORDER BY name').all());
    const version = store.db.prepare('PRAGMA user_version').get().user_version;
    checkSearchCases((q,options={}) => store.searchCourse(fixture.courseId,{q,...options}),fixture);
    assert.equal(store.searchCourse(fixture.otherCourseId,{q:'矩阵'}).total,3);
    assert.ok(store.searchCourse(fixture.otherCourseId,{q:'矩阵'}).results.every(row => row.courseId === fixture.otherCourseId));
    assert.equal(snapshot(),before,'search leaves existing content, tags, favorites and review state unchanged');
    assert.equal(store.searchCourse(fixture.courseId,{q:'数量测试'}).total,105);
    assert.equal(store.searchCourse(fixture.courseId,{q:'数量测试'}).results.length,20);
    assert.equal(store.searchCourse(fixture.courseId,{q:'数量测试',limit:100}).results.length,100);
    assert.equal(store.searchCourse(fixture.courseId,{q:'数量测试',limit:100,offset:100}).results.length,5);
    assert.equal(snapshot(),before,'search is read-only including favorites/tags/review events');
    assert.equal(JSON.stringify(store.db.prepare('SELECT * FROM sqlite_master ORDER BY name').all()),schema);
    assert.equal(store.db.prepare('PRAGMA user_version').get().user_version,version);
    store.db.close();
  `;
  const run = spawnSync(process.execPath,['-e',script],{cwd:fixtureDir,windowsHide:true,encoding:'utf8'});
  assert.equal(run.status,0,run.stderr || run.stdout);
  console.log('PASS course search SQL: existing fields/OCR, same IDs across types, dedup, literal symbols/injection, bounded Unicode snippets, ranking/pages, course isolation, no migration or state changes');
}

async function testCourseSearchApi({base,searchFixture:fixture}) {
  const url = base + '/courses/' + fixture.courseId + '/search';
  const get = async (query = '',status = 200,endpoint = url) => {
    const response = await fetch(endpoint + (query ? '?' + query : ''));
    const json = await response.json(); assert.equal(response.status,status,endpoint + '?' + query + ' ' + JSON.stringify(json));
    return json;
  };
  const search = (q,options = {}) => get(new URLSearchParams({q,...options}).toString());
  const snapshot = async () => {
    const paths = ['materials','notes','mistakes','knowledge-tree'];
    return Promise.all(paths.map(async name => (await fetch(base + '/courses/' + fixture.courseId + '/' + name)).json())
      .concat([fetch(base + '/courses/' + fixture.courseId + '/mistakes/' + fixture.w + '/review').then(res => res.json())]));
  };
  const before = await snapshot();
  const all = await search('矩阵'); assert.equal(all.total,4);
  assert.deepEqual(all.results.map(row => row.type + ':' + row.id),['material:'+fixture.m,'note:'+fixture.n,'mistake:'+fixture.w,'material:'+fixture.body]);
  for (const [types,total] of [['materials',2],['notes',1],['mistakes',1],['mistakes,notes',2],['notes, notes',1]]) {
    assert.equal((await search('矩阵',{types})).total,total);
  }
  for (const q of ['扫描唯一词','答案唯一词','解析唯一词','mixed case','100%_','%','_','\\',"' OR 1=1 --",'目标针','Unicode针']) {
    const result = await search(q); assert.equal(result.total,1,q);
    assert.ok(Array.from(result.results[0].snippet).length <= 160);
    assert.deepEqual(Object.keys(result.results[0]).sort(),['courseId','id','snippet','title','type']);
  }
  for (const q of ['', ' \t\n ', '不存在的关键词','知识框架独有词','子标签独有词','考核独有词','附件内独有词']) {
    assert.equal((await search(q)).total,0,q);
  }
  assert.deepEqual(await get(),{query:'',total:0,results:[]});
  assert.equal((await search(' 矩阵 ')).query,'矩阵');
  const page = await search('矩阵',{limit:2,offset:1}); assert.equal(page.total,4); assert.deepEqual(page.results,all.results.slice(1,3));
  const defaultPage = await search('数量测试'); assert.equal(defaultPage.total,105); assert.equal(defaultPage.results.length,20);
  const maxPage = await search('数量测试',{limit:100}); assert.equal(maxPage.total,105); assert.equal(maxPage.results.length,100);
  const lastPage = await search('数量测试',{limit:100,offset:100}); assert.equal(lastPage.total,105); assert.equal(lastPage.results.length,5);
  assert.ok(!lastPage.results.some(row => maxPage.results.some(previous => previous.type === row.type && previous.id === row.id)));
  const beyond = await search('矩阵',{offset:100}); assert.equal(beyond.total,4); assert.deepEqual(beyond.results,[]);
  const other = await get('q=' + encodeURIComponent('矩阵'),200,base + '/courses/' + fixture.otherCourseId + '/search');
  assert.equal(other.total,3); assert.ok(other.results.every(row => row.courseId === fixture.otherCourseId));
  for (const bad of ['q=x&q=y','q[]=x','q=' + 'x'.repeat(501),'q=%00','types=','types=knowledge','types=materials,','types=materials&types=notes',
    'limit=0','limit=101','limit=-1','limit=1.5','limit=1e2','limit=','limit=20&limit=10','offset=-1','offset=','offset=9007199254740992','offset=1.5','nodeIds=1','unexpected=1']) {
    const error = await get(bad,400); assert.equal(error.code,'INVALID_ARGUMENT',bad); assert.equal(typeof error.message,'string');
  }
  for (const id of ['0','-1','bad','1.2','9007199254740992']) {
    assert.equal((await get('q=x',400,base + '/courses/' + id + '/search')).code,'INVALID_ARGUMENT');
  }
  assert.equal((await get('q=x',404,base + '/courses/9007199254740991/search')).code,'COURSE_NOT_FOUND');
  assert.equal((await search('矩阵',{offset:Number.MAX_SAFE_INTEGER})).results.length,0);
  assert.deepEqual(await search('x'.repeat(500)),{query:'x'.repeat(500),total:0,results:[]});
  assert.deepEqual(await snapshot(),before,'HTTP searches preserve all content/tags/favorites/review progress');
  console.log('PASS course search API: plural types/singular identities, trim/empty/Chinese/OCR, literals, rank/pages/totals, strict argument errors, scoped course data, original state intact');
}

module.exports = {seedCourseSearchFixtures,checkSearchCases,testCourseSearchData,testCourseSearchApi};
