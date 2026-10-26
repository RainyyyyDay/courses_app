const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {fixture}=require('./temp-backend-fixture.cjs');
const {runBrowser}=require('./browser-driver.cjs');

test('course detail rename button updates title, cache and list on desktop and mobile',{timeout:120000},async()=>{
  await fixture(async({api,base,temp,serve})=>{
    const url=await serve();
    const chrome=['C:/Program Files/Google/Chrome/Application/chrome.exe',
      'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
      'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(fs.existsSync);
    assert.ok(chrome);
    for(const [index,viewport]of [[1280,960],[390,844]].entries()){
      const course=await api('POST','/courses',{name:'待编辑课程'+index},201);
      const script=`window.COURSES_API_BASE=${JSON.stringify(base)};addEventListener('load',async()=>{
        const out=document.createElement('pre');out.id='regressionResult';
        const check=(value,message)=>{if(!value)throw Error(message);};
        const wait=async(fn,label)=>{for(let i=0;i<300;i++){if(fn())return;await new Promise(r=>setTimeout(r,20));}throw Error('waiting: '+label);};
        try{
          await openCourse(${course.id},'待编辑课程${index}','materials');
          check(document.querySelector('.course-title-edit')?.getClientRects().length>0,'course page edit button is visible');
          openCourseRename();
          check(document.getElementById('courseModal').classList.contains('show')&&document.getElementById('courseModalTitle').textContent==='编辑课程名','rename modal opens');
          check(document.getElementById('courseNameInput').value==='待编辑课程${index}','rename input is prefilled');
          document.getElementById('courseNameInput').value='';
          await addCourse();
          check(document.getElementById('courseModal').classList.contains('show'),'empty name keeps editor open');
          document.getElementById('courseNameInput').value='修改后的课程${index}';
          await addCourse();
          await wait(()=>document.getElementById('detailTitle').textContent==='修改后的课程${index}','detail title refresh');
          check(currentCourseName==='修改后的课程${index}'&&localStorage.getItem('currentCourseName')==='修改后的课程${index}','current course cache updates');
          const rows=await requestList(API+'/courses');
          check(rows.find(row=>row.id===${course.id})?.name==='修改后的课程${index}','rename persists on server');
          check(document.documentElement.scrollWidth<=innerWidth+1,'rename control fits viewport');
          out.textContent='PASS';document.body.append(out);
        }catch(error){out.textContent='FAIL '+error.stack;document.body.append(out);}
      });`;
      const html=await runBrowser({chrome,profile:path.join(temp,'course-rename-'+index),url,viewport,noSandbox:true,initScript:script});
      const result=html.match(/<pre id="regressionResult">[\s\S]*?<\/pre>/)?.[0];
      assert.match(result||'',/>PASS</,result||html.slice(-2000));
    }
  });
});
