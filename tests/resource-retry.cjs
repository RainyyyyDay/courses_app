const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {fixture}=require('./temp-backend-fixture.cjs'),{runBrowser}=require('./browser-driver.cjs');

test('resource retry prepares its own question, saves selection, reopens and starts fresh attempts without AI',{timeout:90000},async()=>fixture(async({base,ids,temp,serve})=>{
  const url=await serve(),chrome=['C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Google/Chrome/Application/chrome.exe'].find(fs.existsSync);assert.ok(chrome);
  for(const [index,viewport]of [[1280,960],[390,844]].entries()){
    const script=`window.COURSES_API_BASE=${JSON.stringify(base)};addEventListener('load',async()=>{
      const out=document.createElement('pre');out.id='regressionResult';const check=(v,m)=>{if(!v)throw Error(m)};
      const api=async(method,path,body)=>(await requestApi(API+'/courses/'+${ids.courseId}+path,{method,...(body?{headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{})})).json();
      try{
        await openCourse(${ids.courseId},'重新作答验收','materials');
        const restored=JSON.parse(sessionStorage.getItem('retry-rows')||'null');
        if(restored){
          for(const {type,row,oldAttempt}of restored){
            await openReviewWorkbench(type,row.id,{row});check(wb('Mode').value==='retry'&&wb('Reference')?.value==='正确答案：B','retry selection and editable answer survive refresh');closeReviewWorkbench();
            await enterCenterReview(await createReviewRecord('total',[{type,id:row.id}]));
            check(reviewWorkbench?.attempt?.modeId==='standard'&&!wb('Answer').value,'fresh retry opens blank independent answer');
            check(!wb('Attempt').textContent.includes('正确答案：B'),'answer hidden before submission');
            const old=await api('GET','/review-items/'+type+'/'+row.id+'/attempts/'+oldAttempt);check(old.firstAnswer==='我第一次选择 A','previous evidence survives repeat');
            closeReviewWorkbench();await pauseCenterReview();
          }
          out.dataset.result='passed';out.textContent='passed';document.body.append(out);return;
        }
        const rows=[];
        for(const type of ['material','note']){
          const row=await api('POST','/'+(type==='material'?'materials':'notes'),{title:'重新作答 '+type+'${index}',content:'How do you ___? A) explain B) account'});
          await openResourceDetail(type,row.id);document.querySelector('[data-review-preparation]').click();
          for(let i=0;i<200&&(!reviewWorkbench||reviewWorkbench.busy);i++)await new Promise(r=>setTimeout(r,20));
          check(!document.querySelector('[data-review-retry-setup]'),'detail keeps a single shared review management entry');
          wb('Mode').value='retry';wb('Mode').dispatchEvent(new Event('change'));
          for(let i=0;i<200&&(!wb('Reference')||reviewWorkbench.busy);i++)await new Promise(r=>setTimeout(r,20));
          check(wb('Prompt')&&wb('Reference')&&wb('Mode').value==='retry','retry setup distinct from standard recall');
          check(wb('Reference').closest('label').textContent.includes('参考答案 / 解析（必填）'),'answer field is explicitly labelled');
          await saveWorkbenchMaterial();check(reviewWorkbench&&wb('Error').textContent.includes('补齐'),'missing answer keeps setup open');
          wb('Reference').value='正确答案：B';await saveWorkbenchMaterial();
          check(!reviewWorkbench&&readResourceAiMethod({courseId:${ids.courseId},type,id:row.id})==='retry','task save binds retry rather than standard');
          await openResourceDetail(type,row.id);
          check(!document.querySelector('[data-review-retry-setup]'),'detail has no mode-specific button');
          document.querySelector('[data-review-preparation]').click();
          for(let i=0;i<200&&(!wb('Reference')||reviewWorkbench?.busy);i++)await new Promise(r=>setTimeout(r,20));
          check(wb('Dialog').open&&wb('Reference').value==='正确答案：B'&&getComputedStyle(wb('Reference')).display!=='none','shared dialog opens saved editable answer');
          check(wb('Actions').textContent.includes('保存题目、答案并使用重新作答'),'dialog has explicit save action');
          closeReviewWorkbench();
          await openReviewWorkbench(type,row.id,{row});check(wb('Mode').value==='retry'&&wb('Reference').value==='正确答案：B','retry reopens ready');closeReviewWorkbench();
          await enterCenterReview(await createReviewRecord('total',[{type,id:row.id}]));
          check(reviewWorkbench?.attempt?.modeId==='standard'&&wb('Answer'),'bound retry starts actual answer engine');
          const oldAttempt=reviewWorkbench.attempt.id,sessionId=reviewWorkbench.sessionId;
          check(wb('Attempt').textContent.includes('实际执行：重新作答'),'retry is labelled as retry');
          wb('Answer').value='暂停前尚未提交的答案';closeReviewWorkbench();await pauseCenterReview();
          await enterCenterReview(await api('GET','/review-sessions/'+sessionId));
          check(reviewWorkbench?.attempt?.id===oldAttempt&&wb('Answer')?.value==='暂停前尚未提交的答案','resume keeps retry engine and draft');
          check(wb('Attempt').textContent.includes('实际执行：重新作答'),'resume keeps retry label');
          wb('Answer').value='我第一次选择 A';await submitWorkbenchAttempt('submit');
          check(wb('Attempt').textContent.includes('正确答案：B'),'submit reveals saved answer');closeReviewWorkbench();await pauseCenterReview();
          rows.push({type,row,oldAttempt});
          // Existing self-explanation tasks are reused, rather than demanding a standard task.
          const other=await api('POST','/'+(type==='material'?'materials':'notes'),{title:'复用讲解 '+type,content:'解释能量变化'});
          await openReviewWorkbench(type,other.id,{row:other,sourceText:other.content,mode:'self_explain'});wb('Reference').value='保留已有参考';await saveWorkbenchMaterial();
          await openReviewWorkbench(type,other.id,{row:other,mode:'retry'});check(reviewWorkbench.resourceRetryTarget==='self_explain','retry discovers currently saved task mode');saveResourceRetryMode();
          await enterCenterReview(await createReviewRecord('total',[{type,id:other.id}]));check(reviewWorkbench?.attempt?.modeId==='self_explain','retry reuses self explanation');closeReviewWorkbench();await pauseCenterReview();
        }
        sessionStorage.setItem('retry-rows',JSON.stringify(rows));location.reload();return;
      }catch(e){out.dataset.result='failed';out.textContent=e.stack}document.body.append(out);
    });`;
    const html=await runBrowser({chrome,profile:path.join(temp,'resource-retry-'+index),url,viewport,initScript:script,blockedUrls:['https://api.deepseek.com/*']});
    const result=html.match(/<pre id="regressionResult"[^>]*>[\s\S]*?<\/pre>/)?.[0];assert.match(result||'',/data-result="passed"/,result||html.slice(-1800));
  }
}));
