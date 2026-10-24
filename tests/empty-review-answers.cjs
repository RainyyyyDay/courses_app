const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {fixture}=require('./temp-backend-fixture.cjs'),{runBrowser}=require('./browser-driver.cjs');
const material={prompt:'比较或回忆概念',reference:'参考要点',rubric:'核对准确性',objects:['甲','乙'],dimensions:['定义'],blanks:[]};
const cloze={...material,prompt:'甲是【b1】，乙是【b2】',blanks:[{id:'b1',answer:'一',aliases:[],hint:''},{id:'b2',answer:'二',aliases:[],hint:''}]};
test('empty answers API: all modes, partial blanks, immutable failure, history and session persistence',{timeout:90000},async()=>fixture(async({api,ids,read,restart})=>{
  const c='/courses/'+ids.courseId;let n=0;
  for(const type of ['note','material','mistake']){
    const table={note:'notes',material:'materials',mistake:'mistakes'}[type];
    const row=await api('POST',c+'/'+table,{title:type,content:'题面',...(type==='mistake'?{mistakeType:'thinking',questionFormat:'open',answerContent:'参考'}:{})},201),base=c+'/review-items/'+type+'/'+row.id;
    for(const mode of ['standard','self_explain','contrast','cloze']){
      await api('PUT',base+'/materials/'+mode,{confirmed:true,expectedVersion:0,material:mode==='cloze'?cloze:material});
      const session=await api('POST',c+'/review-sessions',{requestId:'session-'+(++n),sourceType:'total',selectedItems:[{type,id:row.id}]},201);
      const a=await api('POST',base+'/attempts',{modeId:mode,expectedMaterialVersion:1,requestId:'attempt-'+n,sessionItemId:session.items[0].id});
      assert.equal(a.firstAnswer,null);assert.equal(a.grade,null);
      const body={action:'submit',answer:mode==='cloze'?{}:mode==='contrast'?JSON.stringify({kind:'contrast-v1',fields:{same:' ',different:''}}):' \n',expectedVersion:0,requestId:'empty'};
      const p=await api('POST',base+'/attempts/'+a.id+'/events',body);assert.equal(p.stage,'completed');assert.equal(p.grade,1);assert.equal(p.result.unanswered,true);
      assert.deepEqual(await api('POST',base+'/attempts/'+a.id+'/events',body),p,'resend is idempotent');
      await api('POST',base+'/attempts/'+a.id+'/events',{action:'judge',grade:4,expectedVersion:p.version,requestId:'upgrade'},409);
      const history=base+'/history/'+encodeURIComponent('w:'+a.id),h=await api('GET',history);assert.equal(h.responseKind,'unanswered');assert.match(h.note,/不会/);
      await api('POST',history+'/feedback',{requestId:'forbidden',provider:'mock',model:'',feedback:{}},409);
      const saved=await api('GET',c+'/review-sessions/'+session.id);assert.equal(saved.items[0].result,'failed');
      await restart();assert.equal((await api('GET',base+'/attempts/'+a.id)).grade,1);
    }
    const partial=await api('POST',base+'/attempts',{modeId:'cloze',expectedMaterialVersion:1,requestId:'partial-'+type});
    const p=await api('POST',base+'/attempts/'+partial.id+'/events',{action:'submit',answer:{b1:'一'},expectedVersion:0,requestId:'partial'});
    assert.deepEqual(p.firstAnswer,{b1:'一',b2:''});assert.equal(p.result.results[0].correct,true);assert.equal(p.result.results[1].unanswered,true);assert.equal(p.grade,1);assert.equal(p.result.unanswered,false);
    await api('PUT',base+'/materials/self_explain',{confirmed:true,expectedVersion:1,material:{...material,reference:''}},400,'material requirements remain');
  }
  for(const type of ['thinking','execution','unclassified','single','multiple']){
    const choice=['single','multiple'].includes(type),row=await api('POST',c+'/mistakes',{title:type,content:'题目',answerContent:'答案',mistakeType:choice?'execution':type,questionFormat:choice?'choice':'open',...(choice?{choiceType:type,options:[{id:'A',text:'甲'},{id:'B',text:'乙'}],correctOption:type==='single'?'A':['A']}:{})},201);
    if(choice)await api('PUT',c+'/mistakes/'+row.id+'/mode',{modeId:'choice_reproduction'});
    const review=c+'/mistakes/'+row.id+'/review';let p=await api('POST',review,{action:'start',expectedVersion:0,requestId:'start'});
    p=await api('POST',review+'/events',{action:choice?'choose':'reveal_answer',...(choice?{selectedOption:type==='single'?'':[]}:{firstAnswer:''}),expectedVersion:p.version,requestId:'empty'});
    assert.equal(p.stage,'completed');assert.equal(p.firstAnswer,'');assert.equal(p.responseKind,'unanswered');assert.equal(p.reviewStatus,'unreviewed');assert.equal(p.answerVisible,true);
    const event=read(db=>db.prepare('SELECT grade,evidence_json FROM review_item_events WHERE item_type=? AND item_id=? ORDER BY id DESC LIMIT 1').get('mistake',row.id));assert.equal(event.grade,1);assert.equal(JSON.parse(event.evidence_json).unanswered,true);
    await api('POST',review+'/events',{action:'judge',correct:true,expectedVersion:p.version,requestId:'upgrade'},409);
    p=await api('POST',review,{action:'start',expectedVersion:p.version,requestId:'retry'});assert.equal(p.firstAnswer,null);assert.equal(p.stage,'question');
  }
}));

