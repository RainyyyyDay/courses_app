// Real website, temporary synthetic SQLite, fake official upstream supplied by Python.
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {fixture}=require('./mistake-format.cjs'),{runBrowser}=require('./browser-driver.cjs');
test('material AI shared settings produce editable drafts and reuse confirmed practice',{timeout:90000},async()=>{
  assert.ok(process.env.COURSES_TEST_AI_BASE);
  await fixture(async({base,ids,temp,snapshot})=>{
    const before=snapshot(),chrome=['C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Google/Chrome/Application/chrome.exe'].find(fs.existsSync);assert.ok(chrome);
    for(const [index,viewport]of [[1280,960],[390,844]].entries()){
      const script=`window.COURSES_API_BASE=${JSON.stringify(base)};addEventListener('load',async()=>{
 const out=document.createElement('pre');out.id='regressionResult';const check=(v,m)=>{if(!v)throw Error(m);};
 const api=async(method,url,body)=>(await requestApi(API+'/courses/'+${ids.courseId}+url,{method,...(body?{headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{})})).json();
 try{
  await openCourse(${ids.courseId},'材料生成测试','notes');
  check(!document.querySelector('#coursesAiDialog a[href="/ai-test"]'),'ordinary settings omit development test tools');
  for(const [type,mode]of [['mistake','self_explain'],['material','contrast'],['note','cloze']]){
   const row=await api('POST','/'+({mistake:'mistakes',material:'materials',note:'notes'}[type]),{title:'AI材料 '+type+'${index}',content:'北京是首都，省会是省级行政中心',...(type==='mistake'?{answerContent:'北京',questionFormat:'open',mistakeType:'thinking'}:{})});
   const record=await createReviewRecord('total',[{type,id:row.id}]);await enterCenterReview(record);
   await openReviewWorkbench(type,row.id,{...centerWorkbenchContext(record.items[0],record),mode});await editWorkbenchMaterial();
   const original=wb('Prompt').value;
   wb('Editor').querySelector('.review-ai-generator').open=true;
   coursesAiSettings.configure({provider:'deepseek',model:'deepseek-flash',apiKey:'synthetic-material-key',retain:true,consent:true,auto:false});
   await requestWorkbenchDraft(true);
   check(reviewWorkbench.aiDraftReal&&wb('Draft')&&!reviewWorkbench.attempt&&wb('Prompt').value!==original,'real draft preview fills the editable form without starting');
   check(reviewWorkbench.inline&&!wb('Dialog').open&&wb('Draft').querySelectorAll('button').length===2,'styled draft stays inline with only adopt/reject controls');
   check(getComputedStyle(wb('Editor').querySelector('[data-material-ai-generate]')).backgroundColor==='rgb(74, 108, 247)','generation uses existing blue primary style');
   if(mode==='cloze')wb('Blanks').querySelector('[data-blank=answer]').value='北京';
   if(wb('Reference'))wb('Reference').value='北京是首都；人工编辑过的要点';
   adoptWorkbenchGeneratedMaterial();
   check(wb('Draft').textContent.includes('已采纳'),'main editable draft is adopted explicitly');
   await saveWorkbenchMaterial(true);check(reviewWorkbench.attempt?.modeId===mode,'confirmed material starts existing selected engine');
   if(mode==='cloze'){wb('Attempt').querySelector('[data-review-blank]').value='北京市';await submitWorkbenchAttempt('submit');check(reviewWorkbench.attempt.grade===3,'existing alias objective grading reused');}
   else {wb('Answer')&&(wb('Answer').value='我的独立讲解');if(mode==='contrast')for(const n of wb('Attempt').querySelectorAll('[data-contrast-field]'))n.value='我的独立比较';await submitWorkbenchAttempt('submit');await submitWorkbenchAttempt('judge',2);check(reviewWorkbench.attempt.grade===2,'existing open grading cap reused');}
   await finishWorkbenchAttempt();closeReviewCompleteModal();
   await openReviewWorkbench(type,row.id,{row,mode});
   wb('Prompt').value='FAIL';const prior=readWorkbenchMaterial();await requestWorkbenchDraft(true);
   check(wb('Error').textContent&&JSON.stringify(readWorkbenchMaterial())===JSON.stringify(prior),'upstream failure preserves form and does not silently mock');
   wb('Prompt').value='INSUFFICIENT';await requestWorkbenchDraft(true);check(!reviewWorkbench.aiDraft&&wb('Draft').textContent.includes('补充比较对象'),'insufficient source explains missing information without fabricated material');
   wb('Prompt').value='北京是首都';const pending=requestWorkbenchDraft(true);coursesAiSettings.clear();await pending;check(!reviewWorkbench.aiDraft,'clearing settings cancels pending generation');
   const calls=coursesAiSettings.status().calls;await requestWorkbenchDraft(true);check(coursesAiSettings.status().calls===calls&&wb('Error').textContent.includes('AI API'),'missing API blocks before model request');
   closeReviewWorkbench();
  }
  check(!JSON.stringify(localStorage).includes('synthetic-material-key')&&!JSON.stringify(sessionStorage).includes('synthetic-material-key'),'key never persisted');
  check(document.documentElement.scrollWidth<=innerWidth+1,'mobile has no page overflow');
  out.dataset.result='passed';out.textContent='passed';
 }catch(e){out.dataset.result='failed';out.textContent=e.stack;}document.body.append(out);
});`;
      const html=await runBrowser({chrome,profile:path.join(temp,'material-ai-'+index),url:process.env.COURSES_TEST_AI_BASE+'/',viewport,initScript:script,blockedUrls:['https://api.deepseek.com/*','http://localhost:3000/*','http://127.0.0.1:3000/*'],screenshot:path.join(os.tmpdir(),'courses-material-ai-'+viewport.join('x')+'.png')});
      const result=html.match(/<pre id="regressionResult"[^>]*>[\s\S]*?<\/pre>/)?.[0];assert.match(result||'',/data-result="passed"/,result||html.slice(-2000));
    }
    const after=snapshot();assert.equal(after.review_item_events.length,before.review_item_events.length+6,'only explicitly completed attempts produce grades');assert.deepEqual(after.review_plan_items,before.review_plan_items,'plans unchanged');
  },{legacy:false});
});
