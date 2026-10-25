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
   el('coursesAiApply').click();check(!coursesAiSettings.status().configured&&coursesAiSettings.status().provider==='mock'&&aiCalls.length===0,'unconfigured selection cannot apply or issue requests');
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
   await openMistakeDetail(${row.id},false);toggleMistakeAi();check(mistakeAiElement('Source').textContent.includes('DeepSeek'),'detail displays shared source');
   mistakeAiElement('StudentAnswer').value='1';await requestMistakeAi();check(mistakeAiState.result?.analysis&&coursesAiSettings.status().hasKey,'detail uses shared retained Key');resetMistakeAi();
   await openMistakeEdit();toggleMistakeAnswerAi('Edit');check(answerAiNode('Edit','Source').textContent.includes('DeepSeek'),'answer editor displays shared source');
   await generateMistakeAnswerAi('Edit');check(answerAiNode('Edit','Answer').value==='2'&&el('mistakeEditAnswer').value==='2','answer draft generated, not adopted');closeMistakeEdit();
   const count=aiCalls.length;configure(true);await openMistakeCreate();el('tagPickerName').value='自动草稿${index}';el('mistakeCreateContent').value='1+1=?';el('mistakeCreateAnswer').value='2';el('mistakeCreateType').value='thinking';
   el('mistakeCreateAiStudentAnswer').value='1';mistakeCreateAiElement('Method').value='standard';changeMistakeCreateAiMethod();
   const captured=coursesAiSettings.captureCreation();await confirmTagPicker();
   for(let i=0;i<100&&!coursesAiSettings.status().drafts;i++)await new Promise(r=>setTimeout(r,10));
   const rows=await(await requestApi(API+'/courses/${ids.courseId}/mistakes')).json(),created=rows.find(r=>r.title==='自动草稿${index}');
   check(created&&aiCalls.length===count+1,'save triggers one call');await coursesAiSettings.afterCreated(created,captured);check(aiCalls.length===count+1,'duplicate save notification no repeat');
   check(readMistakeAiMethod({courseId:${ids.courseId},id:created.id})==='standard','automatic draft never overwrites manual choice');
   coursesAiSettings.openDrafts();const view=el('coursesAiDrafts').querySelector('button');check(view?.textContent.includes('查看'),'draft view available');view.click();
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
   check(dialog.scrollHeight<=dialog.clientHeight+1&&body.clientHeight>0,'compact settings contain any overflow in body; actions remain available');
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
 s.configure(glm);assert.match(s.label(),/GLM（智谱） \/ glm-5.3-flash/);assert.equal(s.describe(s.read()),'GLM / glm-5.3-flash');
 s.configure(config);assert.equal(s.describe(s.read()),'DeepSeek / '+config.model);
 s.configure({...glm,baseUrl:'https://example.com/v1'});assert.match(s.describe(s.read()),/自定义兼容接口/);
});


