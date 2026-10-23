const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {fixture}=require('./mistake-format.cjs'),{runBrowser}=require('./browser-driver.cjs');

test('shared buttons cover static pages and dynamic editors on desktop and mobile',{timeout:90000},async()=>fixture(async({base,ids,temp,serve,api})=>{
 const url=await serve(),chrome=['C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Google/Chrome/Application/chrome.exe'].find(fs.existsSync);assert.ok(chrome);
 const row=await api('POST','/courses/'+ids.courseId+'/mistakes',{title:'按钮巡检',content:'1+1=?',answerContent:'2',questionFormat:'open',mistakeType:'thinking'},201);
 for(const [index,viewport]of [[1280,960],[390,844]].entries()){
  const script=`window.COURSES_API_BASE=${JSON.stringify(base)};addEventListener('load',async()=>{const out=document.createElement('pre');out.id='regressionResult';const check=(v,m)=>{if(!v)throw Error(m);};let checked=0;
  const audit=()=>{for(const button of document.querySelectorAll('button')){const c=getComputedStyle(button);check(!['outset','inset','ridge','groove'].includes(c.borderTopStyle),'native border: '+button.textContent);checked++;}};
  const answer=p=>{toggleMistakeAnswerAi(p);const host=answerAiNode(p,'Host'),generate=answerAiNode(p,'Generate');check(generate.getBoundingClientRect().width>0&&generate.getBoundingClientRect().height>0,'answer buttons are displayed');check(answerAiNode(p,'Provider').value==='shared','AI source must have a selected option');for(const button of host.querySelectorAll('button'))check(parseFloat(getComputedStyle(button).borderRadius)>=8,'rounded answer actions');check(getComputedStyle(generate).backgroundColor==='rgb(74, 108, 247)','blue primary generation');check(getComputedStyle(host.querySelector('button')).backgroundColor==='rgb(243, 244, 248)','gray secondary settings');audit();};
  try{
   audit();await openCourse(${ids.courseId},'按钮巡检','mistakes');await openMistakeCreate();answer('Create');
   const toggle=document.querySelector('[data-answer-ai-toggle]');check(parseFloat(getComputedStyle(toggle).borderRadius)>=8,'rounded AI disclosure');
   const missing=generateMistakeAnswerAi('Create');await missing;check(!mistakeAnswerAiStates.Create.busy,'missing input leaves controls usable');
   const close=document.querySelector('#tagPickerModal .edit-modal-close, #tagPickerModal .modal-close');if(close)check(parseFloat(getComputedStyle(close).borderRadius)>9,'close keeps icon shape');
   closeTagPicker();await openMistakeDetail(${row.id},false);await openMistakeEdit();answer('Edit');closeMistakeEdit();
   coursesAiSettings.open();audit();document.getElementById('coursesAiClose').click();
   await openReviewWorkbench('mistake',${row.id},{row:${JSON.stringify(row)},mode:'cloze'});audit();closeReviewWorkbench();
   await openCourse(${ids.courseId},'按钮巡检','materials');audit();await openCourse(${ids.courseId},'按钮巡检','notes');audit();await openCourse(${ids.courseId},'按钮巡检','assessments');audit();
   openAssessmentModal();audit();closeAssessmentModal();
   await openCourse(${ids.courseId},'按钮巡检','reviewPlans');openReviewPlanCreate();audit();closeReviewPlanCreate();
   check(document.documentElement.scrollWidth<=innerWidth+1,'no page horizontal overflow');check(checked>100,'static and dynamic buttons audited');await openMistakeDetail(${row.id},false);await openMistakeEdit();answer('Edit');answerAiNode('Edit','Generate').scrollIntoView({block:'center'});await new Promise(r=>setTimeout(r,400));out.textContent='PASS '+checked;
  }catch(e){out.textContent='FAIL '+e.stack;}document.body.append(out);});`;
  const html=await runBrowser({chrome,profile:path.join(temp,'buttons-'+index),url,viewport,initScript:script,screenshot:path.join(os.tmpdir(),'courses-buttons-'+viewport.join('x')+'.png')});
  const result=html.match(/<pre id="regressionResult">[\s\S]*?<\/pre>/)?.[0];assert.match(result||'',/>PASS /,result||'no result');
 }
},{legacy:false}));
