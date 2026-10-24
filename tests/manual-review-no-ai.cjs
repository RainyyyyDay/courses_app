const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {fixture}=require('./temp-backend-fixture.cjs'),{runBrowser}=require('./browser-driver.cjs');
test('manual review availability is independent of AI credentials',()=>{
  const context=vm.createContext({AI_SELECTABLE_METHODS:{standard:'标准',self_explain:'讲解',contrast:'对比'},coursesAiSettings:{realReady:()=>false},addEventListener(){}});
  vm.runInContext(fs.readFileSync(path.join(__dirname,'../fronted/js/reviewMethodChoice.js'),'utf8'),context);
  assert.equal(context.reviewAdviceAiReady(),false);
  for(const mode of ['contrast','self_explain']){assert.equal(context.reviewMethodRequiresRealAi(mode),false);assert.equal(context.reviewMethodIsAvailable(mode),true);}
  assert.equal(context.reviewMethodIsAvailable('unknown'),false);
});

test('manual contrast and self explanation run without AI: prepare save enter submit reopen refresh',{timeout:120000},async()=>fixture(async({api,base,ids,temp,serve})=>{
  const chrome=['C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Google/Chrome/Application/chrome.exe'].find(fs.existsSync);assert.ok(chrome);const url=await serve();
  for(const [index,viewport]of [[1280,960],[390,844]].entries()){
    const items=[];
    for(const type of ['mistake','material','note']){
      const table={mistake:'mistakes',material:'materials',note:'notes'}[type];
      const row=await api('POST','/courses/'+ids.courseId+'/'+table,{title:'手动对比 '+type,content:'比较首都与省会',...(type==='mistake'?{questionFormat:'open',mistakeType:'thinking',answerContent:'参考解释'}:{})},201);
      items.push({type,row});
    }
    const script=`window.COURSES_API_BASE=${JSON.stringify(base)};let aiCalls=0;const nativeFetch=fetch;fetch=(u,o)=>{if(String(u).includes('/api/ai/')){aiCalls++;throw Error('AI must not be requested')}return nativeFetch(u,o)};addEventListener('load',async()=>{const out=document.createElement('pre');out.id='regressionResult';const el=id=>document.getElementById(id),q=s=>document.querySelector(s),check=(v,m)=>{if(!v)throw Error(m)},wait=async(fn)=>{for(let n=0;n<250;n++){if(fn())return;await new Promise(r=>setTimeout(r,20))}throw Error('UI timeout')},api=async(p)=>{const r=await nativeFetch(${JSON.stringify(base)}+p);if(!r.ok)throw Error(await r.text());return r.json()};try{
      check(!coursesAiSettings.realReady(),'no configured AI');
      const restore=JSON.parse(sessionStorage.getItem('manual-no-ai')||'null');
      if(restore){
        await wait(()=>currentCourseId===${ids.courseId}&&reviewWorkbench?.attempt?.id===restore.attemptId);
        check(reviewWorkbench?.attempt?.id===restore.attemptId&&reviewWorkbench.mode===restore.mode,'actual refresh restores manual mode and attempt');
        check(wb('Attempt').querySelector('[data-contrast-field]')?.value==='刷新后保留的比较内容','refresh retains unsubmitted manual answer');
        await submitWorkbenchAttempt('submit');check(reviewWorkbench.attempt.stage==='answer','submit after refresh without AI');await submitWorkbenchAttempt('judge',2);check(reviewWorkbench.attempt.grade===2,'manual self grade');
        check(aiCalls===0,'no model requests');out.textContent='PASS';document.body.append(out);return;
      }
      openCourse(${ids.courseId},'无需 AI 的复习','materials');
      await openResourceCreate('material');
      for(const mode of ['contrast','self_explain'])check(!q('#tagPickerReviewMethod option[value="'+mode+'"]').disabled,'mode selectable '+mode);
      check(el('tagPickerReviewModeAdvice').disabled,'AI advice still requires configuration');closeTagPicker();
      const items=${JSON.stringify(items)};
      for(const {type,row}of items)for(const mode of ['contrast','self_explain']){
        const context={row,sourceText:row.content,mode};
        await openReviewWorkbench(type,row.id,context);
        wb('Prompt').value=mode==='contrast'?'比较首都与省会':'用自己的话解释首都';wb('Reference').value='首都是国家行政中心，省会是省级行政中心';
        if(mode==='contrast'){wb('Objects').value='首都\\n省会';wb('Dimensions').value='管辖范围';}
        check(q('[data-material-ai-generate]').disabled,'only AI generation unavailable');
        await saveWorkbenchMaterial();check(!reviewWorkbench,'manual preparation saved and closed');
        await openReviewWorkbench(type,row.id,context);check(wb('Reference').value.includes('国家行政中心'),'reopen saved material without AI');closeReviewWorkbench();
        saveStoredReviewMethod(type,row.id,mode);
        const session=await createReviewRecord('total',[{type,id:row.id}]);await enterCenterReview(session);
        check(!q('.review-mode-requirement'),'no AI requirement blocks mode');
        check(reviewWorkbench?.attempt?.modeId===mode,'saved manual mode auto-enters '+type+' '+mode);
        if(mode==='contrast')for(const field of wb('Attempt').querySelectorAll('[data-contrast-field]'))field.value='国家与省级范围不同';else wb('Answer').value='首都是国家行政中心';
        const attemptId=reviewWorkbench.attempt.id,ctx=centerWorkbenchContext(session.items[0],session);closeReviewWorkbench();
        await openReviewWorkbench(type,row.id,{...ctx,mode});check(reviewWorkbench.attempt?.id===attemptId,'reopen resumes exact manual attempt');
        await submitWorkbenchAttempt('submit');check(reviewWorkbench.attempt.stage==='answer','manual submit reveals reference');await submitWorkbenchAttempt('judge',2);check(reviewWorkbench.attempt.grade===2,'manual evaluation succeeds');
        closeReviewWorkbench();await pauseCenterReview();
      }
      const last=items[2];saveStoredReviewMethod(last.type,last.row.id,'contrast');const session=await createReviewRecord('total',[{type:last.type,id:last.row.id}]);await enterCenterReview(session);
      wb('Attempt').querySelector('[data-contrast-field]').value='刷新后保留的比较内容';const finalAttemptId=reviewWorkbench.attempt.id;closeReviewWorkbench();
      check(aiCalls===0,'preparation and review never call AI');sessionStorage.setItem('manual-no-ai',JSON.stringify({sessionId:session.id,attemptId:finalAttemptId,mode:'contrast'}));location.reload();
    }catch(e){out.textContent='FAIL '+e.stack;document.body.append(out)}});`;
    const html=await runBrowser({chrome,profile:path.join(temp,'manual-no-ai-'+index),url,viewport,initScript:script});assert.match(html.match(/<pre id="regressionResult">[\s\S]*?<\/pre>/)?.[0]||'',/>PASS</);
  }
}));
