const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {fixture}=require('./temp-backend-fixture.cjs');
const {runBrowser}=require('./browser-driver.cjs');

test('completed no-skip sessions expose a read-only answer preview with fresh data',{timeout:90000},async()=>{
  await fixture(async({api,base,ids,temp,serve})=>{
    const coursePath='/courses/'+ids.courseId;
    const note=await api('POST',coursePath+'/notes',{title:'预览挖空笔记',content:'正文'},201);
    const mistake=await api('POST',coursePath+'/mistakes',{
      title:'预览原生错题',content:'独立作答这道题',answerContent:'参考答案内容',
      explanation:'解析内容',mistakeType:'execution',questionFormat:'open',
    },201);
    await api('PUT',coursePath+'/review-items/note/'+note.id+'/materials/cloze',{
      expectedVersion:0,confirmed:true,
      material:{prompt:'中国首都是【b1】',reference:'',rubric:'',objects:[],dimensions:[],blanks:[
        {id:'b1',answer:'北京',aliases:['北京市'],hint:'城市'},
      ]},
    });
    const session=await api('POST',coursePath+'/review-sessions',{
      requestId:'answer-preview-session',sourceType:'total',
      selectedItems:[{type:'note',id:note.id},{type:'mistake',id:mistake.id}],
    },201);
    const noteItem=session.items.find(item=>item.item_type==='note');
    const mistakeItem=session.items.find(item=>item.item_type==='mistake');
    const attempt=await api('POST',coursePath+'/review-items/note/'+note.id+'/attempts',{
      modeId:'cloze',expectedMaterialVersion:1,requestId:'preview-cloze-attempt',sessionItemId:noteItem.id,
    });
    await api('POST',coursePath+'/review-items/note/'+note.id+'/attempts/'+attempt.id+'/events',{
      action:'submit',answer:{b1:'北京'},requestId:'preview-cloze-submit',expectedVersion:0,durationMs:1200,
    });
    let progress=await api('POST',coursePath+'/mistakes/'+mistake.id+'/review?sessionItemId='+mistakeItem.id,{
      action:'start',requestId:'preview-native-start',expectedVersion:0,
    });
    progress=await api('POST',coursePath+'/mistakes/'+mistake.id+'/review/events?sessionItemId='+mistakeItem.id,{
      action:'reveal_answer',firstAnswer:'我的独立作答',requestId:'preview-native-reveal',expectedVersion:progress.version,
    });
    await api('POST',coursePath+'/mistakes/'+mistake.id+'/review/events?sessionItemId='+mistakeItem.id,{
      action:'judge',correct:true,requestId:'preview-native-judge',expectedVersion:progress.version,durationMs:1600,
    });

    const preview=await api('GET',coursePath+'/review-sessions/'+session.id+'/answers');
    assert.equal(preview.status,'completed');
    assert.equal(preview.skipped,0);
    assert.equal(preview.items.length,2);
    const cloze=preview.items.find(item=>item.item_type==='note');
    assert.equal(cloze.modeId,'cloze');
    assert.equal(cloze.material.prompt,'中国首都是【b1】');
    assert.equal(cloze.material.blanks[0].answer,'北京');
    assert.equal(cloze.firstAnswer.b1,'北京');
    assert.equal(cloze.resultDetail.results[0].correct,true);
    const native=preview.items.find(item=>item.item_type==='mistake');
    assert.equal(native.modeId,'standard');
    assert.equal(native.firstAnswer,'我的独立作答');
    assert.equal(native.material.reference,'参考答案内容');
    assert.equal(native.material.rubric,'解析内容');
    assert.equal(native.grade,2);

    const mixed=await api('POST',coursePath+'/review-sessions',{
      requestId:'answer-preview-mixed',sourceType:'total',
      selectedItems:[{type:'note',id:note.id},{type:'mistake',id:mistake.id}],
    },201);
    const mixedNoteItem=mixed.items.find(item=>item.item_type==='note');
    const mixedAttempt=await api('POST',coursePath+'/review-items/note/'+note.id+'/attempts',{
      modeId:'cloze',expectedMaterialVersion:1,requestId:'preview-mixed-note-attempt',sessionItemId:mixedNoteItem.id,
    });
    await api('POST',coursePath+'/review-items/note/'+note.id+'/attempts/'+mixedAttempt.id+'/events',{
      action:'submit',answer:{b1:'北京'},requestId:'preview-mixed-note-submit',expectedVersion:0,
    });
    const typed=await api('GET',coursePath+'/review-sessions/'+mixed.id+'/answers?itemType=note');
    assert.equal(typed.total,1);
    assert.equal(typed.passed,1);
    assert.equal(typed.items[0].item_type,'note');
    await api('GET',coursePath+'/review-sessions/'+mixed.id+'/answers',undefined,409);

    const skipped=await api('POST',coursePath+'/review-sessions',{
      requestId:'answer-preview-skipped',sourceType:'total',selectedItems:[{type:'note',id:note.id}],
    },201);
    await api('POST',coursePath+'/review-sessions/'+skipped.id+'/items/'+skipped.items[0].id+'/skip',{});
    await api('GET',coursePath+'/review-sessions/'+skipped.id+'/answers',undefined,409);
    const browser=['C:/Program Files/Google/Chrome/Application/chrome.exe',
      'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
      'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(fs.existsSync);
    assert.ok(browser);
    const initScript=`window.COURSES_API_BASE=${JSON.stringify(base)};addEventListener('load',async()=>{
      const out=document.createElement('pre');out.id='regressionResult';
      const check=(value,message)=>{if(!value)throw Error(message);};
      const wait=async(fn,label)=>{for(let i=0;i<350;i++){if(fn())return;await new Promise(r=>setTimeout(r,30));}throw Error('waiting: '+label);};
      try{
        await wait(()=>typeof allcourses!=='undefined'&&allcourses.some(course=>course.id===${ids.courseId}),'courses');
        await openCourse(${ids.courseId},'作答预览测试','reviewPlans');
        const completed=await(await requestApi(API+'/courses/${ids.courseId}/review-sessions/${session.id}')).json();
        let answerLoads=0;
        const nativeFetch=fetch;
        fetch=(url,options)=>{if(String(url).endsWith('/answers'))answerLoads++;return nativeFetch(url,options);};
        await openReviewCompleteModal(completed);
        const button=document.getElementById('mistakeCompletePreview');
        check(!button.hidden&&button.textContent.includes('查看作答预览'),'completion modal exposes preview for a no-skip round');
        button.click();
        await wait(()=>document.getElementById('reviewAnswersPreviewDialog').open&&document.getElementById('reviewAnswersPreviewBody').textContent.includes('预览原生错题'),'answer preview loaded');
        const dialog=document.getElementById('reviewAnswersPreviewDialog'),body=document.getElementById('reviewAnswersPreviewBody');
        check(answerLoads===1,'preview loads latest server data on open');
        check(body.textContent.includes('预览挖空笔记')&&body.textContent.includes('中国首都是')&&body.textContent.includes('我的独立作答')&&body.textContent.includes('参考答案内容'),'preview includes every answer type and reference');
        check(body.textContent.includes('各空位作答')&&body.textContent.includes('解析内容'),'cloze details and native explanation are present');
        check(!dialog.querySelector('input,textarea,select,[contenteditable="true"]'),'preview is strictly read-only');
        document.getElementById('reviewAnswersPreviewRefresh').click();
        await wait(()=>answerLoads===2&&!document.getElementById('reviewAnswersPreviewRefresh').disabled,'preview refresh');
        closeReviewAnswersPreview();
        closeReviewCompleteModal();
        const mixed=await(await requestApi(API+'/courses/${ids.courseId}/review-sessions/${mixed.id}')).json();
        const today=planLocalDate(),day={
          date:today,state:'partial',sessionId:mixed.id,sessionStatus:'active',sessionTypes:['note','mistake'],
          items:[
            {type:'note',id:${note.id},title:'预览挖空笔记',status:'completed',result:'passed',minutes:5},
            {type:'mistake',id:${mistake.id},title:'预览原生错题',status:'pending',result:null,minutes:5},
          ],
          sessionItems:[
            {type:'note',id:${note.id},status:'completed',result:'passed'},
            {type:'mistake',id:${mistake.id},status:'pending',result:null},
          ],
        };
        planCalendar={year:Number(today.slice(0,4)),month:Number(today.slice(5,7))-1,dayMap:new Map([[today,day]]),examDate:today,hasNewSchedule:false};
        openPlanScheduleDay(today);
        const dayCard=document.querySelector('#reviewPlanDayBody .review-day-card');
        check(document.querySelectorAll('#reviewPlanDayBody .review-day-card').length===1,'day tasks use one combined card');
        check(dayCard.textContent.includes('1 篇笔记 · 1 道错题')&&dayCard.textContent.includes('继续'),'partially processed day lists populated categories and offers continue');
        check(!dayCard.querySelector('.plan-day-preview'),'incomplete mixed day does not expose preview');
        closePlanScheduleDay();
        const skipped=await(await requestApi(API+'/courses/${ids.courseId}/review-sessions/${skipped.id}')).json();
        await openReviewCompleteModal(skipped);
        check(document.getElementById('mistakeCompletePreview').hidden,'skipped round has no preview button');
        closeReviewCompleteModal();
        out.dataset.result='passed';
      }catch(error){out.dataset.result='failed';out.textContent=error.stack;}
      document.body.append(out);
    });`;
    const html=await runBrowser({
      chrome:browser,
      profile:path.join(temp,'review-answer-preview'),
      url:await serve(),
      viewport:[1280,960],
      noSandbox:true,
      initScript,
    });
    const result=html.match(/<pre id="regressionResult"[^>]*>[\s\S]*?<\/pre>/)?.[0];
    assert.match(result||'',/data-result="passed"/,result||html.slice(-4000));
  });
});
