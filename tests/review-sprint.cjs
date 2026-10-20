// Reuse the established isolated HTTP/browser fixture; its existing regressions also run.
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const {fixture}=require('./mistake-format.cjs');
const {runBrowser}=require('./browser-driver.cjs');
const {DatabaseSync}=require('node:sqlite');
const {testReviewCenterApi}=require('./review-center.cjs');
const {testReviewPlanApi}=require('./review-plans.cjs');
const {testReviewSchedulingApi,testReviewSchedulingUnit}=require('./review-scheduling.cjs');
const cloze={prompt:'首都为【b1】，2+2=【b2】',reference:'',rubric:'',objects:[],dimensions:[],blanks:[
  {id:'b1',answer:'北京',aliases:['北京市'],hint:'中国首都'},{id:'b2',answer:'4',aliases:['四'],hint:'数字'}]};

test('P0/P1/P2 real HTTP: evidence, exposure, manual materials, snapshots, aliases, versions, sessions and plans',{timeout:90000},async()=>fixture(async({api,ids,read,restart,back})=>{
  let seq=0;const key=()=>`sprint-${++seq}`;
  const c=ids.courseId,prefix='/courses/'+c;
  const row=await api('POST',prefix+'/mistakes',{title:'首次作答',content:'2+2=?',answerContent:'4',mistakeType:'execution',questionFormat:'open'},201);
  const review=prefix+'/mistakes/'+row.id+'/review';let p=await api('GET',review);
  p=await api('POST',review,{action:'start',requestId:key(),expectedVersion:p.version});assert.equal(p.answer,null);
  await api('POST',review+'/events',{action:'reveal_answer',requestId:key(),expectedVersion:p.version},400);
  p=await api('POST',review+'/events',{action:'reveal_answer',firstAnswer:'我独立作答为 4',requestId:key(),expectedVersion:p.version,durationMs:1234});
  assert.equal(p.firstAnswer,'我独立作答为 4');assert.equal(p.answerRevealed,true);
  const judge={action:'judge',correct:true,requestId:key(),expectedVersion:p.version,durationMs:2345};
  const done=await api('POST',review+'/events',judge);assert.deepEqual(await api('POST',review+'/events',judge),done);
  p=await api('POST',review,{action:'start',requestId:key(),expectedVersion:done.version});
  const round=p.round;p=await api('POST',review+'/events',{action:'restart',requestId:key(),expectedVersion:p.version});
  assert.equal(p.round,round+1);assert.equal(p.firstAnswer,null);assert.equal(p.answerRevealed,false);
  let events=read(db=>db.prepare('SELECT * FROM review_item_events WHERE item_type=? AND item_id=?').all('mistake',row.id));
  assert.equal(events.length,1);assert.equal(events[0].grade,2);assert.equal(events[0].duration_ms,2345);assert.equal(events[0].answer_revealed,1);assert.equal(events[0].first_answer,'我独立作答为 4');
  await restart();assert.equal((await api('GET',review)).stage,'question');
  const note=await api('POST',prefix+'/notes',{title:'手动复习笔记',content:'记忆材料原文'},201);
  const item=prefix+'/review-items/note/'+note.id;
  const save=(mode,material,version=0)=>api('PUT',item+'/materials/'+mode,{expectedVersion:version,confirmed:true,material});
  const createSession=()=>api('POST',prefix+'/review-sessions',{requestId:key(),sourceType:'total',selectedItems:[{type:'note',id:note.id}]},201);
  const start=async(mode,version=1)=>{
    const session=await createSession();const body={requestId:key(),modeId:mode,expectedMaterialVersion:version,sessionItemId:session.items[0].id};
    const attempt=await api('POST',item+'/attempts',body);assert.deepEqual(await api('POST',item+'/attempts',body),attempt);return {session,attempt};
  };
  await api('PUT',item+'/materials/cloze',{expectedVersion:0,confirmed:false,material:cloze},400);
  await save('cloze',cloze);await api('PUT',item+'/materials/cloze',{expectedVersion:0,confirmed:true,material:cloze},409);
  await api('PUT',item+'/materials/cloze',{expectedVersion:1,confirmed:true,material:{...cloze,blanks:[{...cloze.blanks[0],answer:''}]}},400);
  const practice=await api('GET',item+'/materials/cloze?view=practice');assert.equal(practice.material.blanks[0].answer,undefined);assert.equal(practice.material.reference,undefined);
  const {session,attempt}=await start('cloze');assert.equal(attempt.material.blanks[0].aliases,undefined);assert.equal(attempt.firstAnswer,null);
  await save('cloze',{...cloze,blanks:[{...cloze.blanks[0],answer:'新答案',aliases:[]},cloze.blanks[1]]},1);
  const op={action:'submit',answer:{b1:'北京市',b2:'四'},requestId:key(),expectedVersion:0,durationMs:4500};
  const fixtureDb=new DatabaseSync(path.join(back,'data/app.db'));
  try{
    fixtureDb.exec("CREATE TRIGGER reject_mode_event BEFORE INSERT ON review_mode_events BEGIN SELECT RAISE(ABORT,'test atomic rollback'); END");
    await api('POST',item+'/attempts/'+attempt.id+'/events',op,500);
    assert.equal((await api('GET',item+'/attempts/'+attempt.id)).stage,'question');
    assert.equal(read(db=>db.prepare('SELECT count(*) n FROM review_item_events WHERE session_item_id=?').get(session.items[0].id).n),0,'failed final write rolls back grade and session changes');
  }finally{fixtureDb.exec('DROP TRIGGER IF EXISTS reject_mode_event');fixtureDb.close();}
  const result=await api('POST',item+'/attempts/'+attempt.id+'/events',op);
  assert.equal(result.grade,3);assert.equal(result.material.blanks[0].answer,'北京','existing attempt retains its confirmed snapshot');
  assert.deepEqual(await api('POST',item+'/attempts/'+attempt.id+'/events',op),result);
  await api('POST',item+'/attempts/'+attempt.id+'/events',{...op,answer:{b1:'错误',b2:'0'}},409);
  assert.equal((await api('GET',prefix+'/review-sessions/'+session.id)).passed,1);
  assert.equal(read(db=>db.prepare('SELECT count(*) n FROM review_item_events WHERE session_item_id=?').get(session.items[0].id).n),1);
  await restart();assert.deepEqual(await api('GET',item+'/attempts/'+attempt.id),result);
  const another=await api('POST','/courses',{name:'隔离课程'},201);
  await api('GET','/courses/'+another.id+'/review-items/note/'+note.id+'/materials/cloze',undefined,404);
  const otherNote=await api('POST',prefix+'/notes',{title:'另一条',content:'B'},201);
  assert.equal((await api('GET',prefix+'/review-items/note/'+otherNote.id+'/materials/cloze')).version,0);
  for(const mode of ['standard','self_explain','contrast']){
    await save(mode,{prompt:'先独立讲解 / 对比',reference:'核心要点',rubric:'覆盖关键概念',objects:['对象甲','对象乙'],dimensions:['定义'],blanks:[]});
    const run=await start(mode);let a=run.attempt;
    assert.equal(a.material.reference,undefined);assert.equal(a.material.rubric,undefined);
    a=await api('POST',item+'/attempts/'+a.id+'/events',{requestId:key(),expectedVersion:a.version,action:'submit',answer:'我的首次讲解',durationMs:1000});
    assert.equal(a.firstAnswer,'我的首次讲解');assert.equal(a.material.reference,'核心要点');
    await api('POST',item+'/attempts/'+a.id+'/events',{requestId:key(),expectedVersion:a.version,action:'submit',answer:'看答案后修改'},400);
    a=await api('POST',item+'/attempts/'+a.id+'/events',{requestId:key(),expectedVersion:a.version,action:'judge',grade:4,durationMs:2000});
    assert.equal(a.grade,2,'open-answer engines cap post-answer self-grade at Hard');
  }
  await save('reading',{prompt:'阅读原文',reference:'',rubric:'',blanks:[]});
  const reading=await start('reading');const count=read(db=>db.prepare('SELECT count(*) n FROM review_item_events').get().n);
  const exposure=await api('POST',item+'/attempts/'+reading.attempt.id+'/events',{requestId:key(),expectedVersion:0,action:'complete',answer:'已读，有疑问',durationMs:6000});
  assert.equal(exposure.grade,null);assert.equal(exposure.result.exposureOnly,true);assert.equal(read(db=>db.prepare('SELECT count(*) n FROM review_item_events').get().n),count);
  const exposed=await api('GET',prefix+'/review-sessions/'+reading.session.id);assert.equal(exposed.exposed,1);assert.equal(exposed.passed,0);assert.equal(exposed.failed,0);
  const legacySession=await createSession();await api('PATCH',prefix+'/notes/'+note.id+'/review?sessionItemId='+legacySession.items[0].id,{reviewStatus:'reviewed'});
  assert.equal(read(db=>db.prepare('SELECT count(*) n FROM review_item_events').get().n),count,'legacy reading no longer emits Good');
  const today=new Date().toISOString().slice(0,10),exam=new Date(Date.now()+7*86400000).toISOString().slice(0,10);
  const plan=await api('POST',prefix+'/review-plans',{name:'手动挖空计划',startDate:today,examDate:exam,selectedItems:[{type:'note',id:note.id}]},201);
  const task=read(db=>db.prepare('SELECT * FROM review_plan_items WHERE plan_id=? ORDER BY id LIMIT 1').get(plan.id));assert.ok(task);
  const a=await api('POST',item+'/attempts',{requestId:key(),modeId:'cloze',expectedMaterialVersion:2,planItemId:task.id});
  await api('POST',item+'/attempts/'+a.id+'/events',{requestId:key(),expectedVersion:0,action:'submit',answer:{b1:'新答案',b2:'4'}});
  assert.equal(read(db=>db.prepare('SELECT status FROM review_plan_items WHERE id=?').get(task.id).status),'completed');
  const draft=await api('POST','/ai/review-draft',{modeId:'cloze',text:'牛顿定律：质量乘以加速度。'});
  assert.equal(draft.provider,'mock');assert.ok(draft.material.blanks[0].answer);assert.equal(draft.needsReview,true);
},{legacy:false}));

