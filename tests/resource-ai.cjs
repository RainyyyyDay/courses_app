// Invoked by the Python fake official upstream; only fictional data in a temp DB.
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {fixture}=require('./mistake-format.cjs'),{runBrowser}=require('./browser-driver.cjs');
test('resource AI suggestions reach real inline material and note practice',{timeout:90000},async()=>{
  assert.ok(process.env.COURSES_TEST_AI_BASE);
  await fixture(async({base,ids,temp,snapshot})=>{
    const before=snapshot();
    const chrome=['C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Google/Chrome/Application/chrome.exe'].find(fs.existsSync);assert.ok(chrome);
    for(const [index,viewport]of [[1280,960],[390,844]].entries()){
      const script=`window.COURSES_API_BASE=${JSON.stringify(base)};addEventListener('load',async()=>{
 const out=document.createElement('pre');out.id='regressionResult';const el=id=>document.getElementById(id),check=(v,m)=>{if(!v)throw Error(m);};
 const c=${ids.courseId},api=async(method,url,body)=>{const r=await requestApi(API+'/courses/'+c+url,{method,...(body?{headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{})});if(!r.ok)throw Error('test API '+r.status);return r.json();};
 try{
  await openCourse(c,'资源AI测试','materials');
  for(const type of ['material','note']){
   const row=await api('POST','/'+(type==='note'?'notes':'materials'),{title:type+'测试${index}',content:'中国的首都是北京。'});
   await openResourceDetail(type,row.id);check(el('resourceAiPanel'),'AI entry in original detail');el('resourceAiPanel').querySelector('details').open=true;
   check([...el('resourceAiMethod').options].filter(o=>o.value).length===6&&!el('resourceAiMethod').querySelector('option[value=choice_reproduction]'),'six choices only');
   el('resourceAiGoal').value='remember';await requestResourceAi();check(el('resourceAiStatus').textContent.includes('Mock')&&el('resourceAiMethod').value==='cloze','Mock works without student answer or key');
   check(!readResourceAiMethod(resourceAiState)&&!el('resourceAiAdopt').hidden,'response not auto-adopted; explicit one-click entry is visible');el('resourceAiAdopt').click();await updateResourceAiActions();check(readResourceAiMethod(resourceAiState)==='cloze','one click selects and confirms the suggested mode');
   check(el('resourceAiAdopt').hidden,'adopted suggestion hides duplicate adoption action');
   check(el('resourceAiConfirm').hidden&&!el('resourceAiPrepare').hidden,'confirmed suggestion hides repeat confirmation, missing materials still actionable');
   el('resourceAiMethod').value='contrast';await updateResourceAiActions();check(!el('resourceAiConfirm').hidden,'changing the selected mode restores confirmation');
   el('resourceAiMethod').value='cloze';await updateResourceAiActions();check(el('resourceAiConfirm').hidden,'returning to the saved choice needs no new confirmation');
   prepareResourceAiMaterial();for(let i=0;i<100&&reviewWorkbench?.busy;i++)await new Promise(r=>setTimeout(r,10));check(reviewWorkbench?.mode==='cloze'&&wb('Prompt'),'AI preparation button reuses original editor');closeReviewWorkbench();
   const state=await api('GET','/review-items/'+type+'/'+row.id+'/state');check(state.grade===undefined||state.grade===null,'suggestion does not grade');
   coursesAiSettings.configure({provider:'deepseek',model:'deepseek-flash',apiKey:'synthetic-resource-key',retain:true,consent:true,auto:false});
   el('resourceAiMethod').value='reading';await requestResourceAi();check(resourceAiState.result.review_method==='self_explain'&&el('resourceAiMethod').value==='reading','real adapter does not override manual choice');
   check(!el('resourceAiAdopt').hidden&&readResourceAiMethod(resourceAiState)==='cloze','new advice requires an explicit action even when manual selection differs');
   el('resourceAiRecall').value='修改后的困难';el('resourceAiRecall').dispatchEvent(new Event('input',{bubbles:true}));check(el('resourceAiAdopt').hidden,'edited source hides stale adoption');
   el('resourceAiRecall').value='';el('resourceAiRecall').dispatchEvent(new Event('input',{bubbles:true}));el('resourceAiAdopt').click();await updateResourceAiActions();
   check(el('resourceAiMethod').value==='self_explain'&&readResourceAiMethod(resourceAiState)==='self_explain'&&el('resourceAiConfirm').hidden,'one click adopts real-provider suggestion without dropdown or second confirmation');
   el('resourceAiContent').value='';await requestResourceAi();check(el('resourceAiError').textContent.includes('文字'),'missing attachment text actionable');el('resourceAiContent').value='FAIL';
   await requestResourceAi();check(el('resourceAiError').textContent.includes('Key 无效')&&readResourceAiMethod(resourceAiState)==='self_explain'&&el('resourceAiAdopt').hidden,'failed requests preserve saved choice and cannot adopt stale advice');
   el('resourceAiContent').value=row.content;el('resourceAiMethod').value='self_explain';confirmResourceAi();
   const session=await createReviewRecord('total',[{type,id:row.id}]);await enterCenterReview(session);
   check(centerReview.quickMode.aiMode==='self_explain'&&reviewWorkbench?.inline&&reviewWorkbench.type===type,'confirmed suggestion reaches correct resource and inline workbench');
   check(wb('Editor').textContent.includes('缺少')&&wb('Actions').textContent.includes('手动准备材料'),'missing material never generic answer fallback');
   check(!wb('Dialog').open,'practice is in original page');
   await toggleCenterQuickMode();check(!reviewWorkbench&&centerReview.quickMode.modeId==='reading'&&!el('materialReviewActions').hidden,'one click returns to original reader');
   await toggleCenterQuickMode();check(reviewWorkbench?.mode==='self_explain'&&reviewWorkbench.inline,'second click returns to AI task without modal');
   await editWorkbenchMaterial();wb('Prompt').value='解释中国首都。';wb('Reference').value='北京';wb('Rubric').value='地点正确，说明清楚';await saveWorkbenchMaterial();await updateResourceAiActions();
   check(el('resourceAiConfirm').hidden&&el('resourceAiPrepare').hidden&&!el('resourceAiEditMaterial').hidden,'confirmed available material offers editing instead of repeated preparation');
   if(!reviewWorkbench.attempt)await startWorkbenchAttempt();check(reviewWorkbench.attempt.modeId==='self_explain'&&wb('Answer').rows===10,'actual explanation controls');
   wb('Answer').value='中国的首都是北京。';await submitWorkbenchAttempt('submit');check(wb('Attempt').textContent.includes('北京'),'reference revealed only after submit');await submitWorkbenchAttempt('judge',2);await finishWorkbenchAttempt();closeReviewCompleteModal();
   const stateAfter=await api('GET','/review-items/'+type+'/'+row.id+'/state');check(stateAfter.lastGrade===2,'existing engine records Hard');
   await openResourceDetail(type,row.id);el('resourceAiMethod').value='reading';confirmResourceAi();await updateResourceAiActions();check(el('resourceAiConfirm').hidden&&el('resourceAiPrepare').hidden,'original reading needs neither repeated confirmation nor new material');const reading=await createReviewRecord('total',[{type,id:row.id}]);await enterCenterReview(reading);await confirmCenterQuickMode();
   check(!reviewWorkbench&&!el('materialReviewActions').hidden&&centerReview.quickMode.modeId==='reading','reading suggestion uses original reader, not answer form');await pauseCenterReview();
   await openResourceDetail(type,row.id);await updateResourceAiActions();check(readResourceAiMethod(resourceAiState)==='reading'&&el('resourceAiConfirm').hidden&&el('resourceAiPrepare').hidden,'confirmed mode and non-redundant actions restore per type');
   const other=type==='note'?'material':'note';check(!readResourceAiMethod({courseId:c,type:other,id:row.id})||other==='material','type-scoped suggestion keys');
   el('resourceAiMethod').value='retry';confirmResourceAi();const retry=await createReviewRecord('total',[{type,id:row.id}]);await enterCenterReview(retry);await confirmCenterQuickMode();
   check(reviewWorkbench.mode==='retry'&&wb('Editor').textContent.includes('尚无可重新作答')&&wb('Actions').textContent.includes('手动准备'),'retry with no previous task explains actionable fallback');await pauseCenterReview();
   await openReviewWorkbench(type,row.id,{row,mode:'standard'});wb('Prompt').value='重新独立回忆首都。';wb('Reference').value='北京';await saveWorkbenchMaterial();closeReviewWorkbench();
   const retryReady=await createReviewRecord('total',[{type,id:row.id}]);await enterCenterReview(retryReady);await confirmCenterQuickMode();
   check(reviewWorkbench.attempt?.modeId==='standard'&&reviewWorkbench.attempt.firstAnswer===null,'resource retry reuses existing standard task in new round');await pauseCenterReview();
   coursesAiSettings.configure({provider:'mock',model:'deepseek-flash',retain:false,auto:false});
  }
  const choice=await api('POST','/mistakes',{title:'重做选择题',content:'1+1=?',answerContent:'2',mistakeType:'execution',questionFormat:'choice',options:[{id:'A',text:'1'},{id:'B',text:'2'}],correctOption:'B',choiceType:'single'});
  saveMistakeAiMethod({courseId:c,id:choice.id},'retry');const s=await createReviewRecord('total',[{type:'mistake',id:choice.id}]);await enterCenterReview(s);await confirmCenterQuickMode();
  check(mistakeDetailState.progress.mode.id==='choice_reproduction'&&el('mistakeReviewPanel').querySelector('input[type=radio]'),'retry dispatches to original choice engine');
  check(!el('mistakeReviewPanel').querySelector('textarea'),'choice retry is not a text answer');await pauseCenterReview();
  check(!JSON.stringify(localStorage).includes('synthetic-resource-key')&&!JSON.stringify(sessionStorage).includes('synthetic-resource-key'),'key not persisted');
  await openResourceDetail('note',${index+1});el('resourceAiPanel').querySelector('details').open=true;check(document.documentElement.scrollWidth<=innerWidth+1,'mobile fits');
  out.dataset.result='passed';out.textContent='passed';
 }catch(e){out.dataset.result='failed';out.textContent=e.stack;}document.body.append(out);
});`;
      const html=await runBrowser({chrome,profile:path.join(temp,'resource-'+index),url:process.env.COURSES_TEST_AI_BASE+'/',viewport,initScript:script,
        blockedUrls:['https://api.deepseek.com/*','http://127.0.0.1:3000/*','http://localhost:3000/*'],screenshot:path.join(os.tmpdir(),'courses-resource-ai-'+viewport.join('x')+'.png')});
      const result=html.match(/<pre id="regressionResult"[^>]*>[\s\S]*?<\/pre>/)?.[0];assert.match(result||'',/data-result="passed"/,result||html.slice(-2000));
    }
    const after=snapshot();assert.equal(after.review_item_events.length,before.review_item_events.length+4,'one Hard per explanation, no grade from reading or suggestions');
    assert.deepEqual(after.review_plan_items,before.review_plan_items,'plans unchanged');
  },{legacy:false});
});
