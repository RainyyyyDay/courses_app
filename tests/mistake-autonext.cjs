const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {fixture}=require('./temp-backend-fixture.cjs');
const {runBrowser}=require('./browser-driver.cjs');

test('completed native mistake reviews advance to the next queue item automatically',{timeout:90000},async()=>{
  await fixture(async({api,base,ids,temp,serve})=>{
    const coursePath='/courses/'+ids.courseId;
    const first=await api('POST',coursePath+'/mistakes',{
      title:'第一道自动下一题',content:'第一题',answerContent:'第一答案',mistakeType:'execution',questionFormat:'open',
    },201);
    const second=await api('POST',coursePath+'/mistakes',{
      title:'第二道自动下一题',content:'第二题',answerContent:'第二答案',mistakeType:'execution',questionFormat:'open',
    },201);
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
        await openCourse(${ids.courseId},'错题自动下一题','mistakes');
        await loadMistakes();
        const session=await createReviewRecord('total',[
          {type:'mistake',id:${first.id}},{type:'mistake',id:${second.id}}
        ],{requestId:'mistake-auto-next-session'});
        await enterCenterReview(session);
        await wait(()=>mistakeDetailState?.progress?.stage==='question'&&!mistakeReviewBusy,'first question');
        document.getElementById('mistakeFirstAnswer').value='独立作答';
        await submitMistakeReview('reveal_answer');
        await wait(()=>mistakeDetailState?.progress?.stage==='answer'&&!mistakeReviewBusy,'answer revealed');
        await submitMistakeReview('judge','correct',true);
        check(mistakeDetailState.progress.stage==='completed','first result saved before advancing');
        check(![...document.querySelectorAll('#centerReviewToolbar button')].some(button=>button.textContent.includes('返回复习队列')),'native result has no return-to-queue label');
        await wait(()=>currentCenterItem()?.item_id===${second.id},'native automatic next item');
        check(mistakeDetailState.id===${second.id},'second mistake detail loaded without manual next');
        out.dataset.result='passed';
      }catch(error){out.dataset.result='failed';out.textContent=error.stack;}
      document.body.append(out);
    });`;
    const html=await runBrowser({
      chrome:browser,
      profile:path.join(temp,'mistake-autonext'),
      url:await serve(),
      viewport:[1280,960],
      noSandbox:true,
      initScript,
    });
    const result=html.match(/<pre id="regressionResult"[^>]*>[\s\S]*?<\/pre>/)?.[0];
    assert.match(result||'',/data-result="passed"/,result||html.slice(-3500));
  });
});
