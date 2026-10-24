const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {spawnSync} = require('node:child_process');
const {DatabaseSync} = require('node:sqlite');
const {schedulePlan,planDates,planToday} = require('../back/db/reviewPlanSchedule');

function testReviewPlanMigrations(source,temp) {
  for (const n of [1,12,13,86,120]) {
    const items=Array.from({length:n},(_,i)=>({type:['material','note','mistake'][i%3],id:i+1}));
    const result=schedulePlan(items,'2026-10-16','2026-10-28');
    const dates=planDates('2026-10-16','2026-10-28');
    const counts=dates.map(date=>result.filter(row=>row.scheduled_date===date).length);
    assert.equal(result.length,n); assert.equal(new Set(result.map(row=>row.type+':'+row.id)).size,n);
    assert.ok(result.every(row=>row.scheduled_date>='2026-10-16' && row.scheduled_date<'2026-10-28'));
    assert.ok(Math.max(...counts)-Math.min(...counts)<=1);
    assert.deepEqual(schedulePlan([...items].reverse(),'2026-10-16','2026-10-28'),result,'stable schedule');
  }
  assert.deepEqual(planDates('2028-02-28','2028-03-01'),['2028-02-28','2028-02-29']);
  assert.deepEqual(planDates('2026-12-31','2027-01-02'),['2026-12-31','2027-01-01']);
  for (const dates of [['2026-02-30','2026-03-02'],['bad','2026-10-28'],['2026-10-28','2026-10-28'],['2026-10-28','2026-10-16']]) assert.throws(()=>planDates(...dates));
  for (const version of [10,11]) {
    const fixture=path.join(temp,'plan-migration-'+version); fs.mkdirSync(fixture);
    fs.cpSync(path.join(source,'db'),path.join(fixture,'db'),{recursive:true});
    const schema=fs.readFileSync(path.join(source,'db/schema.js'),'utf8');
    const oldSchema=schema.replace('CURRENT_DB_VERSION = 20','CURRENT_DB_VERSION = 11').replace('if (getUserVersion() === 11)','if (false)').replace('migrateReviewSessions();','').replace('migrateReviewScheduling();','').replace('migrateReviewResults();','').replace('migratePlanScheduleSnapshot();','').replace('migrateReviewModes();','');
    assert.notEqual(oldSchema,schema);
    fs.writeFileSync(path.join(fixture,'db/schema.js'),oldSchema);
    const script=`
      const assert=require('node:assert/strict'),fs=require('node:fs');
      const store=require('./db/index.js'),d=store.db;
      const c=store.createCourse('migration data');
      const m=store.createMaterial(c.id,'old material','/uploads/m.pdf','application/pdf',[],'original body');
      store.setMaterialReviewStatus(m.id,c.id,'reviewed'); store.setMaterialFavorite(m.id,c.id,true);
      const w=store.createMistake(c.id,'old mistake','','question','',[],{mistakeType:'knowledge',answerContent:'answer'});
      // 旧版本还没有 v17 的选择题列；直接写旧步骤表，模拟历史数据。
      d.prepare('INSERT INTO mistake_review_progress (mistake_id,stage,recall,round,version,review_revision,updated_at) VALUES (?,?,?,?,?,?,?)')
        .run(w.id,'question',null,1,1,1,new Date().toISOString());
      if (${version}===10) { d.exec('ALTER TABLE mistakes DROP COLUMN answer_image_url; ALTER TABLE mistakes DROP COLUMN answer_file_type; PRAGMA user_version=10'); }
      const tables=d.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all();
      const snapshots=tables.map(({name})=>({name,columns:d.prepare('PRAGMA table_info('+name+')').all().map(c=>c.name).join(','),rows:d.prepare('SELECT * FROM '+name+' ORDER BY rowid').all()}));
      fs.copyFileSync(${JSON.stringify(path.join(source,'db/schema.js'))},'db/schema.js');
      delete require.cache[require.resolve('./db/schema.js')];
      if (${version}===11) {
        d.exec('CREATE TABLE idx_review_plans_course(id INTEGER)');
        assert.throws(()=>require('./db/schema.js'));
        assert.equal(d.prepare('PRAGMA user_version').get().user_version,11);
        assert.equal(d.prepare("SELECT count(*) n FROM sqlite_master WHERE name='review_plans'").get().n,0);
        d.exec('DROP TABLE idx_review_plans_course');
      }
      require('./db/schema.js');
      assert.equal(d.prepare('PRAGMA user_version').get().user_version,20,'single startup reaches v20');
      for(const s of snapshots) assert.deepEqual(d.prepare('SELECT '+s.columns+' FROM '+s.name+' ORDER BY rowid').all(),s.rows);
      const p=store.createReviewPlan(c.id,{name:'plan',startDate:'2026-10-16',examDate:'2026-10-28',selectedItems:[{type:'material',id:m.id}]});
      const before=JSON.stringify(store.getReviewPlan(c.id,p.id));
      delete require.cache[require.resolve('./db/schema.js')]; require('./db/schema.js');
      assert.equal(JSON.stringify(store.getReviewPlan(c.id,p.id)),before);
      const other=store.createCourse('other'),foreign=store.createMaterial(other.id,'foreign','','',[],'body');
      assert.throws(()=>d.prepare("INSERT INTO review_plan_items(plan_id,item_type,item_id,scheduled_date,sort_order,title_snapshot) VALUES (?,'material',?,'2026-10-16',1,'bad')").run(p.id,foreign.id));
      assert.deepEqual(d.prepare('PRAGMA foreign_key_check').all(),[]);d.close();
    `;
    const result=spawnSync(process.execPath,['-e',script],{cwd:fixture,windowsHide:true,encoding:'utf8'});
    assert.equal(result.status,0,result.stderr);
  }
  console.log('PASS review plan schedule/migration: balanced/stable/bounded dates, leap/year boundaries, v10/v11 through v12 to v13 once, rollback, repeat safety, source data unchanged, course constraint');
}

