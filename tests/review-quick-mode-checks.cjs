async function reviewQuickModeChecks(courseId){
  const check=(v,m)=>{if(!v)throw Error(m);};
  const api=async(method,url,body)=>{const r=await requestApi(API+'/courses/'+courseId+url,{method,...(body===undefined?{}:{headers:{'Content-Type':'application/json'},body:JSON.stringify(body)})});return r.json();};
  const row=await api('POST','/mistakes',{title:'一键模式状态同步',content:'请解释测试概念',answerContent:'原题参考答案',mistakeType:'thinking',questionFormat:'open'});
  const identity={courseId,id:row.id};saveMistakeAiMethod(identity,'self_explain');
  const session=await createReviewRecord('total',[{type:'mistake',id:row.id}]);await enterCenterReview(session);
  check(centerReview.quickMode.modeId==='self_explain'&&!centerReview.quickMode.ready&&reviewWorkbench?.inline&&document.querySelector('[data-quick-reason]').textContent.includes('不完整'),'missing materials show the suggested mode inline with explanation');
  await confirmCenterQuickMode();check(!reviewWorkbench.attempt&&reviewWorkbench.mode==='self_explain','missing materials never start or grade an invalid AI attempt');
  await toggleCenterQuickMode();check(!reviewWorkbench&&!wb('Dialog').open&&mistakeDetailState.progress.mode.id==='standard','one click returns to original standard engine');
  const context=centerWorkbenchContext(session.items[0],session);
  await openReviewWorkbench('mistake',row.id,context);await loadReviewWorkbenchMode('self_explain');await editWorkbenchMaterial();
  wb('Prompt').value='用自己的话讲清测试概念';wb('Reference').value='定义\n原因';wb('Rubric').value='完整且准确';await saveWorkbenchMaterial();closeReviewWorkbench();
  check(centerReview.quickMode.ready,'manual preparation immediately enables AI toggle');
  // A new session defaults to the confirmed, executable suggestion without creating an attempt.
  const next=await createReviewRecord('total',[{type:'mistake',id:row.id}]);await enterCenterReview(next);
  check(centerReview.quickMode.modeId==='self_explain'&&document.querySelector('[data-quick-toggle]').getAttribute('aria-pressed')==='true','valid AI suggestion selected by default');
  check(!wb('Dialog').open&&mistakeDetailState.progress.mode.id==='standard','selection alone never mutates native progress');
  await confirmCenterQuickMode();check(reviewWorkbench?.attempt?.modeId==='self_explain'&&wb('Answer').rows===10,'confirm reads selected mode, not native standard state');
  check(!wb('Suggestion').querySelector('button')&&document.querySelector('[data-quick-start]').hidden,'active matching advice does not request repeated adoption or start confirmation');
  check(!wb('Dialog').open&&reviewWorkbench.inline&&wb('Answer').closest('#mistakeDetailPage')&&wb('Answer').getClientRects().length>0,'AI answer is visible inside original page, never a modal');
  check(getComputedStyle(document.getElementById('mistakeReviewPanel')).display==='none','native and AI answer controls are mutually exclusive');
  const initialAttempt=reviewWorkbench.attempt.id;wb('Answer').value='设置展开不丢讲解';
  await openCenterReviewSettings();await openCenterReviewSettings();
  check(reviewWorkbench.attempt.id===initialAttempt&&wb('Answer').value==='设置展开不丢讲解'&&!wb('Dialog').open,'settings do not open dialog or reload answer');
  const aiAttempt=reviewWorkbench.attempt.id;wb('Answer').value='保留未提交的 AI 讲解';closeReviewWorkbench();
  await toggleCenterQuickMode();check(centerReview.quickMode.modeId==='standard','one click selects standard');
  check(!reviewWorkbench&&!document.getElementById('mistakeReviewPanel').hidden&&mistakeDetailState.progress.mode.id==='standard','one click immediately renders native standard without a second confirmation');
  await confirmCenterQuickMode();check(!wb('Dialog').open&&mistakeDetailState.progress.mode.id==='standard'&&!document.getElementById('mistakeReviewPanel').hidden,'standard confirmation uses original controller');
  const oldContext=centerWorkbenchContext(next.items[0],next);mistakeStorageSet(legacyReviewSelectionKey(oldContext),'standard');mistakeStorageSet(reviewModeSelectionKey(oldContext),null);
  reviewSelections.clear();await enterCenterReview(await api('GET','/review-sessions/'+next.id));
  check(centerReview.quickMode.modeId==='standard','stored manual standard selection beats AI default after reentry without memory cache');
  await toggleCenterQuickMode();check(centerReview.quickMode.modeId==='self_explain','second click selects AI');
  check(reviewWorkbench?.attempt?.id===aiAttempt&&wb('Answer').value==='保留未提交的 AI 讲解'&&!wb('Dialog').open,'second click immediately resumes inline AI, preserving the answer');
  await confirmCenterQuickMode();check(reviewWorkbench.attempt.id===aiAttempt&&wb('Answer').value==='保留未提交的 AI 讲解','switch back resumes original AI attempt and preserves input');
  check(!wb('Dialog').open&&wb('Answer').closest('#mistakeDetailPage'),'switching back remains on original page');
  closeReviewWorkbench();const refreshed=await api('GET','/review-sessions/'+next.id);await enterCenterReview(refreshed);
  check(reviewWorkbench?.attempt?.id===aiAttempt&&centerReview.quickMode.modeId==='self_explain','existing per-session persistence restores selected mode and round');
  await submitWorkbenchAttempt('submit');await submitWorkbenchAttempt('judge',2);await finishWorkbenchAttempt();closeReviewCompleteModal();
  const clean=await api('POST','/mistakes',{title:'无建议的标准回退',content:'题干',answerContent:'答案',mistakeType:'execution',questionFormat:'open'});
  const noAdvice=await createReviewRecord('total',[{type:'mistake',id:clean.id}]);await enterCenterReview(noAdvice);
  check(centerReview.quickMode.modeId===centerReview.quickMode.originalMode&&document.querySelector('[data-quick-reason]').textContent.includes('没有'),'no AI retains original engine with explanation');
  mistakeStorageSet(mistakeAiStorageKey({courseId,id:clean.id}),{version:1,method:'invalid-mode'});
  await prepareCenterQuickMode(currentCenterItem(),centerReview.session);renderCenterReviewToolbar();
  check(centerReview.quickMode.modeId===centerReview.quickMode.originalMode&&centerReview.quickMode.reason.includes('无效'),'invalid advice never submitted');
  await confirmCenterQuickMode();document.getElementById('mistakeFirstAnswer').value='我的标准作答';await submitMistakeReview('reveal_answer');await submitMistakeReview('judge','correct',true);closeReviewCompleteModal();
  await openCourse(courseId,'测试课程','mistakes');await openMistakeCreate();
  check(getComputedStyle(document.getElementById('mistakeCreateOcrBtn')).display==='none','OCR hidden before attachment');
  const transfer=new DataTransfer();transfer.items.add(new File(['synthetic non-private fixture'],'test-question.png',{type:'image/png'}));
  const input=document.getElementById('mistakeCreateQuestionUpload');input.files=transfer.files;input.dispatchEvent(new Event('change'));
  check(getComputedStyle(document.getElementById('mistakeCreateOcrBtn')).display!=='none'&&document.getElementById('mistakeCreateOcrBtn').getClientRects().length>0,'selecting attachment reveals actual OCR button');
  closeTagPicker();
  const nativeRow=await api('POST','/mistakes',{title:'合并保留错题列表入口',content:'2+2=?',answerContent:'4',mistakeType:'knowledge',questionFormat:'open'});
  saveMistakeAiMethod({courseId,id:nativeRow.id},'retry');
  switchTab('mistakes');await openMistakeCategory(null);await enterMistakeReviewFromHome();await openMistakeReviewCategory('knowledge');await clearMistakeFilters();chooseMistake(nativeRow.id,true);await startMistakeQueue();
  check(centerReview?.session.source_type==='mistake'&&reviewWorkbench?.inline&&reviewWorkbench.mode==='retry','merge preserves AI inline mode from the ordinary mistake-list entry');
  await confirmCenterQuickMode();check(!reviewWorkbench&&!document.getElementById('mistakeReviewPanel').hidden,'native AI retry uses original answer controls');
  await renderCenterReviewItem();check(!reviewWorkbench&&centerReview.quickMode.modeId==='retry','native AI progress survives reentry without reopening preparation');
  await toggleCenterQuickMode();check(!reviewWorkbench&&centerReview.quickMode.modeId===centerReview.quickMode.originalMode,'native AI switches back to original mode');
  await pauseCenterReview();
  // Advice -> inline preparation -> confirmed material -> existing attempt, for all content types.
  for(const [type,mode]of [['mistake','cloze'],['material','self_explain'],['note','contrast']]){
    const created=await api('POST','/'+({mistake:'mistakes',material:'materials',note:'notes'}[type]),{title:'就地材料 '+type,content:'中国的首都是北京',...(type==='mistake'?{answerContent:'北京',questionFormat:'open',mistakeType:'knowledge'}:{})});
    const identity={courseId,type,id:created.id};
    if(type==='mistake')saveMistakeAiMethod(identity,mode);else mistakeStorageSet(resourceAiKey(identity),{version:1,method:mode});
    const record=await createReviewRecord('total',[{type,id:created.id}]);await enterCenterReview(record);
    check(!centerReview.quickMode.ready&&document.querySelector('[data-prepare-suggestion]'),'missing suggestion has a direct preparation button for '+type);
    await prepareCenterSuggestedMaterial();
    check(reviewWorkbench.inline&&!wb('Dialog').open&&wb('Prompt')&&wb('Readiness').dataset.materialState==='draft','preparation is inline, editable and not a new attempt');
    await saveWorkbenchMaterial(true);check(!reviewWorkbench.attempt&&wb('Error').textContent.includes('补齐'),'incomplete drafts cannot save or start');
    wb('Prompt').value=mode==='cloze'?'中国首都是【b1】':'解释首都的含义';
    if(mode==='cloze'){addReviewBlank();wb('Blanks').querySelector('[data-blank=answer]').value='北京';}
    else wb('Reference').value='北京及首都的含义';
    if(mode==='contrast'){wb('Objects').value='首都\n省会';wb('Dimensions').value='管辖范围';}
    wb('Prompt').dispatchEvent(new Event('input',{bubbles:true}));
    check(wb('Readiness').textContent.includes('确认保存')&&!reviewWorkbench.attempt,'filled input remains a draft');
    await switchWorkbenchToAvailableMode();
    await prepareCenterSuggestedMaterial();check(wb('Prompt').value.includes(mode==='cloze'?'【b1】':'首都'),'fallback and return preserve the material draft');
    if(type==='note'){
      const originalRequest=requestApi;
      try{requestApi=async(url,options)=>{if(options?.method==='PUT')throw Error('模拟保存失败');return originalRequest(url,options);};await saveWorkbenchMaterial(true);}
      finally{requestApi=originalRequest;}
      check(!reviewWorkbench.attempt&&wb('Prompt').value.includes('首都')&&wb('Error').textContent.includes('输入已保留'),'failed save preserves draft and cannot start');
    }
    await saveWorkbenchMaterial();
    check(centerReview.quickMode.ready&&wb('Readiness').dataset.materialState==='ready'&&!reviewWorkbench.attempt,'save refreshes readiness for '+type+' without starting or grading');
    const state=await api('GET','/review-items/'+type+'/'+created.id+'/state');check(state.lastGrade==null,'material preparation writes no grade');
    await editWorkbenchMaterial();await saveWorkbenchMaterial(true);
    check(reviewWorkbench.attempt?.modeId===mode&&reviewWorkbench.attempt.firstAnswer===null,'explicit save-and-start uses selected mode');
    check(readReviewAiMethod(identity)===mode,'material preparation preserves the confirmed suggestion');
    await pauseCenterReview();
  }
  const preview=await createReviewRecord('total',[{type:'mistake',id:row.id}]);await enterCenterReview(preview);await confirmCenterQuickMode();
  check(reviewWorkbench?.inline&&wb('Answer').getClientRects().length&&!wb('Dialog').open,'final inline mode is visible for screenshot verification');
  check(document.documentElement.scrollWidth<=innerWidth+1,'inline review fits viewport');
}
module.exports={reviewQuickModeChecks};