test('empty answers browser: submit, abandon, reopen, refresh, partial blanks and AI gating',{timeout:120000},async()=>fixture(async({api,base,ids,temp,serve})=>{
  const c='/courses/'+ids.courseId,row=await api('POST',c+'/notes',{title:'留空复习',content:'原文'},201),b=c+'/review-items/note/'+row.id;
  for(const mode of ['standard','self_explain','contrast','cloze'])await api('PUT',b+'/materials/'+mode,{confirmed:true,expectedVersion:0,material:mode==='cloze'?cloze:material});
  const choice=await api('POST',c+'/mistakes',{title:'留空选择',content:'题面',answerContent:'参考',mistakeType:'execution',questionFormat:'choice',choiceType:'single',options:[{id:'A',text:'甲'},{id:'B',text:'乙'}],correctOption:'A'},201);
  await api('PUT',c+'/mistakes/'+choice.id+'/mode',{modeId:'choice_reproduction'});
  const chrome=['C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Google/Chrome/Application/chrome.exe'].find(fs.existsSync);assert.ok(chrome);const url=await serve();
  for(const [i,viewport]of [[1280,960],[390,844]].entries()){
    const script=`window.COURSES_API_BASE=${JSON.stringify(base)};const nativeFetch=fetch;let aiCalls=0;fetch=(u,o)=>{if(String(u).includes('/api/ai/')){aiCalls++;throw Error('AI forbidden')}return nativeFetch(u,o)};addEventListener('load',async()=>{const out=document.createElement('pre');out.id='regressionResult';const q=s=>document.querySelector(s),check=(v,m)=>{if(!v)throw Error(m)},wait=async fn=>{for(let n=0;n<250;n++){if(fn())return;await new Promise(r=>setTimeout(r,20))}throw Error('UI timeout')},api=async(m,p,body)=>{const r=await nativeFetch(${JSON.stringify(base)}+p,{method:m,...(body?{headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{})});if(!r.ok)throw Error(await r.text());return r.json()};try{
      const saved=JSON.parse(sessionStorage.getItem('empty-attempts')||'null');
      if(saved){for(const id of saved){const p=await api('GET',${JSON.stringify(b+'/attempts/')}+id);check(p.stage==='completed'&&p.grade===1,'refresh retains failed round')}out.textContent='PASS';document.body.append(out);return;}
      openCourse(${ids.courseId},'留空测试','notes');const completed=[];
      for(const mode of ['standard','self_explain','contrast','cloze']){
        const session=await createReviewRecord('total',[{type:'note',id:${row.id}}]);await enterCenterReview(session);const ctx={...centerWorkbenchContext(session.items[0],session),mode};
        await openReviewWorkbench('note',${row.id},ctx);if(!reviewWorkbench.attempt)await startWorkbenchAttempt();
        const id=reviewWorkbench.attempt.id;check(reviewWorkbench.attempt.stage==='question','not submitted yet');closeReviewWorkbench();
        check((await api('GET',${JSON.stringify(b+'/attempts/')}+id)).grade===null,'closing blank attempt never grades');
        await openReviewWorkbench('note',${row.id},ctx);check(reviewWorkbench.attempt?.id===id,'reopen restores unsubmitted attempt');
        if(mode==='standard'){[...wb('Actions').querySelectorAll('button')].find(b=>b.textContent==='不会，查看参考').click();await wait(()=>reviewWorkbench.attempt.stage==='completed')}else await submitWorkbenchAttempt('submit');check(reviewWorkbench.attempt.stage==='completed'&&reviewWorkbench.attempt.grade===1,'empty '+mode+' records failure');check(!q('[data-feedback-generate]'),'no AI for blank '+mode);check(wb('Attempt').textContent.includes('不会'),'unanswered message');
        completed.push(id);closeReviewWorkbench();await openReviewWorkbench('note',${row.id},ctx);check(reviewWorkbench.attempt?.id===id&&reviewWorkbench.attempt.grade===1,'reopen completed round preserves failure');closeReviewWorkbench();
      }
      const session=await createReviewRecord('total',[{type:'note',id:${row.id}}]);await enterCenterReview(session);await openReviewWorkbench('note',${row.id},{...centerWorkbenchContext(session.items[0],session),mode:'cloze'});if(!reviewWorkbench.attempt)await startWorkbenchAttempt();
      q('[data-review-blank="b1"]').value='一';await submitWorkbenchAttempt('submit');check(reviewWorkbench.attempt.firstAnswer.b1==='一'&&reviewWorkbench.attempt.result.results[1].unanswered,'partial blank preserved');check(q('[data-feedback-generate]'),'partial answer permits optional AI');closeReviewWorkbench();
      await openMistakeDetail(${choice.id},true);await submitMistakeReview('start');await submitMistakeChoice();check(mistakeDetailState.progress.responseKind==='unanswered'&&mistakeDetailState.progress.reviewStatus==='unreviewed','unselected choice fails');check(!document.getElementById('mistakeReviewPanel').querySelector('[data-feedback-generate]'),'blank choice no AI');
      check(aiCalls===0,'no model calls');sessionStorage.setItem('empty-attempts',JSON.stringify(completed));location.reload();
    }catch(e){out.textContent='FAIL '+e.stack;document.body.append(out)}});`;
    const html=await runBrowser({chrome,profile:path.join(temp,'empty-'+i),url,viewport,initScript:script});assert.match(html.match(/<pre id="regressionResult">[\s\S]*?<\/pre>/)?.[0]||'',/>PASS</);
  }
}));
