const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {fixture}=require('./temp-backend-fixture.cjs'),{runBrowser}=require('./browser-driver.cjs');
test('knowledge standard recall accepts no written answer and retains honest evidence across restart',async()=>fixture(async({api,ids,read,restart})=>{
  const prefix='/courses/'+ids.courseId;
  for(const recall of ['clear','vague','forgotten']){
    const row=await api('POST',prefix+'/mistakes',{title:'记忆 '+recall,content:'回忆概念',answerContent:'概念参考',mistakeType:'knowledge',questionFormat:'open'},201);
    const base=prefix+'/mistakes/'+row.id,review=base+'/review';
    let p=await api('POST',review,{action:'start',requestId:'start',expectedVersion:0});
    await api('POST',review+'/events',{action:'recall',recall,firstAnswer:42,requestId:'invalid',expectedVersion:p.version},400);
    const body={action:'recall',recall,requestId:'recall',expectedVersion:p.version,...(recall==='vague'?{firstAnswer:'   '}:{})};
    p=await api('POST',review+'/events',body);assert.equal(p.stage,'answer');assert.equal(p.firstAnswer,null);assert.equal(p.responseKind,'memory_self_report');
    assert.equal(p.recall,recall);assert.equal(p.answer.content,'概念参考');assert.deepEqual(await api('POST',review+'/events',body),p);
    assert.equal(read(db=>db.prepare('SELECT count(*) n FROM review_item_events WHERE item_type=? AND item_id=?').get('mistake',row.id).n),0,'memory selection alone does not grade');
    if(recall==='clear'){await restart();assert.deepEqual(await api('GET',review),p);}
    const history=prefix+'/review-items/mistake/'+row.id+'/history/'+encodeURIComponent('n:'+p.reviewRevision+':'+p.round);
    const detail=await api('GET',history);assert.equal(detail.firstAnswer,null);assert.equal(detail.recall,recall);assert.match(detail.note,/记忆自评/);
    await api('POST',history+'/feedback',{requestId:'no-evidence',provider:'mock',model:'',feedback:{}},409);
    p=await api('POST',review+'/events',{action:'judge',correct:recall!=='forgotten',requestId:'judge',expectedVersion:p.version});
    const event=read(db=>db.prepare('SELECT first_answer,evidence_json,grade FROM review_item_events WHERE item_type=? AND item_id=? ORDER BY id DESC LIMIT 1').get('mistake',row.id));
    assert.equal(event.first_answer,null);assert.equal(JSON.parse(event.evidence_json).responseKind,'memory_self_report');assert.equal(JSON.parse(event.evidence_json).judgedBeforeReveal,false);assert.ok(event.grade<=2);
    assert.equal(p.reviewStatus,recall==='forgotten'?'unreviewed':'reviewed');
  }
  for(const mistakeType of ['thinking','execution','unclassified']){
    const row=await api('POST',prefix+'/mistakes',{title:mistakeType,content:'问题',answerContent:'答案',mistakeType,questionFormat:'open'},201),review=prefix+'/mistakes/'+row.id+'/review';
    let p=await api('POST',review,{action:'start',requestId:'start',expectedVersion:0});
    const blank=await api('POST',review+'/events',{action:'reveal_answer',requestId:'empty',expectedVersion:p.version});
    assert.equal(blank.responseKind,'unanswered');assert.equal(blank.stage,'completed');
    p=await api('POST',review,{action:'start',requestId:'start-again',expectedVersion:blank.version});
    await api('POST',review+'/events',{action:'recall',recall:'clear',requestId:'wrong-mode',expectedVersion:p.version},409);
    p=await api('POST',review+'/events',{action:'reveal_answer',firstAnswer:'实际作答',requestId:'answer',expectedVersion:p.version});assert.equal(p.firstAnswer,'实际作答');
  }
}));

