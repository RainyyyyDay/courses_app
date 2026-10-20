// Runs inside the real site against the existing fresh-database HTTP fixture.
async function reviewModeChecks(courseId){
  const check=(value,message)=>{if(!value)throw Error('mode routing: '+message);};
  const wait=async(fn)=>{for(let n=0;n<200;n++){if(fn())return;await new Promise(r=>setTimeout(r,20));}throw Error('mode routing UI timeout');};
  const api=async(method,url,body)=>{const response=await requestApi(API+url,{method,...(body===undefined?{}:{headers:{'Content-Type':'application/json'},body:JSON.stringify(body)})});return response.json();};
  const prefix='/courses/'+courseId;
  const create=async(type='knowledge',extra={})=>api('POST',prefix+'/mistakes',{title:'模式实际操作验证',content:'解释为什么 2+2=4',answerContent:'4，两个二相加',mistakeType:type,questionFormat:'open',...extra});
  const enter=async row=>{const session=await createReviewRecord('total',[{type:'mistake',id:row.id}]);await enterCenterReview(session);return session;};
  const open=async(row,session)=>openReviewWorkbench('mistake',row.id,centerWorkbenchContext(session.items[0],session));
  const pause=async()=>{closeReviewWorkbench();await pauseCenterReview();};
  const state=id=>api('GET',prefix+'/review-items/mistake/'+id+'/state');
  for(const type of ['knowledge','thinking','execution','unclassified']){
    const row=await create(type),session=await enter(row);
    await open(row,session);
    check(reviewWorkbench.mode===(type==='execution'?'retry':'standard'),'no-AI default for '+type);
    check(!wb('Editor').textContent.includes('尚缺少')&&!wb('Prompt'),'native question never requires duplicate materials');
    const before=await state(row.id);await runExistingReviewMode();
    check(!wb('Dialog').open&&mistakeDetailState.progress.stage==='question','native mode opens actual first-answer step');
    check(JSON.stringify(await state(row.id))===JSON.stringify(before),'recommendation/dispatch never adds a grade');
    await pause();
  }
  const pending=await create('knowledge',{questionFormat:undefined});
  let session=await enter(pending);await open(pending,session);
  check(reviewWorkbench.mode==='standard','unconfirmed type uses safe standard default');
  await loadReviewWorkbenchMode('choice_reproduction');
  check(wb('Editor').textContent.includes('已确认')&&wb('Actions').textContent.includes('标准复习'),'incompatible choice is explained with an executable escape');
  wb('Actions').querySelector('button').click();await wait(()=>reviewWorkbench.mode==='standard'&&!reviewWorkbench.busy);await pause();

  const row=await create('thinking');
  const adviceKey=mistakeAiStorageKey({courseId,id:row.id});
  saveMistakeAiMethod({courseId,id:row.id},'cloze');const adviceBefore=localStorage.getItem(adviceKey);
  session=await enter(row);
  check(centerReview.quickMode.modeId==='standard'&&!centerReview.quickMode.ready,'missing AI material defaults to safe native flow');
  await open(row,session);
  check(reviewWorkbench.inline&&!wb('Dialog').open&&reviewWorkbench.mode==='cloze','manual AI entry renders in the original page');
  check(wb('Editor').textContent.includes('空位')&&wb('Editor').textContent.includes('AI 建议'),'AI mode ID is not treated as prepared material');
  const originalProgress=JSON.stringify(mistakeDetailState.progress);
  wb('Actions').querySelectorAll('button')[1].click();await wait(()=>reviewWorkbench.mode==='standard');await runExistingReviewMode();
  check(JSON.stringify(mistakeDetailState.progress)===originalProgress,'fallback preserves existing native progress');
  await open(row,session);check(reviewWorkbench.mode==='standard','explicit fallback beats unchanged AI on reopen');
  closeReviewWorkbench();await enterCenterReview(await api('GET',prefix+'/review-sessions/'+session.id));
  check(!wb('Dialog').open,'reentering this session keeps explicit native choice');
  await pause();

  // Prepare missing materials directly in an active session, then execute each
  // engine. The only shared part for self-explain/contrast is open-answer grading.
  for(const mode of ['cloze','self_explain','contrast','reading']){
    session=await enter(row);await open(row,session);await loadReviewWorkbenchMode(mode);
    check(wb('Actions').textContent.includes('手动'),'missing '+mode+' has a working manual action');
    const scoreBefore=JSON.stringify(await state(row.id));
    wb('Actions').querySelector('button').click();await wait(()=>wb('Prompt')&&!reviewWorkbench.busy);
    wb('Prompt').value=mode==='cloze'?'两个二相加为【b1】':'请'+(mode==='reading'?'阅读本片段，记录疑问':'独立说明两个二相加');
    if(mode==='cloze'){
      addReviewBlank();const blank=wb('Blanks').querySelector('.review-blank');
      blank.querySelector('[data-blank="answer"]').value='四';blank.querySelector('[data-blank="aliases"]').value='4';
    }
    if(wb('Reference'))wb('Reference').value='核对专属要点：两个二组成四';
    if(wb('Rubric'))wb('Rubric').value='解释数量关系与推导';
    if(mode==='contrast'){
      check(wb('Objects')&&wb('Dimensions'),'contrast has distinct object/dimension controls');
      wb('Objects').value='加法\n乘法';wb('Dimensions').value='定义\n适用范围';
    }
    await saveWorkbenchMaterial();check(!wb('Error').textContent&&!wb('Prompt'),'confirm/save returns to practice');
    check(JSON.stringify(await state(row.id))===scoreBefore,'material preparation never grades');
    check(localStorage.getItem(adviceKey)===adviceBefore,'materials never overwrite confirmed AI advice');
    await startWorkbenchAttempt();
    check(reviewWorkbench.attempt.modeId===mode,'actual attempt uses selected '+mode);
    check(!reviewWorkbench.attempt.material.reference&&!reviewWorkbench.attempt.material.rubric,'reference/rubric hidden before first answer');
    if(mode==='cloze'){
      check(!reviewWorkbench.attempt.material.blanks[0].answer,'cloze hides answers before submit');
      wb('Attempt').querySelector('[data-review-blank]').value='4';await submitWorkbenchAttempt('submit');
      check(reviewWorkbench.attempt.grade===3&&reviewWorkbench.attempt.result.results[0].correct,'cloze checks alias objectively');
    }else{
      if(mode==='self_explain'){
        check(wb('Answer').rows===10&&wb('Attempt').textContent.includes('自己的话'),'self-explain asks for explanation');
        wb('Answer').value='旧轮次的首次讲解';await submitWorkbenchAttempt('submit');
        const old=reviewWorkbench.attempt.id;closeReviewWorkbench();await open(row,session);
        await loadReviewWorkbenchMode('retry');await runExistingReviewMode();
        check(reviewWorkbench.attempt.id!==old&&reviewWorkbench.attempt.modeId==='self_explain','retry survives closing and reuses actual engine');
        const evidence=await api('GET',prefix+'/review-items/mistake/'+row.id+'/attempts/'+old);
        check(evidence.firstAnswer==='旧轮次的首次讲解','retry retains previous evidence');
        const retryId=reviewWorkbench.attempt.id;closeReviewWorkbench();await enterCenterReview(await api('GET',prefix+'/review-sessions/'+session.id));
        check(reviewWorkbench.inline&&!wb('Dialog').open&&reviewWorkbench.mode==='self_explain','returning to session resumes actual retry engine inline');
        await loadReviewWorkbenchMode('self_explain');check(reviewWorkbench.attempt.id===retryId,'existing retry attempt is resumable without creating another one');
      }
      if(mode==='contrast'){
        check(wb('Attempt').querySelectorAll('tbody textarea').length===4&&!wb('Answer'),'contrast uses the structured object/dimension matrix');
        for(const field of wb('Attempt').querySelectorAll('[data-contrast-field]'))field.value='我的独立比较';
      }else wb('Answer').value=mode==='reading'?'已读，需再看':'我的独立讲解、异同与核对要点';
      if(mode==='reading')wb('ReadComplete').click();
      await submitWorkbenchAttempt(mode==='reading'?'complete':'submit');
      if(mode==='reading'){
        check(reviewWorkbench.attempt.grade===null&&reviewWorkbench.attempt.result.exposureOnly,'reading only records exposure');
        check(JSON.stringify(await state(row.id))===scoreBefore,'reading never changes grade history/state');
      }else{
        check(wb('Attempt').textContent.includes('核对专属要点')&&reviewWorkbench.attempt.stage==='answer','submitted explanation reveals reference and rubric');
        await submitWorkbenchAttempt('judge',2);check(reviewWorkbench.attempt.grade===2,'shared open grading remains Hard');
      }
    }
    const completed=await api('GET',prefix+'/review-sessions/'+session.id);
    check(completed[mode==='reading'?'exposed':'passed']===1,'existing session result updated for '+mode);
    await finishWorkbenchAttempt();closeReviewCompleteModal();
  }

  // Switching from objective choice to native standard must start the actual
  // standard flow and update the queue round, so completion still closes it.
  const choice=await create('execution',{questionFormat:'choice',options:[{id:'A',text:'三'},{id:'B',text:'四'}],correctOption:'B'});
  session=await enter(choice);await open(choice,session);
  check(reviewWorkbench.mode==='choice_reproduction','confirmed compatible choice takes priority in rules');
  await runExistingReviewMode();check(document.querySelector('input[name="mistakeChoiceOption"]'),'choice routes to real option controls');
  await open(choice,session);await loadReviewWorkbenchMode('standard');await runExistingReviewMode();
  check(mistakeDetailState.progress.mode.id==='standard'&&document.getElementById('mistakeFirstAnswer'),'mode switch actually starts standard first answer');
  document.getElementById('mistakeFirstAnswer').value='首次独立回答四';await submitMistakeReview('reveal_answer');await submitMistakeReview('judge','correct',true);
  const finished=await api('GET',prefix+'/review-sessions/'+session.id);
  check(finished.status==='completed'&&finished.passed===1,'native mode switch still completes original session');closeReviewCompleteModal();

  const note=await api('POST',prefix+'/notes',{title:'资料/笔记模式退路',content:'供阅读的正文'});
  session=await createReviewRecord('total',[{type:'note',id:note.id}]);await enterCenterReview(session);
  await openReviewWorkbench('note',note.id,centerWorkbenchContext(session.items[0],session));await loadReviewWorkbenchMode('self_explain');closeReviewWorkbench();
  await enterCenterReview(await api('GET',prefix+'/review-sessions/'+session.id));
  check(reviewWorkbench.inline&&!wb('Dialog').open&&reviewWorkbench.mode==='self_explain','note explicit mode survives session reentry inline');
  await switchWorkbenchToAvailableMode();
  check(!wb('Dialog').open&&currentView.type==='readingReview'&&activeReadingReview.row.id===note.id,'note missing-material escape returns to existing reader');
  const beforeReading=JSON.stringify(await api('GET',prefix+'/review-items/note/'+note.id+'/state'));
  await activeReadingReview.save('reviewed');
  check(JSON.stringify(await api('GET',prefix+'/review-items/note/'+note.id+'/state'))===beforeReading,'native reading escape never creates a Good grade');closeReviewCompleteModal();
}
module.exports={reviewModeChecks};
