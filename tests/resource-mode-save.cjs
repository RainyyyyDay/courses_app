const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {fixture}=require('./temp-backend-fixture.cjs'),{runBrowser}=require('./browser-driver.cjs');

test('detail material management saves resource mode through reopen, resume, new review and refresh',{timeout:90000},async()=>fixture(async({base,ids,temp,serve,api})=>{
  const rows=[];
  for(const type of ['material','note'])rows.push({type,row:await api('POST',`/courses/${ids.courseId}/${type==='material'?'materials':'notes'}`,{title:type,content:'解释光合作用的作用'},201)});
  const url=await serve(),chrome=['C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Google/Chrome/Application/chrome.exe'].find(fs.existsSync);assert.ok(chrome);
  for(const [index,viewport]of [[1280,960],[390,844]].entries()){
    const script=`window.COURSES_API_BASE=${JSON.stringify(base)};addEventListener('load',async()=>{
      const out=document.createElement('pre');out.id='regressionResult';const check=(v,m)=>{if(!v)throw Error(m)};
      try{
        await openCourse(${ids.courseId},'保存复习模式','materials');
        const refreshed=!!sessionStorage.getItem('mode-refreshed');
        for(const {type,row}of ${JSON.stringify(rows)}){
          const context={courseId:${ids.courseId},type,id:row.id,row};
          if(refreshed){
            check(readResourceAiMethod(context)==='reading','mode survives refresh');
            await openResourceDetail(type,row.id);await openReviewWorkbench(type,row.id,{row,sourceText:row.content});
            check(reviewWorkbench.mode==='reading','management reopens selected mode after refresh');closeReviewWorkbench();
            const session=await createReviewRecord('total',[{type,id:row.id}]);await enterCenterReview(session);
            check(!reviewWorkbench&&document.querySelector('[data-material-review="exposure"]'),'new review uses reading after refresh');await pauseCenterReview();continue;
          }
          const old=await createReviewRecord('total',[{type,id:row.id}]);await enterCenterReview(old);await useCenterStandardReviewMode();await pauseCenterReview();
          await openResourceDetail(type,row.id);
          const button=document.querySelector('[data-review-preparation]');check(button,'detail management entry');button.click();
          for(let i=0;i<200&&(!reviewWorkbench||reviewWorkbench.busy);i++)await new Promise(r=>setTimeout(r,20));
          await loadReviewWorkbenchMode('self_explain');wb('Reference').value='植物把光能转为化学能';await saveWorkbenchMaterial();
          check(!reviewWorkbench&&readResourceAiMethod(context)==='self_explain','saving material also selects its mode');
          await openReviewWorkbench(type,row.id,{row,sourceText:row.content});check(reviewWorkbench.mode==='self_explain'&&wb('Reference').value.includes('化学能'),'reopen restores mode and saved material');closeReviewWorkbench();
          const latest=await(await requestApi(API+'/courses/'+${ids.courseId}+'/review-sessions/'+old.id)).json();await enterCenterReview(latest);
          check(reviewWorkbench?.attempt?.modeId==='self_explain','resumed unstarted standard follows newly saved mode');
          const attemptId=reviewWorkbench.attempt.id;wb('Answer').value='保留我尚未提交的讲解';closeReviewWorkbench();await pauseCenterReview();
          await openReviewWorkbench(type,row.id,{row,sourceText:row.content,mode:'standard'});saveWorkbenchStandardMode();
          check(!reviewWorkbench&&readResourceAiMethod(context)==='standard','can explicitly save standard again without duplicate materials');
          await openCourse(${ids.courseId},'保存复习模式',type==='note'?'notes':'materials');
          if(type==='note')await loadNotes();else await loadMaterials();
          await openTagPicker('edit',type,row.id);document.getElementById('tagPickerReviewMethod').value='reading';changeReviewMethodChoice('tagPicker');await confirmTagPicker();
          check(readResourceAiMethod(context)==='reading','edit saves new preference: '+[...document.querySelectorAll('.toast')].map(n=>n.textContent).join(' | '));
          await enterCenterReview(await(await requestApi(API+'/courses/'+${ids.courseId}+'/review-sessions/'+old.id)).json());
          check(reviewWorkbench?.attempt?.id===attemptId&&wb('Answer').value==='保留我尚未提交的讲解','active attempt and draft preserved when preference changes');closeReviewWorkbench();await pauseCenterReview();
          const next=await createReviewRecord('total',[{type,id:row.id}]);await enterCenterReview(next);
          check(!reviewWorkbench&&document.querySelector('[data-material-review="exposure"]'),'new review uses changed mode');await pauseCenterReview();
        }
        if(!refreshed){sessionStorage.setItem('mode-refreshed','1');location.reload();return;}
        out.dataset.result='passed';out.textContent='passed';
      }catch(e){out.dataset.result='failed';out.textContent=e.stack}document.body.append(out);
    });`;
    const html=await runBrowser({chrome,profile:path.join(temp,'resource-mode-'+index),url,viewport,initScript:script,blockedUrls:['https://api.deepseek.com/*']});
    const result=html.match(/<pre id="regressionResult"[^>]*>[\s\S]*?<\/pre>/)?.[0];assert.match(result||'',/data-result="passed"/,result||html.slice(-1800));
  }
}));
