// Fake credentials/upstream, temporary business database, no .env or real model.
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),vm=require('node:vm');
const {fixture}=require('./mistake-format.cjs'),{runBrowser}=require('./browser-driver.cjs');
const root=path.resolve(__dirname,'..');
function settings(){
  const events={},ctx=vm.createContext({document:{readyState:'loading',getElementById:()=>null},addEventListener:(n,f)=>events[n]=f,
    AbortController,setTimeout,clearTimeout,URL,console});
  vm.runInContext(fs.readFileSync(path.join(root,'fronted/js/aiSettings.js'),'utf8'),ctx);
  return {service:vm.runInContext('coursesAiSettings',ctx),events,ctx};
}
const config={provider:'deepseek',model:'deepseek-flash',apiKey:'synthetic-shared-key',consent:true,retain:true,auto:false};
test('shared AI settings retain only opt-in tab credentials, never expose them in status',()=>{
  const {service:s,events}=settings();assert.equal(s.status().auto,false);assert.equal(s.read(),null);
  assert.throws(()=>s.configure({...config,consent:false}));assert.throws(()=>s.configure({...config,auto:true,retain:false}));
  assert.throws(()=>s.configure({...config,auto:true,consent:false}));
  s.configure({...config,auto:true});assert.equal(s.status().auto,true,'single consent covers explicitly enabled auto analysis');
  s.configure(config);assert.equal(s.status().auto,false,'consent alone never enables automatic analysis');
  s.configure({...config,retain:false});const once=s.read();assert.equal(once.apiKey,config.apiKey);assert.throws(()=>s.read(),/没有 Key/);
  assert.ok(!JSON.stringify(s.status()).includes(config.apiKey));s.configure(config);assert.equal(s.read().apiKey,s.read().apiKey);
  let cancelled=0;const lease=s.read();s.track(lease,()=>cancelled++);events['courses-ai-identity-changed']();
  assert.equal(cancelled,1);assert.equal(s.valid(lease),false);assert.equal(s.status().hasKey,false);assert.equal(s.status().provider,'deepseek');
  assert.throws(()=>s.read(),/没有 Key/);s.configure(config);events.pagehide();assert.equal(s.status().hasKey,false);
  assert.equal(settings().service.status().hasKey,false,'a fresh document cannot restore credentials or auto consent');
  const limited=settings().service;limited.configure(config);for(let i=0;i<20;i++)limited.read();assert.throws(()=>limited.read(),/20 次/);
  limited.configure(config);assert.throws(()=>limited.read(),/20 次/,'reconfiguring cannot reset the safety budget');
});
test('shared AI automatic analysis is once-only, opt-in, complete-input-only and never adopts',async()=>{
  const {service:s,ctx}=settings();let calls=0;
  ctx.classifyMistakeWithAi=async()=>{calls++;return {review_method:'standard',reason:'draft',needs_review:true};};
  const row={id:1,course_id:1,title:'fiction'},capture=()=>({epoch:s.status().epoch,input:{question:'1+1=?',student_answer:'1'}});
  await s.afterCreated(row,capture());assert.equal(calls,0);
  s.configure({...config,auto:true});const input=capture();
  await Promise.all([s.afterCreated(row,input),s.afterCreated(row,input)]);assert.equal(calls,1);assert.equal(s.status().drafts,1);
  await s.afterCreated({...row,id:2},{epoch:s.status().epoch,input:{question:'1+1=?'}});assert.equal(calls,1);
  const old=capture();s.configure({...config,auto:true});await s.afterCreated({...row,id:3},old);assert.equal(calls,1);
  ctx.classifyMistakeWithAi=async()=>{calls++;throw Error('fake failure');};
  const failing=capture();await s.afterCreated({...row,id:4},failing);await s.afterCreated({...row,id:4},failing);assert.equal(calls,2);
  s.clear();assert.equal(s.status().drafts,0);assert.equal(s.status().auto,false);
});
test('shared AI website settings work across entries, automatic drafts protect existing records',{timeout:90000},async()=>fixture(async({base,api,ids,temp,serve,snapshot})=>{
  const row=await api('POST',`/courses/${ids.courseId}/mistakes`,{title:'共享设置测试',content:'1+1=?',answerContent:'2',questionFormat:'open',mistakeType:'thinking'},201);
  const before=snapshot(),url=await serve();
  const chrome=['C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Google/Chrome/Application/chrome.exe'].find(fs.existsSync);assert.ok(chrome);
  for(const [index,viewport]of [[1280,960],[390,844]].entries()){
    const initScript=`window.COURSES_API_BASE=${JSON.stringify(base)};window.COURSES_AI_API_BASE='/api';window.COURSES_AI_LOCAL_MOCK=true;
 const originalFetch=fetch;let aiCalls=[],delay=false;
 const result={review_method:'self_explain',reason:'候选理由 <img src=x>',needs_review:true,analysis:{answer_status:'incorrect',observations:['答案不同'],possible_causes:[],follow_up_questions:['请补充过程'],reference_check:'待核验',alternatives:[],material_requirements:['需要讲解要点材料']}};
 window.fetch=async(url,options)=>{
  if(String(url).includes('/api/ai/')){
   const body=JSON.parse(options.body);aiCalls.push({url:String(url),body});
   if(delay)await new Promise(r=>setTimeout(r,100));
   if(String(url).includes('answer-draft'))return new Response(JSON.stringify({provider:'deepseek',draft:{answer:'2',explanation:'两个一相加',choice_answer:[],caveats:[],needs_more_information:false,needs_review:true}}));
   return new Response(JSON.stringify({ok:true,provider:'deepseek',model:body.model,action:body.action,...(body.action==='classify'?{result}:{})}));
  }return originalFetch(url,options);
 };
 addEventListener('load',async()=>{
  const out=document.createElement('pre');out.id='regressionResult';const el=id=>document.getElementById(id),check=(x,m)=>{if(!x)throw Error(m);};
  const configure=(auto=false)=>{coursesAiSettings.open();el('coursesAiProvider').value='deepseek';el('coursesAiKey').value='synthetic-shared-key';el('coursesAiRetain').checked=true;el('coursesAiConsent').checked=true;el('coursesAiAuto').checked=auto;el('coursesAiApply').click();el('coursesAiClose').click();};
  try{
   check(el('coursesAiOpen')&&!coursesAiSettings.status().auto&&aiCalls.length===0,'global entry and auto off, no load call');
   coursesAiSettings.open();
   check(el('coursesAiModel').value===''&&el('coursesAiModel').disabled,'Mock leaves model visibly blank and disabled');
   el('coursesAiApply').click();check(coursesAiSettings.status().configured&&coursesAiSettings.status().provider==='mock'&&aiCalls.length===0,'blank Mock model can be applied without requests');
   el('coursesAiProvider').value='deepseek';el('coursesAiProvider').dispatchEvent(new Event('change'));
   check(!el('coursesAiModel').disabled&&el('coursesAiModel').value==='deepseek-flash','DeepSeek selection reveals supported model');
   el('coursesAiModel').value='deepseek-v4-pro';el('coursesAiProvider').value='mock';el('coursesAiProvider').dispatchEvent(new Event('change'));
   check(el('coursesAiModel').value===''&&el('coursesAiModel').disabled,'switching back to Mock clears displayed model');
   el('coursesAiProvider').value='deepseek';el('coursesAiProvider').dispatchEvent(new Event('change'));
   check(el('coursesAiModel').value==='deepseek-v4-pro'&&aiCalls.length===0,'switching restores pending model without sending a request');el('coursesAiClose').click();
   check(!el('coursesAiAutoConsent')&&el('coursesAiDialog').querySelectorAll('input[type=checkbox]').length===3,'one merged consent and two independent preference switches');
   coursesAiSettings.open();el('coursesAiProvider').value='deepseek';el('coursesAiKey').value='synthetic-shared-key';el('coursesAiRetain').checked=true;el('coursesAiAuto').checked=true;el('coursesAiApply').click();
   check(coursesAiSettings.status().provider==='mock'&&!coursesAiSettings.status().auto&&aiCalls.length===0,'auto analysis cannot bypass merged consent');el('coursesAiClose').click();
   configure();check(coursesAiSettings.status().hasKey&&!el('coursesAiKey').value,'masked memory credential');
   el('coursesAiOpen').click();el('coursesAiTest').click();while(el('coursesAiTest').disabled)await new Promise(r=>setTimeout(r,10));
   check(el('coursesAiMessage').textContent.includes('成功'),'connection uses shared settings');el('coursesAiClose').click();
   await openCourse(${ids.courseId},'共享设置测试','mistakes');check(el('coursesAiOpen').getBoundingClientRect().width>0,'entry on course page');
   await openMistakeDetail(${row.id},false);toggleMistakeAi();check(mistakeAiElement('Provider').value==='shared','detail defaults shared');
   mistakeAiElement('StudentAnswer').value='1';await requestMistakeAi();check(mistakeAiState.result?.analysis&&coursesAiSettings.status().hasKey,'detail uses shared retained Key');resetMistakeAi();
   await openMistakeEdit();toggleMistakeAnswerAi('Edit');check(answerAiNode('Edit','Provider').value==='shared','answer editor uses shared');
   await generateMistakeAnswerAi('Edit');check(answerAiNode('Edit','Answer').value==='2'&&el('mistakeEditAnswer').value==='2','answer draft generated, not adopted');closeMistakeEdit();
   const count=aiCalls.length;configure(true);await openMistakeCreate();el('tagPickerName').value='自动草稿${index}';el('mistakeCreateContent').value='1+1=?';el('mistakeCreateAnswer').value='2';el('mistakeCreateType').value='thinking';
   el('mistakeCreateAiStudentAnswer').value='1';mistakeCreateAiElement('Method').value='standard';changeMistakeCreateAiMethod();
   const captured=coursesAiSettings.captureCreation();await confirmTagPicker();
   for(let i=0;i<100&&!coursesAiSettings.status().drafts;i++)await new Promise(r=>setTimeout(r,10));
   const rows=await(await requestApi(API+'/courses/${ids.courseId}/mistakes')).json(),created=rows.find(r=>r.title==='自动草稿${index}');
   check(created&&aiCalls.length===count+1,'save triggers one call');await coursesAiSettings.afterCreated(created,captured);check(aiCalls.length===count+1,'duplicate save notification no repeat');
   check(readMistakeAiMethod({courseId:${ids.courseId},id:created.id})==='standard','automatic draft never overwrites manual choice');
   coursesAiSettings.open();const view=el('coursesAiDrafts').querySelector('button');check(view?.textContent.includes('查看'),'draft view available');view.click();
   check(mistakeAiState.result.review_method==='self_explain'&&mistakeAiElement('Method').value==='standard','draft preview reuses panel and preserves manual selection');resetMistakeAi();
   check(!document.querySelector('#mistakeAiAnalysis img'),'model content remains text');
   const beforeMissing=aiCalls.length;await openMistakeCreate();el('tagPickerName').value='没有学生作答${index}';el('mistakeCreateContent').value='1+1=?';await confirmTagPicker();
   check(aiCalls.length===beforeMissing,'missing student answer never fabricated');
   await openMistakeDetail(${row.id},false);toggleMistakeAi();mistakeAiElement('StudentAnswer').value='1';delay=true;
   const pending=requestMistakeAi();coursesAiSettings.clear();await pending;check(!mistakeAiState.result,'clear cancels late responses');
   delay=false;const atClear=aiCalls.length;await requestMistakeAi();check(aiCalls.length===atClear&&mistakeAiElement('Error').textContent.includes('没有 Key'),'cleared real config cannot fall back to Mock');resetMistakeAi();
   check(!JSON.stringify(localStorage).includes('synthetic-shared-key')&&!JSON.stringify(sessionStorage).includes('synthetic-shared-key'),'no credential storage');
   coursesAiSettings.open();check(!el('coursesAiKey').value&&!coursesAiSettings.status().auto,'clear invalidates automatic consent');
   check(!el('coursesAiConsent').checked,'opening requires renewed confirmation before applying real settings');
   const dialog=el('coursesAiDialog'),body=dialog.querySelector('.ai-settings-body');
   check(dialog.scrollHeight<=dialog.clientHeight+1&&body.scrollHeight>body.clientHeight,'only settings body scrolls; header and actions remain available');
   check(el('coursesAiConsent').getBoundingClientRect().width<=20,'checkbox retains compact size');
   check(el('coursesAiApply').getBoundingClientRect().bottom<=innerHeight&&el('coursesAiApply').getClientRects().length,'apply action visible without scrolling');
   check(document.documentElement.scrollWidth<=innerWidth+1,'mobile fits');out.dataset.result='passed';out.textContent='passed';
  }catch(e){out.dataset.result='failed';out.textContent=e.stack;}document.body.append(out);
 });`;
    const html=await runBrowser({chrome,profile:path.join(temp,'settings-'+index),url,viewport,initScript,
      blockedUrls:['https://api.deepseek.com/*','http://127.0.0.1:3000/*','http://localhost:3000/*'],screenshot:path.join(os.tmpdir(),'courses-ai-settings-'+viewport.join('x')+'.png')});
    const result=html.match(/<pre id="regressionResult"[^>]*>[\s\S]*?<\/pre>/)?.[0];assert.match(result||'',/data-result="passed"/,result||html.slice(-1500));
  }
  assert.deepEqual(snapshot(),before,'AI configuration and drafts never write grades, sessions or plans');
},{legacy:false}));


