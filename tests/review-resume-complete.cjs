const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const {fixture}=require('./temp-backend-fixture.cjs');
const {runBrowser}=require('./browser-driver.cjs');

test('paused reviews from every ordinary source show completion after resume, including deleted items',{timeout:90000},async()=>fixture(async({api,base,ids,temp,serve})=>{
  const cases=[],c='/courses/'+ids.courseId;
  for(const source of ['total','material','note','mistake']){
    const type=source==='total'?'note':source,table={note:'notes',material:'materials',mistake:'mistakes'}[type];
    const rows=[];
    for(let i=0;i<2;i++)rows.push(await api('POST',c+'/'+table,{title:source+' '+i,content:'复习题面',...(type==='mistake'?{mistakeType:'execution',questionFormat:'open',answerContent:'参考答案',explanation:'辨析内容'}:{})},201));
    const session=await api('POST',c+'/review-sessions',{requestId:'resume-'+source,sourceType:source,selectedItems:rows.map(row=>({type,id:row.id}))},201);
    await api('POST',c+'/review-sessions/'+session.id+'/position',{position:1});
    await api('POST',c+'/review-sessions/'+session.id+'/pause',{});
    await api('DELETE','/'+table+'/'+rows[0].id);
    cases.push({source,type,id:rows[1].id,sessionId:session.id});
  }
  const chrome=['C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Google/Chrome/Application/chrome.exe'].find(fs.existsSync);assert.ok(chrome);
  const script=`window.COURSES_API_BASE=${JSON.stringify(base)};addEventListener('load',async()=>{const out=document.createElement('pre');out.id='regressionResult';const check=(v,m)=>{if(!v)throw Error(m)},wait=async fn=>{for(let n=0;n<300;n++){if(fn())return;await new Promise(r=>setTimeout(r,20))}throw Error('UI timeout')};try{
    await wait(()=>typeof allcourses!=='undefined'&&allcourses.some(c=>c.id===${ids.courseId}));await openCourse(${ids.courseId},'继续复习测试','reviewPlans');
    for(const item of ${JSON.stringify(cases)}){
      await resumeReviewRecord(item.sessionId);check(currentCenterItem()?.item_id===item.id,'resume selects remaining item '+item.source);
      if(item.type==='mistake'){
        await submitMistakeReview('reveal_answer',null,null,{firstAnswer:''});check(mistakeDetailState.progress.responseKind==='unanswered','blank result preserved');
        const b=[...document.querySelectorAll('#mistakeReviewPanel button')].find(b=>b.textContent==='看完了，继续复习');check(b,'explicit continue available');b.click();
      }else await activeReadingReview.save('clear');
      await wait(()=>document.getElementById('mistakeCompleteModal').classList.contains('show'));
      check(reviewCompleteState.sessionId===item.sessionId,'completion belongs to resumed session '+item.source);check(reviewCompleteState.session.deleted===1,'deleted item retained as history');
      check(currentView.type!=='reviewSessionDetail','not routed directly to history');
      await openReviewCompletePreview();check(document.getElementById('reviewAnswersPreviewDialog').open,'preview remains available');closeReviewAnswersPreview();
      await cancelReviewComplete();await openReviewSessionDetail(item.sessionId);check(!document.getElementById('mistakeCompleteModal').classList.contains('show'),'explicit history does not open completion modal');
    }
    out.textContent='PASS';
  }catch(e){out.textContent='FAIL '+e.stack}document.body.append(out)});`;
  const html=await runBrowser({chrome,profile:path.join(temp,'resume-complete'),url:await serve(),viewport:[1280,960],initScript:script});
  assert.match(html.match(/<pre id="regressionResult">[\s\S]*?<\/pre>/)?.[0]||'',/>PASS</);
}));
