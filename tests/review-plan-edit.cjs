const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {fixture}=require('./temp-backend-fixture.cjs'),{runBrowser}=require('./browser-driver.cjs');
const today=()=>new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const plus=(date,n)=>new Date(Date.parse(date+'T00:00:00Z')+n*86400000).toISOString().slice(0,10);

test('plan edits are atomic, scoped and versioned; preserve completion/history and only reschedule changed dates or scope',{timeout:90000},async()=>fixture(async({api,ids,read,restart})=>{
  const c='/courses/'+ids.courseId,d=today();
  const a=await api('POST',c+'/materials',{title:'已完成资料',content:'A'},201),b=await api('POST',c+'/materials',{title:'剩余资料',content:'B'},201);
  const n=await api('POST',c+'/notes',{title:'可移除笔记',content:'N'},201),added=await api('POST',c+'/notes',{title:'新增笔记',content:'NEW'},201);
  const selectedItems=[{type:'material',id:a.id},{type:'material',id:b.id},{type:'note',id:n.id}];
  let plan=await api('POST',c+'/review-plans',{name:'原计划',startDate:d,examDate:plus(d,1),selectedItems},201);
  const route=c+'/review-plans/'+plan.id,tasks=await api('GET',route+'/items');
  const session=await api('POST',c+'/review-sessions',{requestId:'edit-plan-session',sourceType:'plan',sourceId:plan.id,scheduledDate:d,selectedItems},201);
  const first=session.items.find(item=>item.item_type==='material'&&item.item_id===a.id);
  await api('PATCH',c+'/materials/'+a.id+'/review?sessionItemId='+first.id+'&planItemId='+first.plan_item_id,{recall:'clear'});
  const completed=read(db=>db.prepare('SELECT * FROM review_plan_items WHERE id=?').get(first.plan_item_id));
  const history=()=>read(db=>({items:db.prepare('SELECT * FROM review_session_items WHERE session_id=? ORDER BY id').all(session.id),events:db.prepare('SELECT * FROM review_item_events ORDER BY id').all()}));
  const beforeHistory=history();plan=await api('GET',route);
  const snapshot=read(db=>db.prepare('SELECT schedule_json FROM review_plans WHERE id=?').get(plan.id).schedule_json);
  plan=await api('PATCH',route,{name:'只改名称',expectedVersion:plan.editVersion,examDate:plan.exam_date,selectedItems});
  assert.equal(plan.name,'只改名称');assert.equal(read(db=>db.prepare('SELECT schedule_json FROM review_plans WHERE id=?').get(plan.id).schedule_json),snapshot,'name-only edit does not recalculate schedule');
  const remaining=[{type:'material',id:a.id},{type:'material',id:b.id},{type:'note',id:added.id}];
  plan=await api('PATCH',route,{name:'调整后的计划',examDate:plus(d,6),selectedItems:remaining,expectedVersion:plan.editVersion});
  assert.equal(plan.id,session.source_id);assert.equal(plan.exam_date,plus(d,6));
  assert.deepEqual(read(db=>db.prepare('SELECT * FROM review_plan_items WHERE id=?').get(first.plan_item_id)),completed,'completion row, date and timestamp unchanged');
  assert.deepEqual(history(),beforeHistory,'sessions and grading evidence untouched');
  const edited=await api('GET',route+'/items');assert.deepEqual(new Set(edited.map(x=>x.item_type+':'+x.item_id)),new Set(remaining.map(x=>x.type+':'+x.id)));
  assert.equal(edited.find(x=>x.item_type==='material'&&x.item_id===b.id).id,tasks.find(x=>x.item_type==='material'&&x.item_id===b.id).id,'retained pending identity stable');
  let schedule=await api('GET',route+'/schedule');assert.equal(schedule.hasNewSchedule,false);
  assert.ok(schedule.days.find(day=>day.date===d).items.some(x=>x.type==='material'&&x.id===a.id&&x.status==='completed'&&x.result==='passed'),'today success remains visible');
  assert.ok(schedule.days.some(day=>day.items.some(x=>x.type==='note'&&x.id===added.id)),'new content scheduled');
  assert.ok(schedule.days.every(day=>day.date<plan.exam_date));
  assert.ok(!schedule.days.some(day=>day.items.some(x=>x.type==='note'&&x.id===n.id)),'removed pending content absent');
  await api('GET','/notes/'+n.id);
  await api('POST',c+'/review-sessions',{requestId:'excluded-new-session',sourceType:'plan',sourceId:plan.id,scheduledDate:d,selectedItems:[{type:'note',id:n.id}]},409);
  await api('PATCH',route,{expectedVersion:plan.editVersion,name:'不得覆盖',examDate:plus(d,5),selectedItems:[...remaining,remaining[0]]},400);
  assert.equal((await api('GET',route)).name,'调整后的计划','invalid edit rolls back all fields');
  await api('PATCH',route,{examDate:plus(d,3)},400);
  const other=await api('POST','/courses',{name:'其他课程'},201);
  await api('PATCH','/courses/'+other.id+'/review-plans/'+plan.id,{name:'越权'},404);
  const foreign=await api('POST','/courses/'+other.id+'/notes',{title:'其他课程笔记',content:'X'},201);
  await api('PATCH',route,{expectedVersion:plan.editVersion,selectedItems:[{type:'note',id:foreign.id}]},400);
  // Removing a completed source keeps its original task and answer evidence.
  plan=await api('PATCH',route,{expectedVersion:plan.editVersion,selectedItems:remaining.slice(1)});
  assert.deepEqual(read(db=>db.prepare('SELECT * FROM review_plan_items WHERE id=?').get(first.plan_item_id)),completed);
  assert.ok((await api('GET',route+'/schedule')).days.find(day=>day.date===d).items.some(x=>x.id===a.id&&x.type==='material'&&x.result==='passed'));
  assert.deepEqual(history(),beforeHistory);
  // Re-add rather than duplicating or resetting a former task.
  const oldNoteId=tasks.find(x=>x.item_type==='note').id;
  plan=await api('PATCH',route,{expectedVersion:plan.editVersion,examDate:plus(d,4),selectedItems:[...remaining,{type:'note',id:n.id}]});
  assert.equal((await api('GET',route+'/items')).find(x=>x.item_type==='note'&&x.item_id===n.id).id,oldNoteId);
  const stale=plan.editVersion,pending=(await api('GET',route+'/items')).find(x=>x.item_type==='material'&&x.item_id===b.id);
  await api('PATCH',c+'/materials/'+b.id+'/review?planItemId='+pending.id,{recall:'clear'});
  await api('PATCH',route,{expectedVersion:stale,name:'旧窗口覆盖',examDate:plus(d,2)},409);
  assert.equal((await api('GET',route)).name,'调整后的计划');
  plan=await api('GET',route);await restart();
  const reopened=await api('GET',route);assert.equal(reopened.id,plan.id);assert.equal(reopened.editVersion,plan.editVersion);
  assert.equal((await api('GET',route+'/schedule')).hasNewSchedule,false);
  const future=await api('POST',c+'/review-plans',{name:'未来开始',startDate:plus(d,3),examDate:plus(d,8),selectedItems:[{type:'note',id:added.id}]},201);
  await api('PATCH',c+'/review-plans/'+future.id,{expectedVersion:future.editVersion,examDate:plus(d,7)});
  assert.ok((await api('GET',c+'/review-plans/'+future.id+'/schedule')).days.every(day=>day.date>=plus(d,3)));
  let expired=await api('POST',c+'/review-plans',{name:'过期计划',startDate:plus(d,-3),examDate:plus(d,-1),selectedItems:[{type:'material',id:a.id}]},201);
  const expiredRoute=c+'/review-plans/'+expired.id,expiredTask=(await api('GET',expiredRoute+'/items'))[0];
  await api('PATCH',c+'/materials/'+a.id+'/review?planItemId='+expiredTask.id,{recall:'clear'});
  expired=await api('GET',expiredRoute);
  expired=await api('PATCH',expiredRoute,{expectedVersion:expired.editVersion,name:'过期后仅改名'});
  assert.equal(expired.exam_date,plus(d,-1));
  await api('PATCH',expiredRoute,{expectedVersion:expired.editVersion,examDate:plus(d,3)});
  const extended=await api('GET',expiredRoute+'/schedule');
  assert.ok(extended.days.find(day=>day.date===expiredTask.scheduled_date)?.items.some(item=>item.result==='passed'),'extending expired plan preserves direct-completion history');
}));