test('custom compatible settings isolate credentials and preserve cancellation',()=>{
  const {service:s}=settings();
  const custom={...config,provider:'compatible',baseUrl:'https://models.example/v1',model:'vendor/model-v2'};
  for(const change of [{baseUrl:'http://example.com'},{baseUrl:'https://user:secret@example.com'},{model:'bad model'},{consent:false}])assert.throws(()=>s.configure({...custom,...change}));
  s.configure({...custom,retain:false});const once=s.read();assert.equal(once.provider,'compatible');assert.equal(once.baseUrl,custom.baseUrl);assert.equal(once.model,custom.model);assert.throws(()=>s.read(),/没有 Key/);
  assert.ok(!JSON.stringify(s.status()).includes(config.apiKey));
  s.configure(custom);const lease=s.read();let cancelled=false;s.track(lease,()=>cancelled=true);
  s.configure(config);assert.ok(cancelled);assert.equal(s.valid(lease),false);assert.equal(s.read().provider,undefined);
});

test('custom API settings work in desktop and mobile UI',{timeout:90000},async()=>fixture(async({base,temp,serve})=>{
  const url=await serve();
  const chrome=['C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Google/Chrome/Application/chrome.exe'].find(fs.existsSync);assert.ok(chrome);
  for(const [i,viewport]of [[1280,960],[390,844]].entries()){
    const initScript=`window.COURSES_API_BASE=${JSON.stringify(base)};window.COURSES_AI_API_BASE='/api';
      const originalFetch=fetch;let hits=[];
      window.fetch=async(url,options)=>{if(String(url).includes('/api/ai/')){const body=JSON.parse(options.body);hits.push(body);return new Response(JSON.stringify({ok:true,provider:body.provider,model:body.model,action:body.action}));}return originalFetch(url,options);};
      addEventListener('load',async()=>{const out=document.createElement('pre');out.id='regressionResult';const el=id=>document.getElementById('coursesAi'+id),check=(v,m)=>{if(!v)throw Error(m);};try{
        coursesAiSettings.open();el('Provider').value='compatible';el('Provider').dispatchEvent(new Event('change'));
        check(!el('Custom').hidden&&el('ModelLabel').hidden,'custom fields visible');
        el('BaseUrl').value='https://models.example/v1';el('CustomModel').value='vendor/model-v2';el('Key').value='synthetic-custom-key';el('Retain').checked=true;el('Consent').checked=true;el('Apply').click();
        check(coursesAiSettings.status().provider==='compatible'&&el('Key').value==='','applied custom config, key hidden');
        el('Test').click();while(el('Test').disabled)await new Promise(r=>setTimeout(r,20));
        check(hits.length===1&&hits[0].provider==='compatible'&&hits[0].base_url==='https://models.example/v1'&&hits[0].model==='vendor/model-v2','custom credentials delivered only to same origin');
        check(el('Message').textContent.includes('成功'),'custom connection test');
        el('Close').click();coursesAiSettings.open();check(el('CustomModel').value==='vendor/model-v2'&&el('BaseUrl').value==='https://models.example/v1','reopen restores endpoint and model');
        el('BaseUrl').value='https://other.example/v1';el('Consent').checked=true;el('Apply').click();check(coursesAiSettings.status().baseUrl==='https://models.example/v1','cannot reuse hidden key for another endpoint');
        el('Clear').click();check(!coursesAiSettings.status().hasKey,'clear key');
        check(document.documentElement.scrollWidth<=innerWidth+1,'no horizontal overflow');out.textContent='PASS';
      }catch(e){out.textContent='FAIL '+e.stack;}document.body.append(out);});`;
    const html=await runBrowser({chrome,profile:path.join(temp,'custom-'+i),url,viewport,initScript,blockedUrls:['https://models.example/*','https://other.example/*']});
    assert.match(html,/<pre id="regressionResult">PASS<\/pre>/);
  }
}));


test('shared source names follow credentials rather than a fixed vendor',()=>{
 const {service:s}=settings();
 const glm={...config,provider:'compatible',baseUrl:'https://open.bigmodel.cn/api/paas/v4',model:'glm-5.3-flash'};
 s.configure(glm);assert.match(s.label(),/智谱 GLM \/ glm-5.3-flash/);assert.match(s.describe(s.read()),/智谱 GLM/);
 s.configure(config);assert.match(s.describe(s.read()),/DeepSeek 官方/);
 s.configure({...glm,baseUrl:'https://example.com/v1'});assert.match(s.describe(s.read()),/自定义兼容接口/);
});