for(const [name,run]of [['sessions',testReviewCenterApi],['plans',testReviewPlanApi]])test('shared '+name+' API regression on isolated database',{timeout:90000},async()=>fixture(async({base,back})=>run({base,temp:back}),{legacy:false}));
test('shared scheduling calculations remain mode-independent',testReviewSchedulingUnit);
test('shared scheduling API regression',{timeout:90000},async()=>fixture(async({base,ids})=>testReviewSchedulingApi({base,course:{id:ids.courseId}}),{legacy:false}));

function scenario(base,courseId){return `window.COURSES_API_BASE=${JSON.stringify(base)};window.addEventListener('load',async()=>{
  const check=(v,m)=>{if(!v)throw Error(m);};const wait=async(fn)=>{for(let i=0;i<200;i++){if(fn())return;await new Promise(r=>setTimeout(r,30));}throw Error('UI wait timeout');};
  const api=async(method,url,body)=>{const res=await requestApi(API+url,{method,...(body===undefined?{}:{headers:{'Content-Type':'application/json'},body:JSON.stringify(body)})});return res.json();};
  const out=document.createElement('pre');out.id='regressionResult';
  try{
    await wait(()=>typeof allcourses!=='undefined'&&allcourses.some(c=>c.id===${courseId}));await openCourse(${courseId},'冲刺测试','notes');
    if(sessionStorage.getItem('sprint-phase')==='attempt'){
      const noteId=Number(sessionStorage.getItem('sprint-note')),sessionId=Number(sessionStorage.getItem('sprint-session'));
      const session=await api('GET','/courses/${courseId}/review-sessions/'+sessionId);await enterCenterReview(session);
      await openReviewWorkbench('note',noteId,{sessionItemId:session.items[0].id,sessionId});
      check(reviewWorkbench.attempt?.stage==='completed'&&reviewWorkbench.attempt.grade===3,'actual refresh restores submitted attempt');
      await finishWorkbenchAttempt();check(!wb('Dialog').open,'returns to existing queue');
      const history=await api('GET','/courses/${courseId}/review-sessions/'+sessionId);check(history.status==='completed'&&history.passed===1,'normal session finish reused');
      closeReviewCompleteModal();
      for(const mode of ['standard','self_explain','contrast','reading']){
        await openReviewWorkbench('note',noteId);await loadReviewWorkbenchMode(mode);wb('Prompt').value='手动 '+mode+' 任务';
        if(wb('Reference'))wb('Reference').value='参考核对要点';if(wb('Rubric'))wb('Rubric').value='是否覆盖概念与原因';
        if(wb('Objects'))wb('Objects').value=['对象 A','对象 B'].join(String.fromCharCode(10));if(wb('Dimensions'))wb('Dimensions').value=['定义','适用情景'].join(String.fromCharCode(10));
        await saveWorkbenchMaterial();check(!wb('Error').textContent,'manual '+mode+' saved');closeReviewWorkbench();
        const next=await createReviewRecord('total',[{type:'note',id:noteId}]);await enterCenterReview(next);
        await openReviewWorkbench('note',noteId,{sessionItemId:next.items[0].id,sessionId:next.id});await loadReviewWorkbenchMode(mode);await startWorkbenchAttempt();
        if(mode==='self_explain'){
          wb('Answer').value='重开前的首次讲解';await submitWorkbenchAttempt('submit');const oldId=reviewWorkbench.attempt.id;
          await loadReviewWorkbenchMode('retry');await runExistingReviewMode();
          check(reviewWorkbench.attempt.id!==oldId&&reviewWorkbench.attempt.firstAnswer===null,'retry reuses generic engine with a new immutable attempt');
          const old=await api('GET','/courses/${courseId}/review-items/note/'+noteId+'/attempts/'+oldId);check(old.firstAnswer==='重开前的首次讲解','retry retains prior submitted evidence');
        }
        if(mode==='reading'){wb('Answer').value='读完后还有疑问';await submitWorkbenchAttempt('complete');check(reviewWorkbench.attempt.grade===null,'reading UI emits exposure only');}
        else{wb('Answer').value='首次独立作答 '+mode;await submitWorkbenchAttempt('submit');check(reviewWorkbench.attempt.firstAnswer.includes('首次独立'),'open UI keeps first answer');await submitWorkbenchAttempt('judge',2);check(reviewWorkbench.attempt.grade===2,'open UI records Hard');}
        await finishWorkbenchAttempt();closeReviewCompleteModal();
      }
      const mistaken=await api('POST','/courses/${courseId}/mistakes',{title:'标准作答 UI',content:'2+2=?',answerContent:'4',mistakeType:'execution',questionFormat:'open'});
      const standardSession=await createReviewRecord('total',[{type:'mistake',id:mistaken.id}]);await enterCenterReview(standardSession);await wait(()=>mistakeDetailState?.progress?.stage==='question');
      document.getElementById('mistakeFirstAnswer').value='首次算得4';await new Promise(r=>setTimeout(r,40));await submitMistakeReview('reveal_answer');
      check(mistakeDetailState.progress.firstAnswer==='首次算得4'&&mistakeDetailState.progress.answerRevealed,'normal standard saves answer before revealing');
      await openReviewWorkbench('mistake',mistaken.id,{sessionItemId:standardSession.items[0].id,sessionId:standardSession.id});await loadReviewWorkbenchMode('retry');
      const round=mistakeDetailState.progress.round;await runExistingReviewMode();check(!wb('Dialog').open&&mistakeDetailState.progress.round===round+1&&mistakeDetailState.progress.firstAnswer===null,'retry reuses existing engine to start fresh round');
      document.getElementById('mistakeFirstAnswer').value='重做首次为4';await submitMistakeReview('reveal_answer');await submitMistakeReview('judge','correct',true);
      check(mistakeDetailState.progress.durationMs>0,'normal standard records actual elapsed time');
      const state=await api('GET','/courses/${courseId}/review-items/mistake/'+mistaken.id+'/state');check(state.lastGrade===2,'normal standard caps post-answer grade');
      closeReviewCompleteModal();
      for(const multiple of [false,true]){
        const choice=await api('POST','/courses/${courseId}/mistakes',{title:'选择复现保留 '+multiple,content:'选择正确项',mistakeType:'knowledge',questionFormat:'choice',choiceType:multiple?'multiple':'single',options:[{id:'A',text:'甲'},{id:'B',text:'乙'}],correctOption:multiple?['A','B']:'B'});
        const next=await createReviewRecord('total',[{type:'mistake',id:choice.id}]);await enterCenterReview(next);await wait(()=>mistakeDetailState?.progress?.stage==='question');
        check(!document.getElementById('mistakeReviewAnswer')&&mistakeDetailState.progress.choice.correctOption===undefined,'existing choice UI hides answer before submission');
        const selected=multiple?['A','B']:['B'];for(const id of selected)document.querySelector('input[name="mistakeChoiceOption"][value="'+id+'"]').click();
        await submitMistakeChoice();check(mistakeDetailState.progress.choice.correct===true,'existing single/multiple UI still objectively grades');
        const score=await api('GET','/courses/${courseId}/review-items/mistake/'+choice.id+'/state');check(score.lastGrade===3,'objective choice remains Good after post-submit answer display');closeReviewCompleteModal();
      }
      out.dataset.result='passed';out.textContent='sprint UI manual/edit/AI draft/attempt/reload/session passed';document.body.append(out);return;
    }
    const note=await api('POST','/courses/${courseId}/notes',{title:'手动挖空 UI',content:'首都为北京。'});
    await openResourceDetail('note',note.id);check(document.querySelector('[data-review-preparation]'),'normal detail has preparation entry');
    document.querySelector('[data-review-preparation]').click();await wait(()=>wb('Prompt')&&!reviewWorkbench.busy);
    wb('Prompt').value='首都为【b1】';addReviewBlank();let blank=wb('Blanks').querySelector('.review-blank');
    blank.querySelector('[data-blank="answer"]').value='北京';blank.querySelector('[data-blank="aliases"]').value='北京市';blank.querySelector('[data-blank="hint"]').value='中国首都';
    addReviewBlank();removeReviewBlank(wb('Blanks').lastElementChild.querySelector('button'));check(wb('Blanks').children.length===1,'manual add/remove blank');
    await saveWorkbenchMaterial();check(reviewWorkbench.version===1&&!wb('Error').textContent,'manual material saved without AI');
    const original=wb('Prompt').value;await requestWorkbenchDraft();check(wb('Prompt').value===original&&reviewWorkbench.aiDraft,'AI generates separate draft without overwrite');
    await adoptWorkbenchDraft(false);check(wb('Prompt').value===original,'fill-empty preserves manual prompt');undoWorkbenchDraft();
    const bounds=wb('Dialog').getBoundingClientRect();check(bounds.left>=0&&bounds.right<=innerWidth+1&&bounds.top>=0&&bounds.bottom<=innerHeight+1,'workbench fits viewport');
    closeReviewWorkbench();await openReviewWorkbench('note',note.id);check(wb('Prompt').value===original,'saved materials reopen');closeReviewWorkbench();
    const second=await api('POST','/courses/${courseId}/notes',{title:'隔离另一条',content:'不同材料'});await openReviewWorkbench('note',second.id);
    check(reviewWorkbench.version===0&&wb('Prompt').value==='','old editor DOM/draft never leaks to a different content id');closeReviewWorkbench();
    const session=await createReviewRecord('total',[{type:'note',id:note.id}]);await enterCenterReview(session);
    const entry=[...document.querySelectorAll('#centerReviewToolbar button')].find(b=>b.textContent.includes('手动材料'));check(entry,'normal total queue offers mode entry');entry.click();await wait(()=>reviewWorkbench&&!reviewWorkbench.busy&&wb('Actions').textContent.includes('开始'));
    await startWorkbenchAttempt();check(!('answer'in reviewWorkbench.attempt.material.blanks[0]),'practice response hides answer');
    wb('Attempt').querySelector('[data-review-blank]').value='北京市';await submitWorkbenchAttempt('submit');
    check(reviewWorkbench.attempt.grade===3&&reviewWorkbench.attempt.firstAnswer.b1==='北京市','alias correct with first answer recorded');
    sessionStorage.setItem('sprint-note',String(note.id));sessionStorage.setItem('sprint-session',String(session.id));sessionStorage.setItem('sprint-phase','attempt');location.reload();
  }catch(error){out.dataset.result='failed';out.textContent=error.stack;document.body.append(out);}
});`;}
for(const viewport of [[1280,960],[390,844]])test('sprint normal-page manual workflow, mock drafts, HTTP and reload '+viewport.join('x'),{timeout:90000},async()=>fixture(async({base,ids,temp,serve})=>{
  const chrome=['C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(fs.existsSync);assert.ok(chrome);
  new (require('node:vm').Script)(scenario(base,ids.courseId));
  const html=await runBrowser({chrome,profile:path.join(temp,'sprint-profile'),url:await serve(),viewport,blockedUrls:['http://localhost:3000/*','http://127.0.0.1:3000/*'],initScript:scenario(base,ids.courseId)});
  const result=html.match(/<pre id="regressionResult"[^>]*>[\s\S]*?<\/pre>/)?.[0];assert.match(result||'',/data-result="passed"/,result||html.slice(-2000));
},{legacy:false}));
