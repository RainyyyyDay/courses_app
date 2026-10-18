// 与原回归共享隔离后端和浏览器；两次真实刷新验证原控制器恢复。
function reviewPlanBrowserPrelude() {
  return `
    async function reviewPlanBrowserRestore(check,waitUntil) {
      const saved=JSON.parse(sessionStorage.getItem('plan-browser-refresh')||'null');
      if(!saved)return false;
      const ordinaryUnchanged=()=>Object.entries(saved.ordinary).every(([key,value])=>localStorage.getItem(key)===value);
      if(saved.stage==='material') {
        await waitUntil(()=>currentView.type==='readingReview' && activeReadingReview.row?.id===saved.remainingMaterial && !planReviewStarting,'plan reading actual refresh');
        check(activeReadingReview!==materialReadingReview,'plan uses isolated instance of same reading factory');
        check(ordinaryUnchanged(),'plan refresh leaves all ordinary queue keys unchanged');
        const controller=activeReadingReview,originalFetch=window.fetch;
        let lose=true;
        window.fetch=async(url,options)=>{const response=await originalFetch(url,options);if(lose&&options?.method==='PATCH'&&String(url).includes('planItemId=')){lose=false;throw new TypeError('committed response lost');}return response;};
        await controller.save('reviewed');
        check(controller.queue.pending && controller.queue.index===0,'plan lost response preserves pending operation');
        await controller.skip();check(controller.queue.index===0,'unconfirmed plan save cannot skip');
        window.fetch=originalFetch;await controller.retry();
        check(currentView.type==='reviewPlan' && reviewPlanDetail.plan.completed===2,'plan reading retry counts once and returns to plan');
        await startReviewPlanDay(saved.planId,saved.today,'note');
        await activeReadingReview.save('reviewed');
        check(currentView.type==='reviewPlan' && reviewPlanDetail.plan.completed===3,'plan notes use original controller and return');
        await startReviewPlanDay(saved.planId,saved.today,'mistake');
        check(mistakeDetailState.progress.stage==='question','old reviewed mistake starts actual new round');
        await submitMistakeReview('recall','recall','clear');
        check(mistakeDetailState.progress.stage==='answer','plan mistake uses existing recall step');
        const round=mistakeDetailState.progress.round;
        await pauseMistakeQueue();check(currentView.type==='reviewPlan','plan mistake pause returns to plan');
        await startReviewPlanDay(saved.planId,saved.today,'mistake');
        check(mistakeDetailState.progress.stage==='answer' && mistakeDetailState.progress.round===round,'plan mistake resume keeps current round');
        sessionStorage.setItem('plan-browser-refresh',JSON.stringify({...saved,stage:'mistake',round:mistakeDetailState.progress.round,version:mistakeDetailState.progress.version}));
        location.reload();return true;
      }
      await waitUntil(()=>currentView.type==='mistake' && mistakeDetailState?.progress?.stage==='answer' && !planReviewStarting,'plan mistake actual refresh');
      check(mistakeDetailState.progress.round===saved.round && mistakeDetailState.progress.version===saved.version,'plan restores original backend round/version');
      await submitMistakeReview('judge','correct',false);
      await waitUntil(()=>currentView.type==='reviewPlan' && reviewPlanDetail?.plan.id===saved.planId,'plan final mistake returns automatically');
      check(reviewPlanDetail.plan.completed===3 && reviewPlanDetail.plan.pending===1,'negative judgment keeps the plan task pending');
      check(document.getElementById('reviewPlanDetailBody').textContent.includes('今日 1 项待复习'),'today keeps the failed item pending');
      check(document.getElementById('reviewPlanDetailBody').textContent.includes('智能排期预览'),'plan detail shows scheduling preview');
      check(document.querySelectorAll('#reviewPlanCalendar .plan-calendar-cell.has-items').length>0,'schedule calendar marks review days');
      check(document.querySelector('#reviewPlanCalendar .plan-calendar-cell.is-today .is-today-mark'),'today with unfinished items shows the moving pointer');
      check(document.querySelector('#reviewPlanCalendar .plan-calendar-legend').textContent.includes('已过期未完成'),'calendar legend explains overdue');
      const scheduleCell=document.querySelector('#reviewPlanCalendar .plan-calendar-cell.has-items');
      openPlanScheduleDay(scheduleCell.getAttribute('onclick').match(/'([0-9-]+)'/)[1]);
      check(document.getElementById('reviewPlanDayModal').classList.contains('show') && document.querySelectorAll('#reviewPlanDayBody .review-day-card').length>0,'clicking a day opens only populated type cards');
      closePlanScheduleDay();
      check(ordinaryUnchanged(),'all three ordinary queues survive complete plan review');
      const w=await(await requestApi(API+'/courses/'+saved.courseId+'/mistakes/'+saved.mistakeId+'/review')).json();
      check(w.reviewStatus==='unreviewed','negative judgment preserves original status semantics');
      await patchCurrentReviewPlan({name:'已完成复习',status:'archived'});
      check(reviewPlanDetail.plan.status==='archived' && document.getElementById('reviewPlanTodayStart').disabled,'archive UI');
      await patchCurrentReviewPlan({status:'active'});
      const request=async(method,url,body)=>{const response=await requestApi(API+url,{method,...(body?{headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{})});return response.json();};
      const c='/courses/'+saved.courseId;
      const futureExam=new Date(Date.parse(saved.today+'T00:00:00Z')+86400000*10).toISOString().slice(0,10);
      const futurePlan=await request('POST',c+'/review-plans',{name:'提前复习计划',startDate:saved.today,examDate:futureExam,selectedItems:[{type:'material',id:saved.remainingMaterial}]});
      await openReviewPlan(futurePlan.id);
      const futureDate=[...planCalendar.dayMap.keys()].find(date=>date>planLocalDate());
      check(futureDate,'future plan has a later schedule day');
      openPlanScheduleDay(futureDate);
      check(document.getElementById('reviewPlanDayBody').textContent.includes('提前复习会缩短'),'future day explains the early-review tradeoff');
      closePlanScheduleDay();
      const deleted=await request('POST',c+'/notes',{title:'删除后保留的标题',content:'body'});
      const p=await request('POST',c+'/review-plans',{name:'删除来源',startDate:saved.today,examDate:saved.tomorrow,selectedItems:[{type:'note',id:deleted.id}]});
      await request('DELETE','/notes/'+deleted.id);await openReviewPlan(p.id);
      check(reviewPlanDetail.plan.skipped===1 && reviewPlanDetail.plan.completed===0 && reviewPlanDetail.plan.completionRate===0,'all skipped has explicit zero rate');
      openPlanScheduleDay(saved.today);
      check(document.getElementById('reviewPlanDayBody').textContent.includes('内容已删除') && document.getElementById('reviewPlanDayBody').textContent.includes('删除后保留的标题'),'deleted source snapshot UI in day popup');
      closePlanScheduleDay();
      const yesterday=new Date(Date.parse(saved.today+'T00:00:00Z')-86400000).toISOString().slice(0,10);
      const late=await request('POST',c+'/review-plans',{name:'过期任务',startDate:yesterday,examDate:saved.today,selectedItems:[{type:'material',id:saved.remainingMaterial}]});
      await openReviewPlan(late.id);
      check(document.getElementById('reviewPlanDetailBody').textContent.includes('今日没有安排复习任务'),'empty today state');
      await startReviewPlanDay(late.id,yesterday,'material');await activeReadingReview.save('reviewed');
      check(reviewPlanDetail.plan.completed===1 && reviewPlanDetail.items[0].scheduled_date===yesterday,'overdue task can be completed without moving date');
      const oldConfirm=showConfirm;showConfirm=async()=>true;await deleteCurrentReviewPlan();showConfirm=oldConfirm;
      await waitUntil(()=>currentView.type==='course' && reviewPlanCarousel.plans.some(plan=>plan.name==='已完成复习') && document.querySelectorAll('#reviewPlanList .plan-card').length===1,'delete returns to plan carousel');
      check(!document.getElementById('bootErrorBox'),'plan feature has no boot/runtime errors');
      sessionStorage.removeItem('plan-browser-refresh');sessionStorage.setItem('plan-browser-done','true');return false;
    }
  `;
}
function reviewPlanBrowserScenario() {
  return `
    if(!sessionStorage.getItem('plan-browser-done')) {
      const request=async(method,url,body)=>{const response=await requestApi(API+url,{method,...(body?{headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{})});return response.json();};
      const course=await request('POST','/courses',{name:'计划浏览器测试'}),c='/courses/'+course.id;
      openCourse(course.id,course.name,'reviewPlans');await loadReviewPlans();
      check(document.getElementById('reviewPlanList').textContent.includes('还没有'),'empty plan list');
      const first=await request('POST',c+'/materials',{title:'复习过的收藏资料',content:'body'});
      const second=await request('POST',c+'/materials',{title:'稍后补做资料',content:'body'});
      const note=await request('POST',c+'/notes',{title:'计划笔记',content:'body'});
      const mistake=await request('POST',c+'/mistakes',{title:'计划知识错题',content:'question',mistakeType:'knowledge',answerContent:'answer'});
      await request('PATCH',c+'/materials/'+first.id,{favorite:true});
      await request('PATCH',c+'/materials/'+first.id+'/review',{reviewStatus:'reviewed'});
      let wp=await request('POST',c+'/mistakes/'+mistake.id+'/review',{action:'start',requestId:'browser-old-start',expectedVersion:0});
      wp=await request('POST',c+'/mistakes/'+mistake.id+'/review/events',{action:'recall',recall:'clear',requestId:'browser-old-recall',expectedVersion:wp.version});
      await request('POST',c+'/mistakes/'+mistake.id+'/review/events',{action:'judge',correct:true,requestId:'browser-old-judge',expectedVersion:wp.version});
      const today=planLocalDate(),tomorrow=new Date(Date.parse(today+'T00:00:00Z')+86400000).toISOString().slice(0,10);
      const ordinary={};
      for(const [key,value] of [
        ['material-review-queue:'+course.id,{kind:'materials',courseId:course.id,ids:[first.id],index:0,results:{},skipped:[],pending:null,active:false,finished:false}],
        ['note-review-queue:'+course.id,{kind:'notes',courseId:course.id,ids:[note.id],index:0,results:{},skipped:[],pending:null,active:false,finished:false}],
        ['mistake-queue:'+course.id,{type:'mixed',courseId:course.id,ids:[mistake.id],types:{[mistake.id]:'knowledge'},index:0,rounds:{},finished:false}]
      ]) {ordinary[key]=JSON.stringify(value);localStorage.setItem(key,ordinary[key]);}
      const originalFetch=window.fetch,knowledgeCalls=[];
      window.fetch=(url,options)=>{if(String(url).includes('knowledge-tree'))knowledgeCalls.push(url);return originalFetch(url,options);};
      document.querySelector('#pane-reviewPlans .review-panel-heading [onclick="openReviewPlanCreate()"]').click();
      await waitUntil(()=>reviewPlanCreate && !reviewPlanCreate.loading,'plan candidates loaded');
      document.getElementById('reviewPlanName').value='<期末复习> & 计划';document.getElementById('reviewPlanExam').value=tomorrow;
      document.getElementById('reviewPlanFavorite').checked=true;renderReviewPlanSelection();
      check(filteredReviewPlanCandidates().length===1,'favorite filter reads original content');
      selectAllReviewPlanItems(true);check(reviewPlanCreate.ids.size===1,'filtered select all');
      document.getElementById('reviewPlanStatus').value='unreviewed';renderReviewPlanSelection();
      check(filteredReviewPlanCandidates().length===0 && reviewPlanCreate.ids.size===1,'AND filter preserves hidden selection');
      document.getElementById('reviewPlanFavorite').checked=false;document.getElementById('reviewPlanStatus').value='';renderReviewPlanSelection();
      for(const type of ['material','note','mistake']){switchReviewPlanTab(type);selectAllReviewPlanItems(true);}check(reviewPlanCreate.ids.size===4,'mixed fixed selection');
      check(document.getElementById('reviewPlanPreview').textContent.includes('共选择 4 项'),'creation preview');
      window.fetch=async()=>{throw new TypeError('offline');};await createReviewPlan();
      check(reviewPlanCreate.ids.size===4 && document.getElementById('reviewPlanCreateError').textContent,'failed create preserves form/selection');
      window.fetch=(url,options)=>{if(String(url).includes('knowledge-tree'))knowledgeCalls.push(url);return originalFetch(url,options);};
      await Promise.all([createReviewPlan(),createReviewPlan()]);
      check(currentView.type==='reviewPlan' && reviewPlanDetail.plan.total===4 && reviewPlanDetail.plan.pending===4,'create through actual form and all pending');
      check((await request('GET',c+'/review-plans')).length===1,'double generate does not duplicate');
      check(!document.getElementById('reviewPlanDetailBody').querySelector('期末复习'),'name safely rendered');
      const planId=reviewPlanDetail.plan.id;
      await request('PATCH',c+'/materials/'+first.id,{favorite:false});
      await openReviewPlan(planId);check(reviewPlanDetail.plan.total===4,'favorite change does not change selected snapshot');
      openPlanScheduleDay(today);
      check(document.querySelector('#reviewPlanDayBody .plan-day-stats').textContent.includes('已完成 0 / 4'),'day popup carries task stats');
      document.querySelector('[data-plan-day-type="material"] button').click();
      await waitUntil(()=>currentView.type==='readingReview' && activeReadingReview.row && !planReviewStarting,'plan material starts');
      check(activeReadingReview.row.id===first.id && activeReadingReview.row.review_status==='reviewed','already reviewed content still requires plan action');
      await activeReadingReview.save('reviewed');await activeReadingReview.skip();
      check(currentView.type==='reviewPlan' && reviewPlanDetail.plan.completed===1 && reviewPlanDetail.plan.pending===3,'reading skip stays pending');
      await startReviewPlanDay(planId,today,'material');
      check(activeReadingReview.row.id===second.id,'skipped item can be reentered from plan');
      await activeReadingReview.pause();check(currentView.type==='reviewPlan','plan reading pause returns to plan');
      await startReviewPlanDay(planId,today,'material');check(activeReadingReview.row.id===second.id,'plan reading resumes saved position');
      check(knowledgeCalls.length===0,'plan selection and reading start never request knowledge tree');window.fetch=originalFetch;
      sessionStorage.setItem('plan-browser-refresh',JSON.stringify({stage:'material',courseId:course.id,planId,today,tomorrow,remainingMaterial:second.id,mistakeId:mistake.id,ordinary}));
      location.reload();return;
    }
  `;
}
module.exports={reviewPlanBrowserPrelude,reviewPlanBrowserScenario};