test('domestic presets fill endpoints and models without sharing keys across services',{timeout:90000},async()=>fixture(async({temp,serve})=>{
 const url=await serve(),chrome=['C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Google/Chrome/Application/chrome.exe'].find(fs.existsSync);assert.ok(chrome);
 for(const [i,viewport]of [[1280,960],[390,844]].entries()){
  const script=`window.COURSES_AI_API_BASE='/api';const oldFetch=fetch;let hits=[];fetch=(url,options)=>{if(String(url).includes('/api/ai/test')){const body=JSON.parse(options.body);hits.push(body);return Promise.resolve(new Response(JSON.stringify({ok:true,provider:body.provider||'deepseek',model:body.model,action:'connection'})));}return oldFetch(url,options);};
  addEventListener('load',async()=>{const out=document.createElement('pre');out.id='regressionResult';const el=id=>document.getElementById('coursesAi'+id),check=(v,m)=>{if(!v)throw Error(m);};try{
   coursesAiSettings.open();const cases=[['zhipu','https://open.bigmodel.cn/api/paas/v4','GLM（智谱）'],['deepseek','', 'DeepSeek（深度求索）'],['qwen','https://dashscope.aliyuncs.com/compatible-mode/v1','通义千问'],['kimi','https://api.moonshot.cn/v1','Kimi'],['doubao','https://ark.cn-beijing.volces.com/api/v3','豆包'],['siliconflow','https://api.siliconflow.cn/v1','硅基流动']];
   for(const [id,base,label]of cases){
    el('Key').value='must-clear-on-change';el('Consent').checked=true;el('Provider').value=id;el('Provider').dispatchEvent(new Event('change'));
    check(!el('Key').value&&!el('Consent').checked,'switch clears unsubmitted key and consent');
    if(base){check(!el('Advanced').open&&!el('ModelPickLabel').hidden&&el('CustomModelLabel').hidden,'preset shows only model picker '+id);check(el('BaseUrl').value===base,'endpoint for '+id);check(el('CustomModel').value&&el('ModelPick').options.length>1,'model suggestions '+id);}
    el('Key').value='synthetic-'+id;el('Retain').checked=true;el('Consent').checked=true;const before=hits.length;el('Apply').click();
    check(hits.length===before&&coursesAiSettings.status().preset===id,'apply does not call model '+id);
    check(el('Applied').textContent.includes(label),'effective label '+id);check(el('Applied').textContent.includes(el('Provider').selectedOptions[0].textContent),'preset and applied name agree '+id);check(coursesAiSettings.describe(coursesAiSettings.read()).split(' / ')[0]===el('Provider').selectedOptions[0].textContent.split('（')[0],'request uses short AI name '+id);check(!el('Key').value,'applied key masked');
    el('Test').click();while(el('Test').disabled)await new Promise(r=>setTimeout(r,20));check(hits.length===before+1&&el('Message').textContent.includes('成功'),'connection '+id);
    check(hits.at(-1).api_key==='synthetic-'+id,'own key '+id);if(base)check(hits.at(-1).base_url===base,'payload endpoint '+id);
    el('Close').click();coursesAiSettings.open();check(el('Provider').value===id,'reopens chosen preset '+id);
   }
   el('Provider').value='doubao';el('Provider').dispatchEvent(new Event('change'));el('CustomModel').value='ep-my-own-endpoint';el('Key').value='synthetic-ep';el('Consent').checked=true;el('Apply').click();check(coursesAiSettings.status().model==='ep-my-own-endpoint','manual endpoint ID');
   el('Provider').value='qwen';el('Provider').dispatchEvent(new Event('change'));el('Consent').checked=true;el('Apply').click();check(coursesAiSettings.status().preset==='doubao'&&el('Message').textContent.includes('Key'),'old service key cannot apply to another preset');
   check(!JSON.stringify(localStorage).includes('synthetic-')&&!JSON.stringify(sessionStorage).includes('synthetic-'),'no persisted credentials');
   check(document.documentElement.scrollWidth<=innerWidth+1,'mobile does not overflow');out.textContent='PASS';
  }catch(e){out.textContent='FAIL '+e.stack;}document.body.append(out);});`;
  const html=await runBrowser({chrome,profile:path.join(temp,'domestic-'+i),url,viewport,initScript:script});
  const result=html.match(/<pre id="regressionResult">[\s\S]*?<\/pre>/)?.[0];assert.match(result||'',/>PASS</,result||'no result');
 }
}));


