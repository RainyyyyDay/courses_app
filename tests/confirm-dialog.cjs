// Native top-layer confirmation against real page controls, with synthetic temporary data only.
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {fixture}=require('./mistake-format.cjs'),{runBrowser}=require('./browser-driver.cjs');
test('confirmation top layer supports material replacement and other modal callers',{timeout:90000},async()=>fixture(async({base,ids,temp,serve,snapshot})=>{
  const before=snapshot(),url=await serve(),chrome=['C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Google/Chrome/Application/chrome.exe'].find(fs.existsSync);assert.ok(chrome);
  for(const [index,viewport]of [[1280,960],[390,844]].entries()){
    const script=`window.COURSES_API_BASE=${JSON.stringify(base)};addEventListener('load',async()=>{
 const out=document.createElement('pre');out.id='regressionResult';const el=id=>document.getElementById(id),check=(v,m)=>{if(!v)throw Error(m);};
 const visibleButton=selector=>{const button=document.querySelector('#confirmModal '+selector),r=button.getBoundingClientRect();check(r.width>0&&r.height>0&&button.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)),'confirmation button must receive pointer input: '+selector);return button;};
 const cancel=()=>visibleButton('.btn-cancel').click(),accept=()=>visibleButton('.btn-confirm').click();
 try{
  await openCourse(${ids.courseId},'确认层测试','notes');
  const row=await(await requestApi(API+'/courses/'+${ids.courseId}+'/notes',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({title:'确认测试${index}',content:'中国首都是北京'})})).json();
  await openReviewWorkbench('note',row.id,{row,sourceText:row.content,mode:'cloze'});wb('Editor').querySelector('.review-ai-generator').open=true;
  await requestWorkbenchDraft();const beforeMaterial=JSON.stringify(readWorkbenchMaterial()),parent=wb('Dialog');
  check(!el('confirmModal').open&&wb('Draft').querySelectorAll('button').length===2,'AI draft uses inline adopt/reject, not replacement confirmation');
  [...wb('Draft').querySelectorAll('button')].find(button=>button.textContent==='不采纳').click();
  check(parent.open&&JSON.stringify(readWorkbenchMaterial())===beforeMaterial,'reject restores original form');
  await requestWorkbenchDraft();adoptWorkbenchGeneratedMaterial();
  check(parent.open&&wb('Draft').textContent.includes('已采纳'),'adopt keeps editable AI result without saving');
  const saved=await(await requestApi(reviewWorkbenchBase()+'/materials/cloze')).json();check(saved.version===0,'adoption alone never saves formal material');
  coursesAiSettings.open();pending=showConfirm('测试嵌套设置窗口的确认');visibleButton('.btn-confirm');cancel();check(await pending===false&&el('coursesAiDialog').open&&parent.open,'confirmation is accessible above nested AI settings too');el('coursesAiClose').click();
  closeReviewWorkbench();
  // Other native dialogs and ordinary overlay editors use the same public helper.
  const aiDialog=el('mistakeAiDialog');aiDialog.showModal();pending=showConfirm('测试 AI 窗口');visibleButton('.btn-cancel');accept();check(await pending===true&&aiDialog.open,'AI dialog remains open after child confirmation');aiDialog.close();
  const overlay=el('mistakeEditModal');overlay.classList.add('show');pending=showConfirm('测试普通编辑窗口');cancel();check(await pending===false&&overlay.classList.contains('show'),'legacy overlay remains open');overlay.classList.remove('show');
  const first=showConfirm('第一项'),second=showConfirm('第二项');cancel();check(await first===false&&el('confirmMsg').textContent==='第二项','concurrent requests keep separate resolvers');
  await new Promise(r=>setTimeout(r,30));check(el('confirmModal').open,'previous close event cannot dismiss queued confirmation');accept();check(await second===true,'queued confirmation completes');
  check(document.documentElement.scrollWidth<=innerWidth+1,'layout fits mobile');
  // Leave the reported state open for a screenshot, without saving or accepting it.
  await openReviewWorkbench('note',row.id,{row,sourceText:row.content,mode:'cloze'});wb('Editor').querySelector('.review-ai-generator').open=true;
  out.dataset.result='passed';out.textContent='passed';
 }catch(e){out.dataset.result='failed';out.textContent=e.stack;}document.body.append(out);
});`;
    const html=await runBrowser({chrome,profile:path.join(temp,'confirm-'+index),url,viewport,initScript:script,blockedUrls:['https://api.deepseek.com/*','http://localhost:3000/*','http://127.0.0.1:3000/*'],screenshot:path.join(os.tmpdir(),'courses-confirm-top-'+viewport.join('x')+'.png')});
    const result=html.match(/<pre id="regressionResult"[^>]*>[\s\S]*?<\/pre>/)?.[0];assert.match(result||'',/data-result="passed"/,result||html.slice(-2000));
  }
  assert.deepEqual(snapshot(),before,'confirmations do not modify grades, progress, sessions or plans');
},{legacy:false}));