async function testReviewPlanApi({base,temp}) {
  async function api(method,url,body,status=method==='POST' && !/\/review(?:\/events)?(?:\?|$)/.test(url) ? 201 : 200) {
    if(body&&['recall','reveal_answer'].includes(body.action)&&body.firstAnswer===undefined)body={...body,firstAnswer:'测试首次作答'};
    const response=await fetch(base+url,{method,...(body===undefined?{}:{headers:{'Content-Type':'application/json'},body:JSON.stringify(body)})});
    const data=await response.json();assert.equal(response.status,status,JSON.stringify(data));return data;
  }
  const course=await api('POST','/courses',{name:'plan API'}), other=await api('POST','/courses',{name:'other plan API'});
  const c='/courses/'+course.id, prefix=c+'/review-plans';
  const m=await api('POST',c+'/materials',{title:'material',content:'body'});
  const n=await api('POST',c+'/notes',{title:'note',content:'body'});
  const w=await api('POST',c+'/mistakes',{title:'mistake',content:'question',mistakeType:'knowledge',answerContent:'answer'});
  const foreign=await api('POST','/courses/'+other.id+'/materials',{title:'foreign',content:'body'});
  const today=planToday(),tomorrow=new Date(Date.parse(today+'T00:00:00Z')+86400000).toISOString().slice(0,10);
  const body={name:'final',startDate:today,examDate:tomorrow,selectedItems:[{type:'material',id:m.id},{type:'note',id:n.id},{type:'mistake',id:w.id}]};
  await api('PATCH',c+'/materials/'+m.id+'/review',{reviewStatus:'reviewed'});
  const plan=await api('POST',prefix,body,201), second=await api('POST',prefix,{...body,name:'second'},201);
  assert.equal(plan.total,3);assert.equal(plan.pending,3);assert.equal(plan.completed,0);assert.equal(plan.days.length,1);assert.equal(plan.todayStats.pending,3);
  assert.ok(plan.scheduleStats && plan.scheduleStats.total>=1,'plan summary exposes full-schedule progress');
  const url=prefix+'/'+plan.id;
  let items=await api('GET',url+'/items');
  assert.ok(items.every(item=>item.status==='pending' && item.scheduled_date===today));
  const task=type=>items.find(item=>item.item_type===type);
  for(const invalid of [{selectedItems:[]},{startDate:tomorrow},{examDate:today},{examDate:'2026-02-30'},{name:' '},
    {selectedItems:[body.selectedItems[0],body.selectedItems[0]]},{selectedItems:[{type:'material',id:foreign.id}]},
    {selectedItems:[{type:'bad',id:1}]},{selectedItems:[{type:'note',id:'1'}]},{selectedItems:[{type:'note',id:999999999}]},
    {selectedItems:[{type:'note',id:n.id,courseId:other.id}]}]) await api('POST',prefix,{...body,...invalid},400);
  await api('GET','/courses/'+other.id+'/review-plans/'+plan.id,undefined,404);
  await api('GET',url+'/items?status=completed').then(rows=>assert.equal(rows.length,0));
  await api('GET',url+'/items?scheduledDate='+tomorrow).then(rows=>assert.equal(rows.length,0));
  await api('GET',url+'/items?status=reviewed',undefined,400);
  await api('GET',url+'/items?scheduledDate=bad',undefined,400);
  await api('GET',url+'/items?scheduledDate='+today+'&scheduledDate='+today,undefined,400);
  await api('PATCH',url,{examDate:tomorrow},400);
  const candidates=await api('GET',prefix+'/candidates');assert.equal(candidates.length,3);assert.ok(candidates.every(row=>row.course_id===course.id && !('nodes' in row)));
  const readUrl=c+'/materials/'+m.id+'/review?planItemId='+task('material').id;
  await api('GET',c+'/materials/'+m.id+'/review');assert.equal((await api('GET',url)).completed,0,'open not complete');
  await api('PATCH',readUrl,{reviewStatus:'unreviewed'},400);
  await api('PATCH',c+'/materials/'+m.id+'/review?planItemId='+task('note').id,{reviewStatus:'reviewed'},404);
  // 故障注入只操作隔离数据库，验证内容写入和任务回写同事务回滚。
  const d=new DatabaseSync(path.join(temp,'data/app.db'));
  try {
    await api('PATCH',c+'/materials/'+m.id+'/review',{reviewStatus:'unreviewed'});
    d.exec("CREATE TRIGGER reject_plan_completion BEFORE UPDATE OF status ON review_plan_items WHEN NEW.status='completed' BEGIN SELECT RAISE(ABORT,'plan rollback'); END");
    await api('PATCH',readUrl,{reviewStatus:'reviewed'},500);
    assert.equal((await api('GET',c+'/materials/'+m.id+'/review')).review_status,'unreviewed');
    assert.equal((await api('GET',url)).completed,0);
    const review=c+'/mistakes/'+w.id+'/review',context='?planItemId='+task('mistake').id;
    let p=await api('POST',review+context,{action:'start',requestId:'plan-start',expectedVersion:0});
    const operation={action:'recall',recall:'forgotten',requestId:'plan-forgotten',expectedVersion:p.version};
    // 未通过也会写步骤和计划轮次；用事件触发器验证整笔回滚，而不再依赖“失败即完成任务”。
    d.exec("CREATE TRIGGER reject_mistake_event BEFORE INSERT ON mistake_review_events WHEN NEW.request_id='plan-forgotten' BEGIN SELECT RAISE(ABORT,'mistake rollback'); END");
    await api('POST',review+'/events'+context,operation,500);
    assert.equal((await api('GET',review)).version,p.version);assert.equal((await api('GET',url)).completed,0);
    d.exec('DROP TRIGGER reject_mistake_event');
    d.exec('DROP TRIGGER reject_plan_completion');
    const recalled=await api('POST',review+'/events'+context,operation);
    assert.equal(recalled.stage,'answer','forgotten recall reveals the reference before judgment');
    assert.deepEqual(await api('POST',review+'/events'+context,operation),recalled,'same requestId remains idempotent');
    const completed=await api('POST',review+'/events'+context,{action:'judge',correct:false,requestId:'plan-failed-judge',expectedVersion:recalled.version});
    assert.equal(completed.stage,'completed');assert.equal(completed.reviewStatus,'unreviewed');
    const otherTask=(await api('GET',prefix+'/'+second.id+'/items')).find(row=>row.item_type==='mistake');
    await api('POST',review+'/events?planItemId='+otherTask.id,operation,409);
    await api('POST',review+'/events'+context,{...operation,requestId:'new-stale'},409);
    await api('PATCH',readUrl,{reviewStatus:'reviewed'});
    // 日历必须包含已物化的任务（标题来自任务快照），否则会出现“任务已完成但日历没勾”。
    const scheduleAfter=await api('GET',url+'/schedule');
    assert.ok(scheduleAfter.days.some(day=>day.date===today && day.items.some(item=>item.type==='material' && item.title==='material')),'schedule calendar includes materialized tasks');
    const firstTime=(await api('GET',url+'/items')).find(row=>row.item_type==='material').completed_at;
    await api('PATCH',readUrl,{reviewStatus:'reviewed'});
    assert.equal((await api('GET',url+'/items')).find(row=>row.item_type==='material').completed_at,firstTime);
    // 未通过的错题不算完成：completed 只有阅读类的那一条，错题任务保持待完成。
    assert.equal((await api('GET',url)).completed,1);assert.equal((await api('GET',url)).pending,2);assert.equal((await api('GET',prefix+'/'+second.id)).completed,0);
    await api('PATCH',url,{status:'archived',name:'renamed'});
    await api('PATCH',c+'/notes/'+n.id+'/review?planItemId='+task('note').id,{reviewStatus:'reviewed'},409);
    await api('PATCH',url,{status:'active'});
    await api('DELETE','/notes/'+n.id);
    const changed=await api('GET',url);assert.equal(changed.total,2);assert.equal(changed.skipped,0);assert.equal(changed.completed,1);assert.equal(changed.pending,1);assert.equal(changed.completionRate,50);
    items=await api('GET',url+'/items?status=skipped');assert.equal(items.length,0,'deleted tasks leave the effective plan queue');
    const deletedSchedule=await api('GET',url+'/schedule');
    assert.ok(deletedSchedule.days.every(day=>day.items.every(item=>item.type!=='note')),'deleted source disappears from the live schedule without applying a new one');
    assert.equal(deletedSchedule.hasNewSchedule,true,'deleting an upcoming task requests a new schedule');
    // 提前复习：计划内容在“当天没有任务”的预估日期也能开计划会话，并挂回日历那一天。
    const spanExam=new Date(Date.parse(today+'T00:00:00Z')+86400000*5).toISOString().slice(0,10);
    const span=await api('POST',prefix,{...body,name:'span',examDate:spanExam,selectedItems:[{type:'material',id:m.id}]},201);
    const spanSchedule=await api('GET',prefix+'/'+span.id+'/schedule');
    const futureDay=spanSchedule.days.find(day=>day.date>today);
    assert.ok(futureDay,'span plan has a future preview day');
    const preview=await api('POST',c+'/review-sessions',{requestId:'plan-preview-session',sourceType:'plan',sourceId:span.id,scheduledDate:futureDay.date,selectedItems:[{type:'material',id:m.id}]},201);
    assert.equal(preview.source_type,'plan');assert.equal(preview.source_date,futureDay.date);
    const afterSchedule=await api('GET',prefix+'/'+span.id+'/schedule');
    const linked=afterSchedule.days.find(day=>day.date===futureDay.date);
    assert.ok(linked && Array.isArray(linked.sessionItems) && linked.sessionItems.length===1,'preview-date session appears on the calendar');
    // 排期快照：提前复习后先保持旧排期，点「应用新排期」才切换。
    const snapMaterial=await api('POST',c+'/materials',{title:'snapshot future material',content:'future snapshot body'});
    const snapMaterial2=await api('POST',c+'/materials',{title:'snapshot second material',content:'second future body'});
    const snapPlan=await api('POST',prefix,{...body,name:'snapshot',examDate:spanExam,selectedItems:[
      {type:'material',id:snapMaterial.id},{type:'material',id:snapMaterial2.id},
    ]},201);
    const firstSchedule=await api('GET',prefix+'/'+snapPlan.id+'/schedule');
    assert.equal(firstSchedule.hasNewSchedule,false,'initial snapshot matches the computed schedule');
    const snapFutureTask=(await api('GET',prefix+'/'+snapPlan.id+'/items')).find(item=>item.scheduled_date>today);
    assert.ok(snapFutureTask,'snapshot fixture has a future task');
    await api('PATCH',`${c}/materials/${snapFutureTask.item_id}/review?planItemId=${snapFutureTask.id}`,{reviewStatus:'reviewed'});
    const changedSchedule=await api('GET',prefix+'/'+snapPlan.id+'/schedule');
    assert.equal(changedSchedule.hasNewSchedule,true,'successfully reviewing a future item early is flagged for approval');
    assert.deepEqual(changedSchedule.days.map(day=>day.date),firstSchedule.days.map(day=>day.date),'old schedule stays until applied');
    const applied=await api('POST',prefix+'/'+snapPlan.id+'/schedule/apply',undefined,200);
    assert.equal(applied.hasNewSchedule,false,'applying clears the pending flag');
    // 回归：未来日期已完成的旧任务 + 应用新排期，不能因为空日期而 500。
    const m2=await api('POST',c+'/materials',{title:'future material',content:'future body'});
    const futurePlan=await api('POST',prefix,{...body,name:'future-apply',examDate:spanExam,selectedItems:[{type:'material',id:m.id},{type:'material',id:m2.id}]},201);
    const futureTask=(await api('GET',prefix+'/'+futurePlan.id+'/items')).find(item=>item.scheduled_date>today);
    if (futureTask) {
      await api('PATCH',`${c}/materials/${futureTask.item_id}/review?planItemId=${futureTask.id}`,{reviewStatus:'reviewed'});
    }
    const appliedFuture=await api('POST',prefix+'/'+futurePlan.id+'/schedule/apply',undefined,200);
    assert.equal(appliedFuture.hasNewSchedule,false,'apply survives future completed tasks');
    // 回归：同一天已有完整排期，只提前复习其中一道错题时，会话不能把其他资料从日历里挤掉。
    const mergePlan=await api('POST',prefix,{...body,name:'merge-day',examDate:spanExam,
      selectedItems:[{type:'material',id:m.id},{type:'material',id:m2.id},{type:'mistake',id:w.id}]},201);
    const mergeSchedule=await api('GET',prefix+'/'+mergePlan.id+'/schedule');
    const mergeDay=mergeSchedule.days.find(day=>day.date>today && day.items.length>=2 && day.items.some(item=>item.type==='mistake'));
    assert.ok(mergeDay,'merge-day fixture has a multi-item mistake day');
    const mergeSession=await api('POST',c+'/review-sessions',{requestId:'merge-day-session',sourceType:'plan',
      sourceId:mergePlan.id,scheduledDate:mergeDay.date,selectedItems:[{type:'mistake',id:w.id}]},201);
    const mergeSessionDetail=await api('GET',c+'/review-sessions/'+mergeSession.id);
    const mergeSessionItem=mergeSessionDetail.items.find(item=>item.item_type==='mistake');
    const mergeBefore=await api('GET',c+'/mistakes/'+w.id+'/review?sessionItemId='+mergeSessionItem.id);
    const mergeStarted=await api('POST',c+'/mistakes/'+w.id+'/review?sessionItemId='+mergeSessionItem.id,
      {action:'start',requestId:'merge-start',expectedVersion:mergeBefore.version});
    await api('POST',c+'/mistakes/'+w.id+'/review/events?sessionItemId='+mergeSessionItem.id,
      {action:'recall',recall:'clear',requestId:'merge-recall',expectedVersion:mergeStarted.version});
    const mergeRecalled=await api('GET',c+'/mistakes/'+w.id+'/review?sessionItemId='+mergeSessionItem.id);
    await api('POST',c+'/mistakes/'+w.id+'/review/events?sessionItemId='+mergeSessionItem.id,
      {action:'judge',correct:true,requestId:'merge-judge',expectedVersion:mergeRecalled.version});
    const afterMerge=await api('GET',prefix+'/'+mergePlan.id+'/schedule');
    const mergedDay=afterMerge.days.find(day=>day.date===mergeDay.date);
    assert.equal(mergedDay.items.length,mergeDay.items.length,'partial session keeps the full day schedule');
    assert.equal(mergedDay.sessionItems.length,1,'session still records only the reviewed mistake');
    assert.equal(mergedDay.state,'partial','one passed item does not mark the whole day done');
    assert.ok((await api('GET',prefix+'/'+mergePlan.id)).scheduleStats.total>=mergeDay.items.length,'progress uses the full day schedule');
    // 按当天计划完成任务：记忆状态变化不应要求用户再应用一份新排期。
    const onTimePlan=await api('POST',prefix,{...body,name:'on-time',examDate:spanExam,
      selectedItems:[{type:'material',id:m.id}]},201);
    const onTimeItem=(await api('GET',prefix+'/'+onTimePlan.id+'/items')).find(item=>item.scheduled_date===today);
    assert.ok(onTimeItem,'on-time plan has a task today');
    await api('PATCH',`${c}/materials/${m.id}/review?planItemId=${onTimeItem.id}`,{reviewStatus:'reviewed'});
    const onTimeSchedule=await api('GET',prefix+'/'+onTimePlan.id+'/schedule');
    assert.equal(onTimeSchedule.days.find(day=>day.date===today)?.state,'done');
    assert.equal(onTimeSchedule.hasNewSchedule,false,'on-time completion does not request a new schedule');
    const empty=await api('POST',prefix,{...body,selectedItems:[{type:'material',id:m.id}]},201);
    await api('DELETE','/materials/'+m.id);
    const skipped=await api('GET',prefix+'/'+empty.id);assert.equal(skipped.total,0);assert.equal(skipped.skipped,0);assert.equal(skipped.pending,0);assert.equal(skipped.completed,0);assert.equal(skipped.completionRate,0);
    await api('DELETE',url);assert.equal(d.prepare('SELECT count(*) n FROM review_plan_items WHERE plan_id=?').get(plan.id).n,0);
    await api('GET',url,undefined,404);
    await api('DELETE',c);assert.equal(d.prepare('SELECT count(*) n FROM review_plans WHERE course_id=?').get(course.id).n,0);
    assert.deepEqual(d.prepare('PRAGMA foreign_key_check').all(),[]);
  } finally {d.close();}
  console.log('PASS review plan APIs: creation/invalid/duplicates/course scope/fixed selection, completion semantics, atomic reading/mistake rollback, idempotency/context/version, archive, deletion/skipped/cascades');
}
module.exports={testReviewPlanMigrations,testReviewPlanApi};
