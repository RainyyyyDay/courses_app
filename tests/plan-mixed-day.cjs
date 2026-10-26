const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {fixture}=require('./temp-backend-fixture.cjs');
const {runBrowser}=require('./browser-driver.cjs');

test('one plan-day queue runs materials, notes then mistakes and updates its preview to the latest attempts',{timeout:120000},async()=>{
  await fixture(async({api,base,ids,temp,serve,serverLogs})=>{
    const c='/courses/'+ids.courseId;
    const today=new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
    const tomorrow=new Date(Date.parse(today+'T00:00:00Z')+86400000).toISOString().slice(0,10);
    const material=await api('POST',c+'/materials',{title:'混合队列资料',content:'资料正文'},201);
    const note=await api('POST',c+'/notes',{title:'混合队列笔记',content:'笔记正文'},201);
    const mistake=await api('POST',c+'/mistakes',{title:'混合队列错题',content:'错题正文',answerContent:'错题答案',mistakeType:'execution',questionFormat:'open'},201);
    const plan=await api('POST',c+'/review-plans',{
      name:'单卡混合复习',startDate:today,examDate:tomorrow,
      selectedItems:[{type:'mistake',id:mistake.id},{type:'note',id:note.id},{type:'material',id:material.id}],
    },201);
    const futurePlan=await api('POST',c+'/review-plans',{
      name:'未来重复轮次',startDate:today,examDate:new Date(Date.parse(today+'T00:00:00Z')+5*86400000).toISOString().slice(0,10),
      selectedItems:[{type:'material',id:material.id}],
    },201);
    const browser=['C:/Program Files/Google/Chrome/Application/chrome.exe',
      'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
      'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(fs.existsSync);
    assert.ok(browser);
    const initScript=`window.COURSES_API_BASE=${JSON.stringify(base)};addEventListener('load',async()=>{
      const out=document.createElement('pre');out.id='regressionResult';
      const check=(value,message)=>{if(!value)throw Error(message);};
      const wait=async(fn,label)=>{for(let i=0;i<450;i++){if(fn())return;await new Promise(r=>setTimeout(r,30));}throw Error('waiting: '+label);};
      try{
        await wait(()=>typeof allcourses!=='undefined'&&allcourses.some(course=>course.id===${ids.courseId}),'courses');
        await openCourse(${ids.courseId},'混合计划日','reviewPlans');
        await openReviewPlan(${plan.id});
        check(document.querySelector('#reviewPlanCalendar [data-plan-date="${today}"] .plan-calendar-count')?.textContent.trim().startsWith('0/'),'calendar starts at zero successful items');
        openPlanScheduleDay('${today}');
        let card=document.querySelector('#reviewPlanDayBody .review-day-card');
        check(document.querySelectorAll('#reviewPlanDayBody .review-day-card').length===1,'single combined day card');
        check(card.textContent.includes('1 份资料 · 1 篇笔记 · 1 道错题')&&card.textContent.includes('复习')&&!card.querySelector('.plan-day-preview'),'combined day title lists only populated categories');
        card.querySelector('button:last-child').click();
        await wait(()=>centerReview?.session?.items?.length===3,'mixed plan session');
        check(centerReview.session.items.map(item=>item.item_type).join(',')==='material,note,mistake','plan order is material, note, mistake');

        await wait(()=>activeReadingReview?.row?.id===${material.id}&&!activeReadingReview.busy,'material first');
        await activeReadingReview.save('clear');
        await wait(()=>activeReadingReview?.row?.id===${note.id}&&!activeReadingReview.busy,'note second');
        await activeReadingReview.save('vague');
        await wait(()=>currentCenterItem()?.item_type==='mistake','failed note still advances');
        await wait(()=>mistakeDetailState?.progress?.stage==='question'&&!mistakeReviewBusy,'mistake third');
        document.getElementById('mistakeFirstAnswer').value='错误作答';
        await submitMistakeReview('reveal_answer');
        await wait(()=>mistakeDetailState?.progress?.stage==='answer'&&!mistakeReviewBusy,'mistake answer');
        await submitMistakeReview('judge','correct',false);
        await wait(()=>document.getElementById('reviewPlanDayModal').classList.contains('show'),'imperfect round returns to the day card');
        check(!document.getElementById('mistakeCompleteModal').classList.contains('show')&&mistakeConfettiLayerState()==='none','imperfect day has neither completion modal nor confetti');
        card=document.querySelector('#reviewPlanDayBody .review-day-card');
        check(card.textContent.includes('继续')&&card.querySelector('.plan-day-preview'),'processed failures offer continue and preview');
        card.querySelector('.plan-day-preview').click();
        for(let i=0;i<350&&!document.getElementById('reviewAnswersPreviewBody').textContent.includes('混合队列错题');i++)await new Promise(r=>setTimeout(r,30));
        if(!document.getElementById('reviewAnswersPreviewBody').textContent.includes('混合队列错题'))
          throw Error('first plan preview: '+document.getElementById('reviewAnswersPreviewTitle').textContent+' | '+document.getElementById('reviewAnswersPreviewBody').textContent);
        check(document.getElementById('reviewAnswersPreviewBody').textContent.includes('成功复习 1 / 3'),'first aggregate preview counts latest day results');
        closeReviewAnswersPreview();
        card.querySelector('button:last-child').click();
        await wait(()=>centerReview?.session?.items?.length===2,'continue only unsuccessful tasks');
        check(centerReview.session.items.map(item=>item.item_type).join(',')==='note,mistake','continue preserves order and omits passed material');
        await wait(()=>activeReadingReview?.row?.id===${note.id}&&!activeReadingReview.busy,'continued note');
        await activeReadingReview.save('clear');
        await wait(()=>currentCenterItem()?.item_type==='mistake','continued mistake');
        await wait(()=>mistakeDetailState?.progress?.stage==='question'&&!mistakeReviewBusy,'continued mistake question');
        document.getElementById('mistakeFirstAnswer').value='这次正确';
        await submitMistakeReview('reveal_answer');
        await wait(()=>mistakeDetailState?.progress?.stage==='answer'&&!mistakeReviewBusy,'continued answer');
        await submitMistakeReview('judge','correct',true);
        await wait(()=>document.getElementById('mistakeCompleteModal').classList.contains('show')&&document.getElementById('mistakeCompleteTitle').textContent.includes('恭喜'),'perfect completion');
        await wait(()=>mistakeConfettiLayerState()!=='none','perfect confetti');
        const planActions=[...document.querySelectorAll('#mistakeCompleteModal .modal-actions button')].filter(button=>!button.hidden);
        check(planActions.length===2&&document.getElementById('reviewCompleteStartNew').hidden,'plan completion offers only plan actions');
        check(document.getElementById('reviewCompleteReplay').classList.contains('btn-primary')&&document.getElementById('reviewCompleteReplay').textContent.trim()==='再来一遍','plan replay is the blue primary action');
        check(new Set(planActions.map(button=>Math.round(button.getBoundingClientRect().top))).size===1,'plan completion actions stay on one row');
        await cancelReviewComplete();

        openPlanScheduleDay('${today}');
        card=document.querySelector('#reviewPlanDayBody .review-day-card');
        check(document.querySelector('#reviewPlanCalendar [data-plan-date="${today}"] .plan-calendar-count')?.textContent.trim()==='3/3项','calendar aggregates every successful item in the day');
        check([...card.querySelectorAll('button')].at(-1).textContent.trim()==='再来一次'&&!card.textContent.includes('继续'),'all-success day offers replay');
        card.querySelector('.plan-day-preview').click();
        await wait(()=>document.getElementById('reviewAnswersPreviewDialog').open&&document.getElementById('reviewAnswersPreviewBody').textContent.includes('成功复习 3 / 3'),'latest aggregate preview');
        check(document.getElementById('reviewAnswersPreviewBody').textContent.includes('混合队列错题'),'preview covers the whole day');
        closeReviewAnswersPreview();
        closePlanScheduleDay();
        await openReviewPlan(${futurePlan.id});
        const futureDate=[...planCalendar.dayMap.keys()].find(date=>date>'${today}');
        check(!!futureDate,'future preview occurrence exists');
        await startReviewPlanDay(${futurePlan.id},futureDate,null,false,[{type:'material',id:${material.id}}]);
        await wait(()=>centerReview?.session?.items?.length===1,'future occurrence starts without materialized same-day task');
        await pauseCenterReview();
        out.dataset.result='passed';
      }catch(error){out.dataset.result='failed';out.textContent=error.stack;}
      document.body.append(out);
    });`;
    const html=await runBrowser({chrome:browser,profile:path.join(temp,'plan-mixed-day'),url:await serve(),viewport:[1280,960],noSandbox:true,initScript});
    const result=html.match(/<pre id="regressionResult"[^>]*>[\s\S]*?<\/pre>/)?.[0];
    assert.match(result||'',/data-result="passed"/,(result||html.slice(-5000))+'\nSERVER LOG:\n'+serverLogs().slice(-3000));
  });
});
