// Real website + isolated synthetic SQLite; no personal DB, AI calls or new dependencies.
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {fixture}=require('./mistake-format.cjs'),{runBrowser}=require('./browser-driver.cjs');
function scenario(base,courseId){return `window.COURSES_API_BASE=${JSON.stringify(base)};addEventListener('load',async()=>{
 const out=document.createElement('pre');out.id='regressionResult';out.hidden=true;const el=id=>document.getElementById(id),check=(v,m)=>{if(!v)throw Error(m);};
 const c=${courseId},api=async(method,url,body)=>{const r=await requestApi(API+'/courses/'+c+url,{method,...(body?{headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{})});return r.json();};
 try{
  await openCourse(c,'挖空交互测试','notes');
  if(sessionStorage.getItem('cloze-test-id')){
   const id=Number(sessionStorage.getItem('cloze-test-id'));
   await openReviewWorkbench('note',id,{sourceText:'不应覆盖的原文',mode:'cloze'});
   check(el('clozeSource').querySelectorAll('[data-cloze-id]').length===2,'actual reload restores visual blanks');
   const m=readWorkbenchMaterial();check(m.blanks[0].aliases.includes('叶绿体结构'),'aliases survive persistence');
   check(!el('clozeSource').textContent.includes('【b1】'),'internal IDs stay hidden');
   closeReviewWorkbench();
   const session=await createReviewRecord('total',[{type:'note',id}]);await enterCenterReview(session);
   await openReviewWorkbench('note',id,{sessionItemId:session.items[0].id,sessionId:session.id,mode:'cloze'});
   await startWorkbenchAttempt();
   const inputs=[...wb('Attempt').querySelectorAll('[data-review-blank]')];check(inputs.length===2,'actual practice uses existing engine');
   inputs[0].value='叶绿体结构';inputs[1].value='叶绿体';await submitWorkbenchAttempt('submit');
   check(reviewWorkbench.attempt.grade===3,'original exact/alias grading remains correct');
   closeReviewWorkbench();await pauseCenterReview();
   await openReviewWorkbench('note',id,{mode:'cloze'});
   const bounds=wb('Dialog').getBoundingClientRect();check(bounds.left>=0&&bounds.right<=innerWidth&&bounds.top>=0&&bounds.bottom<=innerHeight,'entire dialog fits viewport');
   out.dataset.result='passed';out.textContent='visual cloze: selection, undo, safe editing, mobile find, preview, save/reload and alias grading passed';document.body.append(out);return;
  }
  const row=await api('POST','/notes',{title:'选词挖空',content:'光合作用发生在叶绿体中。叶绿体含有叶绿素。'});
  const original=row.content;
  await openReviewWorkbench('note',row.id,{sourceText:original,mode:'cloze'});
  const source=el('clozeSource');check(source.textContent===original,'prefills full original text');
  const select=(node,start,end)=>{source.focus();const r=document.createRange();r.setStart(node,start);r.setEnd(node,end);const s=getSelection();s.removeAllRanges();s.addRange(r);source.dispatchEvent(new MouseEvent('mouseup',{bubbles:true}));};
  const index=source.firstChild.data.indexOf('叶绿体');select(source.firstChild,index,index+3);el('clozeMakeBlank').click();
  check(readWorkbenchMaterial().blanks[0].answer==='叶绿体','selection auto-captures answer');
  check(readWorkbenchMaterial().prompt==='光合作用发生在【b1】中。叶绿体含有叶绿素。','only selected occurrence is blanked');
  check(!el('clozeSettings').open&&wb('Blanks').querySelector('[data-blank=id]').type==='hidden','numbering and advanced settings hidden');
  const chip=source.querySelector('[data-cloze-id]');chip.querySelector('button').click();
  check(el('clozeSettings').open&&wb('Blanks').firstElementChild.open,'chip opens answer settings');
  const alias=wb('Blanks').querySelector('[data-blank=aliases]');alias.value='叶绿体结构';alias.dispatchEvent(new Event('input',{bubbles:true}));
  const selected=document.createRange();selected.selectNodeContents(source);makeClozeBlank(selected);
  check(readWorkbenchMaterial().blanks.length===1&&el('clozeStatus').textContent.includes('包含'),'overlapping selection rejected');
  source.querySelector('[data-cloze-id] button:last-child').click();check(source.textContent===original&&!readWorkbenchMaterial().blanks.length,'cancel restores answer in original position');
  el('clozeUndo').click();check(readWorkbenchMaterial().blanks.length===1&&readWorkbenchMaterial().blanks[0].aliases[0]==='叶绿体结构','undo restores answer and aliases');
  // Editing beside an existing blank preserves it and serializes the original contract.
  const text=source.lastChild;select(text,text.data.length,text.data.length);
  source.dispatchEvent(new InputEvent('beforeinput',{inputType:'insertText',data:'补充',bubbles:true,cancelable:true}));text.appendData('补充');source.dispatchEvent(new InputEvent('input',{inputType:'insertText',data:'补充',bubbles:true}));
  check(readWorkbenchMaterial().prompt.endsWith('补充')&&readWorkbenchMaterial().blanks.length===1,'editing other text retains blank');
  el('clozeUndo').click();check(!readWorkbenchMaterial().prompt.endsWith('补充'),'undo plain text edit');
  // Mobile fallback chooses a remaining occurrence without changing the existing one.
  el('clozeFindText').value='叶绿体';el('clozeFindButton').click();check(el('clozeMatches').children.length===1,'find excludes existing chips');el('clozeMatches').firstElementChild.click();
  check(readWorkbenchMaterial().blanks.length===2,'mobile fallback adds second blank');
  const before=JSON.stringify(readWorkbenchMaterial());el('clozePreviewToggle').click();
  check(source.hidden&&el('clozePreview').querySelectorAll('input').length===2,'preview displays inline answer inputs');
  check(!el('clozePreview').textContent.includes('叶绿体'),'preview does not reveal answers');
  el('clozePreview').querySelector('input').value='试填';check(JSON.stringify(readWorkbenchMaterial())===before,'preview never changes formal answers');el('clozePreviewToggle').click();
  // Backspace adjacent to a chip cancels it and restores text; undo keeps metadata.
  const second=source.querySelectorAll('[data-cloze-id]')[1],r=document.createRange();r.setStartAfter(second);r.collapse(true);getSelection().removeAllRanges();getSelection().addRange(r);
  const deletion=new InputEvent('beforeinput',{inputType:'deleteContentBackward',bubbles:true,cancelable:true});source.dispatchEvent(deletion);
  check(deletion.defaultPrevented&&readWorkbenchMaterial().blanks.length===1&&source.textContent.includes('叶绿体含有'),'backspace restores chip text');el('clozeUndo').click();
  // Old-format materials and AI adoption/undo synchronize the visual editor.
  const saved=readWorkbenchMaterial();wb('Prompt').value='旧材料【old】';wb('Blanks').innerHTML=wbBlank({id:'old',answer:'兼容答案',aliases:['兼容'],hint:'提示'});updateWorkbenchPreparation();
  check(source.querySelector('[data-cloze-id]').textContent.includes('兼容答案'),'legacy IDs render as chips');
  reviewWorkbench.beforeAi=saved;undoWorkbenchDraft();check(source.querySelectorAll('[data-cloze-id]').length===2,'AI undo updates visual content');
  // Plain-text paste strips HTML; undo restores the full material.
  select(source.lastChild,source.lastChild.length,source.lastChild.length);const transfer=new DataTransfer();transfer.setData('text/plain','<img src=x onerror=alert(1)>');transfer.setData('text/html','<img src=x onerror=alert(1)>');
  source.dispatchEvent(new ClipboardEvent('paste',{clipboardData:transfer,bubbles:true,cancelable:true}));
  check(!source.querySelector('img')&&readWorkbenchMaterial().prompt.includes('<img'),'pasted markup is inert text');el('clozeUndo').click();
  const beforeLines=readWorkbenchMaterial();
  source.replaceChildren(document.createTextNode('第一行'));const line=document.createElement('div');line.textContent='第二行';source.append(line);wb('Blanks').replaceChildren();saveClozeSource();
  check(readWorkbenchMaterial().prompt==='第一行'+String.fromCharCode(10)+'第二行','native block newlines preserved');
  const multi=document.createRange();multi.selectNodeContents(source);makeClozeBlank(multi);
  check(readWorkbenchMaterial().blanks[0].answer==='第一行'+String.fromCharCode(10)+'第二行','multiline selection preserves newlines in answer');
  wb('Prompt').value=beforeLines.prompt;wb('Blanks').innerHTML=beforeLines.blanks.map(wbBlank).join('');updateWorkbenchPreparation();
  // Repeated editing must not overflow the modal or the mobile viewport.
  el('clozeSettings').open=false;
  check(source.getBoundingClientRect().width<=innerWidth,'editor fits viewport');
  await saveWorkbenchMaterial();check(!wb('Dialog').open,'saves with original API');
  const stored=await api('GET','/review-items/note/'+row.id+'/materials/cloze');check(stored.version===1&&stored.material.blanks.length===2,'formal material persisted');
  const states=await api('GET','/review-items/note/'+row.id+'/state');check(!states.lastGrade,'authoring does not grade');
  sessionStorage.setItem('cloze-test-id',String(row.id));location.reload();
 }catch(error){out.dataset.result='failed';out.textContent=error.stack;document.body.append(out);}
});`;}
for(const viewport of [[1280,960],[390,844]])test('visual cloze authoring and existing practice '+viewport.join('x'),{timeout:90000},async()=>fixture(async({base,ids,temp,serve})=>{
 const chrome=['C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Google/Chrome/Application/chrome.exe'].find(fs.existsSync);assert.ok(chrome);
 const screenshot=path.join(os.tmpdir(),'courses-cloze-editor-'+viewport.join('x')+'.png');
 const html=await runBrowser({chrome,profile:path.join(temp,'cloze-profile'),url:await serve(),viewport,screenshot,blockedUrls:['http://localhost:3000/*','http://127.0.0.1:3000/*'],initScript:scenario(base,ids.courseId)});
 const result=html.match(/<pre id="regressionResult"[^>]*>[\s\S]*?<\/pre>/)?.[0];assert.match(result||'',/data-result="passed"/,result||html.slice(-2000));console.log('CLOZE_SCREENSHOT '+screenshot);
},{legacy:false}));
