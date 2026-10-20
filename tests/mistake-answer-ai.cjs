// Called by the Python fake official upstream; isolated website/business fixture.
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {fixture}=require('./mistake-format.cjs');
const {runBrowser}=require('./browser-driver.cjs');
test('answer draft editor buttons preserve manual work and existing grading',{timeout:90000},async()=>{
  assert.ok(process.env.COURSES_TEST_AI_BASE);
  await fixture(async({base,api,ids,temp,snapshot})=>{
    const course=ids.courseId;
    const row=await api('POST',`/courses/${course}/mistakes`,{title:'编辑草稿测试',content:'1+1=?',answerContent:'原答案',explanation:'原解析',questionFormat:'open',mistakeType:'thinking'},201);
    const before=snapshot();
    const chrome=['C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(fs.existsSync);assert.ok(chrome);
    for(const [index,viewport] of [[1280,960],[390,844]].entries()){
      const script=`window.COURSES_API_BASE=${JSON.stringify(base)};addEventListener('load',async()=>{
 const out=document.createElement('pre');out.id='regressionResult';
 const check=(v,m)=>{if(!v)throw Error(m);},field=(p,n)=>document.getElementById('mistake'+p+n),ai=(p,n)=>answerAiNode(p,n);
 const credentials=p=>{ai(p,'Provider').value='deepseek';changeMistakeAiProvider('mistake'+p+'AnswerAi');ai(p,'ApiKey').value='synthetic-answer-key';ai(p,'Cost').checked=true;};
 const adopt=(p,mode)=>{ai(p,'Accept').checked=true;applyMistakeAnswerAi(p,mode);};
 try{
  await openCourse(${course},'草稿测试','mistakes');await openMistakeCreate();
  document.getElementById('tagPickerName').value='生成后手动保存${index}';field('Create','Content').value='1+1=?';
  field('Create','Type').value='thinking';
  field('Create','Answer').value='手写答案';field('Create','Explanation').value='手写解析';
  check(ai('Create','Host').hidden,'manual user sees no required AI form');toggleMistakeAnswerAi('Create');
  await generateMistakeAnswerAi('Create');check(ai('Create','Caveats').textContent.includes('Mock')&&!ai('Create','Answer').value,'Mock not a real answer');
  check(field('Create','Answer').value==='手写答案','generation never adopts');resetMistakeAnswerAi('Create');toggleMistakeAnswerAi('Create');credentials('Create');
  const pending=generateMistakeAnswerAi('Create');field('Create','Answer').value='请求中修改';await pending;
  check(!ai('Create','ApiKey').value&&field('Create','Answer').value==='请求中修改','Key cleared; concurrent manual edit protected');
  check(ai('Create','Explanation').value.includes('<img')&&!ai('Create','Preview').querySelector('img'),'model content is editable plain text');
  applyMistakeAnswerAi('Create','answer');check(field('Create','Answer').value==='请求中修改','acknowledgement required');
  adopt('Create','empty');check(field('Create','Answer').value==='请求中修改'&&field('Create','Explanation').value==='手写解析','fill blanks never replaces');
  adopt('Create','answer');check(field('Create','Answer').value==='2'&&field('Create','Explanation').value==='手写解析','answer replacement scoped');
  applyMistakeAnswerAi('Create','undo');check(field('Create','Answer').value==='请求中修改','undo preserves pre-adoption work');
  field('Create','Answer').value='';field('Create','Explanation').value='';adopt('Create','empty');
  check(field('Create','Answer').value==='2'&&field('Create','Explanation').value.includes('两个'),'fill empty fields explicitly');
  field('Create','Content').value='changed';adopt('Create','answer');check(ai('Create','Error').textContent.includes('过期'),'changed question rejects stale draft');field('Create','Content').value='1+1=?';
  await confirmTagPicker();check(!tagPickerState,'saving uses original create flow');
  const rows=await(await requestApi(API+'/courses/${course}/mistakes')).json();const created=rows.find(x=>x.title==='生成后手动保存${index}');
  check(created&&created.answer_content==='2','adopted answer saved only with original save');
  await openMistakeDetail(${row.id},false);await openMistakeEdit();toggleMistakeAnswerAi('Edit');credentials('Edit');
  await generateMistakeAnswerAi('Edit');check(field('Edit','Answer').value==='原答案'&&field('Edit','Explanation').value==='原解析','edit keeps saved original');
  adopt('Edit','explanation');check(field('Edit','Answer').value==='原答案'&&field('Edit','Explanation').value.includes('两个'),'only explanation replaced');
  closeMistakeEdit();const unchanged=await(await requestApi(API+'/mistakes/${row.id}')).json();check(unchanged.explanation==='原解析','cancel does not save');
  await openMistakeEdit();toggleMistakeAnswerAi('Edit');field('Edit','Content').value='FAIL';credentials('Edit');await generateMistakeAnswerAi('Edit');
  check(ai('Edit','Error').textContent.includes('无效')&&field('Edit','Answer').value==='原答案','failed request preserves inputs');
  field('Edit','Content').value='1+1=?';field('Edit','Format').value='choice';field('Edit','ChoiceType').value='single';
  renderMistakeChoiceOptionRows('Edit',['1','2'],[]);toggleMistakeChoiceFields('Edit');credentials('Edit');await generateMistakeAnswerAi('Edit');
  check(readMistakeChoiceAnswerIds('Edit').length===0,'candidate is not yet the scoring answer');adopt('Edit','answer');
  check(readMistakeChoiceAnswerIds('Edit').join(',')==='B','single-choice candidate uses current option controls');
  field('Edit','ChoiceType').value='multiple';renderMistakeChoiceOptionRows('Edit',['1','2','3'],[]);toggleMistakeChoiceFields('Edit');credentials('Edit');await generateMistakeAnswerAi('Edit');
  adopt('Edit','answer');check(readMistakeChoiceAnswerIds('Edit').join(',')==='A,C','multiple-choice candidate uses existing controls');
  document.querySelector('#mistakeEditOptionsList .choice-option-input').value='modified';adopt('Edit','answer');check(ai('Edit','Error').textContent.includes('过期'),'changed options reject old candidates');
  closeMistakeEdit();await openMistakeEdit();toggleMistakeAnswerAi('Edit');credentials('Edit');const late=generateMistakeAnswerAi('Edit');closeMistakeEdit();await late;
  check(ai('Edit','Host').hidden&&!mistakeAnswerAiStates.Edit,'closed editor discards late responses and Key');
  const storage=JSON.stringify(localStorage)+JSON.stringify(sessionStorage);check(!storage.includes('synthetic-answer-key'),'Key never persisted');
  await openMistakeEdit();toggleMistakeAnswerAi('Edit');credentials('Edit');await generateMistakeAnswerAi('Edit');
  check(document.documentElement.scrollWidth<=innerWidth+1,'editor fits viewport');
  check(ai('Edit','Preview').querySelector('.modal-actions button').getBoundingClientRect().width>=110,'draft actions remain readable on mobile');
  ai('Edit','Preview').scrollIntoView({block:'start'});out.dataset.result='passed';out.textContent='passed';
 }catch(e){out.dataset.result='failed';out.textContent=e.stack;}document.body.append(out);
});`;
      const html=await runBrowser({chrome,profile:path.join(temp,'answer-'+index),url:process.env.COURSES_TEST_AI_BASE+'/',viewport,initScript:script,
        blockedUrls:['https://api.deepseek.com/*','http://localhost:3000/*','http://127.0.0.1:3000/*'],
        screenshot:path.join(os.tmpdir(),'courses-answer-draft-'+viewport.join('x')+'.png')});
      const result=html.match(/<pre id="regressionResult"[^>]*>[\s\S]*?<\/pre>/)?.[0];assert.match(result||'',/data-result="passed"/,result||html.slice(-1500));
    }
    const after=snapshot();
    for(const table of Object.keys(before))assert.deepEqual(after[table].slice(0,before[table].length),before[table],'existing records unchanged: '+table);
    for(const table of ['review_item_events','review_sessions','review_session_items','review_plan_items'])assert.deepEqual(after[table],before[table],'no grading/session/plan writes: '+table);
    const unchanged=await api('GET','/mistakes/'+row.id);assert.equal(unchanged.answer_content,'原答案');assert.equal(unchanged.explanation,'原解析');
  },{legacy:false});
});
