// Real API/browser checks use their own course inside the regression runner's temporary DB.
function reviewCenterLayoutScenario({layoutOnly=false}={}) {
  return `
    {
      const api=async(method,url,body)=>{const response=await requestApi(API+url,{method,...(body?{headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{})});return response.json();};
      const course=await api('POST','/courses',{name:'复习页面布局测试'}),c='/courses/'+course.id,prefix=c+'/review-sessions';
      const pane=document.getElementById('pane-reviewPlans'),rect=el=>el.getBoundingClientRect();
      const returnHome=async()=>{backToReviewPlans();await loadReviewPlans();await loadRecentReviews();};
      const checkLayout=()=>{
        const panels=[...pane.querySelectorAll('.review-center-panel')];
        check(panels.length===2 && getComputedStyle(pane).backgroundColor==='rgb(247, 248, 250)','review-only gray canvas with two panels');
        check(Math.abs(rect(panels[1]).top-rect(panels[0]).bottom-24)<1,'24px gap between independent panels');
        for(const panel of panels){const style=getComputedStyle(panel);check(style.backgroundColor==='rgb(255, 255, 255)' && parseFloat(style.borderTopWidth)===1 && parseFloat(style.borderRadius)>=12 && parseFloat(style.borderRadius)<=16,'white rounded bordered panels');check(parseFloat(style.paddingTop)>=20 && parseFloat(style.paddingTop)<=24,'20-24px panel padding');}
        check(pane.querySelectorAll('.review-panel-title > svg').length===2 && pane.textContent.includes('管理考前安排与每日任务') && pane.textContent.includes('继续未完成的复习，或回顾历史'),'section icons and subtitles');
        check(!pane.querySelector('.upload-btn') && pane.querySelector('.review-panel-heading [onclick="openReviewPlanCreate()"]'),'compact creation entry in section header, no full-width dashed entry');
        for(const head of pane.querySelectorAll('.review-panel-heading')){const title=head.querySelector('.review-panel-title'),action=head.querySelector('button');check(rect(title).right<=rect(action).left+1,'section title and action do not overlap');check(rect(action).right<=rect(head).right+1,'section action contained');}
        for(const el of [pane,...pane.querySelectorAll('.review-center-panel,.plan-card,.review-recent-record,.review-recent-actions')])check(el.scrollWidth<=el.clientWidth+1,'review elements do not overflow horizontally');
        for(const row of pane.querySelectorAll('.review-recent-record')){const main=row.querySelector('.review-recent-main'),actions=row.querySelector('.review-recent-actions');check(rect(main).right<=rect(actions).left+1 || rect(actions).top>=rect(main).bottom-1,'record text and actions do not overlap');}
        check(document.documentElement.scrollWidth<=innerWidth+1,'review document fits actual viewport');
      };
      openCourse(course.id,course.name,'reviewPlans');await loadReviewPlans();await loadRecentReviews();checkLayout();
      check(pane.querySelectorAll('.review-center-empty').length===2 && document.getElementById('reviewRecentList').textContent.includes('暂无复习记录'),'clear empty states in both panels');
      pane.querySelector('[onclick="openReviewPlanCreate()"]').click();await waitUntil(()=>reviewPlanCreate && !reviewPlanCreate.loading,'header creation button opens original creation dialog');closeReviewPlanCreate();
      const material=await api('POST',c+'/materials',{title:'第一章复习资料',content:'复习页面测试正文'}),note=await api('POST',c+'/notes',{title:'课堂笔记',content:'笔记内容'});
      const today=planLocalDate(),exam=new Date(Date.parse(today+'T00:00:00Z')+86400000*12).toISOString().slice(0,10);
      const body={name:'期末考试复习',startDate:today,examDate:exam,selectedItems:[{type:'material',id:material.id}]};
      const plan=await api('POST',c+'/review-plans',body);await loadReviewPlans();
      check(!pane.querySelector('.review-plan-controls button'),'one plan hides navigation arrows');
      await api('POST',c+'/review-plans',{...body,name:'重点章节复习'});await api('POST',c+'/review-plans',{...body,name:'期中回顾'});await loadReviewPlans();
      const controls=pane.querySelector('.review-plan-controls');
      check(controls.closest('.plan-card') && controls.closest('.review-plan-card-top'),'carousel controls live inside card header');
      controls.querySelector('[aria-label="上一个计划"]').click();check(reviewPlanCarousel.index===2,'previous plan wraps');pane.querySelector('[aria-label="下一个计划"]').click();check(reviewPlanCarousel.index===0,'next plan wraps');
      switchReviewPlanCard(reviewPlanCarousel.plans.findIndex(item=>item.id===plan.id));
      const selectedPlan=reviewPlanCarousel.plans[reviewPlanCarousel.index],name=selectedPlan.name,longName='<img src=x onerror=alert(1)>'+ '长计划名称不应挤压切换按钮'.repeat(12);
      selectedPlan.name=longName;renderReviewPlanCarousel();checkLayout();check(!pane.querySelector('.plan-card img'),'long title stays safe text');
      selectedPlan.name=name;renderReviewPlanCarousel();
      pane.querySelector('.plan-card .mistake-toolbar button').click();await waitUntil(()=>currentView.type==='reviewPlan' && reviewPlanDetail?.plan.id===plan.id,'view plan button retained');await returnHome();
      const completed=await api('POST',prefix,{sourceType:'material',requestId:reviewRequestId(),selectedItems:[{type:'material',id:material.id}]});
      await api('PATCH',c+'/materials/'+material.id+'/review?sessionItemId='+completed.items[0].id,{reviewStatus:'reviewed'});
      const paused=await api('POST',prefix,{sourceType:'note',requestId:reviewRequestId(),selectedItems:[{type:'note',id:note.id}]});await api('POST',prefix+'/'+paused.id+'/pause',{});
      await api('POST',prefix,{sourceType:'total',requestId:reviewRequestId(),selectedItems:[{type:'material',id:material.id},{type:'note',id:note.id}]});await loadRecentReviews();
      const row=id=>pane.querySelector('[data-review-session="'+id+'"]');
      check(row(completed.id).textContent.includes('再次复习') && row(paused.id).textContent.includes('继续复习'),'completed repeat and pending resume actions');
      for(const record of pane.querySelectorAll('.review-recent-record'))check(record.querySelector('h3') && record.querySelector('.review-recent-state') && record.querySelector('progress') && record.textContent.includes('最近活动') && record.textContent.includes('已完成'),'compact record includes name/source/time/progress/status');
      check(getComputedStyle(pane.querySelector('.review-recent-record')).borderBottomWidth==='1px','fine separators between records');checkLayout();
      row(paused.id).querySelector('button').click();await waitUntil(()=>centerReview?.session.id===paused.id && activeReadingReview.row?.id===note.id && !reviewRecordBusy,'recent continue opens exact original queue');await pauseCenterReview();await returnHome();
      row(completed.id).querySelectorAll('button')[1].click();await waitUntil(()=>currentView.type==='reviewSessionDetail' && reviewSessionDetail?.id===completed.id,'recent details button retained');
      check(document.querySelector('#reviewSessionDetailBody .review-record') && !document.querySelector('#reviewSessionDetailBody .review-recent-record'),'history detail card rendering unchanged');await returnHome();
      row(completed.id).querySelector('button').click();await waitUntil(()=>centerReview && centerReview.session.id!==completed.id && activeReadingReview.row?.id===material.id && !reviewRecordBusy,'recent repeat creates fresh queue');await pauseCenterReview();await returnHome();
      pane.querySelector('.plan-card .mistake-toolbar button:nth-child(2)').click();await waitUntil(()=>currentView.type==='readingReview' && activeReadingReview.row?.id===material.id && !planReviewStarting,'start today retains original review flow');await activeReadingReview.save('reviewed');
      await waitUntil(()=>currentView.type==='reviewPlan' && reviewPlanDetail?.plan.completed===1,'today review updates original plan task');await returnHome();
      const recent=await api('GET',prefix+'?limit=5'),recentHost=document.getElementById('reviewRecentList');
      recentHost.innerHTML=recent.results.map(record=>reviewRecentRecord({...record,name:'很长的复习记录名称'.repeat(14)})).join('');checkLayout();await loadRecentReviews();
      check(pane.querySelectorAll('.review-recent-record').length===5,'recent list remains limited to five records');
      pane.querySelector('[onclick="openReviewHistory()"]').click();await waitUntil(()=>currentView.type==='reviewHistory' && reviewHistoryState?.courseId===course.id,'view all opens unchanged history');
      check(document.querySelector('#reviewHistoryList .review-record') && !document.querySelector('#reviewHistoryList .review-recent-record'),'full history keeps original layout');await returnHome();checkLayout();
      check(!document.getElementById('bootErrorBox'),'review layout has no runtime errors');
      if(${layoutOnly}){result.dataset.result='passed';result.textContent='review center layout and actions passed';document.body.appendChild(result);return;}
    }
  `;
}
module.exports={reviewCenterLayoutScenario};
