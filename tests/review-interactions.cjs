// Executed in real Chrome, on the normal index.html with an isolated HTTP/SQLite fixture.
async function reviewInteractionChecks(courseId){
  const check=(value,message)=>{if(!value)throw Error(message);};
  const api=async(method,url,body)=>{const response=await requestApi(API+'/courses/'+courseId+url,{method,...(body===undefined?{}:{headers:{'Content-Type':'application/json'},body:JSON.stringify(body)})});return response.json();};
  const row=await api('POST','/mistakes',{title:'七模式路径验证',content:'中国的首都是？2+2=?',answerContent:'北京，4',mistakeType:'thinking',questionFormat:'open'});
  const identity={courseId,id:row.id};
  check(recommendReviewMode('mistake',row).mode==='standard','thinking deterministic fallback');
  check(recommendReviewMode('mistake',{...row,mistake_type:'execution'}).mode==='retry','execution deterministic retry');
  check(recommendReviewMode('mistake',{...row,mistake_type:'knowledge'}).mode==='standard','knowledge deterministic standard');
  check(recommendReviewMode('mistake',{...row,question_format_confirmed:0,mistake_type:'execution'}).mode==='standard','unconfirmed format is not guessed');
  check(recommendReviewMode('mistake',row,'reading','cloze').mode==='reading','explicit selection beats confirmed AI');
  check(saveMistakeAiMethod(identity,'cloze'),'confirmed AI advice saved');
  const savedAi=localStorage.getItem(mistakeAiStorageKey(identity));
  const before=await api('GET','/review-items/mistake/'+row.id+'/state');
  const session=await createReviewRecord('total',[{type:'mistake',id:row.id}]);await enterCenterReview(session);
  check(!wb('Dialog').open&&mistakeDetailState.progress.mode.id==='standard','saving advice never silently changes executing native mode');
  const context=centerWorkbenchContext(session.items[0],session);
  await openReviewWorkbench('mistake',row.id,context);
  check(wb('Suggestion').querySelector('button')&&wb('Info').textContent.includes('当前实际流程：标准复习'),'suggestion and actual mode shown separately');
  wb('Suggestion').querySelector('button').click();
  for(let i=0;i<200&&reviewWorkbench.busy;i++)await new Promise(r=>setTimeout(r,20));
  check(reviewWorkbench.mode==='cloze'&&!reviewWorkbench.attempt&&wb('Editor').textContent.includes('每空答案'),'AI adoption checks real material, not just saved ID');
  check(wb('Actions').textContent.includes('手动准备材料')&&wb('Actions').textContent.includes('切换标准复习'),'missing material offers executable actions');
  await switchWorkbenchToAvailableMode();check(reviewWorkbench.mode==='standard','fallback explicitly selects standard');
  closeReviewWorkbench();await openReviewWorkbench('mistake',row.id,context);
  check(reviewWorkbench.mode==='standard','manual override survives reopen and beats saved AI');
  await loadReviewWorkbenchMode('choice_reproduction');check(wb('Editor').textContent.includes('缺少')&&!wb('Answer')&&wb('Actions').textContent.includes('切换标准复习'),'incompatible choice never degrades to text');
  await loadReviewWorkbenchMode('standard');
  await useWorkbenchSuggestion();await editWorkbenchMaterial();
  wb('Prompt').value='中国首都为【b1】，2+2=【b2】';addReviewBlank();addReviewBlank();
  const blanks=wb('Blanks').querySelectorAll('.review-blank');
  for(const [i,answer,alias]of [[0,'北京','北京市'],[1,'4','四']]){blanks[i].querySelector('[data-blank="answer"]').value=answer;blanks[i].querySelector('[data-blank="aliases"]').value=alias;}
  await saveWorkbenchMaterial();check(!wb('Error').textContent&&!wb('Prompt'),'in-session manual save returns to practice');
  check(JSON.stringify(await api('GET','/review-items/mistake/'+row.id+'/state'))===JSON.stringify(before),'advice adoption and material save never grade');
  await startWorkbenchAttempt();const attemptId=reviewWorkbench.attempt.id;
  closeReviewWorkbench();check(document.getElementById('mistakeReviewPanel').hidden&&document.getElementById('centerReviewToolbar').textContent.includes('原流程已暂停'),'closing workbench cannot expose another engine controls');
  await openReviewWorkbench('mistake',row.id,context);
  check(reviewWorkbench.attempt.modeId==='cloze'&&wb('Attempt').querySelector('[data-executing-mode="cloze"]'),'actual persisted attempt uses adopted AI mode');
  const prompt=wb('Attempt').querySelector('[data-cloze-prompt]');
  check(prompt.querySelectorAll('input').length===2&&!wb('Answer')&&!prompt.textContent.includes('【b1】'),'blanks embedded inside original text');
  check(!('answer'in reviewWorkbench.attempt.material.blanks[0]),'no answers downloaded before submit');
  prompt.querySelector('[data-review-blank="b1"]').value='北京市';prompt.querySelector('[data-review-blank="b2"]').value='四';
  await submitWorkbenchAttempt('submit');check(reviewWorkbench.attempt.grade===3&&wb('Attempt').querySelectorAll('[data-blank-result]').length===2,'per blank results and saved aliases grade correctly');
  check((await api('GET','/review-items/mistake/'+row.id+'/attempts/'+attemptId)).modeId==='cloze','server mode_id, not only label, is cloze');
  check((await api('GET','/review-sessions/'+session.id)).passed===1,'cloze completes original session item');
  check((await api('GET','/review-items/mistake/'+row.id+'/state')).lastModeId==='cloze','grade records real execution mode');
  check(localStorage.getItem(mistakeAiStorageKey(identity))===savedAi,'AI suggestion bytes preserved');
  const restoreKey=reviewWorkbenchKey();await loadReviewWorkbenchMode('retry');await runExistingReviewMode();
  check(wb('Error').textContent.includes('新会话')&&mistakeStorageGet(restoreKey).attemptId===attemptId,'completed task retry keeps history pointer and requires new session');
  await loadReviewWorkbenchMode('cloze');
  await finishWorkbenchAttempt();closeReviewCompleteModal();

  for(const mode of ['self_explain','contrast','reading']){
    const next=await createReviewRecord('total',[{type:'mistake',id:row.id}]);await enterCenterReview(next);
    const scope=centerWorkbenchContext(next.items[0],next);
    await openReviewWorkbench('mistake',row.id,scope);await loadReviewWorkbenchMode(mode);
    check(wb('Editor').textContent.includes('缺少')&&!reviewWorkbench.attempt,mode+' missing material stays distinct');
    await editWorkbenchMaterial();wb('Prompt').value='测试 '+mode+' 正文与任务';
    if(wb('Reference'))wb('Reference').value='概念定义\n原因解释\n举例';if(wb('Rubric'))wb('Rubric').value='覆盖要点且无矛盾';
    if(mode==='contrast'){wb('Objects').value='对象甲\n对象乙';wb('Dimensions').value='定义\n条件';}
    await saveWorkbenchMaterial();await startWorkbenchAttempt();
    check(reviewWorkbench.attempt.modeId===mode,mode+' server mode dispatch');
    if(mode==='reading'){
      check(wb('Attempt').querySelector('article.review-reading-body')&&wb('ReadComplete')&&!wb('Reference'),'reading has body/completion and no required answer');
      const state=await api('GET','/review-items/mistake/'+row.id+'/state');
      await submitWorkbenchAttempt('complete');check(reviewWorkbench.attempt.stage==='question'&&wb('Error').textContent.includes('勾选'),'reading requires explicit completion');
      wb('ReadComplete').click();await submitWorkbenchAttempt('complete');
      check(reviewWorkbench.attempt.grade===null&&reviewWorkbench.attempt.result.exposureOnly,'reading no Good');
      check(JSON.stringify(await api('GET','/review-items/mistake/'+row.id+'/state'))===JSON.stringify(state),'reading preserves scheduling state');
      const result=await api('GET','/review-sessions/'+next.id);check(result.exposed===1&&result.passed===0,'reading session exposure only');
    }else{
      if(mode==='contrast'){
        check(!wb('Answer')&&wb('Attempt').querySelectorAll('tbody textarea').length===4,'contrast object x dimension input matrix');
        for(const field of wb('Attempt').querySelectorAll('[data-contrast-field]'))field.value='独立比较 '+field.dataset.contrastField;
      }else{
        check(wb('Answer').rows===10&&!wb('Attempt').querySelector('[data-review-checkpoints]'),'long explanation before revealing points');
        wb('Answer').value='旧讲解证据';await submitWorkbenchAttempt('submit');const old=reviewWorkbench.attempt.id;
        closeReviewWorkbench();await openReviewWorkbench('mistake',row.id,scope);await loadReviewWorkbenchMode('retry');await runExistingReviewMode();
        check(reviewWorkbench.attempt.id!==old&&reviewWorkbench.attempt.modeId===mode&&wb('Answer').value===''&&!wb('Attempt').querySelector('[data-review-reference]'),'retry after reopen creates clean original-engine round');
        check((await api('GET','/review-items/mistake/'+row.id+'/attempts/'+old)).firstAnswer==='旧讲解证据','retry preserves immutable evidence');
        wb('Answer').value='重新独立讲解';
      }
      await submitWorkbenchAttempt('submit');check(wb('Attempt').querySelectorAll('[data-review-checkpoint]').length===4,'key points and rubric checkable after submit');
      await loadReviewWorkbenchMode('reading');check(wb('Info').textContent.includes('当前实际流程：'+AI_REVIEW_METHODS[mode]),'choosing next mode never changes actual running-mode label');await loadReviewWorkbenchMode(mode);
      const point=wb('Attempt').querySelector('[data-review-checkpoint]');point.click();
      const id=reviewWorkbench.attempt.id;closeReviewWorkbench();await openReviewWorkbench('mistake',row.id,scope);
      check(reviewWorkbench.attempt.id===id&&wb('Attempt').querySelector('[data-review-checkpoint]').checked,'attempt and checklist restore');
      await submitWorkbenchAttempt('judge',2);check(reviewWorkbench.attempt.grade===2,'shared open grade cap');
      check((await api('GET','/review-sessions/'+next.id)).passed===1,'one result belongs to original session');
    }
    check(localStorage.getItem(mistakeAiStorageKey(identity))===savedAi,'other modes do not overwrite AI advice');
    await finishWorkbenchAttempt();closeReviewCompleteModal();
  }
}
module.exports={reviewInteractionChecks};
