// Runs inside the same real DOM/browser fixture; all AI responses are mock.
async function mistakeAiListChecks(check, el) {
  resetMistakeAi();
  const originalList = requestList, originalApi = requestApi, originalFetch = window.fetch;
  const row = {id:71,course_id:42,title:'列表 AI 测试 '.repeat(8),content:'1+1=?',answer_content:'2',
    explanation:'虚构解析',mistake_type:'knowledge',review_status:'unreviewed',knowledge:[],review_revision:1};
  const rows = [row,{...row,id:72,title:'另一道错题'}];
  const suggestion = {review_method:'retry',reason:'Mock 演示：'+ '这是较长的建议理由。'.repeat(35),needs_review:true};
  let aiCalls=0, release;
  try {
    currentCourseId=42; currentView={type:'detail'};showPageOnly('detailPage');
    document.querySelectorAll('.tab-pane').forEach(node=>node.style.display='none');
    document.getElementById('pane-mistakes').style.display='block';
    mistakeUi={courseId:42,type:'knowledge',q:'',favorite:'',reviewStatus:'',nodeIds:[]};
    requestList=async url=>url.endsWith('knowledge-tree') ? [] : url.endsWith('review-sessions/candidates')
      ? rows.map(item=>({...item,type:'mistake',reviewable:1,nodes:[]})) : rows;
    requestApi=async url=>({json:async()=>rows.find(item=>url.endsWith('/'+item.id))});
    window.fetch=async (url,options)=>{
      check(url===API+'/ai/classify' && options.method==='POST','list only calls existing classify API');
      aiCalls++; return new Response(JSON.stringify(suggestion),{status:200});
    };
    await loadMistakes();
    const card=id=>document.querySelector('#mistakeList [data-mistake-id="'+id+'"]');
    const saved=id=>card(id).querySelector('.mistake-ai-saved');
    const originalRow=JSON.stringify(row),view=currentView;
    check(saved(71).textContent.includes('暂无已保存'),'initial list has no saved result');
    const entry=card(71).querySelector('.mistake-ai-entry');entry.click();
    check(document.getElementById('mistakeAiDialog').open && currentView===view,'list entry opens modal without navigating to detail');
    const dialog=document.getElementById('mistakeAiDialog'),body=document.getElementById('mistakeAiDialogBody');
    const rect=dialog.getBoundingClientRect();
    check(Math.abs(rect.left+rect.width/2-innerWidth/2)<=2 && Math.abs(rect.top+rect.height/2-innerHeight/2)<=2,'dialog centered horizontally and vertically');
    check(rect.top>=0 && rect.bottom<=innerHeight && rect.left>=0 && rect.right<=innerWidth,'dialog bounded by viewport');
    const foot=document.getElementById('mistakeAiDialogFoot'),head=dialog.querySelector('header');
    check(body.scrollTop===0 && el('Question').getBoundingClientRect().top>=head.getBoundingClientRect().bottom,'opens at top without input hidden by header');
    check(el('Submit').form===el('Form') && el('Confirm').disabled,'fixed get action retains native form validation; confirm disabled before result');
    check(getComputedStyle(el('Title')).display==='none','dialog hides duplicate detail heading');
    const questionHeight=el('Question').style.height;el('Question').style.height='1200px';
    check(body.scrollHeight>body.clientHeight,'long form scrolls inside dialog');
    const headerTop=dialog.querySelector('header').getBoundingClientRect().top;
    const footerTop=foot.getBoundingClientRect().top;
    body.scrollTop=body.scrollHeight;
    check(Math.abs(dialog.querySelector('header').getBoundingClientRect().top-headerTop)<1,'header stays in place while form scrolls');
    check(Math.abs(foot.getBoundingClientRect().top-footerTop)<1 && foot.getBoundingClientRect().bottom<=innerHeight,'footer stays visible while form scrolls');
    check(el('Confirm').getBoundingClientRect().right<=rect.right,'save button fits dialog');
    body.scrollTop=0;
    el('Question').style.height=questionHeight;
    check(el('Question').value===row.content && el('CorrectAnswer').value==='2','same panel prefills list evidence');
    el('StudentAnswer').value='3';el('ErrorType').value='careless';await requestMistakeAi();
    check(saved(71).textContent.includes('暂无已保存'),'unconfirmed AI suggestion stays unsaved on card');
    check(el('Reason').scrollHeight<=el('Reason').clientHeight+1 && getComputedStyle(el('Reason')).overflowY==='visible','long reason wraps without nested scrolling');
    el('Method').value='guided';changeMistakeAiSuggestion();el('Confirm').click();
    check(saved(71).textContent.includes('引导练习') && saved(72).textContent.includes('暂无已保存'),'save updates only matching card');
    check(!dialog.open && mistakeAiState===null && currentView===view && document.activeElement===entry,'successful save closes modal and returns to original list with focus');
    check(el('Panel').previousElementSibling.id==='mistakeAiHome' && el('Actions').previousElementSibling.id==='mistakeAiActionsHome','panel and actions returned to detail home');
    entry.click();
    el('Method').value='recall';changeMistakeAiSuggestion();
    check(saved(71).textContent.includes('引导练习'),'unconfirmed edit does not update card');
    foot.querySelector('.mistake-ai-dialog-only').click();
    check(!dialog.open && saved(71).textContent.includes('引导练习'),'manual cancel discards unconfirmed edit');
    entry.click();check(el('Method').value==='guided' && body.scrollTop===0,'reopen restores saved choice from top');
    el('Method').value='recall';changeMistakeAiSuggestion();
    const set=Storage.prototype.setItem;
    try {
      Storage.prototype.setItem=function(){throw Error('quota');};el('Confirm').click();
      check(el('Confirmation').textContent.includes('本地保存失败') && el('Method').value==='recall','modal preserves failed save for retry');
      check(dialog.open && currentView===view && !el('Confirm').disabled,'failed save leaves modal open for retry');
      check(saved(71).textContent.includes('引导练习'),'failed save leaves card unchanged');
    } finally {Storage.prototype.setItem=set;}
    el('Confirm').click();check(saved(71).textContent.includes('回忆知识'),'retry saves final choice');
    check(!dialog.open,'successful retry closes dialog');
    check(document.getElementById('mistakeAiDialog').scrollWidth<=document.getElementById('mistakeAiDialog').clientWidth+1,'modal has no horizontal overflow');
    resetMistakeAi();check(document.activeElement===entry && !document.getElementById('mistakeAiDialog').open,'close restores focus');
    check(el('Panel').previousElementSibling.id==='mistakeAiHome','shared panel returned to detail home');
    entry.click();check(el('Method').value==='recall' && !mistakeAiState.result,'list restores saved final choice');
    el('StudentAnswer').value='3';el('ErrorType').value='careless';
    window.fetch=()=>new Promise(resolve=>{release=resolve;});const pending=requestMistakeAi();
    resetMistakeAi();openMistakeAiFromList(72);release(new Response(JSON.stringify(suggestion)));await pending;
    check(!mistakeAiState.result && el('Result').hidden,'closing cancels late response across list mistakes');resetMistakeAi();
    const before=aiCalls;await openTotalReview();switchTotalReviewTab('mistake');
    const total=document.getElementById('totalReviewCandidates');
    check(total.textContent.includes('回忆知识') && total.textContent.includes('暂无已保存的 AI 复习建议'),'total picker shows saved and missing names');
    check(aiCalls===before,'total review never requests AI');
    await openTotalReviewPreview('mistake:71');
    check(document.getElementById('totalReviewPreviewBody').textContent.includes('回忆知识'),'total preview shows saved method');
    closeTotalReviewPreview();closeTotalReview();
    // Existing selection controls continue to operate independently of advice.
    await openTotalReview();switchTotalReviewTab('mistake');selectTotalReviewItem('mistake:71',true);
    check(totalReviewState.ids.has('mistake:71') && !document.getElementById('totalReviewStart').disabled,'review selection unaffected');closeTotalReview();
    currentCourseId=43;currentMistakes=rows.map(item=>({...item,course_id:43}));openMistakeAiFromList(71);
    check(el('Result').hidden && !mistakeAiState.savedMethod,'same id in another course has no saved method');resetMistakeAi();
    currentCourseId=42;
    localStorage.setItem('mistake-ai-method:42:72','{');await loadMistakes();
    check(saved(72).textContent.includes('暂无已保存'),'corrupt storage renders missing advice safely');
    check(JSON.stringify(row)===originalRow,'AI never mutates mistake category or review data');
    for(const label of ['查看','编辑','删除'])check([...card(71).querySelectorAll('button')].some(button=>button.textContent===label),'original '+label+' action remains');
    // Verify original buttons still dispatch their original handlers.
    const viewHandler=openMistakeDetail, editHandler=editMistakeFromList, deleteHandler=delItem;
    let action='';
    try {
      openMistakeDetail=id=>{action='view:'+id;};editMistakeFromList=id=>{action='edit:'+id;};delItem=(type,id)=>{action=type+':'+id;};
      for(const [label,expected] of [['查看','view:71'],['编辑','edit:71'],['删除','mistakes:71']]){
        [...card(71).querySelectorAll('button')].find(button=>button.textContent===label).click();check(action===expected,'original '+label+' handler intact');
      }
    } finally {openMistakeDetail=viewHandler;editMistakeFromList=editHandler;delItem=deleteHandler;}
    check(document.documentElement.scrollWidth<=innerWidth+1,'list layout fits viewport');
    await editMistakeFromList(71);
    check(document.getElementById('mistakeEditModal').classList.contains('show') && document.getElementById('mistakeEditType').value==='knowledge','original list edit modal still opens with original category');
    closeMistakeEdit();
    await openMistakeDetail(71,false);
    check(mistakeDetailState.row.id===71 && document.getElementById('mistakeAiSavedDetail').textContent.includes('回忆知识'),'original view loads detail and saved summary');
    toggleMistakeAi();check(el('Method').value==='recall','detail panel still works after list modal reuse');resetMistakeAi();
    // Actual running review uses the same detail renderer, including in review mode.
    currentView={type:'mistake',id:71};mistakeDetailState={courseId:42,id:71,row,review:true};
    showPageOnly('mistakeDetailPage');renderMistakeDetail(row,true);
    check(document.getElementById('mistakeAiSavedDetail').textContent.includes('回忆知识'),'running mistake review shows saved method');
    localStorage.removeItem('mistake-ai-method:42:71');localStorage.removeItem('mistake-ai-method:42:72');
  } finally {
    resetMistakeAi();requestList=originalList;requestApi=originalApi;window.fetch=originalFetch;
    if(totalReviewState)closeTotalReview();
  }
}
module.exports={mistakeAiListChecks};
