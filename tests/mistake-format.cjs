// All writes use new temporary databases; never copy personal data/uploads/.env.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),http=require('node:http'),net=require('node:net');
const {spawn,spawnSync}=require('node:child_process');
const {DatabaseSync}=require('node:sqlite');
const {runBrowser}=require('./browser-driver.cjs');
const {testMistakeMigrations,testMistakeApi}=require('./mistake-backend.cjs');
const {testMaterialReviewMigration}=require('./material-review.cjs');
const {testReviewPlanMigrations}=require('./review-plans.cjs');
const {testReviewCenterMigration}=require('./review-center.cjs');
const root=path.resolve(__dirname,'..');
async function stop(child){if(child?.exitCode===null)await new Promise(resolve=>{child.once('exit',resolve);child.kill();});}
async function fixture(run,{legacy=true,setupBackend}={}){
  const temp=fs.mkdtempSync(path.join(os.tmpdir(),'courses-format-')),back=path.join(temp,'back');fs.mkdirSync(back);
  let child,staticServer;
  try{
    for(const file of ['server.js','aiProxy.js','localAiGateway.js','localAiSettings.js','db.js'])fs.copyFileSync(path.join(root,'back',file),path.join(back,file));
    for(const folder of ['db','ai','ocr','officePreview'])fs.cpSync(path.join(root,'back',folder),path.join(back,folder),{recursive:true,filter:p=>fs.statSync(p).isDirectory()||p.endsWith('.js')});
    const env={...process.env,NODE_PATH:path.join(root,'back/node_modules'),AI_PROVIDER:'mock',AI_ENABLE_REAL:'false',OCR_PROVIDER:'mock'};
    delete env.NODE_OPTIONS;delete env.NPM_CONFIG_NODE_OPTIONS;
    if(setupBackend)await setupBackend({back,temp,env});
    const schemaPath=path.join(back,'db/schema.js'),schema=fs.readFileSync(schemaPath,'utf8');
    if(legacy)fs.writeFileSync(schemaPath,schema.replace('CURRENT_DB_VERSION = 26','CURRENT_DB_VERSION = 17').replace('migrateQuestionFormatConfirmation();','').replace('migrateReviewEvidence();','').replace('migrateReviewArtifacts();',''));
    const seed=spawnSync(process.execPath,['-e',`
      const d=require('./db/index.js');const c=d.createCourse('题型隔离测试');
      if(${legacy}){
        const a=d.createMistake(c.id,'旧主观题','','1+1=?','',[],{mistakeType:'knowledge',answerContent:'2'});
        const b=d.createMistake(c.id,'旧选择题','','1+1=?','',[],{mistakeType:'knowledge',questionFormat:'choice',optionsJson:JSON.stringify([{id:'A',text:'1'},{id:'B',text:'2'}]),correctOption:'B',choiceType:'single'});
        d.applyMistakeReview(b.id,{action:'start',requestId:'choice-in-progress',expectedVersion:0},true);
        d.createMistake(c.id,'旧损坏选择题','','1+1=?','',[],{mistakeType:'knowledge',questionFormat:'choice'});
        let p=d.getMistakeReview(a.id);
        for(const step of [{action:'start'},{action:'recall',recall:'clear'},{action:'judge',correct:true}])p=d.applyMistakeReview(a.id,{...step,...(['recall','reveal_answer'].includes(step.action)?{firstAnswer:'测试首次作答'}:{}),requestId:step.action,expectedVersion:p.version},step.action==='start');
        d.createReviewSession(c.id,{requestId:'format-session',sourceType:'total',selectedItems:[{type:'mistake',id:a.id}]});
      }
      console.log(JSON.stringify({courseId:c.id}));d.db.close();
    `],{cwd:back,env,encoding:'utf8',windowsHide:true});
    assert.equal(seed.status,0,seed.stderr);const ids=JSON.parse(seed.stdout.trim());
    const read=fn=>{const db=new DatabaseSync(path.join(back,'data/app.db'),{readOnly:true});try{return fn(db);}finally{db.close();}};
    const protectedTables=['mistake_review_progress','mistake_review_events','review_item_states','review_item_events','review_sessions','review_session_items','review_item_modes','review_plan_items'];
    const snapshot=(tables=protectedTables)=>read(db=>Object.fromEntries(tables.map(name=>[name,db.prepare('SELECT * FROM '+name+' ORDER BY rowid').all()])));
    const before=snapshot();fs.writeFileSync(schemaPath,schema);
    const probe=net.createServer();await new Promise(r=>probe.listen(0,'127.0.0.1',r));const port=probe.address().port;await new Promise(r=>probe.close(r));
    const serverPath=path.join(back,'server.js');fs.writeFileSync(serverPath,fs.readFileSync(serverPath,'utf8').replace(/app\.listen\(3000,\s*(?:listenHost,\s*)?/,`app.listen(${port}, '127.0.0.1', `));
    const base='http://127.0.0.1:'+port+'/api';let logs='';
    const start=async()=>{
      child=spawn(process.execPath,['server.js'],{cwd:back,env,windowsHide:true});
      child.stdout.on('data',x=>{logs+=x;});child.stderr.on('data',x=>{logs+=x;});
      for(let i=0;i<150;i++){try{if((await fetch(base+'/courses')).ok)return;}catch{}await new Promise(r=>setTimeout(r,50));}
      throw Error(logs);
    };
    await start();
    const api=async(method,url,body,status=200)=>{
      const res=await fetch(base+url,{method,...(body===undefined?{}:{headers:{'Content-Type':'application/json'},body:JSON.stringify(body)})});
      const text=await res.text();let data;try{data=JSON.parse(text);}catch{assert.fail(method+' '+url+' returned non-JSON: '+text.slice(0,300));}
      assert.equal(res.status,status,JSON.stringify(data));return data;
    };
    const serve=async()=>{
      const front=path.join(root,'fronted');
      staticServer=http.createServer((req,res)=>{
        const file=path.resolve(front,decodeURIComponent(req.url.split('?')[0]).slice(1)||'index.html');
        if(!file.startsWith(front+path.sep)||! /\.(html|js|css|png|svg)$/.test(file)||!fs.existsSync(file)){res.writeHead(404).end();return;}
        res.setHeader('Content-Type',file.endsWith('.html')?'text/html; charset=utf-8':file.endsWith('.js')?'text/javascript; charset=utf-8':file.endsWith('.css')?'text/css; charset=utf-8':'image/svg+xml');res.end(fs.readFileSync(file));
      });await new Promise(r=>staticServer.listen(0,'127.0.0.1',r));return 'http://127.0.0.1:'+staticServer.address().port+'/';
    };
    await run({temp,back,ids,api,read,snapshot,before,base,serve,restart:async()=>{await stop(child);await start();}});
  }finally{await stop(child);if(staticServer?.listening)await new Promise(r=>staticServer.close(r));fs.rmSync(temp,{recursive:true,force:true,maxRetries:10,retryDelay:100});}
}

test('v17 migration and HTTP confirmation protect review/history; actual format edits retain history',async()=>fixture(async({ids,api,read,snapshot,before,restart})=>{
  const prefix='/courses/'+ids.courseId+'/mistakes',get=id=>api('GET','/mistakes/'+id),patch=(id,body,status)=>api('PATCH',prefix+'/'+id,body,status);
  assert.equal(read(db=>db.prepare('PRAGMA user_version').get().user_version),26);
  const migrated=snapshot();
  for(const [table,rows]of Object.entries(before))assert.deepEqual(migrated[table].map(row=>Object.fromEntries(Object.keys(rows[0]||{}).map(key=>[key,row[key]]))),rows.map(row=>({...row})),'migration preserves existing columns: '+table);
  for(const row of await api('GET',prefix))assert.equal(row.question_format_confirmed,0,'all legacy formats pending, including structured choices');
  const original=await get(1),protectedBefore=snapshot();
  const confirmed=await patch(1,{questionFormatConfirmed:true,expectedRevision:original.review_revision});
  assert.deepEqual({...confirmed,question_format_confirmed:0},original,'only confirmation field changes');
  assert.deepEqual(snapshot(),protectedBefore,'confirmation does not touch progress/grade/session records');
  await patch(2,{questionFormatConfirmed:true});
  assert.deepEqual(snapshot(),protectedBefore,'confirming an active choice round does not reset progress');
  await restart();assert.deepEqual(await get(1),confirmed,'persisted after real restart');
  await patch(1,{questionFormatConfirmed:'true'},400);
  await patch(1,{questionFormatConfirmed:true,expectedRevision:original.review_revision+1},409);
  await patch(3,{questionFormatConfirmed:true},400);
  const body={title:'新主观题',content:'Q',answerContent:'A',mistakeType:'knowledge'};
  const unspecified=await api('POST',prefix,body,201);assert.equal(unspecified.question_format_confirmed,0,'old clients omitting format remain pending');
  const open=await api('POST',prefix,{...body,questionFormat:'open'},201);assert.equal(open.question_format_confirmed,1);
  const choice={questionFormat:'choice',options:[{id:'A',text:'1'},{id:'B',text:'2'}],correctOption:'B',choiceType:'single'};
  const created=await api('POST',prefix,{...body,...choice},201);assert.equal(created.question_format_confirmed,1);
  await api('POST',prefix,{...body,...choice,options:[]},400);
  await patch(1,{...choice,correctOption:'Z'},400);assert.deepEqual(await get(1),confirmed);
  const historyTables=['mistake_review_events','review_item_states','review_item_events','review_sessions','review_session_items','review_item_modes','review_plan_items'];
  const history=snapshot(historyTables);
  const changed=await patch(1,{...choice,expectedRevision:confirmed.review_revision});
  assert.equal(changed.question_format_confirmed,1);assert.equal(changed.review_revision,confirmed.review_revision+1);assert.equal(changed.review_status,'unreviewed');
  assert.equal(read(db=>db.prepare('SELECT stage FROM mistake_review_progress WHERE mistake_id=1').get().stage),'idle');
  assert.deepEqual(snapshot(historyTables),history,'real type edit resets current progress only, not historical grades/sessions');
  let progress=await api('GET',prefix+'/'+created.id+'/review');
  progress=await api('POST',prefix+'/'+created.id+'/review',{action:'start',requestId:'new-choice-start',expectedVersion:progress.version});
  assert.equal(progress.answer,null);assert.equal(progress.choice.correctOption,undefined);
  progress=await api('POST',prefix+'/'+created.id+'/review/events',{action:'choose',selectedOption:'B',durationMs:500,requestId:'new-choice-answer',expectedVersion:progress.version});
  assert.equal(progress.reviewStatus,'reviewed');assert.equal(progress.choice.correct,true);
  const repeat=snapshot();await patch(created.id,{questionFormat:'choice',...choice,questionFormatConfirmed:true});assert.deepEqual(snapshot(),repeat,'confirm unchanged choice does not reset anything');
  await api('DELETE','/mistakes/'+open.id);await api('GET','/mistakes/'+open.id,undefined,404);
}));

function browserScenario(base,courseId){return `window.COURSES_API_BASE=${JSON.stringify(base)};window.addEventListener('load',async()=>{
  const check=(ok,message)=>{if(!ok)throw Error(message);};
  const wait=async(fn)=>{for(let i=0;i<160;i++){if(fn())return;await new Promise(r=>setTimeout(r,30));}throw Error('waiting for UI');};
  const card=id=>document.querySelector('#mistakeList [data-mistake-id="'+id+'"]');
  const result=document.createElement('pre');result.id='regressionResult';
  try{
    await wait(()=>typeof allcourses!=='undefined'&&allcourses.some(c=>c.id===${courseId}));
    await openCourse(${courseId},'题型隔离测试','mistakes');await openMistakeCategory('knowledge');
    if(sessionStorage.getItem('format-phase')==='saved'){
      check(card(1).querySelector('.mistake-format').textContent.includes('主观题'),'confirmed open restores on reload');
      check(card(2).querySelector('.mistake-format').textContent.includes('选择题')&&!card(2).querySelector('[data-format-confirm]'),'confirmed choice restores on reload');
      await openMistakeDetail(2);check(document.getElementById('mistakeDetailFormat').textContent.includes('选择题'),'detail restores after reload');
      await openMistakeEdit();check(document.getElementById('mistakeEditFormatConfirmed').checked,'editor restores confirmation');closeMistakeEdit();
      result.dataset.result='passed';result.textContent='format confirmation real HTTP/reload desktop/mobile passed';document.body.append(result);return;
    }
    check(card(1).textContent.includes('题型待确认')&&card(2).textContent.includes('题型待确认'),'legacy open and choice both pending');
    const before=await (await fetch(API+'/courses/${courseId}/mistakes/1/review')).json();
    card(1).querySelector('[data-format-confirm]').click();await wait(()=>card(1).querySelector('.mistake-format').textContent==='主观题');
    const after=await (await fetch(API+'/courses/${courseId}/mistakes/1/review')).json();check(JSON.stringify(after)===JSON.stringify(before),'real confirmation preserves completed review');
    await openMistakeDetail(1);check(document.getElementById('mistakeDetailFormat').textContent==='主观题','detail immediately sees confirmed badge');
    await openMistakeDetail(2);check(document.getElementById('mistakeDetailFormat').textContent.includes('题型待确认'),'ordinary detail pending badge');
    await editMistakeFormatAsChoice(2);check(document.getElementById('mistakeEditModal').classList.contains('show')&&document.getElementById('mistakeEditFormat').value==='choice','existing editor reused for choice');
    check(document.getElementById('mistakeEditFormatConfirmed').checked,'explicit choice entry marks confirmed');
    setMistakeChoiceEditor('Edit',[{id:'A',text:'1'},{id:'B',text:'2'}],'','single');await saveMistakeDetail();
    check(mistakeEditPending&&document.getElementById('mistakeEditError').textContent,'missing correct option blocks save');
    setMistakeChoiceEditor('Edit',[{id:'A',text:'1'},{id:'B',text:'2'}],'B','single');await saveMistakeDetail();
    check(!mistakeEditPending&&document.getElementById('mistakeDetailFormat').textContent==='选择题'&&card(2).querySelector('.mistake-format').textContent==='选择题','save closes existing editor and updates both detail and list');
    await openMistakeEdit();check(document.getElementById('mistakeEditFormatConfirmed').checked,'reopen editor restores');closeMistakeEdit();
    await openMistakeDetail(3);await openMistakeEdit();check(!document.getElementById('mistakeEditFormatConfirmed').checked,'unconfirmed restores unchecked');closeMistakeEdit();
    await openCourse(${courseId},'题型隔离测试','mistakes');await openMistakeCategory('knowledge');
    for(const format of ['open','choice']){
      await openMistakeCreate();document.getElementById('tagPickerName').value='新增题型 '+format;
      document.getElementById('mistakeCreateType').value='knowledge';document.getElementById('mistakeCreateContent').value='1+1=?';
      document.getElementById('mistakeCreateAnswer').value='2';document.getElementById('mistakeCreateFormat').value=format;
      if(format==='choice')setMistakeChoiceEditor('Create',[{id:'A',text:'1'},{id:'B',text:'2'}],'B','single');toggleMistakeChoiceFields('Create');
      await confirmTagPicker();check(!tagPickerState,'original create closes');
      const row=currentMistakes.find(item=>item.title==='新增题型 '+format);
      check(row?.question_format_confirmed===1&&card(row.id).querySelector('.mistake-format').textContent===(format==='choice'?'选择题':'主观题'),'newly submitted format shows confirmed badge');
    }
    const newOpen=currentMistakes.find(item=>item.title==='新增题型 open');
    await editMistakeFromList(newOpen.id);document.getElementById('mistakeEditFormat').value='choice';markMistakeFormatSelected();toggleMistakeChoiceFields('Edit');
    setMistakeChoiceEditor('Edit',[{id:'A',text:'1'},{id:'B',text:'2'}],'B','single');
    let saving=saveMistakeDetail();await wait(()=>document.getElementById('confirmModal').classList.contains('show'));
    check(document.getElementById('confirmMsg').textContent.includes('历史评分'),'type edit explains preserved history');
    const confirmButton=document.querySelector('#confirmModal .btn-confirm');
    const isOnTop=button=>{const rect=button.getBoundingClientRect();return button.contains(document.elementFromPoint(rect.x+rect.width/2,rect.y+rect.height/2));};
    await wait(()=>getComputedStyle(document.getElementById('confirmModal')).opacity==='1');
    check(isOnTop(confirmButton)&&isOnTop(document.querySelector('#confirmModal .btn-cancel')),'confirmation buttons appear above editor and receive pointer events');
    document.querySelector('#confirmModal .btn-cancel').click();await saving;
    check(mistakeEditPending&&currentMistakes.find(item=>item.id===newOpen.id).question_format==='open','cancel does not change format');
    check(document.getElementById('mistakeEditModal').classList.contains('show')&&document.getElementById('mistakeEditFormat').value==='choice','cancel returns to populated editor');
    check(document.getElementById('mistakeEditModal').querySelectorAll('.choice-option-input')[1].value==='2','cancel retains choice option input');
    saving=saveMistakeDetail();await wait(()=>document.getElementById('confirmModal').classList.contains('show'));confirmButton.click();await saving;
    check(!mistakeEditPending&&card(newOpen.id).querySelector('.mistake-format').textContent==='选择题','confirmed actual type edit updates list immediately');
    check(document.documentElement.scrollWidth<=innerWidth+1,'layout fits viewport');
    sessionStorage.setItem('format-phase','saved');location.reload();
  }catch(error){result.dataset.result='failed';result.textContent=error.stack;document.body.append(result);}
});`;}

for(const viewport of [[1280,960],[390,844]])test('format list/detail/edit and actual reload '+viewport.join('x'),{timeout:90000},async()=>fixture(async({base,ids,temp,serve})=>{
  const chrome=['C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(fs.existsSync);assert.ok(chrome);
  const html=await runBrowser({chrome,profile:path.join(temp,'browser'),url:await serve(),viewport,blockedUrls:['http://localhost:3000/*','http://127.0.0.1:3000/*'],initScript:browserScenario(base,ids.courseId)});
  const result=html.match(/<pre id="regressionResult"[^>]*>[\s\S]*?<\/pre>/)?.[0];assert.match(result||'',/data-result="passed"/,result||html.slice(-2000));
}));

test('existing mistake API create/edit/delete/review regression on fresh isolated data',{timeout:90000},async()=>fixture(async({api,ids,base,restart})=>{
  const child=await api('POST','/courses/'+ids.courseId+'/knowledge-nodes',{name:'child',type:'knowledge'},201);
  const otherCourse=await api('POST','/courses',{name:'other'},201);
  const other=await api('POST','/courses/'+otherCourse.id+'/knowledge-nodes',{name:'foreign',type:'knowledge'},201);
  await testMistakeApi({base,course:{id:ids.courseId},child,other,restart});
},{legacy:false}));

test('existing fresh and legacy database migration regression',()=>{
  const temp=fs.mkdtempSync(path.join(os.tmpdir(),'courses-format-migrations-'));
  try{testMistakeMigrations(path.join(root,'back'),temp);}finally{fs.rmSync(temp,{recursive:true,force:true,maxRetries:5,retryDelay:100});}
});

for(const [name,run] of [['materials/notes',testMaterialReviewMigration],['review plans',testReviewPlanMigrations],['review sessions',testReviewCenterMigration]])test('existing '+name+' migration regression',()=>{
  const temp=fs.mkdtempSync(path.join(os.tmpdir(),'courses-format-migrations-'));
  try{run(path.join(root,'back'),temp);}finally{fs.rmSync(temp,{recursive:true,force:true,maxRetries:5,retryDelay:100});}
});
module.exports={fixture};
