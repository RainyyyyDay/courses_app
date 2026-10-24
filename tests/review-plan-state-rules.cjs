const {test}=require('node:test');
const assert=require('node:assert/strict');
const {fixture}=require('./temp-backend-fixture.cjs');

test('plan day completion and new-schedule flags follow only successful planned work',{timeout:90000},async()=>{
  await fixture(async({api,ids})=>{
    const c='/courses/'+ids.courseId;
    const today=new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
    const addDays=(date,days)=>new Date(Date.parse(date+'T00:00:00Z')+days*86400000).toISOString().slice(0,10);
    const materialA=await api('POST',c+'/materials',{title:'状态规则资料 A',content:'A'},201);
    const materialB=await api('POST',c+'/materials',{title:'状态规则资料 B',content:'B'},201);
    const note=await api('POST',c+'/notes',{title:'状态规则待删除笔记',content:'note'},201);
    const plan=await api('POST',c+'/review-plans',{
      name:'当天部分完成',startDate:today,examDate:addDays(today,1),
      selectedItems:[{type:'material',id:materialA.id},{type:'material',id:materialB.id}],
    },201);
    const planItems=await api('GET',c+'/review-plans/'+plan.id+'/items');
    const session=await api('POST',c+'/review-sessions',{
      requestId:'plan-state-session',sourceType:'plan',sourceId:plan.id,scheduledDate:today,
      selectedItems:planItems.map(item=>({type:item.item_type,id:item.item_id})),
    },201);
    const first=session.items[0],second=session.items[1];
    await api('PATCH',c+'/materials/'+first.item_id+'/review?sessionItemId='+first.id+'&planItemId='+first.plan_item_id,{recall:'clear'});
    await api('POST',c+'/review-sessions/'+session.id+'/items/'+second.id+'/skip',{});
    const partial=await api('GET',c+'/review-plans/'+plan.id+'/schedule');
    const partialDay=partial.days.find(day=>day.date===today);
    assert.equal(partialDay.state,'partial','a skipped task prevents the day from being complete');
    assert.equal(partial.hasNewSchedule,false,'an unfinished current day does not request a replacement schedule immediately');

    const missed=await api('POST',c+'/review-plans',{
      name:'昨天未完成',startDate:addDays(today,-1),examDate:addDays(today,1),
      selectedItems:[{type:'material',id:materialA.id}],
    },201);
    const missedSchedule=await api('GET',c+'/review-plans/'+missed.id+'/schedule');
    assert.equal(missedSchedule.hasNewSchedule,true,'an unfinished past day requests a new schedule');
    await api('POST',c+'/review-plans/'+missed.id+'/schedule/apply',undefined,200);
    assert.equal((await api('GET',c+'/review-plans/'+missed.id+'/schedule')).hasNewSchedule,false,'applying handles the missed day once');

    const early=await api('POST',c+'/review-plans',{
      name:'提前完成一项',startDate:today,examDate:addDays(today,5),
      selectedItems:[{type:'material',id:materialA.id},{type:'material',id:materialB.id}],
    },201);
    const earlyItems=await api('GET',c+'/review-plans/'+early.id+'/items');
    const futureTask=earlyItems.find(item=>item.scheduled_date>today);
    assert.ok(futureTask,'early plan has a future task');
    await api('PATCH',c+'/materials/'+futureTask.item_id+'/review?planItemId='+futureTask.id,{reviewStatus:'reviewed'});
    assert.equal((await api('GET',c+'/review-plans/'+early.id+'/schedule')).hasNewSchedule,true,'even one future task completed early requests a new schedule');
    await api('POST',c+'/review-plans/'+early.id+'/schedule/apply',undefined,200);
    const appliedEarly=await api('GET',c+'/review-plans/'+early.id+'/schedule');
    const preserved=appliedEarly.days.flatMap(day=>day.items).find(item=>item.type==='material'&&item.id===futureTask.item_id&&item.status==='completed'&&item.result==='passed');
    assert.ok(preserved,'applying a new schedule never erases an already completed attempt');

    const deletedPlan=await api('POST',c+'/review-plans',{
      name:'未来任务被删除',startDate:today,examDate:addDays(today,5),
      selectedItems:[{type:'note',id:note.id}],
    },201);
    await api('DELETE','/notes/'+note.id);
    assert.equal((await api('GET',c+'/review-plans/'+deletedPlan.id+'/schedule')).hasNewSchedule,true,'deleting a today/future task requests a new schedule');
    await api('POST',c+'/review-plans/'+deletedPlan.id+'/schedule/apply',undefined,200);
    assert.equal((await api('GET',c+'/review-plans/'+deletedPlan.id+'/schedule')).hasNewSchedule,false,'applying a deletion reschedules once');
  });
});