test('foreign presets keep account verification explicit and isolate optional Claude workspace',{timeout:90000},async()=>fixture(async({temp,serve})=>{
 const url=await serve(),chrome=['C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Google/Chrome/Application/chrome.exe'].find(fs.existsSync);assert.ok(chrome);
 for(const [i,viewport]of [[1280,960],[390,844]].entries()){
  const script=`window.COURSES_AI_API_BASE='/api';const originalFetch=fetch;let hits=[];fetch=(url,options)=>{if(String(url).includes('/api/ai/test')){const body=JSON.parse(options.body);hits.push(body);return Promise.resolve(new Response(JSON.stringify({ok:true,provider:'compatible',model:body.model,action:'connection'})));}return originalFetch(url,options);};
  addEventListener('load',async()=>{const out=document.createElement('pre');out.id='regressionResult';const el=id=>document.getElementById('coursesAi'+id),check=(v,m)=>{if(!v)throw Error(m);};try{
   coursesAiSettings.open();const cases=[['openai','https://api.openai.com/v1','OpenAI'],['gemini','https://generativelanguage.googleapis.com/v1beta/openai','Gemini（Google）'],['claude','https://api.anthropic.com/v1','Claude'],['grok','https://api.x.ai/v1','Grok']];
   for(const [id,base,label]of cases){
    el('Provider').value=id;el('Provider').dispatchEvent(new Event('change'));check(el('BaseUrl').value===base,'endpoint '+id);check(!el('Advanced').open&&!el('ModelPickLabel').hidden&&el('CustomModelLabel').hidden,'preset hides address and manual model '+id);check(el('CustomModel').value,'model '+id);
    if(id==='openai'){const ids=[...el('ModelPick').options].map(o=>o.value);for(const model of ['gpt-6.1-sol','gpt-6-luna','gpt-6-astra','gpt-5.4-mini']){check(ids.includes(model),'current GPT option '+model);el('ModelPick').value=model;el('ModelPick').dispatchEvent(new Event('change'));check(el('CustomModel').value===model,'exact GPT API ID '+model);}el('ModelPick').value='gpt-6.1-sol';el('ModelPick').dispatchEvent(new Event('change'));check(el('ModelPick').selectedOptions[0].textContent.includes('均衡'),'friendly model label');}
    const defaultModel=el('CustomModel').value;el('ModelPick').value='';el('ModelPick').dispatchEvent(new Event('change'));check(!el('CustomModelLabel').hidden,'manual model revealed');el('ModelPick').value=defaultModel;el('ModelPick').dispatchEvent(new Event('change'));check(el('CustomModelLabel').hidden&&el('CustomModel').value===defaultModel,'model selection hides manual field');
    if(id==='claude'){check(!el('WorkspaceGroup').hidden,'workspace visible');el('Workspace').value='wrkspc_test';}else check(el('WorkspaceGroup').hidden&&!el('Workspace').value,'workspace cleared and hidden');
    el('Key').value='synthetic-'+id;el('Retain').checked=true;el('Consent').checked=true;const before=hits.length;el('Apply').click();
    check(hits.length===before&&coursesAiSettings.status().preset===id&&coursesAiSettings.status().connectionState==='untested','apply is not a network verification '+id);
    check(el('Verification').textContent.includes('尚未通过')&&el('Applied').textContent.includes(label),'explicit unverified status '+id);check(el('Applied').textContent.includes(el('Provider').selectedOptions[0].textContent),'preset and applied name agree '+id);check(coursesAiSettings.describe(coursesAiSettings.read()).split(' / ')[0]===el('Provider').selectedOptions[0].textContent.split('（')[0],'request uses short AI name '+id);
    el('Test').click();while(el('Test').disabled)await new Promise(r=>setTimeout(r,20));
    check(hits.length===before+1&&hits.at(-1).base_url===base,'one intended endpoint '+id);check(coursesAiSettings.status().connectionState==='passed'&&el('Verification').textContent.includes('不代表所有'),'connection does not claim all capabilities');
    if(id==='claude')check(hits.at(-1).workspace_id==='wrkspc_test','workspace sent only to Claude');else check(!hits.at(-1).workspace_id,'workspace absent elsewhere');
    el('Close').click();coursesAiSettings.open();check(el('Provider').value===id,'preset restores');if(id==='claude')check(el('Workspace').value==='wrkspc_test','workspace restored within tab');
   }
   coursesAiSettings.clear();check(coursesAiSettings.status().connectionState==='untested'&&!coursesAiSettings.status().hasKey,'clear invalidates verification and key');
   check(!JSON.stringify(localStorage).includes('synthetic-')&&!JSON.stringify(sessionStorage).includes('synthetic-'),'credentials not persisted');
   check(document.documentElement.scrollWidth<=innerWidth+1,'no horizontal overflow');out.textContent='PASS';
  }catch(e){out.textContent='FAIL '+e.stack;}document.body.append(out);});`;
  const html=await runBrowser({chrome,profile:path.join(temp,'foreign-'+i),url,viewport,initScript:script});
  const result=html.match(/<pre id="regressionResult">[\s\S]*?<\/pre>/)?.[0];assert.match(result||'',/>PASS</,result||'no result');
 }
}));
