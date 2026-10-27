const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const {fixture}=require('./temp-backend-fixture.cjs');
const {runBrowser}=require('./browser-driver.cjs');
const chrome=['C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(fs.existsSync);
const screenshots=path.resolve(__dirname,'../artifacts');fs.mkdirSync(screenshots,{recursive:true});

test('body and outline writes reject stale values and allow an empty body only with an attachment',()=>fixture(async({base,ids,api})=>{
 for(const plural of ['materials','notes']){
  const form=new FormData();form.append('title','附件测试.pdf');form.append('file',new Blob(['fixture'],{type:'application/pdf'}),'fixture.pdf');form.append('content','原正文');
  const response=await fetch(`${base}/courses/${ids.courseId}/${plural}`,{method:'POST',body:form});assert.equal(response.status,201);const row=await response.json();
  const endpoint=`/courses/${ids.courseId}/${plural}/${row.id}`;
  const cleared=await api('PUT',endpoint+'/content',{text:'',mode:'replace',expectedContent:'原正文'});assert.equal(cleared.content,'');
  await api('PUT',endpoint+'/content',{text:'过期正文',mode:'replace',expectedContent:'原正文'},409);
  await api('PUT',endpoint+'/mindmap',{outline:'新大纲',expectedOutline:''});
  await api('PUT',endpoint+'/mindmap',{outline:'过期大纲',expectedOutline:''},409);
  const saved=await api('GET',`/${plural}/${row.id}`);assert.equal(saved.content,'');assert.equal(saved.outline,'新大纲');assert.equal(saved.file_url,row.file_url);
  const noFile=await api('POST',`/courses/${ids.courseId}/${plural}`,{title:'只有正文',content:'必须保留'},201);
  await api('PUT',`/courses/${ids.courseId}/${plural}/${noFile.id}/content`,{text:'',mode:'replace',expectedContent:'必须保留'},400);
 }
}));

test('materials and notes share discoverable editing, recognition, attachment outlines and safe saves on desktop/mobile',{timeout:120000},()=>fixture(async({base,ids,api,serve,temp})=>{
 const url=await serve();
 for(const viewport of [[1280,960],[390,844]])for(const type of ['material','note']){
  const plural=type==='note'?'notes':'materials';
  const form=new FormData();form.append('title','函数、极限与连续：课程讲义.pdf');form.append('file',new Blob(['synthetic'],{type:'application/pdf'}),'lecture.pdf');form.append('content','函数表示变量之间的对应关系。极限描述变化趋势，连续连接函数值与极限。');
  const response=await fetch(`${base}/courses/${ids.courseId}/${plural}`,{method:'POST',body:form});assert.equal(response.status,201);const row=await response.json();
  const script=`window.COURSES_API_BASE=${JSON.stringify(base)};
addEventListener('load',async()=>{const out=document.createElement('pre');out.id='regressionResult';const el=id=>document.getElementById(id),check=(ok,message)=>{if(!ok)throw Error(message)},wait=async fn=>{for(let i=0;i<300;i++){if(fn())return;await new Promise(r=>setTimeout(r,20))}throw Error('wait timed out')};try{
 await openCourse(${ids.courseId},'课程内容测试','${plural}');await openResourceDetail('${type}',${row.id});
 check(el('resourceDetailContentSection').contains(document.querySelector('.resource-text-entry')),'OCR next to body');
 check(!el('resourceDetailContentSection').hidden,'body section visible');
 check(el('resourceDetailOutlineActions').textContent.includes('AI 从附件生成'),'outline entry on detail');
 check(el('resourceDetailOutlineActions').querySelector('[data-resource-outline-ai]').disabled,'AI requires explicit config');
 await openResourceDetailEditor('body');check(el('tagPickerTitle').textContent==='编辑资料','correct editor title');
 check(el('tagPickerResourceContent').labels[0].textContent==='正文','body labelled');
 check(getComputedStyle(el('tagPickerResourceOcrBtn')).display!=='none','saved attachment OCR available');
 const original=el('tagPickerResourceContent').value;
 recognizeUploadedFile=async file=>{check(file.name.endsWith('.pdf'),'saved attachment converted to File');return {provider:'browser',text:'附件识别出的极限定义与连续条件',warnings:[]}};
 await recognizePickerResourceFile();check(el('tagPickerResourceContent').value===original,'OCR requires adoption');
 await confirmTagPicker();check(tagPickerState,'unadopted OCR prevents accidental save');
 applyPickerResourceOcr('append');check(el('tagPickerResourceContent').value.endsWith('连续条件'),'OCR adoption');
 el('tagPickerResourceContent').value='修改后正文：函数与极限';
 await confirmTagPicker();check(!tagPickerState,'editor closes on successful save');
 check(el('resourceDetailContent').textContent==='修改后正文：函数与极限','detail refreshes body after save');
 const saved=await(await fetch(${JSON.stringify(base+`/${plural}/${row.id}`)})).json();check(saved.content==='修改后正文：函数与极限','body persisted in database');
 coursesAiSettings.configure({provider:'deepseek',model:'deepseek-flash',apiKey:'synthetic-test-key',consent:true,retain:true,auto:false});
 let received='';requestAiMindmapOutline=async text=>{received=text;return {outline:'- 函数与极限\\n  - 定义\\n  - 连续的条件'}};
 await openResourceDetailEditor('outline','attachment');
 check(received==='附件识别出的极限定义与连续条件','attachment text reaches outline generation');
 check(el('tagPickerResourceContent').value==='修改后正文：函数与极限','AI file outline leaves body unchanged');
 check(el('tagPickerOutline').value.includes('连续的条件'),'outline is editable draft');
 await confirmTagPicker();check(el('resourceDetailOutlineText').textContent.includes('连续的条件'),'outline saved and detail refreshed');
 const detailRect=el('resourceDetailContentSection').getBoundingClientRect();check(detailRect.right<=innerWidth+1,'body card fits viewport');
 check(document.documentElement.scrollWidth<=innerWidth+1,'no page horizontal overflow');
 // Opening again must fetch a fresh row; cancel must preserve the persisted text.
 await openResourceDetailEditor('body');el('tagPickerResourceContent').value='放弃的草稿';closeTagPicker();
 await openResourceDetailEditor('body');check(el('tagPickerResourceContent').value==='修改后正文：函数与极限','cancel does not persist');
 coursesAiSettings.open();document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}));
 check(tagPickerState&&el('tagPickerResourceContent').value==='修改后正文：函数与极限','Escape in nested AI settings preserves editor');el('coursesAiDialog').close();
 const before=el('tagPickerResourceContent').value;el('tagPickerResourceContent').value='本页冲突草稿';
 await fetch(${JSON.stringify(base+`/courses/${ids.courseId}/${plural}/${row.id}/content`)},{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({text:'其他页面保存的正文',mode:'replace',expectedContent:before})});
 await confirmTagPicker();check(tagPickerState&&el('tagPickerResourceContent').value==='本页冲突草稿','conflict keeps draft');
 const conflict=await(await fetch(${JSON.stringify(base+`/${plural}/${row.id}`)})).json();check(conflict.content==='其他页面保存的正文','stale save cannot overwrite');
 closeTagPicker();await renderResourceDetailPage('${type}',${row.id});out.dataset.result='passed';out.textContent='PASS';
}catch(error){out.dataset.result='failed';out.textContent=error.stack}document.body.append(out)});`;
  const key=type+'-'+viewport.join('x');
  const html=await runBrowser({chrome,profile:path.join(temp,key),url,viewport,initScript:script,screenshot:path.join(screenshots,'detail-'+key+'.png')});
  const result=html.match(/<pre id="regressionResult"[^>]*>[\s\S]*?<\/pre>/)?.[0];assert.match(result||'',/data-result="passed"/,result||'No browser result');
  const editorScript=`window.COURSES_API_BASE=${JSON.stringify(base)};addEventListener('load',async()=>{const out=document.createElement('pre');out.id='regressionResult';try{await openCourse(${ids.courseId},'课程内容测试','${plural}');await openResourceDetail('${type}',${row.id});await openResourceDetailEditor('body');const modal=document.querySelector('.tag-sheet');if(modal.getBoundingClientRect().right>innerWidth+1)throw Error('Editor overflows');out.dataset.result='passed';out.textContent='PASS';}catch(e){out.dataset.result='failed';out.textContent=e.message}document.body.append(out)});`;
  const editor=await runBrowser({chrome,profile:path.join(temp,'editor-'+key),url,viewport,initScript:editorScript,screenshot:path.join(screenshots,'editor-'+key+'.png')});
  assert.match(editor.match(/<pre id="regressionResult"[^>]*>[\s\S]*?<\/pre>/)?.[0]||'',/data-result="passed"/);
 }
}));
