const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {fixture}=require('./temp-backend-fixture.cjs'),{runBrowser}=require('./browser-driver.cjs');

test('all-plans opens its own page, preserves carousel and returns/refreshes after editing on desktop/mobile',{timeout:90000},async()=>fixture(async({base,ids,temp,serve,api})=>{
  const d=new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
  const plus=n=>new Date(Date.parse(d+'T00:00:00Z')+86400000*n).toISOString().slice(0,10),c='/courses/'+ids.courseId;
  const source=await api('POST',c+'/materials',{title:'计划列表测试资料',content:'测试正文'},201),plans=[];
  for(const [index,name]of ['进行中的计划','已归档的计划','已过期的计划'].entries()){
    const plan=await api('POST',c+'/review-plans',{name,startDate:index===2?plus(-5):d,examDate:index===2?plus(-1):plus(7),selectedItems:[{type:'material',id:source.id}]},201);
    if(index===1)await api('PATCH',c+'/review-plans/'+plan.id,{status:'archived'});plans.push(plan);
  }
  const other=await api('POST','/courses',{name:'没有计划的课程'},201),url=await serve();
  const chrome=['C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Google/Chrome/Application/chrome.exe'].find(fs.existsSync);assert.ok(chrome);
  for(const [index,viewport]of [[1280,960],[390,844]].entries()){
    const script=`window.COURSES_API_BASE=${JSON.stringify(base)};addEventListener('load',async()=>{
      const out=document.createElement('pre');out.id='regressionResult';const check=(ok,message)=>{if(!ok)throw Error(message)};
      const el=id=>document.getElementById(id),cards=()=>[...document.querySelectorAll('#reviewPlanList [data-plan-id]')];
      const allCards=()=>[...document.querySelectorAll('#reviewPlanAllList [data-plan-id]')];
      const wait=async(fn)=>{for(let i=0;i<250;i++){if(fn())return;await new Promise(r=>setTimeout(r,20));}throw Error('等待计划列表超时')};
      try{
        const restored=JSON.parse(sessionStorage.getItem('all-plans-refreshed')||'null');
        if(restored){
          if(restored.stage==='list'){
            await wait(()=>currentView.type==='reviewPlanList'&&allCards().length===3);
            check(el('detailPage').style.display==='none'&&el('reviewPlanListPage').style.display==='block','actual refresh restores standalone list');
            check(el('reviewPlanAllList').textContent.includes('列表编辑后${index}'),'saved edit visible after refresh');
            allCards()[0].querySelector('button[onclick*="openReviewPlan("]').click();await wait(()=>currentView.type==='reviewPlan'&&reviewPlanDetail?.fromList);
            sessionStorage.setItem('all-plans-refreshed',JSON.stringify({...restored,stage:'detail'}));location.reload();return;
          }
          await wait(()=>currentView.type==='reviewPlan'&&reviewPlanDetail?.fromList);
          el('reviewPlanDetailPage').querySelector('.back-btn').click();await wait(()=>currentView.type==='reviewPlanList'&&allCards().length===3);
          el('reviewPlanListPage').querySelector('.back-btn').click();await wait(()=>currentView.type==='course'&&cards().length===1);
          check(cards()[0].dataset.planId===restored.selected,'return restores original carousel card');
          check(document.documentElement.scrollWidth<=innerWidth+1,'mobile layout fits');out.dataset.result='passed';out.textContent='passed';document.body.append(out);return;
        }
        await openCourse(${ids.courseId},'全部计划测试','reviewPlans');await loadReviewPlans();await wait(()=>cards().length>0);
        check(cards().length===1&&el('reviewPlanViewAll').textContent.includes('3'),'default carousel retains all-count entry');
        switchReviewPlanCard(1);const current=cards()[0].dataset.planId;
        el('reviewPlanViewAll').click();await wait(()=>currentView.type==='reviewPlanList'&&allCards().length===3);
        check(el('detailPage').style.display==='none'&&cards().length===1,'all plans open separately without expanding course overview');
        check(el('reviewPlanAllList').textContent.includes('已归档')&&el('reviewPlanAllList').textContent.includes('已过期'),'archived and expired plans visible');
        check(allCards().every(card=>card.querySelector('button[onclick*="openReviewPlanEdit"]')&&card.querySelector('button[onclick*="openReviewPlan("]')),'every plan has detail and edit actions');
        el('reviewPlanListPage').querySelector('.back-btn').click();await wait(()=>currentView.type==='course'&&cards().length===1);
        check(cards()[0].dataset.planId===current,'return restores selected carousel plan');
        await openAllReviewPlans();const target=${plans[0].id};
        document.querySelector('#reviewPlanAllList [data-plan-id="'+target+'"] button[onclick*="openReviewPlanEdit"]').click();await wait(()=>reviewPlanCreate?.originalPlan&& !reviewPlanCreate.loading);
        el('reviewPlanName').value='列表编辑后${index}';await createReviewPlan();await wait(()=>currentView.type==='reviewPlan'&&reviewPlanDetail?.plan.name==='列表编辑后${index}');
        backFromReviewPlan();await wait(()=>currentView.type==='reviewPlanList'&&allCards().length===3&&el('reviewPlanAllList').textContent.includes('列表编辑后${index}'));
        const original=requestApi;try{requestApi=async()=>{throw Error('模拟列表加载失败')};await loadAllReviewPlans();check(el('reviewPlanAllList').textContent.includes('模拟列表加载失败'),'list failure shows retry');}finally{requestApi=original}
        el('reviewPlanAllList').querySelector('button').click();await wait(()=>allCards().length===3);
        await openCourse(${other.id},'没有计划的课程','reviewPlans');await openAllReviewPlans();check(allCards().length===0&&el('reviewPlanAllList').textContent.includes('暂无'),'empty course is scoped and safe');
        await openCourse(${ids.courseId},'全部计划测试','reviewPlans');await openAllReviewPlans();await wait(()=>allCards().length===3);check(document.documentElement.scrollWidth<=innerWidth+1,'desktop/mobile no horizontal overflow');
        sessionStorage.setItem('all-plans-refreshed',JSON.stringify({stage:'list',selected:current}));location.reload();return;
      }catch(e){out.dataset.result='failed';out.textContent=e.stack}document.body.append(out);
    });`;
    const html=await runBrowser({chrome,profile:path.join(temp,'all-plans-'+index),url,viewport,initScript:script,blockedUrls:['https://api.deepseek.com/*']});
    const result=html.match(/<pre id="regressionResult"[^>]*>[\s\S]*?<\/pre>/)?.[0];assert.match(result||'',/data-result="passed"/,result||html.slice(-1800));
  }
}));
