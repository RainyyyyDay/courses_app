const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {fixture}=require('./temp-backend-fixture.cjs');
const {runBrowser}=require('./browser-driver.cjs');

test('cloze results use input-aware red/green highlighting and saved results advance automatically',{timeout:90000},async()=>{
  await fixture(async({api,base,ids,temp,serve})=>{
    const coursePath='/courses/'+ids.courseId;
    const first=await api('POST',coursePath+'/notes',{title:'部分正确挖空',content:'正文一'},201);
    const second=await api('POST',coursePath+'/notes',{title:'完全正确挖空',content:'正文二'},201);
    await api('PUT',coursePath+'/review-items/note/'+first.id+'/materials/cloze',{
      expectedVersion:0,confirmed:true,
      material:{prompt:'马克思主义【b1】',reference:'',rubric:'',objects:[],dimensions:[],blanks:[
        {id:'b1',answer:'中国化',aliases:['中国特色社会主义'],hint:'理论成果'},
      ]},
    });
    await api('PUT',coursePath+'/review-items/note/'+second.id+'/materials/cloze',{
      expectedVersion:0,confirmed:true,
      material:{prompt:'中国首都是【b1】',reference:'',rubric:'',objects:[],dimensions:[],blanks:[
        {id:'b1',answer:'北京',aliases:['北京市'],hint:'城市'},
      ]},
    });
    const browser=['C:/Program Files/Google/Chrome/Application/chrome.exe',
      'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
      'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(fs.existsSync);
    assert.ok(browser);
    const initScript=`window.COURSES_API_BASE=${JSON.stringify(base)};addEventListener('load',async()=>{
      const out=document.createElement('pre');out.id='regressionResult';
      const check=(value,message)=>{if(!value)throw Error(message);};
      const wait=async(fn,label)=>{for(let i=0;i<400;i++){if(fn())return;await new Promise(r=>setTimeout(r,30));}throw Error('waiting: '+label);};
      try{
        await wait(()=>typeof allcourses!=='undefined'&&allcourses.some(course=>course.id===${ids.courseId}),'courses');
        await openCourse(${ids.courseId},'结果颜色测试','notes');
        const session=await createReviewRecord('total',[
          {type:'note',id:${first.id}},{type:'note',id:${second.id}}
        ],{requestId:'result-color-session'});
        await enterCenterReview(session);
        const firstItem=centerReview.session.items[0];
        await openReviewWorkbench('note',${first.id},{...centerWorkbenchContext(firstItem,centerReview.session),mode:'cloze'});
        await loadReviewWorkbenchMode('cloze');
        if(!reviewWorkbench.attempt)await startWorkbenchAttempt();
        document.querySelector('[data-review-blank="b1"]').value='中国';
        await submitWorkbenchAttempt('submit');

        const wrong=document.querySelector('[data-blank-result="b1"]');
        const wrongStatus=wrong.querySelector('.review-result-status');
        check(wrong.classList.contains('is-wrong')&&wrongStatus.textContent==='错误','incorrect result uses the red state');
        check(getComputedStyle(wrongStatus).color==='rgb(196, 61, 61)','incorrect status is red');
        check([...wrong.querySelectorAll('.review-answer-hit')].map(node=>node.textContent).join('')==='中国','matched answer characters stay black');
        check([...wrong.querySelectorAll('.review-answer-miss')].map(node=>node.textContent).join('')==='化','unmatched answer characters are red');
        check(getComputedStyle(wrong.querySelector('.review-answer-miss')).color==='rgb(196, 61, 61)','unmatched character is red');
        check(!wb('Actions').textContent.includes('返回复习队列')&&wb('Actions').textContent.includes('正在进入下一项'),'saved result has no return-to-queue action');

        await wait(()=>currentCenterItem()?.item_id===${second.id},'automatic next item');
        const secondItem=currentCenterItem();
        await openReviewWorkbench('note',${second.id},{...centerWorkbenchContext(secondItem,centerReview.session),mode:'cloze'});
        await loadReviewWorkbenchMode('cloze');
        if(!reviewWorkbench.attempt)await startWorkbenchAttempt();
        document.querySelector('[data-review-blank="b1"]').value='北京';
        await submitWorkbenchAttempt('submit');

        const correct=document.querySelector('[data-blank-result="b1"]');
        const correctStatus=correct.querySelector('.review-result-status'),answer=correct.querySelector('.review-answer-all-correct');
        check(correct.classList.contains('is-correct')&&correctStatus.textContent==='正确','correct result uses the green state');
        check(getComputedStyle(correctStatus).color==='rgb(35, 134, 79)'&&getComputedStyle(answer).color==='rgb(35, 134, 79)','correct status and complete answer are green');
        check(!correct.querySelector('.review-answer-miss'),'correct answer has no red unmatched characters');
        check(!wb('Actions').textContent.includes('返回复习队列'),'correct result also has no return action');
        await finishWorkbenchAttempt();
        out.dataset.result='passed';
      }catch(error){out.dataset.result='failed';out.textContent=error.stack;}
      document.body.append(out);
    });`;
    const html=await runBrowser({
      chrome:browser,
      profile:path.join(temp,'review-result-autoadvance'),
      url:await serve(),
      viewport:[1280,960],
      noSandbox:true,
      initScript,
    });
    const result=html.match(/<pre id="regressionResult"[^>]*>[\s\S]*?<\/pre>/)?.[0];
    assert.match(result||'',/data-result="passed"/,result||html.slice(-4000));
  });
});
