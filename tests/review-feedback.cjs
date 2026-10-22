// Real Chrome, isolated synthetic database, official HTTP transport replaced by Python test.
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {fixture}=require('./mistake-format.cjs'),{runBrowser}=require('./browser-driver.cjs');
test('optional AI feedback follows immutable answers without changing grades or plans',{timeout:100000},async()=>{
 await fixture(async({base,ids,temp,snapshot})=>{
  const before=snapshot(),chrome=['C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Google/Chrome/Application/chrome.exe'].find(fs.existsSync);assert.ok(chrome);
  for(const [index,viewport]of [[1280,960],[390,844]].entries()){
   const script=`window.COURSES_API_BASE=${JSON.stringify(base)};addEventListener('load',async()=>{
const out=document.createElement('pre');out.id='regressionResult';const check=(v,m)=>{if(!v)throw Error(m);},el=id=>document.getElementById(id),c=${ids.courseId};
const api=async(method,url,body)=>(await requestApi(API+'/courses/'+c+url,{method,...(body?{headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{})})).json();
const settings=()=>coursesAiSettings.configure({provider:'deepseek',model:'deepseek-flash',apiKey:'synthetic-feedback-key',retain:true,consent:true,auto:false});
try{
 await openCourse(c,'AI批改测试','notes');
 for(const [type,mode]of [['mistake','self_explain'],['material','contrast'],['note','cloze'],['material','standard'],['note','reading']]){
  const row=await api('POST','/'+({note:'notes',material:'materials',mistake:'mistakes'}[type]),{title:mode+'${index}',content:'加减互逆',...(type==='mistake'?{answerContent:'1+2=3',questionFormat:'open',mistakeType:'thinking'}:{})});
  const record=await createReviewRecord('total',[{type,id:row.id}]);await enterCenterReview(record);
  await openReviewWorkbench(type,row.id,{...centerWorkbenchContext(record.items[0],record),mode});await editWorkbenchMaterial();
  wb('Prompt').value=mode==='cloze'?'1+1=【b1】':'解释 a+b=c 和 c-a=b';if(wb('Reference'))wb('Reference').value='加减互逆，例如1+2=3';if(wb('Rubric'))wb('Rubric').value='概念与例子';
  if(mode==='cloze'){addReviewBlank();wb('Prompt').value='1+1=【b1】';wb('Blanks').querySelector('[data-blank=answer]').value='2';wb('Blanks').querySelector('[data-blank=aliases]').value='二';}
  if(mode==='contrast'){wb('Objects').value='加法\\n减法';wb('Dimensions').value='关系';}
  await saveWorkbenchMaterial(true);check(reviewWorkbench.attempt?.stage==='question','started '+mode);
  check(!wb('Attempt').querySelector('[data-review-feedback]'),'no feedback before independent answer');
  if(mode==='cloze')wb('Attempt').querySelector('[data-review-blank]').value='二';
  else if(mode==='contrast')for(const field of wb('Attempt').querySelectorAll('[data-contrast-field]'))field.value='不会';
  else wb('Answer').value='不会';
  if(mode==='reading'){wb('ReadComplete').checked=true;await submitWorkbenchAttempt('complete');check(!wb('Attempt').querySelector('[data-review-feedback]'),'reading never evaluated');}
  else{
   await submitWorkbenchAttempt('submit');check(wb('Attempt').querySelector('[data-feedback-generate]'),'optional entry after submit '+mode);
   const original=JSON.stringify(reviewWorkbench.attempt),stateBefore=await api('GET','/review-items/'+type+'/'+row.id+'/state');
   coursesAiSettings.configure({provider:'mock',model:'deepseek-flash',retain:false,auto:false});await requestReviewFeedback();check(reviewFeedbackState.provider==='mock'&&reviewFeedbackState.result.judgment==='uncertain','Mock is explicitly not an evaluation');
   settings();const calls=coursesAiSettings.status().calls;renderWorkbenchAttempt();check(coursesAiSettings.status().calls===calls,'render does not call model');
   await requestReviewFeedback();check(reviewFeedbackState.result&&reviewFeedbackState.provider==='deepseek'&&!reviewFeedbackState.error,'official adapter feedback '+mode+': '+reviewFeedbackState.error);
   check(reviewFeedbackState.savedVersion===2&&!reviewFeedbackState.savePayload,'Mock and real feedback persist as separate immutable versions');
   if(mode==='self_explain'){
   const originalApi=requestApi,callsBefore=coursesAiSettings.status().calls;
   try{requestApi=async(url,options)=>{if(url.endsWith('/feedback')&&options?.method==='POST')throw Error('synthetic save failure');return originalApi(url,options);};await requestReviewFeedback();}
   finally{requestApi=originalApi;}
   check(reviewFeedbackState.saveError&&reviewFeedbackState.savePayload&&wb('Attempt').querySelector('[data-feedback-retry-save]'),'failed persistence exposes a separate save retry');
   await saveReviewFeedbackHistory();check(reviewFeedbackState.savedVersion===3&&!reviewFeedbackState.savePayload&&coursesAiSettings.status().calls===callsBefore+1,'retry only saves; never requests model twice');
   }
   check(wb('Attempt').textContent.includes('错误与遗漏')&&wb('Attempt').textContent.includes('解析步骤')&&!wb('Attempt').querySelector('.review-ai-draft img')&&!window.feedbackInjected,'escaped structured explanation');
   check(JSON.stringify(reviewWorkbench.attempt)===original,'feedback cannot mutate attempt');check(JSON.stringify(await api('GET','/review-items/'+type+'/'+row.id+'/state'))===JSON.stringify(stateBefore),'feedback cannot mutate progress');
   if(mode==='cloze')check(reviewWorkbench.attempt.grade===3&&wb('Attempt').textContent.includes('不覆盖原判分'),'alias objective Good preserved despite AI disagreeing');
   else {await submitWorkbenchAttempt('judge',2);check(reviewWorkbench.attempt.grade===2&&reviewFeedbackState.result,'manual grade and feedback coexist');}
   settings();const pending=requestReviewFeedback();coursesAiSettings.clear();await pending;check(reviewFeedbackState.error.includes('取消'),'clearing credentials cancels feedback');
   const keyCalls=coursesAiSettings.status().calls;await requestReviewFeedback();check(coursesAiSettings.status().calls===keyCalls&&reviewFeedbackState.error.includes('Key'),'missing key blocks before network');
   settings();reviewFeedbackState.input={...reviewFeedbackState.input,question:'FAIL'};await requestReviewFeedback();check(reviewFeedbackState.error.includes('Key'),'provider failure does not mock');
   settings();reviewFeedbackState.input={...reviewFeedbackState.input,question:'正常题面'};const late=requestReviewFeedback();closeReviewWorkbench();await late;check(!reviewFeedbackState,'leaving attempt discards delayed reply');
  }
  closeReviewWorkbench();await pauseCenterReview();
 }
 // Native standard flow keeps the immutable first answer and manual judgment.
 const open=await api('POST','/mistakes',{title:'原标准作答${index}',content:'解释加减关系',answerContent:'加减互逆',questionFormat:'open',mistakeType:'thinking'});
 let q=await api('GET','/mistakes/'+open.id+'/review');q=await api('POST','/mistakes/'+open.id+'/review',{action:'start',requestId:'feedback-open-start-${index}',expectedVersion:q.version});
 q=await api('POST','/mistakes/'+open.id+'/review/events',{action:'reveal_answer',firstAnswer:'不会',durationMs:1000,requestId:'feedback-open-answer-${index}',expectedVersion:q.version});
 await openMistakeDetail(open.id,true);check(el('mistakeReviewPanel').querySelector('[data-feedback-generate]'),'native standard feedback entry');settings();await requestReviewFeedback();check(reviewFeedbackState.result&&reviewFeedbackState.input.student_answer==='不会','native standard uses saved independent answer');
 check(reviewFeedbackState.savedVersion===1,'native feedback saved to actual round');const callsAtRestore=coursesAiSettings.status().calls;
 await openMistakeDetail(open.id,true);for(let i=0;i<100&&!reviewFeedbackState?.result;i++)await new Promise(r=>setTimeout(r,10));
 check(reviewFeedbackState.savedVersion===1&&reviewFeedbackState.result&&coursesAiSettings.status().calls===callsAtRestore,'reopening a round restores saved feedback without a model call');
 check(JSON.stringify(await api('GET','/mistakes/'+open.id+'/review'))===JSON.stringify(q),'native manual judgment remains untouched');
 // Native choice engine (also used by retry): existing objective result, no workbench clone.
 const row=await api('POST','/mistakes',{title:'选择重做${index}',content:'1+1=?',answerContent:'2',mistakeType:'execution',questionFormat:'choice',choiceType:'single',options:[{id:'A',text:'1'},{id:'B',text:'2'}],correctOption:'B'});
 let p=await api('GET','/mistakes/'+row.id+'/review');p=await api('POST','/mistakes/'+row.id+'/review',{action:'start',requestId:'feedback-start-${index}',expectedVersion:p.version});
 p=await api('POST','/mistakes/'+row.id+'/review/events',{action:'choose',selectedOption:'B',durationMs:1000,requestId:'feedback-choice-${index}',expectedVersion:p.version});
 await openMistakeDetail(row.id,true);check(el('mistakeReviewPanel').querySelector('[data-feedback-generate]'),'native choice feedback entry');settings();await requestReviewFeedback();check(reviewFeedbackState.result&&reviewFeedbackState.input.objective_result==='correct','native objective feedback uses original engine');
 check(reviewFeedbackState.savedVersion===1,'choice feedback links to original objective round');
 check(JSON.stringify(await api('GET','/mistakes/'+row.id+'/review'))===JSON.stringify(p),'native grading unchanged');
 check(!JSON.stringify(localStorage).includes('synthetic-feedback-key')&&!JSON.stringify(sessionStorage).includes('synthetic-feedback-key'),'key never persisted');
 check(document.documentElement.scrollWidth<=innerWidth+1,'mobile layout fits');
 out.dataset.result='passed';out.textContent='passed';
}catch(e){out.dataset.result='failed';out.textContent=e.stack;}document.body.append(out);
});`;
   const html=await runBrowser({chrome,profile:path.join(temp,'feedback-'+index),url:process.env.COURSES_TEST_AI_BASE+'/',viewport,initScript:script,blockedUrls:['https://api.deepseek.com/*','http://localhost:3000/*','http://127.0.0.1:3000/*']});
   const result=html.match(/<pre id="regressionResult"[^>]*>[\s\S]*?<\/pre>/)?.[0];assert.match(result||'',/data-result="passed"/,result||html.slice(-2000));
  }
  const after=snapshot();assert.equal(after.review_item_events.length,before.review_item_events.length+10,'only explicit submissions create grade/exposure records');assert.deepEqual(after.review_plan_items,before.review_plan_items,'plans untouched');
 },{legacy:false});
});
