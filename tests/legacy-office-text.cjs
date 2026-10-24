// True .doc/.ppt -> LibreOffice -> OOXML -> browser extraction. Isolated DB/files; no AI.
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {spawn}=require('node:child_process'),{pathToFileURL}=require('node:url');
const {fixture}=require('./mistake-format.cjs'),{runBrowser}=require('./browser-driver.cjs');
const {wordFixture,pptFixture}=require('./office-fixtures.cjs'),{converterPath}=require('../back/officePreview');
test('Legacy Office real extraction: upload adoption save reopen refresh and existing attachment',
 {timeout:360000,skip:!converterPath()?'LibreOffice missing; real legacy extraction NOT verified':false},async()=>fixture(async({api,base,ids,temp,serve,back})=>{
  const fixtures={};
  for(const [kind,modern,format]of [['doc',wordFixture(),'doc:MS Word 97'],['ppt',pptFixture(),'ppt:MS PowerPoint 97']]){
    const source=path.join(temp,'sample.'+kind+'x');fs.writeFileSync(source,modern);
    await new Promise((resolve,reject)=>{
      const child=spawn(converterPath(),['-env:UserInstallation='+pathToFileURL(path.join(temp,'profile-'+kind)).href,'--headless','--convert-to',format,'--outdir',temp,source],{windowsHide:true,stdio:'ignore'});
      child.once('error',reject);child.once('close',code=>code===0?resolve():reject(Error('legacy fixture failed')));
    });
    fixtures[kind]=fs.readFileSync(path.join(temp,'sample.'+kind)).toString('base64');
  }
  // Validate API failures without touching any real attachment or API credential.
  let response=await fetch(base+'/office/convert-legacy',{method:'POST',body:new FormData()});assert.equal(response.status,400);
  const unsupported=new FormData();unsupported.append('file',new Blob(['bad']),'file.exe');response=await fetch(base+'/office/convert-legacy',{method:'POST',body:unsupported});assert.equal(response.status,422);assert.equal((await response.json()).code,'FORMAT_UNSUPPORTED');
  const url=await serve(),chrome=['C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Google/Chrome/Application/chrome.exe'].find(fs.existsSync);assert.ok(chrome);
  for(const [index,viewport]of [[1280,960],[390,844]].entries()){
    const kind=index===0?'doc':'ppt',type=index===0?'material':'note',plural=type==='material'?'materials':'notes',original='原正文 '+kind;
    const script=`window.COURSES_API_BASE=${JSON.stringify(base)};const nativeFetch=fetch;let aiCalls=0;fetch=(u,o)=>{if(String(u).includes('/api/ai/')){aiCalls++;throw Error('AI forbidden')}return nativeFetch(u,o)};addEventListener('load',async()=>{const out=document.createElement('pre');out.id='regressionResult';const el=id=>document.getElementById(id),q=s=>document.querySelector(s),norm=v=>String(v).replace(/\\r\\n/g,'\\n'),check=(v,m)=>{if(!v)throw Error(m)},wait=async fn=>{for(let i=0;i<1500;i++){if(fn())return;await new Promise(r=>setTimeout(r,50))}throw Error('timeout: '+document.body.innerText.slice(-1200))};try{
      const saved=JSON.parse(sessionStorage.getItem('legacy-saved')||'null');
      if(saved){await wait(()=>currentCourseId===${ids.courseId}&&currentView.type==='course');await openResourceDetail('${type}',saved.id);check(norm(el('resourceDetailContent').textContent)===saved.body,'actual page refresh retains saved text');check(aiCalls===0,'no AI');out.textContent='PASS';document.body.append(out);return;}
      openCourse(${ids.courseId},'旧版文字提取测试','${plural}');
      pendingUploadFile=new File([Uint8Array.from(atob(${JSON.stringify(fixtures[kind])}),c=>c.charCodeAt(0))],'旧版课程.${kind}',{type:'${kind==='doc'?'application/msword':'application/vnd.ms-powerpoint'}'});
      await openTagPicker('upload','${type}',null);el('tagPickerResourceContent').value=${JSON.stringify(original)};
      el('tagPickerResourceOcrBtn').click();await wait(()=>q('[data-pdf-start]')?.disabled===false);
      if('${kind}'==='ppt'){q('input[value="range"]').click();q('[data-pdf-range]').value='2';}
      q('[data-pdf-start]').click();await wait(()=>el('tagPickerResourceOcrPanel').dataset.pendingAdoption==='true');
      check(el('tagPickerResourceContent').value===${JSON.stringify(original)},'extraction does not change body');
      const extracted=el('tagPickerResourceOcrText').value;check(extracted.includes('${kind==='doc'?'Word preview':'Slide 2'}'),'real legacy text extracted');
      if('${kind}'==='ppt')check(!extracted.includes('Slide 1'),'selected slide only');
      check(el('tagPickerResourceOcrMeta').textContent.includes('自动转换'),'conversion disclosed');
      applyPickerResourceOcr('append');const body=el('tagPickerResourceContent').value;check(body.startsWith(${JSON.stringify(original)}+'\\n\\n'),'explicit append');
      await confirmTagPicker();await wait(()=>!el('tagPickerModal').classList.contains('show'));
      const rows=await(await nativeFetch(${JSON.stringify(base+'/courses/'+ids.courseId+'/'+plural)})).json();const row=rows.find(r=>norm(r.content)===body);check(row,'saved adopted text');
      await openResourceDetail('${type}',row.id);check(norm(el('resourceDetailContent').textContent)===body,'immediate reopen');check(row.file_url.endsWith('.${kind}'),'original extension preserved');
      // Re-extract from an already saved attachment through the actual editor.
      let opening=openResourceTextEditor('${type}',row.id);await wait(()=>q('[data-pdf-start]')?.disabled===false);q('[data-pdf-start]').click();await opening;
      check(q('[data-text-draft]').value.includes('${kind==='doc'?'Word preview':'Slide 1'}'),'existing legacy attachment extracted');check(norm(q('[data-text-original]').textContent)===body,'existing body unchanged before adoption');
      const addition=q('[data-text-draft]').value;q('[data-text-append]').click();await wait(()=>!resourceTextEditor&&el('resourceDetailName').textContent!=='加载中…');
      const expected=body+'\\n\\n'+addition;check(norm(el('resourceDetailContent').textContent)===expected,'existing extraction explicitly appended and saved');
      await openResourceDetail('${type}',row.id);check(norm(el('resourceDetailContent').textContent)===expected,'refetched body persisted');check(aiCalls===0,'no AI requests');
      sessionStorage.setItem('legacy-saved',JSON.stringify({id:row.id,body:expected}));location.reload();
    }catch(e){out.textContent='FAIL '+e.stack;document.body.append(out)}});`;
    const html=await runBrowser({chrome,profile:path.join(temp,'legacy-text-'+index),url,viewport,initScript:script,timeoutMs:180000});
    assert.match(html.match(/<pre id="regressionResult">[\s\S]*?<\/pre>/)?.[0]||'',/>PASS</);
    const rows=await api('GET','/courses/'+ids.courseId+'/'+plural),row=rows.find(r=>r.content.includes(original));assert.ok(row);
    const buffer=fs.readFileSync(path.join(back,'uploads',row.file_url.split('/').pop()));assert.deepEqual(buffer,Buffer.from(fixtures[kind],'base64'),'conversion never changes original');
  }
 },{legacy:false}));
