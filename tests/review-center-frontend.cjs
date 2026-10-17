function reviewCenterBrowserPrelude() {
  return `
    async function reviewCenterBrowserRestore(check,waitUntil) {
      const saved=JSON.parse(sessionStorage.getItem('review-center-browser-refresh')||'null');if(!saved)return false;
      const api=async(method,url,body)=>{const response=await requestApi(API+url,{method,...(body?{headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{})});return response.json();};
      const c='/courses/'+saved.courseId,prefix=c+'/review-sessions';
      if(saved.stage==='reading') {
        await waitUntil(()=>centerReview?.session.id===saved.id && activeReadingReview.queue?.pending && !activeReadingReview.busy,'mixed reading pending actual refresh');
        check(JSON.stringify(centerReview.session.items.map(item=>item.item_type+':'+item.item_id))===JSON.stringify(saved.identities),'mixed identity and order survive refresh');
        await activeReadingReview.retry();
        check(centerReview.session.completed===1 && currentCenterItem().item_type==='note','retry completes once and dispatches note');
        await moveCenterReview(-1);check(!document.querySelector('[data-material-review="reviewed"]'),'previous completed item is read only');
        await moveCenterReview(1);await skipCenterReviewItem();
        check(currentCenterItem().item_type==='mistake' && centerReview.session.skipped===1,'skip dispatches existing mistake UI');
        check((await api('GET',c+'/notes/'+saved.noteId+'/review')).review_status==='unreviewed','session skip preserves original status');
        await submitMistakeReview('recall','recall','clear');
        check(mistakeDetailState.progress.stage==='answer','mixed queue uses original recall step');
        const round=mistakeDetailState.progress.round,version=mistakeDetailState.progress.version;
        await pauseMistakeQueue();check(reviewSessionDetail.id===saved.id && reviewSessionDetail.status==='paused','mixed pause persists original record');
        const count=(await api('GET',prefix)).total;await resumeReviewRecord(saved.id);
        check((await api('GET',prefix)).total===count && mistakeDetailState.progress.round===round,'resume does not create record or restart round');
        sessionStorage.setItem('review-center-browser-refresh',JSON.stringify({...saved,stage:'mistake',round,version}));location.reload();return true;
      }
      await waitUntil(()=>centerReview?.session.id===saved.id && mistakeDetailState?.progress?.stage==='answer','mixed mistake actual refresh');
      check(mistakeDetailState.progress.round===saved.round && mistakeDetailState.progress.version===saved.version,'mistake round/version restored unchanged');
      await submitMistakeReview('judge','correct',false);
      check(currentCenterItem().item_id===saved.secondMaterial && currentView.type==='readingReview','negative judgment advances to original reading UI');
      await activeReadingReview.save('reviewed');
      check(currentView.type==='reviewSessionDetail' && reviewSessionDetail.status==='completed' && reviewSessionDetail.completed===3 && reviewSessionDetail.skipped===1,'mixed history settles consistently');
      const ended=reviewSessionDetail.completed_at;await api('DELETE','/materials/'+saved.secondMaterial);await openReviewSessionDetail(saved.id);
      check(document.getElementById('reviewSessionDetailBody').textContent.includes('内容已删除'),'deleted source history is readable');
      await repeatReviewRecord(saved.id);
      check(centerReview.session.id!==saved.id && centerReview.session.total===3,'repeat creates fresh valid fixed queue');
      check((await api('GET',prefix+'/'+saved.id)).completed_at===ended,'repeat leaves original history completed');
      await pauseCenterReview();
      // 普通阅读入口仍保留原界面；多个未完成记录保存在后端而非覆盖旧头指针。
      mistakeStorageSet('material-review-queue:'+saved.courseId,{kind:'materials',courseId:saved.courseId,ids:[saved.firstMaterial],index:0,results:{},skipped:[],pending:null,active:false,finished:false});
      switchTab('materials');await materialReadingReview.open();materialReadingReview.select(saved.firstMaterial,true);await materialReadingReview.start();
      const legacy=mistakeStorageGet('legacy-review-backups:'+saved.courseId);check(legacy.length===1,'new module start preserves pre-v13 queue');
      const original=materialReadingReview.queue.sessionId;await materialReadingReview.pause();
      await materialReadingReview.open();materialReadingReview.select(saved.firstMaterial,true);await materialReadingReview.start();
      const another=materialReadingReview.queue.sessionId;check(original!==another,'two module starts create independent sessions');await materialReadingReview.pause();
      await resumeReviewRecord(original);check(centerReview.session.id===original && currentCenterItem().item_id===saved.firstMaterial,'older module session resumes exact objects');await pauseCenterReview();
      check((await api('GET',prefix+'/'+another)).status==='paused','resuming older session does not overwrite another');
      const beforeLegacy=(await api('GET',prefix)).total;await resumeLegacyReview(legacy[0].id);
      check(activeReadingReview.queue.ids[0]===saved.firstMaterial && !activeReadingReview.queue.sessionId,'legacy queue resumes without invented session');await activeReadingReview.pause();
      check((await api('GET',prefix)).total===beforeLegacy,'legacy resume does not invent history');
      switchTab('notes');await noteReadingReview.open();noteReadingReview.select(saved.noteId,true);await noteReadingReview.start();
      const noteSession=noteReadingReview.queue.sessionId;await noteReadingReview.skip();await noteReadingReview.pause();
      check((await api('GET',prefix+'/'+noteSession)).source_type==='note','notes entry records its source');
      switchTab('mistakes');await openMistakeCategory(null);await enterMistakeReviewFromHome();await openMistakeReviewCategory('knowledge');await clearMistakeFilters();chooseMistake(saved.mistakeId,true);await startMistakeQueue();
      const mistakeSession=mistakeQueue.sessionId;await pauseMistakeQueue();check((await api('GET',prefix+'/'+mistakeSession)).source_type==='mistake','mistake module keeps its UI and records source');
      switchTab('reviewPlans');await startReviewPlanDay(saved.planId,saved.today,'material');await activeReadingReview.save('reviewed');
      check(currentView.type==='reviewPlan' && reviewPlanDetail.plan.completed===1,'plan still updates its task');
      const planned=await api('GET',prefix+'?sourceType=plan');check(planned.total===1 && planned.results[0].status==='completed','plan execution also creates history');
      await openReviewHistory();document.getElementById('reviewHistoryStatus').value='completed';document.getElementById('reviewHistorySource').value='total';await loadReviewHistory();
      check(reviewHistoryState.rows.every(row=>row.status==='completed' && row.source_type==='total'),'history filters');
      backToReviewPlans();await loadRecentReviews();check(document.querySelectorAll('#reviewRecentList [data-review-session]').length===5,'recent five records');
      check(document.documentElement.scrollWidth<=innerWidth+1,'review center fits viewport');
      check(!document.getElementById('bootErrorBox'),'review center has no runtime errors');
      sessionStorage.removeItem('review-center-browser-refresh');sessionStorage.setItem('review-center-browser-done','true');return false;
    }
  `;
}
const {totalReviewModalBrowserScenario}=require('./total-review-modal-frontend.cjs');
function reviewCenterBrowserScenario({modalOnly=false}={}) {
  return `
    if(!sessionStorage.getItem('review-center-browser-done')) {
      const api=async(method,url,body)=>{const response=await requestApi(API+url,{method,...(body?{headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{})});return response.json();};
      const course=await api('POST','/courses',{name:'复习中心浏览器'}),c='/courses/'+course.id,prefix=c+'/review-sessions';
      openCourse(course.id,course.name,'reviewPlans');await loadReviewPlans();await loadRecentReviews();
      check(document.querySelector('.dtab[onclick*="reviewPlans"]').textContent==='复习','review tab keeps its position');
      check(document.getElementById('totalReviewOpen').nextElementSibling.id==='courseSearchOpen','total review next to original search');
      check(document.getElementById('reviewPlanList').textContent.includes('还没有') && document.getElementById('reviewRecentList').textContent.includes('暂无复习记录'),'zero plans and empty recent state');
      const m=await api('POST',c+'/materials',{title:'收藏资料',content:'first body'}),m2=await api('POST',c+'/materials',{title:'第二份资料',content:'second body'});
      const note=await api('POST',c+'/notes',{title:'课堂笔记',content:'note body'}),w=await api('POST',c+'/mistakes',{title:'知识错题',content:'question',mistakeType:'knowledge',answerContent:'answer'});
      await api('PATCH',c+'/materials/'+m.id,{favorite:true});await api('PATCH',c+'/materials/'+m.id+'/review',{reviewStatus:'reviewed'});
      const tag=await api('POST',c+'/knowledge-nodes',{name:'直接标签',type:'knowledge'});await api('PUT','/notes/'+note.id+'/nodes',{nodeIds:[tag.id]});
      const today=planLocalDate(),tomorrow=new Date(Date.parse(today+'T00:00:00Z')+86400000).toISOString().slice(0,10);
      const pbody={name:'轮播计划 1',startDate:today,examDate:tomorrow,selectedItems:[{type:'material',id:m.id}]};
      const p=await api('POST',c+'/review-plans',pbody);await loadReviewPlans();check(!document.querySelector('.review-plan-controls button'),'single plan hides arrows');
      await api('POST',c+'/review-plans',{...pbody,name:'轮播计划 2'});await api('POST',c+'/review-plans',{...pbody,name:'轮播计划 3'});await loadReviewPlans();
      check(document.querySelectorAll('#reviewPlanList .plan-card').length===1 && document.querySelector('.review-plan-controls').textContent.includes('1 / 3'),'one card for multiple plans');
      switchReviewPlanCard(-1);check(document.querySelector('.review-plan-controls').textContent.includes('3 / 3'),'carousel wraps backwards');switchReviewPlanCard(1);check(reviewPlanCarousel.index===0,'carousel wraps forwards');
      ${totalReviewModalBrowserScenario()}
      if(${modalOnly}){result.dataset.result='passed';result.textContent='total review modal interactions passed';document.body.appendChild(result);return;}
      closeTotalReview();
      for(const type of ['material','note','mistake']) {
        await openTotalReview();switchTotalReviewTab(type);
        selectTotalReviewVisible(true);await startTotalReview();check(currentCenterItem().item_type===type,'single-module total review '+type);await pauseCenterReview();
      }
      await openTotalReview();check(document.getElementById('totalReviewStart').disabled,'empty selection disables start');
      document.getElementById('totalReviewFavorite').checked=true;document.getElementById('totalReviewSearch').value='收藏';renderTotalReview();
      selectTotalReviewVisible(true);check(totalReviewState.ids.size===1,'filtered selection');
      document.getElementById('totalReviewStatus').value='unreviewed';renderTotalReview();check(filteredTotalReview().length===0 && totalReviewState.ids.size===1,'hidden selection survives filters');
      document.getElementById('totalReviewStatus').value='';document.getElementById('totalReviewFavorite').checked=false;document.getElementById('totalReviewSearch').value='';
      switchTotalReviewTab('note');
      changeTotalReviewTag(tag.id,true);check(filteredTotalReview().length===1 && filteredTotalReview()[0].type==='note','direct tag filter reused');
      selectTotalReviewCourse();check(totalReviewState.ids.size===4,'course-wide select distinct from filtered select');
      clearTotalReviewSelection();changeTotalReviewTag(tag.id,false);
      const items=[{type:'material',id:m.id},{type:'note',id:note.id},{type:'mistake',id:w.id},{type:'material',id:m2.id}];
      items.forEach(item=>{switchTotalReviewTab(item.type);document.querySelector('[data-total-choice="'+item.type+':'+item.id+'"]').click();});
      const count=(await api('GET',prefix)).total,realFetch=window.fetch;let loseCreate=true;
      window.fetch=async(url,options)=>{const response=await realFetch(url,options);if(loseCreate && options?.method==='POST' && new URL(url).pathname.endsWith('/review-sessions')){loseCreate=false;throw new TypeError('create response lost');}return response;};
      await startTotalReview();check(totalReviewState.ids.size===4,'failed create keeps fixed selection');window.fetch=realFetch;
      await Promise.all([startTotalReview(),startTotalReview()]);check((await api('GET',prefix)).total===count+1,'retry/double click creates only one session');
      const id=centerReview.session.id,identities=items.map(item=>item.type+':'+item.id);
      check(JSON.stringify(centerReview.session.items.map(item=>item.item_type+':'+item.item_id))===JSON.stringify(identities),'fixed mixed queue order');
      check(activeReadingReview!==materialReadingReview && activeReadingReview.row.id===m.id,'mixed queue reuses isolated reading factory');
      let failSave=true;window.fetch=async(url,options)=>{if(failSave && options?.method==='PATCH' && String(url).includes('sessionItemId=')){failSave=false;throw new TypeError('offline before save');}return realFetch(url,options);};
      await activeReadingReview.save('reviewed');check(activeReadingReview.queue.pending,'unconfirmed mixed save retains retry');window.fetch=realFetch;
      await moveCenterReview(1);await skipCenterReviewItem();check(centerReview.position===0 && centerReview.session.pending===4,'unconfirmed save blocks mixed navigation and skip');
      sessionStorage.setItem('review-center-browser-refresh',JSON.stringify({stage:'reading',courseId:course.id,id,identities,firstMaterial:m.id,secondMaterial:m2.id,noteId:note.id,mistakeId:w.id,planId:p.id,today}));
      location.reload();return;
    }
  `;
}
module.exports={reviewCenterBrowserPrelude,reviewCenterBrowserScenario};
