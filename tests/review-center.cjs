const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {spawnSync}=require('node:child_process');
const {DatabaseSync}=require('node:sqlite');

function testReviewCenterMigration(source,temp) {
  const fixture=path.join(temp,'sessions-migration');fs.mkdirSync(fixture);fs.cpSync(path.join(source,'db'),path.join(fixture,'db'),{recursive:true});
  const schema=fs.readFileSync(path.join(source,'db/schema.js'),'utf8');
  fs.writeFileSync(path.join(fixture,'db/schema.js'),schema.replace('CURRENT_DB_VERSION = 27','CURRENT_DB_VERSION = 12').replace('migrateReviewSessions();','').replace('migrateReviewScheduling();','').replace('migrateReviewResults();','').replace('migratePlanScheduleSnapshot();','').replace('migrateReviewModes();',''));
  const result=spawnSync(process.execPath,['-e',`
    const assert=require('node:assert/strict'),fs=require('node:fs'),store=require('./db/index.js'),d=store.db;
    assert.equal(d.prepare('PRAGMA user_version').get().user_version,12);
    const c=store.createCourse('old course'),m=store.createMaterial(c.id,'old content','','',[],'body');
    store.setMaterialFavorite(m.id,c.id,true);store.setMaterialReviewStatus(m.id,c.id,'reviewed');
    const p=store.createReviewPlan(c.id,{name:'old plan',startDate:'2026-10-16',examDate:'2026-10-28',selectedItems:[{type:'material',id:m.id}]});
    const tables=d.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all();
    const before=tables.map(({name})=>({name,columns:d.prepare('PRAGMA table_info('+name+')').all().map(c=>c.name).join(','),rows:d.prepare('SELECT * FROM '+name+' ORDER BY rowid').all()}));
    fs.copyFileSync(${JSON.stringify(path.join(source,'db/schema.js'))},'db/schema.js');delete require.cache[require.resolve('./db/schema.js')];
    d.exec('CREATE TABLE idx_review_sessions_course(id INTEGER)');assert.throws(()=>require('./db/schema.js'));
    assert.equal(d.prepare('PRAGMA user_version').get().user_version,12);
    assert.equal(d.prepare("SELECT count(*) n FROM sqlite_master WHERE name='review_sessions'").get().n,0);
    d.exec('DROP TABLE idx_review_sessions_course');require('./db/schema.js');
    assert.equal(d.prepare('PRAGMA user_version').get().user_version,27);
    for(const t of before)assert.deepEqual(d.prepare('SELECT '+t.columns+' FROM '+t.name+' ORDER BY rowid').all(),t.rows);
    assert.equal(d.prepare('SELECT count(*) n FROM review_sessions').get().n,0,'no invented history');
    const session=store.createReviewSession(c.id,{requestId:'first',sourceType:'material',selectedItems:[{type:'material',id:m.id}]});
    const snapshot=JSON.stringify(store.getReviewSession(c.id,session.id));
    delete require.cache[require.resolve('./db/schema.js')];require('./db/schema.js');assert.equal(JSON.stringify(store.getReviewSession(c.id,session.id)),snapshot);
    assert.deepEqual(d.prepare('PRAGMA foreign_key_check').all(),[]);d.close();
  `],{cwd:fixture,windowsHide:true,encoding:'utf8'});
  assert.equal(result.status,0,result.stderr);
  console.log('PASS review center migration: v12->v14, rollback, repeat execution, all legacy data preserved, no fabricated sessions');
}
async function testReviewCenterApi({base,temp}) {
  async function api(method,url,body,status=200) {
    if(body&&['recall','reveal_answer'].includes(body.action)&&body.firstAnswer===undefined)body={...body,firstAnswer:'测试首次作答'};
    const response=await fetch(base+url,{method,...(body===undefined?{}:{headers:{'Content-Type':'application/json'},body:JSON.stringify(body)})});
    const json=await response.json();assert.equal(response.status,status,JSON.stringify(json));return json;
  }
  const course=await api('POST','/courses',{name:'review center API'},201),other=await api('POST','/courses',{name:'isolated history'},201);
  const c='/courses/'+course.id,prefix=c+'/review-sessions',d=new DatabaseSync(path.join(temp,'data/app.db'));
  try {
    const shared=10000000+course.id;
    d.prepare("INSERT INTO materials(id,course_id,title,file_url,content,created_at,review_status,favorite) VALUES (?,?,'material snapshot','','body','2026-10-17','reviewed',1)").run(shared,course.id);
    d.prepare("INSERT INTO notes(id,course_id,title,file_url,content,created_at) VALUES (?,?,'note snapshot','','body','2026-10-17')").run(shared,course.id);
    d.prepare("INSERT INTO mistakes(id,course_id,title,image_url,content,created_at,mistake_type,answer_content) VALUES (?,?,'mistake snapshot','','question','2026-10-17','knowledge','answer')").run(shared,course.id);
    const selectedItems=['material','note','mistake'].map(type=>({type,id:shared}));
    const body={requestId:'mixed-create',sourceType:'total',selectedItems};
    const session=await api('POST',prefix,body,201),url=prefix+'/'+session.id;
    assert.equal(session.total,3);assert.equal(session.pending,3);assert.equal(new Set(session.items.map(item=>item.item_id)).size,1);assert.equal(new Set(session.items.map(item=>item.item_type+':'+item.item_id)).size,3);
    assert.equal((await api('POST',prefix,body,201)).id,session.id);
    await api('POST',prefix,{...body,selectedItems:[selectedItems[0]]},409);
    for(const invalid of [{selectedItems:[]},{selectedItems:[selectedItems[0],selectedItems[0]]},{selectedItems:[{type:'material',id:-1}]},
      {sourceType:'material'},{requestId:''},{sourceType:'assessment'}])await api('POST',prefix,{...body,...invalid,requestId:invalid.requestId ?? 'invalid-'+JSON.stringify(invalid)},400);
    await api('POST','/courses/'+other.id+'/review-sessions',{...body,requestId:'foreign'},400);
    await api('GET','/courses/'+other.id+'/review-sessions/'+session.id,undefined,404);
    await api('GET','/courses/'+other.id+'/review-sessions').then(result=>assert.equal(result.total,0));
    await api('POST',url+'/position',{position:2});await api('POST',url+'/pause',{});
    let resumed=await api('POST',url+'/resume',{});assert.equal(resumed.id,session.id);assert.equal(resumed.current_position,2);assert.equal(resumed.pending,3);
    await api('POST',url+'/finish',{},409);
    const byType=type=>session.items.find(item=>item.item_type===type);
    const read=c+'/materials/'+shared+'/review?sessionItemId='+byType('material').id;
    await api('PATCH',c+'/materials/'+shared+'/review?sessionItemId='+byType('note').id,{reviewStatus:'reviewed'},404);
    await api('PATCH',read,{reviewStatus:'unreviewed'},400);
    // 回写失败必须连原内容一起回滚。
    await api('PATCH',c+'/materials/'+shared+'/review',{reviewStatus:'unreviewed'});
    d.exec("CREATE TRIGGER reject_session BEFORE UPDATE OF status ON review_session_items WHEN NEW.status='completed' BEGIN SELECT RAISE(ABORT,'rollback session'); END");
    await api('PATCH',read,{reviewStatus:'reviewed'},500);
    assert.equal((await api('GET',c+'/materials/'+shared+'/review')).review_status,'unreviewed');
    const w=c+'/mistakes/'+shared+'/review',ctx='?sessionItemId='+byType('mistake').id;
    let progress=await api('POST',w+ctx,{action:'start',requestId:'start-session',expectedVersion:0});
    const operation={action:'recall',recall:'forgotten',requestId:'negative-session',expectedVersion:progress.version};
    await api('POST',w+'/events'+ctx,operation,500);assert.equal((await api('GET',w)).version,progress.version);
    d.exec('DROP TRIGGER reject_session');
    await api('PATCH',read,{reviewStatus:'reviewed'});await api('PATCH',read,{reviewStatus:'reviewed'});
    let after=await api('GET',url);assert.equal(after.completed,1);assert.equal(after.pending,2);
    await api('POST',url+'/items/'+byType('material').id+'/skip',{},409);
    await api('POST',url+'/items/'+byType('note').id+'/skip',{});await api('POST',url+'/items/'+byType('note').id+'/skip',{});
    assert.equal((await api('GET',c+'/notes/'+shared+'/review')).review_status,'unreviewed','skip does not mark content reviewed');
    const result=await api('POST',w+'/events'+ctx,operation);assert.equal(result.reviewStatus,'unreviewed');
    assert.equal(result.stage,'answer','forgotten answer remains pending final judgment');
    assert.deepEqual(await api('POST',w+'/events'+ctx,operation),result,'existing requestId idempotency retained');
    await api('POST',w+'/events'+ctx,{...operation,requestId:'stale-new'},409);
    const judged=await api('POST',w+'/events'+ctx,{action:'judge',correct:false,requestId:'negative-session-final',expectedVersion:result.version});
    assert.equal(judged.stage,'completed');assert.equal(judged.reviewStatus,'unreviewed');
    after=await api('GET',url);assert.equal(after.status,'completed');assert.equal(after.completed,2);assert.equal(after.passed,0,'reading exposure is not retrieval success');assert.equal(after.exposed,1);assert.equal(after.failed,1,'forgotten plus final judgment is processed but not passed');assert.equal(after.skipped,1);assert.equal(after.progress,100);assert.equal(after.passRate,0);
    const endedAt=after.completed_at;await api('POST',url+'/resume',{},409);await api('POST',url+'/position',{position:0},409);
    await api('POST',url+'/repeat',{requestId:'repeat-original'},201).then(row=>assert.notEqual(row.id,session.id));
    const two=await api('POST',prefix,{...body,requestId:'another-pending'},201);
    const three=await api('POST',prefix,{...body,requestId:'third-pending'},201);
    await api('POST',prefix+'/'+two.id+'/position',{position:1});await api('POST',prefix+'/'+three.id+'/pause',{});
    assert.equal((await api('GET',prefix+'/'+two.id)).current_position,1,'new record does not overwrite another');
    await api('GET',prefix+'?limit=5').then(list=>{assert.ok(list.results.length<=5);assert.notEqual(list.results[0].status,'completed');});
    await api('GET',prefix+'?status=completed&sourceType=total').then(list=>assert.ok(list.results.every(row=>row.status==='completed' && row.source_type==='total')));
    for(const query of ['limit=0','status=bad','sourceType=bad','limit=1&limit=2'])await api('GET',prefix+'?'+query,undefined,400);
    d.prepare("UPDATE materials SET title='renamed',favorite=0,review_status='unreviewed' WHERE id=?").run(shared);
    assert.equal((await api('GET',url)).items[0].title_snapshot,'material snapshot');
    await api('PATCH',read,{reviewStatus:'reviewed'});assert.equal((await api('GET',c+'/materials/'+shared+'/review')).review_status,'unreviewed','closed session cannot rewrite source');
    await api('DELETE','/notes/'+shared);
    const repeated=await api('POST',url+'/repeat',{requestId:'repeat-after-delete'},201);
    assert.equal(repeated.total,2);assert.equal(repeated.excluded.length,1);assert.ok(repeated.items.every(item=>item.item_type!=='note'));
    const deletedHistory=await api('GET',url);assert.equal(deletedHistory.completed_at,endedAt);assert.equal(deletedHistory.items[1].source_deleted,1);
    assert.equal(deletedHistory.total,2);assert.equal(deletedHistory.deleted,1,'deleted source leaves the effective session denominator');
    const plan=await api('POST',c+'/review-plans',{name:'session plan',startDate:'2026-10-17',examDate:'2026-10-18',selectedItems:[selectedItems[0]]},201);
    const linked=await api('POST',prefix,{requestId:'plan-linked',sourceType:'plan',sourceId:plan.id,scheduledDate:'2026-10-17',selectedItems:[selectedItems[0]]},201);
    await api('PATCH',c+'/materials/'+shared+'/review?sessionItemId='+linked.items[0].id,{reviewStatus:'reviewed'});
    assert.equal((await api('GET',c+'/review-plans/'+plan.id)).completed,0,'reading exposure does not complete a mastery plan task');
    const planRepeat=await api('POST',prefix+'/'+linked.id+'/repeat',{requestId:'plan-repeat'},201);assert.equal(planRepeat.items[0].plan_item_id,null,'repeat does not reopen old plan tasks');
    await api('DELETE','/materials/'+shared);await api('DELETE','/mistakes/'+shared);
    const allDeleted=await api('GET',prefix+'/'+repeated.id);assert.equal(allDeleted.status,'completed','deleted pending sources settle safely');
    assert.equal(allDeleted.total,0);assert.equal(allDeleted.deleted,2);assert.equal(allDeleted.passRate,0,'no remaining tasks means no invented success');
    assert.equal((await api('POST',url+'/repeat',{requestId:'repeat-after-delete'},201)).id,repeated.id,'repeat response loss retry is fixed even after deletion');
    await api('POST',url+'/repeat',{requestId:'empty-repeat'},422);
    await api('DELETE',c);assert.equal(d.prepare('SELECT count(*) n FROM review_sessions WHERE course_id=?').get(course.id).n,0);
    assert.deepEqual(d.prepare('PRAGMA foreign_key_check').all(),[]);
  } finally{d.close();}
  console.log('PASS review center API: compound IDs/fixed order, all sources, idempotent create/repeat/writes, resume/multiple pending, filters/scope, atomic rollback, negative mistake execution, immutable completed history, deleted snapshots/cascades, plan integration');
}
module.exports={testReviewCenterMigration,testReviewCenterApi};
