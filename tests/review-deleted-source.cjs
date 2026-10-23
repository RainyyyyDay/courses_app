const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {fixture}=require('./temp-backend-fixture.cjs');
const {runBrowser}=require('./browser-driver.cjs');

test('deleted sources leave plan and session denominators while active queues show a next-only placeholder',{timeout:90000},async()=>{
  await fixture(async({api,base,ids,temp,serve,read})=>{
    const coursePath='/courses/'+ids.courseId;
    const materialA=await api('POST',coursePath+'/materials',{title:'先删除的资料',content:'正文 A'},201);
    const materialB=await api('POST',coursePath+'/materials',{title:'保留的资料',content:'正文 B'},201);
    const noteA=await api('POST',coursePath+'/notes',{title:'计划删除笔记',content:'笔记 A'},201);
    const noteB=await api('POST',coursePath+'/notes',{title:'计划保留笔记',content:'笔记 B'},201);
    const today=new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
    const tomorrow=new Date(Date.parse(today+'T00:00:00Z')+86400000).toISOString().slice(0,10);
    const plan=await api('POST',coursePath+'/review-plans',{
      name:'删除实时计划',startDate:today,examDate:tomorrow,
      selectedItems:[{type:'note',id:noteA.id},{type:'note',id:noteB.id}],
    },201);
    await api('DELETE','/notes/'+noteA.id);
    const updatedPlan=await api('GET',coursePath+'/review-plans/'+plan.id);
    assert.equal(updatedPlan.total,1,'plan denominator drops deleted tasks immediately');
    assert.equal(updatedPlan.pending,1);
    assert.equal(updatedPlan.skipped,0,'deleted tasks are not user skips');
    assert.equal(updatedPlan.completed,0);
    assert.equal(updatedPlan.completionRate,0);
    const planItems=await api('GET',coursePath+'/review-plans/'+plan.id+'/items');
    assert.deepEqual(planItems.map(item=>item.item_id),[noteB.id]);
    const schedule=await api('GET',coursePath+'/review-plans/'+plan.id+'/schedule');
    assert.ok(schedule.days.every(day=>day.items.every(item=>item.id!==noteA.id)),'deleted note is absent from the live calendar');
    assert.ok(read(db=>db.prepare('SELECT source_deleted FROM review_plan_items WHERE plan_id=? AND item_id=?').get(plan.id,noteA.id).source_deleted),'history identity remains materialized');

    const browser=['C:/Program Files/Google/Chrome/Application/chrome.exe',
      'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
      'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(fs.existsSync);
    assert.ok(browser);
    const initScript=`window.COURSES_API_BASE=${JSON.stringify(base)};addEventListener('load',async()=>{
      const out=document.createElement('pre');out.id='regressionResult';
      const check=(value,message)=>{if(!value)throw Error(message);};
      const wait=async(fn,label)=>{for(let i=0;i<300;i++){if(fn())return;await new Promise(r=>setTimeout(r,30));}throw Error('waiting: '+label);};
      try{
        await wait(()=>typeof allcourses!=='undefined'&&allcourses.some(course=>course.id===${ids.courseId}),'courses');
        await openCourse(${ids.courseId},'现有复习删除测试','materials');
        const session=await createReviewRecord('total',[
          {type:'material',id:${materialA.id}},{type:'material',id:${materialB.id}}
        ],{requestId:'deleted-active-session'});
        await enterCenterReview(session);
        await wait(()=>currentCenterItem()?.item_id===${materialA.id},'initial material');
        await requestApi(API+'/materials/${materialA.id}',{method:'DELETE'});
        centerReview.session=await (await requestApi(reviewSessionApi(session.id))).json();
        centerReview.position=centerReview.session.current_position;
        await renderCenterReviewItem();
        check(centerReview.session.total===1&&centerReview.session.deleted===1,'server excludes deleted item from effective session total');
        check(document.getElementById('materialReviewContent').textContent.includes('内容已删除'),'active queue shows deleted placeholder');
        const toolbar=document.getElementById('centerReviewToolbar');
        const actions=[...toolbar.querySelectorAll('button')].map(button=>button.textContent.trim());
        check(actions.length===1&&actions[0]==='下一项','deleted item offers only the next action');
        check(toolbar.textContent.includes('成功复习 0 / 1'),'deleted item is absent from success denominator');
        toolbar.querySelector('button').click();
        await wait(()=>currentCenterItem()?.item_id===${materialB.id},'next valid item');
        centerReview=null;
        clearCenterReviewUi();
        await openReviewPlan(${plan.id});
        check(reviewPlanDetail.plan.total===1,'plan detail reflects only the remaining task');
        check(document.getElementById('reviewPlanDetailBody').textContent.includes('成功复习 0 / 1'),'plan card shows success / effective total');
        check([...planCalendar.dayMap.values()].every(day=>day.items.every(item=>item.id!==${noteA.id})),'deleted plan task is absent from the calendar');
        const firstPlanDay=[...planCalendar.dayMap.keys()][0];
        check(!!firstPlanDay,'remaining task still has a schedule day');
        openPlanScheduleDay(firstPlanDay);
        check(document.getElementById('reviewPlanDayBody').textContent.includes('成功复习 0 / 1'),'day task count uses the effective total');
        closePlanScheduleDay();
        await requestApi(API+'/notes/${noteB.id}',{method:'DELETE'});
        window.dispatchEvent(new Event('focus'));
        await wait(()=>reviewPlanDetail?.plan.total===0,'plan auto refresh after source deletion');
        check(document.getElementById('reviewPlanDetailBody').textContent.includes('成功复习 0 / 0'),'plan total updates without pressing apply schedule');
        check(planCalendar.dayMap.size===0,'calendar removes the last deleted task automatically');
        out.dataset.result='passed';
      }catch(error){out.dataset.result='failed';out.textContent=error.stack;}
      document.body.append(out);
    });`;
    const html=await runBrowser({
      chrome:browser,
      profile:path.join(temp,'review-deleted-source'),
      url:await serve(),
      viewport:[1280,960],
      noSandbox:true,
      initScript,
    });
    const result=html.match(/<pre id="regressionResult"[^>]*>[\s\S]*?<\/pre>/)?.[0];
    assert.match(result||'',/data-result="passed"/,result||html.slice(-3000));
  });
});