test('knowledge memory browser optional recall, persistence, AI gating and blank answer regression',{timeout:120000},async()=>fixture(async({api,base,ids,serve,temp})=>{
  const chrome=['C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Google/Chrome/Application/chrome.exe'].find(fs.existsSync);assert.ok(chrome);
  const url=await serve();
  for(const [index,viewport]of [[1280,960],[390,844]].entries()){
    const create=mistakeType=>api('POST','/courses/'+ids.courseId+'/mistakes',{title:'记忆模式 '+index,content:'回忆概念',answerContent:'核对参考',questionFormat:'open',mistakeType},201);
    const rows=[];for(let i=0;i<4;i++)rows.push(await create('knowledge'));const thinking=await create('thinking');
    const script=`window.COURSES_API_BASE=${JSON.stringify(base)};let aiCalls=0;const nativeFetch=fetch;fetch=(u,o)=>{if(String(u).includes('/api/ai/')){aiCalls++;throw Error('model calls forbidden')}return nativeFetch(u,o)};addEventListener('load',async()=>{const out=document.createElement('pre');out.id='regressionResult';const el=id=>document.getElementById(id),q=s=>document.querySelector(s),check=(v,m)=>{if(!v)throw Error(m)},wait=async fn=>{for(let n=0;n<250;n++){if(fn())return;await new Promise(r=>setTimeout(r,30))}throw Error('UI timeout')};try{
      if(sessionStorage.getItem('memory-pending')){
        await wait(()=>currentCourseId===${ids.courseId}&&currentView.type==='course');await openMistakeDetail(${rows[0].id},true);
        check(mistakeDetailState.progress.stage==='answer'&&mistakeDetailState.progress.firstAnswer===null,'refresh restores memory choice without fabricating answer');
        check(!q('[data-feedback-generate]'),'refresh does not expose AI for blank answer');await submitMistakeReview('judge','correct',true);sessionStorage.setItem('memory-refreshed','1');sessionStorage.removeItem('memory-pending');
      }else openCourse(${ids.courseId},'记忆自评测试','mistakes');
      const rows=${JSON.stringify(rows.slice(0,3).map(r=>r.id))};
      for(const [i,recall]of ['clear','vague','forgotten'].entries()){
        if(i===0&&sessionStorage.getItem('memory-refreshed'))continue;
        await openMistakeDetail(rows[i],true);await submitMistakeReview('start');
        check(q('[data-memory-answer]')&&!q('[data-memory-answer]').open,'optional editor initially collapsed');
        q('[data-review-action="recall-'+recall+'"]').click();await wait(()=>mistakeDetailState.progress.stage==='answer');
        check(mistakeDetailState.progress.firstAnswer===null&&mistakeDetailState.progress.recall===recall,'direct recall saves only self report');check(!q('[data-feedback-generate]'),'no AI feedback without written evidence');check(el('mistakeReviewPanel').textContent.includes('仅记录记忆自评'),'self report description');
        if(i===0){sessionStorage.setItem('memory-pending','1');location.reload();return;}
        await openMistakeDetail(rows[i],true);check(mistakeDetailState.progress.recall===recall,'immediate reopen retains recall');await submitMistakeReview('judge','correct',recall!=='forgotten');
        await openMistakeDetail(rows[i],true);check(mistakeDetailState.progress.stage==='completed'&&mistakeDetailState.progress.firstAnswer===null,'completed round persists no answer');
      }
      await openMistakeDetail(${rows[3].id},true);await submitMistakeReview('start');q('[data-memory-answer]').open=true;
      el('mistakeFirstAnswer').value='我对概念的实际回忆';el('mistakeFirstAnswer').dispatchEvent(new Event('input'));await submitMistakeReview('recall','recall','clear');
      check(mistakeDetailState.progress.firstAnswer==='我对概念的实际回忆'&&q('[data-feedback-generate]'),'written recall retains optional AI feedback');await openMistakeDetail(${rows[3].id},true);check(mistakeDetailState.progress.firstAnswer==='我对概念的实际回忆','written recall restored');
      await openMistakeDetail(${thinking.id},true);await submitMistakeReview('start');check(!q('[data-memory-answer]')&&el('mistakeFirstAnswer').getBoundingClientRect().height>0,'thinking retains visible answer');await submitMistakeReview('reveal_answer');check(mistakeDetailState.progress.stage==='completed'&&mistakeDetailState.progress.responseKind==='unanswered','other categories allow blank as failure');
      await openMistakeDetail(rows[0],true);await submitMistakeReview('start');check(!q('[data-memory-answer]').open,'fresh round remains collapsed');
      check(aiCalls===0,'no real or simulated AI requested');check(document.documentElement.scrollWidth<=innerWidth+1,'mobile fits');out.textContent='PASS';
    }catch(e){out.textContent='FAIL '+e.stack}document.body.append(out)});`;
    const html=await runBrowser({chrome,profile:path.join(temp,'memory-'+index),url,viewport,initScript:script,screenshot:path.join(require('node:os').tmpdir(),'courses-memory-recall-'+viewport[0]+'.png')});
    assert.match(html.match(/<pre id="regressionResult">[\s\S]*?<\/pre>/)?.[0]||'',/>PASS</);
  }
}));
