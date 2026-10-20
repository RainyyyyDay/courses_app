// Invoked by the Python fake-upstream test; real website + isolated business DB.
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {fixture}=require('./mistake-format.cjs');
const {runBrowser}=require('./browser-driver.cjs');

test('website temporary DeepSeek advice adopts into existing review flow',{timeout:90000},async()=>{
  assert.ok(process.env.COURSES_TEST_AI_BASE,'Only run through the Python fake-upstream fixture');
  await fixture(async({base,api,ids,temp,snapshot})=>{
    const course=ids.courseId;
    const row=await api('POST',`/courses/${course}/mistakes`,{title:'临时 Key 网站链路',content:'解释虚构概念',answerContent:'参考定义',mistakeType:'thinking',questionFormat:'open'},201);
    await api('PUT',`/courses/${course}/review-items/mistake/${row.id}/materials/self_explain`,{
      expectedVersion:0,confirmed:true,material:{prompt:'用自己的话讲解虚构概念',reference:'定义\n原因',rubric:'无矛盾',blanks:[],objects:[],dimensions:[]}});
    const before=snapshot();
    const chrome=['C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(fs.existsSync);
    assert.ok(chrome);
    for(const [index,viewport] of [[1280,960],[390,844]].entries()){
      const script=`window.COURSES_API_BASE=${JSON.stringify(base)};
addEventListener('load',async()=>{
 const out=document.createElement('pre');out.id='regressionResult';
 const check=(v,m)=>{if(!v)throw Error(m);},el=n=>document.getElementById('mistakeAi'+n);
 const settle=async()=>{for(let i=0;i<300&&mistakeAiState?.busy;i++)await new Promise(r=>setTimeout(r,20));check(!mistakeAiState?.busy,'AI finished');};
 try{
  await openCourse(${course},'隔离测试','mistakes');await openMistakeDetail(${row.id},false);toggleMistakeAi();
  el('StudentAnswer').value='独立解释';el('ErrorType').value='careless';
  check(el('Provider').value==='default'&&el('KeySettings').hidden,'normal panel defaults unchanged');
  await requestMistakeAi();check(mistakeAiState.result.review_method==='retry','original Mock works');
  check(!readMistakeAiMethod({courseId:${course},id:${row.id}}),'response alone not saved');
  el('Provider').value='deepseek';el('Provider').dispatchEvent(new Event('change'));
  el('ErrorType').value='';check(!el('ErrorType').required,'unknown cause is allowed');
  await requestMistakeAi();check(el('Error').textContent.includes('Key'),'no Key refuses instead of fallback');
  el('ApiKey').value='synthetic-website-key';await requestMistakeAi();
  check(el('Error').textContent.includes('勾选')&&el('ApiKey').value,'cost consent required');
  el('Cost').checked=true;
  // Exercise the actual existing button/form rather than calling only an adapter.
  el('Form').requestSubmit(el('Submit'));
  check(!el('ApiKey').value&&!el('Cost').checked&&mistakeAiState.busy,'Key immediately cleared and pending');
  await settle();
  check(mistakeAiState.result.review_method==='self_explain'&&el('Status').textContent.includes('DeepSeek'),'official result in original panel');
  check(!el('Analysis').hidden&&el('Analysis').textContent.includes('候选错因')&&el('Analysis').textContent.includes('可补充的问题')&&el('Analysis').textContent.includes('材料需求'),'structured analysis rendered in normal panel');
  check(!el('Reason').querySelector('img')&&el('Reason').textContent.includes('<img'),'reason is text');
  check(!readMistakeAiMethod({courseId:${course},id:${row.id}}),'official result also needs confirmation');
  el('Confirm').click();check(readMistakeAiMethod({courseId:${course},id:${row.id}})==='self_explain','original confirmation saves mode only');
  el('ApiKey').value='synthetic-invalid';el('Cost').checked=true;await requestMistakeAi();
  check(el('Error').textContent.includes('无效')&&!el('ApiKey').value,'official failure is explicit, not Mock: '+el('Error').textContent+' / '+el('Provider').value);
  check(readMistakeAiMethod({courseId:${course},id:${row.id}})==='self_explain'&&mistakeAiState.result.review_method==='self_explain','failure retains prior advice');
  el('ApiKey').value='synthetic-close';resetMistakeAi();check(!el('ApiKey').value,'closing clears credential');
  openMistakeAiFromList(${row.id});check(document.getElementById('mistakeAiDialog').open,'list shares panel');
  el('Provider').value='deepseek';changeMistakeAiProvider('mistakeAi');el('ApiKey').value='synthetic-list-close';resetMistakeAi();
  check(!el('ApiKey').value&&el('Provider').value==='default','list cancel clears credentials');
  await openMistakeCreate();
  document.getElementById('mistakeCreateContent').value='虚构新增题目';
  mistakeCreateAiElement('Panel').open=true;mistakeCreateAiElement('StudentAnswer').value='独立作答';mistakeCreateAiElement('ErrorType').value='';
  mistakeCreateAiElement('Provider').value='deepseek';changeMistakeAiProvider('mistakeCreateAi');
  mistakeCreateAiElement('ApiKey').value='synthetic-create-key';mistakeCreateAiElement('Cost').checked=true;
  await requestMistakeCreateAi();check(tagPickerState.aiCreate.result.review_method==='self_explain'&&!mistakeCreateAiElement('ApiKey').value,'creation uses same official adapter');
  check(!mistakeCreateAiElement('Analysis').hidden,'creation also renders analysis without a user cause');
  check(!tagPickerState.aiCreate.selectedMethod,'creation never silently adopts');adoptMistakeCreateAi();
  check(tagPickerState.aiCreate.selectedMethod==='self_explain','creation existing adoption works');closeTagPicker();
  check(!mistakeCreateAiElement('ApiKey').value,'creation cancel clears Key');
  const allStorage=JSON.stringify(localStorage)+JSON.stringify(sessionStorage);
  check(!allStorage.includes('synthetic-')&&!JSON.stringify(mistakeAiState).includes('synthetic-'),'credentials not persisted or in AI state');
  check(!localStorage.getItem('mistake-ai-method:${course}:${row.id}').includes('analysis'),'only selected mode, not analysis, is stored');
  const session=await createReviewRecord('total',[{type:'mistake',id:${row.id}}]);await enterCenterReview(session);await confirmCenterQuickMode();
  check(reviewWorkbench.attempt.modeId==='self_explain'&&reviewWorkbench.inline&&!wb('Dialog').open,'saved official advice reaches real inline mode');
  check(wb('Answer').rows===10,'existing explanation control');wb('Answer').value='本轮独立讲解';
  await submitWorkbenchAttempt('submit');await submitWorkbenchAttempt('judge',2);
  check(reviewWorkbench.attempt.grade===2,'existing grading reused');await finishWorkbenchAttempt();closeReviewCompleteModal();
  await openMistakeDetail(${row.id},false);toggleMistakeAi();
  check(el('Provider').value==='default'&&!el('ApiKey').value,'reopen never restores Key or real provider');
  el('Provider').value='deepseek';changeMistakeAiProvider('mistakeAi');
  // Show the structured result in the screenshot using a fresh, explicit request.
  el('StudentAnswer').value='1';el('ErrorType').value='';el('ApiKey').value='synthetic-website-key';el('Cost').checked=true;
  await requestMistakeAi();check(!el('Analysis').hidden,'fresh analysis visible after review');
  el('Analysis').scrollIntoView({block:'start'});
  check(el('KeySettings').getClientRects().length&&document.documentElement.scrollWidth<=innerWidth+1,'temporary credential controls visible and fit viewport');
  out.textContent='passed';out.dataset.result='passed';
 }catch(e){out.textContent=e.stack;out.dataset.result='failed';}document.body.append(out);
});`;
      const html=await runBrowser({chrome,profile:path.join(temp,'byok-'+index),url:process.env.COURSES_TEST_AI_BASE+'/',viewport,initScript:script,
        blockedUrls:['https://api.deepseek.com/*','http://localhost:3000/*','http://127.0.0.1:3000/*'],
        screenshot:path.join(os.tmpdir(),'courses-website-byok-'+viewport.join('x')+'.png')});
      const result=html.match(/<pre id="regressionResult"[^>]*>[\s\S]*?<\/pre>/)?.[0];
      assert.match(result||'',/data-result="passed"/,result||html.slice(-1500));
    }
    const after=snapshot();
    assert.equal(after.review_item_events.length,before.review_item_events.length+2,'one grade per browser session');
    assert.equal(after.review_sessions.length,before.review_sessions.length+2);
    for(const item of after.review_item_events.slice(before.review_item_events.length))assert.equal(item.grade,2);
    assert.deepEqual(after.review_plan_items,before.review_plan_items,'plans unchanged');
  },{legacy:false});
});
