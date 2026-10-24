// Real LibreOffice + isolated HTTP/database + headless Chrome. No AI upstream.
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {fixture}=require('./mistake-format.cjs'),{runBrowser}=require('./browser-driver.cjs');
const {wordFixture,pptFixture,pdfFixture}=require('./office-fixtures.cjs');
const {converterPath}=require('../back/officePreview');
async function ready(base,name){
  for(let i=0;i<140;i++){
    const r=await fetch(base+'/attachments/'+name+'/preview'),s=await r.json();
    if(s.status==='ready')return;
    assert.equal(s.status,'preparing',JSON.stringify(s));await new Promise(r=>setTimeout(r,500));
  }throw Error('real conversion timed out');
}
for(const real of [false,true])test('Office '+(real?'real':'simulated')+' conversion and browser: upload, preview, reopen, reload, restart, replace, delete',
  {timeout:240000,skip:real&&!converterPath()?'LibreOffice not installed; real conversion NOT verified':false},async()=>fixture(async({api,base,ids,back,temp,serve,restart})=>{
    const chrome=['C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Google/Chrome/Application/chrome.exe'].find(fs.existsSync);assert.ok(chrome);
    const upload=async(type,name,body)=>{
      const f=new FormData();f.append('title',name);f.append('content','原正文保持不变');f.append('file',new Blob([body]),name);
      const r=await fetch(base+'/courses/'+ids.courseId+'/'+type,{method:'POST',body:f});assert.equal(r.status,201);return r.json();
    };
    const wordData=wordFixture();
    const word=await upload('materials','课程.docx',wordData),ppt=await upload('notes','课件.pptx',pptFixture());
    const names=[word,ppt].map(r=>r.file_url.split('/').pop());
    for(const name of names)await ready(base,name);
    for(const name of names){const r=await fetch(base+'/attachments/'+name+'/preview.pdf');assert.equal(r.status,200);assert.equal(Buffer.from(await r.arrayBuffer()).subarray(0,5).toString(),'%PDF-');}
    const original=fs.readFileSync(path.join(back,'uploads',names[0]));assert.deepEqual(original,Buffer.from(wordData));
    const cache=path.join(back,'data/office-preview',names[0]);const revision=fs.readdirSync(cache)[0],pdfFile=path.join(cache,revision,'preview.pdf'),mtime=fs.statSync(pdfFile).mtimeMs;
    const url=await serve();
    for(const [i,viewport]of [[1280,960],[390,844]].entries()){
      const script=`window.COURSES_API_BASE=${JSON.stringify(base)};let aiCalls=0;const nativeFetch=fetch;fetch=(u,o)=>{if(String(u).includes('/api/ai/'))aiCalls++;return nativeFetch(u,o)};addEventListener('load',async()=>{const out=document.createElement('pre');out.id='regressionResult';const check=(v,m)=>{if(!v)throw Error(m)},el=id=>document.getElementById(id),wait=async fn=>{for(let i=0;i<350;i++){if(fn())return;await new Promise(r=>setTimeout(r,40))}throw Error(el('attachmentPreviewStatus')?.textContent||'timeout')};try{
        if(sessionStorage.getItem('office-reloaded'))await wait(()=>currentCourseId===${ids.courseId}&&currentView.type==='course');
        openCourse(${ids.courseId},'预览测试','materials');
        for(const [kind,id,pages]of [['material',${word.id},1],['note',${ppt.id},2]]){
          await openResourceDetail(kind,id);const button=el('resourceDetailPreview').querySelector('[data-attachment-preview]');check(button,'preview button: '+el('resourceDetailPreview').innerHTML+' / '+el('resourceDetailName').textContent);button.click();await wait(()=>attachmentViewer?.ready&&el('attachmentPreviewStage').querySelector('canvas')&&el('attachmentPreviewStatus').textContent.includes('可翻页'));
          check(attachmentViewer.pdf.numPages===pages,'real document page count');check(el('attachmentPreviewDownload').href.endsWith(kind==='note'?'.pptx':'.docx'),'download remains original');
          if(pages>1){el('attachmentPreviewDialog').querySelector('[data-viewer-next]').click();await wait(()=>el('attachmentPageInfo').textContent.includes('2 / 2')&&el('attachmentPreviewStatus').textContent.includes('可翻页'));}
          el('attachmentPreviewDialog').querySelector('[data-viewer-plus]').click();await wait(()=>el('attachmentZoomInfo').textContent==='125%'&&el('attachmentPreviewStatus').textContent.includes('可翻页'));closeAttachmentPreview();
          await openResourceDetail(kind,id);el('resourceDetailPreview').querySelector('[data-attachment-preview]').click();await wait(()=>attachmentViewer?.ready);closeAttachmentPreview();check(el('resourceDetailContent').textContent==='原正文保持不变','body preserved after refetch');
        }
        if(!${real}){
          const normalFetch=fetch;
          fetch=(u,o)=>String(u).endsWith('/preview')?Promise.resolve(new Response(JSON.stringify({status:'preparing'}),{headers:{'Content-Type':'application/json'}})):normalFetch(u,o);
          void openAttachmentPreview(${JSON.stringify(base.replace(/\/api$/,'')+word.file_url)},'','等待中的 Word');await wait(()=>el('attachmentPreviewStatus').textContent.includes('正在准备'));
          closeAttachmentPreview();fetch=normalFetch;
          await openAttachmentPreview(${JSON.stringify(base.replace(/\/api$/,'')+ppt.file_url)},'','新 PPT');await wait(()=>attachmentViewer?.ready);await new Promise(r=>setTimeout(r,1600));check(el('attachmentPreviewTitle').textContent==='新 PPT'&&attachmentViewer?.ready,'closed polling cannot change new viewer');closeAttachmentPreview();
          let failedOnce=false;
          fetch=(u,o)=>{if(!failedOnce&&String(u).endsWith('/preview')){failedOnce=true;return Promise.resolve(new Response(JSON.stringify({status:'failed',code:'CONVERSION_FAILED'}),{headers:{'Content-Type':'application/json'}}))}return normalFetch(u,o)};
          await openAttachmentPreview(${JSON.stringify(base.replace(/\/api$/,'')+word.file_url)},'','失败重试');await wait(()=>el('attachmentPreviewStage').querySelector('button'));check(el('attachmentPreviewStatus').classList.contains('attachment-error'),'conversion error visible');el('attachmentPreviewStage').querySelector('button').click();await wait(()=>attachmentViewer?.ready);fetch=normalFetch;closeAttachmentPreview();
        }
        if(!sessionStorage.getItem('office-reloaded')){sessionStorage.setItem('office-reloaded','1');location.reload();return;}
        check(aiCalls===0,'no AI requests');check(document.documentElement.scrollWidth<=innerWidth+1,'mobile width');
        await openAttachmentPreview(${JSON.stringify(base.replace(/\/api$/,'')+(i===0?word:ppt).file_url)},'','课程文档预览');await wait(()=>attachmentViewer?.ready&&el('attachmentPreviewStatus').textContent.includes('可翻页'));out.textContent='PASS';
      }catch(e){out.textContent='FAIL '+e.stack}document.body.append(out)});`;
      const html=await runBrowser({chrome,profile:path.join(temp,'office-browser-'+i),url,viewport,initScript:script,screenshot:path.join(require('node:os').tmpdir(),'courses-office-'+(real?'real':'simulated')+'-'+viewport[0]+'.png')});
      assert.match(html.match(/<pre id="regressionResult">[\s\S]*?<\/pre>/)?.[0]||'',/>PASS</);
    }
    await restart();for(const name of names)await ready(base,name);assert.equal(fs.statSync(pdfFile).mtimeMs,mtime,'restart reuses disk cache');
    const changed=new FormData();changed.append('file',new Blob([pptFixture()]),'替换.pptx');
    const replaced=await fetch(base+'/courses/'+ids.courseId+'/materials/'+word.id+'/file',{method:'PUT',body:changed});assert.equal(replaced.status,200);
    const row=await replaced.json(),next=row.file_url.split('/').pop();assert.notEqual(next,names[0]);await ready(base,next);
    assert.equal((await fetch(base+'/attachments/'+names[0]+'/preview.pdf')).status,404,'deleted source cannot serve old preview');
    assert.equal((await api('GET','/materials/'+word.id)).content,'原正文保持不变');
    await api('DELETE','/courses/'+ids.courseId+'/materials/'+word.id+'/file');
    assert.equal((await fetch(base+'/attachments/'+next+'/preview.pdf')).status,404);
  },{legacy:false,...(!real?{setupBackend:({back})=>{
    const file=path.join(back,'officePreview/index.js');
    fs.appendFileSync(file,`\nconst originalCreate=module.exports.createOfficePreview;module.exports.createOfficePreview=options=>originalCreate({...options,findConverter:()=>'/simulated',convertFile:async(file,out)=>{await new Promise(r=>setTimeout(r,300));fs.writeFileSync(path.join(out,path.parse(file).name+'.pdf'),/ppt/.test(path.extname(file))?${JSON.stringify(pdfFixture(2))}:${JSON.stringify(pdfFixture(1))});}});`);
  }}:{})}));
