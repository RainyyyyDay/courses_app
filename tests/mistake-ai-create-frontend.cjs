// Real creation DOM and handlers; deterministic responses for failure/retry edges.
async function mistakeAiCreateChecks(check) {
  const originalFetch=window.fetch, originalList=requestList;
  const originalSet=Storage.prototype.setItem;
  const ai=name=>document.getElementById('mistakeCreateAi'+name);
  const rows=[];
  let posts=0, aiCalls=0, failCreate=false, wrongCourse=false, mode='retry', nextId=801;
  const reply=(body,status=200)=>new Response(JSON.stringify(body),{status});
  const select=method=>{ai('Method').value=method;ai('Method').dispatchEvent(new Event('change'));};
  const open=async()=>{
    currentCourseId=42;currentView={type:'detail'};showPageOnly('detailPage');
    pendingUploadFile=null;await openTagPicker('upload','mistake',null);
    document.getElementById('tagPickerName').value='创建 AI 测试';
    document.getElementById('mistakeCreateContent').value='1+1=?';
    document.getElementById('mistakeCreateType').value='knowledge';
    document.getElementById('mistakeCreateAnswer').value='2';
  };
  try {
    window.fetch=async(url,options={})=>{
      if(url.endsWith('/knowledge-tree'))return reply([]);
      if(url===API+'/ai/classify'){
        aiCalls++;const input=JSON.parse(options.body);
        check(input.question==='1+1=?' && input.student_answer==='3' && input.error_type==='careless' && input.correct_answer==='2','creation reuses five-field AI adapter');
        return reply({review_method:mode,reason:'Mock 演示：'+'理由很长，需要自然换行。'.repeat(40),needs_review:true});
      }
      check(url===API+'/courses/42/mistakes' && options.method==='POST','only original creation endpoint');
      posts++;
      check(!options.body.has('review_method') && !options.body.has('student_answer'),'AI selection/evidence never enters backend creation fields');
      if(failCreate)return reply({message:'测试创建失败'},500);
      const row={id:nextId++,course_id:wrongCourse?43:42,title:'创建 AI 测试',content:'1+1=?',answer_content:'2',
        mistake_type:'knowledge',review_status:'unreviewed',review_revision:1,knowledge:[]};
      rows.push(row);return reply(row,201);
    };
    requestList=async url=>url.endsWith('knowledge-tree')?[]:url.endsWith('review-sessions/candidates')
      ?rows.map(row=>({...row,type:'mistake',reviewable:1,nodes:[]})):rows;
    await open();
    check(!ai('Panel').open && ai('Method').value==='' && !tagPickerState.aiCreate.selectedMethod,'creation starts collapsed with no selection');
    check([...ai('Method').options].map(o=>o.value).join('|')===['',...Object.keys(AI_SELECTABLE_METHODS)].join('|'),'six public options plus empty choice');
    document.getElementById('mistakeCreateType').value='';await confirmTagPicker();
    check(tagPickerState && posts===0,'original required category validation unchanged');
    document.getElementById('mistakeCreateType').value='knowledge';
    await confirmTagPicker();
    check(!tagPickerState && posts===1 && aiCalls===0 && !readMistakeAiMethod({courseId:42,id:801}),'original no-AI creation works without advice storage/request');

    await open();ai('Panel').querySelector('summary').click();check(ai('Panel').open,'optional details expands');
    ai('Panel').querySelector('summary').click();check(!ai('Panel').open,'optional details collapses');ai('Panel').open=true;
    await requestMistakeCreateAi();check(aiCalls===0 && ai('Error').textContent,'missing AI evidence does not call adapter');
    ai('StudentAnswer').value='3';ai('ErrorType').value='careless';await requestMistakeCreateAi();
    check(!ai('Result').hidden && ai('Reason').textContent.includes('Mock') && ai('Method').value==='' && !tagPickerState.aiCreate.selectedMethod,'obtaining advice is never confirmation');
    ai('Panel').scrollIntoView({block:'start'});
    const modal=document.querySelector('#tagPickerModal .tag-sheet'),body=document.getElementById('tagPickerBody');
    check(modal.getBoundingClientRect().right<=innerWidth+1 && modal.getBoundingClientRect().left>=0,'creation modal fits viewport');
    body.scrollTop=body.scrollHeight;
    check(body.scrollHeight>body.clientHeight && modal.querySelector('.tag-sheet-foot').getBoundingClientRect().bottom<=innerHeight+1,'one scrolling body retains creation footer');
    check(ai('Reason').scrollHeight<=ai('Reason').clientHeight+1 && ai('Panel').scrollWidth<=ai('Panel').clientWidth+1,'long AI reason wraps without nested scrolling or horizontal overflow');
    await confirmTagPicker();
    check(!readMistakeAiMethod({courseId:42,id:802}),'unadopted mock suggestion not saved on successful creation');

    await open();ai('Panel').open=true;ai('StudentAnswer').value='3';ai('ErrorType').value='careless';
    await requestMistakeCreateAi();ai('Adopt').click();check(ai('Method').value==='retry','adopt explicitly selects suggestion');
    select('contrast');await requestMistakeCreateAi();check(ai('Method').value==='contrast','repeat AI never overwrites manual final selection');
    mode='unclassified';await requestMistakeCreateAi();
    check(ai('Suggested').textContent==='AI 暂未给出可用建议，请人工选择' && ai('Adopt').disabled && ai('Method').value==='contrast','unclassified requests manual selection without erasing choice');
    await confirmTagPicker();
    check(readMistakeAiMethod({courseId:42,id:803})==='contrast' && !tagPickerState,'creation response real id receives final choice and closes');
    check(!readMistakeAiMethod({courseId:43,id:803}) && !readMistakeAiMethod({courseId:42,id:804}),'course and mistake keys isolated');
    check(document.querySelector('#mistakeList [data-mistake-id="803"]').textContent.includes('对比辨析'),'new card summary updates immediately');
    await openTotalReview();switchTotalReviewTab('mistake');check(document.getElementById('totalReviewCandidates').textContent.includes('对比辨析'),'total review reads creation final choice');closeTotalReview();

    await open();select('cloze');failCreate=true;const beforePosts=posts;
    await confirmTagPicker();
    check(tagPickerState && ai('Method').value==='cloze' && !tagPickerState.createdMistake && !readMistakeAiMethod({courseId:42,id:804}),'failed creation preserves choice with no associated storage');
    failCreate=false;
    Storage.prototype.setItem=function(key,value){if(key.startsWith('mistake-ai-method:'))throw Error('quota');return originalSet.call(this,key,value);};
    await confirmTagPicker();
    check(posts===beforePosts+2 && tagPickerState.createdMistake.id===804 && ai('Panel').open && ai('Error').textContent.includes('本地保存失败') && ai('Method').value==='cloze','local failure retains created id/choice and shows error');
    Storage.prototype.setItem=originalSet;await confirmTagPicker();
    check(posts===beforePosts+2 && !tagPickerState && readMistakeAiMethod({courseId:42,id:804})==='cloze','retry writes only advice, never creates duplicate mistake');

    await open();select('reading');wrongCourse=true;await confirmTagPicker();
    check(tagPickerState && ai('Error').textContent.includes('编号无效') && !readMistakeAiMethod({courseId:42,id:805}) && !readMistakeAiMethod({courseId:43,id:805}),'wrong response course never associates advice');
    closeTagPicker();wrongCourse=false;
    pendingManual={type:'mistake',title:'旧手动入口',content:'1+1=?'};await openTagPicker('manual','mistake',null);
    document.getElementById('mistakeCreateType').value='knowledge';select('reading');await confirmTagPicker();
    check(!tagPickerState && readMistakeAiMethod({courseId:42,id:806})==='reading','legacy manual creation also saves using response id');
    await open();select('standard');closeTagPicker();await open();
    check(ai('Method').value==='' && !ai('Panel').open,'closing without save discards draft');closeTagPicker();
    await open();ai('Panel').open=true;select('standard');ai('StudentAnswer').value='3';ai('ErrorType').value='careless';
    const fixtureFetch=window.fetch;
    window.fetch=async url=>{if(url===API+'/ai/classify')throw Error('network');return fixtureFetch(url);};
    await requestMistakeCreateAi();
    check(ai('Error').textContent && !ai('Get').disabled && ai('Method').value==='standard' && ai('StudentAnswer').value==='3','AI connection failure preserves inputs/selection and allows retry');
    window.fetch=fixtureFetch;
    let release;
    window.fetch=(url,options)=>url===API+'/ai/classify'?new Promise(resolve=>{release=resolve;}):fixtureFetch(url,options);
    const pending=requestMistakeCreateAi();closeTagPicker();await open();
    release(reply({review_method:'retry',reason:'Mock 演示',needs_review:true}));await pending;
    check(!tagPickerState.aiCreate.result && ai('Result').hidden && ai('Method').value==='','late response cannot populate newly opened creation modal');
    window.fetch=fixtureFetch;closeTagPicker();
    check(rows.every(row=>row.mistake_type==='knowledge' && row.review_status==='unreviewed' && row.review_revision===1),'AI never changes category/progress');
  } finally {
    Storage.prototype.setItem=originalSet;closeTagPicker();window.fetch=originalFetch;requestList=originalList;
    if(totalReviewState)closeTotalReview();
    for(let id=801;id<=806;id++)localStorage.removeItem('mistake-ai-method:42:'+id);
  }
}
module.exports={mistakeAiCreateChecks};
