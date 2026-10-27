const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {fixture}=require('./temp-backend-fixture.cjs'),{runBrowser}=require('./browser-driver.cjs');

test('resource standard preparation uses native recall without reference forms, preserves saved materials after reopen and refresh',{timeout:90000},async()=>fixture(async({base,ids,temp,serve,api})=>{
  const rows=[];
  for(const type of ['material','note']){
    const row=await api('POST',`/courses/${ids.courseId}/${type==='material'?'materials':'notes'}`,{title:type,content:'正文：先阅读，再回忆'},201);
    const route=`/courses/${ids.courseId}/review-items/${type}/${row.id}/materials/standard`;
    await api('PUT',route,{expectedVersion:0,confirmed:true,material:{prompt:'旧任务',reference:'保留旧要点',rubric:'保留旧标准'}});
    const originalRow=await api('POST',`/courses/${ids.courseId}/${type==='material'?'materials':'notes'}`,{title:type+'-原文',content:'AI 识别后的原文'},201);
    const originalRoute=`/courses/${ids.courseId}/review-items/${type}/${originalRow.id}/materials/standard`;
    const originalSaved=await api('PUT',originalRoute,{expectedVersion:0,confirmed:true,material:{prompt:'AI 识别后的原文'}});
    assert.equal(originalSaved.version,1);
    rows.push({type,row,route});
  }
  const url=await serve(),chrome=['C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(fs.existsSync);
  assert.ok(chrome);
  for(const [index,viewport]of [[1280,960],[390,844]].entries()){
    const script=`window.COURSES_API_BASE=${JSON.stringify(base)};addEventListener('load',async()=>{
      const out=document.createElement('pre');out.id='regressionResult';
      const check=(ok,message)=>{if(!ok)throw Error(message)};
      const wait=async(fn,message)=>{for(let i=0;i<250;i++){if(fn())return;await new Promise(resolve=>setTimeout(resolve,20))}throw Error(message)};
      try{
        await openCourse(${ids.courseId},'标准复习检查','materials');
        for(const {type,row}of ${JSON.stringify(rows)}){
          for(let pass=0;pass<2;pass++){
            await openReviewWorkbench(type,row.id,{row,sourceText:row.content,mode:'standard'});
            check(wb('Prompt')&&!wb('Reference')&&!wb('Rubric'),'standard keeps only the original text');
            check(!wb('Editor').querySelector('.review-ai-generator'),'standard has no answer-material generator');
            check(wb('Prompt').parentElement.textContent.includes('复习原文'),'standard labels the source as original text');
            check(!wb('Actions').querySelector('[data-save-start]')&&wb('Editor').textContent.includes('清楚'),'uses native recall explanation');
            if(pass===0){await loadReviewWorkbenchMode('self_explain');check(wb('Reference')&&wb('Rubric'),'self explanation keeps its own form');await loadReviewWorkbenchMode('standard');check(!wb('Reference')&&!wb('Rubric'),'switch back removes forms');}
            wb('Actions').querySelector('button').click();await wait(()=>!wb('Dialog').open,'saving original text closes settings');
          }
        }
        check(document.documentElement.scrollWidth<=innerWidth+1,'mobile layout fits');
        if(!sessionStorage.getItem('standard-refreshed')){sessionStorage.setItem('standard-refreshed','1');location.reload();return;}
        out.dataset.result='passed';out.textContent='passed';
      }catch(e){out.dataset.result='failed';out.textContent=e.stack}document.body.append(out);
    });`;
    const html=await runBrowser({chrome,profile:path.join(temp,'standard-'+index),url,viewport,initScript:script,blockedUrls:['https://api.deepseek.com/*'],noSandbox:true});
    const result=html.match(/<pre id="regressionResult"[^>]*>[\s\S]*?<\/pre>/)?.[0];assert.match(result||'',/data-result="passed"/,result||html.slice(-1500));
  }
  for(const {route}of rows){const saved=await api('GET',route);assert.ok(saved.version>=1);assert.equal(saved.material.reference,'保留旧要点');assert.equal(saved.material.rubric,'保留旧标准');}
}));