test('plan editing reuses the picker on desktop/mobile and persists through cancel, failure, reopen and real refresh',{timeout:90000},async()=>fixture(async({base,ids,temp,serve})=>{
  const chrome=['C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Google/Chrome/Application/chrome.exe'].find(fs.existsSync);assert.ok(chrome);const url=await serve();
  for(const [index,viewport]of [[1280,960],[390,844]].entries()){
    const script=`window.COURSES_API_BASE=${JSON.stringify(base)};addEventListener('load',async()=>{
      const out=document.createElement('pre');out.id='regressionResult';const check=(v,m)=>{if(!v)throw Error(m)};
      const el=id=>document.getElementById(id),api=async(method,path,body)=>(await requestApi(API+'/courses/'+${ids.courseId}+path,{method,...(body?{headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{})})).json();
      const wait=async(fn)=>{for(let i=0;i<250;i++){if(fn())return;await new Promise(r=>setTimeout(r,20));}throw Error('页面状态未就绪')};
      try{
        await openCourse(${ids.courseId},'编辑计划浏览器验收','reviewPlans');const saved=JSON.parse(sessionStorage.getItem('edit-plan-refresh')||'null');
        if(saved){await openReviewPlanEdit(saved.id);check(el('reviewPlanName').value===saved.name&&el('reviewPlanExam').value===saved.exam,'fields survive actual refresh');check(JSON.stringify([...reviewPlanCreate.ids].sort())===JSON.stringify(saved.keys.sort()),'selection survives refresh');closeReviewPlanCreate();await openReviewPlan(saved.id);check(reviewPlanDetail.plan.name===saved.name,'detail restored after refresh');out.dataset.result='passed';out.textContent='passed';document.body.append(out);return;}
        const m=await api('POST','/materials',{title:'编辑保留资料${index}',content:'M'}),n=await api('POST','/notes',{title:'编辑移除笔记${index}',content:'N'}),extra=await api('POST','/notes',{title:'编辑新增笔记${index}',content:'NEW'});
        const d=planLocalDate(),exam=new Date(Date.parse(d+'T00:00:00Z')+5*86400000).toISOString().slice(0,10);
        await openReviewPlanCreate();el('reviewPlanName').value='创建后编辑${index}';el('reviewPlanExam').value=exam;selectReviewPlanItem('material:'+m.id,true);switchReviewPlanTab('note');selectReviewPlanItem('note:'+n.id,true);await createReviewPlan();
        await wait(()=>reviewPlanDetail&&!reviewPlanCreate);
        const id=reviewPlanDetail.plan.id;await backToReviewPlans();await loadReviewPlans();await wait(()=>document.querySelector('[data-plan-id="'+id+'"] button[onclick*="openReviewPlanEdit"]'));
        await openReviewPlanEdit(id);check(el('reviewPlanCreateTitle').textContent==='编辑复习计划'&&el('reviewPlanStart').disabled,'edit reuses picker and locks start date');check(reviewPlanCreate.ids.has('material:'+m.id)&&reviewPlanCreate.ids.has('note:'+n.id),'all types preselected');
        el('reviewPlanName').value='取消的名称';closeReviewPlanCreate();check((await api('GET','/review-plans/'+id)).name==='创建后编辑${index}','cancel does not save');
        await openReviewPlanEdit(id);const newName='修改后计划${index}',newExam=new Date(Date.parse(d+'T00:00:00Z')+8*86400000).toISOString().slice(0,10);el('reviewPlanName').value=newName;
        el('reviewPlanExam').value=d;renderReviewPlanPreview();check(el('reviewPlanGenerate').disabled,'invalid date blocks save');el('reviewPlanExam').value=newExam;
        switchReviewPlanTab('note');selectReviewPlanItem('note:'+n.id,false);selectReviewPlanItem('note:'+extra.id,true);check(el('reviewPlanPreview').textContent.includes('新增 1 项，移除 1 项')&&el('reviewPlanGenerate').textContent.includes('调整剩余'),'change summary shown before save');
        await openReviewPlanPreview('note:'+extra.id);closeReviewPlanPreview();check(el('reviewPlanName').value===newName&&reviewPlanCreate.ids.has('note:'+extra.id),'preview preserves edits');
        const original=requestApi;try{requestApi=async(url,options)=>{if(options?.method==='PATCH'&&String(url).includes('/review-plans/'))throw Error('模拟保存失败');return original(url,options)};await createReviewPlan();}finally{requestApi=original}
        check(reviewPlanCreate&&el('reviewPlanName').value===newName&&el('reviewPlanCreateError').textContent.includes('模拟保存失败'),'failure retains all inputs');
        await Promise.all([createReviewPlan(),createReviewPlan()]);await wait(()=>!reviewPlanCreate&&reviewPlanDetail?.plan.name===newName);check(reviewPlanDetail.plan.id===id,'save updates existing plan exactly once');
        await openReviewPlanEdit(id);check(el('reviewPlanName').value===newName&&el('reviewPlanExam').value===newExam&&!reviewPlanCreate.ids.has('note:'+n.id)&&reviewPlanCreate.ids.has('note:'+extra.id),'immediate reopen reads saved fields and scope');
        // Stale editor must retain inputs and report conflict, never overwrite newer changes.
        await api('PATCH','/review-plans/'+id,{name:'并发修改'});el('reviewPlanName').value='旧窗口输入';await createReviewPlan();check(reviewPlanCreate&&el('reviewPlanName').value==='旧窗口输入'&&el('reviewPlanCreateError').textContent.includes('发生变化'),'version conflict keeps draft');closeReviewPlanCreate();
        await openReviewPlanEdit(id);el('reviewPlanName').value=newName;await createReviewPlan();
        await openReviewPlanEdit(id);const keys=[...reviewPlanCreate.ids];check(document.documentElement.scrollWidth<=innerWidth+1,'mobile has no horizontal overflow');closeReviewPlanCreate();
        sessionStorage.setItem('edit-plan-refresh',JSON.stringify({id,name:newName,exam:newExam,keys}));location.reload();return;
      }catch(e){out.dataset.result='failed';out.textContent=e.stack}document.body.append(out);
    });`;
    const html=await runBrowser({chrome,profile:path.join(temp,'plan-edit-'+index),url,viewport,initScript:script,blockedUrls:['https://api.deepseek.com/*']});
    const result=html.match(/<pre id="regressionResult"[^>]*>[\s\S]*?<\/pre>/)?.[0];assert.match(result||'',/data-result="passed"/,result||html.slice(-2000));
  }
}));
